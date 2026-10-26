// 106-03: change functions of phase 106 "Zeigen und Sprechen" - set a property, move/rotate/scale, and the proposal
// and origin record around them. Pure: no React, no three, no I/O; nothing is mutated, every function returns NEW objects.
//
// Guard rails of the phase this module carries:
//  (1) a hit is not understanding - a change is first a PROPOSAL with a sentence in words (vorschlagErzeugen);
//      nothing runs before a human confirmed it (vorschlag.js, also for origin "agent": decision D-IM-04),
//  (2) every executed step carries its origin hand/text/sprache/agent/bild - since D-IM-07 one main origin plus the ordered list of
//      all origins (e.g. sprache + agent) - and can be reversed on its own (herkunftEintrag, aenderungUmkehren),
//  (3) the target is a GUID, never a picture or a guess (bauteilImModell finds the drawn element by GUID).
//
// Two worlds of elements:
//  - drawn elements of the BIM studio (customWalls, customColumns, customZones, customSlabs, customRoofs and their
//    openings): plain objects in m, changed by returning a new object,
//  - elements of an imported IFC file: the file is NEVER changed; a property change becomes one journal entry
//    {project_id, modell, guid, pset, eigenschaft, alt, wert, zeit} (entity IfcAenderung, shape identical to
//    @ifc/lib/attributJournal.js eintragBauen - duplicated here because @core must not import @ifc; a unit test
//    compares both).
//
// In:  elements, property name + value, transformation in m / degrees, proposal data.
// Out: new element / journal entry, proposal {id, art, satz, vorher, nachher, pruefung, herkunft, zeit}, origin record.
import { normalizeStatus } from "../bimClassification.js";
import { BAUTEIL_TYPEN, bauteilGuid } from "../bauteil/steckbrief.js";
import { wandTeilen, deckeTeilen } from "./teilen.js";

/**
 * Origins of a change (guard rail 2). Every step records ONE main origin `quelle` (read by older code and stored entries) and, since
 * decision D-IM-07 (25.10.2026), the ordered list `quellen` of all origins that led to it - e.g. ["sprache", "agent"] for a proposal the
 * agent made from a spoken sentence, ["sprache", "agent", "bild"] when an image of the view went along. A record without `quellen` reads as
 * [quelle] (herkunftQuellen).
 */
export const HERKUNFT_QUELLEN = Object.freeze(["hand", "text", "sprache", "agent", "bild"]);

/** German labels of the origins for the history and the preview (i18n keys); several origins are joined with HERKUNFT_TRENNER. */
export const HERKUNFT_LABEL = Object.freeze({ hand: "Von Hand", text: "Textbefehl", sprache: "Spracheingabe", agent: "Agent", bild: "Bildkontext" });

/** Separator between the labels of several origins ("Spracheingabe + Agent"); language-neutral, every label is translated on its own. */
export const HERKUNFT_TRENNER = " + ";

/**
 * Checks and normalises the origin list of a proposal (D-IM-07).
 * @param {string} quelle  Main origin (one of HERKUNFT_QUELLEN).
 * @param {any} quellen  The caller's list, or undefined/null (= [quelle]).
 * @returns {string[]}  The list, duplicates removed, order kept.
 * @throws {Error} German text: not a list, unknown origin, main origin missing from the list, "hand" together with another origin
 *   ("hand" is the person's mouse in the window and nothing else - a list must not lift an agent's step into it).
 */
function quellenPruefen(quelle, quellen) {
  if (quellen == null) return [quelle];
  if (!Array.isArray(quellen) || !quellen.length) throw new Error("Vorschlag: die Herkunftsliste muss eine nicht leere Liste sein");
  const liste = [...new Set(quellen.map(String))];
  const fremd = liste.find((q) => !HERKUNFT_QUELLEN.includes(/** @type {any} */ (q)));
  if (fremd) throw new Error(`Vorschlag: unbekannte Herkunft „${fremd}“`);
  if (!liste.includes(quelle)) throw new Error(`Vorschlag: die Herkunft „${quelle}“ fehlt in der Herkunftsliste`);
  if (liste.length > 1 && liste.includes("hand")) throw new Error("Vorschlag: „hand“ steht nur allein — eine Änderung mit der Maus hat keine weitere Herkunft");
  return liste;
}

/**
 * All origins of a proposal, a step record, an element mark or an IFC journal entry, in their order (D-IM-07). Old records without a list
 * read as their one origin; nothing known reads as [].
 * @param {any} x  Proposal ({herkunft: {quelle, quellen?}}), its `herkunft` object, a step record / mark / journal entry
 *   ({herkunft: string, herkunft_quellen?}) or an origin string.
 * @returns {string[]}
 */
export function herkunftQuellen(x) {
  if (x == null) return [];
  if (typeof x === "string") return x ? [x] : [];
  if (x.herkunft && typeof x.herkunft === "object") return herkunftQuellen(x.herkunft);
  if (typeof x.herkunft === "string") return Array.isArray(x.herkunft_quellen) && x.herkunft_quellen.length ? x.herkunft_quellen.map(String) : [x.herkunft];
  if (typeof x.quelle === "string") return Array.isArray(x.quellen) && x.quellen.length ? x.quellen.map(String) : [x.quelle];
  return [];
}

/**
 * The origins in words for the preview, the proposal list and the history: "Spracheingabe + Agent", "Spracheingabe + Agent + Bildkontext".
 * @param {any} x  See herkunftQuellen. @param {(s: string) => string} [t]  Translator of each label (default German).
 * @returns {string}  "" when no origin is known.
 */
export function herkunftText(x, t = (s) => s) {
  return herkunftQuellen(x).map((q) => t(HERKUNFT_LABEL[/** @type {keyof typeof HERKUNFT_LABEL} */ (q)] ?? q)).join(HERKUNFT_TRENNER);
}

/** Kinds of change a proposal can carry. */
export const AENDERUNG_ARTEN = Object.freeze(["eigenschaft", "transformieren", "teilen"]);

/** Human channels that may confirm a proposal; an agent can never confirm its own (see vorschlag.js). */
export const BESTAETIGUNG_KANAELE = Object.freeze(["hand", "sprache", "tastatur"]);

/** Word shown for an empty value in a sentence (i18n key). */
export const WERT_LEER = "leer";

/**
 * Sentence templates of the preview, keyed by the German template text itself (the i18n convention of the app:
 * t() looks the German key up; the placeholders {…} are filled by satzAusVorlage afterwards). English texts live in
 * i18nTeile/aenderungen-106.js.
 */
export const SATZ_VORLAGEN = Object.freeze({
  eigenschaft: "{ziel}: {eigenschaft} {vorher} → {nachher}",
  transformieren: "{ziel}: {schritte}",
  verschieben: "um {dx} m in x und {dz} m in z verschieben",
  verschiebenHoehe: "um {dx} m in x, {dy} m in y und {dz} m in z verschieben",
  drehen: "um {grad}° drehen",
  skalieren: "auf {prozent} % skalieren",
  teilenWand: "{ziel}: bei {t} m teilen → {laengeA} m + {laengeB} m",
  teilenFlaeche: "{ziel}: entlang der Linie teilen → {flaecheA} m² + {flaecheB} m²",
});

/**
 * Name of the additive field a confirmed step leaves on a drawn element: `{herkunft, befehl_text, zeit, vorschlag_id}`.
 * It survives a reload (it is part of the stored element), so a change by an agent can be told from a change by hand
 * afterwards (guard rail 2). A new field only, no existing field is renamed.
 */
export const MARKE_FELD = "geaendert_durch";

/**
 * Deterministic text of a value for comparing two states (object keys sorted, undefined left out).
 * @param {any} v @returns {string}
 */
export function stabil(v) {
  const norm = (/** @type {any} */ x) => {
    if (Array.isArray(x)) return x.map(norm);
    if (x && typeof x === "object") return Object.fromEntries(Object.keys(x).sort().filter((k) => x[k] !== undefined).map((k) => [k, norm(x[k])]));
    return x;
  };
  return JSON.stringify(norm(v));
}

/** Rounds to 1e-6 m (as the massing functions do) so floating point drift never reaches the stored plan. */
const runde = (v) => Math.round(v * 1e6) / 1e6 + 0; // + 0 turns -0 into 0

/**
 * German number text for sentences: decimal comma, at most 3 decimals, no trailing zeros.
 * @param {number} v  Any number.
 * @returns {string}
 */
export function zahlText(v) {
  const r = Math.round(Number(v) * 1000) / 1000;
  return String(Object.is(r, -0) ? 0 : r).replace(".", ",");
}

/**
 * Fills the {placeholders} of a (translated) template.
 * @param {string} vorlage  Template text, e.g. t(SATZ_VORLAGEN.eigenschaft).
 * @param {Record<string, string|number>} werte  Values by placeholder name; a placeholder without value stays as it is.
 * @returns {string}
 */
export function satzAusVorlage(vorlage, werte) {
  return String(vorlage).replace(/\{(\w+)\}/g, (m, k) => (k in (werte || {}) ? String(werte[k]) : m));
}

/**
 * Value as a word for a sentence: empty -> "leer", booleans ja/nein, numbers with decimal comma.
 * @param {any} v
 * @param {(s: string) => string} [t]  Translator for "leer"/"ja"/"nein" (default: identity).
 * @returns {string}
 */
export function wertText(v, t = (s) => s) {
  if (v == null || v === "") return t(WERT_LEER);
  if (v === true) return t("ja");
  if (v === false) return t("nein");
  if (typeof v === "number") return zahlText(v);
  return String(v);
}

// ---------------------------------------------------------------------------------------------------------------
// Properties of drawn elements

/** @param {any} v @returns {boolean|null} ja/nein in its spellings, null when not readable */
function janein(v) {
  if (v === true || v === false) return v;
  const s = String(v ?? "").trim().toLowerCase();
  if (["true", "ja", "wahr", "yes", "1", "tragend"].includes(s)) return true;
  if (["false", "nein", "falsch", "no", "0", "nichttragend", "nicht tragend"].includes(s)) return false;
  return null;
}

/**
 * The properties a drawn element can take through a change. `feld` is the field on the element object (German or
 * the sheet's name), `namen` the spellings accepted for {name} (case-insensitive, German and IFC names), `parse`
 * checks and normalises the value and throws a German text for a wrong one.
 * `feuerwiderstand` and `statik_vermerk` are new optional fields on the element (additive, no layer version needed);
 * the sheet and the IFC export do not read them yet [ASSUMED: shown in the preview and stored, written to the IFC
 * Pset FireRating in a later step].
 * @type {ReadonlyArray<{feld: string, label: string, namen: string[], parse: (wert: any) => any}>}
 */
export const EIGENSCHAFTEN = Object.freeze([
  { feld: "status", label: "Status", namen: ["status", "umbaustatus"], parse: (w) => {
    const s = normalizeStatus(w);
    if (!s) throw new Error(`„${w}“ ist kein Status (bestand, neubau oder abbruch)`);
    return s;
  } },
  { feld: "kg", label: "Kostengruppe", namen: ["kg", "kostengruppe"], parse: (w) => {
    const s = String(w).trim();
    if (!/^\d{1,3}$/.test(s)) throw new Error(`„${w}“ ist keine Kostengruppe (1 bis 3 Ziffern nach DIN 276)`);
    return s;
  } },
  { feld: "gewerk_lb", label: "Leistungsbereich", namen: ["gewerk_lb", "lb", "leistungsbereich"], parse: (w) => {
    const s = String(w).trim();
    if (!/^\d{3}$/.test(s)) throw new Error(`„${w}“ ist kein Leistungsbereich (3 Ziffern nach STLB-Bau)`);
    return s;
  } },
  { feld: "bauabschnitt", label: "Bauabschnitt", namen: ["bauabschnitt"], parse: (w) => {
    const s = String(w).trim();
    if (s.length > 40) throw new Error("Der Bauabschnitt darf höchstens 40 Zeichen haben");
    return s;
  } },
  { feld: "bauteil_typ", label: "Bauteiltyp", namen: ["bauteil_typ", "bauteiltyp", "typ"], parse: (w) => {
    const s = String(w).trim();
    if (BAUTEIL_TYPEN[s]) return s;
    const hit = Object.entries(BAUTEIL_TYPEN).find(([, v]) => v.label.toLowerCase() === s.toLowerCase());
    if (!hit) throw new Error(`„${w}“ ist kein Bauteiltyp`);
    return hit[0];
  } },
  { feld: "material", label: "Material", namen: ["material"], parse: (w) => String(w).trim() },
  { feld: "tragend", label: "Tragend", namen: ["tragend", "loadbearing"], parse: (w) => {
    const b = janein(w);
    if (b == null) throw new Error(`„${w}“ ist weder ja noch nein`);
    return b;
  } },
  { feld: "feuerwiderstand", label: "Feuerwiderstand", namen: ["feuerwiderstand", "feuerwiderstandsklasse", "firerating"], parse: (w) => {
    // classes: DIN 4102 F30/F90, T30 (doors), DIN EN 13501-2 EI 90/REI 60, optionally with a suffix like -AB
    const s = String(w).trim().toUpperCase().replace(/\s+/g, "");
    if (["OHNE", "KEINE", "KEIN"].includes(s)) return "ohne";
    const m = /^(F|T|EI|REI|R|E)(\d{2,3})(-[A-Z]{1,3})?$/.exec(s);
    if (!m) throw new Error(`„${w}“ ist keine Feuerwiderstandsklasse (z. B. F30, F90, EI 90)`);
    return `${m[1]}${m[1].length > 1 ? " " : ""}${m[2]}${m[3] || ""}`;
  } },
  { feld: "statik_vermerk", label: "Statik-Vermerk", namen: ["statik_vermerk", "statikvermerk", "vermerk"], parse: (w) => String(w).trim() },
]);

/**
 * The property definition for a name (any accepted spelling, case-insensitive).
 * @param {string} name  e.g. "Feuerwiderstand", "FireRating", "kg".
 * @returns {(typeof EIGENSCHAFTEN)[number]|null}
 */
export function eigenschaftFeld(name) {
  const k = String(name ?? "").trim().toLowerCase();
  return EIGENSCHAFTEN.find((e) => e.namen.includes(k)) || null;
}

/** Value equality across number/text (1 == "1"); null only equals null. Same rule as attributJournal.gleich. @param {any} a @param {any} b @returns {boolean} */
export function gleich(a, b) {
  if (a == null || b == null) return a == null && b == null;
  if (typeof a === "boolean" || typeof b === "boolean") return String(a) === String(b);
  const na = Number(a), nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && String(a).trim() !== "" && String(b).trim() !== "") return Math.abs(na - nb) < 1e-9;
  return String(a) === String(b);
}

/** Converts the typed text to the type of the current value (number with decimal comma, boolean ja/nein, else text); same rule as attributJournal.wertTypisieren. */
function typisieren(eingabe, vorlage) {
  if (typeof eingabe !== "string") return eingabe ?? null;
  const text = eingabe.trim();
  if (typeof vorlage === "number") {
    const n = Number(text.replace(/\s/g, "").replace(",", "."));
    if (text === "" || !Number.isFinite(n)) throw new Error(`„${text}“ ist keine Zahl`);
    return n;
  }
  if (typeof vorlage === "boolean") {
    const b = janein(text);
    if (b == null) throw new Error(`„${text}“ ist weder ja noch nein`);
    return b;
  }
  return text;
}

/**
 * Sets one property of an element - as a NEW element (drawn) or as a journal entry (IFC); the input is never changed.
 *
 * Drawn element (no `quelle: "ifc"`): `name` names one of EIGENSCHAFTEN (German or IFC spelling, `pset` is ignored);
 * an empty `wert` removes the stored value. IFC element `{quelle: "ifc", modell, guid, psets, project_id?}`: `pset`
 * and `name` address the property as in the model (looked up case-insensitively, a new one is allowed and gets
 * alt null), the value is typed like the current one; the file stays unchanged, the result carries the journal entry.
 * @param {any} bauteil  Drawn element (customWalls ... with `_idx`) or `{quelle: "ifc", modell: string (file name),
 *   guid: string (22-character GlobalId), psets: Record<string, Record<string, any>>, project_id?: string|null}`.
 * @param {{pset?: string, name: string, wert: any}} eig  pset: property set (IFC only); name: property; wert: new value.
 * @param {{abgeleitet?: Record<string, any>, eintraege?: Array<{modell: string, guid: string, pset: string, eigenschaft: string, wert: any, zeit: string}>, zeit?: string}} [opt]
 *   abgeleitet: values the data sheet derives for fields still unset on a drawn element (shown as `vorher`, marked
 *   `vorherQuelle: "abgeleitet"`); eintraege: journal entries already stored (the newest per property wins as current
 *   value of an IFC element); zeit: ISO time of the journal entry (tests).
 * @returns {{quelle: "bim"|"ifc", bauteil: any, feld: string, label: string, vorher: any, nachher: any,
 *   vorherQuelle: "gesetzt"|"abgeleitet", journal?: {project_id: string|null, modell: string, guid: string, pset: string,
 *   eigenschaft: string, alt: any, wert: any, zeit: string}}}
 *   bauteil: the NEW drawn element (IFC: the same object, unchanged); feld: field name (IFC: "Pset.Eigenschaft");
 *   label: German name of the property; vorher/nachher: the values (null = empty).
 * @throws {Error} German text: unknown property, wrong value, no change, journal fields missing.
 */
export function eigenschaftSetzen(bauteil, eig, opt = {}) {
  if (!bauteil || typeof bauteil !== "object") throw new Error("Eigenschaft setzen: kein Bauteil");
  if (!eig || !String(eig.name ?? "").trim()) throw new Error("Eigenschaft setzen: Name der Eigenschaft fehlt");
  if (bauteil.quelle === "ifc") return eigenschaftSetzenIfc(bauteil, eig, opt);

  const def = eigenschaftFeld(eig.name);
  if (!def) throw new Error(`Eigenschaft „${eig.name}“ gibt es an gezeichneten Bauteilen nicht — möglich: ${EIGENSCHAFTEN.map((e) => e.label).join(", ")}`);
  const leer = eig.wert == null || (typeof eig.wert === "string" && eig.wert.trim() === "");
  const nachher = leer ? null : def.parse(eig.wert);
  const gespeichert = bauteil[def.feld] ?? null;
  const abgeleitet = gespeichert == null && opt.abgeleitet?.[def.feld] != null;
  const vorher = abgeleitet ? opt.abgeleitet?.[def.feld] : gespeichert;
  // only a STORED equal value is no change: confirming a derived value (e.g. the type's cost group) makes it a decision
  if (gleich(gespeichert, nachher)) {
    throw new Error(`Keine Änderung — ${def.label} ist schon ${wertText(nachher)}`);
  }
  const neu = { ...bauteil };
  if (nachher == null) delete neu[def.feld];
  else neu[def.feld] = nachher;
  return { quelle: "bim", bauteil: neu, feld: def.feld, label: def.label, vorher, nachher, vorherQuelle: abgeleitet ? "abgeleitet" : "gesetzt" };
}

/**
 * The current value of a property of an IFC element: the newest journal entry wins over the model value (overlay
 * semantics of the attribute editor); names are looked up case-insensitively so a typo never creates a second property.
 * @param {{modell: string, guid: string, psets?: Record<string, Record<string, any>>}} bauteil  IFC element (psets as parsed from the file).
 * @param {string} pset  Property set name. @param {string} name  Property name.
 * @param {Array<{modell: string, guid: string, pset: string, eigenschaft: string, wert: any, zeit: string}>} [eintraege]  Stored journal entries.
 * @returns {{pset: string, eigenschaft: string, wert: any}}  Names as they stand in the model and the current value (null = empty).
 */
export function ifcWertAktuell(bauteil, pset, name, eintraege = []) {
  const psetName = Object.keys(bauteil.psets || {}).find((p) => p.toLowerCase() === String(pset).toLowerCase()) ?? String(pset);
  const props = bauteil.psets?.[psetName] || {};
  const propName = Object.keys(props).find((p) => p.toLowerCase() === String(name).toLowerCase()) ?? String(name);
  const neuester = (eintraege || [])
    .filter((e) => e.modell === bauteil.modell && e.guid === bauteil.guid && e.pset === psetName && e.eigenschaft === propName)
    .sort((x, y) => String(x.zeit).localeCompare(String(y.zeit))).pop();
  const roh = neuester ? neuester.wert : props[propName];
  return { pset: psetName, eigenschaft: propName, wert: roh == null || typeof roh === "object" ? (roh == null ? null : String(roh)) : roh };
}

/**
 * IFC standard property behind a field name of the drawn elements (106-05: "setze Brandschutz auf F90" spoken at an IFC element names no
 * property set). Only FireRating (IfcLabel) and LoadBearing (IfcBoolean), and only for the classes whose IFC4 common property set defines them.
 */
const IFC_STANDARD_EIGENSCHAFT = Object.freeze({ feuerwiderstand: "FireRating", tragend: "LoadBearing" });

/**
 * IFC4 class stem (IfcWall -> "Wall") -> standard properties its Pset_<Stem>Common defines. Source: IFC4 ADD2 TC1 property set definitions
 * (Pset_WallCommon, Pset_SlabCommon, Pset_ColumnCommon, Pset_BeamCommon, Pset_MemberCommon, Pset_PlateCommon, Pset_ChimneyCommon: both;
 * Pset_FootingCommon, Pset_PileCommon: LoadBearing only; Pset_DoorCommon, Pset_WindowCommon, Pset_RoofCommon, Pset_CoveringCommon,
 * Pset_StairCommon, Pset_RampCommon, Pset_CurtainWallCommon: FireRating only). A class not listed (IfcSpace, IfcSite, IfcOpeningElement, ...)
 * gets no derived property: the refusal "nur mit Eigenschaftssatz" applies instead of a property the schema does not know.
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
const IFC_COMMON_EIGENSCHAFTEN = Object.freeze({
  Wall: ["FireRating", "LoadBearing"], Slab: ["FireRating", "LoadBearing"], Column: ["FireRating", "LoadBearing"], Beam: ["FireRating", "LoadBearing"],
  Member: ["FireRating", "LoadBearing"], Plate: ["FireRating", "LoadBearing"], Chimney: ["FireRating", "LoadBearing"],
  Footing: ["LoadBearing"], Pile: ["LoadBearing"],
  Door: ["FireRating"], Window: ["FireRating"], Roof: ["FireRating"], Covering: ["FireRating"], Stair: ["FireRating"], Ramp: ["FireRating"], CurtainWall: ["FireRating"],
});

/** IFC properties of type IfcBoolean among the standard ones: a spoken/typed "ja"/"nein" becomes true/false even when the element has no value yet. */
const IFC_BOOLESCH = new Set(["loadbearing"]);

/**
 * Property set and property name for a property given without a property set at an IFC element: the element's own common set that
 * already holds the property wins (its spelling is kept by ifcWertAktuell); else `Pset_<Class>Common` from the IFC class
 * (IfcWallStandardCase -> Pset_WallCommon), but only when IFC4 defines the property in that set (IFC_COMMON_EIGENSCHAFTEN).
 * @param {{psets?: Record<string, Record<string, any>>, klasse?: string|null}} bauteil  IFC element (ifcBauteil of the viewer).
 * @param {string} name  Name as given (a field name of the drawn elements, e.g. "feuerwiderstand", or already "FireRating").
 * @returns {{pset: string, name: string}|null}  null = no standard property known for this name, no IFC class, or the class's common set
 *   does not define it (e.g. LoadBearing at a window, FireRating at a space).
 */
export function ifcStandardEigenschaft(bauteil, name) {
  const def = eigenschaftFeld(name);
  const prop = def ? /** @type {Record<string, string>} */ (IFC_STANDARD_EIGENSCHAFT)[def.feld] : undefined;
  if (!prop) return null;
  const eigener = Object.keys(bauteil?.psets || {}).find((p) => /^Pset_.*Common$/i.test(p)
    && Object.keys(bauteil.psets?.[p] || {}).some((k) => k.toLowerCase() === prop.toLowerCase()));
  if (eigener) return { pset: eigener, name: prop };
  const klasse = String(bauteil?.klasse || "");
  if (!/^Ifc[A-Z]/.test(klasse)) return null;
  const stamm = klasse.slice(3).replace(/(StandardCase|ElementedCase)$/, "");
  if (!(/** @type {Record<string, ReadonlyArray<string>>} */ (IFC_COMMON_EIGENSCHAFTEN)[stamm] || []).includes(prop)) return null;
  return { pset: `Pset_${stamm}Common`, name: prop };
}

/** IFC branch of eigenschaftSetzen: builds the journal entry, never touches the element. */
function eigenschaftSetzenIfc(bauteil, eig, opt) {
  if (!eig.pset || !String(eig.pset).trim()) {
    const std = ifcStandardEigenschaft(bauteil, eig.name);
    if (!std) throw new Error(`„${eig.name}“ ist bei IFC-Bauteilen nur mit Eigenschaftssatz möglich (z. B. Pset_WallCommon) — Brandschutz und Tragend gehen auch ohne`);
    eig = { ...eig, pset: std.pset, name: std.name };
  }
  for (const [k, v] of Object.entries({ modell: bauteil.modell, guid: bauteil.guid, pset: eig.pset, eigenschaft: eig.name })) {
    if (!v || !String(v).trim()) throw new Error(`Journal-Eintrag: ${k === "eigenschaft" ? "Eigenschaft" : k} fehlt`);
  }
  const { pset: psetName, eigenschaft: propName, wert: vorher } = ifcWertAktuell(bauteil, eig.pset, eig.name, opt.eintraege);
  // LoadBearing is an IfcBoolean: "ja"/"nein" become true/false also for a property the element does not hold yet (vorher null)
  const vorlage = IFC_BOOLESCH.has(propName.toLowerCase()) && typeof vorher !== "number" ? true : vorher;
  const nachher = typisieren(eig.wert, vorlage);
  if (gleich(vorher, nachher)) throw new Error(`Keine Änderung — ${propName} ist schon ${wertText(nachher)}`);
  const def = eigenschaftFeld(propName);
  const journal = { project_id: bauteil.project_id ?? null, modell: String(bauteil.modell), guid: String(bauteil.guid), pset: psetName,
    eigenschaft: propName, alt: vorher ?? null, wert: nachher ?? null, zeit: opt.zeit || new Date().toISOString() };
  return { quelle: /** @type {"ifc"} */ ("ifc"), bauteil, feld: `${psetName}.${propName}`, label: def?.label ?? propName, vorher, nachher, vorherQuelle: /** @type {"gesetzt"} */ ("gesetzt"), journal };
}

// ---------------------------------------------------------------------------------------------------------------
// Transformation

/**
 * Kind of a drawn element from its shape.
 * @param {any} el
 * @returns {"wand"|"stuetze"|"flaeche"|"oeffnung"|null}
 */
export function elementArt(el) {
  if (!el || typeof el !== "object") return null;
  if (el.a && el.b) return "wand";
  if (Array.isArray(el.points)) return "flaeche";
  if (el.wallIdx != null || el.edge != null) return "oeffnung";
  if (Number.isFinite(el.x) && Number.isFinite(el.z)) return "stuetze";
  return null;
}

/**
 * Centre of a transformation in the plan: the given `zentrum`, else the element's own (wall = midpoint of its axis,
 * column = its position, polygon = centre of its bounding box). Shared by transformieren() and the ghost preview
 * (geisterVorschau.js), so the preview turns about exactly the point the change will.
 * @param {any} bauteil  Drawn wall, column or polygon element.
 * @param {{x: number, z: number}|null|undefined} [zentrum]  Explicit centre in m (plan x east, z down).
 * @returns {{x: number, z: number}}  Centre in m.
 * @throws {Error} German text when the element has no position in the plan.
 */
export function transformZentrum(bauteil, zentrum) {
  if (zentrum) return { x: Number(zentrum.x), z: Number(zentrum.z) };
  const art = elementArt(bauteil);
  if (art === "wand") return { x: (bauteil.a.x + bauteil.b.x) / 2, z: (bauteil.a.z + bauteil.b.z) / 2 };
  if (art === "stuetze") return { x: bauteil.x, z: bauteil.z };
  if (art === "flaeche") {
    const xs = bauteil.points.map((/** @type {{x: number}} */ q) => q.x), zs = bauteil.points.map((/** @type {{z: number}} */ q) => q.z);
    return { x: (Math.min(...xs) + Math.max(...xs)) / 2, z: (Math.min(...zs) + Math.max(...zs)) / 2 };
  }
  throw new Error("Transformieren: das Bauteil hat keine Lage in der Ebene");
}

/**
 * Moves, rotates and/or scales a drawn element in the plan - the same field semantics as the move handlers of the BIM
 * studio (wall: `a`, `b`; column: `x`, `z`; slab/zone/roof: `points`), coordinates in m, plan x east / z "down".
 * Order: scale, then rotate, then move: p' = c + R(S(p - c)) + d with c the centre.
 * Rotation: `drehung_grad` is counter-clockwise AS SEEN in the plan (z points down on the sheet), so +90 turns a wall
 * lying east of the centre to the north (z decreasing).
 * Centre `c`: `zentrum` {x, z} in m if given, else the element's own: wall = midpoint of its axis, column = its
 * position, polygon = centre of its bounding box. Scaling changes the PLAN extent (wall length, column edge length
 * `size`, polygon points); thickness, height and ridge height stay [ASSUMED: a "scale" in the plan is not a change of
 * the build-up]. A column has no stored orientation (square profile): turning it about its own centre changes nothing and is refused.
 * Vertical: `verschiebung_m[1]` (m, up) is only possible in whole storeys (elements hang on `level`); it needs
 * `opt.geschosshoehe_m`.
 * Openings are not transformed on their own (they move with their wall) and are refused.
 * @param {any} bauteil  Drawn wall, column or polygon element.
 * @param {{verschiebung_m?: [number, number, number], drehung_grad?: number, faktor?: number, zentrum?: {x: number, z: number}}} param
 *   verschiebung_m: [dx, dy, dz] in m (x east, y up, z plan); drehung_grad: degrees; faktor: scale factor > 0 (unitless).
 * @param {{geschosshoehe_m?: number}} [opt]  Storey height in m for a vertical move.
 * @returns {any}  The new element (all other fields copied).
 * @throws {Error} German text: nothing to do, factor <= 0, opening, vertical move not in whole storeys, no change.
 */
export function transformieren(bauteil, param, opt = {}) {
  const art = elementArt(bauteil);
  if (!art) throw new Error("Transformieren: das Bauteil hat keine Lage in der Ebene");
  if (art === "oeffnung") throw new Error("Öffnungen wandern mit ihrer Wand — die Wand bewegen, nicht die Öffnung");
  const p = param || {};
  const hatV = p.verschiebung_m != null, hatD = p.drehung_grad != null, hatF = p.faktor != null;
  if (!hatV && !hatD && !hatF) throw new Error("Transformieren: nichts angegeben (verschiebung_m, drehung_grad oder faktor)");
  let dx = 0, dy = 0, dz = 0;
  if (hatV) {
    if (!Array.isArray(p.verschiebung_m) || p.verschiebung_m.length !== 3 || !p.verschiebung_m.every((v) => Number.isFinite(Number(v)))) {
      throw new Error("Transformieren: verschiebung_m braucht drei Zahlen [dx, dy, dz] in m");
    }
    [dx, dy, dz] = p.verschiebung_m.map(Number);
  }
  const grad = hatD ? Number(p.drehung_grad) : 0;
  if (hatD && !Number.isFinite(grad)) throw new Error("Transformieren: drehung_grad ist keine Zahl");
  const faktor = hatF ? Number(p.faktor) : 1;
  if (hatF && !(Number.isFinite(faktor) && faktor > 0)) throw new Error("Transformieren: der Skalierfaktor muss größer als 0 sein");
  if (p.zentrum != null && !(Number.isFinite(Number(p.zentrum.x)) && Number.isFinite(Number(p.zentrum.z)))) throw new Error("Transformieren: zentrum braucht x und z in m");

  /** @type {number} */
  let stufen = 0;
  if (Math.abs(dy) > 1e-9) {
    const sh = Number(opt.geschosshoehe_m);
    if (!(sh > 0)) throw new Error("Transformieren: nach oben/unten verschieben braucht die Geschosshöhe");
    const n = dy / sh;
    if (Math.abs(n - Math.round(n)) > 1e-6) throw new Error(`Transformieren: nach oben/unten geht nur in ganzen Geschossen (${zahlText(sh)} m je Geschoss)`);
    stufen = Math.round(n);
    if ((bauteil.level || 0) + stufen < 0) throw new Error("Transformieren: unter dem untersten Geschoss gibt es nichts");
  }

  const rad = (grad * Math.PI) / 180;
  const c = Math.cos(rad), s = Math.sin(rad);
  const { x: zx, z: zz } = transformZentrum(bauteil, p.zentrum);
  /** one plan point: scale, rotate counter-clockwise as seen on the sheet (z down), move */
  const punkt = (/** @type {{x: number, z: number}} */ q) => {
    const rx = (q.x - zx) * faktor, rz = (q.z - zz) * faktor;
    return { x: runde(zx + rx * c + rz * s + dx), z: runde(zz - rx * s + rz * c + dz) };
  };

  const neu = { ...bauteil };
  if (art === "wand") { neu.a = punkt(bauteil.a); neu.b = punkt(bauteil.b); }
  else if (art === "stuetze") {
    const q = punkt({ x: bauteil.x, z: bauteil.z });
    neu.x = q.x; neu.z = q.z;
    if (hatF && bauteil.size != null) neu.size = runde(Number(bauteil.size) * faktor);
  } else neu.points = bauteil.points.map(punkt);
  if (stufen) neu.level = (bauteil.level || 0) + stufen;
  if (JSON.stringify(neu) === JSON.stringify(bauteil)) {
    throw new Error(art === "stuetze" && hatD ? "Stütze drehen: um den eigenen Mittelpunkt ändert sich nichts (quadratischer Querschnitt)" : "Keine Änderung — die Transformation verändert das Bauteil nicht");
  }
  return neu;
}

/**
 * The geometry fields of a drawn element that a transformation can change (what the undo record keeps).
 * @param {any} el
 * @returns {Record<string, any>}  wall: a, b, level; column: x, z, size, level; polygon: points, level.
 */
export function geometrieVon(el) {
  const art = elementArt(el);
  /** @type {Record<string, any>} */
  const g = {};
  if (art === "wand") { g.a = { ...el.a }; g.b = { ...el.b }; }
  else if (art === "stuetze") { g.x = el.x; g.z = el.z; if (el.size != null) g.size = el.size; }
  else if (art === "flaeche") g.points = el.points.map((q) => ({ ...q }));
  if (el?.level != null) g.level = el.level;
  return g;
}

// ---------------------------------------------------------------------------------------------------------------
// Finding drawn elements by GUID

/** Arrays of the studio with kind, label word, short prefix of the name ("W-12") and the GUID source name. */
const ARRAYS = [
  { name: "customWalls", art: "wand", wort: "Wand", kuerzel: "W", quelle: "customWalls" },
  { name: "customColumns", art: "stuetze", wort: "Stütze", kuerzel: "S", quelle: "customColumns" },
  { name: "customZones", art: "zone", wort: "Raum", kuerzel: "R", quelle: "customZones" },
  { name: "customSlabs", art: "decke", wort: "Decke", kuerzel: "D", quelle: "customSlabs" },
  { name: "customRoofs", art: "dach", wort: "Dach", kuerzel: "Da", quelle: "customRoofs" },
];
const OEFFNUNG_ARRAYS = [{ name: "customWindows", env: false }, { name: "envOpenings", env: true }];

/**
 * The drawn element of a model with this GUID: a stored `guid` wins, else the GUID is derived from project, source
 * and `_idx` exactly as the IFC export and the studio do (same source names as @designer/lib/auswahlBim.js).
 * Hull walls and workshop components are derived, regenerated on every tessellation, and are not found here.
 * @param {any} modell  Model record with the arrays customWalls, customColumns, customZones, customSlabs, customRoofs, customWindows, envOpenings.
 * @param {string} guid  22-character GlobalId.
 * @param {{projektId?: string|number|null}} [opt]  Project of the derived GUIDs.
 * @returns {{art: "wand"|"stuetze"|"zone"|"decke"|"dach"|"oeffnung", arrayName: string, element: any, guid: string,
 *   kurzname: string}|null}  kurzname: "Wand W-12" style name; null when no drawn element has this GUID.
 */
export function bauteilImModell(modell, guid, opt = {}) {
  if (!guid || !modell) return null;
  const pid = opt.projektId ?? null;
  for (const a of ARRAYS) {
    for (const el of Array.isArray(modell[a.name]) ? modell[a.name] : []) {
      if (bauteilGuid(pid, a.quelle, el) === guid) return { art: /** @type {any} */ (a.art), arrayName: a.name, element: el, guid, kurzname: `${a.wort} ${a.kuerzel}-${el._idx}` };
    }
  }
  for (const a of OEFFNUNG_ARRAYS) {
    for (const o of Array.isArray(modell[a.name]) ? modell[a.name] : []) {
      const key = a.env ? `env:${o.level}:${o.edge}` : `cw:${o.wallIdx}`;
      if (bauteilGuid(pid, `oeffnung|${key}|${o.kind}|${o._idx ?? o.u ?? 0}`, o) === guid) {
        return { art: "oeffnung", arrayName: a.name, element: o, guid, kurzname: `${o.kind === "door" ? "Tür" : o.kind === "oeffnung" ? "Öffnung" : "Fenster"} ${o._idx ?? ""}`.trim() };
      }
    }
  }
  return null;
}

/** Next free `_idx` over all element arrays of a model (what the studio's idRef would hand out). @param {any} modell @returns {number} */
export function naechsteFreieIdx(modell) {
  let max = 0;
  for (const k of ["customWalls", "customColumns", "customZones", "customSlabs", "customRoofs", "customWindows", "envOpenings"]) {
    for (const el of Array.isArray(modell?.[k]) ? modell[k] : []) if (Number.isFinite(el?._idx) && el._idx > max) max = el._idx;
  }
  return max + 1;
}

// ---------------------------------------------------------------------------------------------------------------
// Proposal and origin record

/** Short random id of a proposal. @returns {string} 8 characters */
function kurzId() {
  const u = globalThis.crypto?.randomUUID?.();
  return (u ? u.replace(/-/g, "") : Math.random().toString(36).slice(2).padEnd(8, "0")).slice(0, 8);
}

/** Name for a sentence: the target's name, else class and the start of its GUID. @param {{name?: string, klasse?: string, guid?: string}} ziel @returns {string} */
export function zielName(ziel) {
  return ziel?.name?.trim() || `${ziel?.klasse || "Bauteil"} ${String(ziel?.guid || "").slice(0, 6)}`.trim();
}

/**
 * Builds the sentence of a proposal as template + values (translatable) and as plain German (or translated) text.
 * @param {string} art  "eigenschaft" | "transformieren" | "teilen".
 * @param {any} ziel  {guid, klasse, name}.
 * @param {any} params  Parameters of the change.
 * @param {any} vorher
 * @param {any} nachher
 * @param {(s: string) => string} t  Translator of the templates.
 * @returns {{vorlage: string, werte: Record<string, string|number>, satz: string}}
 */
function satzBauen(art, ziel, params, vorher, nachher, t) {
  const name = zielName(ziel);
  if (art === "eigenschaft") {
    const werte = { ziel: name, eigenschaft: nachher?.label ?? params?.name ?? "", vorher: wertText(vorher?.wert, t), nachher: wertText(nachher?.wert, t) };
    return { vorlage: SATZ_VORLAGEN.eigenschaft, werte, satz: satzAusVorlage(t(SATZ_VORLAGEN.eigenschaft), werte) };
  }
  if (art === "transformieren") {
    const schritte = [];
    const v = params?.verschiebung_m;
    if (Array.isArray(v)) {
      const [dx, dy, dz] = v.map(Number);
      const mitHoehe = Math.abs(dy) > 1e-9;
      schritte.push(satzAusVorlage(t(mitHoehe ? SATZ_VORLAGEN.verschiebenHoehe : SATZ_VORLAGEN.verschieben), { dx: zahlText(dx), dy: zahlText(dy), dz: zahlText(dz) }));
    }
    if (params?.drehung_grad != null) schritte.push(satzAusVorlage(t(SATZ_VORLAGEN.drehen), { grad: zahlText(params.drehung_grad) }));
    if (params?.faktor != null) schritte.push(satzAusVorlage(t(SATZ_VORLAGEN.skalieren), { prozent: zahlText(Number(params.faktor) * 100) }));
    const werte = { ziel: name, schritte: schritte.join(", ") };
    return { vorlage: SATZ_VORLAGEN.transformieren, werte, satz: satzAusVorlage(t(SATZ_VORLAGEN.transformieren), werte) };
  }
  const teile = nachher?.teile || [];
  if (teile[0]?.laenge_m != null) {
    const werte = { ziel: name, t: zahlText(nachher.t_m), laengeA: zahlText(teile[0].laenge_m), laengeB: zahlText(teile[1]?.laenge_m) };
    return { vorlage: SATZ_VORLAGEN.teilenWand, werte, satz: satzAusVorlage(t(SATZ_VORLAGEN.teilenWand), werte) };
  }
  const werte = { ziel: name, flaecheA: zahlText(teile[0]?.flaeche_m2), flaecheB: zahlText(teile[1]?.flaeche_m2) };
  return { vorlage: SATZ_VORLAGEN.teilenFlaeche, werte, satz: satzAusVorlage(t(SATZ_VORLAGEN.teilenFlaeche), werte) };
}

/**
 * Assembles a proposal: one change, in words, with its check and its origin - nothing has run yet (guard rail 1).
 * Shapes of `vorher` / `nachher` per kind:
 *  - eigenschaft: `{feld, label, wert}` (IFC: plus `pset`, `eigenschaft`),
 *  - transformieren: `{geometrie}` (see geometrieVon),
 *  - teilen: vorher `{element, laenge_m | flaeche_m2, oeffnungen}`, nachher `{teile: [{_idx, guid, laenge_m | flaeche_m2}, x2],
 *    t_m?, oeffnungen}` (the undo record needs the old element and its openings).
 * @param {{art: "eigenschaft"|"transformieren"|"teilen", ziel: {guid: string, klasse?: string, name?: string, quelle?: "bim"|"ifc", modell?: string},
 *   params: any, herkunft: {quelle: "hand"|"text"|"sprache"|"agent"|"bild", quellen?: string[], befehl_text?: string|null}, vorher: any, nachher: any, pruefung?: any}} eingabe
 *   params: eigenschaft {pset?, name, wert}; transformieren {verschiebung_m?, drehung_grad?, faktor?, zentrum?};
 *   teilen {punkt_m: {x, z}} (wall, m) or {linie: {a, b}} (slab, m); herkunft is mandatory; herkunft.quellen (D-IM-07): all origins in
 *   order, must contain `quelle` (default [quelle]).
 * @param {{t?: (s: string) => string, id?: string, zeit?: string}} [opt]  t: translator of the sentence templates
 *   (default: German as it stands); id/zeit: for tests.
 * @returns {{id: string, art: string, ziel: any, params: any, satz_vorlage: string, satz_werte: Record<string, string|number>, satz: string,
 *   vorher: any, nachher: any, pruefung: any|null, herkunft: {quelle: string, quellen: string[], befehl_text: string|null}, zeit: string, bestaetigung: "erforderlich"}}
 *   `bestaetigung` is "erforderlich" for EVERY origin, also "agent" (decision D-IM-04); satz_vorlage + satz_werte let the
 *   UI translate later (satzAusVorlage(t(vorlage), werte)).
 * @throws {Error} German text: unknown kind, missing target GUID, missing or unknown origin, an origin list that does not fit
 *   (not a list, unknown entry, main origin missing, "hand" with another origin).
 */
export function vorschlagErzeugen(eingabe, opt = {}) {
  const { art, ziel, params, herkunft } = eingabe || {};
  if (!AENDERUNG_ARTEN.includes(/** @type {any} */ (art))) throw new Error(`Vorschlag: unbekannte Art „${art}“`);
  if (!ziel?.guid) throw new Error("Vorschlag: das Ziel braucht eine GUID — ohne GUID wird nicht geändert");
  if (!herkunft?.quelle) throw new Error("Vorschlag: die Herkunft fehlt (hand, text, sprache, agent oder bild)");
  if (!HERKUNFT_QUELLEN.includes(herkunft.quelle)) throw new Error(`Vorschlag: unbekannte Herkunft „${herkunft.quelle}“`);
  const quellen = quellenPruefen(herkunft.quelle, herkunft.quellen);
  const t = opt.t || ((s) => s);
  const { vorlage, werte, satz } = satzBauen(art, ziel, params, eingabe.vorher, eingabe.nachher, t);
  return {
    id: opt.id || kurzId(),
    art,
    ziel: { guid: ziel.guid, klasse: ziel.klasse ?? null, name: ziel.name ?? "", quelle: ziel.quelle || "bim", ...(ziel.modell ? { modell: ziel.modell } : {}) },
    params: params ?? {},
    satz_vorlage: vorlage,
    satz_werte: werte,
    satz,
    vorher: eingabe.vorher,
    nachher: eingabe.nachher,
    pruefung: eingabe.pruefung ?? null,
    herkunft: { quelle: herkunft.quelle, quellen, befehl_text: herkunft.befehl_text ?? null },
    zeit: opt.zeit || new Date().toISOString(),
    bestaetigung: "erforderlich",
  };
}

/**
 * The record an executed step leaves in the history / undo stack of the studio: who asked (origin), with which words,
 * when it ran, what it replaced and what it made - enough to reverse this one step on its own (aenderungUmkehren).
 * @param {ReturnType<typeof vorschlagErzeugen>} vorschlag  The confirmed proposal; its `vorher` must be the state the step really replaced
 *   (vorschlagAusfuehren checks that against the current model before it runs) and its `nachher` what it really made.
 * @param {{zeit?: string, bestaetigt_durch?: string, journal_zeit?: string, marke_vorher?: any}} [opt]
 *   zeit: ISO time the step ran (default now; the proposal's own `zeit` is when it was made); bestaetigt_durch: channel that
 *   confirmed (hand/sprache/tastatur); journal_zeit: `zeit` of the IFC journal entry the step wrote (names exactly that entry
 *   when the step is reversed); marke_vorher: the origin mark the drawn element carried before (null = none).
 * @returns {{herkunft: string, herkunft_quellen: string[], befehl_text: string|null, zeit: string, vorher: any, nachher: any, vorschlag_id: string,
 *   art: string, ziel: any, params: any, satz: string, bestaetigt_durch?: string, journal_zeit?: string, marke_vorher?: any}}
 *   herkunft: "hand" | "text" | "sprache" | "agent" | "bild" (the main origin as a string, not the object - as before D-IM-07);
 *   herkunft_quellen (D-IM-07, a new field next to it): all origins in order, [herkunft] for a proposal without a list;
 *   art/ziel/params/satz are kept so the history can show the step in words and undo it.
 */
export function herkunftEintrag(vorschlag, opt = {}) {
  if (!vorschlag?.id || !vorschlag.herkunft?.quelle) throw new Error("Herkunftseintrag: Vorschlag ohne Id oder Herkunft");
  return {
    herkunft: vorschlag.herkunft.quelle,
    herkunft_quellen: herkunftQuellen(vorschlag.herkunft),
    befehl_text: vorschlag.herkunft.befehl_text ?? null,
    zeit: opt.zeit || new Date().toISOString(),
    vorher: vorschlag.vorher,
    nachher: vorschlag.nachher,
    vorschlag_id: vorschlag.id,
    art: vorschlag.art,
    ziel: vorschlag.ziel,
    params: vorschlag.params,
    satz: vorschlag.satz,
    ...(opt.bestaetigt_durch ? { bestaetigt_durch: opt.bestaetigt_durch } : {}),
    ...(opt.journal_zeit ? { journal_zeit: opt.journal_zeit } : {}),
    ...("marke_vorher" in opt ? { marke_vorher: opt.marke_vorher ?? null } : {}),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Applying a proposal / reversing a step on the model arrays

/**
 * Journal entry of an IFC property change: the shape of entity IfcAenderung (see eigenschaftSetzen), plus - additive,
 * only when known - who asked (`herkunft`, `befehl_text`) and who confirmed (`bestaetigt_durch`), so the origin of the
 * change survives a reload (guard rail 2).
 * @param {{ziel: {guid: string, modell?: string}, vorher?: any, nachher?: any, herkunft?: any, befehl_text?: string|null}} vorschlag
 *   Proposal (herkunft = {quelle, befehl_text}) or origin record (herkunft = string) of an IFC property change.
 * @param {{projektId?: string|number|null, zeit?: string, bestaetigt_durch?: string}} [opt]
 * @returns {{project_id: string|number|null, modell: string, guid: string, pset: string, eigenschaft: string, alt: any, wert: any, zeit: string,
 *   herkunft?: string, herkunft_quellen?: string[], befehl_text?: string|null, bestaetigt_durch?: string}}
 *   herkunft_quellen (D-IM-07): all origins in order, next to the main origin `herkunft`.
 */
export function journalEintragAus(vorschlag, opt = {}) {
  const n = vorschlag.nachher || {};
  const h = vorschlag.herkunft;
  const quelle = typeof h === "string" ? h : h?.quelle;
  const befehlText = typeof h === "string" ? vorschlag.befehl_text : h?.befehl_text;
  return { project_id: opt.projektId ?? null, modell: String(vorschlag.ziel.modell), guid: vorschlag.ziel.guid, pset: n.pset, eigenschaft: n.eigenschaft,
    alt: vorschlag.vorher?.wert ?? null, wert: n.wert ?? null, zeit: opt.zeit || new Date().toISOString(),
    ...(quelle ? { herkunft: quelle, herkunft_quellen: herkunftQuellen(vorschlag), befehl_text: befehlText ?? null } : {}),
    ...(opt.bestaetigt_durch ? { bestaetigt_durch: opt.bestaetigt_durch } : {}) };
}

/** @param {any[]|undefined} arr @param {any} el @returns {any[]} copy of the array with the element of the same `_idx` replaced */
const ersetze = (arr, el) => (arr || []).map((x) => (x._idx === el._idx ? el : x));

/** @param {any} el @param {any} marke @returns {any} the element with the origin mark (MARKE_FELD) when one is given */
const markiert = (el, marke) => (marke ? { ...el, [MARKE_FELD]: marke } : el);

/**
 * Applies a proposal (or its origin record) to the model: returns a NEW model with only the changed arrays copied.
 * Drawn elements only; an IFC change leaves the model alone and yields the journal entry. Throws instead of guessing
 * when the target is missing or the change is not possible - the check (pruefung.js) relies on that.
 * @param {any} modell  Model record (see bauteilImModell).
 * @param {{art: string, ziel: {guid: string, quelle?: string, modell?: string}, params: any, vorher?: any, nachher?: any, herkunft?: any}} vorschlag
 * @param {{projektId?: string|number|null, naechsteIdx?: number, geschosshoehe_m?: number, zeit?: string, bestaetigt_durch?: string,
 *   marke?: {herkunft: string, herkunft_quellen?: string[], befehl_text: string|null, zeit: string, vorschlag_id: string}}} [opt]
 *   naechsteIdx: free `_idx` for the second part of a split (default: naechsteFreieIdx(modell)); marke: origin mark written
 *   onto the changed element(s) as MARKE_FELD (only the real execution passes it, the check works on an unmarked copy).
 * @returns {{modell: any, journal?: ReturnType<typeof journalEintragAus>, warnungen: string[], neu: string[], entfernt: string[],
 *   element?: any, teile?: any[], oeffnungenNach?: any[]}}
 *   neu / entfernt: GUIDs of elements that were created / removed (a split removes one and creates two); element: the changed
 *   element (property, transformation); teile: the two parts of a split, as stored; oeffnungenNach: the openings of the two
 *   wall parts after a wall split, as stored (the reversal compares against them).
 * @throws {Error} German text.
 */
export function modellMitAenderung(modell, vorschlag, opt = {}) {
  const pid = opt.projektId ?? null;
  if (vorschlag.art === "eigenschaft" && vorschlag.ziel.quelle === "ifc") {
    return { modell, journal: journalEintragAus(vorschlag, { projektId: pid, zeit: opt.zeit, bestaetigt_durch: opt.bestaetigt_durch }), warnungen: [], neu: [], entfernt: [] };
  }
  const fund = bauteilImModell(modell, vorschlag.ziel.guid, { projektId: pid });
  if (!fund) throw new Error(`Bauteil nicht gefunden: ${vorschlag.ziel.guid} (Hülle und Werkstatt-Bauteile sind abgeleitet und hier nicht änderbar)`);
  const { element, arrayName } = fund;
  const p = vorschlag.params || {};
  if (vorschlag.art === "eigenschaft") {
    const r = eigenschaftSetzen(element, p);
    const neu = markiert(r.bauteil, opt.marke);
    return { modell: { ...modell, [arrayName]: ersetze(modell[arrayName], neu) }, warnungen: [], neu: [], entfernt: [], element: neu };
  }
  if (vorschlag.art === "transformieren") {
    const neu = markiert(transformieren(element, p, { geschosshoehe_m: opt.geschosshoehe_m }), opt.marke);
    return { modell: { ...modell, [arrayName]: ersetze(modell[arrayName], neu) }, warnungen: [], neu: [], entfernt: [], element: neu };
  }
  // the studio's own counter wins; else the number the preview announced; else the next free one
  const naechsteIdx = opt.naechsteIdx ?? vorschlag.nachher?.teile?.[1]?._idx ?? naechsteFreieIdx(modell);
  if (fund.art === "wand") {
    if (!p.punkt_m) throw new Error("Wand teilen: Teilungspunkt fehlt (punkt_m)");
    const r = wandTeilen(element, p.punkt_m, { naechsteIdx, projektId: pid, oeffnungen: modell.customWindows });
    let fenster = modell.customWindows || [];
    for (const o of r.oeffnungen) fenster = ersetze(fenster, o);
    const teile = r.teile.map((w) => markiert(w, opt.marke));
    const waende = ersetze(modell.customWalls, teile[0]);
    const oeffnungenNach = fenster.filter((/** @type {any} */ o) => o.wallIdx === teile[0]._idx || o.wallIdx === teile[1]._idx);
    return { modell: { ...modell, customWalls: [...waende, teile[1]], customWindows: fenster }, warnungen: r.warnungen, neu: [teile[0].guid, teile[1].guid], entfernt: [r.guidAlt], teile, oeffnungenNach };
  }
  if (["decke", "zone", "dach"].includes(fund.art)) {
    if (!p.linie) throw new Error("Decke teilen: Teilungslinie fehlt (linie)");
    const quelle = ARRAYS.find((a) => a.name === arrayName)?.quelle;
    const r = deckeTeilen(element, p.linie, { naechsteIdx, projektId: pid, quelle });
    const teile = r.teile.map((w) => markiert(w, opt.marke));
    return { modell: { ...modell, [arrayName]: [...ersetze(modell[arrayName], teile[0]), teile[1]] }, warnungen: r.warnungen, neu: [teile[0].guid, teile[1].guid], entfernt: [r.guidAlt], teile, oeffnungenNach: [] };
  }
  throw new Error("Teilen geht nur bei Wänden und Flächen (Decke, Raum, Dach)");
}

/** Openings in a stable order for comparing two states. @param {any[]} liste @returns {any[]} */
const nachIdx = (liste) => [...liste].sort((x, y) => (Number(x._idx) || 0) - (Number(y._idx) || 0));

/**
 * Reverses ONE executed step on its own, from its origin record (or proposal). A step goes back only while the
 * state it made is still there: if a LATER step (or a hand edit) changed the same property, the same geometry or one of
 * the parts of a split, it refuses with a German text instead of putting an old snapshot over the newer work
 * ("erst den neueren Schritt zurücknehmen"). Steps on different properties of one element do not block each other.
 * What goes back: the old property value, the old geometry (the origin mark too, if it is still this step's), the
 * undivided element with its openings. If the target of this step has vanished meanwhile, it throws instead of guessing.
 * An IFC property change is reversed by deleting its journal entry: the result names it in `journal.loeschen`
 * (modell, guid, pset, eigenschaft and the `zeit` that identifies exactly this entry).
 * @param {any} modell  Current model record.
 * @param {ReturnType<typeof herkunftEintrag>} eintrag  Record of the executed step.
 * @param {{projektId?: string|number|null, spaetere?: Array<{art: string, ziel?: {guid?: string}}>,
 *   eintraege?: Array<{modell: string, guid: string, pset: string, eigenschaft: string, zeit: string}>}} [opt]
 *   spaetere: the later steps of the history that are still active (a later split of the same element blocks);
 *   eintraege: stored journal entries of the IFC model (when given, the entry of this step must exist and be the newest of its property).
 * @returns {{modell: any, journal?: {loeschen: {modell: string, guid: string, pset: string, eigenschaft: string, zeit?: string}}}}
 * @throws {Error} German text when the element of the step no longer exists or a later change blocks the reversal.
 */
export function aenderungUmkehren(modell, eintrag, opt = {}) {
  const pid = opt.projektId ?? null;
  if (eintrag.art === "eigenschaft" && eintrag.ziel?.quelle === "ifc") {
    const n = eintrag.nachher || {};
    const jz = eintrag.journal_zeit;
    if (jz && Array.isArray(opt.eintraege)) {
      const gleiche = opt.eintraege.filter((e) => e.modell === String(eintrag.ziel.modell) && e.guid === eintrag.ziel.guid && e.pset === n.pset && e.eigenschaft === n.eigenschaft);
      if (!gleiche.some((e) => e.zeit === jz)) throw new Error("Der Journal-Eintrag dieses Schrittes ist nicht mehr da");
      if (gleiche.some((e) => String(e.zeit) > String(jz))) {
        throw new Error(`Spätere Änderung an ${n.eigenschaft} im Journal — erst den neueren Schritt zurücknehmen (sonst ginge er verloren)`);
      }
    }
    return { modell, journal: { loeschen: { modell: String(eintrag.ziel.modell), guid: eintrag.ziel.guid, pset: n.pset, eigenschaft: n.eigenschaft, ...(jz ? { zeit: jz } : {}) } } };
  }
  const weg = () => new Error("Dieser Schritt lässt sich nicht zurücknehmen — das Bauteil gibt es nicht mehr");
  if (eintrag.art === "teilen") {
    const teile = eintrag.nachher?.teile || [];
    const alt = eintrag.vorher?.element;
    const kandidaten = elementArt(alt) === "wand" ? ["customWalls"] : ["customSlabs", "customZones", "customRoofs"];
    const arrayName = kandidaten.find((k) => (modell[k] || []).some((x) => x.guid === teile[0]?.guid));
    const arr = modell[arrayName || ""] || [];
    const a = arr.find((x) => x.guid === teile[0]?.guid), b = arr.find((x) => x.guid === teile[1]?.guid);
    if (!arrayName || !a || !b) throw weg();
    // both parts (and, for a wall, their openings) must still be exactly as the split made them, else a later
    // property, move or new window would be lost silently
    const geaendert = new Error("Eines der beiden Teile (oder eine Öffnung darin) wurde nach dem Teilen verändert — erst die späteren Schritte zurücknehmen, sonst gingen sie verloren");
    if (teile[0]?.element && teile[1]?.element && (stabil(a) !== stabil(teile[0].element) || stabil(b) !== stabil(teile[1].element))) throw geaendert;
    if (elementArt(alt) === "wand" && Array.isArray(eintrag.nachher?.oeffnungenNach)) {
      const jetzt = (modell.customWindows || []).filter((/** @type {any} */ o) => o.wallIdx === a._idx || o.wallIdx === b._idx);
      if (stabil(nachIdx(jetzt)) !== stabil(nachIdx(eintrag.nachher.oeffnungenNach))) throw geaendert;
    }
    const neu = { ...modell, [arrayName]: arr.filter((x) => x !== b).map((x) => (x === a ? alt : x)) };
    if (eintrag.vorher?.oeffnungen?.length) {
      let fenster = modell.customWindows || [];
      for (const o of eintrag.vorher.oeffnungen) fenster = ersetze(fenster, o);
      neu.customWindows = fenster;
    }
    return { modell: neu };
  }
  // a later split of the same element: its old GUID is gone, say why instead of "the element is gone"
  if ((opt.spaetere || []).some((s) => s.art === "teilen" && s.ziel?.guid === eintrag.ziel?.guid)) {
    throw new Error("Das Bauteil wurde danach geteilt — erst das Teilen zurücknehmen");
  }
  const fund = bauteilImModell(modell, eintrag.ziel?.guid, { projektId: pid });
  if (!fund) throw weg();
  /** @type {any} */
  let el;
  if (eintrag.art === "eigenschaft") {
    el = { ...fund.element };
    const v = eintrag.vorher || {};
    const n = eintrag.nachher || {};
    const feld = n.feld ?? v.feld;
    if (!gleich(fund.element[feld] ?? null, n.wert ?? null)) {
      throw new Error(`Spätere Änderung an ${n.label ?? v.label ?? feld} (jetzt ${wertText(fund.element[feld] ?? null)}, nach diesem Schritt ${wertText(n.wert ?? null)}) — erst den neueren Schritt zurücknehmen`);
    }
    // a value that was only derived (never stored) goes back to "unset": the stored field is removed
    if (v.quelle === "abgeleitet" || v.wert == null) delete el[v.feld];
    else el[v.feld] = v.wert;
  } else {
    if (eintrag.nachher?.geometrie && stabil(geometrieVon(fund.element)) !== stabil(eintrag.nachher.geometrie)) {
      throw new Error("Das Bauteil wurde nach diesem Schritt noch einmal bewegt oder verändert — erst den neueren Schritt zurücknehmen");
    }
    el = { ...fund.element, ...(eintrag.vorher?.geometrie || {}) };
  }
  // the origin mark goes back with the step - but only while it is still this step's mark
  if ("marke_vorher" in eintrag && el[MARKE_FELD]?.vorschlag_id === eintrag.vorschlag_id) {
    if (eintrag.marke_vorher) el[MARKE_FELD] = eintrag.marke_vorher;
    else delete el[MARKE_FELD];
  }
  return { modell: { ...modell, [fund.arrayName]: ersetze(modell[fund.arrayName], el) } };
}
