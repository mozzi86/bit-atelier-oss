// nachtragPruefpfad.js — review path of a change order (Nachtrag) under VOB/B § 2
// Abs. 5 / Abs. 6 (88-03, RE-16): kind, announcement, the three amounts
// demanded → checked → released, and the reference to the contractor's original
// calculation (Urkalkulation).
//
// Why: a ChangeOrder carried only one amount (cost_impact). The site management
// works with three — what the contractor demands, what the architect checked,
// what the client released — and the VOB/B attaches consequences to the kind of
// change and to the announcement before execution. This module is the one rule
// for those fields; nachtraege.js (72-14) stays the rule for project scope and
// status lifecycle.
//
// Data contract — additive on ChangeOrder, schemaless, no migration, no renamed
// field (legacy records simply have no review path):
// - art: 'leistungsaenderung' (§ 2 Abs. 5) | 'zusatzleistung' (§ 2 Abs. 6) |
//   'sonstige' | null (not classified).
// - angekuendigt_am: ISO date (yyyy-mm-dd) of the contractor's announcement of
//   the claim; null = not announced / unknown.
// - ankuendigung_vor_ausfuehrung: true | false | null (unknown).
// - betrag_gefordert / betrag_geprueft / betrag_freigegeben: euros net, null =
//   not given (never 0 by default — 0 € is a real amount).
// - urkalkulation_ref: free text, e.g. "Urkalkulation Pos. 02.0010" ('' = none).
// - cost_impact stays THE effective amount that every existing sum reads
//   (Finance, AVA settlement, kostenJeKg, preisschichten). Once one of the three
//   amounts is set, cost_impact is derived from them (wirksamerBetrag) — so those
//   readers need no change and never see two truths.
//
// In:  ChangeOrder records, form values. Out: labels, findings, sums in euros,
//      update patches. Pure — no DOM, no React, no API — runs under Node.
//
// Legal note: the texts paraphrase VOB/B (2016) § 2 Abs. 5 and Abs. 6. They are
// hints for the site management, not a legal assessment.

/**
 * Change order kinds with their VOB/B source. `label` doubles as i18n key.
 * @type {ReadonlyArray<{key: string, label: string, quelle: string}>}
 */
export const NACHTRAG_ARTEN = Object.freeze([
  Object.freeze({ key: 'leistungsaenderung', label: 'Leistungsänderung', quelle: 'VOB/B § 2 Abs. 5' }),
  Object.freeze({ key: 'zusatzleistung', label: 'Zusätzliche Leistung', quelle: 'VOB/B § 2 Abs. 6' }),
  Object.freeze({ key: 'sonstige', label: 'Sonstige / nicht zugeordnet', quelle: '' }),
]);

/** Field names of the review path (for patches and tests). */
export const PRUEFPFAD_FELDER = Object.freeze([
  'art', 'angekuendigt_am', 'ankuendigung_vor_ausfuehrung',
  'betrag_gefordert', 'betrag_geprueft', 'betrag_freigegeben', 'urkalkulation_ref',
]);

/**
 * @typedef {object} PruefpfadNachtrag
 * @property {string} [id]
 * @property {string} [title]
 * @property {string} [status]
 * @property {number|null} [cost_impact] euros
 * @property {string|null} [art]
 * @property {string|null} [angekuendigt_am] ISO date
 * @property {boolean|null} [ankuendigung_vor_ausfuehrung]
 * @property {number|null} [betrag_gefordert] euros net
 * @property {number|null} [betrag_geprueft] euros net
 * @property {number|null} [betrag_freigegeben] euros net
 * @property {string} [urkalkulation_ref]
 */

/**
 * @typedef {object} PruefHinweis
 * @property {string} code stable id, e.g. "ankuendigung_fehlt"
 * @property {'warn'|'hinweis'} stufe warn = possible loss of money/claim, hinweis = missing documentation
 * @property {string} text German text (doubles as i18n key)
 */

/**
 * Amount in euros or null. Accepts numbers and numeric strings (form input);
 * '' / null / undefined / garbage → null (never 0).
 * @param {unknown} v
 * @returns {number|null}
 */
export function betragOderNull(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/**
 * Label of a kind, '' for null, the raw value for unknown kinds.
 * @param {unknown} art
 * @returns {string}
 */
export function nachtragArtLabel(art) {
  if (art === null || art === undefined || art === '') return '';
  const a = NACHTRAG_ARTEN.find((x) => x.key === art);
  return a ? a.label : String(art);
}

/**
 * Whether the record carries a review path (any of the three amounts or a kind).
 * Legacy records (only cost_impact) return false.
 * @param {PruefpfadNachtrag|null|undefined} o
 * @returns {boolean}
 */
export function hatPruefpfad(o) {
  if (!o) return false;
  return betragOderNull(o.betrag_gefordert) !== null
    || betragOderNull(o.betrag_geprueft) !== null
    || betragOderNull(o.betrag_freigegeben) !== null
    || (typeof o.art === 'string' && o.art !== '');
}

/**
 * The effective amount of a change order in euros — the value every sum reads.
 * Approved/completed: released ?? checked ?? demanded; undecided: checked ??
 * demanded (the usual cost forecast uses the checked amount [ASSUMED], the
 * released one does not exist yet). Without any of the three amounts: the stored
 * cost_impact (legacy). null = not quantified.
 * @param {PruefpfadNachtrag|null|undefined} o
 * @returns {number|null} euros
 */
export function wirksamerBetrag(o) {
  if (!o) return null;
  const g = betragOderNull(o.betrag_gefordert);
  const p = betragOderNull(o.betrag_geprueft);
  const f = betragOderNull(o.betrag_freigegeben);
  if (g === null && p === null && f === null) return betragOderNull(o.cost_impact);
  const entschieden = o.status === 'approved' || o.status === 'completed';
  if (entschieden) return f ?? p ?? g;
  return p ?? g ?? f;
}

/**
 * Review findings of one change order. All are warn/hinweis, never fail: the
 * VOB/B consequences have exceptions in case law (e.g. the announcement under
 * § 2 Abs. 6 Nr. 1 S. 2 is dispensable when the client knew the extra work was
 * paid work), so the program must not decide a claim — it flags, the site
 * management judges (liability decision, see CLAUDE.md "Checks").
 * Rejected change orders get no findings (nothing left to decide).
 * @param {PruefpfadNachtrag|null|undefined} o
 * @returns {PruefHinweis[]}
 */
export function pruefHinweise(o) {
  /** @type {PruefHinweis[]} */
  const h = [];
  if (!o || o.status === 'rejected') return h;
  const g = betragOderNull(o.betrag_gefordert);
  const p = betragOderNull(o.betrag_geprueft);
  const f = betragOderNull(o.betrag_freigegeben);
  if (!hatPruefpfad(o)) return h;
  if (!o.art) {
    h.push({ code: 'art_fehlt', stufe: 'hinweis', text: 'Art nicht zugeordnet (VOB/B § 2 Abs. 5 oder Abs. 6)' });
  }
  if (o.art === 'zusatzleistung') {
    // VOB/B § 2 Abs. 6 Nr. 1 S. 2: the claim must be announced BEFORE execution starts.
    if (!o.angekuendigt_am || o.ankuendigung_vor_ausfuehrung === false) {
      h.push({ code: 'ankuendigung_fehlt', stufe: 'warn', text: 'Zusätzliche Leistung ohne Ankündigung vor Ausführung — Vergütungsanspruch kann entfallen (VOB/B § 2 Abs. 6 Nr. 1 S. 2)' });
    } else if (o.ankuendigung_vor_ausfuehrung == null) {
      h.push({ code: 'ankuendigung_zeitpunkt', stufe: 'hinweis', text: 'Ankündigung erfasst, aber nicht bestätigt, dass sie vor Ausführung lag' });
    }
  }
  if ((o.art === 'leistungsaenderung' || o.art === 'zusatzleistung') && !String(o.urkalkulation_ref || '').trim()) {
    // § 2 Abs. 5: new price "unter Berücksichtigung der Mehr- oder Minderkosten";
    // § 2 Abs. 6 Nr. 2: "nach den Grundlagen der Preisermittlung für die vertragliche Leistung".
    h.push({ code: 'urkalkulation_fehlt', stufe: 'hinweis', text: 'Preisgrundlage fehlt — Bezug zur Urkalkulation oder Vertragsposition angeben (VOB/B § 2 Abs. 5 / Abs. 6 Nr. 2)' });
  }
  if (g === null && (p !== null || f !== null)) {
    h.push({ code: 'forderung_fehlt', stufe: 'hinweis', text: 'Geforderter Betrag fehlt — Prüfung ohne Forderung nicht nachvollziehbar' });
  }
  if (g !== null && p !== null && p > g) {
    h.push({ code: 'geprueft_ueber_forderung', stufe: 'warn', text: 'Geprüfter Betrag liegt über der Forderung' });
  }
  if (f !== null && p !== null && f > p) {
    h.push({ code: 'freigabe_ueber_pruefung', stufe: 'warn', text: 'Freigegebener Betrag liegt über dem geprüften Betrag' });
  }
  const entschieden = o.status === 'approved' || o.status === 'completed';
  if (entschieden && p === null) {
    h.push({ code: 'freigabe_ohne_pruefung', stufe: 'warn', text: 'Genehmigt ohne geprüften Betrag' });
  }
  return h;
}

/**
 * Sums of the three amounts over a list (already scoped to one project).
 * - gefordert: all not rejected change orders with a demanded amount.
 * - geprueft: all not rejected change orders with a checked amount.
 * - freigegeben: approved/completed change orders (released ?? checked ?? demanded,
 *   i.e. wirksamerBetrag — what the contract sum counts).
 * - kuerzung: Σ (demanded − checked) over orders that have both — the reduction
 *   achieved by the review; quote = Σ checked / Σ demanded over the same orders.
 * - ohnePruefpfad: legacy records (only cost_impact) — counted, never mixed in.
 * @param {PruefpfadNachtrag[]|null|undefined} orders
 * @returns {{gefordert: number, geprueft: number, freigegeben: number, kuerzung: number,
 *   quote: number|null, anzahl: number, mitPruefpfad: number, ohnePruefpfad: number,
 *   warnungen: number, hinweise: number}} amounts in euros; quote as share 0…1 (null without pairs)
 */
export function pruefpfadSummen(orders) {
  const s = { gefordert: 0, geprueft: 0, freigegeben: 0, kuerzung: 0, quote: /** @type {number|null} */ (null), anzahl: 0, mitPruefpfad: 0, ohnePruefpfad: 0, warnungen: 0, hinweise: 0 };
  if (!Array.isArray(orders)) return s;
  let paarG = 0;
  let paarP = 0;
  for (const o of orders) {
    if (!o || o.status === 'rejected') continue;
    s.anzahl += 1;
    if (!hatPruefpfad(o)) { s.ohnePruefpfad += 1; continue; }
    s.mitPruefpfad += 1;
    const g = betragOderNull(o.betrag_gefordert);
    const p = betragOderNull(o.betrag_geprueft);
    if (g !== null) s.gefordert += g;
    if (p !== null) s.geprueft += p;
    if (g !== null && p !== null) { paarG += g; paarP += p; s.kuerzung += g - p; }
    if (o.status === 'approved' || o.status === 'completed') s.freigegeben += wirksamerBetrag(o) ?? 0;
    for (const x of pruefHinweise(o)) {
      if (x.stufe === 'warn') s.warnungen += 1; else s.hinweise += 1;
    }
  }
  s.quote = paarG !== 0 ? Math.round((paarP / paarG) * 10000) / 10000 : null;
  const r2 = (v) => Math.round(v * 100) / 100;
  s.gefordert = r2(s.gefordert); s.geprueft = r2(s.geprueft); s.freigegeben = r2(s.freigegeben); s.kuerzung = r2(s.kuerzung);
  return s;
}

/**
 * Record fields of the review path from form values, plus the derived
 * cost_impact when any amount is given (see data contract). Without any of the
 * three amounts cost_impact is NOT part of the result — the caller keeps its own.
 * @param {{art?: string|null, angekuendigt_am?: string|null, ankuendigung_vor_ausfuehrung?: boolean|string|null,
 *   betrag_gefordert?: unknown, betrag_geprueft?: unknown, betrag_freigegeben?: unknown,
 *   urkalkulation_ref?: string|null}} werte form values (amounts as text or number, euros)
 * @param {string} [status] status the record will have (decides the effective amount)
 * @returns {Record<string, any>} fields to merge into the record
 */
export function pruefpfadFelder(werte, status = 'pending') {
  const w = werte || {};
  const vor = w.ankuendigung_vor_ausfuehrung;
  /** @type {Record<string, any>} */
  const felder = {
    art: NACHTRAG_ARTEN.some((a) => a.key === w.art) ? w.art : null,
    angekuendigt_am: typeof w.angekuendigt_am === 'string' && /^\d{4}-\d{2}-\d{2}/.test(w.angekuendigt_am) ? w.angekuendigt_am.slice(0, 10) : null,
    ankuendigung_vor_ausfuehrung: vor === true || vor === 'ja' ? true : vor === false || vor === 'nein' ? false : null,
    betrag_gefordert: betragOderNull(w.betrag_gefordert),
    betrag_geprueft: betragOderNull(w.betrag_geprueft),
    betrag_freigegeben: betragOderNull(w.betrag_freigegeben),
    urkalkulation_ref: String(w.urkalkulation_ref ?? '').trim(),
  };
  if (felder.betrag_gefordert !== null || felder.betrag_geprueft !== null || felder.betrag_freigegeben !== null) {
    felder.cost_impact = wirksamerBetrag({ ...felder, status });
  }
  return felder;
}

/**
 * Extra fields for a status change (merged into nachtraege.statusWechsel's patch).
 * On approval of a change order WITH review path: betrag_freigegeben defaults to
 * checked ?? demanded when empty, and cost_impact follows the released amount.
 * Any other transition, or a legacy record, returns {} (nothing changes).
 * @param {PruefpfadNachtrag|null|undefined} o
 * @param {string} neu target status
 * @returns {{betrag_freigegeben?: number|null, cost_impact?: number|null}}
 */
export function freigabeFelder(o, neu) {
  if (!o || neu !== 'approved' || !hatPruefpfad(o)) return {};
  const f = betragOderNull(o.betrag_freigegeben)
    ?? betragOderNull(o.betrag_geprueft)
    ?? betragOderNull(o.betrag_gefordert);
  if (f === null) return {};
  return { betrag_freigegeben: f, cost_impact: f };
}
