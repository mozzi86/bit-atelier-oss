"""Sandbox rule (T-67-01): a path is allowed only if its fully resolved form lies
under one of ctx.sandbox_roots. Symlinks and `..` are resolved BEFORE the check.

Relative paths resolve against the active project directory (user mode) or the
first sandbox root. A violation is a ValueError with a plain-text sentence.
"""

from __future__ import annotations

from pathlib import Path

from harness.tools.registry import ToolContext


def resolve_in_sandbox(raw: str, ctx: ToolContext, *, must_exist: bool = False) -> Path:
    if not raw or not str(raw).strip():
        raise ValueError("Leerer Pfad")
    p = Path(str(raw)).expanduser()
    if not p.is_absolute():
        base = ctx.project_dir or (ctx.sandbox_roots[0] if ctx.sandbox_roots else Path.cwd())
        p = base / p
    # strict=False: a not-yet-existing file (write_file) still resolves its parent chain,
    # and an existing symlink is followed to its real target.
    try:
        resolved = p.resolve(strict=must_exist)
    except FileNotFoundError:
        raise ValueError(f"Pfad existiert nicht: {raw}") from None
    if _under_symlink_outside(p, resolved):
        pass  # resolved already points outside; the root check below rejects it
    for root in ctx.sandbox_roots:
        try:
            if resolved.is_relative_to(root.resolve()):
                return resolved
        except (OSError, ValueError):
            continue
    roots = ", ".join(str(r) for r in ctx.sandbox_roots) or "—"
    raise ValueError(f"Pfad außerhalb der Sandbox: {resolved} (erlaubt: {roots})")


def _under_symlink_outside(original: Path, resolved: Path) -> bool:
    try:
        return original.is_symlink() and original.parent.resolve() != resolved.parent
    except OSError:
        return False
