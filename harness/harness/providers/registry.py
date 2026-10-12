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
    def __init__(self, profiles: list[ProviderProfile], *, nur_lokal: bool = False):
        self._profiles: dict[str, ProviderProfile] = {"mock": MOCK_PROFILE}
        # 93-12: "Nur lokale KI" — make_provider() refuses every profile that leaves this computer.
        self.nur_lokal = nur_lokal
        for p in profiles:
            self._profiles[p.name] = p

    @classmethod
    def load(cls, path: Path, *, nur_lokal: bool = False) -> "ProviderRegistry":
        if not path.exists():
            return cls([], nur_lokal=nur_lokal)
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        return cls([ProviderProfile.from_dict(d) for d in (data.get("profiles") or [])], nur_lokal=nur_lokal)

    def check_local(self, name: str) -> None:
        """Raise ValueError with a plain German sentence when "Nur lokale KI" forbids this profile."""
        from harness.lokal import profile_is_local, refusal
        profile = self.get(name)
        if self.nur_lokal and not profile_is_local(profile):
            raise ValueError(refusal(profile))

    def names(self) -> list[str]:
        return list(self._profiles)

    def get(self, name: str) -> ProviderProfile:
        try:
            return self._profiles[name]
        except KeyError:
            raise KeyError(f"Provider-Profil {name!r} nicht in providers.yaml (vorhanden: {', '.join(self._profiles)})") from None

    def make_provider(self, name: str) -> LLMProvider:
        self.check_local(name)  # the one choke point every transport passes (CLI, WebSocket, doctor probe)
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
