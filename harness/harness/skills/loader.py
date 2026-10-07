"""Skill loader: skills/<name>/SKILL.md → Skill objects, filtered by mode and platform.

Frontmatter: name, description (≤ 60 chars, one sentence), version, mode
(developer|user|both, default both), tools, platforms. Body = the instruction.
The system prompt gets only name + description; the body is loaded on /name.
Warnings are collected in plain text, not raised — a bad skill must not stop the harness.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from harness.workspace.frontmatter import parse_frontmatter

MAX_DESCRIPTION = 60
PLATFORM_MAP = {"windows": "win32", "win": "win32", "mac": "darwin", "macos": "darwin", "linux": "linux"}


@dataclass
class Skill:
    name: str
    description: str
    mode: str
    body: str
    path: Path
    version: str = "0"
    tools: list[str] = field(default_factory=list)
    platforms: list[str] = field(default_factory=list)

    def visible(self, mode: str) -> bool:
        return self.mode in ("both", mode) and platform_ok(self.platforms)


def platform_ok(platforms: list[str] | str | None) -> bool:
    if not platforms:
        return True
    items = platforms if isinstance(platforms, list) else [platforms]
    for p in items:
        mapped = PLATFORM_MAP.get(str(p).lower().strip(), str(p).lower().strip())
        if sys.platform.startswith(mapped):
            return True
    return False


def _as_list(v: Any) -> list[str]:
    if v is None:
        return []
    if isinstance(v, list):
        return [str(x) for x in v]
    return [s.strip() for s in str(v).split(",") if s.strip()]


def load_skills(skills_dir: Path, *, extra_dirs: list[Path] | None = None) -> tuple[list[Skill], list[str]]:
    skills: list[Skill] = []
    warnings: list[str] = []
    dirs = [skills_dir] + list(extra_dirs or [])
    seen: set[str] = set()
    for base in dirs:
        if not base.exists():
            continue
        for md in sorted(base.glob("*/SKILL.md")):
            fm, body = parse_frontmatter(md.read_text(encoding="utf-8"))
            name = str(fm.get("name") or md.parent.name).strip()
            if name in seen:
                warnings.append(f"Skill {name!r} doppelt ({md}) — erste Fassung gewinnt")
                continue
            desc = str(fm.get("description") or "").strip()
            if not desc:
                warnings.append(f"Skill {name!r}: description fehlt ({md})")
            elif len(desc) > MAX_DESCRIPTION:
                warnings.append(f"Skill {name!r}: description hat {len(desc)} Zeichen, erlaubt sind {MAX_DESCRIPTION} — wird gekürzt")
                desc = desc[:MAX_DESCRIPTION - 1].rstrip() + "…"
            mode = str(fm.get("mode") or "both").strip()
            if mode not in ("developer", "user", "both"):
                warnings.append(f"Skill {name!r}: mode {mode!r} unbekannt — auf developer gesetzt (sicherer Fehler)")
                mode = "developer"
            skills.append(Skill(
                name=name, description=desc, mode=mode, body=body.strip(), path=md,
                version=str(fm.get("version") or "0"), tools=_as_list(fm.get("tools")),
                platforms=_as_list(fm.get("platforms")),
            ))
            seen.add(name)
    return skills, warnings


def skills_index(skills: list[Skill], mode: str) -> list[tuple[str, str]]:
    return [(s.name, s.description) for s in skills if s.visible(mode)]
