// 4D timeline at the level "construction section × trade" (89-06, decision D-BW-04).
//
// Replaces the budget estimate of FourDFiveD ("floors built" = budget share × 8 fixed floors):
// that number said nothing about WHERE and WHO. The matrix answers both for a date: for every
// construction section (row) and trade (column) whether the work has not started, is running
// or is finished, and which trades are on site. Element-level (show/hide elements by GUID)
// follows after 89-03.
//
// Construction section of a task: `bauabschnitt` (added by 89-05, additive) or the existing
// `area`; without both it is "ohne Bauabschnitt" — no section is invented (same rule as
// D-BW-03: unknown stays unknown). Trade = `trade`, else "ohne Gewerk".
//
// In:  ScheduleTask rows ({ name, trade, area?, bauabschnitt?, start_date, end_date, progress? })
//      and a date (ms since epoch). Out: zeitstrahlMatrix(), standAlsCsv(), helpers.
// Pure, no imports.

/** Row label of tasks without construction section. */
export const OHNE_ABSCHNITT = "ohne Bauabschnitt";
/** Column label of tasks without trade. */
export const OHNE_GEWERK = "ohne Gewerk";

/**
 * Construction section of a task (89-05 field first, then the existing `area`).
 * @param {{bauabschnitt?: string, area?: string}} task
 * @returns {string}
 */
export function abschnittVon(task) {
  return String(task?.bauabschnitt ?? task?.area ?? "").trim() || OHNE_ABSCHNITT;
}

/**
 * Planned share of a task done at a date, 0…1, linear over its duration [ASSUMED: no S-curve —
 * a task without resource histogram has no better planned course]. Invalid dates → null.
 * @param {{start_date?: string, end_date?: string}} task
 * @param {number} ms date in ms since epoch
 * @returns {number|null}
 */
export function sollAnteil(task, ms) {
  const s = Date.parse(task?.start_date ?? ""), e = Date.parse(task?.end_date ?? "");
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return null;
  if (ms <= s) return 0;
  if (ms >= e) return 1;
  return (ms - s) / (e - s);
}

/**
 * @typedef {{ zustand: "offen"|"laeuft"|"fertig", soll: number, ist: number|null, vorgaenge: number, namen: string[] }} Zelle
 */

/**
 * The matrix construction section × trade at a date.
 * Cell share = duration-weighted planned share of its tasks (a 2-day task does not weigh like a
 * 2-month one); `ist` = duration-weighted `progress` (percent → 0…1) when any task carries one.
 * Order: trades and sections by their earliest start (the sequence on site), ties alphabetically;
 * "ohne …" always last. Tasks with invalid dates are counted in `unbewertbar`, not drawn.
 * @param {Array<any>} tasks ScheduleTask rows
 * @param {number} ms date in ms since epoch
 * @returns {{ abschnitte: string[], gewerke: string[], zelle: (abschnitt: string, gewerk: string) => Zelle|null,
 *   aktiv: Array<{ gewerk: string, abschnitt: string, name: string }>, unbewertbar: number, gesamtSoll: number }}
 */
export function zeitstrahlMatrix(tasks = [], ms = Date.now()) {
  /** @type {Map<string, { dauer: number, soll: number, istDauer: number, ist: number, vorgaenge: number, namen: string[] }>} */
  const summen = new Map();
  /** @type {Map<string, number>} */
  const startAb = new Map();
  /** @type {Map<string, number>} */
  const startGw = new Map();
  const aktiv = [];
  let unbewertbar = 0, dauerGesamt = 0, sollGesamt = 0;

  for (const t of tasks || []) {
    const soll = sollAnteil(t, ms);
    if (soll == null) { unbewertbar += 1; continue; }
    const ab = abschnittVon(t);
    const gw = String(t?.trade ?? "").trim() || OHNE_GEWERK;
    const s = Date.parse(t.start_date), e = Date.parse(t.end_date);
    // Weight in days; a zero-length task (milestone) still counts with a minimal weight.
    const dauer = Math.max((e - s) / 86400000, 1 / 24);
    startAb.set(ab, Math.min(startAb.get(ab) ?? Infinity, s));
    startGw.set(gw, Math.min(startGw.get(gw) ?? Infinity, s));
    const key = `${ab}\u0000${gw}`;
    const z = summen.get(key) || { dauer: 0, soll: 0, istDauer: 0, ist: 0, vorgaenge: 0, namen: [] };
    z.dauer += dauer;
    z.soll += dauer * soll;
    const p = Number(t?.progress);
    if (t?.progress != null && Number.isFinite(p)) { z.istDauer += dauer; z.ist += dauer * Math.min(1, Math.max(0, p / 100)); }
    z.vorgaenge += 1;
    z.namen.push(String(t?.name ?? ""));
    summen.set(key, z);
    dauerGesamt += dauer;
    sollGesamt += dauer * soll;
    if (soll > 0 && soll < 1) aktiv.push({ gewerk: gw, abschnitt: ab, name: String(t?.name ?? "") });
  }

  const ordne = (/** @type {Map<string, number>} */ m, ohne) => [...m.keys()].sort((a, b) => {
    if (a === ohne) return 1;
    if (b === ohne) return -1;
    return (m.get(a) - m.get(b)) || a.localeCompare(b, "de", { numeric: true });
  });

  return {
    abschnitte: ordne(startAb, OHNE_ABSCHNITT),
    gewerke: ordne(startGw, OHNE_GEWERK),
    zelle(abschnitt, gewerk) {
      const z = summen.get(`${abschnitt}\u0000${gewerk}`);
      if (!z) return null;
      const soll = z.soll / z.dauer;
      return {
        zustand: soll >= 1 ? "fertig" : soll > 0 ? "laeuft" : "offen",
        soll,
        ist: z.istDauer > 0 ? z.ist / z.istDauer : null,
        vorgaenge: z.vorgaenge,
        namen: z.namen,
      };
    },
    aktiv,
    unbewertbar,
    gesamtSoll: dauerGesamt > 0 ? sollGesamt / dauerGesamt : 0,
  };
}

/**
 * The state at a date as CSV (semicolon, German Excel): one line per non-empty cell.
 * Columns: Datum; Bauabschnitt; Gewerk; Zustand; Soll %; Ist %; Vorgänge.
 * @param {ReturnType<typeof zeitstrahlMatrix>} matrix
 * @param {string} datumIso date of the state, YYYY-MM-DD
 * @returns {string}
 */
export function standAlsCsv(matrix, datumIso) {
  const ZUSTAND = { offen: "nicht begonnen", laeuft: "läuft", fertig: "fertig" };
  const feld = (v) => (/[;"\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const zeilen = [["Datum", "Bauabschnitt", "Gewerk", "Zustand", "Soll %", "Ist %", "Vorgänge"].join(";")];
  for (const ab of matrix.abschnitte) {
    for (const gw of matrix.gewerke) {
      const z = matrix.zelle(ab, gw);
      if (!z) continue;
      zeilen.push([datumIso, ab, gw, ZUSTAND[z.zustand], Math.round(z.soll * 100), z.ist == null ? "" : Math.round(z.ist * 100), z.vorgaenge].map(feld).join(";"));
    }
  }
  return zeilen.join("\n");
}
