// Bank reconciliation of the accounting module (79-07, BUCH-11): matching a
// bank transaction to what it settles (an outgoing invoice's payment, an
// incoming invoice, a tax payment, or an owner's drawing), automatic matching
// ONLY on the narrow rule RESEARCH sets ("Bank-CSV-Formate"), and the
// consistency check that catches the two sides of a match drifting apart.
//
// Data-model rule (RESEARCH "Bank-CSV-Formate", also grundlagen.js's own
// header comment): a match is written through ONE function that sets BOTH
// sides at once (the target entity's own field + the Bankumsatz's `zuordnung`)
// — never one without the other, so `konsistenz()` stays meaningful.
//
// In:  records of the data contract (datenmodell.js). Out: pure functions —
//      `kandidaten`/`autoZuordnen`/`konsistenz` only read; `zuordnungAnwenden`/
//      `zuordnungLoesen` return a write list for the caller's bh.speichereViele
//      (this module never calls the storage layer itself).

import { euroZuCent } from "./geld.js";
import { offenerBetragCent } from "./grundlagen.js";

/**
 * One possible target for a bank transaction. `sicher` (auto-matchable) is
 * only ever true for an outgoing invoice matched on BOTH its number in the
 * purpose text AND the exact open amount — every other match (incoming
 * invoice, tax payment, drawing) is a proposal for a human to confirm, per
 * RESEARCH's rule that automatic assignment is a narrow, deliberately rare case.
 * @typedef {{typ: "Ausgangsrechnung"|"Eingangsrechnung"|"Steuerzahlung"|"Entnahme", id: string, grund: string, sicher: boolean}} Kandidat
 */

/**
 * Invoice-number text → comparable form: spaces and hyphens removed (a SEPA
 * remittance text wraps at 27/35 characters, sometimes splitting a number
 * across the break with a plain space), upper case. `RE-2026 -014` and
 * `RE2026014` both normalise to `RE2026014`.
 * @param {unknown} text
 * @returns {string}
 */
export function normNummer(text) {
  return String(text ?? "").toUpperCase().replace(/[\s-]/g, "");
}

/** @param {string} zweck @param {string} nummer @returns {boolean} true when the normalised number occurs in the normalised purpose text */
function nummerImZweck(zweck, nummer) {
  const n = normNummer(nummer);
  return n.length > 0 && normNummer(zweck).includes(n);
}

/**
 * Every plausible target of a bank transaction (RESEARCH "Bank-CSV-Formate";
 * BUCH-11's <behavior> lines are its test oracle). Incoming money (`betrag`
 * &gt; 0) is checked against open outgoing invoices; outgoing money (`betrag`
 * &lt; 0) against unpaid incoming invoices, open tax payments (by "Finanzamt"
 * in the counterparty) and the owner/partners (by IBAN, always a proposal —
 * a drawing does not exist yet, it would be newly created).
 * @param {{betrag?: number, zweck?: string, gegenpartei?: string, iban?: string}} umsatz Bankumsatz
 * @param {Record<string, any[]>} daten loaded collections (bh.daten)
 * @returns {Kandidat[]}
 */
export function kandidaten(umsatz, daten) {
  const cent = euroZuCent(umsatz?.betrag);
  const zweck = String(umsatz?.zweck ?? "");
  const gegenpartei = String(umsatz?.gegenpartei ?? "");
  /** @type {Kandidat[]} */
  const ergebnisse = [];

  if (cent > 0) {
    for (const r of daten.Ausgangsrechnung || []) {
      if (r.status !== "gestellt") continue;
      const offenCent = offenerBetragCent(r);
      if (offenCent <= 0) continue;
      const hatNummer = r.nummer && nummerImZweck(zweck, r.nummer);
      const betragPasst = cent === offenCent;
      if (!hatNummer && !betragPasst) continue;
      ergebnisse.push({
        typ: "Ausgangsrechnung", id: r.id, sicher: Boolean(hatNummer && betragPasst),
        grund: hatNummer && betragPasst ? "nummer_und_betrag" : hatNummer ? "nummer" : "betrag",
      });
    }
    return ergebnisse;
  }

  if (cent < 0) {
    const bruttoAbs = -cent;
    for (const e of daten.Eingangsrechnung || []) {
      if (e.bezahlt_am) continue;
      if (euroZuCent(e.brutto) !== bruttoAbs) continue;
      const hatFremdNr = e.fremd_nr && nummerImZweck(zweck, e.fremd_nr);
      const hatLieferant = e.lieferant && normNummer(gegenpartei).includes(normNummer(e.lieferant));
      if (!hatFremdNr && !hatLieferant) continue;
      ergebnisse.push({ typ: "Eingangsrechnung", id: e.id, sicher: false, grund: hatFremdNr ? "fremdnummer" : "lieferant" });
    }
    if (/finanzamt/i.test(gegenpartei)) {
      for (const s of daten.Steuerzahlung || []) {
        if (s.bezahlt_am) continue;
        if (euroZuCent(s.betrag) !== bruttoAbs) continue;
        ergebnisse.push({ typ: "Steuerzahlung", id: s.id, sicher: false, grund: "finanzamt" });
      }
    }
    const ibanUmsatz = normNummer(umsatz?.iban);
    if (ibanUmsatz) {
      for (const g of daten.Gesellschafter || []) {
        if (g.aktiv === false || !g.iban) continue;
        if (normNummer(g.iban) !== ibanUmsatz) continue;
        ergebnisse.push({ typ: "Entnahme", id: g.id, sicher: false, grund: "gesellschafter_iban" });
      }
    }
  }
  return ergebnisse;
}

/**
 * Writes both sides of a match: the target entity's own field (a new payment
 * on the invoice, `bezahlt_am` on an incoming invoice or tax payment, a newly
 * created drawing) and the Bankumsatz's own status/`zuordnung`. A drawing gets
 * a deterministic id (`bu:<bankumsatz id>`) so the Bankumsatz side can point at
 * it even though it does not exist yet — both writes happen through the SAME
 * bh.speichereViele call, so the two sides can never land only half-written.
 * @param {Record<string, any>} umsatz Bankumsatz (id/buchungstag/betrag read)
 * @param {{typ: Kandidat["typ"], id: string, modus: "auto"|"manuell"}} ziel one of `kandidaten()`'s results (or a manual choice)
 * @param {Record<string, any[]>} daten loaded collections
 * @returns {Array<{entitaet: string, obj: Record<string, any>}>} write list for bh.speichereViele
 * @throws {Error} plain text when `ziel` names a record that is not in `daten`
 */
export function zuordnungAnwenden(umsatz, ziel, daten) {
  /** @type {Array<{entitaet: string, obj: Record<string, any>}>} */
  const schreibliste = [];
  if (ziel.typ === "Ausgangsrechnung") {
    const r = (daten.Ausgangsrechnung || []).find((x) => x.id === ziel.id);
    if (!r) throw new Error(`Abgleich: Ausgangsrechnung „${ziel.id}” nicht gefunden.`);
    const zahlungen = [...(r.zahlungen || []), { datum: umsatz.buchungstag, betrag: umsatz.betrag, bankumsatz_id: umsatz.id }];
    schreibliste.push({ entitaet: "Ausgangsrechnung", obj: { id: r.id, zahlungen } });
  } else if (ziel.typ === "Eingangsrechnung") {
    const e = (daten.Eingangsrechnung || []).find((x) => x.id === ziel.id);
    if (!e) throw new Error(`Abgleich: Eingangsrechnung „${ziel.id}” nicht gefunden.`);
    schreibliste.push({ entitaet: "Eingangsrechnung", obj: { id: e.id, bezahlt_am: umsatz.buchungstag } });
  } else if (ziel.typ === "Steuerzahlung") {
    const s = (daten.Steuerzahlung || []).find((x) => x.id === ziel.id);
    if (!s) throw new Error(`Abgleich: Steuerzahlung „${ziel.id}” nicht gefunden.`);
    schreibliste.push({ entitaet: "Steuerzahlung", obj: { id: s.id, bezahlt_am: umsatz.buchungstag } });
  } else if (ziel.typ === "Entnahme") {
    const g = (daten.Gesellschafter || []).find((x) => x.id === ziel.id);
    if (!g) throw new Error(`Abgleich: Gesellschafter „${ziel.id}” nicht gefunden.`);
    schreibliste.push({
      entitaet: "Entnahme",
      obj: { id: `bu:${umsatz.id}`, gesellschafter_id: g.id, datum: umsatz.buchungstag, betrag: Math.abs(umsatz.betrag), art: "ueberweisung", bankumsatz_id: umsatz.id },
    });
  } else {
    throw new Error(`Abgleich: unbekanntes Zuordnungsziel „${ziel.typ}”.`);
  }
  schreibliste.push({ entitaet: "Bankumsatz", obj: { id: umsatz.id, status: "zugeordnet", zuordnung: { typ: ziel.typ, id: ziel.id, modus: ziel.modus } } });
  return schreibliste;
}

/**
 * Reverses a match: resets the target's own field (removes the payment from
 * the invoice's `zahlungen[]`, clears `bezahlt_am`) and puts the Bankumsatz
 * back to "offen". A drawing the reconciliation itself created is left in
 * place (it is a real record of money having moved) — the caller (BankReiter)
 * deletes it separately via bh.loesche when it wants to undo the whole thing.
 * @param {Record<string, any>} umsatz Bankumsatz (id/zuordnung read)
 * @param {Record<string, any[]>} daten loaded collections
 * @returns {Array<{entitaet: string, obj: Record<string, any>}>} write list for bh.speichereViele
 */
export function zuordnungLoesen(umsatz, daten) {
  const ziel = umsatz?.zuordnung;
  /** @type {Array<{entitaet: string, obj: Record<string, any>}>} */
  const schreibliste = [];
  if (ziel?.typ === "Ausgangsrechnung") {
    const r = (daten.Ausgangsrechnung || []).find((x) => x.id === ziel.id);
    if (r) schreibliste.push({ entitaet: "Ausgangsrechnung", obj: { id: r.id, zahlungen: (r.zahlungen || []).filter((z) => z.bankumsatz_id !== umsatz.id) } });
  } else if (ziel?.typ === "Eingangsrechnung") {
    const e = (daten.Eingangsrechnung || []).find((x) => x.id === ziel.id);
    if (e) schreibliste.push({ entitaet: "Eingangsrechnung", obj: { id: e.id, bezahlt_am: null } });
  } else if (ziel?.typ === "Steuerzahlung") {
    const s = (daten.Steuerzahlung || []).find((x) => x.id === ziel.id);
    if (s) schreibliste.push({ entitaet: "Steuerzahlung", obj: { id: s.id, bezahlt_am: null } });
  }
  schreibliste.push({ entitaet: "Bankumsatz", obj: { id: umsatz.id, status: "offen", zuordnung: null } });
  return schreibliste;
}

/**
 * Assigns every still-open bank transaction that has EXACTLY ONE `sicher`
 * candidate (several equally sure candidates stay open for a human — an
 * ambiguous automatic match is worse than none). Does not look at a
 * transaction's OWN just-applied write within the same call: two lines of the
 * same import both fully matching one invoice is rare enough that the second
 * one simply not auto-matching (the invoice's open amount only updates once
 * the caller reloads) is an acceptable, honest limitation.
 * @param {Record<string, any[]>} daten loaded collections (bh.daten)
 * @returns {Array<{entitaet: string, obj: Record<string, any>}>} write list for bh.speichereViele
 */
export function autoZuordnen(daten) {
  /** @type {Array<{entitaet: string, obj: Record<string, any>}>} */
  const schreibliste = [];
  for (const umsatz of daten.Bankumsatz || []) {
    if (umsatz.status !== "offen") continue;
    const sichere = kandidaten(umsatz, daten).filter((k) => k.sicher);
    if (sichere.length !== 1) continue;
    schreibliste.push(...zuordnungAnwenden(umsatz, { ...sichere[0], modus: "auto" }, daten));
  }
  return schreibliste;
}

/**
 * Finds the three ways the two sides of a match can drift apart: a payment
 * recorded with a `bankumsatz_id` whose Bankumsatz does not exist (or no
 * longer points back), a Bankumsatz marked "zugeordnet" without a real
 * counterpart, and the same target claimed by more than one Bankumsatz.
 * @param {Record<string, any[]>} daten loaded collections
 * @returns {Array<{art: "zahlung_ohne_umsatz"|"umsatz_ohne_gegenstueck"|"doppelt_zugeordnet", [k: string]: any}>}
 */
export function konsistenz(daten) {
  /** @type {Array<{art: "zahlung_ohne_umsatz"|"umsatz_ohne_gegenstueck"|"doppelt_zugeordnet", [k: string]: any}>} */
  const befunde = [];
  const bankNachId = new Map((daten.Bankumsatz || []).map((b) => [b.id, b]));

  for (const r of daten.Ausgangsrechnung || []) {
    for (const z of r.zahlungen || []) {
      if (!z.bankumsatz_id) continue;
      const b = bankNachId.get(z.bankumsatz_id);
      if (!b || b.zuordnung?.typ !== "Ausgangsrechnung" || b.zuordnung?.id !== r.id) {
        befunde.push({ art: "zahlung_ohne_umsatz", entitaet: "Ausgangsrechnung", id: r.id, bankumsatz_id: z.bankumsatz_id });
      }
    }
  }

  const zielAnzahl = new Map();
  for (const b of daten.Bankumsatz || []) {
    if (b.status !== "zugeordnet" || !b.zuordnung) continue;
    const schluessel = `${b.zuordnung.typ}:${b.zuordnung.id}`;
    zielAnzahl.set(schluessel, (zielAnzahl.get(schluessel) || 0) + 1);
    let gefunden = false;
    if (b.zuordnung.typ === "Ausgangsrechnung") {
      const r = (daten.Ausgangsrechnung || []).find((x) => x.id === b.zuordnung.id);
      gefunden = Boolean(r && (r.zahlungen || []).some((z) => z.bankumsatz_id === b.id));
    } else if (b.zuordnung.typ === "Eingangsrechnung") {
      gefunden = Boolean((daten.Eingangsrechnung || []).find((x) => x.id === b.zuordnung.id)?.bezahlt_am);
    } else if (b.zuordnung.typ === "Steuerzahlung") {
      gefunden = Boolean((daten.Steuerzahlung || []).find((x) => x.id === b.zuordnung.id)?.bezahlt_am);
    } else if (b.zuordnung.typ === "Entnahme") {
      gefunden = (daten.Entnahme || []).some((x) => x.bankumsatz_id === b.id);
    }
    if (!gefunden) befunde.push({ art: "umsatz_ohne_gegenstueck", bankumsatz_id: b.id, ziel: b.zuordnung });
  }
  for (const [schluessel, anzahl] of zielAnzahl) {
    if (anzahl > 1) { const [typ, id] = schluessel.split(":"); befunde.push({ art: "doppelt_zugeordnet", typ, id, anzahl }); }
  }
  return befunde;
}

/** @param {string} status @param {(k: string) => string} t */
function statusText(status, t) {
  if (status === "zugeordnet") return t("Zugeordnet");
  if (status === "ignoriert") return t("Ignoriert");
  return t("Offen");
}

/** @param {{typ: string, id: string}|null|undefined} zuordnung @param {Record<string, any[]>} daten @param {(k: string) => string} t */
function zuordnungText(zuordnung, daten, t) {
  if (!zuordnung) return "";
  if (zuordnung.typ === "Ausgangsrechnung") {
    const r = (daten.Ausgangsrechnung || []).find((x) => x.id === zuordnung.id);
    return `${t("Ausgangsrechnung")} ${r?.nummer || zuordnung.id}`;
  }
  if (zuordnung.typ === "Eingangsrechnung") {
    const e = (daten.Eingangsrechnung || []).find((x) => x.id === zuordnung.id);
    return `${t("Eingangsrechnung")} ${e?.lieferant || zuordnung.id}`;
  }
  if (zuordnung.typ === "Steuerzahlung") return t("Steuerzahlung");
  if (zuordnung.typ === "Entnahme") return t("Entnahme");
  return zuordnung.typ;
}

/**
 * Exportable table of the bank transactions (ExportKnopf: CSV/XLSX). `filter`
 * narrows to one status, "alle" (default) keeps every transaction.
 * @param {Record<string, any[]>} daten loaded collections
 * @param {(k: string) => string} t
 * @param {"alle"|"offen"|"zugeordnet"|"ignoriert"} [filter]
 * @returns {import("./tabellenExport.js").Tabellenmodell}
 */
export function bankTabelle(daten, t, filter = "alle") {
  const zeilen = (daten.Bankumsatz || [])
    .filter((b) => filter === "alle" || b.status === filter)
    .slice()
    .sort((a, b) => (a.buchungstag < b.buchungstag ? 1 : a.buchungstag > b.buchungstag ? -1 : 0))
    .map((b) => ({
      buchungstag: b.buchungstag, betrag: b.betrag, zweck: b.zweck || "", gegenpartei: b.gegenpartei || "",
      status: statusText(b.status, t), zuordnung: zuordnungText(b.zuordnung, daten, t),
    }));
  return {
    titel: t("Bank-Abgleich"),
    spalten: [
      { key: "buchungstag", label: t("Buchungstag"), typ: "datum" },
      { key: "betrag", label: t("Betrag"), typ: "betrag" },
      { key: "zweck", label: t("Verwendungszweck"), typ: "text" },
      { key: "gegenpartei", label: t("Gegenpartei"), typ: "text" },
      { key: "status", label: t("Status"), typ: "text" },
      { key: "zuordnung", label: t("Zuordnung"), typ: "text" },
    ],
    zeilen,
  };
}
