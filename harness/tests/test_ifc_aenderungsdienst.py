"""71-09: change service — own journal over a new client model state, per GlobalId.

Three states from the IFC2X3 fixture of test_ifc_write: old client state, our journal
on it, a new client state where the client changed one of "our" properties (conflict),
another of our properties to exactly our value (already equal), left one alone
(transferable), removed a column (removed) and added a wall (diff: new).
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

pytest.importorskip("ifcopenshell", reason="Extra [ifc] installieren: pip install -e '.[ifc]'")

import ifcopenshell  # noqa: E402
import ifcopenshell.api.pset  # noqa: E402
import ifcopenshell.api.root  # noqa: E402
import ifcopenshell.api.spatial  # noqa: E402
import ifcopenshell.util.element  # noqa: E402

from test_ifc_write import W, _script, bau_2x3  # noqa: E402

D = _script("ifc_aenderungsdienst")


def _pset(model, guid, name):
    el = model.by_guid(guid)
    for rel in el.IsDefinedBy or ():
        if rel.is_a("IfcRelDefinesByProperties") and rel.RelatingPropertyDefinition.Name == name:
            return rel.RelatingPropertyDefinition
    raise AssertionError(name)


@pytest.fixture
def staende(tmp_path):
    alt = tmp_path / "ag_stand_1.ifc"
    g = bau_2x3(alt)
    m = ifcopenshell.open(str(alt))
    W.owner_einrichten(m)
    ifcopenshell.api.pset.edit_pset(m, pset=_pset(m, g["Wand A"], "PRJ"), properties={"Material": "C35/45"})
    ifcopenshell.api.pset.edit_pset(m, pset=_pset(m, g["Wand B"], "PRJ"), properties={"DIN276_Nummer": "332"})
    ifcopenshell.api.root.remove_product(m, product=m.by_guid(g["Stütze 1"]))
    storey = m.by_type("IfcBuildingStorey")[0]
    neu_wand = ifcopenshell.api.root.create_entity(m, ifc_class="IfcWallStandardCase", name="Wand C")
    ifcopenshell.api.spatial.assign_container(m, products=[neu_wand], relating_structure=storey)
    neu = tmp_path / "ag_stand_2.ifc"
    m.write(str(neu))
    journal = [
        {"guid": g["Wand A"], "pset": "PRJ", "eigenschaft": "Material", "alt": "C25/30", "wert": "C30/37"},
        {"guid": g["Wand B"], "pset": "PRJ", "eigenschaft": "Material", "alt": "C25/30", "wert": "C30/37"},
        {"guid": g["Wand B"], "pset": "PRJ", "eigenschaft": "DIN276_Nummer", "alt": "331", "wert": "332"},
        {"guid": g["Stütze 1"], "pset": "PRJ", "eigenschaft": "Material", "alt": "C25/30", "wert": "C40/50"},
    ]
    return alt, neu, g, journal, neu_wand.GlobalId


def test_urteile_je_eigener_aenderung(staende):
    alt, neu, g, journal, _ = staende
    r = D.run(alt, neu, journal)
    assert [x["urteil"] for x in r["json"]["urteile"]] == ["konflikt", "uebertragbar", "schon_gleich", "entfallen"]
    k = r["json"]["urteile"][0]
    assert k["wert_alter_stand"] == "C25/30" and k["wert_neuer_stand"] == "C35/45"
    assert "C35/45" in k["grund"] and "C30/37" in k["grund"]
    assert r["json"]["zaehlung"]["konflikt"] == 1
    assert r["json"]["datei"] is None  # nothing written without anwenden
    assert "Konflikt" in r["markdown"]


def test_modelldiff_je_guid(staende):
    alt, neu, g, journal, wand_c = staende
    d = D.run(alt, neu, journal)["json"]["diff"]
    assert d["neu_ids"] == [wand_c]
    assert d["entfallen_ids"] == [g["Stütze 1"]]
    assert d["geaendert"] >= 2


def test_anwenden_schreibt_nur_uebertragbare(staende):
    alt, neu, g, journal, _ = staende
    vorher = neu.read_bytes()
    r = D.run(alt, neu, journal, anwenden=True)
    assert Path(r["json"]["datei"]).name == "ag_stand_2_v1.ifc"
    assert r["json"]["geschrieben"]["guid_erhalt"] is True
    assert neu.read_bytes() == vorher
    m = ifcopenshell.open(r["json"]["datei"])
    assert ifcopenshell.util.element.get_psets(m.by_guid(g["Wand B"]))["PRJ"]["Material"] == "C30/37"
    assert ifcopenshell.util.element.get_psets(m.by_guid(g["Wand A"]))["PRJ"]["Material"] == "C35/45"  # conflict untouched
    assert m.schema == "IFC2X3"


def test_journal_ohne_alt_nimmt_alten_stand(staende):
    alt, neu, g, _, _ = staende
    r = D.run(alt, neu, [{"guid": g["Wand A"], "pset": "PRJ", "eigenschaft": "Material", "wert": "C30/37"}])
    assert r["json"]["urteile"][0]["urteil"] == "konflikt"


def test_journal_zu_anderem_stand_wird_gemeldet(staende):
    alt, neu, g, _, _ = staende
    r = D.run(alt, neu, [{"guid": g["Wand B"], "pset": "PRJ", "eigenschaft": "Material", "alt": "C20/25", "wert": "C30/37"}])
    row = r["json"]["urteile"][0]
    assert "anderen Stand" in row["hinweis"]


def test_tool_aenderungsdienst(staende, workspace):
    from harness.tools.builtin import registry
    from harness.tools.registry import ToolContext

    alt, neu, g, journal, _ = staende
    model_dir = workspace["project_dir"] / "model"
    for p in (alt, neu):
        (model_dir / p.name).write_bytes(p.read_bytes())
    (model_dir / "eigen.journal.json").write_text(json.dumps({"format": "bit-ifc-journal", "version": 1,
                                                               "modell": alt.name, "eintraege": journal}), encoding="utf-8")
    ctx = ToolContext(mode="user", projekt="efh-satteldach", sandbox_roots=[workspace["project_dir"]],
                      project_dir=workspace["project_dir"])
    out = json.loads(asyncio.run(registry.dispatch("ifc_run", {
        "unterbefehl": "aenderungsdienst", "datei": f"model/{alt.name}", "datei2": f"model/{neu.name}",
        "optionen": {"journal": "model/eigen.journal.json", "anwenden": True}}, ctx)))
    assert "error" not in out, out.get("error")
    assert out["json"]["zaehlung"]["uebertragbar"] == 1
    assert out["ziel"] == {"datei": "model/ag_stand_2_v1.ifc"}
    out = json.loads(asyncio.run(registry.dispatch("ifc_run", {
        "unterbefehl": "aenderungsdienst", "datei": f"model/{alt.name}"}, ctx)))
    assert "braucht datei2" in out["error"]
