"""ifc_list — Bauteilliste eines IFC-Modells, nach Klasse UND PredefinedType.

Standalone CLI:
    python ifc_list.py <ifc> [--klasse IfcWall] [--json]

In-process: run(path, klasse=None) -> {"markdown": …, "json": …, "hinweis": …}

Gruppierung nach PredefinedType, nicht nur nach IFC-Klasse (Vorgabe aus
67-03-REVIEW-TASK1 §4.1): sonst meldet /ifc liste "fünf Decken", obwohl drei
Geschossdecken und zwei Dachflächen gemeint sind.
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

# Classes shown by default — building elements plus their aggregates.
STANDARD_CLASSES = (
    "IfcWall", "IfcSlab", "IfcRoof", "IfcWindow", "IfcDoor",
    "IfcColumn", "IfcBeam", "IfcStair", "IfcRailing", "IfcCovering",
    "IfcPlate", "IfcMember", "IfcBuildingElementProxy",
)


def _container_name(element) -> str:
    """Storey (or site/building) the element hangs in — '' when none."""
    import ifcopenshell.util.element

    container = ifcopenshell.util.element.get_container(element)
    return container.Name if container is not None else ""


def run(path: str | Path, klasse: str | None = None, **opts: Any) -> dict:
    """Bauteilliste als Markdown-Tabellen + JSON.

    klasse: optional auf eine IFC-Klasse beschränken (z. B. "IfcWall").
    """
    try:
        model = open_ifc(path)
    except ValueError as exc:
        return error_result(str(exc))

    classes = [klasse] if klasse else list(STANDARD_CLASSES)
    groups: dict[tuple[str, str], list[dict]] = {}
    for ifc_class in classes:
        for element in model.by_type(ifc_class):
            # IfcRoof aggregates IfcSlab panels; by_type("IfcSlab") catches
            # them too, so skip nothing — PredefinedType keeps them apart.
            key = (element.is_a(), element.PredefinedType or "—")
            row = {
                "guid": element.GlobalId,
                "name": element.Name or "—",
                "geschoss": _container_name(element),
            }
            groups.setdefault(key, []).append(row)

    # One table per class; inside it one line per PredefinedType group.
    md = [f"# Bauteilliste — {Path(path).name}", ""]
    total = 0
    json_groups = []
    for (ifc_class, ptype) in sorted(groups):
        rows = groups[(ifc_class, ptype)]
        total += len(rows)
        md.append(f"## {ifc_class} · {ptype} ({len(rows)})")
        md.append(table_md(
            ["Name", "Geschoss", "GlobalId"],
            [[r["name"], r["geschoss"] or "—", f"`{r['guid']}`"] for r in rows]))
        md.append("")
        json_groups.append({"klasse": ifc_class, "predefined_type": ptype,
                            "anzahl": len(rows), "elemente": rows})
    if not groups:
        md.append("_(keine Bauteile der gefragten Klassen)_")

    md.insert(1, f"Bauteile gesamt: **{total}**\n")
    return {"markdown": "\n".join(md),
            "json": {"datei": str(path), "gesamt": total, "gruppen": json_groups},
            "hinweis": data_note()}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Bauteilliste eines IFC-Modells (nach Klasse und PredefinedType).")
    parser.add_argument("ifc", help="IFC-Datei")
    parser.add_argument("--klasse", default=None, help="nur diese IFC-Klasse (z. B. IfcWall)")
    parser.add_argument("--json", action="store_true", help="JSON statt Markdown")
    args = parser.parse_args(argv)

    result = run(args.ifc, args.klasse)
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
