// Logic of the bidder portal (Phase 74-01 Task 14): what an external role sees
// and how its bid is composed. Pure — the screen is src/pages/BieterPortal.jsx.
//
// The portal reads ONLY what the database releases to an external role
// (0011): TenderFreigabe and MengenFreigabe projections, the bidder's own Bid
// and BcfRueckfrage rows. It never asks for Tender, LVPosition, Contact or
// ChangeOrder — not because they would leak (RLS returns nothing), but so the
// network log of the portal proves it (74-01 verification).
//
// Bid shape matches PriceComparison.jsx:118-131, so the office's price
// comparison reads a portal bid like a paper bid after the opening:
//   line_items: [{ position_id: <LVPosition id>, unit_price: <euro> }]
// The projection carries the original position id as `lv_id` (0012).
//
// In:  released rows, entered prices. Out: grouped tenders, bid draft. No imports.

/**
 * @typedef {{ id: string, tender_id?: string, project_id?: string, name?: string, trade?: string, frist?: string }} TenderFreigabe
 *   project_id: the 0012 whitelist must carry it — a question (BcfRueckfrage)
 *   is only accepted for a project the bidder has access to (0011)
 * @typedef {{ id: string, tender_id?: string, vergabe_id?: string, lv_id?: string, oz?: string,
 *   kurztext?: string, quantity?: number|string, unit?: string }} MengenFreigabe
 * @typedef {{ id: string, tender_id?: string, status?: string, total?: number,
 *   line_items?: Array<{position_id: string, unit_price: number}>, submitted_date?: string,
 *   created_date?: string }} Gebot
 */

/** Rounds to cents (euro amounts). @param {number} n @returns {number} */
const cent = (n) => Math.round(n * 100) / 100;

/**
 * Parses a price as typed by a German user: "1.234,50", "12,5", "12.5", " 7 ".
 * @param {unknown} eingabe
 * @returns {number|null} euro, null when empty or not a non-negative number
 */
export function preisLesen(eingabe) {
  if (typeof eingabe === 'number') return Number.isFinite(eingabe) && eingabe >= 0 ? eingabe : null;
  const s = String(eingabe ?? '').trim().replace(/\s/g, '');
  if (!s) return null;
  // German thousands dots before a decimal comma. Without a comma, dots in
  // groups of exactly three digits ("1.000", "12.500.000") are thousands too —
  // reading "1.000" as 1.0 would let a bidder offer a thousandth of the price
  // without noticing. Any other single dot ("12.5") is a decimal point.
  const norm = s.includes(',')
    ? s.replace(/\./g, '').replace(',', '.')
    : /^\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, '') : s;
  if (!/^\d+(\.\d+)?$/.test(norm)) return null;
  const n = Number(norm);
  return Number.isFinite(n) ? n : null;
}

/**
 * Tender id of a projection row: the projection names the ORIGINAL tender id
 * in its data (tender_id), the row column is vergabe_id.
 * @param {{ tender_id?: string, vergabe_id?: string }} zeile
 * @returns {string}
 */
export function vergabeVon(zeile) {
  return String(zeile?.tender_id || zeile?.vergabe_id || '');
}

/**
 * Groups what the portal shows per tender: the released tender, its released
 * quantities (by OZ), and the bidder's own bid if there is one.
 * @param {TenderFreigabe[]} vergaben
 * @param {MengenFreigabe[]} mengen
 * @param {Gebot[]} gebote the caller's own bids (RLS returns no others)
 * @returns {Array<{ vergabe: TenderFreigabe, mengen: MengenFreigabe[], gebot: Gebot|null }>}
 */
export function portalVergaben(vergaben = [], mengen = [], gebote = []) {
  return vergaben
    .map((v) => {
      const id = vergabeVon(v);
      return {
        vergabe: v,
        mengen: mengen
          .filter((m) => vergabeVon(m) === id)
          .sort((a, b) => String(a.oz || '').localeCompare(String(b.oz || ''), 'de', { numeric: true })),
        gebot: gebote.find((g) => String(g.tender_id || '') === id) || null,
      };
    })
    .sort((a, b) => String(a.vergabe.frist || '').localeCompare(String(b.vergabe.frist || '')));
}

/**
 * State of a deadline.
 * @param {string|undefined} frist ISO date-time
 * @param {Date} [jetzt]
 * @returns {'laeuft'|'abgelaufen'|'unbekannt'}
 */
export function fristStatus(frist, jetzt = new Date()) {
  const t = frist ? Date.parse(frist) : NaN;
  if (!Number.isFinite(t)) return 'unbekannt';
  return t > jetzt.getTime() ? 'laeuft' : 'abgelaufen';
}

/**
 * Composes a bid from the entered unit prices. Every released position needs a
 * price — an incomplete bid is refused here rather than silently totalled low.
 * @param {MengenFreigabe[]} mengen released quantities of ONE tender
 * @param {Record<string, unknown>} preise unit price per projection id (euro, as typed)
 * @returns {{ ok: boolean, fehlend: string[], line_items: Array<{position_id: string, unit_price: number}>,
 *   total: number }} total in euro, rounded to cents; fehlend = OZ (or id) without a valid price
 */
export function gebotAusPreisen(mengen = [], preise = {}) {
  const fehlend = [];
  const line_items = [];
  let total = 0;
  for (const m of mengen) {
    const preis = preisLesen(preise[m.id]);
    if (preis === null) {
      fehlend.push(String(m.oz || m.id));
      continue;
    }
    line_items.push({ position_id: String(m.lv_id || m.id), unit_price: preis });
    total += preis * (Number(m.quantity) || 0);
  }
  return { ok: fehlend.length === 0 && mengen.length > 0, fehlend, line_items, total: cent(total) };
}
