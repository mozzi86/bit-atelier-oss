// Data contract of the fee chain of phase 81 (offer → architect's contract →
// fee amendment): status tables with the allowed next states and the
// commissioning stages of a contract. Pure; shared by 81-02…81-05 and phase 82.
//
// UI words are always "Honorarangebot", "Architektenvertrag" and
// "Honorarnachtrag" — never "Angebot", "Vertrag" or "Nachtrag" alone, which
// mean bids, construction contracts and change orders in the AVA (pitfall 1).
//
// 79's Honorarvertrag carries the commissioned stages in `lph[i].beauftragt`.
// Phase 81 adds `stufen[{nr, lph[], beauftragt_am}]`: commissioning a stage sets
// the flags, so 79's fee calculation and the time tracking see only what is
// commissioned (D-P81-32).
//
// In:  contracts (79 shape + 81 fields). Out: ANGEBOT_STATUS, VERTRAG_STATUS,
//      NACHTRAG_STATUS, statusErlaubt, beauftragteStufenLph, stufeSetztLph.

/**
 * @typedef {Readonly<Record<string, Readonly<{label: string, naechste: ReadonlyArray<string>}>>>} StatusTabelle
 */

/**
 * @param {Record<string, {label: string, naechste: string[]}>} t
 * @returns {StatusTabelle}
 */
const tabelle = (t) => Object.freeze(Object.fromEntries(Object.entries(t).map(([k, v]) => [k, Object.freeze({ label: v.label, naechste: Object.freeze([...v.naechste]) })])));

/**
 * Honorarangebot: from 'versendet' on a version is immutable; a new version
 * replaces the open ones. "abgelaufen" is shown only, never stored.
 * @type {StatusTabelle}
 */
export const ANGEBOT_STATUS = tabelle({
  entwurf: { label: "im Entwurf", naechste: ["versendet", "ersetzt"] },
  versendet: { label: "Versendet", naechste: ["angenommen", "abgelehnt", "ersetzt"] },
  angenommen: { label: "Angenommen", naechste: [] },
  abgelehnt: { label: "Abgelehnt", naechste: [] },
  ersetzt: { label: "Ersetzt", naechste: [] },
});

/**
 * Architektenvertrag (79 Honorarvertrag + 81 status).
 * @type {StatusTabelle}
 */
export const VERTRAG_STATUS = tabelle({
  entwurf: { label: "im Entwurf", naechste: ["beauftragt"] },
  beauftragt: { label: "Beauftragt", naechste: ["ruht", "abgeschlossen", "gekuendigt"] },
  ruht: { label: "Ruht", naechste: ["beauftragt", "abgeschlossen", "gekuendigt"] },
  abgeschlossen: { label: "Abgeschlossen", naechste: [] },
  gekuendigt: { label: "Gekündigt", naechste: [] },
});

/**
 * Honorarnachtrag: commissioned and rejected are final.
 * @type {StatusTabelle}
 */
export const NACHTRAG_STATUS = tabelle({
  entwurf: { label: "im Entwurf", naechste: ["angeboten", "abgelehnt"] },
  angeboten: { label: "Angeboten", naechste: ["beauftragt", "abgelehnt"] },
  beauftragt: { label: "Beauftragt", naechste: [] },
  abgelehnt: { label: "Abgelehnt", naechste: [] },
});

/**
 * Whether a status change is allowed by a table.
 * @param {StatusTabelle} tab ANGEBOT_STATUS | VERTRAG_STATUS | NACHTRAG_STATUS
 * @param {string} von current status
 * @param {string} nach target status
 * @returns {boolean}
 */
export function statusErlaubt(tab, von, nach) {
  return Boolean(tab?.[von]?.naechste?.includes(nach));
}

/**
 * Commissioned work stages of a contract: the union of `stufen[].lph` with a
 * `beauftragt_am`; a contract without stages (built by 79's form) falls back to
 * the `beauftragt` flags of `lph[]`.
 * @param {Record<string, any>|null|undefined} vertrag
 * @returns {number[]} LPH numbers, ascending
 */
export function beauftragteStufenLph(vertrag) {
  const stufen = Array.isArray(vertrag?.stufen) ? vertrag.stufen : [];
  const menge = new Set();
  if (stufen.length) {
    for (const s of stufen) if (s?.beauftragt_am) for (const nr of s.lph || []) menge.add(Number(nr));
  } else {
    (Array.isArray(vertrag?.lph) ? vertrag.lph : []).forEach((l, i) => { if (l?.beauftragt === true) menge.add(i + 1); });
  }
  return [...menge].filter(Number.isFinite).sort((a, b) => a - b);
}

/**
 * Commissions stage `nr`: sets its `beauftragt_am` and the `beauftragt` flag of
 * each of its LPH in `lph[]` (79 field; the stored percentages stay). Returns a
 * new contract; every other field is unchanged. An unknown stage returns the
 * contract unchanged.
 * @param {Record<string, any>} vertrag
 * @param {number} nr stage number
 * @param {string} datumIso 'YYYY-MM-DD'
 * @returns {Record<string, any>}
 */
export function stufeSetztLph(vertrag, nr, datumIso) {
  const stufen = Array.isArray(vertrag?.stufen) ? vertrag.stufen : [];
  const stufe = stufen.find((s) => s?.nr === nr);
  if (!stufe) return vertrag;
  const lph = (Array.isArray(vertrag.lph) ? vertrag.lph : []).map((l, i) => ((stufe.lph || []).includes(i + 1) ? { ...l, beauftragt: true } : { ...l }));
  return { ...vertrag, lph, stufen: stufen.map((s) => (s === stufe ? { ...s, beauftragt_am: datumIso } : s)) };
}
