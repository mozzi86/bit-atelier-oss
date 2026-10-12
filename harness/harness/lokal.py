"""Local AI inside BIT-Atelier (plan 93-12): loopback detection and the app's local connection.

The app's local server starts the harness as a child process and hands over, via environment:
  BIT_NUR_LOKAL=1        "Nur lokale KI" — every provider profile that does not talk to this computer is
                         refused (mock is allowed: it never leaves the process)
  BIT_LOKAL_BASE_URL     OpenAI-compatible base of the app's active local connection (LM Studio, Ollama /v1)
  BIT_LOKAL_MODELL       its model name
  BIT_LOKAL_ART          "ollama" | "openai" (Ollama lists its models under /api/tags)
`config.load_config` reads them; `app_lokal_profile` turns them into the provider profile "app-lokal".

Same rules as packages/nova-core/src/lib/kiLokal.js (istLoopbackHost): localhost and *.localhost,
127.0.0.0/8, ::1 and IPv4-mapped ::ffff:127.x.x.x. Hosts are taken from urllib's parser, so
http://127.0.0.1@evil.example resolves to evil.example and is refused.
"""

from __future__ import annotations

import ipaddress
from urllib.parse import urlsplit

from harness.providers.base import ProviderProfile

APP_LOKAL = "app-lokal"

NUR_LOKAL_TEXT = (
    "Nur lokale KI ist eingeschaltet (Einstellungen › KI in BIT-Atelier): Profil {profil!r} spricht mit "
    "{host}, nicht mit diesem Rechner — die Anfrage wird nicht gesendet. Ein lokales Profil wählen "
    "(app-lokal, lmstudio, ollama) oder den Schalter ausschalten."
)

# Read timeout for local models, seconds. [ASSUMED] 15 min: a 27 B model partly on the CPU needs minutes
# before the first token of a long prompt; the default 300 s of openai_compat would cut it off.
LOKAL_TIMEOUT_S = 900


def is_loopback_host(host: str | None) -> bool:
    h = (host or "").strip().lower().strip("[]")
    if not h:
        return False
    if h == "localhost" or h.endswith(".localhost"):
        return True
    try:
        ip = ipaddress.ip_address(h)
    except ValueError:
        return False
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        return ip.ipv4_mapped.is_loopback
    return ip.is_loopback


def is_loopback_url(url: str | None) -> bool:
    try:
        parts = urlsplit((url or "").strip())
    except ValueError:
        return False
    if parts.scheme not in ("http", "https"):
        return False
    return is_loopback_host(parts.hostname)


def profile_is_local(profile: ProviderProfile) -> bool:
    """True when using this profile sends nothing off this computer."""
    if profile.api_mode == "mock":
        return True
    urls = [profile.base_url]
    if profile.quirks.get("models_url"):
        urls.append(str(profile.quirks["models_url"]))
    return all(is_loopback_url(u) for u in urls)


def refusal(profile: ProviderProfile) -> str:
    host = urlsplit(profile.base_url or "").hostname or "einem unbekannten Ziel"
    return NUR_LOKAL_TEXT.format(profil=profile.name, host=host)


def app_lokal_profile(base_url: str, model: str, art: str = "openai") -> ProviderProfile:
    """The app's local connection as an openai_compat profile (no key, long timeout)."""
    base = base_url.rstrip("/")
    quirks: dict = {"include_usage": True, "timeout_s": LOKAL_TIMEOUT_S}
    if art == "ollama":
        root = base[:-3] if base.endswith("/v1") else base
        quirks["models_url"] = f"{root}/api/tags"
    return ProviderProfile(
        name=APP_LOKAL, api_mode="openai_compat", base_url=base, env_var=None,
        models=(), default_model=model or None, aux_model=model or None,
        context_window=32768,  # [ASSUMED] depends on the loaded model's context length
        preis_in_pro_mio=0, preis_out_pro_mio=0, quirks=quirks,
    )
