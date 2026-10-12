// PDFs of the architect's contract (phase 81-04, HON-04/05): the order
// confirmation and the fee amendment letter, through 79-03's letter core with
// 81-03's options (page numbers, columns, fixed hash, transliteration) and the
// builders HONORAR_BRIEFE.auftragsbestaetigung / .honorarnachtrag.
//
// The confirmation names the payment term WITH its source (E-12): the contract's
// own value ("laut Architektenvertrag"), otherwise 79's chain — client map ("je
// Bauherr") or office standard. A consumer client gets the hint on § 650r BGB
// (special termination right) — a hint only, wording [ASSUMED] for the lawyer's
// checklist (78-09), no legal advice.
//
// In:  contract, offer, amendment, project, letterhead, 79 settings, today,
//      optional `fixiert`. Out: {bytes, ersetzt, zeichen, layout}.

import { briefkopfZeilen } from "@core/lib/brief/briefkopf.js";
import { HONORAR_BRIEFE } from "@core/lib/brief/vorlagen.js";
import { normalisiereBriefkopf } from "@core/lib/briefkopf.js";
import { datumText } from "@core/lib/kalender/datum.js";
import { leistungsbildInfo } from "@core/lib/hoai/leistungsbilder.js";
import { bauherrSchluessel, zahlungszielTage } from "@/lib/accounting/grundlagen.js";
import { aufstellung, euroText } from "./aufstellung.js";
import { briefPdfAusEingabe } from "./angebotPdf.js";
import { NACHTRAG_GRUENDE } from "./honorarNachtrag.js";

/**
 * Payment term of a contract and where it comes from (E-12).
 * @param {Record<string, any>} vertrag
 * @param {{einst?: Record<string, any>|null, projekt?: Record<string, any>|null}} kontext
 * @returns {{tage: number, quelle: string}} quelle: German document text
 */
export function zahlungszielMitQuelle(vertrag, { einst = null, projekt = null } = {}) {
  if (typeof vertrag?.zahlungsziel_tage === "number") return { tage: vertrag.zahlungsziel_tage, quelle: "laut Architektenvertrag" };
  const schluessel = bauherrSchluessel(vertrag, projekt);
  const tage = zahlungszielTage({ vertrag: null, einst, bauherrSchluessel: schluessel });
  const jeBauherr = schluessel && einst?.zahlungsziel_je_bauherr && Object.prototype.hasOwnProperty.call(einst.zahlungsziel_je_bauherr, schluessel);
  return { tage, quelle: jeBauherr ? "vereinbart je Bauherr" : "Bürostandard" };
}

/**
 * Recipient lines from the flat client fields.
 * @param {Record<string, any>} v contract or offer
 * @returns {string[]}
 */
function empfaengerZeilen(v) {
  return [v.bauherr_name, ...String(v.bauherr_anschrift || "").split(/\n|,\s*/)].map((z) => String(z || "").trim()).filter(Boolean);
}

/**
 * Letter input of the order confirmation.
 * @param {Record<string, any>} vertrag
 * @param {{angebot?: Record<string, any>|null, projekt?: Record<string, any>|null, briefkopf?: any, einst?: Record<string, any>|null, heuteIso: string, gegenlesen?: boolean, optionen?: {weitere?: ReadonlyArray<any>}}} kontext
 * @returns {{absender: string[], empfaenger: string[], datum: string, betreff: string, absaetze: string[], tabelle: any}}
 * @throws {Error} plain text when the contract has no amount
 */
export function bestaetigungEingabe(vertrag, { angebot = null, projekt = null, briefkopf = null, einst = null, heuteIso, gegenlesen = false, optionen = {} }) {
  const a = aufstellung(vertrag, optionen);
  if (a.summen.netto === null) throw new Error("Der Architektenvertrag hat keinen Betrag (Tafel fehlt bzw. frei vereinbar) — bitte eine Pauschale eintragen.");
  const info = leistungsbildInfo(vertrag.leistungsbild, optionen);
  const ziel = zahlungszielMitQuelle(vertrag, { einst, projekt });
  const stufen = (Array.isArray(vertrag.stufen) ? vertrag.stufen : [])
    .filter((s) => s?.beauftragt_am)
    .map((s) => `Stufe ${s.nr}: LPH ${(s.lph || []).join(", ")} (beauftragt am ${datumText(s.beauftragt_am)})`);
  const zeilen = a.zeilen
    .filter((z) => !["netto", "ust", "brutto", "kosten", "tafel"].includes(z.art) && z.betrag_eur !== null)
    .map((z) => (z.art === "lph"
      ? { bezeichnung: `LPH ${z.werte.nr} ${z.werte.bezeichnung}`, prozent: `${String(z.werte.prozent).replace(".", ",")} %`, betrag: euroText(/** @type {number} */ (z.betrag_eur)) }
      : { bezeichnung: z.text, prozent: "", betrag: euroText(/** @type {number} */ (z.betrag_eur)) }));
  const h = vertrag.haftung || null;
  const haftung = h ? [
    h.versicherer ? `Berufshaftpflicht bei ${h.versicherer}` : "",
    typeof h.deckung_personen_eur === "number" ? `Deckung Personenschäden ${euroText(h.deckung_personen_eur)}` : "",
    typeof h.deckung_sach_eur === "number" ? `Deckung Sach- und Vermögensschäden ${euroText(h.deckung_sach_eur)}` : "",
    h.haftungsbegrenzung_text || "",
  ].filter(Boolean) : [];
  const brief = HONORAR_BRIEFE.auftragsbestaetigung.bauen({
    nummer: vertrag.nummer || "", angebotNummer: angebot?.nummer, projektName: projekt?.name || "",
    vertragsdatum: datumText(vertrag.vertragsdatum || heuteIso),
    leistungsbild: info?.label || vertrag.leistungsbild, lphParagraf: info?.lphParagraf ?? "", fassungHoai: info?.tafel?.fassung || "HOAI 2021",
    stufen, zeilen,
    netto: euroText(/** @type {number} */ (a.summen.netto)), ust: euroText(/** @type {number} */ (a.summen.ust)), brutto: euroText(/** @type {number} */ (a.summen.brutto)),
    ustProzent: typeof vertrag.ust_satz === "number" ? vertrag.ust_satz : 19,
    zahlungszielTage: ziel.tage, zahlungszielQuelle: ziel.quelle, zahlungszielVertraglich: vertrag.zahlungsziel_vertraglich === true,
    termine: (Array.isArray(vertrag.termine) ? vertrag.termine : []).filter((t) => t?.datum).map((t) => `${t.titel} bis ${datumText(t.datum)}`),
    haftung, verbraucher: vertrag.bauherr_art === "verbraucher", gegenlesen,
  });
  return { absender: briefkopfZeilen(normalisiereBriefkopf(briefkopf)), empfaenger: empfaengerZeilen(vertrag), datum: datumText(heuteIso), ...brief };
}

/**
 * PDF of the order confirmation.
 * @param {Record<string, any>} vertrag
 * @param {Parameters<typeof bestaetigungEingabe>[1] & {fixiert?: {erstelltAm: string, dateiId: string}|null}} kontext
 * @returns {ReturnType<typeof briefPdfAusEingabe>}
 */
export async function auftragsbestaetigungPdf(vertrag, { fixiert = null, ...kontext }) {
  return briefPdfAusEingabe(bestaetigungEingabe(vertrag, kontext), fixiert);
}

/**
 * Letter input of a fee amendment.
 * @param {Record<string, any>} nachtrag
 * @param {Record<string, any>} vertrag
 * @param {{projekt?: Record<string, any>|null, briefkopf?: any, heuteIso: string, gegenlesen?: boolean}} kontext
 * @returns {{absender: string[], empfaenger: string[], datum: string, betreff: string, absaetze: string[], tabelle: any}}
 */
export function nachtragEingabe(nachtrag, vertrag, { projekt = null, briefkopf = null, heuteIso, gegenlesen = false }) {
  const grund = /** @type {any} */ (NACHTRAG_GRUENDE)[nachtrag.grund] || NACHTRAG_GRUENDE.leistungsaenderung;
  const b = nachtrag.berechnung || {};
  const berechnung = b.art === "stunden"
    ? `${String(b.stunden ?? 0).replace(".", ",")} Stunden × ${euroText(Number(b.satz_eur_h) || 0)}`
    : b.art === "wiederholung" ? `${b.wiederholung_prozent ?? 0} % der Grundleistungen der LPH ${b.lph ?? nachtrag.lph ?? ""}` : "pauschal";
  const brief = HONORAR_BRIEFE.honorarnachtrag.bauen({
    nr: nachtrag.nr, titel: nachtrag.titel || "", vertragNummer: vertrag.nummer || "", projektName: projekt?.name || "",
    grund: grund.label, grundQuelle: grund.quelle, lph: nachtrag.lph ? `LPH ${nachtrag.lph}` : "",
    berechnung, betrag: euroText(Number(nachtrag.betrag_euro) || 0),
    nebenkostenProzent: typeof vertrag.nebenkosten_prozent === "number" ? vertrag.nebenkosten_prozent : 5, gegenlesen,
  });
  return { absender: briefkopfZeilen(normalisiereBriefkopf(briefkopf)), empfaenger: empfaengerZeilen(vertrag), datum: datumText(heuteIso), ...brief };
}

/**
 * PDF of a fee amendment letter.
 * @param {Record<string, any>} nachtrag
 * @param {Record<string, any>} vertrag
 * @param {Parameters<typeof nachtragEingabe>[2] & {fixiert?: {erstelltAm: string, dateiId: string}|null}} kontext
 * @returns {ReturnType<typeof briefPdfAusEingabe>}
 */
export async function honorarnachtragPdf(nachtrag, vertrag, { fixiert = null, ...kontext }) {
  return briefPdfAusEingabe(nachtragEingabe(nachtrag, vertrag, kontext), fixiert);
}
