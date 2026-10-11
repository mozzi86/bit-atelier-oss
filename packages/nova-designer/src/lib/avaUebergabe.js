// 91-03: hand-over of a planner quantity list to the AVA through the AVA's EXISTING bill-of-quantities
// CSV import (nova-ausschreibung gaeb.js parseLvCsv: semicolon, header row, decimal comma, BOM).
// No second import path and no new AVA rule type: the planner lists ("Mengen (AVA-Übergabe)") were only
// displayed until now — none of them reached the AVA (91-03 finding). A live link from planner
// components to quantity rules is Phase 89-03 (Werkstatt → IFC/AVA) and waits for D-P87-01; this file
// is the honest interim step: a file the user imports into the LV, with origin and date in the text.
//
// In:  quantity rows [{ key, label, menge, einheit }] (entwaesserungMengen, regenwasserMengen, …),
//      options { gewerk, ozPrefix, quelle, stand }.
// Out: CSV text (string) and a pure DIN 276 cost-group proposal per row key. Pure, node-testable.
// 91-05: row converters for the other planners — table lists (garage, cellar: { key, label, wert,
// einheit }, sum rows left out) and the TGA network (netzMengen: pipes per trade + DN, nodes per type).

import { GEWERKE_TGA, KNOTEN_ARTEN } from "./tgaNetz.js";

/**
 * DIN 276 (2018-12) cost group proposals per quantity key [ASSUMED — concept assignment, the cost
 * planner checks it]: 411 Abwasseranlagen (ground pipes, roof drains, emergency overflows, backwater
 * protection, lifting plants incl. the cistern overflow), 412 Wasseranlagen (rainwater harvesting plant:
 * cistern, filter, pumps, service-water pipes), 363 Dachbeläge (tapered insulation, retention roof),
 * 541 Abwasseranlagen der Außenanlagen (swales, trenches). The services room gets no group (it is a
 * room, its construction is in the building's KG 300). 91-05 TGA network by trade: 411 Abwasser,
 * 412 Trinkwasser, 422 Wärmeverteilnetze, 431 Lüftungsanlagen, 444 Niederspannungsinstallation.
 * Garage and cellar rows (areas, bays, compartments) get NO group — they are spaces, not services;
 * the cost planner assigns them (left empty on purpose).
 * @type {Readonly<Record<string, string>>}
 */
export const KG_VORSCHLAG = Object.freeze({
  gl_: "411", ablaeufe: "411", notueberlaeufe: "411", hebeanlage: "411", verschluss: "411",
  rh_zisterne: "411", rh_mulde: "541", rh_rigole: "541", rh_muldenrigole: "541", rh_retentionsdach: "363",
  gefaelle: "363", daemmung: "363", staffel_: "363",
  rw_zisterne: "412", rw_zisterne_sohle: "412", rw_filter: "412", rw_pumpe: "412", rw_leitung: "412",
  rw_technikraum: "", rw_hebeanlage: "411", rw_rueckstau: "411",
  netz_abwasser_: "411", netz_trinkwasser_: "412", netz_heizung_: "422", netz_lueftung_: "431", netz_elektro_: "444",
});

/**
 * Cost group proposal for a row key: exact key, else the longest matching prefix (e.g. "gl_dn150" →
 * "gl_"), else "" (left empty — never guessed into a wrong group).
 * @param {string} key
 * @returns {string} DIN 276 group or ""
 */
export function kgVorschlag(key) {
  const k = String(key || "");
  if (Object.prototype.hasOwnProperty.call(KG_VORSCHLAG, k)) return KG_VORSCHLAG[k];
  const praefix = Object.keys(KG_VORSCHLAG).filter((p) => p.endsWith("_") && k.startsWith(p)).sort((a, b) => b.length - a.length)[0];
  if (praefix) return KG_VORSCHLAG[praefix];
  const teil = Object.keys(KG_VORSCHLAG).filter((p) => k.startsWith(p)).sort((a, b) => b.length - a.length)[0];
  return teil ? KG_VORSCHLAG[teil] : "";
}

/** CSV cell: quoted when it contains ; " or a line break (same rules as gaeb.js splitCsvLine). */
function zelle(v) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Number with decimal comma, max. 3 decimals, no thousands separator (parseLvCsv reads it back exactly). */
function zahl(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  return String(Math.round(n * 1000) / 1000).replace(".", ",");
}

/**
 * Quantity list → CSV for the AVA's LV import. Columns: OZ;Kurztext;Menge;Einheit;Gewerk;DIN276;EP — the
 * unit price stays EMPTY (the planner knows no prices; an empty EP is read as null, never as 0).
 * The short text carries the origin ("aus <quelle>, Stand <datum>") so the LV row is traceable.
 * Rows with menge ≤ 0 or without a label are skipped.
 * @param {Array<{key: string, label: string, menge: number, einheit: string}>} zeilen
 * @param {{gewerk?: string, ozPrefix?: string, quelle?: string, stand?: string}} [o] ozPrefix e.g. "01" → OZ 01.0010, 01.0020, …
 * @returns {string} CSV with BOM and CRLF line ends
 */
export function mengenAlsLvCsv(zeilen, { gewerk = "", ozPrefix = "01", quelle = "", stand = "" } = {}) {
  const kopf = ["OZ", "Kurztext", "Menge", "Einheit", "Gewerk", "DIN276", "EP"];
  const herkunft = [quelle && `aus ${quelle}`, stand && `Stand ${stand}`].filter(Boolean).join(", ");
  const rows = (Array.isArray(zeilen) ? zeilen : []).filter((z) => z && String(z.label || "").trim() && Number(z.menge) > 0);
  const linien = rows.map((z, i) => [
    `${ozPrefix}.${String((i + 1) * 10).padStart(4, "0")}`,
    herkunft ? `${z.label} (${herkunft})` : z.label,
    zahl(z.menge),
    String(z.einheit || "").replace(/\.$/, ""),
    gewerk,
    kgVorschlag(z.key),
    "",
  ].map(zelle).join(";"));
  return "﻿" + [kopf.join(";"), ...linien].join("\r\n") + "\r\n";
}

/**
 * 91-05: rows of a planner table list ({ key, label, wert, einheit }, as TiefgaragenPlaner and
 * KellerabteilPlaner render them) → hand-over rows. Sum rows must be left out (`ohne`), otherwise the
 * LV counts the same area twice (cellar "gesamt_m2", garage "nutzflaeche_m2").
 * @param {Array<{key: string, label: string, wert: number, einheit: string}>} zeilen
 * @param {{ohne?: string[], praefix?: string}} [o] praefix = key prefix that keeps the source apart ("tg_", "keller_")
 * @returns {Array<{key: string, label: string, menge: number, einheit: string}>}
 */
export function zeilenAusTabelle(zeilen, { ohne = [], praefix = "" } = {}) {
  const raus = new Set(ohne);
  return (Array.isArray(zeilen) ? zeilen : [])
    .filter((z) => z && !raus.has(z.key))
    .map((z) => ({ key: `${praefix}${z.key}`, label: String(z.label || ""), menge: Number(z.wert) || 0, einheit: String(z.einheit || "") }));
}

/**
 * 91-05: TGA network quantities (tgaNetz.netzMengen) → hand-over rows: one row per trade + DN (lfm),
 * one per trade + node type (Stk). Keys "netz_<gewerk>_dn<dn>" / "netz_<gewerk>_<art>" carry the trade,
 * so kgVorschlag finds the cost group.
 * @param {{lfm?: Array<{gewerk: string, dn: number|null, lfm: number}>, knoten?: Array<{gewerk: string, art: string, stk: number}>}} mengen
 * @returns {Array<{key: string, label: string, menge: number, einheit: string}>}
 */
export function netzZeilen(mengen) {
  const m = mengen && typeof mengen === "object" ? mengen : {};
  const gewerk = (g) => GEWERKE_TGA[g]?.label || g;
  const dnText = (g, dn) => (dn === null || dn === undefined ? "DN offen" : g === "elektro" ? `${String(dn).replace(".", ",")} mm²` : `DN ${dn}`);
  return [
    ...(Array.isArray(m.lfm) ? m.lfm : []).map((x) => ({ key: `netz_${x.gewerk}_dn${x.dn ?? "offen"}`, label: `${gewerk(x.gewerk)}-Leitung ${dnText(x.gewerk, x.dn)}`, menge: Number(x.lfm) || 0, einheit: "m" })),
    ...(Array.isArray(m.knoten) ? m.knoten : []).map((x) => ({ key: `netz_${x.gewerk}_${x.art}`, label: `${gewerk(x.gewerk)}: ${KNOTEN_ARTEN[x.art]?.label || x.art}`, menge: Number(x.stk) || 0, einheit: "Stk" })),
  ];
}
