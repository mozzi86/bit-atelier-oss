"""Minimal Server-Sent-Events parser shared by the HTTP transports.

In: async iterator of text lines (httpx `aiter_lines`). Out: parsed JSON payloads
per event; multi-line `data:` is joined; `[DONE]` ends the stream; non-JSON data is
skipped (a provider quirk must not crash a turn).
"""

from __future__ import annotations

import json
from typing import Any, AsyncIterator


async def iter_sse_json(lines: AsyncIterator[str]) -> AsyncIterator[dict[str, Any]]:
    buf: list[str] = []

    def flush() -> dict[str, Any] | None:
        data = [ln[5:].strip() for ln in buf if ln.startswith("data:")]
        buf.clear()
        if not data:
            return None
        joined = "".join(data)
        if joined == "[DONE]":
            return {"__done__": True}
        try:
            return json.loads(joined)
        except json.JSONDecodeError:
            return None

    async for line in lines:
        if line.strip() == "":
            ev = flush()
            if ev is None:
                continue
            if ev.get("__done__"):
                return
            yield ev
        else:
            buf.append(line)
    ev = flush()
    if ev and not ev.get("__done__"):
        yield ev
