"""Slash commands: `/name rest` → the skill body plus "Argumente: rest" as the user turn.

Built-in commands (/status, /project, /model, /skills, /quit, /help) are handled by
the CLI/server, not here; this module only resolves skill invocations.
"""

from __future__ import annotations

from harness.skills.loader import Skill

BUILTIN = ("status", "project", "model", "skills", "quit", "help", "now")


def parse_slash(text: str) -> tuple[str, str] | None:
    t = text.strip()
    if not t.startswith("/") or len(t) < 2:
        return None
    head, _, rest = t[1:].partition(" ")
    return head.strip().lower(), rest.strip()


def expand_skill(skills: list[Skill], mode: str, name: str, args: str) -> str:
    for s in skills:
        if s.name.lower() == name.lower():
            if not s.visible(mode):
                raise PermissionError(f"Skill /{s.name} ist im Modus {mode} nicht verfügbar")
            turn = f"[Skill /{s.name}]\n{s.body}"
            if args:
                turn += f"\n\nArgumente: {args}"
            return turn
    raise KeyError(f"Unbekannter Skill: /{name} — /skills zeigt die Liste")
