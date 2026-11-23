"""Process-wide lock for every in-process ifcopenshell use (B-111-01-03).

Why: ifcopenshell is not thread-safe. Two IFC jobs in parallel worker threads corrupted its global state for the
rest of the process (found by the test suite on 08.11.: afterwards ifcopenshell.api calls failed with
AttributeError). One harness service serves several chat sessions, and each session may call an IFC tool at the
same time, so all IFC work of the process (ifc_run, the component catalogue tools, the FreeCAD round-trip check)
must take this ONE lock.

In:  a synchronous function that uses ifcopenshell, plus its arguments.
Out: its return value, computed in a worker thread while the lock is held. The event loop is never blocked:
     waiting for the lock happens in the worker thread, not on the loop.

FreeCAD itself runs as a separate process (fc_run subprocess / GUI bridge) and does not need the lock; only the
in-process ifcopenshell reads afterwards do.
"""

from __future__ import annotations

import asyncio
import threading
from typing import Any, Callable, TypeVar

T = TypeVar("T")

#: The one lock that serialises all ifcopenshell work of this process (held for the whole job, seconds to minutes).
IFC_SPERRE = threading.Lock()


async def im_ifc_thread(fn: Callable[..., T], *args: Any, **kwargs: Any) -> T:
    """Run `fn(*args, **kwargs)` in a worker thread while holding `IFC_SPERRE`.

    Args:
        fn: synchronous function that may use ifcopenshell.
        *args, **kwargs: passed through to `fn`.
    Returns:
        whatever `fn` returns; an exception of `fn` propagates after the lock is released.
    Side effects: blocks other IFC jobs of the process until `fn` returns (no timeout: an IFC job that hangs keeps
    the lock — the same behaviour the catalogue tools had since 109-02).
    """
    def gesperrt() -> T:
        with IFC_SPERRE:
            return fn(*args, **kwargs)
    return await asyncio.to_thread(gesperrt)
