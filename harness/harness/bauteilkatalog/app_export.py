"""App export of the component catalogue (plan 114-01, D-MH-01…03): the neutral catalogue as one JSON for the app.

Why: the house builder of the app (BIM studio) must know the catalogue types (layer build-ups, materials,
type GUIDs) without a running harness (local-first). The building logic stays in elmonkey; the app only gets
the DATA, generated here from the loaded catalogue — `packages/nova-core/src/lib/bauteil/katalog/katalog.json`
is never edited by hand (a harness test compares it byte for byte with a fresh export).

Content (base stock only, no runtime types — those come with a proposal from the harness, 114-04):
- `typen`: per type `schluessel, version, rohling, klasse, predefined_type, kurzname, langname, dicke_m (m),
  din276, pset_common, schichten[{baustoff, dicke_m (m), rolle, staenderwerk?}], oeffnung? {breite_m, hoehe_m,
  oeffnungsart} (doors/windows), typ_guid` — sorted by key, then version. `typ_guid` is the final GUID of our
  IFC files (`guids.typ_guid`, own uuid5 namespace): the ONE place where type GUIDs are made (D-MH-03);
- `baustoffe`: per material `schluessel, name, kurz, werkstoffklasse, farbe, verschneidungsprioritaet (0–999),
  kennwerte {lambda_W_mK, dichte_kg_m3, waermekapazitaet_J_kgK, graue_energie_MJ_kg, co2_kg_kg}` — sorted by key;
- head: `quelle` ("elmonkey-core <version>"), `inhalt_sha256` (SHA-256 of the canonical JSON of
  `{"baustoffe": …, "typen": …}`: sorted keys, no whitespace, UTF-8) and `hinweis` (how to regenerate).

Format: `json.dumps(…, ensure_ascii=False, indent=1, sort_keys=True)` + "\\n", UTF-8, LF line ends — so the file
is byte-stable across machines. The written file is name-checked (`neutral.pruefe_text`); a hit aborts.

In:  the catalogue (`katalog()` without a project = base stock), a target path.
Out: `app_katalog()` → dict; `app_export_text()` → str; `app_export(pfad)` → Path (file written).
"""
from __future__ import annotations

import hashlib
import json
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import TYPE_CHECKING, Any, Optional, Union

from . import neutral

if TYPE_CHECKING:  # pragma: no cover - typing only
    from elmonkey.katalog import Katalog

#: Repo path of the app copy, relative to the repository root (the harness folder's parent).
APP_KATALOG_REL = Path("packages") / "nova-core" / "src" / "lib" / "bauteil" / "katalog" / "katalog.json"

#: Command that regenerates the app copy (cwd = harness folder); quoted in the file head and in test messages.
BEFEHL = "python -m harness.bauteilkatalog app-export ../" + APP_KATALOG_REL.as_posix()

#: Material fields copied into the export (the app needs no hatch/texture/IFC category from here: hatch and colour
#: of the layer stack are mapped in the app, the 3D appearance reads its own data, see bauteil/erscheinung.js).
_BAUSTOFF_FELDER = ("schluessel", "name", "kurz", "werkstoffklasse", "farbe", "verschneidungsprioritaet", "kennwerte")


def app_katalog_pfad() -> Path:
    """Absolute path of `katalog.json` in this repository (harness folder's parent + `APP_KATALOG_REL`)."""
    from harness.config import HARNESS_DIR
    return Path(HARNESS_DIR).resolve().parent / APP_KATALOG_REL


def _elmonkey_version() -> str:
    try:
        return version("elmonkey-core")
    except PackageNotFoundError:  # pragma: no cover - the catalogue cannot load without it anyway
        return "unbekannt"


def _typ(t: dict, k: "Katalog") -> dict[str, Any]:
    """One type in the app form (fields see module doc; lengths in m)."""
    from . import typ_info
    i = typ_info(t, k, ausfuehrlich=True)
    schichten = []
    for s in i["schichten"]:
        z: dict[str, Any] = {"baustoff": s["baustoff"], "dicke_m": s["dicke_m"], "rolle": s.get("rolle")}
        if s.get("staenderwerk"):
            z["staenderwerk"] = s["staenderwerk"]
        schichten.append(z)
    aus: dict[str, Any] = {
        "schluessel": i["schluessel"], "version": i["version"], "rohling": i["rohling"], "klasse": i["klasse"],
        "predefined_type": i["predefined_type"], "kurzname": i["kurzname"], "langname": i["langname"],
        "dicke_m": i["dicke_m"], "din276": i["din276"], "pset_common": i["pset_common"], "schichten": schichten,
        "typ_guid": i["typ_guid"],
    }
    if "oeffnung" in i:
        aus["oeffnung"] = i["oeffnung"]
    return aus


def inhalt_sha256(inhalt: dict) -> str:
    """SHA-256 (hex) of the canonical JSON of `{"baustoffe", "typen"}` (sorted keys, no whitespace, UTF-8)."""
    kern = {"baustoffe": inhalt["baustoffe"], "typen": inhalt["typen"]}
    text = json.dumps(kern, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def app_katalog(k: "Optional[Katalog]" = None) -> dict[str, Any]:
    """The app catalogue as a dict (base stock only; runtime types of `k` are skipped).

    k: a loaded catalogue, default `katalog()` without a project."""
    from . import katalog
    k = k or katalog()
    typen = [_typ(t, k)
             for s in sorted(k.versionen)
             for v, t in sorted(k.versionen[s].items())
             if t.get("ebene", "grundbestand") != "laufzeit"]
    baustoffe = [{f: b.get(f) for f in _BAUSTOFF_FELDER}
                 for b in sorted(k.baustoffe.values() if isinstance(k.baustoffe, dict) else k.baustoffe,
                                 key=lambda b: b["schluessel"])]
    inhalt: dict[str, Any] = {"baustoffe": baustoffe, "typen": typen}
    inhalt["inhalt_sha256"] = inhalt_sha256(inhalt)
    inhalt["quelle"] = f"elmonkey-core {_elmonkey_version()}"
    inhalt["hinweis"] = f"ERZEUGT aus dem Bauteilkatalog des Harness — nicht von Hand ändern. Neu erzeugen: {BEFEHL}"
    return inhalt


def app_export_text(k: "Optional[Katalog]" = None) -> str:
    """The exact file text of the app export (indent 1, sorted keys, trailing LF)."""
    return json.dumps(app_katalog(k), ensure_ascii=False, indent=1, sort_keys=True) + "\n"


def app_export(pfad: Union[str, Path], k: "Optional[Katalog]" = None) -> Path:
    """Write the app export to `pfad` (UTF-8, LF; creates the folder) and name-check the written file.

    Raises `neutral.NeutralitaetsFehler` (German message) when the written file has a name-check hit — the
    file is removed again then, so no non-neutral copy stays on disk. Returns the path."""
    p = Path(pfad)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(app_export_text(k), encoding="utf-8", newline="\n")
    treffer = neutral.pruefe_text(p)
    if treffer:
        p.unlink()
        raise neutral.NeutralitaetsFehler(f"App-Export {p.name}: {len(treffer)} Treffer der Namensprüfung — "
                                          "Datei nicht geschrieben")
    return p
