"""shell tool: runs a command after allowlist/blocklist/approval judgement.

Commands run without a shell where possible (argument list), cwd = project dir or
repo root (developer). Output is captured with a timeout; secrets are redacted
before the result reaches the model.
"""

from __future__ import annotations

import asyncio
import os
import shlex
import subprocess
import uuid

from harness.config import load_config
from harness.jsonlog import redact
from harness.tools import allowlist
from harness.tools.registry import ToolContext, registry, tool_error, tool_ok

_CFG_ALLOWLIST: tuple[str, ...]
_TIMEOUT_S: int
try:
    _c = load_config()
    _CFG_ALLOWLIST, _TIMEOUT_S = _c.shell_allowlist, _c.shell_timeout_s
except Exception:
    from harness.config import DEFAULT_ALLOWLIST
    _CFG_ALLOWLIST, _TIMEOUT_S = tuple(DEFAULT_ALLOWLIST), 120


def _split(command: str) -> list[str]:
    try:
        return shlex.split(command, posix=(os.name != "nt"))
    except ValueError:
        return command.split()


async def shell(args: dict, ctx: ToolContext) -> str:
    command = str(args.get("command") or "")
    allow = tuple(ctx.extra.get("allowlist") or _CFG_ALLOWLIST)
    verdict = allowlist.judge(command, mode=ctx.mode, allowlist=allow)

    if verdict.kind == "block":
        return tool_error(f"Befehl abgelehnt: {verdict.erklaerung} — `{allowlist.normalise(command)}`")
    if verdict.kind == "approve":
        approval_id = uuid.uuid4().hex[:8]
        ja = await ctx.approve(approval_id, allowlist.normalise(command), verdict.erklaerung)
        if not ja:
            return tool_error(f"Nutzer hat den Befehl nicht bestätigt: `{allowlist.normalise(command)}`")

    cwd = ctx.project_dir if ctx.mode == "user" else (ctx.repo_root or ctx.project_dir)
    timeout = int(ctx.extra.get("timeout_s") or _TIMEOUT_S)
    argv = _split(command)
    if not argv:
        return tool_error("leerer Befehl")

    def _run() -> subprocess.CompletedProcess:
        # Windows: run the string through cmd.exe — built-ins (dir, type) exist only there and
        # list-form quoting of nested quotes (python -c "print('x')") is lossy. The command has
        # already passed blocklist + allowlist/approval, so the shell adds no new reach.
        use_shell = os.name == "nt"
        return subprocess.run(
            command if use_shell else argv, shell=use_shell, cwd=str(cwd) if cwd else None,
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout,
        )

    try:
        proc = await asyncio.get_running_loop().run_in_executor(None, _run)
    except subprocess.TimeoutExpired:
        return tool_error(f"Zeitüberschreitung nach {timeout}s: `{command}`")
    except FileNotFoundError:
        return tool_error(f"Programm nicht gefunden: {argv[0]}")
    except OSError as exc:
        return tool_error(f"Start fehlgeschlagen: {exc}")

    return tool_ok(command=command, cwd=str(cwd) if cwd else None, returncode=proc.returncode,
                   stdout=redact(proc.stdout[-20_000:]), stderr=redact(proc.stderr[-8_000:]))


registry.register("shell", "both", {
    "description": ("Führt einen Shell-Befehl aus. Nur-Lese-Befehle der Allowlist laufen sofort; andere "
                    "werden dem Nutzer mit Erklärung zur Bestätigung gezeigt (nur Developer-Modus). "
                    "Zerstörerische Befehle sind gesperrt."),
    "parameters": {"type": "object", "properties": {"command": {"type": "string"}}, "required": ["command"]},
}, shell)
