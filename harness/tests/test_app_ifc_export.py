"""114-02: cross-check of the APP's IFC export with the harness — the app and the harness write the same catalogue types.

Node writes the IFC export of the app's catalogue example model (`tests/unit/fixtures/ifcKatalogModell-11402.js`, via
`ifcKatalogExport-11402.mjs`) into a temp folder; this test reads it with ifcopenshell and checks:

- `bauteilkatalog.pruefen`: valid incl. WHERE rules, 0 proxies, every element typed (no element without IsTypedBy), no name-check
  hit and no foreign texture;
- every type object is a catalogue type the harness knows: class, GlobalId = `typ_guid` of the harness catalogue (D-MH-03) and = the
  GlobalId in the harness type library (`examples/bauteilkatalog/bit-atelier-bauteiltypen-ifc4.ifc`), the layer set has the same
  layers (thickness, role) as the library — including the 0 m membrane the app's own build-up drops;
- one IfcRelDefinesByType per type, every instance's IfcMaterialLayerSetUsage points to its type's layer set;
- the layer side (task 2 of the plan): with the reading of IfcOpenShell (MlsBase = placement + offset along the LayerSetDirection axis,
  layers stacked in DirectionSense), the first (outer) layer of each external wall lies on the side its reference line prescribes —
  "outside": body on the outer side of the drawn line, "inside": on the inner side, "center": centred — and on the face away from
  the building.

Skips loudly without the extras [ifc, katalog] or without Node/node_modules (the app side cannot be exported then). ifcopenshell
is not thread-safe: everything runs in this one process, one file at a time.
"""

from __future__ import annotations

import json
import math
import shutil
import subprocess
from pathlib import Path

import pytest

pytest.importorskip("elmonkey.katalog", reason="Extra [katalog] installieren: pip install -e '.[dev,ifc,katalog]'")
ifcopenshell = pytest.importorskip("ifcopenshell", reason="Extra [ifc] installieren: pip install -e '.[dev,ifc,katalog]'")

import ifcopenshell.util.element as ue  # noqa: E402
import ifcopenshell.util.placement as up  # noqa: E402

from harness import bauteilkatalog as bk  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
SCHREIBER = "tests/unit/fixtures/ifcKatalogExport-11402.mjs"
BIBLIOTHEK = Path(__file__).resolve().parents[1] / "examples" / "bauteilkatalog" / "bit-atelier-bauteiltypen-ifc4.ifc"
#: Name of the DIN 276 classification in the app export since 97-02a (the harness names it "DIN 276 Kosten im Bauwesen", see
#: neutral.KLASSIFIZIERUNG_ERLAUBT) — same system, different name; aligning it is an open point of 114-02 (it would change the goldens).
APP_DIN276 = "DIN 276"


@pytest.fixture(scope="module")
def export(tmp_path_factory):
    node = shutil.which("node")
    if not node or not (REPO / "node_modules").is_dir():
        pytest.skip("114-02 Cross-Check übersprungen: Node.js oder node_modules fehlt — im Repo `npm ci` ausführen, "
                    "sonst kann der App-Export nicht erzeugt werden")
    ziel = tmp_path_factory.mktemp("app-ifc") / "katalogprobe.ifc"
    erg = subprocess.run([node, "--import", "./tests/alias-register.mjs", SCHREIBER, str(ziel)], cwd=REPO,
                         capture_output=True, text=True, encoding="utf-8", timeout=180)
    assert erg.returncode == 0, f"App-Export fehlgeschlagen (Exit {erg.returncode}): {erg.stderr or erg.stdout}"
    waende = json.loads(Path(f"{ziel}.json").read_text(encoding="utf-8"))["waende"]
    return {"pfad": ziel, "datei": ifcopenshell.open(str(ziel)), "waende": waende}


@pytest.fixture(scope="module")
def k():
    return bk.katalog()


@pytest.fixture(scope="module")
def bibliothek():
    return ifcopenshell.open(str(BIBLIOTHEK))


def _katalog_pset(t) -> dict:
    return ue.get_psets(t).get("Pset_BIT_Katalog", {})


def _schichten(satz) -> list[tuple[float, str | None]]:
    return [(round(float(s.LayerThickness), 4), s.Category) for s in satz.MaterialLayers]


def _typ_satz(t):
    for r in t.HasAssociations or ():
        if r.is_a("IfcRelAssociatesMaterial") and r.RelatingMaterial.is_a("IfcMaterialLayerSet"):
            return r.RelatingMaterial
    return None


def test_pruefen_gueltig_ohne_proxy_alles_typisiert(export):
    r = bk.pruefen(export["pfad"])
    assert r["gueltig"], f"Schema-/WHERE-Fehler im App-Export: {r['fehler']}"
    assert r["mit_regeln"] is True
    assert r["proxys"] == 0
    assert r["ohne_typ"] == [], f"Bauteile ohne Typ: {r['ohne_typ']}"
    assert r["typen"] == 5  # KS+WDVS, GK, StB-Decke, Holzrahmendecke, Estrich/Parkett — each exactly once
    assert r["neutral_treffer"] == 0 and r["fremde_texturen"] == 0
    assert r["klassifizierungen"] == [APP_DIN276]


def test_typen_sind_die_katalogtypen_des_harness(export, k, bibliothek):
    f = export["datei"]
    bib = {_katalog_pset(t).get("Schluessel"): t for t in bibliothek.by_type("IfcTypeObject") if _katalog_pset(t)}
    typen = f.by_type("IfcTypeObject")
    assert len(typen) == 5
    for t in typen:
        ps = _katalog_pset(t)
        schluessel, version = ps["Schluessel"], ps["Version"]
        assert isinstance(version, int) and version >= 1
        harness_typ = k.versionen[schluessel][version]
        assert t.GlobalId == bk.typ_guid(harness_typ), f"{schluessel}: GUID der App ≠ typ_guid des Harness"
        ref = bib[schluessel]
        assert t.is_a() == ref.is_a(), f"{schluessel}: Klasse {t.is_a()} ≠ Bibliothek {ref.is_a()}"
        assert t.GlobalId == ref.GlobalId, f"{schluessel}: GUID ≠ Typbibliothek des Harness"
        assert t.PredefinedType == ref.PredefinedType
        assert t.Name == ref.Name
        assert _schichten(_typ_satz(t)) == _schichten(_typ_satz(ref)), f"{schluessel}: Schichten weichen von der Typbibliothek ab"


def test_folie_mit_0_m_bleibt_im_typ(export):
    t = next(t for t in export["datei"].by_type("IfcSlabType") if _katalog_pset(t)["Schluessel"] == "holzrahmen-abgehangt-35-5-cm")
    dicken = [d for d, _ in _schichten(_typ_satz(t))]
    assert 0.0 in dicken, "die 0-m-Folie fehlt im Schichtsatz des Typs"


def test_eine_relation_je_typ_und_usage_auf_den_typsatz(export):
    f = export["datei"]
    for t in f.by_type("IfcTypeObject"):
        rels = t.Types or ()
        assert len(rels) == 1, f"{t.Name}: {len(rels)} IfcRelDefinesByType statt 1"
        satz = _typ_satz(t)
        for inst in rels[0].RelatedObjects:
            assert inst.is_a() == t.is_a()[:-4], f"{inst.is_a()} an {t.is_a()}"
            usage = ue.get_material(inst, should_skip_usage=False)
            assert usage.is_a("IfcMaterialLayerSetUsage"), f"{inst.Name}: Material ist {usage.is_a()}"
            assert usage.ForLayerSet == satz, f"{inst.Name}: Usage zeigt nicht auf den Schichtsatz des Typs"
            assert usage.DirectionSense == "NEGATIVE"
            assert usage.LayerSetDirection == ("AXIS2" if inst.is_a("IfcWall") else "AXIS3")


def test_aussenschicht_liegt_auf_der_seite_der_referenzlinie(export):
    f = export["datei"]
    waende = sorted(f.by_type("IfcWall"), key=lambda e: e.id())
    assert len(waende) == len(export["waende"])
    # signed distance (along the plan normal n = (−dz, dx), pointing outside in the example) of the middle of the FIRST layer from the
    # drawn line, per reference line; th = total, t0 = first layer (both m)
    soll = {"outside": lambda th, t0: th - t0 / 2, "inside": lambda th, t0: -t0 / 2, "center": lambda th, t0: th / 2 - t0 / 2}
    geprueft = 0
    for wand, w in zip(waende, export["waende"]):
        if not str(w["katalog_typ"]).startswith("ks-wdvs"):
            continue
        usage = ue.get_material(wand, should_skip_usage=False)
        lagen = usage.ForLayerSet.MaterialLayers
        th = sum(float(s.LayerThickness) for s in lagen)
        t0 = float(lagen[0].LayerThickness)
        assert lagen[0].Category == "Outer finish"
        m = up.get_local_placement(wand.ObjectPlacement)
        y_achse, ursprung = m[:3, 1], m[:3, 3]
        # IfcOpenShell's reading of the usage: MlsBase = placement + offset · Y, layers stacked by −Y for NEGATIVE
        sinn = -1 if usage.DirectionSense == "NEGATIVE" else 1
        y0 = float(usage.OffsetFromReferenceLine) + sinn * t0 / 2
        mitte = ursprung + y_achse * y0
        a, b = w["a"], w["b"]
        laenge = math.hypot(b["x"] - a["x"], b["z"] - a["z"])
        n = ((a["z"] - b["z"]) / laenge, (b["x"] - a["x"]) / laenge)  # (−dz, dx); IFC X = model x, IFC Y = model z
        abstand = (mitte[0] - a["x"]) * n[0] + (mitte[1] - a["z"]) * n[1]
        assert abstand == pytest.approx(soll[w["refLine"]](th, t0), abs=1e-3), f"Wand {w}: Außenschicht bei {abstand:.4f} m"
        # and the first layer lies on the face away from the building (centre of the example ring (3, −2.5))
        innen = ((3 - a["x"]) * n[0] + (-2.5 - a["z"]) * n[1])
        assert innen < 0, "Beispielring falsch orientiert: n zeigt nicht nach außen"
        geprueft += 1
    assert geprueft == 4


# --- user sample 08.11.2026: catalogue types together with gable walls, a stair opening and a dormer (variant "kombi") ---------

@pytest.fixture(scope="module")
def export_kombi(tmp_path_factory):
    """IFC export of the mixed model tests/unit/fixtures/ifcKatalogKombi-11402.js, opened with ifcopenshell."""
    node = shutil.which("node")
    if not node or not (REPO / "node_modules").is_dir():
        pytest.skip("114-02 Cross-Check (kombi) übersprungen: Node.js oder node_modules fehlt — im Repo `npm ci` ausführen")
    ziel = tmp_path_factory.mktemp("app-ifc-kombi") / "katalogprobe-dach.ifc"
    erg = subprocess.run([node, "--import", "./tests/alias-register.mjs", SCHREIBER, str(ziel), "kombi"], cwd=REPO,
                         capture_output=True, text=True, encoding="utf-8", timeout=180)
    assert erg.returncode == 0, f"App-Export (kombi) fehlgeschlagen (Exit {erg.returncode}): {erg.stderr or erg.stdout}"
    return {"pfad": ziel, "datei": ifcopenshell.open(str(ziel))}


def test_kombi_gueltig_mit_where_regeln(export_kombi):
    """Schema and WHERE rules hold for the mixed file — including the spaces, which are aggregated under their storey since
    B-114-02-01 (before: IfcRelContainedInSpatialStructure, two violated rules per space). The catalogue types are the three in use."""
    r = bk.pruefen(export_kombi["pfad"])
    assert r["gueltig"], f"Schema-/WHERE-Fehler im kombinierten App-Export: {r['fehler']}"
    assert r["mit_regeln"] is True
    f = export_kombi["datei"]
    raeume = f.by_type("IfcSpace")
    assert raeume and all(sp.Decomposes and sp.Decomposes[0].RelatingObject.is_a("IfcBuildingStorey") for sp in raeume)
    assert r["typen"] == 3  # GK partition, KS+WDVS, screed/parquet covering
    assert r["neutral_treffer"] == 0 and r["fremde_texturen"] == 0


def test_kombi_guids_eindeutig_und_typrelationen(export_kombi, k):
    f = export_kombi["datei"]
    guids = [e.GlobalId for e in f.by_type("IfcRoot")]
    assert len(guids) == len(set(guids)), "GlobalId doppelt im kombinierten Export"
    typen = f.by_type("IfcTypeObject")
    assert len(typen) == 3
    getypt = 0
    for t in typen:
        ps = _katalog_pset(t)
        assert t.GlobalId == bk.typ_guid(k.versionen[ps["Schluessel"]][ps["Version"]])
        rels = t.Types or ()
        assert len(rels) == 1, f"{t.Name}: {len(rels)} IfcRelDefinesByType statt 1"
        for inst in rels[0].RelatedObjects:
            assert inst.is_a() == t.is_a()[:-4]
            usage = ue.get_material(inst, should_skip_usage=False)
            assert usage.is_a("IfcMaterialLayerSetUsage") and usage.ForLayerSet == _typ_satz(t)
            getypt += 1
    assert getypt == 4  # three drawn catalogue walls (one of them cut by the roof) and the covering


def test_kombi_dachpfade_neben_den_typen(export_kombi):
    """Stair opening voids a slab, the global roof and the dormer are IfcRoof, none of them is typed."""
    f = export_kombi["datei"]
    oeffnungen = f.by_type("IfcOpeningElement")
    assert len(oeffnungen) == 1
    wirt = oeffnungen[0].VoidsElements[0].RelatingBuildingElement
    assert wirt.is_a("IfcSlab")
    daecher = f.by_type("IfcRoof")
    assert sorted(d.Name for d in daecher) == ["Dach", "Gaube"]
    assert len(f.by_type("IfcStair")) == 1
    for e in [wirt, *daecher]:
        assert not ue.get_type(e), f"{e.is_a()} {e.Name} ist unerwartet typisiert"

