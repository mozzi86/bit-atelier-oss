"""B-111-01-03: one process-wide lock serialises every in-process ifcopenshell use.

ifcopenshell is not thread-safe (two IFC jobs in parallel worker threads corrupted its global state for the rest of
the process, 08.11.). The component catalogue tools already serialised their work; `ifc_run` ran its scripts in a
bare `asyncio.to_thread`, so two chat sessions of one harness service could read/write IFC at the same time.

The tests replace the real IFC work by a probe that counts how many calls are inside at once (no ifcopenshell call
is needed for that; the real scripts are covered by test_ifc_scripts.py). They drive the async handlers with
`asyncio.run` so they do not depend on pytest-asyncio.
"""

from __future__ import annotations

import asyncio
import json
import threading
import time

import pytest

pytest.importorskip("ifcopenshell", reason="Extra [ifc] installieren: pip install -e '.[dev,ifc,katalog]'")

from conftest import make_ctx  # noqa: E402

from harness.tools import ifc as ifc_tool  # noqa: E402

#: Time one probe call stays "inside" the IFC work, in seconds — long enough that two unserialised calls overlap.
HALTEZEIT_S = 0.2


class _Sonde:
    """Counts concurrent entries into the (replaced) IFC work; `hoechstens` = peak concurrency."""

    def __init__(self) -> None:
        self._zaehler = threading.Lock()
        self.drin = 0
        self.hoechstens = 0

    def arbeit(self, *_args, **_kwargs) -> dict:
        with self._zaehler:
            self.drin += 1
            self.hoechstens = max(self.hoechstens, self.drin)
        time.sleep(HALTEZEIT_S)
        with self._zaehler:
            self.drin -= 1
        return {"markdown": "", "json": {}, "hinweis": ""}


def test_zwei_parallele_ifc_run_aufrufe_laufen_nacheinander(workspace, monkeypatch):
    """Two concurrent ifc_run calls (two sessions of one service) never run IFC work at the same time."""
    sonde = _Sonde()
    monkeypatch.setattr(ifc_tool, "_run_sync", sonde.arbeit)
    ctx = make_ctx(workspace, "user")

    async def beide():
        return await asyncio.gather(
            ifc_tool.ifc_run({"unterbefehl": "liste"}, ctx),
            ifc_tool.ifc_run({"unterbefehl": "klassen"}, ctx),
        )

    ergebnisse = asyncio.run(beide())
    assert all("error" not in json.loads(e) for e in ergebnisse), ergebnisse
    assert sonde.hoechstens == 1, f"{sonde.hoechstens} IFC-Arbeiten liefen gleichzeitig"


def test_ifc_run_und_bauteilkatalog_teilen_eine_sperre(workspace, monkeypatch):
    """ifc_run and the catalogue tools hold the SAME lock: an ifc_run never overlaps a catalogue build."""
    from harness.tools import bauteilkatalog as katalog_tool

    sonde = _Sonde()
    monkeypatch.setattr(ifc_tool, "_run_sync", sonde.arbeit)
    ctx = make_ctx(workspace, "user")

    async def beide():
        return await asyncio.gather(
            ifc_tool.ifc_run({"unterbefehl": "liste"}, ctx),
            katalog_tool._im_thread(sonde.arbeit),
        )

    asyncio.run(beide())
    assert sonde.hoechstens == 1, f"{sonde.hoechstens} IFC-Arbeiten liefen gleichzeitig"


def test_sperre_haelt_die_ereignisschleife_frei(workspace, monkeypatch):
    """Waiting for the lock happens in the worker thread: the event loop keeps serving other work meanwhile."""
    sonde = _Sonde()
    monkeypatch.setattr(ifc_tool, "_run_sync", sonde.arbeit)
    ctx = make_ctx(workspace, "user")
    ticks: list[float] = []

    async def ticker():
        for _ in range(5):
            ticks.append(time.monotonic())
            await asyncio.sleep(0.02)

    async def alles():
        await asyncio.gather(
            ifc_tool.ifc_run({"unterbefehl": "liste"}, ctx),
            ifc_tool.ifc_run({"unterbefehl": "liste"}, ctx),
            ticker(),
        )

    start = time.monotonic()
    asyncio.run(alles())
    # All five ticks happen while the two serialised calls (≈ 2 × HALTEZEIT_S) are still running.
    assert len(ticks) == 5
    assert ticks[-1] - start < 2 * HALTEZEIT_S
