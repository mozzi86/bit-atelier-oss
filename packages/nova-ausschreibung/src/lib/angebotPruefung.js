// 90-04: deterministic offer check (Angebotsprüfung) for EVERY bid in the Preisspiegel — typed by hand,
// imported from GAEB X84 (90-03) or simulated. Council 10.10.2026 (HANDOFF-SKILLS-INTEGRATION §3): the
// office skill "pruefangebot-pruefen" ticks prices and quantities in the offer PDF and stamps it; the
// app had the Preisspiegel but no check step "quantity × unit price = total".
//
// In:  one bid ({ line_items: [{ position_id, unit_price, total_price?, quantity? }], angebotssumme_bieter? }),
//      the LV positions of the tender ({ id, oz, title, quantity, unit, unit_price = cost-estimate EP }),
//      the other bids of the same tender (reference for outlier prices and the gap to the next bidder).
// Out: pure result — one row per LV position with codes (no German text: the dialog translates them),
//      the recomputed total with LV quantities, the deviation from the bidder's own total, counts, and the
//      verdict. Plus the Prüfvermerk record that is stored on the bid and the CSV rows of the protocol.
//
// Two kinds of finding, kept apart on purpose:
//   befund  — arithmetic / completeness (missing price, 0,00 €, line total ≠ quantity × EP, changed
//             quantity, bidder total ≠ recomputed total). These decide "rechnerisch geprüft mit Befund".
//   hinweis — economic plausibility (single price far from the others, offer far below the next one).
//             Only hints: whether a price is speculative or "ungewöhnlich niedrig" (§ 16d VOB/A) is a
//             judgement of the tendering party, so the check names it and never decides it (warn, not fail).
//
// Isomorph: kein window, keine Aliase.

/** Tolerance for "total ≠ quantity × unit price", euro — same value as the GAEB import (90-03). */
export const PRUEF_TOLERANZ_EUR = 0.02;

/**
 * A unit price is an outlier when it is below `unten` or above `oben` times the reference (median of
 * the other bidders, else the cost-estimate EP) [ASSUMED ±50 %: wide on purpose — single prices spread
 * a lot; the hint is meant to catch shifted prices (Spekulation), not normal competition].
 */
export const AUSREISSER_FAKTOR = Object.freeze({ unten: 0.5, oben: 1.5 });

/**
 * Gap to the next complete offer above which the cheapest offer is flagged for clarification, as a
 * share of the next offer [ASSUMED 0.20 — the "Aufgreifschwelle" used in German procurement case law
 * for § 16d (1) VOB/A lies between 10 and 20 %; 20 % keeps the hint rare].
 */
export const AUFGREIFSCHWELLE = 0.2;

/** Codes of a row or of the whole offer. `befund` = arithmetic, `hinweis` = plausibility. */
export const PRUEF_CODES = Object.freeze({
  ohne_preis: "befund",
  nullpreis: "befund",
  rechenfehler: "befund",
  menge: "befund",
  summe: "befund",
  ausreisser: "hinweis",
  niedrig: "hinweis",
});

const r2 = (v) => Math.round(Number(v) * 100) / 100;
const zahl = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

function median(werte) {
  const s = [...werte].sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Line item of a bid for a position, or null. */
function zeileVon(bid, positionId) {
  return (Array.isArray(bid?.line_items) ? bid.line_items : []).find((l) => l.position_id === positionId) || null;
}

/** Unit price of a bid for a position as a number, null when missing (an empty field is NOT 0). */
function epVon(bid, positionId) {
  const li = zeileVon(bid, positionId);
  return li ? zahl(li.unit_price) : null;
}

/**
 * Recomputed total of a bid with the LV quantities, euro; `vollstaendig` = every position has a price.
 * @param {any} bid
 * @param {Array<{id: string, quantity?: number|null, kennz?: string|null}>} positionen
 * @returns {{summe: number, vollstaendig: boolean, ohnePreis: number}}
 */
export function bidSumme(bid, positionen) {
  let summe = 0, ohnePreis = 0;
  for (const p of positionen) {
    const ep = epVon(bid, p.id);
    if (ep === null) { ohnePreis += 1; continue; }
    // 73-08: a contingency item is priced but not part of the offer sum (VOB).
    if (/bedarf|eventual|withouttotal/i.test(String(p?.kennz || ""))) continue;
    summe += (zahl(p.quantity) ?? 0) * ep;
  }
  return { summe: r2(summe), vollstaendig: ohnePreis === 0, ohnePreis };
}

/**
 * Check one bid against the LV of its tender.
 * @param {{bid: any, positionen: Array<{id: string, oz?: string, title?: string, quantity?: number|null, unit?: string, unit_price?: number|null}>, andere?: Array<any>}} p
 *   positionen = LV positions of the tender (the Preisspiegel rows); andere = the OTHER bids of the tender
 * @returns {{zeilen: Array<{position_id: string, oz: string, title: string, unit: string, menge: number|null, ep: number|null,
 *   gp: number|null, gp_bieter: number|null, menge_bieter: number|null, referenz: number|null, referenz_quelle: "bieter"|"anschlag"|null,
 *   codes: string[]}>, summe: number, summe_bieter: number|null, summe_differenz: number|null, vollstaendig: boolean,
 *   naechstes: number|null, abstand: number|null, gesamtCodes: string[], zaehler: Record<string, number>,
 *   befunde: number, hinweise: number, ergebnis: "ohne_befund"|"mit_befund"}}
 *   summe/gp/referenz in euro; abstand = share of the next complete offer (0.25 = 25 % cheaper)
 */
export function angebotPruefen({ bid, positionen, andere = [] }) {
  const lv = Array.isArray(positionen) ? positionen : [];
  const fremd = (Array.isArray(andere) ? andere : []).filter((b) => b && b.id !== bid?.id);
  /** @type {Record<string, number>} */
  const zaehler = Object.fromEntries(Object.keys(PRUEF_CODES).map((k) => [k, 0]));
  const zeilen = lv.map((p) => {
    const li = zeileVon(bid, p.id);
    const ep = li ? zahl(li.unit_price) : null;
    const menge = zahl(p.quantity);
    const mengeBieter = li ? zahl(li.quantity) : null;
    const gpBieter = li ? zahl(li.total_price) : null;
    /** @type {string[]} */
    const codes = [];
    let referenz = null, quelle = /** @type {"bieter"|"anschlag"|null} */ (null);
    if (ep === null) {
      codes.push("ohne_preis");
    } else {
      if (ep === 0) codes.push("nullpreis");
      // The bidder must not change quantities; the Preisspiegel always uses the LV quantity.
      if (mengeBieter !== null && menge !== null && Math.abs(mengeBieter - menge) > 1e-6) codes.push("menge");
      // The bidder's own line total is checked against HIS quantity (the arithmetic he did), the
      // quantity change itself is a separate finding above.
      const basis = mengeBieter ?? menge;
      if (gpBieter !== null && basis !== null && Math.abs(gpBieter - r2(basis * ep)) > PRUEF_TOLERANZ_EUR) codes.push("rechenfehler");
      // Reference: median of the other bidders when at least two priced this position, else the cost estimate.
      const vergleich = fremd.map((b) => epVon(b, p.id)).filter((v) => v !== null && v > 0);
      if (vergleich.length >= 2) { referenz = median(vergleich); quelle = "bieter"; }
      else if (zahl(p.unit_price) !== null && Number(p.unit_price) > 0) { referenz = Number(p.unit_price); quelle = "anschlag"; }
      if (referenz !== null && ep > 0 && (ep < referenz * AUSREISSER_FAKTOR.unten || ep > referenz * AUSREISSER_FAKTOR.oben)) codes.push("ausreisser");
    }
    for (const c of codes) zaehler[c] += 1;
    return {
      position_id: p.id, oz: String(p.oz ?? ""), title: String(p.title ?? ""), unit: String(p.unit ?? ""),
      menge, ep, gp: ep !== null && menge !== null ? r2(menge * ep) : null, gp_bieter: gpBieter, menge_bieter: mengeBieter,
      referenz: referenz === null ? null : r2(referenz), referenz_quelle: quelle, codes,
    };
  });

  const { summe, vollstaendig } = bidSumme(bid, lv);
  const summeBieter = zahl(bid?.angebotssumme_bieter);
  const summeDifferenz = summeBieter === null ? null : r2(summeBieter - summe);
  /** @type {string[]} */
  const gesamtCodes = [];
  if (summeDifferenz !== null && Math.abs(summeDifferenz) > PRUEF_TOLERANZ_EUR) gesamtCodes.push("summe");

  // Gap to the next complete offer above this one — only meaningful for a complete offer.
  let naechstes = null, abstand = null;
  if (vollstaendig && summe > 0) {
    const hoeher = fremd.map((b) => bidSumme(b, lv)).filter((s) => s.vollstaendig && s.summe > summe).map((s) => s.summe);
    const istGuenstigstes = !fremd.some((b) => { const s = bidSumme(b, lv); return s.vollstaendig && s.summe > 0 && s.summe < summe; });
    if (hoeher.length) {
      naechstes = Math.min(...hoeher);
      abstand = Math.round((naechstes - summe) / naechstes * 10000) / 10000;
      if (istGuenstigstes && abstand > AUFGREIFSCHWELLE) gesamtCodes.push("niedrig");
    }
  }
  for (const c of gesamtCodes) zaehler[c] += 1;

  let befunde = 0, hinweise = 0;
  for (const [k, n] of Object.entries(zaehler)) { if (PRUEF_CODES[k] === "befund") befunde += n; else hinweise += n; }
  return {
    zeilen, summe, summe_bieter: summeBieter, summe_differenz: summeDifferenz, vollstaendig,
    naechstes, abstand, gesamtCodes, zaehler, befunde, hinweise,
    ergebnis: befunde === 0 ? "ohne_befund" : "mit_befund",
  };
}

/**
 * The Prüfvermerk stored on the bid (`bid.pruefung`, new optional field) — a snapshot of the check at
 * the moment the checker signs it, so a later price change shows as "Prüfung veraltet".
 * @param {{ergebnis: ReturnType<typeof angebotPruefen>, pruefer: string, bemerkung?: string, jetzt?: Date}} p
 * @returns {{datum: string, pruefer: string, bemerkung: string, ergebnis: "ohne_befund"|"mit_befund", summe_geprueft: number,
 *   summe_bieter: number|null, befunde: number, hinweise: number, zaehler: Record<string, number>}}
 */
export function pruefvermerk({ ergebnis, pruefer, bemerkung = "", jetzt = new Date() }) {
  return {
    datum: jetzt.toISOString(),
    pruefer: String(pruefer || "").trim(),
    bemerkung: String(bemerkung || "").trim(),
    ergebnis: ergebnis.ergebnis,
    summe_geprueft: ergebnis.summe,
    summe_bieter: ergebnis.summe_bieter,
    befunde: ergebnis.befunde,
    hinweise: ergebnis.hinweise,
    zaehler: { ...ergebnis.zaehler },
  };
}

/**
 * Is a stored Prüfvermerk still valid for the bid as it is now? It is outdated when the recomputed
 * total or the finding count changed since the checker signed it.
 * @param {any} bid
 * @param {ReturnType<typeof angebotPruefen>} jetzt current check result
 * @returns {"keine"|"aktuell"|"veraltet"}
 */
export function pruefStatus(bid, jetzt) {
  const v = bid?.pruefung;
  if (!v || typeof v !== "object") return "keine";
  const gleich = Math.abs(Number(v.summe_geprueft) - jetzt.summe) <= PRUEF_TOLERANZ_EUR && Number(v.befunde) === jetzt.befunde;
  return gleich ? "aktuell" : "veraltet";
}

/**
 * Protocol rows for the CSV export (header + one row per position + total). Codes are written as the
 * German labels passed in, so the CSV reads like the dialog.
 * @param {ReturnType<typeof angebotPruefen>} ergebnis
 * @param {(code: string) => string} label code → printed label
 * @returns {{header: string[], rows: Array<Array<string|number>>}}
 */
export function pruefProtokoll(ergebnis, label) {
  const header = ["OZ", "Position", "Menge LV", "Einheit", "EP", "GP nachgerechnet", "GP Bieter", "Menge Bieter", "Referenz-EP", "Befunde / Hinweise"];
  const leer = (v) => (v === null || v === undefined ? "" : v);
  const rows = ergebnis.zeilen.map((z) => [
    z.oz, z.title, leer(z.menge), z.unit, leer(z.ep), leer(z.gp), leer(z.gp_bieter), leer(z.menge_bieter), leer(z.referenz),
    z.codes.map(label).join("; "),
  ]);
  rows.push(["", "Angebotssumme nachgerechnet (LV-Mengen)", "", "", "", ergebnis.summe, leer(ergebnis.summe_bieter), "", "", ergebnis.gesamtCodes.map(label).join("; ")]);
  return { header, rows };
}
