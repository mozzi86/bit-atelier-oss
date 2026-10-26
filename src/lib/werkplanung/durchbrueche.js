// durchbrueche.js — openings planning (Schlitz- und Durchbruchsplanung, SuD; 88-01,
// RE-01): openings, slots and core drillings with position, size, the penetrated
// element (IFC GlobalId), trade, fire protection and the review matrix structural
// engineer → architect; BCF topic per opening.
//
// Data contract — entity `Durchbruch` (schemaless, new):
//   {project_id, nr ("D-001"), art: 'durchbruch'|'schlitz'|'kernbohrung',
//    form: 'rechteck'|'rund', x, y, z (m, IFC model coordinates, Z up),
//    b, h (m, rectangle) | d (m, diameter), t (m, slot depth; null = through),
//    bauteil_guid (22-char IFC GlobalId), bauteil_name, geschoss, gewerk (code of the
//    discipline catalogue @ifc/lib/dateiname KATALOG.fachsichten),
//    feuerwiderstand ('ohne'|'EI 30'|'EI 60'|'EI 90'|'EI 120' — of the PENETRATED
//    element, DIN EN 13501-2), abschottung (text: system, approval no.),
//    status, pruefung: {statik: Pruefvermerk|null, architekt: Pruefvermerk|null},
//    bcf_topic_guid (UUID, fixed at creation → stable topic across exports), kommentar,
//    brandschott?: Brandschott (97-02a — the fire stop as its own element at the opening)}
//   Pruefvermerk = {ergebnis: 'ok'|'abgelehnt', von, am (ISO), kommentar}
// - status: 'beantragt' → 'statik_geprueft' → 'freigegeben' → 'ausgefuehrt';
//   rejection by either reviewer → 'abgelehnt' (final; a new request replaces it).
//   The architect reviews only after the structural engineer [ASSUMED usual order:
//   statics decides whether the opening is possible, the architect whether it is wanted].
//
// - 97-02a: the fire stop is its own element (`brandschott`) with rating, system, approval,
//   manufacturer and marking; the old free text `abschottung` stays readable (records before
//   97-02a). Opening and fire stop each get a data sheet (@core/lib/bauteil/steckbrief.js):
//   a requested opening is a "provision for void" (IfcBuildingElementProxy PROVISIONFORVOID),
//   an executed one an IfcOpeningElement.
//
// In:  Durchbruch records, form values. Out: labels, findings, patches, BCF topics, data sheets.
// Pure — no React, no API.

import { KATALOG } from "@ifc/lib/dateiname";
import { newTopicGuid } from "@ifc/lib/bcf";
import { durchbruchSteckbriefe } from "@core/lib/bauteil/durchbruchSteckbrief.js";
import { feuerMinuten } from "@core/lib/bauteil/pruefregeln.js";

/** Kinds of openings (labels double as i18n keys). */
export const DURCHBRUCH_ARTEN = Object.freeze([
  Object.freeze({ key: "durchbruch", label: "Durchbruch" }),
  Object.freeze({ key: "schlitz", label: "Schlitz" }),
  Object.freeze({ key: "kernbohrung", label: "Kernbohrung" }),
]);

/** Fire resistance of the penetrated element after DIN EN 13501-2 (EI = integrity + insulation, minutes). */
export const FEUERWIDERSTAENDE = Object.freeze(["ohne", "EI 30", "EI 60", "EI 90", "EI 120"]);

/**
 * Kinds of approval of a fire stop (labels double as i18n keys): national technical approval
 * (abZ), general type approval (aBG), European Technical Assessment (ETA).
 */
export const ZULASSUNG_ARTEN = Object.freeze([
  Object.freeze({ key: "abZ", label: "abZ (allgemeine bauaufsichtliche Zulassung)" }),
  Object.freeze({ key: "aBG", label: "aBG (allgemeine Bauartgenehmigung)" }),
  Object.freeze({ key: "ETA", label: "ETA (Europäische Technische Bewertung)" }),
]);

/** Minutes of a fire resistance class — 97-06: ONE helper in @core (bauteil/pruefregeln.js). */
export { feuerMinuten };

/** Status keys in order with German labels (labels double as i18n keys). */
export const DURCHBRUCH_STATUS = Object.freeze([
  Object.freeze({ key: "beantragt", label: "Beantragt" }),
  Object.freeze({ key: "statik_geprueft", label: "Statik geprüft" }),
  Object.freeze({ key: "freigegeben", label: "Freigegeben" }),
  Object.freeze({ key: "ausgefuehrt", label: "Ausgeführt" }),
  Object.freeze({ key: "abgelehnt", label: "Abgelehnt" }),
]);

/**
 * Trades that request openings: architecture, structure, the TGA/electrical/fire
 * disciplines of the discipline catalogue (one truth with the model file names).
 * @type {ReadonlyArray<{wert: string, text: string}>}
 */
export const DURCHBRUCH_GEWERKE = Object.freeze(
  KATALOG.fachsichten.filter((f) => /^(AX|TX|G|E|F)/.test(f.wert)),
);

/** BCF topic status per opening status (BCF 2.1 TopicStatus is free text; the four usual values). */
const BCF_STATUS = Object.freeze({ beantragt: "Open", statik_geprueft: "InProgress", freigegeben: "Resolved", ausgefuehrt: "Closed", abgelehnt: "Closed" });

// 22-character IFC GlobalId (base64 variant of IFC), same pattern as @ifc/lib/bcf.js.
const IFC_GUID = /^[0-9A-Za-z_$]{22}$/;

/**
 * @typedef {object} Pruefvermerk
 * @property {'ok'|'abgelehnt'} ergebnis
 * @property {string} von
 * @property {string} am ISO timestamp
 * @property {string} [kommentar]
 */

/**
 * @typedef {object} DurchbruchRecord
 * @property {string} [id]
 * @property {string} [nr]
 * @property {string} [art]
 * @property {string} [form]
 * @property {number|null} [x] m
 * @property {number|null} [y] m
 * @property {number|null} [z] m
 * @property {number|null} [b] m
 * @property {number|null} [h] m
 * @property {number|null} [d] m
 * @property {number|null} [t] m
 * @property {string} [bauteil_guid]
 * @property {string} [bauteil_name]
 * @property {string} [geschoss]
 * @property {string} [gewerk]
 * @property {string} [feuerwiderstand]
 * @property {string} [abschottung]
 * @property {string} [status]
 * @property {{statik?: Pruefvermerk|null, architekt?: Pruefvermerk|null}} [pruefung]
 * @property {string} [bcf_topic_guid]
 * @property {string} [kommentar]
 * @property {Brandschott|null} [brandschott]
 * @property {string} [kg]            97-02a: DIN 276 cost group of the opening (optional, data sheet)
 * @property {string} [gewerk_lb]     97-02a: STLB-Bau LB of the opening (optional)
 * @property {string} [bauabschnitt]  97-02a: construction section (optional)
 */

/**
 * @typedef {object} Brandschott fire stop at an opening (97-02a)
 * @property {string} klasse      fire resistance of the stop ("EI 90"), must be ≥ the penetrated element
 * @property {string} system      product/system name
 * @property {string} zulassung_art  'abZ'|'aBG'|'ETA'|''
 * @property {string} zulassung_nr   approval number
 * @property {string} hersteller
 * @property {boolean} kennzeichnung  marking plate set on site
 */

const zahl = (v) => {
  if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) return null;
  const n = Number(typeof v === "string" ? v.replace(",", ".") : v);
  return Number.isFinite(n) ? n : null;
};

/**
 * German label of a status or kind.
 * @param {ReadonlyArray<{key: string, label: string}>} liste
 * @param {unknown} key
 * @returns {string}
 */
export function labelAus(liste, key) {
  return liste.find((x) => x.key === key)?.label || String(key || "");
}

/**
 * Size text in millimetres, e.g. "200 × 300 mm", "Ø 150 mm".
 * @param {DurchbruchRecord} d
 * @returns {string}
 */
export function masseText(d) {
  const mm = (v) => (zahl(v) === null ? "?" : String(Math.round(/** @type {number} */ (zahl(v)) * 1000)));
  const tiefe = zahl(d.t) !== null ? ` × T ${mm(d.t)}` : "";
  return d.form === "rund" ? `Ø ${mm(d.d)} mm${tiefe}` : `${mm(d.b)} × ${mm(d.h)} mm${tiefe}`;
}

/**
 * Next free number "D-001", "D-002" … within the project.
 * @param {DurchbruchRecord[]} alle
 * @returns {string}
 */
export function naechsteNr(alle) {
  const max = (alle || []).reduce((m, d) => {
    const n = /^D-(\d+)$/.exec(String(d?.nr || ""));
    return n ? Math.max(m, Number(n[1])) : m;
  }, 0);
  return `D-${String(max + 1).padStart(3, "0")}`;
}

/**
 * Equivalent radius in m (half the diagonal of a rectangle, half the diameter) — for the overlap check.
 * @param {DurchbruchRecord} d
 * @returns {number|null}
 */
function radius(d) {
  if (d.form === "rund") return zahl(d.d) === null ? null : /** @type {number} */ (zahl(d.d)) / 2;
  const b = zahl(d.b);
  const h = zahl(d.h);
  return b === null || h === null ? null : Math.hypot(b, h) / 2;
}

/**
 * Findings of one opening. All warn/hinweis, never fail: whether an opening is
 * structurally possible and how it is sealed is decided by the structural and
 * fire-protection engineers — the program only shows what is missing or suspicious.
 * @param {DurchbruchRecord} d
 * @param {DurchbruchRecord[]} [alle] all openings of the project (for the overlap check)
 * @returns {Array<{code: string, stufe: 'warn'|'hinweis', text: string}>}
 */
export function durchbruchHinweise(d, alle = []) {
  /** @type {Array<{code: string, stufe: 'warn'|'hinweis', text: string}>} */
  const h = [];
  if (!d || d.status === "abgelehnt") return h;
  const gross = d.form === "rund" ? zahl(d.d) : (zahl(d.b) !== null && zahl(d.h) !== null ? Math.min(/** @type {number} */ (zahl(d.b)), /** @type {number} */ (zahl(d.h))) : null);
  if (gross === null || gross <= 0) h.push({ code: "masse_fehlen", stufe: "warn", text: "Maße fehlen oder sind nicht positiv" });
  if (!IFC_GUID.test(String(d.bauteil_guid || ""))) {
    h.push({ code: "bauteil_fehlt", stufe: "hinweis", text: "Kein Bauteil (IFC-GUID) zugeordnet — Sprung ins Modell nicht möglich" });
  }
  if ([d.x, d.y, d.z].some((v) => zahl(v) === null)) h.push({ code: "lage_fehlt", stufe: "hinweis", text: "Lage (x, y, z) unvollständig" });
  // MLAR (Muster-Leitungsanlagen-Richtlinie) Abschn. 4: lines through fire-resisting
  // elements need an approved seal (Abschottung) of the same rating.
  const schott = d.brandschott && typeof d.brandschott === "object" ? d.brandschott : null;
  const hatSchott = !!(schott && (String(schott.klasse || "").trim() || String(schott.system || "").trim()));
  if (d.feuerwiderstand && d.feuerwiderstand !== "ohne" && !String(d.abschottung || "").trim() && !hatSchott) {
    h.push({ code: "abschottung_fehlt", stufe: "warn", text: "Bauteil mit Feuerwiderstand — Abschottung angeben (MLAR Abschn. 4)" });
  }
  // 97-02a: the stop must reach the rating of the penetrated element (MLAR Abschn. 4.1: same
  // fire resistance duration). warn, not fail: the fire-protection engineer may justify otherwise.
  if (hatSchott && d.feuerwiderstand && d.feuerwiderstand !== "ohne") {
    const soll = feuerMinuten(d.feuerwiderstand), ist = feuerMinuten(schott?.klasse);
    if (soll && (ist === null || ist === 0)) h.push({ code: "schott_klasse_fehlt", stufe: "warn", text: "Brandschott ohne Feuerwiderstandsklasse" });
    else if (soll && ist !== null && ist < soll) h.push({ code: "schott_schwaecher", stufe: "warn", text: `Brandschott ${schott?.klasse} schwächer als das Bauteil (${d.feuerwiderstand})` });
    // A seal without a verifiable approval is not usable (MLAR 4.1 / MVV TB) — hinweis because the
    // number is often entered once the product is chosen.
    if (!String(schott?.zulassung_nr || "").trim()) h.push({ code: "schott_zulassung_fehlt", stufe: "hinweis", text: "Brandschott ohne Zulassungsnummer (abZ/aBG/ETA)" });
    if (d.status === "ausgefuehrt" && !schott?.kennzeichnung) h.push({ code: "schott_kennzeichnung_fehlt", stufe: "hinweis", text: "Ausgeführt — Kennzeichnungsschild des Brandschotts bestätigen" });
  }
  const r = radius(d);
  if (r !== null && IFC_GUID.test(String(d.bauteil_guid || ""))) {
    const ueberlappt = alle.some((o) => {
      if (!o || o === d || (d.id && o.id === d.id) || o.status === "abgelehnt" || o.bauteil_guid !== d.bauteil_guid) return false;
      const ro = radius(o);
      const pos = [d.x, d.y, d.z].map(zahl);
      const poso = [o.x, o.y, o.z].map(zahl);
      if (ro === null || pos.some((v) => v === null) || poso.some((v) => v === null)) return false;
      const abstand = Math.hypot(/** @type {number} */ (pos[0]) - /** @type {number} */ (poso[0]), /** @type {number} */ (pos[1]) - /** @type {number} */ (poso[1]), /** @type {number} */ (pos[2]) - /** @type {number} */ (poso[2]));
      // Equivalent circles touching or overlapping [ASSUMED conservative: no minimum web width modelled].
      return abstand < r + ro;
    });
    if (ueberlappt) h.push({ code: "ueberlappung", stufe: "warn", text: "Überlagert einen anderen Durchbruch im selben Bauteil" });
  }
  return h;
}

/**
 * Patch for a review step.
 * @param {DurchbruchRecord} d
 * @param {'statik'|'architekt'} rolle
 * @param {'ok'|'abgelehnt'} ergebnis
 * @param {string} von reviewer's name (required)
 * @param {string} [kommentar]
 * @param {Date} [jetzt]
 * @returns {{status: string, pruefung: {statik: Pruefvermerk|null, architekt: Pruefvermerk|null}}|null}
 *   null when the step is not allowed (wrong order, decided, no name)
 */
export function pruefSchritt(d, rolle, ergebnis, von, kommentar = "", jetzt = new Date()) {
  const name = String(von || "").trim();
  if (!d || !name || (ergebnis !== "ok" && ergebnis !== "abgelehnt")) return null;
  const erwartet = rolle === "statik" ? "beantragt" : rolle === "architekt" ? "statik_geprueft" : null;
  if (!erwartet || d.status !== erwartet) return null;
  const vermerk = { ergebnis, von: name, am: jetzt.toISOString(), kommentar: String(kommentar || "").trim() };
  const pruefung = { statik: d.pruefung?.statik || null, architekt: d.pruefung?.architekt || null, [rolle]: vermerk };
  const status = ergebnis === "abgelehnt" ? "abgelehnt" : rolle === "statik" ? "statik_geprueft" : "freigegeben";
  return { status, pruefung };
}

/**
 * Patch "executed on site" — only from 'freigegeben'.
 * @param {DurchbruchRecord} d
 * @returns {{status: 'ausgefuehrt'}|null}
 */
export function ausgefuehrtPatch(d) {
  return d?.status === "freigegeben" ? { status: "ausgefuehrt" } : null;
}

/**
 * Fire stop from form values (schott_* fields), or null when the element has no fire
 * resistance or nothing about the stop was entered. The class defaults to the element's rating.
 * @param {Record<string, any>} w
 * @returns {Brandschott|null}
 */
export function brandschottAus(w) {
  if (!w || !w.feuerwiderstand || w.feuerwiderstand === "ohne") return null;
  const txt = (v) => String(v ?? "").trim();
  const felder = ["schott_system", "schott_zulassung_nr", "schott_hersteller", "schott_klasse"].map((k) => txt(w[k]));
  if (!felder.some(Boolean)) return null;
  return {
    klasse: FEUERWIDERSTAENDE.includes(w.schott_klasse) && w.schott_klasse !== "ohne" ? w.schott_klasse : w.feuerwiderstand,
    system: txt(w.schott_system),
    zulassung_art: ZULASSUNG_ARTEN.some((z) => z.key === w.schott_zulassung_art) ? w.schott_zulassung_art : "",
    zulassung_nr: txt(w.schott_zulassung_nr),
    hersteller: txt(w.schott_hersteller),
    kennzeichnung: w.schott_kennzeichnung === true || w.schott_kennzeichnung === "ja",
  };
}

/**
 * Data sheets of an opening and its fire stop (97-02a) — 107-04: lives in @core (bauteil/durchbruchSteckbrief.js) so the IFC export and
 * the BIM studio can use it; re-exported here, all app callers stay valid.
 */
export { durchbruchSteckbriefe };

/**
 * New opening from form values (status 'beantragt', stable BCF topic guid).
 * @param {Record<string, any>} w form values (sizes in mm as typed, positions in m)
 * @param {{projectId: string, alle: DurchbruchRecord[], rng?: () => number}} kontext
 * @returns {DurchbruchRecord & {project_id: string}}
 */
export function neuerDurchbruch(w, { projectId, alle, rng = Math.random }) {
  const mm = (v) => (zahl(v) === null ? null : /** @type {number} */ (zahl(v)) / 1000);
  const art = DURCHBRUCH_ARTEN.some((a) => a.key === w.art) ? w.art : "durchbruch";
  const form = w.form === "rund" || art === "kernbohrung" ? "rund" : "rechteck";
  return {
    project_id: projectId,
    nr: naechsteNr(alle),
    art,
    form,
    x: zahl(w.x), y: zahl(w.y), z: zahl(w.z),
    b: form === "rechteck" ? mm(w.b_mm) : null,
    h: form === "rechteck" ? mm(w.h_mm) : null,
    d: form === "rund" ? mm(w.d_mm) : null,
    t: art === "schlitz" ? mm(w.t_mm) : null,
    bauteil_guid: String(w.bauteil_guid || "").trim(),
    bauteil_name: String(w.bauteil_name || "").trim(),
    geschoss: String(w.geschoss || "").trim(),
    gewerk: DURCHBRUCH_GEWERKE.some((g) => g.wert === w.gewerk) ? w.gewerk : "",
    feuerwiderstand: FEUERWIDERSTAENDE.includes(w.feuerwiderstand) ? w.feuerwiderstand : "ohne",
    abschottung: String(w.abschottung || "").trim(),
    brandschott: brandschottAus(w),
    status: "beantragt",
    pruefung: { statik: null, architekt: null },
    bcf_topic_guid: newTopicGuid(rng),
    kommentar: String(w.kommentar || "").trim(),
  };
}

/**
 * BCF topic of one opening for @ifc/lib/bcf.js buildBcfZip: title with number,
 * kind and size, description with all data, the penetrated element as selection,
 * review notes as comments, camera 3 m diagonally above the opening looking at it.
 * @param {DurchbruchRecord} d
 * @param {{autor?: string}} [opt]
 * @returns {Record<string, any>} topic for buildBcfZip
 */
export function alsBcfTopic(d, { autor = "BIT-Atelier" } = {}) {
  const gewerk = DURCHBRUCH_GEWERKE.find((g) => g.wert === d.gewerk);
  const zeilen = [
    `${labelAus(DURCHBRUCH_ARTEN, d.art)} ${masseText(d)}`,
    `Lage x/y/z [m]: ${[d.x, d.y, d.z].map((v) => (zahl(v) === null ? "?" : /** @type {number} */ (zahl(v)).toFixed(3))).join(" / ")}`,
    d.bauteil_name || d.bauteil_guid ? `Bauteil: ${[d.bauteil_name, d.bauteil_guid].filter(Boolean).join(" · ")}` : "",
    d.geschoss ? `Geschoss: ${d.geschoss}` : "",
    gewerk ? `Gewerk: ${gewerk.wert} ${gewerk.text}` : "",
    `Feuerwiderstand Bauteil: ${d.feuerwiderstand || "ohne"}${d.abschottung ? ` · Abschottung: ${d.abschottung}` : ""}`,
    `Status: ${labelAus(DURCHBRUCH_STATUS, d.status)}`,
    d.kommentar || "",
  ].filter(Boolean);
  const kommentare = [];
  for (const [rolle, titel] of /** @type {Array<['statik'|'architekt', string]>} */ ([["statik", "Statik"], ["architekt", "Architekt"]])) {
    const v = d.pruefung?.[rolle];
    if (v) kommentare.push({ datum: v.am, autor: v.von, text: `${titel}: ${v.ergebnis === "ok" ? "geprüft, i. O." : "abgelehnt"}${v.kommentar ? ` — ${v.kommentar}` : ""}` });
  }
  const p = [d.x, d.y, d.z].map(zahl);
  const kamera = p.every((v) => v !== null)
    ? { pos: [/** @type {number} */ (p[0]) + 3, /** @type {number} */ (p[1]) - 3, /** @type {number} */ (p[2]) + 3], ziel: /** @type {number[]} */ (p) }
    : null;
  return {
    guid: d.bcf_topic_guid,
    titel: `${d.nr || "Durchbruch"} · ${labelAus(DURCHBRUCH_ARTEN, d.art)} ${masseText(d)}`,
    beschreibung: zeilen.join("\n"),
    topicType: "Durchbruch",
    topicStatus: BCF_STATUS[/** @type {keyof typeof BCF_STATUS} */ (d.status)] || "Open",
    ifcGuids: IFC_GUID.test(String(d.bauteil_guid || "")) ? [d.bauteil_guid] : [],
    kommentare,
    creationAuthor: autor,
    ...(kamera ? { kamera } : {}),
  };
}
