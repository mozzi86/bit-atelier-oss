"""`harness doctor` — provider, sandbox and environment diagnosis in plain text.

Per profile: key present? (never the key itself, T-67-06), models endpoint
reachable (5 s), response time, optional tool-calling probe (--probe, costs
tokens). Plus: sandbox self-test (`..` must be refused), tool paths (rg, ffmpeg,
ollama, lms, FreeCADCmd), Python version, write access to projects/ and logs/.
Every failure names the next step. Exit 1 when at least one row failed.
"""

from __future__ import annotations

import json
import os
import shutil
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

import httpx

from harness.agent.messages import Message, ToolSchema
from harness.config import HARNESS_DIR, HarnessConfig, env_key
from harness.jsonlog import redact
from harness.providers.base import ProviderProfile
from harness.providers.openai_compat import fetch_models
from harness.providers.registry import ProviderRegistry

FREECAD_CANDIDATES = [
    r"C:\Program Files\FreeCAD 1.1\bin\freecadcmd.exe",
    r"C:\Program Files\FreeCAD 1.0\bin\FreeCADCmd.exe",
    "/Applications/FreeCAD.app/Contents/MacOS/FreeCADCmd",
]


@dataclass
class Row:
    bereich: str
    name: str
    status: str          # ok | warn | fail | skip
    befund: str
    naechster_schritt: str = ""


@dataclass
class Report:
    rows: list[Row] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not any(r.status == "fail" for r in self.rows)

    def add(self, *a, **k) -> None:
        self.rows.append(Row(*a, **k))


async def check_profile(profile: ProviderProfile, registry: ProviderRegistry, report: Report, *,
                        probe: bool, transport: httpx.AsyncBaseTransport | None, timeout: float = 5.0) -> None:
    if profile.api_mode == "mock":
        report.add("provider", profile.name, "ok", "Offline-Mock, immer verfügbar")
        return
    key_state = registry.key_status(profile.name)
    if key_state == "fehlt":
        report.add("provider", profile.name, "fail", f"Key fehlt ({profile.env_var})",
                   f"{profile.env_var} in harness/.env setzen — nie in providers.yaml")
        return
    key = env_key(profile.env_var)
    if profile.api_mode == "anthropic":
        url = f"{(profile.base_url or 'https://api.anthropic.com').rstrip('/')}/v1/models"
        headers = {"x-api-key": key or "", "anthropic-version": str(profile.quirks.get("anthropic_version") or "2023-06-01")}
    else:
        url = str(profile.quirks.get("models_url") or f"{(profile.base_url or '').rstrip('/')}/models")
        headers = {"authorization": f"Bearer {key}"} if key else {}

    t0 = time.perf_counter()
    try:
        async with httpx.AsyncClient(transport=transport, timeout=timeout) as client:
            resp = await client.get(url, headers=headers)
        ms = int((time.perf_counter() - t0) * 1000)
    except (httpx.TimeoutException, httpx.ConnectError, httpx.NetworkError) as exc:
        hint = ("Server starten: `lms server start --port 1234` (LM Studio)" if profile.name == "lmstudio"
                else "Ollama starten: `ollama serve`" if profile.name == "ollama"
                else "Netz/Proxy prüfen, base_url in providers.yaml vergleichen")
        report.add("provider", profile.name, "fail", f"nicht erreichbar ({exc.__class__.__name__}) — {url}", hint)
        return

    if resp.status_code == 401 or resp.status_code == 403:
        step = ("Endpunkt prüfen: Token Plan ≠ Coding Plan — Token-Plan-Key nur gegen "
                "token-plan.ap-southeast-1.maas.aliyuncs.com, Coding-Plan-Key nur gegen coding-intl.dashscope.aliyuncs.com; "
                "beide Profile stehen in providers.yaml" if profile.name.startswith("alibaba")
                else f"{profile.env_var} in harness/.env erneuern")
        report.add("provider", profile.name, "fail", f"Key ungültig ({resp.status_code}) — Endpunkt prüfen (Token Plan ≠ Coding Plan)"
                   if profile.name.startswith("alibaba") else f"Key ungültig ({resp.status_code})", step)
        return
    if resp.status_code >= 400:
        report.add("provider", profile.name, "warn", f"HTTP {resp.status_code} auf {url} — {redact(resp.text[:160])}",
                   "Modell-Liste nicht lesbar; Chat kann trotzdem gehen")
        return

    models: list[str] = []
    try:
        if profile.api_mode == "anthropic":
            data = resp.json()
            models = [str(m.get("id")) for m in data.get("data", []) if isinstance(m, dict)]
        else:
            models = await fetch_models(profile, key, transport=transport, timeout=timeout)
    except Exception as exc:  # list is a convenience, not a gate
        report.add("provider", profile.name, "warn", f"erreichbar ({ms} ms), Modell-Liste nicht lesbar: {exc.__class__.__name__}")
    else:
        shown = ", ".join(models[:6]) + (" …" if len(models) > 6 else "")
        report.add("provider", profile.name, "ok", f"erreichbar ({ms} ms), {len(models)} Modelle: {shown}" if models
                   else f"erreichbar ({ms} ms), keine Modelle gemeldet")
        if models and not profile.models:
            # remember discovered models so /model can validate against them
            from dataclasses import replace
            registry.replace(replace(profile, models=tuple(models),
                                     default_model=profile.default_model or models[0]))

    if probe:
        await probe_tool_calling(profile, registry, report, transport=transport)


async def probe_tool_calling(profile: ProviderProfile, registry: ProviderRegistry, report: Report, *,
                             transport: httpx.AsyncBaseTransport | None) -> None:
    """Ask the model to call `echo` once; costs a few hundred tokens."""
    try:
        provider = registry.make_provider(profile.name)
        if transport is not None:
            provider._transport = transport  # type: ignore[attr-defined]
    except (ValueError, NotImplementedError) as exc:
        report.add("probe", profile.name, "fail", str(exc))
        return
    prof = registry.get(profile.name)
    model = prof.default_model or (prof.models[0] if prof.models else "")
    tools = [ToolSchema("echo", "Gibt den Text unverändert zurück", {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]})]
    msgs = [Message("system", "Du testest Werkzeugaufrufe. Rufe genau einmal das Werkzeug echo mit text='ping' auf. Keine Erklärung."),
            Message("user", "Bitte echo ping.")]
    saw_call, err = False, None
    t0 = time.perf_counter()
    async for ev in provider.chat(msgs, tools, model=model, max_tokens=200):
        if ev.get("type") == "tool_call" and ev.get("name") == "echo":
            saw_call = True
        elif ev.get("type") == "error":
            err = ev.get("message")
    ms = int((time.perf_counter() - t0) * 1000)
    if err:
        report.add("probe", profile.name, "fail", redact(f"Fehler: {err[:200]}"), "Modell/Endpunkt prüfen")
    elif saw_call:
        report.add("probe", profile.name, "ok", f"Tool-Calling funktioniert ({model}, {ms} ms)")
    else:
        report.add("probe", profile.name, "warn", f"{model} hat kein Werkzeug aufgerufen ({ms} ms)",
                   "Modell unterstützt Tool-Calling vermutlich nicht — anderes Modell wählen oder quirks.no_tools setzen")


def check_sandbox(cfg: HarnessConfig, report: Report) -> None:
    from harness.tools.registry import ToolContext
    from harness.tools.sandbox import resolve_in_sandbox
    root = cfg.projects_dir / (cfg.project or "efh-satteldach")
    ctx = ToolContext(mode="user", projekt=cfg.project, sandbox_roots=[root], project_dir=root)
    try:
        resolve_in_sandbox("../../package.json", ctx)
    except ValueError as exc:
        report.add("sandbox", "user-Modus", "ok", f"`..`-Zugriff abgewiesen: {str(exc)[:60]}…")
    else:
        report.add("sandbox", "user-Modus", "fail", "`..`-Zugriff wurde NICHT abgewiesen", "tools/sandbox.py prüfen")
    roots = [root] + ([cfg.repo_root] if cfg.mode == "developer" else [])
    report.add("sandbox", "Wurzeln", "ok", f"Modus {cfg.mode}: " + "; ".join(str(r) for r in roots))


def check_environment(cfg: HarnessConfig, report: Report) -> None:
    v = sys.version_info
    status = "ok" if (3, 11) <= (v.major, v.minor) < (3, 14) else "fail"
    report.add("umgebung", "Python", status, f"{v.major}.{v.minor}.{v.micro}", "" if status == "ok" else "Python 3.11–3.13 verwenden")

    for name, hint in (("rg", "ripgrep installieren (winget install BurntSushi.ripgrep.MSVC) — sonst Python-Suche"),
                       ("ffmpeg", "für 67-05 Sprache; winget install Gyan.FFmpeg"),
                       ("ollama", "optional: Ollama aus %LOCALAPPDATA%\\Programs\\Ollama"),
                       ("lms", "optional: LM Studio CLI unter ~/.lmstudio/bin")):
        path = shutil.which(name) or (str(Path.home() / ".lmstudio" / "bin" / "lms.exe") if name == "lms" and (Path.home() / ".lmstudio" / "bin" / "lms.exe").exists() else None)
        report.add("werkzeug", name, "ok" if path else "warn", path or "nicht im PATH", "" if path else hint)

    fc = next((p for p in FREECAD_CANDIDATES if Path(p).exists()), None) or shutil.which("freecadcmd")
    report.add("werkzeug", "FreeCADCmd", "ok" if fc else "warn", fc or "nicht gefunden", "" if fc else "für 67-04: freecad.cmd in config.yaml setzen")

    for label, d in (("projects/", cfg.projects_dir), ("logs/", cfg.logs_dir)):
        try:
            d.mkdir(parents=True, exist_ok=True)
            probe = d / ".doctor-write-test"
            probe.write_text("ok", encoding="utf-8")
            probe.unlink()
            report.add("schreibrecht", label, "ok", str(d))
        except OSError as exc:
            report.add("schreibrecht", label, "fail", f"{d}: {exc}", "Rechte/Pfad prüfen (Google-Drive-Sync?)")

    env_file = HARNESS_DIR / ".env"
    report.add("konfiguration", ".env", "ok" if env_file.exists() else "warn",
               "vorhanden" if env_file.exists() else "fehlt", "" if env_file.exists() else "Copy-Item .env.example .env, Keys eintragen")
    report.add("konfiguration", "providers", "ok", f"{cfg.providers_file.name}")


async def run_doctor(cfg: HarnessConfig, *, provider: str | None = None, probe: bool = False,
                     transport: httpx.AsyncBaseTransport | None = None,
                     registry: ProviderRegistry | None = None) -> Report:
    report = Report()
    registry = registry or ProviderRegistry.load(cfg.providers_file)
    names = [provider] if provider else registry.names()
    for name in names:
        try:
            prof = registry.get(name)
        except KeyError as exc:
            report.add("provider", name, "fail", str(exc), "Profilname aus providers.yaml verwenden")
            continue
        await check_profile(prof, registry, report, probe=probe, transport=transport)
    if not provider:
        check_sandbox(cfg, report)
        check_environment(cfg, report)
    return report


SYMBOL = {"ok": "✓", "warn": "!", "fail": "✗", "skip": "–"}


def render(report: Report) -> str:
    w1 = max(len(r.bereich) for r in report.rows) if report.rows else 8
    w2 = max(len(r.name) for r in report.rows) if report.rows else 8
    lines = []
    for r in report.rows:
        line = f"{SYMBOL[r.status]} {r.bereich:<{w1}}  {r.name:<{w2}}  {redact(r.befund)}"
        if r.naechster_schritt:
            line += f"\n  {'':<{w1}}  {'':<{w2}}  → {r.naechster_schritt}"
        lines.append(line)
    fails = sum(1 for r in report.rows if r.status == "fail")
    warns = sum(1 for r in report.rows if r.status == "warn")
    lines.append("")
    lines.append(f"{'Alles in Ordnung' if fails == 0 else f'{fails} Fehler'} · {warns} Hinweise · Exit {0 if fails == 0 else 1}")
    return "\n".join(lines)


def to_json(report: Report) -> str:
    return json.dumps([r.__dict__ for r in report.rows], ensure_ascii=False, indent=2)
