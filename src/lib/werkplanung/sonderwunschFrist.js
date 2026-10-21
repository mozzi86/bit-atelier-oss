// sonderwunschFrist.js — decision deadline of special requests from the construction schedule
// (99-03). The latest release date per apartment × trade = start of that trade in the
// apartment's construction section (ScheduleTask, the rows the 89-06 timeline reads) minus
// FRIST_VORLAUF_TAGE. One deadline for everything (D-P99-02/03: 4 weeks, no trade-specific
// lead times). Nothing is stored: the deadline is recomputed from the schedule on every read,
// so it moves with every rescheduled task. A request keeps the deadline of its request day
// (frist_bei_anfrage) only to show how far it moved.
//
// Traffic light per request and per apartment:
//   gruen = decided and done (worked in, accepted, rejected) or nothing requested,
//   gelb  = deadline running (undecided, today ≤ deadline) or released but not yet worked in,
//   rot   = undecided and the deadline passed — the trade starts in less than 4 weeks;
//           "too late" means: reject, or accept as change order with rework/schedule risk,
//   offen = undecided and no deadline computable (no task of that trade in the schedule).
//
// In:  ScheduleTask rows ({gewerk_lb?, trade?, bauabschnitt?, area?, start_date}), apartments,
//      requests, today 'YYYY-MM-DD'. Out: deadlines, lights, the matrix apartment × trade.
// Pure — no React, no API.

import { abschnittVon, OHNE_ABSCHNITT } from "@/lib/planung/zeitstrahl.js";
import { STLB_LB } from "@core/lib/bauteil/gewerke.js";
import { OFFEN } from "./sonderwunsch.js";

/** Lead time before the start of a trade, days (D-P99-02/03: 4 weeks for every trade). */
export const FRIST_VORLAUF_TAGE = 28;

/** Severity order of the lights (worst last). */
const AMPEL_RANG = Object.freeze({ gruen: 0, offen: 1, gelb: 2, rot: 3 });

/** @typedef {'gruen'|'gelb'|'rot'|'offen'} Ampel */
/**
 * @typedef {{frist: string, beginn: string, basis: 'abschnitt'|'projekt', vorgaenge: string[]}} Frist
 *   frist/beginn 'YYYY-MM-DD'; basis: start taken from the apartment's section or (no section /
 *   no task there) the earliest start of the trade in the whole project
 */

const TAG_MS = 86400000;

/** 'YYYY-MM-DD' of an ISO date/date-time string, or null. */
const tag = (/** @type {unknown} */ v) => {
  const s = String(v || "");
  return /^\d{4}-\d{2}-\d{2}/.test(s) && Number.isFinite(Date.parse(s.slice(0, 10))) ? s.slice(0, 10) : null;
};

/**
 * Date plus/minus days, calendar days in UTC (no time-zone drift on a date-only value).
 * @param {string} iso 'YYYY-MM-DD'
 * @param {number} tage days (negative = earlier)
 * @returns {string} 'YYYY-MM-DD'
 */
export function plusTageIso(iso, tage) {
  return new Date(Date.parse(iso) + tage * TAG_MS).toISOString().slice(0, 10);
}

/**
 * Days from a to b (b − a), calendar days.
 * @param {string} a 'YYYY-MM-DD'
 * @param {string} b 'YYYY-MM-DD'
 * @returns {number}
 */
export function tageBis(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / TAG_MS);
}

/**
 * Whether a schedule task belongs to a trade: its STLB code (89-05 field gewerk_lb) or, for
 * older tasks without code, a free-text trade equal to the code or the catalogue name
 * (case-insensitive) [ASSUMED: no fuzzy matching — a wrong match would set a wrong deadline].
 * @param {{gewerk_lb?: string, trade?: string}} task
 * @param {string} lb STLB-Bau LB code
 * @returns {boolean}
 */
export function gehoertZuGewerk(task, lb) {
  if (!lb) return false;
  if (task?.gewerk_lb) return String(task.gewerk_lb) === lb;
  const t = String(task?.trade || "").trim().toLowerCase();
  if (!t) return false;
  const name = STLB_LB.find((g) => g.lb === lb)?.name.toLowerCase();
  return t === lb || t === name;
}

/**
 * Start of a trade for one apartment and its deadline. Section first: tasks of the trade in
 * the apartment's construction section; without section or without a task there, the earliest
 * start of the trade in the project (the strictest deadline — never a later one by guessing).
 * @param {Array<any>} tasks ScheduleTask rows of the project
 * @param {string} lb STLB-Bau LB code of the trade
 * @param {string} [bauabschnitt] construction section of the apartment
 * @returns {Frist|null} null when no task of the trade has a valid start
 */
export function fristFuer(tasks, lb, bauabschnitt = "") {
  const passend = (tasks || []).filter((t) => gehoertZuGewerk(t, lb) && tag(t?.start_date));
  if (!passend.length) return null;
  const ab = String(bauabschnitt || "").trim();
  const imAbschnitt = ab ? passend.filter((t) => abschnittVon(t) === ab && ab !== OHNE_ABSCHNITT) : [];
  const basis = imAbschnitt.length ? "abschnitt" : "projekt";
  const auswahl = imAbschnitt.length ? imAbschnitt : passend;
  const beginn = auswahl.map((t) => /** @type {string} */ (tag(t.start_date))).sort()[0];
  const vorgaenge = auswahl.filter((t) => tag(t.start_date) === beginn).map((t) => String(t?.name || ""));
  return { frist: plusTageIso(beginn, -FRIST_VORLAUF_TAGE), beginn, basis, vorgaenge };
}

/**
 * Light of one request at a date.
 * @param {{status?: string}} sw request
 * @param {Frist|null} frist its current deadline
 * @param {string} heute 'YYYY-MM-DD'
 * @returns {Ampel}
 */
export function ampelSonderwunsch(sw, frist, heute) {
  const s = String(sw?.status || "");
  if (s === "freigegeben") return "gelb"; // decided, but the detailed design does not show it yet
  if (!OFFEN.includes(/** @type {any} */ (s))) return "gruen";
  if (!frist) return "offen";
  return heute > frist.frist ? "rot" : "gelb";
}

/**
 * Worst of several lights; none → gruen.
 * @param {Ampel[]} lichter
 * @returns {Ampel}
 */
export function schlechteste(lichter) {
  return (lichter || []).reduce((a, b) => (AMPEL_RANG[b] > AMPEL_RANG[a] ? b : a), /** @type {Ampel} */ ("gruen"));
}

/**
 * Deadline state of every request: current deadline, light, shift since the request and
 * whether a decision now would be too late.
 * @param {Array<any>} wuensche Sonderwunsch rows
 * @param {Array<any>} wohnungen Wohneinheit rows (bauabschnitt)
 * @param {Array<any>} tasks ScheduleTask rows
 * @param {string} heute 'YYYY-MM-DD'
 * @returns {Map<string, {frist: Frist|null, ampel: Ampel, verschoben_tage: number|null, zu_spaet: boolean}>} by request id
 */
export function fristenDerWuensche(wuensche, wohnungen, tasks, heute) {
  const abschnitt = new Map((wohnungen || []).map((w) => [w.id, String(w.bauabschnitt || "")]));
  /** @type {Map<string, {frist: Frist|null, ampel: Ampel, verschoben_tage: number|null, zu_spaet: boolean}>} */
  const m = new Map();
  for (const sw of wuensche || []) {
    if (!sw?.id) continue;
    const frist = fristFuer(tasks, String(sw.gewerk_lb || ""), abschnitt.get(sw.wohnung_id) || "");
    const alt = tag(sw.frist_bei_anfrage);
    m.set(sw.id, {
      frist,
      ampel: ampelSonderwunsch(sw, frist, heute),
      verschoben_tage: frist && alt ? tageBis(alt, frist.frist) : null,
      zu_spaet: Boolean(frist && OFFEN.includes(sw.status) && heute > frist.frist),
    });
  }
  return m;
}

/**
 * The matrix apartment × trade for the overview: per cell the deadline (also without any
 * request — the buyer needs to know until when a wish is possible) and the light of the
 * requests in that cell; per apartment the worst light. Trades = catalogue trades ∪ trades
 * of requests, in site order (STLB_LB order); dropped apartments are left out.
 * @param {{wohnungen: Array<any>, wuensche: Array<any>, tasks: Array<any>, katalog?: Array<any>, heute: string}} p
 * @returns {{gewerke: string[], zeilen: Array<{wohnung: any, ampel: Ampel, zellen: Record<string, {frist: Frist|null, ampel: Ampel|null, anzahl: number}>}>}}
 *   cell ampel null = no request in that cell
 */
export function fristMatrix({ wohnungen, wuensche, tasks, katalog = [], heute }) {
  const lbs = new Set([...(katalog || []).filter((o) => o?.aktiv !== false).map((o) => String(o.gewerk_lb || "")), ...(wuensche || []).map((s) => String(s.gewerk_lb || ""))].filter(Boolean));
  const folge = (/** @type {string} */ lb) => STLB_LB.find((g) => g.lb === lb)?.folge ?? 999;
  const gewerke = [...lbs].sort((a, b) => folge(a) - folge(b) || a.localeCompare(b));
  const zustand = fristenDerWuensche(wuensche, wohnungen, tasks, heute);
  const zeilen = (wohnungen || []).filter((w) => w?.entfallen !== true).map((w) => {
    const eigene = (wuensche || []).filter((s) => s.wohnung_id === w.id);
    /** @type {Record<string, {frist: Frist|null, ampel: Ampel|null, anzahl: number}>} */
    const zellen = {};
    for (const lb of gewerke) {
      const hier = eigene.filter((s) => String(s.gewerk_lb || "") === lb);
      zellen[lb] = {
        frist: fristFuer(tasks, lb, String(w.bauabschnitt || "")),
        ampel: hier.length ? schlechteste(hier.map((s) => zustand.get(s.id)?.ampel || "offen")) : null,
        anzahl: hier.length,
      };
    }
    return { wohnung: w, ampel: schlechteste(eigene.map((s) => zustand.get(s.id)?.ampel || "offen")), zellen };
  });
  return { gewerke, zeilen };
}
