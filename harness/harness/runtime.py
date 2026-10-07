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

    @classmethod
    def from_config(cls, cfg: HarnessConfig, *, skills_dir: Path = SKILLS_DIR) -> "Runtime":
        providers = ProviderRegistry.load(cfg.providers_file)
        profile = providers.get(cfg.provider)
        model = cfg.model or profile.default_model or (profile.models[0] if profile.models else "")
        rt = cls(cfg, providers, cfg.provider, model, skills_dir=skills_dir)
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
            extra={"allowlist": self.config.shell_allowlist, "timeout_s": self.config.shell_timeout_s},
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

    def build_session(self) -> Session:
        s = Session(provider_name=self.provider_name, model=self.model, mode=self.config.mode,
                    project=self.project.slug if self.project else None)
        s.set_system_prompt(self.system_prompt())
        return s

    def status(self, session: Session) -> dict:
        d = session.status(self.profile, self.config.display_name)
        d["offene_aufgaben"] = len(self.project.open_tasks()) if self.project else 0
        d["skills"] = len(skills_index(self.skills, self.config.mode))
        return d
