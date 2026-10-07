"""OpenAI-compatible transport: translation, split tool-call deltas, usage, 401 hint,
and parity with the Anthropic adapter through the loop."""

import json

import httpx
import pytest

from harness.agent.loop import run_turn
from harness.agent.messages import Message, ToolCall, ToolSchema, check_alternation
from harness.providers.anthropic import AnthropicProvider
from harness.providers.base import ProviderProfile
from harness.providers.openai_compat import OpenAICompatProvider, fetch_models, to_openai_payload
from harness.tools.builtin import registry
from tests.conftest import make_ctx, make_runtime

TOOLS = [ToolSchema("read_file", "Liest eine Datei", {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]})]
QWEN = ProviderProfile(name="alibaba-token-plan", api_mode="openai_compat", base_url="https://token-plan.example/compatible-mode/v1",
                       env_var="DASHSCOPE_API_KEY", models=("qwen3.8-max",), default_model="qwen3.8-max",
                       quirks={"include_usage": True, "extra_body": {"enable_thinking": False}})
LOCAL = ProviderProfile(name="lmstudio", api_mode="openai_compat", base_url="http://127.0.0.1:1234/v1", env_var=None)


def test_payload_translation():
    msgs = [
        Message("system", "SYS"), Message("user", "lies PROJECT.md"),
        Message("assistant", "", tool_calls=[ToolCall("call_1", "read_file", {"path": "PROJECT.md"})]),
        Message("tool", "INHALT", tool_call_id="call_1", name="read_file"),
        Message("assistant", "Fertig."),
    ]
    got = to_openai_payload(msgs, TOOLS, model="qwen3.8-max", max_tokens=512, stream=True, quirks=QWEN.quirks)
    assert got == {
        "model": "qwen3.8-max", "max_tokens": 512, "stream": True,
        "messages": [
            {"role": "system", "content": "SYS"},
            {"role": "user", "content": "lies PROJECT.md"},
            {"role": "assistant", "content": None, "tool_calls": [
                {"id": "call_1", "type": "function", "function": {"name": "read_file", "arguments": '{"path": "PROJECT.md"}'}}]},
            {"role": "tool", "tool_call_id": "call_1", "content": "INHALT"},
            {"role": "assistant", "content": "Fertig."},
        ],
        "tools": [{"type": "function", "function": {"name": "read_file", "description": "Liest eine Datei",
                                                    "parameters": TOOLS[0].parameters}}],
        "stream_options": {"include_usage": True},
        "enable_thinking": False,
    }


def test_no_tools_quirk_and_no_usage_option():
    got = to_openai_payload([Message("user", "x")], TOOLS, model="m", max_tokens=1, stream=True, quirks={"no_tools": True})
    assert "tools" not in got and "stream_options" not in got


def _sse(chunks: list[dict]) -> bytes:
    body = "".join(f"data: {json.dumps(c)}\n\n" for c in chunks) + "data: [DONE]\n\n"
    return body.encode()


def _delta(**delta):
    return {"choices": [{"index": 0, "delta": delta, "finish_reason": None}]}


STREAM = [
    _delta(role="assistant", content="Ich "),
    _delta(content="lese."),
    _delta(tool_calls=[{"index": 0, "id": "call_a", "type": "function", "function": {"name": "read_file", "arguments": '{"pa'}}]),
    _delta(tool_calls=[{"index": 1, "id": "call_b", "type": "function", "function": {"name": "read_file", "arguments": ""}}]),
    _delta(tool_calls=[{"index": 0, "function": {"arguments": 'th": "A.md"}'}}]),
    _delta(tool_calls=[{"index": 1, "function": {"arguments": '{"path": "B.md"}'}}]),
    {"choices": [{"index": 0, "delta": {}, "finish_reason": "tool_calls"}]},
    {"choices": [], "usage": {"prompt_tokens": 33, "completion_tokens": 9}},
]


async def test_stream_two_split_tool_calls(monkeypatch):
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["headers"] = dict(request.headers)
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, content=_sse(STREAM), headers={"content-type": "text/event-stream"})

    prov = OpenAICompatProvider(QWEN, "sk-sp-test", transport=httpx.MockTransport(handler))
    events = [e async for e in prov.chat([Message("user", "lies A und B")], TOOLS, model="qwen3.8-max")]

    assert seen["headers"]["authorization"] == "Bearer sk-sp-test"
    assert seen["body"]["stream_options"] == {"include_usage": True}
    assert "".join(e["text"] for e in events if e["type"] == "text_delta") == "Ich lese."
    calls = [e for e in events if e["type"] == "tool_call"]
    assert calls == [
        {"type": "tool_call", "id": "call_a", "name": "read_file", "arguments": {"path": "A.md"}},
        {"type": "tool_call", "id": "call_b", "name": "read_file", "arguments": {"path": "B.md"}},
    ]
    assert {"type": "usage", "input_tokens": 33, "output_tokens": 9} in events
    assert events[-1] == {"type": "done", "stop_reason": "tool_use"}


async def test_missing_usage_is_flagged_estimate():
    def handler(request):
        return httpx.Response(200, content=_sse([_delta(content="Hallo Welt, zwölf"), {"choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]}]))

    prov = OpenAICompatProvider(LOCAL, None, transport=httpx.MockTransport(handler))
    events = [e async for e in prov.chat([Message("user", "hi")], [], model="local")]
    usage = next(e for e in events if e["type"] == "usage")
    assert usage["estimated"] is True and usage["output_tokens"] == len("Hallo Welt, zwölf") // 4


async def test_broken_tool_json_is_handed_to_the_model():
    def handler(request):
        return httpx.Response(200, content=_sse([
            _delta(tool_calls=[{"index": 0, "id": "c", "function": {"name": "read_file", "arguments": '{"path": '}}]),
            {"choices": [{"index": 0, "delta": {}, "finish_reason": "tool_calls"}]},
        ]))

    prov = OpenAICompatProvider(LOCAL, None, transport=httpx.MockTransport(handler))
    events = [e async for e in prov.chat([Message("user", "x")], TOOLS, model="m")]
    call = next(e for e in events if e["type"] == "tool_call")
    assert "_ungueltiges_json" in call["arguments"]


async def test_401_on_alibaba_names_both_profiles():
    def handler(request):
        return httpx.Response(401, json={"error": {"message": "invalid access token"}})

    prov = OpenAICompatProvider(QWEN, "sk-sp-wrong", transport=httpx.MockTransport(handler))
    events = [e async for e in prov.chat([Message("user", "hi")], [], model="qwen3.8-max")]
    msg = events[0]["message"]
    assert events[0]["type"] == "error" and "alibaba-coding-plan" in msg and "alibaba-token-plan" in msg and "doctor" in msg


def test_key_required_only_when_env_var_set():
    with pytest.raises(ValueError, match="DASHSCOPE_API_KEY"):
        OpenAICompatProvider(QWEN, None)
    OpenAICompatProvider(LOCAL, None)  # local server, no key


async def test_fetch_models_openai_and_ollama_shapes():
    def handler(request):
        if "api/tags" in str(request.url):
            return httpx.Response(200, json={"models": [{"name": "qwen3:8b"}, {"name": "llama3.1:8b"}]})
        return httpx.Response(200, json={"data": [{"id": "qwen/qwen3.8-27b"}, {"id": "text-embedding-nomic"}]})

    t = httpx.MockTransport(handler)
    assert await fetch_models(LOCAL, None, transport=t) == ["qwen/qwen3.8-27b", "text-embedding-nomic"]
    ollama = ProviderProfile(name="ollama", api_mode="openai_compat", base_url="http://127.0.0.1:11434/v1",
                             quirks={"models_url": "http://127.0.0.1:11434/api/tags"})
    assert await fetch_models(ollama, None, transport=t) == ["qwen3:8b", "llama3.1:8b"]


# --- Parity: the same loop scenario through both translators ------------------

def _anthropic_sse(events):
    return "".join(f"event: {e['type']}\ndata: {json.dumps(e)}\n\n" for e in events).encode()


def _anthropic_scripted():
    """First call: tool_use read_file PROJECT.md; second call: text answer."""
    n = {"i": 0}

    def handler(request):
        n["i"] += 1
        if n["i"] == 1:
            return httpx.Response(200, content=_anthropic_sse([
                {"type": "message_start", "message": {"usage": {"input_tokens": 10}}},
                {"type": "content_block_start", "index": 0, "content_block": {"type": "tool_use", "id": "t1", "name": "read_file", "input": {}}},
                {"type": "content_block_delta", "index": 0, "delta": {"type": "input_json_delta", "partial_json": '{"path": "PROJECT.md"}'}},
                {"type": "content_block_stop", "index": 0},
                {"type": "message_delta", "delta": {"stop_reason": "tool_use"}, "usage": {"output_tokens": 5}},
            ]))
        return httpx.Response(200, content=_anthropic_sse([
            {"type": "message_start", "message": {"usage": {"input_tokens": 20}}},
            {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "EFH gelesen."}},
            {"type": "message_delta", "delta": {"stop_reason": "end_turn"}, "usage": {"output_tokens": 3}},
        ]))
    return handler


def _openai_scripted():
    n = {"i": 0}

    def handler(request):
        n["i"] += 1
        if n["i"] == 1:
            return httpx.Response(200, content=_sse([
                _delta(tool_calls=[{"index": 0, "id": "t1", "function": {"name": "read_file", "arguments": '{"path": "PROJECT.md"}'}}]),
                {"choices": [{"index": 0, "delta": {}, "finish_reason": "tool_calls"}]},
                {"choices": [], "usage": {"prompt_tokens": 10, "completion_tokens": 5}},
            ]))
        return httpx.Response(200, content=_sse([
            _delta(content="EFH gelesen."), {"choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]},
            {"choices": [], "usage": {"prompt_tokens": 20, "completion_tokens": 3}},
        ]))
    return handler


@pytest.mark.parametrize("make", [
    lambda: AnthropicProvider(ProviderProfile(name="anthropic", api_mode="anthropic", env_var="K", models=("m",)), "sk-ant-x",
                              transport=httpx.MockTransport(_anthropic_scripted())),
    lambda: OpenAICompatProvider(QWEN, "sk-sp-x", transport=httpx.MockTransport(_openai_scripted())),
], ids=["anthropic", "openai_compat"])
async def test_loop_parity_across_translators(workspace, make):
    rt = make_runtime(workspace, "user")
    session = rt.build_session()
    events = [e async for e in run_turn(session, make(), registry, make_ctx(workspace, "user"), "lies PROJECT.md")]
    types = [e["type"] for e in events]
    assert types.count("tool_call") == 1 and types.count("tool_result") == 1
    assert "".join(e["text"] for e in events if e["type"] == "text_delta") == "EFH gelesen."
    assert events[-1] == {"type": "done", "stop_reason": "end_turn"}
    assert [m.role for m in session.history] == ["system", "user", "assistant", "tool", "assistant"]
    check_alternation(session.history)
    assert (session.input_tokens, session.output_tokens) == (30, 8)
    result = json.loads(next(e for e in events if e["type"] == "tool_result")["result"])
    assert "EFH Satteldach" in result["content"]
