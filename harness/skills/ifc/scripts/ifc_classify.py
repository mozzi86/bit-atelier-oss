"""ifc_classify — Klassifikationen eines IFC-Modells lesen (oder vorschlagen).

Standalone CLI:
    python ifc_classify.py <ifc> [--json]

In-process: run(path) -> {"markdown": …, "json": …, "hinweis": …}

Zweigleisig (Vorgabe 67-03-REVIEW-TASK1 §4.5):
1. Lese-Fall: IfcRelAssociatesClassification vorhanden → Classification-Code
   und Name werden ausgegeben (Beispiel: mini.ifc, IFCCLASSIFICATION "BUERO").
2. Heuristik-Fall: keine Klassifikation im Modell → Vorschlag aus IFC-Klasse
   und Pset-Heuristik, jede Zeile mit "[ASSUMED]" markiert (Beispiel: efh.ifc).
   Die Heuristik lehnt sich an die KG-Logik der App an
   (packages/nova-core/src/lib/bimClassification.js: kgFromKind) — deliberately
   NOT imported (import boundaries: the harness never imports app JS).
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

from common import data_note, error_result, open_ifc, table_md  # noqa: E402

# Heuristic mapping IFC class -> (Kostengruppe DIN 276, Gewerk-Label).
# [ASSUMED] Richtwerte für Wohnbau; ersetzt keine echte Klassifikation.
HEURISTIK = {
    "IfcWall": ("310", "Wand"),
    "IfcSlab": ("320", "Decke/Bodenplatte"),
    "IfcRoof": ("340", "Dach"),
    "IfcWindow": ("341", "Fenster"),
    "IfcDoor": ("342", "Türen"),
    "IfcColumn": ("310", "Stütze"),
    "IfcBeam": ("310", "Unterzug"),
    "IfcStair": ("340", "Treppe"),
    "IfcRailing": ("340", "Geländer"),
    "IfcCovering": ("350", "Bekleidung/Belag"),
}


def _classifications(element) -> list[tuple[str, str]]:
    """Read IfcRelAssociatesClassification of one element.

    Returns [(source, code, name)] — source is the classification title
    (e.g. "BUERO"). One element MAY carry several references (mini.ifc #31 has
    two: code "10" and a codeless "tragend").
    """
    out: list[tuple[str, str]] = []
    for rel in getattr(element, "HasAssociations", ()) or ():
        if not rel.is_a("IfcRelAssociatesClassification"):
            continue
        ref = rel.RelatingClassification
        if ref.is_a("IfcClassificationReference"):
            source = ""
            if ref.ReferencedSource and ref.ReferencedSource.is_a("IfcClassification"):
                source = ref.ReferencedSource.Name or ""
            out.append((source, ref.Identification or "", ref.Name or ""))
        elif ref.is_a("IfcClassification"):
            out.append((ref.Name or "", "", ""))
    return out


def _heuristic(element) -> tuple[str, str]:
    """[ASSUMED] proposal from the IFC class + PredefinedType/Pset hints."""
    import ifcopenshell.util.element

    kg, gewerk = HEURISTIK.get(element.is_a(), ("—", element.is_a()))
    # Roof panels are IfcSlab with PredefinedType ROOF — the roof KG fits better.
    if element.is_a("IfcSlab") and element.PredefinedType == "ROOF":
        kg, gewerk = "340", "Dachfläche"
    psets = ifcopenshell.util.element.get_psets(element)
    if psets.get("Pset_WallCommon", {}).get("LoadBearing") is False:
        gewerk += " (nicht tragend)"
    return kg, gewerk


def run(path: str | Path, **opts: Any) -> dict:
    """Klassifikationsliste: gelesen oder vorgeschlagen, nie gemischt pro Zeile."""
    try:
        model = open_ifc(path)
    except ValueError as exc:
        return error_result(str(exc))

    elements = [e for e in model.by_type("IfcElement") if not e.is_a("IfcOpeningElement")]
    rows_md: list[list[str]] = []
    rows_json: list[dict] = []
    gelesen = 0
    vorgeschlagen = 0

    for element in sorted(elements, key=lambda e: (e.is_a(), e.Name or "")):
        label = f"{element.is_a()} „{element.Name or '—'}“"
        refs = _classifications(element)
        if refs:
            gelesen += 1
            for source, code, name in refs:
                rows_md.append([label, source or "—", code or "—", name or "—", "gelesen"])
                rows_json.append({"guid": element.GlobalId, "klasse": element.is_a(),
                                  "quelle": source, "code": code, "name": name,
                                  "herkunft": "gelesen"})
        else:
            vorgeschlagen += 1
            kg, gewerk = _heuristic(element)
            rows_md.append([label, "—", kg, f"{gewerk} [ASSUMED]", "Vorschlag"])
            rows_json.append({"guid": element.GlobalId, "klasse": element.is_a(),
                              "quelle": "", "code": kg, "name": gewerk,
                              "herkunft": "heuristik [ASSUMED]"})

    md = [f"# Klassifikationen — {Path(path).name}",
          f"Gelesen: {gelesen} · Vorschlag [ASSUMED]: {vorgeschlagen}", ""]
    md.append(table_md(["Bauteil", "System", "Code", "Bezeichnung", "Herkunft"], rows_md)
              if rows_md else "_(keine Bauteile)_")
    if vorgeschlagen:
        md.append("\nVorschläge sind Heuristik aus IFC-Klasse und Psets "
                  "([ASSUMED], DIN-276-Richtwerte für Wohnbau) — keine echte Klassifikation.")
    return {"markdown": "\n".join(md),
            "json": {"datei": str(path), "gelesen": gelesen,
                     "vorgeschlagen": vorgeschlagen, "zeilen": rows_json},
            "hinweis": data_note()}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Klassifikationen eines IFC-Modells lesen oder vorschlagen.")
    parser.add_argument("ifc", help="IFC-Datei")
    parser.add_argument("--json", action="store_true", help="JSON statt Markdown")
    args = parser.parse_args(argv)

    result = run(args.ifc)
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
