// Fee amendments of an architect's contract (Honorarnachtrag, phase 81-04,
// HON-05): a change of services (§ 10 Abs. 1 HOAI), repeated basic services
// (§ 10 Abs. 2 HOAI), an order of the client (§ 650b BGB), a special service,
// a cost update or an extension of time. UI word always "Honorarnachtrag" —
// never "Nachtrag" alone, which means a construction change order (pitfall 1).
//
// Honorarnachtrag (bitApi.entities, through src/lib/zeitHonorar/speicher.js):
// honorarvertrag_id, project_id, nr, titel, grund, lph|null, berechnung
// {art 'pauschal'|'stunden'|'wiederholung', betrag_euro?, stunden?, satz_eur_h?,
// rolle?, wiederholung_prozent?}, betrag_euro, erbracht_prozent 0..100, status
// (NACHTRAG_STATUS), datum, beauftragt_am, textform_am.
//
// Amounts in cents inside, Euro outside. Incidental costs on commissioned fee
// amendments (D-P81-14 [ASSUMED]: § 14 HOAI applies to the whole fee, so the
// contract's rate is charged on amendments too).
//
// In:  contracts (79 Honorarvertrag), amendments, invoices, the rule reader.
// Out: records and amounts.

import { honorarVertrag } from "@core/lib/hoai/honorar.js";
import { NACHTRAG_STATUS, statusErlaubt } from "./vertragsdaten.js";

/** Reasons of a fee amendment (German i18n keys) with their legal source. */
export const NACHTRAG_GRUENDE = Object.freeze({
  leistungsaenderung: Object.freeze({ label: "Leistungsänderung", quelle: "§ 10 Abs. 1 HOAI" }),
  wiederholung: Object.freeze({ label: "Wiederholung von Grundleistungen", quelle: "§ 10 Abs. 2 HOAI" }),
  anordnung: Object.freeze({ label: "Anordnung des Bauherrn", quelle: "§ 650b BGB" }),
  besondere_leistung: Object.freeze({ label: "Besondere Leistung", quelle: "§ 3 Abs. 3 HOAI" }),
  kostenfortschreibung: Object.freeze({ label: "Kostenfortschreibung", quelle: "§ 6 Abs. 1 HOAI" }),
  terminverlaengerung: Object.freeze({ label: "Terminverlängerung", quelle: "§ 650c BGB" }),
});

/** Charge-out rate rule per role (zeit_honorar.verrechnungssatz_*, Euro/hour). */
export const ROLLEN_SATZ = Object.freeze({
  inhaber: "zeit_honorar.verrechnungssatz_inhaber",
  projektleitung: "zeit_honorar.verrechnungssatz_projektleitung",
  mitarbeit: "zeit_honorar.verrechnungssatz_mitarbeit",
});

/** @param {number} euro @returns {number} */
const cent = (euro) => Math.round((Number(euro) || 0) * 100);

/**
 * A new draft amendment of a contract with the next number.
 * @param {Record<string, any>} vertrag
 * @param {ReadonlyArray<Record<string, any>>} vorhandene all amendments
 * @param {{heuteIso: string}} kontext
 * @returns {Record<string, any>} without id
 */
export function neuerNachtrag(vertrag, vorhandene, { heuteIso }) {
  const eigene = (vorhandene || []).filter((n) => n?.honorarvertrag_id === vertrag.id);
  return {
    honorarvertrag_id: vertrag.id, project_id: vertrag.project_id ?? null,
    nr: eigene.reduce((m, n) => Math.max(m, Number(n.nr) || 0), 0) + 1,
    titel: "", grund: "leistungsaenderung", lph: null,
    berechnung: { art: "pauschal", betrag_euro: 0 }, betrag_euro: 0, erbracht_prozent: 0,
    status: "entwurf", datum: heuteIso, beauftragt_am: null, textform_am: null,
  };
}

/**
 * Amount of a calculation in Euro: a flat amount; hours × rate (own rate or the
 * charge-out rate of the role, zeit_honorar.verrechnungssatz_*); or a share of
 * the stage's fee for repeated basic services (§ 10 Abs. 2 HOAI).
 * {art:'wiederholung', lph:2, wiederholung_prozent:50} on Fixture B → 19.373,94 × 50 % = 9.686,97.
 * @param {{art?: string, betrag_euro?: number, stunden?: number, satz_eur_h?: number, rolle?: string, lph?: number|null, wiederholung_prozent?: number}} berechnung
 * @param {Record<string, any>} vertrag 79 Honorarvertrag
 * @param {(id: string) => any} [wert] rule reader
 * @param {{weitere?: ReadonlyArray<any>}} [optionen]
 * @returns {number} Euro (0 when nothing computes)
 */
export function betragAusBerechnung(berechnung, vertrag, wert = () => null, optionen = {}) {
  const b = berechnung || {};
  if (b.art === "stunden") {
    const satz = typeof b.satz_eur_h === "number" ? b.satz_eur_h : Number(wert(/** @type {any} */ (ROLLEN_SATZ)[b.rolle || "mitarbeit"] || ROLLEN_SATZ.mitarbeit)) || 0;
    return Math.round((Number(b.stunden) || 0) * cent(satz)) / 100;
  }
  if (b.art === "wiederholung") {
    const h = honorarVertrag(vertrag, optionen);
    const stufe = (h.lph || []).find((l) => l.nr === Number(b.lph));
    if (!stufe) return 0;
    return Math.round(cent(stufe.betrag) * ((Number(b.wiederholung_prozent) || 0) / 100)) / 100;
  }
  return cent(b.betrag_euro) / 100;
}

/**
 * Status change of an amendment: entwurf → angeboten → beauftragt | abgelehnt;
 * commissioned and rejected are final. Commissioning stamps beauftragt_am.
 * @param {Record<string, any>} nachtrag
 * @param {string} ziel
 * @param {{heuteIso: string}} kontext
 * @returns {{ok: true, nachtrag: Record<string, any>} | {ok: false, fehler: 'uebergang'}}
 */
export function nachtragStatusWechsel(nachtrag, ziel, { heuteIso }) {
  if (!statusErlaubt(NACHTRAG_STATUS, nachtrag?.status || "entwurf", ziel)) return { ok: false, fehler: "uebergang" };
  return { ok: true, nachtrag: { ...nachtrag, status: ziel, ...(ziel === "beauftragt" ? { beauftragt_am: heuteIso } : {}) } };
}

/**
 * Commissioned amendments of a contract with incidental costs, in cents.
 * @param {Record<string, any>} vertrag
 * @param {ReadonlyArray<Record<string, any>>} nachtraege
 * @returns {number} cents
 */
export function beauftragteNachtraegeCent(vertrag, nachtraege) {
  const nk = typeof vertrag?.nebenkosten_prozent === "number" ? vertrag.nebenkosten_prozent : 5;
  return (nachtraege || [])
    .filter((n) => n?.honorarvertrag_id === vertrag.id && n.status === "beauftragt")
    .reduce((s, n) => s + Math.round(cent(n.betrag_euro) * (1 + nk / 100)), 0);
}

/**
 * Contract sum including commissioned amendments (net, Euro):
 * honorarVertrag(vertrag).netto + Σ commissioned × (1 + incidental costs).
 * Fixture B with N1 8.000 € → 284.796,97 + 8.400,00 = 293.196,97.
 * @param {Record<string, any>} vertrag
 * @param {ReadonlyArray<Record<string, any>>} nachtraege
 * @param {{weitere?: ReadonlyArray<any>}} [optionen]
 * @returns {number|null} null when the contract has no amount ("Tafel fehlt" without flat fee)
 */
export function vertragssummeMitNachtraegen(vertrag, nachtraege, optionen = {}) {
  const h = honorarVertrag(vertrag, optionen);
  if (typeof h.netto !== "number") return null;
  return (cent(h.netto) + beauftragteNachtraegeCent(vertrag, nachtraege)) / 100;
}

/**
 * Invoice positions of commissioned amendments not yet billed:
 * betrag × erbracht % − already billed for this amendment (issued, non-cancelled
 * invoices, positions with its nachtrag_id). Positions with 0 € are left out.
 * @param {ReadonlyArray<Record<string, any>>} nachtraege amendments of ONE contract
 * @param {ReadonlyArray<Record<string, any>>} rechnungen invoices of that contract
 * @returns {Array<{lp: null, nachtrag_id: string, bezeichnung: string, stand: number, netto: number}>}
 */
export function nachtragPositionen(nachtraege, rechnungen) {
  const gestellt = (rechnungen || []).filter((r) => r?.status === "gestellt" && r.art !== "storno");
  return (nachtraege || [])
    .filter((n) => n?.status === "beauftragt")
    .map((n) => {
      const soll = Math.round(cent(n.betrag_euro) * ((Number(n.erbracht_prozent) || 0) / 100));
      const bisher = gestellt.reduce((s, r) => s + (r.lp_pos || []).filter((p) => p?.nachtrag_id === n.id).reduce((x, p) => x + cent(p.netto), 0), 0);
      return { lp: null, nachtrag_id: n.id, bezeichnung: `Honorarnachtrag ${n.nr} – ${n.titel || ""}`.trim(), stand: Number(n.erbracht_prozent) || 0, netto: (soll - bisher) / 100 };
    })
    .filter((p) => p.netto > 0);
}
