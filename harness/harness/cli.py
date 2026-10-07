"""CLI (argparse, no typer): `harness chat|serve|skills|projects` — a thin shell
around Runtime + run_turn. Approval = keyboard prompt.

    python -m harness chat --provider mock --project efh-satteldach
    python -m harness serve --port 8765
"""

from __future__ import annotations

import argparse
import asyncio
import sys

from harness import __version__
from harness.agent.loop import run_turn
from harness.agent.session import format_status
from harness.config import load_config
from harness.jsonlog import SessionLog
from harness.runtime import Runtime
from harness.skills.commands import BUILTIN, expand_skill, parse_slash
from harness.tools.builtin import registry

HELP = """Befehle: /status  /project [slug]  /model [provider] [modell]  /skills  /now  /quit
Alles andere geht an das Modell. Skills: /name [Argumente]."""


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="harness", description="Atelier AI Harness — KI-Arbeitssystem der BIT Atelier App")
    p.add_argument("--version", action="version", version=f"harness {__version__}")
    sub = p.add_subparsers(dest="cmd", required=True)

    chat = sub.add_parser("chat", help="interaktiver Chat im Terminal")
    chat.add_argument("--provider"), chat.add_argument("--model"), chat.add_argument("--project")
    chat.add_argument("--mode", choices=["developer", "user"])
    chat.add_argument("--once", metavar="TEXT", help="eine Frage stellen und beenden (für Skripte)")
    chat.add_argument("--voice", action="store_true", help="Push-to-Talk: leere Eingabe + Enter startet die Aufnahme, Enter beendet sie; Text als Vorschau")

    serve = sub.add_parser("serve", help="lokalen Dienst starten (HTTP + WebSocket)")
    serve.add_argument("--host"), serve.add_argument("--port", type=int)
    serve.add_argument("--provider"), serve.add_argument("--model"), serve.add_argument("--project")
    serve.add_argument("--mode", choices=["developer", "user"])

    sub.add_parser("skills", help="verfügbare Skills auflisten")
    sub.add_parser("projects", help="Projekte auflisten")
    doctor = sub.add_parser("doctor", help="Provider, Sandbox und Werkzeuge prüfen")
    doctor.add_argument("--provider", help="nur dieses Profil prüfen")
    doctor.add_argument("--probe", action="store_true", help="Tool-Calling-Probe je erreichbarem Profil (kostet Tokens)")
    return p


async def _ask_approval(approval_id: str, befehl: str, erklaerung: str) -> bool:
    print(f"\n⚠  Bestätigung nötig [{approval_id}]: `{befehl}` — {erklaerung}")
    answer = await asyncio.get_running_loop().run_in_executor(None, lambda: input("Ausführen? (ja/nein) ").strip().lower())
    return answer in ("ja", "j", "yes", "y")


async def _chat(rt: Runtime, *, once: str | None, voice: bool = False) -> int:
    provider = rt.make_provider()
    session = rt.build_session()
    stt = None
    if voice:
        # Push-to-Talk in the terminal: a plain Enter on an empty line starts the
        # recording, the next Enter stops it; the transcript is shown as a PREVIEW
        # and sent only after the user confirms it with Enter (T-67-16).
        try:
            from harness.voice.record import record_until_enter
            from harness.voice.stt import FasterWhisperProvider
            stt = FasterWhisperProvider(rt.config.stt_model, rt.config.stt_language, preload=True)
            print(f"[Diktat] faster-whisper {rt.config.stt_model} lädt im Hintergrund. Leere Eingabe + Enter = Aufnahme starten.")
        except Exception as exc:
            print(f"[Diktat aus] {exc}")
            voice = False
    log = SessionLog(rt.config.logs_dir, session.project, session.id)
    ctx = rt.tool_context(_ask_approval)
    log.write("session_start", mode=rt.config.mode, provider=rt.provider_name, model=rt.model, projekt=session.project)

    print(f"{rt.config.display_name} · Provider {rt.provider_name} · Modell {rt.model} · Projekt {session.project or '—'}")
    for w in rt.skill_warnings:
        print(f"[Skill-Warnung] {w}")
    if rt.config.project and not rt.project:
        print(f"[Hinweis] Projekt {rt.config.project!r} nicht gefunden unter {rt.config.projects_dir}")
    if not once:
        print(HELP)

    async def turn(text: str) -> None:
        log.write("user", text=text)
        async for ev in run_turn(session, provider, registry, ctx, text, **rt.turn_kwargs()):
            log.event(ev)
            t = ev["type"]
            if t == "compression":
                print(f"[Kompression] {ev['vorher']} → {ev['nachher']} Nachrichten, ≈{ev['tokens_vorher']} → {ev['tokens_nachher']} Tokens", flush=True)
            elif t == "text_delta":
                print(ev["text"], end="", flush=True)
            elif t == "tool_call":
                print(f"\n[Werkzeug] {ev['name']} {ev.get('arguments')}", flush=True)
            elif t == "tool_result":
                print(f"[Ergebnis] {ev['result'][:300]}", flush=True)
            elif t == "error":
                print(f"\n[Fehler] {ev['message']}", file=sys.stderr, flush=True)
            elif t == "notice":
                print(f"\n[Hinweis] {ev['message']}", flush=True)
        print()

    if once:
        # Review §4.8 (67-03): --once used to bypass the slash expansion of the
        # interactive loop, so `--once "/ifc liste"` sent the raw slash text to
        # the model. Expand skill slashes here too — builtins stay raw (they
        # are CLI commands, not model input).
        slash = parse_slash(once)
        if slash and slash[0] not in BUILTIN:
            try:
                once = expand_skill(rt.skills, rt.config.mode, *slash)
            except (KeyError, PermissionError) as exc:
                print(f"[Fehler] {exc}", file=sys.stderr)
                return 2
        await turn(once)
        print(format_status(rt.status(session)))
        return 0

    while True:
        try:
            text = await asyncio.get_running_loop().run_in_executor(None, lambda: input("\n> ").strip())
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if not text and voice and stt is not None:
            from harness.voice.stt import SttNotReady, SttUnavailable
            try:
                wav = await asyncio.get_running_loop().run_in_executor(None, record_until_enter)
                print("[Diktat] transkribiere …", flush=True)
                res = await asyncio.get_running_loop().run_in_executor(None, lambda: stt.transcribe(wav, "audio/wav"))
                print(f"[Diktat {res.dauer_s:.1f}s auf {res.geraet}/{res.modell}] Vorschau:\n  {res.text}")
                bestaetigt = await asyncio.get_running_loop().run_in_executor(
                    None, lambda: input("Senden? (Enter = ja, Text = ersetzen, n = verwerfen) ").strip())
                if bestaetigt.lower() == "n":
                    continue
                text = res.text if bestaetigt == "" else bestaetigt
            except (SttNotReady, SttUnavailable, RuntimeError, ValueError) as exc:
                print(f"[Diktat] {exc}")
                continue
        if not text:
            continue
        slash = parse_slash(text)
        if slash and slash[0] in BUILTIN:
            cmd, arg = slash
            if cmd == "quit":
                break
            if cmd == "help":
                print(HELP)
            elif cmd == "status":
                print(format_status(rt.status(session)))
            elif cmd == "skills":
                for s in rt.skills:
                    if s.visible(rt.config.mode):
                        print(f"/{s.name} — {s.description}")
            elif cmd == "project":
                if not arg:
                    print("Projekte: " + ", ".join(rt.projects()))
                else:
                    try:
                        rt.project = rt.open_project(arg)
                        session = rt.build_session()
                        ctx = rt.tool_context(_ask_approval)
                        log = SessionLog(rt.config.logs_dir, session.project, session.id)
                        print(f"Projekt {arg} geladen — neue Session {session.id}")
                    except (FileNotFoundError, ValueError) as exc:
                        print(f"[Fehler] {exc}")
            elif cmd == "model":
                parts = arg.split()
                if not parts:
                    print(f"Provider {rt.provider_name} · Modell {rt.model} · Profile: {', '.join(rt.providers.names())}")
                else:
                    try:
                        rt.set_model(parts[0], parts[1] if len(parts) > 1 else None)
                        provider = rt.sync_session(session, None)
                        print(f"Modell: {rt.provider_name} / {rt.model} — Verlauf und Kosten der Session bleiben")
                    except (KeyError, ValueError, NotImplementedError) as exc:
                        print(f"[Fehler] {exc}")
            elif cmd == "now":
                rt.reload_skills()
                session.set_system_prompt(rt.system_prompt())
                print("System-Prompt neu gebaut (Skills/Memory jetzt wirksam).")
            continue
        if slash:
            try:
                text = expand_skill(rt.skills, rt.config.mode, *slash)
            except (KeyError, PermissionError) as exc:
                print(f"[Fehler] {exc}")
                continue
        await turn(text)

    log.write("session_end", **rt.status(session))
    return 0


def main(argv: list[str] | None = None) -> int:
    # Windows consoles default to cp1252 — German umlauts and ✓/✗ would crash print().
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(encoding="utf-8", errors="replace")
            except (ValueError, OSError):
                pass
    args = _parser().parse_args(argv)
    try:
        cfg = load_config()
    except ValueError as exc:
        print(f"[Konfiguration] {exc}", file=sys.stderr)
        return 2

    if args.cmd == "doctor":
        from harness.doctor import run_doctor, render
        report = asyncio.run(run_doctor(cfg, provider=args.provider, probe=args.probe))
        print(render(report))
        return 0 if report.ok else 1

    overrides = {k: getattr(args, k, None) for k in ("provider", "model", "project", "mode", "host", "port")}
    cfg = cfg.with_overrides(**overrides)

    if args.cmd == "skills":
        rt = Runtime.from_config(cfg)
        for s in rt.skills:
            if s.visible(cfg.mode):
                print(f"/{s.name} — {s.description}  [{s.mode}]")
        for w in rt.skill_warnings:
            print(f"[Warnung] {w}")
        return 0
    if args.cmd == "projects":
        rt = Runtime.from_config(cfg)
        print("\n".join(rt.projects()) or "(keine Projekte — examples/ enthält efh-satteldach)")
        return 0
    if args.cmd == "serve":
        from harness.server import serve
        return serve(cfg)
    if args.cmd == "chat":
        try:
            rt = Runtime.from_config(cfg)
        except (KeyError, ValueError) as exc:
            print(f"[Fehler] {exc}", file=sys.stderr)
            return 2
        try:
            return asyncio.run(_chat(rt, once=args.once, voice=bool(getattr(args, "voice", False))))
        except (ValueError, NotImplementedError) as exc:
            print(f"[Fehler] {exc}", file=sys.stderr)
            return 2
    return 1
