"""File tools: read_file, write_file, search_files, list_dir — all through the sandbox.

Results are JSON strings. File contents are prefixed with the data-not-instruction
marker (prompt-injection defence, Research §2).
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path

from harness.agent.context import DATA_NOT_INSTRUCTION
from harness.tools.registry import ToolContext, registry, tool_error, tool_ok
from harness.tools.sandbox import resolve_in_sandbox

MAX_READ_CHARS = 40_000
SKIP_DIRS = {".git", "node_modules", ".venv", "__pycache__", "dist", ".vite"}


def read_file(args: dict, ctx: ToolContext) -> str:
    try:
        p = resolve_in_sandbox(args.get("path", ""), ctx, must_exist=True)
    except ValueError as exc:
        return tool_error(str(exc))
    if not p.is_file():
        return tool_error(f"Keine Datei: {p}")
    try:
        text = p.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        return tool_error(f"Lesen fehlgeschlagen: {exc}")
    truncated = len(text) > MAX_READ_CHARS
    return tool_ok(path=str(p), hinweis=DATA_NOT_INSTRUCTION, truncated=truncated,
                   content=text[:MAX_READ_CHARS])


def write_file(args: dict, ctx: ToolContext) -> str:
    try:
        p = resolve_in_sandbox(args.get("path", ""), ctx)
    except ValueError as exc:
        return tool_error(str(exc))
    content = args.get("content")
    if not isinstance(content, str):
        return tool_error("write_file: content (Text) fehlt")
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        existed = p.exists()
        p.write_text(content, encoding="utf-8")
    except OSError as exc:
        return tool_error(f"Schreiben fehlgeschlagen: {exc}")
    return tool_ok(path=str(p), bytes=len(content.encode("utf-8")), overwritten=existed)


def list_dir(args: dict, ctx: ToolContext) -> str:
    try:
        p = resolve_in_sandbox(args.get("path") or ".", ctx, must_exist=True)
    except ValueError as exc:
        return tool_error(str(exc))
    if not p.is_dir():
        return tool_error(f"Kein Verzeichnis: {p}")
    entries = []
    for child in sorted(p.iterdir(), key=lambda c: (not c.is_dir(), c.name.lower())):
        if child.name in SKIP_DIRS:
            continue
        entries.append({"name": child.name, "type": "dir" if child.is_dir() else "file",
                        "size": child.stat().st_size if child.is_file() else None})
    return tool_ok(path=str(p), entries=entries[:500], count=len(entries))


def _rg_available() -> bool:
    return shutil.which("rg") is not None


def search_files(args: dict, ctx: ToolContext) -> str:
    pattern = str(args.get("pattern") or "").strip()
    if not pattern:
        return tool_error("search_files: pattern fehlt")
    try:
        root = resolve_in_sandbox(args.get("path") or ".", ctx, must_exist=True)
    except ValueError as exc:
        return tool_error(str(exc))
    glob = args.get("glob")
    max_hits = int(args.get("max_results") or 200)
    hits: list[dict] = []

    if _rg_available():
        # Paths with spaces are safe: subprocess takes a list, no shell.
        cmd = ["rg", "--no-heading", "--line-number", "--color", "never", "--max-count", "50", "-e", pattern]
        if glob:
            cmd += ["--glob", str(glob)]
        cmd.append(str(root))
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60)
        except (subprocess.TimeoutExpired, OSError) as exc:
            return tool_error(f"ripgrep fehlgeschlagen: {exc}")
        if proc.returncode not in (0, 1):
            return tool_error(f"ripgrep: {proc.stderr.strip()[:400]}")
        for line in proc.stdout.splitlines():
            m = re.match(r"^(.*?):(\d+):(.*)$", line)
            if m:
                hits.append({"file": m.group(1), "line": int(m.group(2)), "text": m.group(3)[:300]})
            if len(hits) >= max_hits:
                break
    else:
        try:
            rx = re.compile(pattern)
        except re.error as exc:
            return tool_error(f"Ungültiges Muster: {exc}")
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
            for fn in filenames:
                fp = Path(dirpath) / fn
                if glob and not fp.match(str(glob)):
                    continue
                try:
                    with fp.open("r", encoding="utf-8", errors="replace") as fh:
                        for no, line in enumerate(fh, 1):
                            if rx.search(line):
                                hits.append({"file": str(fp), "line": no, "text": line.rstrip()[:300]})
                                if len(hits) >= max_hits:
                                    break
                except OSError:
                    continue
                if len(hits) >= max_hits:
                    break
            if len(hits) >= max_hits:
                break
    return tool_ok(pattern=pattern, root=str(root), hinweis=DATA_NOT_INSTRUCTION, hits=hits, count=len(hits))


registry.register("read_file", "both", {
    "description": "Liest eine Textdatei innerhalb der Sandbox (Projektordner; im Developer-Modus auch das App-Repo).",
    "parameters": {"type": "object", "properties": {"path": {"type": "string", "description": "Pfad, relativ zum Projekt oder absolut"}}, "required": ["path"]},
}, read_file)

registry.register("write_file", "both", {
    "description": "Schreibt eine Textdatei innerhalb der Sandbox (überschreibt, legt Ordner an).",
    "parameters": {"type": "object", "properties": {"path": {"type": "string"}, "content": {"type": "string"}}, "required": ["path", "content"]},
}, write_file)

registry.register("list_dir", "both", {
    "description": "Listet ein Verzeichnis innerhalb der Sandbox.",
    "parameters": {"type": "object", "properties": {"path": {"type": "string", "description": "Standard: Projektordner"}}},
}, list_dir)

registry.register("search_files", "both", {
    "description": "Sucht ein Regex-Muster in Dateien innerhalb der Sandbox (ripgrep, sonst Python).",
    "parameters": {"type": "object", "properties": {
        "pattern": {"type": "string"}, "path": {"type": "string"}, "glob": {"type": "string", "description": "z. B. *.md"},
        "max_results": {"type": "integer"}}, "required": ["pattern"]},
}, search_files)
