"""Compression: threshold, protected head/tail, one system note, alternation intact."""

from harness.agent.compression import Compression, NOTE_NAME, estimate_tokens, plan_cut, window_of
from harness.agent.loop import run_turn
from harness.agent.messages import Message, ToolCall, check_alternation
from harness.providers.base import ProviderProfile
from harness.providers.mock import MockProvider
from harness.tools.builtin import registry
from tests.conftest import make_ctx, make_runtime

WINDOW = 128_000
PROFILE = ProviderProfile(name="mock", api_mode="mock", models=("mock-1",), default_model="mock-1",
                          aux_model="mock-aux", context_window=WINDOW)


def _history(n_pairs: int, chars: int = 4000) -> list[Message]:
    """system + n user/assistant pairs of ~chars/4 tokens each (≈1k tokens at 4000 chars)."""
    h = [Message("system", "SYS")]
    for i in range(n_pairs):
        h.append(Message("user", f"u{i} " + "x" * chars))
        h.append(Message("assistant", f"a{i} " + "y" * chars))
    return h


def test_window_default_is_flagged():
    assert window_of(ProviderProfile(name="x", api_mode="mock")) == (128_000, True)
    assert window_of(PROFILE) == (WINDOW, False)


def test_plan_cut_respects_protection_and_alternation():
    h = _history(30)  # 61 messages
    head_end, tail_start = plan_cut(h, protect_head=3, protect_tail=20)
    assert head_end == 3 and h[head_end - 1].role == "assistant"
    assert h[tail_start].role == "user" and len(h) - tail_start >= 20
    assert plan_cut(_history(10)) is None  # too short


def test_plan_cut_never_ends_head_on_tool_call():
    h = [Message("system", "S"), Message("user", "u"),
         Message("assistant", "", tool_calls=[ToolCall("1", "read_file", {})]),
         Message("tool", "r", tool_call_id="1")] + _history(30)[1:]
    head_end, tail_start = plan_cut(h, protect_head=3, protect_tail=20)
    assert head_end == 2  # the tool-calling assistant is not kept without its result
    assert h[tail_start].role == "assistant"  # alternates with the user at head_end-1


async def test_compression_runs_once_and_keeps_alternation(workspace):
    rt = make_runtime(workspace, "user")
    session = rt.build_session()
    session.history = _history(30)                       # 61 msgs ≈ 60k tokens by chars
    session.ledger.last_input_tokens = 70_000            # last call reported > 50 % of 128k
    tail_before = [m.content for m in session.history[-20:]]
    head_before = [m.content for m in session.history[:3]]
    prov = MockProvider()

    comp = Compression(PROFILE)
    events = [e async for e in run_turn(session, prov, registry, make_ctx(workspace, "user"), "weiter", compression=comp)]

    cev = events[0]
    assert cev["type"] == "compression" and cev["vorher"] == 61
    # head 3 + note 1 + tail 20 = 24, then the new user turn and the answer
    assert cev["nachher"] == 24 and len(session.history) == 26
    assert [m.content for m in session.history[:3]] == head_before
    assert [m.content for m in session.history[4:24]] == tail_before
    note = session.history[3]
    assert note.role == "system" and note.name == NOTE_NAME and "verdichtet" in note.content
    assert cev["tokens_nachher"] <= 0.2 * WINDOW < cev["tokens_vorher"]
    check_alternation(session.history)
    assert session.compressions == 1
    assert cev["modell"] == "mock-aux"

    # second turn: last_input_tokens was reset, chars-estimate is below threshold → no compression
    events2 = [e async for e in run_turn(session, prov, registry, make_ctx(workspace, "user"), "und?", compression=comp)]
    assert all(e["type"] != "compression" for e in events2)


async def test_no_compression_below_threshold(workspace):
    rt = make_runtime(workspace, "user")
    session = rt.build_session()
    session.history = _history(30)
    session.ledger.last_input_tokens = 30_000
    events = [e async for e in run_turn(session, MockProvider(), registry, make_ctx(workspace, "user"), "x", compression=Compression(PROFILE))]
    assert all(e["type"] != "compression" for e in events)
    assert estimate_tokens(session.history) > 0
