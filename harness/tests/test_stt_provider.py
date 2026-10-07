"""STT provider pieces without a model: WAV decoding, Transcript shape, the
optional real run (marker `voice`, downloads `tiny`)."""

import io
import math
import struct
import wave

import pytest

from harness.voice.stt import SAMPLE_RATE, Transcript, decode_to_pcm


def make_wav(seconds: float = 0.5, rate: int = 16_000, channels: int = 1, freq: float = 440.0) -> bytes:
    n = int(seconds * rate)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(2)
        w.setframerate(rate)
        frames = bytearray()
        for i in range(n):
            v = int(12000 * math.sin(2 * math.pi * freq * i / rate))
            for _ in range(channels):
                frames += struct.pack("<h", v)
        w.writeframes(bytes(frames))
    return buf.getvalue()


def test_wav_mono_16k_decodes_to_float32():
    pytest.importorskip("numpy")  # comes with the [voice] extra; the core venv has no numpy
    pcm = decode_to_pcm(make_wav(0.5), "audio/wav")
    assert pcm.dtype.name == "float32" and len(pcm) == SAMPLE_RATE // 2
    assert -1.0 <= float(pcm.min()) and float(pcm.max()) <= 1.0


def test_wav_stereo_44k_is_downmixed_and_resampled():
    pytest.importorskip("numpy")  # comes with the [voice] extra; the core venv has no numpy
    pcm = decode_to_pcm(make_wav(0.25, rate=44_100, channels=2), "audio/wav")
    assert abs(len(pcm) - SAMPLE_RATE // 4) <= 2


def test_riff_sniffing_ignores_wrong_mime():
    pytest.importorskip("numpy")  # comes with the [voice] extra; the core venv has no numpy
    pcm = decode_to_pcm(make_wav(0.1), "application/octet-stream")
    assert len(pcm) == SAMPLE_RATE // 10


def test_unknown_format_without_ffmpeg_is_plain_error(monkeypatch):
    import harness.voice.stt as stt
    monkeypatch.setattr(stt.shutil, "which", lambda name: None)
    with pytest.raises(ValueError, match="ffmpeg fehlt"):
        decode_to_pcm(b"\x1a\x45\xdf\xa3 not really webm", "audio/webm")


def test_transcript_dict_rounds():
    t = Transcript("Guten Tag", 0.123456, "cpu", "tiny", 1.98765)
    assert t.to_dict() == {"text": "Guten Tag", "dauer_s": 0.12, "geraet": "cpu", "modell": "tiny", "audio_s": 1.99}


@pytest.mark.voice
def test_real_tiny_model_transcribes_speech_fixture():
    """Runs only with `-m voice`: downloads faster-whisper `tiny` (~75 MB) and needs
    the extra. The fixture is synthetic (a tone), so we only assert the pipeline
    returns a Transcript with a device and a duration — real German dictation is
    the manual check documented in the SUMMARY."""
    pytest.importorskip("faster_whisper")
    from harness.voice.stt import FasterWhisperProvider
    prov = FasterWhisperProvider("tiny", "de", preload=False)
    prov._load()
    assert prov.ready, prov.status()
    t = prov.transcribe(make_wav(1.0), "audio/wav")
    assert t.geraet in ("cuda", "cpu") and t.dauer_s > 0 and t.modell == "tiny"
