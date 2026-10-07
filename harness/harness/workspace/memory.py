"""Memory: one file = one fact (frontmatter name/description/type), MEMORY.md index.

Compatible with the user's Claude Code memory format. Saving the same name again
replaces the file and its index line instead of duplicating.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from harness.workspace.frontmatter import dump_frontmatter, parse_frontmatter

MEMORY_TYPES = ("user", "project", "reference", "feedback")
NAME_RX = re.compile(r"^[a-z0-9][a-z0-9-]{0,79}$")


@dataclass
class Fact:
    name: str
    description: str
    type: str
    body: str
    path: Path


_UMLAUTE = str.maketrans({"ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss"})


def slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", name.strip().lower().translate(_UMLAUTE)).strip("-")
    return s[:80] or "fakt"


def load_facts(memory_dir: Path) -> list[Fact]:
    if not memory_dir.exists():
        return []
    facts: list[Fact] = []
    for p in sorted(memory_dir.glob("*.md")):
        if p.name == "MEMORY.md":
            continue
        fm, body = parse_frontmatter(p.read_text(encoding="utf-8"))
        facts.append(Fact(
            name=str(fm.get("name") or p.stem),
            description=str(fm.get("description") or ""),
            type=str(fm.get("type") or "project"),
            body=body.strip(),
            path=p,
        ))
    return facts


def _rewrite_index(memory_dir: Path) -> None:
    facts = load_facts(memory_dir)
    lines = ["# Memory-Index", ""]
    lines += [f"- [{f.name}]({f.path.name}) — {f.description}" for f in facts]
    (memory_dir / "MEMORY.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def save_fact(memory_dir: Path, name: str, description: str, type_: str, body: str) -> Fact:
    slug = slugify(name)
    if not NAME_RX.match(slug):
        raise ValueError(f"Ungültiger Memory-Name: {name!r}")
    if type_ not in MEMORY_TYPES:
        raise ValueError(f"Memory-Typ {type_!r} unbekannt (erlaubt: {', '.join(MEMORY_TYPES)})")
    if not description.strip():
        raise ValueError("description fehlt (eine Zeile, wofür der Fakt steht)")
    memory_dir.mkdir(parents=True, exist_ok=True)
    path = memory_dir / f"{slug}.md"
    fm = {"name": slug, "description": description.strip(), "type": type_}
    path.write_text(dump_frontmatter(fm, body), encoding="utf-8")
    _rewrite_index(memory_dir)
    return Fact(slug, description.strip(), type_, body.strip(), path)


def delete_fact(memory_dir: Path, name: str) -> bool:
    path = memory_dir / f"{slugify(name)}.md"
    if not path.exists():
        return False
    path.unlink()
    _rewrite_index(memory_dir)
    return True


def index_text(memory_dir: Path) -> str:
    p = memory_dir / "MEMORY.md"
    return p.read_text(encoding="utf-8") if p.exists() else ""
