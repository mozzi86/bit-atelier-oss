import pytest

from harness.agent.messages import Message, ToolCall, check_alternation


def test_message_roundtrip():
    m = Message(role="assistant", content="hi", tool_calls=[ToolCall("c1", "read_file", {"path": "a"})])
    d = m.to_dict()
    assert d["tool_calls"][0] == {"id": "c1", "name": "read_file", "arguments": {"path": "a"}}
    assert Message.from_dict(d) == m


def test_unknown_role_rejected():
    with pytest.raises(ValueError):
        Message(role="robot", content="x")


def test_alternation_ok_with_tools():
    msgs = [
        Message("system", "s"), Message("user", "lies a"),
        Message("assistant", "", tool_calls=[ToolCall("1", "read_file", {})]),
        Message("tool", "inhalt", tool_call_id="1", name="read_file"),
        Message("assistant", "fertig"), Message("user", "danke"),
    ]
    check_alternation(msgs)


@pytest.mark.parametrize("msgs, needle", [
    ([Message("system", "s"), Message("assistant", "x")], "user-Nachricht folgen"),
    ([Message("system", "s"), Message("user", "a"), Message("user", "b")], "zwei user"),
    ([Message("user", "a"), Message("system", "s")], "Position 1"),
    ([Message("user", "a"), Message("tool", "r", tool_call_id="1")], "ohne vorhergehenden Tool-Aufruf"),
    ([Message("user", "a"), Message("assistant", "", tool_calls=[ToolCall("1", "t", {})]),
      Message("tool", "r", tool_call_id="1"), Message("user", "b")], "Assistent fehlt"),
])
def test_alternation_violations(msgs, needle):
    with pytest.raises(ValueError, match=needle):
        check_alternation(msgs)
