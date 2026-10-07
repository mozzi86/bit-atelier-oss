"""OpenAI Chat Completions transport — covers Alibaba/Qwen (Token Plan and Coding Plan),
DeepSeek, Groq, vLLM, LM Studio and Ollama's /v1 endpoint.

In: internal Messages + ToolSchemas. Out: Events parsed from the SSE stream.
Translation: ToolSchema → {"type":"function","function":{name, description,
parameters}}; assistant tool calls → tool_calls[] with JSON-string arguments; `tool`
role with tool_call_id. Streaming deltas of tool calls are merged by `index`.

Profile quirks (providers.yaml `quirks:`):
  include_usage: true   → stream_options.include_usage (OpenAI, Groq, DeepSeek, Qwen)
  extra_body: {…}       → merged into the request (e.g. Qwen enable_thinking: false)
  headers: {…}          → extra HTTP headers
  no_tools: true        → tools are not sent (models without tool calling)
Without usage in the stream, tokens are ESTIMATED as len(text)/4 and flagged.
"""

from __future__ import annotations

import json
from typing import Any, AsyncIterator

import httpx

from harness.agent.messages import (
    Message, ToolCall, ToolSchema, ev_done, ev_error, ev_text_delta, ev_tool_call, ev_usage,
)
from harness.providers.base import LLMProvider, ProviderProfile

ALIBABA_HINT = (
    "401 — Token-Plan- und Coding-Plan-Endpunkt sind verschieden und akzeptieren nur den "
    "jeweils eigenen Schlüssel; geprüft: {profil}. `harness doctor` zeigt beide Profile "
    "(alibaba-token-plan, alibaba-coding-plan) und welcher Key fehlt."
)


def to_openai_payload(
    messages: list[Message], tools: list[ToolSchema], *, model: str, max_tokens: int, stream: bool,
    quirks: dict[str, Any] | None = None,
) -> dict[str, Any]:
    quirks = quirks or {}
    out: list[dict[str, Any]] = []
    for m in messages:
        if m.role in ("system", "user"):
            out.append({"role": m.role, "content": m.content})
        elif m.role == "assistant":
            d: dict[str, Any] = {"role": "assistant", "content": m.content or None}
            if m.tool_calls:
                d["tool_calls"] = [
                    {"id": tc.id, "type": "function",
                     "function": {"name": tc.name, "arguments": json.dumps(tc.arguments, ensure_ascii=False)}}
                    for tc in m.tool_calls
                ]
            out.append(d)
        elif m.role == "tool":
            out.append({"role": "tool", "tool_call_id": m.tool_call_id, "content": m.content})

    payload: dict[str, Any] = {"model": model, "messages": out, "max_tokens": max_tokens, "stream": stream}
    if tools and not quirks.get("no_tools"):
        payload["tools"] = [
            {"type": "function", "function": {"name": t.name, "description": t.description, "parameters": t.parameters}}
            for t in tools
        ]
    if stream and quirks.get("include_usage"):
        payload["stream_options"] = {"include_usage": True}
    extra = quirks.get("extra_body")
    if isinstance(extra, dict):
        payload.update(extra)
    return payload


class OpenAICompatProvider(LLMProvider):
    def __init__(self, profile: ProviderProfile, api_key: str | None, *, transport: httpx.AsyncBaseTransport | None = None):
        super().__init__(profile)
        if profile.env_var and not api_key:
            raise ValueError(f"Profil {profile.name!r}: kein Schlüssel — {profile.env_var} in .env setzen")
        if not profile.base_url:
            raise ValueError(f"Profil {profile.name!r}: base_url fehlt")
        self._api_key = api_key
        self._base_url = profile.base_url.rstrip("/")
        self._transport = transport

    def _headers(self) -> dict[str, str]:
        h = {"content-type": "application/json"}
        if self._api_key:
            h["authorization"] = f"Bearer {self._api_key}"
        extra = self.profile.quirks.get("headers")
        if isinstance(extra, dict):
            h.update({str(k): str(v) for k, v in extra.items()})
        return h

    def _error_text(self, status: int, body: str) -> str:
        text = f"{self.profile.name} {status}: {body[:600]}"
        if status == 401 and self.profile.name.startswith("alibaba"):
            text = ALIBABA_HINT.format(profil=self.profile.name) + " — " + text
        return text

    async def chat(
        self, messages: list[Message], tools: list[ToolSchema], *, model: str,
        stream: bool = True, max_tokens: int = 4096,
    ) -> AsyncIterator[dict[str, Any]]:
        payload = to_openai_payload(messages, tools, model=model, max_tokens=max_tokens, stream=True,
                                    quirks=self.profile.quirks)
        url = f"{self._base_url}/chat/completions"
        try:
            async with httpx.AsyncClient(transport=self._transport, timeout=httpx.Timeout(300.0, connect=15.0)) as client:
                async with client.stream("POST", url, headers=self._headers(), json=payload) as resp:
                    if resp.status_code >= 400:
                        body = (await resp.aread()).decode("utf-8", "replace")
                        yield ev_error(self._error_text(resp.status_code, body))
                        yield ev_done("error")
                        return
                    async for ev in self._stream_events(resp):
                        yield ev
        except httpx.HTTPError as exc:
            yield ev_error(f"{self.profile.name}: Verbindung fehlgeschlagen — {exc.__class__.__name__}: {exc}")
            yield ev_done("error")

    async def _stream_events(self, resp: httpx.Response) -> AsyncIterator[dict[str, Any]]:
        from harness.providers.sse import iter_sse_json

        pending: dict[int, dict[str, Any]] = {}
        text_chars = 0
        usage: dict[str, Any] | None = None
        finish = "end_turn"

        async for ev in iter_sse_json(resp.aiter_lines()):
            if "error" in ev and not ev.get("choices"):
                msg = ev["error"].get("message") if isinstance(ev["error"], dict) else str(ev["error"])
                yield ev_error(f"{self.profile.name}: {msg}")
                finish = "error"
                continue
            if ev.get("usage"):
                usage = ev["usage"]
            for choice in ev.get("choices") or []:
                delta = choice.get("delta") or {}
                content = delta.get("content")
                if content:
                    text_chars += len(content)
                    yield ev_text_delta(content)
                for tc in delta.get("tool_calls") or []:
                    idx = int(tc.get("index", 0))
                    slot = pending.setdefault(idx, {"id": None, "name": None, "args": ""})
                    if tc.get("id"):
                        slot["id"] = tc["id"]
                    fn = tc.get("function") or {}
                    if fn.get("name"):
                        slot["name"] = fn["name"]  # name arrives whole in the first delta
                    if fn.get("arguments"):
                        slot["args"] += fn["arguments"]
                fr = choice.get("finish_reason")
                if fr:
                    finish = {"tool_calls": "tool_use", "stop": "end_turn", "length": "max_tokens"}.get(fr, fr)

        for idx in sorted(pending):
            slot = pending[idx]
            if not slot.get("name"):
                continue
            try:
                args = json.loads(slot["args"]) if slot["args"].strip() else {}
                if not isinstance(args, dict):
                    raise json.JSONDecodeError("kein Objekt", slot["args"], 0)
            except json.JSONDecodeError:
                # T-67-07: hand the broken JSON back as the tool's input; the loop's
                # error result tells the model what went wrong instead of crashing the turn.
                args = {"_ungueltiges_json": slot["args"][:500]}
            yield ev_tool_call(ToolCall(id=slot["id"] or f"call_{idx}", name=slot["name"], arguments=args))
            finish = "tool_use" if finish == "end_turn" else finish

        if usage:
            yield ev_usage(int(usage.get("prompt_tokens", 0)), int(usage.get("completion_tokens", 0)))
        else:
            # [ASSUMED] no usage from this provider — rough estimate, flagged for /status.
            yield {**ev_usage(0, text_chars // 4), "estimated": True}
        yield ev_done(finish)


async def fetch_models(profile: ProviderProfile, api_key: str | None, *, transport: httpx.AsyncBaseTransport | None = None,
                       timeout: float = 5.0) -> list[str]:
    """GET {models_url|base_url/models}. Ollama's /api/tags has `models[].name`,
    OpenAI-style endpoints have `data[].id`."""
    url = str(profile.quirks.get("models_url") or f"{(profile.base_url or '').rstrip('/')}/models")
    headers = {"authorization": f"Bearer {api_key}"} if api_key else {}
    async with httpx.AsyncClient(transport=transport, timeout=timeout) as client:
        resp = await client.get(url, headers=headers)
        resp.raise_for_status()
        data = resp.json()
    if isinstance(data, dict) and isinstance(data.get("models"), list):
        return [str(m.get("name") or m.get("id")) for m in data["models"] if isinstance(m, dict)]
    if isinstance(data, dict) and isinstance(data.get("data"), list):
        return [str(m.get("id")) for m in data["data"] if isinstance(m, dict) and m.get("id")]
    return []
