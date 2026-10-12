"""Task 2 (67-04): /freecad headless — description → FreeCAD → IFC → /ifc.

Tests marked `needs_freecad` run against the real FreeCAD (1.1 on the
reference machine) and SKIP with the reason "freecadcmd nicht gefunden
(config freecad.cmd)" where it is absent (CI). The rest — binary lookup,
versioned file names, plain-text errors, /freecad plan — always runs.
"""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path

import pytest

from harness.config import HARNESS_DIR
from harness.tools.freecad import _fc_run, naechste_version
from harness.tools.registry import ToolContext, registry
from harness.geom.massing import plan_massing

FC = _fc_run()
# HARNESS_TEST_OHNE_FREECAD=1 simulates a machine without FreeCAD (the CI case).
FREECADCMD = None if os.environ.get("HARNESS_TEST_OHNE_FREECAD") else FC.finde_freecadcmd()
needs_freecad = pytest.mark.skipif(
    FREECADCMD is None, reason="freecadcmd nicht gefunden (config freecad.cmd)")

BEISPIEL = HARNESS_DIR / "skills" / "freecad" / "references" / "beispiel-efh.json"
MASSING_EINGABE = {"grundstueck": [[0, 0], [20, 0], [20, 15], [0, 15]],
                   "raumprogramm": [{"name": "Wohnen", "flaeche_m2": 100},
                                    {"name": "Schlafen", "flaeche_m2": 80}],
                   "geschosshoehe_m": 3.0, "abstand_m": 3.0,
                   "dach": {"form": "satteldach", "neigung_grad": 40}}


def _ctx(project_dir: Path, **extra) -> ToolContext:
    return ToolContext(mode="user", projekt="test", sandbox_roots=[project_dir],
                       project_dir=project_dir, extra=extra)


def _dispatch(name: str, args: dict, ctx: ToolContext) -> dict:
    return json.loads(asyncio.run(registry.dispatch(name, args, ctx)))


# --- always ---------------------------------------------------------------------

def test_finde_freecadcmd_env_ordner_und_datei(tmp_path):
    install = tmp_path / "FreeCAD 9.9"
    (install / "bin").mkdir(parents=True)
    exe = install / "bin" / "freecadcmd.exe"
    exe.write_text("", encoding="utf-8")
    assert FC.finde_freecadcmd(None, env={"BIT_FREECAD": str(install)}) == exe
    assert FC.finde_freecadcmd(None, env={"BIT_FREECAD": str(exe)}) == exe
    # env wins over config; a bad env value falls through to the config
    other = tmp_path / "cfg.exe"
    other.write_text("", encoding="utf-8")
    assert FC.finde_freecadcmd(str(other), env={"BIT_FREECAD": str(exe)}) == exe
    assert FC.finde_freecadcmd(str(other), env={"BIT_FREECAD": str(tmp_path / "nix")}) == other


def test_run_script_ohne_freecad_klartext(tmp_path):
    result = FC.run_script("fc_massing", {}, cmd=tmp_path / "fehlt.exe")
    assert result["ok"] is False
    assert "freecadcmd nicht gefunden (config freecad.cmd)" in result["error"]
    assert "BIT_FREECAD" in result["error"]


def test_naechste_version(tmp_path):
    ifc, fcstd = naechste_version(tmp_path, "Massen modell")
    assert ifc.name == "Massen-modell_v1.ifc" and fcstd.name == "Massen-modell_v1.FCStd"
    ifc.write_text("x", encoding="utf-8")
    assert naechste_version(tmp_path, "Massen modell")[0].name == "Massen-modell_v2.ifc"


def test_tool_ohne_freecad_meldet_konfiguration(tmp_path, monkeypatch):
    monkeypatch.setattr(FC, "finde_freecadcmd", lambda *a, **k: None)
    out = _dispatch("freecad_run", {"unterbefehl": "massing", "eingabe": MASSING_EINGABE},
                    _ctx(tmp_path))
    assert "freecadcmd nicht gefunden (config freecad.cmd)" in out["error"]
    assert not (tmp_path / "model").exists()


def test_tool_plan_ohne_freecad(tmp_path, monkeypatch):
    monkeypatch.setattr(FC, "finde_freecadcmd", lambda *a, **k: None)
    out = _dispatch("freecad_run", {"unterbefehl": "plan", "eingabe": MASSING_EINGABE},
                    _ctx(tmp_path))
    assert out["bauplan"]["kennzahlen"]["volumen_m3"] == pytest.approx(993.9, abs=0.5)
    assert "BGF" in out["markdown"]


def test_tool_fehler_im_klartext(tmp_path):
    out = _dispatch("freecad_run", {"unterbefehl": "zaubern"}, _ctx(tmp_path))
    assert "unbekannt" in out["error"]
    out = _dispatch("freecad_run", {"unterbefehl": "plan", "eingabe": {"grundstueck": [[0, 0]]}},
                    _ctx(tmp_path))
    assert "drei Eckpunkte" in out["error"]


def test_tool_in_beiden_modi():
    assert "freecad_run" in registry.names("user")
    assert "freecad_run" in registry.names("developer")


def test_skill_wird_geladen():
    from harness.skills.loader import load_skills

    skills, fehler = load_skills(HARNESS_DIR / "skills")
    assert not [f for f in fehler if "freecad" in f]
    sk = next(s for s in skills if s.name == "freecad")
    assert sk.mode == "both" and "freecad_run" in sk.tools


# --- real FreeCAD ----------------------------------------------------------------

@pytest.fixture(scope="module")
def massing_lauf(tmp_path_factory):
    if FREECADCMD is None:
        pytest.skip("freecadcmd nicht gefunden (config freecad.cmd)")
    out = tmp_path_factory.mktemp("massing")
    plan = plan_massing(MASSING_EINGABE)
    result = FC.run_script("fc_massing", {"bauplan": plan, "ifc": str(out / "m.ifc"),
                                          "fcstd": str(out / "m.FCStd")}, cmd=FREECADCMD)
    assert result.get("ok"), result.get("error")
    return plan, result, out


@pytest.fixture(scope="module")
def bauteile_lauf(tmp_path_factory):
    if FREECADCMD is None:
        pytest.skip("freecadcmd nicht gefunden (config freecad.cmd)")
    out = tmp_path_factory.mktemp("bauteile")
    beschreibung = json.loads(BEISPIEL.read_text(encoding="utf-8"))
    result = FC.run_script("fc_bauteile", {"beschreibung": beschreibung, "ifc": str(out / "b.ifc"),
                                           "fcstd": str(out / "b.FCStd")}, cmd=FREECADCMD)
    assert result.get("ok"), result.get("error")
    return result, out


def _ifc_script(name: str):
    from harness.tools.ifc import _script
    return _script(name)


@needs_freecad
def test_massing_roundtrip_ifc_liste_und_mengen(massing_lauf):
    pytest.importorskip("ifcopenshell", reason="Extra [ifc] installieren")
    import ifcopenshell
    import ifcopenshell.util.element

    plan, result, out = massing_lauf
    ifc = out / "m.ifc"
    model = ifcopenshell.open(str(ifc))
    assert len(model.by_type("IfcBuildingStorey")) == 2
    liste = _ifc_script("ifc_list").run(ifc)
    assert "IfcBuildingElementProxy" in liste["markdown"]
    proxies = model.by_type("IfcBuildingElementProxy") + model.by_type("IfcSlab")
    assert len(proxies) >= 2
    mengen = _ifc_script("ifc_quantities").run(ifc)
    volumen = sum(p["mengen"].get("NetVolume", 0) for p in mengen["json"]["positionen"])
    assert all(p["quelle"] == "Qto" for p in mengen["json"]["positionen"])
    assert volumen == pytest.approx(994.0, rel=0.02)
    assert volumen == pytest.approx(plan["kennzahlen"]["volumen_m3"], abs=0.01)
    assert result["volumen_m3"] == pytest.approx(plan["kennzahlen"]["volumen_m3"], abs=0.01)
    # storeys in the right place: body of the 1st floor starts at z = 3 m
    by_storey = {e.Name: ifcopenshell.util.element.get_container(e).Name
                 for e in model.by_type("IfcBuildingElementProxy")}
    assert by_storey["Baukörper EG"] == "EG" and by_storey["Baukörper 1. OG"] == "1. OG"


@needs_freecad
def test_massing_ifc_ist_schemagueltig(massing_lauf):
    pytest.importorskip("ifcopenshell")
    import ifcopenshell.validate

    _, _, out = massing_lauf
    logger = ifcopenshell.validate.json_logger()
    ifcopenshell.validate.validate(str(out / "m.ifc"), logger)
    assert logger.statements == []


@needs_freecad
def test_bauteile_zaehlung_und_mengen(bauteile_lauf):
    pytest.importorskip("ifcopenshell")
    import ifcopenshell
    import ifcopenshell.util.element
    import ifcopenshell.validate

    result, out = bauteile_lauf
    ifc = out / "b.ifc"
    model = ifcopenshell.open(str(ifc))
    zaehl = {k: len(model.by_type(k)) for k in ("IfcWall", "IfcWindow", "IfcDoor", "IfcRoof", "IfcSlab")}
    assert zaehl == {"IfcWall": 12, "IfcWindow": 6, "IfcDoor": 2, "IfcRoof": 1, "IfcSlab": 2}
    assert result["zaehlung"]["IfcWall"] == 12

    liste = _ifc_script("ifc_list").run(ifc)
    assert liste["json"]
    mengen = {p["name"]: p for p in _ifc_script("ifc_quantities").run(ifc)["json"]["positionen"]}
    # South wall EG: 10.0 × 2.8 m minus window 1.5 × 1.4 and door 1.01 × 2.135
    sued = mengen["Wand EG 01"]["mengen"]
    assert sued["NetSideArea"] == pytest.approx(28.0 - 2.1 - 1.01 * 2.135, abs=1e-3)
    # FreeCAD cut both openings through the full wall thickness 0.365 m
    assert sued["NetVolume"] == pytest.approx((28.0 - 2.1 - 1.01 * 2.135) * 0.365, abs=1e-3)
    # pinwheel corners: exterior walls of one storey = perimeter × t × h, no overlap
    aussen_brutto = sum(mengen[f"Wand EG 0{i}"]["mengen"]["GrossVolume"] for i in range(1, 5))
    assert aussen_brutto == pytest.approx(36.0 * 0.365 * 2.8, abs=1e-3)
    # openings carry no window quantities (same name as their window)
    for op in model.by_type("IfcOpeningElement"):
        assert not ifcopenshell.util.element.get_psets(op, qtos_only=True)

    walls = {w.Name: w.PredefinedType for w in model.by_type("IfcWall")}
    assert walls["Wand EG 01"] == "SOLIDWALL" and walls["Wand EG 05"] == "PARTITIONING"
    assert model.by_type("IfcRoof")[0].PredefinedType == "GABLE_ROOF"

    logger = ifcopenshell.validate.json_logger()
    ifcopenshell.validate.validate(str(ifc), logger)
    assert logger.statements == []


@needs_freecad
def test_export_aus_fcstd_behaelt_mengen(bauteile_lauf, tmp_path):
    pytest.importorskip("ifcopenshell")
    import ifcopenshell
    import ifcopenshell.util.element

    _, out = bauteile_lauf
    result = FC.run_script("fc_export_ifc", {"fcstd": str(out / "b.FCStd"),
                                             "ifc": str(tmp_path / "re.ifc")}, cmd=FREECADCMD)
    assert result.get("ok"), result.get("error")
    model = ifcopenshell.open(str(tmp_path / "re.ifc"))
    assert len(model.by_type("IfcWall")) == 12
    wand = next(w for w in model.by_type("IfcWall") if w.Name == "Wand EG 01")
    qto = ifcopenshell.util.element.get_psets(wand, qtos_only=True)["Qto_WallBaseQuantities"]
    assert qto["NetVolume"] == pytest.approx((28.0 - 2.1 - 1.01 * 2.135) * 0.365, abs=1e-3)


@needs_freecad
def test_tool_massing_schreibt_versioniert(workspace):
    out = _dispatch("freecad_run", {"unterbefehl": "massing", "eingabe": MASSING_EINGABE},
                    _ctx(workspace["project_dir"], freecad_cmd=str(FREECADCMD)))
    assert "error" not in out, out.get("error")
    assert out["ifc"] == "model/massenmodell_v1.ifc"
    assert (workspace["project_dir"] / "model" / "massenmodell_v1.ifc").is_file()
    assert out["fcstd"] == "model/massenmodell_v1.FCStd"
    assert out["volumen_freecad_m3"] == pytest.approx(993.9, abs=0.5)
    assert out["ziel"] == {"datei": "model/massenmodell_v1.ifc"}
    if "roundtrip" in out:
        assert "Gegenprobe /ifc liste" in out["markdown"]


def test_fehlerhafte_beschreibung_klartext(tmp_path):
    if FREECADCMD is None:
        pytest.skip("freecadcmd nicht gefunden (config freecad.cmd)")
    beschreibung = json.loads(BEISPIEL.read_text(encoding="utf-8"))
    beschreibung["geschosse"][0]["oeffnungen"][0]["wand"] = "Wand XY 99"
    result = FC.run_script("fc_bauteile", {"beschreibung": beschreibung, "ifc": str(tmp_path / "x.ifc")},
                           cmd=FREECADCMD)
    assert result["ok"] is False
    assert "Wand 'Wand XY 99' nicht gefunden" in result["error"]
