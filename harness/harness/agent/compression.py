"""Context compression (Hermes thresholds): when the last model call used more than
50 % of the context window, the middle of the history is replaced by ONE summary
note; the first `protect_head` and last `protect_tail` messages stay untouched.

The note is a `system` message tagged name="kompression". It is the only system
message allowed after position 0 (check_alternation skips it); both translators
carry it as a system entry. No synthetic user turn is ever inserted.

Cut rule: the tail must start with a message that alternates correctly with the
last protected head message (head ends user → tail starts assistant; head ends
assistant → tail starts user) and never with a `tool` result — otherwise the
provider would see a tool_use without its result.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from harness.agent.messages import Message, ev_text_delta
from harness.agent.session import Session
from harness.providers.base import LLMProvider, ProviderProfile

DEFAULT_WINDOW = 128_000  # [ASSUMED] when the profile carries no context_window
NOTE_NAME = "kompression"
MAX_SUMMARY_CHARS = 6000

SUMMARY_SYSTEM = (
    "Du verdichtest einen Gesprächsverlauf zwischen Nutzer und Assistent für die weitere Arbeit. "
    "Behalte: Entscheidungen, Zahlen mit Einheit, Dateipfade, offene Fragen, was der Nutzer will. "
    "Lass weg: Höflichkeiten, Wiederholungen, rohe Werkzeugausgaben. Deutsch, Stichpunkte, höchstens 400 Wörter."
)


def estimate_tokens(messages: list[Message]) -> int:
    """Rough chars/4 estimate over the whole history (used only for reporting)."""
    return sum(len(m.content) + sum(len(str(tc.arguments)) for tc in m.tool_calls) for m in messages) // 4


def window_of(profile: ProviderProfile) -> tuple[int, bool]:
    """(context_window, assumed?)"""
    if profile.context_window:
        return int(profile.context_window), False
    return DEFAULT_WINDOW, True


def _tail_start(history: list[Message], head_end: int, nominal: int) -> int:
    """First index ≥ nominal whose role alternates with history[head_end-1] and is not `tool`."""
    prev = history[head_end - 1].role
    want = "user" if prev in ("assistant", "system") else "assistant"
    i = nominal
    while i < len(history) and (history[i].role != want):
        i += 1
    return i


def plan_cut(history: list[Message], *, protect_head: int = 3, protect_tail: int = 20) -> tuple[int, int] | None:
    """Return (head_end, tail_start) or None when there is nothing worth compressing."""
    n = len(history)
    if n <= protect_head + protect_tail + 2:
        return None
    head_end = min(protect_head, n)
    # never end the head on an assistant tool call — its results would be cut away
    while head_end > 1 and history[head_end - 1].role in ("tool",) or (head_end > 1 and history[head_end - 1].tool_calls):
        head_end -= 1
    tail_start = _tail_start(history, head_end, max(head_end + 1, n - protect_tail))
    if tail_start >= n or tail_start - head_end < 2:
        return None
    return head_end, tail_start


@dataclass
class Compression:
    profile: ProviderProfile
    threshold: float = 0.5
    protect_head: int = 3
    protect_tail: int = 20

    def needed(self, session: Session) -> bool:
        window, _ = window_of(self.profile)
        used = session.ledger.last_input_tokens or estimate_tokens(session.history)
        return used > self.threshold * window

    async def summarize(self, provider: LLMProvider, chunk: list[Message], model: str) -> str:
        transcript = "\n".join(
            f"[{m.role}{' ' + (m.name or '') if m.role == 'tool' else ''}] "
            + (m.content[:4000] if m.content else "")
            + ("".join(f" → {tc.name}({tc.arguments})" for tc in m.tool_calls))
            for m in chunk
        )
        parts: list[str] = []
        async for ev in provider.chat([Message("system", SUMMARY_SYSTEM), Message("user", transcript)], [],
                                      model=model, max_tokens=1200):
            if ev.get("type") == "text_delta":
                parts.append(ev["text"])
            elif ev.get("type") == "error":
                raise RuntimeError(ev.get("message", "Zusammenfassung fehlgeschlagen"))
        summary = "".join(parts).strip()
        # A summary longer than this defeats the purpose (≈1.5k tokens); cut, do not fail.
        return summary if len(summary) <= MAX_SUMMARY_CHARS else summary[:MAX_SUMMARY_CHARS] + " … [gekürzt]"

    async def run(self, session: Session, provider: LLMProvider) -> dict[str, Any] | None:
        """Compress once if needed; returns the `compression` event or None."""
        if not self.needed(session):
            return None
        cut = plan_cut(session.history, protect_head=self.protect_head, protect_tail=self.protect_tail)
        if cut is None:
            return None
        head_end, tail_start = cut
        chunk = session.history[head_end:tail_start]
        before_msgs, before_tok = len(session.history), estimate_tokens(session.history)
        model = self.profile.aux_model or session.model
        try:
            summary = await self.summarize(provider, chunk, model)
        except RuntimeError as exc:
            return {"type": "error", "message": f"Kompression übersprungen: {exc}"}
        note = Message("system", f"Zusammenfassung des bisherigen Verlaufs ({len(chunk)} Nachrichten verdichtet):\n{summary}",
                       name=NOTE_NAME)
        session.history[head_end:tail_start] = [note]
        session.ledger.last_input_tokens = 0  # unknown until the next call reports usage
        return {"type": "compression", "vorher": before_msgs, "nachher": len(session.history),
                "tokens_vorher": before_tok, "tokens_nachher": estimate_tokens(session.history),
                "modell": model}


__all__ = ["Compression", "plan_cut", "estimate_tokens", "window_of", "NOTE_NAME", "ev_text_delta"]
