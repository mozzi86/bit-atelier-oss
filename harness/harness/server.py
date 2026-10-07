"""FastAPI service: HTTP status/projects/skills/model + WebSocket chat streaming.

Bind 127.0.0.1:8765 only. CORS restricted to the app's own local origins: the
Vite dev server (:5173), the local app/API (:3001 — `npm start` serves the app
there since plan 83-03) and the Vite preview / client build (:4173), plus any
origin listed in HARNESS_ALLOWED_ORIGINS (comma-separated, additive). /ws/chat
forwards loop Events 1:1 as JSON; an `approval` event is answered by the client
with {type:"approval_reply", id, ja:true|false} on the same connection (T-67-05:
origin check on the WebSocket as well).
"""

from __future__ import annotations

import asyncio
import json
import os
from collections.abc import Mapping
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

from harness.voice.devices import EXTRA_HINT, voice_extra_available
from harness.voice.stt import SttNotReady, SttUnavailable, TranscriptionProvider

from harness import __version__
from harness.agent.loop import run_turn
from harness.agent.messages import ev_approval, ev_error
from harness.config import HARNESS_DIR, HarnessConfig, load_config
from harness.jsonlog import SessionLog
from harness.runtime import Runtime
from harness.skills.commands import BUILTIN, expand_skill, parse_slash
from harness.tools.builtin import registry

ALLOWED_ORIGINS = [
    "http://localhost:5173", "http://127.0.0.1:5173",   # vite dev
    "http://localhost:3001", "http://127.0.0.1:3001",   # local app + API (npm start, start scripts)
    "http://localhost:4173", "http://127.0.0.1:4173",   # vite preview / client build
]
UI_FILE = HARNESS_DIR / "ui" / "index.html"


def allowed_origins(env: Mapping[str, str] | None = None) -> list[str]:
    """Default origins plus HARNESS_ALLOWED_ORIGINS (comma-separated, additive).

    Additive like the API's API_ORIGINS: adding a port (e.g. API_PORT=3002) must
    not silently drop the defaults. Trailing slashes are stripped — a browser
    sends the Origin header without one. Order kept, duplicates removed.
    """
    env = os.environ if env is None else env
    extra = [o.strip().rstrip("/") for o in str(env.get("HARNESS_ALLOWED_ORIGINS", "")).split(",") if o.strip()]
    out: list[str] = []
    for origin in ALLOWED_ORIGINS + extra:
        if origin not in out:
            out.append(origin)
    return out


class ModelBody(BaseModel):
    provider: str | None = None
    model: str | None = None


class TtsBody(BaseModel):
    text: str


def make_stt(rt: Runtime) -> TranscriptionProvider | None:
    """faster-whisper provider when enabled and the extra is installed; else None (→ 501)."""
    if not rt.config.stt_enabled or not voice_extra_available():
        return None
    from harness.voice.stt import FasterWhisperProvider
    return FasterWhisperProvider(rt.config.stt_model, rt.config.stt_language, preload=True)


def create_app(rt: Runtime, *, stt: TranscriptionProvider | None = None, tts=None) -> FastAPI:
    app = FastAPI(title="Atelier AI Harness", version=__version__)
    app.state.stt = stt
    app.state.tts = tts
    # The service's own origin is allowed so the standalone UI served at / can open the WebSocket.
    own = [f"http://{rt.config.host}:{rt.config.port}", f"http://localhost:{rt.config.port}"]
    erlaubt = allowed_origins()
    origins = erlaubt + [o for o in own if o not in erlaubt]
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST"], allow_headers=["*"])
    app.state.rt = rt
    app.state.origins = origins
    app.state.sessions = {}  # session id → Session (per WebSocket)

    @app.get("/", include_in_schema=False)
    def ui() -> FileResponse:
        return FileResponse(UI_FILE, media_type="text/html")

    def stt_status() -> dict[str, Any]:
        if app.state.stt is None:
            return {"verfuegbar": False, "bereit": False,
                    "hinweis": "stt.enabled: false" if not rt.config.stt_enabled else EXTRA_HINT}
        return {"verfuegbar": True, **app.state.stt.status()}

    @app.get("/status")
    def status(session: str | None = None) -> dict[str, Any]:
        s = app.state.sessions.get(session) if session else None
        if s is None:
            s = rt.build_session()
        return {**rt.status(s), "stt": stt_status(), "tts": {"aktiv": app.state.tts is not None}}

    @app.post("/stt")
    async def stt(audio: UploadFile = File(...), language: str | None = None) -> dict[str, Any]:
        """Transcribe one recording. Audio is read into memory and dropped after the call (T-67-15)."""
        if app.state.stt is None:
            raise HTTPException(501, stt_status()["hinweis"])
        data = await audio.read()
        if not data:
            raise HTTPException(400, "Leere Aufnahme")
        if len(data) > 25 * 1024 * 1024:
            raise HTTPException(413, "Aufnahme größer als 25 MB")
        mime = audio.content_type or "application/octet-stream"
        try:
            result = await asyncio.get_running_loop().run_in_executor(
                None, lambda: app.state.stt.transcribe(data, mime, language))
        except SttNotReady as exc:
            raise HTTPException(503, str(exc))
        except SttUnavailable as exc:
            raise HTTPException(501, str(exc))
        except ValueError as exc:
            raise HTTPException(400, str(exc))
        return result.to_dict()

    @app.post("/tts")
    def tts(body: TtsBody) -> Response:
        if app.state.tts is None:
            raise HTTPException(501, "TTS ist aus (tts.enabled: false) oder piper-tts fehlt")
        text = body.text.strip()
        if not text:
            raise HTTPException(400, "Kein Text")
        try:
            wav = app.state.tts.synthesize(text[:2000])
        except Exception as exc:
            raise HTTPException(500, f"TTS fehlgeschlagen: {exc}")
        return Response(content=wav, media_type="audio/wav")

    @app.get("/projects")
    def projects() -> dict[str, Any]:
        return {"aktiv": rt.project.slug if rt.project else None, "projekte": rt.projects()}

    @app.post("/project/{slug}")
    def set_project(slug: str) -> dict[str, Any]:
        try:
            rt.project = rt.open_project(slug)
        except (FileNotFoundError, ValueError) as exc:
            raise HTTPException(404, str(exc))
        return {"aktiv": slug, "hinweis": "gilt für neue WebSocket-Sessions"}

    @app.get("/skills")
    def skills() -> dict[str, Any]:
        return {"skills": [{"name": s.name, "description": s.description, "mode": s.mode}
                           for s in rt.skills if s.visible(rt.config.mode)],
                "warnungen": rt.skill_warnings}

    @app.get("/model")
    def get_model() -> dict[str, Any]:
        prof = rt.profile
        return {"provider": rt.provider_name, "model": rt.model, "profile": rt.providers.names(),
                "models": list(prof.models), "context_window": prof.context_window}

    @app.post("/model")
    def set_model(body: ModelBody) -> dict[str, Any]:
        try:
            rt.set_model(body.provider, body.model)
        except (KeyError, ValueError) as exc:
            raise HTTPException(400, str(exc))
        return {"provider": rt.provider_name, "model": rt.model}

    @app.api_route("/files", methods=["GET", "HEAD"])
    def files(path: str) -> FileResponse:
        """Serve one model file of the ACTIVE project to the app's IFC viewer (67-06).
        T-67-19: sandbox-resolved, restricted to <projekt>/model/*.ifc — nothing else,
        whatever the path says."""
        if rt.project is None:
            raise HTTPException(404, "Kein aktives Projekt")
        from harness.tools.registry import ToolContext
        from harness.tools.sandbox import resolve_in_sandbox
        model_dir = (rt.project.dir / "model").resolve()
        ctx = ToolContext(mode="user", projekt=rt.project.slug, sandbox_roots=[model_dir], project_dir=rt.project.dir)
        try:
            p = resolve_in_sandbox(path, ctx, must_exist=True)
        except ValueError as exc:
            raise HTTPException(403, str(exc))
        if not p.is_file() or p.suffix.lower() != ".ifc":
            raise HTTPException(403, "Nur model/*.ifc des aktiven Projekts werden ausgeliefert")
        return FileResponse(p, media_type="application/x-step", filename=p.name)

    @app.websocket("/ws/chat")
    async def ws_chat(ws: WebSocket) -> None:
        origin = ws.headers.get("origin")
        if origin and origin not in app.state.origins:
            await ws.close(code=4403)
            return
        await ws.accept()
        try:
            provider = rt.make_provider()
        except (ValueError, NotImplementedError) as exc:
            await ws.send_json(ev_error(str(exc)))
            await ws.close()
            return

        session = rt.build_session()
        app.state.sessions[session.id] = session
        log = SessionLog(rt.config.logs_dir, session.project, session.id)
        log.write("session_start", mode=rt.config.mode, provider=rt.provider_name, model=rt.model, projekt=session.project)
        pending: dict[str, asyncio.Future] = {}
        inbox: asyncio.Queue[dict[str, Any]] = asyncio.Queue()

        async def approve(approval_id: str, befehl: str, erklaerung: str) -> bool:
            fut: asyncio.Future = asyncio.get_running_loop().create_future()
            pending[approval_id] = fut
            ev = ev_approval(approval_id, befehl, erklaerung)
            log.event(ev)
            await ws.send_json(ev)
            try:
                return bool(await asyncio.wait_for(fut, timeout=600))
            except asyncio.TimeoutError:
                return False
            finally:
                pending.pop(approval_id, None)

        ctx = rt.tool_context(approve)

        async def reader() -> None:
            # Single reader: approval replies resolve futures, everything else is queued.
            try:
                while True:
                    raw = await ws.receive_text()
                    try:
                        msg = json.loads(raw)
                    except json.JSONDecodeError:
                        await ws.send_json(ev_error("Nachricht ist kein JSON"))
                        continue
                    if msg.get("type") == "approval_reply":
                        fut = pending.get(str(msg.get("id")))
                        if fut and not fut.done():
                            fut.set_result(bool(msg.get("ja")))
                        continue
                    await inbox.put(msg)
            except WebSocketDisconnect:
                await inbox.put({"type": "_closed"})

        reader_task = asyncio.create_task(reader())
        await ws.send_json({"type": "hello", "session": session.id, **rt.status(session)})

        try:
            while True:
                msg = await inbox.get()
                if msg.get("type") == "_closed":
                    break
                if msg.get("type") == "status":
                    await ws.send_json({"type": "status", **rt.status(session)})
                    continue
                if msg.get("type") == "model":
                    try:
                        rt.set_model(msg.get("provider"), msg.get("model"))
                        provider = rt.sync_session(session, None)
                        await ws.send_json({"type": "status", **rt.status(session)})
                    except (KeyError, ValueError, NotImplementedError) as exc:
                        await ws.send_json(ev_error(str(exc)))
                    continue
                if msg.get("type") != "user":
                    await ws.send_json(ev_error(f"Unbekannter Nachrichtentyp: {msg.get('type')!r}"))
                    continue
                text = str(msg.get("text") or "").strip()
                if not text:
                    continue
                slash = parse_slash(text)
                if slash and slash[0] in BUILTIN:
                    if slash[0] == "status":
                        await ws.send_json({"type": "status", **rt.status(session)})
                    elif slash[0] == "now":
                        rt.reload_skills()
                        session.set_system_prompt(rt.system_prompt())
                        await ws.send_json({"type": "notice", "message": "System-Prompt neu gebaut."})
                    else:
                        await ws.send_json(ev_error(f"/{slash[0]} gibt es in der UI als Schaltfläche, nicht als Chat-Befehl"))
                    continue
                if slash:
                    try:
                        text = expand_skill(rt.skills, rt.config.mode, *slash)
                    except (KeyError, PermissionError) as exc:
                        await ws.send_json(ev_error(str(exc)))
                        continue
                log.write("user", text=text)
                try:
                    provider = rt.sync_session(session, provider)  # picks up POST /model or {type:"model"}
                except (KeyError, ValueError, NotImplementedError) as exc:
                    await ws.send_json(ev_error(str(exc)))
                    continue
                async for ev in run_turn(session, provider, registry, ctx, text, **rt.turn_kwargs()):
                    log.event(ev)
                    await ws.send_json(ev)
        except WebSocketDisconnect:
            pass
        finally:
            reader_task.cancel()
            app.state.sessions.pop(session.id, None)
            log.write("session_end", **rt.status(session))

    return app


def serve(cfg: HarnessConfig | None = None) -> int:
    import uvicorn
    cfg = cfg or load_config()
    rt = Runtime.from_config(cfg)
    stt = make_stt(rt)
    tts = None
    if cfg.tts_enabled:
        try:
            from harness.voice.tts import PiperTts
            tts = PiperTts(cfg.tts_voice)
        except RuntimeError as exc:
            print(f"[TTS] aus — {exc}")
    app = create_app(rt, stt=stt, tts=tts)
    print(f"{cfg.display_name} · http://{cfg.host}:{cfg.port} · Provider {rt.provider_name} · Modell {rt.model} · Projekt {rt.project.slug if rt.project else '—'}")
    if stt is None:
        print(f"[STT] aus — {'stt.enabled: false' if not cfg.stt_enabled else EXTRA_HINT}")
    else:
        print(f"[STT] faster-whisper {cfg.stt_model} lädt im Hintergrund; Gerätewahl steht in /status")
    if cfg.host not in ("127.0.0.1", "localhost"):
        print("[Warnung] Der Dienst hat keine Authentifizierung — nur 127.0.0.1 ist vorgesehen.")
    uvicorn.run(app, host=cfg.host, port=cfg.port, log_level="info")
    return 0
