"""GET /files (67-06): only model/*.ifc of the active project, sandbox-resolved."""

from fastapi.testclient import TestClient

from harness.server import create_app
from tests.conftest import make_runtime


def _client(workspace):
    rt = make_runtime(workspace, "user")
    model = workspace["project_dir"] / "model"
    model.mkdir(exist_ok=True)
    (model / "efh.ifc").write_text("ISO-10303-21;\nHEADER;ENDSEC;DATA;ENDSEC;END-ISO-10303-21;\n", encoding="utf-8")
    (model / "notiz.txt").write_text("nicht ausliefern", encoding="utf-8")
    (workspace["project_dir"] / "PROJECT.md")  # exists from the example
    return TestClient(create_app(rt))


def test_serves_model_ifc(workspace):
    c = _client(workspace)
    r = c.get("/files", params={"path": "model/efh.ifc"})
    assert r.status_code == 200 and r.text.startswith("ISO-10303-21")
    assert c.head("/files", params={"path": "model/efh.ifc"}).status_code == 200


def test_refuses_everything_else(workspace):
    c = _client(workspace)
    assert c.get("/files", params={"path": "model/notiz.txt"}).status_code == 403     # not .ifc
    assert c.get("/files", params={"path": "PROJECT.md"}).status_code == 403          # outside model/
    assert c.get("/files", params={"path": "../../repo/package.json"}).status_code == 403
    assert c.get("/files", params={"path": "model/../PROJECT.md"}).status_code == 403
    assert c.get("/files", params={"path": "model/fehlt.ifc"}).status_code == 403     # resolve(strict) → sandbox error
