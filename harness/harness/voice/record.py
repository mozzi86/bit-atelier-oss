"""Terminal recording for `harness chat --voice`: 16 kHz mono WAV in memory via
sounddevice (PortAudio). Start on call, stop on Enter. No file is written.

Platform note: the plan asked for "hold Space"; a reliable key-hold needs a raw
terminal (msvcrt/termios) that breaks `input()` on Windows consoles — so the
CLI uses Enter to start and Enter to stop, which works in every terminal.
"""

from __future__ import annotations

import io
import wave

SAMPLE_RATE = 16_000


def record_until_enter(max_seconds: int = 120) -> bytes:
    try:
        import numpy as np
        import sounddevice as sd
    except Exception as exc:  # the extra is missing or PortAudio has no device
        raise RuntimeError(f"Aufnahme nicht möglich — {exc.__class__.__name__}: {exc}. Extra [voice] installiert? Mikrofon vorhanden?") from exc

    frames: list = []

    def cb(indata, frames_count, time_info, status):  # noqa: ARG001 — sounddevice signature
        frames.append(indata.copy())

    try:
        with sd.InputStream(samplerate=SAMPLE_RATE, channels=1, dtype="int16", callback=cb):
            print("● Aufnahme läuft — Enter beendet.", flush=True)
            input()
    except Exception as exc:
        raise RuntimeError(f"Mikrofon-Fehler: {exc}") from exc

    if not frames:
        raise RuntimeError("Keine Audiodaten aufgenommen")
    pcm = np.concatenate(frames, axis=0)[: max_seconds * SAMPLE_RATE]
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()
