"""Das Beispielmodell "EFH Satteldach" — feste Zahlen, Geometrie, Driftschutz.

The example is generated, not hand-authored, so the test regenerates it in
tmp_path and checks the figures the rest of the /ifc skill relies on. The last
test compares the checked-in file byte for byte against a fresh build: if
make_example.py changes without the model being regenerated, it fails.
"""

from __future__ import annotations

import importlib.util
import math
import sys
from pathlib import Path

import pytest

pytest.importorskip("ifcopenshell", reason="Extra [ifc] installieren: pip install -e '.[ifc]'")

import ifcopenshell  # noqa: E402
import ifcopenshell.geom  # noqa: E402
import ifcopenshell.util.element  # noqa: E402

HARNESS_DIR = Path(__file__).resolve().parents[1]
SCRIPT = HARNESS_DIR / "skills" / "ifc" / "scripts" / "make_example.py"
CHECKED_IN = HARNESS_DIR / "examples" / "efh-satteldach" / "model" / "efh.ifc"


def load_make_example():
    """Loads the standalone script as a module — it is a CLI, not a package."""
    spec = importlib.util.spec_from_file_location("make_example", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    sys.modules["make_example"] = module
    spec.loader.exec_module(module)
    return module


def load_script(name: str):
    """Loads any skills/ifc/scripts/<name>.py as a module (same pattern)."""
    path = SCRIPT.parent / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


make_example = load_make_example()


@pytest.fixture(scope="module")
def fresh(tmp_path_factory) -> tuple[Path, dict]:
    out = tmp_path_factory.mktemp("efh") / "efh.ifc"
    figures = make_example.build(out)
    return out, figures


@pytest.fixture
def model(fresh) -> ifcopenshell.file:
    """Per test, deliberately: sharing one open file across tests makes
    ifcopenshell.geom return empty meshes once another handle on the same file
    is collected."""
    return ifcopenshell.open(str(fresh[0]))


def test_schema_und_projektstruktur(model):
    assert model.schema == "IFC4"
    assert len(model.by_type("IfcProject")) == 1
    assert len(model.by_type("IfcSite")) == 1
    assert len(model.by_type("IfcBuilding")) == 1
    storeys = sorted(model.by_type("IfcBuildingStorey"), key=lambda s: s.Elevation)
    assert [s.Name for s in storeys] == ["EG", "OG"]
    assert [s.Elevation for s in storeys] == [0.0, 3.0]


def test_bauteile_je_klasse(model):
    """Exact counts — the /ifc list and diff commands are tested against these."""
    assert len(model.by_type("IfcWall")) == 12
    assert len(model.by_type("IfcSlab")) == 5        # 3 Decken + 2 Dachflaechen
    assert len(model.by_type("IfcRoof")) == 1        # aggregiert die 2 Dachflaechen
    assert len(model.by_type("IfcWindow")) == 6
    assert len(model.by_type("IfcDoor")) == 2
    assert len(model.by_type("IfcOpeningElement")) == 8


def test_waende_aussen_innen(model):
    walls = model.by_type("IfcWall")
    external = [w for w in walls
                if ifcopenshell.util.element.get_psets(w)["Pset_WallCommon"]["IsExternal"]]
    assert len(external) == 8            # 4 je Geschoss
    assert len(walls) - len(external) == 4
    for wall in external:
        assert ifcopenshell.util.element.get_psets(wall)["Qto_WallBaseQuantities"]["Width"] == 0.365
    for wall in (w for w in walls if w not in external):
        assert ifcopenshell.util.element.get_psets(wall)["Qto_WallBaseQuantities"]["Width"] == 0.115


def test_bgf_je_geschoss(model):
    """BGF = Footprint 10 x 8 m = 80,0 m2 je Geschoss (Toleranz 0,5)."""
    for storey in model.by_type("IfcBuildingStorey"):
        qtos = ifcopenshell.util.element.get_psets(storey, qtos_only=True)
        bgf = qtos["Qto_BuildingStoreyBaseQuantities"]["GrossFloorArea"]
        assert bgf == pytest.approx(80.0, abs=0.5), f"{storey.Name}: BGF {bgf}"
        netto = qtos["Qto_BuildingStoreyBaseQuantities"]["NetFloorArea"]
        # T-4 (review): exact value, not a 20 m2 band. Computed in
        # build_storey_quantities: inner face minus interior wall footprints.
        expected = ((make_example.LENGTH - 2 * make_example.EXT_THICKNESS)
                    * (make_example.WIDTH - 2 * make_example.EXT_THICKNESS)
                    - (make_example.LENGTH - 2 * make_example.EXT_THICKNESS) * make_example.INT_THICKNESS
                    - (4.0 - make_example.EXT_THICKNESS) * make_example.INT_THICKNESS)
        assert netto == pytest.approx(expected, abs=0.01), f"{storey.Name}: NetFloorArea {netto}"


def test_wand_nettoflaechen_ziehen_oeffnungen_ab(model):
    """H-2: NetSideArea must deduct hosted openings; NetVolume must exist.

    AW-Sued-EG: gross 30.0 m2 minus three windows of 1.26 x 1.385 m
    = 30.0 - 3 x 1.7451 = 24.765 m2 (the review measured exactly this).
    """
    win_area = 1.26 * 1.385
    for name, openings, thickness in (
        ("AW-Sued-EG", 3 * win_area, make_example.EXT_THICKNESS),
        ("AW-Sued-OG", 3 * win_area, make_example.EXT_THICKNESS),
        ("AW-West-EG", 1.135 * 2.135, make_example.EXT_THICKNESS),
        ("AW-Nord-EG", 1.01 * 2.135, make_example.EXT_THICKNESS),
        ("IW-Quer-EG", 0.0, make_example.INT_THICKNESS),
    ):
        wall = next(w for w in model.by_type("IfcWall") if w.Name == name)
        qto = ifcopenshell.util.element.get_psets(wall)["Qto_WallBaseQuantities"]
        gross = qto["GrossSideArea"]
        assert qto["NetSideArea"] == pytest.approx(gross - openings, abs=0.001), name
        assert qto["NetVolume"] == pytest.approx((gross - openings) * thickness, abs=0.001), name
    # Every wall carries NetVolume now (it was missing in ALL Qto sets before).
    for wall in model.by_type("IfcWall"):
        qto = ifcopenshell.util.element.get_psets(wall)["Qto_WallBaseQuantities"]
        assert "NetVolume" in qto and qto["NetVolume"] > 0, wall.Name


def test_slab_qto_width_ist_dicke(model):
    """H-3: Qto_SlabBaseQuantities.Width = nominal thickness, not the footprint
    edge; Length and Perimeter must exist (schema: ifc4_properties.json)."""
    for slab in model.by_type("IfcSlab"):
        qto = ifcopenshell.util.element.get_psets(slab)["Qto_SlabBaseQuantities"]
        expected_t = make_example.ROOF_THICKNESS if slab.PredefinedType == "ROOF" \
            else make_example.SLAB_THICKNESS
        assert qto["Width"] == pytest.approx(expected_t, abs=1e-6), slab.Name
        assert qto["Length"] > 1.0, slab.Name          # the long edge, not 0.2
        assert qto["Perimeter"] > 0, slab.Name


def test_jedes_bauteil_hat_pset_und_qto(model):
    """H-4: windows, doors, openings and the roof aggregate used to carry
    nothing; now every building element has at least one Pset_* and one Qto_*."""
    for element in model.by_type("IfcBuildingElement"):
        psets = ifcopenshell.util.element.get_psets(element)
        names = set(psets)
        assert any(n.startswith("Pset_") for n in names), f"{element.is_a()} {element.Name}: kein Pset"
        assert any(n.startswith("Qto_") for n in names), f"{element.is_a()} {element.Name}: kein Qto"
    for opening in model.by_type("IfcOpeningElement"):
        qto = ifcopenshell.util.element.get_psets(opening).get("Qto_OpeningElementBaseQuantities")
        assert qto and qto["Volume"] > 0, opening.Name


def test_waende_tragen_fire_rating(model):
    """H-6: public/beispiel/musterprojekt.ids (BRAND-01) requires
    Pset_WallCommon.FireRating on every IFCWALL — the reference example must
    pass the app's own IDS check."""
    for wall in model.by_type("IfcWall"):
        rating = ifcopenshell.util.element.get_psets(wall)["Pset_WallCommon"].get("FireRating")
        assert rating == make_example.WALL_FIRE_RATING, wall.Name


def test_fenster_u_wert_passt_zur_projekterinnerung(model):
    """M-5: the project memory fixes triple glazing (0.8-1.1 W/m2K); the old
    1.3 contradicted it."""
    for window in model.by_type("IfcWindow"):
        u = ifcopenshell.util.element.get_psets(window)["Pset_WindowCommon"]["ThermalTransmittance"]
        assert 0.8 <= u <= 1.1, f"{window.Name}: U_w {u}"


def test_jedes_bauteil_haengt_an_einem_geschoss(model):
    orphans = [f"{e.is_a()} {e.Name}" for e in model.by_type("IfcElement")
               if not e.is_a("IfcOpeningElement")
               and ifcopenshell.util.element.get_container(e) is None]
    assert orphans == []


def test_oeffnungen_sind_verknuepft(model):
    """Every window and door fills an opening that voids an exterior wall."""
    fills = model.by_type("IfcRelFillsElement")
    assert len(fills) == 8
    assert len(model.by_type("IfcRelVoidsElement")) == 8
    for rel in fills:
        opening = rel.RelatingOpeningElement
        host = opening.VoidsElements[0].RelatingBuildingElement
        assert host.is_a("IfcWall")
        assert ifcopenshell.util.element.get_psets(host)["Pset_WallCommon"]["IsExternal"] is True


def test_guids_eindeutig_und_stabil(fresh, tmp_path):
    """Same names must yield the same GUIDs — the diff test depends on it."""
    model = ifcopenshell.open(str(fresh[0]))
    guids = [e.GlobalId for e in model.by_type("IfcRoot")]
    assert len(guids) == len(set(guids))

    again = tmp_path / "efh.ifc"
    make_example.build(again)
    second = ifcopenshell.open(str(again))
    by_name = {(e.is_a(), e.Name): e.GlobalId for e in second.by_type("IfcBuildingElement")}
    for element in model.by_type("IfcBuildingElement"):
        assert by_name[(element.is_a(), element.Name)] == element.GlobalId


def world_bbox(elements) -> tuple[list[float], list[float]]:
    """Lower and upper corner of the world bounding box over `elements`."""
    settings = ifcopenshell.geom.settings()
    settings.set("use-world-coords", True)
    lo = [1e9] * 3
    hi = [-1e9] * 3
    for element in elements:
        if not element.Representation:
            continue
        # Keep the shape in a variable. create_shape(...).geometry.verts in one
        # chain returns an empty tuple: .geometry does not hold a reference to
        # the shape, so the shape is freed before .verts is read.
        shape = ifcopenshell.geom.create_shape(settings, element)
        verts = shape.geometry.verts
        for axis in range(3):
            values = verts[axis::3]
            lo[axis] = min(lo[axis], min(values))
            hi[axis] = max(hi[axis], max(values))
    return lo, hi


def test_grundriss_und_geschosshoehe(model):
    """The walls define the footprint exactly: 10 x 8 m, two storeys of 3 m."""
    lo, hi = world_bbox(model.by_type("IfcWall"))
    assert lo[0] == pytest.approx(0.0, abs=1e-6) and hi[0] == pytest.approx(10.0, abs=1e-6)
    assert lo[1] == pytest.approx(0.0, abs=1e-6) and hi[1] == pytest.approx(8.0, abs=1e-6)
    assert lo[2] == pytest.approx(0.0, abs=1e-6)
    assert hi[2] == pytest.approx(2 * make_example.STOREY_HEIGHT, abs=1e-6)  # Traufe


def test_dach_first_und_traufe(model):
    """Gable roof: east-west ridge, 38 deg, eaves within the B-Plan limit."""
    panels = [s for s in model.by_type("IfcSlab") if s.PredefinedType == "ROOF"]
    assert sorted(p.Name for p in panels) == ["Dachflaeche-Nord", "Dachflaeche-Sued"]

    lo, hi = world_bbox(panels)
    pitch = math.radians(make_example.ROOF_PITCH_DEG)
    eave = 2 * make_example.STOREY_HEIGHT
    t = make_example.ROOF_THICKNESS
    # Ridge of the LOWER faces = eave + run x tan(pitch). Each panel extends up
    # the slope by t x tan(pitch) (H-5 fix), so the UPPER faces meet exactly on
    # the ridge axis at ridge + t / cos(pitch). The old model ended both panels
    # with their lower faces at the ridge, leaving a 0.296 m wide notch.
    ridge = eave + make_example.RIDGE_Y * math.tan(pitch)
    assert hi[2] == pytest.approx(ridge + t / math.cos(pitch), abs=0.01)
    assert lo[2] == pytest.approx(eave, abs=0.01)
    assert eave <= 6.50, "Traufhoehe ueber der B-Plan-Festsetzung (memory/b-plan-traufhoehe.md)"

    # East-west ridge: the panels span the full 10 m in x and overhang in y only
    # by the panel thickness at the eaves.
    overhang = t * math.sin(pitch)
    assert lo[0] == pytest.approx(0.0, abs=1e-6) and hi[0] == pytest.approx(10.0, abs=1e-6)
    assert lo[1] == pytest.approx(-overhang, abs=0.01)
    assert hi[1] == pytest.approx(8.0 + overhang, abs=0.01)


def test_dach_first_ohne_kerbe(model):
    """H-5: the two panels must interlock at the ridge — no notch.

    Old geometry: both panels ended with their LOWER faces on the ridge axis,
    so above it the material diverged and a 0.296 m wide, 0.189 m deep notch
    ran the full 10 m. Fix: each panel extends up the slope by t·tan(pitch),
    which puts the TOP-face ridge corner of BOTH panels exactly on the ridge
    axis at z = ridge + t/cos(pitch) (measured 9.4297 m).

    Measured on the real vertices (not the shared bbox — the review's T-2
    lesson).
    """
    pitch = math.radians(make_example.ROOF_PITCH_DEG)
    t = make_example.ROOF_THICKNESS
    ridge_top = 2 * make_example.STOREY_HEIGHT + make_example.RIDGE_Y * math.tan(pitch) \
        + t / math.cos(pitch)

    settings = ifcopenshell.geom.settings()
    settings.set("use-world-coords", True)
    for panel in (p for p in model.by_type("IfcSlab") if p.PredefinedType == "ROOF"):
        shape = ifcopenshell.geom.create_shape(settings, panel)  # keep in a variable (Falle 2)
        verts = shape.geometry.verts
        top_corners = [(verts[i], verts[i + 1], verts[i + 2])
                       for i in range(0, len(verts), 3)
                       if abs(verts[i + 2] - ridge_top) < 1e-6]
        assert top_corners, f"{panel.Name}: keine Ecke auf Firsthöhe {ridge_top:.4f} m"
        # Both ridge-side top corners sit ON the ridge axis (y = 4.0) at full
        # 10 m length — the panels meet instead of diverging.
        for x, y, z in top_corners:
            assert y == pytest.approx(make_example.RIDGE_Y, abs=0.01), \
                f"{panel.Name}: Firstecke bei y={y:.4f}, erwartet {make_example.RIDGE_Y}"
        xs = sorted({round(c[0], 6) for c in top_corners})
        assert xs == [0.0, make_example.LENGTH], f"{panel.Name}: Firstkante nicht durchgehend {xs}"


def test_roundtrip_property_schreiben(fresh, tmp_path):
    """H-7: the roundtrip must go through ifc_props.set_property (the function
    Task 2 ships) and must prove T-67-11: the SOURCE file stays untouched.

    Checked: value present after re-open, GUID stable, entity count identical,
    and the source file's bytes unchanged (set_property writes ONLY out_path).
    """
    props = load_script("ifc_props")

    source_bytes = Path(fresh[0]).read_bytes()
    out = tmp_path / "efh_v2.ifc"
    result = props.set_property(fresh[0], None, "Pset_WallCommon", "FireRating", "F90", out)
    assert result.get("error") is None, result

    model = ifcopenshell.open(str(fresh[0]))
    wall = model.by_type("IfcWall")[0]
    guid = wall.GlobalId
    # file.traverse() needs an instance in 0.8.5; iterating the file itself
    # yields every entity — that is the comparable total.
    entity_count = sum(1 for _ in model)

    # T-67-11: never in-place — the source must be byte-identical afterwards.
    assert Path(fresh[0]).read_bytes() == source_bytes, "set_property hat die Quelldatei verändert"

    reopened = ifcopenshell.open(str(out))
    same_wall = reopened.by_guid(guid)
    assert same_wall.GlobalId == guid
    assert ifcopenshell.util.element.get_psets(same_wall)["Pset_WallCommon"]["FireRating"] == "F90"
    assert sum(1 for _ in reopened) == entity_count


def test_ifcopenshell_validate_meldet_nichts(fresh):
    """The commit message claimed a clean validate run but no test backed it
    (review §1). Now it does: ifcopenshell.validate over the fresh build."""
    from ifcopenshell.validate import json_logger, validate as validate_file

    log = json_logger()
    model = ifcopenshell.open(str(fresh[0]))
    validate_file(model, log)
    statements = getattr(log, "statements", []) or []
    assert statements == [], f"validate meldet {len(statements)} Problem(e): {statements[:3]}"


def test_eingechecktes_modell_ist_aktuell(fresh):
    """Drift guard: the committed efh.ifc must match a fresh build byte for byte.

    Fails when make_example.py changed without regenerating the model. Fix:
    python harness/skills/ifc/scripts/make_example.py
    """
    assert CHECKED_IN.exists(), f"fehlt: {CHECKED_IN}"
    assert CHECKED_IN.read_bytes() == fresh[0].read_bytes(), (
        "examples/efh-satteldach/model/efh.ifc weicht vom Skript ab — "
        "neu erzeugen mit: python skills/ifc/scripts/make_example.py"
    )
