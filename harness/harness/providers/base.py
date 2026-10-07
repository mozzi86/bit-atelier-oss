"""Provider contract (Hermes pattern): a profile is declarative data, a transport
is one class per HTTP dialect. Adding a vendor = adding a YAML profile, not code.

In: ProviderProfile from providers.yaml; Out: LLMProvider.chat() yields Events.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, AsyncIterator

from harness.agent.messages import Message, ToolSchema

API_MODES = ("anthropic", "openai_compat", "mock")


@dataclass(frozen=True)
class ProviderProfile:
    name: str
    api_mode: str
    base_url: str | None = None
    env_var: str | None = None
    models: tuple[str, ...] = ()
    default_model: str | None = None
    aux_model: str | None = None
    context_window: int | None = None
    preis_in_pro_mio: float | None = None
    preis_out_pro_mio: float | None = None
    quirks: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.api_mode not in API_MODES:
            raise ValueError(f"Profil {self.name!r}: api_mode={self.api_mode!r} unbekannt (erlaubt: {', '.join(API_MODES)})")

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "ProviderProfile":
        if "api_key" in d:
            # Keys belong in .env — refuse loudly instead of silently accepting a leak.
            raise ValueError(f"Profil {d.get('name')!r}: api_key gehört nicht in providers.yaml, nur env_var")
        models = tuple(d.get("models") or ())
        return cls(
            name=str(d["name"]),
            api_mode=str(d["api_mode"]),
            base_url=d.get("base_url"),
            env_var=d.get("env_var"),
            models=models,
            default_model=d.get("default_model") or (models[0] if models else None),
            aux_model=d.get("aux_model"),
            context_window=d.get("context_window"),
            preis_in_pro_mio=d.get("preis_in_pro_mio"),
            preis_out_pro_mio=d.get("preis_out_pro_mio"),
            quirks=dict(d.get("quirks") or {}),
        )

    def kosten_eur(self, input_tokens: int, output_tokens: int) -> float | None:
        """EUR for the given usage, or None when the profile carries no price (no guessing)."""
        if self.preis_in_pro_mio is None or self.preis_out_pro_mio is None:
            return None
        return (input_tokens * self.preis_in_pro_mio + output_tokens * self.preis_out_pro_mio) / 1_000_000


class LLMProvider(ABC):
    """One transport. `chat` yields Events: text_delta*, tool_call*, usage, done | error."""

    def __init__(self, profile: ProviderProfile):
        self.profile = profile

    @abstractmethod
    def chat(
        self,
        messages: list[Message],
        tools: list[ToolSchema],
        *,
        model: str,
        stream: bool = True,
        max_tokens: int = 4096,
    ) -> AsyncIterator[dict[str, Any]]:
        ...
