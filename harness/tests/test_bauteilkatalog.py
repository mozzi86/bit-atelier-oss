"""109-01: component catalogue in the harness — neutral data, builder elmonkey-core 0.3.0, IFC output.

Covers: loading/validating the neutral base stock, stable names/fingerprint/type GUID, layered and stud
wall build plans, reinforcement placement, editing → runtime type in the project folder (base stock
unchanged), material/type library and sample project in IFC4 + IFC4X3 with WHERE rules against the
reference counts (113 materials, 42 types, 0 proxies, every element typed), the stud-wall-as-layers
option, the counter-check (USERDEFINED without ElementType), the post-processing (origin properties,
texture URNs, emptied type property sets), our own GlobalId namespace (no GUID shared with elmonkey's
namespace, runtime versions unique across projects) and the neutrality of every file of the catalogue
package and of the example IFCs.

Skips only when the [katalog] extra (or ifcopenshell) is missing — the reference venv has both, and
tests/conftest.py prints a loud "KATALOG-TESTS ÜBERSPRUNGEN" banner when the extra is absent (H-1).
"""

from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path

import pytest

pytest.importorskip("elmonkey.katalog", reason="Extra [katalog] installieren: pip install -e '.[dev,ifc,katalog]'")
pytest.importorskip("ifcopenshell", reason="Extra [ifc] installieren: pip install -e '.[dev,ifc,katalog]'")

import ifcopenshell.util.element as ue  # noqa: E402
import ifcopenshell.api  # noqa: E402
from elmonkey.katalog import KatalogFehler, benennen, fingerabdruck  # noqa: E402
from elmonkey.katalog import typ_guid as el_typ_guid  # noqa: E402
from elmonkey.katalog import ifc as eifc  # noqa: E402

from harness import bauteilkatalog as bk  # noqa: E402
from harness.bauteilkatalog import neutral  # noqa: E402
from harness.bauteilkatalog.__main__ import main as cli  # noqa: E402
from harness.config import HARNESS_DIR  # noqa: E402

PAKET = HARNESS_DIR / "harness" / "bauteilkatalog"
BEISPIELE = HARNESS_DIR / "examples" / "bauteilkatalog"
SCHEMEN = ["IFC4", "IFC4X3"]
GRIFF = [{"art": "stuetzklappgriff-din18040", "abstand_m": 0.95, "hoehe_m": 0.85}]

#: Counters of the reference sample (D-BKAT-02, reference check report) — the neutral sample must match.
REFERENZ_ZAEHLER = {
    "IfcMaterial": 15, "IfcWallType": 3, "IfcWall": 3, "IfcWindowType": 1, "IfcOpeningElement": 2, "IfcWindow": 1,
    "IfcDoorType": 1, "IfcDoor": 1, "IfcPlate": 4, "IfcMember": 9, "IfcBuildingElementPart": 7, "IfcSlabType": 1,
    "IfcSlab": 1, "IfcCoveringType": 1, "IfcCovering": 1,
}


@pytest.fixture(scope="module")
def k():
    return bk.katalog()


def _sha(ordner: Path) -> dict[str, str]:
    return {str(p.relative_to(ordner)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(ordner.rglob("*.json"))}


# ── data

def test_neutraler_bestand_laedt_und_besteht_die_pruefung(k):
    assert len(k.baustoffe) == 113
    assert len(k.typen) == 42
    assert sum(1 for t in k.typen.values() if t.get("rohling")) == 4
    assert all(t["ebene"] == "grundbestand" for t in k.typen.values())
    # profiles and reinforcements come from the builder's package data (identical values, no copy here)
    assert not (bk.DATEN / "profile.json").exists() and not (bk.DATEN / "verstaerkungen.json").exists()
    assert {"CW50", "CW75", "CW100", "UW75"} <= set(k.profile)
    assert "stuetzklappgriff-din18040" in k.verstaerkungen
    for t in k.typen.values():
        assert t["ifc"]["klasse"] and t["ifc"]["predefined_type"]


def test_daten_ohne_herkunft_und_fremdfelder():
    def schluessel(o, aus):
        if isinstance(o, dict):
            for a, v in o.items():
                aus.add(a)
                schluessel(v, aus)
        elif isinstance(o, list):
            for x in o:
                schluessel(x, aus)
        return aus

    for p in sorted(bk.DATEN.rglob("*.json")):
        d = json.loads(p.read_text(encoding="utf-8"))
        felder = schluessel(d, set())
        assert "herkunft" not in felder, p.name
        assert not [f for f in felder if neutral.treffer(f, neutral.GESPERRT_DATEN)], p.name
    for t in json.loads((bk.DATEN / "typen" / "grundbestand.json").read_text(encoding="utf-8"))["typen"]:
        assert set(t.get("klassifizierung") or {}) <= {"din276", "bsdd_klasse"}


def test_referenzielle_integritaet(k):
    for t in k.typen.values():
        for s in t.get("schichten") or []:
            assert s["baustoff"] in k.baustoffe
            if s.get("staenderwerk"):
                assert s["staenderwerk"]["profil"] in k.profile
        for teil in ("zarge", "blatt", "fluegel", "verglasung"):
            if isinstance(t.get(teil), dict) and t[teil].get("baustoff"):
                assert t[teil]["baustoff"] in k.baustoffe
    for p in k.profile.values():
        assert p["baustoff"] in k.baustoffe
    for v in k.verstaerkungen.values():
        assert v["baustoff"] in k.baustoffe


def test_namen_fingerabdruck_und_typ_guid_stabil(k):
    t = benennen(k.typ("ks-wdvs-42-cm"), k)
    assert t["kurzname"] == "KS + WDVS 42 cm"
    assert t["langname"].endswith("| 420 mm")
    # fixed values: a changed GUID would break every exported model that references the type.
    # Own uuid5 namespace (109-RESEARCH) — never the builder's built-in namespace.
    assert bk.typ_guid(t) == "1XEVHbDKvIjAOSAuxNaIEz"
    assert bk.typ_guid(k.typ("gk-2-lagen-12-5-cm")) == "3OB2OZBw1QMhkp41jnUC0x"
    assert bk.typ_guid(t) != el_typ_guid(t)
    assert fingerabdruck(t) == fingerabdruck(copy.deepcopy(k.typ("ks-wdvs-42-cm"))) == "9afd7f894c204e4b"
    g = benennen(k.typ("gk-2-lagen-12-5-cm"), k)
    assert "(CW75 e=62,5 cm)" in g["langname"]


# ── build plans

def test_schichtwand_bauplan(k):
    p = bk.wand("ks-wdvs-42-cm", 5.0, 2.75, k=k)
    assert p.art == "schichten" and len(p.koerper) == 1
    assert p.dicke == pytest.approx(0.42)
    assert p.koerper[0].x == (0.0, 5.0) and p.koerper[0].z == (0.0, 2.75)


def test_staenderwand_bauplan_wie_referenz(k):
    p = bk.wand("gk-2-lagen-12-5-cm", 2.94, 2.75, GRIFF, k=k)
    assert p.art == "teile"
    assert p.zusammenfassung()["teile"] == {"IfcPlate SHEET": 4, "IfcMember PLATE": 2, "IfcMember STUD": 6,
                                            "IfcBuildingElementPart INSULATION": 7, "IfcMember Wandverstärkung": 1}
    assert p.hinweise == []


def test_verstaerkungslage(k):
    p = bk.wand("gk-2-lagen-12-5-cm", 2.94, 2.75, GRIFF, k=k)
    v = next(x for x in p.koerper if x.object_type == "Wandverstärkung")
    # inner side: the reinforcement sits against the inner face of the stud layer, centred at 0.95 / 0.85 m
    assert (v.x[0] + v.x[1]) / 2 == pytest.approx(0.95)
    assert (v.z[0] + v.z[1]) / 2 == pytest.approx(0.85)
    stud = next(s for s in p.koerper if s.predefined_type == "STUD")
    assert v.y[1] >= stud.y[1]
    with pytest.raises(KatalogFehler, match="Ständer"):
        bk.wand("gk-2-lagen-12-5-cm", 2.94, 2.75, [{**GRIFF[0], "abstand_m": 0.625}], k=k)
    with pytest.raises(KatalogFehler, match="unbekannt"):
        bk.wand("gk-2-lagen-12-5-cm", 2.94, 2.75, [{"art": "gibt-es-nicht", "abstand_m": 0.95}], k=k)
    with pytest.raises(KatalogFehler, match="Ständerwänden"):
        bk.wand("ks-wdvs-42-cm", 5.0, 2.75, GRIFF, k=k)


def test_staenderwand_als_schichten_bauplan(k):
    p = bk.wand("gk-2-lagen-12-5-cm", 2.94, 2.75, GRIFF, "schichten", k=k)
    assert p.art == "schichten" and len(p.koerper) == 1
    assert p.staenderwerk["Staender"] == 6 and p.staenderwerk["UW"] == 2


# ── editing → runtime types in the project folder

def test_bearbeiten_speichert_laufzeit_typ_im_projekt(tmp_path):
    vorher = _sha(bk.DATEN)
    erg = bk.bearbeiten(tmp_path, "ks-wdvs-42-cm", [{"op": "schicht_aendern", "position": 2, "dicke_m": 0.2}],
                        autor="test", zeit="2026-11-05T12:00:00")
    assert erg["neu"] and erg["grund"] == "neuer Typ aus dem Grundbestand"
    t = erg["typ"]
    assert t["schluessel"].startswith("ks-wdvs-42-cm-") and t["basiert_auf"] == "ks-wdvs-42-cm@1"
    assert erg["datei"] == tmp_path / "bauteilkatalog" / "typen" / f"{t['schluessel']}.json"
    gespeichert = json.loads(erg["datei"].read_text(encoding="utf-8"))["typen"]
    assert len(gespeichert) == 1 and "kurzname" not in gespeichert[0]

    k2 = bk.katalog(tmp_path)
    assert len(k2.typen) == 43 and k2.typ(t["schluessel"])["ebene"] == "laufzeit"
    assert benennen(k2.typ(t["schluessel"]), k2)["kurzname"] == "KS 24 + XPS 20 – 46 cm"
    assert len(bk.katalog().typen) == 42                       # without project: base stock only
    # a runtime type is buildable by name when the project folder is given
    assert bk.wand(t["schluessel"], 5.0, 2.75, projekt_ordner=tmp_path).dicke == pytest.approx(0.46)

    # editing the runtime type again → version 2 in the same file, version 1 stays loadable
    erg2 = bk.bearbeiten(tmp_path, t["schluessel"], [{"op": "schicht_aendern", "position": 1, "dicke_m": 0.015}])
    assert erg2["neu"] and erg2["typ"]["version"] == 2 and erg2["datei"] == erg["datei"]
    k3 = bk.katalog(tmp_path)
    assert k3.typ(f"{t['schluessel']}@1")["schichten"][0]["dicke_m"] == 0.01
    assert k3.typ(t["schluessel"])["version"] == 2

    # no change → nothing new, nothing written; same build-up as an existing type → that type (E3)
    erg3 = bk.bearbeiten(tmp_path, "ks-wdvs-42-cm", [{"op": "schicht_aendern", "position": 2, "dicke_m": 0.16}])
    assert not erg3["neu"] and "datei" not in erg3
    assert len(list((tmp_path / "bauteilkatalog" / "typen").glob("*.json"))) == 1
    assert not list((tmp_path / "bauteilkatalog" / "typen").glob("*.tmp"))   # atomic write leaves no rest
    assert _sha(bk.DATEN) == vorher                              # base stock unchanged


def test_laufzeit_versionen_projektuebergreifend_eindeutig(tmp_path):
    # Runtime versions are counted per project: the same key@version may name two different build-ups
    # in two projects. Their IFC type GUIDs must differ; the same build-up must keep the same GUID.
    a, b = tmp_path / "a", tmp_path / "b"
    op1 = [{"op": "schicht_aendern", "position": 2, "dicke_m": 0.2}]
    ta = bk.bearbeiten(a, "ks-wdvs-42-cm", op1, zeit="2026-11-05T10:00:00")["typ"]
    tb = bk.bearbeiten(b, "ks-wdvs-42-cm", op1, zeit="2026-11-05T11:00:00")["typ"]
    assert ta["schluessel"] == tb["schluessel"] and bk.typ_guid(ta) == bk.typ_guid(tb)
    va = bk.bearbeiten(a, ta["schluessel"], [{"op": "schicht_aendern", "position": 1, "dicke_m": 0.015}])["typ"]
    vb = bk.bearbeiten(b, tb["schluessel"], [{"op": "schicht_aendern", "position": 1, "dicke_m": 0.02}])["typ"]
    assert (va["schluessel"], va["version"]) == (vb["schluessel"], vb["version"]) == (ta["schluessel"], 2)
    assert el_typ_guid(va) == el_typ_guid(vb)                    # the builder alone would collide
    assert bk.typ_guid(va) != bk.typ_guid(vb)
    fa = bk.typbibliothek("IFC4", projekt_ordner=a)
    fb = bk.typbibliothek("IFC4", projekt_ordner=b)
    assert fa.by_guid(bk.typ_guid(va)).is_a("IfcWallType") and fb.by_guid(bk.typ_guid(vb)).is_a("IfcWallType")
    # every GlobalId tied to the differing version differs too (type, its relations and property sets)
    def an_typ(f, guid):
        tt = f.by_guid(guid)
        rels = [r for r in f.get_inverse(tt) if r.is_a("IfcRelationship") and not r.is_a("IfcRelDeclares")]
        return {tt.GlobalId} | {r.GlobalId for r in rels} | {p.GlobalId for p in tt.HasPropertySets or ()}
    assert not an_typ(fa, bk.typ_guid(va)) & an_typ(fb, bk.typ_guid(vb))
    # base stock types keep their GUID in both projects
    g = bk.typ_guid(bk.katalog().typ("gk-2-lagen-12-5-cm"))
    assert fa.by_guid(g).Name == fb.by_guid(g).Name


def test_speichern_lehnt_grundbestand_und_unsichere_schluessel_ab(tmp_path, k):
    with pytest.raises(ValueError, match="Grundbestand"):
        bk.speichern(tmp_path, k.typ("ks-wdvs-42-cm"))
    with pytest.raises(ValueError, match="Dateiname"):
        bk.speichern(tmp_path, {"schluessel": "../x", "ebene": "laufzeit"})


def test_laufzeit_datei_falsches_format(tmp_path):
    d = tmp_path / "bauteilkatalog" / "typen"
    d.mkdir(parents=True)
    (d / "kaputt.json").write_text("[1, 2]", encoding="utf-8")
    with pytest.raises(ValueError, match="kaputt.json"):
        bk.katalog(tmp_path)
    # an existing malformed file of the same key: speichern reports it instead of crashing
    (d / "x-1.json").write_text("[1]", encoding="utf-8")
    with pytest.raises(ValueError, match="x-1.json"):
        bk.speichern(tmp_path, {"schluessel": "x-1", "ebene": "laufzeit", "version": 1})
    (d / "kaputt.json").write_text('{"typen": [{"version": 1}]}', encoding="utf-8")
    with pytest.raises(ValueError, match=r"kaputt\.json: Eintrag 1 ohne"):
        bk.laufzeit_typen(tmp_path)


# ── IFC (cached per schema — the WHERE-rule check is the slow part)

_CACHE: dict[tuple[str, str], object] = {}


def _datei(art: str, schema: str, k):
    key = (art, schema)
    if key not in _CACHE:
        if art == "material":
            _CACHE[key] = bk.materialbibliothek(schema, k)
        elif art == "typen":
            _CACHE[key] = bk.typbibliothek(schema, k)
        else:
            _CACHE[key] = bk.muster_projekt(schema, art, k)
    return _CACHE[key]


@pytest.mark.parametrize("schema", SCHEMEN)
def test_materialbibliothek(schema, k):
    f = _datei("material", schema, k)
    b = bk.pruefen(f)
    assert b["gueltig"] and b["anzahl_fehler"] == 0 and b["mit_regeln"], b["fehler"]
    assert b["materialien"] == 113 and b["typen"] == 0 and b["proxys"] == 0 and b["neutral"]
    assert f.by_type("IfcProject")[0].Name == bk.NAME_MATERIALBIBLIOTHEK
    assert f.by_type("IfcProjectLibrary")[0].Name == bk.NAME_MATERIALBIBLIOTHEK
    assert f.schema_identifier == ("IFC4" if schema == "IFC4" else "IFC4X3_ADD2")
    m = f.by_type("IfcMaterial")[0]
    psets = ue.get_psets(m)
    assert "Pset_BIT_Material" in psets and not [p for p in psets if p.startswith("Pset_Katalog")]
    assert not [n for n in psets["Pset_BIT_Material"] if neutral.treffer(n, neutral.GESPERRT_DATEN)]
    # no third-party URL: every texture reference is our URN (109-RESEARCH "ohne Fremd-URL")
    urls = [t.URLReference for t in f.by_type("IfcImageTexture")]
    assert len(urls) == 97 and all(u.startswith(bk.TEXTUR_URL) for u in urls)
    assert sum(u.startswith(bk.TEXTUR_URL + "ambientcg/") for u in urls) == 95
    assert sum(u.startswith(bk.TEXTUR_URL + "klasse/") for u in urls) == 2


@pytest.mark.parametrize("schema", SCHEMEN)
def test_typbibliothek(schema, k):
    f = _datei("typen", schema, k)
    b = bk.pruefen(f)
    assert b["gueltig"] and b["anzahl_fehler"] == 0, b["fehler"]
    assert b["materialien"] == 113 and b["typen"] == 42 and b["proxys"] == 0 and b["neutral"]
    assert b["klassifizierungen"] == ["DIN 276 Kosten im Bauwesen", "bSDD IFC 4.3"]
    lib = f.by_type("IfcProjectLibrary")[0]
    assert lib.Name == bk.NAME_TYPBIBLIOTHEK
    deklariert = [o for r in lib.Declares for o in r.RelatedDefinitions]
    assert len(deklariert) == 42
    wt = f.by_guid("1XEVHbDKvIjAOSAuxNaIEz")
    assert wt.is_a("IfcWallType") and "Pset_BIT_Katalog" in ue.get_psets(wt)
    assert wt.GlobalId == bk.typ_guid(k.typ("ks-wdvs-42-cm"))


@pytest.mark.parametrize("schema", SCHEMEN)
def test_muster_projekt_wie_referenz(schema, k):
    f, info = _datei("teile", schema, k)
    b = bk.pruefen(f)
    assert b["gueltig"] and b["anzahl_fehler"] == 0, b["fehler"]
    assert b["proxys"] == 0 and b["ohne_typ"] == [] and b["neutral"]
    assert b["materialien"] == 15 and b["typen"] == 7
    assert info["zaehler"] == REFERENZ_ZAEHLER
    assert f.by_type("IfcProject")[0].Name == bk.NAME_MUSTER
    gk = next(w for w in f.by_type("IfcWall") if w.Name.startswith("GK"))
    assert [r.RepresentationIdentifier for r in gk.Representation.Representations] == ["Axis"]
    teile = gk.IsDecomposedBy[0].RelatedObjects
    assert any(t.is_a("IfcMember") and t.ObjectType == "Wandverstärkung" for t in teile)
    # parts of the stud wall carry no own type — every other element does
    for e in f.by_type("IfcElement"):
        if e.is_a("IfcFeatureElement") or e in teile:
            continue
        assert e.IsTypedBy, e.Name
    usages = {(u.LayerSetDirection, u.DirectionSense) for u in f.by_type("IfcMaterialLayerSetUsage")}
    assert ("AXIS2", "POSITIVE") in usages and ("AXIS3", "NEGATIVE") in usages
    assert info["nachlauf"]["eigenschaften_entfernt"] == 15
    assert info["nachlauf"]["globalids_umgeschluesselt"] == len(f.by_type("IfcRoot"))


@pytest.mark.parametrize("schema", SCHEMEN)
def test_eigener_guid_namensraum(schema, k):
    # Not one GlobalId of our files may come from the builder's built-in namespace (shared with the
    # delivered source samples): compare with the raw output of the same writer call.
    f, _ = _datei("teile", schema, k)
    roh, _ = eifc.muster_projekt(k, bk.MUSTER_ROLLEN, schema, "teile", bk.NAME_MUSTER,
                                 pset_praefix=bk.PSET_PRAEFIX, textur_url=bk.TEXTUR_URL)
    unsere = [e.GlobalId for e in f.by_type("IfcRoot")]
    assert len(set(unsere)) == len(unsere)
    assert not set(unsere) & {e.GlobalId for e in roh.by_type("IfcRoot")}
    assert not set(unsere) & {el_typ_guid(t) for t in k.typen.values()}
    # deterministic: the elements and types of a second build carry the same GlobalIds
    f2, _ = bk.muster_projekt(schema, "teile", k)
    stabil = ("IfcWall", "IfcSlab", "IfcDoor", "IfcWindow", "IfcTypeObject", "IfcBuildingStorey")
    assert {e.GlobalId for c in stabil for e in f.by_type(c)} == {e.GlobalId for c in stabil for e in f2.by_type(c)}


@pytest.mark.parametrize("schema", SCHEMEN)
def test_muster_staenderwand_als_schichten(schema, k):
    f, info = _datei("schichten", schema, k)
    b = bk.pruefen(f)
    assert b["gueltig"] and b["proxys"] == 0 and b["ohne_typ"] == [] and b["neutral"], b["fehler"]
    gk = next(w for w in f.by_type("IfcWall") if w.Name.startswith("GK"))
    assert ue.get_material(gk).is_a("IfcMaterialLayerSetUsage") and not gk.IsDecomposedBy
    sw = ue.get_psets(gk)["Pset_BIT_Staenderwerk_Bauteil"]
    assert sw["Staender"] == 6 and sw["Ausgabe"] == neutral.NEUTRALER_WERT[("_Staenderwerk_Bauteil", "Ausgabe")]
    assert not f.by_type("IfcMember")
    assert info["nachlauf"]["werte_ersetzt"] == 1


def test_gegenprobe_userdefined_ohne_elementtype(k):
    f = bk.typbibliothek("IFC4", k)
    w = f.by_type("IfcWallType")[0]
    w.PredefinedType, w.ElementType = "USERDEFINED", None
    b = bk.pruefen(f)
    # exactly the WHERE rule CorrectPredefinedType (USERDEFINED needs ElementType) must fire
    assert not b["gueltig"] and b["anzahl_fehler"] == 1
    assert "USERDEFINED" in b["fehler"][0] and "ElementType" in b["fehler"][0]


# ── post-processing (transition until elmonkey stops writing the origin keys)

def test_nachlauf_entfernt_treffer(k):
    roh = eifc.materialbibliothek(k, "IFC4", bk.NAME_MATERIALBIBLIOTHEK, pset_praefix=bk.PSET_PRAEFIX,
                                  textur_url=bk.TEXTUR_URL)
    vorher = neutral.ifc_treffer(roh)
    assert len(vorher) >= 113                                    # one origin property per material at least
    assert sum(t.URLReference.startswith("https://") for t in roh.by_type("IfcImageTexture")) == 95
    n = neutral.nachlauf(roh)
    assert n["eigenschaften_entfernt"] == len(vorher) and n["texturen_umgeschrieben"] == 95
    assert neutral.ifc_treffer(roh) == []
    assert all(t.URLReference.startswith(neutral.TEXTUR_URN) for t in roh.by_type("IfcImageTexture"))
    assert eifc.pruefen(roh)["gueltig"]
    # idempotent: a second run changes nothing
    assert neutral.nachlauf(roh)["eigenschaften_entfernt"] == 0


def _gesperrtes_wort(k) -> str:
    """A blocked word taken from the builder's own output (never written in plain text here)."""
    roh = eifc.materialbibliothek(k, "IFC4", "x", pset_praefix="Pset_X", textur_url=bk.TEXTUR_URL)
    for mp in roh.by_type("IfcMaterialProperties"):
        for p in mp.Properties:
            tok = neutral.treffer(p.Name, neutral.GESPERRT_DATEN)
            if tok:
                return next(t for t in neutral._CAMEL.split(tok[0])
                            if neutral.treffer(t, neutral.GESPERRT_DATEN) and t.isalpha())
    raise AssertionError("kein gesperrtes Wort in der Rohausgabe")


def test_namenspruefung_camelcase_und_guid_position(k, tmp_path):
    w = _gesperrtes_wort(k).capitalize()
    assert neutral.treffer(f"{w}Name Feld{w}", neutral.GESPERRT_DATEN) == [f"{w}Name", f"Feld{w}"]
    assert neutral.treffer("IfcWallType PredefinedType", neutral.GESPERRT_DATEN) == []
    assert neutral.ersetzen(f"{w}Name")[1] == [f"{w}Name"]     # blocked compound without replacement
    # IFC text: only the GlobalId position is skipped, the same literal elsewhere is checked
    lit = (w + "1" * 22)[:22]
    assert len(lit) == 22 and lit[:len(w)] == w
    p = tmp_path / "x.ifc"
    p.write_text(f"#1=IFCWALL('{lit}',$,$,$,$,$,$,$,$);\n", encoding="utf-8")
    assert neutral.pruefe_text(p) == []
    p.write_text(f"#1=IFCWALL('0123456789012345678901',$,'{lit}',$,$,$,$,$,$);\n", encoding="utf-8")
    assert neutral.pruefe_text(p) == [w]
    assert not neutral.klassifizierung_erlaubt("DIN 276 und mehr")
    assert neutral.klassifizierung_erlaubt("DIN 276 Kosten im Bauwesen")


def test_nachlauf_ersetzt_wert_der_option(k):
    roh, _ = eifc.muster_projekt(k, bk.MUSTER_ROLLEN, "IFC4", "schichten", bk.NAME_MUSTER,
                                 pset_praefix=bk.PSET_PRAEFIX, textur_url=bk.TEXTUR_URL)
    assert any(a == "NominalValue" for _, a in neutral.ifc_treffer(roh))
    assert neutral.nachlauf(roh)["werte_ersetzt"] == 1
    assert neutral.ifc_treffer(roh) == []


def test_nachlauf_lehnt_fremde_klassifizierung_ab(k):
    f = bk.typbibliothek("IFC4", k)
    f.createIfcClassification("X", "1", None, "Fremdsystem", None, None, None)
    with pytest.raises(neutral.NeutralitaetsFehler, match="Klassifizierung"):
        neutral.nachlauf(f)
    assert not bk.pruefen(f, regeln=False)["neutral"]


def test_nachlauf_entfernt_leeres_pset(k):
    # a property set that holds only offending properties must vanish completely (IFC: SET [1:?])
    roh = eifc.materialbibliothek(k, "IFC4", "x", pset_praefix="Pset_X", textur_url=bk.TEXTUR_URL)
    mp = next(p for p in roh.by_type("IfcMaterialProperties") if p.Name == "Pset_X_Material")
    weg = [p for p in mp.Properties if not neutral.treffer(p.Name, neutral.GESPERRT_DATEN)]
    mp.Properties = [p for p in mp.Properties if p not in weg]
    for p in weg:
        roh.remove(p)
    n = neutral.nachlauf(roh)
    assert n["psets_entfernt"] == 1
    assert len([p for p in roh.by_type("IfcMaterialProperties") if p.Name == "Pset_X_Material"]) == 112


def test_nachlauf_entfernt_leeres_typ_pset(k):
    # a type property set (HasPropertySets, OPTIONAL SET [1:?]) that holds only offending properties
    roh = eifc.typbibliothek(k, "IFC4", "x", pset_praefix="Pset_X", textur_url=bk.TEXTUR_URL)
    name = next(p.Name for mp in roh.by_type("IfcMaterialProperties") for p in mp.Properties
                if neutral.treffer(p.Name, neutral.GESPERRT_DATEN))
    wt = roh.by_type("IfcWallType")[0]
    vorher = list(wt.HasPropertySets or ())
    ps = ifcopenshell.api.run("pset.add_pset", roh, product=wt, name="Pset_X_Leer")
    ifcopenshell.api.run("pset.edit_pset", roh, pset=ps, properties={name: "x"})
    assert ps in wt.HasPropertySets
    n = neutral.nachlauf(roh)
    assert n["psets_entfernt"] == 1
    assert list(wt.HasPropertySets or ()) == vorher
    assert not [p for p in roh.by_type("IfcPropertySet") if p.Name == "Pset_X_Leer"]
    assert eifc.pruefen(roh, regeln=False)["gueltig"]


# ── neutrality of the package and the examples

def _dateien(ordner: Path) -> list[Path]:
    return [p for p in sorted(ordner.rglob("*")) if p.is_file() and "__pycache__" not in p.parts]


def test_paket_ist_neutral():
    dateien = _dateien(PAKET) + [HARNESS_DIR / "tools" / "bauteilkatalog_neutral.py", Path(__file__)]
    assert len(dateien) >= 6
    for p in dateien:
        assert neutral.pruefe_text(p) == [], p.name


def test_beispiele_vorhanden_neutral_und_gueltig(k):
    ifcs = sorted(BEISPIELE.glob("*.ifc"))
    assert [p.name for p in ifcs] == [
        "bit-atelier-bauteilkatalog-muster-ifc4-staenderwand-als-schichten.ifc",
        "bit-atelier-bauteilkatalog-muster-ifc4.ifc",
        "bit-atelier-bauteiltypen-ifc4.ifc",
        "bit-atelier-materialbibliothek-ifc4.ifc",
    ]
    for p in _dateien(BEISPIELE):
        assert neutral.pruefe_text(p) == [], p.name
    for p in ifcs:
        b = bk.pruefen(p)
        assert b["gueltig"] and b["proxys"] == 0 and b["ohne_typ"] == [] and b["neutral"], (p.name, b["fehler"])
        assert b["fremde_texturen"] == 0, p.name
    # the committed examples carry our type GUIDs, none from the builder's built-in namespace
    typen = ifcopenshell.open(str(BEISPIELE / "bit-atelier-bauteiltypen-ifc4.ifc"))
    guids = {e.GlobalId for e in typen.by_type("IfcRoot")}
    assert {bk.typ_guid(t) for t in k.typen.values()} <= guids
    assert not guids & {el_typ_guid(t) for t in k.typen.values()}


# ── CLI

def test_cli_muster_bibliothek_pruefen(tmp_path, capsys):
    assert cli(["muster", str(tmp_path), "--schema", "ifc4x3"]) == 0     # schema is case-insensitive
    berichte = json.loads(capsys.readouterr().out)
    assert [b["datei"] for b in berichte] == ["bit-atelier-bauteilkatalog-muster-ifc4x3.ifc",
                                              "bit-atelier-bauteilkatalog-muster-ifc4x3-staenderwand-als-schichten.ifc"]
    assert all(b["gueltig"] and b["neutral"] for b in berichte)
    assert cli(["pruefen", str(tmp_path / berichte[0]["datei"]), "--ohne-regeln"]) == 0
    assert json.loads(capsys.readouterr().out)["proxys"] == 0
    assert cli(["pruefen", str(tmp_path / "fehlt.ifc")]) == 1
    assert "nicht gefunden" in capsys.readouterr().err


def test_cli_pruefen_kaputte_datei(tmp_path, capsys):
    # a file that is not IFC: German message and exit 1, no traceback
    p = tmp_path / "kaputt.ifc"
    p.write_text("not an ifc", encoding="utf-8")
    assert cli(["pruefen", str(p)]) == 1
    err = capsys.readouterr().err
    assert "IFC-Datei kaputt.ifc nicht lesbar" in err and "Traceback" not in err
