"""fc_export_ifc — IFC4 export from FreeCAD plus quantity post-processing.

Runs INSIDE FreeCAD's own Python (freecadcmd or the GUI), never in the
harness venv. Three roles:

1. Shared I/O for every fc_*.py script: input/output JSON paths come from
   the environment (FC_HARNESS_IN / FC_HARNESS_OUT), because freecadcmd 1.1
   treats every argument after the script as a file to OPEN (it tried to
   import in.json as a FEM mesh). run_entry() turns any exception into
   {"ok": false, "error", "traceback"} in the output file.
2. export_ifc(objs, path, meta): FreeCAD's exporter (importers.exportIFC,
   FreeCAD 1.x — the 0.21 module `importIFC` no longer exists), then
   IfcOpenShell (bundled with FreeCAD) writes Qto_* base quantities computed
   from the FreeCAD shapes and the correct PredefinedType. Without this the
   exporter writes no quantities at all and IfcWall.PredefinedType=MOVABLE.
3. Standalone: {"fcstd": "<file>", "ifc": "<file>"} → exports a saved model.

Input JSON (standalone): {"fcstd": str, "ifc": str}
Output JSON: {"ok": true, "ifc": str, "elemente": [{name, klasse, ...}]}
"""

from __future__ import annotations

import json
import os
import sys
import traceback
from pathlib import Path
from typing import Any, Callable

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

# FreeCAD works in millimetres; IFC output is metres (exporter SCALE_FACTOR).
MM = 1000.0


# --- I/O shared by all fc_* scripts -------------------------------------------

def lese_eingabe() -> dict[str, Any]:
    pfad = os.environ.get("FC_HARNESS_IN")
    if not pfad:
        raise RuntimeError("FC_HARNESS_IN nicht gesetzt — Skript über fc_run.py starten")
    return json.loads(Path(pfad).read_text(encoding="utf-8"))


def schreibe_ausgabe(daten: dict[str, Any]) -> None:
    pfad = os.environ.get("FC_HARNESS_OUT")
    if not pfad:
        print(json.dumps(daten, ensure_ascii=False))
        return
    Path(pfad).write_text(json.dumps(daten, ensure_ascii=False, default=str), encoding="utf-8")


def ist_einstieg(modulname: str) -> bool:
    """True when this module is the script fc_run.py started.

    freecadcmd runs a script with __name__ == its file stem (not "__main__"),
    so a plain __main__ guard never fires and a stem guard would also fire
    when another script imports the module. fc_run.py names the entry.
    """
    return modulname == "__main__" or os.environ.get("FC_HARNESS_ENTRY") == modulname


def run_entry(fn: Callable[[dict[str, Any]], dict[str, Any]]) -> None:
    try:
        ergebnis = fn(lese_eingabe())
        schreibe_ausgabe({"ok": True, **ergebnis})
    except Exception as exc:  # report every failure as data, the caller shows it
        schreibe_ausgabe({"ok": False, "error": f"{exc.__class__.__name__}: {exc}",
                          "traceback": traceback.format_exc()})


def freecad_version() -> str:
    import FreeCAD
    v = FreeCAD.Version()
    return ".".join(v[:3])


# --- quantity metadata ---------------------------------------------------------

def meta_proxy(obj, predefined: str = "ELEMENT") -> dict[str, Any]:
    """Massing body: volume only (Qto_BuildingElementProxyQuantities.NetVolume, m³)."""
    vol = obj.Shape.Volume / MM ** 3
    return {"klasse": "IfcBuildingElementProxy", "predefined": predefined,
            "qto": ("Qto_BuildingElementProxyQuantities", {"NetVolume": vol})}


def meta_wand(obj, laenge_mm: float, oeffnungen_m2: float, aussen: bool) -> dict[str, Any]:
    """Wall quantities (m, m², m³). NetVolume = FreeCAD solid after the openings."""
    l_m = laenge_mm / MM
    b_m = float(obj.Width.Value) / MM
    h_m = float(obj.Height.Value) / MM
    brutto = l_m * h_m
    return {"klasse": "IfcWall", "predefined": "SOLIDWALL" if aussen else "PARTITIONING",
            "qto": ("Qto_WallBaseQuantities", {
                "Length": l_m, "Width": b_m, "Height": h_m,
                "GrossSideArea": brutto, "NetSideArea": brutto - oeffnungen_m2,
                "GrossVolume": l_m * b_m * h_m, "NetVolume": obj.Shape.Volume / MM ** 3}),
            "pset": ("Pset_WallCommon", {"IsExternal": bool(aussen),
                                         # [ASSUMED] exterior walls load-bearing, partitions not
                                         "LoadBearing": bool(aussen)})}


def meta_decke(obj, flaeche_m2: float, umfang_m: float, dicke_m: float,
               predefined: str) -> dict[str, Any]:
    return {"klasse": "IfcSlab", "predefined": predefined,
            "qto": ("Qto_SlabBaseQuantities", {
                "Width": dicke_m, "GrossArea": flaeche_m2, "NetArea": flaeche_m2,
                "Perimeter": umfang_m, "GrossVolume": obj.Shape.Volume / MM ** 3,
                "NetVolume": obj.Shape.Volume / MM ** 3})}


def meta_oeffnung(klasse: str, breite_m: float, hoehe_m: float) -> dict[str, Any]:
    qto = "Qto_DoorBaseQuantities" if klasse == "IfcDoor" else "Qto_WindowBaseQuantities"
    return {"klasse": klasse, "predefined": "DOOR" if klasse == "IfcDoor" else "WINDOW",
            "qto": (qto, {"Width": breite_m, "Height": hoehe_m, "Area": breite_m * hoehe_m,
                          "Perimeter": 2 * (breite_m + hoehe_m)})}


def meta_dach(projiziert_m2: float, neigung_grad: float, form: str) -> dict[str, Any]:
    import math
    brutto = projiziert_m2 / math.cos(math.radians(neigung_grad)) if neigung_grad else projiziert_m2
    return {"klasse": "IfcRoof", "predefined": "GABLE_ROOF" if form == "satteldach" else "FLAT_ROOF",
            "qto": ("Qto_RoofBaseQuantities", {"ProjectedArea": projiziert_m2,
                                               "GrossArea": brutto, "NetArea": brutto})}


# --- export --------------------------------------------------------------------

def _set_predefined(model, el, wert: str) -> None:
    try:
        el.PredefinedType = wert
    except Exception:
        # enum value unknown in this class/schema: keep the exporter's value
        pass


def entferne_doppelte_aggregationen(model) -> int:
    """FreeCAD 1.1.1 writes the building→storey IfcRelAggregates twice
    ('BuildingLink'), which makes the file schema-invalid (Decomposes is
    SET [0:1]). Keeps the first relation per (parent, children) and removes
    the rest. Returns the number removed."""
    gesehen: set[tuple[int, tuple[int, ...]]] = set()
    entfernt = 0
    for rel in list(model.by_type("IfcRelAggregates")):
        key = (rel.RelatingObject.id(), tuple(sorted(o.id() for o in rel.RelatedObjects)))
        if key in gesehen:
            model.remove(rel)
            entfernt += 1
        else:
            gesehen.add(key)
    return entfernt


def nachbearbeiten(ifc_path: str | Path, meta: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """Writes Qto/Pset/PredefinedType for every element whose Name is in `meta`."""
    import ifcopenshell
    import ifcopenshell.api.pset

    model = ifcopenshell.open(str(ifc_path))
    entferne_doppelte_aggregationen(model)
    elemente: list[dict[str, Any]] = []
    for el in model.by_type("IfcElement"):
        m = meta.get(el.Name or "")
        # The exporter names a window's IfcOpeningElement like the window itself.
        if m and m.get("klasse") and not el.is_a(m["klasse"]):
            m = None
        eintrag = {"name": el.Name, "klasse": el.is_a(), "guid": el.GlobalId}
        if m:
            if m.get("predefined"):
                _set_predefined(model, el, m["predefined"])
            if m.get("qto"):
                name, werte = m["qto"]
                qto = ifcopenshell.api.pset.add_qto(model, product=el, name=name)
                ifcopenshell.api.pset.edit_qto(model, qto=qto, properties={
                    k: float(v) for k, v in werte.items()})
                eintrag["mengen"] = {k: round(float(v), 6) for k, v in werte.items()}
            if m.get("pset"):
                name, werte = m["pset"]
                pset = ifcopenshell.api.pset.add_pset(model, product=el, name=name)
                ifcopenshell.api.pset.edit_pset(model, pset=pset, properties=werte)
        eintrag["predefined"] = getattr(el, "PredefinedType", None)
        elemente.append(eintrag)
    model.write(str(ifc_path))
    return elemente


def export_ifc(objs: list, ifc_path: str | Path,
               meta: dict[str, dict[str, Any]] | None = None) -> dict[str, Any]:
    """Exports `objs` (usually [site]) as IFC4 to `ifc_path` and post-processes it.

    Returns {"ifc": str, "elemente": [...]}. Raises RuntimeError when the
    exporter wrote nothing (it logs errors to the console instead of raising).
    """
    from importers import exportIFC  # FreeCAD 1.x location

    ifc_path = Path(ifc_path)
    ifc_path.parent.mkdir(parents=True, exist_ok=True)
    if ifc_path.exists():
        ifc_path.unlink()
    prefs = exportIFC.getPreferences()
    prefs["SCHEMA"] = "IFC4"
    exportIFC.export(objs, str(ifc_path), preferences=prefs)
    if not ifc_path.exists() or ifc_path.stat().st_size == 0:
        raise RuntimeError(f"FreeCAD-IFC-Export hat keine Datei geschrieben: {ifc_path}")
    elemente = nachbearbeiten(ifc_path, meta or {})
    return {"ifc": str(ifc_path), "elemente": elemente}


def wurzel_objekte(doc) -> list:
    """Top-level spatial objects (sites, else buildings, else everything visible)."""
    from draftutils.utils import get_type

    sites = [o for o in doc.Objects if getattr(o, "IfcType", "") == "Site" or get_type(o) == "Site"]
    if sites:
        return sites
    buildings = [o for o in doc.Objects if getattr(o, "IfcType", "") == "Building"]
    return buildings or [o for o in doc.Objects if not o.InList]


def meta_auto(obj) -> dict[str, Any] | None:
    """Meta for Arch objects the harness did not build (drawn by hand in the GUI
    or created by a free-code bridge step), so their IFC still has quantities.

    [ASSUMED] walls without harness meta get PredefinedType STANDARD and no
    IsExternal — the harness cannot know which side is outside.
    """
    from draftutils.utils import get_type

    typ = get_type(obj)
    ifc_typ = getattr(obj, "IfcType", "")
    try:
        if typ == "Wall":
            laenge = 0.0
            base = getattr(obj, "Base", None)
            if base is not None and hasattr(base, "Shape") and base.Shape.Edges:
                laenge = base.Shape.Length
            elif hasattr(obj, "Length"):
                laenge = float(obj.Length.Value)
            oeffnungen = 0.0
            for o in obj.InList:
                if obj in (getattr(o, "Hosts", None) or []) and hasattr(o, "Width"):
                    oeffnungen += float(o.Width.Value) * float(o.Height.Value) / MM ** 2
            m = meta_wand(obj, laenge, oeffnungen, True)
            m["predefined"] = "STANDARD"
            m.pop("pset", None)
            return m
        if typ == "Window" and ifc_typ in ("Window", "Door"):
            return meta_oeffnung("IfcDoor" if ifc_typ == "Door" else "IfcWindow",
                                 float(obj.Width.Value) / MM, float(obj.Height.Value) / MM)
        if typ == "Structure" and ifc_typ == "Slab":
            return {"klasse": "IfcSlab", "predefined": "FLOOR",
                    "qto": ("Qto_SlabBaseQuantities", {"NetVolume": obj.Shape.Volume / MM ** 3})}
    except Exception:
        return None  # quantities are a bonus here; the export itself must not fail
    return None


def meta_aus_dokument(doc) -> dict[str, dict[str, Any]]:
    """Per-object meta: what the fc_* builders stored (HarnessMeta property),
    otherwise meta_auto() for Arch walls/windows/slabs."""
    meta: dict[str, dict[str, Any]] = {}
    for o in doc.Objects:
        raw = getattr(o, "HarnessMeta", "")
        if raw:
            try:
                m = json.loads(raw)
            except ValueError:
                continue
            for key in ("qto", "pset"):
                if isinstance(m.get(key), list):
                    m[key] = tuple(m[key])
            meta[o.Label] = m
        else:
            auto = meta_auto(o)
            if auto:
                meta[o.Label] = auto
    return meta


def merke_meta(obj, meta: dict[str, Any]) -> None:
    """Stores meta on the object, so a later export (e.g. after the user edited
    the model in the GUI) still writes the right Qto/PredefinedType.

    Volumes are recomputed at export from the live shape (aktualisiere_mengen).
    """
    if "HarnessMeta" not in obj.PropertiesList:
        obj.addProperty("App::PropertyString", "HarnessMeta", "Harness",
                        "Qto/PredefinedType for the IFC export (Atelier AI Harness)")
    obj.HarnessMeta = json.dumps(meta, ensure_ascii=False)


def aktualisiere_mengen(doc, meta: dict[str, dict[str, Any]]) -> None:
    """Volume quantities follow the CURRENT shape (hand edits in the GUI)."""
    by_label = {o.Label: o for o in doc.Objects}
    for label, m in meta.items():
        obj = by_label.get(label)
        if obj is None or not m.get("qto") or not hasattr(obj, "Shape"):
            continue
        name, werte = m["qto"]
        werte = dict(werte)
        if "NetVolume" in werte:
            werte["NetVolume"] = obj.Shape.Volume / MM ** 3
        if m["klasse"] == "IfcWall" and hasattr(obj, "Height"):
            werte["Height"] = float(obj.Height.Value) / MM
            werte["Width"] = float(obj.Width.Value) / MM
        m["qto"] = (name, werte)


def export_dokument(doc, ifc_path: str | Path) -> dict[str, Any]:
    """Export of a whole document with the stored meta (bridge reload, standalone)."""
    doc.recompute()
    meta = meta_aus_dokument(doc)
    aktualisiere_mengen(doc, meta)
    return export_ifc(wurzel_objekte(doc), ifc_path, meta)


def _standalone(eingabe: dict[str, Any]) -> dict[str, Any]:
    import FreeCAD

    doc = FreeCAD.openDocument(str(eingabe["fcstd"]))
    try:
        result = export_dokument(doc, eingabe["ifc"])
    finally:
        FreeCAD.closeDocument(doc.Name)
    return {**result, "freecad": freecad_version()}


if ist_einstieg(__name__):
    run_entry(_standalone)
