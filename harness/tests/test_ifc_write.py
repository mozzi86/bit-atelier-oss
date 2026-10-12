"""71-05: ifc_write — changes, GUID preservation, conflicts, georeferenced delivery.

The IFC2X3 fixture is built here with ifcopenshell.api (no customer model in
the repo). The run against the real reference models needs BIT_REFERENZ_MODELLE
(folder with .ifc files) and skips otherwise. Georef values are invented.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import sys
from pathlib import Path

import pytest

pytest.importorskip("ifcopenshell", reason="Extra [ifc] installieren: pip install -e '.[ifc]'")

import ifcopenshell  # noqa: E402
import ifcopenshell.api.aggregate  # noqa: E402
import ifcopenshell.api.context  # noqa: E402
import ifcopenshell.api.pset  # noqa: E402
import ifcopenshell.api.root  # noqa: E402
import ifcopenshell.api.spatial  # noqa: E402
import ifcopenshell.api.unit  # noqa: E402
import ifcopenshell.util.element  # noqa: E402

HARNESS_DIR = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = HARNESS_DIR / "skills" / "ifc" / "scripts"
EFH = HARNESS_DIR / "examples" / "efh-satteldach" / "model" / "efh.ifc"
# invented test values — never project coordinates (NDA)
GEOREF = {"ostwert": 4432100.25, "nordwert": 5491200.75, "hoehe": 301.5,
          "drehung_grad": 30.0, "crs": "EPSG:31468"}


def _script(name: str):
    if str(SCRIPTS_DIR) not in sys.path:
        sys.path.insert(0, str(SCRIPTS_DIR))
    spec = importlib.util.spec_from_file_location(f"t_{name}", SCRIPTS_DIR / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


W = _script("ifc_write")


def bau_2x3(pfad: Path) -> dict[str, str]:
    """Small IFC2X3 model like the reference structure: storey, two walls, a column, Pset PRJ."""
    f = ifcopenshell.file(schema="IFC2X3")
    W.owner_einrichten(f)
    project = ifcopenshell.api.root.create_entity(f, ifc_class="IfcProject", name="Testprojekt")
    ifcopenshell.api.unit.assign_unit(f)
    ifcopenshell.api.context.add_context(f, context_type="Model")
    site = ifcopenshell.api.root.create_entity(f, ifc_class="IfcSite", name="Gelände")
    building = ifcopenshell.api.root.create_entity(f, ifc_class="IfcBuilding", name="Gebäude")
    storey = ifcopenshell.api.root.create_entity(f, ifc_class="IfcBuildingStorey", name="EG")
    ifcopenshell.api.aggregate.assign_object(f, products=[site], relating_object=project)
    ifcopenshell.api.aggregate.assign_object(f, products=[building], relating_object=site)
    ifcopenshell.api.aggregate.assign_object(f, products=[storey], relating_object=building)
    guids = {}
    for name, cls in (("Wand A", "IfcWallStandardCase"), ("Wand B", "IfcWallStandardCase"),
                      ("Stütze 1", "IfcColumn")):
        el = ifcopenshell.api.root.create_entity(f, ifc_class=cls, name=name)
        ifcopenshell.api.spatial.assign_container(f, products=[el], relating_structure=storey)
        prj = ifcopenshell.api.pset.add_pset(f, product=el, name="PRJ")
        ifcopenshell.api.pset.edit_pset(f, pset=prj, properties={"Material": "C25/30", "DIN276_Nummer": "331"})
        guids[name] = el.GlobalId
    f.header.file_description.description = ()  # like an export without MVD
    f.write(str(pfad))
    return guids


@pytest.fixture
def modell_2x3(tmp_path):
    pfad = tmp_path / "rohbau.ifc"
    return pfad, bau_2x3(pfad)


def _sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def test_roundtrip_ohne_aenderung_erhaelt_alles(modell_2x3):
    pfad, _ = modell_2x3
    vorher = _sha(pfad)
    r = W.run(pfad)
    assert r["json"]["guid_erhalt"] is True
    p = r["json"]["pruefung"]
    assert p["schema"] == "IFC2X3" and p["guids_fehlend_anzahl"] == 0 and p["dubletten"] == 0
    assert Path(r["json"]["datei"]).name == "rohbau_v1.ifc"
    assert _sha(pfad) == vorher  # source untouched (T-71-05-01)
    neu = ifcopenshell.open(r["json"]["datei"])
    assert any("CoordinationView_V2.0" in d for d in neu.header.file_description.description)


def test_vorhandene_viewdefinition_bleibt(modell_2x3, tmp_path):
    pfad, _ = modell_2x3
    m = ifcopenshell.open(str(pfad))
    m.header.file_description.description = ("ViewDefinition [ReferenceView_V1.2]",)
    eigen = tmp_path / "rv.ifc"
    m.write(str(eigen))
    neu = ifcopenshell.open(W.run(eigen)["json"]["datei"])
    assert neu.header.file_description.description == ("ViewDefinition [ReferenceView_V1.2]",)


def test_prj_und_attribut_schreiben(modell_2x3):
    pfad, g = modell_2x3
    aend = [{"guid": g["Wand A"], "pset": "PRJ", "eigenschaft": "Material", "wert": "C30/37", "alt": "C25/30"},
            {"guid": g["Stütze 1"], "pset": "PRJ", "eigenschaft": "Betondeckung_mm", "wert": "35", "typ": "float"},
            {"guid": g["Wand B"], "attribut": "Name", "wert": "Wand B neu"},
            {"guid": g["Wand B"], "pset": "Pset_WallCommon", "eigenschaft": "LoadBearing", "wert": True}]
    r = W.run(pfad, aend)
    assert [x["status"] for x in r["json"]["aenderungen"]] == ["angewendet"] * 4
    assert r["json"]["guid_erhalt"] is True
    m = ifcopenshell.open(r["json"]["datei"])
    a = ifcopenshell.util.element.get_psets(m.by_guid(g["Wand A"]))
    assert a["PRJ"]["Material"] == "C30/37" and a["PRJ"]["DIN276_Nummer"] == "331"
    s = ifcopenshell.util.element.get_psets(m.by_guid(g["Stütze 1"]))
    assert s["PRJ"]["Betondeckung_mm"] == pytest.approx(35.0)
    b = m.by_guid(g["Wand B"])
    assert b.Name == "Wand B neu"
    assert ifcopenshell.util.element.get_psets(b)["Pset_WallCommon"]["LoadBearing"] is True
    assert m.schema == "IFC2X3"


def test_konflikt_wird_nicht_geschrieben(modell_2x3):
    pfad, g = modell_2x3
    aend = [{"guid": g["Wand A"], "pset": "PRJ", "eigenschaft": "Material", "wert": "C35/45", "alt": "C20/25"}]
    r = W.run(pfad, aend)
    row = r["json"]["aenderungen"][0]
    assert row["status"] == "konflikt" and "C25/30" in row["grund"]
    m = ifcopenshell.open(r["json"]["datei"])
    assert ifcopenshell.util.element.get_psets(m.by_guid(g["Wand A"]))["PRJ"]["Material"] == "C25/30"
    r2 = W.run(pfad, aend, erzwingen=True)
    assert r2["json"]["aenderungen"][0]["status"] == "angewendet"


def test_fehlende_guid_ungueltig_unveraendert(modell_2x3):
    pfad, g = modell_2x3
    aend = [{"guid": "0000000000000000000000", "pset": "PRJ", "eigenschaft": "X", "wert": 1},
            {"guid": g["Wand A"], "pset": "PRJ", "eigenschaft": "Material", "wert": "C25/30"},
            {"guid": g["Wand A"], "wert": 1},
            {"guid": g["Wand A"], "attribut": "GibtEsNicht", "wert": "x"}]
    st = [x["status"] for x in W.run(pfad, aend)["json"]["aenderungen"]]
    assert st == ["fehlt", "unveraendert", "ungueltig", "ungueltig"]


def test_versionierte_namen(modell_2x3):
    pfad, _ = modell_2x3
    assert Path(W.run(pfad)["json"]["datei"]).name == "rohbau_v1.ifc"
    assert Path(W.run(pfad)["json"]["datei"]).name == "rohbau_v2.ifc"
    assert "Quelle" in W.run(pfad, out=pfad)["error"]


def test_abgabe_georef_ifc2x3(modell_2x3):
    pfad, _ = modell_2x3
    r = W.run(pfad, abgabe=True, georef=GEOREF)
    ab = r["json"]["abgabe"]
    assert Path(ab["datei"]).name == "rohbau_abgabe_v1.ifc"
    assert ab["guids_fehlend_anzahl"] == 0 and ab["schema"] == "IFC2X3"
    m = ifcopenshell.open(ab["datei"])
    project = m.by_type("IfcProject")[0]
    conv = ifcopenshell.util.element.get_pset(project, "ePSet_MapConversion")
    crs = ifcopenshell.util.element.get_pset(project, "ePSet_ProjectedCRS")
    assert conv["Eastings"] == pytest.approx(GEOREF["ostwert"])
    assert conv["Northings"] == pytest.approx(GEOREF["nordwert"])
    assert conv["OrthogonalHeight"] == pytest.approx(GEOREF["hoehe"])
    assert conv["XAxisAbscissa"] == pytest.approx(0.8660254, abs=1e-6)
    assert conv["XAxisOrdinate"] == pytest.approx(0.5, abs=1e-6)
    assert crs["Name"] == "EPSG:31468"
    # the main file stays without georeference
    haupt = ifcopenshell.open(r["json"]["datei"])
    assert not ifcopenshell.util.element.get_pset(haupt.by_type("IfcProject")[0], "ePSet_MapConversion")


def test_abgabe_georef_ifc4_efh(tmp_path):
    src = tmp_path / "efh.ifc"
    src.write_bytes(EFH.read_bytes())
    wand = ifcopenshell.open(str(src)).by_type("IfcWall")[0]
    r = W.run(src, [{"guid": wand.GlobalId, "pset": "Pset_WallCommon", "eigenschaft": "FireRating",
                     "wert": "F90", "alt": "F30"}], abgabe=True, georef=GEOREF)
    assert r["json"]["aenderungen"][0]["status"] == "angewendet"
    m = ifcopenshell.open(r["json"]["abgabe"]["datei"])
    conv = m.by_type("IfcMapConversion")[0]
    assert conv.Eastings == pytest.approx(GEOREF["ostwert"]) and conv.TargetCRS.Name == "EPSG:31468"
    assert r["json"]["abgabe"]["guids_fehlend_anzahl"] == 0


def test_abgabe_ohne_georef_klartext(modell_2x3):
    pfad, _ = modell_2x3
    assert "georef fehlt" in W.run(pfad, abgabe=True)["error"]
    assert "crs fehlt" in W.run(pfad, abgabe=True, georef={**GEOREF, "crs": ""})["error"]


def test_journal_datei_lesen(tmp_path, modell_2x3):
    pfad, g = modell_2x3
    j = tmp_path / "rohbau.journal.json"
    j.write_text(json.dumps({"format": "bit-ifc-journal", "version": 1, "modell": "rohbau.ifc",
                             "eintraege": [{"guid": g["Wand A"], "pset": "PRJ", "eigenschaft": "Material",
                                            "wert": "C30/37", "alt": "C25/30"}]}), encoding="utf-8")
    assert W.main([str(pfad), "--aenderungen", str(j)]) == 0
    m = ifcopenshell.open(str(tmp_path / "rohbau_v1.ifc"))
    assert ifcopenshell.util.element.get_psets(m.by_guid(g["Wand A"]))["PRJ"]["Material"] == "C30/37"


REFERENZ = os.environ.get("BIT_REFERENZ_MODELLE")


@pytest.mark.skipif(not REFERENZ, reason="BIT_REFERENZ_MODELLE nicht gesetzt (Referenzmodelle nur lokal)")
def test_referenzmodelle_roundtrip(tmp_path):
    dateien = sorted(Path(REFERENZ).glob("*.ifc"))
    if not dateien:
        pytest.skip(f"keine .ifc in {REFERENZ}")
    for quelle in dateien:
        r = W.run(quelle, out=tmp_path / f"{quelle.stem}_rt.ifc")
        assert r["json"]["guid_erhalt"] is True, quelle.name
        assert r["json"]["pruefung"]["schema"] == ifcopenshell.open(str(quelle)).schema


# --- tool: ifc_run schreibe ------------------------------------------------------

def _tool(ws: dict, optionen: dict, extra: dict | None = None) -> dict:
    import asyncio

    from harness.tools.builtin import registry
    from harness.tools.registry import ToolContext

    ctx = ToolContext(mode="user", projekt="efh-satteldach", sandbox_roots=[ws["project_dir"]],
                      project_dir=ws["project_dir"], extra=extra or {})
    args = {"unterbefehl": "schreibe", "datei": "model/efh.ifc", "optionen": optionen}
    return json.loads(asyncio.run(registry.dispatch("ifc_run", args, ctx)))


def _ws_mit_modell(workspace) -> tuple[dict, str]:
    model_dir = workspace["project_dir"] / "model"
    model_dir.mkdir(exist_ok=True)
    (model_dir / "efh.ifc").write_bytes(EFH.read_bytes())
    guid = ifcopenshell.open(str(model_dir / "efh.ifc")).by_type("IfcWall")[0].GlobalId
    return workspace, guid


def test_tool_schreibe_mit_projekt_georef(workspace):
    ws, guid = _ws_mit_modell(workspace)
    (ws["project_dir"] / "georef.yaml").write_text(
        "\n".join(f"{k}: {v}" for k, v in GEOREF.items()), encoding="utf-8")
    out = _tool(ws, {"aenderungen": [{"guid": guid, "pset": "Pset_WallCommon", "eigenschaft": "FireRating",
                                      "wert": "F90"}], "abgabe": True},
                extra={"ifc_georef": {**GEOREF, "ostwert": 1.0}})
    assert "error" not in out, out.get("error")
    assert out["json"]["guid_erhalt"] is True
    assert out["json"]["abgabe"]["georef"]["Eastings"] == pytest.approx(GEOREF["ostwert"])  # project file wins
    assert (ws["project_dir"] / "model" / "efh_v1.ifc").is_file()
    assert (ws["project_dir"] / "model" / "efh_abgabe_v1.ifc").is_file()
    assert out["ziel"] == {"datei": "model/efh_v1.ifc"}


def test_tool_schreibe_journal_und_config_georef(workspace):
    ws, guid = _ws_mit_modell(workspace)
    j = ws["project_dir"] / "model" / "efh.journal.json"
    j.write_text(json.dumps({"format": "bit-ifc-journal", "version": 1, "modell": "efh.ifc",
                             "eintraege": [{"guid": guid, "attribut": "Name", "wert": "Wand umbenannt"}]}),
                 encoding="utf-8")
    out = _tool(ws, {"journal": "model/efh.journal.json", "abgabe": True}, extra={"ifc_georef": GEOREF})
    assert out["json"]["zaehlung"] == {"angewendet": 1}
    assert out["json"]["abgabe"]["georef"]["crs"] == "EPSG:31468"


def test_tool_schreibe_ohne_georef_klartext(workspace):
    ws, _ = _ws_mit_modell(workspace)
    out = _tool(ws, {"abgabe": True})
    assert "georef fehlt" in out["error"]
    out = _tool(ws, {"out": "../../ausserhalb.ifc"})
    assert "error" in out


def test_app_journal_auf_musterprojekt(tmp_path):
    """71-06 → 71-05: the journal the app downloads (AttributEditor, E2E attribut-editor-71-06)
    applied to the app's sample model — alt values from web-ifc match IfcOpenShell's."""
    muster = HARNESS_DIR.parent / "public" / "beispiel" / "musterprojekt.ifc"
    if not muster.is_file():
        pytest.skip("public/beispiel/musterprojekt.ifc fehlt")
    src = tmp_path / "musterprojekt.ifc"
    src.write_bytes(muster.read_bytes())
    guid = "nYqxeK5NUBtew1kQBTaHzk"
    journal = {"format": "bit-ifc-journal", "version": 1, "modell": "musterprojekt.ifc",
               "exportiert": "2026-10-12T10:00:00.000Z",
               "eintraege": [
                   {"guid": guid, "pset": "Pset_WallCommon", "eigenschaft": "FireRating",
                    "alt": "F90", "wert": "F120", "zeit": "2026-10-12T09:58:00.000Z"},
                   {"guid": guid, "pset": "Pset_WallCommon", "eigenschaft": "LoadBearing",
                    "alt": True, "wert": False, "zeit": "2026-10-12T09:59:00.000Z"}]}
    j = tmp_path / "musterprojekt.journal.json"
    j.write_text(json.dumps(journal), encoding="utf-8")
    r = W.run(src, W.lade_journal(j))
    assert [x["status"] for x in r["json"]["aenderungen"]] == ["angewendet", "angewendet"]
    assert r["json"]["guid_erhalt"] is True
    ps = ifcopenshell.util.element.get_psets(ifcopenshell.open(r["json"]["datei"]).by_guid(guid))
    assert ps["Pset_WallCommon"]["FireRating"] == "F120" and ps["Pset_WallCommon"]["LoadBearing"] is False
