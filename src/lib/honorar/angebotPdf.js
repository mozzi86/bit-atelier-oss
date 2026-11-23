// PDF of a fee offer (phase 81-03, HON-02): the breakdown of aufstellung() as a
// DIN 5008 letter through 79-03's letter core — builder HONORAR_BRIEFE.honorarangebot
// (@core/lib/brief/vorlagen.js), briefLayout() with page numbers and an amount
// table in columns, erzeugeBriefPdf() with fixed date/id for a reproducible hash.
//
// Phase 115 (user finding 15.11.2026): the builder is taken in the template VERSION of
// the offer (honorarBriefVersion) — a draft gets the current one (amount table before
// closing text and greeting), an offer that was already sent keeps the version it was
// sent with (stamp `vorlage_version`; without a stamp version 1, table after the greeting).
//
// Every text runs through ersetzeNichtWinAnsi(…, {umschrift:true}) FIRST: a
// client name like "Şahin" becomes "Sahin" with a message instead of the "?"
// briefLayout() would put in (pitfall 13). The sender comes from the office
// letterhead (@core/lib/briefkopf.js briefkopfZeilen, which normalises itself —
// one module since wave 1, B-81-05). An offer without an amount (missing table without a flat fee,
// or outside the table) gets no PDF.
//
// In:  the offer, its project, the letterhead, today, optional `fixiert` and the
//      test injection `optionen`. Out: {bytes, ersetzt, zeichen, layout}.

import { briefLayout } from "@core/lib/brief/briefLayout.js";
import { erzeugeBriefPdf, fixiertFuerVersion } from "@core/lib/brief/briefPdf.js";
import { honorarBriefBauer, honorarBriefVersion } from "@core/lib/brief/vorlagen.js";
import { HONORAR_BRIEF_VERSION_MIT_SPRACHE } from "@core/lib/brief/vorlagenVersion.js";
import { ersetzeNichtWinAnsi } from "@core/lib/brief/winAnsi.js";
import { datumText } from "@core/lib/kalender/datum.js";
import { leistungsbildInfo } from "@core/lib/hoai/leistungsbilder.js";
import { briefkopfZeilen } from "@core/lib/briefkopfBrief.js";
import { aufstellung, euroText } from "./aufstellung.js";

/** Lines the letter template appends itself (net, VAT, gross). */
const SUMMEN_ARTEN = new Set(["netto", "ust", "brutto"]);

/**
 * The letter input of an offer (before WinAnsi cleaning).
 * @param {Record<string, any>} angebot
 * @param {{projekt?: Record<string, any>|null, briefkopf?: any, heuteIso: string, optionen?: {weitere?: ReadonlyArray<any>}}} kontext
 * @returns {{absender: string[], empfaenger: string[], datum: string, betreff: string, absaetze: string[], tabelle: any, schluss?: string[]}}
 *   schluss: the paragraphs after the amount table (template version 2 and later)
 * @throws {Error} "Tafel fehlt …" / "frei vereinbar …" when the offer has no amount; a template version this build does not know
 */
export function angebotBriefEingabe(angebot, { projekt = null, briefkopf = null, heuteIso, optionen = {} }) {
  const a = aufstellung(angebot, optionen);
  const info = leistungsbildInfo(angebot.leistungsbild, optionen);
  if (a.tafelFehlt) throw new Error(`Tafel fehlt — HOAI § ${info?.tafelParagraf ?? ""} noch nicht amtlich übertragen. Ohne Pauschale gibt es kein PDF.`);
  if (a.summen.netto === null) throw new Error("Außerhalb der Honorartafel: frei vereinbar (§ 7 Abs. 2 HOAI) — bitte eine Pauschale eintragen.");
  const zeilen = a.zeilen
    .filter((z) => !SUMMEN_ARTEN.has(z.art) && z.art !== "kosten" && z.art !== "tafel" && z.betrag_eur !== null)
    .map((z) => (z.art === "lph"
      ? { bezeichnung: `LPH ${z.werte.nr} ${z.werte.bezeichnung}`, prozent: `${String(z.werte.prozent).replace(".", ",")} %`, betrag: euroText(/** @type {number} */ (z.betrag_eur)) }
      : { bezeichnung: z.text, prozent: "", betrag: euroText(/** @type {number} */ (z.betrag_eur)) }));
  const brief = honorarBriefBauer("honorarangebot", honorarBriefVersion("honorarangebot", angebot))({
    nummer: angebot.nummer, fassung: Number(angebot.fassung) || 1,
    datum: datumText(angebot.datum || heuteIso), gueltigBis: datumText(angebot.gueltig_bis || heuteIso),
    projektName: projekt?.name || "",
    leistungsbild: info?.label || angebot.leistungsbild, lphParagraf: info?.lphParagraf ?? "", fassungHoai: info?.tafel?.fassung || "HOAI 2021",
    zeilen, netto: euroText(/** @type {number} */ (a.summen.netto)), ust: euroText(/** @type {number} */ (a.summen.ust)), brutto: euroText(/** @type {number} */ (a.summen.brutto)),
    ustProzent: typeof angebot.ust_satz === "number" ? angebot.ust_satz : 19,
    zahlungszielTage: Number(angebot.zahlungsziel_tage) || 14, zahlungszielVertraglich: angebot.zahlungsziel_vertraglich !== false,
    vorbemerkung: angebot.textbausteine?.vorbemerkung || "", annahmen: angebot.textbausteine?.annahmen || "", ausschluesse: angebot.textbausteine?.ausschluesse || "",
    umbauOhneTextform: Number(angebot.umbauzuschlag_prozent) > 0 && !angebot.textform_am,
    // The review line belongs to a DRAFT only — a letter sent to the client must not carry an internal note.
    gegenlesen: (angebot.status || "entwurf") === "entwurf",
  });
  const empfaenger = [angebot.bauherr_name, ...String(angebot.bauherr_anschrift || "").split(/\n|,\s*/)].map((z) => String(z || "").trim()).filter(Boolean);
  return {
    absender: briefkopfZeilen(briefkopf),
    empfaenger,
    datum: datumText(angebot.datum || heuteIso),
    ...brief,
  };
}

/**
 * The PDF of an offer.
 * @param {Record<string, any>} angebot
 * @param {{projekt?: Record<string, any>|null, briefkopf?: any, heuteIso: string, fixiert?: {erstelltAm: string, dateiId: string}|null, optionen?: {weitere?: ReadonlyArray<any>}}} kontext
 * @returns {Promise<{bytes: Uint8Array, ersetzt: number, zeichen: string[], layout: ReturnType<typeof briefLayout>}>}
 *   ersetzt/zeichen: characters outside WinAnsi that were transliterated or replaced
 * @throws {Error} plain text when the offer has no amount
 */
export async function angebotPdf(angebot, { fixiert = null, ...kontext }) {
  // 105-19 follow-up: /Lang only from template version 3 on — an offer sent with version 1 or 2 keeps its bytes.
  const mitSprache = honorarBriefVersion("honorarangebot", angebot) >= HONORAR_BRIEF_VERSION_MIT_SPRACHE;
  return briefPdfAusEingabe(angebotBriefEingabe(angebot, kontext), fixiertFuerVersion(fixiert, mitSprache));
}

/**
 * A letter input (absender, empfaenger, datum, betreff, absaetze, tabelle, schluss) as PDF:
 * every text transliterated first (umschrift), then 79-03's briefLayout with page
 * numbers and erzeugeBriefPdf. Shared by the offer, the order confirmation and
 * the fee amendment (81-04). `schluss` (115) is handed on only when the input has it,
 * so an input of template version 1 gives the bytes it gave before.
 * @param {{absender: string[], empfaenger: string[], datum: string, betreff: string, absaetze: string[], tabelle: any, schluss?: string[]}} eingabe
 * @param {{erstelltAm: string, dateiId: string, sprache?: string}|null} [fixiert] see erzeugeBriefPdf (`sprache` only for
 *   a letter whose template version carries /Lang — fixiertFuerVersion)
 * @returns {Promise<{bytes: Uint8Array, ersetzt: number, zeichen: string[], layout: ReturnType<typeof briefLayout>}>}
 */
export async function briefPdfAusEingabe(eingabe, fixiert = null) {
  let ersetzt = 0;
  /** @type {string[]} */
  const zeichen = [];
  const um = (/** @type {string} */ text) => {
    const r = ersetzeNichtWinAnsi(text, { umschrift: true });
    ersetzt += r.ersetzt;
    for (const z of r.zeichen || []) if (!zeichen.includes(z)) zeichen.push(z);
    return r.text;
  };
  const layout = briefLayout({
    absender: eingabe.absender.map(um), empfaenger: eingabe.empfaenger.map(um), datum: um(eingabe.datum), betreff: um(eingabe.betreff),
    absaetze: eingabe.absaetze.map(um),
    tabelle: { ...eingabe.tabelle, kopf: eingabe.tabelle.kopf.map(um), zeilen: eingabe.tabelle.zeilen.map((/** @type {string[]} */ z) => z.map(um)) },
    ...(Array.isArray(eingabe.schluss) && eingabe.schluss.length ? { schluss: eingabe.schluss.map(um) } : {}),
    seitenzahlen: true,
  });
  const bytes = await erzeugeBriefPdf(layout, { fixiert });
  return { bytes, ersetzt, zeichen, layout };
}

/**
 * SHA-256 of bytes as hex (Web Crypto, browser and node ≥ 19).
 * @param {Uint8Array} bytes
 * @returns {Promise<string>}
 */
export async function sha256Hex(bytes) {
  const hash = await globalThis.crypto.subtle.digest("SHA-256", /** @type {any} */ (bytes));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Bytes as a data URL (the Document.data convention, Reports.jsx).
 * @param {Uint8Array} bytes
 * @param {string} [mime]
 * @returns {string}
 */
export function alsDataUrl(bytes, mime = "application/pdf") {
  let binaer = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binaer += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(binaer)}`;
}
