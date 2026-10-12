"""ifc_write — apply changes to an IFC model and write it back (IFC2X3 and IFC4).

Standalone CLI:
    python ifc_write.py <ifc> --aenderungen <journal.json> [--abgabe --georef <georef.json>] [--out <ifc>]

In-process: run(path, aenderungen=[...], out=None, abgabe=False, georef=None) -> dict

Plan 71-05 (ROHB-05). The writer is the "apply on export" half of the attribute
editor (71-06) and the write step of the change service (71-09).

Change (Änderung) — the journal entry format of 71-06:
    {"guid": "<GlobalId>", "pset": "PRJ", "eigenschaft": "Material", "wert": "C30/37",
     "typ"?: "str"|"int"|"float"|"bool", "alt"?: <expected old value>}
    {"guid": "<GlobalId>", "attribut": "Name", "wert": "Stütze A1", "alt"?: ...}
`alt` present → the change is applied only while the model still holds that old
value; otherwise it is a conflict and NOT applied (never overwrite silently).

Guarantees, checked after writing by re-opening the new file:
- never in-place: <name>_v<n>.ifc next to the source (T-67-11 / T-71-05-01);
- schema unchanged (IFC2X3 stays IFC2X3);
- every GlobalId of the source is in the result, no duplicates.

Delivery export (abgabe=True): a second file <name>_abgabe_v<n>.ifc with the
georeference as metadata (ifcopenshell.api.georeference — IFC4 IfcMapConversion
+ IfcProjectedCRS, IFC2X3 ePSet_MapConversion + ePSet_ProjectedCRS on IfcProject,
the convention Bonsai reads). Geometry is NOT moved. Values only from
configuration — this module carries no project coordinates (NDA).

georef = {"ostwert": m, "nordwert": m, "hoehe": m, "drehung_grad": deg,
          "crs": "EPSG:…", "massstab"?: 1.0}
drehung_grad [ASSUMED convention]: angle from grid east to the project x axis,
counter-clockwise (IFC XAxisAbscissa = cos, XAxisOrdinate = sin). Survey plans
often give the angle clockwise from north — check the sign against the source.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import data_note, error_result, open_ifc, table_md  # noqa: E402

VIEW_2X3 = "ViewDefinition [CoordinationView_V2.0, QuantityTakeOffAddOnView]"
GEOREF_PFLICHT = ("ostwert", "nordwert", "hoehe", "drehung_grad", "crs")


def naechster_pfad(source: Path, zusatz: str = "") -> Path:
    """Smallest free "<stem><zusatz>_v<n>.ifc" next to the source."""
    n = 1
    while True:
        cand = source.with_name(f"{source.stem}{zusatz}_v{n}{source.suffix}")
        if not cand.exists():
            return cand
        n += 1


def _typed(value: Any, typ: str | None) -> Any:
    if typ is None or value is None:
        return value
    if typ == "bool":
        return value if isinstance(value, bool) else str(value).strip().lower() in ("true", "ja", "yes", "1")
    if typ == "int":
        return int(value)
    if typ == "float":
        return float(value)
    return str(value)


def _gleich(a: Any, b: Any) -> bool:
    """Value equality across JSON/IFC types (1 == 1.0, '1.0' == 1.0, rounding 1e-9)."""
    if a is None or b is None:
        return a is b
    if isinstance(a, bool) or isinstance(b, bool):
        return str(a).lower() == str(b).lower()
    try:
        return math.isclose(float(a), float(b), rel_tol=1e-9, abs_tol=1e-9)
    except (TypeError, ValueError):
        return str(a) == str(b)


def owner_einrichten(model) -> None:
    """IFC2X3 requires an OwnerHistory on every new rooted entity (psets!), and
    ifcopenshell.api asks owner.settings for user + application. Use the
    model's own (a Revit export has both); create "BIT-Atelier Harness" only
    when the model has none."""
    import ifcopenshell.api.owner
    import ifcopenshell.api.owner.settings as owner_settings

    def user(f):
        pao = next(iter(f.by_type("IfcPersonAndOrganization")), None)
        if pao is None and f.schema == "IFC2X3":  # IFC4: OwnerHistory optional, add nothing
            person = ifcopenshell.api.owner.add_person(f, identification="harness",
                                                       family_name="Harness", given_name="BIT-Atelier")
            org = ifcopenshell.api.owner.add_organisation(f, identification="bit-atelier", name="BIT-Atelier")
            pao = ifcopenshell.api.owner.add_person_and_organisation(f, person=person, organisation=org)
        return pao

    def application(f):
        app = next(iter(f.by_type("IfcApplication")), None)
        if app is None and f.schema == "IFC2X3":
            org = next(iter(f.by_type("IfcOrganization")), None) or \
                ifcopenshell.api.owner.add_organisation(f, identification="bit-atelier", name="BIT-Atelier")
            app = ifcopenshell.api.owner.add_application(
                f, application_developer=org, version="1", application_full_name="BIT-Atelier Harness",
                application_identifier="bit-atelier-harness")
        return app

    owner_settings.get_user = user
    owner_settings.get_application = application


def _pset_entity(element, pset_name: str):
    for rel in getattr(element, "IsDefinedBy", ()) or ():
        if rel.is_a("IfcRelDefinesByProperties") and rel.RelatingPropertyDefinition.Name == pset_name:
            return rel.RelatingPropertyDefinition
    return None


def aktueller_wert(model, change: dict[str, Any]) -> tuple[bool, Any]:
    """(element found?, current value) of the target of `change` in `model`."""
    import ifcopenshell.util.element

    try:
        element = model.by_guid(str(change.get("guid")))
    except RuntimeError:
        return False, None
    if change.get("attribut"):
        return True, getattr(element, str(change["attribut"]), None)
    psets = ifcopenshell.util.element.get_psets(element)
    return True, psets.get(str(change.get("pset")), {}).get(str(change.get("eigenschaft")))


def _pruefe_aenderung(change: Any) -> str | None:
    if not isinstance(change, dict):
        return "Änderung ist kein Objekt"
    if not change.get("guid"):
        return "guid fehlt"
    if change.get("attribut"):
        return None
    if not change.get("pset") or not change.get("eigenschaft"):
        return "pset und eigenschaft (oder attribut) fehlen"
    if "wert" not in change:
        return "wert fehlt"
    return None


def wende_an(model, aenderungen: list[dict[str, Any]], erzwingen: bool = False) -> list[dict[str, Any]]:
    """Applies the changes to the open model; returns one result row per change.

    status: angewendet | unveraendert (already that value) | konflikt | fehlt | ungueltig
    """
    import ifcopenshell.api.attribute
    import ifcopenshell.api.pset

    rows: list[dict[str, Any]] = []
    for i, change in enumerate(aenderungen):
        row: dict[str, Any] = {"nr": i + 1, **{k: change.get(k) for k in
                               ("guid", "pset", "attribut", "eigenschaft", "wert", "alt")
                               if isinstance(change, dict)}}
        fehler = _pruefe_aenderung(change)
        if fehler:
            rows.append({**row, "status": "ungueltig", "grund": fehler})
            continue
        gefunden, ist = aktueller_wert(model, change)
        if not gefunden:
            rows.append({**row, "status": "fehlt", "grund": "GlobalId nicht im Modell"})
            continue
        row["ist"] = ist
        neu = _typed(change.get("wert"), change.get("typ"))
        if _gleich(ist, neu):
            rows.append({**row, "status": "unveraendert"})
            continue
        if "alt" in change and not erzwingen and not _gleich(ist, change.get("alt")):
            rows.append({**row, "status": "konflikt",
                         "grund": f"Modell hat {ist!r}, erwartet war {change.get('alt')!r}"})
            continue
        element = model.by_guid(str(change["guid"]))
        if change.get("attribut"):
            try:
                ifcopenshell.api.attribute.edit_attributes(model, product=element,
                                                           attributes={str(change["attribut"]): neu})
            except Exception as exc:  # unknown attribute / wrong type: report, keep going
                rows.append({**row, "status": "ungueltig", "grund": f"{exc.__class__.__name__}: {exc}"})
                continue
        else:
            pset = _pset_entity(element, str(change["pset"]))
            if pset is not None and pset.is_a("IfcElementQuantity"):
                rows.append({**row, "status": "ungueltig",
                             "grund": f"{change['pset']} ist ein Mengensatz — Mengen schreibt der Writer nicht"})
                continue
            if pset is None:
                pset = ifcopenshell.api.pset.add_pset(model, product=element, name=str(change["pset"]))
            ifcopenshell.api.pset.edit_pset(model, pset=pset, properties={str(change["eigenschaft"]): neu})
        rows.append({**row, "status": "angewendet"})
    return rows


def _header(model) -> None:
    """IFC2X3 without a ViewDefinition gets CV 2.0 + QTO (BIM-AIA delivery); an
    existing description is kept as it is."""
    if model.schema != "IFC2X3":
        return
    fd = model.header.file_description  # ifcopenshell 0.8: file.header (kept on write)
    desc = list(fd.description or ())
    if not any("ViewDefinition" in d for d in desc):
        fd.description = tuple([VIEW_2X3] + desc)


def pruefe_georef(georef: Any) -> dict[str, Any]:
    """Validates a georef dict; raises ValueError with the missing keys."""
    if not isinstance(georef, dict):
        raise ValueError("georef fehlt — Werte in projects/<slug>/georef.yaml oder config.yaml ifc.georef setzen")
    fehlend = [k for k in GEOREF_PFLICHT if georef.get(k) in (None, "")]
    if fehlend:
        raise ValueError(f"georef unvollständig: {', '.join(fehlend)} fehlt")
    out = {k: float(georef[k]) for k in ("ostwert", "nordwert", "hoehe", "drehung_grad")}
    out["crs"] = str(georef["crs"])
    out["massstab"] = float(georef.get("massstab") or 1.0)
    return out


def setze_georef(model, georef: dict[str, Any]) -> dict[str, Any]:
    """Writes the georeference as metadata (see module docstring)."""
    import ifcopenshell.api.georeference

    g = pruefe_georef(georef)
    winkel = math.radians(g["drehung_grad"])
    op = {"Eastings": g["ostwert"], "Northings": g["nordwert"], "OrthogonalHeight": g["hoehe"],
          "XAxisAbscissa": math.cos(winkel), "XAxisOrdinate": math.sin(winkel), "Scale": g["massstab"]}
    ifcopenshell.api.georeference.add_georeferencing(model, name=g["crs"])
    # copy: edit_georeferencing consumes the dict it is given
    ifcopenshell.api.georeference.edit_georeferencing(model, coordinate_operation=dict(op),
                                                      projected_crs={"Name": g["crs"]})
    return {**op, "crs": g["crs"]}


def _verifiziere(quelle_guids: set[str], schema: str, pfad: Path) -> dict[str, Any]:
    neu = open_ifc(pfad)
    guids = [e.GlobalId for e in neu.by_type("IfcRoot")]
    fehlend = sorted(quelle_guids - set(guids))
    return {"datei": str(pfad), "schema": neu.schema, "schema_gleich": neu.schema == schema,
            "guids": len(guids), "guids_fehlend": fehlend[:20], "guids_fehlend_anzahl": len(fehlend),
            "dubletten": len(guids) - len(set(guids)), "entitaeten": len(list(neu))}


def run(path: str | Path, aenderungen: list[dict[str, Any]] | None = None, out: str | Path | None = None,
        abgabe: bool = False, georef: dict[str, Any] | None = None, erzwingen: bool = False,
        **opts: Any) -> dict:
    """Writes the changed model (and optionally the georeferenced delivery copy)."""
    source = Path(path)
    try:
        model = open_ifc(source)
    except ValueError as exc:
        return error_result(str(exc))
    if abgabe:
        try:
            pruefe_georef(georef)
        except ValueError as exc:
            return error_result(str(exc))
    aenderungen = list(aenderungen or [])
    schema = model.schema
    owner_einrichten(model)
    quelle_guids = {e.GlobalId for e in model.by_type("IfcRoot")}
    entitaeten_vorher = len(list(model))

    rows = wende_an(model, aenderungen, erzwingen=erzwingen)
    _header(model)
    ziel = Path(out) if out else naechster_pfad(source)
    if ziel.resolve() == source.resolve():
        return error_result(f"Zieldatei darf nicht die Quelle sein (T-67-11): {ziel}")
    ziel.parent.mkdir(parents=True, exist_ok=True)
    model.write(str(ziel))
    pruef = _verifiziere(quelle_guids, schema, ziel)

    abgabe_info = None
    if abgabe:
        werte = setze_georef(model, georef)
        abgabe_pfad = naechster_pfad(source, "_abgabe")
        model.write(str(abgabe_pfad))
        abgabe_info = {**_verifiziere(quelle_guids, schema, abgabe_pfad), "georef": werte}

    zaehl: dict[str, int] = {}
    for r in rows:
        zaehl[r["status"]] = zaehl.get(r["status"], 0) + 1
    ok = pruef["schema_gleich"] and not pruef["guids_fehlend_anzahl"] and not pruef["dubletten"]
    md = [f"# IFC geschrieben — {ziel.name}", "",
          f"- Quelle: `{source.name}` (unverändert) · Schema {schema}",
          f"- GUID-Erhalt: **{'ja' if ok else 'NEIN'}** — {len(quelle_guids)} der Quelle, "
          f"{pruef['guids_fehlend_anzahl']} fehlen, {pruef['dubletten']} doppelt",
          f"- Entitäten: {entitaeten_vorher} → {pruef['entitaeten']}",
          "- Änderungen: " + (", ".join(f"{v} {k}" for k, v in sorted(zaehl.items())) or "keine")]
    if rows:
        md += ["", table_md(["Nr", "GUID", "Ziel", "Wert", "Status", "Grund"],
                            [[str(r["nr"]), f"`{r.get('guid')}`",
                              r.get("attribut") or f"{r.get('pset')}.{r.get('eigenschaft')}",
                              str(r.get("wert")), r["status"], r.get("grund", "")] for r in rows])]
    if abgabe_info:
        md += ["", f"## Abgabe mit Georeferenz — {Path(abgabe_info['datei']).name}",
               f"- {abgabe_info['georef']['crs']}: Ost {abgabe_info['georef']['Eastings']:.4f} m, "
               f"Nord {abgabe_info['georef']['Northings']:.4f} m, Höhe {abgabe_info['georef']['OrthogonalHeight']:.3f} m",
               "- Geometrie unverändert, Georeferenz als Metadaten (Drehkonvention [ASSUMED], s. Skill)"]
    return {"markdown": "\n".join(md),
            "json": {"datei": str(ziel), "quelle": str(source), "schema": schema, "guid_erhalt": ok,
                     "pruefung": pruef, "aenderungen": rows, "zaehlung": zaehl, "abgabe": abgabe_info},
            "hinweis": data_note()}


def lade_journal(pfad: str | Path) -> list[dict[str, Any]]:
    """Reads an 71-06 journal file ({format: "bit-ifc-journal", eintraege: [...]}) or a bare list."""
    daten = json.loads(Path(pfad).read_text(encoding="utf-8"))
    if isinstance(daten, list):
        return daten
    if isinstance(daten, dict) and isinstance(daten.get("eintraege"), list):
        return daten["eintraege"]
    raise ValueError("Journal-Datei: erwartet {format: 'bit-ifc-journal', eintraege: [...]} oder eine Liste")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Änderungen in ein IFC schreiben (neue Datei, GUIDs bleiben).")
    parser.add_argument("ifc")
    parser.add_argument("--aenderungen", help="Journal-JSON (71-06) oder Liste von Änderungen")
    parser.add_argument("--out", help="Zieldatei (Standard <name>_v<n>.ifc)")
    parser.add_argument("--abgabe", action="store_true", help="zusätzlich Abgabe-Datei mit Georeferenz")
    parser.add_argument("--georef", help="JSON-Datei {ostwert, nordwert, hoehe, drehung_grad, crs}")
    parser.add_argument("--erzwingen", action="store_true", help="Konflikte (alt ≠ ist) trotzdem schreiben")
    args = parser.parse_args(argv)
    aend = lade_journal(args.aenderungen) if args.aenderungen else []
    georef = json.loads(Path(args.georef).read_text(encoding="utf-8")) if args.georef else None
    result = run(args.ifc, aend, out=args.out, abgabe=args.abgabe, georef=georef, erzwingen=args.erzwingen)
    if "error" in result:
        print(result["error"], file=sys.stderr)
        return 1
    print(result["markdown"])
    return 0 if result["json"]["guid_erhalt"] else 2


if __name__ == "__main__":
    sys.exit(main())
