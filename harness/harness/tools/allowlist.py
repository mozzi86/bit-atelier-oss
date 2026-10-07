"""Shell policy: read-only allowlist runs freely, a hard-coded blocklist never runs,
everything else needs a confirmation (Hermes approval pattern, reduced).

`yolo` is read ONCE at import from config.yaml and frozen in _YOLO_FROZEN — a
prompt injection that edits config or the environment at runtime changes nothing
(T-67-02). In user mode yolo does not exist at all.
"""

from __future__ import annotations

import re
import shlex
from dataclasses import dataclass

from harness.config import load_config

try:
    _YOLO_FROZEN: bool = bool(load_config().shell_yolo)
except Exception:  # a broken config must not turn yolo on
    _YOLO_FROZEN = False

# Never, not even with "ja". Matched against the normalised command.
BLOCKLIST: tuple[re.Pattern[str], ...] = tuple(re.compile(p, re.IGNORECASE) for p in (
    r"\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\b",      # rm -rf / rm -fr
    r"\brm\s+-r\b.*\s/(\s|$)",                            # rm -r /
    r"\bdel\b.*\s/s\b",                                   # del /s
    r"\brmdir\b.*\s/s\b",
    r"\bremove-item\b.*-recurse",
    r"\bformat(\.com)?\s+[a-z]:",                         # format c:
    r"\bgit\s+push\b.*(--force|-f\b|\+)",                 # git push --force / +ref
    r"\bgit\s+reset\s+--hard\b",
    r"\bgit\s+clean\b.*-[a-z]*f",
    r"\bshutdown\b|\breboot\b|\bStop-Computer\b|\bRestart-Computer\b",
    r"\bmkfs\b|\bdd\s+if=",
    r">\s*/dev/sd",
    r"\bcurl\b.*\|\s*(ba)?sh\b|\bwget\b.*\|\s*(ba)?sh\b|\biex\b.*DownloadString",
))

# One-sentence explanations for the approval dialog.
EXPLAIN: dict[str, str] = {
    "npm install": "installiert die npm-Abhängigkeiten aus package.json",
    "npm run": "führt ein npm-Skript aus package.json aus",
    "npm test": "führt die Test-Suite aus",
    "npx": "führt ein npm-Paket einmalig aus",
    "pip install": "installiert Python-Pakete ins aktive venv",
    "python": "führt ein Python-Skript aus",
    "pytest": "führt die Python-Tests aus",
    "git add": "merkt Änderungen für den nächsten Commit vor",
    "git commit": "erzeugt einen Commit aus den vorgemerkten Änderungen",
    "git push": "überträgt lokale Commits auf den Server",
    "git pull": "holt Commits vom Server und führt sie zusammen",
    "git checkout": "wechselt Branch oder stellt Dateien wieder her",
    "git stash": "legt Arbeitsstand beiseite",
    "mkdir": "legt ein Verzeichnis an",
    "mv": "verschiebt oder benennt um",
    "cp": "kopiert Dateien",
    "rm": "löscht Dateien",
    "del": "löscht Dateien",
}


@dataclass(frozen=True)
class Verdict:
    kind: str          # "allow" | "approve" | "block"
    erklaerung: str


def normalise(command: str) -> str:
    return re.sub(r"\s+", " ", command.strip())


def _first_token(command: str) -> str:
    try:
        parts = shlex.split(command, posix=True)
    except ValueError:
        parts = command.split()
    return parts[0] if parts else ""


def is_blocked(command: str) -> bool:
    c = normalise(command)
    return any(p.search(c) for p in BLOCKLIST)


def is_allowlisted(command: str, allowlist: tuple[str, ...] | list[str]) -> bool:
    """Prefix match on whole tokens: `git log --oneline` matches `git log`, `gitk` does not.
    Shell operators (|, ;, &&, >, `, $( ) make a command non-allowlisted — a pipe to
    rm would otherwise hide behind an innocent `cat`."""
    c = normalise(command)
    if re.search(r"[|;&><`]|\$\(", c):
        return False
    for entry in allowlist:
        e = normalise(entry)
        if c == e or c.startswith(e + " "):
            return True
    return False


def explain(command: str) -> str:
    c = normalise(command)
    for prefix, text in sorted(EXPLAIN.items(), key=lambda kv: -len(kv[0])):
        if c == prefix or c.startswith(prefix + " "):
            return text
    tok = _first_token(c) or c
    return f"führt `{tok}` aus"


def judge(command: str, *, mode: str, allowlist: tuple[str, ...] | list[str]) -> Verdict:
    if not normalise(command):
        return Verdict("block", "leerer Befehl")
    if is_blocked(command):
        return Verdict("block", "steht auf der Blockliste (zerstörerisch) und läuft nie")
    if is_allowlisted(command, allowlist):
        return Verdict("allow", "Nur-Lese-Befehl aus der Allowlist")
    if mode == "user":
        return Verdict("block", "im Nutzer-Modus laufen nur Befehle der Nur-Lese-Allowlist")
    if _YOLO_FROZEN:
        return Verdict("allow", "yolo beim Start aktiv — ohne Rückfrage (Developer-Modus)")
    return Verdict("approve", explain(command))
