"""114-01: app export of the component catalogue — `python -m harness.bauteilkatalog app-export`.

Covers: the app copy `packages/nova-core/src/lib/bauteil/katalog/katalog.json` is byte-identical with a fresh export (else the
test names the command that regenerates it), the head (elmonkey version, SHA-256 of the content), the fields per type and material,
base stock only (a runtime type of a project never lands in the export), the type GUID is the harness's `typ_guid` (own namespace,
not elmonkey's), the file is name-checked (`neutral.pruefe_text`) and LF/UTF-8, and the CLI writes the same bytes.

No IFC work here (ifcopenshell is not needed and not thread-safe anyway).
"""

from __future__ import annotations

import hashlib
import json

import pytest

pytest.importorskip("elmonkey.katalog", reason="Extra [katalog] installieren: pip install -e '.[dev,ifc,katalog]'")

from elmonkey.katalog import typ_guid as el_typ_guid  # noqa: E402

from harness import bauteilkatalog as bk  # noqa: E402
from harness.bauteilkatalog import app_export as ae  # noqa: E402
from harness.bauteilkatalog import neutral  # noqa: E402
from harness.bauteilkatalog.__main__ import main as cli  # noqa: E402

TYP_FELDER = {"schluessel", "version", "rohling", "klasse", "predefined_type", "kurzname", "langname", "dicke_m", "din276",
              "pset_common", "schichten", "typ_guid"}
BAUSTOFF_FELDER = {"schluessel", "name", "kurz", "werkstoffklasse", "farbe", "verschneidungsprioritaet", "kennwerte"}


@pytest.fixture(scope="module")
def k():
    return bk.katalog()


@pytest.fixture(scope="module")
def text(k):
    return ae.app_export_text(k)


def test_app_kopie_ist_bytegleich_mit_frischem_export(text):
    pfad = ae.app_katalog_pfad()
    assert pfad.is_file(), f"{pfad} fehlt — erzeugen mit: {ae.BEFEHL}"
    assert pfad.read_bytes() == text.encode("utf-8"), (
        f"{pfad.name} weicht vom frischen Export ab (von Hand geändert oder Katalog geändert) — neu erzeugen mit: {ae.BEFEHL}")


def test_kopf_version_und_inhalt_sha256(text):
    from importlib.metadata import version
    d = json.loads(text)
    assert d["quelle"] == f"elmonkey-core {version('elmonkey-core')}"
    kanonisch = json.dumps({"baustoffe": d["baustoffe"], "typen": d["typen"]}, ensure_ascii=False, sort_keys=True,
                           separators=(",", ":"))
    assert d["inhalt_sha256"] == hashlib.sha256(kanonisch.encode("utf-8")).hexdigest()
    assert ae.BEFEHL in d["hinweis"]


def test_format_lf_utf8_sortiert(text):
    assert "\r" not in text and text.endswith("}\n")
    d = json.loads(text)
    assert text == json.dumps(d, ensure_ascii=False, indent=1, sort_keys=True) + "\n"
    schl = [(t["schluessel"], t["version"]) for t in d["typen"]]
    assert schl == sorted(schl)
    assert [b["schluessel"] for b in d["baustoffe"]] == sorted(b["schluessel"] for b in d["baustoffe"])


def test_felder_je_typ_und_baustoff(text, k):
    d = json.loads(text)
    assert len(d["typen"]) == 42 and len(d["baustoffe"]) == 113
    stoffe = {b["schluessel"] for b in d["baustoffe"]}
    for t in d["typen"]:
        assert TYP_FELDER <= set(t), t["schluessel"]
        assert set(t) - TYP_FELDER <= {"oeffnung"}, t["schluessel"]
        assert ("oeffnung" in t) == (t["klasse"] in ("IfcDoor", "IfcWindow")), t["schluessel"]
        for s in t["schichten"]:
            assert set(s) <= {"baustoff", "dicke_m", "rolle", "staenderwerk"}
            assert s["baustoff"] in stoffe
        if t["schichten"]:
            assert t["dicke_m"] == pytest.approx(sum(s["dicke_m"] for s in t["schichten"]), abs=1e-4)
    for b in d["baustoffe"]:
        assert set(b) == BAUSTOFF_FELDER, b["schluessel"]
    ks = next(t for t in d["typen"] if t["schluessel"] == "ks-wdvs-42-cm")
    assert ks["dicke_m"] == 0.42 and len(ks["schichten"]) == 4 and ks["klasse"] == "IfcWall"


def test_typ_guid_aus_eigenem_namensraum(text, k):
    d = json.loads(text)
    guids = [t["typ_guid"] for t in d["typen"]]
    assert len(set(guids)) == len(guids)
    for t in d["typen"]:
        roh = k.typ(f"{t['schluessel']}@{t['version']}")
        assert t["typ_guid"] == bk.typ_guid(roh)
        assert t["typ_guid"] != el_typ_guid(roh), "GUID aus elmonkeys Namensraum statt unserem"
        assert len(t["typ_guid"]) == 22
    assert next(t for t in d["typen"] if t["schluessel"] == "ks-wdvs-42-cm")["typ_guid"] == "1XEVHbDKvIjAOSAuxNaIEz"


def test_nur_grundbestand_ohne_laufzeit_typen(tmp_path, text):
    erg = bk.bearbeiten(tmp_path, "ks-wdvs-42-cm", [{"op": "umbenennen", "kurzname": "KS Laufzeit"}],
                        autor="Test", zeit="2026-11-08T00:00:00Z")
    assert erg["neu"]
    mit_laufzeit = bk.katalog(tmp_path)
    assert any(t.get("ebene") == "laufzeit" for vs in mit_laufzeit.versionen.values() for t in vs.values())
    assert ae.app_export_text(mit_laufzeit) == text


def test_export_ist_neutral(tmp_path, k):
    p = ae.app_export(tmp_path / "katalog.json", k)
    assert neutral.pruefe_text(p) == []
    assert neutral.pruefe_text(ae.app_katalog_pfad()) == []


def test_export_mit_treffer_bricht_ab_und_hinterlaesst_nichts(tmp_path, k, monkeypatch):
    monkeypatch.setattr(ae.neutral, "pruefe_text", lambda p: ["x"])
    ziel = tmp_path / "katalog.json"
    with pytest.raises(neutral.NeutralitaetsFehler):
        ae.app_export(ziel, k)
    assert not ziel.exists()


def test_cli_schreibt_dieselben_bytes(tmp_path, text, capsys):
    ziel = tmp_path / "unter" / "katalog.json"
    assert cli(["app-export", str(ziel)]) == 0
    assert ziel.read_bytes() == text.encode("utf-8")
    assert json.loads(capsys.readouterr().out)["bytes"] == len(text.encode("utf-8"))
