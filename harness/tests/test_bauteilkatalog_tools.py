"""109-02: the component catalogue as harness tools (bauteilkatalog_*) and the /bauteilkatalog skill.

Covers: registration in both modes, the skill index, reading (list filters, one type in detail with layers,
U-value per DIN EN ISO 6946 and versions; materials), building a wall with a window into a NEW file under
model/ (valid with WHERE rules, typed, neutral, viewer target, never overwrites), stud wall with
reinforcement, wrong input with German messages, editing → runtime type in the project (base stock bytes
unchanged, a second edit of a runtime type → version 2, the edited type can be built), the libraries, the
check report with the catalogue types used, the sandbox (no write outside the project), and an offline
agent turn whose scripted provider calls bauteilkatalog_bauen through run_turn.

Skips only without the [katalog] extra (conftest prints a loud banner then).
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, AsyncIterator

import pytest

pytest.importorskip("elmonkey.katalog", reason="Extra [katalog] installieren: pip install -e '.[dev,ifc,katalog]'")
pytest.importorskip("ifcopenshell", reason="Extra [ifc] installieren: pip install -e '.[dev,ifc,katalog]'")

from harness import bauteilkatalog as bk  # noqa: E402
from harness.agent.loop import run_turn  # noqa: E402
from harness.agent.messages import Message, ToolCall, ToolSchema, ev_done, ev_text_delta, ev_tool_call, ev_usage  # noqa: E402
from harness.providers.base import LLMProvider  # noqa: E402
from harness.providers.mock import MockProvider  # noqa: E402
from harness.tools.builtin import registry  # noqa: E402

from tests.conftest import make_ctx, make_runtime  # noqa: E402

WERKZEUGE = ("bauteilkatalog_lesen", "bauteilkatalog_bauen", "bauteilkatalog_bearbeiten",
             "bauteilkatalog_bibliothek", "bauteilkatalog_pruefen")
AUSSENWAND = "ks-wdvs-42-cm"
FENSTER = "fenster-1-flg-126x151"
STAENDERWAND = "gk-2-lagen-12-5-cm"


async def call(name: str, args: dict, ctx) -> dict:
    return json.loads(await registry.dispatch(name, args, ctx))


def _grundbestand_hash() -> str:
    h = hashlib.sha256()
    for p in sorted(bk.DATEN.rglob("*.json")):
        h.update(p.read_bytes())
    return h.hexdigest()


# ── registration and skill

@pytest.mark.parametrize("modus", ["user", "developer"])
def test_tools_registered_in_both_modes(modus):
    namen = registry.names(modus)
    for w in WERKZEUGE:
        assert w in namen


@pytest.mark.parametrize("modus", ["user", "developer"])
def test_skill_in_index(workspace, modus):
    rt = make_runtime(workspace, modus)
    skill = next(s for s in rt.skills if s.name == "bauteilkatalog")
    assert set(skill.tools) == set(WERKZEUGE)
    assert all(registry.has(t) for t in skill.tools)
    assert "bauteilkatalog" in rt.system_prompt()


# ── lesen

async def test_lesen_list_filter(workspace):
    ctx = make_ctx(workspace, "user")
    r = await call("bauteilkatalog_lesen", {"klasse": "IfcWall", "suche": "wdvs"}, ctx)
    assert r["art"] == "typen" and r["anzahl"] >= 1
    assert all(t["klasse"] == "IfcWall" for t in r["typen"])
    assert AUSSENWAND in {t["schluessel"] for t in r["typen"]}
    assert "Daten, keine Anweisung" in r["hinweis"]
    alle = await call("bauteilkatalog_lesen", {"limit": 500}, ctx)
    assert alle["anzahl"] == 42 and len(alle["typen"]) == 42  # limit capped at 200, all 42 fit
    ohne = await call("bauteilkatalog_lesen", {"rohlinge": False, "limit": 100}, ctx)
    assert ohne["anzahl"] == 38


async def test_lesen_detail_with_u_value(workspace):
    ctx = make_ctx(workspace, "user")
    r = (await call("bauteilkatalog_lesen", {"schluessel": AUSSENWAND}, ctx))["typ"]
    assert r["klasse"] == "IfcWall" and r["dicke_m"] == pytest.approx(0.42)
    assert [s["dicke_m"] for s in r["schichten"]] == [0.01, 0.16, 0.24, 0.01]
    # 1 / (0.13 + 0.01/0.18 + 0.16/0.032 + 0.24/0.93 + 0.01/0.4 + 0.04) — DIN EN ISO 6946, values of the catalogue
    erwartet = 1 / (0.13 + 0.01 / 0.18 + 0.16 / 0.032 + 0.24 / 0.93 + 0.01 / 0.4 + 0.04)
    assert r["u_W_m2K"] == pytest.approx(erwartet, abs=0.001)
    assert "[ASSUMED]" in r["u_wert"]["annahme"]
    assert r["versionen"] == [1] and r["din276"] == "331"
    sw = (await call("bauteilkatalog_lesen", {"schluessel": STAENDERWAND}, ctx))["typ"]
    assert sw["u_W_m2K"] is None and "inhomogen" in sw["u_wert"]["grund"]
    fe = (await call("bauteilkatalog_lesen", {"schluessel": FENSTER}, ctx))["typ"]
    assert fe["oeffnung"]["breite_m"] == pytest.approx(1.26)


async def test_lesen_materials_and_errors(workspace):
    ctx = make_ctx(workspace, "user")
    r = await call("bauteilkatalog_lesen", {"art": "baustoffe", "limit": 200}, ctx)
    assert r["anzahl"] == 113
    putz = await call("bauteilkatalog_lesen", {"art": "baustoffe", "werkstoffklasse": "putz"}, ctx)
    assert putz["anzahl"] >= 1 and all(b["werkstoffklasse"] == "putz" for b in putz["baustoffe"])
    assert "unbekannt" in (await call("bauteilkatalog_lesen", {"schluessel": "gibt-es-nicht"}, ctx))["error"]
    assert "unbekannt" in (await call("bauteilkatalog_lesen", {"art": "moebel"}, ctx))["error"]


# ── bauen

async def test_bauen_wall_with_window(workspace):
    ctx = make_ctx(workspace, "user")
    args = {"typ": AUSSENWAND, "von": [0, 0], "bis": [6, 0], "hoehe_m": 2.75,
            "oeffnungen": [{"typ": FENSTER, "abstand_m": 1.5, "bruestung_m": 0.9}]}
    r = await call("bauteilkatalog_bauen", args, ctx)
    assert "error" not in r, r
    assert r["datei"] == f"model/katalog-{AUSSENWAND}.ifc"
    pfad = workspace["project_dir"] / r["datei"]
    assert pfad.is_file() and r["bytes"] == pfad.stat().st_size
    p = r["pruefung"]
    assert p["gueltig"] and p["anzahl_fehler"] == 0 and p["proxys"] == 0 and p["ohne_typ"] == [] and p["neutral"]
    assert r["laenge_m"] == pytest.approx(6.0)
    assert r["zaehler"]["IfcWall"] == 1 and r["zaehler"]["IfcWindow"] == 1
    assert r["ziel"] == {"datei": f"model/katalog-{AUSSENWAND}.ifc"} and "IfcViewer" in r["viewer_link"]
    # second call: same name taken → _v2, the first file stays byte-identical
    vorher = pfad.read_bytes()
    r2 = await call("bauteilkatalog_bauen", args, ctx)
    assert r2["datei"] == f"model/katalog-{AUSSENWAND}_v2.ifc"
    assert pfad.read_bytes() == vorher
    # the check tool sees the catalogue types used
    pr = await call("bauteilkatalog_pruefen", {"datei": r["datei"]}, ctx)
    typen = {(t["schluessel"], t["version"]): t for t in pr["katalogtypen"]}
    assert typen[(AUSSENWAND, 1)]["bauteile"] == 1 and typen[(AUSSENWAND, 1)]["im_katalog"]
    assert typen[(FENSTER, 1)]["bauteile"] == 1


async def test_bauen_stud_wall_and_ifc4x3(workspace):
    ctx = make_ctx(workspace, "user")
    r = await call("bauteilkatalog_bauen", {
        "typ": STAENDERWAND, "bis": [0, 3], "hoehe_m": 2.6, "schema": "IFC4X3",
        "verstaerkungen": [{"art": "stuetzklappgriff-din18040", "abstand_m": 1.0, "hoehe_m": 0.85}]}, ctx)
    assert "error" not in r, r
    assert r["pruefung"]["gueltig"] and r["pruefung"]["neutral"]
    assert r["zaehler"]["IfcMember"] > 0 and r["zaehler"]["IfcPlate"] > 0
    assert r["winkel_grad"] == pytest.approx(90.0)
    import ifcopenshell
    assert ifcopenshell.open(str(workspace["project_dir"] / r["datei"])).schema.startswith("IFC4X3")


async def test_bauen_errors(workspace):
    ctx = make_ctx(workspace, "user")
    assert "braucht" in (await call("bauteilkatalog_bauen", {"typ": AUSSENWAND}, ctx))["error"]
    kein = await call("bauteilkatalog_bauen", {"typ": "rohdecke-stb-20-cm", "bis": [5, 0], "hoehe_m": 2.5}, ctx)
    assert "kein Wandtyp" in kein["error"]
    passt = await call("bauteilkatalog_bauen", {"typ": AUSSENWAND, "bis": [1, 0], "hoehe_m": 2.5,
                                                "oeffnungen": [{"typ": FENSTER, "abstand_m": 0.5}]}, ctx)
    assert "passt nicht" in passt["error"]
    kurz = await call("bauteilkatalog_bauen", {"typ": AUSSENWAND, "bis": [0.01, 0], "hoehe_m": 2.5}, ctx)
    assert "zu dicht" in kurz["error"]
    endung = await call("bauteilkatalog_bauen", {"typ": AUSSENWAND, "bis": [3, 0], "hoehe_m": 2.5,
                                                 "datei": "model/wand.txt"}, ctx)
    assert ".ifc" in endung["error"]


async def test_bauen_outside_sandbox_refused(workspace, tmp_path):
    ctx = make_ctx(workspace, "user")
    draussen = tmp_path / "draussen" / "wand.ifc"
    r = await call("bauteilkatalog_bauen", {"typ": AUSSENWAND, "bis": [3, 0], "hoehe_m": 2.5,
                                            "datei": str(draussen)}, ctx)
    assert "außerhalb der Sandbox" in r["error"]
    assert not draussen.exists()


async def test_writing_needs_a_project(workspace):
    ctx = make_ctx(workspace, "developer")
    ctx.project_dir = None
    r = await call("bauteilkatalog_bibliothek", {"art": "material"}, ctx)
    assert "Kein aktives Projekt" in r["error"]
    # reading still works on the base stock
    assert (await call("bauteilkatalog_lesen", {"schluessel": AUSSENWAND}, ctx))["typ"]["ebene"] == "grundbestand"


# ── bearbeiten

async def test_bearbeiten_runtime_type_and_version(workspace):
    ctx = make_ctx(workspace, "user")
    vorher = _grundbestand_hash()
    r = await call("bauteilkatalog_bearbeiten", {"typ": AUSSENWAND, "operationen": [
        {"op": "schicht_aendern", "position": 2, "dicke_m": 0.20}]}, ctx)
    assert r["neu"] is True and r["grund"] == "neuer Typ aus dem Grundbestand", r
    neu = r["typ"]["schluessel"]
    assert neu.startswith(AUSSENWAND + "-") and r["typ"]["ebene"] == "laufzeit"
    assert r["typ"]["dicke_m"] == pytest.approx(0.46) and r["typ"]["basiert_auf"] == f"{AUSSENWAND}@1"
    assert r["typ"]["u_W_m2K"] < 0.182  # thicker insulation → lower U
    assert r["datei"] == f"bauteilkatalog/typen/{neu}.json"
    assert _grundbestand_hash() == vorher
    gespeichert = json.loads((workspace["project_dir"] / r["datei"]).read_text(encoding="utf-8"))
    assert gespeichert["typen"][0]["aenderung"]["autor"] == "Harness-Agent"
    # editing the runtime type → version 2 of the same key
    r2 = await call("bauteilkatalog_bearbeiten", {"typ": neu, "operationen": [
        {"op": "eigenschaft_setzen", "feld": "FireRating", "wert": "F90"}]}, ctx)
    assert r2["neu"] and r2["referenz"] == f"{neu}@2" and r2["typ"]["versionen"] == [1, 2]
    # no change → nothing new
    r3 = await call("bauteilkatalog_bearbeiten", {"typ": f"{neu}@2", "operationen": [
        {"op": "schicht_aendern", "position": 2, "dicke_m": 0.20}]}, ctx)
    assert r3["neu"] is False and "datei" not in r3
    # the list shows the runtime type, building with it works
    lauf = await call("bauteilkatalog_lesen", {"ebene": "laufzeit"}, ctx)
    assert [t["schluessel"] for t in lauf["typen"]] == [neu]
    b = await call("bauteilkatalog_bauen", {"typ": f"{neu}@1", "bis": [4, 0], "hoehe_m": 2.75}, ctx)
    assert b["pruefung"]["gueltig"] and b["pruefung"]["neutral"]


async def test_bearbeiten_errors(workspace):
    ctx = make_ctx(workspace, "user")
    assert "operationen" in (await call("bauteilkatalog_bearbeiten", {"typ": AUSSENWAND}, ctx))["error"]
    r = await call("bauteilkatalog_bearbeiten", {"typ": AUSSENWAND, "operationen": [{"op": "zaubern"}]}, ctx)
    assert "unbekannt" in r["error"]
    r = await call("bauteilkatalog_bearbeiten", {"typ": AUSSENWAND, "operationen": [
        {"op": "schicht_aendern", "position": 9, "dicke_m": 0.1}]}, ctx)
    assert "außerhalb" in r["error"]
    assert not (workspace["project_dir"] / "bauteilkatalog").exists()


# ── bibliothek and pruefen

async def test_bibliothek_types_include_runtime_type(workspace):
    ctx = make_ctx(workspace, "user")
    await call("bauteilkatalog_bearbeiten", {"typ": AUSSENWAND, "operationen": [
        {"op": "schicht_aendern", "position": 2, "dicke_m": 0.20}]}, ctx)
    r = await call("bauteilkatalog_bibliothek", {"art": "typen"}, ctx)
    assert r["datei"] == "bauteilkatalog/ifc/bit-atelier-bauteiltypen-ifc4.ifc", r
    p = r["pruefung"]
    assert p["gueltig"] and p["typen"] == 43 and p["materialien"] == 113 and p["neutral"]


async def test_bibliothek_material_and_sample(workspace):
    ctx = make_ctx(workspace, "user")
    m = await call("bauteilkatalog_bibliothek", {"art": "material", "schema": "IFC4X3"}, ctx)
    assert m["pruefung"]["gueltig"] and m["pruefung"]["materialien"] == 113
    mu = await call("bauteilkatalog_bibliothek", {"art": "muster", "staenderwand_als": "schichten"}, ctx)
    assert mu["datei"].endswith("muster-staenderwand-als-schichten-ifc4.ifc")
    assert mu["pruefung"]["gueltig"] and mu["pruefung"]["proxys"] == 0 and mu["pruefung"]["ohne_typ"] == []
    assert "unbekannt" in (await call("bauteilkatalog_bibliothek", {"art": "moebel"}, ctx))["error"]
    assert "schema" in (await call("bauteilkatalog_bibliothek", {"art": "material", "schema": "IFC2X3"}, ctx))["error"]


async def test_pruefen_default_newest_model_and_foreign_file(workspace):
    ctx = make_ctx(workspace, "user")
    # the example project's own model has no catalogue types: report, no error
    r = await call("bauteilkatalog_pruefen", {"regeln": False}, ctx)
    assert r["datei"].startswith("model/") and r["katalogtypen"] == [] and r["mit_regeln"] is False
    kaputt = workspace["project_dir"] / "model" / "kaputt.ifc"
    kaputt.write_text("kein ifc", encoding="utf-8")
    assert "nicht lesbar" in (await call("bauteilkatalog_pruefen", {"datei": "model/kaputt.ifc"}, ctx))["error"]


# ── offline agent turn: the model calls bauteilkatalog_bauen

class _BaueWand(LLMProvider):
    """Scripted offline provider: first answer = one bauteilkatalog_bauen call, then a closing sentence."""

    def __init__(self) -> None:
        super().__init__(MockProvider().profile)
        self.calls = 0

    async def chat(self, messages: list[Message], tools: list[ToolSchema], *, model: str,
                   stream: bool = True, max_tokens: int = 4096) -> AsyncIterator[dict[str, Any]]:
        self.calls += 1
        if messages[-1].role != "tool":
            assert "bauteilkatalog_bauen" in {t.name for t in tools}
            yield ev_tool_call(ToolCall(id="kat-1", name="bauteilkatalog_bauen", arguments={
                "typ": AUSSENWAND, "von": [0, 0], "bis": [5, 0], "hoehe_m": 2.75}))
            yield ev_usage(10, 10)
            yield ev_done("tool_use")
            return
        yield ev_text_delta("Wand gebaut.")
        yield ev_usage(10, 3)
        yield ev_done("end_turn")


async def test_agent_turn_builds_valid_ifc(workspace):
    rt = make_runtime(workspace, "user")
    session = rt.build_session()
    ctx = make_ctx(workspace, "user")
    events = [e async for e in run_turn(session, _BaueWand(), registry, ctx, "Bau mir eine Außenwand 5 m")]
    ergebnis = json.loads(next(e for e in events if e["type"] == "tool_result")["result"])
    assert "error" not in ergebnis, ergebnis
    assert ergebnis["pruefung"]["gueltig"] and ergebnis["pruefung"]["neutral"]
    assert (workspace["project_dir"] / ergebnis["datei"]).is_file()
    assert events[-1]["type"] == "done"


# ── review fixes 109-02

async def test_bauen_subfolder_has_no_viewer_target(workspace):
    ctx = make_ctx(workspace, "user")
    r = await call("bauteilkatalog_bauen", {"typ": AUSSENWAND, "bis": [3, 0], "hoehe_m": 2.5,
                                            "datei": "model/varianten/wand.ifc"}, ctx)
    assert r["datei"] == "model/varianten/wand.ifc" and "ziel" not in r and "viewer_link" not in r


async def test_writes_stay_in_project(workspace):
    ctx = make_ctx(workspace, "developer")  # sandbox = project + repo
    r = await call("bauteilkatalog_bauen", {"typ": AUSSENWAND, "bis": [3, 0], "hoehe_m": 2.5,
                                            "datei": str(workspace["repo"] / "wand.ifc")}, ctx)
    assert "im aktiven Projekt" in r["error"] and not (workspace["repo"] / "wand.ifc").exists()
    r = await call("bauteilkatalog_bibliothek", {"art": "material", "datei": "../../draussen.ifc"}, ctx)
    assert "error" in r and not (workspace["tmp"] / "draussen.ifc").exists()


async def test_wrong_number_types_give_german_messages(workspace):
    ctx = make_ctx(workspace, "user")
    r = await call("bauteilkatalog_bauen", {"typ": AUSSENWAND, "bis": [3, 0], "hoehe_m": [2]}, ctx)
    assert r["error"].startswith("hoehe_m: Zahl (Meter) erwartet")
    r = await call("bauteilkatalog_bauen", {"typ": AUSSENWAND, "bis": [3, 0], "hoehe_m": 2.5,
                                            "oeffnungen": [{"typ": FENSTER, "abstand_m": "links"}]}, ctx)
    assert "oeffnungen[1].abstand_m" in r["error"]
    r = await call("bauteilkatalog_bearbeiten", {"typ": AUSSENWAND, "operationen": [
        {"op": "schicht_aendern", "position": 1, "dicke_m": None}]}, ctx)
    assert "error" in r and not r["error"].startswith("bauteilkatalog_bearbeiten: TypeError")


async def test_parallel_builds_never_share_a_file(workspace):
    import asyncio
    ctx = make_ctx(workspace, "user")
    args = {"typ": AUSSENWAND, "bis": [3, 0], "hoehe_m": 2.5}
    rs = await asyncio.gather(*(call("bauteilkatalog_bauen", dict(args), ctx) for _ in range(3)))
    assert len({r["datei"] for r in rs}) == 3


async def test_string_booleans_and_unknown_exposition(workspace):
    ctx = make_ctx(workspace, "user")
    r = await call("bauteilkatalog_lesen", {"rohlinge": "false", "limit": 100}, ctx)
    assert r["anzahl"] == 38
    k = bk.katalog()
    ohne = next(t for t in k.typen.values() if t["ifc"]["klasse"] == "IfcWall" and not t.get("rohling")
                and "IsExternal" not in (t.get("pset_common") or {}) and bk.u_wert(t, k)["u_W_m2K"])
    assert "Lage unbekannt" in bk.u_wert(ohne, k)["annahme"]
