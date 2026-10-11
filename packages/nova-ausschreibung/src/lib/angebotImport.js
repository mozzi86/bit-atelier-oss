// 90-03: import a bidder's GAEB offer (DA XML X84 Angebotsabgabe, also X86) into the Preisspiegel of
// a tender. Council 10.10.2026 (HANDOFF-SKILLS-INTEGRATION §3): the app read GAEB requests (X83/D83)
// but not the PRICES of an offer — the chain "offer → check → award proposal" broke at the first step.
//
// In:  readX83 result of the offer file (positionen with unit_price/total_price, bieter), the LV
//      positions of the tender (AVA entities { id, oz, title, quantity, unit }), the AVA contacts.
// Out: pure functions — the assignment by Ordnungszahl with every deviation named (missing price,
//      unknown position, quantity changed by the bidder, total ≠ quantity × unit price), the matched
//      contact, and the Bid record the AVA stores (same shape as "Angebot erfassen" in PriceComparison).
// A missing price stays MISSING in the bid (no line item) — it is never written as 0; a 0,00 € unit
// price that the bidder really wrote stays 0 and is flagged.
//
// Isomorph: kein window, keine Aliase (wie gaebXmlRead.js).

/** Tolerance for "total ≠ quantity × unit price", euro [ASSUMED 0,01 € + rounding of the bidder]. */
export const GP_TOLERANZ_EUR = 0.02;

/** Ordnungszahl for matching: digits and letters only, upper case ("01.01.0010" ≡ "01010010"). */
export function ozSchluessel(oz) {
  return String(oz ?? "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();
}

const r2 = (v) => Math.round(Number(v) * 100) / 100;

/**
 * Assign the offer's positions to the tender's LV positions by Ordnungszahl.
 * @param {Array<{oz: string, title?: string, short_text?: string, quantity?: number|null, unit?: string, unit_price?: number|null, total_price?: number|null}>} angebot readX83(...).positionen
 * @param {Array<{id: string, oz: string, title?: string, quantity?: number|null, unit?: string}>} lv LV positions of the tender
 * @returns {{zeilen: Array<{position_id: string, oz: string, title: string, unit_price: number|null, gp_angebot: number|null, gp_gerechnet: number|null, menge_lv: number|null, menge_angebot: number|null, hinweise: string[]}>,
 *            ohnePreis: Array<{position_id: string, oz: string, title: string}>, unbekannt: Array<{oz: string, title: string}>,
 *            mengeAbweichend: number, gpAbweichend: number, nullpreise: number, summe: number}}
 */
export function angebotZuordnen(angebot, lv) {
  const lvListe = Array.isArray(lv) ? lv : [];
  const lvJeOz = new Map(lvListe.map((p) => [ozSchluessel(p.oz), p]));
  const offer = new Map();
  /** @type {Array<{oz: string, title: string}>} */
  const unbekannt = [];
  for (const a of Array.isArray(angebot) ? angebot : []) {
    const k = ozSchluessel(a.oz);
    if (lvJeOz.has(k)) offer.set(k, a);
    else unbekannt.push({ oz: String(a.oz ?? ""), title: String(a.title || a.short_text || "") });
  }
  const zeilen = [];
  const ohnePreis = [];
  let mengeAbweichend = 0, gpAbweichend = 0, nullpreise = 0, summe = 0;
  for (const p of lvListe) {
    const a = offer.get(ozSchluessel(p.oz));
    const ep = a && a.unit_price !== null && a.unit_price !== undefined && Number.isFinite(Number(a.unit_price)) ? Number(a.unit_price) : null;
    if (ep === null) { ohnePreis.push({ position_id: p.id, oz: p.oz, title: String(p.title || "") }); continue; }
    const hinweise = [];
    const mLv = p.quantity === null || p.quantity === undefined ? null : Number(p.quantity);
    const mAng = a.quantity === null || a.quantity === undefined ? null : Number(a.quantity);
    // The bidder must not change quantities; a difference is named (the LV quantity counts in the Preisspiegel).
    if (mLv !== null && mAng !== null && Math.abs(mLv - mAng) > 1e-6) { hinweise.push(`Menge im Angebot ${mAng} statt ${mLv} — es zählt die LV-Menge`); mengeAbweichend += 1; }
    const gpGerechnet = mLv === null ? null : r2(mLv * ep);
    const gpAng = a.total_price === null || a.total_price === undefined ? null : Number(a.total_price);
    // The offer's own total may be computed from the bidder's quantity — check against that one.
    const gpBasis = mAng !== null ? r2(mAng * ep) : gpGerechnet;
    if (gpAng !== null && gpBasis !== null && Math.abs(gpAng - gpBasis) > GP_TOLERANZ_EUR) { hinweise.push(`Gesamtbetrag ${r2(gpAng)} € ≠ Menge × EP ${gpBasis} €`); gpAbweichend += 1; }
    if (ep === 0) { hinweise.push("Einheitspreis 0,00 € — im Angebot so angegeben, prüfen"); nullpreise += 1; }
    if (gpGerechnet !== null) summe += gpGerechnet;
    zeilen.push({ position_id: p.id, oz: p.oz, title: String(p.title || ""), unit_price: ep, gp_angebot: gpAng, gp_gerechnet: gpGerechnet, menge_lv: mLv, menge_angebot: mAng, hinweise });
  }
  return { zeilen, ohnePreis, unbekannt, mengeAbweichend, gpAbweichend, nullpreise, summe: r2(summe) };
}

/**
 * Find the AVA contact of the bidder: exact company/name match first (case-insensitive, spaces and
 * legal-form punctuation ignored), else null — the user picks; a guess would award the wrong firm.
 * @param {{name?: string|null}|null} bieter readX83(...).bieter
 * @param {Array<{id: string, company?: string, name?: string}>} kontakte
 * @returns {string|null} contact id
 */
export function bieterKontakt(bieter, kontakte) {
  const norm = (s) => String(s || "").toLowerCase().replace(/[\s.,&+-]+/g, "");
  const n = norm(bieter?.name);
  if (!n) return null;
  const k = (Array.isArray(kontakte) ? kontakte : []).find((c) => norm(c.company) === n || norm(c.name) === n);
  return k ? k.id : null;
}

/**
 * The Bid record for onCreateBid (same shape as "Angebot erfassen"): only positions WITH a price get a
 * line item; the note names file, date and what is missing, so nobody mistakes a gap for a full offer.
 * @param {{tender: {id: string, project_id?: string}, zuordnung: ReturnType<typeof angebotZuordnen>, contact_id: string, bieterName: string, datei: string, jetzt?: Date}} p
 * @returns {{tender_id: string, project_id: string|undefined, contact_id: string, bidder_name: string, submitted_date: string, status: string, note: string, quelle: string, line_items: Array<{position_id: string, unit_price: number, total_price?: number, quantity?: number}>}}
 */
export function angebotAlsBid({ tender, zuordnung, contact_id, bieterName, datei, jetzt = new Date() }) {
  const teile = [`GAEB-Import ${datei}`];
  if (zuordnung.ohnePreis.length) teile.push(`${zuordnung.ohnePreis.length} Position(en) ohne Preis`);
  if (zuordnung.unbekannt.length) teile.push(`${zuordnung.unbekannt.length} Position(en) nicht im LV`);
  if (zuordnung.mengeAbweichend) teile.push(`${zuordnung.mengeAbweichend} Mengenabweichung(en)`);
  if (zuordnung.gpAbweichend) teile.push(`${zuordnung.gpAbweichend} Rechenabweichung(en)`);
  return {
    tender_id: tender.id,
    project_id: tender.project_id,
    contact_id,
    bidder_name: bieterName || "Bieter",
    submitted_date: jetzt.toISOString(),
    status: "submitted",
    note: teile.join(" · "),
    quelle: "gaeb_x84",
    // 90-04: the bidder's own line total and quantity travel along (optional fields), so the offer check
    // can recompute "quantity × EP = GP" later for imported offers too — the Preisspiegel ignores them.
    line_items: zuordnung.zeilen.map((z) => ({
      position_id: z.position_id, unit_price: /** @type {number} */ (z.unit_price),
      ...(z.gp_angebot !== null ? { total_price: z.gp_angebot } : {}),
      ...(z.menge_angebot !== null ? { quantity: z.menge_angebot } : {}),
    })),
  };
}
