"""Tool-calling loop on the internal message schema.

In: Session (history), LLMProvider, ToolRegistry + ToolContext, user text.
Out: an async iterator of Events — the WebSocket route forwards them 1:1, the CLI
prints them. The loop appends to session.history itself and keeps the strict
role alternation: user → assistant(tool_calls) → tool* → assistant → …

Guard rails (T-67-04): at most `max_rounds` model calls per user turn; the same
tool call (name + arguments) failing three times in a row aborts with plain text.
"""

from __future__ import annotations

import json
from typing import Any, AsyncIterator

from harness.agent.messages import (
    Message, ToolCall, check_alternation, ev_done, ev_error, ev_notice, ev_text_delta,
    ev_tool_result, ev_usage,
)
from harness.agent.session import Session
from harness.providers.base import LLMProvider
from harness.tools.registry import ToolContext, ToolRegistry

REPEAT_FAIL_LIMIT = 3


def _call_key(tc: ToolCall) -> str:
    return tc.name + ":" + json.dumps(tc.arguments, sort_keys=True, ensure_ascii=False)


def _is_error_result(result: str) -> bool:
    try:
        data = json.loads(result)
    except (json.JSONDecodeError, TypeError):
        return False
    return isinstance(data, dict) and "error" in data


async def run_turn(
    session: Session,
    provider: LLMProvider,
    registry: ToolRegistry,
    ctx: ToolContext,
    user_text: str,
    *,
    max_rounds: int = 20,
    max_tokens: int = 4096,
    nudge_every: int = 0,
    compression: Any = None,
) -> AsyncIterator[dict[str, Any]]:
    # Compression runs once per turn, BEFORE the new user message is appended, so the
    # last protected messages and the fresh turn stay verbatim.
    if compression is not None:
        cev = await compression.run(session, provider)
        if cev is not None:
            if cev.get("type") == "compression":
                session.compressions += 1
            yield cev
    session.history.append(Message(role="user", content=user_text))
    session.turns += 1
    tools = registry.schemas(ctx.mode)
    fail_count: dict[str, int] = {}

    for round_no in range(1, max_rounds + 1):
        try:
            check_alternation(session.history)
        except ValueError as exc:
            yield ev_error(f"Verlauf verletzt die Rollen-Reihenfolge: {exc}")
            yield ev_done("error")
            return

        text_parts: list[str] = []
        calls: list[ToolCall] = []
        stop_reason = "end_turn"
        errored = False

        async for ev in provider.chat(session.history, tools, model=session.model, max_tokens=max_tokens):
            t = ev.get("type")
            if t == "text_delta":
                text_parts.append(ev["text"])
                yield ev
            elif t == "tool_call":
                calls.append(ToolCall(id=ev["id"], name=ev["name"], arguments=ev.get("arguments") or {}))
                yield ev
            elif t == "usage":
                session.add_usage(ev["input_tokens"], ev["output_tokens"], estimated=bool(ev.get("estimated")))
                yield ev
            elif t == "error":
                errored = True
                yield ev
            elif t == "done":
                stop_reason = ev.get("stop_reason", "end_turn")
            else:
                yield ev

        if errored:
            # Keep the history consistent: the user turn stays, no half assistant turn.
            if session.history and session.history[-1].role == "user":
                session.history.pop()
                session.turns -= 1
            yield ev_done("error")
            return

        session.history.append(Message(role="assistant", content="".join(text_parts), tool_calls=calls))

        if not calls:
            if nudge_every and session.turns % nudge_every == 0:
                yield ev_notice("Gibt es aus den letzten Turns etwas Bleibendes für das Memory? (memory_save)")
            yield ev_done(stop_reason)
            return

        for tc in calls:
            session.tool_calls += 1
            result = await registry.dispatch(tc.name, tc.arguments, ctx)
            yield ev_tool_result(tc.id, tc.name, result)
            session.history.append(Message(role="tool", content=result, tool_call_id=tc.id, name=tc.name))

            key = _call_key(tc)
            if _is_error_result(result):
                fail_count[key] = fail_count.get(key, 0) + 1
                if fail_count[key] >= REPEAT_FAIL_LIMIT:
                    msg = (f"Abbruch: der Aufruf {tc.name} mit denselben Argumenten ist {REPEAT_FAIL_LIMIT}× "
                           "hintereinander fehlgeschlagen. Bitte anders vorgehen oder den Nutzer fragen.")
                    session.history.append(Message(role="assistant", content=msg))
                    yield ev_text_delta(msg)
                    yield ev_done("tool_loop_guard")
                    return
            else:
                fail_count.pop(key, None)

    msg = f"Abbruch: {max_rounds} Werkzeug-Runden erreicht, ohne dass eine Antwort entstand."
    session.history.append(Message(role="assistant", content=msg))
    yield ev_text_delta(msg)
    yield ev_done("max_rounds")


__all__ = ["run_turn", "ev_usage"]
