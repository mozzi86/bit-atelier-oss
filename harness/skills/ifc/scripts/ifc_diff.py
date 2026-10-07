"""ifc_diff — Modellvergleich zweier IFC-Versionen über GlobalId.

Standalone CLI:
    python ifc_diff.py <alt.ifc> <neu.ifc> [--volumen] [--json]

In-process: run(alt, neu, volumen=False) -> {"markdown": …, "json": …}

Verglichen werden NUR IfcRoot-Bauteile (IfcElement + räumliche Struktur),
keine Relationen: deren GUIDs hängen im Beispielgenerator an einem laufenden
Zähler (Review M-1) — ein zusätzliches Pset würde sie alle verschieben und
der Diff bestünde nur aus Rauschen.

"geändert" = Attribut- oder Pset/Qto-Wert anders; mit --volumen zusätzlich
Geometrie-Volumen ± 1 % anders (Plan 67-03 <interfaces>). Volumenvergleich
ist langsam (Mesh je Bauteil) — deshalb opt-in (T-67-10).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

from common import data_note, error_result, fmt_de, geo_area_volume, open_ifc, table_md  # noqa: E402


def _element_fingerabdruck(element) -> dict[str, Any]:
    """Comparable fingerprint of one element: the attributes that matter for
    a model revision (name, type, key dimensions) plus all Pset/Qto values."""
    import ifcopenshell.util.element

    psets = ifcopenshell.util.element.get_psets(element)
    werte = {f"{satz}.{prop}": v
             for satz, props in psets.items() if satz != "id"
             for prop, v in props.items() if prop != "id"}
    return {
        "klasse": element.is_a(),
        "name": element.Name or "",
        "predefined_type": getattr(element, "PredefinedType", None) or "",
        "werte": werte,
    }


def _sammle(model) -> dict[str, dict[str, Any]]:
    """GUID -> fingerprint for every compared element of one file.

    Compared: IfcElement (without openings) + the spatial structure
    (project/site/building/storey) — a storey rename is a real change.
    """
    out: dict[str, dict[str, Any]] = {}
    for element in model.by_type("IfcElement"):
        if element.is_a("IfcOpeningElement"):
            continue  # openings follow their window/door; comparing both double-counts
        out[element.GlobalId] = _element_fingerabdruck(element)
    for structure in model.by_type("IfcSpatialStructureElement"):
        out[structure.GlobalId] = _element_fingerabdruck(structure)
    return out


def _volumen(model, guid: str) -> float | None:
    """Mesh volume [m3] of one element, or None without representation."""
    try:
        element = model.by_guid(guid)
    except Exception:
        return None
    _area, volume = geo_area_volume(model, element)
    return volume


def run(alt: str | Path, neu: str | Path, volumen: bool = False, **opts: Any) -> dict:
    """Three tables: neu / entfallen / geändert (plan 67-03 <interfaces>)."""
    try:
        model_alt = open_ifc(alt)
        model_neu = open_ifc(neu)
    except ValueError as exc:
        return error_result(str(exc))

    alt_map = _sammle(model_alt)
    neu_map = _sammle(model_neu)

    guids_neu = sorted(set(neu_map) - set(alt_map))
    guids_weg = sorted(set(alt_map) - set(neu_map))
    guids_gleich = sorted(set(alt_map) & set(neu_map))

    geaendert: list[dict] = []
    for guid in guids_gleich:
        a, n = alt_map[guid], neu_map[guid]
        gründe: list[str] = []
        if a["name"] != n["name"]:
            gründe.append(f"Name: „{a['name']}“ → „{n['name']}“")
        if a["predefined_type"] != n["predefined_type"]:
            gründe.append(f"PredefinedType: {a['predefined_type'] or '—'} → "
                          f"{n['predefined_type'] or '—'}")
        for key in sorted(set(a["werte"]) | set(n["werte"])):
            va, vn = a["werte"].get(key), n["werte"].get(key)
            if va != vn:
                gründe.append(f"{key}: {va!r} → {vn!r}")
        if volumen:
            # ± 1 % per plan; below that the mesh difference is noise.
            vol_a = _volumen(model_alt, guid)
            vol_n = _volumen(model_neu, guid)
            if vol_a is not None and vol_n is not None and vol_a > 0:
                if abs(vol_n - vol_a) / vol_a > 0.01:
                    gründe.append(f"Volumen [ASSUMED Geometrie]: "
                                  f"{fmt_de(vol_a, 3)} → {fmt_de(vol_n, 3)} m³")
        if gründe:
            geaendert.append({"guid": guid, "klasse": n["klasse"], "name": n["name"],
                              "gruende": gründe})

    def _zeile(guid: str, quelle: dict) -> list[str]:
        e = quelle[guid]
        return [e["klasse"], e["name"] or "—", f"`{guid}`"]

    md = [f"# Modellvergleich — {Path(alt).name} → {Path(neu).name}",
          f"Neu: {len(guids_neu)} · Entfallen: {len(guids_weg)} · Geändert: {len(geaendert)}",
          ""]
    md.append("## Neu")
    md.append(table_md(["Klasse", "Name", "GlobalId"],
                       [_zeile(g, neu_map) for g in guids_neu]) if guids_neu else "_(keine)_")
    md.append("\n## Entfallen")
    md.append(table_md(["Klasse", "Name", "GlobalId"],
                       [_zeile(g, alt_map) for g in guids_weg]) if guids_weg else "_(keine)_")
    md.append("\n## Geändert")
    if geaendert:
        md.append(table_md(
            ["Klasse", "Name", "GlobalId", "Änderungen"],
            [[e["klasse"], e["name"] or "—", f"`{e['guid']}`", "; ".join(e["gruende"])]
             for e in geaendert]))
    else:
        md.append("_(keine)_")
    if not volumen:
        md.append("\nGeometrie-Volumen wurde nicht verglichen (--volumen, langsam).")
    md.append("\nRelationen werden bewusst nicht verglichen (Review M-1: ihre "
              "GUIDs sind generatorintern und verschieben sich bei jeder Änderung).")

    return {"markdown": "\n".join(md), "hinweis": data_note(),
            "json": {"alt": str(alt), "neu": str(neu),
                     "neu_ids": guids_neu, "entfallen_ids": guids_weg,
                     "geaendert": geaendert,
                     "volumen_verglichen": bool(volumen)}}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Zwei IFC-Versionen über GlobalId vergleichen (neu/entfallen/geändert).")
    parser.add_argument("alt", help="alte IFC-Datei")
    parser.add_argument("neu", help="neue IFC-Datei")
    parser.add_argument("--volumen", action="store_true",
                        help="auch Geometrie-Volumen ±1 %% vergleichen (langsam, [ASSUMED])")
    parser.add_argument("--json", action="store_true", help="JSON statt Markdown")
    args = parser.parse_args(argv)

    result = run(args.alt, args.neu, args.volumen)
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
