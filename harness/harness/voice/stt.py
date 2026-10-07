"""Speech-to-text: TranscriptionProvider ABC (Hermes pattern) + FasterWhisperProvider.

In: audio bytes (webm/opus from the browser, wav from the CLI) + mime.
Out: {text, dauer_s, geraet, modell}. Audio stays in memory — nothing is written
to disk except faster-whisper's own model cache (T-67-15). The model loads on
first use in a background thread; until then the route answers 503 "lädt".

webm/opus is decoded with ffmpeg (on PATH on this machine — `harness doctor`
checks) to 16 kHz mono PCM; wav is read directly.
"""

from __future__ import annotations

import io
import shutil
import subprocess
import threading
import time
import wave
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any

from harness.voice.devices import DeviceChoice, EXTRA_HINT, choose_device, register_cuda_dlls, voice_extra_available

SAMPLE_RATE = 16_000
MODEL_SIZES_MB = {"tiny": 75, "base": 145, "small": 480, "medium": 1500, "large-v3": 3100}  # [ASSUMED] approx. download sizes


class SttNotReady(Exception):
    """Model still loading — the route turns this into 503."""


class SttUnavailable(Exception):
    """Extra missing or disabled — the route turns this into 501."""


@dataclass
class Transcript:
    text: str
    dauer_s: float
    geraet: str
    modell: str
    audio_s: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {"text": self.text, "dauer_s": round(self.dauer_s, 2), "geraet": self.geraet,
                "modell": self.modell, "audio_s": round(self.audio_s, 2)}


class TranscriptionProvider(ABC):
    @abstractmethod
    def transcribe(self, audio: bytes, mime: str, language: str = "de") -> Transcript: ...

    def status(self) -> dict[str, Any]:
        return {}


# --- audio decoding ----------------------------------------------------------------

def _wav_to_float32(data: bytes):
    import numpy as np
    with wave.open(io.BytesIO(data), "rb") as w:
        ch, width, rate, n = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
        raw = w.readframes(n)
    if width != 2:
        raise ValueError(f"WAV mit {width * 8} Bit — 16 Bit PCM erwartet")
    pcm = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    if ch > 1:
        pcm = pcm.reshape(-1, ch).mean(axis=1)
    if rate != SAMPLE_RATE:
        # linear resample — good enough for speech; ffmpeg path handles the browser case
        idx = np.linspace(0, len(pcm) - 1, int(len(pcm) * SAMPLE_RATE / rate))
        pcm = np.interp(idx, np.arange(len(pcm)), pcm).astype(np.float32)
    return pcm


def decode_to_pcm(audio: bytes, mime: str):
    """→ float32 mono 16 kHz numpy array. wav directly, everything else via ffmpeg."""
    if mime.startswith("audio/wav") or mime.startswith("audio/x-wav") or audio[:4] == b"RIFF":
        return _wav_to_float32(audio)
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise ValueError("ffmpeg fehlt — für webm/opus-Aufnahmen nötig (winget install Gyan.FFmpeg) oder WAV senden")
    proc = subprocess.run(
        [ffmpeg, "-loglevel", "error", "-i", "pipe:0", "-f", "wav", "-ac", "1", "-ar", str(SAMPLE_RATE), "pipe:1"],
        input=audio, capture_output=True, timeout=60,
    )
    if proc.returncode != 0 or not proc.stdout:
        raise ValueError(f"ffmpeg konnte die Aufnahme nicht lesen: {proc.stderr.decode('utf-8', 'replace')[:200]}")
    return _wav_to_float32(proc.stdout)


# --- faster-whisper ----------------------------------------------------------------

class FasterWhisperProvider(TranscriptionProvider):
    def __init__(self, model_name: str = "small", language: str = "de", *, device: DeviceChoice | None = None,
                 preload: bool = True):
        if not voice_extra_available():
            raise SttUnavailable(EXTRA_HINT)
        register_cuda_dlls()
        self.model_name = model_name
        self.language = language
        self._device = device
        self._model = None
        self._error: str | None = None
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        if preload:
            self.start_loading()

    # loading -------------------------------------------------------------------
    def _try_load(self, device: str, compute_type: str) -> None:
        """Create the model AND run one encode on a second of silence. Constructing a
        CUDA model succeeds without cuBLAS/cuDNN — the first encode is what fails
        (`cublas64_12.dll is not found`, measured on this machine 05.09.2026). VAD is
        off for the probe: with VAD the silence yields no segment and no encode."""
        import numpy as np
        from faster_whisper import WhisperModel
        model = WhisperModel(self.model_name, device=device, compute_type=compute_type)
        segments, _ = model.transcribe(np.zeros(SAMPLE_RATE, dtype=np.float32), language=self.language,
                                       beam_size=1, vad_filter=False, without_timestamps=True)
        for _ in segments:  # generator — consume to force the encode
            pass
        self._model = model

    def _load(self) -> None:
        try:
            if self._device is None:
                self._device = choose_device(try_load=self._try_load)
            if self._model is None:
                self._try_load(self._device.geraet, self._device.compute_type)
        except Exception as exc:  # surfaced through status()/transcribe(), never swallowed
            self._error = f"{exc.__class__.__name__}: {exc}"

    def start_loading(self) -> None:
        with self._lock:
            if self._thread is None or not self._thread.is_alive():
                self._thread = threading.Thread(target=self._load, name="stt-load", daemon=True)
                self._thread.start()

    @property
    def ready(self) -> bool:
        return self._model is not None

    def status(self) -> dict[str, Any]:
        d = {"modell": self.model_name, "sprache": self.language, "bereit": self.ready,
             "geraet": self._device.geraet if self._device else None,
             "compute_type": self._device.compute_type if self._device else None,
             "warnung": self._device.warnung if self._device else "",
             "download_mb": MODEL_SIZES_MB.get(self.model_name)}
        if self._error:
            d["fehler"] = self._error
        return d

    # transcription --------------------------------------------------------------
    def transcribe(self, audio: bytes, mime: str, language: str | None = None) -> Transcript:
        if self._error:
            raise SttUnavailable(f"STT-Modell konnte nicht geladen werden — {self._error}")
        if not self.ready:
            self.start_loading()
            raise SttNotReady(f"Modell {self.model_name} lädt noch ({MODEL_SIZES_MB.get(self.model_name, '?')} MB beim ersten Mal)")
        pcm = decode_to_pcm(audio, mime)
        t0 = time.perf_counter()
        try:
            text, info = self._run(pcm, language or self.language)
        except RuntimeError as exc:
            # GPU went away or a CUDA library failed mid-flight: one honest fallback to CPU.
            if self._device and self._device.geraet == "cuda":
                from harness.voice.devices import CUDA_DLL_HINT, DeviceChoice
                self._device = DeviceChoice("cpu", "int8", f"{CUDA_DLL_HINT} ({exc})")
                self._model = None
                self._try_load("cpu", "int8")
                text, info = self._run(pcm, language or self.language)
            else:
                raise
        return Transcript(text=text, dauer_s=time.perf_counter() - t0, geraet=self._device.geraet if self._device else "?",
                          modell=self.model_name, audio_s=float(getattr(info, "duration", 0.0) or len(pcm) / SAMPLE_RATE))

    def _run(self, pcm, language: str):
        segments, info = self._model.transcribe(pcm, language=language, beam_size=1, vad_filter=True)
        return " ".join(s.text.strip() for s in segments).strip(), info
