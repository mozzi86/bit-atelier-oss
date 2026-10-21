// sonderwunsch.js — special requests of apartment buyers (99-02): the project's equipment
// catalogue (Ausstattungskatalog, D-P99-04: catalogue price per project, not the BoQ unit
// price), the classification of an intervention by severity and the technical approvals it
// needs (D-P99-01), and the status chain of a request per apartment:
//   angefragt → geprüft → angeboten → freigegeben | abgelehnt → eingearbeitet → abgenommen
//
// "geprüft" = every technical approval the severity requires is given (site manager /
// + architect / + structural engineer). "freigegeben" = the buyer accepted the offered
// price. A rejection at either step ends the request with status "abgelehnt".
//
// Product and colour of a request (manufacturer, RAL/NCS, surface) are the fields of the
// sampling (Bemusterung, 88-05) and are checked with its rules; a released request with
// product data becomes ONE Bemusterung row of its apartment (bemusterungAusSonderwunsch in
// bemusterung.js) — the sample register stays the single place for released products.
//
// Data contracts (schemaless, new):
//   AusstattungsOption {project_id, nr "K-001", gewerk_lb (STLB-Bau LB, e.g. "036"),
//     bezeichnung, art 'standard'|'option', preis_eur (extra/reduced price per unit, EUR
//     gross to the buyer [ASSUMED gross: a developer sells to consumers], negative = credit),
//     einheit 'psch'|'m²'|'Stk'|'m', schwere 'ausstattung'|'grundriss'|'tragwerk',
//     beschreibung, aktiv (bool)}
//   Sonderwunsch {project_id, nr "SW-001", wohnung_id, raum, gewerk_lb, katalog_option_id|null,
//     beschreibung, menge, preis_eur (total, EUR gross), schwere, status (chain above),
//     angefragt_am, pruefungen [{rolle, ergebnis 'ok'|'abgelehnt', von, am, bemerkung}],
//     angeboten_am, entscheidung {ergebnis, von, am, bemerkung}|null, nach_frist (bool),
//     frist_bei_anfrage (ISO date|null, deadline when requested — shows a shift later),
//     eingearbeitet {von, am, bemerkung}|null, abgenommen {von, am}|null, abgelehnt_grund,
//     fabrikat, produkt, farbe_system, farbe, oberflaeche (sampling fields, optional)}
//
// In:  form values, catalogue rows, request rows, a date. Out: records, patches, findings.
// Pure — no React, no API.

import { farbeGueltig, OBERFLAECHEN } from "./bemusterung.js";
import { STLB_LB } from "@core/lib/bauteil/gewerke.js";

/**
 * Technical approval roles (D-P99-01). Labels double as i18n keys.
 * @type {ReadonlyArray<Readonly<{key: 'bauleitung'|'architektur'|'statik', label: string}>>}
 */
export const FREIGABE_ROLLEN = Object.freeze([
  Object.freeze({ key: "bauleitung", label: "Bauleitung" }),
  Object.freeze({ key: "architektur", label: "Architektur" }),
  Object.freeze({ key: "statik", label: "Tragwerksplanung" }),
]);

/**
 * Severity of an intervention and the approvals it needs (D-P99-01; the step assignment is
 * [ASSUMED] in 99-02 as the decision asks: surface/fit-out = site manager; layout or
 * installation = + architect; wall, slab, opening, load = + structural engineer).
 * @type {ReadonlyArray<Readonly<{key: 'ausstattung'|'grundriss'|'tragwerk', label: string, freigaben: ReadonlyArray<string>}>>}
 */
export const SCHWERE = Object.freeze([
  Object.freeze({ key: "ausstattung", label: "Oberfläche / Ausstattung", freigaben: Object.freeze(["bauleitung"]) }),
  Object.freeze({ key: "grundriss", label: "Grundriss / Installation", freigaben: Object.freeze(["bauleitung", "architektur"]) }),
  Object.freeze({ key: "tragwerk", label: "Wand, Decke, Durchbruch, Last", freigaben: Object.freeze(["bauleitung", "architektur", "statik"]) }),
]);

/** Status chain of a request (labels double as i18n keys). */
export const SW_STATUS = Object.freeze([
  Object.freeze({ key: "angefragt", label: "angefragt" }),
  Object.freeze({ key: "geprueft", label: "geprüft" }),
  Object.freeze({ key: "angeboten", label: "angeboten" }),
  Object.freeze({ key: "freigegeben", label: "freigegeben" }),
  Object.freeze({ key: "abgelehnt", label: "abgelehnt" }),
  Object.freeze({ key: "eingearbeitet", label: "eingearbeitet" }),
  Object.freeze({ key: "abgenommen", label: "abgenommen" }),
]);

/** States in which the buyer's decision is still open (the deadline of 99-03 runs). */
export const OFFEN = Object.freeze(["angefragt", "geprueft", "angeboten"]);

/** Units of a catalogue price. */
export const KATALOG_EINHEITEN = Object.freeze(["psch", "m²", "Stk", "m"]);

// Word boundaries that know German umlauts (\b does not).
const VOR = "(?<![a-zäöüß])";
const NACH = "(?![a-zäöüß])";
// Verb stems that remove or open a wall/slab ("entfernen", "abreißen", "herausreißen", "öffnen", …).
const WEG = "(entfern|abbrech|abbruch|abreiß|abreiss|abriss|herausreiß|herausreiss|rausreiß|rausreiss|herausnehm|wegnehm|öffn|oeffn|durchbrech)";
// Opening = an opening is enlarged or added (door/window/opening + "verbreitern", "vergrößern", …).
const GROESSER = "(verbreiter|vergrößer|vergroesser|erweiter|aufweit)";
// Free text between noun and verb: up to 60 characters within one clause (a comma ends it,
// so "Wandfliesen bis zur Decke, Bordüre entfernen" stays fit-out).
const LUECKE = "[^.,;!?\\n]{0,60}?";

/**
 * [ASSUMED] keywords that raise the severity of a free-text request (the catalogue option or
 * the form may say less). The program only raises — a wall mentioned in passing costs one
 * extra signature, a missed one a structural risk. Hence also deliberate false alarms on the
 * safe side: "nichttragende Wand" still reads as tragwerk (a buyer's "non-load-bearing" is
 * no structural check), "Tapete von der Wand entfernen" too.
 * Tragwerk: load-bearing words; wall/slab + remove/open in either order ("Wand zwischen Küche
 * und Wohnzimmer entfernen", "Abriss der Wand", "Öffnung in der Wand"); a door/window/opening
 * enlarged (lintel); an added door/window/opening; a staircase moved (slab opening).
 */
const STICHWORTE = Object.freeze([
  {
    schwere: "tragwerk",
    muster: new RegExp([
      "tragend", "durchbruch", "deckenöffnung", "deckenoeffnung", "wandöffnung", "wandoeffnung", "stütze", "stuetze", "träger", "traeger", "unterzug",
      `${VOR}lasten?${NACH}`,
      `${VOR}(wand|wände|waende|decke)${NACH}${LUECKE}${WEG}`,
      `${WEG}[a-zäöüß]*${LUECKE}${VOR}(wand|wände|waende|decke)${NACH}`,
      `(tür|tuer|fenster|öffnung|oeffnung)${LUECKE}${GROESSER}`,
      `(größer|groesser|breiter)e?[snm]?\\s+(tür|tuer|fenster|öffnung|oeffnung)`,
      `(zusätzlich|zusaetzlich|weiter)e?[snmr]?\\s+(tür|tuer|fenster|wandöffnung|öffnung|oeffnung)(?!\\s*(blatt|griff|drücker|druecker|band|bänder|beschlag|farbe))`,
      `treppe${LUECKE}(verleg|versetz|verschieb|verlager|entfern)`,
    ].join("|"), "i"),
  },
  { schwere: "grundriss", muster: /grundriss|trennwand|wand (versetzen|einziehen|verschieben)|tür (versetzen|verschieben)|installation|leitung|sanitär|sanitaer|steckdose|elektro|heizkörper|heizkoerper|fußbodenheizung|fussbodenheizung|anschluss/i },
]);

/** @param {string|undefined|null} s @returns {number} rank of a severity, −1 unknown */
const rang = (s) => SCHWERE.findIndex((x) => x.key === s);

/**
 * @typedef {{
 *   id?: string, nr?: string, gewerk_lb?: string, bezeichnung?: string, art?: string,
 *   preis_eur?: number, einheit?: string, schwere?: string, beschreibung?: string, aktiv?: boolean,
 * }} KatalogOption
 * @typedef {{rolle: string, ergebnis: 'ok'|'abgelehnt', von: string, am: string, bemerkung?: string}} Pruefung
 * @typedef {{
 *   id?: string, nr?: string, wohnung_id?: string, raum?: string, gewerk_lb?: string,
 *   katalog_option_id?: string|null, beschreibung?: string, menge?: number, preis_eur?: number|null,
 *   schwere?: string, status?: string, angefragt_am?: string, pruefungen?: Pruefung[],
 *   angeboten_am?: string|null, entscheidung?: {ergebnis: string, von: string, am: string, bemerkung?: string}|null,
 *   nach_frist?: boolean, frist_bei_anfrage?: string|null,
 *   eingearbeitet?: {von: string, am: string, bemerkung?: string}|null, abgenommen?: {von: string, am: string}|null,
 *   abgelehnt_grund?: string, fabrikat?: string, produkt?: string, farbe_system?: string, farbe?: string, oberflaeche?: string,
 * }} SonderwunschRecord
 */

/**
 * German label of a request status.
 * @param {unknown} s
 * @returns {string}
 */
export function swStatusLabel(s) {
  return SW_STATUS.find((x) => x.key === s)?.label || String(s || "");
}

/**
 * Trade label "036 Bodenbelagarbeiten" of an STLB-Bau LB code.
 * @param {unknown} lb
 * @returns {string}
 */
export function gewerkLabel(lb) {
  const g = STLB_LB.find((x) => x.lb === String(lb ?? ""));
  return g ? `${g.lb} ${g.name}` : String(lb || "—");
}

/**
 * Minimum severity a request text implies (keywords above), or null.
 * @param {unknown} text
 * @returns {'tragwerk'|'grundriss'|null}
 */
export function schwereAusText(text) {
  const t = String(text || "");
  for (const s of STICHWORTE) if (s.muster.test(t)) return /** @type {any} */ (s.schwere);
  return null;
}

/**
 * Effective severity of a request: the higher of the stated one (catalogue/form) and the
 * one its text implies. Unknown stated severity → 'grundriss' [ASSUMED: a free request
 * without classification gets the architect's look; the site manager alone is for
 * catalogue fit-out only].
 * @param {SonderwunschRecord} sw
 * @returns {'ausstattung'|'grundriss'|'tragwerk'}
 */
export function wirksameSchwere(sw) {
  const angegeben = rang(sw?.schwere) >= 0 ? /** @type {string} */ (sw.schwere) : "grundriss";
  const text = schwereAusText(`${sw?.beschreibung || ""} ${sw?.raum || ""}`);
  return /** @type {any} */ (text && rang(text) > rang(angegeben) ? text : angegeben);
}

/**
 * Approval roles a request needs (by its effective severity).
 * @param {SonderwunschRecord} sw
 * @returns {string[]} role keys of FREIGABE_ROLLEN
 */
export function noetigeFreigaben(sw) {
  return [.../** @type {any} */ (SCHWERE.find((s) => s.key === wirksameSchwere(sw))).freigaben];
}

/**
 * Roles still missing for "geprüft" (no 'ok' recorded yet).
 * @param {SonderwunschRecord} sw
 * @returns {string[]}
 */
export function offeneFreigaben(sw) {
  const ok = new Set((sw?.pruefungen || []).filter((p) => p.ergebnis === "ok").map((p) => p.rolle));
  return noetigeFreigaben(sw).filter((r) => !ok.has(r));
}

/**
 * Next free number with a prefix ("K-001", "SW-001").
 * @param {Array<{nr?: string}>} alle
 * @param {string} praefix e.g. "K" or "SW"
 * @returns {string}
 */
export function naechsteNr(alle, praefix) {
  const re = new RegExp(`^${praefix}-(\\d+)$`);
  const max = (alle || []).reduce((m, x) => {
    const n = re.exec(String(x?.nr || ""));
    return n ? Math.max(m, Number(n[1])) : m;
  }, 0);
  return `${praefix}-${String(max + 1).padStart(3, "0")}`;
}

/**
 * Number from a form value or null. The price fields are German text inputs, so German
 * notation wins where it is ambiguous:
 *   "1.250" / "12.500.000" → thousands dots (1250); "1.250,50" / "1,5" → comma decimal;
 *   "12.5" / "0.75" → dot decimal (no 3-digit groups); "1,250.50" → both separators, the
 *   last one is the decimal; "€ 1.250" / "-300" → currency sign and spaces ignored.
 * @param {unknown} v
 * @returns {number|null}
 */
export function zahl(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v).replace(/[\s€]/g, "").replace(/^\+/, "");
  if (!s) return null;
  const punkt = s.lastIndexOf("."), komma = s.lastIndexOf(",");
  if (punkt >= 0 && komma >= 0) {
    // Both present: the later one is the decimal separator, the other one groups thousands.
    s = komma > punkt ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (komma >= 0) {
    s = /^-?\d{1,3}(,\d{3}){2,}$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if (punkt >= 0 && /^-?\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, "");
  }
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * New catalogue option from form values. A standard option has price 0 (it is in the base
 * price); the form's price is kept for an option only.
 * @param {Record<string, any>} w form values
 * @param {{projectId: string, alle: KatalogOption[]}} k
 * @returns {KatalogOption & {project_id: string}}
 */
export function neueKatalogOption(w, { projectId, alle }) {
  const art = w.art === "standard" ? "standard" : "option";
  return {
    project_id: projectId,
    nr: naechsteNr(alle, "K"),
    gewerk_lb: String(w.gewerk_lb || "").trim(),
    bezeichnung: String(w.bezeichnung || "").trim(),
    art,
    preis_eur: art === "standard" ? 0 : zahl(w.preis_eur) ?? 0,
    einheit: KATALOG_EINHEITEN.includes(w.einheit) ? w.einheit : "psch",
    schwere: rang(w.schwere) >= 0 ? w.schwere : "ausstattung",
    beschreibung: String(w.beschreibung || "").trim(),
    aktiv: true,
  };
}

/**
 * Findings of a catalogue option (hinweis only — the catalogue is the developer's offer).
 * @param {KatalogOption} o
 * @returns {Array<{code: string, stufe: 'hinweis', text: string}>}
 */
export function katalogHinweise(o) {
  /** @type {Array<{code: string, stufe: 'hinweis', text: string}>} */
  const h = [];
  if (!STLB_LB.some((g) => g.lb === String(o?.gewerk_lb || ""))) h.push({ code: "gewerk_fehlt", stufe: "hinweis", text: "Gewerk fehlt — ohne Gewerk keine Frist aus dem Bauablauf" });
  if (o?.art === "option" && !Number(o?.preis_eur)) h.push({ code: "preis_fehlt", stufe: "hinweis", text: "Option ohne Mehr-/Minderpreis" });
  return h;
}

/**
 * New request from form values (status 'angefragt'). With a catalogue option, trade,
 * severity and price (option price × quantity) come from it; without one the form's values
 * are used. The deadline at request time is kept so a later shift can be shown.
 * @param {Record<string, any>} w form values (wohnung_id, raum, gewerk_lb, beschreibung, menge, preis_eur, schwere, sampling fields)
 * @param {{projectId: string, alle: SonderwunschRecord[], option?: KatalogOption|null, frist?: string|null, jetzt?: Date}} k
 * @returns {SonderwunschRecord & {project_id: string}}
 */
export function neuerSonderwunsch(w, { projectId, alle, option = null, frist = null, jetzt = new Date() }) {
  const menge = zahl(w.menge) ?? 1;
  const preis = option ? Math.round(Number(option.preis_eur || 0) * menge * 100) / 100 : zahl(w.preis_eur);
  const sys = ["RAL", "NCS", "sonstig"].includes(w.farbe_system) ? w.farbe_system : "sonstig";
  return {
    project_id: projectId,
    nr: naechsteNr(alle, "SW"),
    wohnung_id: String(w.wohnung_id || ""),
    raum: String(w.raum || "").trim(),
    gewerk_lb: String(option?.gewerk_lb || w.gewerk_lb || "").trim(),
    katalog_option_id: option?.id || null,
    beschreibung: String(w.beschreibung || option?.bezeichnung || "").trim(),
    menge,
    preis_eur: preis,
    schwere: String(option?.schwere || (rang(w.schwere) >= 0 ? w.schwere : "")),
    status: "angefragt",
    angefragt_am: jetzt.toISOString().slice(0, 10),
    pruefungen: [],
    angeboten_am: null,
    entscheidung: null,
    nach_frist: false,
    frist_bei_anfrage: frist || null,
    eingearbeitet: null,
    abgenommen: null,
    abgelehnt_grund: "",
    fabrikat: String(w.fabrikat || "").trim(),
    produkt: String(w.produkt || "").trim(),
    farbe_system: sys,
    farbe: String(w.farbe || "").trim(),
    oberflaeche: OBERFLAECHEN.includes(w.oberflaeche) ? w.oberflaeche : String(w.oberflaeche || "").trim(),
  };
}

/**
 * Patch for one technical approval (status 'angefragt' only, a role the severity needs, a
 * name). All needed roles 'ok' → 'geprueft'; one 'abgelehnt' → the request is rejected
 * (technically not possible) with the remark as reason. A role may record again (latest wins).
 * @param {SonderwunschRecord} sw
 * @param {string} rolle key of FREIGABE_ROLLEN
 * @param {'ok'|'abgelehnt'} ergebnis
 * @param {string} von name of the person (required)
 * @param {string} [bemerkung]
 * @param {Date} [jetzt]
 * @returns {Record<string, any>|null}
 */
export function pruefungPatch(sw, rolle, ergebnis, von, bemerkung = "", jetzt = new Date()) {
  const name = String(von || "").trim();
  if (!sw || sw.status !== "angefragt" || !name || (ergebnis !== "ok" && ergebnis !== "abgelehnt")) return null;
  if (!noetigeFreigaben(sw).includes(rolle)) return null;
  const pruefungen = [...(sw.pruefungen || []).filter((p) => p.rolle !== rolle), { rolle, ergebnis, von: name, am: jetzt.toISOString(), bemerkung: String(bemerkung || "").trim() }];
  if (ergebnis === "abgelehnt") {
    const label = FREIGABE_ROLLEN.find((r) => r.key === rolle)?.label || rolle;
    return { pruefungen, status: "abgelehnt", abgelehnt_grund: `${label}: ${String(bemerkung || "").trim() || "technisch nicht freigegeben"}` };
  }
  const offen = offeneFreigaben({ ...sw, pruefungen });
  return offen.length ? { pruefungen } : { pruefungen, status: "geprueft" };
}

/**
 * Patch "offered to the buyer" (geprüft → angeboten) with the final price.
 * @param {SonderwunschRecord} sw
 * @param {unknown} preis total price, EUR gross (negative = credit); required
 * @param {Date} [jetzt]
 * @returns {{status: 'angeboten', preis_eur: number, angeboten_am: string}|null}
 */
export function angebotPatch(sw, preis, jetzt = new Date()) {
  const p = zahl(preis);
  if (!sw || sw.status !== "geprueft" || p === null) return null;
  return { status: "angeboten", preis_eur: Math.round(p * 100) / 100, angeboten_am: jetzt.toISOString().slice(0, 10) };
}

/**
 * Patch for the buyer's decision on an offered request. A release after the deadline is
 * allowed but marked (`nach_frist`): 99-03 "too late" = reject, or accept as a change order
 * with rework/schedule risk — that is the developer's decision, so the program marks, it does
 * not block.
 * @param {SonderwunschRecord} sw
 * @param {'freigegeben'|'abgelehnt'} ergebnis
 * @param {string} von name of the buyer or representative (required)
 * @param {{bemerkung?: string, frist?: string|null, jetzt?: Date}} [opt] frist = current deadline 'YYYY-MM-DD'
 * @returns {Record<string, any>|null}
 */
export function kaeuferEntscheidungPatch(sw, ergebnis, von, { bemerkung = "", frist = null, jetzt = new Date() } = {}) {
  const name = String(von || "").trim();
  if (!sw || sw.status !== "angeboten" || !name || (ergebnis !== "freigegeben" && ergebnis !== "abgelehnt")) return null;
  const tag = jetzt.toISOString().slice(0, 10);
  const patch = { status: ergebnis, entscheidung: { ergebnis, von: name, am: jetzt.toISOString(), bemerkung: String(bemerkung || "").trim() }, nach_frist: Boolean(frist && tag > frist) };
  return ergebnis === "abgelehnt" ? { ...patch, abgelehnt_grund: `Käufer: ${String(bemerkung || "").trim() || "nicht beauftragt"}` } : patch;
}

/**
 * Patch "worked into the detailed design" (freigegeben → eingearbeitet). 99-04 will write
 * this from the plan index; until then it is recorded by hand with a remark (plan, index).
 * @param {SonderwunschRecord} sw
 * @param {string} von
 * @param {string} [bemerkung]
 * @param {Date} [jetzt]
 * @returns {{status: 'eingearbeitet', eingearbeitet: {von: string, am: string, bemerkung: string}}|null}
 */
export function einarbeitungPatch(sw, von, bemerkung = "", jetzt = new Date()) {
  const name = String(von || "").trim();
  if (!sw || sw.status !== "freigegeben" || !name) return null;
  return { status: "eingearbeitet", eingearbeitet: { von: name, am: jetzt.toISOString(), bemerkung: String(bemerkung || "").trim() } };
}

/**
 * Patch "accepted at handover" (eingearbeitet → abgenommen). 99-06 (handover per apartment)
 * will set this from the inspection; until then by hand.
 * @param {SonderwunschRecord} sw
 * @param {string} von
 * @param {Date} [jetzt]
 * @returns {{status: 'abgenommen', abgenommen: {von: string, am: string}}|null}
 */
export function abnahmePatch(sw, von, jetzt = new Date()) {
  const name = String(von || "").trim();
  if (!sw || sw.status !== "eingearbeitet" || !name) return null;
  return { status: "abgenommen", abgenommen: { von: name, am: jetzt.toISOString() } };
}

/**
 * Findings of a request. warn/hinweis only: the request is a contract matter between buyer
 * and developer; the program shows gaps and risks, it never blocks a step.
 * @param {SonderwunschRecord} sw
 * @returns {Array<{code: string, stufe: 'warn'|'hinweis', text: string}>}
 */
export function sonderwunschHinweise(sw) {
  /** @type {Array<{code: string, stufe: 'warn'|'hinweis', text: string}>} */
  const h = [];
  if (!sw || sw.status === "abgelehnt") return h;
  if (sw.nach_frist) h.push({ code: "nach_frist", stufe: "warn", text: "Nach Fristablauf freigegeben — Nachtrag mit Rückbau-/Terminrisiko" });
  const text = schwereAusText(`${sw.beschreibung || ""} ${sw.raum || ""}`);
  if (text && rang(text) > rang(sw.schwere || "grundriss")) h.push({ code: "schwere_erhoeht", stufe: "warn", text: "Beschreibung deutet auf größeren Eingriff — Freigaben erhöht" });
  if (!farbeGueltig(String(sw.farbe_system || ""), String(sw.farbe || ""))) h.push({ code: "farbe_format", stufe: "warn", text: "Farbangabe passt nicht zum Farbsystem (RAL 9010 / NCS S 0502-Y)" });
  if (sw.preis_eur === null || sw.preis_eur === undefined) h.push({ code: "preis_fehlt", stufe: "hinweis", text: "Noch kein Preis" });
  if (!STLB_LB.some((g) => g.lb === String(sw.gewerk_lb || ""))) h.push({ code: "gewerk_fehlt", stufe: "hinweis", text: "Gewerk fehlt — ohne Gewerk keine Frist aus dem Bauablauf" });
  return h;
}

/**
 * Extra/reduced cost of one apartment (EUR gross): `beauftragt` = released, worked in or
 * accepted; `angeboten` = offered and not yet decided.
 * @param {SonderwunschRecord[]} wuensche requests of the apartment
 * @returns {{beauftragt: number, angeboten: number}}
 */
export function summeWohnung(wuensche) {
  let beauftragt = 0, angeboten = 0;
  for (const sw of wuensche || []) {
    const p = Number(sw?.preis_eur) || 0;
    if (["freigegeben", "eingearbeitet", "abgenommen"].includes(String(sw?.status))) beauftragt += p;
    else if (sw?.status === "angeboten") angeboten += p;
  }
  return { beauftragt: Math.round(beauftragt * 100) / 100, angeboten: Math.round(angeboten * 100) / 100 };
}
