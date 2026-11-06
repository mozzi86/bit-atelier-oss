"""Shared fixtures: an isolated workspace under tmp_path (never inside the repo —
the repo lives on Google Drive and sync locks break temp files)."""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from harness.config import HARNESS_DIR, HarnessConfig
from harness.runtime import Runtime
from harness.tools.builtin import registry  # noqa: F401  (registers all tools)
from harness.tools.registry import ToolContext

EXAMPLE = HARNESS_DIR / "examples" / "efh-satteldach"


#: Install line of the reference venv (all extras the offline suite needs).
INSTALLATION = "Installation: .venv\\Scripts\\python -m pip install -e \".[dev,ifc,katalog]\""


def pytest_configure(config):
    """H-1 (Review 67-03): without the [ifc] extra every IFC test skips
    silently and pytest still exits 0 — a green-looking suite that tested
    nothing. Make the hole LOUD: a terminal summary banner per missing extra
    (ifcopenshell for the IFC tests, elmonkey-core [katalog] for the component
    catalogue tests of 109-01)."""
    try:
        import ifcopenshell  # noqa: F401
    except ImportError:
        config.pluginmanager.register(
            _ExtraMissingReporter("IFC-TESTS ÜBERSPRUNGEN",
                                  "ifcopenshell fehlt — alle IFC-Tests wurden still übersprungen."),
            "ifc-missing-reporter")
    try:
        import elmonkey.katalog  # noqa: F401
    except ImportError:
        config.pluginmanager.register(
            _ExtraMissingReporter("KATALOG-TESTS ÜBERSPRUNGEN",
                                  "Extra [katalog] (elmonkey-core 0.3.0) fehlt — alle Bauteilkatalog-Tests "
                                  "wurden übersprungen."),
            "katalog-missing-reporter")


class _ExtraMissingReporter:
    """Terminal summary banner when an optional extra is absent (H-1)."""

    def __init__(self, titel: str, text: str) -> None:
        self.titel = titel
        self.text = text

    def pytest_terminal_summary(self, terminalreporter, exitstatus, config):
        terminalreporter.write_sep("!", self.titel)
        terminalreporter.write_line(self.text)
        terminalreporter.write_line(INSTALLATION)


@pytest.fixture
def workspace(tmp_path: Path) -> dict:
    projects = tmp_path / "projects"
    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "package.json").write_text('{"name": "fake-app"}', encoding="utf-8")
    shutil.copytree(EXAMPLE, projects / "efh-satteldach")
    skills = tmp_path / "skills"
    shutil.copytree(HARNESS_DIR / "skills", skills)
    return {"tmp": tmp_path, "projects": projects, "repo": repo, "skills": skills,
            "project_dir": projects / "efh-satteldach"}


def make_config(ws: dict, mode: str, **kw) -> HarnessConfig:
    return HarnessConfig(
        mode=mode, provider="mock", projects_dir=ws["projects"], project="efh-satteldach",
        repo_root=ws["repo"], logs_dir=ws["tmp"] / "logs",
        providers_file=HARNESS_DIR / "providers.example.yaml", **kw,
    )


def make_runtime(ws: dict, mode: str, **kw) -> Runtime:
    return Runtime.from_config(make_config(ws, mode, **kw), skills_dir=ws["skills"])


async def approve_yes(approval_id: str, befehl: str, erklaerung: str) -> bool:
    return True


async def approve_no(approval_id: str, befehl: str, erklaerung: str) -> bool:
    return False


def make_ctx(ws: dict, mode: str, approve=approve_no) -> ToolContext:
    return make_runtime(ws, mode).tool_context(approve)
