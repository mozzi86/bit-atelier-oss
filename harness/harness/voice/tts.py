"""Optional text-to-speech with Piper (local, MIT). Default OFF.

In: text. Out: WAV bytes. Voice `de_DE-thorsten-medium` [ASSUMED]; the .onnx +
.json are downloaded once into the faster-whisper-style cache dir. Without the
`piper-tts` package the route answers 501 — the core never depends on it.
"""

from __future__ import annotations

import io
import wave
from pathlib import Path
from typing import Any

from harness.config import HARNESS_DIR

DEFAULT_VOICE = "de_DE-thorsten-medium"  # [ASSUMED] clear German male voice, medium quality
TTS_HINT = "TTS-Extra installieren: pip install piper-tts, Stimme nach harness/voices/ (siehe README)"


def tts_available() -> bool:
    try:
        import piper  # noqa: F401
        return True
    except Exception:
        return False


class PiperTts:
    def __init__(self, voice: str = DEFAULT_VOICE, voices_dir: Path | None = None):
        if not tts_available():
            raise RuntimeError(TTS_HINT)
        from piper import PiperVoice
        self.voice_name = voice
        d = voices_dir or (HARNESS_DIR / "voices")
        model = d / f"{voice}.onnx"
        if not model.exists():
            raise RuntimeError(f"Stimme fehlt: {model} — Download siehe README „Sprache“")
        self._voice = PiperVoice.load(str(model))

    def synthesize(self, text: str) -> bytes:
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            self._voice.synthesize(text, w)
        return buf.getvalue()

    def status(self) -> dict[str, Any]:
        return {"stimme": self.voice_name, "bereit": True}
