"""93-12: "Nur lokale KI" and the app's local connection (harness/lokal.py, registry, runtime, config)."""

from __future__ import annotations

import json

import httpx
import pytest
from fastapi.testclient import TestClient

from harness.agent.messages import Message
from harness.config import load_config
from harness.lokal import APP_LOKAL, LOKAL_TIMEOUT_S, app_lokal_profile, is_loopback_url, profile_is_local
from harness.providers.base import ProviderProfile
from harness.providers.openai_compat import OpenAICompatProvider
from harness.providers.registry import ProviderRegistry
from harness.runtime import Runtime
from harness.server import create_app
from tests.conftest import make_config


@pytest.mark.parametrize("url", [
    "http://127.0.0.1:1234/v1", "http://localhost:11434", "http://127.5.6.7:8000", "http://[::1]:1234/v1",
    "http://[::ffff:127.0.0.1]:1234", "https://api.localhost/v1", "http://LOCALHOST:1",
])
def test_loopback_accepts(url):
    assert is_loopback_url(url)


@pytest.mark.parametrize("url", [
    "https://api.openai.com/v1", "http://127.0.0.1.evil.example/v1", "http://127.0.0.1@evil.example/",
    "http://localhost.evil.example", "http://10.0.0.5:1234", "http://[::2]:1", "ftp://127.0.0.1/", "", None,
    "http://192.168.1.10:11434",
])
def test_loopback_refuses(url):
    assert not is_loopback_url(url)


CLOUD = ProviderProfile(name="cloud", api_mode="openai_compat", base_url="https://api.example.com/v1", env_var=None)
LOKAL = ProviderProfile(name="lokal", api_mode="openai_compat", base_url="http://127.0.0.1:1234/v1", env_var=None)
VERSTECKT = ProviderProfile(name="versteckt", api_mode="openai_compat", base_url="http://127.0.0.1:1234/v1", env_var=None,
                            quirks={"models_url": "https://evil.example/models"})


def test_profile_is_local():
    assert profile_is_local(LOKAL)
    assert not profile_is_local(CLOUD)
    assert not profile_is_local(VERSTECKT), "a remote models_url leaks too"
    assert profile_is_local(ProviderProfile(name="m", api_mode="mock"))


def test_registry_refuses_cloud_when_nur_lokal():
    reg = ProviderRegistry([CLOUD, LOKAL], nur_lokal=True)
    with pytest.raises(ValueError, match="Nur lokale KI ist eingeschaltet.*api.example.com"):
        reg.make_provider("cloud")
    assert reg.make_provider("lokal").profile.name == "lokal"
    assert reg.make_provider("mock").profile.name == "mock"
    # Switch off → allowed again.
    assert ProviderRegistry([CLOUD], nur_lokal=False).make_provider("cloud").profile.name == "cloud"


def test_app_lokal_profile_for_ollama():
    p = app_lokal_profile("http://127.0.0.1:11434/v1/", "qwen3.5:9b", "ollama")
    assert p.name == APP_LOKAL and p.base_url == "http://127.0.0.1:11434/v1"
    assert p.default_model == "qwen3.5:9b" and p.env_var is None
    assert p.quirks["models_url"] == "http://127.0.0.1:11434/api/tags"
    assert p.quirks["timeout_s"] == LOKAL_TIMEOUT_S


def test_runtime_uses_app_connection_when_nur_lokal(workspace):
    cfg = make_config(workspace, "user", nur_lokal=True, app_lokal_base_url="http://127.0.0.1:1234/v1", app_lokal_modell="gemma4:12b")
    rt = Runtime.from_config(cfg, skills_dir=workspace["skills"])
    assert (rt.provider_name, rt.model) == (APP_LOKAL, "gemma4:12b")
    with pytest.raises(ValueError, match="Nur lokale KI"):
        rt.set_model("anthropic", None)
    assert rt.status(rt.build_session())["nur_lokal"] is True


def test_runtime_keeps_configured_cloud_profile_without_nur_lokal(workspace):
    from dataclasses import replace
    cfg = replace(make_config(workspace, "user", app_lokal_base_url="http://127.0.0.1:1234/v1", app_lokal_modell="m"), provider="deepseek")
    rt = Runtime.from_config(cfg, skills_dir=workspace["skills"])
    assert rt.provider_name == "deepseek"
    assert APP_LOKAL in rt.providers.names()


def test_websocket_refuses_cloud_profile_in_plain_text(workspace, monkeypatch):
    from dataclasses import replace
    monkeypatch.setenv("DEEPSEEK_API_KEY", "sk-test")
    cfg = replace(make_config(workspace, "user", nur_lokal=True), provider="deepseek")
    rt = Runtime.from_config(cfg, skills_dir=workspace["skills"])
    client = TestClient(create_app(rt))
    with client.websocket_connect("/ws/chat") as ws:
        ev = ws.receive_json()
    assert ev["type"] == "error" and "Nur lokale KI" in ev["message"]
    r = client.post("/model", json={"provider": "groq"})
    assert r.status_code == 400 and "Nur lokale KI" in r.json()["detail"]


def test_config_reads_environment(tmp_path, monkeypatch):
    (tmp_path / "config.yaml").write_text("mode: user\nprovider: mock\n", encoding="utf-8")
    monkeypatch.setenv("BIT_NUR_LOKAL", "1")
    monkeypatch.setenv("BIT_LOKAL_BASE_URL", "http://127.0.0.1:11434/v1")
    monkeypatch.setenv("BIT_LOKAL_MODELL", "qwen3.5:4b")
    monkeypatch.setenv("BIT_LOKAL_ART", "ollama")
    cfg = load_config(harness_dir=tmp_path)
    assert cfg.nur_lokal is True and cfg.app_lokal_base_url == "http://127.0.0.1:11434/v1"
    assert cfg.app_lokal_modell == "qwen3.5:4b" and cfg.app_lokal_art == "ollama"
    monkeypatch.setenv("BIT_NUR_LOKAL", "0")
    assert load_config(harness_dir=tmp_path).nur_lokal is False


def test_config_yaml_nur_lokal_without_env(tmp_path, monkeypatch):
    monkeypatch.delenv("BIT_NUR_LOKAL", raising=False)
    (tmp_path / "config.yaml").write_text("mode: user\nnur_lokal: true\n", encoding="utf-8")
    assert load_config(harness_dir=tmp_path).nur_lokal is True


async def test_timeout_quirk_reaches_httpx(monkeypatch):
    seen = {}
    real = httpx.AsyncClient

    def spy(*a, **kw):
        seen["timeout"] = kw.get("timeout")
        return real(*a, **kw)

    monkeypatch.setattr(httpx, "AsyncClient", spy)

    def handler(request: httpx.Request) -> httpx.Response:
        body = "data: " + json.dumps({"choices": [{"delta": {"content": "OK"}, "finish_reason": "stop"}]}) + "\n\ndata: [DONE]\n\n"
        return httpx.Response(200, text=body, headers={"content-type": "text/event-stream"})

    prov = OpenAICompatProvider(app_lokal_profile("http://127.0.0.1:1234/v1", "m"), None, transport=httpx.MockTransport(handler))
    events = [ev async for ev in prov.chat([Message(role="user", content="hi")], [], model="m")]
    assert any(ev.get("type") == "text_delta" for ev in events)
    assert seen["timeout"].read == LOKAL_TIMEOUT_S


def test_example_files_load_without_control_characters():
    """93-12 found a backspace (from an unescaped Windows path) in config.example.yaml: every fresh install
    without its own config.yaml crashed at start. Both example files must parse."""
    import yaml
    from harness.config import HARNESS_DIR
    for name in ("config.example.yaml", "providers.example.yaml"):
        text = (HARNESS_DIR / name).read_text(encoding="utf-8")
        assert yaml.safe_load(text), name
