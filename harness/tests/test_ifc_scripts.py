"""Task 2 (67-03): the /ifc read scripts against the EFH example and mini.ifc.

Covers, per plan and review §4:
- ifc_list: 12 walls grouped by PredefinedType, 8 external (IsExternal).
- ifc_quantities: Qto path (source "Qto") — including the app fixture
  mini.ifc whose sets are named plain "BaseQuantities" (read via IsDefinedBy,
  NOT by set name, review §4.2); geometry fallback (source "Geometrie
  [ASSUMED]") against a purpose-built fixture (efh.ifc copy with every Qto
  removed — the review §4.3 proved mini.ifc cannot serve this case: it HAS
  quantities and its walls carry no representation).
- ifc_props: roundtrip set_property — source untouched (T-67-11), value
  present after re-open, GUID stable.
- ifc_classify: mini.ifc as the read case (IFCCLASSIFICATION 'BUERO', two
  references, plus the unclassified wall as the mixed case), efh.ifc as the
  heuristic case with [ASSUMED].
- ifc_check: clean example -> pass; missing mandatory Pset -> warn with the
  element list.

Path anchor note (review §4.5): mini.ifc lives OUTSIDE harness/ — parents[2]
from this file, not parents[1].
"""

from __future__ import annotations

import importlib.util
import json
import shutil
import sys
from pathlib import Path

import pytest

pytest.importorskip("ifcopenshell", reason="Extra [ifc] installieren: pip install -e '.[ifc]'")

import ifcopenshell  # noqa: E402
import ifcopenshell.util.element  # noqa: E402  (module level: a function-local
# `import ifcopenshell.…` would shadow the name and break earlier uses)

HARNESS_DIR = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = HARNESS_DIR / "skills" / "ifc" / "scripts"
EFH = HARNESS_DIR / "examples" / "efh-satteldach" / "model" / "efh.ifc"
# mini.ifc sits in the APP repo's e2e fixtures — one level above harness/.
MINI = Path(__file__).resolve().parents[2] / "tests" / "e2e" / "fixtures" / "mini.ifc"


def load_script(name: str):
    """Loads a standalone script from skills/ifc/scripts as a module."""
    spec = importlib.util.spec_from_file_location(name, SCRIPTS_DIR / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


ifc_list = load_script("ifc_list")
ifc_quantities = load_script("ifc_quantities")
ifc_props = load_script("ifc_props")
ifc_classify = load_script("ifc_classify")
ifc_check = load_script("ifc_check")


@pytest.fixture(scope="module")
def efh_copy(tmp_path_factory) -> Path:
    """A writable copy of the example — never touch the checked-in file."""
    out = tmp_path_factory.mktemp("efh") / "efh.ifc"
    shutil.copy(EFH, out)
    return out


@pytest.fixture(scope="module")
def ohne_qto(tmp_path_factory) -> Path:
    """Geometry-fallback fixture (review §4.3): efh.ifc with EVERY quantity
    set removed, so ifc_quantities must fall back to the mesh."""
    out = tmp_path_factory.mktemp("noqto") / "efh_ohne_qto.ifc"
    model = ifcopenshell.open(str(EFH))
    for qto in list(model.by_type("IfcElementQuantity")):
        for rel in list(qto.DefinesOccurrence):
            model.remove(rel)
        model.remove(qto)
    model.write(str(out))
    return out


# --- ifc_list ---------------------------------------------------------------

def test_liste_zaehlt_und_gruppiert(efh_copy):
    result = ifc_list.run(efh_copy, klasse="IfcWall")
    assert "error" not in result, result.get("error")
    json_out = result["json"]
    assert json_out["gesamt"] == 12
    # All walls are SOLIDWALL — one PredefinedType group, not split by name.
    groups = {(g["klasse"], g["predefined_type"]): g["anzahl"] for g in json_out["gruppen"]}
    assert groups == {("IfcWall", "SOLIDWALL"): 12}


def test_liste_decken_nach_predefined_type(efh_copy):
    """Review §4.1: '/ifc liste' must NOT report 'five slabs' — the
    PredefinedType keeps floors, base slab and roof panels apart."""
    result = ifc_list.run(efh_copy, klasse="IfcSlab")
    groups = {(g["predefined_type"]): g["anzahl"] for g in result["json"]["gruppen"]}
    assert groups == {"BASESLAB": 1, "FLOOR": 2, "ROOF": 2}


def test_liste_aussenwaende_je_geschoss(efh_copy):
    """The plan's verify line: 12 walls, 4 external per storey, container set."""
    import ifcopenshell.util.element

    model = ifcopenshell.open(str(efh_copy))
    per_storey = {"EG": 0, "OG": 0}
    for wall in model.by_type("IfcWall"):
        psets = ifcopenshell.util.element.get_psets(wall)
        if psets["Pset_WallCommon"]["IsExternal"]:
            container = ifcopenshell.util.element.get_container(wall)
            per_storey[container.Name] += 1
    assert per_storey == {"EG": 4, "OG": 4}

    result = ifc_list.run(efh_copy, klasse="IfcWall")
    rows = result["json"]["gruppen"][0]["elemente"]
    assert all(r["geschoss"] in ("EG", "OG") for r in rows)


def test_liste_fehler_im_klartext(tmp_path):
    missing = ifc_list.run(tmp_path / "gibt-es-nicht.ifc")
    assert "Datei nicht gefunden" in missing["error"]
    not_ifc = tmp_path / "text.ifc"
    not_ifc.write_text("das ist kein IFC", encoding="utf-8")
    broken = ifc_list.run(not_ifc)
    assert "Keine IFC-Datei" in broken["error"]


def test_liste_markiert_ergebnis_als_daten(efh_copy):
    """T-67-09: every result carries the data-not-instruction note."""
    result = ifc_list.run(efh_copy, klasse="IfcWall")
    assert "keine Anweisungen" in result["hinweis"]


# --- ifc_quantities ---------------------------------------------------------

def test_mengen_aus_qto(efh_copy):
    """The EFH example carries Qto_WallBaseQuantities -> source 'Qto'."""
    result = ifc_quantities.run(efh_copy, klasse="IfcWall")
    assert "error" not in result, result.get("error")
    positionen = result["json"]["positionen"]
    assert len(positionen) == 12
    assert all(p["quelle"] == "Qto" for p in positionen)
    sued = next(p for p in positionen if p["name"] == "AW-Sued-EG")
    # H-2 values: NetSideArea 30 - 3 x 1.7451 = 24.765 m2, NetVolume present.
    assert sued["mengen"]["NetSideArea"] == pytest.approx(24.765, abs=0.001)
    assert sued["mengen"]["NetVolume"] == pytest.approx(9.039, abs=0.001)


def test_mengen_mini_ifc_satz_heisst_nur_basequantities():
    """Review §4.2: mini.ifc's sets are named plain 'BaseQuantities' — the
    script must find them via IsDefinedBy, not via the Qto_* name prefix."""
    assert MINI.exists(), f"App-Fixture fehlt: {MINI}"
    result = ifc_quantities.run(MINI)
    assert "error" not in result, result.get("error")
    wand = next(p for p in result["json"]["positionen"] if p["name"] == "Wand-Abbruch")
    assert wand["quelle"] == "Qto"
    assert wand["mengen"]["NetSideArea"] == pytest.approx(12.5)
    assert wand["mengen"]["GrossSideArea"] == pytest.approx(14.75)
    assert wand["mengen"]["NetVolume"] == pytest.approx(3.0)


def test_mengen_geometrie_fallback(ohne_qto):
    """Review §4.3: purpose-built fixture (all Qto removed) -> source
    'Geometrie [ASSUMED]' when --geometrie is given, 'fehlend' without."""
    ohne = ifc_quantities.run(ohne_qto, klasse="IfcWall")
    assert all(p["quelle"] == "fehlend" for p in ohne["json"]["positionen"])
    assert ohne["json"]["warnungen"], "ohne Geometrie muss eine Warnung stehen"

    mit = ifc_quantities.run(ohne_qto, klasse="IfcWall", geometrie=True)
    positionen = mit["json"]["positionen"]
    assert all(p["quelle"] == "Geometrie [ASSUMED]" for p in positionen)
    # AW-Sued-EG: bbox 10 x 3 x 0.365 -> volume 10.95 m3 (mesh box, [ASSUMED]).
    sued = next(p for p in positionen if p["name"] == "AW-Sued-EG")
    assert sued["mengen"]["NetVolume"] == pytest.approx(10.95, abs=0.05)
    assert sued["mengen"]["NetSideArea"] == pytest.approx(30.0, abs=0.05)


# --- ifc_props (Roundtrip) --------------------------------------------------

def test_roundtrip_set_property(efh_copy, tmp_path):
    """Plan verify: set FireRating F90 -> re-open -> value there, GUID same,
    entity count same, SOURCE untouched (T-67-11)."""
    source_bytes = efh_copy.read_bytes()
    out = tmp_path / "efh_v2.ifc"

    model = ifcopenshell.open(str(efh_copy))
    wall = model.by_type("IfcWall")[0]
    guid = wall.GlobalId
    entities = sum(1 for _ in model)

    result = ifc_props.set_property(efh_copy, guid, "Pset_WallCommon",
                                    "FireRating", "F90", out)
    assert "error" not in result, result.get("error")
    assert efh_copy.read_bytes() == source_bytes, "Quelldatei verändert (T-67-11)"

    reopened = ifcopenshell.open(str(out))
    same = reopened.by_guid(guid)
    assert same.GlobalId == guid
    assert ifcopenshell.util.element.get_psets(same)["Pset_WallCommon"]["FireRating"] == "F90"
    assert sum(1 for _ in reopened) == entities


def test_roundtrip_verweigert_in_place(efh_copy):
    """T-67-11 hard rule: out_path == source must be rejected, not executed."""
    result = ifc_props.set_property(efh_copy, None, "Pset_WallCommon",
                                    "FireRating", "F90", efh_copy)
    assert "T-67-11" in result["error"]


def test_roundtrip_legt_neues_pset_an(efh_copy, tmp_path):
    """A Pset the element does not have yet is created, not crashed on."""
    out = tmp_path / "efh_v3.ifc"
    result = ifc_props.set_property(efh_copy, None, "Pset_WallCommon",
                                    "AcousticRating", "50 dB", out, typ="str")
    assert "error" not in result, result.get("error")
    reopened = ifcopenshell.open(str(out))
    wall = reopened.by_guid(result["json"]["guid"])
    assert ifcopenshell.util.element.get_psets(wall)["Pset_WallCommon"]["AcousticRating"] == "50 dB"


def test_props_default_out_bekommt_versionszaehler(efh_copy, tmp_path, monkeypatch):
    """Without out_path the write goes to <name>_v<n>.ifc next to the source."""
    workdir = tmp_path / "arbeit"
    workdir.mkdir()
    copy = workdir / "efh.ifc"
    shutil.copy(efh_copy, copy)
    first = ifc_props.set_property(copy, None, "Pset_WallCommon", "FireRating", "F90")
    assert "error" not in first, first.get("error")
    assert Path(first["json"]["datei"]).name == "efh_v1.ifc"
    second = ifc_props.set_property(copy, None, "Pset_WallCommon", "FireRating", "F90")
    assert Path(second["json"]["datei"]).name == "efh_v2.ifc"


# --- ifc_classify -----------------------------------------------------------

def test_classify_mini_gelesen_und_mischfall():
    """Review §4.5: mini.ifc is the READ case — 'BUERO', two references on
    Wand-Abbruch (code '10' + codeless 'tragend'), and #33 Wand-ohne-Status
    is the unclassified mixed case -> heuristic [ASSUMED]."""
    result = ifc_classify.run(MINI)
    assert "error" not in result, result.get("error")
    zeilen = result["json"]["zeilen"]
    gelesen = [z for z in zeilen if z["herkunft"] == "gelesen"]
    assert len(gelesen) == 2
    assert all(z["quelle"] == "BUERO" for z in gelesen)
    codes = {z["code"] for z in gelesen}
    assert codes == {"10", ""}
    vorschlag = [z for z in zeilen if z["herkunft"].startswith("heuristik")]
    assert len(vorschlag) == 1 and vorschlag[0]["klasse"] == "IfcWall"
    assert "[ASSUMED]" in result["markdown"]


def test_classify_efh_heuristik(efh_copy):
    """No classification in the example -> every element gets an [ASSUMED]
    proposal; roof panels (IfcSlab/ROOF) must map to the roof KG, not floors."""
    result = ifc_classify.run(efh_copy)
    assert result["json"]["gelesen"] == 0
    assert result["json"]["vorgeschlagen"] > 0
    dach = next(z for z in result["json"]["zeilen"]
                if z["name"] == "Dachfläche" or z["name"].startswith("Dachfläche"))
    assert dach["code"] == "340"
    assert "[ASSUMED]" in result["markdown"]


# --- ifc_check --------------------------------------------------------------

def test_check_efh_pass(efh_copy):
    """The example passes its own rule set — the reference model must be
    clean against the house's own IDS-derived rules (H-6 context)."""
    result = ifc_check.run(efh_copy)
    assert result["json"]["status"] == "pass"
    assert result["json"]["befunde"] == []


def test_check_mini_warn_mit_elementliste():
    """mini.ifc has no Pset_WallCommon at all -> warn, and the finding names
    the elements (plan verify: 'fehlendes Pflicht-Pset -> warn mit Elementliste')."""
    result = ifc_check.run(MINI)
    assert result["json"]["status"] == "warn"
    texte = " ".join(b["text"] for b in result["json"]["befunde"])
    assert "Pset fehlt: Pset_WallCommon" in texte
    elements = {b["element"] for b in result["json"]["befunde"]}
    assert any("Wand-Abbruch" in e for e in elements)
    # Never fail — the honesty convention (pass/warn/offen only).
    assert result["json"]["status"] != "fail"


def test_check_guid_dublette(tmp_path, efh_copy):
    """A duplicated GUID must be reported (warn) — diffs key on GlobalId."""
    model = ifcopenshell.open(str(efh_copy))
    walls = model.by_type("IfcWall")
    walls[1].GlobalId = walls[0].GlobalId
    dup = tmp_path / "dup.ifc"
    model.write(str(dup))
    result = ifc_check.run(dup)
    assert result["json"]["status"] == "warn"
    assert any("doppelte GUID" in b["text"] for b in result["json"]["befunde"])


def test_check_regeln_fehlen_ist_offen(efh_copy, tmp_path):
    """No rule file -> 'offen' finding instead of a silent pass."""
    result = ifc_check.run(efh_copy, regeln=tmp_path / "nix.yaml")
    assert result["json"]["status"] == "offen"
    assert any("Regeldatei nicht gefunden" in b["text"] for b in result["json"]["befunde"])


# --- ifc_diff (Task 3) ------------------------------------------------------

ifc_diff = load_script("ifc_diff")


def _variante_bauen(tmp_path: Path) -> Path:
    """Plan verify: copy of the example with ONE wall removed and ONE pset
    value changed -> expected 0 neu / 1 entfallen / 1 geaendert."""
    variante = tmp_path / "efh_v2.ifc"
    model = ifcopenshell.open(str(EFH))
    walls = [w for w in model.by_type("IfcWall") if w.Name == "IW-Laengs-OG"]
    assert len(walls) == 1
    import ifcopenshell.api.pset as api_pset

    # Remove the interior wall (its pset/qto relations go with the element).
    wall = walls[0]
    for rel in list(wall.IsDefinedBy or ()):
        model.remove(rel)
    for rel in list(wall.ContainedInStructure or ()):
        related = list(rel.RelatedElements)
        related.remove(wall)
        rel.RelatedElements = related
    model.remove(wall)

    # Change one pset value on another wall (FireRating F30 -> F90).
    # NOTE: util.element.get_pset returns the value DICT, not the entity —
    # api.pset.edit_pset needs the entity, so walk IsDefinedBy (0.8.5 pitfall,
    # same as ifc_props._pset_entity).
    target = next(w for w in model.by_type("IfcWall") if w.Name == "AW-Sued-EG")
    pset = next(r.RelatingPropertyDefinition for r in target.IsDefinedBy
                if r.is_a("IfcRelDefinesByProperties")
                and r.RelatingPropertyDefinition.Name == "Pset_WallCommon")
    api_pset.edit_pset(model, pset=pset, properties={"FireRating": "F90"})
    model.write(str(variante))
    return variante


def test_diff_neu_entfallen_geaendert(tmp_path):
    """Plan verify line: 0 neu / 1 entfallen / 1 geaendert."""
    variante = _variante_bauen(tmp_path)
    result = ifc_diff.run(EFH, variante)
    assert "error" not in result, result.get("error")
    json_out = result["json"]
    assert json_out["neu_ids"] == []
    assert len(json_out["entfallen_ids"]) == 1
    assert len(json_out["geaendert"]) == 1
    aenderung = json_out["geaendert"][0]
    assert aenderung["name"] == "AW-Sued-EG"
    assert any("FireRating" in g and "F90" in g for g in aenderung["gruende"])
    # Three tables in the markdown, per plan.
    md = result["markdown"]
    for ueberschrift in ("## Neu", "## Entfallen", "## Geändert"):
        assert ueberschrift in md


def test_diff_unveraendert_ist_leer(tmp_path):
    kopie = tmp_path / "kopie.ifc"
    shutil.copy(EFH, kopie)
    result = ifc_diff.run(EFH, kopie)
    json_out = result["json"]
    assert json_out["neu_ids"] == [] and json_out["entfallen_ids"] == []
    assert json_out["geaendert"] == []


def test_diff_mit_volumen(tmp_path, ohne_qto):
    """--volumen: example vs the no-Qto fixture — same geometry, so no volume
    reason may appear (only the vanished Qto VALUES mark the walls changed)."""
    result = ifc_diff.run(EFH, ohne_qto, volumen=True)
    assert result["json"]["volumen_verglichen"] is True
    for eintrag in result["json"]["geaendert"]:
        assert not any(g.startswith("Volumen") for g in eintrag["gruende"]), eintrag


def test_diff_vergleicht_keine_relationen(tmp_path):
    """Review M-1/§4.6: relation objects are NOT compared — only elements and
    spatial structure. Removing one pset relation must not create 'entfallen'."""
    variante = tmp_path / "weniger_pset.ifc"
    model = ifcopenshell.open(str(EFH))
    wall = next(w for w in model.by_type("IfcWall") if w.Name == "IW-Quer-OG")
    rel = next(r for r in wall.IsDefinedBy
               if r.RelatingPropertyDefinition.Name == "Pset_WallCommon")
    model.remove(rel)
    model.write(str(variante))
    result = ifc_diff.run(EFH, variante)
    json_out = result["json"]
    assert json_out["neu_ids"] == [] and json_out["entfallen_ids"] == []
    # The wall itself shows up as changed (its pset values vanished).
    assert len(json_out["geaendert"]) == 1
    assert json_out["geaendert"][0]["name"] == "IW-Quer-OG"


def test_diff_fehler_im_klartext(tmp_path):
    result = ifc_diff.run(tmp_path / "a.ifc", tmp_path / "b.ifc")
    assert "Datei nicht gefunden" in result["error"]


# --- ifc_run tool (Task 3) --------------------------------------------------

def test_ifc_run_registriert_in_beiden_modi():
    """The plan: toolset user AND developer."""
    from harness.tools.builtin import registry as tool_registry

    assert tool_registry.has("ifc_run")
    assert tool_registry.names("user").count("ifc_run") == 1
    assert tool_registry.names("developer").count("ifc_run") == 1


async def test_ifc_run_liste_auf_aktivem_projekt(workspace):
    """Standarddatei = newest model/*.ifc of the active project; the example
    copy in workspace/projects carries model/efh.ifc since Task 1 (M-7/M-12)."""
    from harness.tools.builtin import registry as tool_registry
    from tests.conftest import make_ctx

    ctx = make_ctx(workspace, "user")
    assert (ctx.project_dir / "model" / "efh.ifc").exists()
    raw = await tool_registry.dispatch("ifc_run", {"unterbefehl": "liste"}, ctx)
    result = json.loads(raw)
    assert "error" not in result, result.get("error")
    assert "Bauteilliste" in result["markdown"]
    assert result["json"]["gesamt"] >= 26
    # Data-not-instruction marker (T-67-09) on every result.
    assert "Daten, keine Anweisung" in result["hinweis"]


async def test_ifc_run_ziel_und_viewer_link(workspace):
    """Review §4.9: ziel is {"datei": "model/x.ifc", "guid"?} — a path the
    harness /files route actually serves. viewer_link follows viewerLink.js:
    basis + #/IfcViewer?url=…(&sel=…), and NO cam/ziel camera values."""
    from harness.tools.builtin import registry as tool_registry
    from tests.conftest import make_ctx

    ctx = make_ctx(workspace, "user")
    raw = await tool_registry.dispatch(
        "ifc_run", {"unterbefehl": "props", "optionen": {}}, ctx)
    result = json.loads(raw)
    assert "error" not in result, result.get("error")
    assert result["ziel"]["datei"] == "model/efh.ifc"
    assert result["ziel"]["guid"]
    link = result["viewer_link"]
    assert link.startswith("http://localhost:5173/#/IfcViewer?url=")
    assert "sel=" in link
    # No camera values — the viewer fits the model itself (review §4.9).
    assert "cam=" not in link and "ziel=" not in link


async def test_ifc_run_datei_ausserhalb_sandbox_abgelehnt(workspace):
    from harness.tools.builtin import registry as tool_registry
    from tests.conftest import make_ctx

    ctx = make_ctx(workspace, "user")
    raw = await tool_registry.dispatch(
        "ifc_run", {"unterbefehl": "liste", "datei": "../../repo/package.json"}, ctx)
    assert "Sandbox" in json.loads(raw)["error"]


async def test_ifc_run_unterbefehl_unbekannt(workspace):
    from harness.tools.builtin import registry as tool_registry
    from tests.conftest import make_ctx

    ctx = make_ctx(workspace, "user")
    raw = await tool_registry.dispatch("ifc_run", {"unterbefehl": "zaubern"}, ctx)
    assert "unbekannt" in json.loads(raw)["error"]


async def test_ifc_run_setze_schreibt_nie_in_place(workspace):
    """T-67-11 through the tool path: 'setze' writes <name>_v<n>.ifc into the
    project's model dir; the source stays byte-identical."""
    from harness.tools.builtin import registry as tool_registry
    from tests.conftest import make_ctx

    ctx = make_ctx(workspace, "user")
    quelle = ctx.project_dir / "model" / "efh.ifc"
    before = quelle.read_bytes()
    raw = await tool_registry.dispatch("ifc_run", {
        "unterbefehl": "setze",
        "optionen": {"pset": "Pset_WallCommon", "eigenschaft": "FireRating",
                     "wert": "F90"}}, ctx)
    result = json.loads(raw)
    assert "error" not in result, result.get("error")
    assert quelle.read_bytes() == before
    neu = ctx.project_dir / "model" / "efh_v1.ifc"
    assert neu.exists()
    assert Path(result["json"]["datei"]).name == "efh_v1.ifc"


async def test_ifc_run_diff_ueber_das_tool(workspace):
    from harness.tools.builtin import registry as tool_registry
    from tests.conftest import make_ctx

    ctx = make_ctx(workspace, "user")
    variante = _variante_bauen(Path(ctx.project_dir))
    shutil.copy(variante, ctx.project_dir / "model" / "efh_v2.ifc")
    # datei explicit: the DEFAULT is the newest model/*.ifc — that is now the
    # variant itself, so the comparison must name the old file.
    raw = await tool_registry.dispatch("ifc_run", {
        "unterbefehl": "diff",
        "datei": "model/efh.ifc",
        "datei2": "model/efh_v2.ifc"}, ctx)
    result = json.loads(raw)
    assert "error" not in result, result.get("error")
    assert len(result["json"]["entfallen_ids"]) == 1
    assert len(result["json"]["geaendert"]) == 1
