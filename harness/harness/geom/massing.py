"""Massing plan (Bauplan) from a plot polygon and a room programme — pure Python.

In:  {"grundstueck": [[x, y], …] (m), "raumprogramm": [{"name", "flaeche_m2",
     "geschoss"?}], "geschosshoehe_m"?, "dach"?: {"form": "satteldach"|"flach",
     "neigung_grad"?}, "abstand_m"?}
Out: {"footprint": [[x, y] ×4] (m), "geschosse": [{level, name, z_m, hoehe_m,
     flaeche_m2, raeume}], "dach": {…}, "kennzahlen": {grundstueck_m2,
     footprint_m2, bgf_m2, volumen_m3, grz, gfz, …}, "annahmen": [...]}

The FreeCAD scripts (skills/freecad/scripts/fc_massing.py) only turn this plan
into solids; every number the user sees is computed here, without FreeCAD, so
it is testable on machines (and CI) that have no FreeCAD.

Footprint rule (plan 67-04): the largest axis-parallel rectangle inside the plot
that keeps `abstand_m` to every plot edge. Storeys = enough for the room
programme plus circulation (Verkehrsfläche).
"""

from __future__ import annotations

import math
from typing import Any

# [ASSUMED] 3.0 m storey height (floor-to-floor) — typical residential value
# (2.50–2.75 m clear height + slab); replace by the project's section once known.
GESCHOSSHOEHE_M = 3.0
# [ASSUMED] 40° roof pitch — middle of the common 35–45° band of residential
# development plans; the project's B-Plan value wins when given.
DACHNEIGUNG_GRAD = 40.0
# [ASSUMED] 3.0 m boundary distance — the BayBO/MBO minimum (Art. 6 BayBO:
# 0.4 H, at least 3 m); the real Abstandsfläche depends on wall height.
ABSTAND_M = 3.0
# [ASSUMED] 15 % circulation/construction surcharge on the net room programme
# (BGF ≈ NUF × 1.15 for compact residential plans); DIN 277 ratios vary 1.1–1.3.
VERKEHRSFLAECHE_ANTEIL = 0.15
# [ASSUMED] search raster for non-rectangular plots (m). Rectangle edges also
# snap to every plot vertex ± distance, so axis-parallel plots are exact.
RASTER_M = 0.5
# Finer raster than extent/60 would make large plots slow without changing
# the massing decision noticeably.
RASTER_TEILE = 60
# Above this a massing study is no longer a single-family/small-building plan.
MAX_GESCHOSSE = 8

_EPS = 1e-9


# --- small vector helpers ----------------------------------------------------

def polygon_area(poly: list[tuple[float, float]]) -> float:
    """Shoelace area of a simple polygon [m²] (always positive)."""
    s = 0.0
    for (x1, y1), (x2, y2) in zip(poly, poly[1:] + poly[:1]):
        s += x1 * y2 - x2 * y1
    return abs(s) / 2.0


def _point_in_polygon(px: float, py: float, poly: list[tuple[float, float]]) -> bool:
    inside = False
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        if (y1 > py) != (y2 > py):
            x_cross = x1 + (py - y1) * (x2 - x1) / (y2 - y1)
            if px < x_cross:
                inside = not inside
    return inside


def _point_seg_dist(px, py, ax, ay, bx, by) -> float:
    dx, dy = bx - ax, by - ay
    l2 = dx * dx + dy * dy
    if l2 < _EPS:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / l2))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def _cross(ox, oy, ax, ay, bx, by) -> float:
    return (ax - ox) * (by - oy) - (ay - oy) * (bx - ox)


def _segments_intersect(a, b, c, d) -> bool:
    d1 = _cross(*c, *d, *a)
    d2 = _cross(*c, *d, *b)
    d3 = _cross(*a, *b, *c)
    d4 = _cross(*a, *b, *d)
    if ((d1 > 0) != (d2 > 0)) and ((d3 > 0) != (d4 > 0)) and d1 and d2 and d3 and d4:
        return True
    return False


def _seg_seg_dist(a, b, c, d) -> float:
    if _segments_intersect(a, b, c, d):
        return 0.0
    return min(_point_seg_dist(*a, *c, *d), _point_seg_dist(*b, *c, *d),
               _point_seg_dist(*c, *a, *b), _point_seg_dist(*d, *a, *b))


def _rect_clear(x0: float, y0: float, x1: float, y1: float,
                poly: list[tuple[float, float]], abstand: float) -> bool:
    """True when the rectangle lies inside `poly` with >= `abstand` m to its boundary.

    Centre inside + no boundary edge closer than `abstand` ⇒ the whole
    rectangle is inside (it is connected and never touches the boundary).
    """
    if not _point_in_polygon((x0 + x1) / 2, (y0 + y1) / 2, poly):
        return False
    corners = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    rect_edges = list(zip(corners, corners[1:] + corners[:1]))
    n = len(poly)
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        # an edge endpoint inside the rectangle means distance 0
        for (px, py) in (a, b):
            if x0 - _EPS <= px <= x1 + _EPS and y0 - _EPS <= py <= y1 + _EPS:
                return False
        dist = min(_seg_seg_dist(a, b, c, d) for c, d in rect_edges)
        if dist < abstand - 1e-7:
            return False
    return True


def _candidates(lo: float, hi: float, snaps: list[float], step: float) -> list[float]:
    vals = {round(lo + i * step, 6) for i in range(int((hi - lo) / step) + 1)}
    vals.add(round(hi, 6))
    vals.update(round(v, 6) for v in snaps if lo - _EPS <= v <= hi + _EPS)
    return sorted(vals)


def largest_rectangle(poly: list[tuple[float, float]], abstand: float
                      ) -> tuple[float, float, float, float] | None:
    """Largest axis-parallel rectangle (x0, y0, x1, y1) [m] inside `poly` with
    `abstand` m clearance to every edge; None if nothing fits.

    Method: candidate coordinates (raster + every vertex ± abstand) split the
    bounding box into cells; a cell is free when it is clear (_rect_clear). A
    union of free cells is clear too, so the answer is the maximum-area block
    of free cells — O(nx² · ny) with weighted cell sizes. Exact for
    axis-parallel plots, raster-accurate otherwise [ASSUMED RASTER_M].
    """
    xs_all = [p[0] for p in poly]
    ys_all = [p[1] for p in poly]
    extent = max(max(xs_all) - min(xs_all), max(ys_all) - min(ys_all))
    step = max(RASTER_M, extent / RASTER_TEILE)
    xs = _candidates(min(xs_all), max(xs_all),
                     [x + s * abstand for x in xs_all for s in (-1, 1)], step)
    ys = _candidates(min(ys_all), max(ys_all),
                     [y + s * abstand for y in ys_all for s in (-1, 1)], step)
    nx, ny = len(xs) - 1, len(ys) - 1
    free = [[_rect_clear(xs[i], ys[j], xs[i + 1], ys[j + 1], poly, abstand)
             for j in range(ny)] for i in range(nx)]

    best: tuple[float, float, float, float] | None = None
    best_area = 0.0
    for i0 in range(nx):
        rows = [True] * ny  # rows free across columns i0..i1
        for i1 in range(i0, nx):
            rows = [r and free[i1][j] for j, r in enumerate(rows)]
            if not any(rows):
                break
            width = xs[i1 + 1] - xs[i0]
            j = 0
            while j < ny:
                if not rows[j]:
                    j += 1
                    continue
                k = j
                while k < ny and rows[k]:
                    k += 1
                area = width * (ys[k] - ys[j])
                if area > best_area + 1e-9:
                    best_area = area
                    best = (xs[i0], ys[j], xs[i1 + 1], ys[k])
                j = k
    return best


# --- the plan ----------------------------------------------------------------

def _geschoss_name(level: int) -> str:
    return "EG" if level == 0 else f"{level}. OG"


def _parse_poly(raw: Any) -> list[tuple[float, float]]:
    if not isinstance(raw, list) or len(raw) < 3:
        raise ValueError("grundstueck braucht mindestens drei Eckpunkte [[x, y], …] in Metern")
    try:
        poly = [(float(p[0]), float(p[1])) for p in raw]
    except (TypeError, ValueError, IndexError) as exc:
        raise ValueError(f"grundstueck: Eckpunkt ungültig ({exc})") from exc
    if len(poly) > 3 and poly[0] == poly[-1]:
        poly = poly[:-1]
    if polygon_area(poly) < 1.0:
        raise ValueError("grundstueck: Fläche < 1 m² — Eckpunkte prüfen")
    return poly


def plan_massing(eingabe: dict[str, Any]) -> dict[str, Any]:
    """Builds the Bauplan (see module docstring). Raises ValueError with a
    German plain-text reason when the input is unusable or nothing fits.

    Units: lengths m, areas m², volumes m³, angles degrees; GRZ/GFZ are ratios.
    """
    poly = _parse_poly(eingabe.get("grundstueck"))
    raum = eingabe.get("raumprogramm")
    if not isinstance(raum, list) or not raum:
        raise ValueError("raumprogramm braucht mindestens einen Raum {name, flaeche_m2}")
    raeume: list[dict[str, Any]] = []
    for i, r in enumerate(raum):
        try:
            flaeche = float(r["flaeche_m2"])
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError(f"raumprogramm[{i}]: flaeche_m2 fehlt oder ist keine Zahl") from exc
        if flaeche <= 0:
            raise ValueError(f"raumprogramm[{i}]: flaeche_m2 muss > 0 sein")
        geschoss = r.get("geschoss")
        raeume.append({"name": str(r.get("name") or f"Raum {i + 1}"), "flaeche_m2": flaeche,
                       "geschoss": int(geschoss) if geschoss is not None else None})

    annahmen: list[str] = []

    def _param(key: str, default: float, label: str) -> float:
        if eingabe.get(key) is None:
            annahmen.append(f"{label} = {default:g} [ASSUMED]")
            return default
        return float(eingabe[key])

    h = _param("geschosshoehe_m", GESCHOSSHOEHE_M, "Geschosshöhe (m)")
    abstand = _param("abstand_m", ABSTAND_M, "Grenzabstand (m)")
    dach_in = eingabe.get("dach") or {}
    form = str(dach_in.get("form") or "satteldach").lower()
    if form not in ("satteldach", "flach"):
        raise ValueError(f"dach.form {form!r} unbekannt (satteldach | flach)")
    if form == "satteldach":
        if dach_in.get("neigung_grad") is None:
            annahmen.append(f"Dachneigung = {DACHNEIGUNG_GRAD:g}° [ASSUMED]")
        neigung = float(dach_in.get("neigung_grad") or DACHNEIGUNG_GRAD)
        if not 0 < neigung < 80:
            raise ValueError("dach.neigung_grad muss zwischen 0 und 80 liegen")
    else:
        neigung = 0.0
    if h <= 0 or abstand < 0:
        raise ValueError("geschosshoehe_m muss > 0 und abstand_m >= 0 sein")

    rect = largest_rectangle(poly, abstand)
    if rect is None:
        raise ValueError(f"Kein Baufeld: mit {abstand:g} m Grenzabstand passt kein Rechteck "
                         "auf das Grundstück")
    x0, y0, x1, y1 = rect
    breite, tiefe = x1 - x0, y1 - y0
    footprint_m2 = breite * tiefe

    nutz_m2 = sum(r["flaeche_m2"] for r in raeume)
    verkehr_m2 = nutz_m2 * VERKEHRSFLAECHE_ANTEIL
    bedarf_m2 = nutz_m2 + verkehr_m2
    annahmen.append(f"Verkehrsfläche = {VERKEHRSFLAECHE_ANTEIL:.0%} auf das Raumprogramm [ASSUMED]")
    n = max(1, math.ceil(bedarf_m2 / footprint_m2 - 1e-9),
            max((r["geschoss"] + 1 for r in raeume if r["geschoss"] is not None), default=1))
    if n > MAX_GESCHOSSE:
        raise ValueError(
            f"Raumprogramm {bedarf_m2:.0f} m² (inkl. Verkehrsfläche) braucht {n} Geschosse "
            f"auf {footprint_m2:.0f} m² Grundfläche — mehr als {MAX_GESCHOSSE}; "
            "Grundstück oder Programm prüfen")

    # Rooms: explicit storeys first, then in order onto the first storey with room.
    netto_je_geschoss = footprint_m2 / (1 + VERKEHRSFLAECHE_ANTEIL)
    belegt = [0.0] * n
    zuordnung: list[list[str]] = [[] for _ in range(n)]
    for r in raeume:
        if r["geschoss"] is not None:
            belegt[r["geschoss"]] += r["flaeche_m2"]
            zuordnung[r["geschoss"]].append(r["name"])
    for r in raeume:
        if r["geschoss"] is None:
            level = next((i for i in range(n) if belegt[i] + r["flaeche_m2"] <= netto_je_geschoss + 1e-9),
                         min(range(n), key=lambda i: belegt[i]))
            belegt[level] += r["flaeche_m2"]
            zuordnung[level].append(r["name"])

    geschosse = [{"level": i, "name": _geschoss_name(i), "z_m": round(i * h, 6),
                  "hoehe_m": h, "flaeche_m2": round(footprint_m2, 6),
                  "raeume": zuordnung[i]} for i in range(n)]

    traufe = n * h
    if form == "satteldach":
        # Ridge parallel to the longer side, so the span is the shorter one.
        richtung = "x" if breite >= tiefe else "y"
        spann = tiefe if richtung == "x" else breite
        laenge = breite if richtung == "x" else tiefe
        first_h = spann / 2 * math.tan(math.radians(neigung))
        dach_vol = laenge * spann * first_h / 2  # triangular prism
    else:
        richtung, spann, laenge, first_h, dach_vol = None, 0.0, 0.0, 0.0, 0.0
    dach = {"form": form, "neigung_grad": neigung, "firstrichtung": richtung,
            "spannweite_m": round(spann, 6), "laenge_m": round(laenge, 6),
            "traufhoehe_m": round(traufe, 6), "firsthoehe_m": round(first_h, 6),
            "first_z_m": round(traufe + first_h, 6), "volumen_m3": round(dach_vol, 6)}

    grundstueck_m2 = polygon_area(poly)
    bgf = footprint_m2 * n
    volumen = footprint_m2 * h * n + dach_vol
    return {
        "footprint": [[x0, y0], [x1, y0], [x1, y1], [x0, y1]],
        "geschosse": geschosse,
        "dach": dach,
        "kennzahlen": {
            "grundstueck_m2": round(grundstueck_m2, 3),
            "footprint_m2": round(footprint_m2, 3),
            "breite_m": round(breite, 3), "tiefe_m": round(tiefe, 3),
            "geschosse": n,
            "raumprogramm_m2": round(nutz_m2, 3),
            "verkehrsflaeche_m2": round(verkehr_m2, 3),
            "bedarf_m2": round(bedarf_m2, 3),
            "bgf_m2": round(bgf, 3),
            "volumen_m3": round(volumen, 3),
            "grz": round(footprint_m2 / grundstueck_m2, 3),
            "gfz": round(bgf / grundstueck_m2, 3),
        },
        "annahmen": annahmen,
    }


def kennzahlen_markdown(plan: dict[str, Any]) -> str:
    """German summary table of a plan (de-DE number format)."""
    k = plan["kennzahlen"]
    d = plan["dach"]

    def de(v: float, s: int = 2) -> str:
        return f"{v:,.{s}f}".replace(",", "X").replace(".", ",").replace("X", ".")

    zeilen = [
        ("Grundstück", f"{de(k['grundstueck_m2'])} m²"),
        ("Grundfläche (Footprint)", f"{de(k['breite_m'])} × {de(k['tiefe_m'])} m = {de(k['footprint_m2'])} m²"),
        ("Geschosse", str(k["geschosse"])),
        ("Raumprogramm + Verkehrsfläche", f"{de(k['raumprogramm_m2'])} + {de(k['verkehrsflaeche_m2'])} = {de(k['bedarf_m2'])} m²"),
        ("BGF", f"{de(k['bgf_m2'])} m²"),
        ("Bruttorauminhalt", f"{de(k['volumen_m3'])} m³"),
        ("GRZ / GFZ", f"{de(k['grz'])} / {de(k['gfz'])}"),
        ("Dach", f"{d['form']}" + (f", {de(d['neigung_grad'], 0)}°, First +{de(d['firsthoehe_m'])} m"
                                    if d["form"] == "satteldach" else "")),
    ]
    out = ["| Kennzahl | Wert |", "| --- | --- |"] + [f"| {a} | {b} |" for a, b in zeilen]
    if plan.get("annahmen"):
        out += ["", "Annahmen: " + "; ".join(plan["annahmen"])]
    return "\n".join(out)
