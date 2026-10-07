"""FastAPI TestClient with the mock provider: status, WS streaming, approval round-trip."""

import json

import pytest
from fastapi.testclient import TestClient

from harness.server import ALLOWED_ORIGINS, create_app
from harness.tools.builtin import registry
from harness.tools.registry import tool_ok
from tests.conftest import make_runtime


@pytest.fixture
def client(workspace):
    rt = make_runtime(workspace, "developer")
    return TestClient(create_app(rt))


def test_status(client):
    r = client.get("/status")
    assert r.status_code == 200
    d = r.json()
    assert d["mode"] == "developer" and d["display_name"] == "BIT Atelier Developer Harness"
    assert d["model"] == "mock-1" and d["projekt"] == "efh-satteldach"
    assert d["tokens"] == {"input": 0, "output": 0, "total": 0, "estimated": False}
    assert d["context_window"] == 128000 and d["context_window_assumed"] is False
    assert d["offene_aufgaben"] == 3


def test_projects_skills_model(client):
    assert "efh-satteldach" in client.get("/projects").json()["projekte"]
    assert any(s["name"] == "skill-new" for s in client.get("/skills").json()["skills"])
    m = client.get("/model").json()
    assert m["provider"] == "mock" and "anthropic" in m["profile"]
    assert client.post("/model", json={"provider": "nope"}).status_code == 400
    assert client.post("/project/gibt-es-nicht").status_code == 404


def test_cors_only_local_origins(client):
    r = client.options("/status", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"})
    assert r.headers.get("access-control-allow-origin") == "http://localhost:5173"
    r = client.options("/status", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"})
    assert "access-control-allow-origin" not in r.headers


def _drain(ws):
    events = []
    while True:
        ev = ws.receive_json()
        events.append(ev)
        if ev["type"] in ("done", "error") and ev["type"] == "done":
            return events


def test_ws_hello_and_stream(client):
    with client.websocket_connect("/ws/chat") as ws:
        hello = ws.receive_json()
        assert hello["type"] == "hello" and hello["mode"] == "developer"
        ws.send_json({"type": "user", "text": "hallo"})
        events = _drain(ws)
        text = "".join(e["text"] for e in events if e["type"] == "text_delta")
        assert text == "Mock-Antwort auf: hallo"
        assert any(e["type"] == "usage" for e in events)
        ws.send_json({"type": "user", "text": "/status"})
        st = ws.receive_json()
        assert st["type"] == "status" and st["turns"] == 1 and st["tokens"]["total"] > 0


def test_ws_tool_call_visible(client):
    with client.websocket_connect("/ws/chat") as ws:
        ws.receive_json()
        ws.send_json({"type": "user", "text": "lies PROJECT.md"})
        events = _drain(ws)
        assert [e["type"] for e in events if e["type"] in ("tool_call", "tool_result")] == ["tool_call", "tool_result"]


def test_ws_approval_roundtrip(workspace):
    """A provider that calls the shell with a non-allowlisted command → approval event → reply → result."""
    from harness.providers.base import LLMProvider
    from harness.providers.mock import MOCK_PROFILE

    class ShellCaller(LLMProvider):
        def __init__(self):
            super().__init__(MOCK_PROFILE)
            self.n = 0

        async def chat(self, messages, tools, *, model, stream=True, max_tokens=4096):
            self.n += 1
            if messages[-1].role == "tool":
                yield {"type": "text_delta", "text": "erledigt"}
                yield {"type": "done", "stop_reason": "end_turn"}
                return
            yield {"type": "tool_call", "id": "s1", "name": "shell", "arguments": {"command": "python -c \"print('hi')\""}}
            yield {"type": "done", "stop_reason": "tool_use"}

    rt = make_runtime(workspace, "developer")
    rt.make_provider = lambda: ShellCaller()  # type: ignore[method-assign]
    client = TestClient(create_app(rt))
    with client.websocket_connect("/ws/chat") as ws:
        ws.receive_json()
        ws.send_json({"type": "user", "text": "führ das aus"})
        ev = ws.receive_json()
        assert ev["type"] == "tool_call"
        ev = ws.receive_json()
        assert ev["type"] == "approval" and ev["befehl"].startswith("python -c") and ev["erklaerung"]
        ws.send_json({"type": "approval_reply", "id": ev["id"], "ja": True})
        events = _drain(ws)
        result = json.loads(next(e for e in events if e["type"] == "tool_result")["result"])
        assert result["returncode"] == 0 and "hi" in result["stdout"]
        assert "erledigt" in "".join(e.get("text", "") for e in events if e["type"] == "text_delta")


def test_ws_rejects_foreign_origin(client):
    with pytest.raises(Exception):
        with client.websocket_connect("/ws/chat", headers={"Origin": "https://evil.example"}) as ws:
            ws.receive_json()


def test_allowed_origins_defaults_and_env():
    """83-03: the local app (npm start, :3001) and the preview (:4173) are allowed;
    HARNESS_ALLOWED_ORIGINS adds origins, never replaces the defaults."""
    from harness.server import allowed_origins

    default = allowed_origins({})
    for origin in ("http://localhost:3001", "http://127.0.0.1:3001", "http://localhost:4173", "http://localhost:5173"):
        assert origin in default
    extra = allowed_origins({"HARNESS_ALLOWED_ORIGINS": " http://localhost:3002/ , http://localhost:5173,,"})
    assert extra[: len(default)] == default
    assert extra[-1] == "http://localhost:3002"
    assert extra.count("http://localhost:5173") == 1
    assert ALLOWED_ORIGINS == default


def test_cors_app_port_and_env_origin(workspace, monkeypatch):
    monkeypatch.setenv("HARNESS_ALLOWED_ORIGINS", "http://localhost:3002")
    client = TestClient(create_app(make_runtime(workspace, "developer")))
    for origin in ("http://localhost:3001", "http://localhost:4173", "http://localhost:3002"):
        r = client.options("/status", headers={"Origin": origin, "Access-Control-Request-Method": "GET"})
        assert r.headers.get("access-control-allow-origin") == origin
    r = client.options("/status", headers={"Origin": "http://localhost:3003", "Access-Control-Request-Method": "GET"})
    assert "access-control-allow-origin" not in r.headers
