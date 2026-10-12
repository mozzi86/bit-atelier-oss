"""fc_run — starts an fc_*.py script in FreeCAD's own interpreter (harness venv side).

FreeCAD brings its own Python (3.11 in FreeCAD 1.1) with its own modules; the
harness venv cannot import FreeCAD. So every FreeCAD job is a subprocess:

    freecadcmd <script.py>     with FC_HARNESS_IN / FC_HARNESS_OUT / FC_HARNESS_ENTRY

JSON goes in and out through files in a temporary directory. Arguments after
the script would be OPENED by freecadcmd 1.1 as documents (it tried to load
in.json as a FEM mesh), hence the environment variables. Command as a list,
never a shell string (paths contain spaces). Timeout 120 s (T-67-13).

Lookup of the binary (finde_freecadcmd):
  1. BIT_FREECAD — path to freecadcmd(.exe) or to the FreeCAD install folder
  2. config.yaml freecad.cmd
  3. platform defaults, then freecadcmd/FreeCADCmd on PATH

Standalone CLI:  python fc_run.py <fc_script.py> <in.json> [out.json]
In-process:      run_script("fc_massing", payload, cmd=…) -> dict
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Mapping

SCRIPTS_DIR = Path(__file__).resolve().parent
ENV_VAR = "BIT_FREECAD"
TIMEOUT_S = 120

DEFAULT_CANDIDATES = (
    r"C:\Program Files\FreeCAD 1.1\bin\freecadcmd.exe",
    r"C:\Program Files\FreeCAD 1.0\bin\FreeCADCmd.exe",
    "/Applications/FreeCAD.app/Contents/MacOS/FreeCADCmd",
    "/usr/bin/freecadcmd",
)
_NAMEN = ("freecadcmd.exe", "FreeCADCmd.exe", "freecadcmd", "FreeCADCmd")

HINWEIS_FEHLT = (
    "freecadcmd nicht gefunden (config freecad.cmd) — FreeCAD 1.1 installieren oder den Pfad "
    f"setzen: Umgebungsvariable {ENV_VAR} oder freecad.cmd in harness/config.yaml "
    r"(Standard: C:\Program Files\FreeCAD 1.1\bin\freecadcmd.exe). "
    "Kennzahlen ohne FreeCAD: /freecad plan")


def _aus_pfad(raw: str) -> Path | None:
    p = Path(raw.strip().strip('"')).expanduser()
    if p.is_file():
        return p
    if p.is_dir():
        for sub in ("bin", "Contents/MacOS", "."):
            for name in _NAMEN:
                cand = p / sub / name
                if cand.is_file():
                    return cand
    return None


def finde_freecadcmd(config_cmd: str | None = None,
                     env: Mapping[str, str] | None = None) -> Path | None:
    """Path to freecadcmd, or None. Order: BIT_FREECAD, config, defaults, PATH."""
    env = os.environ if env is None else env
    for raw in (env.get(ENV_VAR), config_cmd):
        if raw:
            found = _aus_pfad(raw)
            if found:
                return found
    for cand in DEFAULT_CANDIDATES:
        if Path(cand).is_file():
            return Path(cand)
    for name in _NAMEN:
        hit = shutil.which(name)
        if hit:
            return Path(hit)
    return None


def _tail(text: str, zeilen: int = 15) -> str:
    # FreeCAD prints a banner and console noise; the end holds the cause.
    rows = [r for r in text.splitlines() if r.strip()]
    return "\n".join(rows[-zeilen:])


def run_script(script: str, payload: dict[str, Any], *, cmd: str | Path | None = None,
               timeout: int = TIMEOUT_S) -> dict[str, Any]:
    """Runs skills/freecad/scripts/<script>.py in freecadcmd with `payload`.

    Returns the script's output dict ({"ok": true, …}) or {"ok": false,
    "error": <plain text>} — never raises for FreeCAD-side problems.
    """
    exe = Path(cmd) if cmd else finde_freecadcmd()
    if exe is None or not exe.is_file():
        return {"ok": False, "error": HINWEIS_FEHLT}
    script_path = SCRIPTS_DIR / f"{script}.py"
    if not script_path.is_file():
        return {"ok": False, "error": f"FreeCAD-Skript fehlt: {script_path}"}

    with tempfile.TemporaryDirectory(prefix="fc-harness-") as tmp:
        ein = Path(tmp) / "in.json"
        aus = Path(tmp) / "out.json"
        ein.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        env = {**os.environ, "FC_HARNESS_IN": str(ein), "FC_HARNESS_OUT": str(aus),
               "FC_HARNESS_ENTRY": script}
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if sys.platform == "win32" else 0
        try:
            proc = subprocess.run([str(exe), str(script_path)], cwd=tmp, env=env,
                                  capture_output=True, timeout=timeout, creationflags=flags)
        except subprocess.TimeoutExpired:
            return {"ok": False, "error": f"FreeCAD hat nach {timeout} s nicht geantwortet "
                                          f"({script}) — Abbruch (T-67-13)"}
        except OSError as exc:
            return {"ok": False, "error": f"FreeCAD konnte nicht starten ({exe}): {exc}"}
        stdout = proc.stdout.decode("utf-8", errors="replace")
        stderr = proc.stderr.decode("utf-8", errors="replace")
        if not aus.is_file():
            return {"ok": False, "error": (
                f"FreeCAD lieferte kein Ergebnis ({script}, Exit {proc.returncode}). "
                f"Letzte Ausgabe:\n{_tail(stderr + chr(10) + stdout)}")}
        try:
            result = json.loads(aus.read_text(encoding="utf-8"))
        except ValueError as exc:
            return {"ok": False, "error": f"FreeCAD-Ergebnis unlesbar ({script}): {exc}"}
    if not result.get("ok"):
        result.setdefault("error", "FreeCAD-Skript meldete einen Fehler ohne Text")
    return result


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description="fc_*.py-Skript in FreeCAD ausführen (JSON rein/raus).")
    parser.add_argument("script", help="z. B. fc_massing oder fc_massing.py")
    parser.add_argument("eingabe", help="Eingabe-JSON")
    parser.add_argument("ausgabe", nargs="?", help="Ausgabe-JSON (Standard: stdout)")
    parser.add_argument("--timeout", type=int, default=TIMEOUT_S)
    args = parser.parse_args(argv)
    payload = json.loads(Path(args.eingabe).read_text(encoding="utf-8"))
    result = run_script(Path(args.script).stem, payload, timeout=args.timeout)
    text = json.dumps(result, ensure_ascii=False, indent=2)
    if args.ausgabe:
        Path(args.ausgabe).write_text(text, encoding="utf-8")
    else:
        print(text)
    if not result.get("ok"):
        print(result.get("error"), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
