"""Own GlobalId namespace of the component catalogue (phase 109, 109-RESEARCH "eigener uuid5-Namensraum").

Purpose: elmonkey-core 0.3.0 derives every GlobalId from a hard-wired uuid5 namespace that it shares with
the delivered source package — our neutral IFC files would carry the same identities as the source
samples (traceable origin, colliding identities in a federation). Until elmonkey takes the namespace as
a parameter (proposal, the user's own repo), this module rewrites every GlobalId of a written file into
the BIT-Atelier namespaces, deterministically:

- type objects: `uuid5(NAMENSRAUM_TYP, "<schluessel>@<version>")` — the same recipe as elmonkey, only
  with our namespace, so a later switch to an elmonkey namespace parameter keeps these GUIDs. Runtime
  types (`ebene == "laufzeit"`) add `#<inhalt>` (hash of the stored definition): runtime versions are
  counted per project, so `schluessel@version` alone may name two different build-ups in two projects;
- every other IfcRoot entity: `uuid5(NAMENSRAUM_GID, "<elmonkey GlobalId>")`, extended by the content
  hashes of the runtime types it relates to (relations, a type's own property sets), for the same reason.

In:  an `ifcopenshell.file` written by elmonkey and the `Katalog` it was written from.
Out: the file, changed in place; `typ_guid(t)` gives the final GUID of a catalogue type.
"""
from __future__ import annotations

import hashlib
import json
import uuid
from typing import TYPE_CHECKING

if TYPE_CHECKING:  # pragma: no cover - typing only
    import ifcopenshell
    from elmonkey.katalog import Katalog

#: Namespace of catalogue type GUIDs (derived from our URN, so it is reproducible without a magic value).
NAMENSRAUM_TYP = uuid.uuid5(uuid.NAMESPACE_URL, "urn:bit-atelier:bauteilkatalog:typ")

#: Namespace of all other GlobalIds of catalogue IFC files.
NAMENSRAUM_GID = uuid.uuid5(uuid.NAMESPACE_URL, "urn:bit-atelier:bauteilkatalog:globalid")

#: Fields that do not define a runtime type's content: derived names/fingerprint, the edit log
#: (author, time — two projects applying the same edit must get the same type) and the layer flag.
_NICHT_INHALT = ("kurzname", "langname", "fingerabdruck", "aenderung", "ebene")

_B64 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$"


def _komprimieren(u: uuid.UUID) -> str:
    """128-bit UUID → 22-character IFC GlobalId (IFC base64 alphabet, same as ifcopenshell.guid.compress)."""
    n = u.int
    aus = []
    for _ in range(21):
        aus.append(_B64[n & 63])
        n >>= 6
    aus.append(_B64[n])
    return "".join(reversed(aus))


def inhalt(t: dict) -> str:
    """Content hash (16 hex) of a runtime type: canonical JSON of the stored definition."""
    kern = {k: v for k, v in t.items() if k not in _NICHT_INHALT}
    return hashlib.sha256(json.dumps(kern, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()[:16]


def _salz(t: dict) -> str:
    """'' for base stock types, the content hash for runtime types."""
    return inhalt(t) if t.get("ebene") == "laufzeit" else ""


def typ_guid(t: dict) -> str:
    """Final IFC GlobalId (22 characters) of a catalogue type in our files — stable across exports."""
    seed = f"{t['schluessel']}@{int(t.get('version', 1))}"
    salz = _salz(t)
    return _komprimieren(uuid.uuid5(NAMENSRAUM_TYP, f"{seed}#{salz}" if salz else seed))


def _bezuege(e) -> list:
    """Entity instances referenced directly by the attributes of `e` (plain or in aggregates)."""
    aus: list = []

    def sammle(w) -> None:
        if isinstance(w, (tuple, list)):
            for x in w:
                sammle(x)
        elif hasattr(w, "is_a") and hasattr(w, "id") and w.id():
            aus.append(w)

    for i in range(len(e)):
        sammle(e[i])
    return aus


def umschluesseln(f: "ifcopenshell.file", k: "Katalog") -> int:
    """Rewrite every GlobalId of `f` into our namespaces (see module doc); returns the number rewritten.

    Raises RuntimeError (German message) when the result would not be unique — then the file is not
    safe to write. Call this exactly once per written file (it maps elmonkey GUIDs, not its own)."""
    from elmonkey.katalog import typ_guid as el_typ_guid

    typ_alt_neu: dict[str, tuple[str, str]] = {}
    for versionen in k.versionen.values():
        for t in versionen.values():
            typ_alt_neu[el_typ_guid(t)] = (typ_guid(t), _salz(t))
    salz_von: dict[int, str] = {}
    for tt in f.by_type("IfcTypeObject"):
        neu = typ_alt_neu.get(tt.GlobalId)
        if neu and neu[1]:
            salz_von[tt.id()] = neu[1]

    neue: dict[int, str] = {}
    for e in f.by_type("IfcRoot"):
        alt = e.GlobalId
        if e.is_a("IfcTypeObject") and alt in typ_alt_neu:
            neue[e.id()] = typ_alt_neu[alt][0]
            continue
        salze = set()
        if salz_von:
            for x in _bezuege(e) + list(f.get_inverse(e)):
                if x.id() in salz_von:
                    salze.add(salz_von[x.id()])
        seed = alt + ("#" + "#".join(sorted(salze)) if salze else "")
        neue[e.id()] = _komprimieren(uuid.uuid5(NAMENSRAUM_GID, seed))
    if len(set(neue.values())) != len(neue):
        raise RuntimeError("GlobalIds nach dem Umschlüsseln nicht eindeutig — Datei nicht geschrieben")
    for eid, g in neue.items():
        f.by_id(eid).GlobalId = g
    return len(neue)
