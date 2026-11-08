// planAblage — pure helpers for "An Plan ablegen" in the BIM studio (110 follow-up): the studio builds the vector PDF of the
// current floor plan / section and files it directly on a plan of the plan list (Werkplanung), instead of download + upload.
//
// In:  Plan rows ({ id, gewerk, nr, titel, index }), the sheet title the studio prints ("Grundriss EG", "Schnitt A-A"),
//      PDF bytes. Out: the label of a plan in the picker, the plan that most likely matches the sheet, the download file
//      name, and the data URL that dokumentAblegen stores. No I/O here; the studio does the filing (dokumentAblegen +
//      Plan.update, the same path as the plan list's "PDF ablegen").
//
// The plan number formula of the plan list (@pdf/lib/plankopf plannummer) is not importable from @designer (boundary rule),
// so the picker shows gewerk-nr + title, which is unique enough to pick from.

/** @typedef {{ id: string, gewerk?: string, nr?: string|number, titel?: string, index?: string, status?: string, datei_ref?: string|null }} PlanZeile */

// Storey names the studio may print vs. names a plan title may use; both sides are reduced to the short code.
/** @type {Array<[RegExp, string]>} */
const GESCHOSS_KURZ = [
  [/\b(kellergeschoss|untergeschoss|keller)\b/g, "kg"],
  [/\bug\b/g, "kg"],
  [/\berdgeschoss\b/g, "eg"],
  [/\b(obergeschoss)\b/g, "og"],
  [/\b(dachgeschoss)\b/g, "dg"],
];

/**
 * Normalises a title for matching: lower case, umlauts kept, punctuation to spaces, storey names to short codes.
 * @param {unknown} s
 * @returns {string}
 */
export function titelNorm(s) {
  let t = String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ");
  for (const [re, kurz] of GESCHOSS_KURZ) t = t.replace(re, kurz);
  return t.replace(/\s+/g, " ").trim();
}

/**
 * Label of a plan in the picker: "AR-101 Grundriss EG" (index appended when set).
 * @param {PlanZeile} p
 * @returns {string}
 */
export function planWahlText(p) {
  const nummer = [p?.gewerk, p?.nr].filter((x) => x !== undefined && x !== null && String(x) !== "").join("-");
  const idx = p?.index ? ` (${p.index})` : "";
  return `${nummer} ${p?.titel || ""}`.trim() + idx;
}

/**
 * The plan whose title matches the sheet title: exact (normalised) first, then a title that contains the sheet title as whole
 * words. Ambiguous containment (two candidates) gives null — the user picks, a wrong sheet on a plan is worse than no default.
 * @param {PlanZeile[]} plaene
 * @param {string} planinhalt e.g. "Grundriss EG", "Schnitt A-A"
 * @returns {PlanZeile|null}
 */
export function passenderPlan(plaene, planinhalt) {
  const ziel = titelNorm(planinhalt);
  if (!ziel || !Array.isArray(plaene)) return null;
  const genau = plaene.filter((p) => titelNorm(p.titel) === ziel);
  if (genau.length === 1) return genau[0];
  if (genau.length > 1) return null;
  const enthalten = plaene.filter((p) => ` ${titelNorm(p.titel)} `.includes(` ${ziel} `));
  return enthalten.length === 1 ? enthalten[0] : null;
}

/**
 * File name of a plan sheet: "<projekt>_<planinhalt>_1-<massstab>.pdf" (same formula as the studio download).
 * @param {string} projekt project name (may be empty)
 * @param {string} planinhalt sheet title
 * @param {number} massstab scale denominator (1:n)
 * @returns {string}
 */
export function planPdfDateiname(projekt, planinhalt, massstab) {
  return `${(projekt || "plan").replace(/[^\w-]+/g, "_")}_${String(planinhalt || "").replace(/[^\w-]+/g, "_")}_1-${massstab}.pdf`;
}

/**
 * PDF bytes as a data URL, the form dokumentAblegen stores (chunked, so a large sheet does not overflow the call stack).
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function pdfDataUrl(bytes) {
  let bin = "";
  const STUECK = 0x8000;
  for (let i = 0; i < bytes.length; i += STUECK) bin += String.fromCharCode.apply(null, /** @type {any} */ (bytes.subarray(i, i + STUECK)));
  return `data:application/pdf;base64,${btoa(bin)}`;
}
