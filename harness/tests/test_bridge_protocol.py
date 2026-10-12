"""Task 3 (67-04): GUI bridge — named steps, undo, reload, plain-text errors.

Two levels:
- always: the REAL macro (harness_bridge.FCMacro) with a fake FreeCAD
  document whose transactions behave like FreeCAD's (open/commit/abort/undo),
  polled from a thread, spoken to by the real harness tools over TCP;
- needs_freecad: the same macro inside freecadcmd against a real document
  (no Qt there, tests/fc_bridge_server.py drives poll()). The GUI path itself
  (QTimer, Ctrl+Z) is a manual check, see 67-04-SUMMARY.
"""

from __future__ import annotations

import asyncio
import importlib.machinery
import importlib.util
import json
import os
import socket
import subprocess
import threading
import time
from pathlib import Path

import pytest

from harness.config import HARNESS_DIR
from harness.tools import freecad as fct
from harness.tools.registry import ToolContext, registry

MACRO = HARNESS_DIR / "skills" / "freecad" / "macros" / "harness_bridge.FCMacro"


def _load_macro():
    os.environ["HARNESS_BRIDGE_NO_AUTOSTART"] = "1"
    loader = importlib.machinery.SourceFileLoader("harness_bridge_test", str(MACRO))
    spec = importlib.util.spec_from_loader("harness_bridge_test", loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


# --- fake FreeCAD ------------------------------------------------------------------

class FakeObj:
    def __init__(self, typ: str, name: str):
        self.TypeId, self.Name, self.Label = typ, name, name


class FakeDoc:
    """Transactions like FreeCAD: a step is one undo entry; abort restores."""

    def __init__(self):
        self.Label = "Hybrid"
        self.UndoMode = 1
        self.Objects: list[FakeObj] = []
        self._undo: list[tuple[str, list[FakeObj]]] = []
        self._offen: tuple[str, list[FakeObj]] | None = None
        self.recomputes = 0

    def addObject(self, typ, name):
        obj = FakeObj(typ, name)
        self.Objects.append(obj)
        return obj

    def openTransaction(self, name):
        self._offen = (name, list(self.Objects))

    def commitTransaction(self):
        self._undo.append(self._offen)
        self._offen = None

    def abortTransaction(self):
        self.Objects = self._offen[1]
        self._offen = None

    def undo(self):
        _, vorher = self._undo.pop()
        self.Objects = vorher

    @property
    def UndoCount(self):
        return len(self._undo)

    @property
    def UndoNames(self):
        return [n for n, _ in reversed(self._undo)]

    def recompute(self):
        self.recomputes += 1


class FakeApp:
    def __init__(self):
        self.ActiveDocument = FakeDoc()

    def Version(self):
        return ["1", "1", "1", "fake"]

    def newDocument(self, name):
        self.ActiveDocument = FakeDoc()
        return self.ActiveDocument


@pytest.fixture
def fake_bridge():
    macro = _load_macro()
    app = FakeApp()
    bridge = macro.Bridge(app, port=0)
    stop = threading.Event()

    def loop():
        while not stop.is_set() and bridge.laeuft:
            bridge.poll()
            time.sleep(0.005)
    t = threading.Thread(target=loop, daemon=True)
    t.start()
    fct.SCHRITTE.clear()
    yield bridge, app
    stop.set()
    t.join(2)
    bridge.close()


def _ctx(port: int, mode: str = "developer", project_dir: Path | None = None) -> ToolContext:
    return ToolContext(mode=mode, projekt="test", sandbox_roots=[project_dir] if project_dir else [],
                       project_dir=project_dir, extra={"freecad_port": port})


def _call(name: str, args: dict, ctx: ToolContext) -> dict:
    return json.loads(asyncio.run(registry.dispatch(name, args, ctx)))


def _freier_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


# --- always ------------------------------------------------------------------------

def test_step_benannt_und_im_log(fake_bridge):
    bridge, app = fake_bridge
    out = _call("freecad_step", {"name": "Wand Nord",
                                 "code": "doc.addObject('Part::Feature', 'WandNord')"}, _ctx(bridge.port))
    assert out["schritt"] == "Wand Nord"
    assert [o.Name for o in app.ActiveDocument.Objects] == ["WandNord"]
    assert app.ActiveDocument.UndoNames == ["Wand Nord"]
    assert fct.SCHRITTE[-1] == {"name": "Wand Nord", "op": "run", "ok": True}


def test_undo_nimmt_genau_den_schritt_zurueck(fake_bridge):
    bridge, app = fake_bridge
    ctx = _ctx(bridge.port)
    _call("freecad_step", {"name": "Wand Nord", "code": "doc.addObject('X', 'A')"}, ctx)
    _call("freecad_step", {"name": "Wand Süd", "code": "doc.addObject('X', 'B')"}, ctx)
    out = _call("freecad_undo", {}, ctx)
    assert out == {"rueckgaengig": "Wand Süd"}
    assert [o.Name for o in app.ActiveDocument.Objects] == ["A"]
    assert _call("freecad_undo", {}, ctx) == {"rueckgaengig": "Wand Nord"}
    assert "Nichts rückgängig" in _call("freecad_undo", {}, ctx)["error"]


def test_fehlerhafter_schritt_wird_verworfen(fake_bridge):
    bridge, app = fake_bridge
    ctx = _ctx(bridge.port)
    out = _call("freecad_step", {"name": "Kaputt",
                                 "code": "doc.addObject('X', 'halb')\nraise ValueError('Wand zu kurz')"}, ctx)
    assert "Wand zu kurz" in out["error"]
    assert "Schritt verworfen" in out["error"]
    assert app.ActiveDocument.Objects == []
    assert app.ActiveDocument.UndoCount == 0
    assert fct.SCHRITTE[-1]["ok"] is False


def test_user_modus_kein_freies_python(fake_bridge):
    bridge, app = fake_bridge
    out = _call("freecad_step", {"name": "X", "code": "import os"}, _ctx(bridge.port, mode="user"))
    assert "nur im developer-Modus" in out["error"]
    assert app.ActiveDocument.Objects == []


def test_step_ohne_namen_abgelehnt(fake_bridge):
    bridge, _ = fake_bridge
    assert "Schrittnamen" in _call("freecad_step", {"name": " ", "code": "x=1"}, _ctx(bridge.port))["error"]


def test_status_und_reload(fake_bridge):
    bridge, _ = fake_bridge
    ctx = _ctx(bridge.port)
    status = _call("freecad_status", {}, ctx)
    assert status["verbunden"] is True and status["freecad"] == "1.1.1"
    _call("freecad_step", {"name": "Wand Ost", "code": "doc.addObject('X', 'Ost')"}, ctx)
    stand = _call("freecad_reload", {}, ctx)
    assert [o["name"] for o in stand["objekte"]] == ["Ost"]
    assert stand["rueckgaengig_liste"] == ["Wand Ost"]
    assert stand["schritte_harness"][-1]["name"] == "Wand Ost"


def test_unbekannte_op_und_kaputte_zeile(fake_bridge):
    bridge, _ = fake_bridge
    antwort = fct.bridge_anfrage({"op": "zaubern"}, bridge.port)
    assert antwort["ok"] is False and "unbekannte op" in antwort["error"]
    with socket.create_connection(("127.0.0.1", bridge.port), timeout=5) as s:
        s.sendall(b"kein json\n")
        assert json.loads(s.recv(65536).split(b"\n")[0])["ok"] is False


def test_verbindung_verweigert_klartext_ohne_traceback():
    port = _freier_port()
    ctx = _ctx(port)
    for tool, args in (("freecad_step", {"name": "Wand Nord", "code": "x=1"}),
                       ("freecad_undo", {}), ("freecad_reload", {})):
        out = _call(tool, args, ctx)
        assert "FreeCAD-GUI mit Bridge-Makro nicht erreichbar" in out["error"]
        assert "--headless" in out["error"]
        assert "Traceback" not in out["error"]
    status = _call("freecad_status", {}, ctx)
    assert status["verbunden"] is False and "Bridge-Makro" in status["hinweis"]


def test_timeout_klartext():
    # a server that accepts and never answers
    srv = socket.socket()
    srv.bind(("127.0.0.1", 0))
    srv.listen(1)
    try:
        antwort = fct.bridge_anfrage({"op": "ping"}, srv.getsockname()[1], timeout=0.3)
    finally:
        srv.close()
    assert antwort["ok"] is False and "nicht geantwortet" in antwort["error"]


def test_bridge_nur_localhost():
    macro = _load_macro()
    with pytest.raises(ValueError, match="127.0.0.1"):
        macro.Bridge(FakeApp(), port=0, host="0.0.0.0")


def test_bridge_tools_in_beiden_modi():
    for name in ("freecad_status", "freecad_step", "freecad_undo", "freecad_reload"):
        assert name in registry.names("user") and name in registry.names("developer")


# --- real FreeCAD (headless, macro code against a real document) ------------------

FREECADCMD = None if os.environ.get("HARNESS_TEST_OHNE_FREECAD") else fct._fc_run().finde_freecadcmd()

KLEINES_HAUS = {"geschosse": [{"name": "EG", "hoehe_m": 3.0, "decke": {"dicke_m": 0.25},
                               "wandzuege": [{"punkte": [[0, 0], [6, 0], [6, 5], [0, 5]],
                                              "geschlossen": True, "dicke_m": 0.3, "aussen": True}],
                               "oeffnungen": [{"wand": 1, "typ": "tuer", "abstand_m": 2.0,
                                               "breite_m": 1.0, "hoehe_m": 2.1}]}]}


@pytest.fixture
def echte_bridge(tmp_path):
    if FREECADCMD is None:
        pytest.skip("freecadcmd nicht gefunden (config freecad.cmd)")
    ready = tmp_path / "port.txt"
    env = {**os.environ, "HARNESS_BRIDGE_MACRO": str(MACRO), "HARNESS_BRIDGE_READY": str(ready),
           "HARNESS_BRIDGE_DEADLINE_S": "150"}
    proc = subprocess.Popen([str(FREECADCMD), str(Path(__file__).with_name("fc_bridge_server.py"))],
                            cwd=tmp_path, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    ende = time.time() + 90
    while not (ready.is_file() and ready.read_text().strip()) and time.time() < ende:
        if proc.poll() is not None:
            pytest.fail("freecadcmd beendet: " + proc.stdout.read().decode("utf-8", "replace")[-2000:])
        time.sleep(0.2)
    port = int(ready.read_text().strip())
    fct.SCHRITTE.clear()
    yield port
    try:
        fct.bridge_anfrage({"op": "stop"}, port, timeout=5)
    except fct.BridgeNichtErreichbar:
        pass
    try:
        proc.wait(20)
    except subprocess.TimeoutExpired:
        proc.kill()


def test_echtes_freecad_schritte_undo_reload(echte_bridge, workspace):
    port = echte_bridge
    project = workspace["project_dir"]
    dev = _ctx(port, "developer", project)
    user = _ctx(port, "user", project)

    status = _call("freecad_status", {}, dev)
    assert status["verbunden"] is True and status["freecad"].startswith("1.")

    code = ("import Arch, Part, FreeCAD\n"
            "achse = doc.addObject('Part::Feature', 'Achse')\n"
            "achse.Shape = Part.makePolygon([FreeCAD.Vector(0, 8000, 0), FreeCAD.Vector(10000, 8000, 0)])\n"
            "w = Arch.makeWall(achse, width=300, height=2800, align='Center', name='Wand Nord')\n"
            "w.Label = 'Wand Nord'\n"
            "ergebnis = w.Name\n")
    out = _call("freecad_step", {"name": "Wand Nord", "code": code}, dev)
    assert "error" not in out, out.get("error")
    out = _call("freecad_step", {"name": "Haus EG", "beschreibung": KLEINES_HAUS}, user)
    assert "error" not in out, out.get("error")
    assert out["ergebnis"]["zaehlung"]["IfcWall"] == 4

    stand = _call("freecad_reload", {}, dev)
    labels = [o["label"] for o in stand["objekte"]]
    assert "Wand Nord" in labels and "Wand EG 01" in labels
    assert stand["rueckgaengig_liste"][:2] == ["Haus EG", "Wand Nord"]

    assert _call("freecad_undo", {}, dev) == {"rueckgaengig": "Haus EG"}
    labels = [o["label"] for o in _call("freecad_reload", {}, dev)["objekte"]]
    assert "Wand Nord" in labels and "Wand EG 01" not in labels

    # export of the current state: one wall from the first step
    out = _call("freecad_reload", {"export": True, "name": "hybrid"}, dev)
    assert "error" not in out, out.get("error")
    assert out["ifc"] == "model/hybrid_v1.ifc"
    ifc = project / "model" / "hybrid_v1.ifc"
    assert ifc.is_file()
    pytest.importorskip("ifcopenshell")
    import ifcopenshell

    model = ifcopenshell.open(str(ifc))
    assert [w.Name for w in model.by_type("IfcWall")] == ["Wand Nord"]
    # a wall the harness did not build still gets quantities (meta_auto)
    import ifcopenshell.util.element

    wand = model.by_type("IfcWall")[0]
    qto = ifcopenshell.util.element.get_psets(wand, qtos_only=True)["Qto_WallBaseQuantities"]
    assert qto["NetVolume"] == pytest.approx(10.0 * 0.3 * 2.8, abs=1e-3)
    assert wand.PredefinedType == "STANDARD"

    # a failing step leaves the document unchanged
    vorher = len(_call("freecad_reload", {}, dev)["objekte"])
    out = _call("freecad_step", {"name": "Kaputt", "code": "doc.addObject('Part::Feature', 'Rest')\n1/0"}, dev)
    assert "ZeroDivisionError" in out["error"]
    assert len(_call("freecad_reload", {}, dev)["objekte"]) == vorher
