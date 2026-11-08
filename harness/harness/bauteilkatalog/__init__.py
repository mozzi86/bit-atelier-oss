"""Component catalogue and IFC builder of the harness (phase 109) — adapter on `elmonkey.katalog`.

The builder is elmonkey-core 0.3.0 (extra `[katalog]`): `elmonkey.katalog` holds the catalogue model
(types from layers, names, fingerprint, stable type GUID), the build plan (layered wall / stud wall) and
the editing core; `elmonkey.katalog.ifc` writes the IFC libraries. This package only adds:

- the neutral base stock in `daten/` (113 materials, 42 types; D-BKAT-01). Profiles and reinforcements
  come from the elmonkey package data (identical values, so no copy here);
- runtime types per harness project: `<projekt>/bauteilkatalog/typen/<schluessel>.json`, each file
  `{"typen": [version 1, version 2, …]}` — the base stock is never written;
- the neutral writer settings (pset prefix `Pset_BIT`, library names, texture URN), the
  post-processing of `neutral.nachlauf` on every written IFC file, and the rewrite of every GlobalId
  into our own uuid5 namespaces (`guids.umschluesseln`; `typ_guid` gives a type's final GUID).

In:  type references (`schluessel` or `schluessel@version`), lengths in metres, a harness project folder.
Out: `elmonkey.katalog.Katalog`, build plans (`elmonkey.katalog.bauen.Bauplan`), `ifcopenshell.file`
     objects and check reports (dict).

Everything that needs elmonkey is imported lazily; without the extra the functions raise
`NichtVerfuegbar` with a German message (no silent fallback).
CLI: `python -m harness.bauteilkatalog muster|bibliothek|pruefen …`.
"""
from __future__ import annotations

import copy
import json
import os
import re
from pathlib import Path
from typing import TYPE_CHECKING, Any, Optional, Union

from . import guids, neutral

if TYPE_CHECKING:  # pragma: no cover - typing only
    import ifcopenshell
    from elmonkey.katalog import Katalog
    from elmonkey.katalog.bauen import Bauplan

#: Folder of the neutral base stock (baustoffe.json + typen/*.json).
DATEN = Path(__file__).resolve().parent / "daten"

#: Runtime types live below the harness project folder in this sub-folder.
LAUFZEIT_ORDNER = Path("bauteilkatalog") / "typen"

#: Prefix of our own property sets (Pset_BIT_Material, Pset_BIT_Katalog, Pset_BIT_Staenderwerk, …).
PSET_PRAEFIX = "Pset_BIT"

#: Texture reference prefix of every texture (`klasse:<name>` → `urn:bit-atelier:textur/klasse/<name>`
#: by elmonkey; `ambientcg:<id>` → `urn:bit-atelier:textur/ambientcg/<id>` by `neutral.nachlauf`).
TEXTUR_URL = neutral.TEXTUR_URN

#: Names of the IFC projects / project libraries written by the builder.
NAME_MATERIALBIBLIOTHEK = "BIT-Atelier Materialbibliothek"
NAME_TYPBIBLIOTHEK = "BIT-Atelier Bauteiltypen"
NAME_MUSTER = "BIT-Atelier Bauteilkatalog Muster"

#: Roles of the sample project (room 5.00 × 3.62 m, height 2.75 m) → neutral type keys. Chosen to match
#: the reference sample of D-BKAT-02 one to one (same build-ups, only the keys of door and window were
#: neutralised), so the counts of the reference report can be compared: layered external wall with a
#: window, masonry internal wall with a door, two-layer gypsum stud wall (CW75) with a grab-bar
#: reinforcement, reinforced concrete slab 20 cm and a screed/parquet floor build-up.
MUSTER_ROLLEN: dict[str, str] = {
    "aussenwand": "ks-wdvs-42-cm",
    "fenster": "fenster-1-flg-126x151",
    "innenwand": "ks-24-cm-beidseitig-gipsputz",
    "tuer": "tuer-innen-1-flg-uz-holz-88-5x213-5",
    "staenderwand": "gk-2-lagen-12-5-cm",
    "rohdecke": "rohdecke-stb-20-cm",
    "fussboden": "estrich-parkett-15-cm",
}

#: IFC schemas the writer supports (elmonkey maps IFC4X3 to IFC4X3_ADD2).
SCHEMATA = ("IFC4", "IFC4X3")

#: Allowed characters of a runtime type key — it becomes a file name, so no path separators.
_SCHLUESSEL = re.compile(r"^[a-z0-9][a-z0-9-]{0,119}$")

#: Fields `elmonkey.katalog.modell.benennen` derives on every call; not stored with a runtime type.
_ABGELEITET = ("kurzname", "langname", "fingerabdruck")


class NichtVerfuegbar(RuntimeError):
    """The `[katalog]` extra (elmonkey-core) or the `[ifc]` extra is not installed; German message."""


def _katalog_modul():
    try:
        import elmonkey.katalog as ek
    except ImportError as e:  # pragma: no cover - exercised only without the extra
        raise NichtVerfuegbar(
            "Bauteilkatalog nicht verfügbar: das Extra [katalog] (elmonkey-core 0.3.0) ist nicht installiert — "
            "im Ordner harness: .venv\\Scripts\\python -m pip install -e \".[dev,ifc,katalog]\"") from e
    return ek


def _ifc_modul():
    _katalog_modul()
    try:
        import elmonkey.katalog.ifc as ei
    except ImportError as e:  # pragma: no cover - exercised only without ifcopenshell
        raise NichtVerfuegbar(
            "IFC-Ausgabe des Bauteilkatalogs nicht verfügbar: ifcopenshell fehlt — "
            "im Ordner harness: .venv\\Scripts\\python -m pip install -e \".[dev,ifc,katalog]\"") from e
    return ei


def verfuegbar() -> bool:
    """True when elmonkey-core and ifcopenshell can be imported (catalogue + IFC output usable)."""
    try:
        _ifc_modul()
    except NichtVerfuegbar:
        return False
    return True


# ── catalogue and runtime types

def _laufzeit_datei(datei: Path) -> list[dict]:
    """Types of one runtime type file `{"typen": [{schluessel, …}, …]}`; ValueError naming the file
    (German message) when it is unreadable or malformed."""
    try:
        daten = json.loads(datei.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, UnicodeDecodeError) as e:
        raise ValueError(f"Laufzeit-Typ {datei.name} nicht lesbar: {e}") from e
    typen = daten.get("typen") if isinstance(daten, dict) else None
    if not isinstance(typen, list):
        raise ValueError(f"Laufzeit-Typ {datei.name}: erwartet {{\"typen\": [...]}}")
    for i, t in enumerate(typen, 1):
        if not isinstance(t, dict) or not isinstance(t.get("schluessel"), str) or not t["schluessel"]:
            raise ValueError(f"Laufzeit-Typ {datei.name}: Eintrag {i} ohne gültigen \"schluessel\"")
        try:
            int(t.get("version", 1))
        except (TypeError, ValueError) as e:
            raise ValueError(f"Laufzeit-Typ {datei.name}: Eintrag {i} mit ungültiger \"version\"") from e
    return typen


def laufzeit_typen(projekt_ordner: Union[str, Path, None]) -> list[dict]:
    """Runtime types stored in `<projekt_ordner>/bauteilkatalog/typen/*.json` (all versions, file order).

    Returns an empty list when the folder is None or has no runtime types yet. A file that is not
    `{"typen": [{schluessel, …}, …]}` raises ValueError naming the file (German message)."""
    if projekt_ordner is None:
        return []
    ordner = Path(projekt_ordner) / LAUFZEIT_ORDNER
    if not ordner.is_dir():
        return []
    aus: list[dict] = []
    for datei in sorted(ordner.glob("*.json")):
        aus.extend(_laufzeit_datei(datei))
    return aus


def katalog(projekt_ordner: Union[str, Path, None] = None) -> "Katalog":
    """Load the neutral base stock plus the runtime types of a harness project.

    Every type is validated by `elmonkey.katalog.pruefen` while loading (KatalogFehler on error).
    Profiles and reinforcements are the elmonkey package data."""
    ek = _katalog_modul()
    return ek.Katalog.laden(DATEN, laufzeit=laufzeit_typen(projekt_ordner))


def speichern(projekt_ordner: Union[str, Path], typ: dict) -> Path:
    """Store a runtime type (result of `bearbeiten`) in the project folder; returns the file path.

    The file `<schluessel>.json` holds all versions of that key; a version that is already stored is
    replaced. Base stock types cannot be stored here (ValueError) — the base stock is read-only. The
    file is written atomically (temporary file + `os.replace`), so an aborted write never loses the
    versions stored before."""
    if typ.get("ebene") != "laufzeit":
        raise ValueError("Nur Laufzeit-Typen werden im Projekt gespeichert — der Grundbestand bleibt unverändert")
    s = str(typ.get("schluessel") or "")
    if not _SCHLUESSEL.match(s):
        raise ValueError(f"Typ-Schlüssel {s!r} ist als Dateiname ungeeignet (erlaubt: a–z, 0–9, '-')")
    ordner = Path(projekt_ordner) / LAUFZEIT_ORDNER
    ordner.mkdir(parents=True, exist_ok=True)
    datei = ordner / f"{s}.json"
    vorhanden: list[dict] = _laufzeit_datei(datei) if datei.is_file() else []
    neu = {k: v for k, v in copy.deepcopy(typ).items() if k not in _ABGELEITET}
    v = int(neu.get("version", 1))
    vorhanden = [t for t in vorhanden if int(t.get("version", 1)) != v] + [neu]
    vorhanden.sort(key=lambda t: int(t.get("version", 1)))
    tmp = datei.with_name(datei.name + ".tmp")
    tmp.write_text(json.dumps({"typen": vorhanden}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8",
                   newline="\n")
    os.replace(tmp, datei)
    return datei


def bearbeiten(projekt_ordner: Union[str, Path], typ_ref: str, operationen: list[dict],
               autor: Optional[str] = None, zeit: Optional[str] = None) -> dict:
    """Apply editing operations (`elmonkey.katalog.bearbeiten.OPERATIONEN`) and store a new type/version.

    Returns elmonkey's result `{typ, neu, grund}`; when `neu` is True the type was written with
    `speichern` and `datei` (Path) is added. Dimensions in the operations are metres (`dicke_m`, …)."""
    ek = _katalog_modul()
    k = katalog(projekt_ordner)
    erg = ek.bearbeiten.anwenden(k, typ_ref, operationen, autor=autor, zeit=zeit)
    if erg["neu"]:
        erg["datei"] = speichern(projekt_ordner, erg["typ"])
    return erg


def wand(typ_ref: str, laenge_m: float, hoehe_m: float, verstaerkungen: Optional[list[dict]] = None,
         staenderwand_als: str = "teile", k: "Optional[Katalog]" = None,
         projekt_ordner: Union[str, Path, None] = None) -> "Bauplan":
    """Build plan of a wall from a catalogue type (pass-through to `elmonkey.katalog.bauen.wand`).

    laenge_m: axis length in metres (0.05…200); hoehe_m: height in metres (0.1…30);
    verstaerkungen: `[{art, abstand_m (centre from wall start, m), hoehe_m (centre above floor, m), seite}]`;
    staenderwand_als: "teile" (stud wall decomposed into parts) or "schichten" (extrusion + layer set).
    Catalogue: `k`, else `katalog(projekt_ordner)` — a runtime type needs one of the two (without both
    only the base stock is loaded, and each call loads it anew)."""
    ek = _katalog_modul()
    return ek.bauen.wand(k or katalog(projekt_ordner), typ_ref, laenge_m, hoehe_m, verstaerkungen, staenderwand_als)


def typ_guid(t: dict) -> str:
    """Final IFC GlobalId (22 characters) of a catalogue type in our IFC files (own uuid5 namespace;
    runtime types include their content hash). Stable across exports."""
    return guids.typ_guid(t)


# ── IFC

def _schreiber_kw() -> dict[str, Any]:
    return {"pset_praefix": PSET_PRAEFIX, "textur_url": TEXTUR_URL}


def _fertig(f: "ifcopenshell.file", k: "Katalog") -> dict:
    """Post-processing of every file we write: neutralise (`neutral.nachlauf`), then rewrite every
    GlobalId into our namespace (`guids.umschluesseln`). Returns the post-processing report."""
    n = neutral.nachlauf(f, TEXTUR_URL)
    n["globalids_umgeschluesselt"] = guids.umschluesseln(f, k)
    return n


def _schema(schema: str) -> str:
    s = str(schema).upper()
    if s not in SCHEMATA:
        raise ValueError(f"Schema {schema!r} unbekannt — erlaubt: {', '.join(SCHEMATA)}")
    return s


def materialbibliothek(schema: str = "IFC4", k: "Optional[Katalog]" = None,
                       projekt_ordner: Union[str, Path, None] = None) -> "ifcopenshell.file":
    """IFC material library: one IfcMaterial per material (psets, colour, texture, DIN hatch), neutralised.

    Catalogue: `k`, else `katalog(projekt_ordner)`."""
    ei = _ifc_modul()
    k = k or katalog(projekt_ordner)
    f = ei.materialbibliothek(k, _schema(schema), NAME_MATERIALBIBLIOTHEK, **_schreiber_kw())
    _fertig(f, k)
    return f


def typbibliothek(schema: str = "IFC4", k: "Optional[Katalog]" = None,
                  projekt_ordner: Union[str, Path, None] = None) -> "ifcopenshell.file":
    """IFC type library: all materials plus every catalogue type declared in an IfcProjectLibrary.

    Catalogue: `k`, else `katalog(projekt_ordner)` (runtime types of the project are included then).
    Built from `Schreiber` directly (not `elmonkey.katalog.ifc.typbibliothek`) so that the project
    library carries our name too — elmonkey's helper names only the IfcProject."""
    ei = _ifc_modul()
    k = k or katalog(projekt_ordner)
    s = ei.Schreiber(k, _schema(schema), NAME_TYPBIBLIOTHEK, **_schreiber_kw())
    s.alle_materialien()
    s.alle_typen(NAME_TYPBIBLIOTHEK)
    f = s.fertig()
    _fertig(f, k)
    return f


def muster_projekt(schema: str = "IFC4", staenderwand_als: str = "teile", k: "Optional[Katalog]" = None,
                   rollen: Optional[dict[str, str]] = None,
                   projekt_ordner: Union[str, Path, None] = None) -> "tuple[ifcopenshell.file, dict]":
    """Sample project (site/building/storey with the roles of `MUSTER_ROLLEN`), neutralised.

    Catalogue: `k`, else `katalog(projekt_ordner)` (needed when `rollen` names runtime types).
    Returns (IFC file, info) — info is elmonkey's `{bauplaene, zaehler}` plus `nachlauf` (what the
    post-processing removed or rewrote, and how many GlobalIds were rewritten)."""
    ei = _ifc_modul()
    k = k or katalog(projekt_ordner)
    f, info = ei.muster_projekt(k, rollen or MUSTER_ROLLEN, _schema(schema), staenderwand_als,
                                NAME_MUSTER, **_schreiber_kw())
    info["nachlauf"] = _fertig(f, k)
    return f, info


def pruefen(datei: "Union[str, Path, ifcopenshell.file]", regeln: bool = True) -> dict:
    """Check an IFC file: schema + WHERE rules, proxies, elements without type (elmonkey) plus neutrality.

    Adds `klassifizierungen` (names of the IfcClassification systems), `neutral_treffer` (number of name
    check hits in string attributes), `fremde_texturen` (texture references outside `TEXTUR_URL`) and
    `neutral` (True when all three are clean). A file that is not readable IFC raises ValueError with a
    German message (instead of the parser's exception)."""
    ei = _ifc_modul()
    if isinstance(datei, (str, Path)):
        import ifcopenshell
        name = Path(datei).name
        # Header check first: a failed ifcopenshell.open leaves a half-built file object whose
        # destructor prints a stray KeyError traceback (ifcopenshell 0.8.5), so reject non-SPF early.
        if Path(datei).suffix.lower() == ".ifc":
            try:
                with open(datei, "rb") as h:
                    kopf = h.read(64).lstrip(b"\xef\xbb\xbf \t\r\n")
            except OSError as e:
                raise ValueError(f"IFC-Datei {name} nicht lesbar: {e}") from e
            if not kopf.startswith(b"ISO-10303-21"):
                raise ValueError(f"IFC-Datei {name} nicht lesbar: kein IFC-SPF-Kopf (ISO-10303-21)")
        try:
            f = ifcopenshell.open(str(datei))
        except (ifcopenshell.Error, RuntimeError, OSError) as e:
            raise ValueError(f"IFC-Datei {name} nicht lesbar: {e}") from e
    else:
        f = datei
    bericht = ei.pruefen(f, regeln=regeln)
    systeme = sorted({c.Name for c in f.by_type("IfcClassification")})
    treffer = neutral.ifc_treffer(f)
    fremde_texturen = sum(1 for t in f.by_type("IfcImageTexture")
                          if not str(t.URLReference or "").startswith(TEXTUR_URL))
    bericht["klassifizierungen"] = systeme
    bericht["neutral_treffer"] = len(treffer)
    bericht["fremde_texturen"] = fremde_texturen
    bericht["neutral"] = (not treffer and not fremde_texturen
                          and all(neutral.klassifizierung_erlaubt(n) for n in systeme))
    return bericht


# ── reading helpers and the single-wall model (109-02: harness tools)

#: Surface resistances in m²K/W for horizontal heat flow, DIN EN ISO 6946:2018 Tab. 7: R_si inside,
#: R_se outside. An internal wall has an inside surface on both sides (R_si twice).
R_SI_HORIZONTAL = 0.13
R_SE = 0.04


def u_wert(t: dict, k: "Katalog") -> dict:
    """Thermal transmittance of a wall type, simplified method of DIN EN ISO 6946 (homogeneous layers).

    U = 1 / (R_si + Σ d_i/λ_i + R_se) in W/(m²K); d in m, λ in W/(mK). Only for `IfcWall` (horizontal heat
    flow — slabs need the flow direction, which the type does not know). External wall (pset_common
    IsExternal true): R_si + R_se; otherwise R_si on both sides (IsExternal missing: computed as internal and
    said so in `annahme`). [ASSUMED] every layer is homogeneous and not
    ventilated (rear-ventilated cladding would need R_se only up to the air layer, not modelled here).
    Returns `{u_W_m2K, r_gesamt_m2K_W, rsi, rse, schichten: [{baustoff, dicke_m, lambda_W_mK, r_m2K_W}], norm,
    annahme}` or `{u_W_m2K: None, grund}` when it cannot be computed (stud layer = inhomogeneous, missing λ,
    no layers, not a wall)."""
    if t.get("ifc", {}).get("klasse") != "IfcWall":
        return {"u_W_m2K": None, "grund": "nur für Wände berechnet (Wärmestrom horizontal)"}
    schichten = t.get("schichten") or []
    if not schichten:
        return {"u_W_m2K": None, "grund": "Typ ohne Schichten"}
    zeilen = []
    for s in schichten:
        b = k.baustoff(s["baustoff"])
        name = b.get("kurz") or b.get("name") or s["baustoff"]
        if s.get("staenderwerk"):
            return {"u_W_m2K": None, "grund": f"Schicht {name} mit Ständerwerk ist inhomogen — U-Wert braucht das "
                                              "Verfahren mit oberem/unterem Grenzwert (DIN EN ISO 6946 Abs. 6.7), "
                                              "nicht berechnet"}
        lam = (b.get("kennwerte") or {}).get("lambda_W_mK")
        if not lam:
            return {"u_W_m2K": None, "grund": f"Baustoff {name} ohne Wärmeleitfähigkeit λ"}
        d = float(s["dicke_m"])
        zeilen.append({"baustoff": s["baustoff"], "name": name, "dicke_m": d, "lambda_W_mK": float(lam),
                       "r_m2K_W": round(d / float(lam), 4)})
    exposition = (t.get("pset_common") or {}).get("IsExternal")
    aussen = exposition is True
    rse = R_SE if aussen else R_SI_HORIZONTAL
    r = R_SI_HORIZONTAL + sum(z["r_m2K_W"] for z in zeilen) + rse
    return {"u_W_m2K": round(1.0 / r, 3), "r_gesamt_m2K_W": round(r, 3), "rsi": R_SI_HORIZONTAL, "rse": rse,
            "schichten": zeilen, "norm": "DIN EN ISO 6946:2018, vereinfachtes Verfahren (homogene Schichten)",
            "annahme": "[ASSUMED] Schichten homogen und nicht hinterlüftet; "
                       + ("Außenwand: Rsi 0,13 + Rse 0,04" if aussen else
                          "Innenwand: Rsi 0,13 beidseitig" if exposition is False else
                          "Lage unbekannt (IsExternal fehlt im Typ), als Innenwand gerechnet: Rsi 0,13 beidseitig")}


def typ_info(t: dict, k: "Katalog", ausfuehrlich: bool = False) -> dict:
    """Plain description of a catalogue type for tools and reports.

    Always: schluessel, version, ebene, rohling, klasse, predefined_type, kurzname, langname, dicke_m (sum of
    the layers in m, None for doors/windows), din276 (cost group or None), u_W_m2K. With `ausfuehrlich`:
    schichten (baustoff key + name, dicke_m, rolle, staenderwerk), pset_common, oeffnung (breite_m/hoehe_m
    of doors/windows), versionen (all versions of the key), basiert_auf, typ_guid and the full U-value record."""
    from elmonkey.katalog import modell
    n = modell.benennen(t, k)
    sch = n.get("schichten") or []
    u = u_wert(n, k)
    aus: dict[str, Any] = {
        "schluessel": n["schluessel"], "version": int(n.get("version", 1)), "ebene": n.get("ebene", "grundbestand"),
        "rohling": bool(n.get("rohling")), "klasse": n["ifc"]["klasse"],
        "predefined_type": n["ifc"].get("predefined_type"), "kurzname": n["kurzname"], "langname": n["langname"],
        "dicke_m": round(modell.gesamtdicke(n), 4) if sch else None,
        "din276": ((n.get("klassifizierung") or {}).get("din276") or {}).get("kg"),
        "u_W_m2K": u.get("u_W_m2K"),
    }
    if not ausfuehrlich:
        return aus
    zeilen = []
    for s in sch:
        b = k.baustoff(s["baustoff"])
        z = {"baustoff": s["baustoff"], "name": b.get("kurz") or b.get("name"), "dicke_m": s["dicke_m"],
             "rolle": s.get("rolle")}
        if s.get("staenderwerk"):
            z["staenderwerk"] = s["staenderwerk"]
        zeilen.append(z)
    aus.update({
        "schichten": zeilen, "pset_common": n.get("pset_common") or {},
        "versionen": sorted(k.versionen.get(n["schluessel"], {})), "basiert_auf": n.get("basiert_auf"),
        "typ_guid": typ_guid(n), "u_wert": u,
    })
    if n["ifc"]["klasse"] in ("IfcDoor", "IfcWindow"):
        aus["oeffnung"] = {"breite_m": n.get("breite_m"), "hoehe_m": n.get("hoehe_m"),
                           "oeffnungsart": n.get("oeffnungsart")}
    return aus


def wand_projekt(typ_ref: str, von: list[float], bis: list[float], hoehe_m: float, z0_m: float = 0.0,
                 verstaerkungen: Optional[list[dict]] = None, staenderwand_als: str = "teile",
                 oeffnungen: Optional[list[dict]] = None, schema: str = "IFC4", k: "Optional[Katalog]" = None,
                 projekt_ordner: Union[str, Path, None] = None,
                 geschoss: str = "EG") -> "tuple[ifcopenshell.file, dict]":
    """IFC model of ONE straight wall from a catalogue type, with doors/windows, neutralised.

    von/bis: wall axis start/end in the storey plane, metres [x, y]; hoehe_m: wall height in m; z0_m: base
    above the storey in m; verstaerkungen: as `wand`; staenderwand_als: "teile" | "schichten";
    oeffnungen: `[{typ (door/window type key), abstand_m (from the wall start to the opening's left edge, m),
    bruestung_m (sill above the wall base, m, default 0)}]`. Site → building → storey `geschoss`, the wall
    typed with its catalogue type (layered: IfcMaterialLayerSetUsage; stud wall: decomposed into parts).
    Element GlobalIds are derived from type and axis, so the same call gives the same file.
    Returns (IFC file, info `{bauplan, laenge_m, winkel_grad, oeffnungen, zaehler, nachlauf}`); ValueError /
    KatalogFehler (German message) on unusable input — nothing is written here."""
    import math
    ek = _katalog_modul()
    ei = _ifc_modul()
    from elmonkey.katalog import bauen
    k = k or katalog(projekt_ordner)
    if staenderwand_als not in ("teile", "schichten"):
        raise ValueError(f"staenderwand_als {staenderwand_als!r} unbekannt — erlaubt: teile, schichten")
    try:
        von2 = [float(von[0]), float(von[1])]
        bis2 = [float(bis[0]), float(bis[1])]
    except (TypeError, ValueError, IndexError) as e:
        raise ValueError("von/bis: je zwei Zahlen [x, y] in Metern") from e
    t = k.typ(typ_ref)
    if t["ifc"]["klasse"] != "IfcWall":
        raise ValueError(f"{t['schluessel']} ist kein Wandtyp ({t['ifc']['klasse']}) — bauen kann nur Wände")
    laenge, winkel = bauen.achse(von2, bis2)
    plan = ek.bauen.wand(k, typ_ref, laenge, float(hoehe_m), verstaerkungen, staenderwand_als)
    s = ei.Schreiber(k, _schema(schema), f"BIT-Atelier Wand {plan.typ.get('kurzname_fest') or t['schluessel']}",
                     **_schreiber_kw())
    gs = s.struktur(geschoss)
    for rel in gs.Decomposes or ():
        rel.RelatingObject.Name = "Gebäude"  # elmonkey names the building of its sample "Muster"
    bauteil_id = f"wand-{t['schluessel']}@{t.get('version', 1)}-{von2[0]:.3f},{von2[1]:.3f}-{bis2[0]:.3f},{bis2[1]:.3f}"
    w = s.wand(plan, bauteil_id, von2, winkel, float(z0_m))
    gesetzt = []
    for i, o in enumerate(oeffnungen or [], 1):
        if not isinstance(o, dict) or not o.get("typ"):
            raise ValueError(f"oeffnungen[{i}]: {{typ, abstand_m, bruestung_m?}} erwartet")
        ot = k.typ(str(o["typ"]))
        if ot["ifc"]["klasse"] not in ("IfcDoor", "IfcWindow"):
            raise ValueError(f"oeffnungen[{i}]: {ot['schluessel']} ist weder Tür noch Fenster")
        abstand = float(o.get("abstand_m", 0.0))
        bruestung = float(o.get("bruestung_m", 0.0))
        s.oeffnung(w, plan, str(o["typ"]), f"{bauteil_id}-oeffnung-{i}", abstand, bruestung)
        gesetzt.append({"typ": ot["schluessel"], "klasse": ot["ifc"]["klasse"], "abstand_m": abstand,
                        "bruestung_m": bruestung})
    f = s.fertig()
    info = {"bauplan": plan.zusammenfassung(), "laenge_m": round(laenge, 4),
            "winkel_grad": round(math.degrees(winkel), 4), "oeffnungen": gesetzt, "zaehler": dict(s.zaehler)}
    info["nachlauf"] = _fertig(f, k)
    return f, info


def schreiben(f: "ifcopenshell.file", pfad: Union[str, Path]) -> Path:
    """Write an IFC file (creates the folder); returns the path."""
    p = Path(pfad)
    p.parent.mkdir(parents=True, exist_ok=True)
    f.write(str(p))
    return p


__all__ = [
    "DATEN", "LAUFZEIT_ORDNER", "MUSTER_ROLLEN", "NAME_MATERIALBIBLIOTHEK", "NAME_MUSTER", "NAME_TYPBIBLIOTHEK",
    "NichtVerfuegbar", "PSET_PRAEFIX", "SCHEMATA", "TEXTUR_URL", "bearbeiten", "katalog", "laufzeit_typen",
    "materialbibliothek", "muster_projekt", "neutral", "pruefen", "schreiben", "speichern", "typ_guid",
    "typbibliothek", "typ_info", "u_wert", "verfuegbar", "wand", "wand_projekt",
]
