// Mail register (Postbuch) of the office (phase 82, 82-05, D-P82-31): numbers
// PE-{jahr}-{nr4} (incoming) and PA-{jahr}-{nr4} (outgoing) from the shared
// number range of 79-01 — derived from the existing numbers, no stored counter;
// the outgoing entry of a sent letter; the reply deadlines as terms for
// "Fristen & Termine" (source postbuch).
//
// Pure; storing goes through the office store (bueroEntitaet, 82-01, E-03).
//
// In:  register entries, letters. Out: NUMMERN_FORMAT, naechsteNummer,
//      nummerSichern, eintragAusSchreiben, bezugErledigen, fristenAusPostbuch.

import { naechsteNummer as nummerAusKreis } from "../nummernkreis.js";

/** Number formats per direction (79-01 placeholders). */
export const NUMMERN_FORMAT = Object.freeze({ eingang: "PE-{jahr}-{nr4}", ausgang: "PA-{jahr}-{nr4}" });

/**
 * Next free register number of a direction in a year.
 * @param {ReadonlyArray<Record<string, any>>} eintraege existing register entries
 * @param {'eingang'|'ausgang'} richtung
 * @param {number|string} jahr year (number) or a date 'YYYY-MM-DD'
 * @returns {string} e.g. 'PA-2026-0002'
 */
export function naechsteNummer(eintraege, richtung, jahr) {
  const datum = typeof jahr === "number" ? `${jahr}-01-01` : String(jahr);
  const vorhandene = (eintraege || []).filter((e) => e?.richtung === richtung).map((e) => e.nummer);
  return nummerAusKreis(NUMMERN_FORMAT[richtung], vorhandene, datum);
}

/**
 * Keeps the number of a new entry unique: when another device took it in the
 * meantime, the next free number is given and the caller tells the user.
 * @param {Record<string, any>} eintrag entry to be saved (with nummer, richtung, datum)
 * @param {ReadonlyArray<Record<string, any>>} vorhandene entries stored now (freshly loaded)
 * @returns {{eintrag: Record<string, any>, hinweis: 'nummer_neu_vergeben'|null}}
 */
export function nummerSichern(eintrag, vorhandene) {
  const belegt = (vorhandene || []).some((e) => e && e.id !== eintrag.id && e.nummer === eintrag.nummer);
  if (!belegt) return { eintrag, hinweis: null };
  return { eintrag: { ...eintrag, nummer: naechsteNummer(vorhandene, eintrag.richtung, eintrag.datum) }, hinweis: "nummer_neu_vergeben" };
}

/**
 * Outgoing register entry of a sent letter.
 * @param {Record<string, any>} schreiben letter in state 'versendet'
 * @param {ReadonlyArray<Record<string, any>>} vorhandene existing register entries (for the number)
 * @returns {Record<string, any>} new Postbucheintrag without id
 * @throws {Error} when the letter is not sent
 */
export function eintragAusSchreiben(schreiben, vorhandene) {
  if (schreiben?.status !== "versendet") throw new Error("Nur ein versendetes Schreiben kommt ins Postbuch");
  const datum = String(schreiben.versendet_am || "").slice(0, 10);
  const e = schreiben.empfaenger || {};
  return {
    richtung: "ausgang",
    nummer: naechsteNummer(vorhandene, "ausgang", datum),
    datum,
    partner_contact_id: e.contact_id || null,
    partner_name: e.firma || e.name || "",
    project_id: schreiben.project_id || null,
    betreff: schreiben.betreff || "",
    kanal: schreiben.versandweg || "brief",
    ihr_zeichen: schreiben.ihr_zeichen || "",
    unser_zeichen: schreiben.unser_zeichen || "",
    document_id: schreiben.document_id || null,
    schreiben_id: schreiben.id || null,
    frist: null,
    erledigt_am: null,
    zustaendig: null,
    bereich: schreiben.bereich || "projekt",
    notiz: "",
  };
}

/**
 * The incoming entry a sent reply settles: its `erledigt_am` becomes the sending date.
 * @param {ReadonlyArray<Record<string, any>>} eintraege
 * @param {Record<string, any>} schreiben sent letter with bezug {typ:'postbuch', id}
 * @returns {Record<string, any>|null} the changed entry, or null when nothing is to settle
 */
export function bezugErledigen(eintraege, schreiben) {
  if (schreiben?.status !== "versendet" || schreiben?.bezug?.typ !== "postbuch") return null;
  const pb = (eintraege || []).find((e) => e?.id === schreiben.bezug.id);
  if (!pb || pb.erledigt_am) return null;
  return { ...pb, erledigt_am: String(schreiben.versendet_am || "").slice(0, 10) || null };
}

/**
 * Reply deadlines of open incoming mail as terms (source "postbuch" of 82-03's registry).
 * @param {ReadonlyArray<Record<string, any>>} eintraege
 * @returns {import("../kalender/termin.js").Termin[]}
 */
export function fristenAusPostbuch(eintraege) {
  return (eintraege || [])
    .filter((e) => e && e.richtung === "eingang" && /^\d{4}-\d{2}-\d{2}$/.test(String(e.frist || "")) && !e.erledigt_am)
    .map((e) => ({
      id: `postbuch:${e.id}:antwort`,
      quelle: "postbuch",
      art: "postbuch_antwort",
      klasse: /** @type {'frist'} */ ("frist"),
      datum: e.frist,
      bis: null,
      zeit: null,
      dauer_min: null,
      project_id: e.project_id || null,
      modul: "schriftverkehr",
      objekt: String(e.nummer || ""),
      ziel: "/Correspondence?tab=register",
      datensatz_id: e.id,
    }));
}
