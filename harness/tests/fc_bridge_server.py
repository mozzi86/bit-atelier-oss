"""Test helper, runs INSIDE freecadcmd: the real harness_bridge.FCMacro without Qt.

The GUI drives Bridge.poll() from a QTimer; freecadcmd has no event loop, so
this loop calls poll() itself. Everything else — transactions, undo, export —
is the macro's own code against a real FreeCAD document.

Env: HARNESS_BRIDGE_MACRO (macro path), HARNESS_BRIDGE_READY (file that gets
the port once listening), HARNESS_BRIDGE_DEADLINE_S (safety stop, default 120).
"""

import importlib.machinery
import importlib.util
import os
import time

os.environ["HARNESS_BRIDGE_NO_AUTOSTART"] = "1"
loader = importlib.machinery.SourceFileLoader("harness_bridge", os.environ["HARNESS_BRIDGE_MACRO"])
spec = importlib.util.spec_from_loader("harness_bridge", loader)
macro = importlib.util.module_from_spec(spec)
loader.exec_module(macro)

import FreeCAD  # noqa: E402

doc = FreeCAD.newDocument("Hybrid")
doc.UndoMode = 1
bridge = macro.Bridge(FreeCAD, port=0)
with open(os.environ["HARNESS_BRIDGE_READY"], "w", encoding="utf-8") as fh:
    fh.write(str(bridge.port))

ende = time.time() + float(os.environ.get("HARNESS_BRIDGE_DEADLINE_S") or 120)
while bridge.laeuft and time.time() < ende:
    bridge.poll()
    time.sleep(0.02)
bridge.close()
