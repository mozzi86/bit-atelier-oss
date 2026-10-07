"""Sandbox: user mode stays inside the project, developer mode reaches the repo,
symlinks and `..` are resolved before the check."""

import json
import os
import sys

import pytest

from harness.tools.builtin import registry
from tests.conftest import make_ctx


async def test_user_cannot_read_repo(workspace):
    ctx = make_ctx(workspace, "user")
    out = json.loads(await registry.dispatch("read_file", {"path": "../../repo/package.json"}, ctx))
    assert "außerhalb der Sandbox" in out["error"]


async def test_developer_reads_repo(workspace):
    ctx = make_ctx(workspace, "developer")
    out = json.loads(await registry.dispatch("read_file", {"path": str(workspace["repo"] / "package.json")}, ctx))
    assert out["content"] == '{"name": "fake-app"}'


async def test_relative_path_resolves_against_project(workspace):
    ctx = make_ctx(workspace, "user")
    out = json.loads(await registry.dispatch("read_file", {"path": "PROJECT.md"}, ctx))
    assert out["path"].endswith("PROJECT.md") and "Satteldach" in out["content"]


async def test_write_outside_rejected_and_inside_ok(workspace):
    ctx = make_ctx(workspace, "user")
    bad = json.loads(await registry.dispatch("write_file", {"path": "../../repo/evil.txt", "content": "x"}, ctx))
    assert "außerhalb der Sandbox" in bad["error"]
    assert not (workspace["repo"] / "evil.txt").exists()
    ok = json.loads(await registry.dispatch("write_file", {"path": "files/notiz.md", "content": "hallo"}, ctx))
    assert ok["bytes"] == 5 and (workspace["project_dir"] / "files" / "notiz.md").read_text() == "hallo"


@pytest.mark.skipif(sys.platform == "win32" and not os.environ.get("HARNESS_TEST_SYMLINK"),
                    reason="symlink creation needs developer mode/admin on Windows; set HARNESS_TEST_SYMLINK=1")
async def test_symlink_out_of_project_rejected(workspace):
    link = workspace["project_dir"] / "files" / "leak.json"
    os.symlink(workspace["repo"] / "package.json", link)
    ctx = make_ctx(workspace, "user")
    out = json.loads(await registry.dispatch("read_file", {"path": "files/leak.json"}, ctx))
    assert "außerhalb der Sandbox" in out["error"]


async def test_symlink_rule_via_resolver(workspace, monkeypatch):
    """Windows-safe stand-in: a path whose resolve() lands outside is rejected."""
    from pathlib import Path

    from harness.tools import sandbox

    ctx = make_ctx(workspace, "user")
    target = (workspace["repo"] / "package.json").resolve()
    real_resolve = Path.resolve

    def fake_resolve(self, strict=False):
        # Only the "symlink" jumps out of the project; roots resolve normally.
        return target if self.name == "leak.json" else real_resolve(self, strict=strict)

    monkeypatch.setattr(Path, "resolve", fake_resolve)
    with pytest.raises(ValueError, match="außerhalb der Sandbox"):
        sandbox.resolve_in_sandbox("files/leak.json", ctx)


async def test_list_and_search(workspace):
    ctx = make_ctx(workspace, "user")
    ls = json.loads(await registry.dispatch("list_dir", {}, ctx))
    assert {"PROJECT.md", "tasks.md", "memory"} <= {e["name"] for e in ls["entries"]}
    hits = json.loads(await registry.dispatch("search_files", {"pattern": "Traufh", "glob": "*.md"}, ctx))
    assert hits["count"] >= 2 and all("Traufh" in h["text"] for h in hits["hits"])
    outside = json.loads(await registry.dispatch("search_files", {"pattern": "x", "path": str(workspace["repo"])}, ctx))
    assert "außerhalb der Sandbox" in outside["error"]


def test_toolsets_differ_by_mode():
    assert "skill_new" in registry.names("developer")
    assert "skill_new" not in registry.names("user")
    assert "read_file" in registry.names("user")
