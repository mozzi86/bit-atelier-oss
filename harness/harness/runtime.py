"""Runtime assembly shared by CLI and server: config → provider, project, skills,
tool context, session with a byte-stable system prompt.

One Runtime per process; one Session per conversation. `build_session()` is the
single place the system prompt is composed, so CLI and WebSocket cannot drift.
"""

from __future__ import annotations

import shutil
from dataclasses import dataclass, field
from pathlib import Path

from harness.agent.context import PromptInputs, build_system_prompt
from harness.agent.session import Session
from harness.config import HARNESS_DIR, HarnessConfig
from harness.mcp.bridge import SPRECH_PROMPT, McpBridge, McpSettings
from harness.providers.base import LLMProvider, ProviderProfile
from harness.providers.registry import ProviderRegistry
from harness.skills.loader import Skill, load_skills, skills_index
from harness.tools.builtin import registry
from harness.tools.registry import ApproveFn, ToolContext
from harness.workspace import memory as mem
from harness.workspace.project import Project, get_project, list_projects

SKILLS_DIR = HARNESS_DIR / "skills"
EXAMPLES_DIR = HARNESS_DIR / "examples"


@dataclass
class Runtime:
    config: HarnessConfig
    providers: ProviderRegistry
    provider_name: str
    model: str
    project: Project | None = None
    skills: list[Skill] = field(default_factory=list)
    skill_warnings: list[str] = field(default_factory=list)
    skills_dir: Path = SKILLS_DIR
    # 106-05: connection to the app's MCP server (tools of the open viewer) for the speech profile; connected on first use
    mcp: McpBridge | None = None

    @classmethod
    def from_config(cls, cfg: HarnessConfig, *, skills_dir: Path = SKILLS_DIR) -> "Runtime":
        providers = ProviderRegistry.load(cfg.providers_file, nur_lokal=cfg.nur_lokal)
        provider_name = cfg.provider
        # 93-12: BIT-Atelier hands over its local connection. It becomes the start provider when
        # "Nur lokale KI" is on, or when config.yaml names nothing real (mock) — a deliberately
        # configured cloud profile stays the start provider otherwise; app-lokal is then one /model away.
        if cfg.app_lokal_base_url:
            from harness.lokal import APP_LOKAL, app_lokal_profile
            providers.replace(app_lokal_profile(cfg.app_lokal_base_url, cfg.app_lokal_modell or "", cfg.app_lokal_art))
            if cfg.nur_lokal or cfg.provider == "mock":
                provider_name = APP_LOKAL
        profile = providers.get(provider_name)
        if provider_name != cfg.provider:
            model = profile.default_model or ""
        else:
            model = cfg.model or profile.default_model or (profile.models[0] if profile.models else "")
        rt = cls(cfg, providers, provider_name, model, skills_dir=skills_dir)
        rt.mcp = McpBridge(McpSettings.from_raw(cfg.raw.get("mcp"), cfg.repo_root))
        rt.reload_skills()
        if cfg.project:
            try:
                rt.project = rt.open_project(cfg.project)
            except FileNotFoundError:
                rt.project = None  # /status shows "—"; the CLI prints the reason
        return rt

    # --- projects -------------------------------------------------------------
    def open_project(self, slug: str) -> Project:
        """projects/<slug>; if missing but examples/<slug> exists, copy the example once."""
        try:
            return get_project(self.config.projects_dir, slug)
        except FileNotFoundError:
            example = EXAMPLES_DIR / slug
            if (example / "PROJECT.md").exists():
                target = self.config.projects_dir / slug
                shutil.copytree(example, target, dirs_exist_ok=True)
                for sub in ("files", "model"):
                    (target / sub).mkdir(exist_ok=True)
                return get_project(self.config.projects_dir, slug)
            raise

    def projects(self) -> list[str]:
        names = {p.slug for p in list_projects(self.config.projects_dir)}
        if EXAMPLES_DIR.exists():
            names |= {p.name for p in EXAMPLES_DIR.iterdir() if (p / "PROJECT.md").exists()}
        return sorted(names)

    # --- skills ----------------------------------------------------------------
    def reload_skills(self) -> None:
        self.skills, self.skill_warnings = load_skills(self.skills_dir)

    # --- provider --------------------------------------------------------------
    @property
    def profile(self) -> ProviderProfile:
        return self.providers.get(self.provider_name)

    def make_provider(self) -> LLMProvider:
        return self.providers.make_provider(self.provider_name)

    def compression(self):
        from harness.agent.compression import Compression
        return Compression(self.profile)

    def turn_kwargs(self) -> dict:
        """Keyword arguments for run_turn — one place for CLI and server."""
        return {"max_rounds": self.config.max_rounds, "max_tokens": self.config.max_tokens,
                "nudge_every": self.config.memory_nudge_every, "compression": self.compression()}

    def sync_session(self, session: Session, provider: LLMProvider | None) -> LLMProvider:
        """After /model: give the session the current transport, keep history + ledger.
        Returns the (possibly new) provider."""
        if provider is None or (session.provider_name, session.model) != (self.provider_name, self.model):
            provider = self.make_provider()
            session.switch(self.provider_name, self.model)
        return provider

    def set_model(self, provider_name: str | None, model: str | None) -> None:
        if provider_name:
            self.providers.get(provider_name)  # raises with the list of known names
            self.providers.check_local(provider_name)  # 93-12: "Nur lokale KI"
            self.provider_name = provider_name
        prof = self.profile
        if model:
            if prof.models and model not in prof.models:
                raise ValueError(f"Modell {model!r} nicht im Profil {prof.name} (bekannt: {', '.join(prof.models)})")
            self.model = model
        elif provider_name:
            self.model = prof.default_model or (prof.models[0] if prof.models else "")

    # --- context ---------------------------------------------------------------
    def sandbox_roots(self) -> list[Path]:
        roots: list[Path] = []
        if self.project:
            roots.append(self.project.dir)
        if self.config.mode == "developer":
            roots.append(self.config.repo_root)
        return roots

    def tool_context(self, approve: ApproveFn) -> ToolContext:
        return ToolContext(
            mode=self.config.mode,
            projekt=self.project.slug if self.project else None,
            sandbox_roots=self.sandbox_roots(),
            approve=approve,
            project_dir=self.project.dir if self.project else None,
            repo_root=self.config.repo_root if self.config.mode == "developer" else None,
            skills_dir=self.skills_dir,
            extra={"allowlist": self.config.shell_allowlist, "timeout_s": self.config.shell_timeout_s,
                   "freecad_cmd": self.config.freecad_cmd, "freecad_port": self.config.freecad_bridge_port,
                   "freecad_timeout_s": self.config.freecad_timeout_s,
                   "ifc_georef": self.config.ifc_georef},
        )

    def system_prompt(self) -> str:
        facts = mem.load_facts(self.project.memory_dir) if self.project else []
        return build_system_prompt(PromptInputs(
            display_name=self.config.display_name,
            mode=self.config.mode,
            project_md=self.project.project_text() if self.project else "",
            memory_entries=[(f.name, f.description, f.body) for f in facts],
            skills_index=skills_index(self.skills, self.config.mode),
            tools=registry.schemas(self.config.mode),
            memory_budget_chars=self.config.memory_budget_chars,
        ))

    def build_session(self, profil: str | None = None) -> Session:
        """One session. profil "sprechen" (106-05): the speech profile - a short prompt, no project memory, no skills; its tools
        are the registry of the MCP bridge (the caller passes that registry to run_turn), never the file/shell tools."""
        s = Session(provider_name=self.provider_name, model=self.model, mode=self.config.mode,
                    project=self.project.slug if self.project else None)
        if profil == "sprechen":
            tools = self.mcp.registry().schemas(self.config.mode) if self.mcp else []
            s.set_system_prompt(SPRECH_PROMPT + ("\n\n## Werkzeuge\n" + "\n".join(f"- {t.name}: {t.description.splitlines()[0] if t.description else ''}" for t in tools) if tools else ""))
            return s
        s.set_system_prompt(self.system_prompt())
        return s

    def status(self, session: Session) -> dict:
        d = session.status(self.profile, self.config.display_name)
        d["offene_aufgaben"] = len(self.project.open_tasks()) if self.project else 0
        d["skills"] = len(skills_index(self.skills, self.config.mode))
        d["nur_lokal"] = self.config.nur_lokal  # 93-12: the app shows a badge
        # 106-05: the speech field needs to know whether the current provider leaves this computer, and whether the viewer tools are connected
        from harness.lokal import profile_is_local
        d["provider_lokal"] = profile_is_local(self.profile)
        # 106-06: what the "mit Bild" button shows - does the model read images, and where does the provider talk to (host only, never a key)
        from urllib.parse import urlsplit
        from harness.bilder import kann_bilder, katalog_vision
        d["bilder"] = kann_bilder(self.profile, self.model, katalog=katalog_vision(self.config.repo_root))
        d["provider_ziel"] = urlsplit(self.profile.base_url or "").hostname or ("" if self.profile.api_mode == "mock" else None)
        d["mcp"] = self.mcp.status() if self.mcp else {"verbunden": False, "aktiv": False, "werkzeuge": [], "hinweis": "kein MCP-Client"}
        return d
