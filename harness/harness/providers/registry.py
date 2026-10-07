"""Provider registry: providers.yaml → profiles; make_provider() picks the transport.

The mock profile is always present. openai_compat is declared in the contract but
its transport arrives in 67-02 — selecting it today fails with a clear sentence.
"""

from __future__ import annotations

from pathlib import Path

import yaml

from harness.config import env_key
from harness.providers.base import LLMProvider, ProviderProfile
from harness.providers.mock import MOCK_PROFILE, MockProvider


class ProviderRegistry:
    def __init__(self, profiles: list[ProviderProfile]):
        self._profiles: dict[str, ProviderProfile] = {"mock": MOCK_PROFILE}
        for p in profiles:
            self._profiles[p.name] = p

    @classmethod
    def load(cls, path: Path) -> "ProviderRegistry":
        if not path.exists():
            return cls([])
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        return cls([ProviderProfile.from_dict(d) for d in (data.get("profiles") or [])])

    def names(self) -> list[str]:
        return list(self._profiles)

    def get(self, name: str) -> ProviderProfile:
        try:
            return self._profiles[name]
        except KeyError:
            raise KeyError(f"Provider-Profil {name!r} nicht in providers.yaml (vorhanden: {', '.join(self._profiles)})") from None

    def make_provider(self, name: str) -> LLMProvider:
        profile = self.get(name)
        if profile.api_mode == "mock":
            return MockProvider(profile)
        if profile.api_mode == "anthropic":
            from harness.providers.anthropic import AnthropicProvider
            key = env_key(profile.env_var)
            if not key:
                raise ValueError(f"Profil {name!r}: Umgebungsvariable {profile.env_var} ist leer — in harness/.env setzen")
            return AnthropicProvider(profile, key)
        if profile.api_mode == "openai_compat":
            from harness.providers.openai_compat import OpenAICompatProvider
            key = env_key(profile.env_var)
            if profile.env_var and not key:
                raise ValueError(f"Profil {name!r}: Umgebungsvariable {profile.env_var} ist leer — in harness/.env setzen")
            return OpenAICompatProvider(profile, key)
        raise NotImplementedError(f"Profil {name!r}: api_mode {profile.api_mode!r} unbekannt")

    def key_status(self, name: str) -> str:
        """'vorhanden' | 'fehlt' | 'nicht nötig' — never the key itself (T-67-06)."""
        profile = self.get(name)
        if not profile.env_var:
            return "nicht nötig"
        return "vorhanden" if env_key(profile.env_var) else "fehlt"

    def replace(self, profile: ProviderProfile) -> None:
        """Update a profile in memory (e.g. models discovered by doctor)."""
        self._profiles[profile.name] = profile
