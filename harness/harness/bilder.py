"""Images of the view as context for the model (plan 106-06) - the harness half.

The app sends a speech-profile task with `bilder: [{png_base64}]` and `projekt_id` (WebSocket /ws/chat). Before an image reaches a provider,
the harness checks on its own - it does not trust the browser:
  1. the images: PNG, at most BILD_KANTE_MAX px per edge, BILD_BYTES_MAX bytes, BILD_ANZAHL_MAX images (same limits as
     packages/nova-core/src/lib/zeigen/bildKontext.js),
  2. the model reads images (`kann_bilder`): the profile quirk `vision` wins (true/false or a list of model names), else the app's catalog of
     local models (lokaleModelle.json, `faehigkeiten` contains "vision"), else the model-id patterns BILD_MODELL_MUSTER - the SAME list as
     modellKatalog.js in the app (a unit test of the app compares both); unknown = no,
  3. the project's rules from the app's store (`GET {api}/llm/bild-freigabe?projekt_id=…&ziel=lokal|extern`): NDA marker -> never an image,
     "Nur lokale KI" / office switch, and the person's once-per-project consent when the image leaves this computer (decision D-IM-02).
     The app not reachable = no image (fail closed).
"Nur lokale KI" of the harness itself is enforced earlier: a non-local profile cannot even be built (providers/registry.py).
An image is only context; the target of a change stays the GUID held at the sentence (`ziel`), and every change waits for the person (D-IM-04).

In: the raw `bilder` of a message, the provider profile and model, the API URL. Out: checked image list, decisions with German sentences.
"""

from __future__ import annotations

import base64
import binascii
import json
import os
import re
from pathlib import Path
from typing import Any, Awaitable, Callable
from urllib.parse import urlencode, urlsplit

import httpx

from harness.lokal import profile_is_local
from harness.providers.base import ProviderProfile

#: Longest edge of an image, px (plan 106-06 Task 1; the viewer renders at most this width for a model).
BILD_KANTE_MAX = 1280
#: Largest decoded PNG, bytes [ASSUMED, same value and reason as bildKontext.js BILD_BYTES_MAX].
BILD_BYTES_MAX = 3 * 1024 * 1024
#: Most images in one task [ASSUMED, same as bildKontext.js BILD_ANZAHL_MAX].
BILD_ANZAHL_MAX = 2

#: Model-id patterns of models that read images - KEEP EQUAL to BILD_MODELL_MUSTER in packages/nova-core/src/lib/modellKatalog.js
#: (tests/unit/llmBild-10606.test.js reads this block). [ASSUMED, Stand 25.10.2026] from the vendors' public model pages.
# BILD_MODELL_MUSTER-ANFANG
BILD_MODELL_MUSTER: tuple[str, ...] = (
    "^claude-(3|sonnet|opus|haiku)",
    "^gpt-4o(?!.*(audio|realtime|transcribe|tts|search))",
    "^gpt-4\\.1",
    "^gpt-5(?!.*(audio|realtime|transcribe|tts))",
    "^o3(?!-mini)",
    "^o4-mini",
    "^gemini-(?!.*(embedding|tts|audio))",
    "^gemma-?3n",
    "^gemma-?3[-:._]?(4|12|27)b",
    "^gemma-?4",
    "^qwen[0-9.]*-?vl",
    "^pixtral",
    "^llava",
    "^llama-?3\\.2-?vision",
    "^llama-?4",
    "^minicpm-v",
    "^moondream",
)
# BILD_MODELL_MUSTER-ENDE

#: Path of the app's catalog of local models below the repository root.
KATALOG_PFAD = Path("packages") / "nova-core" / "src" / "lib" / "lokaleModelle.json"

#: Default address of the app's API (same default as tools/mcp-server.mjs).
STANDARD_API_URL = "http://127.0.0.1:3001/api"


class BildFehler(ValueError):
    """An image is refused; the message is the German sentence for the person."""


def _tag_gleich(a: str, b: str) -> bool:
    """Local model tags: "gemma4" and "gemma4:latest" are the same model (same rule as modellKatalog.tagGleich)."""
    def norm(s: str) -> str:
        t = (s or "").strip().lower()
        return t if ":" in t else f"{t}:latest"
    return norm(a) == norm(b)


def katalog_vision(repo_root: Path | None) -> dict[str, bool]:
    """{tag: reads images} from the app's catalog; {} when the file is not there (a harness outside the repository)."""
    if repo_root is None:
        return {}
    try:
        data = json.loads((repo_root / KATALOG_PFAD).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    out: dict[str, bool] = {}
    for e in data.get("modelle") or []:
        if isinstance(e, dict) and isinstance(e.get("tag"), str):
            out[e["tag"]] = "vision" in (e.get("faehigkeiten") or [])
    return out


def kann_bilder(profile: ProviderProfile, model: str | None, *, katalog: dict[str, bool] | None = None) -> bool:
    """Whether this profile/model reads images: quirk `vision` > catalog > patterns; unknown = False."""
    q = profile.quirks.get("vision")
    if isinstance(q, bool):
        return q
    m = (model or "").strip()
    if isinstance(q, (list, tuple)):
        return m in [str(x) for x in q]
    if profile.api_mode == "mock":
        return False  # the mock reads nothing; a test that wants images sets quirks.vision
    if not m:
        return False
    for tag, vision in (katalog or {}).items():
        if _tag_gleich(m, tag):
            return vision
    kurz = m.rsplit("/", 1)[-1]
    return any(re.search(p, kurz, re.IGNORECASE) for p in BILD_MODELL_MUSTER)


def _png_masse(raw: bytes) -> tuple[int, int] | None:
    if len(raw) < 24 or raw[:8] != b"\x89PNG\r\n\x1a\n" or raw[12:16] != b"IHDR":
        return None
    w, h = int.from_bytes(raw[16:20], "big"), int.from_bytes(raw[20:24], "big")
    return (w, h) if w > 0 and h > 0 else None


def bilder_pruefen(roh: Any) -> list[str]:
    """The checked base64 PNGs of a message (without data: prefix); [] for none. Raises BildFehler with a German sentence."""
    if roh is None:
        return []
    if not isinstance(roh, list):
        raise BildFehler("bilder: eine Liste [{png_base64}] erwartet")
    if len(roh) > BILD_ANZAHL_MAX:
        raise BildFehler(f"Höchstens {BILD_ANZAHL_MAX} Bilder je Auftrag")
    out: list[str] = []
    for i, b in enumerate(roh, 1):
        s = str((b or {}).get("png_base64") or "").strip() if isinstance(b, dict) else ""
        if s.startswith("data:image/png;base64,"):
            s = s[len("data:image/png;base64,"):]
        if not s:
            raise BildFehler(f"Bild {i}: png_base64 fehlt")
        try:
            raw = base64.b64decode(s, validate=True)
        except (binascii.Error, ValueError):
            raise BildFehler(f"Bild {i}: kein base64") from None
        masse = _png_masse(raw)
        if masse is None:
            raise BildFehler(f"Bild {i}: kein PNG")
        if masse[0] > BILD_KANTE_MAX or masse[1] > BILD_KANTE_MAX:
            raise BildFehler(f"Bild {i}: {masse[0]} × {masse[1]} px — höchstens {BILD_KANTE_MAX} px Kante")
        if len(raw) > BILD_BYTES_MAX:
            raise BildFehler(f"Bild {i}: größer als {BILD_BYTES_MAX // (1024 * 1024)} MB")
        out.append(s)
    return out


def api_url(settings_api_url: str | None = None) -> str:
    """The app's API: the `mcp.api_url` of config.yaml, else BIT_API_URL, else the default."""
    return (settings_api_url or os.environ.get("BIT_API_URL") or STANDARD_API_URL).rstrip("/")


#: Signature of the project check (injectable for tests): (projekt_id, ziel_lokal, anbieter, host) -> answer of /llm/bild-freigabe.
FreigabeFn = Callable[[str, bool, str, str], Awaitable[dict[str, Any]]]


def freigabe_ueber_app(base: str, *, transport: httpx.AsyncBaseTransport | None = None, timeout: float = 5.0) -> FreigabeFn:
    """The project check against the app's store. Any failure (app down, no JSON) is a refusal - fail closed."""
    async def pruefen(projekt_id: str, ziel_lokal: bool, anbieter: str, host: str) -> dict[str, Any]:
        q = urlencode({"projekt_id": projekt_id, "ziel": "lokal" if ziel_lokal else "extern", "anbieter": anbieter, "host": host})
        try:
            async with httpx.AsyncClient(transport=transport, timeout=timeout) as client:
                resp = await client.get(f"{base}/llm/bild-freigabe?{q}")
                data = resp.json()
        except (httpx.HTTPError, ValueError):
            return {"ok": False, "grund": "app", "text": "BIT-Atelier antwortet nicht — ohne Prüfung des Projekts geht kein Bild an ein Modell"}
        if not isinstance(data, dict):
            return {"ok": False, "grund": "app", "text": "Unerwartete Antwort der App — kein Bild gesendet"}
        return data
    return pruefen


async def bild_erlaubt(
    roh: Any, projekt_id: Any, profile: ProviderProfile, model: str | None, *,
    freigabe: FreigabeFn, katalog: dict[str, bool] | None = None,
) -> list[str]:
    """All checks for the images of one message, in the order of the app (bildKontext.js, D-IM-02): images valid, project present,
    the project's final refusals (NDA, "Nur lokale KI", office switch, app not reachable), model reads images, the person's consent.
    So an NDA project hears the NDA sentence, not the vision sentence (review fix 106-06), and nobody is asked to consent for a model
    that could not read the image anyway.
    Returns the base64 images to send ([] when there are none). Raises BildFehler with the sentence for the person - nothing is sent then."""
    bilder = bilder_pruefen(roh)
    if not bilder:
        return []
    pid = str(projekt_id or "").strip()
    if not pid:
        raise BildFehler("Ohne geöffnetes Projekt geht kein Bild an ein Sprachmodell (NDA-Merker und Zustimmung hängen am Projekt)")
    lokal = profile_is_local(profile)
    host = urlsplit(profile.base_url or "").hostname or ""
    antwort = await freigabe(pid, lokal, profile.name, host)
    erlaubt = antwort.get("ok") is True
    if not erlaubt and antwort.get("grund") != "zustimmung":
        raise BildFehler(str(antwort.get("text") or "Bild nicht freigegeben"))
    if not kann_bilder(profile, model, katalog=katalog):
        raise BildFehler(
            f"Das Modell „{model or '?'}“ (Profil {profile.name}) versteht laut Katalog keine Bilder — nichts wurde gesendet. "
            "Ohne Bild senden oder ein Bildmodell wählen.")
    if not erlaubt:
        raise BildFehler(str(antwort.get("text") or "Bild nicht freigegeben"))
    return bilder
