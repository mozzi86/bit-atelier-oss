"""fc_bauteile — walls, slabs, openings and roof (stage b) from a description.

Runs inside FreeCAD (freecadcmd headless, or the GUI via harness_bridge.FCMacro
— both call baue_bauteile()). Description (Beschreibung), all lengths in m:

{
  "name": "efh",
  "geschosse": [{
    "name": "EG", "z_m"?: 0.0, "hoehe_m"?: 3.0,
    "decke"?: {"dicke_m": 0.25},                    # slab BELOW this storey
    "wandzuege": [{"punkte": [[x, y], …], "geschlossen"?: bool, "dicke_m": 0.365,
                   "aussen"?: bool, "namen"?: [str, …]}],
    "oeffnungen": [{"wand": "Wand EG 01" | 1, "typ": "fenster" | "tuer",
                    "abstand_m": 1.5, "breite_m": 1.2, "hoehe_m": 1.4,
                    "bruestung_m"?: 0.9, "name"?: str}]
  }],
  "dach"?: {"form": "satteldach" | "flach", "neigung_grad": 40, "dicke_m": 0.25,
            "ueberstand_m": 0.0}
}

Wall polylines are CENTRE lines. One Arch wall per segment (one IfcWall each).
Corners use a pinwheel joint: every segment is shifted by half its thickness
along its own direction (start trimmed, end extended), so right-angled corners
are closed without overlap or gap. [ASSUMED] right angles — other angles leave
a small wedge. `abstand_m` of an opening is measured from the segment's start
point on the centre line.

Output JSON (headless): {"ok", "ifc", "fcstd"?, "elemente", "zaehlung", "freecad"}

FreeCAD 1.1 calls used (verified 2026-10-12, FreeCAD 1.1.1):
- Arch.makeWall(baseobj, width=, height=, align="Center") — the base MUST be a
  Wire (Part.makePolygon), not an Edge: the IFC exporter's axis writer calls
  edge.scale() on an immutable edge and aborts (exportIFC.createCurveWithArcs).
- Arch.makeStructure(face_obj, height=) + IfcType "Slab" for slabs. NOT
  Arch.makeFloor: since 1.0 that creates a BuildingPart storey, not a slab.
- Arch.makeWindowPreset("Open 1-pane" | "Simple door", w, h, h1, h2, h3, w1,
  w2, o1, o2, placement) — the placement goes to the sketch; the preset sets
  IfcType "Door" for door presets itself. window.Hosts = [wall] cuts the wall.
- Arch.makeRoof(wire_obj, angles=[a, 90, a, 90], run=[…], idrel=[-1, 0, -1, 0],
  thickness=[…], overhang=[…]) — 90° edges are gables.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

import fc_export_ifc as fx  # noqa: E402

MM = fx.MM
# [ASSUMED] storey height when the description omits it (same as massing.py).
GESCHOSSHOEHE_M = 3.0
# [ASSUMED] window/door frame for the presets (mm): h1..h3 frame heights,
# w1 frame depth, w2 frame width, o1/o2 offsets. Visual only — the opening
# size (breite/hoehe) is exact.
RAHMEN_MM = (100, 100, 100, 100, 50, 0, 0)
PRESETS = {"fenster": ("Open 1-pane", "IfcWindow", "Fenster"),
           "tuer": ("Simple door", "IfcDoor", "Tür")}


def _f(d: dict[str, Any], key: str, default: float | None = None) -> float:
    if d.get(key) is None:
        if default is None:
            raise ValueError(f"{key} fehlt")
        return float(default)
    return float(d[key])


def _segmente(zug: dict[str, Any]) -> list[tuple[tuple[float, float], tuple[float, float], bool, bool]]:
    """[(start, end, trim_start, extend_end)] of a polyline (m)."""
    pts = [(float(p[0]), float(p[1])) for p in zug.get("punkte") or []]
    geschlossen = bool(zug.get("geschlossen"))
    if geschlossen and len(pts) > 2 and pts[0] == pts[-1]:
        pts = pts[:-1]
    if len(pts) < 2:
        raise ValueError("Wandzug braucht mindestens zwei Punkte")
    paare = list(zip(pts, pts[1:] + ([pts[0]] if geschlossen else [])))
    letzte = len(paare) - 1
    return [(a, b, geschlossen or i > 0, geschlossen or i < letzte)
            for i, (a, b) in enumerate(paare)]


def _umriss(zug: dict[str, Any]) -> list[tuple[float, float]] | None:
    """Outer face of a closed, axis-parallel rectangular wall chain (m), else None."""
    pts = [(float(p[0]), float(p[1])) for p in zug.get("punkte") or []]
    if len(pts) > 4 and pts[0] == pts[-1]:
        pts = pts[:-1]
    if not zug.get("geschlossen") or len(pts) != 4:
        return None
    xs, ys = sorted({p[0] for p in pts}), sorted({p[1] for p in pts})
    if len(xs) != 2 or len(ys) != 2:
        return None
    t = _f(zug, "dicke_m") / 2
    return [(xs[0] - t, ys[0] - t), (xs[1] + t, ys[0] - t), (xs[1] + t, ys[1] + t), (xs[0] - t, ys[1] + t)]


def _wire(punkte: list[tuple[float, float]], z_mm: float, schliessen: bool = True):
    import FreeCAD
    import Part

    v = [FreeCAD.Vector(x * MM, y * MM, z_mm) for x, y in punkte]
    return Part.makePolygon(v + ([v[0]] if schliessen else []))


def _aussen_umriss(g: dict[str, Any]) -> list[tuple[float, float]] | None:
    for zug in g.get("wandzuege") or []:
        if zug.get("aussen", True) and zug.get("geschlossen"):
            return _umriss(zug)
    return None


def baue_bauteile(doc, beschreibung: dict[str, Any], building=None
                  ) -> tuple[Any, dict[str, dict[str, Any]], dict[str, int]]:
    """Builds the described elements into `doc`.

    building: an existing Arch building to add to (GUI bridge); None creates
    site + building. Returns (root object for the export, meta, counts).
    Raises ValueError with a German plain-text reason on bad input.
    """
    import Arch
    import FreeCAD
    import Part

    V = FreeCAD.Vector
    geschosse = beschreibung.get("geschosse") or []
    if not geschosse:
        raise ValueError("Beschreibung braucht mindestens ein Geschoss (geschosse: [...])")

    root = building
    if building is None:
        site = Arch.makeSite(name="Grundstück")
        building = Arch.makeBuilding(name="Gebäude")
        site.addObject(building)
        root = site

    meta: dict[str, dict[str, Any]] = {}
    zaehlung = {"IfcWall": 0, "IfcWindow": 0, "IfcDoor": 0, "IfcSlab": 0, "IfcRoof": 0}
    z_lauf = 0.0
    letzte = None  # (storey, g, z_m, hoehe_m) of the top storey

    for gi, g in enumerate(geschosse):
        gname = str(g.get("name") or ("EG" if gi == 0 else f"{gi}. OG"))
        hoehe = _f(g, "hoehe_m", GESCHOSSHOEHE_M)
        z = _f(g, "z_m", z_lauf)
        z_lauf = z + hoehe
        naechste = geschosse[gi + 1] if gi + 1 < len(geschosse) else None
        # Walls stop under the next storey's slab.
        wand_h = hoehe - (_f(naechste.get("decke") or {}, "dicke_m", 0) if naechste else 0)

        storey = Arch.makeFloor(name=gname)
        storey.Label = gname
        storey.Placement.Base = V(0, 0, z * MM)
        storey.Height = hoehe * MM
        building.addObject(storey)
        letzte = (storey, g, z, hoehe)

        # --- walls
        waende: list[dict[str, Any]] = []
        for zug in g.get("wandzuege") or []:
            dicke = _f(zug, "dicke_m")
            aussen = bool(zug.get("aussen", bool(zug.get("geschlossen"))))
            namen = list(zug.get("namen") or [])
            for si, (a, b, trim, ext) in enumerate(_segmente(zug)):
                dx, dy = b[0] - a[0], b[1] - a[1]
                laenge = math.hypot(dx, dy)
                if laenge < 1e-6:
                    raise ValueError(f"{gname}: Wandsegment mit Länge 0 bei {a}")
                ux, uy = dx / laenge, dy / laenge
                s = (a[0] + ux * dicke / 2, a[1] + uy * dicke / 2) if trim else a
                e = (b[0] + ux * dicke / 2, b[1] + uy * dicke / 2) if ext else b
                name = namen[si] if si < len(namen) else f"Wand {gname} {len(waende) + 1:02d}"
                base = doc.addObject("Part::Feature", "Wandachse")
                base.Label = f"{name} (Achse)"
                base.Shape = _wire([s, e], z * MM, schliessen=False)
                wall = Arch.makeWall(base, width=dicke * MM, height=wand_h * MM,
                                     align="Center", name=name)
                wall.Label = name
                storey.addObject(wall)
                waende.append({"obj": wall, "name": name, "a": a, "u": (ux, uy), "laenge": laenge,
                               "laenge_achse": math.hypot(e[0] - s[0], e[1] - s[1]),
                               "aussen": aussen, "oeffnungen_m2": 0.0, "hoehe": wand_h})
                zaehlung["IfcWall"] += 1

        # --- openings
        nummer = {"fenster": 0, "tuer": 0}
        for oi, o in enumerate(g.get("oeffnungen") or []):
            typ = str(o.get("typ") or "fenster").lower().replace("ü", "ue")
            if typ not in PRESETS:
                raise ValueError(f"{gname}: Öffnung {oi + 1}: typ {typ!r} unbekannt (fenster | tuer)")
            ref = o.get("wand")
            if isinstance(ref, int):
                wand = waende[ref - 1] if 0 < ref <= len(waende) else None
            else:
                wand = next((w for w in waende if w["name"] == ref), None)
            if wand is None:
                raise ValueError(f"{gname}: Öffnung {oi + 1}: Wand {ref!r} nicht gefunden "
                                 f"(vorhanden: {', '.join(w['name'] for w in waende)})")
            breite, hoehe_o = _f(o, "breite_m"), _f(o, "hoehe_m")
            abstand = _f(o, "abstand_m")
            bruestung = _f(o, "bruestung_m", 0.0 if typ == "tuer" else 0.9)
            if abstand < 0 or abstand + breite > wand["laenge"] + 1e-6:
                raise ValueError(f"{gname}: Öffnung {oi + 1} liegt außerhalb von {wand['name']} "
                                 f"(Länge {wand['laenge']:.2f} m)")
            if bruestung + hoehe_o > wand["hoehe"] + 1e-6:
                raise ValueError(f"{gname}: Öffnung {oi + 1} ist höher als {wand['name']} "
                                 f"({wand['hoehe']:.2f} m)")
            preset, klasse, wort = PRESETS[typ]
            nummer[typ] += 1
            name = str(o.get("name") or f"{wort} {gname} {nummer[typ]:02d}")
            (ax, ay), (ux, uy) = wand["a"], wand["u"]
            pos = V((ax + ux * abstand) * MM, (ay + uy * abstand) * MM, (z + bruestung) * MM)
            winkel = math.degrees(math.atan2(uy, ux))
            # sketch XY → vertical plane of the wall: tilt up about X, then turn to the wall
            rot = FreeCAD.Rotation(V(0, 0, 1), winkel).multiply(FreeCAD.Rotation(V(1, 0, 0), 90))
            win = Arch.makeWindowPreset(preset, breite * MM, hoehe_o * MM, *RAHMEN_MM,
                                        FreeCAD.Placement(pos, rot))
            if win is None:
                raise RuntimeError(f"Arch.makeWindowPreset({preset!r}) lieferte nichts")
            win.Label = name
            win.Hosts = [wand["obj"]]
            storey.addObject(win)
            wand["oeffnungen_m2"] += breite * hoehe_o
            meta[name] = fx.meta_oeffnung(klasse, breite, hoehe_o)
            zaehlung[klasse] += 1

        # --- slab below the storey
        decke = g.get("decke")
        if decke:
            dicke = _f(decke, "dicke_m")
            umriss = _aussen_umriss(g)
            if umriss is None:
                raise ValueError(f"{gname}: Decke braucht einen geschlossenen, achsparallelen "
                                 "rechteckigen Außenwandzug")
            face = Part.Face(_wire(umriss, 0.0))
            fb = doc.addObject("Part::Feature", "Deckenumriss")
            name = str(decke.get("name") or ("Bodenplatte" if gi == 0 else f"Decke über {geschosse[gi - 1].get('name') or gi - 1}"))
            fb.Label = f"{name} (Umriss)"
            fb.Shape = face
            slab = Arch.makeStructure(fb, height=dicke * MM, name=name)
            slab.IfcType = "Slab"
            slab.Label = name
            slab.Placement.Base = V(0, 0, (z - dicke) * MM)
            storey.addObject(slab)
            doc.recompute()
            meta[name] = fx.meta_decke(slab, face.Area / MM ** 2, face.Length / MM, dicke,
                                       "BASESLAB" if gi == 0 else "FLOOR")
            fx.merke_meta(slab, meta[name])
            zaehlung["IfcSlab"] += 1

        doc.recompute()
        for w in waende:
            meta[w["name"]] = fx.meta_wand(w["obj"], w["laenge_achse"] * MM, w["oeffnungen_m2"], w["aussen"])
            fx.merke_meta(w["obj"], meta[w["name"]])

    # --- roof over the top storey
    dach = beschreibung.get("dach")
    if dach and letzte:
        storey, g, z, hoehe = letzte
        umriss = _aussen_umriss(g)
        if umriss is None:
            raise ValueError("Dach braucht im obersten Geschoss einen geschlossenen, "
                             "achsparallelen rechteckigen Außenwandzug")
        form = str(dach.get("form") or "satteldach").lower()
        dicke = _f(dach, "dicke_m", 0.25)
        ueber = _f(dach, "ueberstand_m", 0.0)
        traufe = (z + hoehe) * MM
        (x0, y0), (x1, y1) = umriss[0], umriss[2]
        name = str(dach.get("name") or "Dach")
        rw = doc.addObject("Part::Feature", "Dachumriss")
        rw.Label = f"{name} (Umriss)"
        rw.Shape = _wire(umriss, traufe)
        if form == "satteldach":
            neigung = _f(dach, "neigung_grad", 40.0)
            breite, tiefe = x1 - x0, y1 - y0
            # Ridge parallel to the longer side: edges 0/2 run along x.
            if breite >= tiefe:
                winkel, run = [neigung, 90.0, neigung, 90.0], [tiefe / 2 * MM, 0, tiefe / 2 * MM, 0]
                idrel = [-1, 0, -1, 0]
            else:
                winkel, run = [90.0, neigung, 90.0, neigung], [0, breite / 2 * MM, 0, breite / 2 * MM]
                idrel = [0, -1, 0, -1]
            roof = Arch.makeRoof(rw, angles=winkel, run=run, idrel=idrel,
                                 thickness=[dicke * MM], overhang=[ueber * MM], name=name)
            roof.Label = name
            storey.addObject(roof)
            proj = (breite + 2 * ueber) * (tiefe + 2 * ueber)
            meta[name] = fx.meta_dach(proj, neigung, "satteldach")
            zaehlung["IfcRoof"] += 1
        elif form == "flach":
            fb = doc.addObject("Part::Feature", "Dachplatte")
            fb.Shape = Part.Face(_wire(umriss, 0.0))
            slab = Arch.makeStructure(fb, height=dicke * MM, name=name)
            slab.IfcType = "Slab"
            slab.Label = name
            slab.Placement.Base = V(0, 0, traufe)
            storey.addObject(slab)
            doc.recompute()
            meta[name] = fx.meta_decke(slab, (x1 - x0) * (y1 - y0), 2 * ((x1 - x0) + (y1 - y0)),
                                       dicke, "ROOF")
            zaehlung["IfcSlab"] += 1
        else:
            raise ValueError(f"dach.form {form!r} unbekannt (satteldach | flach)")
        doc.recompute()
        fx.merke_meta(roof if form == "satteldach" else slab, meta[name])

    for name, m in meta.items():
        obj = next((o for o in doc.Objects if o.Label == name), None)
        if obj is not None and "HarnessMeta" not in obj.PropertiesList:
            fx.merke_meta(obj, m)
    return root, meta, zaehlung


def _main(eingabe: dict[str, Any]) -> dict[str, Any]:
    import FreeCAD

    beschreibung = eingabe["beschreibung"]
    doc = FreeCAD.newDocument(str(beschreibung.get("name") or "bauteile").replace(" ", "_"))
    try:
        root, meta, zaehlung = baue_bauteile(doc, beschreibung)
        result = fx.export_ifc([root], eingabe["ifc"], meta)
        if eingabe.get("fcstd"):
            doc.saveAs(str(eingabe["fcstd"]))
            result["fcstd"] = str(eingabe["fcstd"])
    finally:
        FreeCAD.closeDocument(doc.Name)
    return {**result, "zaehlung": zaehlung, "freecad": fx.freecad_version()}


if fx.ist_einstieg(__name__):
    fx.run_entry(_main)
