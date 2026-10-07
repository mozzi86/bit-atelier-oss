"""Anthropic translation against a hand-written expectation + SSE parsing via httpx.MockTransport."""

import json

import httpx
import pytest

from harness.agent.messages import Message, ToolCall, ToolSchema
from harness.providers.anthropic import AnthropicProvider, to_anthropic_payload
from harness.providers.base import ProviderProfile

PROFILE = ProviderProfile(name="anthropic", api_mode="anthropic", env_var="ANTHROPIC_API_KEY",
                          models=("claude-sonnet-5",), default_model="claude-sonnet-5")

TOOLS = [ToolSchema("read_file", "Liest eine Datei", {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]})]


def test_payload_matches_expectation():
    msgs = [
        Message("system", "SYS"),
        Message("user", "lies PROJECT.md"),
        Message("assistant", "Ich lese.", tool_calls=[ToolCall("toolu_1", "read_file", {"path": "PROJECT.md"})]),
        Message("tool", "INHALT", tool_call_id="toolu_1", name="read_file"),
        Message("assistant", "Fertig."),
        Message("user", "danke"),
    ]
    got = to_anthropic_payload(msgs, TOOLS, model="claude-sonnet-5", max_tokens=1024, stream=True)
    expected = {
        "model": "claude-sonnet-5",
        "max_tokens": 1024,
        "stream": True,
        "system": "SYS",
        "messages": [
            {"role": "user", "content": "lies PROJECT.md"},
            {"role": "assistant", "content": [
                {"type": "text", "text": "Ich lese."},
                {"type": "tool_use", "id": "toolu_1", "name": "read_file", "input": {"path": "PROJECT.md"}},
            ]},
            {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "toolu_1", "content": "INHALT"}]},
            {"role": "assistant", "content": [{"type": "text", "text": "Fertig."}]},
            {"role": "user", "content": "danke"},
        ],
        "tools": [{"name": "read_file", "description": "Liest eine Datei",
                   "input_schema": {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]}}],
    }
    assert got == expected
    assert "parameters" not in json.dumps(got)  # renamed to input_schema


def test_two_tool_results_merge_into_one_user_turn():
    msgs = [
        Message("user", "x"),
        Message("assistant", "", tool_calls=[ToolCall("a", "read_file", {}), ToolCall("b", "read_file", {})]),
        Message("tool", "1", tool_call_id="a"), Message("tool", "2", tool_call_id="b"),
    ]
    got = to_anthropic_payload(msgs, [], model="m", max_tokens=1, stream=False)
    assert [m["role"] for m in got["messages"]] == ["user", "assistant", "user"]
    assert len(got["messages"][2]["content"]) == 2
    assert "system" not in got


def _sse(events: list[dict]) -> bytes:
    return "".join(f"event: {e['type']}\ndata: {json.dumps(e)}\n\n" for e in events).encode()


STREAM = [
    {"type": "message_start", "message": {"usage": {"input_tokens": 42}}},
    {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}},
    {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "Hal"}},
    {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "lo"}},
    {"type": "content_block_stop", "index": 0},
    {"type": "content_block_start", "index": 1, "content_block": {"type": "tool_use", "id": "toolu_9", "name": "read_file", "input": {}}},
    {"type": "content_block_delta", "index": 1, "delta": {"type": "input_json_delta", "partial_json": '{"path": "PRO'}},
    {"type": "content_block_delta", "index": 1, "delta": {"type": "input_json_delta", "partial_json": 'JECT.md"}'}},
    {"type": "content_block_stop", "index": 1},
    {"type": "message_delta", "delta": {"stop_reason": "tool_use"}, "usage": {"output_tokens": 7}},
    {"type": "message_stop"},
]


async def test_stream_parsing_with_mock_transport():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["headers"] = dict(request.headers)
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, content=_sse(STREAM), headers={"content-type": "text/event-stream"})

    prov = AnthropicProvider(PROFILE, "sk-ant-test", transport=httpx.MockTransport(handler))
    events = [e async for e in prov.chat([Message("user", "lies PROJECT.md")], TOOLS, model="claude-sonnet-5")]

    assert seen["headers"]["x-api-key"] == "sk-ant-test"
    assert seen["headers"]["anthropic-version"] == "2023-06-01"
    assert seen["body"]["stream"] is True
    text = "".join(e["text"] for e in events if e["type"] == "text_delta")
    assert text == "Hallo"
    calls = [e for e in events if e["type"] == "tool_call"]
    assert calls == [{"type": "tool_call", "id": "toolu_9", "name": "read_file", "arguments": {"path": "PROJECT.md"}}]
    assert {"type": "usage", "input_tokens": 42, "output_tokens": 7} in events
    assert events[-1] == {"type": "done", "stop_reason": "tool_use"}


async def test_http_error_becomes_error_event():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": {"message": "invalid x-api-key"}})

    prov = AnthropicProvider(PROFILE, "sk-ant-bad", transport=httpx.MockTransport(handler))
    events = [e async for e in prov.chat([Message("user", "hi")], [], model="m")]
    assert events[0]["type"] == "error" and "401" in events[0]["message"]
    assert events[-1] == {"type": "done", "stop_reason": "error"}


def test_missing_key_is_a_clear_error():
    with pytest.raises(ValueError, match="ANTHROPIC_API_KEY"):
        AnthropicProvider(PROFILE, "")
