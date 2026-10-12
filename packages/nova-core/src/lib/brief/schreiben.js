// Letters of the correspondence (phase 82, 82-05): the rules from draft to a
// fixed, filed letter. Pure — nothing is stored here; the page stores through
// the office store (bueroEntitaet, 82-01, E-03).
//
// - festschreiben: freezes text and fields, stores the SHA-256 (hex) of the PDF
//   bytes and the layout version. Business letters are kept 6 years
//   (§ 147 Abs. 1 Nr. 2/3 AO, [ASSUMED] for every letter type — letters that
//   are accounting documents may need 10), so a fixed letter keeps bytes, hash
//   and the frozen text, is never edited and never deleted;
// - statusWechsel: entwurf → festgeschrieben → versendet, never back;
// - kontextFuer: gathers the placeholder data of a reference (incoming mail,
//   invoice, fee offer, project) as SNAPSHOTS — the recipient's address is
//   copied into the letter, a later change in the address book does not change
//   a sent letter. Data of src/ (79's dunning text, 81's fee records) come in
//   injected, because @core may not import src/;
// - briefModell: the input of briefLayout() from a letter.
//
// In:  letter records, data lists, injected text builders. Out: see the exports.

import { briefkopfZeilen } from "./briefkopf.js";
import { schreibenStatusWechsel } from "./status.js";
import { ersetzeNichtWinAnsi } from "./winAnsi.js";

/** Version of the letter layout written into a fixed letter (raise when briefLayout's geometry changes). */
export const LAYOUT_VERSION = 1;

/**
 * SHA-256 of bytes as lower-case hex (Web Crypto, also in Node ≥ 20).
 * @param {Uint8Array} bytes
 * @returns {Promise<string>}
 */
export async function sha256Hex(bytes) {
  const puffer = await globalThis.crypto.subtle.digest("SHA-256", /** @type {Uint8Array<ArrayBuffer>} */ (bytes));
  return [...new Uint8Array(puffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The 32-hex-character file id briefPdf's `fixiert` needs, derived from the letter id
 * (same letter → same id → same bytes with the same timestamp).
 * @param {string} id
 * @returns {Promise<string>}
 */
export async function dateiIdAus(id) {
  return (await sha256Hex(new TextEncoder().encode(String(id)))).slice(0, 32);
}

/**
 * Freezes a draft.
 * @param {Record<string, any>} entwurf letter in state 'entwurf'
 * @param {{pdfBytes: Uint8Array, jetzt: string, layoutVersion?: number, fehlend?: ReadonlyArray<string>}} optionen
 *   jetzt: ISO timestamp of freezing (also the fixed PDF creation date); fehlend: required placeholders without value
 * @returns {Promise<Record<string, any>>} the fixed letter (new object)
 * @throws {Error} when the letter is not a draft, required data are missing or there are no bytes
 */
export async function festschreiben(entwurf, { pdfBytes, jetzt, layoutVersion = LAYOUT_VERSION, fehlend = [] }) {
  if (!entwurf || entwurf.status !== "entwurf") throw new Error("bereits festgeschrieben");
  if (fehlend.length) throw new Error(`Pflichtangaben fehlen: ${fehlend.join(", ")}`);
  if (!(pdfBytes instanceof Uint8Array) || !pdfBytes.length) throw new Error("Kein PDF zum Festschreiben");
  return {
    ...entwurf,
    status: "festgeschrieben",
    festgeschrieben_am: jetzt,
    text: String(entwurf.text ?? ""),
    felder: { ...(entwurf.felder || {}) },
    pdf_sha256: await sha256Hex(pdfBytes),
    layout_version: layoutVersion,
  };
}

/**
 * Changes the text of a draft.
 * @param {Record<string, any>} schreiben
 * @param {string} text
 * @returns {Record<string, any>}
 * @throws {Error} when the letter is fixed
 */
export function aendereText(schreiben, text) {
  if (schreiben?.status !== "entwurf") throw new Error("festgeschrieben – Text nicht änderbar");
  return { ...schreiben, text };
}

/**
 * Moves a letter forward.
 * @param {Record<string, any>} schreiben
 * @param {'festgeschrieben'|'versendet'} nach
 * @param {{jetzt?: string, versandweg?: string}} [optionen] versendet: date and channel
 * @returns {Record<string, any>}
 * @throws {Error} on a forbidden change (backwards or skipping freezing)
 */
export function statusWechsel(schreiben, nach, { jetzt, versandweg } = {}) {
  if (!schreibenStatusWechsel(schreiben?.status, nach)) throw new Error(`Statuswechsel ${schreiben?.status} → ${nach} nicht erlaubt`);
  if (nach === "versendet") return { ...schreiben, status: nach, versendet_am: jetzt || null, versandweg: versandweg || "brief" };
  return { ...schreiben, status: nach };
}

/**
 * Whether a letter may be deleted (only drafts — a fixed letter is a record).
 * @param {Record<string, any>|null|undefined} schreiben
 * @returns {boolean}
 */
export function loeschbar(schreiben) {
  return schreiben?.status === "entwurf";
}

/**
 * Splits a one-line address "Street 1, 12345 Town" into its parts.
 * @param {string} text
 * @returns {{strasse: string, plz: string, ort: string}}
 */
function anschriftAus(text) {
  const zeilen = String(text || "").split(/\n|,\s*/).map((z) => z.trim()).filter(Boolean);
  const ortZeile = zeilen.findIndex((z) => /^\d{4,5}\s+\S/.test(z));
  if (ortZeile < 0) return { strasse: zeilen.join(", "), plz: "", ort: "" };
  const m = /** @type {RegExpMatchArray} */ (zeilen[ortZeile].match(/^(\d{4,5})\s+(.*)$/));
  return { strasse: zeilen.slice(0, ortZeile).join(", "), plz: m[1], ort: m[2] };
}

/**
 * Recipient snapshot of a letter.
 * @typedef {{contact_id: string|null, anrede: string, titel: string, name: string, firma: string, abteilung: string,
 *   strasse: string, plz: string, ort: string, land: string}} Empfaenger
 */

/**
 * Recipient snapshot from an address book contact.
 * @param {Record<string, any>|null|undefined} kontakt Contact {name, company, address, zip, city}
 * @returns {Empfaenger|null}
 */
export function empfaengerAusKontakt(kontakt) {
  if (!kontakt) return null;
  return {
    contact_id: kontakt.id || null, anrede: "", titel: "", name: String(kontakt.name || ""), firma: String(kontakt.company || ""), abteilung: "",
    strasse: String(kontakt.address || ""), plz: String(kontakt.zip || ""), ort: String(kontakt.city || ""), land: "",
  };
}

/**
 * Recipient snapshot from a name and a free address text (invoice, fee offer).
 * @param {string} name
 * @param {string} anschrift
 * @returns {Empfaenger}
 */
function empfaengerAusText(name, anschrift) {
  return { contact_id: null, anrede: "", titel: "", name: "", firma: String(name || ""), abteilung: "", ...anschriftAus(anschrift), land: "" };
}

/**
 * Address lines of a recipient (DIN 5008 address field, top to bottom).
 * @param {Empfaenger|null|undefined} e
 * @returns {string[]}
 */
export function anschriftZeilen(e) {
  if (!e) return [];
  const person = [e.anrede, e.titel, e.name].filter(Boolean).join(" ");
  return [e.firma, e.abteilung, person, e.strasse, [e.plz, e.ort].filter(Boolean).join(" "), e.land].map((z) => String(z || "").trim()).filter(Boolean);
}

/** @param {Empfaenger|null|undefined} e @returns {boolean} whether street and town are present */
export function anschriftVollstaendig(e) {
  return Boolean(e && String(e.strasse || "").trim() && String(e.ort || "").trim());
}

/** @param {Record<string, any>|null|undefined} briefkopf normalised letterhead {office, tagline, address, contact} */
function bueroDaten(briefkopf) {
  return { name: briefkopf?.office || "", zusatz: briefkopf?.tagline || "", anschrift: briefkopf?.address || "", kontakt: briefkopf?.contact || "" };
}

/**
 * Text fields of a dunning letter as 79 builds them (mahnwesen.mahnTextFelder + mahnPdf.mahnBrief).
 * @typedef {{betreff: string, absaetze: string[], tabelle?: {kopf: string[], zeilen: string[][]}|null,
 *   empfaenger?: string[], offenCent?: number, zinsenCent?: number, pauschaleCent?: number, summeCent?: number, frist?: string}} MahnText
 */

/**
 * Data a reference draws on. Lists are the stored records; the text builders of src/ are injected.
 * @typedef {{
 *   heute: string, briefkopf?: Record<string, any>|null, kontakte?: any[], projekte?: any[], postbuch?: any[],
 *   rechnungen?: any[], angebote?: any[], vertraege?: any[], nachtraege?: any[],
 *   mahnText?: (rechnung: Record<string, any>, stufe: number) => MahnText,
 *   behinderung?: {eintrag_id: string, project_id: string|null, zeitraum: string, tage: number, text: string}|null,
 * }} KontextDaten
 *   behinderung: hindrance context of a site-diary entry (88-02), built in src/ from the diary
 */

/**
 * Placeholder data and prefill of a letter from its reference.
 * @param {{typ: string, id: string, stufe?: number}|null} bezug typ ∈ postbuch, rechnung, honorarangebot, honorarvertrag, honorarnachtrag, projekt, bautagebuch (88-02)
 * @param {KontextDaten} daten
 * @returns {{
 *   daten: Record<string, any>, empfaenger: Empfaenger|null, project_id: string|null, bereich: 'projekt'|'buero'|'buchhaltung',
 *   ihr_zeichen: string, text: string|null, tabelle: {kopf: string[], zeilen: string[][]}|null, hinweise: string[],
 * }}
 *   text/tabelle: only for the dunning letter (79's wording); hinweise: plain-text notes ("Bezug nicht gefunden")
 */
export function kontextFuer(bezug, daten) {
  const finde = (/** @type {any[]|undefined} */ liste, /** @type {string|null|undefined} */ id) => (id ? (liste || []).find((x) => x && x.id === id) || null : null);
  const projektDaten = (/** @type {any} */ p) => (p ? { name: p.name || "", nummer: p.number || p.nummer || "", adresse: [p.location?.address, p.location?.city].filter(Boolean).join(", ") } : {});
  /** @type {Record<string, any>} */
  const d = { buero: bueroDaten(daten.briefkopf), datum: daten.heute, unser_zeichen: "", ihr_zeichen: "", empfaenger: {}, projekt: {} };
  const aus = { daten: d, empfaenger: /** @type {Empfaenger|null} */ (null), project_id: /** @type {string|null} */ (null), bereich: /** @type {'projekt'|'buero'|'buchhaltung'} */ ("buero"),
    ihr_zeichen: "", text: /** @type {string|null} */ (null), tabelle: /** @type {any} */ (null), hinweise: /** @type {string[]} */ ([]) };
  const mitProjekt = (/** @type {string|null|undefined} */ id) => {
    const p = finde(daten.projekte, id);
    if (id) { aus.project_id = id; aus.bereich = "projekt"; }
    d.projekt = projektDaten(p);
  };
  if (!bezug) return aus;

  if (bezug.typ === "postbuch") {
    const pb = finde(daten.postbuch, bezug.id);
    if (!pb) { aus.hinweise.push("Bezug nicht gefunden"); return aus; }
    d.postbuch = { nummer: pb.nummer || "", datum: pb.datum || "", betreff: pb.betreff || "", ihr_zeichen: pb.ihr_zeichen || "" };
    d.ihr_zeichen = pb.ihr_zeichen || "";
    aus.ihr_zeichen = d.ihr_zeichen;
    aus.empfaenger = empfaengerAusKontakt(finde(daten.kontakte, pb.partner_contact_id)) || empfaengerAusText(pb.partner_name || "", "");
    mitProjekt(pb.project_id);
    if (!pb.project_id) aus.bereich = pb.bereich === "buchhaltung" ? "buchhaltung" : "buero";
  } else if (bezug.typ === "rechnung") {
    const r = finde(daten.rechnungen, bezug.id);
    if (!r) { aus.hinweise.push("Bezug nicht gefunden"); return aus; }
    const stufe = Number(bezug.stufe) || 1;
    d.rechnung = { nummer: r.nummer || "", datum: r.rechnungsdatum || "", offen: null };
    aus.empfaenger = empfaengerAusText(r.empfaenger?.name || "", r.empfaenger?.anschrift || "");
    aus.bereich = "buchhaltung";
    // Interest and flat fee as 79 recorded them in the dunning run (mahnungen[]); the
    // text builder of 79 is the only wording (D-P82-25) — nothing is computed here.
    const lauf = (Array.isArray(r.mahnungen) ? r.mahnungen : []).filter((m) => Number(m?.stufe) === stufe).pop() || null;
    const text = daten.mahnText ? daten.mahnText(r, stufe) : null;
    const euro = (/** @type {number|undefined} */ cent) => (Number.isFinite(cent) ? /** @type {number} */ (cent) / 100 : null);
    d.mahnung = {
      stufe,
      frist: lauf?.frist || text?.frist || "",
      zinsen: lauf && Number.isFinite(Number(lauf.zinsen)) ? Number(lauf.zinsen) : euro(text?.zinsenCent),
      pauschale: lauf && Number.isFinite(Number(lauf.pauschale)) ? Number(lauf.pauschale) : euro(text?.pauschaleCent),
      summe: euro(text?.summeCent),
    };
    d.rechnung.offen = euro(text?.offenCent);
    if (text) {
      aus.text = text.absaetze.join("\n\n");
      aus.tabelle = text.tabelle && text.tabelle.zeilen?.length ? { kopf: text.tabelle.kopf || [], zeilen: text.tabelle.zeilen } : null;
    } else {
      aus.hinweise.push("Mahntext aus der Buchhaltung nicht verfügbar");
    }
  } else if (bezug.typ === "honorarangebot") {
    const a = finde(daten.angebote, bezug.id);
    if (!a) { aus.hinweise.push("Bezug nicht gefunden"); return aus; }
    d.angebot = { nummer: a.nummer || "", datum: a.datum || "", gueltig_bis: a.gueltig_bis || "", netto: a.summen?.netto ?? null, brutto: a.summen?.brutto ?? null };
    aus.empfaenger = empfaengerAusText(a.bauherr_name || "", a.bauherr_anschrift || "");
    mitProjekt(a.project_id);
  } else if (bezug.typ === "honorarvertrag" || bezug.typ === "honorarnachtrag") {
    const n = bezug.typ === "honorarnachtrag" ? finde(daten.nachtraege, bezug.id) : null;
    const v = finde(daten.vertraege, n ? n.honorarvertrag_id : bezug.id);
    if (!v && !n) { aus.hinweise.push("Bezug nicht gefunden"); return aus; }
    if (v) d.vertrag = { nummer: v.nummer || "", datum: v.vertragsdatum || v.datum || "" };
    if (n) d.honorarnachtrag = { nr: n.nr ?? "", titel: n.titel || "", betrag: n.betrag_euro ?? null };
    aus.empfaenger = empfaengerAusText(v?.bauherr_name || "", v?.bauherr_anschrift || "");
    mitProjekt(v?.project_id || n?.project_id);
  } else if (bezug.typ === "bautagebuch") {
    const b = daten.behinderung && daten.behinderung.eintrag_id === bezug.id ? daten.behinderung : null;
    if (!b) { aus.hinweise.push("Bezug nicht gefunden"); return aus; }
    d.behinderung = { zeitraum: b.zeitraum, tage: b.tage, text: b.text };
    mitProjekt(b.project_id);
  } else if (bezug.typ === "projekt") {
    if (!finde(daten.projekte, bezug.id)) { aus.hinweise.push("Bezug nicht gefunden"); return aus; }
    mitProjekt(bezug.id);
    d.protokoll = { titel: "", datum: daten.heute, ort: "" };
  } else {
    aus.hinweise.push("Bezug unbekannt");
  }
  if (aus.empfaenger) d.empfaenger = { ...aus.empfaenger };
  return aus;
}

/**
 * Required placeholders still unfilled in a draft: the visible marks
 * `[[fehlt: pfad]]` the placeholder engine wrote into subject or text.
 * @param {{betreff?: string, text?: string}} schreiben
 * @returns {string[]} paths, each once
 */
export function fehlendIn(schreiben) {
  /** @type {string[]} */
  const pfade = [];
  for (const m of `${schreiben?.betreff || ""}\n${schreiben?.text || ""}`.matchAll(/\[\[fehlt: ([^\]]+)\]\]/g)) if (!pfade.includes(m[1])) pfade.push(m[1]);
  return pfade;
}

/**
 * Transliterates every text of a letter that goes into the PDF with 81-03's
 * `ersetzeNichtWinAnsi(text, {umschrift: true})` (Ş → S, → → "->" …), BEFORE the
 * layout: briefLayout would otherwise turn each such character into "?" (79's
 * behaviour without the option). The editor shows the count ("1 Zeichen ersetzt")
 * and freezes the transliterated letter, so the stored text equals the PDF.
 * @param {Record<string, any>} schreiben
 * @returns {{schreiben: Record<string, any>, ersetzt: number, zeichen: string[]}}
 */
export function umschreiben(schreiben) {
  let ersetzt = 0;
  /** @type {string[]} */
  const zeichen = [];
  // Line by line: the line break itself is no WinAnsi glyph and would become "?"
  // (briefLayout only ever gets single paragraphs, the letter text has many lines).
  const u = (/** @type {unknown} */ wert) => {
    if (typeof wert !== "string" || !wert) return wert;
    return wert.split("\n").map((zeile) => {
      const r = /** @type {{text: string, ersetzt: number, zeichen: string[]}} */ (ersetzeNichtWinAnsi(zeile, { umschrift: true }));
      ersetzt += r.ersetzt;
      zeichen.push(...r.zeichen);
      return r.text;
    }).join("\n");
  };
  const e = schreiben.empfaenger ? Object.fromEntries(Object.entries(schreiben.empfaenger).map(([k, v]) => [k, k === "contact_id" ? v : u(v)])) : schreiben.empfaenger;
  const tabelle = schreiben.tabelle ? { ...schreiben.tabelle, kopf: (schreiben.tabelle.kopf || []).map(u), zeilen: (schreiben.tabelle.zeilen || []).map((/** @type {any[]} */ z) => z.map(u)) } : schreiben.tabelle;
  const aus = {
    ...schreiben,
    betreff: u(schreiben.betreff),
    text: u(schreiben.text),
    ihr_zeichen: u(schreiben.ihr_zeichen),
    unser_zeichen: u(schreiben.unser_zeichen),
    empfaenger: e,
    anlagen: Array.isArray(schreiben.anlagen) ? schreiben.anlagen.map(u) : schreiben.anlagen,
    verteiler: Array.isArray(schreiben.verteiler) ? schreiben.verteiler.map(u) : schreiben.verteiler,
    tabelle,
  };
  return { schreiben: aus, ersetzt, zeichen };
}

/**
 * Input of briefLayout() from a letter: office as sender line and footer, address
 * field from the snapshot, date in German, every text line a paragraph (blank lines
 * separate as in the editor), the TOP table of a protocol, the distribution list.
 * @param {Record<string, any>} schreiben
 * @param {{briefkopf?: Record<string, any>|null, datumText: string}} optionen datumText: formatted letter date
 * @returns {Record<string, any>} argument of briefLayout()
 */
export function briefModell(schreiben, { briefkopf, datumText }) {
  const absaetze = String(schreiben.text || "").split("\n").map((z) => z.trimEnd()).filter((z) => z.trim() !== "");
  // References (DIN 5008 "Ihr Zeichen / Unser Zeichen") as the first body line — the core has no info block.
  const zeichen = [schreiben.ihr_zeichen ? `Ihr Zeichen: ${schreiben.ihr_zeichen}` : "", schreiben.unser_zeichen ? `Unser Zeichen: ${schreiben.unser_zeichen}` : ""].filter(Boolean).join(" · ");
  if (zeichen) absaetze.unshift(zeichen);
  const anlagen = Array.isArray(schreiben.anlagen) ? schreiben.anlagen.filter(Boolean) : [];
  if (anlagen.length) absaetze.push(`Anlagen: ${anlagen.join(", ")}`);
  const bk = briefkopf || {};
  const fuss = [bk.office, String(bk.address || "").split("\n").join(", "), bk.contact].map((z) => String(z || "").trim()).filter(Boolean).join(" · ");
  /** @type {Record<string, any>} */
  const modell = {
    absender: briefkopfZeilen(briefkopf),
    empfaenger: schreiben.variante === "verteiler" ? [] : anschriftZeilen(schreiben.empfaenger),
    datum: datumText,
    betreff: String(schreiben.betreff || ""),
    absaetze,
    tabelle: schreiben.tabelle && Array.isArray(schreiben.tabelle.zeilen) && schreiben.tabelle.zeilen.length ? schreiben.tabelle : null,
    seitenzahlen: true,
    fusszeileLinks: fuss,
  };
  if (schreiben.variante === "verteiler") {
    modell.variante = "verteiler";
    modell.verteiler = Array.isArray(schreiben.verteiler) ? schreiben.verteiler.filter(Boolean) : [];
  }
  return modell;
}
