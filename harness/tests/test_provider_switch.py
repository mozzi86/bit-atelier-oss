"""/model at runtime: history, ledger and the byte-identical system prompt survive."""

import hashlib

import pytest
from fastapi.testclient import TestClient

from harness.agent.loop import run_turn
from harness.providers.base import ProviderProfile
from harness.providers.mock import MockProvider
from harness.server import create_app
from harness.tools.builtin import registry
from tests.conftest import make_ctx, make_runtime

MOCK2 = ProviderProfile(name="mock2", api_mode="mock", models=("mock-2",), default_model="mock-2",
                        preis_in_pro_mio=3.0, preis_out_pro_mio=2.0, context_window=64_000)


async def test_switch_keeps_history_and_prompt(workspace):
    rt = make_runtime(workspace, "user")
    rt.providers.replace(MOCK2)
    session = rt.build_session()
    provider = rt.make_provider()
    before = hashlib.sha256(session.history[0].content.encode()).hexdigest()

    async for _ in run_turn(session, provider, registry, make_ctx(workspace, "user"), "hallo"):
        pass
    tokens_before = session.input_tokens

    rt.set_model("mock2", None)
    provider = rt.sync_session(session, provider)
    assert isinstance(provider, MockProvider) and provider.profile.name == "mock2"
    assert (session.provider_name, session.model) == ("mock2", "mock-2")
    assert hashlib.sha256(session.history[0].content.encode()).hexdigest() == before
    assert [m.role for m in session.history] == ["system", "user", "assistant"]
    assert session.input_tokens == tokens_before

    async for _ in run_turn(session, provider, registry, make_ctx(workspace, "user"), "nochmal"):
        pass
    st = rt.status(session)
    assert st["model"] == "mock-2" and st["turns"] == 2 and st["context_window"] == 64_000
    assert st["context_window_assumed"] is False and st["kosten_eur"] is not None
    assert session.ledger.entries[-1].provider == "mock2" and session.ledger.entries[0].provider == "mock"


def test_switch_validates_model_against_profile(workspace):
    rt = make_runtime(workspace, "user")
    with pytest.raises(ValueError, match="nicht im Profil"):
        rt.set_model("mock", "gibt-es-nicht")
    with pytest.raises(KeyError, match="nicht in providers.yaml"):
        rt.set_model("nope", None)
    # profiles with an empty models list accept any model name (local servers)
    rt.providers.replace(ProviderProfile(name="lokal", api_mode="mock", models=()))
    rt.set_model("lokal", "irgendwas")
    assert rt.model == "irgendwas"


def test_ws_model_switch_mid_session(workspace):
    rt = make_runtime(workspace, "developer")
    rt.providers.replace(MOCK2)
    client = TestClient(create_app(rt))
    with client.websocket_connect("/ws/chat") as ws:
        hello = ws.receive_json()
        assert hello["model"] == "mock-1"
        ws.send_json({"type": "user", "text": "eins"})
        while ws.receive_json()["type"] != "done":
            pass
        ws.send_json({"type": "model", "provider": "mock2"})
        st = ws.receive_json()
        assert st["type"] == "status" and st["model"] == "mock-2" and st["turns"] == 1
        ws.send_json({"type": "user", "text": "zwei"})
        events = []
        while True:
            ev = ws.receive_json()
            events.append(ev)
            if ev["type"] == "done":
                break
        ws.send_json({"type": "status"})
        st = ws.receive_json()
        assert st["turns"] == 2 and st["provider"] == "mock2"
    # POST /model also reaches a running session on its next turn
    assert client.post("/model", json={"provider": "mock"}).json()["model"] == "mock-1"
    assert client.get("/model").json()["provider"] == "mock"
