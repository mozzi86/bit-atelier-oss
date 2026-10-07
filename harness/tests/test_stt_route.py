"""POST /stt and /tts through the TestClient with fake providers: 501 without the
extra, 503 while loading, 200 with text, 400 on empty upload; /status carries stt."""

from fastapi.testclient import TestClient

from harness.server import create_app
from harness.voice.stt import SttNotReady, Transcript, TranscriptionProvider
from tests.conftest import make_runtime
from tests.test_stt_provider import make_wav


class FakeStt(TranscriptionProvider):
    def __init__(self, ready=True):
        self.ready = ready
        self.seen = []

    def transcribe(self, audio, mime, language="de"):
        if not self.ready:
            raise SttNotReady("Modell tiny lädt noch (75 MB beim ersten Mal)")
        self.seen.append((len(audio), mime, language))
        return Transcript("Guten Tag, ein Test", 0.4, "cpu", "tiny", 1.0)

    def status(self):
        return {"modell": "tiny", "bereit": self.ready, "geraet": "cpu", "warnung": "läuft auf CPU"}


class FakeTts:
    def synthesize(self, text):
        return b"RIFF....WAVEfake" + text.encode()


def test_without_extra_501_with_install_hint(workspace):
    c = TestClient(create_app(make_runtime(workspace, "user"), stt=None))
    r = c.post("/stt", files={"audio": ("a.wav", make_wav(0.2), "audio/wav")})
    assert r.status_code == 501 and "pip install -e .[voice]" in r.json()["detail"]
    st = c.get("/status").json()
    assert st["stt"]["verfuegbar"] is False and st["tts"]["aktiv"] is False


def test_loading_503(workspace):
    c = TestClient(create_app(make_runtime(workspace, "user"), stt=FakeStt(ready=False)))
    r = c.post("/stt", files={"audio": ("a.wav", make_wav(0.2), "audio/wav")})
    assert r.status_code == 503 and "lädt noch" in r.json()["detail"]


def test_transcribes_and_reports_status(workspace):
    fake = FakeStt()
    c = TestClient(create_app(make_runtime(workspace, "user"), stt=fake))
    r = c.post("/stt?language=de", files={"audio": ("rec.webm", b"\x1a\x45\xdf\xa3fake", "audio/webm")})
    assert r.status_code == 200
    assert r.json() == {"text": "Guten Tag, ein Test", "dauer_s": 0.4, "geraet": "cpu", "modell": "tiny", "audio_s": 1.0}
    assert fake.seen == [(8, "audio/webm", "de")]  # 4 magic bytes + b"fake"
    st = c.get("/status").json()["stt"]
    assert st["verfuegbar"] is True and st["geraet"] == "cpu" and "CPU" in st["warnung"]


def test_empty_upload_400(workspace):
    c = TestClient(create_app(make_runtime(workspace, "user"), stt=FakeStt()))
    assert c.post("/stt", files={"audio": ("a.wav", b"", "audio/wav")}).status_code == 400


def test_tts_off_by_default_and_on_with_provider(workspace):
    c = TestClient(create_app(make_runtime(workspace, "user")))
    assert c.post("/tts", json={"text": "Hallo"}).status_code == 501
    c2 = TestClient(create_app(make_runtime(workspace, "user"), tts=FakeTts()))
    r = c2.post("/tts", json={"text": "Hallo"})
    assert r.status_code == 200 and r.headers["content-type"].startswith("audio/wav") and r.content.endswith(b"Hallo")
    assert c2.post("/tts", json={"text": "  "}).status_code == 400
