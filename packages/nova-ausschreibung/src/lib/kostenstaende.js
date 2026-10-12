// kostenstaende.js — the six stages of cost determination after DIN 276:2018-12
// Abschn. 3.4 side by side, with date and source, the change against the previous
// stage and a traffic light against the agreed construction cost ceiling
// (Baukostenobergrenze) — 88-08, RE-22.
//
// Why: CostControl showed the LV estimate, award and billing, and the building-model
// estimate only as a volatile value. Cost estimate (LPH 2) and final cost (LPH 8)
// were missing as own stages, and nothing compared them with a ceiling.
//
// Data contract:
// - KostenStand (new entity, schemaless): {project_id, stufe, betrag (euros net),
//   datum (ISO yyyy-mm-dd), quelle (free text), notiz}. A snapshot per stage; the
//   latest record of a stage (by datum, then created order) is THE value of that stage.
// - Project.baukostenobergrenze: euros net (additive field; null/absent = none agreed).
// - Live values fill a stage only while no record exists (quelle 'live'):
//     kostenschaetzung  ← Project.estimated_cost (existing project field "Kostenschätzung")
//     kostenberechnung  ← building model cost tab (useBuildingProgram().costEstimate.total)
//     kostenvoranschlag ← Σ LV positions quantity × estimate unit price
//     kostenanschlag    ← contract value of awarded positions + estimate of the rest
//                         (the "Prognose" of 90-10 kostenJeKg)
//     kostenfeststellung← billed (measurements × contract EP) + approved change orders,
//                         marked "vorläufig" until a record is written.
//   Stage mapping per DIN 276:2018-12: Kostenvoranschlag = priced LV (3.4.4),
//   Kostenanschlag = offers/contracts (3.4.5). CostControl's older label
//   "Kostenanschlag (LV)" follows DIN 276-1:2008 and is left unchanged.
// - All amounts must share one basis (the office decides, e.g. KG 300+400 net);
//   the module compares numbers, it cannot check the scope behind them.
//
// In:  KostenStand records, the project, live values. Out: rows per stage, the
//      current stage, traffic light. Pure — no React, no API.

/**
 * Stages of cost determination, in order. `label` doubles as i18n key.
 * Sources: DIN 276:2018-12 Abschn. 3.4.1–3.4.6; LPH after HOAI 2021 Anlage 10.1.
 * @type {ReadonlyArray<{key: string, label: string, lph: string, norm: string}>}
 */
export const KOSTEN_STUFEN = Object.freeze([
  Object.freeze({ key: 'kostenrahmen', label: 'Kostenrahmen', lph: 'LPH 1', norm: 'DIN 276 3.4.1' }),
  Object.freeze({ key: 'kostenschaetzung', label: 'Kostenschätzung', lph: 'LPH 2', norm: 'DIN 276 3.4.2' }),
  Object.freeze({ key: 'kostenberechnung', label: 'Kostenberechnung', lph: 'LPH 3', norm: 'DIN 276 3.4.3' }),
  Object.freeze({ key: 'kostenvoranschlag', label: 'Kostenvoranschlag', lph: 'LPH 6', norm: 'DIN 276 3.4.4' }),
  Object.freeze({ key: 'kostenanschlag', label: 'Kostenanschlag', lph: 'LPH 7', norm: 'DIN 276 3.4.5' }),
  Object.freeze({ key: 'kostenfeststellung', label: 'Kostenfeststellung', lph: 'LPH 8', norm: 'DIN 276 3.4.6' }),
]);

/**
 * Traffic light thresholds as share of the ceiling. [ASSUMED] office convention,
 * not from a standard: yellow from 95 %, red above 100 %. Case law grants a
 * tolerance around an agreed ceiling depending on the contract — therefore the
 * light is a hint (warn), never a verdict (fail).
 */
export const AMPEL_SCHWELLEN = Object.freeze({ gelbAb: 0.95, rotUeber: 1.0 });

/**
 * @typedef {object} KostenStandRecord
 * @property {string} [id]
 * @property {string} [project_id]
 * @property {string} stufe one of KOSTEN_STUFEN keys
 * @property {number} betrag euros net
 * @property {string} [datum] ISO date
 * @property {string} [quelle]
 * @property {string} [notiz]
 */

/**
 * @typedef {object} StufenZeile
 * @property {string} key
 * @property {string} label
 * @property {string} lph
 * @property {string} norm
 * @property {number|null} betrag euros net; null = no value
 * @property {'erfasst'|'live'|null} herkunft erfasst = stored snapshot, live = derived now
 * @property {string} quelle German source text (record's quelle or the live source)
 * @property {string|null} datum ISO date of the snapshot (null for live values)
 * @property {boolean} vorlaeufig live final cost (not yet recorded)
 * @property {number|null} deltaVorstufe change against the previous stage with a value, euros
 * @property {number|null} deltaVorstufeAnteil same as share (0.05 = +5 %)
 * @property {number|null} anteilObergrenze betrag / ceiling (1.02 = 102 %)
 * @property {'gruen'|'gelb'|'rot'|null} ampel null without ceiling or value
 */

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const r2 = (v) => Math.round(v * 100) / 100;

/**
 * Traffic light of an amount against the ceiling.
 * @param {number|null} betrag euros
 * @param {number|null} obergrenze euros; null/≤0 = none agreed
 * @returns {'gruen'|'gelb'|'rot'|null}
 */
export function ampel(betrag, obergrenze) {
  const b = num(betrag);
  const o = num(obergrenze);
  if (b === null || o === null || o <= 0) return null;
  const a = b / o;
  if (a > AMPEL_SCHWELLEN.rotUeber) return 'rot';
  if (a >= AMPEL_SCHWELLEN.gelbAb) return 'gelb';
  return 'gruen';
}

/**
 * Latest record per stage (by datum, records without datum count as oldest; equal
 * dates → later in the list wins).
 * @param {KostenStandRecord[]|null|undefined} records
 * @returns {Map<string, KostenStandRecord>}
 */
export function juengsteJeStufe(records) {
  /** @type {Map<string, KostenStandRecord>} */
  const m = new Map();
  for (const r of records || []) {
    if (!r || !KOSTEN_STUFEN.some((s) => s.key === r.stufe) || num(r.betrag) === null) continue;
    const alt = m.get(r.stufe);
    if (!alt || String(r.datum || '') >= String(alt.datum || '')) m.set(r.stufe, r);
  }
  return m;
}

/**
 * Rows of all six stages.
 * @param {{records?: KostenStandRecord[], obergrenze?: number|null,
 *   live?: {kostenschaetzung?: number|null, kostenberechnung?: number|null, kostenvoranschlag?: number|null,
 *     kostenanschlag?: number|null, kostenfeststellung?: number|null}}} p live values in euros net
 * @returns {StufenZeile[]}
 */
export function kostenstaendeZusammenstellen({ records = [], obergrenze = null, live = {} }) {
  const juengste = juengsteJeStufe(records);
  /** @type {Record<string, string>} */
  const liveQuelle = {
    kostenschaetzung: 'Projektangabe „Kostenschätzung“',
    kostenberechnung: 'Gebäudemodell (Kosten-Tab)',
    kostenvoranschlag: 'Bepreistes LV (Σ Menge × Schätzpreis)',
    kostenanschlag: 'Vergabe + offener LV-Anschlag',
    kostenfeststellung: 'Abgerechnet + genehmigte Nachträge',
  };
  /** @type {StufenZeile[]} */
  const zeilen = [];
  let vorher = null;
  for (const s of KOSTEN_STUFEN) {
    const rec = juengste.get(s.key);
    const lv = num(/** @type {Record<string, any>} */ (live)[s.key]);
    // A live value of 0 € means "nothing there yet" (empty LV, nothing billed) — not a stage value.
    const liveWert = lv !== null && lv !== 0 ? lv : null;
    const betrag = rec ? /** @type {number} */ (num(rec.betrag)) : liveWert;
    const herkunft = rec ? 'erfasst' : liveWert !== null ? 'live' : null;
    const z = {
      key: s.key, label: s.label, lph: s.lph, norm: s.norm,
      betrag: betrag === null ? null : r2(betrag),
      herkunft: /** @type {'erfasst'|'live'|null} */ (herkunft),
      quelle: rec ? String(rec.quelle || 'erfasst') : herkunft === 'live' ? liveQuelle[s.key] : '',
      datum: rec ? (rec.datum || null) : null,
      vorlaeufig: s.key === 'kostenfeststellung' && herkunft === 'live',
      deltaVorstufe: null, deltaVorstufeAnteil: null,
      anteilObergrenze: null, ampel: /** @type {'gruen'|'gelb'|'rot'|null} */ (null),
    };
    if (betrag !== null && vorher !== null) {
      z.deltaVorstufe = r2(betrag - vorher);
      z.deltaVorstufeAnteil = vorher !== 0 ? Math.round(((betrag - vorher) / vorher) * 10000) / 10000 : null;
    }
    const o = num(obergrenze);
    if (betrag !== null && o !== null && o > 0) {
      z.anteilObergrenze = Math.round((betrag / o) * 10000) / 10000;
      z.ampel = ampel(betrag, o);
    }
    if (betrag !== null) vorher = betrag;
    zeilen.push(z);
  }
  return zeilen;
}

/**
 * The current cost stage = the latest stage in the order that has a value.
 * @param {StufenZeile[]} zeilen
 * @returns {StufenZeile|null}
 */
export function aktuellerStand(zeilen) {
  for (let i = (zeilen || []).length - 1; i >= 0; i -= 1) if (zeilen[i].betrag !== null) return zeilen[i];
  return null;
}

/**
 * Record to create when a stage is written (snapshot). Validates stage and amount.
 * @param {{projectId: string, stufe: string, betrag: unknown, datum?: string, quelle?: string, notiz?: string}} p
 *   betrag in euros net (number or numeric text); datum ISO date (default today)
 * @returns {KostenStandRecord & {project_id: string}}
 * @throws {Error} unknown stage or amount not a number (German message for the UI)
 */
export function kostenStandRecord({ projectId, stufe, betrag, datum, quelle = 'erfasst', notiz = '' }) {
  if (!KOSTEN_STUFEN.some((s) => s.key === stufe)) throw new Error(`Unbekannte Kostenstufe: ${stufe}`);
  const b = num(typeof betrag === 'string' ? betrag.replace(',', '.') : betrag);
  if (b === null) throw new Error('Betrag fehlt oder ist keine Zahl');
  const d = typeof datum === 'string' && /^\d{4}-\d{2}-\d{2}/.test(datum) ? datum.slice(0, 10) : new Date().toISOString().slice(0, 10);
  return { project_id: projectId, stufe, betrag: r2(b), datum: d, quelle: String(quelle || 'erfasst'), notiz: String(notiz || '') };
}
