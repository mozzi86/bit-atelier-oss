"""project_info / project_tasks tools — read the active workspace."""

from __future__ import annotations

from harness.tools.registry import ToolContext, registry, tool_error, tool_ok
from harness.workspace.project import Project


def _project(ctx: ToolContext) -> Project:
    if not ctx.project_dir or not ctx.projekt:
        raise ValueError("Kein aktives Projekt — /project <slug> wählen")
    return Project(ctx.projekt, ctx.project_dir)


def project_info(args: dict, ctx: ToolContext) -> str:
    try:
        p = _project(ctx)
    except ValueError as exc:
        return tool_error(str(exc))
    return tool_ok(slug=p.slug, dir=str(p.dir), meta=p.meta(), offene_aufgaben=len(p.open_tasks()))


def project_tasks(args: dict, ctx: ToolContext) -> str:
    try:
        p = _project(ctx)
    except ValueError as exc:
        return tool_error(str(exc))
    text = p.tasks_md.read_text(encoding="utf-8") if p.tasks_md.exists() else ""
    return tool_ok(offen=p.open_tasks(), tasks_md=text[:20_000])


registry.register("project_info", "both", {
    "description": "Stammdaten des aktiven Projekts (PROJECT.md-Frontmatter) und Anzahl offener Aufgaben.",
    "parameters": {"type": "object", "properties": {}},
}, project_info)

registry.register("project_tasks", "both", {
    "description": "Offene Aufgaben (tasks.md) des aktiven Projekts.",
    "parameters": {"type": "object", "properties": {}},
}, project_tasks)
