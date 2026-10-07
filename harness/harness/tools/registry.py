"""Tool registry (Hermes pattern): register(name, toolset, schema, handler, check_fn).

Handlers return a JSON string: `(args: dict, ctx: ToolContext) -> str`, sync or
async. Toolsets are the operating modes — `developer`, `user`, or `both`. A tool
is offered to the model only when its toolset matches the mode AND check_fn()
(if given) returns True. Errors never escape: they come back as {"error": …}.
"""

from __future__ import annotations

import inspect
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Awaitable, Callable

from harness.agent.messages import ToolSchema

TOOLSETS = ("developer", "user", "both")
MAX_RESULT_CHARS = 60_000

ApproveFn = Callable[[str, str, str], Awaitable[bool]]  # (approval_id, befehl, erklaerung) -> ja?


async def _deny_all(approval_id: str, befehl: str, erklaerung: str) -> bool:
    return False


@dataclass
class ToolContext:
    mode: str
    projekt: str | None
    sandbox_roots: list[Path]
    approve: ApproveFn = _deny_all
    project_dir: Path | None = None
    repo_root: Path | None = None
    skills_dir: Path | None = None
    extra: dict[str, Any] = field(default_factory=dict)


def tool_error(message: str) -> str:
    return json.dumps({"error": message}, ensure_ascii=False)


def tool_ok(**payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False)


@dataclass
class ToolEntry:
    name: str
    toolset: str
    schema: ToolSchema
    handler: Callable[..., Any]
    check_fn: Callable[[], bool] | None = None

    def available(self, mode: str) -> bool:
        if self.toolset not in ("both", mode):
            return False
        if self.check_fn is not None:
            try:
                return bool(self.check_fn())
            except Exception:
                return False
        return True


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, ToolEntry] = {}

    def register(
        self, name: str, toolset: str, schema: ToolSchema | dict[str, Any],
        handler: Callable[..., Any], check_fn: Callable[[], bool] | None = None,
    ) -> None:
        if toolset not in TOOLSETS:
            raise ValueError(f"Tool {name!r}: toolset {toolset!r} unbekannt (developer|user|both)")
        if isinstance(schema, dict):
            schema = ToolSchema(name=name, description=schema["description"], parameters=schema["parameters"])
        if schema.name != name:
            raise ValueError(f"Tool {name!r}: Schema-Name {schema.name!r} passt nicht")
        self._tools[name] = ToolEntry(name, toolset, schema, handler, check_fn)

    def names(self, mode: str) -> list[str]:
        return [n for n, e in self._tools.items() if e.available(mode)]

    def schemas(self, mode: str) -> list[ToolSchema]:
        return [e.schema for e in self._tools.values() if e.available(mode)]

    def has(self, name: str) -> bool:
        return name in self._tools

    async def dispatch(self, name: str, args: dict[str, Any] | None, ctx: ToolContext) -> str:
        entry = self._tools.get(name)
        if entry is None:
            return tool_error(f"Unbekanntes Werkzeug: {name}")
        if not entry.available(ctx.mode):
            return tool_error(f"Werkzeug {name} ist im Modus {ctx.mode} nicht verfügbar")
        try:
            result = entry.handler(dict(args or {}), ctx)
            if inspect.isawaitable(result):
                result = await result
        except Exception as exc:  # the model must see the failure, not a crash
            return tool_error(f"{name}: {exc.__class__.__name__}: {exc}")
        if not isinstance(result, str):
            result = json.dumps(result, ensure_ascii=False, default=str)
        if len(result) > MAX_RESULT_CHARS:
            result = result[:MAX_RESULT_CHARS] + "\n… [gekürzt]"
        return result


# Module-level default registry; tool modules register into it at import time.
registry = ToolRegistry()
