// Outgoing invoices of the accounting module (phase 79, BUCH-04): drafting from
// a project, computing amounts, issuing (freezing the GoBD-relevant fields),
// storno, recording payments and building the export table. Every function is
// pure — the caller (RechnungenAbschnitt.jsx, RechnungFormular.jsx) passes the
// data it already has and writes the result through useBuchhaltung.speichere.
//
// In:  Ausgangsrechnung/Honorarvertrag/Project/Contact records, effective
//      settings, a reference date. Out: plain record patches, warning keys and
//      one export table model. No entity access, no clock reads.

import { plusTage } from "@core/lib/kalender/datum.js";
import { normalisiereHoaiPhase } from "@core/lib/labels.js";
import { naechsteNummer } from "@core/lib/nummernkreis.js";
import { lpStand } from "@core/lib/hoai/honorar.js";
import { abschlagsVorlage } from "@core/lib/hoai/abrechnung.js";
import { euroZuCent, centZuEuro, rundeCent, ustCent } from "./geld.js";
import { bauherrSchluessel, faelligAm, rechnungsStatus, zahlungszielTage } from "./grundlagen.js";

/**
 * Recipient of an invoice: from the fee contract's own client fields,
 * otherwise a matching contact ("company" === Project.client), otherwise only
 * the project's free-text client name. A draft never keeps its own copy —
 * the form and stelleRechnung() derive it from the CURRENT project/contract,
 * so a switched project or a later-filled contract is never billed to the
 * previous recipient.
 * @param {{bauherr_name?: string, bauherr_anschrift?: string, bauherr_ust_idnr?: string, bauherr_art?: string}|null|undefined} vertrag
 * @param {ReadonlyArray<{company?: string, name?: string}>} kontakte
 * @param {{client?: string}|null|undefined} projekt
 * @returns {{name: string, anschrift: string, ust_idnr: string, art: string}} name "" when nothing is known
 */
export function empfaengerAus(vertrag, kontakte, projekt) {
  if (vertrag?.bauherr_name) {
    return { name: vertrag.bauherr_name, anschrift: vertrag.bauherr_anschrift || "", ust_idnr: vertrag.bauherr_ust_idnr || "", art: vertrag.bauherr_art || "unternehmer" };
  }
  const treffer = Array.isArray(kontakte) ? kontakte.find((k) => k?.company && k.company === projekt?.client) : null;
  if (treffer) return { name: treffer.company, anschrift: "", ust_idnr: "", art: "unternehmer" };
  return { name: projekt?.client || "", anschrift: "", ust_idnr: "", art: "unternehmer" };
}

/**
 * New invoice draft from a project (and optionally its fee contract). The
 * recipient is a live snapshot only (not frozen — istStelleRechnung() freezes
 * it); `project_name` is deliberately left out so the draft always shows the
 * project's CURRENT name, unlike an issued invoice (behaviour: rename after
 * issuing must not change the issued document).
 * @param {{
 *   projekt: {id: string, name?: string, client?: string, hoai_phase?: string|number},
 *   vertrag?: Record<string, any>|null,
 *   kontakte?: ReadonlyArray<{company?: string, name?: string}>,
 *   einst: Record<string, any>,
 *   heute: string,
 *   vorlage?: {netto?: number, art?: string, lp_pos?: Array<{lp: number, stand: number, netto: number}>, rechnungsdatum?: string}|null,
 * }} eingabe
 * @returns {Record<string, any>} Ausgangsrechnung draft (no id — speichere() assigns one)
 */
export function neueRechnung({ projekt, vertrag = null, kontakte = [], einst, heute, vorlage = null }) {
  const lpVorschlag = normalisiereHoaiPhase(projekt?.hoai_phase);
  const satz = typeof vertrag?.ust_satz === "number" ? vertrag.ust_satz : einst?.ust_satz;
  const nettoEuro = typeof vorlage?.netto === "number" ? vorlage.netto : 0;
  const betraege = rechnungBetraege(nettoEuro, satz);
  return {
    project_id: projekt?.id,
    honorarvertrag_id: vertrag?.id || undefined,
    art: vorlage?.art || "abschlag",
    lp_pos: vorlage?.lp_pos ? vorlage.lp_pos.map((p) => ({ ...p })) : lpVorschlag ? [{ lp: lpVorschlag, stand: 0, netto: nettoEuro }] : [],
    netto: betraege.netto,
    ust_satz: satz,
    ust: betraege.ust,
    brutto: betraege.brutto,
    rechnungsdatum: vorlage?.rechnungsdatum || undefined,
    zahlungsziel_tage: undefined, // only frozen at stellen; the form shows the chain's suggestion instead
    empfaenger: empfaengerAus(vertrag, kontakte, projekt),
    status: "entwurf",
    zahlungen: [],
    mahnungen: [],
  };
}

/**
 * Splits a net amount into VAT and gross (§ 14 UStG: VAT rounded per invoice).
 * @param {number} nettoEuro net amount in Euro
 * @param {number} satz VAT rate in percent (19, 7, 0)
 * @returns {{netto: number, ust: number, brutto: number}} Euro, two decimals
 */
export function rechnungBetraege(nettoEuro, satz) {
  const nettoCent = euroZuCent(nettoEuro);
  const ustC = ustCent(nettoCent, satz);
  return { netto: centZuEuro(nettoCent), ust: centZuEuro(ustC), brutto: centZuEuro(nettoCent + ustC) };
}

/**
 * Prefill (`vorlage` of neueRechnung/RechnungFormular) of an Abschlag invoice
 * for a fee contract: the progress-based proposal with its per-LP lines. The
 * execution stand comes from the project's HoaiPlan (read-only, "Planer im
 * Komplex-Designer"), otherwise lpStand()'s estimate from the project phase.
 * One function for both entries — the "Abschlag vorschlagen" button and the
 * `?neu=1&vertrag=<id>` deep link of phase 81 — so both always propose the
 * same amount.
 * @param {{
 *   vertrag: Record<string, any>,
 *   projekt?: {hoai_phase?: string|number}|null,
 *   hoaiPlan?: {progress?: number[]}|null,
 *   rechnungen: ReadonlyArray<Record<string, any>>,
 * }} eingabe
 * @returns {{art: "abschlag", netto: number, lp_pos?: Array<{lp: number, stand: number, netto: number}>, stand_quelle: string}}
 *   netto in Euro; lp_pos only when the proposal is above 0 (otherwise the
 *   project-phase LP suggestion of neueRechnung applies); stand_quelle:
 *   "hoaiplan" | "projektphase" | "unbekannt" | "manuell" (no 9-stage profile)
 */
export function abschlagsEntwurf({ vertrag, projekt = null, hoaiPlan = null, rechnungen }) {
  const standErgebnis = lpStand(hoaiPlan, projekt, vertrag?.leistungsbild || "gebaeude");
  const { netto, lp_pos } = abschlagsVorlage(vertrag, standErgebnis?.stand || {}, rechnungen);
  return {
    art: "abschlag",
    netto,
    ...(lp_pos.length ? { lp_pos } : {}),
    stand_quelle: standErgebnis?.quelle || "manuell",
  };
}

/**
 * Existing invoice numbers of a document range, including storno numbers
 * (they consume a number too, § 14 Abs. 4 Nr. 4 UStG — no gap in the sequence).
 * @param {ReadonlyArray<{nummer?: string}>} rechnungen
 * @returns {string[]}
 */
function vorhandeneNummern(rechnungen) {
  return (rechnungen || []).map((r) => r?.nummer).filter((n) => typeof n === "string");
}

/**
 * Issues a draft or planned invoice: assigns its number and freezes every
 * field the GoBD write protection then locks (grundlagen.schreibschutzVerletzt) —
 * recipient, invoice date, payment term, due date and the project's name at
 * this moment. A later project rename or a changed contract term must never
 * change an already-issued document. The recipient is derived from the
 * CURRENT contract/project (empfaengerAus) — a planned invoice from
 * zahlungsplan() carries none, and a stored draft's preview may be stale; the
 * draft's own value is only the fallback when neither names anyone.
 * @param {Record<string, any>} entwurf the draft/planned invoice
 * @param {{
 *   rechnungen: ReadonlyArray<Record<string, any>>,
 *   vertrag?: Record<string, any>|null,
 *   kontakte?: ReadonlyArray<{company?: string, name?: string}>,
 *   einst: Record<string, any>,
 *   heute: string,
 *   projekt: {name?: string, client?: string}|null,
 * }} kontext
 * @returns {Record<string, any>} the invoice as it must be stored (status "gestellt")
 */
export function stelleRechnung(entwurf, { rechnungen, vertrag = null, kontakte = [], einst, heute, projekt }) {
  const rechnungsdatum = entwurf.rechnungsdatum || heute;
  const zielTage = zahlungszielTage({
    rechnung: entwurf,
    vertrag,
    einst,
    bauherrSchluessel: bauherrSchluessel(vertrag, projekt),
  });
  const faellig = plusTage(rechnungsdatum, zielTage);
  const nummer = naechsteNummer(einst.rechnungsnr_muster, vorhandeneNummern(rechnungen), rechnungsdatum);
  const live = empfaengerAus(vertrag, kontakte, projekt);
  return {
    ...entwurf,
    nummer,
    rechnungsdatum,
    zahlungsziel_tage: zielTage,
    faellig_am: /** @type {string} */ (faellig),
    empfaenger: live.name ? live : (entwurf.empfaenger || live),
    project_name: projekt?.name || "",
    status: "gestellt",
  };
}

/**
 * Cancels an issued invoice: a negative storno document with its own number
 * (never re-uses or gaps the sequence) and `storno_von`; the original becomes
 * "storniert" (GoBD: a document is corrected by a cancellation, never edited —
 * grundlagen.schreibschutzVerletzt only allows exactly this transition).
 * Deviation from the plan signature `storniere(rechnung, {rechnungen, heute})`:
 * a storno needs the office's number pattern, so `einst` is a required third
 * context field (see 79-02-SUMMARY "Abweichungen").
 * @param {Record<string, any>} rechnung the issued invoice to cancel
 * @param {{rechnungen: ReadonlyArray<Record<string, any>>, einst: Record<string, any>, heute: string}} kontext
 * @returns {{storno: Record<string, any>, original: Record<string, any>}}
 */
export function storniere(rechnung, { rechnungen, einst, heute }) {
  const nummer = naechsteNummer(einst.rechnungsnr_muster, vorhandeneNummern(rechnungen), heute);
  const storno = {
    project_id: rechnung.project_id,
    project_name: rechnung.project_name,
    honorarvertrag_id: rechnung.honorarvertrag_id,
    art: "storno",
    nummer,
    netto: rundeCent(-euroZuCent(rechnung.netto)) / 100,
    ust_satz: rechnung.ust_satz,
    ust: rundeCent(-euroZuCent(rechnung.ust)) / 100,
    brutto: rundeCent(-euroZuCent(rechnung.brutto)) / 100,
    rechnungsdatum: heute,
    faellig_am: heute,
    zahlungsziel_tage: 0,
    empfaenger: rechnung.empfaenger,
    status: "gestellt",
    storno_von: rechnung.id,
    zahlungen: [],
    mahnungen: [],
  };
  const original = { ...rechnung, status: "storniert" };
  return { storno, original };
}

/**
 * Records a payment (appended, never replacing earlier ones — the GoBD guard
 * only allows appending to `zahlungen`).
 * @param {Record<string, any>} rechnung
 * @param {{datum: string, betrag: number, bankumsatz_id?: string}} zahlung betrag in Euro
 * @returns {Record<string, any>} the invoice with the payment appended
 */
export function zahlungErfassen(rechnung, zahlung) {
  const zahlungen = Array.isArray(rechnung.zahlungen) ? rechnung.zahlungen : [];
  return { ...rechnung, zahlungen: [...zahlungen, { datum: zahlung.datum, betrag: zahlung.betrag, ...(zahlung.bankumsatz_id ? { bankumsatz_id: zahlung.bankumsatz_id } : {}) }] };
}

/**
 * Whether an invoice may still be freely edited (drafts and planned invoices —
 * an issued or cancelled one is GoBD-protected, grundlagen.schreibschutzVerletzt).
 * @param {{status?: string}|null|undefined} rechnung
 * @returns {boolean}
 */
export function istEditierbar(rechnung) {
  return rechnung?.status === "entwurf" || rechnung?.status === "geplant";
}

/**
 * Plausibility warnings before issuing a draft (the user must confirm each one
 * explicitly — they never block, GoBD leaves that judgement to the office).
 * @param {ReadonlyArray<Record<string, any>>} rechnungen existing invoices (any status)
 * @param {Record<string, any>} entwurf the draft about to be issued
 * @returns {Array<"schluss_doppelt"|"lp_stand_doppelt"|"zeitraum_ueberlappt">}
 */
export function doppelteRechnung(rechnungen, entwurf) {
  if (!entwurf?.honorarvertrag_id) return [];
  const andere = (rechnungen || []).filter(
    (r) => r.honorarvertrag_id === entwurf.honorarvertrag_id && r.id !== entwurf.id && r.status !== "storniert"
  );
  const warnungen = /** @type {Array<"schluss_doppelt"|"lp_stand_doppelt"|"zeitraum_ueberlappt">} */ ([]);
  if (entwurf.art === "schluss" && andere.some((r) => r.art === "schluss")) warnungen.push("schluss_doppelt");
  const lpPos = Array.isArray(entwurf.lp_pos) ? entwurf.lp_pos : [];
  const lpDoppelt = lpPos.some((pos) =>
    andere.some((r) => (Array.isArray(r.lp_pos) ? r.lp_pos : []).some((p) => p.lp === pos.lp && p.stand === pos.stand))
  );
  if (lpDoppelt) warnungen.push("lp_stand_doppelt");
  if (entwurf.leistung_von && entwurf.leistung_bis) {
    const ueberlappt = andere.some((r) => {
      if (!r.leistung_von || !r.leistung_bis) return false;
      return entwurf.leistung_von <= r.leistung_bis && r.leistung_von <= entwurf.leistung_bis;
    });
    if (ueberlappt) warnungen.push("zeitraum_ueberlappt");
  }
  return warnungen;
}

/** @param {Record<string, any>} r @returns {{cent: number, datum: string|null}} sum of payments and the latest payment date */
function zahlungsUebersicht(r) {
  const zahlungen = Array.isArray(r.zahlungen) ? r.zahlungen : [];
  const cent = zahlungen.reduce((n, z) => n + euroZuCent(z?.betrag), 0);
  const datum = zahlungen.reduce(/** @param {string|null} letztes */ (letztes, z) => (z?.datum && (!letztes || z.datum > letztes) ? z.datum : letztes), /** @type {string|null} */ (null));
  return { cent, datum };
}

/**
 * Export/table model of the outgoing invoices (one row per invoice, already
 * filtered and translated — feeds ExportKnopf and the on-screen table alike).
 * @param {ReadonlyArray<Record<string, any>>} daten Ausgangsrechnung records
 * @param {(key: string) => string} t
 * @param {{heute: string, projekte: ReadonlyArray<{id: string, name?: string}>}} kontext
 * @param {{status?: string, jahr?: string|number, projektId?: string|null}} [filter]
 * @returns {import("./tabellenExport.js").Tabellenmodell}
 */
export function ausgangTabelle(daten, t, kontext, filter = {}) {
  const { heute, projekte } = kontext;
  const projektName = (id) => projekte.find((p) => p.id === id)?.name || "";
  let zeilen = (daten || []).map((r) => {
    const status = rechnungsStatus(r, heute);
    const { cent, datum } = zahlungsUebersicht(r);
    return {
      nummer: r.nummer || "",
      projekt: r.project_name || projektName(r.project_id),
      lp: (Array.isArray(r.lp_pos) ? r.lp_pos.map((p) => p.lp).join(", ") : ""),
      art: r.art || "",
      netto: r.netto ?? 0,
      ust: r.ust ?? 0,
      brutto: r.brutto ?? 0,
      rechnungsdatum: r.rechnungsdatum || "",
      faellig_am: faelligAm(r) || "",
      zahlung_summe: centZuEuro(cent),
      zahlung_datum: datum || "",
      status: t(statusLabelSchluessel(status)),
      _status: status,
      _id: r.id,
      _jahr: (r.rechnungsdatum || "").slice(0, 4),
    };
  });
  if (filter.status) zeilen = zeilen.filter((z) => z._status === filter.status);
  if (filter.jahr) zeilen = zeilen.filter((z) => z._jahr === String(filter.jahr));
  if (filter.projektId) zeilen = zeilen.filter((z) => (daten || []).find((r) => r.id === z._id)?.project_id === filter.projektId);
  return {
    titel: t("Ausgangsrechnungen"),
    spalten: [
      { key: "nummer", label: t("Nummer"), typ: "text" },
      { key: "projekt", label: t("Projekt"), typ: "text" },
      { key: "lp", label: t("LP"), typ: "text" },
      { key: "art", label: t("Art"), typ: "text" },
      { key: "netto", label: t("Netto"), typ: "betrag" },
      { key: "ust", label: t("USt"), typ: "betrag" },
      { key: "brutto", label: t("Brutto"), typ: "betrag" },
      { key: "rechnungsdatum", label: t("Rechnungsdatum"), typ: "datum" },
      { key: "faellig_am", label: t("Fällig am"), typ: "datum" },
      { key: "zahlung_summe", label: t("Zahlung"), typ: "betrag" },
      { key: "zahlung_datum", label: t("Letzte Zahlung"), typ: "datum" },
      { key: "status", label: t("Status"), typ: "text" },
    ],
    zeilen,
  };
}

/** @param {string} status computed rechnungsStatus @returns {string} the fitting DICT key */
function statusLabelSchluessel(status) {
  switch (status) {
    case "geplant": return "Geplant";
    case "entwurf": return "Rechnungsentwurf";
    case "offen": return "Offen";
    case "teilbezahlt": return "Teilbezahlt";
    case "ueberfaellig": return "Überfällig";
    case "bezahlt": return "Bezahlt";
    case "storniert": return "Storniert";
    default: return status;
  }
}
