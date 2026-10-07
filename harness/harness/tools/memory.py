"""memory_save / memory_list / memory_read tools on the active project's memory/."""

from __future__ import annotations

from harness.tools.registry import ToolContext, registry, tool_error, tool_ok
from harness.workspace import memory as mem


def _dir(ctx: ToolContext):
    if not ctx.project_dir:
        raise ValueError("Kein aktives Projekt — /project <slug> wählen")
    return ctx.project_dir / "memory"


def memory_save(args: dict, ctx: ToolContext) -> str:
    try:
        fact = mem.save_fact(_dir(ctx), str(args.get("name") or ""), str(args.get("description") or ""),
                             str(args.get("type") or "project"), str(args.get("text") or ""))
    except (ValueError, OSError) as exc:
        return tool_error(str(exc))
    return tool_ok(saved=fact.name, path=str(fact.path), hinweis="wirkt im System-Prompt ab der nächsten Session")


def memory_list(args: dict, ctx: ToolContext) -> str:
    try:
        facts = mem.load_facts(_dir(ctx))
    except ValueError as exc:
        return tool_error(str(exc))
    return tool_ok(count=len(facts), facts=[{"name": f.name, "description": f.description, "type": f.type} for f in facts])


def memory_read(args: dict, ctx: ToolContext) -> str:
    name = mem.slugify(str(args.get("name") or ""))
    try:
        facts = {f.name: f for f in mem.load_facts(_dir(ctx))}
    except ValueError as exc:
        return tool_error(str(exc))
    f = facts.get(name)
    if not f:
        return tool_error(f"Memory {name!r} nicht vorhanden")
    return tool_ok(name=f.name, description=f.description, type=f.type, text=f.body)


registry.register("memory_save", "both", {
    "description": "Speichert einen bleibenden Fakt zum Projekt (eine Datei = ein Fakt, Indexzeile in MEMORY.md). Gleicher Name ersetzt.",
    "parameters": {"type": "object", "properties": {
        "name": {"type": "string", "description": "kurzer kebab-case-Name"},
        "description": {"type": "string", "description": "eine Zeile, wofür der Fakt steht"},
        "type": {"type": "string", "enum": list(mem.MEMORY_TYPES)},
        "text": {"type": "string"}}, "required": ["name", "description", "text"]},
}, memory_save)

registry.register("memory_list", "both", {
    "description": "Listet die gespeicherten Memory-Fakten des Projekts (Name, Beschreibung, Typ).",
    "parameters": {"type": "object", "properties": {}},
}, memory_list)

registry.register("memory_read", "both", {
    "description": "Liest den Volltext eines Memory-Fakts.",
    "parameters": {"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"]},
}, memory_read)
