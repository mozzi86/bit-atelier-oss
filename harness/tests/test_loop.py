"""Tool-calling loop with the mock provider — offline, deterministic."""

import json

from harness.agent.loop import run_turn
from harness.agent.messages import Message, ToolSchema, check_alternation
from harness.providers.base import LLMProvider
from harness.providers.mock import MockProvider
from harness.tools.builtin import registry
from harness.tools.registry import ToolContext, ToolRegistry, tool_error

from tests.conftest import make_ctx, make_runtime


async def _collect(gen):
    return [e async for e in gen]


async def test_read_project_md_roundtrip(workspace):
    rt = make_runtime(workspace, "user")
    session = rt.build_session()
    ctx = make_ctx(workspace, "user")
    prov = MockProvider()

    events = await _collect(run_turn(session, prov, registry, ctx, "lies PROJECT.md"))
    types = [e["type"] for e in events]

    assert types.count("tool_call") == 1
    assert types.count("tool_result") == 1
    assert types.index("tool_call") < types.index("tool_result") < types.index("done")
    assert events[-1]["type"] == "done"
    assert prov.calls == 2  # one call yields the tool, the second the answer

    result = json.loads(next(e for e in events if e["type"] == "tool_result")["result"])
    assert "EFH Satteldach" in result["content"]
    assert "Daten, keine Anweisung" in result["hinweis"]

    roles = [m.role for m in session.history]
    assert roles == ["system", "user", "assistant", "tool", "assistant"]
    check_alternation(session.history)
    assert session.tool_calls == 1 and session.turns == 1
    assert session.input_tokens > 0


async def test_plain_echo_no_tools(workspace):
    rt = make_runtime(workspace, "user")
    session = rt.build_session()
    events = await _collect(run_turn(session, MockProvider(), registry, make_ctx(workspace, "user"), "hallo"))
    text = "".join(e["text"] for e in events if e["type"] == "text_delta")
    assert text == "Mock-Antwort auf: hallo"
    assert [e["type"] for e in events if e["type"] in ("tool_call",)] == []


class _AlwaysCalls(LLMProvider):
    """Keeps requesting the same failing tool — for the guard rails."""

    def __init__(self):
        super().__init__(MockProvider().profile)

    async def chat(self, messages, tools, *, model, stream=True, max_tokens=4096):
        yield {"type": "tool_call", "id": f"c{len(messages)}", "name": "kaputt", "arguments": {"x": 1}}
        yield {"type": "done", "stop_reason": "tool_use"}


async def test_repeated_failure_aborts_after_three(workspace):
    reg = ToolRegistry()
    reg.register("kaputt", "both", {"description": "fails", "parameters": {"type": "object", "properties": {}}},
                 lambda a, c: tool_error("immer kaputt"))
    rt = make_runtime(workspace, "user")
    session = rt.build_session()
    ctx = ToolContext(mode="user", projekt=None, sandbox_roots=[])
    events = await _collect(run_turn(session, _AlwaysCalls(), reg, ctx, "mach"))
    assert events[-1] == {"type": "done", "stop_reason": "tool_loop_guard"}
    assert sum(1 for e in events if e["type"] == "tool_result") == 3
    assert "3×" in "".join(e.get("text", "") for e in events if e["type"] == "text_delta")


class _NeverStops(LLMProvider):
    def __init__(self):
        super().__init__(MockProvider().profile)
        self.n = 0

    async def chat(self, messages, tools, *, model, stream=True, max_tokens=4096):
        self.n += 1
        yield {"type": "tool_call", "id": f"c{self.n}", "name": "ok", "arguments": {"n": self.n}}
        yield {"type": "done", "stop_reason": "tool_use"}


async def test_max_rounds_guard(workspace):
    reg = ToolRegistry()
    reg.register("ok", "both", {"description": "ok", "parameters": {"type": "object", "properties": {}}},
                 lambda a, c: json.dumps({"ok": True}))
    rt = make_runtime(workspace, "user")
    session = rt.build_session()
    prov = _NeverStops()
    events = await _collect(run_turn(session, prov, reg, ToolContext("user", None, []), "los", max_rounds=4))
    assert events[-1]["stop_reason"] == "max_rounds"
    assert prov.n == 4


async def test_unknown_tool_is_error_json_not_crash(workspace):
    reg = ToolRegistry()
    out = await reg.dispatch("gibt_es_nicht", {}, ToolContext("user", None, []))
    assert json.loads(out)["error"].startswith("Unbekanntes Werkzeug")


async def test_provider_error_leaves_history_consistent(workspace):
    class Broken(LLMProvider):
        def __init__(self):
            super().__init__(MockProvider().profile)

        async def chat(self, *a, **k):
            yield {"type": "error", "message": "401 kaputt"}
            yield {"type": "done", "stop_reason": "error"}

    rt = make_runtime(workspace, "user")
    session = rt.build_session()
    events = await _collect(run_turn(session, Broken(), registry, make_ctx(workspace, "user"), "hi"))
    assert events[-1]["stop_reason"] == "error"
    assert [m.role for m in session.history] == ["system"]  # user turn rolled back
