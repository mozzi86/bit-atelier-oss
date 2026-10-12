"""fc_massing — massing model (stage a) in FreeCAD from a Bauplan, exported as IFC.

Runs inside FreeCAD (freecadcmd). The Bauplan is computed beforehand in the
harness venv by harness/geom/massing.py — this script only builds solids:
one box per storey (IfcBuildingElementProxy in its IfcBuildingStorey) and a
roof prism for the gable. Every body carries Qto_BuildingElementProxyQuantities
.NetVolume, so `/ifc mengen` reads the volume without a geometry fallback.

Input JSON: {"bauplan": {...}, "ifc": "<path>", "fcstd"?: "<path>", "name"?: str}
Output JSON: {"ok", "ifc", "fcstd"?, "elemente", "volumen_m3", "freecad"}

FreeCAD 1.1 calls used (verified 2026-10-12, FreeCAD 1.1.1):
Arch.makeSite/makeBuilding/makeFloor (makeFloor = BuildingPart, IfcType
"Building Storey"), Part.makeBox, Part.Face(Part.makePolygon(...)).extrude,
Arch.makeComponent(base) with IfcType "Building Element Proxy".
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

import fc_export_ifc as fx  # noqa: E402

MM = fx.MM


def _koerper(doc, shape, label: str):
    import Arch

    base = doc.addObject("Part::Feature", "Basis")
    base.Label = f"{label} (Basis)"
    base.Shape = shape
    comp = Arch.makeComponent(base, name=label)
    comp.IfcType = "Building Element Proxy"
    comp.Label = label
    return comp


def _dachprisma(fp: list[list[float]], dach: dict[str, Any]):
    import FreeCAD
    import Part

    V = FreeCAD.Vector
    (x0, y0), (x1, _), (_, y1) = fp[0], fp[1], fp[2]
    zt = dach["traufhoehe_m"] * MM
    zf = dach["first_z_m"] * MM
    if dach["firstrichtung"] == "x":
        ym = (y0 + y1) / 2
        tri = [V(x0 * MM, y0 * MM, zt), V(x0 * MM, y1 * MM, zt), V(x0 * MM, ym * MM, zf)]
        richtung = V((x1 - x0) * MM, 0, 0)
    else:
        xm = (x0 + x1) / 2
        tri = [V(x0 * MM, y0 * MM, zt), V(x1 * MM, y0 * MM, zt), V(xm * MM, y0 * MM, zf)]
        richtung = V(0, (y1 - y0) * MM, 0)
    face = Part.Face(Part.makePolygon(tri + [tri[0]]))
    return face.extrude(richtung)


def baue_massenmodell(doc, bauplan: dict[str, Any]) -> tuple[Any, dict[str, dict[str, Any]]]:
    """Builds site → building → storeys → bodies in `doc`. Returns (site, meta)."""
    import Arch
    import FreeCAD
    import Part

    fp = bauplan["footprint"]
    (x0, y0), (x1, y1) = fp[0], fp[2]
    site = Arch.makeSite(name="Grundstück")
    building = Arch.makeBuilding(name="Gebäude")
    site.addObject(building)
    meta: dict[str, dict[str, Any]] = {}
    storeys = []
    for g in bauplan["geschosse"]:
        storey = Arch.makeFloor(name=g["name"])
        storey.Label = g["name"]
        storey.Placement.Base = FreeCAD.Vector(0, 0, g["z_m"] * MM)
        storey.Height = g["hoehe_m"] * MM
        building.addObject(storey)
        box = Part.makeBox((x1 - x0) * MM, (y1 - y0) * MM, g["hoehe_m"] * MM,
                           FreeCAD.Vector(x0 * MM, y0 * MM, g["z_m"] * MM))
        body = _koerper(doc, box, f"Baukörper {g['name']}")
        storey.addObject(body)
        storeys.append((storey, body))
    doc.recompute()
    for _, body in storeys:
        meta[body.Label] = fx.meta_proxy(body)
        fx.merke_meta(body, meta[body.Label])

    dach = bauplan["dach"]
    if dach["form"] == "satteldach" and dach["firsthoehe_m"] > 0:
        roof = _koerper(doc, _dachprisma(fp, dach), "Dachkörper")
        storeys[-1][0].addObject(roof)
        doc.recompute()
        meta[roof.Label] = fx.meta_proxy(roof)
        fx.merke_meta(roof, meta[roof.Label])
    return site, meta


def _main(eingabe: dict[str, Any]) -> dict[str, Any]:
    import FreeCAD

    doc = FreeCAD.newDocument(str(eingabe.get("name") or "massenmodell").replace(" ", "_"))
    try:
        site, meta = baue_massenmodell(doc, eingabe["bauplan"])
        volumen = sum(m["qto"][1]["NetVolume"] for m in meta.values())
        result = fx.export_ifc([site], eingabe["ifc"], meta)
        if eingabe.get("fcstd"):
            doc.saveAs(str(eingabe["fcstd"]))
            result["fcstd"] = str(eingabe["fcstd"])
    finally:
        FreeCAD.closeDocument(doc.Name)
    return {**result, "volumen_m3": round(volumen, 3), "freecad": fx.freecad_version()}


if fx.ist_einstieg(__name__):
    fx.run_entry(_main)
