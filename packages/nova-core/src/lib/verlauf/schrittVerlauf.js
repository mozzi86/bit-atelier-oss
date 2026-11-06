// 106-10 (part of 102-01 "Verlaufsbaum als gemeinsamer Kern"): the ORDERED LIST of confirmed steps of a project - the
// straight trunk of the later history tree, without branches, stars or names (those stay with 102-01).
// One node = one confirmed change with its state (vorher/nachher), its key data (kind, target, sentence, check result),
// its time and its author, plus the origin of guard rail 2 (hand/text/sprache/agent/bild, since D-IM-07 the ordered list
// `herkunft_quellen`). It is built from the origin record a viewer keeps when a person confirmed a proposal
// (@core/lib/zeigen/aenderungen.js herkunftEintrag, 106-03; IFC journal and element mark carry the same fields).
//
// The list is stored as entity AenderungsSchritt (one record per step, additive, nothing renamed) so it survives a reload
// and can be reviewed from another page or device (106-10 Modellfreigabe). This module is pure: no React, no I/O.
//
// In:  origin records (herkunftEintrag), the check result of the proposal, project, author, time.
// Out: step records, the list in order, the later active steps of one step (what blocks reversing it on its own).
import { herkunftQuellen } from "../zeigen/aenderungen.js";
import { SCHRITT_ENTITY } from "./entitaeten.js";

/** Entity name of a stored step (one record per confirmed change; additive, read by 106-10 and 106-11). */
export { SCHRITT_ENTITY };

/** Most check sentences kept per step (the full result lives in the viewer while the proposal is open) [ASSUMED: the first lines carry the verdict]. */
export const PRUEF_SAETZE_MAX = 8;

/**
 * Short, storable form of a check result: level and the first sentences, nothing else (no geometry, no images).
 * @param {any} pruefung  Check result of 106-03 ({stufe, saetze, zeilen?, befunde?}) or null.
 * @returns {{stufe: string, saetze: string[]}|null}  null = no check ran (shown as "nicht geprüft", never as a pass).
 */
export function pruefungKurz(pruefung) {
  if (!pruefung || typeof pruefung !== "object") return null;
  const saetze = Array.isArray(pruefung.saetze) ? pruefung.saetze.map(String).slice(0, PRUEF_SAETZE_MAX) : [];
  return { stufe: String(pruefung.stufe ?? "ok"), saetze };
}

/**
 * Builds the stored record of ONE confirmed step from the viewer's origin record.
 * @param {ReturnType<typeof import("../zeigen/aenderungen.js").herkunftEintrag>} eintrag  Origin record of the executed step (vorschlagAusfuehren).
 * @param {{projektId: string|number, quelle?: "bim"|"ifc", modell?: string|null, pruefung?: any, autor?: string|null, geraet?: string|null}} opt
 *   projektId: project of the step (mandatory: a step without project would never be listed again); quelle: drawn element (bim) or
 *   IFC journal (ifc), default from the target; modell: file name of the IFC model (ifc only); pruefung: check result the person saw
 *   when confirming; autor: name of the person who confirmed (the signed-in user), null = unknown; geraet: optional device name.
 * @returns {Record<string, any>}  Fields: project_id, quelle, modell, vorschlag_id, art, ziel, params, satz, herkunft, herkunft_quellen,
 *   befehl_text, vorher, nachher, journal_zeit?, marke_vorher?, pruefung, bestaetigt_durch, autor, geraet, zeit, zurueckgenommen (null),
 *   freigabe (null). `zeit` is when the step ran (ISO); review fields start empty.
 * @throws {Error} German text when the record or the project is missing.
 */
export function schrittAusEintrag(eintrag, opt) {
  if (!eintrag?.vorschlag_id || !eintrag.herkunft) throw new Error("Schritt: Herkunftseintrag ohne Vorschlag-Id oder Herkunft");
  if (opt?.projektId == null || opt.projektId === "") throw new Error("Schritt: kein Projekt — ohne Projekt wird der Schritt nicht abgelegt");
  const quelle = opt.quelle ?? (eintrag.ziel?.quelle === "ifc" ? "ifc" : "bim");
  return {
    project_id: String(opt.projektId),
    quelle,
    modell: quelle === "ifc" ? String(opt.modell ?? eintrag.ziel?.modell ?? "") : null,
    vorschlag_id: String(eintrag.vorschlag_id),
    art: eintrag.art,
    ziel: eintrag.ziel ?? null,
    params: eintrag.params ?? {},
    satz: eintrag.satz ?? "",
    herkunft: eintrag.herkunft,
    herkunft_quellen: herkunftQuellen(eintrag),
    befehl_text: eintrag.befehl_text ?? null,
    vorher: eintrag.vorher ?? null,
    nachher: eintrag.nachher ?? null,
    ...(eintrag.journal_zeit ? { journal_zeit: eintrag.journal_zeit } : {}),
    ...("marke_vorher" in eintrag ? { marke_vorher: eintrag.marke_vorher ?? null } : {}),
    pruefung: pruefungKurz(opt.pruefung),
    bestaetigt_durch: eintrag.bestaetigt_durch ?? null,
    autor: opt.autor ? String(opt.autor) : null,
    geraet: opt.geraet ? String(opt.geraet) : null,
    zeit: eintrag.zeit,
    zurueckgenommen: null,
    freigabe: null,
  };
}

/**
 * Comparison key of a step for the order: the time it ran, then the record's creation time, then the proposal id (stable).
 * @param {any} s @returns {string}
 */
const ordnung = (s) => `${String(s?.zeit ?? "")}|${String(s?.created_date ?? "")}|${String(s?.vorschlag_id ?? "")}`;

/**
 * The steps in the order they ran (oldest first); a new array, the input stays as it is.
 * @param {ReadonlyArray<any>} schritte @returns {any[]}
 */
export function schritteOrdnen(schritte) {
  return [...(schritte || [])].sort((a, b) => ordnung(a).localeCompare(ordnung(b)));
}

/**
 * A step still counts in the model: it has not been reversed (in the viewer or in the review workplace).
 * @param {any} s @returns {boolean}
 */
export function schrittAktiv(s) {
  return !!s && !s.zurueckgenommen;
}

/**
 * The active steps that ran AFTER this one in the same project - what reversing this step on its own has to respect
 * (aenderungen.js aenderungUmkehren `spaetere`: a later split of the same element blocks).
 * @param {ReadonlyArray<any>} schritte  All steps of the project (any order). @param {any} schritt  The step to reverse.
 * @returns {any[]}  In order, oldest first.
 */
export function spaetereAktive(schritte, schritt) {
  const k = ordnung(schritt);
  return schritteOrdnen(schritte).filter((s) => s !== schritt && s.vorschlag_id !== schritt.vorschlag_id && schrittAktiv(s)
    && String(s.project_id ?? "") === String(schritt.project_id ?? "") && ordnung(s).localeCompare(k) > 0);
}
