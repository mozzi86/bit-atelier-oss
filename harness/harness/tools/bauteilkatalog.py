"""bauteilkatalog_* — the component catalogue of phase 109 as harness tools (plan 109-02).

Five tools in the toolset `both` (user AND developer), all on top of the adapter `harness.bauteilkatalog`
(builder = elmonkey-core 0.3.0, extra `[katalog]`):

- bauteilkatalog_lesen       list/filter types or materials, or one type in detail (layers, U-value, versions)
- bauteilkatalog_bauen       one straight wall from a catalogue type (+ doors/windows) → NEW IFC file in model/
- bauteilkatalog_bearbeiten  editing operations → new runtime type/version in the project (base stock untouched)
- bauteilkatalog_bibliothek  material library / type library / sample project as IFC4 or IFC4X3
- bauteilkatalog_pruefen     check an IFC file: WHERE rules, proxies, elements without type, neutrality,
                             catalogue types used (Pset_BIT_Katalog)

Confirmation path: the same as `ifc_run` — writing tools write only inside the sandbox of the ACTIVE
project and never overwrite: every output gets a free name (`<name>.ifc`, `<name>_v2.ifc`, …), a runtime type
gets a new version. No tool asks for approval, as none of them touches anything outside the project. The
speech profile never sees these tools (its registry is the MCP bridge's, see harness/mcp/bridge.py).

In:  JSON arguments (lengths in metres), ToolContext (project folder, sandbox roots).
Out: JSON strings via tool_ok / tool_error; German messages; read results carry the data-not-instruction note.
IFC building and checking run in a worker thread (a check of a big file must not block the service), one at a
time per process (`_IFC_SPERRE`: ifcopenshell is not thread-safe).
"""

from __future__ import annotations

import asyncio
import re
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from harness.agent.context import DATA_NOT_INSTRUCTION
from harness.tools.ifc import _neueste_modelldatei, _viewer_link, _ziel
from harness.tools.registry import ToolContext, registry, tool_error, tool_ok
from harness.tools.sandbox import resolve_in_sandbox

#: Output folder of the libraries inside the project (models go to model/, where the viewer finds them).
BIBLIOTHEK_ORDNER = Path("bauteilkatalog") / "ifc"

#: Default and maximum number of list rows of bauteilkatalog_lesen (keeps the tool answer small).
LISTE_STANDARD = 50
LISTE_MAX = 200

#: Author of an edit made through the harness (stored in the runtime type's `aenderung`).
AUTOR = "Harness-Agent"

_ARTEN_BIBLIOTHEK = ("material", "typen", "muster")

#: Serialises ALL ifcopenshell work of these tools (build, write, check) across worker threads of the process:
#: ifcopenshell is not thread-safe — two builds in parallel threads corrupted its global state for the rest of
#: the process (later IFC work failed with AttributeError in ifcopenshell.api; found by the test suite,
#: 08.11.). It also makes "choose a free name + write" atomic, so parallel calls never share a file. Several
#: chat sessions of one harness service can call tools at the same time; within one session the loop is
#: sequential anyway.
_IFC_SPERRE = threading.Lock()


async def _im_thread(fn, *args):
    """Run `fn(*args)` in a worker thread while holding `_IFC_SPERRE` (keeps the event loop free)."""
    def gesperrt():
        with _IFC_SPERRE:
            return fn(*args)
    return await asyncio.to_thread(gesperrt)


class EingabeFehler(ValueError):
    """Unusable tool input (wrong type of a number etc.); German message."""


def _wahr(v: Any, standard: bool = True) -> bool:
    """Boolean tool argument; also accepts the strings "true"/"false"/"ja"/"nein"/"0"/"1" from weak models."""
    if v is None:
        return standard
    if isinstance(v, str):
        return v.strip().lower() not in ("false", "nein", "0", "no", "aus", "")
    return bool(v)


def _zahl(v: Any, feld: str, standard: float | None = None) -> float:
    """A number argument in metres; EingabeFehler naming the field when it is not a number."""
    if v is None or v == "":
        if standard is None:
            raise EingabeFehler(f"{feld}: Zahl (Meter) fehlt")
        return standard
    if isinstance(v, bool):
        raise EingabeFehler(f"{feld}: Zahl (Meter) erwartet, nicht {v!r}")
    try:
        return float(v)
    except (TypeError, ValueError):
        raise EingabeFehler(f"{feld}: Zahl (Meter) erwartet, nicht {v!r}") from None


def _bk():
    """The adapter, or a German error text when the extras are missing (no silent fallback)."""
    from harness import bauteilkatalog as bk

    try:
        bk._ifc_modul()
    except bk.NichtVerfuegbar as exc:
        return None, str(exc)
    return bk, None


def _katalog_fehler() -> tuple[type[BaseException], ...]:
    from elmonkey.katalog import KatalogFehler

    # TypeError: a wrong JSON type deep in elmonkey (e.g. dicke_m: null) - reported, not crashed.
    return (KatalogFehler, ValueError, TypeError)


def _projekt(ctx: ToolContext) -> Path:
    """Active project folder; ValueError when there is none (writing tools need one)."""
    if not ctx.project_dir:
        raise ValueError("Kein aktives Projekt — der Bauteilkatalog schreibt nur in einen Projektordner "
                         "(Projekt wählen, dann erneut)")
    return ctx.project_dir


def _freier_pfad(p: Path) -> Path:
    """`p` itself when free, else `<stem>_v2<suffix>`, `_v3`, … — written files never overwrite."""
    if not p.exists():
        return p
    stamm = re.sub(r"_v\d+$", "", p.stem)
    n = 2
    while (kandidat := p.with_name(f"{stamm}_v{n}{p.suffix}")).exists():
        n += 1
    return kandidat


def _ausgabe(raw: str | None, standard: Path, ctx: ToolContext) -> Path:
    """Output path: `raw` (sandbox-checked, must end in .ifc, must lie in the ACTIVE project - in developer
    mode the sandbox also holds the repo, which a catalogue tool must not write into) or `standard` below the
    project; never an existing file (see `_freier_pfad`). Call under `_IFC_SPERRE`."""
    projekt = _projekt(ctx).resolve()
    if raw and str(raw).strip():
        p = resolve_in_sandbox(str(raw).strip(), ctx, must_exist=False)
        if p.suffix.lower() != ".ifc":
            raise ValueError(f"datei muss auf .ifc enden: {raw}")
        if not p.is_relative_to(projekt):
            raise ValueError(f"datei muss im aktiven Projekt liegen: {raw}")
    else:
        p = (projekt / standard).resolve()
    return _freier_pfad(p)


def _rel(p: Path, ctx: ToolContext) -> str:
    """Path relative to the project folder when inside it (for messages), else absolute."""
    if ctx.project_dir:
        try:
            return p.resolve().relative_to(ctx.project_dir.resolve()).as_posix()
        except ValueError:
            pass
    return str(p)


def _kurzbericht(bericht: dict) -> dict:
    """The parts of a check report that belong into a tool answer."""
    return {x: bericht.get(x) for x in ("gueltig", "anzahl_fehler", "fehler", "proxys", "ohne_typ", "materialien",
                                        "typen", "klassifizierungen", "neutral")}


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9-]+", "-", s.lower()).strip("-")[:80] or "wand"


# ── bauteilkatalog_lesen

def _passt(text: str, suche: str) -> bool:
    return all(w in text for w in suche.lower().split())


def lesen(args: dict, ctx: ToolContext) -> str:
    """Tool handler: one type in detail (`schluessel`), or a filtered list of types or materials."""
    bk, fehler = _bk()
    if fehler:
        return tool_error(fehler)
    try:
        k = bk.katalog(ctx.project_dir)
    except _katalog_fehler() as exc:
        return tool_error(f"Katalog nicht ladbar: {exc}")
    schluessel = str(args.get("schluessel") or "").strip()
    if schluessel:
        try:
            info = bk.typ_info(k.typ(schluessel), k, ausfuehrlich=True)
        except _katalog_fehler() as exc:
            return tool_error(str(exc))
        return tool_ok(hinweis=DATA_NOT_INSTRUCTION, typ=info)

    art = str(args.get("art") or "typen").strip().lower()
    suche = str(args.get("suche") or "").strip()
    try:
        limit = max(1, min(int(args.get("limit") or LISTE_STANDARD), LISTE_MAX))
    except (TypeError, ValueError):
        return tool_error("limit muss eine Zahl sein")
    if art == "baustoffe":
        klasse = str(args.get("werkstoffklasse") or "").strip().lower()
        zeilen = []
        for b in k.baustoffe.values():
            text = " ".join(str(b.get(x) or "") for x in ("schluessel", "name", "kurz", "werkstoffklasse")).lower()
            if klasse and str(b.get("werkstoffklasse") or "").lower() != klasse:
                continue
            if suche and not _passt(text, suche):
                continue
            kw = b.get("kennwerte") or {}
            zeilen.append({"schluessel": b["schluessel"], "name": b.get("name"), "kurz": b.get("kurz"),
                           "werkstoffklasse": b.get("werkstoffklasse"), "lambda_W_mK": kw.get("lambda_W_mK"),
                           "dichte_kg_m3": kw.get("dichte_kg_m3")})
        return tool_ok(hinweis=DATA_NOT_INSTRUCTION, art="baustoffe", anzahl=len(zeilen),
                       gekuerzt=len(zeilen) > limit, baustoffe=zeilen[:limit])
    if art != "typen":
        return tool_error(f"art {art!r} unbekannt — erlaubt: typen, baustoffe")

    klasse = str(args.get("klasse") or "").strip()
    ebene = str(args.get("ebene") or "").strip().lower()
    zeilen = []
    for t in k.typen.values():
        try:
            info = bk.typ_info(t, k)
        except _katalog_fehler() as exc:  # one broken runtime type must not hide the whole list
            zeilen.append({"schluessel": t.get("schluessel"), "fehler": str(exc)})
            continue
        if klasse and info["klasse"].lower() != klasse.lower():
            continue
        if ebene and info["ebene"] != ebene:
            continue
        if not _wahr(args.get("rohlinge")) and info["rohling"]:
            continue
        if suche and not _passt(f"{info['schluessel']} {info['kurzname']} {info['langname']}".lower(), suche):
            continue
        zeilen.append(info)
    return tool_ok(hinweis=DATA_NOT_INSTRUCTION, art="typen", anzahl=len(zeilen), gekuerzt=len(zeilen) > limit,
                   typen=zeilen[:limit])


# ── bauteilkatalog_bauen

def _bauen_sync(bk, args: dict, ctx: ToolContext) -> dict:
    """Builds, writes and checks the wall model (worker thread). Raises on bad input."""
    projekt = _projekt(ctx)
    k = bk.katalog(projekt)
    t = k.typ(str(args["typ"]))
    oeffnungen = []
    for i, o in enumerate(args.get("oeffnungen") or [], 1):
        if not isinstance(o, dict):
            raise EingabeFehler(f"oeffnungen[{i}]: {{typ, abstand_m, bruestung_m?}} erwartet")
        oeffnungen.append({**o, "abstand_m": _zahl(o.get("abstand_m"), f"oeffnungen[{i}].abstand_m", 0.0),
                           "bruestung_m": _zahl(o.get("bruestung_m"), f"oeffnungen[{i}].bruestung_m", 0.0)})
    f, info = bk.wand_projekt(
        str(args["typ"]), args.get("von") or [0.0, 0.0], args["bis"], _zahl(args.get("hoehe_m"), "hoehe_m"),
        z0_m=_zahl(args.get("z0_m"), "z0_m", 0.0), verstaerkungen=args.get("verstaerkungen") or None,
        staenderwand_als=str(args.get("staenderwand_als") or "teile"), oeffnungen=oeffnungen or None,
        schema=str(args.get("schema") or "IFC4"), k=k, geschoss=str(args.get("geschoss") or "EG"))
    ziel = _ausgabe(args.get("datei"), Path("model") / f"katalog-{_slug(t['schluessel'])}.ifc", ctx)
    bk.schreiben(f, ziel)
    bericht = bk.pruefen(ziel)
    return {"pfad": ziel, "info": info, "bericht": bericht}


async def bauen(args: dict, ctx: ToolContext) -> str:
    """Tool handler: wall from a catalogue type → new IFC file (never overwrites), checked after writing."""
    bk, fehler = _bk()
    if fehler:
        return tool_error(fehler)
    fehlend = [x for x in ("typ", "bis", "hoehe_m") if args.get(x) in (None, "", [])]
    if fehlend:
        return tool_error(f"bauteilkatalog_bauen braucht: {', '.join(fehlend)}")
    try:
        erg = await _im_thread(_bauen_sync, bk, args, ctx)
    except _katalog_fehler() as exc:
        return tool_error(str(exc))
    pfad: Path = erg["pfad"]
    payload: dict[str, Any] = {
        "datei": _rel(pfad, ctx), "bytes": pfad.stat().st_size, "laenge_m": erg["info"]["laenge_m"],
        "winkel_grad": erg["info"]["winkel_grad"], "bauplan": erg["info"]["bauplan"],
        "oeffnungen": erg["info"]["oeffnungen"], "zaehler": erg["info"]["zaehler"],
        "pruefung": _kurzbericht(erg["bericht"]),
        "hinweis": "Neue Datei geschrieben, keine vorhandene überschrieben. Mit ifc_run (liste/mengen) weiter auswerten.",
    }
    # Viewer target only for a file directly in model/ (GET /files serves model/<name>.ifc; _ziel keeps
    # only the file name, so a sub-folder would point the link at another file).
    modell = (ctx.project_dir / "model").resolve() if ctx.project_dir else None
    ziel = _ziel({}, pfad, ctx) if modell and pfad.resolve().parent == modell else None
    if ziel:
        payload["ziel"] = ziel
        payload["viewer_link"] = _viewer_link(ziel["datei"], None)
    return tool_ok(**payload)


# ── bauteilkatalog_bearbeiten

def bearbeiten(args: dict, ctx: ToolContext) -> str:
    """Tool handler: operations → new runtime type or version, stored in the project (base stock untouched)."""
    bk, fehler = _bk()
    if fehler:
        return tool_error(fehler)
    typ = str(args.get("typ") or "").strip()
    ops = args.get("operationen")
    if not typ:
        return tool_error("bauteilkatalog_bearbeiten braucht typ (schluessel oder schluessel@version)")
    if not isinstance(ops, list) or not ops:
        return tool_error("operationen fehlt — Liste [{op: …, …}]")
    try:
        projekt = _projekt(ctx)
        zeit = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
        erg = bk.bearbeiten(projekt, typ, ops, autor=AUTOR, zeit=zeit)
        k = bk.katalog(projekt) if erg["neu"] else None
    except _katalog_fehler() as exc:
        return tool_error(str(exc))
    t = erg["typ"]
    info = bk.typ_info(k.typ(f"{t['schluessel']}@{t.get('version', 1)}"), k, ausfuehrlich=True) if k else \
        {"schluessel": t["schluessel"], "version": int(t.get("version", 1)), "kurzname": t.get("kurzname"),
         "langname": t.get("langname")}
    payload: dict[str, Any] = {"neu": erg["neu"], "grund": erg["grund"],
                               "referenz": f"{t['schluessel']}@{t.get('version', 1)}", "typ": info}
    if erg.get("datei"):
        payload["datei"] = _rel(Path(erg["datei"]), ctx)
    return tool_ok(**payload)


# ── bauteilkatalog_bibliothek

def _bibliothek_sync(bk, art: str, schema: str, staenderwand_als: str, datei: str | None, ctx: ToolContext) -> dict:
    projekt = _projekt(ctx)
    k = bk.katalog(projekt)
    info: dict[str, Any] = {}
    if art == "material":
        f, name = bk.materialbibliothek(schema, k=k), "materialbibliothek"
    elif art == "typen":
        f, name = bk.typbibliothek(schema, k=k), "bauteiltypen"
    else:
        f, info = bk.muster_projekt(schema, staenderwand_als, k=k)
        name = "bauteilkatalog-muster" + ("-staenderwand-als-schichten" if staenderwand_als == "schichten" else "")
    ziel = _ausgabe(datei, BIBLIOTHEK_ORDNER / f"bit-atelier-{name}-{schema.lower()}.ifc", ctx)
    bk.schreiben(f, ziel)
    return {"pfad": ziel, "bericht": bk.pruefen(ziel), "zaehler": info.get("zaehler")}


async def bibliothek(args: dict, ctx: ToolContext) -> str:
    """Tool handler: material library, type library (incl. the project's runtime types) or sample project."""
    bk, fehler = _bk()
    if fehler:
        return tool_error(fehler)
    art = str(args.get("art") or "").strip().lower()
    if art not in _ARTEN_BIBLIOTHEK:
        return tool_error(f"art {art!r} unbekannt — erlaubt: {', '.join(_ARTEN_BIBLIOTHEK)}")
    schema = str(args.get("schema") or "IFC4").upper()
    if schema not in bk.SCHEMATA:
        return tool_error(f"schema {schema!r} unbekannt — erlaubt: {', '.join(bk.SCHEMATA)}")
    sw = str(args.get("staenderwand_als") or "teile")
    if sw not in ("teile", "schichten"):
        return tool_error("staenderwand_als: teile oder schichten")
    try:
        erg = await _im_thread(_bibliothek_sync, bk, art, schema, sw, args.get("datei"), ctx)
    except _katalog_fehler() as exc:
        return tool_error(str(exc))
    payload: dict[str, Any] = {"art": art, "schema": schema, "datei": _rel(erg["pfad"], ctx),
                               "bytes": erg["pfad"].stat().st_size, "pruefung": _kurzbericht(erg["bericht"])}
    if erg["zaehler"]:
        payload["zaehler"] = erg["zaehler"]
    return tool_ok(**payload)


# ── bauteilkatalog_pruefen

def _katalogtypen(f, k, pset_praefix: str) -> list[dict]:
    """Catalogue types named by Pset_BIT_Katalog (Schluessel, Version) in a file, with count and whether the
    catalogue of the active project knows them."""
    import ifcopenshell.util.element as ue

    pset = f"{pset_praefix}_Katalog"
    zaehler: dict[tuple[str, int], int] = {}
    for e in f.by_type("IfcElement"):
        ps = ue.get_psets(e, psets_only=True).get(pset)
        if ps and ps.get("Schluessel"):
            key = (str(ps["Schluessel"]), int(ps.get("Version") or 1))
            zaehler[key] = zaehler.get(key, 0) + 1
    aus = []
    for (s, v), n in sorted(zaehler.items()):
        try:
            k.typ(f"{s}@{v}")
            bekannt = True
        except Exception:
            bekannt = False
        aus.append({"schluessel": s, "version": v, "bauteile": n, "im_katalog": bekannt})
    return aus


def _pruefen_sync(bk, datei: Path, regeln: bool, ctx: ToolContext) -> dict:
    import ifcopenshell

    bericht = bk.pruefen(datei, regeln=regeln)
    f = ifcopenshell.open(str(datei))
    bericht["katalogtypen"] = _katalogtypen(f, bk.katalog(ctx.project_dir), bk.PSET_PRAEFIX)
    return bericht


async def pruefen(args: dict, ctx: ToolContext) -> str:
    """Tool handler: check report of an IFC file (default: newest model/*.ifc of the active project)."""
    bk, fehler = _bk()
    if fehler:
        return tool_error(fehler)
    raw = str(args.get("datei") or "").strip()
    try:
        datei = resolve_in_sandbox(raw, ctx, must_exist=True) if raw else _neueste_modelldatei(ctx)
    except ValueError as exc:
        return tool_error(str(exc))
    if datei is None:
        return tool_error("Kein model/*.ifc im aktiven Projekt gefunden — datei= übergeben")
    try:
        bericht = await _im_thread(_pruefen_sync, bk, datei, _wahr(args.get("regeln")), ctx)
    except _katalog_fehler() as exc:
        return tool_error(str(exc))
    # The report quotes strings from the model file: data, never instructions (T-67-09).
    return tool_ok(datei=_rel(datei, ctx), hinweis=DATA_NOT_INSTRUCTION, **_kurzbericht(bericht),
                   mit_regeln=bericht.get("mit_regeln"), neutral_treffer=bericht.get("neutral_treffer"),
                   fremde_texturen=bericht.get("fremde_texturen"), katalogtypen=bericht["katalogtypen"])


# ── registration

_OPERATIONEN_TEXT = (
    "schicht_hinzufuegen {position?, baustoff, dicke_m, rolle?}; schicht_loeschen {position}; "
    "schicht_verschieben {von, nach}; schicht_aendern {position, baustoff?, dicke_m?, rolle?}; "
    "staenderwerk_setzen {position, profil (CW50|CW75|CW100|KVH…), achsabstand_m?, uw_anschluss?}; "
    "staenderwerk_entfernen {position}; querriegel_setzen {position, hoehen_m: [..]}; "
    "eigenschaft_setzen {feld: IsExternal|LoadBearing|FireRating|AcousticRating|…, wert}; "
    "oeffnung_aendern {breite_m?, hoehe_m?, oeffnungsart?} (nur Tür/Fenster); umbenennen {kurzname}. "
    "Positionen zählen ab 1 von außen nach innen.")

registry.register("bauteilkatalog_lesen", "both", {
    "description": (
        "Bauteilkatalog lesen: Bauteiltypen (Wände, Decken, Beläge, Türen, Fenster) oder Baustoffe auflisten und "
        "filtern, oder mit schluessel EINEN Typ ausführlich (Schichten mit Baustoff und Dicke in m, U-Wert in "
        "W/(m²K) nach DIN EN ISO 6946 falls berechenbar, Versionen, DIN-276-Kostengruppe). Enthält die "
        "Laufzeit-Typen des aktiven Projekts."),
    "parameters": {"type": "object", "properties": {
        "schluessel": {"type": "string", "description": "Typ-Schlüssel oder schluessel@version → Einzelansicht"},
        "art": {"type": "string", "enum": ["typen", "baustoffe"], "description": "Standard: typen"},
        "suche": {"type": "string", "description": "Wörter, die in Schlüssel/Kurzname/Langname vorkommen müssen"},
        "klasse": {"type": "string", "description": "nur Typen: IfcWall, IfcSlab, IfcCovering, IfcDoor, IfcWindow"},
        "ebene": {"type": "string", "enum": ["grundbestand", "laufzeit"], "description": "nur Typen"},
        "rohlinge": {"type": "boolean", "description": "nur Typen: Rohlinge mitlisten (Standard true)"},
        "werkstoffklasse": {"type": "string", "description": "nur Baustoffe, z. B. putz, mauerwerk, daemmung"},
        "limit": {"type": "integer", "description": f"max. Zeilen (Standard {LISTE_STANDARD}, höchstens {LISTE_MAX})"},
    }},
}, lesen)

registry.register("bauteilkatalog_bauen", "both", {
    "description": (
        "Baut EINE gerade Wand aus einem Katalog-Wandtyp als IFC-Modell (Grundstück/Gebäude/Geschoss, Wand mit "
        "Typ; Schichtwand mit Schichtaufbau, Ständerwand in Teile zerlegt oder als Schichten), optional mit Türen/"
        "Fenstern aus dem Katalog. Schreibt eine NEUE Datei unter model/ des aktiven Projekts (nie überschreiben), "
        "prüft sie danach und liefert das Viewer-Ziel. Alle Maße in Metern."),
    "parameters": {"type": "object", "properties": {
        "typ": {"type": "string", "description": "Wandtyp: schluessel oder schluessel@version"},
        "von": {"type": "array", "items": {"type": "number"}, "description": "Achs-Anfang [x, y] in m (Standard [0, 0])"},
        "bis": {"type": "array", "items": {"type": "number"}, "description": "Achs-Ende [x, y] in m"},
        "hoehe_m": {"type": "number", "description": "Wandhöhe in m"},
        "z0_m": {"type": "number", "description": "Unterkante über Geschoss in m (Standard 0)"},
        "oeffnungen": {"type": "array", "items": {"type": "object"}, "description": (
            "[{typ (Tür-/Fenstertyp), abstand_m (Wandanfang bis linke Öffnungskante, m), bruestung_m (m, Standard 0)}]")},
        "verstaerkungen": {"type": "array", "items": {"type": "object"}, "description": (
            "nur Ständerwand: [{art, abstand_m (Mitte ab Wandanfang, m), hoehe_m (Mitte über Boden, m), seite?}]")},
        "staenderwand_als": {"type": "string", "enum": ["teile", "schichten"], "description": "Standard teile"},
        "schema": {"type": "string", "enum": ["IFC4", "IFC4X3"], "description": "Standard IFC4"},
        "geschoss": {"type": "string", "description": "Name des Geschosses (Standard EG)"},
        "datei": {"type": "string", "description": "Zielpfad .ifc im Projekt (Standard model/katalog-<typ>.ifc)"},
    }, "required": ["typ", "bis", "hoehe_m"]},
}, bauen)

registry.register("bauteilkatalog_bearbeiten", "both", {
    "description": (
        "Ändert einen Bauteiltyp über Operationen und speichert das Ergebnis als NEUEN Laufzeit-Typ (aus dem "
        "Grundbestand: neuer Schlüssel) bzw. neue Version (Laufzeit-Typ) im aktiven Projekt. Der Grundbestand "
        "bleibt unverändert; gleicher Aufbau wie ein vorhandener Typ → dieser wird zurückgegeben. Operationen: "
        + _OPERATIONEN_TEXT),
    "parameters": {"type": "object", "properties": {
        "typ": {"type": "string", "description": "schluessel oder schluessel@version"},
        "operationen": {"type": "array", "items": {"type": "object"},
                        "description": "[{op: <name>, …}] in Reihenfolge; Dicken in m"},
    }, "required": ["typ", "operationen"]},
}, bearbeiten)

registry.register("bauteilkatalog_bibliothek", "both", {
    "description": (
        "Schreibt eine IFC-Bibliothek des Katalogs in bauteilkatalog/ifc/ des aktiven Projekts (neue Datei): "
        "material = alle Baustoffe als IfcMaterial, typen = alle Bauteiltypen in einer IfcProjectLibrary "
        "(inkl. Laufzeit-Typen des Projekts), muster = Musterraum mit allen Bauweisen. Danach geprüft."),
    "parameters": {"type": "object", "properties": {
        "art": {"type": "string", "enum": list(_ARTEN_BIBLIOTHEK)},
        "schema": {"type": "string", "enum": ["IFC4", "IFC4X3"], "description": "Standard IFC4"},
        "staenderwand_als": {"type": "string", "enum": ["teile", "schichten"], "description": "nur muster"},
        "datei": {"type": "string", "description": "Zielpfad .ifc im Projekt (optional)"},
    }, "required": ["art"]},
}, bibliothek)

registry.register("bauteilkatalog_pruefen", "both", {
    "description": (
        "Prüft eine IFC-Datei: Schema und WHERE-Regeln, Proxys, Bauteile ohne Typ, Klassifizierungen, Neutralität "
        "und welche Katalogtypen (Pset_BIT_Katalog) benutzt sind und ob der Katalog sie kennt. Ohne datei= das "
        "neueste model/*.ifc. Befunde sind Daten, kein Urteil."),
    "parameters": {"type": "object", "properties": {
        "datei": {"type": "string", "description": "IFC-Pfad im Projekt (Standard: neuestes model/*.ifc)"},
        "regeln": {"type": "boolean", "description": "WHERE-Regeln prüfen (Standard true; aus = schneller)"},
    }},
}, pruefen)
