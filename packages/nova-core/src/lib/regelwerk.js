// Rule core (80-01, D-P80-C): legal and office values as dated series with a source,
// shared by the accounting rules of phase 79, the HR rules of phase 80 and the
// calculation values of phase 81. Phase 79 already delivers this shape through
// alsRegeln(); 81 (E-16) uses it for the calculation values.
//
// A rule's standard is a time series (`werte`, each row valid from `ab`). An office
// may override an EDITABLE rule; legal values (`art:'gesetz'`), formulas and rules
// marked `editierbar:false` are read-only, exactly like GESETZ in 79 — a change of
// the law comes with an update of the code, not with a click.
//
// Two storage kinds per group (RegelGruppe.speicher):
// - `zeilen`:  one Setting row per rule, key "regel:<id>", value {wert, gueltig_ab,
//              notiz, gesetzt_am, basis_stand, verlauf[≤20]} (HR, 81; E-16 "gültig ab").
// - `setting`: one field inside an existing Setting object — 79's Setting{key:
//              "buchhaltung"} — read from the row 79 reads (the first of the key).
// There is deliberately no per-entity fallback as in katalogSnapshot
// (rules/catalogs.js): a rule either has an override or it has none.
//
// The rule shape, verbatim from 80-RESEARCH § Regel-Form (the JSDoc typedefs below
// repeat it for tsc and add `hinweis`, which the 79 adapter sets on read-only rules):
//
// @typedef {{
//   id: string,                  // stable 'gruppe.name': 'personal.mindestlohn', 'buchhaltung.zahlungsziel_tage', 'zeit_honorar.gemeinkosten'
//   label: string,               // German i18n key
//   einheit: string,             // 'Euro/Stunde' | 'Prozent' | 'Tage' | 'Monate' | 'Euro/km' | 'MM-TT' …
//   typ: 'zahl'|'datum'|'monatstag'|'auswahl'|'formel'|'tabelle'|'text'
//        |'prozent'|'betrag'|'ja_nein'|'objekt'|'liste'|'termine',   // last six: types of 79 alsRegeln() as built
//   art: 'gesetz'|'buero'|'praxis',   // gesetz = read-only (like 79 GESETZ)
//   werte: Array<{ab: string, wert: any, quelle?: string}>,
//   stand: string, quelle: string, assumed?: string|boolean,     // 79: boolean
//   grenze?: {min?: number, max?: number, modus: 'fail'|'warn', quelle?: string},
//   optionen?: Array<{wert: string, label: string}>,
//   formel?: (stichtag: string, wertVon: (id: string) => any) => any,
//   editierbar?: boolean, abschnitt?: string
// }} Regel
//  @typedef {{ gruppe: string, titel: string, regeln: Regel[], sichtbar: (kontext) => boolean,
//    speicher: {art: 'zeilen'} | {art: 'setting', key: string, feld: (id: string) => string},
//    vorSchreiben?: () => Promise<void> }} RegelGruppe
//
// In:  rules, override objects, Setting rows, a key date 'YYYY-MM-DD'.
// Out: REGEL_PRAEFIX, regelSchluessel, istEditierbar, wertAm, berechneFormel,
//      wirksamerWert, pruefeOverride, REGEL_PRUEFTEXTE, overridesAus, regelWerteAus,
//      heuteLokal (re-exported from the 79 calendar core). Pure and isomorphic.
//
// 80-07 adds the write-side and display helpers of the editor (still pure — the
// actual reads/writes live in ./useRegelwerkBearbeiten.js): overrideWert (builds
// the next override + its verlauf), settingFeldSetzen/-Entfernen (storage kind
// `setting`), statusFuer (row status), tabellenZeilen (one row set per visible
// group, for RegelwerkTabelle.jsx) and rechenweg (formula/table display text).

import { neuesteZeile } from "./einstellungen.js";
import { heuteLokal, parseTag } from "./kalender/datum.js";

// One date module (79-01): today comes from the calendar core, not from a second one here.
export { heuteLokal };

/**
 * One rule of a rule book (see the typedef in the file header).
 * @typedef {{
 *   id: string, label: string, einheit: string, typ: string, art: 'gesetz'|'buero'|'praxis',
 *   werte: Array<{ab: string, wert: any, quelle?: string}>, stand: string, quelle: string,
 *   assumed?: string|boolean, grenze?: {min?: number, max?: number, modus: 'fail'|'warn', quelle?: string},
 *   optionen?: Array<{wert: string, label: string}>, formel?: (stichtag: string, wertVon: (id: string) => any) => any,
 *   editierbar?: boolean, abschnitt?: string, hinweis?: string,
 * }} Regel
 */

/**
 * One rule book in the registry (src/lib/settings/regelwerke.js). `vorSchreiben` is
 * called by the write path (80-07) before the first write into the group.
 * @typedef {{
 *   gruppe: string, titel: string, regeln: Regel[], sichtbar: (kontext: any) => boolean,
 *   speicher: {art: 'zeilen'} | {art: 'setting', key: string, feld: (id: string) => string},
 *   vorSchreiben?: () => Promise<void>,
 * }} RegelGruppe
 */

/**
 * An office override: {wert} for storage kind `setting`; {wert, gueltig_ab, notiz,
 * gesetzt_am, basis_stand, verlauf} for storage kind `zeilen`.
 * @typedef {{wert: any, gueltig_ab?: string, notiz?: string, gesetzt_am?: string, basis_stand?: string, verlauf?: any[]}} Override
 */

/**
 * Effective value of a rule on a key date.
 * @typedef {{wert: any, herkunft: 'standard'|'eigen', ab: string|null, quelle: string|null, abweichend: boolean, veraltet: boolean}} Wirksam
 */

/** Prefix of the Setting key of one rule override (storage kind `zeilen`). */
export const REGEL_PRAEFIX = "regel:";

/**
 * Setting key of the override of a rule.
 * @param {string} id rule id, e.g. "personal.urlaub_buero_standard"
 * @returns {string} e.g. "regel:personal.urlaub_buero_standard"
 */
export function regelSchluessel(id) {
  return REGEL_PRAEFIX + id;
}

/**
 * True when an office may override the rule: not a legal value, not a formula,
 * not marked `editierbar:false`.
 * @param {Regel|null|undefined} regel
 * @returns {boolean}
 */
export function istEditierbar(regel) {
  if (!regel) return false;
  return regel.art !== "gesetz" && regel.editierbar !== false && regel.typ !== "formel" && typeof regel.formel !== "function";
}

/**
 * Row of the standard series that applies on a date: the one with the latest
 * `ab` ≤ stichtag (the series need not be sorted).
 * @param {Regel} regel
 * @param {string} stichtag 'YYYY-MM-DD'
 * @returns {{ab: string, wert: any, quelle?: string}|null}
 */
function zeileAm(regel, stichtag) {
  let treffer = null;
  for (const z of Array.isArray(regel?.werte) ? regel.werte : []) {
    if (!z || typeof z.ab !== "string" || z.ab > stichtag) continue;
    if (!treffer || z.ab >= treffer.ab) treffer = z;
  }
  return treffer;
}

/**
 * Standard value of a rule on a date (no override, no formula).
 * @param {Regel} regel
 * @param {string} stichtag 'YYYY-MM-DD'
 * @returns {any} the value of the youngest row with ab ≤ stichtag, or null before the first row
 */
export function wertAm(regel, stichtag) {
  const z = zeileAm(regel, stichtag);
  return z ? z.wert : null;
}

/**
 * Value of a formula rule on a date. The formula gets a reader `(id) => value on the
 * same date`; a formula that cannot compute (a missing input) returns null itself.
 * Errors inside a formula are programming errors and are thrown, not hidden.
 * @param {Regel} regel rule with `formel`
 * @param {string} stichtag 'YYYY-MM-DD'
 * @param {((id: string, stichtag: string) => any)|undefined} wertVon effective value of another rule on a date
 * @returns {any} the computed value, or null (no formula, no reader, non-finite number)
 */
export function berechneFormel(regel, stichtag, wertVon) {
  if (typeof regel?.formel !== "function" || typeof wertVon !== "function") return null;
  const w = regel.formel(stichtag, (id) => wertVon(id, stichtag));
  if (typeof w === "number" && !Number.isFinite(w)) return null;
  return w ?? null;
}

/**
 * Deep equality for rule values (numbers, strings, booleans, arrays, plain objects).
 * @param {any} a
 * @param {any} b
 * @returns {boolean}
 */
function gleich(a, b) {
  if (a === b) return true;
  if (a && b && typeof a === "object" && typeof b === "object") return JSON.stringify(a) === JSON.stringify(b);
  return false;
}

/**
 * Effective value of a rule on a date, from the standard series and the office
 * override.
 * - Legal values, formulas and `editierbar:false` ignore every override.
 * - Candidates are the standard row with the latest ab ≤ stichtag and the override
 *   with gueltig_ab ≤ stichtag; the younger one wins, on a tie the override.
 * - An override WITHOUT gueltig_ab (storage kind `setting`, 79) applies on every
 *   date and always wins: 79 stores no date and its stored value replaces
 *   BUERO_STANDARD as a whole (wirksameEinstellungen). Read as "valid from
 *   0000-01-01" it would lose against the 79 standard row (ab = 2026-09-27) and a
 *   stored payment term of 21 days would show as 14.
 * - `veraltet`: the standard carries a newer `stand` than the one the override was
 *   set against (`basis_stand`) — the office should look at it again.
 * @param {Regel} regel
 * @param {Override|null|undefined} override
 * @param {string} stichtag 'YYYY-MM-DD'
 * @param {(id: string, stichtag: string) => any} [wertVon] reader for formula inputs
 * @returns {Wirksam} `quelle` is null for the office's own value
 */
export function wirksamerWert(regel, override, stichtag, wertVon) {
  if (regel?.typ === "formel" || typeof regel?.formel === "function") {
    return { wert: berechneFormel(regel, stichtag, wertVon), herkunft: "standard", ab: null, quelle: regel.quelle ?? null, abweichend: false, veraltet: false };
  }
  const std = zeileAm(regel, stichtag);
  const standard = /** @type {Wirksam} */ ({
    wert: std ? std.wert : null, herkunft: "standard", ab: std ? std.ab : null,
    quelle: (std && std.quelle) || regel?.quelle || null, abweichend: false, veraltet: false,
  });
  const gilt = override && typeof override === "object" && Object.prototype.hasOwnProperty.call(override, "wert") && istEditierbar(regel);
  if (!gilt) return standard;
  const veraltet = Boolean(override.basis_stand) && typeof regel.stand === "string" && regel.stand > String(override.basis_stand);
  const ab = typeof override.gueltig_ab === "string" && override.gueltig_ab ? override.gueltig_ab : null;
  const eigenGewinnt = ab === null || (ab <= stichtag && (!std || ab >= std.ab));
  if (!eigenGewinnt) return { ...standard, veraltet };
  return { wert: override.wert, herkunft: "eigen", ab, quelle: null, abweichend: !gleich(override.wert, std ? std.wert : null), veraltet };
}

/**
 * German message templates of pruefeOverride (i18n keys; the UI translates the
 * template with t() and fills the {placeholders} from `werte`).
 * @type {Readonly<Record<string, string>>}
 */
export const REGEL_PRUEFTEXTE = Object.freeze({
  unbekannt: "Unbekannte Regel.",
  formel: "Berechneter Wert — nicht überschreibbar ({quelle}).",
  gesetz: "Gesetzlicher Wert — nur lesend ({quelle}, Stand {stand}). Änderungen kommen mit einem Update.",
  fest: "Dieser Wert ist nicht überschreibbar ({quelle}).",
  zahl: "Bitte eine Zahl eingeben.",
  monatstag: "Bitte einen Tag im Format MM-TT eingeben.",
  auswahl: "Dieser Wert steht nicht zur Auswahl.",
  ja_nein: "Bitte Ja oder Nein wählen.",
  datum: "Bitte ein Datum eingeben.",
  text: "Bitte einen Text eingeben.",
  min: "Mindestens {grenze} {einheit} ({quelle}).",
  max: "Höchstens {grenze} {einheit} ({quelle}).",
});

/**
 * @param {string} schluessel key of REGEL_PRUEFTEXTE
 * @param {'fail'|'warn'} schwere
 * @param {Record<string, string>} [werte] placeholder values
 * @returns {{schwere: 'fail'|'warn', text: string, schluessel: string, werte: Record<string, string>}}
 */
function befund(schluessel, schwere, werte = {}) {
  const vorlage = REGEL_PRUEFTEXTE[schluessel];
  const text = vorlage.replace(/\{(\w+)\}/g, (_, k) => String(werte[k] ?? "")).replace(/\s+\(\)/, "");
  return { schwere, text, schluessel: vorlage, werte };
}

/** German number text (decimal comma) for messages. @param {number} n */
const zahlText = (n) => String(n).replace(".", ",");

/**
 * Checks an office value against its rule before it is stored.
 * - `fail` only here: a legal value, a formula, a fixed value, a wrong type, or an
 *   office value beyond its `grenze` with modus 'fail' (e.g. a holiday standard
 *   below § 3 BUrlG would be void). Contract checks in lane B only warn (D-P80-17).
 * - `warn` when the `grenze` says so: the value is legal in special cases, the
 *   office decides and the warning names the norm.
 * @param {Regel|null|undefined} regel
 * @param {any} wert the new value, already converted to its type (number, 'MM-TT', option value …)
 * @returns {null|{schwere: 'fail'|'warn', text: string, schluessel: string, werte: Record<string, string>}}
 *   null = acceptable; `text` is the filled German message, `schluessel` its template
 */
export function pruefeOverride(regel, wert) {
  if (!regel) return befund("unbekannt", "fail");
  const quelle = String(regel.quelle ?? "");
  if (regel.typ === "formel" || typeof regel.formel === "function") return befund("formel", "fail", { quelle });
  // Like GESETZ in 79: legal values change with an update of the code.
  if (regel.art === "gesetz") return befund("gesetz", "fail", { quelle, stand: String(regel.stand ?? "") });
  if (regel.editierbar === false) return befund("fest", "fail", { quelle });

  switch (regel.typ) {
    case "zahl": case "prozent": case "betrag":
      if (typeof wert !== "number" || !Number.isFinite(wert)) return befund("zahl", "fail");
      break;
    case "monatstag":
      if (typeof wert !== "string" || !/^\d{2}-\d{2}$/.test(wert) || !parseTag(`2000-${wert}`)) return befund("monatstag", "fail");
      break;
    case "auswahl":
      if (!(regel.optionen || []).some((o) => o.wert === wert)) return befund("auswahl", "fail");
      break;
    case "ja_nein":
      if (typeof wert !== "boolean") return befund("ja_nein", "fail");
      break;
    case "datum":
      if (parseTag(wert) !== wert) return befund("datum", "fail");
      break;
    case "text":
      if (typeof wert !== "string") return befund("text", "fail");
      break;
    default:
      // tabelle, objekt, liste, termine: shown read-only by the editor.
      return befund("fest", "fail", { quelle });
  }

  const g = regel.grenze;
  if (g && typeof wert === "number") {
    const schwere = g.modus === "warn" ? "warn" : "fail";
    const werte = { einheit: String(regel.einheit ?? ""), quelle: String(g.quelle ?? "") };
    if (typeof g.min === "number" && wert < g.min) return befund("min", schwere, { ...werte, grenze: zahlText(g.min) });
    if (typeof g.max === "number" && wert > g.max) return befund("max", schwere, { ...werte, grenze: zahlText(g.max) });
  }
  return null;
}

/**
 * Overrides of one group, read from all Setting rows.
 * - `zeilen`: the rows "regel:<id>" of the group's rules, the newest row per key
 *   (neuesteZeile); its `value` is the override.
 * - `setting`: `value[feld(id)]` of the row 79 reads — the FIRST row with the key,
 *   like einstellungLesen (src/lib/accounting/speicher.js); not the newest, or 79
 *   and 80 would read different rows of a duplicate (BEFUNDE-79 N-17). Only
 *   editable rules, as {wert} without gueltig_ab.
 * @param {RegelGruppe} gruppe
 * @param {ReadonlyArray<any>|null|undefined} settingRows all Setting rows
 * @returns {Map<string, Override>} rule id → override
 */
export function overridesAus(gruppe, settingRows) {
  const rows = Array.isArray(settingRows) ? settingRows.filter((r) => r && typeof r === "object") : [];
  /** @type {Map<string, Override>} */
  const aus = new Map();
  const regeln = Array.isArray(gruppe?.regeln) ? gruppe.regeln : [];
  const speicher = gruppe?.speicher;
  if (speicher?.art === "zeilen") {
    for (const regel of regeln) {
      const { zeile } = neuesteZeile(rows.filter((r) => r.key === regelSchluessel(regel.id)));
      if (zeile && zeile.value && typeof zeile.value === "object" && !Array.isArray(zeile.value)) aus.set(regel.id, zeile.value);
    }
  } else if (speicher?.art === "setting") {
    const zeile = rows.find((r) => r.key === speicher.key);
    const value = zeile && zeile.value && typeof zeile.value === "object" ? zeile.value : null;
    if (value) {
      for (const regel of regeln) {
        if (!istEditierbar(regel)) continue;
        const feld = speicher.feld(regel.id);
        if (Object.prototype.hasOwnProperty.call(value, feld)) aus.set(regel.id, { wert: value[feld] });
      }
    }
  }
  return aus;
}

/**
 * Builds the next override for storage kind `zeilen` (80-07): the new value plus
 * bookkeeping fields, with the previous override pushed onto `verlauf` (newest
 * first, capped at 20 entries so the row cannot grow without bound).
 * @param {{wert: any, gueltig_ab?: string, notiz?: string}} eingabe the new value
 * @param {Regel} regel the rule (its `stand` becomes `basis_stand`)
 * @param {Override|null|undefined} vorher the override this call replaces, if any
 * @returns {Override}
 */
export function overrideWert(eingabe, regel, vorher) {
  /** @type {Override} */
  const eintrag = { wert: eingabe?.wert, gesetzt_am: heuteLokal(), basis_stand: regel?.stand };
  if (typeof eingabe?.gueltig_ab === "string" && eingabe.gueltig_ab) eintrag.gueltig_ab = eingabe.gueltig_ab;
  if (typeof eingabe?.notiz === "string" && eingabe.notiz) eintrag.notiz = eingabe.notiz;
  const vorherEintrag = vorher && typeof vorher === "object" && Object.prototype.hasOwnProperty.call(vorher, "wert")
    ? { wert: vorher.wert, gueltig_ab: vorher.gueltig_ab, notiz: vorher.notiz, gesetzt_am: vorher.gesetzt_am, basis_stand: vorher.basis_stand }
    : null;
  const verlaufVorher = Array.isArray(vorher?.verlauf) ? vorher.verlauf : [];
  eintrag.verlauf = [...(vorherEintrag ? [vorherEintrag] : []), ...verlaufVorher].slice(0, 20);
  return eintrag;
}

/**
 * Sets one field of a plain object, returning a NEW object (storage kind
 * `setting`, 79's Setting{key:"buchhaltung"}). The data layer's `update` merges
 * only the top level of the record, so the whole object is written back, never a
 * partial patch.
 * @param {Record<string, any>|null|undefined} objekt
 * @param {string} feld
 * @param {any} wert
 * @returns {Record<string, any>} a new object; `objekt` is never mutated
 */
export function settingFeldSetzen(objekt, feld, wert) {
  return { ...(objekt && typeof objekt === "object" ? objekt : {}), [feld]: wert };
}

/**
 * Removes one field of a plain object, returning a NEW object ("Zurücksetzen" for
 * storage kind `setting`: the field is gone, 79's own default applies again).
 * @param {Record<string, any>|null|undefined} objekt
 * @param {string} feld
 * @returns {Record<string, any>} a new object without `feld`; `objekt` is never mutated
 */
export function settingFeldEntfernen(objekt, feld) {
  const basis = objekt && typeof objekt === "object" ? objekt : {};
  /** @type {Record<string, any>} */
  const aus = {};
  for (const k of Object.keys(basis)) if (k !== feld) aus[k] = basis[k];
  return aus;
}

/**
 * Display status of a rule row in the editor (80-07).
 * - `gesetzlich` / `formel` / `fest`: the rule's own nature, override or not.
 * - `standard`: editable, no override in effect and none scheduled.
 * - `geplant`: an override exists but its `gueltig_ab` is still in the future.
 * - `abweichend`: an override is in effect now and differs from the standard.
 * - `veraltet`: the legal/office standard changed after this override was set
 *   (`regel.stand` newer than `override.basis_stand`) — checked ahead of
 *   `geplant`/`abweichend`, so a stale override is flagged even before its date.
 * @param {Regel|null|undefined} regel
 * @param {Override|null|undefined} override
 * @param {string} stichtag 'YYYY-MM-DD'
 * @returns {'standard'|'geplant'|'abweichend'|'veraltet'|'gesetzlich'|'formel'|'fest'}
 */
export function statusFuer(regel, override, stichtag) {
  if (!regel) return "standard";
  // Order matches pruefeOverride's own priority (80-01 deviation 3): a rule can be
  // BOTH `art:'gesetz'` and `typ:'formel'` (minijob_grenze) or `editierbar:false`
  // (kuendigung_staffel) — the more specific fact (formula, fixed) wins over the
  // general "it is a legal value" label.
  if (regel.typ === "formel" || typeof regel.formel === "function") return "formel";
  if (regel.editierbar === false) return "fest";
  if (regel.art === "gesetz") return "gesetzlich";
  if (!override || typeof override !== "object" || !Object.prototype.hasOwnProperty.call(override, "wert")) return "standard";
  const w = wirksamerWert(regel, override, stichtag);
  if (w.veraltet) return "veraltet";
  return w.herkunft === "eigen" ? "abweichend" : "geplant";
}

/**
 * Table rows of "Einstellungen › Regelwerke" (80-07): one entry per visible
 * group, its rules grouped into sections (`regel.abschnitt`, or the group title
 * when a rule carries none — true for every 79 accounting rule).
 * @param {ReadonlyArray<RegelGruppe>} regelwerke
 * @param {Record<string, Override>|null|undefined} overrides rule id → override,
 *   flat across every group (ids are globally unique, e.g. "personal.x", "buchhaltung.y")
 * @param {any} kontext passed to each group's `sichtbar(kontext)`
 * @param {string} stichtag 'YYYY-MM-DD'
 * @param {(id: string, stichtag: string) => any} [wertVon] reader for formula inputs (regelWerteAus's)
 * @returns {Array<{gruppe: string, titel: string, speicherArt: string, abschnitte: Array<{titel: string, zeilen: Array<{regel: Regel, standard: any, wirksam: Wirksam, override: Override|null, status: string, editierbar: boolean, rechenwegAnzeige: {text: string|null, zeilen: string[]|null}}>}>}>}
 *   `rechenwegAnzeige` is `rechenweg(regel, stichtag, wertVon)` (the display component has no
 *   `wertVon` reader of its own — 80-07 task 3 deviation, see RegelwerkTabelle.jsx file header).
 */
export function tabellenZeilen(regelwerke, overrides, kontext, stichtag, wertVon) {
  const ov = overrides && typeof overrides === "object" ? overrides : {};
  const gruppen = (Array.isArray(regelwerke) ? regelwerke : []).filter((g) => (typeof g?.sichtbar === "function" ? g.sichtbar(kontext || {}) : true));
  return gruppen.map((gruppe) => {
    /** @type {Map<string, any[]>} */
    const abschnitte = new Map();
    for (const regel of gruppe.regeln || []) {
      const override = ov[regel.id] ?? null;
      const wirksam = wirksamerWert(regel, override, stichtag, wertVon);
      const zeile = {
        regel, standard: wertAm(regel, stichtag), wirksam, override,
        status: statusFuer(regel, override, stichtag), editierbar: istEditierbar(regel),
        rechenwegAnzeige: rechenweg(regel, stichtag, wertVon),
      };
      const titel = regel.abschnitt || gruppe.titel;
      if (!abschnitte.has(titel)) abschnitte.set(titel, []);
      /** @type {any[]} */ (abschnitte.get(titel)).push(zeile);
    }
    return {
      gruppe: gruppe.gruppe, titel: gruppe.titel, speicherArt: gruppe.speicher?.art,
      abschnitte: [...abschnitte.entries()].map(([titel, zeilen]) => ({ titel, zeilen })),
    };
  });
}

/** German-locale number text with two decimals (13.9 → "13,90"), for the formula display. @param {number} n */
const formelZahl = (n) => (typeof n === "number" ? new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) : String(n));

/**
 * Formula-display templates by rule id (only known formula rule as built:
 * personal.minijob_grenze — § 8 Abs. 1a SGB IV). A new formula rule adds its own entry.
 * @type {Readonly<Record<string, (basiswert: number) => string>>}
 */
const FORMEL_ANZEIGE = Object.freeze({
  "personal.minijob_grenze": (mindestlohn) => `⌈${formelZahl(mindestlohn)} × 130 / 3⌉`,
});

/**
 * Display of a computed value: the formula ("⌈13,90 × 130 / 3⌉ = 603") for a
 * `typ:'formel'` rule, or the rows of a `typ:'tabelle'` rule (Kündigungsstaffel,
 * HOAI tables); everything else has nothing to show here (the editor renders the
 * plain value itself).
 * @param {Regel|null|undefined} regel
 * @param {string} stichtag 'YYYY-MM-DD'
 * @param {(id: string, stichtag: string) => any} [wertVon] reader for formula inputs
 * @returns {{text: string|null, zeilen: string[]|null}}
 */
export function rechenweg(regel, stichtag, wertVon) {
  if (!regel) return { text: null, zeilen: null };
  if (regel.typ === "formel" || typeof regel.formel === "function") {
    const wert = berechneFormel(regel, stichtag, wertVon);
    const vorlage = FORMEL_ANZEIGE[regel.id];
    const basis = vorlage && typeof wertVon === "function" && regel.id === "personal.minijob_grenze"
      ? wertVon("personal.mindestlohn", stichtag) : null;
    const formelText = vorlage && typeof basis === "number" ? vorlage(basis) : null;
    return { text: formelText ? `${formelText} = ${wert}` : (wert == null ? null : String(wert)), zeilen: null };
  }
  if (regel.typ === "tabelle") {
    const wert = wertAm(regel, stichtag);
    if (regel.id === "personal.kuendigung_staffel" && Array.isArray(wert)) {
      return { text: null, zeilen: wert.map(([jahre, monate]) => `ab ${jahre} Jahren: ${monate} Monat(e) zum Monatsende`) };
    }
    return { text: null, zeilen: null };
  }
  return { text: null, zeilen: null };
}

/**
 * Reader over several groups and the stored rows: effective value and details of
 * any rule id on any date, formulas included (they read other rules through the
 * same reader). A formula that refers to itself, directly or through others,
 * throws a plain-text error instead of recursing forever.
 * @param {ReadonlyArray<RegelGruppe>} gruppen
 * @param {ReadonlyArray<any>} settingRows all Setting rows
 * @returns {{wert: (id: string, stichtag?: string) => any, details: (id: string, stichtag?: string) => (Wirksam & {regel: Regel})|null}}
 *   unknown ids give null
 */
export function regelWerteAus(gruppen, settingRows) {
  /** @type {Map<string, {regel: Regel, override: Override|undefined}>} */
  const nachId = new Map();
  for (const gruppe of Array.isArray(gruppen) ? gruppen : []) {
    const overrides = overridesAus(gruppe, settingRows);
    for (const regel of gruppe.regeln || []) nachId.set(regel.id, { regel, override: overrides.get(regel.id) });
  }
  /** @type {Set<string>} */
  const inArbeit = new Set();
  /**
   * @param {string} id
   * @param {string} [stichtag]
   * @returns {(Wirksam & {regel: Regel})|null}
   */
  const details = (id, stichtag = heuteLokal()) => {
    const eintrag = nachId.get(id);
    if (!eintrag) return null;
    if (inArbeit.has(id)) throw new Error(`Regel „${id}“ verweist in ihrer Formel auf sich selbst.`);
    inArbeit.add(id);
    try {
      return { ...wirksamerWert(eintrag.regel, eintrag.override, stichtag, (andere, tag) => details(andere, tag)?.wert ?? null), regel: eintrag.regel };
    } finally {
      inArbeit.delete(id);
    }
  };
  return { details, wert: (id, stichtag) => details(id, stichtag)?.wert ?? null };
}
