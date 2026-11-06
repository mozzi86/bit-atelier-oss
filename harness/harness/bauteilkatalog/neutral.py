"""Name check of the component catalogue (phase 109, D-BKAT-01).

Purpose: the catalogue data, the generated IFC files and the code must not carry names of
foreign products, offices or persons. The words to look for must not stand in the repository
in plain text either, so this module only holds the SHA-256 of each lower-cased word — the
same idea as `tests/unit/sperrliste.sha256.json` of the app.

In:  any text (str).
Out: `treffer(text)` → list of the offending tokens as found in the text (empty = neutral).

Matching is per token: a token is a run of letters (digits, `_`, `-`, `.` and spaces split
tokens). That is stricter than `grep -w` (which treats `_` as part of a word), so a word glued
to an index such as `word_340` is found too. A token is additionally split at lower→upper case
changes (`WordName` → `Word`, `Name`), so a blocked word inside a CamelCase compound is found as well.
"""
from __future__ import annotations

import hashlib
import re
import unicodedata

#: SHA-256 (hex) of the lower-cased words of the name check given by the phase plan (14 words).
GESPERRT: frozenset[str] = frozenset({
    "bac8736b4055203b1e2fbbf131280979d0342920a5d1646e257a9a9e6727fcbd",
    "2993f8453f06da87d9df99e0b35f810a9887a38bfee0523014c52308a67d6b6b",
    "6e8ab60cecce9b2c7df09c49704c414cab26ef39ab62c1eb9634f5e565b5ed61",
    "83cdd1b713f554cfc345fefe974d845baed9e36d2e8ee5e2fee0169f7fb445f7",
    "ac1a1c7143cb2199eb400993a5db42bc2f6d98f6769bb696d04b48d84c68a56f",
    "bb1e854a11b8312c8789b0b1a67c6d45b8478a97d919d4d9b4edb2aee2b27982",
    "5971b0dc06256600737ca8ba133808b5d8122016a777948e998535036594a95b",
    "40cb20962e0a1257f0a4fc98116c416b19f57118c2096aada4359c17608aee6e",
    "ebecac3dbb3428c344df1b9e9656e0648db6b480513e8c763a69b5f0675465d3",
    "55efa080d02d76fdd9021db48718aeababaafa85f082ab4152db505b26f6cbf8",
    "1b3aba5ed8ee468518bfb742ad467cbe4b56309b29d5a5252431b7091016149e",
    "07b4d375aa562f205e8169db3c0a81b5ed8a66255f1dff464b11a0733cc77135",
    "79c86800822fec0e991de54c8001dd338995952667ba8c56c2b454ba40926092",
    "4cbe19716b1aa73a67dc4b28c34391879b503259fc76852082b4dafcf0de85b2",
})

#: Further tokens that point to the source's authoring tool or a manufacturer (object library
#: file types, template file type, a manufacturer, the tool's abbreviation for its solid element
#: operations). Checked on data, package code and generated IFC files.
GESPERRT_DATEN: frozenset[str] = GESPERRT | frozenset({
    "3998ff70f3d37c664178983f816ef9adeaedfda34e7a2415f4bbe9ffa0ea57e3",
    "401ccc1785a6ca3f2af96e28c5bcde830346e229dd37c36fab29fef2f17edd94",
    "75e8e6a504b5a6835e88eaf9d6d130c9fcb2c54e8bcc85b94e8134057f1d703f",
    "63bce8d4edf0cd46fffe9c93a06ed34806202956d17a36a94df37388d9149b51",
    "30f50f7fa4fa466a13861ff1f48759cbc715748bf8fed4810ca68d3ead12d807",
})

#: Neutral replacement for blocked tokens of a material name (key = SHA-256 of the word): a colour
#: word, and the tool abbreviation of a template pseudo-material (→ "Volumenverschneidung", the
#: neutral term for a solid element operation). Everything else blocked is an error, not a rename.
ERSATZ: dict[str, str] = {
    "2993f8453f06da87d9df99e0b35f810a9887a38bfee0523014c52308a67d6b6b": "dunkel",
    "30f50f7fa4fa466a13861ff1f48759cbc715748bf8fed4810ca68d3ead12d807": "volumenverschneidung",
}

_TOKEN = re.compile(r"[^\W\d_]+", re.UNICODE)

#: Split point inside a token: a lower-case letter followed by an upper-case letter (CamelCase).
_CAMEL = re.compile(r"(?<=[a-zäöüß])(?=[A-ZÄÖÜ])")


def _h(token: str) -> str:
    """SHA-256 (hex) of the NFKC-normalised, lower-cased token."""
    return hashlib.sha256(unicodedata.normalize("NFKC", token).lower().encode("utf-8")).hexdigest()


def _gesperrt(token: str, liste: frozenset[str]) -> bool:
    """True when the token or one of its CamelCase parts is in `liste`."""
    if _h(token) in liste:
        return True
    teile = _CAMEL.split(token)
    return len(teile) > 1 and any(_h(t) in liste for t in teile)


def treffer(text: str, liste: frozenset[str] = GESPERRT) -> list[str]:
    """Tokens of `text` that are (or contain as a CamelCase part) a blocked word of `liste`, in order of
    appearance (with repeats)."""
    return [m.group(0) for m in _TOKEN.finditer(text or "") if _gesperrt(m.group(0), liste)]


def ersetzen(text: str, liste: frozenset[str] = GESPERRT_DATEN) -> tuple[str, list[str]]:
    """Replace blocked tokens that have a neutral replacement (`ERSATZ`), keeping the case of the
    first letter. Returns (new text, tokens that are blocked and have NO replacement)."""
    offen: list[str] = []

    def ein(m: re.Match) -> str:
        tok = m.group(0)
        if not _gesperrt(tok, liste):
            return tok
        neu = ERSATZ.get(_h(tok))
        if neu is None:
            offen.append(tok)
            return tok
        return neu.capitalize() if tok[:1].isupper() else neu

    return _TOKEN.sub(ein, text or ""), offen


# ── IFC post-processing (transition) and checks

class NeutralitaetsFehler(RuntimeError):
    """A written IFC file is not neutral after the post-processing (German message, no matched word)."""


#: Classification systems allowed in our IFC files, by their exact `IfcClassification.Name` as the
#: builder writes them: DIN 276 (cost groups) and the bSDD IFC 4.3 classes. Anything else is foreign.
KLASSIFIZIERUNG_ERLAUBT: tuple[str, ...] = ("DIN 276 Kosten im Bauwesen", "bSDD IFC 4.3")

#: Neutral value for a property whose NAME is fine but whose text VALUE trips the name check, keyed by
#: (end of the property set name, property name) — elmonkey 0.3.0 explains the stud-wall-as-layers
#: option with a product name in `<praefix>_Staenderwerk_Bauteil.Ausgabe`.
NEUTRALER_WERT: dict[tuple[str, str], str] = {
    ("_Staenderwerk_Bauteil", "Ausgabe"): "Schichtwand (Option „schichten“: Ständerwerk nur als Eigenschaften)",
}

#: Our texture reference prefix (`ambientcg:<id>` → `<prefix>ambientcg/<id>`, `klasse:<name>` →
#: `<prefix>klasse/<name>`). No third-party URL in our IFC files (109-RESEARCH, "ohne Fremd-URL").
TEXTUR_URN = "urn:bit-atelier:textur/"

#: The public texture URL elmonkey 0.3.0 writes for `ambientcg:<id>` (it ignores `textur_url` there);
#: group 1 = texture id. TRANSITION until elmonkey routes these through `textur_url` too.
_AMBIENTCG_URL = re.compile(r"^https?://(?:www\.)?ambientcg\.com/view\?id=([A-Za-z0-9_-]+)$")

#: Attributes that are identifiers, not text: a GlobalId is base64 and may contain any letter run.
_KEINE_TEXTE = frozenset({"GlobalId"})

#: GlobalId literal in an IFC-SPF text: the FIRST attribute of an entity instance (`#12=IFCWALL('…',`).
#: Only that position is skipped by `pruefe_text`; any other 22-character string is checked.
_GUID_LITERAL = re.compile(r"(=\s*IFC[A-Z0-9_]+\(\s*)'[0-9A-Za-z_$]{22}'")


def klassifizierung_erlaubt(name: str | None) -> bool:
    """True when an IfcClassification name is one of the allowed systems (`KLASSIFIZIERUNG_ERLAUBT`)."""
    return bool(name) and str(name) in KLASSIFIZIERUNG_ERLAUBT


def _neutraler_wert(pset_name: str | None, prop_name: str | None) -> str | None:
    """Neutral replacement value for a property of a given property set, or None."""
    for (ende, name), wert in NEUTRALER_WERT.items():
        if prop_name == name and str(pset_name or "").endswith(ende):
            return wert
    return None


def _texte(wert, aus: list[str]) -> None:
    """Collect the strings of an attribute value (plain, typed value such as IfcLabel, or aggregate)."""
    if isinstance(wert, str):
        aus.append(wert)
    elif isinstance(wert, (tuple, list)):
        for x in wert:
            _texte(x, aus)
    elif hasattr(wert, "wrappedValue") and hasattr(wert, "id") and wert.id() == 0:
        _texte(wert.wrappedValue, aus)


def ifc_treffer(f) -> list[tuple[int, str]]:
    """Name check over every string attribute of an `ifcopenshell.file` (GlobalIds excluded).

    Returns [(entity id, attribute name)] of the attributes that hold a blocked token of
    `GESPERRT_DATEN` — never the token itself, so the result can be printed and logged."""
    aus: list[tuple[int, str]] = []
    for e in f:
        info = e.get_info(include_identifier=False, recursive=False)
        for name, wert in info.items():
            if name in _KEINE_TEXTE or name == "type":
                continue
            texte: list[str] = []
            _texte(wert, texte)
            if any(treffer(t, GESPERRT_DATEN) for t in texte):
                aus.append((e.id(), name))
    return aus


def _eigenschaften(pset) -> tuple[str, list]:
    """(attribute name, properties) of an IfcPropertySet or IfcMaterialProperties/IfcExtendedProperties."""
    if pset.is_a("IfcPropertySet"):
        return "HasProperties", list(pset.HasProperties or ())
    return "Properties", list(pset.Properties or ())


def _pset_entfernen(f, pset) -> None:
    """Remove an emptied property set together with every link to it: IfcRelDefinesByProperties, and the
    `HasPropertySets` list of a type object (OPTIONAL SET [1:?] — an empty list becomes None)."""
    for ref in list(f.get_inverse(pset)):
        if ref.is_a("IfcRelDefinesByProperties"):
            f.remove(ref)
        elif ref.is_a("IfcTypeObject"):
            rest = [p for p in (ref.HasPropertySets or ()) if p != pset]
            ref.HasPropertySets = rest or None
    f.remove(pset)


def _texturen(f, urn: str) -> int:
    """Rewrite third-party texture URLs to our URN; returns the number rewritten."""
    n = 0
    for t in f.by_type("IfcImageTexture"):
        m = _AMBIENTCG_URL.match(t.URLReference or "")
        if m:
            t.URLReference = f"{urn}ambientcg/{m.group(1)}"
            n += 1
    return n


def nachlauf(f, textur_urn: str = TEXTUR_URN) -> dict:
    """Neutralise an IFC file written by elmonkey 0.3.0 in place and verify it (idempotent).

    TRANSITION until elmonkey writes its template-origin keys only when origin data exist: the material
    pset of 0.3.0 always carries origin properties whose names trip the name check, the
    stud-wall-as-layers option carries a product name in a text value, and texture references of
    `ambientcg:<id>` are a third-party URL. Steps:
    1. drop every property whose name holds a token of `GESPERRT_DATEN`;
    2. rewrite a text value with such a token from `NEUTRALER_WERT`, or drop the property;
    3. drop a property set that became empty (IFC requires at least one property), including its
       relation or its place in a type's `HasPropertySets`;
    4. rewrite third-party texture URLs to `<textur_urn>ambientcg/<id>`;
    5. raise `NeutralitaetsFehler` when a classification system other than DIN 276 / bSDD is present,
       a texture reference does not start with `textur_urn`, or any string attribute still trips the
       name check.
    Returns {eigenschaften_entfernt, werte_ersetzt, psets_entfernt, texturen_umgeschrieben,
    klassifizierungen}."""
    entfernt = ersetzt = psets_weg = 0
    psets = list(f.by_type("IfcPropertySet")) + list(f.by_type("IfcExtendedProperties"))
    for pset in psets:
        attr, props = _eigenschaften(pset)
        behalten = []
        for p in props:
            if treffer(p.Name or "", GESPERRT_DATEN):
                f.remove(p)
                entfernt += 1
                continue
            texte: list[str] = []
            if p.is_a("IfcPropertySingleValue"):
                _texte(p.NominalValue, texte)
            if any(treffer(t, GESPERRT_DATEN) for t in texte):
                wert = _neutraler_wert(pset.Name, p.Name)
                if wert is not None:
                    p.NominalValue = f.createIfcText(wert)
                    ersetzt += 1
                else:
                    f.remove(p)
                    entfernt += 1
                    continue
            behalten.append(p)
        if len(behalten) == len(props):
            continue
        if behalten:
            setattr(pset, attr, behalten)
        else:
            _pset_entfernen(f, pset)
            psets_weg += 1
    texturen = _texturen(f, textur_urn)
    systeme = sorted({c.Name or "" for c in f.by_type("IfcClassification")})
    fremd = [s for s in systeme if not klassifizierung_erlaubt(s)]
    if fremd:
        raise NeutralitaetsFehler(f"IFC enthält {len(fremd)} nicht erlaubte Klassifizierung(en) — erlaubt: DIN 276, bSDD")
    fremde_urls = [t for t in f.by_type("IfcImageTexture") if not str(t.URLReference or "").startswith(textur_urn)]
    if fremde_urls:
        raise NeutralitaetsFehler(f"IFC enthält {len(fremde_urls)} Textur-Verweis(e) außerhalb von {textur_urn} "
                                  f"(erste Entität #{fremde_urls[0].id()})")
    rest = ifc_treffer(f)
    if rest:
        raise NeutralitaetsFehler(f"IFC enthält nach dem Nachlauf noch {len(rest)} Treffer der Namensprüfung "
                                  f"(erste Entität #{rest[0][0]}, Attribut {rest[0][1]})")
    return {"eigenschaften_entfernt": entfernt, "werte_ersetzt": ersetzt, "psets_entfernt": psets_weg,
            "texturen_umgeschrieben": texturen, "klassifizierungen": systeme}


def pruefe_text(pfad) -> list[str]:
    """Name check of one file on disk (data, code or IFC-SPF text) against `GESPERRT_DATEN`.

    IFC files: the GlobalId literal (first attribute of an entity instance) is skipped — an identifier,
    not text; every other string is checked. Returns the blocked
    tokens found (empty = neutral); binary files that are not UTF-8 are read with replacement."""
    from pathlib import Path

    p = Path(pfad)
    text = p.read_text(encoding="utf-8", errors="replace")
    if p.suffix.lower() == ".ifc":
        text = _GUID_LITERAL.sub(r"\1''", text)
    return treffer(text, GESPERRT_DATEN) + treffer(p.name, GESPERRT_DATEN)
