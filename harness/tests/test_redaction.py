import json

from harness.jsonlog import SessionLog, redact


def test_redaction_patterns():
    assert redact("DASHSCOPE_API_KEY=sk-sp-abc123456") == "DASHSCOPE_API_KEY=***"
    assert redact("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc") == "Authorization: Bearer ***"
    assert redact("key sk-ant-api03-XXXXXXXXXXXX end") == "key sk-*** end"
    assert redact("x-api-key: sk-ant-1234567890") == "x-api-key: ***"
    assert redact("kein Geheimnis hier") == "kein Geheimnis hier"


def test_log_writes_redacted_jsonl(tmp_path):
    log = SessionLog(tmp_path, "efh-satteldach", "abc")
    log.write("user", text="mein Key ist DASHSCOPE_API_KEY=sk-sp-abc123456 ok")
    log.event({"type": "error", "message": "401 with Bearer geheim12345 sent"})
    log.event({"type": "text_delta", "text": "nicht geloggt"})
    lines = [json.loads(l) for l in log.path.read_text(encoding="utf-8").splitlines()]
    assert len(lines) == 2
    assert lines[0]["text"] == "mein Key ist DASHSCOPE_API_KEY=*** ok"
    assert "geheim" not in lines[1]["message"] and lines[1]["kind"] == "error"
    assert log.path.name.endswith("-efh-satteldach.jsonl")
