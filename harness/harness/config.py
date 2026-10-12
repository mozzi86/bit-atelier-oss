"""Configuration: config.yaml (behaviour) + .env (secrets only) → HarnessConfig.

In: harness/config.yaml (falls back to config.example.yaml), harness/.env.
Out: a frozen HarnessConfig dataclass. Nothing here reads API keys — providers
read os.environ[profile.env_var] themselves, so keys never travel through config.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml
from dotenv import load_dotenv

HARNESS_DIR = Path(__file__).resolve().parent.parent  # …/harness (the package root)

MODES = ("developer", "user")
DISPLAY_NAMES = {
    "developer": "BIT Atelier Developer Harness",
    "user": "Atelier AI Harness",
}

DEFAULT_ALLOWLIST = [
    "git status", "git log", "git diff", "ls", "dir", "cat", "type", "rg", "grep",
    "find", "python --version", "node --version", "npm ls",
]


@dataclass(frozen=True)
class HarnessConfig:
    mode: str = "user"
    provider: str = "mock"
    model: str | None = None
    host: str = "127.0.0.1"
    port: int = 8765
    projects_dir: Path = HARNESS_DIR / "projects"
    project: str | None = None
    repo_root: Path = HARNESS_DIR.parent
    memory_budget_chars: int = 2200
    memory_nudge_every: int = 10
    max_rounds: int = 20
    max_tokens: int = 4096
    shell_allowlist: tuple[str, ...] = tuple(DEFAULT_ALLOWLIST)
    shell_yolo: bool = False
    shell_timeout_s: int = 120
    logs_dir: Path = HARNESS_DIR / "logs"
    providers_file: Path = HARNESS_DIR / "providers.yaml"
    stt_enabled: bool = True
    stt_model: str = "small"
    stt_language: str = "de"
    tts_enabled: bool = False
    tts_voice: str = "de_DE-thorsten-medium"
    # 67-04: FreeCAD. None = BIT_FREECAD env or the platform default (tools/freecad.py).
    freecad_cmd: str | None = None
    freecad_bridge_port: int = 8766
    freecad_timeout_s: int = 120
    # 71-05: georeference for the IFC delivery export. No default on purpose —
    # project coordinates never live in code (NDA); projects/<slug>/georef.yaml wins.
    ifc_georef: dict[str, Any] | None = None
    # 93-12: set by BIT-Atelier when it starts the harness (harness/lokal.py). nur_lokal refuses every
    # provider profile that does not talk to this computer; app_lokal_* is the app's local connection.
    nur_lokal: bool = False
    app_lokal_base_url: str | None = None
    app_lokal_modell: str | None = None
    app_lokal_art: str = "openai"
    raw: dict[str, Any] = field(default_factory=dict, compare=False)

    @property
    def display_name(self) -> str:
        return DISPLAY_NAMES[self.mode]

    def with_overrides(self, **kw: Any) -> "HarnessConfig":
        """Return a copy with CLI overrides applied (None values are ignored)."""
        clean = {k: v for k, v in kw.items() if v is not None}
        if "mode" in clean and clean["mode"] not in MODES:
            raise ValueError(f"Unbekannter Modus: {clean['mode']!r} (erlaubt: developer, user)")
        from dataclasses import replace
        return replace(self, **clean)


def _resolve(base: Path, value: str | None, default: Path) -> Path:
    if not value:
        return default
    p = Path(value).expanduser()
    return p if p.is_absolute() else (base / p).resolve()


def load_config(path: Path | None = None, *, harness_dir: Path = HARNESS_DIR) -> HarnessConfig:
    """Load config.yaml (or the example) and .env. Raises ValueError on a bad mode."""
    load_dotenv(harness_dir / ".env", override=False)
    cfg_path = path or (harness_dir / "config.yaml")
    if not cfg_path.exists():
        cfg_path = harness_dir / "config.example.yaml"
    data: dict[str, Any] = {}
    if cfg_path.exists():
        data = yaml.safe_load(cfg_path.read_text(encoding="utf-8")) or {}

    mode = str(data.get("mode") or "user")
    if mode not in MODES:
        raise ValueError(f"config.yaml: mode={mode!r} — erlaubt sind developer oder user")

    shell = data.get("shell") or {}
    agent = data.get("agent") or {}
    stt = data.get("stt") or {}
    tts = data.get("tts") or {}
    freecad = data.get("freecad") or {}
    ifc = data.get("ifc") or {}
    allow = shell.get("allowlist")
    providers_file = harness_dir / "providers.yaml"
    if not providers_file.exists():
        providers_file = harness_dir / "providers.example.yaml"

    return HarnessConfig(
        mode=mode,
        provider=str(data.get("provider") or "mock"),
        model=data.get("model") or None,
        host=str(data.get("host") or "127.0.0.1"),
        port=int(data.get("port") or 8765),
        projects_dir=_resolve(harness_dir, data.get("projects_dir"), harness_dir / "projects"),
        project=data.get("project") or None,
        repo_root=_resolve(harness_dir, data.get("repo_root"), harness_dir.parent),
        memory_budget_chars=int(data.get("memory_budget_chars") or 2200),
        memory_nudge_every=int(data.get("memory_nudge_every") or 10),
        max_rounds=int(agent.get("max_rounds") or 20),
        max_tokens=int(agent.get("max_tokens") or 4096),
        shell_allowlist=tuple(allow) if isinstance(allow, list) else tuple(DEFAULT_ALLOWLIST),
        shell_yolo=bool(shell.get("yolo", False)),
        shell_timeout_s=int(shell.get("timeout_s") or 120),
        logs_dir=_resolve(harness_dir, data.get("logs_dir"), harness_dir / "logs"),
        providers_file=providers_file,
        stt_enabled=bool(stt.get("enabled", True)),
        stt_model=str(stt.get("model") or "small"),
        stt_language=str(stt.get("language") or "de"),
        tts_enabled=bool(tts.get("enabled", False)),
        tts_voice=str(tts.get("voice") or "de_DE-thorsten-medium"),
        freecad_cmd=str(freecad["cmd"]) if freecad.get("cmd") else None,
        freecad_bridge_port=int(freecad.get("bridge_port") or 8766),
        freecad_timeout_s=int(freecad.get("timeout_s") or 120),
        ifc_georef=dict(ifc["georef"]) if isinstance(ifc.get("georef"), dict) else None,
        # 93-12: environment from BIT-Atelier wins over config.yaml (nur_lokal: true there also works).
        nur_lokal=_env_flag("BIT_NUR_LOKAL") if os.environ.get("BIT_NUR_LOKAL") is not None else bool(data.get("nur_lokal", False)),
        app_lokal_base_url=(os.environ.get("BIT_LOKAL_BASE_URL") or "").strip() or None,
        app_lokal_modell=(os.environ.get("BIT_LOKAL_MODELL") or "").strip() or None,
        app_lokal_art="ollama" if (os.environ.get("BIT_LOKAL_ART") or "").strip().lower() == "ollama" else "openai",
        raw=data,
    )


def _env_flag(name: str) -> bool:
    """"1", "true", "ja", "yes", "on" (any case) → True."""
    return (os.environ.get(name) or "").strip().lower() in ("1", "true", "ja", "yes", "on")


def env_key(env_var: str | None) -> str | None:
    """The only place a key is read: from the process environment, never from YAML."""
    if not env_var:
        return None
    value = os.environ.get(env_var, "").strip()
    return value or None
