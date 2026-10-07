"""doctor: reachable / 401 / timeout / missing key — all through httpx.MockTransport."""

import httpx

from harness.doctor import render, run_doctor
from harness.providers.base import ProviderProfile
from harness.providers.registry import ProviderRegistry
from tests.conftest import make_config

TOKEN = ProviderProfile(name="alibaba-token-plan", api_mode="openai_compat",
                        base_url="https://token-plan.example/compatible-mode/v1", env_var="DASHSCOPE_API_KEY")
CODING = ProviderProfile(name="alibaba-coding-plan", api_mode="openai_compat",
                         base_url="https://coding.example/v1", env_var="DASHSCOPE_CODING_API_KEY")
LOCAL = ProviderProfile(name="lmstudio", api_mode="openai_compat", base_url="http://127.0.0.1:1234/v1", env_var=None)
DEAD = ProviderProfile(name="ollama", api_mode="openai_compat", base_url="http://127.0.0.1:11434/v1", env_var=None,
                       quirks={"models_url": "http://127.0.0.1:11434/api/tags"})


def _transport():
    def handler(request: httpx.Request) -> httpx.Response:
        host = request.url.host
        if host == "token-plan.example":
            return httpx.Response(200, json={"data": [{"id": "qwen3.8-max"}, {"id": "qwen3.8-flash"}]})
        if host == "coding.example":
            return httpx.Response(401, json={"error": {"message": "invalid access token"}})
        if request.url.port == 1234:
            return httpx.Response(200, json={"data": [{"id": "qwen/qwen3.8-27b"}]})
        raise httpx.ConnectError("connection refused", request=request)
    return httpx.MockTransport(handler)


def _rows(report, bereich="provider"):
    return {r.name: r for r in report.rows if r.bereich == bereich}


async def test_doctor_states(workspace, monkeypatch):
    monkeypatch.setenv("DASHSCOPE_API_KEY", "sk-sp-richtig")
    monkeypatch.setenv("DASHSCOPE_CODING_API_KEY", "sk-sp-falsch")
    reg = ProviderRegistry([TOKEN, CODING, LOCAL, DEAD])
    report = await run_doctor(make_config(workspace, "user"), transport=_transport(), registry=reg)
    p = _rows(report)

    assert p["alibaba-token-plan"].status == "ok" and "2 Modelle" in p["alibaba-token-plan"].befund
    assert p["alibaba-coding-plan"].status == "fail"
    assert "Token Plan ≠ Coding Plan" in p["alibaba-coding-plan"].befund
    assert "coding-intl" in p["alibaba-coding-plan"].naechster_schritt
    assert p["lmstudio"].status == "ok" and "qwen/qwen3.8-27b" in p["lmstudio"].befund
    assert p["ollama"].status == "fail" and "nicht erreichbar" in p["ollama"].befund and "ollama serve" in p["ollama"].naechster_schritt
    assert p["mock"].status == "ok"
    assert report.ok is False

    # discovered models are remembered so /model can validate
    assert reg.get("lmstudio").models == ("qwen/qwen3.8-27b",)

    text = render(report)
    assert "sk-sp" not in text and "Exit 1" in text
    sb = _rows(report, "sandbox")
    assert sb["user-Modus"].status == "ok"
    assert _rows(report, "umgebung")["Python"].status == "ok"


async def test_missing_key_is_plain_text_fail(workspace, monkeypatch):
    monkeypatch.delenv("DASHSCOPE_API_KEY", raising=False)
    reg = ProviderRegistry([TOKEN])
    report = await run_doctor(make_config(workspace, "user"), provider="alibaba-token-plan", transport=_transport(), registry=reg)
    row = report.rows[0]
    assert row.status == "fail" and "Key fehlt" in row.befund and "DASHSCOPE_API_KEY in harness/.env setzen" in row.naechster_schritt
    assert report.ok is False and len(report.rows) == 1  # --provider skips sandbox/environment


async def test_probe_with_mock_provider(workspace):
    report = await run_doctor(make_config(workspace, "user"), provider="mock", probe=True)
    assert [r.status for r in report.rows] == ["ok"]  # mock: no probe row, no network
    assert report.ok
