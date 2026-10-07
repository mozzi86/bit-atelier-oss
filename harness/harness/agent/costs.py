"""Token and cost bookkeeping per session.

In: usage events (input/output tokens, optional `estimated` flag), the profile's
EUR-per-million prices. Out: totals, per-turn ledger, formatted strings. No price
in the profile → None → "—" (never a guess); estimated tokens are flagged.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from harness.providers.base import ProviderProfile


@dataclass
class TurnUsage:
    turn: int
    input_tokens: int
    output_tokens: int
    estimated: bool = False
    provider: str = ""
    model: str = ""


@dataclass
class CostLedger:
    entries: list[TurnUsage] = field(default_factory=list)
    input_tokens: int = 0
    output_tokens: int = 0
    estimated: bool = False          # True once any entry was an estimate
    last_input_tokens: int = 0       # context size seen by the last model call

    def add(self, turn: int, input_tokens: int, output_tokens: int, *, estimated: bool = False,
            provider: str = "", model: str = "") -> None:
        self.entries.append(TurnUsage(turn, int(input_tokens), int(output_tokens), estimated, provider, model))
        self.input_tokens += int(input_tokens)
        self.output_tokens += int(output_tokens)
        self.estimated = self.estimated or estimated
        if input_tokens:
            self.last_input_tokens = int(input_tokens)

    def kosten_eur(self, profile: ProviderProfile) -> float | None:
        return kosten_eur(profile, self.input_tokens, self.output_tokens)


def kosten_eur(profile: ProviderProfile, input_tokens: int, output_tokens: int) -> float | None:
    """EUR for the usage, e.g. 1000 in @ 3 €/Mio + 500 out @ 2 €/Mio = 0.003 + 0.001 = 0.004 €."""
    if profile.preis_in_pro_mio is None or profile.preis_out_pro_mio is None:
        return None
    return (input_tokens * profile.preis_in_pro_mio + output_tokens * profile.preis_out_pro_mio) / 1_000_000


def format_eur(value: float | None) -> str:
    """de-DE style for the CLI: 0,0040 €; None → —."""
    if value is None:
        return "—"
    s = f"{value:,.4f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"{s} €"
