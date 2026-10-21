// bemusterung.js — sampling (Bemusterung, 88-05, RE-11): one sample per item to be
// decided (floor covering, wall paint, …) with manufacturer/product, colour (RAL / NCS),
// surface class, submission and release with name; suggestions from the room book;
// the release protocol as an A4 PDF (jspdf, dynamic import).
//
// Data contract — entity `Bemusterung` (schemaless, new):
//   {project_id, nr ("B-001"), gegenstand, raum_bezug, position_ref (LV OZ or text),
//    fabrikat, produkt, farbe_system 'RAL'|'NCS'|'sonstig', farbe, oberflaeche,
//    status 'offen' → 'vorgelegt' → 'freigegeben' | 'abgelehnt',
//    vorgelegt_am (ISO date), freigabe {von, am (ISO), bemerkung} | null,
//    99-02 additive: wohnung_id (Wohneinheit id, apartment sample of a buyer) and
//    sonderwunsch_id (the special request it came from) — both absent on project samples}
//
// 99-02: a special request of a buyer (sonderwunsch.js) carries the same product fields and
// is checked with the same rules (farbeGueltig, OBERFLAECHEN). When the buyer releases it,
// bemusterungAusSonderwunsch() turns it into ONE released sample of the apartment — the
// sample register stays the single list of released products; the protocol can be printed
// per apartment.
//
// In:  Bemusterung records, room book rows (@designer/lib/raumbuch), form values.
// Out: findings, patches, suggestions, PDF bytes. Pure apart from the PDF builder's
//      dynamic import.

import { raumbuchVon } from "@designer/lib/raumbuch";
import { usageInfo } from "@designer/lib/spaceProgram";

/** Status keys with German labels (labels double as i18n keys). */
export const BEMUSTERUNG_STATUS = Object.freeze([
  Object.freeze({ key: "offen", label: "Offen" }),
  Object.freeze({ key: "vorgelegt", label: "Vorgelegt" }),
  Object.freeze({ key: "freigegeben", label: "Freigegeben" }),
  Object.freeze({ key: "abgelehnt", label: "Abgelehnt" }),
]);

/**
 * Surface classes offered in the form. Sources: Q1–Q4 Merkblatt Nr. 2 (Bundesverband
 * der Gipsindustrie, Verspachtelung von Gipsplatten); SB1–SB4 DBV/VDZ-Merkblatt
 * Sichtbeton; R9–R13 slip resistance DGUV Regel 108-003 / ASR A1.5.
 */
export const OBERFLAECHEN = Object.freeze(["Q1", "Q2", "Q3", "Q4", "SB1", "SB2", "SB3", "SB4", "R9", "R10", "R11", "R12", "R13"]);

// RAL Classic "RAL 9010" (4 digits) or RAL Design "RAL 210 50 20" (hue lightness chroma).
const RAL = /^RAL\s?(\d{4}|\d{3}\s\d{2}\s\d{2})$/i;
// NCS "S 0502-Y", "S 2030-Y90R", "S 0500-N" (optional leading "NCS").
const NCS = /^(NCS\s)?S\s?\d{4}-(N|[YRBG](\d{2}[YRBG])?)$/i;

/**
 * @typedef {object} BemusterungRecord
 * @property {string} [id]
 * @property {string} [nr]
 * @property {string} [gegenstand]
 * @property {string} [raum_bezug]
 * @property {string} [position_ref]
 * @property {string} [fabrikat]
 * @property {string} [produkt]
 * @property {string} [farbe_system]
 * @property {string} [farbe]
 * @property {string} [oberflaeche]
 * @property {string} [status]
 * @property {string|null} [vorgelegt_am]
 * @property {{von: string, am: string, bemerkung?: string}|null} [freigabe]
 * @property {string} [wohnung_id] 99-02: apartment (Wohneinheit id) of a buyer's sample
 * @property {string} [sonderwunsch_id] 99-02: special request the sample came from
 */

/**
 * German label of a status.
 * @param {unknown} s
 * @returns {string}
 */
export function bemusterungStatusLabel(s) {
  return BEMUSTERUNG_STATUS.find((x) => x.key === s)?.label || String(s || "");
}

/**
 * Whether a colour code matches its system's format (RAL Classic/Design, NCS).
 * @param {string} system 'RAL' | 'NCS' | 'sonstig'
 * @param {string} farbe
 * @returns {boolean} true for 'sonstig' and empty colours (nothing to check)
 */
export function farbeGueltig(system, farbe) {
  const f = String(farbe || "").trim();
  if (!f || system === "sonstig" || !system) return true;
  return system === "RAL" ? RAL.test(f) : system === "NCS" ? NCS.test(f) : true;
}

/**
 * Findings of one sample. hinweis/warn only — a sample is a client decision; the
 * program flags gaps, it never blocks a release (liability stays with the people
 * who sign the protocol).
 * @param {BemusterungRecord} b
 * @returns {Array<{code: string, stufe: 'warn'|'hinweis', text: string}>}
 */
export function bemusterungHinweise(b) {
  /** @type {Array<{code: string, stufe: 'warn'|'hinweis', text: string}>} */
  const h = [];
  if (!b || b.status === "abgelehnt") return h;
  if (!farbeGueltig(String(b.farbe_system || ""), String(b.farbe || ""))) {
    h.push({ code: "farbe_format", stufe: "warn", text: "Farbangabe passt nicht zum Farbsystem (RAL 9010 / NCS S 0502-Y)" });
  }
  if (!String(b.fabrikat || "").trim() && !String(b.produkt || "").trim()) {
    h.push({ code: "fabrikat_fehlt", stufe: "hinweis", text: "Fabrikat / Produkt fehlt" });
  }
  if (b.status === "freigegeben" && !String(b.position_ref || "").trim()) {
    h.push({ code: "ohne_position", stufe: "hinweis", text: "Freigegeben ohne Bezug zur LV-Position" });
  }
  return h;
}

/**
 * Patch "submitted" (offen → vorgelegt) with date.
 * @param {BemusterungRecord} b
 * @param {Date} [jetzt]
 * @returns {{status: 'vorgelegt', vorgelegt_am: string}|null}
 */
export function vorlagePatch(b, jetzt = new Date()) {
  return b?.status === "offen" ? { status: "vorgelegt", vorgelegt_am: jetzt.toISOString().slice(0, 10) } : null;
}

/**
 * Patch for the decision on a submitted sample.
 * @param {BemusterungRecord} b
 * @param {'freigegeben'|'abgelehnt'} ergebnis
 * @param {string} von name of the deciding person (required)
 * @param {string} [bemerkung]
 * @param {Date} [jetzt]
 * @returns {{status: string, freigabe: {von: string, am: string, bemerkung: string}}|null}
 */
export function entscheidungPatch(b, ergebnis, von, bemerkung = "", jetzt = new Date()) {
  const name = String(von || "").trim();
  if (!b || b.status !== "vorgelegt" || !name || (ergebnis !== "freigegeben" && ergebnis !== "abgelehnt")) return null;
  return { status: ergebnis, freigabe: { von: name, am: jetzt.toISOString(), bemerkung: String(bemerkung || "").trim() } };
}

/**
 * Next free number "B-001" … in the project.
 * @param {BemusterungRecord[]} alle
 * @returns {string}
 */
export function naechsteBemusterungNr(alle) {
  const max = (alle || []).reduce((m, b) => {
    const n = /^B-(\d+)$/.exec(String(b?.nr || ""));
    return n ? Math.max(m, Number(n[1])) : m;
  }, 0);
  return `B-${String(max + 1).padStart(3, "0")}`;
}

/**
 * New sample from form values (status 'offen').
 * @param {Record<string, any>} w
 * @param {{projectId: string, alle: BemusterungRecord[]}} k
 * @returns {BemusterungRecord & {project_id: string}}
 */
export function neueBemusterung(w, { projectId, alle }) {
  const sys = ["RAL", "NCS", "sonstig"].includes(w.farbe_system) ? w.farbe_system : "sonstig";
  return {
    project_id: projectId,
    nr: naechsteBemusterungNr(alle),
    gegenstand: String(w.gegenstand || "").trim(),
    raum_bezug: String(w.raum_bezug || "").trim(),
    position_ref: String(w.position_ref || "").trim(),
    fabrikat: String(w.fabrikat || "").trim(),
    produkt: String(w.produkt || "").trim(),
    farbe_system: sys,
    farbe: String(w.farbe || "").trim(),
    oberflaeche: OBERFLAECHEN.includes(w.oberflaeche) ? w.oberflaeche : String(w.oberflaeche || "").trim(),
    status: "offen",
    vorgelegt_am: null,
    freigabe: null,
    // 99-02 additive: an apartment sample keeps its apartment; project samples stay without.
    ...(w.wohnung_id ? { wohnung_id: String(w.wohnung_id) } : {}),
  };
}

/**
 * 99-02: the released sample of a buyer's special request — product, colour and surface of
 * the request, released by the buyer's decision (name, date). null when the request has no
 * product data (nothing to sample, e.g. an extra socket) or is not released.
 * @param {Record<string, any>} sw Sonderwunsch record (status 'freigegeben' or later)
 * @param {{id?: string, nr?: string}|null} wohnung the apartment
 * @param {{projectId: string, alle: BemusterungRecord[]}} k alle = existing samples (number pool)
 * @returns {(BemusterungRecord & {project_id: string})|null}
 */
export function bemusterungAusSonderwunsch(sw, wohnung, { projectId, alle }) {
  const freigegeben = ["freigegeben", "eingearbeitet", "abgenommen"].includes(String(sw?.status));
  const produkt = [sw?.fabrikat, sw?.produkt, sw?.farbe].some((v) => String(v || "").trim());
  if (!sw || !freigegeben || !produkt) return null;
  const basis = neueBemusterung({
    gegenstand: `${sw.nr || ""}: ${sw.beschreibung || ""}`.trim(),
    raum_bezug: [wohnung?.nr, sw.raum].filter(Boolean).join(" · "),
    position_ref: "",
    fabrikat: sw.fabrikat, produkt: sw.produkt, farbe_system: sw.farbe_system, farbe: sw.farbe, oberflaeche: sw.oberflaeche,
    wohnung_id: wohnung?.id || sw.wohnung_id,
  }, { projectId, alle });
  const e = sw.entscheidung;
  return {
    ...basis,
    status: "freigegeben",
    vorgelegt_am: String(sw.angeboten_am || "").slice(0, 10) || null,
    freigabe: { von: String(e?.von || ""), am: String(e?.am || new Date().toISOString()), bemerkung: `Sonderwunsch ${sw.nr || ""}`.trim() },
    sonderwunsch_id: sw.id ? String(sw.id) : undefined,
  };
}

/**
 * Suggestions from the room book: one sample per distinct finish (floor, wall,
 * ceiling, skirting) that no existing sample covers yet (same gegenstand text,
 * case-insensitive). The room types using a finish go into raum_bezug.
 * @param {Array<{use: string, raumbuch?: any}>} items SpaceProgram rows
 * @param {BemusterungRecord[]} bestehende existing samples of the project
 * @returns {Array<{gegenstand: string, raum_bezug: string}>}
 */
export function vorschlaegeAusRaumbuch(items, bestehende = []) {
  const bauteil = { boden: "Boden", sockel: "Sockel", wand: "Wand", decke: "Decke" };
  /** @type {Map<string, {gegenstand: string, raeume: Set<string>}>} */
  const m = new Map();
  for (const it of items || []) {
    const r = raumbuchVon(it);
    for (const [key, label] of Object.entries(bauteil)) {
      const material = String(r[/** @type {"boden"|"sockel"|"wand"|"decke"} */ (key)] || "").trim();
      if (!material) continue;
      const gegenstand = `${label}: ${material}`;
      const k = gegenstand.toLowerCase();
      if (!m.has(k)) m.set(k, { gegenstand, raeume: new Set() });
      /** @type {{raeume: Set<string>}} */ (m.get(k)).raeume.add(usageInfo(it.use).label);
    }
  }
  const vorhanden = new Set((bestehende || []).map((b) => String(b.gegenstand || "").trim().toLowerCase()));
  return [...m.entries()].filter(([k]) => !vorhanden.has(k)).map(([, v]) => ({ gegenstand: v.gegenstand, raum_bezug: [...v.raeume].join(", ") }));
}

/**
 * True for a project sample, false for a buyer's apartment sample (99-02, wohnung_id set).
 * The sampling tab and its protocol show project samples only; apartment samples live in the
 * tab "Wohnungen & Sonderwünsche". Numbers (B-…) stay one pool for both.
 * @param {BemusterungRecord & {wohnung_id?: string|null}} b
 * @returns {boolean}
 */
export function istProjektMuster(b) {
  return !String(b?.wohnung_id || "");
}

/**
 * Release protocol (Bemusterungsprotokoll) as A4 landscape PDF: all decided samples
 * (released and rejected) with colour, surface, decision, name and date; blank
 * signature lines. No office logo (office data only from the caller).
 * 99-02: with `wohnung` only that apartment's samples are printed and the title names it
 * (the protocol a buyer signs). Without `wohnung` only project samples (no wohnung_id) are
 * printed — the developer's protocol must not show buyers' samples and names (privacy; one
 * buyer's protocol never shows another buyer's choices either).
 * @param {{projekt?: {name?: string, client?: string}|null, muster: BemusterungRecord[], jetzt?: Date, wohnung?: {id?: string, nr?: string}|null}} p
 * @returns {Promise<{bytes: Uint8Array, dateiname: string, anzahl: number}>} anzahl = rows printed
 */
export async function bemusterungsProtokollPdf({ projekt = null, muster, jetzt = new Date(), wohnung = null }) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const L = 15;
  let y = 18;
  pdf.setFont("helvetica", "bold"); pdf.setFontSize(14); pdf.text(wohnung ? `Bemusterungsprotokoll Wohnung ${wohnung.nr || ""}` : "Bemusterungsprotokoll", L, y); y += 7;
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(9);
  pdf.text(`Projekt: ${projekt?.name || "—"}${projekt?.client ? ` · Bauherr: ${projekt.client}` : ""} · Stand ${jetzt.toLocaleDateString("de-DE")}`, L, y); y += 8;
  const spalten = [["Nr.", 14], ["Gegenstand", 52], ["Raum", 34], ["Fabrikat / Produkt", 50], ["Farbe", 30], ["Oberfl.", 16], ["Entscheidung", 26], ["durch / am", 45]];
  const kopf = () => {
    pdf.setFont("helvetica", "bold"); let x = L;
    for (const [s, w] of spalten) { pdf.text(String(s), x, y); x += /** @type {number} */ (w); }
    y += 2; pdf.setLineWidth(0.3); pdf.line(L, y, L + 267, y); y += 4.5; pdf.setFont("helvetica", "normal");
  };
  kopf();
  const entschieden = (muster || []).filter((b) => (b.status === "freigegeben" || b.status === "abgelehnt")
    && (wohnung ? b.wohnung_id === wohnung.id : istProjektMuster(b)));
  for (const b of entschieden) {
    const werte = [b.nr || "", b.gegenstand || "", b.raum_bezug || "", [b.fabrikat, b.produkt].filter(Boolean).join(" · "),
      b.farbe || "", b.oberflaeche || "",
      b.status === "freigegeben" ? "freigegeben" : "abgelehnt",
      b.freigabe ? `${b.freigabe.von}, ${new Date(b.freigabe.am).toLocaleDateString("de-DE")}` : ""];
    const zeilen = werte.map((v, i) => pdf.splitTextToSize(String(v), /** @type {number} */ (spalten[i][1]) - 2));
    const hoehe = Math.max(...zeilen.map((z) => z.length)) * 4;
    if (y + hoehe > 180) { pdf.addPage(); y = 18; kopf(); }
    let x = L;
    zeilen.forEach((z, i) => { pdf.text(z, x, y); x += /** @type {number} */ (spalten[i][1]); });
    y += hoehe + 1.5;
    if (b.freigabe?.bemerkung) { pdf.setFontSize(8); pdf.text(`Bemerkung: ${b.freigabe.bemerkung}`, L + 14, y - 1); pdf.setFontSize(9); y += 3; }
  }
  if (entschieden.length === 0) { pdf.text("Noch keine entschiedenen Muster.", L, y); y += 6; }
  y = Math.max(y + 12, 175);
  if (y > 190) { pdf.addPage(); y = 40; }
  pdf.setLineWidth(0.2); pdf.line(L, y, L + 80, y); pdf.line(L + 110, y, L + 190, y);
  pdf.setFontSize(8); pdf.text(wohnung ? "Ort, Datum, Käufer" : "Ort, Datum, Bauherr", L, y + 4); pdf.text("Ort, Datum, Objektüberwachung", L + 110, y + 4);
  const safe = String(projekt?.name || "Projekt").replace(/[^\p{L}\p{N}_-]+/gu, "_").slice(0, 40);
  return { bytes: new Uint8Array(pdf.output("arraybuffer")), dateiname: `Bemusterungsprotokoll_${safe}${wohnung?.nr ? `_${String(wohnung.nr).replace(/[^\p{L}\p{N}_-]+/gu, "_")}` : ""}_${jetzt.toISOString().slice(0, 10)}.pdf`, anzahl: entschieden.length };
}
