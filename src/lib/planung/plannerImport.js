// 90-09: import a Microsoft Planner / Project-for-the-web Excel export into the EXISTING site Gantt
// (ScheduleTask entity, GanttSchedule in SiteControl) — no second Gantt. Council 10.10.2026
// (HANDOFF-SKILLS-INTEGRATION §3, skill "planner-gantt-pdf").
//
// Export layout per the office skill: sheet "Projektaufgaben", header data in rows 1–7, column headers in row 9,
// tasks from row 10; B outline number (dots = level), C name, E start, F finish, G bucket, J % complete (0–1),
// Q done. Exports differ between Planner versions and languages, so the header row and the columns are FOUND
// by their header text (German and English); the fixed letters are only the fallback. If neither name nor
// start/finish columns are found, the import refuses with a clear message instead of guessing.
//
// In:  XLSX bytes. Out: pure — tasks with level, the top-level branches, branch/exclude filter, ScheduleTask
//      records, and the plan of a re-import (which earlier planner tasks are replaced; manual tasks never).

import { leseArbeitsmappe } from "@ava/lib/xlsxRead";

/** Header aliases (lower case, compared after trimming). */
const KOEPFE = Object.freeze({
  gliederung: ["gliederungsnummer", "gliederungsnr.", "gliederung", "wbs", "outline number", "nr.", "nr"],
  name: ["name", "aufgabenname", "vorgangsname", "task name", "titel"],
  start: ["anfangstermin", "startdatum", "start", "anfang", "start date", "beginn"],
  ende: ["endtermin", "fälligkeitsdatum", "ende", "finish", "due date", "end date", "enddatum"],
  bucket: ["bucket", "bucketname", "bucket name", "gewerk", "kategorie"],
  fortschritt: ["% erledigt", "% abgeschlossen", "fortschritt", "% complete", "progress", "abgeschlossen in %"],
  erledigt: ["erledigt", "abgeschlossen", "completed", "done"],
});
/** Fallback columns of the office export (1-based). */
const FEST = Object.freeze({ zeile: 9, gliederung: 2, name: 3, start: 5, ende: 6, bucket: 7, fortschritt: 10, erledigt: 17 });

const spaltenBuchstabe = (n) => { let s = ""; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

/**
 * Cell value → ISO date "YYYY-MM-DD" or null. Accepts Excel serial numbers (1900 system), "dd.mm.yyyy",
 * "yyyy-mm-dd…" and "m/d/yyyy" (US export).
 * @param {any} v
 * @returns {string|null}
 */
export function datumIso(v) {
  if (v === null || v === undefined || v === "") return null;
  const iso = (y, m, d) => { const dt = new Date(Date.UTC(y, m - 1, d)); return Number.isNaN(dt.getTime()) || dt.getUTCMonth() !== m - 1 ? null : dt.toISOString().slice(0, 10); };
  if (typeof v === "number" || /^\d+(\.\d+)?$/.test(String(v).trim())) {
    const n = Number(v);
    if (n < 1 || n > 2958465) return null;
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000).toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})/.exec(s);
  if (m) return iso(m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (m) return iso(Number(m[3]), Number(m[1]), Number(m[2]));
  return null;
}

/** Progress → percent 0–100 (accepts 0–1 shares and "45 %" strings). */
function prozent(v) {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(String(v).replace("%", "").replace(",", ".").trim());
  if (!Number.isFinite(n)) return 0;
  const p = n <= 1 && !String(v).includes("%") ? n * 100 : n;
  return Math.max(0, Math.min(100, Math.round(p)));
}

/**
 * Read the tasks of a Planner export.
 * @param {Uint8Array|ArrayBuffer} bytes XLSX
 * @returns {{blatt: string, kopfZeile: number, spalten: Record<string, string>, vorgaenge: Array<{zeile: number, gliederung: string, ebene: number, name: string,
 *   start: string|null, ende: string|null, bucket: string, fortschritt: number, erledigt: boolean}>, warnungen: string[]}}
 *   spalten = column letters used per field (for the dialog)
 * @throws {Error} when no sheet with a task header is found
 */
export function plannerLesen(bytes) {
  const mappe = leseArbeitsmappe(bytes);
  const reihenfolge = [...mappe.blaetter].sort((a, b) => (b.name === "Projektaufgaben" ? 1 : 0) - (a.name === "Projektaufgaben" ? 1 : 0));
  const text = (blatt, r, c) => { const w = blatt.zellen[`${spaltenBuchstabe(c)}${r}`]?.wert; return w === null || w === undefined ? "" : String(w).trim(); };
  for (const blatt of reihenfolge) {
    // Header row: first row (1–40) that has a "name" column and a start or finish column.
    let kopf = 0; /** @type {Record<string, number>} */ let spalten = {};
    for (let r = 1; r <= Math.min(40, blatt.maxRow); r += 1) {
      const gefunden = {};
      for (let c = 1; c <= Math.min(60, blatt.maxCol); c += 1) {
        const k = text(blatt, r, c).toLowerCase();
        for (const [feld, alias] of Object.entries(KOEPFE)) if (!gefunden[feld] && alias.includes(k)) gefunden[feld] = c;
      }
      if (gefunden.name && (gefunden.start || gefunden.ende)) { kopf = r; spalten = gefunden; break; }
    }
    if (!kopf && blatt.name === "Projektaufgaben" && text(blatt, FEST.zeile, FEST.name)) { kopf = FEST.zeile; spalten = { ...FEST }; delete spalten.zeile; }
    if (!kopf) continue;
    const warnungen = [];
    const vorgaenge = [];
    for (let r = kopf + 1; r <= blatt.maxRow; r += 1) {
      const name = spalten.name ? text(blatt, r, spalten.name) : "";
      if (!name) continue;
      const roh = (f) => (spalten[f] ? blatt.zellen[`${spaltenBuchstabe(spalten[f])}${r}`]?.wert ?? null : null);
      const gliederung = spalten.gliederung ? text(blatt, r, spalten.gliederung) : "";
      const start = datumIso(roh("start")), ende = datumIso(roh("ende")) || start;
      if (!start && !ende) warnungen.push(`Zeile ${r} „${name}“: kein Datum – übersprungen`);
      const erl = String(roh("erledigt") ?? "").trim().toLowerCase();
      vorgaenge.push({
        zeile: r, gliederung, ebene: gliederung ? gliederung.split(".").filter(Boolean).length - 1 : 0, name,
        start: start || ende, ende, bucket: spalten.bucket ? text(blatt, r, spalten.bucket) : "",
        fortschritt: prozent(roh("fortschritt")), erledigt: ["ja", "yes", "true", "1", "x"].includes(erl),
      });
    }
    return {
      blatt: blatt.name, kopfZeile: kopf,
      spalten: Object.fromEntries(Object.entries(spalten).map(([k, c]) => [k, spaltenBuchstabe(c)])),
      vorgaenge: vorgaenge.filter((v) => v.start && v.ende), warnungen,
    };
  }
  throw new Error("Keine Aufgabentabelle gefunden – erwartet wird ein Planner-Export mit Spalten „Name“ und „Anfangstermin“/„Endtermin“ (Blatt „Projektaufgaben“).");
}

/**
 * Top-level branches (level 0) with their share done, for the branch choice.
 * @param {ReturnType<typeof plannerLesen>["vorgaenge"]} vorgaenge
 * @returns {Array<{gliederung: string, name: string, fortschritt: number, erledigt: boolean, anzahl: number}>} anzahl incl. sub-tasks
 */
export function hauptzweige(vorgaenge) {
  return vorgaenge.filter((v) => v.ebene === 0).map((v) => ({
    gliederung: v.gliederung, name: v.name, fortschritt: v.fortschritt, erledigt: v.erledigt || v.fortschritt >= 100,
    anzahl: vorgaenge.filter((x) => x.gliederung === v.gliederung || (v.gliederung && x.gliederung.startsWith(`${v.gliederung}.`))).length,
  }));
}

/**
 * Branch + exclusion filter (as in the office skill). `zweig` = outline number of a node (its sub-tree is
 * kept), "" = whole plan. `ausschliessen` = comma list of outline numbers or names; an excluded node takes
 * its sub-tree with it.
 * @param {ReturnType<typeof plannerLesen>["vorgaenge"]} vorgaenge
 * @param {{zweig?: string, ausschliessen?: string}} [o]
 */
export function filtern(vorgaenge, { zweig = "", ausschliessen = "" } = {}) {
  const imZweig = (g, wurzel) => g === wurzel || g.startsWith(`${wurzel}.`);
  const raus = String(ausschliessen || "").split(",").map((s) => s.trim()).filter(Boolean);
  const rausG = new Set();
  for (const r of raus) for (const v of vorgaenge) if (v.gliederung === r || v.name.toLowerCase() === r.toLowerCase()) rausG.add(v.gliederung || `#${v.zeile}`);
  return vorgaenge.filter((v) => (!zweig || (v.gliederung && imZweig(v.gliederung, zweig)))
    && ![...rausG].some((g) => (g.startsWith("#") ? `#${v.zeile}` === g : v.gliederung && imZweig(v.gliederung, g))));
}

/**
 * ScheduleTask records for the site Gantt. Summary tasks (they have children) are kept — the Gantt shows them
 * as bars of their own; their name carries the outline number so the hierarchy stays readable.
 * @param {ReturnType<typeof plannerLesen>["vorgaenge"]} vorgaenge
 * @param {{projektId: string, datei: string}} o
 */
export function alsScheduleTasks(vorgaenge, { projektId, datei }) {
  return vorgaenge.map((v) => ({
    project_id: projektId,
    name: `${v.gliederung ? `${v.gliederung} ` : ""}${v.name}`,
    start_date: v.start, end_date: v.ende,
    progress: v.erledigt ? 100 : v.fortschritt,
    trade: v.bucket || "",
    quelle: "planner", planner_gliederung: v.gliederung, planner_ebene: v.ebene, planner_datei: datei,
  }));
}

/**
 * Re-import plan: earlier planner tasks are replaced (deleted + created again), manual tasks are never touched.
 * @param {Array<any>} bestehend ScheduleTasks of the project
 * @returns {{loeschen: string[], behalten: number}} ids to delete, count of manual tasks kept
 */
export function ersetzenPlan(bestehend) {
  const alt = (bestehend || []).filter((t) => t.quelle === "planner");
  return { loeschen: alt.map((t) => t.id), behalten: (bestehend || []).length - alt.length };
}
