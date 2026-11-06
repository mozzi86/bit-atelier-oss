// 106-10: the office's command library - frequent sentences with placeholders, e.g. "Setze {eigenschaft} auf {wert}" for the fire
// resistance with the classes the office allows (F30, F60, F90, ...). It feeds the speech grammar of 106-05 (sprachbefehl.js: a sentence
// that fits a template becomes the property command; a value outside the allowed list is refused with the list) and the task text of the
// model fallback (sprachAgent.js: the allowed values are named). It never changes anything itself: a fitting sentence still only makes a
// PROPOSAL that a person confirms (D-IM-04).
//
// Template record (entity Befehlsvorlage, office-wide, no project): {satz, eigenschaft, werte: string[], beschreibung?, aktiv?}.
//  - satz: German sentence with the placeholder {wert} at the END and optionally {eigenschaft} before it; at least one plain word,
//  - eigenschaft: field name of a property of the change tools (aenderungen.js EIGENSCHAFTEN: feuerwiderstand, status, kg, ...),
//  - werte: the allowed values; each must pass the property's own check and is stored in its normal spelling ("ei90" -> "EI 90").
// [ASSUMED] {wert} only at the end: a spoken value is the rest of the sentence; templates with words after the value are refused when saved.
//
// Pure apart from a small module cache (bibliothekSetzen / bibliothekAktuell) that the speech field and the "eingabe" command read; the
// loader that fills it from the store is befehlsBibliothekLaden.js.
//
// In:  template records. Out: checked templates, allowed values per property, prompt lines, the cache.
import { eigenschaftFeld, gleich } from "./aenderungen.js";
import { VORLAGE_ENTITY } from "../verlauf/entitaeten.js";

export { VORLAGE_ENTITY };

/** Placeholder of the property name in a template. */
export const PLATZ_EIGENSCHAFT = "{eigenschaft}";
/** Placeholder of the value in a template (must be the last word). */
export const PLATZ_WERT = "{wert}";

/** Most allowed values per template [ASSUMED: a list a person can still read out; longer lists belong in a catalogue]. */
export const WERTE_MAX = 40;

/**
 * Templates offered when the office has none yet ("Standardvorlagen anlegen"). Values: DIN 4102-2 classes F30-F120 and DIN EN 13501-2
 * classes EI/REI as used in German building permits; status words of the change tools; cost groups of DIN 276 level 3 for walls/ceilings.
 * [ASSUMED] a starting set the office edits, not a rule.
 * @type {ReadonlyArray<{satz: string, eigenschaft: string, werte: string[], beschreibung: string}>}
 */
export const STANDARD_VORLAGEN = Object.freeze([
  { satz: "Setze {eigenschaft} auf {wert}", eigenschaft: "feuerwiderstand", werte: ["F30", "F60", "F90", "F120", "EI 30", "EI 60", "EI 90", "REI 90"],
    beschreibung: "Brandschutz nach DIN 4102 / DIN EN 13501-2" },
  { satz: "Markiere als {wert}", eigenschaft: "status", werte: ["bestand", "neubau", "abbruch"], beschreibung: "Umbaustatus" },
  { satz: "Setze {eigenschaft} auf {wert}", eigenschaft: "kg", werte: ["331", "332", "341", "342", "351", "352"], beschreibung: "Kostengruppe nach DIN 276" },
]);

/**
 * Checks one template and returns it in normal form (values in the property's own spelling, duplicates removed).
 * @param {any} v  Template record ({satz, eigenschaft, werte, beschreibung?, aktiv?, id?}).
 * @returns {{id?: string, satz: string, eigenschaft: string, label: string, werte: any[], beschreibung: string, aktiv: boolean}}
 * @throws {Error} German text: no sentence, {wert} missing or not at the end, no plain word, unknown placeholder, unknown property,
 *   a value the property does not take, no values, too many values.
 */
export function vorlagePruefen(v) {
  const satz = String(v?.satz ?? "").trim().replace(/\s+/g, " ");
  if (!satz) throw new Error("Vorlage: der Satz fehlt");
  const platz = satz.match(/\{[^}]*\}/g) || [];
  const fremd = platz.find((p) => p !== PLATZ_WERT && p !== PLATZ_EIGENSCHAFT);
  if (fremd) throw new Error(`Vorlage: Platzhalter ${fremd} gibt es nicht — möglich sind {eigenschaft} und {wert}`);
  if (platz.filter((p) => p === PLATZ_WERT).length !== 1) throw new Error("Vorlage: der Satz braucht genau einmal {wert}");
  if (!satz.endsWith(PLATZ_WERT)) throw new Error("Vorlage: {wert} muss am Ende stehen (der Wert ist der Rest des Satzes)");
  if (platz.filter((p) => p === PLATZ_EIGENSCHAFT).length > 1) throw new Error("Vorlage: {eigenschaft} höchstens einmal");
  if (!satz.replace(/\{[^}]*\}/g, " ").trim()) throw new Error("Vorlage: der Satz braucht mindestens ein festes Wort (sonst passt jeder Satz)");
  const def = eigenschaftFeld(v?.eigenschaft);
  if (!def) throw new Error(`Vorlage: Eigenschaft „${v?.eigenschaft ?? ""}“ gibt es nicht`);
  const roh = Array.isArray(v?.werte) ? v.werte : String(v?.werte ?? "").split(/[,;\n]/);
  const werte = [];
  for (const w of roh.map((x) => String(x).trim()).filter(Boolean)) {
    const n = def.parse(w); // throws the property's own German text for a wrong value
    if (!werte.some((x) => gleich(x, n))) werte.push(n);
  }
  if (!werte.length) throw new Error("Vorlage: mindestens ein erlaubter Wert");
  if (werte.length > WERTE_MAX) throw new Error(`Vorlage: höchstens ${WERTE_MAX} Werte`);
  return { ...(v?.id ? { id: String(v.id) } : {}), satz, eigenschaft: def.feld, label: def.label, werte, beschreibung: String(v?.beschreibung ?? "").trim(), aktiv: v?.aktiv !== false };
}

/**
 * The active, valid templates of a list (invalid ones are left out - the library page shows why, the grammar must not stumble).
 * @param {ReadonlyArray<any>} liste @returns {Array<ReturnType<typeof vorlagePruefen>>}
 */
export function bibliothekNormen(liste) {
  const aus = [];
  for (const v of liste || []) {
    try {
      const n = vorlagePruefen(v);
      if (n.aktiv) aus.push(n);
    } catch { /* invalid template: shown with its reason on the library page, ignored here */ }
  }
  return aus;
}

/**
 * The allowed values of a property over all active templates; null when no template restricts it.
 * @param {ReadonlyArray<any>} bibliothek  Normalised templates (bibliothekNormen). @param {string} eigenschaft  Field name or spoken name.
 * @returns {any[]|null}
 */
export function erlaubteWerte(bibliothek, eigenschaft) {
  const feld = eigenschaftFeld(eigenschaft)?.feld;
  if (!feld) return null;
  const werte = [];
  for (const v of bibliothek || []) if (v.eigenschaft === feld) for (const w of v.werte) if (!werte.some((x) => gleich(x, w))) werte.push(w);
  return werte.length ? werte : null;
}

/**
 * Lines for the task text of the model fallback: the office's sentences and the allowed values per property (text only).
 * @param {ReadonlyArray<any>} bibliothek  Normalised templates. @returns {string[]}  [] without templates.
 */
export function bibliothekPromptZeilen(bibliothek) {
  if (!bibliothek?.length) return [];
  /** @type {Map<string, {label: string, werte: any[]}>} */
  const je = new Map();
  for (const v of bibliothek) {
    const e = je.get(v.eigenschaft) || { label: v.label, werte: [] };
    for (const w of v.werte) if (!e.werte.some((x) => gleich(x, w))) e.werte.push(w);
    je.set(v.eigenschaft, e);
  }
  return [
    "- Befehlsbibliothek des Büros — bei diesen Eigenschaften nur die erlaubten Werte vorschlagen:",
    ...[...je.values()].map((e) => `  - ${e.label}: ${e.werte.join(", ")}`),
    `  Übliche Sätze: ${[...new Set(bibliothek.map((v) => `„${v.satz.replace(PLATZ_EIGENSCHAFT, v.label)}“`))].join(", ")}`,
  ];
}

/** @type {Array<ReturnType<typeof vorlagePruefen>>} the library the speech field and the "eingabe" command read (filled by the loader) */
let aktuell = [];

/**
 * Replaces the cached library (normalised on the way in).
 * @param {ReadonlyArray<any>} liste  Template records. @returns {Array<ReturnType<typeof vorlagePruefen>>} the active, valid templates
 */
export function bibliothekSetzen(liste) {
  aktuell = bibliothekNormen(liste);
  return aktuell;
}

/** The cached library (active, valid templates; [] before the first load). @returns {Array<ReturnType<typeof vorlagePruefen>>} */
export function bibliothekAktuell() {
  return aktuell;
}
