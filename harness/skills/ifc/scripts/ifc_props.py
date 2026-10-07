"""ifc_props — Property-Sets eines IFC-Modells lesen und (Roundtrip) schreiben.

Standalone CLI:
    python ifc_props.py <ifc> [GUID] [--json]
    python ifc_props.py <ifc> --set GUID PSET NAME WERT [--out PFAD]

In-process: run(path, guid=None) -> {"markdown": …, "json": …, …}
            set_property(path, guid, pset, name, value, out_path) -> dict

T-67-11 (threat model 67-03): set_property writes ALWAYS to out_path, never
in-place. Default out_path is "<name>_v<n>.ifc" next to the source with the
smallest free n, so an original can never be overwritten by accident.

Value typing: IFC properties are typed. Strings starting with a digit and
pure numbers become IfcReal/IfcInteger, "true"/"false" IfcBoolean, everything
else IfcLabel — the caller can force the type with --type.
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

from common import data_note, error_result, fmt_de, open_ifc, table_md  # noqa: E402


def _default_out_path(source: str | Path) -> Path:
    """Smallest free "<name>_v<n>.ifc" next to the source (T-67-11)."""
    p = Path(source)
    n = 1
    while True:
        candidate = p.with_name(f"{p.stem}_v{n}{p.suffix}")
        if not candidate.exists():
            return candidate
        n += 1


def _typed(value: str, typ: str | None = None) -> Any:
    """Converts a CLI string to the Python type ifcopenshell maps to IFC.

    typ (optional): "str" | "int" | "float" | "bool" — forces the conversion;
    without it numbers become float, true/false become bool, rest str.
    """
    if typ == "bool" or (typ is None and value.lower() in ("true", "false")):
        return value.lower() in ("true", "ja", "yes", "1")
    if typ == "int":
        return int(value)
    if typ in ("float",) or (typ is None and _is_number(value)):
        return float(value)
    return value


def _is_number(value: str) -> bool:
    try:
        float(value)
        return True
    except ValueError:
        return False


def _find_element(model, guid: str | None):
    """GUID -> element, or the first IfcWall when guid is None (test convenience)."""
    if guid:
        try:
            return model.by_guid(guid)
        except Exception:
            return None
    walls = model.by_type("IfcWall")
    return walls[0] if walls else None


def read_props(path: str | Path, guid: str | None = None) -> dict:
    """All Psets/Qto of one element (or of the first wall) as tables.

    Returns {"markdown", "json", "hinweis"} or {"error"}.
    """
    import ifcopenshell.util.element

    try:
        model = open_ifc(path)
    except ValueError as exc:
        return error_result(str(exc))

    element = _find_element(model, guid)
    if element is None:
        return error_result(
            f"Element nicht gefunden: {guid or '(keine IfcWall im Modell)'}")

    psets = ifcopenshell.util.element.get_psets(element)
    pset_rows: list[list[str]] = []
    qto_rows: list[list[str]] = []
    for set_name in sorted(psets):
        if set_name == "id":
            continue
        for prop_name in sorted(psets[set_name]):
            if prop_name == "id":
                continue
            value = psets[set_name][prop_name]
            row = [set_name, prop_name, _value_md(value)]
            (qto_rows if set_name.startswith("Qto_") else pset_rows).append(row)

    md = [f"# Property-Sets — {element.is_a()} „{element.Name or '—'}“",
          f"GlobalId: `{element.GlobalId}`", ""]
    md.append("## Psets")
    md.append(table_md(["Pset", "Eigenschaft", "Wert"], pset_rows) if pset_rows else "_(keine)_")
    md.append("\n## Mengensätze (Qto)")
    md.append(table_md(["Qto", "Menge", "Wert"], qto_rows) if qto_rows else "_(keine)_")

    json_out = {
        "datei": str(path), "guid": element.GlobalId, "klasse": element.is_a(),
        "name": element.Name,
        "psets": {k: v for k, v in psets.items() if k != "id"},
    }
    return {"markdown": "\n".join(md), "json": json_out, "hinweis": data_note()}


def _value_md(value: Any) -> str:
    if isinstance(value, bool):
        return "ja" if value else "nein"
    if isinstance(value, float):
        return fmt_de(value, 3)
    if value is None:
        return "—"
    return str(value)


def _pset_entity(model, element, pset_name: str):
    """Finds the IfcPropertySet/IfcElementQuantity ENTITY of `pset_name` on
    `element`, or None. ifcopenshell.util.element.get_pset() returns the value
    DICT, not the entity — but api.pset.edit_pset needs the entity.
    Walks IsDefinedBy instead (the reliable way in 0.8.5)."""
    for rel in getattr(element, "IsDefinedBy", ()) or ():
        if rel.is_a("IfcRelDefinesByProperties") and rel.RelatingPropertyDefinition.Name == pset_name:
            return rel.RelatingPropertyDefinition
    return None


def set_property(path: str | Path, guid: str | None, pset: str, name: str,
                 value: Any, out_path: str | Path | None = None,
                 typ: str | None = None) -> dict:
    """Roundtrip: read -> set one property -> write to out_path -> verify.

    NEVER writes in-place (T-67-11). out_path defaults to "<name>_v<n>.ifc".
    `value` may already be typed (int/float/bool/str); strings are converted
    per _typed(). Returns {"markdown", "json"} or {"error"}.
    """
    import ifcopenshell.api.pset
    import ifcopenshell.util.element

    try:
        model = open_ifc(path)
    except ValueError as exc:
        return error_result(str(exc))

    element = _find_element(model, guid)
    if element is None:
        return error_result(f"Element nicht gefunden: {guid or '(keine IfcWall)'}")

    typed = _typed(value, typ) if isinstance(value, str) else value

    # Does the Pset exist on this element? If yes, edit the ENTITY; if not,
    # add it. (ifcopenshell 0.8.5: api.pset.edit_pset takes the pset entity —
    # util.element.get_pset only returns the value dict, see _pset_entity.)
    existing = _pset_entity(model, element, pset)
    if existing is None:
        existing = ifcopenshell.api.pset.add_pset(model, product=element, name=pset)
    ifcopenshell.api.pset.edit_pset(model, pset=existing, properties={name: typed})

    out = Path(out_path) if out_path else _default_out_path(path)
    if out.resolve() == Path(path).resolve():
        return error_result(
            f"out_path darf nicht die Quelldatei sein (T-67-11): {out}")
    out.parent.mkdir(parents=True, exist_ok=True)
    model.write(str(out))

    # Verify by re-reading: the value must survive the roundtrip.
    reopened = open_ifc(out)
    again = reopened.by_guid(element.GlobalId)
    check = ifcopenshell.util.element.get_psets(again).get(pset, {}).get(name)

    md = [f"# Property gesetzt — {again.is_a()} „{again.Name or '—'}“",
          f"- Datei (neu): `{out}`",
          f"- GlobalId: `{again.GlobalId}` (unverändert)",
          f"- {pset}.{name} = {_value_md(check)}",
          "",
          "Die Quelldatei wurde NICHT verändert (T-67-11)."]
    json_out = {"datei": str(out), "quelle": str(path), "guid": again.GlobalId,
                "pset": pset, "name": name, "wert": check,
                "wert_typ": type(typed).__name__}
    return {"markdown": "\n".join(md), "json": json_out, "hinweis": data_note()}


def run(path: str | Path, guid: str | None = None, **opts: Any) -> dict:
    """In-process entry for harness/tools/ifc.py."""
    if opts.get("set"):
        pset, name, value = opts["set"]
        return set_property(path, guid, pset, name, value,
                            out_path=opts.get("out"), typ=opts.get("typ"))
    return read_props(path, guid)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Property-Sets eines IFC-Modells lesen oder schreiben (Roundtrip).")
    parser.add_argument("ifc", help="IFC-Datei")
    parser.add_argument("guid", nargs="?", default=None,
                        help="GlobalId des Elements (Standard: erste IfcWall)")
    parser.add_argument("--json", action="store_true", help="JSON statt Markdown")
    parser.add_argument("--set", nargs=3, metavar=("PSET", "NAME", "WERT"),
                        help="Property setzen (Roundtrip)")
    parser.add_argument("--type", choices=["str", "int", "float", "bool"],
                        help="Typ für --set erzwingen")
    parser.add_argument("--out", default=None,
                        help="Zieldatei für --set (Standard: <name>_v<n>.ifc)")
    args = parser.parse_args(argv)

    result = run(args.ifc, args.guid, set=tuple(args.set) if args.set else None,
                 typ=args.type, out=args.out)
    if "error" in result:
        print(result["error"], file=sys.stderr)
        return 1
    if args.json:
        import json
        print(json.dumps(result["json"], ensure_ascii=False, indent=2, default=str))
    else:
        print(result["markdown"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
