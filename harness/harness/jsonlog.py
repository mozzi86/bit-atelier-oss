"""Session log as JSONL + secret redaction.

Named jsonlog (not logging) on purpose: a module called `logging` inside the
package would shadow the standard library for anything run from this directory.

logs/<YYYY-MM-DD>-<projekt>.jsonl, one JSON object per line: prompts, tool calls,
usage, cost. redact() runs before EVERY write, including error texts.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REDACTIONS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"\bsk-[A-Za-z0-9_-]{8,}"), "sk-***"),
    (re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._\-~+/=]{8,}"), "Bearer ***"),
    (re.compile(r"(?i)\b([A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*)\s*=\s*\S+"), r"\1=***"),
    (re.compile(r"(?i)(x-api-key\s*[:=]\s*)\S+"), r"\1***"),
)


def redact(text: str) -> str:
    if not text:
        return text
    for rx, repl in REDACTIONS:
        text = rx.sub(repl, text)
    return text


def redact_obj(value: Any) -> Any:
    if isinstance(value, str):
        return redact(value)
    if isinstance(value, dict):
        return {k: redact_obj(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [redact_obj(v) for v in value]
    return value


class SessionLog:
    def __init__(self, logs_dir: Path, projekt: str | None, session_id: str):
        self.logs_dir = Path(logs_dir)
        self.projekt = projekt or "ohne-projekt"
        self.session_id = session_id
        day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        safe = re.sub(r"[^A-Za-z0-9_.-]+", "-", self.projekt)
        self.path = self.logs_dir / f"{day}-{safe}.jsonl"

    def write(self, kind: str, **fields: Any) -> None:
        record = {"ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                  "session": self.session_id, "kind": kind, **redact_obj(fields)}
        try:
            self.logs_dir.mkdir(parents=True, exist_ok=True)
            with self.path.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(record, ensure_ascii=False) + "\n")
        except OSError as exc:
            # Logging must never break a turn — but say so on stderr, do not swallow.
            import sys
            print(f"[harness] Log konnte nicht geschrieben werden: {exc}", file=sys.stderr)

    def event(self, ev: dict[str, Any]) -> None:
        t = ev.get("type")
        if t in ("tool_call", "tool_result", "usage", "error", "approval", "done"):
            self.write(t, **{k: v for k, v in ev.items() if k != "type"})
