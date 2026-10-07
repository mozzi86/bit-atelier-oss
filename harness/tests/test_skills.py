"""Skill loader: mode filter, description length warning, slash expansion, skill_new."""

import json

import pytest

from harness.skills.commands import expand_skill, parse_slash
from harness.skills.loader import load_skills, skills_index
from harness.tools.builtin import registry
from tests.conftest import make_ctx, make_runtime


def _write_skill(base, name, fm_extra="", body="Tu es."):
    d = base / name
    d.mkdir(parents=True)
    (d / "SKILL.md").write_text(f"---\nname: {name}\ndescription: Kurz\n{fm_extra}---\n\n{body}\n", encoding="utf-8")


def test_developer_skill_hidden_in_user_mode(workspace):
    _write_skill(workspace["skills"], "nur-user", "mode: user\n")
    skills, warnings = load_skills(workspace["skills"])
    names_dev = {n for n, _ in skills_index(skills, "developer")}
    names_usr = {n for n, _ in skills_index(skills, "user")}
    assert "skill-new" in names_dev and "skill-new" not in names_usr
    assert "nur-user" in names_usr and "nur-user" not in names_dev
    assert warnings == []


def test_long_description_warns_and_truncates(workspace):
    d = workspace["skills"] / "lang"
    d.mkdir()
    (d / "SKILL.md").write_text("---\nname: lang\ndescription: " + "x" * 80 + "\n---\nBody", encoding="utf-8")
    skills, warnings = load_skills(workspace["skills"])
    assert any("80 Zeichen" in w and "erlaubt sind 60" in w for w in warnings)
    assert len(next(s for s in skills if s.name == "lang").description) <= 60


def test_frontmatter_fallback_and_bom(workspace):
    d = workspace["skills"] / "kaputt"
    d.mkdir()
    (d / "SKILL.md").write_text("﻿---\nname: kaputt\ndescription: [unclosed\nmode: user\n---\nBody", encoding="utf-8")
    skills, _ = load_skills(workspace["skills"])
    s = next(s for s in skills if s.name == "kaputt")
    assert s.mode == "user" and s.body == "Body"


def test_platform_filter(workspace):
    _write_skill(workspace["skills"], "nur-mac", "platforms: [macos]\n")
    skills, _ = load_skills(workspace["skills"])
    s = next(s for s in skills if s.name == "nur-mac")
    import sys
    assert s.visible("both") is (sys.platform == "darwin")


def test_slash_parsing_and_expansion(workspace):
    skills, _ = load_skills(workspace["skills"])
    assert parse_slash("/skill-new foo  Bar baz") == ("skill-new", "foo  Bar baz")
    assert parse_slash("kein slash") is None
    turn = expand_skill(skills, "developer", "skill-new", "foo Bar")
    assert turn.startswith("[Skill /skill-new]") and turn.endswith("Argumente: foo Bar")
    with pytest.raises(PermissionError):
        expand_skill(skills, "user", "skill-new", "")
    with pytest.raises(KeyError):
        expand_skill(skills, "developer", "gibt-es-nicht", "")


async def test_skill_new_tool(workspace):
    ctx = make_ctx(workspace, "developer")
    bad = json.loads(await registry.dispatch("skill_new", {"name": "ifc-liste", "description": "x" * 61}, ctx))
    assert "1–60 Zeichen" in bad["error"]
    ok = json.loads(await registry.dispatch("skill_new", {"name": "ifc-liste", "description": "Listet IFC-Bauteile", "mode": "user"}, ctx))
    assert (workspace["skills"] / "ifc-liste" / "SKILL.md").exists()
    assert (workspace["skills"] / "ifc-liste" / "scripts").is_dir()
    dup = json.loads(await registry.dispatch("skill_new", {"name": "ifc-liste", "description": "nochmal"}, ctx))
    assert "existiert bereits" in dup["error"]
    usr = json.loads(await registry.dispatch("skill_new", {"name": "x-y", "description": "d"}, make_ctx(workspace, "user")))
    assert "nicht verfügbar" in usr["error"]


def test_system_prompt_contains_index_and_is_stable(workspace):
    rt = make_runtime(workspace, "developer")
    p1, p2 = rt.system_prompt(), rt.system_prompt()
    assert p1 == p2
    assert "/skill-new — Legt einen neuen Skill" in p1
    assert "BIT Atelier Developer Harness" in p1
    assert "bauherr-praeferenz-holzfenster" in p1 and "Holzfenster" in p1
    assert p1.index("Sicherheitsregeln") < p1.index("## Projekt") < p1.index("## Memory") < p1.index("## Skills") < p1.index("## Werkzeuge")
    usr = make_runtime(workspace, "user").system_prompt()
    assert "Atelier AI Harness" in usr and "/skill-new" not in usr and "skill_new" not in usr
