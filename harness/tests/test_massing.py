"""Task 1 (67-04): the massing plan without FreeCAD — hand-calculated cases.

Reference case from the plan: plot 20 × 15 m, distance 3 m → footprint
14 × 9 = 126 m²; programme 180 m² + 15 % = 207 m² → 2 storeys (252 m² BGF);
gable 40° over 9 m span → ridge 4.5 · tan 40° = 3.776 m; volume
126 · 6 + 14 · 9 · 3.776 / 2 = 756 + 237.9 = 993.9 m³.
"""

from __future__ import annotations

import math

import pytest

from harness.config import load_config
from harness.geom.massing import kennzahlen_markdown, largest_rectangle, plan_massing

GRUNDSTUECK_20x15 = [[0, 0], [20, 0], [20, 15], [0, 15]]
PROGRAMM_180 = [{"name": "Wohnen", "flaeche_m2": 60}, {"name": "Küche", "flaeche_m2": 20},
                {"name": "Schlafen", "flaeche_m2": 40}, {"name": "Kind 1", "flaeche_m2": 30},
                {"name": "Kind 2", "flaeche_m2": 30}]


def _referenz(**kw):
    return plan_massing({"grundstueck": GRUNDSTUECK_20x15, "raumprogramm": PROGRAMM_180,
                         "geschosshoehe_m": 3.0, "abstand_m": 3.0,
                         "dach": {"form": "satteldach", "neigung_grad": 40}, **kw})


def test_referenzfall_handgerechnet():
    plan = _referenz()
    k = plan["kennzahlen"]
    assert plan["footprint"] == [[3, 3], [17, 3], [17, 12], [3, 12]]
    assert k["footprint_m2"] == pytest.approx(126.0)
    assert k["bedarf_m2"] == pytest.approx(207.0)
    assert k["geschosse"] == 2
    assert k["bgf_m2"] == pytest.approx(252.0)
    assert plan["dach"]["firstrichtung"] == "x"
    assert plan["dach"]["firsthoehe_m"] == pytest.approx(4.5 * math.tan(math.radians(40)), abs=1e-6)
    assert plan["dach"]["firsthoehe_m"] == pytest.approx(3.78, abs=0.005)
    assert k["volumen_m3"] == pytest.approx(994.1, abs=0.5)
    assert k["grz"] == pytest.approx(0.42)
    assert k["gfz"] == pytest.approx(0.84)
    assert [g["z_m"] for g in plan["geschosse"]] == [0.0, 3.0]
    assert plan["dach"]["traufhoehe_m"] == pytest.approx(6.0)


def test_deterministisch():
    assert _referenz() == _referenz()


def test_annahmen_werden_genannt():
    plan = plan_massing({"grundstueck": GRUNDSTUECK_20x15, "raumprogramm": PROGRAMM_180})
    text = " ".join(plan["annahmen"])
    for teil in ("Geschosshöhe", "Grenzabstand", "Dachneigung", "Verkehrsfläche"):
        assert teil in text
    assert "[ASSUMED]" in text
    # defaults equal the reference values
    assert plan["kennzahlen"] == _referenz()["kennzahlen"]


def test_flachdach_ohne_dachvolumen():
    plan = _referenz(dach={"form": "flach"})
    assert plan["dach"]["volumen_m3"] == 0
    assert plan["kennzahlen"]["volumen_m3"] == pytest.approx(756.0)


def test_firstrichtung_folgt_der_laengeren_seite():
    plan = plan_massing({"grundstueck": [[0, 0], [15, 0], [15, 20], [0, 20]],
                         "raumprogramm": PROGRAMM_180, "abstand_m": 3})
    assert plan["dach"]["firstrichtung"] == "y"
    assert plan["dach"]["spannweite_m"] == pytest.approx(9.0)


def test_l_foermiges_grundstueck():
    # L: 20 × 10 strip plus a 10 × 10 wing on the left. With 3 m distance the
    # largest rectangle is the strip part 14 × 4 = 56 or the wing 4 × 14 = 56;
    # the union x 3..7, y 3..17 → 4 × 14 = 56, strip x 3..17, y 3..7 → 56.
    poly = [[0, 0], [20, 0], [20, 10], [10, 10], [10, 20], [0, 20]]
    rect = largest_rectangle([tuple(p) for p in poly], 3.0)
    assert rect is not None
    x0, y0, x1, y1 = rect
    assert (x1 - x0) * (y1 - y0) == pytest.approx(56.0)


def test_schraeges_grundstueck_bleibt_innerhalb():
    # Trapezoid with a slanted east edge: rectangle must keep 3 m to it.
    poly = [(0.0, 0.0), (30.0, 0.0), (20.0, 20.0), (0.0, 20.0)]
    x0, y0, x1, y1 = largest_rectangle(poly, 3.0)
    assert x0 >= 3 - 1e-9 and y0 >= 3 - 1e-9 and y1 <= 17 + 1e-9
    # distance of the corner (x1, y1) and (x1, y0) to the slanted edge >= 3 m
    ax, ay, bx, by = 30.0, 0.0, 20.0, 20.0
    for px, py in ((x1, y0), (x1, y1)):
        d = abs((by - ay) * px - (bx - ax) * py + bx * ay - by * ax) / math.hypot(by - ay, bx - ax)
        assert d >= 3 - 1e-6


def test_geschosszuordnung_explizit():
    plan = _referenz(raumprogramm=PROGRAMM_180 + [{"name": "Hobby", "flaeche_m2": 10, "geschoss": 2}])
    assert plan["kennzahlen"]["geschosse"] == 3
    assert "Hobby" in plan["geschosse"][2]["raeume"]


@pytest.mark.parametrize("eingabe, fehler", [
    ({"grundstueck": [[0, 0], [1, 0]], "raumprogramm": PROGRAMM_180}, "drei Eckpunkte"),
    ({"grundstueck": GRUNDSTUECK_20x15, "raumprogramm": []}, "mindestens einen Raum"),
    ({"grundstueck": GRUNDSTUECK_20x15, "raumprogramm": [{"name": "x"}]}, "flaeche_m2"),
    ({"grundstueck": [[0, 0], [5, 0], [5, 5], [0, 5]], "raumprogramm": PROGRAMM_180,
      "abstand_m": 3}, "Kein Baufeld"),
    ({"grundstueck": [[0, 0], [8, 0], [8, 8], [0, 8]], "raumprogramm": [{"name": "Halle",
      "flaeche_m2": 1000}], "abstand_m": 2}, "Geschosse"),
    ({"grundstueck": GRUNDSTUECK_20x15, "raumprogramm": PROGRAMM_180,
      "dach": {"form": "kuppel"}}, "dach.form"),
])
def test_fehler_im_klartext(eingabe, fehler):
    with pytest.raises(ValueError, match=fehler):
        plan_massing(eingabe)


def test_markdown_de():
    md = kennzahlen_markdown(_referenz())
    assert "126,00 m²" in md and "252,00 m²" in md and "993,88 m³" in md


def test_config_freecad_defaults(tmp_path):
    cfg = load_config(tmp_path / "fehlt.yaml", harness_dir=tmp_path)
    assert cfg.freecad_cmd is None and cfg.freecad_bridge_port == 8766
    (tmp_path / "config.yaml").write_text(
        "freecad:\n  cmd: D:/FC/bin/freecadcmd.exe\n  bridge_port: 9001\n", encoding="utf-8")
    cfg = load_config(tmp_path / "config.yaml", harness_dir=tmp_path)
    assert cfg.freecad_cmd == "D:/FC/bin/freecadcmd.exe" and cfg.freecad_bridge_port == 9001
