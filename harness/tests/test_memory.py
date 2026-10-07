"""Memory: file + index line, replace on same name, budget rendering."""

import json

from harness.agent.context import render_memory
from harness.tools.builtin import registry
from harness.workspace import memory as mem
from tests.conftest import make_ctx


async def test_save_creates_file_and_index_line(workspace):
    ctx = make_ctx(workspace, "user")
    out = json.loads(await registry.dispatch("memory_save", {
        "name": "Heizung Wärmepumpe", "description": "Sole/Wasser-WP gewünscht", "type": "project",
        "text": "Bauherr will Erdwärme, Bohrung prüfen."}, ctx))
    assert out["saved"] == "heizung-waermepumpe"
    mdir = workspace["project_dir"] / "memory"
    files = sorted(p.name for p in mdir.glob("*.md"))
    assert len(files) == 4  # 2 example facts + MEMORY.md + new
    index = (mdir / "MEMORY.md").read_text(encoding="utf-8")
    assert index.count("[heizung-waermepumpe]") == 1 and "Sole/Wasser-WP" in index


async def test_save_same_name_replaces(workspace):
    ctx = make_ctx(workspace, "user")
    for text in ("v1", "v2"):
        await registry.dispatch("memory_save", {"name": "fakt", "description": f"desc {text}", "text": text}, ctx)
    mdir = workspace["project_dir"] / "memory"
    assert len(list(mdir.glob("fakt*.md"))) == 1
    index = (mdir / "MEMORY.md").read_text(encoding="utf-8")
    assert index.count("[fakt]") == 1 and "desc v2" in index and "desc v1" not in index
    read = json.loads(await registry.dispatch("memory_read", {"name": "fakt"}, ctx))
    assert read["text"] == "v2"


async def test_invalid_type_and_missing_description(workspace):
    ctx = make_ctx(workspace, "user")
    bad = json.loads(await registry.dispatch("memory_save", {"name": "a", "description": "d", "type": "geheim", "text": "t"}, ctx))
    assert "Memory-Typ" in bad["error"]
    bad2 = json.loads(await registry.dispatch("memory_save", {"name": "a", "description": "", "text": "t"}, ctx))
    assert "description fehlt" in bad2["error"]


async def test_list_reads_example_facts(workspace):
    ctx = make_ctx(workspace, "user")
    out = json.loads(await registry.dispatch("memory_list", {}, ctx))
    assert {f["name"] for f in out["facts"]} == {"bauherr-praeferenz-holzfenster", "b-plan-traufhoehe"}


def test_budget_renders_full_then_index():
    entries = [("a", "desc a", "x" * 100), ("b", "desc b", "y" * 100), ("c", "desc c", "z" * 100)]
    out = render_memory(entries, budget=250)
    assert "x" * 100 in out and "y" * 100 in out
    assert "z" * 100 not in out and "- c — desc c" in out


def test_frontmatter_roundtrip(tmp_path):
    f = mem.save_fact(tmp_path, "Umlaute Ärger", "Ä ö ü bleiben", "reference", "Körper")
    facts = mem.load_facts(tmp_path)
    assert facts[0].name == f.name and facts[0].description == "Ä ö ü bleiben" and facts[0].body == "Körper"
    assert mem.delete_fact(tmp_path, f.name) and mem.load_facts(tmp_path) == []
    assert (tmp_path / "MEMORY.md").read_text(encoding="utf-8").strip() == "# Memory-Index"
