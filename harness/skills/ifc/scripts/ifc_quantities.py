"""ifc_quantities — Mengenauszug eines IFC-Modells mit Quellen-Spalte.

Standalone CLI:
    python ifc_quantities.py <ifc> [--klasse IfcWall] [--geometrie] [--json]

In-process: run(path, klasse=None, geometrie=False) -> dict

Leseweg (Vorgabe 67-03-REVIEW-TASK1 §4.2): Mengensätze werden über
IsDefinedBy → IfcElementQuantity gesucht, NICHT über den Namen des Satzes —
mini.ifc (App-Fixture) trägt zwei Sätze, die schlicht "BaseQuantities" heißen.

Fehlen Mengen, liefert --geometrie Flächen/Volumen aus dem Mesh
(ifcopenshell.geom, USE_WORLD_COORDS); die Zeile trägt dann die Quelle
"Geometrie [ASSUMED]" — Mesh-Werte sind Näherungen, keine Qto-Zusagen.
Ohne --geometrie steht dort "fehlend" (DoS-Schutz T-67-10: Geometrie nur
auf Anfrage, große Modelle bleiben schnell).

Einheiten: Length/Width/Height/Perimeter in m, *Area in m², *Volume in m³.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

# Standalone scripts are not a package: put the own directory on sys.path so
# `import common` also works when started from another cwd (or loaded via
# importlib from the tests). common.py does the same once imported — this
# bootstrap is what makes THAT import possible in the first place.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import data_note, error_result, fmt_de, geo_area_volume, open_ifc, table_md  # noqa: E402

# Quantities shown per element, in the order of the app's IFC_QUANTITY_KEYS
# (packages/nova-core/src/lib/bimElements.js) — same vocabulary, same units.
QUANTITY_KEYS = ("Length", "Width", "Height", "Perimeter",
                 "GrossSideArea", "NetSideArea", "GrossArea", "NetArea",
                 "GrossVolume", "NetVolume", "Area", "Volume")

UNITS = {"m": ("Length", "Width", "Height", "Perimeter"),
         "m²": ("GrossSideArea", "NetSideArea", "GrossArea", "NetArea", "Area"),
         "m³": ("GrossVolume", "NetVolume", "Volume")}


def _unit_of(key: str) -> str:
    for unit, keys in UNITS.items():
        if key in keys:
            return unit
    return ""


def _quantity_sets(element) -> list[tuple[str, dict[str, Any]]]:
    """All IfcElementQuantity sets of `element` via IsDefinedBy (name-agnostic).

    Returns [(set name, {quantity name: value})]; the 'id' entries that
    get_psets() mixes in are dropped here, not by the caller.
    """
    import ifcopenshell.util.element

    sets: list[tuple[str, dict[str, Any]]] = []
    qtos = ifcopenshell.util.element.get_psets(element, qtos_only=True)
    for name in sorted(qtos):
        if name == "id":
            continue
        values = {k: v for k, v in qtos[name].items() if k != "id"}
        sets.append((name, values))
    return sets


def run(path: str | Path, klasse: str | None = None, geometrie: bool = False,
        **opts: Any) -> dict:
    """Mengenauszug: eine Zeile je Bauteil mit den gefundenen Mengen.

    geometrie=True aktiviert den Mesh-Fallback für Bauteile ohne Qto
    ([ASSUMED], langsam — deshalb opt-in, T-67-10).
    """
    try:
        model = open_ifc(path)
    except ValueError as exc:
        return error_result(str(exc))

    classes = [klasse] if klasse else ["IfcElement"]
    seen: set[int] = set()
    rows_md: list[list[str]] = []
    rows_json: list[dict] = []
    warnungen: list[str] = []

    for ifc_class in classes:
        for element in model.by_type(ifc_class):
            if id(element) in seen or element.is_a("IfcOpeningElement"):
                continue  # IfcElement double-catches subclasses; openings are not quantities
            seen.add(id(element))

            quantities: dict[str, float] = {}
            quelle = "Qto"
            sets = _quantity_sets(element)
            for _set_name, values in sets:
                for key, value in values.items():
                    if key in QUANTITY_KEYS and isinstance(value, (int, float)):
                        # Two sets with the same key: last one wins — same
                        # convention as the app's ifcImport.js (L4 note there).
                        quantities[key] = float(value)

            if not quantities:
                if geometrie:
                    area, volume = geo_area_volume(model, element)
                    if area is not None:
                        quantities = {"NetSideArea": area, "NetVolume": volume or 0.0}
                        quelle = "Geometrie [ASSUMED]"
                    else:
                        quelle = "fehlend"
                        warnungen.append(
                            f"{element.is_a()} „{element.Name}“: keine Mengen, keine Geometrie")
                else:
                    quelle = "fehlend"
                    warnungen.append(
                        f"{element.is_a()} „{element.Name}“: keine Mengensätze "
                        "(--geometrie für Mesh-Fallback)")

            label = f"{element.is_a()} „{element.Name or '—'}“"
            cells = [label, quelle]
            for key in QUANTITY_KEYS:
                if key in quantities:
                    cells.append(f"{fmt_de(quantities[key], 3)} {_unit_of(key)}".strip())
            if len(cells) == 2:
                cells.append("—")
            rows_md.append(cells)
            rows_json.append({"guid": element.GlobalId, "klasse": element.is_a(),
                              "name": element.Name, "quelle": quelle,
                              "mengen": quantities})

    header = ["Bauteil", "Quelle", "Mengen (m / m² / m³)"]
    md = [f"# Mengenauszug — {Path(path).name}", "",
          table_md(header, [[r[0], r[1], "; ".join(r[2:])] for r in rows_md])
          if rows_md else "_(keine Bauteile)_"]
    if warnungen:
        md.append("\n## Warnungen")
        md.extend(f"- {w}" for w in warnungen)
    return {"markdown": "\n".join(md),
            "json": {"datei": str(path), "positionen": rows_json,
                     "warnungen": warnungen},
            "hinweis": data_note()}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Mengenauszug eines IFC-Modells (Qto_*BaseQuantities, Geometrie-Fallback).")
    parser.add_argument("ifc", help="IFC-Datei")
    parser.add_argument("--klasse", default=None, help="nur diese IFC-Klasse (z. B. IfcWall)")
    parser.add_argument("--geometrie", action="store_true",
                        help="Mesh-Fallback für Bauteile ohne Mengen ([ASSUMED], langsam)")
    parser.add_argument("--json", action="store_true", help="JSON statt Markdown")
    args = parser.parse_args(argv)

    result = run(args.ifc, args.klasse, args.geometrie)
    if "error" in result:
        print(result["error"], file=sys.stderr)
        return 1
    if args.json:
        import json
        print(json.dumps(result["json"], ensure_ascii=False, indent=2))
    else:
        print(result["markdown"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
