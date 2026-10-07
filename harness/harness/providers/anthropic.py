"""Anthropic Messages API transport over httpx (no SDK, like llm.js in Node).

In: internal Messages + ToolSchemas. Out: Events parsed from the SSE stream.
Translation rules: the system message is sent separately; assistant tool calls
become `tool_use` blocks; `tool` messages become `tool_result` blocks inside a
user turn (consecutive results are merged into one user turn); ToolSchema
`parameters` is renamed `input_schema`.
"""

from __future__ import annotations

import json
from typing import Any, AsyncIterator

import httpx

from harness.agent.messages import (
    Message, ToolCall, ToolSchema, ev_done, ev_error, ev_text_delta, ev_tool_call, ev_usage,
)
from harness.providers.base import LLMProvider, ProviderProfile

DEFAULT_BASE_URL = "https://api.anthropic.com"
DEFAULT_VERSION = "2023-06-01"


def to_anthropic_payload(
    messages: list[Message], tools: list[ToolSchema], *, model: str, max_tokens: int, stream: bool,
) -> dict[str, Any]:
    """Pure translation — tested against a hand-written expectation, no network."""
    system_parts = [m.content for m in messages if m.role == "system"]
    out: list[dict[str, Any]] = []

    for m in messages:
        if m.role == "system":
            continue
        if m.role == "user":
            out.append({"role": "user", "content": m.content})
        elif m.role == "assistant":
            blocks: list[dict[str, Any]] = []
            if m.content:
                blocks.append({"type": "text", "text": m.content})
            for tc in m.tool_calls:
                blocks.append({"type": "tool_use", "id": tc.id, "name": tc.name, "input": tc.arguments})
            out.append({"role": "assistant", "content": blocks or [{"type": "text", "text": ""}]})
        elif m.role == "tool":
            block = {"type": "tool_result", "tool_use_id": m.tool_call_id, "content": m.content}
            if out and out[-1]["role"] == "user" and isinstance(out[-1]["content"], list):
                out[-1]["content"].append(block)
            else:
                out.append({"role": "user", "content": [block]})

    payload: dict[str, Any] = {"model": model, "max_tokens": max_tokens, "messages": out, "stream": stream}
    if system_parts:
        payload["system"] = "\n\n".join(system_parts)
    if tools:
        payload["tools"] = [
            {"name": t.name, "description": t.description, "input_schema": t.parameters} for t in tools
        ]
    return payload


def _parse_sse(chunk_lines: list[str]) -> dict[str, Any] | None:
    data = [ln[5:].strip() for ln in chunk_lines if ln.startswith("data:")]
    if not data:
        return None
    try:
        return json.loads("".join(data))
    except json.JSONDecodeError:
        return None


class AnthropicProvider(LLMProvider):
    def __init__(self, profile: ProviderProfile, api_key: str, *, transport: httpx.AsyncBaseTransport | None = None):
        super().__init__(profile)
        if not api_key:
            raise ValueError(f"Profil {profile.name!r}: kein Schlüssel — {profile.env_var} in .env setzen")
        self._api_key = api_key
        self._base_url = (profile.base_url or DEFAULT_BASE_URL).rstrip("/")
        self._version = str(profile.quirks.get("anthropic_version") or DEFAULT_VERSION)
        self._transport = transport

    def _headers(self) -> dict[str, str]:
        return {
            "content-type": "application/json",
            "x-api-key": self._api_key,
            "anthropic-version": self._version,
        }

    async def chat(
        self, messages: list[Message], tools: list[ToolSchema], *, model: str,
        stream: bool = True, max_tokens: int = 4096,
    ) -> AsyncIterator[dict[str, Any]]:
        payload = to_anthropic_payload(messages, tools, model=model, max_tokens=max_tokens, stream=True)
        url = f"{self._base_url}/v1/messages"
        try:
            async with httpx.AsyncClient(transport=self._transport, timeout=httpx.Timeout(120.0, connect=15.0)) as client:
                async with client.stream("POST", url, headers=self._headers(), json=payload) as resp:
                    if resp.status_code >= 400:
                        body = (await resp.aread()).decode("utf-8", "replace")
                        yield ev_error(f"Anthropic {resp.status_code}: {body[:600]}")
                        yield ev_done("error")
                        return
                    async for ev in self._stream_events(resp):
                        yield ev
        except httpx.HTTPError as exc:
            yield ev_error(f"Anthropic-Verbindung fehlgeschlagen: {exc.__class__.__name__}: {exc}")
            yield ev_done("error")

    async def _stream_events(self, resp: httpx.Response) -> AsyncIterator[dict[str, Any]]:
        # Tool-use blocks arrive as partial JSON deltas keyed by block index.
        pending: dict[int, dict[str, Any]] = {}
        usage_in = usage_out = 0
        stop_reason = "end_turn"
        buf: list[str] = []

        async for line in resp.aiter_lines():
            if line.strip():
                buf.append(line)
                continue
            ev = _parse_sse(buf)
            buf = []
            if not ev:
                continue
            t = ev.get("type")
            if t == "message_start":
                usage_in = int(ev.get("message", {}).get("usage", {}).get("input_tokens", 0))
            elif t == "content_block_start":
                block = ev.get("content_block", {})
                if block.get("type") == "tool_use":
                    pending[ev["index"]] = {"id": block.get("id"), "name": block.get("name"), "json": ""}
            elif t == "content_block_delta":
                delta = ev.get("delta", {})
                if delta.get("type") == "text_delta":
                    yield ev_text_delta(delta.get("text", ""))
                elif delta.get("type") == "input_json_delta":
                    pending.setdefault(ev["index"], {"id": None, "name": None, "json": ""})["json"] += delta.get("partial_json", "")
            elif t == "content_block_stop":
                p = pending.pop(ev.get("index"), None)
                if p and p.get("name"):
                    try:
                        args = json.loads(p["json"]) if p["json"].strip() else {}
                    except json.JSONDecodeError:
                        yield ev_error(f"Tool-Argumente von {p['name']} nicht lesbar: {p['json'][:200]}")
                        args = {}
                    yield ev_tool_call(ToolCall(id=p["id"], name=p["name"], arguments=args))
            elif t == "message_delta":
                usage_out = int(ev.get("usage", {}).get("output_tokens", usage_out))
                stop_reason = ev.get("delta", {}).get("stop_reason") or stop_reason
            elif t == "error":
                yield ev_error(f"Anthropic-Stream: {ev.get('error', {}).get('message', 'unbekannt')}")
                stop_reason = "error"

        if buf:  # stream ended without trailing blank line
            ev = _parse_sse(buf)
            if ev and ev.get("type") == "message_delta":
                usage_out = int(ev.get("usage", {}).get("output_tokens", usage_out))
                stop_reason = ev.get("delta", {}).get("stop_reason") or stop_reason

        yield ev_usage(usage_in, usage_out)
        yield ev_done(stop_reason)
