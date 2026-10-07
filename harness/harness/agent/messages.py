"""Internal message schema — the one shape every provider translates from and to.

In/out: plain dataclasses, JSON-friendly via to_dict(). Events are dicts with a
`type` key so the WebSocket route can forward them 1:1 without a second mapping.

    Message   {role: system|user|assistant|tool, content, tool_calls?, tool_call_id?, name?}
    ToolCall  {id, name, arguments: dict}
    ToolSchema{name, description, parameters: JSON schema}
    Event     {type: text_delta|tool_call|tool_result|approval|usage|error|done|notice, ...}
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

ROLES = ("system", "user", "assistant", "tool")


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {"id": self.id, "name": self.name, "arguments": dict(self.arguments)}


@dataclass
class Message:
    role: str
    content: str = ""
    tool_calls: list[ToolCall] = field(default_factory=list)
    tool_call_id: str | None = None
    name: str | None = None

    def __post_init__(self) -> None:
        if self.role not in ROLES:
            raise ValueError(f"Unbekannte Rolle: {self.role!r}")

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {"role": self.role, "content": self.content}
        if self.tool_calls:
            d["tool_calls"] = [tc.to_dict() for tc in self.tool_calls]
        if self.tool_call_id:
            d["tool_call_id"] = self.tool_call_id
        if self.name:
            d["name"] = self.name
        return d

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Message":
        return cls(
            role=d["role"],
            content=d.get("content") or "",
            tool_calls=[ToolCall(**tc) for tc in d.get("tool_calls", [])],
            tool_call_id=d.get("tool_call_id"),
            name=d.get("name"),
        )


@dataclass
class ToolSchema:
    name: str
    description: str
    parameters: dict[str, Any] = field(default_factory=lambda: {"type": "object", "properties": {}})

    def to_dict(self) -> dict[str, Any]:
        return {"name": self.name, "description": self.description, "parameters": self.parameters}


# --- Event constructors (keep the wire format in one place) ---------------------

def ev_text_delta(text: str) -> dict[str, Any]:
    return {"type": "text_delta", "text": text}


def ev_tool_call(call: ToolCall) -> dict[str, Any]:
    return {"type": "tool_call", **call.to_dict()}


def ev_tool_result(call_id: str, name: str, result: str) -> dict[str, Any]:
    return {"type": "tool_result", "id": call_id, "name": name, "result": result}


def ev_approval(approval_id: str, befehl: str, erklaerung: str) -> dict[str, Any]:
    return {"type": "approval", "id": approval_id, "befehl": befehl, "erklaerung": erklaerung}


def ev_usage(input_tokens: int, output_tokens: int) -> dict[str, Any]:
    return {"type": "usage", "input_tokens": int(input_tokens), "output_tokens": int(output_tokens)}


def ev_error(message: str) -> dict[str, Any]:
    return {"type": "error", "message": message}


def ev_notice(message: str) -> dict[str, Any]:
    """Harness-side hint for the UI (e.g. the memory nudge). Not part of the transcript."""
    return {"type": "notice", "message": message}


def ev_done(stop_reason: str = "end_turn") -> dict[str, Any]:
    return {"type": "done", "stop_reason": stop_reason}


# --- Invariants -----------------------------------------------------------------

def check_alternation(messages: list[Message]) -> None:
    """Prompt-cache invariant (Hermes): after the system prompt, user/assistant
    strictly alternate; a `tool` message may only follow an assistant tool call
    (or another tool message of the same batch). Raises ValueError with the index."""
    prev: Message | None = None
    for i, m in enumerate(messages):
        if m.role == "system":
            if i != 0 and m.name != "kompression":
                raise ValueError(f"System-Nachricht an Position {i} — nur an Position 0 erlaubt")
            if i != 0:
                continue  # compression note is transparent for the alternation rule
            prev = m
            continue
        if prev is None or prev.role == "system":
            if m.role != "user":
                raise ValueError(f"Position {i}: nach dem System-Prompt muss eine user-Nachricht folgen")
        elif m.role == "tool":
            if prev.role not in ("assistant", "tool") or (prev.role == "assistant" and not prev.tool_calls):
                raise ValueError(f"Position {i}: tool-Ergebnis ohne vorhergehenden Tool-Aufruf")
        elif m.role == prev.role:
            raise ValueError(f"Position {i}: zwei {m.role}-Nachrichten hintereinander")
        elif m.role == "user" and prev.role == "tool":
            raise ValueError(f"Position {i}: user-Nachricht direkt nach tool-Ergebnis (Assistent fehlt)")
        prev = m
