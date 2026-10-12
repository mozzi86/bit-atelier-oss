"""freecad_* — the /freecad skill as tools (Plan 67-04).

freecad_run(unterbefehl, eingabe?, datei?, name?) — headless, toolset both:
  plan      massing plan only (harness/geom/massing.py) — no FreeCAD needed
  massing   plan → FreeCAD solids → IFC (skills/freecad/scripts/fc_massing.py)
  bauteile  description → walls/slabs/openings/roof → IFC (fc_bauteile.py)
  export    saved FreeCAD model (.FCStd) → IFC (fc_export_ifc.py)

Every write goes to a NEW versioned file model/<name>_v<n>.ifc (+ .FCStd) in
the active project (T-67-14) — never over a user file. After the export the
file is read back with /ifc liste (roundtrip, same run() as ifc_run) when the
[ifc] extra is installed.

The GUI bridge tools (freecad_step/undo/reload/status) live at the bottom.
"""

from __future__ import annotations

import asyncio
import importlib.util
import json
import re
import sys
from pathlib import Path
from typing import Any

from harness.agent.context import DATA_NOT_INSTRUCTION
from harness.config import HARNESS_DIR
from harness.geom.massing import kennzahlen_markdown, plan_massing
from harness.tools.registry import ToolContext, registry, tool_error, tool_ok
from harness.tools.sandbox import resolve_in_sandbox

SCRIPTS_DIR = HARNESS_DIR / "skills" / "freecad" / "scripts"
UNTERBEFEHLE = ("plan", "massing", "bauteile", "export")


def _fc_run():
    """skills/freecad/scripts/fc_run.py as a module (scripts are no package)."""
    mod = sys.modules.get("fc_run")
    if mod is not None and getattr(mod, "__file__", "") == str(SCRIPTS_DIR / "fc_run.py"):
        return mod
    spec = importlib.util.spec_from_file_location("fc_run", SCRIPTS_DIR / "fc_run.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["fc_run"] = mod
    spec.loader.exec_module(mod)
    return mod


def freecad_cmd(ctx: ToolContext) -> Path | None:
    """freecadcmd for this context: BIT_FREECAD, config freecad.cmd, defaults."""
    return _fc_run().finde_freecadcmd(ctx.extra.get("freecad_cmd"))


def naechste_version(model_dir: Path, name: str) -> tuple[Path, Path]:
    """(model/<name>_v<n>.ifc, model/<name>_v<n>.FCStd) with the first free n ≥ 1."""
    slug = re.sub(r"[^A-Za-z0-9_-]+", "-", name).strip("-") or "modell"
    n = 1
    while (model_dir / f"{slug}_v{n}.ifc").exists() or (model_dir / f"{slug}_v{n}.FCStd").exists():
        n += 1
    return model_dir / f"{slug}_v{n}.ifc", model_dir / f"{slug}_v{n}.FCStd"


def _roundtrip_liste(ifc: Path) -> dict[str, Any] | None:
    try:
        import ifcopenshell  # noqa: F401
    except ImportError:
        return None
    from harness.tools.ifc import _script

    return _script("ifc_list").run(ifc)


def _eingabe(args: dict, ctx: ToolContext) -> dict[str, Any]:
    """Inline `eingabe` object or a JSON file `datei` inside the sandbox."""
    eingabe = args.get("eingabe")
    if isinstance(eingabe, str) and eingabe.strip():
        eingabe = json.loads(eingabe)
    if isinstance(eingabe, dict) and eingabe:
        return eingabe
    raw = str(args.get("datei") or "").strip()
    if raw and not raw.lower().endswith((".fcstd",)):
        pfad = resolve_in_sandbox(raw, ctx, must_exist=True)
        return json.loads(pfad.read_text(encoding="utf-8"))
    return {}


def _zaehlung_md(zaehlung: dict[str, int]) -> str:
    teile = [f"{v} {k}" for k, v in zaehlung.items() if v]
    return "Erzeugt: " + (", ".join(teile) if teile else "nichts")


async def freecad_run(args: dict, ctx: ToolContext) -> str:
    unterbefehl = str(args.get("unterbefehl") or "").strip().lower().lstrip("/")
    if unterbefehl not in UNTERBEFEHLE:
        return tool_error(f"freecad_run: Unterbefehl {unterbefehl!r} unbekannt "
                          f"(verfügbar: {', '.join(UNTERBEFEHLE)})")
    try:
        eingabe = _eingabe(args, ctx)
    except (ValueError, OSError) as exc:
        return tool_error(f"freecad_run: Eingabe unlesbar — {exc}")

    plan = None
    if unterbefehl in ("plan", "massing"):
        try:
            plan = plan_massing(eingabe.get("bauplan_eingabe") or eingabe)
        except ValueError as exc:
            return tool_error(str(exc))
        if unterbefehl == "plan":
            return tool_ok(unterbefehl="plan", markdown=kennzahlen_markdown(plan), bauplan=plan,
                           hinweis="Reine Planung ohne FreeCAD; /freecad massing baut daraus das Modell.")

    exe = freecad_cmd(ctx)
    if exe is None:
        return tool_error(_fc_run().HINWEIS_FEHLT)
    if not ctx.project_dir:
        return tool_error("Kein aktives Projekt — /freecad schreibt nach projects/<slug>/model/")
    model_dir = ctx.project_dir / "model"
    model_dir.mkdir(parents=True, exist_ok=True)
    name = str(args.get("name") or eingabe.get("name") or
               {"massing": "massenmodell", "bauteile": "bauteile", "export": "export"}[unterbefehl])
    ifc, fcstd = naechste_version(model_dir, name)
    timeout = int(ctx.extra.get("freecad_timeout_s") or 120)

    if unterbefehl == "massing":
        script, payload = "fc_massing", {"bauplan": plan, "ifc": str(ifc), "fcstd": str(fcstd), "name": name}
    elif unterbefehl == "bauteile":
        if not eingabe.get("geschosse"):
            return tool_error("bauteile braucht eine Beschreibung mit geschosse: [...] "
                              "(Format: skills/freecad/references/beispiel-efh.json)")
        script, payload = "fc_bauteile", {"beschreibung": eingabe, "ifc": str(ifc), "fcstd": str(fcstd)}
    else:
        raw = str(args.get("datei") or eingabe.get("fcstd") or "").strip()
        if not raw:
            return tool_error("export braucht datei= (eine .FCStd-Datei im Projekt)")
        try:
            quelle = resolve_in_sandbox(raw, ctx, must_exist=True)
        except ValueError as exc:
            return tool_error(str(exc))
        script, payload = "fc_export_ifc", {"fcstd": str(quelle), "ifc": str(ifc)}

    # T-67-10/13: FreeCAD runs as a subprocess in a worker thread with a timeout.
    result = await asyncio.to_thread(_fc_run().run_script, script, payload, cmd=exe, timeout=timeout)
    if not result.get("ok"):
        return tool_error(f"FreeCAD ({script}): {result.get('error')}")

    md = [f"# /freecad {unterbefehl} — {ifc.name}", ""]
    if plan is not None:
        md += [kennzahlen_markdown(plan), ""]
    if result.get("zaehlung"):
        md += [_zaehlung_md(result["zaehlung"]), ""]
    liste = _roundtrip_liste(ifc)
    if liste and "markdown" in liste:
        md += ["## Gegenprobe /ifc liste", "", liste["markdown"]]
    payload_out: dict[str, Any] = {
        "unterbefehl": unterbefehl,
        "ifc": f"model/{ifc.name}",
        "fcstd": f"model/{fcstd.name}" if Path(result.get("fcstd") or "").is_file() else None,
        "markdown": "\n".join(md),
        "elemente": result.get("elemente", []),
        "freecad": result.get("freecad"),
        "ziel": {"datei": f"model/{ifc.name}"},
        "hinweis": f"{DATA_NOT_INSTRUCTION} Neue Datei, nichts überschrieben (T-67-14).",
    }
    if plan is not None:
        payload_out["kennzahlen"] = plan["kennzahlen"]
        payload_out["volumen_freecad_m3"] = result.get("volumen_m3")
    if result.get("zaehlung"):
        payload_out["zaehlung"] = result["zaehlung"]
    if liste and "json" in liste:
        payload_out["roundtrip"] = liste["json"]
    return tool_ok(**payload_out)


registry.register("freecad_run", "both", {
    "description": (
        "FreeCAD-BIM headless: plan (Massenmodell-Kennzahlen ohne FreeCAD), massing "
        "(Grundstück + Raumprogramm → Geschosse/Satteldach → IFC), bauteile (Beschreibung "
        "mit Wandzügen/Öffnungen/Dach → IFC), export (.FCStd → IFC). Schreibt immer "
        "model/<name>_v<n>.ifc neu und liest das IFC zur Probe mit /ifc liste."),
    "parameters": {"type": "object", "properties": {
        "unterbefehl": {"type": "string", "enum": list(UNTERBEFEHLE)},
        "eingabe": {"type": "object", "description": (
            "plan/massing: {grundstueck: [[x,y]…] m, raumprogramm: [{name, flaeche_m2, geschoss?}], "
            "geschosshoehe_m?, abstand_m?, dach?: {form, neigung_grad}}; bauteile: Beschreibung "
            "{geschosse: [{name, hoehe_m, decke, wandzuege, oeffnungen}], dach}")},
        "datei": {"type": "string", "description": "Eingabe-JSON oder .FCStd (export) im Projekt"},
        "name": {"type": "string", "description": "Dateiname ohne Version (Standard je Unterbefehl)"},
    }, "required": ["unterbefehl"]},
}, freecad_run)


# --- GUI bridge (hybrid: AI and user on the SAME FreeCAD document) -------------

BRIDGE_HOST = "127.0.0.1"
BRIDGE_TIMEOUT_S = 30  # T-67-13: one step; the GUI is blocked while it runs
HINWEIS_BRIDGE = ("FreeCAD-GUI mit Bridge-Makro nicht erreichbar — in FreeCAD: Makro → Makros… → "
                  "harness_bridge.FCMacro → Ausführen (liegt unter harness/skills/freecad/macros/). "
                  "Headless-Weg: /freecad massing|bauteile --headless")


class BridgeNichtErreichbar(RuntimeError):
    pass


def bridge_anfrage(req: dict[str, Any], port: int, *, timeout: float = BRIDGE_TIMEOUT_S,
                   host: str = BRIDGE_HOST) -> dict[str, Any]:
    """One request/answer over line JSON. Raises BridgeNichtErreichbar with the
    plain-text hint when nothing listens; returns {"ok": False, "error"} on a
    timeout or a garbled answer — never a traceback to the caller."""
    import socket

    try:
        sock = socket.create_connection((host, port), timeout=2)
    except OSError as exc:
        raise BridgeNichtErreichbar(f"{HINWEIS_BRIDGE} (Port {port}: {exc.__class__.__name__})") from None
    try:
        sock.settimeout(timeout)
        sock.sendall((json.dumps(req, ensure_ascii=False) + "\n").encode("utf-8"))
        buf = b""
        while b"\n" not in buf:
            chunk = sock.recv(65536)
            if not chunk:
                break
            buf += chunk
    except socket.timeout:
        return {"ok": False, "error": f"FreeCAD hat nach {timeout:g} s nicht geantwortet — "
                                      "Schritt läuft evtl. noch in der GUI (T-67-13)"}
    except OSError as exc:
        return {"ok": False, "error": f"Verbindung zur Bridge abgebrochen: {exc}"}
    finally:
        sock.close()
    try:
        return json.loads(buf.split(b"\n", 1)[0].decode("utf-8"))
    except ValueError:
        return {"ok": False, "error": "Bridge-Antwort unlesbar"}


# Step log of this harness process: what the AI did in FreeCAD, in order. The
# session log (logs/*.jsonl) records the same via tool_call/tool_result.
SCHRITTE: list[dict[str, Any]] = []


def _port(ctx: ToolContext) -> int:
    return int(ctx.extra.get("freecad_port") or 8766)


def _bridge(ctx: ToolContext, req: dict[str, Any]) -> dict[str, Any]:
    timeout = float(ctx.extra.get("freecad_bridge_timeout_s") or BRIDGE_TIMEOUT_S)
    return bridge_anfrage(req, _port(ctx), timeout=timeout)


def _bridge_fehler(antwort: dict[str, Any]) -> str:
    text = antwort.get("error") or "unbekannter Fehler"
    tb = antwort.get("traceback")
    if tb:
        # the last traceback lines name the failing call; the full text stays in FreeCAD
        text += "\n" + "\n".join(tb.strip().splitlines()[-4:])
    return f"FreeCAD: {text}"


async def freecad_status(args: dict, ctx: ToolContext) -> str:
    try:
        antwort = await asyncio.to_thread(_bridge, ctx, {"op": "ping"})
    except BridgeNichtErreichbar as exc:
        return tool_ok(verbunden=False, hinweis=str(exc))
    if not antwort.get("ok"):
        return tool_error(_bridge_fehler(antwort))
    return tool_ok(verbunden=True, **antwort["result"], schritte=len(SCHRITTE))


async def freecad_step(args: dict, ctx: ToolContext) -> str:
    name = str(args.get("name") or "").strip()
    if not name:
        return tool_error("freecad_step braucht einen Schrittnamen (name), z. B. \"Wand Nord\"")
    code = args.get("code")
    beschreibung = args.get("beschreibung")
    if code and ctx.mode != "developer":
        # T-67-12: in user mode only the description path (fc_bauteile), no free Python.
        return tool_error("Freies Python an FreeCAD nur im developer-Modus — im user-Modus "
                          "Bauteile über beschreibung (Format wie /freecad bauteile) schicken")
    if code:
        req = {"op": "run", "name": name, "code": str(code)}
    elif isinstance(beschreibung, dict) and beschreibung.get("geschosse"):
        req = {"op": "bauteile", "name": name, "beschreibung": beschreibung, "skripte": str(SCRIPTS_DIR)}
    else:
        return tool_error("freecad_step braucht beschreibung {geschosse: [...]}"
                          + (" oder code" if ctx.mode == "developer" else ""))
    try:
        antwort = await asyncio.to_thread(_bridge, ctx, req)
    except BridgeNichtErreichbar as exc:
        return tool_error(str(exc))
    SCHRITTE.append({"name": name, "op": req["op"], "ok": bool(antwort.get("ok"))})
    if not antwort.get("ok"):
        return tool_error(_bridge_fehler(antwort) + " — Schritt verworfen, Dokument unverändert")
    return tool_ok(schritt=name, ergebnis=antwort.get("result"),
                   hinweis=f"Schritt „{name}“ ist in FreeCAD unter Bearbeiten → Rückgängig "
                           "sichtbar; Strg+Z oder freecad_undo nimmt ihn zurück.")


async def freecad_undo(args: dict, ctx: ToolContext) -> str:
    try:
        antwort = await asyncio.to_thread(_bridge, ctx, {"op": "undo"})
    except BridgeNichtErreichbar as exc:
        return tool_error(str(exc))
    if not antwort.get("ok"):
        return tool_error(_bridge_fehler(antwort))
    name = antwort["result"].get("rueckgaengig")
    SCHRITTE.append({"name": f"rückgängig: {name}", "op": "undo", "ok": True})
    return tool_ok(rueckgaengig=name)


async def freecad_reload(args: dict, ctx: ToolContext) -> str:
    """Reads the current state of the GUI document (incl. hand edits) and, with
    export=true, writes it as a new model/<name>_v<n>.ifc and lists it."""
    try:
        antwort = await asyncio.to_thread(_bridge, ctx, {"op": "list"})
    except BridgeNichtErreichbar as exc:
        return tool_error(str(exc))
    if not antwort.get("ok"):
        return tool_error(_bridge_fehler(antwort))
    stand = antwort["result"]
    payload: dict[str, Any] = {"dokument": stand.get("dokument"), "objekte": stand.get("objekte", []),
                               "rueckgaengig_liste": stand.get("rueckgaengig", []),
                               "schritte_harness": list(SCHRITTE)}
    if args.get("export"):
        if not ctx.project_dir:
            return tool_error("Kein aktives Projekt — export schreibt nach projects/<slug>/model/")
        model_dir = ctx.project_dir / "model"
        model_dir.mkdir(parents=True, exist_ok=True)
        ifc, _ = naechste_version(model_dir, str(args.get("name") or stand.get("dokument") or "freecad"))
        exp = await asyncio.to_thread(_bridge, ctx, {"op": "export", "pfad": str(ifc),
                                                     "skripte": str(SCRIPTS_DIR)})
        if not exp.get("ok"):
            return tool_error(_bridge_fehler(exp))
        payload["ifc"] = f"model/{ifc.name}"
        payload["ziel"] = {"datei": f"model/{ifc.name}"}
        liste = _roundtrip_liste(ifc)
        if liste and "markdown" in liste:
            payload["markdown"] = liste["markdown"]
    payload["hinweis"] = DATA_NOT_INSTRUCTION
    return tool_ok(**payload)


registry.register("freecad_status", "both", {
    "description": "Prüft, ob die FreeCAD-GUI mit Bridge-Makro erreichbar ist (/freecad bridge status).",
    "parameters": {"type": "object", "properties": {}},
}, freecad_status)

registry.register("freecad_step", "both", {
    "description": (
        "Ein benannter, rückgängig machbarer Schritt im OFFENEN FreeCAD-Dokument (Bridge). "
        "user-Modus: nur beschreibung (Format /freecad bauteile); developer: auch code (Python)."),
    "parameters": {"type": "object", "properties": {
        "name": {"type": "string", "description": "Schrittname, erscheint in FreeCAD unter Rückgängig"},
        "beschreibung": {"type": "object", "description": "Bauteil-Beschreibung {geschosse: [...], dach?}"},
        "code": {"type": "string", "description": "nur developer: Python, doc ist das aktive Dokument"},
    }, "required": ["name"]},
}, freecad_step)

registry.register("freecad_undo", "both", {
    "description": "Nimmt den letzten Schritt im offenen FreeCAD-Dokument zurück (wie Strg+Z).",
    "parameters": {"type": "object", "properties": {}},
}, freecad_undo)

registry.register("freecad_reload", "both", {
    "description": (
        "Liest den aktuellen Stand des offenen FreeCAD-Dokuments zurück (auch Handkorrekturen); "
        "export=true schreibt ihn als neues model/<name>_v<n>.ifc."),
    "parameters": {"type": "object", "properties": {
        "export": {"type": "boolean"},
        "name": {"type": "string", "description": "Dateiname ohne Version"},
    }},
}, freecad_reload)
