"""ifc_check — Modellprüfung gegen Pflicht-Psets, Container und GUID-Dubletten.

Standalone CLI:
    python ifc_check.py <ifc> [--regeln PFAD] [--json]

In-process: run(path, regeln=None) -> {"markdown": …, "json": …, "hinweis": …}

Bewertung: pass / warn / offen — NIE fail. Das ist die Ehrlichkeits-Konvention
der App (Checks zeigen Befunde, sie blockieren niemanden); ein Haftungs-
urteil bleibt dem Menschen vorbehalten, deshalb ist die härteste Stufe "warn".

Regeln: skills/ifc/references/pflicht-psets.yaml (Pflicht-Psets und
-Eigenschaften je IFC-Klasse, angelehnt an public/beispiel/musterprojekt.ids).
Dazu fest eingebaut: Elemente ohne räumlichen Container, doppelte GUIDs.
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

REGELN_DEFAULT = Path(__file__).resolve().parents[1] / "references" / "pflicht-psets.yaml"

# Status labels — stable strings, the tool result and tests rely on them.
PASS, WARN, OFFEN = "pass", "warn", "offen"


def load_rules(path: str | Path | None = None) -> list[dict]:
    """Reads pflicht-psets.yaml (YAML via PyYAML, a core harness dependency)."""
    import yaml

    regeln_path = Path(path) if path else REGELN_DEFAULT
    if not regeln_path.exists():
        return []
    data = yaml.safe_load(regeln_path.read_text(encoding="utf-8")) or {}
    return list(data.get("regeln") or [])


def _check_psets(model, regeln: list[dict]) -> list[dict]:
    """One finding per missing Pset / missing mandatory property (warn)."""
    import ifcopenshell.util.element

    befunde: list[dict] = []
    by_class: dict[str, dict] = {}
    for regel in regeln:
        by_class[str(regel.get("klasse", "")).upper()] = regel

    for element in model.by_type("IfcElement"):
        if element.is_a("IfcOpeningElement"):
            continue
        regel = by_class.get(element.is_a().upper())
        if not regel:
            continue
        psets = ifcopenshell.util.element.get_psets(element)
        for pflicht_pset in regel.get("psets") or []:
            name = pflicht_pset.get("name")
            values = psets.get(name)
            if values is None:
                befunde.append({"status": WARN, "element": _label(element),
                                "guid": element.GlobalId,
                                "text": f"Pset fehlt: {name}"})
                continue
            for prop in pflicht_pset.get("pflicht") or []:
                if prop not in values or values[prop] in (None, ""):
                    befunde.append({"status": WARN, "element": _label(element),
                                    "guid": element.GlobalId,
                                    "text": f"{name}.{prop} fehlt"})
    return befunde


def _label(element) -> str:
    return f"{element.is_a()} „{element.Name or '—'}“"


def _check_container(model) -> list[dict]:
    """Elements without a spatial container (warn) — the same check the app's
    model inspection runs; a homeless element is invisible in quantity takeoffs."""
    import ifcopenshell.util.element

    befunde = []
    for element in model.by_type("IfcElement"):
        if element.is_a("IfcOpeningElement"):
            continue  # openings hang on their host wall, not in a storey
        if ifcopenshell.util.element.get_container(element) is None:
            befunde.append({"status": WARN, "element": _label(element),
                            "guid": element.GlobalId,
                            "text": "kein räumlicher Container (Geschoss/Gebäude)"})
    return befunde


def _check_guids(model) -> list[dict]:
    """Duplicate GlobalIds (warn) — a duplicate breaks every GUID-keyed diff."""
    seen: dict[str, str] = {}
    befunde = []
    for element in model.by_type("IfcRoot"):
        guid = element.GlobalId
        if not guid:
            befunde.append({"status": OFFEN, "element": _label(element),
                            "guid": "", "text": "GlobalId leer"})
        elif guid in seen:
            befunde.append({"status": WARN, "element": _label(element),
                            "guid": guid,
                            "text": f"doppelte GUID (auch: {seen[guid]})"})
        else:
            seen[guid] = _label(element)
    return befunde


def run(path: str | Path, regeln: str | Path | None = None, **opts: Any) -> dict:
    """Full check: Pset rules + container + GUIDs. Status per finding, never fail."""
    try:
        model = open_ifc(path)
    except ValueError as exc:
        return error_result(str(exc))

    rules = load_rules(regeln)
    befunde = _check_psets(model, rules) + _check_container(model) + _check_guids(model)

    if not rules:
        befunde.append({"status": OFFEN, "element": "—", "guid": "",
                        "text": f"Regeldatei nicht gefunden: {regeln or REGELN_DEFAULT}"})

    n_warn = sum(1 for b in befunde if b["status"] == WARN)
    n_offen = sum(1 for b in befunde if b["status"] == OFFEN)
    status = WARN if n_warn else (OFFEN if n_offen else PASS)

    md = [f"# Modellprüfung — {Path(path).name}",
          f"Gesamtstatus: **{status}** (warn {n_warn}, offen {n_offen})", ""]
    if befunde:
        md.append(table_md(
            ["Status", "Element", "Befund", "GlobalId"],
            [[b["status"], b["element"], b["text"], f"`{b['guid']}`"] for b in befunde]))
    else:
        md.append("Alle Prüfungen bestanden — keine Befunde.")
    md.append("\nBewertung pass/warn/offen, nie fail: Befunde zeigen, nicht blockieren "
              "(Ehrlichkeits-Konvention der App).")

    return {"markdown": "\n".join(md), "hinweis": data_note(),
            "json": {"datei": str(path), "status": status,
                     "warn": n_warn, "offen": n_offen, "befunde": befunde}}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="IFC-Modell prüfen: Pflicht-Psets, Container, GUID-Dubletten.")
    parser.add_argument("ifc", help="IFC-Datei")
    parser.add_argument("--regeln", default=None,
                        help=f"Regel-YAML (Standard: {REGELN_DEFAULT})")
    parser.add_argument("--json", action="store_true", help="JSON statt Markdown")
    args = parser.parse_args(argv)

    result = run(args.ifc, args.regeln)
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
