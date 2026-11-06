"""One-off conversion tool: delivered component catalogue data → neutral catalogue data (phase 109, D-BKAT-01).

In:  path of the delivered data folder (argument; never a constant here), holding
     `baustoffe.json`, `profile.json`, `verstaerkungen.json` and `typen/*.json`.
Out: `harness/harness/bauteilkatalog/daten/` (or `--ziel`): `baustoffe.json` and `typen/*.json`; the type
     file that is not `muster_und_rohlinge.json` becomes `typen/grundbestand.json`. Profiles and
     reinforcements are NOT written: the builder (elmonkey-core 0.3.0) ships them as package data, and the
     tool only verifies that the delivered values equal those package data. Prints a count and exits 1
     when the result fails the name check, loses referential integrity or the package data differ.

What it does:
- drops `herkunft` (template origin) everywhere and every field whose name carries a blocked token
  (authoring-tool fields of layers, foreign classification, object-library references);
- renames materials whose name or key carries a blocked word with a neutral replacement (colour word,
  tool abbreviation; `harness.bauteilkatalog.neutral.ERSATZ`) and follows the new keys in all references;
- rebuilds the keys of door/window types from their description and size (the delivered keys carry
  a catalogue/product identifier);
- checks profiles and reinforcements (after dropping fields) against the elmonkey package data;
- verifies that values (λ, ρ, c, grey energy, CO₂, colours, textures, hatches, layer build-ups,
  DIN 276, bSDD, profiles, reinforcements) are unchanged and that every reference resolves.

Run once from the repository root:
    harness/.venv/Scripts/python -I harness/tools/bauteilkatalog_neutral.py <data folder>
"""
from __future__ import annotations

import argparse
import copy
import json
import re
import sys
from pathlib import Path

HARNESS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HARNESS))

from harness.bauteilkatalog.neutral import GESPERRT_DATEN, ersetzen, treffer  # noqa: E402

QUELLE = "Erstbestand BIT-Atelier, 05.11.2026"
MUSTER_DATEI = "muster_und_rohlinge.json"
ZIEL = HARNESS / "harness" / "bauteilkatalog" / "daten"

#: Opening material slots that reference a material key.
OEFFNUNG_TEILE = ("zarge", "blatt", "fluegel", "verglasung")


class Abbruch(RuntimeError):
    """Conversion stopped — the message says why (German, for the operator)."""


def _lies(p: Path) -> dict:
    return json.loads(p.read_text(encoding="utf-8"))


def _felder_entfernen(o, zaehler: dict[str, int]):
    """Recursively drop `herkunft` and every key whose tokens fail the name check; count per key."""
    if isinstance(o, dict):
        for k in list(o):
            if k == "herkunft" or treffer(k, GESPERRT_DATEN):
                zaehler[k] = zaehler.get(k, 0) + 1
                del o[k]
            else:
                _felder_entfernen(o[k], zaehler)
    elif isinstance(o, list):
        for x in o:
            _felder_entfernen(x, zaehler)
    return o


def _slug(s: str) -> str:
    s = s.lower()
    for a, b in (("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("ß", "ss")):
        s = s.replace(a, b)
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def _cm_schluessel(m: float) -> str:
    """Metres → centimetre text for keys: 0.885 → '88-5', 1.26 → '126'."""
    return f"{round(m * 100, 1):g}".replace(".", "-")


def oeffnung_schluessel(t: dict) -> str:
    """Neutral key of a door/window type from description and size (width × height in cm)."""
    pre = "tuer" if t["ifc"]["klasse"] == "IfcDoor" else "fenster"
    teile = [pre, _slug(t.get("bezeichnung") or ""), f"{_cm_schluessel(t['breite_m'])}x{_cm_schluessel(t['hoehe_m'])}"]
    return "-".join(x for x in teile if x)


def umsetzen(quelle: Path) -> tuple[dict[str, dict], dict]:
    """Convert the data folder. Returns ({relative output path: JSON}, report)."""
    baustoffe_roh = _lies(quelle / "baustoffe.json")
    profile_roh = _lies(quelle / "profile.json")
    verst_roh = _lies(quelle / "verstaerkungen.json")
    typ_dateien = sorted((quelle / "typen").glob("*.json"))
    andere = [p for p in typ_dateien if p.name != MUSTER_DATEI]
    if len(andere) != 1 or len(typ_dateien) != 2:
        raise Abbruch(f"typen/: erwartet {MUSTER_DATEI} und genau eine weitere Datei, gefunden {len(typ_dateien)}")
    typen_roh = {"typen/grundbestand.json": _lies(andere[0]), f"typen/{MUSTER_DATEI}": _lies(quelle / "typen" / MUSTER_DATEI)}

    entfernt: dict[str, int] = {}
    # ── materials: rename blocked words that have a neutral replacement, map old → new key
    baustoffe = _felder_entfernen(copy.deepcopy(baustoffe_roh), entfernt)
    schluessel_neu: dict[str, str] = {}
    umbenannt = 0
    for b in baustoffe["baustoffe"]:
        alt = b["schluessel"]
        neu_s, offen1 = ersetzen(alt)
        neu_n, offen2 = ersetzen(b["name"])
        if offen1 or offen2:
            raise Abbruch(f"Baustoff {alt}: Namensprüfung ohne neutralen Ersatz ({len(offen1) + len(offen2)} Treffer)")
        if (neu_s, neu_n) != (alt, b["name"]):
            umbenannt += 1
        b["schluessel"], b["name"] = neu_s, neu_n
        schluessel_neu[alt] = neu_s
    if len(set(schluessel_neu.values())) != len(schluessel_neu):
        raise Abbruch("Baustoff-Schlüssel nach dem Umbenennen nicht mehr eindeutig")
    baustoffe["quelle"] = QUELLE
    baustoffe["anzahl"] = len(baustoffe["baustoffe"])

    def neu(k: str | None) -> str | None:
        if k is None:
            return None
        if k not in schluessel_neu:
            raise Abbruch(f"Verweis auf unbekannten Baustoff {k!r}")
        return schluessel_neu[k]

    # ── types
    aus: dict[str, dict] = {"baustoffe.json": baustoffe}
    oeffnungen_umbenannt = 0
    for rel, roh in typen_roh.items():
        d = _felder_entfernen(copy.deepcopy(roh), entfernt)
        d["quelle"] = QUELLE
        for t in d["typen"]:
            for s in t.get("schichten") or []:
                s["baustoff"] = neu(s["baustoff"])
            for teil in OEFFNUNG_TEILE:
                if isinstance(t.get(teil), dict) and t[teil].get("baustoff"):
                    t[teil]["baustoff"] = neu(t[teil]["baustoff"])
            if t["ifc"]["klasse"] in ("IfcDoor", "IfcWindow") and not t.get("rohling"):
                k = oeffnung_schluessel(t)
                if k != t["schluessel"]:
                    oeffnungen_umbenannt += 1
                t["schluessel"] = k
        aus[rel] = d

    # ── profiles and reinforcements: only checked against the builder's package data, not written
    profile = _felder_entfernen(copy.deepcopy(profile_roh), entfernt)
    for p in profile["profile"]:
        p["baustoff"] = neu(p["baustoff"])
    verst = _felder_entfernen(copy.deepcopy(verst_roh), entfernt)
    for v in verst["verstaerkungen"]:
        v["baustoff"] = neu(v["baustoff"])
    _paketdaten_gleich(profile, verst)

    _werte_gleich(baustoffe_roh, typen_roh, aus, schluessel_neu)
    _integritaet({**aus, "profile.json": profile, "verstaerkungen.json": verst})
    typen_n = sum(len(aus[r]["typen"]) for r in typen_roh)
    bericht = {"baustoffe": len(baustoffe["baustoffe"]), "typen": typen_n,
               "baustoffe_umbenannt": umbenannt, "oeffnungen_umbenannt": oeffnungen_umbenannt,
               "felder_entfernt": sum(entfernt.values()), "felder_entfernt_je_schluessel": entfernt}
    for rel, d in aus.items():
        hits = treffer(json.dumps(d, ensure_ascii=False), GESPERRT_DATEN)
        if hits:
            raise Abbruch(f"{rel}: nach der Umsetzung noch {len(hits)} Treffer der Namensprüfung")
    return aus, bericht


def _werte_gleich(baustoffe_roh: dict, typen_roh: dict, aus: dict, sn: dict[str, str]) -> None:
    """Values must survive unchanged — only keys, names and dropped fields may differ."""
    neu_b = {b["schluessel"]: b for b in aus["baustoffe.json"]["baustoffe"]}
    for b in baustoffe_roh["baustoffe"]:
        n = neu_b[sn[b["schluessel"]]]
        for f in ("werkstoffklasse", "kategorie_ifc", "verschneidungsprioritaet", "kennwerte", "farbe", "textur",
                  "schraffur", "kurz"):
            if b.get(f) != n.get(f):
                raise Abbruch(f"Baustoff {n['schluessel']}: Feld {f} verändert")
    for rel, roh in typen_roh.items():
        for a, n in zip(roh["typen"], aus[rel]["typen"]):
            sa, sn_ = a.get("schichten") or [], n.get("schichten") or []
            if len(sa) != len(sn_):
                raise Abbruch(f"Typ {n['schluessel']}: Schichtzahl verändert")
            for x, y in zip(sa, sn_):
                for f in ("dicke_m", "rolle", "staenderwerk", "belueftet"):
                    if x.get(f) != y.get(f):
                        raise Abbruch(f"Typ {n['schluessel']}: Schicht-Feld {f} verändert")
                if sn[x["baustoff"]] != y["baustoff"]:
                    raise Abbruch(f"Typ {n['schluessel']}: Schicht-Baustoff falsch zugeordnet")
            for f in ("ifc", "pset_common", "version", "rohling", "kurzname_fest", "breite_m", "hoehe_m", "oeffnungsart"):
                if a.get(f) != n.get(f):
                    raise Abbruch(f"Typ {n['schluessel']}: Feld {f} verändert")
            ka, kn = a.get("klassifizierung") or {}, n.get("klassifizierung") or {}
            if ka.get("din276") != kn.get("din276") or ka.get("bsdd_klasse") != kn.get("bsdd_klasse"):
                raise Abbruch(f"Typ {n['schluessel']}: DIN 276 / bSDD verändert")


def _paketdaten_gleich(profile: dict, verst: dict) -> None:
    """Profiles and reinforcements must equal the builder's package data (only the free-text note may
    differ), otherwise the catalogue would have to ship its own copies."""
    from elmonkey.katalog.modell import paketdaten

    paket_profile = paketdaten("profile.json")
    if (profile["profile"] != paket_profile["profile"]
            or profile.get("uw_zu_cw") != paket_profile.get("uw_zu_cw")):
        raise Abbruch("profile.json weicht von den Paketdaten des Bauers ab — eigene Datei nötig")
    if verst["verstaerkungen"] != paketdaten("verstaerkungen.json")["verstaerkungen"]:
        raise Abbruch("verstaerkungen.json weicht von den Paketdaten des Bauers ab — eigene Datei nötig")


def _integritaet(aus: dict) -> None:
    """Every layer → material, every stud frame → profile, every profile/reinforcement → material."""
    b = {x["schluessel"] for x in aus["baustoffe.json"]["baustoffe"]}
    prof = {p["schluessel"] for p in aus["profile.json"]["profile"]}
    for p in aus["profile.json"]["profile"]:
        if p["baustoff"] not in b:
            raise Abbruch(f"Profil {p['schluessel']}: Baustoff fehlt")
    for c, u in (aus["profile.json"].get("uw_zu_cw") or {}).items():
        if c not in prof or u not in prof:
            raise Abbruch(f"uw_zu_cw {c}→{u}: Profil fehlt")
    for v in aus["verstaerkungen.json"]["verstaerkungen"]:
        if v["baustoff"] not in b:
            raise Abbruch(f"Verstärkung {v['schluessel']}: Baustoff fehlt")
    schluessel: set[str] = set()
    for rel in ("typen/grundbestand.json", f"typen/{MUSTER_DATEI}"):
        for t in aus[rel]["typen"]:
            if t["schluessel"] in schluessel:
                raise Abbruch(f"Typ-Schlüssel {t['schluessel']} doppelt")
            schluessel.add(t["schluessel"])
            for s in t.get("schichten") or []:
                if s["baustoff"] not in b:
                    raise Abbruch(f"Typ {t['schluessel']}: Schicht-Baustoff fehlt")
                if s.get("staenderwerk") and s["staenderwerk"]["profil"] not in prof:
                    raise Abbruch(f"Typ {t['schluessel']}: Profil fehlt")
            for teil in OEFFNUNG_TEILE:
                if isinstance(t.get(teil), dict) and t[teil].get("baustoff") and t[teil]["baustoff"] not in b:
                    raise Abbruch(f"Typ {t['schluessel']}: {teil}-Baustoff fehlt")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Bauteilkatalog-Daten neutral umsetzen (einmalig)")
    ap.add_argument("quelle", type=Path, help="Ordner mit baustoffe.json, profile.json, verstaerkungen.json, typen/")
    ap.add_argument("--ziel", type=Path, default=ZIEL)
    a = ap.parse_args(argv)
    try:
        aus, bericht = umsetzen(a.quelle)
    except (Abbruch, OSError, KeyError, ImportError, json.JSONDecodeError) as e:
        print(f"Abbruch: {e}", file=sys.stderr)
        return 1
    for rel, d in aus.items():
        p = a.ziel / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(d, ensure_ascii=False, indent=1) + "\n", encoding="utf-8",
                     newline="\n")
    print(json.dumps(bericht, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
