// Lifecycle of a fee offer (Honorarangebot, phase 81-03, HON-01/02): a new
// draft with the office defaults, new versions, sending (totals frozen, open
// versions replaced), immutability from "versendet" on, the displayed status
// "abgelaufen" and the deadlines for phase 82.
//
// Honorarangebot (bitApi.entities, through src/lib/zeitHonorar/speicher.js):
// own fields project_id, nummer ('HA-{jahr}-{nr3}'), fassung, ersetzt_id,
// status (ANGEBOT_STATUS), datum, gueltig_bis, versendet_am, honorarvertrag_id,
// dokument_id, textbausteine {vorbemerkung, annahmen, ausschluesse},
// besondere_leistungen[{titel, art 'pauschal'|'stunden', betrag_euro, stunden,
// satz_eur_h}], summen — plus ALL flat fields of 79's Honorarvertrag with the
// same names (D-P81-05), so honorarVertrag() computes offer and contract alike.
//
// "abgelaufen" is shown, never written silently (a stored status changes only
// through an action of the user).
//
// In:  offers, a project, the rule reader wert(id), the effective accounting
//      settings (79 wirksameEinstellungen). Out: plain records / {ok, …} results.

import { lphFuerLeistungsbild } from "@core/lib/hoai/honorar.js";
import { leistungsbildInfo } from "@core/lib/hoai/leistungsbilder.js";
import { istBestand } from "@core/lib/bauart.js";
import { plusTage, tageZwischen } from "@core/lib/kalender/datum.js";
import { naechsteNummer } from "@core/lib/nummernkreis.js";
import { bauherrSchluessel, zahlungszielTage } from "@/lib/accounting/grundlagen.js";
import { aufstellung } from "./aufstellung.js";
import { ANGEBOT_STATUS, statusErlaubt } from "./vertragsdaten.js";

/** The flat fields of 79's Honorarvertrag an offer carries 1:1 (D-P81-05). */
export const VERTRAGSFELDER = Object.freeze([
  "leistungsbild", "bauherr_contact_id", "bauherr_name", "bauherr_anschrift", "bauherr_ust_idnr", "bauherr_art",
  "zahlungsziel_tage", "zahlungsziel_vertraglich", "anrechenbare_quelle", "kg300_euro", "kg400_euro", "sonstige_euro",
  "bezugswert", "mvb_euro", "mvb_grundlage", "honorarzone", "satz_position_prozent", "lph", "umbauzuschlag_prozent",
  "nebenkosten_prozent", "pauschal_euro", "ust_satz", "textform_am",
  // 96-03: the frozen LV snapshot travels from the offer into the contract (null = none).
  "kosten_eingefroren_am", "kosten_eingefroren",
]);

/**
 * A new draft offer for a project with the office defaults:
 * number from zeit_honorar.nummer_angebot, validity zeit_honorar.angebot_gueltigkeit,
 * incidental costs and VAT from buchhaltung.* (79, E-16), payment term through
 * 79's chain (client > office standard > 14, E-12) and `zahlungsziel_vertraglich:
 * true` [ASSUMED: the term is part of the contract — default from the day after
 * the due date, § 286 Abs. 2 Nr. 1 BGB]. Building is the default profile; its
 * stages come from lphFuerLeistungsbild (H-2 fix). A project cost estimate is
 * taken as KG 300 proposal (to be checked); a renovation proposes a 20 %
 * conversion surcharge (without text form) when the table has a maximum.
 * @param {Record<string, any>} projekt Project record
 * @param {(id: string) => any} wert rule reader (useRegelWerte(REGELWERKE).wert)
 * @param {ReadonlyArray<Record<string, any>>} vorhandene all offers (for the number)
 * @param {{heuteIso: string, vorschlag?: Record<string, any>, einstBuchhaltung?: Record<string, any>|null}} kontext
 * @returns {Record<string, any>} draft without id
 */
export function neuesAngebot(projekt, wert, vorhandene, { heuteIso, vorschlag = {}, einstBuchhaltung = null }) {
  const muster = wert("zeit_honorar.nummer_angebot") || "HA-{jahr}-{nr3}";
  const gueltig = Number(wert("zeit_honorar.angebot_gueltigkeit")) || 30;
  const nk = wert("buchhaltung.nebenkosten_prozent");
  const ust = wert("buchhaltung.ust_satz");
  const leistungsbild = vorschlag.leistungsbild || "gebaeude";
  const info = leistungsbildInfo(leistungsbild);
  // 73-12: an existing-building project (Bauart "bestand": sanierung/umbau/bestand, 73-01) suggests the
  // conversion surcharge. 20 % is the statutory presumption without a text-form agreement "ab einem
  // durchschnittlichen Schwierigkeitsgrad" (§ 6 Abs. 2 S. 3 HOAI 2021) — i.e. from fee zone III; the
  // offer starts in zone III when the profile has it, otherwise no presumption applies.
  const sanierung = istBestand(projekt) && typeof info?.umbau_max_prozent === "number";
  const startZone = info?.zonen?.includes("III") ? "III" : (info?.zonen?.[0] ?? "III");
  const geschaetzt = Number(projekt?.estimated_cost) > 0 ? Math.round(Number(projekt.estimated_cost)) : null;
  return {
    project_id: projekt?.id ?? null,
    nummer: naechsteNummer(muster, (vorhandene || []).map((a) => a?.nummer).filter(Boolean), heuteIso),
    fassung: 1, ersetzt_id: null, status: "entwurf",
    datum: heuteIso, gueltig_bis: plusTage(heuteIso, gueltig), versendet_am: null,
    honorarvertrag_id: null, dokument_id: null,
    textbausteine: { vorbemerkung: "", annahmen: "", ausschluesse: "" }, besondere_leistungen: [], summen: null,
    leistungsbild,
    bauherr_contact_id: null, bauherr_name: typeof projekt?.client === "string" ? projekt.client : "", bauherr_anschrift: "", bauherr_ust_idnr: "", bauherr_art: "unternehmer",
    zahlungsziel_tage: zahlungszielTage({ vertrag: null, einst: einstBuchhaltung, bauherrSchluessel: bauherrSchluessel(null, projekt) }),
    zahlungsziel_vertraglich: true,
    anrechenbare_quelle: "manuell",
    kg300_euro: info?.kostenregel === "p33" ? geschaetzt : null, kg400_euro: info?.kostenregel === "p33" ? 0 : null, sonstige_euro: info?.kostenregel === "p33" ? 0 : null,
    bezugswert: info?.kostenregel === "p33" ? null : geschaetzt, mvb_euro: null, mvb_grundlage: null,
    honorarzone: startZone,
    satz_position_prozent: 0,
    lph: lphFuerLeistungsbild(leistungsbild),
    umbauzuschlag_prozent: sanierung && ["III", "IV", "V"].includes(startZone) ? 20 : 0,
    nebenkosten_prozent: typeof nk === "number" ? nk : (einstBuchhaltung?.nebenkosten_prozent ?? 5),
    pauschal_euro: null,
    ust_satz: typeof ust === "number" ? ust : (einstBuchhaltung?.ust_satz ?? 19),
    textform_am: null,
    kosten_eingefroren_am: null, kosten_eingefroren: null,
    ...vorschlag,
  };
}

/**
 * Changes a draft. From "versendet" on an offer is immutable — in the code, not
 * only in the UI. A change of the service profile rebuilds `lph` from the new
 * profile (H-2 lesson: never keep the old profile's percentages positionally).
 * @param {Record<string, any>} angebot
 * @param {Record<string, any>} patch
 * @returns {{ok: true, angebot: Record<string, any>} | {ok: false, fehler: 'unveraenderlich'}}
 */
export function aendern(angebot, patch) {
  if ((angebot?.status || "entwurf") !== "entwurf") return { ok: false, fehler: "unveraenderlich" };
  const neu = { ...angebot, ...patch };
  if (patch.leistungsbild && patch.leistungsbild !== angebot.leistungsbild && !patch.lph) neu.lph = lphFuerLeistungsbild(patch.leistungsbild);
  return { ok: true, angebot: neu };
}

/**
 * A new version of an offer: a draft copy with the next version number of the
 * same offer number, linked to its predecessor; the validity keeps its length.
 * @param {Record<string, any>} angebot the version to start from
 * @param {ReadonlyArray<Record<string, any>>} alle all offers
 * @param {{heuteIso: string}} kontext
 * @returns {Record<string, any>} draft without id
 */
export function neueFassung(angebot, alle, { heuteIso }) {
  const gleicheNummer = (alle || []).filter((a) => a?.nummer === angebot.nummer);
  const fassung = Math.max(Number(angebot.fassung) || 1, ...gleicheNummer.map((a) => Number(a.fassung) || 1)) + 1;
  const laenge = tageZwischen(angebot.datum, angebot.gueltig_bis) ?? 30;
  const rest = { ...angebot };
  delete rest.id;
  return {
    ...rest, fassung, ersetzt_id: angebot.id ?? null, status: "entwurf",
    datum: heuteIso, gueltig_bis: plusTage(heuteIso, laenge), versendet_am: null, dokument_id: null, summen: null, honorarvertrag_id: null,
  };
}

/**
 * Sends an offer: freezes the totals of aufstellung(), sets status and date; every
 * other open version of the same number (draft or sent) becomes "ersetzt". An
 * offer without an amount (missing table without a flat fee, or outside the
 * table) cannot be sent.
 * @param {Record<string, any>} angebot
 * @param {ReadonlyArray<Record<string, any>>} alle all offers
 * @param {{heuteIso: string, jetztIso?: string, optionen?: {weitere?: ReadonlyArray<any>}}} kontext
 * @returns {{ok: true, angebot: Record<string, any>, ersetzte: Array<Record<string, any>>} | {ok: false, fehler: 'status'|'tafel_fehlt'|'frei'}}
 */
export function versenden(angebot, alle, { heuteIso, jetztIso, optionen = {} }) {
  if (!statusErlaubt(ANGEBOT_STATUS, angebot?.status || "entwurf", "versendet")) return { ok: false, fehler: "status" };
  const a = aufstellung(angebot, optionen);
  if (a.tafelFehlt) return { ok: false, fehler: "tafel_fehlt" };
  if (a.summen.netto === null) return { ok: false, fehler: "frei" };
  const ersetzte = (alle || [])
    .filter((x) => x && x.id !== angebot.id && x.nummer === angebot.nummer && (x.status === "entwurf" || x.status === "versendet"))
    .map((x) => ({ ...x, status: "ersetzt" }));
  return {
    ok: true,
    angebot: { ...angebot, status: "versendet", versendet_am: jetztIso || `${heuteIso}T00:00:00.000Z`, summen: a.summen },
    ersetzte,
  };
}

/**
 * Status to SHOW: "abgelaufen" for a sent offer past its validity; the stored
 * status stays "versendet".
 * @param {Record<string, any>} angebot
 * @param {string} heuteIso
 * @returns {string}
 */
export function effektiverStatus(angebot, heuteIso) {
  if (angebot?.status === "versendet" && angebot.gueltig_bis && angebot.gueltig_bis < heuteIso) return "abgelaufen";
  return angebot?.status || "entwurf";
}

/**
 * Deadlines of sent offers for the dates overview of phase 82 (raw data, 82 aggregates).
 * @param {ReadonlyArray<Record<string, any>>} angebote
 * @param {string} heuteIso
 * @returns {Array<{quelle: 'honorarangebot', art: 'angebot_laeuft_ab', datum: string, objekt: string, project_id: string|null, ziel: string}>}
 */
export function angebotsFristen(angebote, heuteIso) {
  void heuteIso; // every sent offer, expired ones included — 82 decides what to show
  return (angebote || [])
    .filter((a) => a?.status === "versendet" && a.gueltig_bis)
    .map((a) => ({ quelle: /** @type {const} */ ("honorarangebot"), art: /** @type {const} */ ("angebot_laeuft_ab"), datum: a.gueltig_bis, objekt: a.nummer, project_id: a.project_id ?? null, ziel: "/Fees?tab=offers" }));
}
