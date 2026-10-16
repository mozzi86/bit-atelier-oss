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
// (NACHTRAG_STATUS), datum, beauftragt_am, textform_am; since 96-03 optionally
// kosten_drift {bezug_am, bezug, aktuell, aktuell_am} (an LV cost drift turned
// into this amendment, cents per KG — see driftBezug/nachtragAusKostenDrift).
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

/**
 * 96-03: the reference the LV drift of a contract is measured against. That is
 * the contract's frozen snapshot (`kosten_eingefroren`) — unless a drift was
 * already turned into a fee amendment: then the newest non-rejected amendment
 * with `kosten_drift` is the reference, so a handled drift is not reported
 * again (a further change beyond the threshold is). The contract itself is
 * never changed — issued instalment invoices stay as they are (GoBD).
 * @param {Record<string, any>} vertrag Honorarvertrag
 * @param {ReadonlyArray<Record<string, any>>} nachtraege all amendments
 * @returns {Record<string, any>} the contract, or a copy carrying the amendment's
 *   reference as snapshot fields (`kosten_eingefroren_am` 'YYYY-MM-DD',
 *   `kosten_eingefroren` integer cents per KG)
 */
export function driftBezug(vertrag, nachtraege) {
  if (!vertrag?.kosten_eingefroren) return vertrag;
  const letzter = (nachtraege || [])
    .filter((n) => n?.honorarvertrag_id === vertrag.id && n.status !== "abgelehnt" && n.kosten_drift?.aktuell)
    .sort((a, b) => (Number(b.nr) || 0) - (Number(a.nr) || 0))[0];
  if (!letzter) return vertrag;
  return { ...vertrag, kosten_eingefroren_am: letzter.kosten_drift.aktuell_am ?? letzter.datum ?? null, kosten_eingefroren: { ...letzter.kosten_drift.aktuell } };
}

/**
 * 96-03: a draft fee amendment for an LV drift of the anrechenbare Kosten —
 * § 10 Abs. 1 HOAI: a changed scope that changes the anrechenbare Kosten
 * adjusts the fee by agreement (in text form). The flat amount is the fee
 * difference in Euro (Grundhonorar + Umbauzuschlag, net, WITHOUT incidental
 * costs — beauftragteNachtraegeCent adds those on commissioned amendments)
 * between the contract computed with the reference costs and with the current
 * LV costs; 0 € when the fee does not depend on the costs (flat fee, table
 * missing, outside the table). Only a draft: nothing is saved here, and the
 * contract and its invoices stay untouched. A negative amount (LV got cheaper)
 * is kept as the honest proposal; the user decides in the dialog.
 * @param {Record<string, any>} vertrag Honorarvertrag
 * @param {NonNullable<ReturnType<typeof import("@core/lib/hoai/kostenDrift.js").kostenDrift>>} drift
 *   kostenDrift(driftBezug(vertrag, …), lvPositionen)
 * @param {ReadonlyArray<Record<string, any>>} vorhandene all amendments (for the number)
 * @param {{heuteIso: string, titel: string}} kontext heuteIso 'YYYY-MM-DD'; titel: translated title
 * @param {{weitere?: ReadonlyArray<any>}} [optionen] injectable test tables
 * @returns {Record<string, any>} draft amendment without id, with `kosten_drift`
 *   {bezug_am, bezug, aktuell, aktuell_am} (integer cents per KG) — the next drift reference
 */
export function nachtragAusKostenDrift(vertrag, drift, vorhandene, { heuteIso, titel }, optionen = {}) {
  const k = drift.jeKg;
  /** @param {"eingefrorenCent"|"aktuellCent"} feld @returns {{kg300_euro: number, kg400_euro: number, sonstige_euro: number}} */
  const kosten = (feld) => ({ kg300_euro: k.kg300[feld] / 100, kg400_euro: k.kg400[feld] / 100, sonstige_euro: k.sonstige[feld] / 100 });
  const alt = honorarVertrag({ ...vertrag, ...kosten("eingefrorenCent") }, optionen);
  const neu = honorarVertrag({ ...vertrag, ...kosten("aktuellCent") }, optionen);
  /** @param {ReturnType<typeof honorarVertrag>} h @returns {number} cents */
  const ohneNebenkosten = (h) => cent(h.grund) + cent(h.umbau);
  const betrag = alt.quelle === "tafel" && neu.quelle === "tafel" ? (ohneNebenkosten(neu) - ohneNebenkosten(alt)) / 100 : 0;
  /** @param {"eingefrorenCent"|"aktuellCent"} feld @returns {{kg300_cent: number, kg400_cent: number, sonstige_cent: number}} */
  const centJeKg = (feld) => ({ kg300_cent: k.kg300[feld], kg400_cent: k.kg400[feld], sonstige_cent: k.sonstige[feld] });
  return {
    ...neuerNachtrag(vertrag, vorhandene, { heuteIso }),
    titel,
    grund: "leistungsaenderung",
    berechnung: { art: "pauschal", betrag_euro: betrag },
    betrag_euro: betrag,
    kosten_drift: { bezug_am: drift.eingefrorenAm, bezug: centJeKg("eingefrorenCent"), aktuell: centJeKg("aktuellCent"), aktuell_am: heuteIso },
  };
}
