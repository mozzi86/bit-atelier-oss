"""Project workspace: locate, list, create and read projects/<slug>/.

PROJECT.md frontmatter: typ, bauherr, ort, leistungsphase, stand. tasks.md holds
`- [ ]` lines; open_tasks() counts them for /status.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from harness.workspace.frontmatter import dump_frontmatter, parse_frontmatter

SUBDIRS = ("memory", "files", "model")
SLUG_RX = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")


@dataclass
class Project:
    slug: str
    dir: Path

    @property
    def project_md(self) -> Path:
        return self.dir / "PROJECT.md"

    @property
    def memory_dir(self) -> Path:
        return self.dir / "memory"

    @property
    def tasks_md(self) -> Path:
        return self.dir / "tasks.md"

    def meta(self) -> dict[str, Any]:
        if not self.project_md.exists():
            return {}
        fm, _ = parse_frontmatter(self.project_md.read_text(encoding="utf-8"))
        return fm

    def project_text(self) -> str:
        return self.project_md.read_text(encoding="utf-8") if self.project_md.exists() else ""

    def open_tasks(self) -> list[str]:
        if not self.tasks_md.exists():
            return []
        return [ln.strip()[6:].strip() for ln in self.tasks_md.read_text(encoding="utf-8").splitlines()
                if ln.strip().startswith("- [ ]")]


def list_projects(projects_dir: Path) -> list[Project]:
    if not projects_dir.exists():
        return []
    return [Project(p.name, p) for p in sorted(projects_dir.iterdir()) if p.is_dir() and (p / "PROJECT.md").exists()]


def get_project(projects_dir: Path, slug: str) -> Project:
    if not SLUG_RX.match(slug or ""):
        raise ValueError(f"Ungültiger Projekt-Slug: {slug!r} (a-z, 0-9, Bindestrich)")
    p = Project(slug, projects_dir / slug)
    if not p.project_md.exists():
        raise FileNotFoundError(f"Projekt {slug!r} nicht gefunden unter {projects_dir}")
    return p


def create_project(projects_dir: Path, slug: str, meta: dict[str, Any], body: str = "") -> Project:
    if not SLUG_RX.match(slug or ""):
        raise ValueError(f"Ungültiger Projekt-Slug: {slug!r}")
    d = projects_dir / slug
    if (d / "PROJECT.md").exists():
        raise FileExistsError(f"Projekt {slug!r} existiert bereits")
    for sub in SUBDIRS:
        (d / sub).mkdir(parents=True, exist_ok=True)
    fm = {k: meta.get(k) for k in ("typ", "bauherr", "ort", "leistungsphase", "stand")}
    (d / "PROJECT.md").write_text(dump_frontmatter(fm, body or f"# {slug}\n"), encoding="utf-8")
    (d / "tasks.md").write_text("# Aufgaben\n\n", encoding="utf-8")
    (d / "memory" / "MEMORY.md").write_text("# Memory-Index\n\n", encoding="utf-8")
    return Project(slug, d)
