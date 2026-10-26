"""106-05: the harness as an MCP client of the BIT-Atelier MCP server (tools/mcp-server.mjs) and the speech profile on /ws/chat.

Real wire: the tests start the REAL `node tools/mcp-server.mjs --schreiben` and let it talk to a small fake of the app's HTTP API
(the control channel `POST /api/steuerung`), so client, bridge, allowlist, argument removal and the profile route are proved together.
Guard rails under test: no tool to confirm, no image tool, no record-changing tool, the model cannot aim a change at a guid, the speech
profile has no file/shell tools, a program never answers an approval with "ja", an unreachable app is a plain German sentence.
"""

from __future__ import annotations

import asyncio
import json
import shutil
import sys
import textwrap
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from harness.agent.messages import ToolCall, ev_done, ev_text_delta, ev_tool_call, ev_usage
from harness.config import HARNESS_DIR
from harness.mcp.bridge import DEFAULT_TOOLS, IMMER_GESPERRT, McpBridge, McpSettings
from harness.mcp.client import McpClient, McpError
from harness.providers.base import LLMProvider
from harness.server import create_app
from harness.tools.registry import ToolContext
from tests.conftest import make_runtime

REPO = HARNESS_DIR.parent
SERVER = REPO / "tools" / "mcp-server.mjs"
needs_node = pytest.mark.skipif(shutil.which("node") is None or not SERVER.is_file(), reason="Node.js oder tools/mcp-server.mjs fehlt")


class FakeApi:
    """The control channel of the app as a stand-in: records every POST /api/steuerung and answers with `antwort(body)`."""

    def __init__(self, antwort=None) -> None:
        self.anfragen: list[dict[str, Any]] = []
        self.antwort = antwort or (lambda body: {"id": body.get("id"), "ok": True, "result": {"vorschlag": "ok", "befehl": body["params"]["befehl"]}})
        api = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):  # silence
                pass

            def _json(self, status: int, obj: Any) -> None:
                data = json.dumps(obj).encode()
                self.send_response(status)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def do_GET(self):
                self._json(200, {"nur_lokal": False} if self.path.startswith("/api/llm/einstellungen") else {"ordner": "."})

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers.get("content-length") or 0)) or b"{}")
                api.anfragen.append({"pfad": self.path, "token": self.headers.get("x-bit-steuerung"), "body": body})
                self._json(200, api.antwort(body))

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.url = f"http://127.0.0.1:{self.httpd.server_address[1]}/api"
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def close(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()


@pytest.fixture
def api():
    a = FakeApi()
    yield a
    a.close()


def settings(api: FakeApi | None, **kw) -> McpSettings:
    return McpSettings(api_url=api.url if api else "http://127.0.0.1:9/api", extra_env={"BIT_STEUERUNG_TOKEN": "test-token"}, timeout_s=20.0, **kw)


CTX = ToolContext(mode="user", projekt=None, sandbox_roots=[])


# --- client against the real server ------------------------------------------------------------------------

@needs_node
async def test_client_handshake_and_tools_list_of_the_real_server():
    c = McpClient(["node", str(SERVER), "--schreiben"], timeout_s=20)
    await c.start()
    try:
        assert c.server_info.get("name")
        names = {t["name"] for t in await c.list_tools()}
        assert set(DEFAULT_TOOLS) <= names
        # the app has no tool that confirms - the harness must not find one to offer either
        assert not {"vorschlag_bestaetigen", "bestaetigen"} & names
    finally:
        await c.close()
    assert not c.running


async def test_client_unknown_command_is_a_german_sentence():
    c = McpClient(["gibt-es-nicht-xyz"], timeout_s=2)
    with pytest.raises(McpError, match="nicht gefunden"):
        await c.start()


STUB_STUMM = textwrap.dedent("""
    import sys, json
    for line in sys.stdin:
        m = json.loads(line)
        if m.get("method") == "initialize":
            print(json.dumps({"jsonrpc": "2.0", "id": m["id"], "result": {"protocolVersion": "2025-06-18", "capabilities": {}, "serverInfo": {"name": "stub"}}}), flush=True)
        # every other request is never answered
""")
STUB_STIRBT = textwrap.dedent("""
    import sys, json
    for line in sys.stdin:
        m = json.loads(line)
        if m.get("method") == "initialize":
            print(json.dumps({"jsonrpc": "2.0", "id": m["id"], "result": {"serverInfo": {"name": "stub"}}}), flush=True)
        elif m.get("method") == "tools/list":
            sys.stderr.write("boom im Stub\\n"); sys.stderr.flush()
            sys.exit(3)
""")


async def test_client_timeout_and_dying_server(tmp_path):
    stumm = tmp_path / "stumm.py"
    stumm.write_text(STUB_STUMM, encoding="utf-8")
    c = McpClient([sys.executable, str(stumm)], timeout_s=0.6)
    await c.start()
    with pytest.raises(McpError, match="antwortet nicht auf tools/list"):
        await c.list_tools()
    await c.close()
    stirbt = tmp_path / "stirbt.py"
    stirbt.write_text(STUB_STIRBT, encoding="utf-8")
    d = McpClient([sys.executable, str(stirbt)], timeout_s=10)
    await d.start()
    with pytest.raises(McpError, match="läuft nicht mehr"):
        await d.list_tools()
    await d.close()


# --- bridge -----------------------------------------------------------------------------------------------

@needs_node
async def test_bridge_offers_exactly_the_allowlist_without_guid_on_the_change_tools(api):
    b = McpBridge(settings(api))
    st = await b.ensure()
    try:
        assert st["verbunden"] is True, st
        assert set(st["werkzeuge"]) == set(DEFAULT_TOOLS)
        reg = b.registry()
        assert set(reg.names("user")) == set(DEFAULT_TOOLS) and set(reg.names("developer")) == set(DEFAULT_TOOLS)
        schemas = {s.name: s for s in reg.schemas("user")}
        for n in ("eigenschaft_setzen", "transformieren", "teilen"):
            assert "guid" not in schemas[n].parameters.get("properties", {}), n
            assert "guid" not in schemas[n].parameters.get("required", []), n
        assert "name" in schemas["eigenschaft_setzen"].parameters["properties"]
        # nothing that confirms, changes records directly, or sends an image
        assert not IMMER_GESPERRT & set(reg.names("user"))
    finally:
        await b.close()


@needs_node
async def test_config_cannot_unlock_the_forbidden_tools():
    s = McpSettings.from_raw({"tools": ["transformieren", "ansicht_bild", "bauteil_waehlen", "vorschlag_bestaetigen", "update_record", "create_record", "zeichenflaeche_ausfuehren"]}, REPO)
    assert s.tools == ("transformieren",)
    d = McpSettings.from_raw(None, REPO)
    assert d.enabled is True and d.tools == DEFAULT_TOOLS and d.script == REPO / "tools" / "mcp-server.mjs" and d.command == "node"
    assert McpSettings.from_raw({"enabled": False, "script": "x/y.mjs"}, REPO).script == (REPO / "x" / "y.mjs").resolve()


@needs_node
async def test_tool_call_reaches_the_app_with_selection_target_and_never_a_guid(api):
    b = McpBridge(settings(api))
    await b.ensure()
    try:
        reg = b.registry()
        out = await reg.dispatch("transformieren", {"guid": "WAHL-DES-MODELLS", "verschiebung_m": [0.5, 0, 0]}, CTX)
        assert "transformieren" in out and "error" not in json.loads(out) if out.startswith("{") else True
        post = [a for a in api.anfragen if a["pfad"] == "/api/steuerung"]
        assert len(post) == 1
        assert post[0]["token"] == "test-token"
        p = post[0]["body"]["params"]
        assert p["befehl"] == "transformieren"
        assert "guid" not in p["params"], "the model's guid never reaches the app"
        assert p["params"]["verschiebung_m"] == [0.5, 0, 0]
        # the same for the property tool
        await reg.dispatch("eigenschaft_setzen", {"guid": "ANDERE", "name": "feuerwiderstand", "wert": "F90"}, CTX)
        p2 = [a for a in api.anfragen if a["pfad"] == "/api/steuerung"][-1]["body"]["params"]
        assert p2["befehl"] == "eigenschaft-setzen" and "guid" not in p2["params"] and p2["params"]["wert"] == "F90"
        # a read keeps working
        await reg.dispatch("auswahl_abfragen", {}, CTX)
        assert api.anfragen[-1]["body"]["params"]["befehl"] == "auswahl-lesen"
    finally:
        await b.close()


@needs_node
async def test_refusal_of_the_app_is_data_for_the_model_and_a_dead_app_is_a_sentence(api):
    api.antwort = lambda body: {"id": body.get("id"), "ok": False, "error": "Keine Auswahl — erst ein Bauteil zeigen oder mit auswahl-guid wählen"}
    b = McpBridge(settings(api))
    await b.ensure()
    try:
        reg = b.registry()
        out = await reg.dispatch("teilen", {"anteil": 0.5}, CTX)
        assert "Keine Auswahl" in out
    finally:
        await b.close()
    # the app is not running: the MCP server says so, the tool answer is an error with that sentence
    b2 = McpBridge(settings(None))
    await b2.ensure()
    try:
        out2 = await b2.registry().dispatch("auswahl_abfragen", {}, CTX)
        assert json.loads(out2)["error"]
        assert "BIT-Atelier läuft nicht" in out2
    finally:
        await b2.close()


async def test_bridge_never_raises_and_says_what_is_missing(tmp_path):
    off = McpBridge(McpSettings(enabled=False))
    st = await off.ensure()
    assert st["verbunden"] is False and "enabled: false" in st["hinweis"]
    ohne = McpBridge(McpSettings(script=tmp_path / "gibt-es-nicht.mjs"))
    assert "fehlt" in (await ohne.ensure())["hinweis"]
    skript = tmp_path / "s.mjs"
    skript.write_text("//", encoding="utf-8")
    kein_node = McpBridge(McpSettings(script=skript, command="node-gibt-es-nicht"))
    assert "Node.js nicht gefunden" in (await kein_node.ensure())["hinweis"]
    assert off.registry().names("user") == []


async def test_bridge_server_without_the_tools(tmp_path):
    """An old app: the server answers, but knows none of the tools - the hint says so, the registry stays empty."""
    stub = tmp_path / "alt.py"
    stub.write_text(textwrap.dedent("""
        import sys, json
        for line in sys.stdin:
            m = json.loads(line)
            if m.get("method") == "initialize":
                print(json.dumps({"jsonrpc": "2.0", "id": m["id"], "result": {"serverInfo": {"name": "alt"}}}), flush=True)
            elif m.get("method") == "tools/list":
                print(json.dumps({"jsonrpc": "2.0", "id": m["id"], "result": {"tools": [{"name": "bit_status", "inputSchema": {"type": "object"}}]}}), flush=True)
    """), encoding="utf-8")
    b = McpBridge(McpSettings(script=stub, command=sys.executable), client_factory=lambda cmd, env: McpClient([cmd[0], str(stub)], env=env, timeout_s=10))
    st = await b.ensure()
    assert st["verbunden"] is False
    assert "kennt keines der Sprach-Werkzeuge" in st["hinweis"]
    assert b.registry().names("user") == []
    await b.close()


class _FakeClient:
    """A client stand-in that counts start/close; `tools` is what tools/list answers."""

    def __init__(self, zaehler: dict[str, int], tools: list[dict[str, Any]]) -> None:
        self.zaehler, self.tools, self._laeuft = zaehler, tools, False

    @property
    def running(self) -> bool:
        return self._laeuft

    async def start(self) -> None:
        self.zaehler["gestartet"] += 1
        self._laeuft = True

    async def list_tools(self) -> list[dict[str, Any]]:
        return self.tools

    async def close(self) -> None:
        if self._laeuft:
            self.zaehler["geschlossen"] += 1
        self._laeuft = False


async def test_bridge_without_the_tools_keeps_no_process_alive(tmp_path):
    """Review 106-05: a server without the speech tools must not leave one node process per sentence behind."""
    skript = tmp_path / "s.mjs"
    skript.write_text("//", encoding="utf-8")
    z = {"gestartet": 0, "geschlossen": 0}
    clients: list[_FakeClient] = []

    def fabrik(cmd, env):
        c = _FakeClient(z, [{"name": "bit_status", "inputSchema": {"type": "object"}}])
        clients.append(c)
        return c

    b = McpBridge(McpSettings(script=skript, command=sys.executable), client_factory=fabrik)
    for _ in range(3):
        st = await b.ensure()
        assert st["verbunden"] is False and "kennt keines" in st["hinweis"]
    assert z["gestartet"] == 3
    assert sum(1 for c in clients if c.running) == 0, "every client without tools is closed again"
    await b.close()


async def test_bridge_closes_a_dead_client_before_starting_a_new_one(tmp_path):
    skript = tmp_path / "s.mjs"
    skript.write_text("//", encoding="utf-8")
    z = {"gestartet": 0, "geschlossen": 0}
    clients: list[_FakeClient] = []

    def fabrik(cmd, env):
        c = _FakeClient(z, [{"name": "pruefen", "inputSchema": {"type": "object"}}])
        clients.append(c)
        return c

    b = McpBridge(McpSettings(script=skript, command=sys.executable, tools=("pruefen",)), client_factory=fabrik)
    assert (await b.ensure())["verbunden"] is True
    assert (await b.ensure())["verbunden"] is True and z["gestartet"] == 1, "a live client with tools is reused"
    clients[0]._laeuft = False  # the server died
    assert (await b.ensure())["verbunden"] is True
    assert z["gestartet"] == 2 and sum(1 for c in clients if c.running) <= 1
    await b.close()
    assert sum(1 for c in clients if c.running) == 0


def test_satz_marke_aus_reads_only_the_apps_form():
    """D-IM-07: only the app's marker form passes ("sm-" + 32 hex digits); anything else is dropped, never guessed."""
    from harness.mcp.bridge import satz_marke_aus
    gut = "sm-" + "0123456789abcdef" * 2
    assert satz_marke_aus(gut) == gut and satz_marke_aus(f"  {gut} ") == gut
    for schlecht in (None, 5, "", "sprache", "sm-" + "G" * 32, "sm-" + "a" * 31, ["sm-" + "a" * 32]):
        assert satz_marke_aus(schlecht) is None, schlecht


@needs_node
async def test_apps_sentence_marker_goes_into_the_change_calls_and_the_models_never(api):
    """D-IM-07: the app's marker of a spoken sentence is put into the three change tools by the bridge; the model neither sees the
    argument in the schema nor gets its own value through."""
    marke = "sm-" + "ab" * 16
    b = McpBridge(settings(api))
    await b.ensure()
    try:
        reg = b.registry(ziel=["GUID-AUS-DEM-STRAHL-01"], satz_marke=marke)
        schemas = {s.name: s for s in reg.schemas("standard")}
        for name in ("eigenschaft_setzen", "transformieren", "teilen"):
            assert "satz_marke" not in (schemas[name].parameters.get("properties") or {}), name
        await reg.dispatch("eigenschaft_setzen", {"name": "feuerwiderstand", "wert": "F90", "satz_marke": "sm-" + "ff" * 16}, CTX)
        p = api.anfragen[-1]["body"]["params"]
        assert p["befehl"] == "eigenschaft-setzen" and p["params"]["satz_marke"] == marke
        await reg.dispatch("teilen", {"anteil": 0.5}, CTX)
        assert api.anfragen[-1]["body"]["params"]["params"]["satz_marke"] == marke
        # a read carries no marker
        await reg.dispatch("auswahl_abfragen", {}, CTX)
        assert "satz_marke" not in api.anfragen[-1]["body"]["params"]["params"]
    finally:
        await b.close()


def test_ziel_aus_reads_only_short_strings():
    from harness.mcp.bridge import ziel_aus
    assert ziel_aus(None) is None and ziel_aus("G") is None
    assert ziel_aus([]) == []
    assert ziel_aus(["  A1 ", 5, "", "x" * 65, None]) == ["A1"]


@needs_node
async def test_held_target_goes_into_the_call_and_the_models_guid_never(api):
    """Review 106-05 (guard rail 3): the GUID selected when the person spoke is the target, not the selection at the time of the call."""
    b = McpBridge(settings(api))
    await b.ensure()
    try:
        reg = b.registry(ziel=["GUID-AUS-DEM-STRAHL-01"])
        await reg.dispatch("eigenschaft_setzen", {"guid": "WAHL-DES-MODELLS", "name": "feuerwiderstand", "wert": "F90"}, CTX)
        p = [a for a in api.anfragen if a["pfad"] == "/api/steuerung"][-1]["body"]["params"]
        assert p["befehl"] == "eigenschaft-setzen" and p["params"]["guid"] == "GUID-AUS-DEM-STRAHL-01"
        assert "satz_marke" not in p["params"], "no marker from the app: none in the call (the proposal stays origin agent)"
        await reg.dispatch("transformieren", {"verschiebung_m": [0.5, 0, 0]}, CTX)
        assert api.anfragen[-1]["body"]["params"]["params"]["guid"] == "GUID-AUS-DEM-STRAHL-01"
        # a read is not aimed
        await reg.dispatch("auswahl_abfragen", {}, CTX)
        assert "guid" not in api.anfragen[-1]["body"]["params"]["params"]
        anzahl = len(api.anfragen)
        # nothing or several selected at the sentence: refused in words, nothing reaches the app
        out0 = await b.registry(ziel=[]).dispatch("teilen", {"anteil": 0.5}, CTX)
        out2 = await b.registry(ziel=["A", "B"]).dispatch("teilen", {"anteil": 0.5}, CTX)
        assert "kein Bauteil ausgewählt" in out0 and "mehrere Bauteile" in out2
        assert len(api.anfragen) == anzahl
    finally:
        await b.close()


# --- the speech profile on /ws/chat ----------------------------------------------------------------------

class SprechProvider(LLMProvider):
    """Stand-in model: first round asks for eigenschaft_setzen with a guid of its own choosing, then answers in a sentence."""

    def __init__(self) -> None:
        super().__init__(None)  # type: ignore[arg-type]
        self.tool_namen: list[list[str]] = []
        self.systeme: list[str] = []
        self.nutzer: list[str] = []

    async def chat(self, messages, tools, *, model, stream=True, max_tokens=4096):
        self.tool_namen.append([t.name for t in tools])
        self.systeme.append(messages[0].content)
        self.nutzer.append(next(m.content for m in messages if m.role == "user"))
        if messages[-1].role == "tool":
            yield ev_text_delta("Vorschlag gemacht: Feuerwiderstand F90.")
            yield ev_usage(10, 5)
            yield ev_done("end_turn")
            return
        # D-IM-07: the model also tries a sentence marker of its own - the bridge drops it like the guid
        yield ev_tool_call(ToolCall(id="c1", name="eigenschaft_setzen",
                                    arguments={"guid": "FREMDE-GUID", "name": "feuerwiderstand", "wert": "F90", "satz_marke": "sm-" + "ee" * 16}))
        yield ev_usage(10, 5)
        yield ev_done("tool_use")


def _alle(ws):
    ev = []
    while True:
        e = ws.receive_json()
        ev.append(e)
        if e["type"] in ("done", "error"):
            return ev


@needs_node
def test_speech_profile_end_to_end_with_the_mock_of_the_model(workspace, api):
    rt = make_runtime(workspace, "developer")  # developer mode on purpose: even there the speech profile has no file/shell tools
    rt.mcp = McpBridge(settings(api))
    prov = SprechProvider()
    rt.make_provider = lambda: prov  # type: ignore[method-assign]
    with TestClient(create_app(rt)) as client:
        with client.websocket_connect("/ws/chat?profil=sprechen") as ws:
            hello = ws.receive_json()
            assert hello["type"] == "hello"
            ws.send_json({"type": "user", "text": "Sprachbefehl: setze den Brandschutz dieser Wand auf F90"})
            events = _alle(ws)
            # 106-05 review: the app sends the GUID selected when the person spoke; the bridge puts it into the call
            ws.send_json({"type": "user", "text": "Sprachbefehl: noch einmal", "ziel": ["GUID-BEIM-SATZ-0000001"], "satz_marke": "sm-" + "cd" * 16})
            _alle(ws)
    types = [e["type"] for e in events]
    assert "approval" not in types, "a program never answers an approval with ja, and the profile has no tool that asks"
    assert types[-1] == "done"
    assert any(e["type"] == "tool_call" and e["name"] == "eigenschaft_setzen" for e in events)
    result = next(e for e in events if e["type"] == "tool_result")
    assert "eigenschaft-setzen" in result["result"], result
    assert "Vorschlag gemacht" in "".join(e.get("text", "") for e in events if e["type"] == "text_delta")
    # the app received the command WITHOUT the model's guid
    posts = [a for a in api.anfragen if a["pfad"] == "/api/steuerung" and a["body"]["params"]["befehl"] == "eigenschaft-setzen"]
    p = posts[0]["body"]["params"]
    assert "guid" not in p["params"], "without `ziel` (older app) the model's guid is dropped and the app's selection counts"
    assert posts[-1]["body"]["params"]["params"]["guid"] == "GUID-BEIM-SATZ-0000001", "with `ziel` the held GUID is the target"
    # D-IM-07: the model's own marker never reaches the app; the app's marker of the spoken sentence does
    assert "satz_marke" not in p["params"]
    assert posts[-1]["body"]["params"]["params"]["satz_marke"] == "sm-" + "cd" * 16
    assert all("sm-" not in str(n) for n in prov.nutzer), "the marker is not in the model's view"
    # the model saw only the speech tools: no files, shell, memory, skills
    assert set(prov.tool_namen[0]) == set(DEFAULT_TOOLS)
    assert not {"read_file", "write_file", "shell", "memory_save"} & set(prov.tool_namen[0])
    assert "Du bist die Sprachsteuerung" in prov.systeme[0]
    assert "PROJECT.md" not in prov.systeme[0] and "## Memory" not in prov.systeme[0]


def test_speech_profile_refusals(workspace):
    rt = make_runtime(workspace, "user")
    rt.mcp = McpBridge(McpSettings(enabled=False))
    with TestClient(create_app(rt)) as client:
        with client.websocket_connect("/ws/chat?profil=sprechen") as ws:
            e = ws.receive_json()
            assert e["type"] == "error" and "ausgeschaltet" in e["message"]
        with client.websocket_connect("/ws/chat?profil=gibtsnicht") as ws:
            e = ws.receive_json()
            assert e["type"] == "error" and "Unbekanntes Profil" in e["message"]
        # the normal chat is unchanged: hello first, all built-in tools
        with client.websocket_connect("/ws/chat") as ws:
            assert ws.receive_json()["type"] == "hello"


def test_status_tells_the_app_what_the_speech_field_needs(workspace):
    rt = make_runtime(workspace, "user")
    with TestClient(create_app(rt)) as client:
        d = client.get("/status").json()
    assert d["provider_lokal"] is True  # the mock never leaves the process
    assert set(d["mcp"]) >= {"verbunden", "aktiv", "werkzeuge", "hinweis"}
    assert d["mcp"]["verbunden"] is False  # connected on first use, not at start
    assert d["nur_lokal"] is False


@pytest.mark.skipif(sys.platform != "win32", reason="Prüft die Windows-Schleife")
def test_client_works_on_a_selector_loop_too(tmp_path):
    """uvicorn may run a selector loop on Windows, where asyncio's subprocess API raises NotImplementedError - the thread-based client does not care."""
    stub = tmp_path / "stub.py"
    stub.write_text(STUB_STUMM, encoding="utf-8")
    loop = asyncio.SelectorEventLoop()
    try:
        async def lauf():
            c = McpClient([sys.executable, str(stub)], timeout_s=5)
            await c.start()
            await c.close()
            return c.server_info
        info = loop.run_until_complete(lauf())
    finally:
        loop.close()
    assert info == {"name": "stub"}
