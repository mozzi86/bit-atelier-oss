"""skill_list / skill_read tools and skill_new (developer only) — creates a skill scaffold."""

from __future__ import annotations

import re

from harness.skills.loader import MAX_DESCRIPTION, load_skills
from harness.tools.registry import ToolContext, registry, tool_error, tool_ok
from harness.workspace.frontmatter import dump_frontmatter


def _skills_dir(ctx: ToolContext):
    if not ctx.skills_dir:
        raise ValueError("skills_dir nicht gesetzt")
    return ctx.skills_dir


def skill_list(args: dict, ctx: ToolContext) -> str:
    skills, warnings = load_skills(_skills_dir(ctx))
    return tool_ok(skills=[{"name": s.name, "description": s.description, "mode": s.mode}
                           for s in skills if s.visible(ctx.mode)], warnungen=warnings)


def skill_read(args: dict, ctx: ToolContext) -> str:
    name = str(args.get("name") or "").lstrip("/")
    skills, _ = load_skills(_skills_dir(ctx))
    for s in skills:
        if s.name == name:
            if not s.visible(ctx.mode):
                return tool_error(f"Skill {name} ist im Modus {ctx.mode} nicht verfügbar")
            return tool_ok(name=s.name, description=s.description, mode=s.mode, body=s.body)
    return tool_error(f"Skill {name!r} nicht gefunden")


def skill_new(args: dict, ctx: ToolContext) -> str:
    name = str(args.get("name") or "").strip().lower()
    if not re.match(r"^[a-z0-9][a-z0-9-]{1,40}$", name):
        return tool_error("skill_new: name muss kebab-case sein (a-z, 0-9, Bindestrich)")
    desc = str(args.get("description") or "").strip()
    if not desc or len(desc) > MAX_DESCRIPTION:
        return tool_error(f"skill_new: description muss 1–{MAX_DESCRIPTION} Zeichen haben (ist {len(desc)})")
    mode = str(args.get("mode") or "both")
    if mode not in ("developer", "user", "both"):
        return tool_error("skill_new: mode muss developer, user oder both sein")
    d = _skills_dir(ctx) / name
    if (d / "SKILL.md").exists():
        return tool_error(f"Skill {name} existiert bereits: {d}")
    d.mkdir(parents=True, exist_ok=True)
    (d / "scripts").mkdir(exist_ok=True)
    fm = {"name": name, "description": desc, "version": "0.1.0", "mode": mode, "tools": [], "platforms": []}
    body = str(args.get("body") or f"# /{name}\n\nAnleitung: was der Skill tut, Schritt für Schritt.\n\n## Skripte\n\n`scripts/` für alles Nicht-Triviale — kein Inline-Parser je Aufruf.\n")
    (d / "SKILL.md").write_text(dump_frontmatter(fm, body), encoding="utf-8")
    return tool_ok(created=str(d / "SKILL.md"), hinweis="Skill erscheint ab der nächsten Session im Index (oder /now)")


registry.register("skill_list", "both", {
    "description": "Listet die im aktuellen Modus verfügbaren Skills (Slash-Befehle).",
    "parameters": {"type": "object", "properties": {}},
}, skill_list)

registry.register("skill_read", "both", {
    "description": "Liest die vollständige Anleitung eines Skills.",
    "parameters": {"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"]},
}, skill_read)

registry.register("skill_new", "developer", {
    "description": "Legt ein Skill-Gerüst an (SKILL.md mit Frontmatter, scripts/). Prüft die Beschreibungslänge (≤ 60 Zeichen).",
    "parameters": {"type": "object", "properties": {
        "name": {"type": "string"}, "description": {"type": "string"},
        "mode": {"type": "string", "enum": ["developer", "user", "both"]}, "body": {"type": "string"}},
        "required": ["name", "description"]},
}, skill_new)
