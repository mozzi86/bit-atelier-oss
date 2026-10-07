"""ifc_run — the /ifc skill as a tool (Task 3, Plan 67-03).

Registers `ifc_run(unterbefehl, datei?, optionen?)` in the toolset `both`
(user AND developer). The handler calls the standalone skill scripts
IN-PROCESS (same run() functions the CLIs use) inside a thread (T-67-10:
a 100 MB IFC must not block the service) and returns
{"markdown", "json", "hinweis", "ziel"?}.

Standarddatei: the newest model/*.ifc of the ACTIVE project (plan truth #1).

Viewer-Link (key_link to packages/nova-ifc-viewer/src/lib/viewerLink.js):
the link format is READ from that module's convention — `${basis}#/${route}?`
plus query parameters — and emitted as TEXT only. The harness never uploads
an IFC into the app (phase 68 settles that) and never invents cam/ziel
values: it cannot compute them correctly (scene is Y-up, COORDINATE_TO_
ORIGIN) and they would override the viewer's automatic fit (review §4.9).
What the app can actually consume is {"datei": "model/<name>.ifc", "guid": …}
— GET /files serves exactly model/*.ifc of the active project.

T-67-09: every result carries the data-not-instruction note; property
strings are data, never commands.
"""

from __future__ import annotations

import asyncio
import importlib.util
import json
import sys
from pathlib import Path
from typing import Any

from harness.agent.context import DATA_NOT_INSTRUCTION
from harness.config import HARNESS_DIR
from harness.tools.registry import ToolContext, registry, tool_error, tool_ok
from harness.tools.sandbox import resolve_in_sandbox

SCRIPTS_DIR = HARNESS_DIR / "skills" / "ifc" / "scripts"

# Subcommands -> script module + option mapping. Keep in sync with SKILL.md.
UNTERBEFEHLE = ("liste", "mengen", "props", "klassen", "diff", "check", "setze")

# Base URL of the app's dev server (vite default). The plan fixes this value;
# config.py has no app_url field (review §5) — when the app builds the link
# itself it uses `ziel`, this text is for the human in the terminal.
APP_BASIS = "http://localhost:5173"
# Harness service base for the ?url= parameter of IfcViewer (67-06 path).
HARNESS_BASIS = "http://127.0.0.1:8765"

# T-67-10: geometry fallback on big models is slow — warn above this size.
GROESSEN_WARNUNG_BYTES = 50 * 1024 * 1024

_modules: dict[str, Any] = {}


def _script(name: str):
    """Loads a skill script as a module (once, cached) — scripts are CLIs in
    a directory without __init__.py, same pattern as common.load_module."""
    if name in _modules:
        return _modules[name]
    scripts = str(SCRIPTS_DIR)
    if scripts not in sys.path:
        sys.path.insert(0, scripts)
    spec = importlib.util.spec_from_file_location(name, SCRIPTS_DIR / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    _modules[name] = module
    return module


def _neueste_modelldatei(ctx: ToolContext) -> Path | None:
    """The newest model/*.ifc of the active project (plan: Standarddatei)."""
    if not ctx.project_dir:
        return None
    candidates = sorted((ctx.project_dir / "model").glob("*.ifc"),
                        key=lambda p: p.stat().st_mtime, reverse=True)
    return candidates[0] if candidates else None


def _viewer_link(datei_rel: str, guid: str | None) -> str:
    """Link text in the format of viewerLink.js: `${basis}#/${route}?…`.

    url = the harness /files endpoint (IfcViewer loads it since 67-06),
    sel = GlobalId (viewerLink.js: sel). NO cam/ziel — see module docstring.
    """
    from urllib.parse import quote

    datei_url = f"{HARNESS_BASIS}/files?path={quote(datei_rel)}"
    query = f"url={quote(datei_url, safe='')}"
    if guid:
        query += f"&sel={quote(guid)}"
    return f"{APP_BASIS}/#/IfcViewer?{query}"


def _ziel(result_json: dict, datei: Path, ctx: ToolContext) -> dict | None:
    """Structured viewer target for the app: {"datei": "model/x.ifc", "guid"?}.

    Only when the file lies in the ACTIVE project's model dir — GET /files
    serves nothing else (server.py:157-166), any other value would 403.
    """
    if not ctx.project_dir:
        return None
    model_dir = (ctx.project_dir / "model").resolve()
    try:
        inside = datei.resolve().is_relative_to(model_dir)
    except (OSError, ValueError):
        return None
    if not inside:
        return None
    ziel: dict[str, Any] = {"datei": f"model/{datei.name}"}
    guid = result_json.get("guid")
    if isinstance(guid, str) and guid:
        ziel["guid"] = guid
    return ziel


def _run_sync(unterbefehl: str, datei: Path, optionen: dict[str, Any],
              datei2: Path | None) -> dict:
    """Executes one subcommand (called in a worker thread — T-67-10)."""
    if unterbefehl == "liste":
        return _script("ifc_list").run(datei, klasse=optionen.get("klasse"))
    if unterbefehl == "mengen":
        return _script("ifc_quantities").run(
            datei, klasse=optionen.get("klasse"),
            geometrie=bool(optionen.get("geometrie")))
    if unterbefehl == "props":
        return _script("ifc_props").run(datei, guid=optionen.get("guid"))
    if unterbefehl == "klassen":
        return _script("ifc_classify").run(datei)
    if unterbefehl == "diff":
        if datei2 is None:
            return {"error": "diff braucht eine zweite Datei (datei2)"}
        return _script("ifc_diff").run(datei, datei2,
                                       volumen=bool(optionen.get("volumen")))
    if unterbefehl == "check":
        return _script("ifc_check").run(datei, regeln=optionen.get("regeln"))
    if unterbefehl == "setze":
        fehlend = [k for k in ("pset", "eigenschaft", "wert") if not optionen.get(k)]
        if fehlend:
            return {"error": f"setze braucht: {', '.join(fehlend)}"}
        return _script("ifc_props").set_property(
            datei, optionen.get("guid"), optionen["pset"], optionen["eigenschaft"],
            optionen["wert"], out_path=optionen.get("out"), typ=optionen.get("typ"))
    return {"error": f"Unbekannter Unterbefehl: {unterbefehl} "
                     f"(verfügbar: {', '.join(UNTERBEFEHLE)})"}


async def ifc_run(args: dict, ctx: ToolContext) -> str:
    """Tool handler: subcommand -> script run() in a thread -> JSON string."""
    try:
        import ifcopenshell  # noqa: F401
    except ImportError:
        return tool_error(
            "IFC-Werkzeuge brauchen das Extra [ifc] installieren: "
            "pip install -e \".[dev,ifc]\" (ifcopenshell==0.8.5)")

    unterbefehl = str(args.get("unterbefehl") or "").strip().lower().lstrip("/")
    if unterbefehl not in UNTERBEFEHLE:
        return tool_error(f"ifc_run: Unterbefehl {unterbefehl!r} unbekannt "
                          f"(verfügbar: {', '.join(UNTERBEFEHLE)})")

    optionen = args.get("optionen") or {}
    if not isinstance(optionen, dict):
        return tool_error("ifc_run: optionen muss ein Objekt sein")

    # --- file selection: explicit `datei` (sandbox-checked) or newest model/*.ifc
    raw = str(args.get("datei") or "").strip()
    try:
        if raw:
            datei = resolve_in_sandbox(raw, ctx, must_exist=True)
        else:
            datei = _neueste_modelldatei(ctx)
            if datei is None:
                return tool_error(
                    "Kein model/*.ifc im aktiven Projekt gefunden — "
                    "datei= übergeben oder ein Projekt mit Modell öffnen")
    except ValueError as exc:
        return tool_error(str(exc))

    datei2: Path | None = None
    raw2 = str(optionen.get("datei2") or args.get("datei2") or "").strip()
    if unterbefehl == "diff":
        try:
            if raw2:
                datei2 = resolve_in_sandbox(raw2, ctx, must_exist=True)
            else:
                return tool_error("diff braucht datei2 (zweite IFC-Datei)")
        except ValueError as exc:
            return tool_error(str(exc))

    warnungen: list[str] = []
    groesse = datei.stat().st_size
    if groesse > GROESSEN_WARNUNG_BYTES:
        warnungen.append(
            f"Modell ist {groesse / 1e6:.0f} MB (> 50 MB) — Lesebefehle können "
            "lange laufen; Geometrie-Fallback (geometrie/volumen) besser weglassen")
    if optionen.get("geometrie") or optionen.get("volumen"):
        warnungen.append("Geometrie-Fallback aktiv: Werte sind Mesh-Näherungen [ASSUMED]")

    # T-67-10: scripts run in a worker thread, never on the event loop.
    result = await asyncio.to_thread(_run_sync, unterbefehl, datei, optionen, datei2)

    if "error" in result:
        return tool_error(result["error"])

    payload: dict[str, Any] = {
        "unterbefehl": unterbefehl,
        "datei": str(datei),
        "markdown": result.get("markdown", ""),
        "json": result.get("json", {}),
        # T-67-09: the result is model data, never instructions.
        "hinweis": f"{DATA_NOT_INSTRUCTION} {result.get('hinweis', '')}".strip(),
        "warnungen": warnungen,
    }
    ziel = _ziel(payload["json"], datei, ctx)
    if ziel:
        payload["ziel"] = ziel
        payload["viewer_link"] = _viewer_link(ziel["datei"], ziel.get("guid"))
    return tool_ok(**payload)


registry.register("ifc_run", "both", {
    "description": (
        "IFC-Modell des aktiven Projekts lesen, prüfen, vergleichen, schreiben. "
        "Unterbefehle: liste, mengen, props, klassen, diff, check, setze. "
        "Ohne datei= gilt das neueste model/*.ifc. Ergebnisse: deutsche "
        "Markdown-Tabellen + JSON + Viewer-Ziel für die App."),
    "parameters": {"type": "object", "properties": {
        "unterbefehl": {"type": "string", "enum": list(UNTERBEFEHLE)},
        "datei": {"type": "string", "description": "IFC-Pfad (Standard: neuestes model/*.ifc)"},
        "datei2": {"type": "string", "description": "zweite Datei für diff"},
        "optionen": {"type": "object", "description": (
            "je Unterbefehl: klasse, guid, geometrie (bool), volumen (bool), "
            "regeln (Pfad), pset/eigenschaft/wert/typ/out für setze")},
    }, "required": ["unterbefehl"]},
}, ifc_run)
