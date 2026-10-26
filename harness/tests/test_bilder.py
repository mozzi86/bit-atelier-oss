"""106-06: images of the view as context - checks, image blocks of the providers, the WebSocket road with the project check of the app."""

import base64
import json
import struct
import zlib
from dataclasses import replace

import httpx
import pytest
from fastapi.testclient import TestClient

from harness.agent.messages import Message, ev_done, ev_text_delta, ev_usage
from harness.bilder import (
    BILD_KANTE_MAX, BildFehler, bild_erlaubt, bilder_pruefen, freigabe_ueber_app, kann_bilder, katalog_vision,
)
from harness.config import HARNESS_DIR
from harness.providers.anthropic import to_anthropic_payload
from harness.providers.base import LLMProvider, ProviderProfile
from harness.providers.mock import MOCK_PROFILE
from harness.providers.openai_compat import to_openai_payload
from harness.server import create_app
from tests.conftest import make_runtime


def png(w: int = 4, h: int = 3) -> str:
    """A real PNG of w x h px (grey), base64 without prefix."""
    def chunk(t: bytes, d: bytes) -> bytes:
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    roh = b"".join(b"\x00" + b"\x80" * w for _ in range(h))
    data = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 0, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(roh)) + chunk(b"IEND", b"")
    return base64.b64encode(data).decode()


def prof(name: str = "p", api_mode: str = "openai_compat", base_url: str | None = "https://api.example.com/v1", **quirks) -> ProviderProfile:
    return ProviderProfile(name=name, api_mode=api_mode, base_url=base_url, quirks=quirks)


# --- checks ------------------------------------------------------------------------------------------------

def test_bilder_pruefen_accepts_a_png_and_refuses_what_is_not_one():
    assert bilder_pruefen(None) == []
    b = png()
    assert bilder_pruefen([{"png_base64": b}]) == [b]
    assert bilder_pruefen([{"png_base64": "data:image/png;base64," + b}]) == [b]
    for roh, wort in (
        ("x", "Liste"),
        ([{"png_base64": ""}], "fehlt"),
        ([{"png_base64": "%%%"}], "base64"),
        ([{"png_base64": base64.b64encode(b"GIF89a-not-a-png-at-all-xxxxxx").decode()}], "kein PNG"),
        ([{"png_base64": png(BILD_KANTE_MAX + 1, 10)}], "1280"),
        ([{"png_base64": b}] * 3, "Höchstens"),
    ):
        with pytest.raises(BildFehler, match=wort):
            bilder_pruefen(roh)


def test_kann_bilder_quirk_catalog_patterns_unknown_is_no():
    assert kann_bilder(prof(vision=True), "irgendwas") is True
    assert kann_bilder(prof(vision=False), "claude-sonnet-5-5") is False
    assert kann_bilder(prof(vision=["mein-vl"]), "mein-vl") is True
    assert kann_bilder(prof(vision=["mein-vl"]), "anderes") is False
    kat = katalog_vision(HARNESS_DIR.parent)
    assert kat, "the harness reads the app's catalog in the repository"
    assert kann_bilder(prof(), "gemma4:12b", katalog=kat) is True
    assert kann_bilder(prof(), "qwen3.6:27b", katalog=kat) is False, "catalog: no vision"
    assert kann_bilder(prof(), "llama3.2:3b", katalog=kat) is False
    assert kann_bilder(prof(), "claude-sonnet-5-5") is True
    assert kann_bilder(prof(), "openai/gpt-4o-mini") is True, "id after the last slash"
    assert kann_bilder(prof(), "deepseek-v4-pro") is False, "unknown = no image"
    assert kann_bilder(prof(), "") is False
    assert kann_bilder(MOCK_PROFILE, "mock-1") is False


def test_kann_bilder_patterns_exclude_text_only_members():
    """Review fix 106-06: same cases as llmBild-10606.test.js - the text-only members of a family get no image."""
    for m in ["o3-mini", "gemma3:1b", "gemma3:270m", "claude-2.1", "claude-instant-1.2", "gpt-4o-audio-preview", "gemini-embedding-001"]:
        assert kann_bilder(prof(), m) is False, m
    for m in ["o3", "gemma3:4b", "gemma3n:e4b", "google/gemma-4-12b", "claude-3-5-sonnet-20241022", "gpt-4o-mini", "gemini-2.5-pro"]:
        assert kann_bilder(prof(), m) is True, m


# --- image blocks ------------------------------------------------------------------------------------------

def test_providers_put_the_image_into_the_user_turn_and_text_only_stays_as_it_was():
    b = png()
    msgs = [Message("system", "S"), Message("user", "Was ist links?", bilder=[b])]
    a = to_anthropic_payload(msgs, [], model="m", max_tokens=10, stream=True)
    inhalt = a["messages"][0]["content"]
    assert inhalt[0] == {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": b}}
    assert inhalt[-1] == {"type": "text", "text": "Was ist links?"}
    o = to_openai_payload(msgs, [], model="m", max_tokens=10, stream=True)
    teile = o["messages"][1]["content"]
    assert teile[0] == {"type": "text", "text": "Was ist links?"}
    assert teile[1] == {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b}"}}
    # without images the payload is byte-identical to before
    nur_text = [Message("system", "S"), Message("user", "hallo")]
    assert to_anthropic_payload(nur_text, [], model="m", max_tokens=10, stream=True)["messages"][0]["content"] == "hallo"
    assert to_openai_payload(nur_text, [], model="m", max_tokens=10, stream=True)["messages"][1] == {"role": "user", "content": "hallo"}
    # logs and saved transcripts never carry the image itself
    d = Message("user", "x", bilder=[b]).to_dict()
    assert d["bilder_anzahl"] == 1 and b not in json.dumps(d)


# --- the project check of the app --------------------------------------------------------------------------

async def test_freigabe_ueber_app_asks_the_store_and_fails_closed():
    gesehen = []

    def handler(req: httpx.Request) -> httpx.Response:
        gesehen.append(dict(req.url.params))
        return httpx.Response(200, json={"ok": False, "grund": "nda", "text": "NDA-Projekt: es geht nie ein Bild"})

    f = freigabe_ueber_app("http://app/api", transport=httpx.MockTransport(handler))
    r = await f("P1", False, "cloud", "api.example.com")
    assert r["grund"] == "nda"
    assert gesehen[0] == {"projekt_id": "P1", "ziel": "extern", "anbieter": "cloud", "host": "api.example.com"}

    def kaputt(req: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("weg")

    r = await freigabe_ueber_app("http://app/api", transport=httpx.MockTransport(kaputt))("P1", True, "lokal", "")
    assert r["ok"] is False and "antwortet nicht" in r["text"]


async def test_bild_erlaubt_order_project_rules_then_model_then_consent():
    """Same order as the app (bildKontext.js): NDA and the other final refusals first, then vision, then the consent question."""
    aufrufe = []

    async def ja(pid, lokal, anbieter, host):
        aufrufe.append((pid, lokal, anbieter, host))
        return {"ok": True}

    async def nda(*_a):
        return {"ok": False, "grund": "nda", "text": "NDA-Projekt: es geht nie ein Bild der Ansicht an ein Sprachmodell"}

    async def zustimmung(*_a):
        return {"ok": False, "grund": "zustimmung", "text": "dafür braucht es einmal je Projekt Ihre Zustimmung"}

    b = png()
    assert await bild_erlaubt(None, "P1", prof(vision=True), "x", freigabe=ja) == []
    with pytest.raises(BildFehler, match="keine Bilder"):
        await bild_erlaubt([{"png_base64": b}], "P1", prof(), "deepseek-v4-pro", freigabe=ja)
    with pytest.raises(BildFehler, match="NDA-Projekt"):
        await bild_erlaubt([{"png_base64": b}], "P1", prof(), "deepseek-v4-pro", freigabe=nda)
    with pytest.raises(BildFehler, match="keine Bilder"):
        # nobody is asked to consent for a model that could not read the image anyway
        await bild_erlaubt([{"png_base64": b}], "P1", prof(), "deepseek-v4-pro", freigabe=zustimmung)
    with pytest.raises(BildFehler, match="Zustimmung"):
        await bild_erlaubt([{"png_base64": b}], "P1", prof(vision=True), "x", freigabe=zustimmung)
    aufrufe.clear()
    with pytest.raises(BildFehler, match="Ohne geöffnetes Projekt"):
        await bild_erlaubt([{"png_base64": b}], "", prof(vision=True), "x", freigabe=ja)
    assert await bild_erlaubt([{"png_base64": b}], "P1", prof(vision=True), "x", freigabe=ja) == [b]
    assert aufrufe[-1] == ("P1", False, "p", "api.example.com"), "a cloud profile asks for ziel=extern with its host"
    lokal = prof(base_url="http://127.0.0.1:11434/v1", vision=True)
    await bild_erlaubt([{"png_base64": b}], "P1", lokal, "x", freigabe=ja)
    assert aufrufe[-1][1] is True


# --- the WebSocket road ------------------------------------------------------------------------------------

class SiehtProvider(LLMProvider):
    """Records the user messages it gets (with their images)."""

    def __init__(self, profile):
        super().__init__(profile)
        self.nutzer: list[Message] = []
        #: per provider call: how many images the WHOLE history it got carries
        self.alle_bilder: list[int] = []

    async def chat(self, messages, tools, *, model, stream=True, max_tokens=4096):
        # a copy: the loop removes the images from the history after the turn (review fix 106-06)
        letzte = next(m for m in reversed(messages) if m.role == "user")
        self.nutzer.append(replace(letzte, bilder=list(letzte.bilder)))
        self.alle_bilder.append(sum(len(m.bilder) for m in messages))
        yield ev_text_delta("Links steht eine Wand.")
        yield ev_usage(1, 1)
        yield ev_done("end_turn")


def _bis_ende(ws):
    out = []
    while True:
        e = ws.receive_json()
        out.append(e)
        if e["type"] in ("done", "error"):
            return out


def _runtime(workspace, vision: bool):
    rt = make_runtime(workspace, "user")
    rt.providers.replace(replace(MOCK_PROFILE, quirks={"vision": vision}))
    prov = SiehtProvider(rt.profile)
    rt.make_provider = lambda: prov  # type: ignore[method-assign]
    return rt, prov


def test_ws_image_reaches_the_model_only_after_the_apps_project_check(workspace):
    rt, prov = _runtime(workspace, vision=True)
    antworten = {"P-OK": {"ok": True}, "P-NDA": {"ok": False, "grund": "nda", "text": "NDA-Projekt: es geht nie ein Bild der Ansicht an ein Sprachmodell"}}
    gefragt = []

    async def freigabe(pid, lokal, anbieter, host):
        gefragt.append((pid, lokal))
        return antworten.get(pid, {"ok": False, "text": "?"})

    b = png()
    with TestClient(create_app(rt, bild_freigabe=freigabe)) as client:
        d = client.get("/status").json()
        assert d["bilder"] is True and "provider_ziel" in d
        with client.websocket_connect("/ws/chat") as ws:
            assert ws.receive_json()["type"] == "hello"
            ws.send_json({"type": "user", "text": "was ist links?", "bilder": [{"png_base64": b}], "projekt_id": "P-OK"})
            ev = _bis_ende(ws)
            assert ev[-1]["type"] == "done"
            ws.send_json({"type": "user", "text": "und jetzt?", "bilder": [{"png_base64": b}], "projekt_id": "P-NDA"})
            ev = _bis_ende(ws)
            assert ev[-1]["type"] == "error" and "NDA" in ev[-1]["message"]
            ws.send_json({"type": "user", "text": "ohne Bild"})
            assert _bis_ende(ws)[-1]["type"] == "done"
    assert prov.nutzer[0].bilder == [b], "the image travels with the user message"
    assert len(prov.nutzer) == 2, "the NDA project's turn never reached the model"
    assert prov.nutzer[1].content == "ohne Bild" and prov.nutzer[1].bilder == []
    assert gefragt == [("P-OK", True), ("P-NDA", True)], "the mock profile is on this computer: ziel=lokal"


def test_ws_model_without_images_is_a_sentence_not_a_silent_drop(workspace):
    rt, prov = _runtime(workspace, vision=False)

    async def frei(*_a):
        return {"ok": True}

    with TestClient(create_app(rt, bild_freigabe=frei)) as client:
        assert client.get("/status").json()["bilder"] is False
        with client.websocket_connect("/ws/chat") as ws:
            ws.receive_json()
            ws.send_json({"type": "user", "text": "was ist links?", "bilder": [{"png_base64": png()}], "projekt_id": "P-OK"})
            ev = _bis_ende(ws)
    assert ev[-1]["type"] == "error" and "keine Bilder" in ev[-1]["message"]
    assert prov.nutzer == []


def test_ws_image_lives_one_turn_only_a_model_switch_never_resends_it(workspace):
    """Review fix 106-06: an image checked for a local target stays out of every later turn of the same WebSocket session - also after a
    {type: model} switch, which could point to a provider outside this computer where neither consent nor the switches were checked."""
    rt, prov = _runtime(workspace, vision=True)

    async def frei(*_a):
        return {"ok": True}

    b = png()
    with TestClient(create_app(rt, bild_freigabe=frei)) as client:
        with client.websocket_connect("/ws/chat") as ws:
            assert ws.receive_json()["type"] == "hello"
            ws.send_json({"type": "user", "text": "was ist links?", "bilder": [{"png_base64": b}], "projekt_id": "P-OK"})
            assert _bis_ende(ws)[-1]["type"] == "done"
            ws.send_json({"type": "model", "provider": rt.profile.name})  # a switch: sync_session hands the session a fresh transport
            ws.send_json({"type": "user", "text": "und rechts?"})
            assert _bis_ende(ws)[-1]["type"] == "done"
    assert prov.alle_bilder[0] == 1, "the first turn carries its image"
    assert prov.alle_bilder[-1] == 0, "the next turn sends no image block, not even from the history"
    assert payload_ohne_bilder(prov), "no image block in the provider payload"


def payload_ohne_bilder(prov) -> bool:
    """The last user message as both transports would send it: no image part."""
    m = prov.nutzer[-1]
    a = json.dumps(to_anthropic_payload([m], [], model="x", max_tokens=1, stream=False))
    o = json.dumps(to_openai_payload([m], [], model="x", max_tokens=1, stream=False))
    return "image" not in a and "image_url" not in o


async def test_run_turn_removes_images_from_the_history_also_after_an_error(workspace):
    from harness.agent.loop import run_turn
    from harness.tools.builtin import registry
    from tests.conftest import make_ctx

    class Fehler(LLMProvider):
        async def chat(self, messages, tools, *, model, stream=True, max_tokens=4096):
            yield {"type": "error", "message": "kaputt"}

    rt = make_runtime(workspace, "user")
    session = rt.build_session()
    b = png()
    async for _ in run_turn(session, SiehtProvider(rt.profile), registry, make_ctx(workspace, "user"), "x", bilder=[b]):
        pass
    assert all(not m.bilder for m in session.history), "after a good turn"
    session.history.append(Message(role="user", content="alt", bilder=[b]))  # e.g. a history from before the fix
    session.history.append(Message(role="assistant", content="a"))
    async for _ in run_turn(session, Fehler(rt.profile), registry, make_ctx(workspace, "user"), "y", bilder=[b]):
        pass
    assert all(not m.bilder for m in session.history), "after an error turn, older images included"
