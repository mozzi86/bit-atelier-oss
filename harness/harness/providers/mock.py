"""Deterministic offline provider — the basis of every test and the no-key fallback.

Behaviour: if the latest user prompt starts with/contains "lies <pfad>" and no tool
result has been returned yet in this turn, emit ONE read_file tool call. After a
tool result, answer with a fixed summary of it. Otherwise echo the prompt.
"""

from __future__ import annotations

import re
from typing import Any, AsyncIterator

from harness.agent.messages import (
    Message, ToolCall, ToolSchema, ev_done, ev_text_delta, ev_tool_call, ev_usage,
)
from harness.providers.base import LLMProvider, ProviderProfile

MOCK_PROFILE = ProviderProfile(
    name="mock", api_mode="mock", models=("mock-1",), default_model="mock-1",
    aux_model="mock-1", context_window=128_000, preis_in_pro_mio=0.0, preis_out_pro_mio=0.0,
)

_LIES = re.compile(r"\blies\s+(\S+)", re.IGNORECASE)
# "führe <befehl> aus" → one shell call; lets the UI's approval flow be exercised offline (67-06).
_FUEHRE = re.compile(r"\bf(?:ü|ue)hre\s+(.+?)\s+aus\b", re.IGNORECASE)


class MockProvider(LLMProvider):
    def __init__(self, profile: ProviderProfile = MOCK_PROFILE):
        super().__init__(profile)
        self.calls = 0  # tests inspect how often the model was consulted

    async def chat(
        self, messages: list[Message], tools: list[ToolSchema], *, model: str,
        stream: bool = True, max_tokens: int = 4096,
    ) -> AsyncIterator[dict[str, Any]]:
        self.calls += 1
        last = messages[-1] if messages else Message(role="user", content="")
        tool_names = {t.name for t in tools}

        if last.role == "tool":
            snippet = last.content.strip().replace("\n", " ")[:200]
            text = f"Ergebnis von {last.name or 'Werkzeug'}: {snippet}"
        else:
            s = _FUEHRE.search(last.content)
            if s and "shell" in tool_names:
                yield ev_tool_call(ToolCall(id=f"mock-call-{self.calls}", name="shell", arguments={"command": s.group(1).strip("`'\" ")}))
                yield ev_usage(len(last.content) // 4, 12)
                yield ev_done("tool_use")
                return
            m = _LIES.search(last.content)
            if m and "read_file" in tool_names:
                yield ev_tool_call(ToolCall(id=f"mock-call-{self.calls}", name="read_file", arguments={"path": m.group(1)}))
                yield ev_usage(len(last.content) // 4, 12)
                yield ev_done("tool_use")
                return
            text = f"Mock-Antwort auf: {last.content.strip()}"

        # Stream in word chunks so the UI path is exercised even offline.
        for i, word in enumerate(text.split(" ")):
            yield ev_text_delta(("" if i == 0 else " ") + word)
        yield ev_usage(sum(len(m.content) for m in messages) // 4, len(text) // 4)
        yield ev_done("end_turn")
