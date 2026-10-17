// bauablauf.js — the construction sequence chain (89-05, BW-07/08): predecessors of a
// schedule task, trade from the STLB catalogue with a construction order, construction
// section, element and BoQ references, award units (Vergabeeinheiten) and the coverage
// report "every element has a trade, a BoQ item and a task".
//
// Data contract — additive fields on ScheduleTask (no rename; legacy tasks stay valid):
//   gewerk_lb (STLB Leistungsbereich, e.g. "013"), bauabschnitt (text; read by 89-06),
//   vergabeeinheit (text, e.g. "VE 03 Rohbau"),
//   vorgaenger: [{id, art: 'EA'|'AA'|'EE', abstand_tage}]   (EA = finish-to-start …),
//   bauteil_guids: [IFC GlobalId …], lv_position_ids: [LVPosition id …]
// LVPosition ↔ element: bim_element_ids / nachweis_element_ids (Phase 33, T-33-05).
// Elements: newest BimSnapshot (snapshotElemente) — {guid|globalId|GlobalId|id, name, gewerk|classification.gewerk}.
//
// In:  ScheduleTask rows, LVPosition rows, element rows. Out: findings, award units, coverage.
// Pure — no React, no API.
import { STLB_LB } from "@core/lib/bauteil/gewerke.js";

/**
 * STLB-Bau Leistungsbereiche with an order on site — 97-02a: the ONE catalogue lives in
 * @core/lib/bauteil/gewerke.js (shared with the element data sheet).
 */
export const GEWERKE_KATALOG = STLB_LB;

/** Relationship types (labels double as i18n keys). */
export const ANORDNUNG = Object.freeze([
  { key: "EA", label: "Ende → Anfang" },
  { key: "AA", label: "Anfang → Anfang" },
  { key: "EE", label: "Ende → Ende" },
]);

/** [ASSUMED] lead time between award and start on site, in days (6 weeks). */
export const VERGABE_VORLAUF_TAGE = 42;

const TAG_MS = 24 * 3600 * 1000;
const ms = (iso) => { const t = Date.parse(String(iso || "")); return Number.isFinite(t) ? t : null; };
const arr = (v) => (Array.isArray(v) ? v : []);

/**
 * Catalogue entry of a task's trade (by gewerk_lb), or null.
 * @param {{gewerk_lb?: string}} task
 * @returns {{lb: string, name: string, folge: number}|null}
 */
export function gewerkVon(task) {
  return GEWERKE_KATALOG.find((g) => g.lb === String(task?.gewerk_lb || "")) || null;
}

/**
 * Element identifier (IFC GlobalId preferred).
 * @param {Record<string, any>} e
 * @returns {string}
 */
export function elementGuid(e) {
  return String(e?.guid || e?.globalId || e?.GlobalId || e?.global_id || e?.id || "");
}

/**
 * Findings on predecessors per task. warn for date violations and cycles, hinweis for an
 * unknown predecessor and an unusual trade order — never fail: overlapping by sections is
 * often intended; the site manager decides.
 * @param {Array<Record<string, any>>} tasks
 * @returns {Map<string, Array<{code: string, stufe: 'warn'|'hinweis', text: string, vorgaenger?: string}>>} task id → findings
 */
export function vorgaengerPruefung(tasks) {
  const byId = new Map(arr(tasks).map((t) => [String(t.id), t]));
  /** @type {Map<string, Array<{code: string, stufe: 'warn'|'hinweis', text: string, vorgaenger?: string}>>} */
  const out = new Map();
  const add = (id, h) => { if (!out.has(id)) out.set(id, []); /** @type {any[]} */ (out.get(id)).push(h); };
  for (const t of arr(tasks)) {
    const id = String(t.id);
    for (const v of arr(t.vorgaenger)) {
      const p = byId.get(String(v?.id));
      if (!p) { add(id, { code: "vorgaenger_fehlt", stufe: "hinweis", text: "Vorgänger nicht mehr vorhanden" }); continue; }
      const abstand = (Number(v.abstand_tage) || 0) * TAG_MS;
      const art = v.art === "AA" || v.art === "EE" ? v.art : "EA";
      const [ts, te, ps, pe] = [ms(t.start_date), ms(t.end_date), ms(p.start_date), ms(p.end_date)];
      const verletzt = art === "EA" ? ts !== null && pe !== null && ts < pe + abstand
        : art === "AA" ? ts !== null && ps !== null && ts < ps + abstand
          : te !== null && pe !== null && te < pe + abstand;
      if (verletzt) add(id, { code: "termin", stufe: "warn", text: "Termin verletzt die Anordnungsbeziehung zum Vorgänger", vorgaenger: String(p.name || p.id) });
      const g = gewerkVon(t);
      const gp = gewerkVon(p);
      if (g && gp && gp.folge > g.folge) add(id, { code: "reihenfolge", stufe: "hinweis", text: "Ungewöhnliche Gewerke-Reihenfolge (Vorgänger-Gewerk kommt üblicherweise später)", vorgaenger: String(p.name || p.id) });
    }
  }
  // Cycle detection (DFS over predecessor edges).
  const zustand = new Map();
  const besuch = (id, pfad) => {
    if (zustand.get(id) === 2) return;
    if (zustand.get(id) === 1) { for (const x of pfad.slice(pfad.indexOf(id))) add(x, { code: "zyklus", stufe: "warn", text: "Vorgänger bilden einen Kreis" }); return; }
    zustand.set(id, 1);
    for (const v of arr(byId.get(id)?.vorgaenger)) if (byId.has(String(v?.id))) besuch(String(v.id), [...pfad, id]);
    zustand.set(id, 2);
  };
  for (const id of byId.keys()) besuch(id, []);
  for (const [id, liste] of out) {
    const gesehen = new Set();
    out.set(id, liste.filter((h) => { const k = `${h.code}|${h.vorgaenger || ""}`; if (gesehen.has(k)) return false; gesehen.add(k); return true; }));
  }
  return out;
}

/**
 * Award units: tasks grouped by vergabeeinheit (tasks without one are left out).
 * @param {Array<Record<string, any>>} tasks
 * @returns {Array<{ve: string, gewerke: string[], vorgaenge: number, positionen: number, start: string|null, vergabeSpaetestens: string|null}>}
 *   start / vergabeSpaetestens as ISO dates (yyyy-mm-dd), sorted by start
 */
export function vergabeeinheiten(tasks) {
  const m = new Map();
  for (const t of arr(tasks)) {
    const ve = String(t.vergabeeinheit || "").trim();
    if (!ve) continue;
    if (!m.has(ve)) m.set(ve, { ve, gewerke: new Set(), vorgaenge: 0, positionen: new Set(), start: null });
    const z = m.get(ve);
    z.vorgaenge += 1;
    const g = gewerkVon(t);
    z.gewerke.add(g ? `${g.lb} ${g.name}` : String(t.trade || "—"));
    for (const p of arr(t.lv_position_ids)) z.positionen.add(String(p));
    const s = ms(t.start_date);
    if (s !== null && (z.start === null || s < z.start)) z.start = s;
  }
  return [...m.values()].sort((a, b) => (a.start ?? Infinity) - (b.start ?? Infinity)).map((z) => ({
    ve: z.ve, gewerke: [...z.gewerke], vorgaenge: z.vorgaenge, positionen: z.positionen.size,
    start: z.start === null ? null : new Date(z.start).toISOString().slice(0, 10),
    vergabeSpaetestens: z.start === null ? null : new Date(z.start - VERGABE_VORLAUF_TAGE * TAG_MS).toISOString().slice(0, 10),
  }));
}

/**
 * Coverage report per element: trade, BoQ item, task.
 * - gewerk: the element's own classification (gewerk | classification.gewerk | trade) or a
 *   task with a catalogue trade that names the element.
 * - position: an LVPosition whose bim_element_ids or nachweis_element_ids contains the element.
 * - vorgang: a task whose bauteil_guids contains it, or a task linked to one of those positions.
 * @param {{elemente: Array<Record<string, any>>, tasks: Array<Record<string, any>>, positionen: Array<Record<string, any>>}} p
 * @returns {{gesamt: number, mitGewerk: number, mitPosition: number, mitVorgang: number, vollstaendig: number,
 *   zeilen: Array<{guid: string, name: string, gewerk: string|null, positionen: string[], vorgaenge: string[]}>}}
 *   positionen = OZ (or id), vorgaenge = task names
 */
export function deckungsreport({ elemente, tasks, positionen }) {
  const posJeGuid = new Map();
  for (const p of arr(positionen)) {
    for (const g of [...arr(p.bim_element_ids), ...arr(p.nachweis_element_ids)]) {
      const k = String(g);
      if (!posJeGuid.has(k)) posJeGuid.set(k, []);
      posJeGuid.get(k).push(p);
    }
  }
  const taskJeGuid = new Map();
  const taskJePos = new Map();
  for (const t of arr(tasks)) {
    for (const g of arr(t.bauteil_guids)) { const k = String(g); if (!taskJeGuid.has(k)) taskJeGuid.set(k, []); taskJeGuid.get(k).push(t); }
    for (const pid of arr(t.lv_position_ids)) { const k = String(pid); if (!taskJePos.has(k)) taskJePos.set(k, []); taskJePos.get(k).push(t); }
  }
  const zeilen = arr(elemente).map((e) => {
    const guid = elementGuid(e);
    const pos = posJeGuid.get(guid) || [];
    const tk = [...(taskJeGuid.get(guid) || []), ...pos.flatMap((p) => taskJePos.get(String(p.id)) || [])];
    const eigen = e.gewerk || e.classification?.gewerk || e.trade || null;
    const ausTask = tk.map((t) => gewerkVon(t)).find(Boolean);
    return {
      guid, name: String(e.name || e.typ || e.ifcType || guid),
      gewerk: eigen ? String(eigen) : ausTask ? `${ausTask.lb} ${ausTask.name}` : null,
      positionen: [...new Set(pos.map((p) => String(p.oz || p.id)))],
      vorgaenge: [...new Set(tk.map((t) => String(t.name || t.id)))],
    };
  });
  const z = (f) => zeilen.filter(f).length;
  return {
    gesamt: zeilen.length,
    mitGewerk: z((x) => !!x.gewerk), mitPosition: z((x) => x.positionen.length > 0), mitVorgang: z((x) => x.vorgaenge.length > 0),
    vollstaendig: z((x) => !!x.gewerk && x.positionen.length > 0 && x.vorgaenge.length > 0),
    zeilen,
  };
}

/**
 * Coverage report as CSV (semicolon, German headers).
 * @param {ReturnType<typeof deckungsreport>} r
 * @returns {string}
 */
export function deckungCsv(r) {
  const zelle = (v) => { const s = String(v ?? ""); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const zeilen = [["GUID", "Bauteil", "Gewerk", "LV-Positionen", "Vorgänge", "vollständig"]];
  for (const x of r.zeilen) zeilen.push([x.guid, x.name, x.gewerk || "", x.positionen.join(", "), x.vorgaenge.join(", "), x.gewerk && x.positionen.length && x.vorgaenge.length ? "ja" : "nein"]);
  return zeilen.map((z) => z.map(zelle).join(";")).join("\n");
}

/**
 * Additive ScheduleTask fields from form values. trade stays the caller's text; when it is
 * empty the catalogue name is used (the 89-06 legend and the H&S matrix read trade).
 * @param {Record<string, any>} w form values (bauteil_guids as text, one GUID per line/comma)
 * @returns {{gewerk_lb: string, bauabschnitt: string, vergabeeinheit: string, trade: string,
 *   vorgaenger: Array<{id: string, art: string, abstand_tage: number}>, bauteil_guids: string[], lv_position_ids: string[]}}
 */
export function taskFelder(w) {
  const g = GEWERKE_KATALOG.find((x) => x.lb === w.gewerk_lb);
  const guids = Array.isArray(w.bauteil_guids) ? w.bauteil_guids : String(w.bauteil_guids || "").split(/[\s,;]+/);
  return {
    gewerk_lb: g ? g.lb : "",
    bauabschnitt: String(w.bauabschnitt || "").trim(),
    vergabeeinheit: String(w.vergabeeinheit || "").trim(),
    trade: String(w.trade || "").trim() || (g ? g.name : ""),
    vorgaenger: arr(w.vorgaenger).filter((v) => v && v.id).map((v) => ({ id: String(v.id), art: ["EA", "AA", "EE"].includes(v.art) ? v.art : "EA", abstand_tage: Number(v.abstand_tage) || 0 })),
    bauteil_guids: [...new Set(guids.map((s) => String(s).trim()).filter(Boolean))],
    lv_position_ids: [...new Set(arr(w.lv_position_ids).map(String))],
  };
}
