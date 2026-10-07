"""Session state: message history, token/cost ledger, turn counter.

One Session per CLI run or WebSocket connection. The system prompt is built once
(byte-stable, prompt-cache invariant) and stored as history[0]. Switching the
provider/model keeps history and ledger — only the transport changes.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone

from harness.agent.costs import CostLedger, format_eur
from harness.agent.messages import Message
from harness.providers.base import ProviderProfile


@dataclass
class Session:
    provider_name: str
    model: str
    mode: str
    project: str | None = None
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    started: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    history: list[Message] = field(default_factory=list)
    ledger: CostLedger = field(default_factory=CostLedger)
    turns: int = 0
    tool_calls: int = 0
    compressions: int = 0

    # Convenience accessors kept for callers/tests written against 67-01.
    @property
    def input_tokens(self) -> int:
        return self.ledger.input_tokens

    @property
    def output_tokens(self) -> int:
        return self.ledger.output_tokens

    def set_system_prompt(self, text: str) -> None:
        if self.history and self.history[0].role == "system":
            self.history[0] = Message(role="system", content=text)
        else:
            self.history.insert(0, Message(role="system", content=text))

    def add_usage(self, input_tokens: int, output_tokens: int, *, estimated: bool = False) -> None:
        self.ledger.add(self.turns, input_tokens, output_tokens, estimated=estimated,
                        provider=self.provider_name, model=self.model)

    def switch(self, provider_name: str, model: str) -> None:
        """Runtime /model: transport changes, history and ledger stay."""
        self.provider_name, self.model = provider_name, model

    def kosten_eur(self, profile: ProviderProfile) -> float | None:
        return self.ledger.kosten_eur(profile)

    def status(self, profile: ProviderProfile, display_name: str) -> dict:
        from harness.agent.compression import window_of
        kosten = self.kosten_eur(profile)
        window, assumed = window_of(profile)
        return {
            "session": self.id,
            "mode": self.mode,
            "display_name": display_name,
            "provider": self.provider_name,
            "model": self.model,
            "projekt": self.project,
            "turns": self.turns,
            "tool_calls": self.tool_calls,
            "tokens": {"input": self.input_tokens, "output": self.output_tokens,
                       "total": self.input_tokens + self.output_tokens,
                       "estimated": self.ledger.estimated},
            "kosten_eur": None if kosten is None else round(kosten, 6),
            "context_window": window,
            "context_window_assumed": assumed,
            "context_used": self.ledger.last_input_tokens,
            "compressions": self.compressions,
        }


def format_status(s: dict) -> str:
    """Human-readable /status for the CLI (German, UI language)."""
    fenster = f"{s['context_window']:,}".replace(",", ".") + (" [ASSUMED]" if s.get("context_window_assumed") else "")
    est = " (geschätzt)" if s["tokens"].get("estimated") else ""
    return (
        f"{s['display_name']} · Modus {s['mode']}\n"
        f"Projekt: {s['projekt'] or '—'} · Provider: {s['provider']} · Modell: {s['model']}\n"
        f"Turns: {s['turns']} · Tool-Aufrufe: {s['tool_calls']} · Tokens: {s['tokens']['input']} rein / "
        f"{s['tokens']['output']} raus{est} · Kosten: {format_eur(s['kosten_eur'])}\n"
        f"Kontext: {s.get('context_used', 0)} von {fenster} zuletzt belegt · Kompressionen: {s.get('compressions', 0)}"
    )
