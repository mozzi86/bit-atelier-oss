// befundListe.js — the findings list of a check run as ONE table model (66-14).
//
// Why: a project controller works in tables (register no. 124) — findings that stay
// in a PDF or a BCF have to be retyped, and from then on there are two truths. This
// module turns the result of a run into a table model; @core/lib/tabellenExport
// writes CSV and XLSX from that same model, so the two files cannot disagree.
//
// In:  findings from clash.js (`aGuid/bGuid, aId/bId, aType/bType, kind, overlapVol,
//      regel, abweichungMm, toleranzMm, aQuelle/bQuelle`), IDS results from
//      evaluateIds (`spec, bestanden, verletzungen`), the geometry elements the run
//      used (the SAME list the finding map gets — `quelle` "A"/"B" in a two-model
//      run), the file names of the one or two models, and the German kind labels of
//      the page (ModelCheck KIND_LABELS — passed in, so the file says what the table
//      on screen says).
// Out: befundTabelle() → {titel, spalten, zeilen}; zaehleBefundzeilen(); befundlisteDateiname().
//
// NUMBERING. `nr` is the number of the report column "Nr." and of the marker on the
// finding map: the position of a finding in the clash list + 1 (ModelCheck `befundNr`,
// befundkarte.befundeJeGeschoss). The page passes its own `befundNr` map as `nummern`,
// so file and screen read ONE source; without the map the same position + 1 applies.
// The caller passes the clash list in report order and in full (the 60-row cut of the
// print report does not apply here). IDS violations carry NO number — the report does
// not number them, and a number that exists only in this file would not lead back into
// the report.
//
// COLUMNS — only what a finding really carries; nothing is derived or invented:
//   filled   nr, art, schwere, fachmodell, geschoss, globalIdA/B, regel, grundlage,
//            bauteilA/B, ueberlappung, abweichung, toleranz, hinweis
//   empty    status, quittung, kostenklasse — header only. No such fields exist on a
//            finding of the run (the 71-04 acknowledgement chain belongs to imported
//            BCF issues, the cost class is plan 66-05, still a sketch). The empty
//            columns keep the register's column order stable for later plans and make
//            the file paste straight into a measures list.
//   omitted  Gewerk (no field; the only derivation, gewerkFromKind, defaults every
//            unknown class to "Rohbau" — that would be invented data) and Achse (the
//            import does not read IfcGrid, see 66-08).
//
// Pure, no DOM, no network.

import { elementSuche, geschossVonBefund, BEFUND_STIL } from "./befundkarte.js";
import { ART_LABELS, grundlageText } from "./clashRegeln.js";

/** Kind text of an IDS violation row (same wording as the BCF title and the HTML summary). */
export const ART_IDS = "IDS verletzt";

/**
 * Severity words by marker rank — rank 1 is the most severe and drawn last on the
 * finding map (befundkarte BEFUND_STIL.schwere). [ASSUMED] the words are a plain
 * reading of that rank (collision high; duplicate, approximations, missing counterpart
 * medium; clearance low), no technical rating — the report calls findings suspicions.
 */
const SCHWERE_TEXT = { 1: "hoch", 2: "mittel", 3: "niedrig" };

/**
 * Columns in file order. `breite` = XLSX column width in characters. Labels are German
 * on purpose: the office works in German, and the AVA exports write German headers
 * regardless of the UI language.
 */
export const BEFUNDLISTE_SPALTEN = Object.freeze([
  { key: "nr", label: "Nr.", typ: "zahl", breite: 7 },
  { key: "art", label: "Art", typ: "text", breite: 32 },
  { key: "schwere", label: "Schwere", typ: "text", breite: 10 },
  { key: "fachmodell", label: "Fachmodell", typ: "text", breite: 30 },
  { key: "geschoss", label: "Geschoss", typ: "text", breite: 18 },
  { key: "globalIdA", label: "GlobalId A", typ: "text", breite: 25 },
  { key: "globalIdB", label: "GlobalId B", typ: "text", breite: 25 },
  { key: "regel", label: "Regel", typ: "text", breite: 34 },
  { key: "grundlage", label: "Grundlage", typ: "text", breite: 55 },
  { key: "status", label: "Status", typ: "text", breite: 14 },
  { key: "quittung", label: "Quittung", typ: "text", breite: 18 },
  { key: "kostenklasse", label: "Kostenklasse", typ: "text", breite: 14 },
  { key: "bauteilA", label: "Bauteil A", typ: "text", breite: 22 },
  { key: "bauteilB", label: "Bauteil B", typ: "text", breite: 22 },
  { key: "ueberlappung", label: "Überlappung (AABB) m³", typ: "zahl", breite: 20 },
  { key: "abweichung", label: "Abweichung mm", typ: "zahl", breite: 15 },
  { key: "toleranz", label: "Toleranz mm", typ: "zahl", breite: 13 },
  { key: "hinweis", label: "Hinweis", typ: "text", breite: 55 },
]);

/**
 * Trimmed text, or null for anything empty — so a missing value becomes an empty cell
 * and never the word "undefined".
 * @param {unknown} v
 * @returns {string|null}
 */
function text(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

/**
 * Finite number rounded to `stellen` decimals, else null (no coercion of strings).
 * @param {unknown} v
 * @param {number} stellen decimals
 * @returns {number|null}
 */
function zahl(v, stellen) {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const f = 10 ** stellen;
  return Math.round(v * f) / f;
}

/**
 * Identity of one side of a finding: the GlobalId, else the express ID as the table on
 * screen shows it ("#123"), else nothing (a side that does not exist, e.g. the missing
 * counterpart of an "ohne Gegenstück" finding).
 * @param {string|null|undefined} guid
 * @param {number|null|undefined} id express ID
 * @returns {string|null}
 */
function kennung(guid, id) {
  return text(guid) ?? (id === null || id === undefined ? null : `#${id}`);
}

/**
 * Name of the model one side of a finding belongs to. A found element knows its source
 * ("A"/"B" in a two-model run, unset in a single run = model A); a side without an
 * element falls back to the source the finding itself carries (BAP findings). With only
 * one model loaded every side is that model.
 * @param {{quelle?: string|null}|null} el
 * @param {string|null|undefined} quelleBefund aQuelle/bQuelle of the finding
 * @param {{A?: string, B?: string}} namen file names by source
 * @returns {string|null}
 */
function modellVon(el, quelleBefund, namen) {
  let q = el ? (el.quelle || "A") : (quelleBefund || null);
  if (!q && !text(namen && namen.B)) q = "A";
  return q ? text(namen && namen[q]) : null;
}

/**
 * Number of rows `befundTabelle` produces for these inputs — the buttons use it to
 * enable or disable themselves without building the table. Clash findings count one
 * row each; a failed IDS specification counts one row per violating element (one row
 * for the specification itself in the defensive case of no listed element).
 * @param {Array<object>|null|undefined} clashes
 * @param {Array<object>|null|undefined} ids
 * @returns {number}
 */
export function zaehleBefundzeilen(clashes, ids) {
  let n = Array.isArray(clashes) ? clashes.length : 0;
  for (const r of Array.isArray(ids) ? ids : []) {
    if (!r || r.bestanden !== false) continue;
    n += Math.max(1, Array.isArray(r.verletzungen) ? r.verletzungen.length : 0);
  }
  return n;
}

/**
 * The findings list as a table model.
 *
 * Rows: first every clash finding in report order (number = the report number, see
 * `nummern`), then one row per violating element of every failed IDS specification (no
 * number).
 *
 * @param {{
 *   clashes?: Array<object>,
 *   nummern?: Map<object, number>|null,
 *   ids?: Array<object>,
 *   elemente?: Array<{expressId?: number, globalId?: string, ifcType?: string, storey?: string, quelle?: string|null}>,
 *   parsedElemente?: Array<{guid?: string, globalId?: string, ifcType?: string, storey?: string}>,
 *   modellNamen?: {A?: string, B?: string},
 *   artLabels?: Record<string, string>,
 * }} p
 *   clashes   — ergebnis.clash.clashes in report order, the FULL list;
 *   nummern   — report number per finding object (ModelCheck `befundNr`); a finding the map
 *               does not know, or no map at all, gets its position in `clashes` + 1;
 *   ids       — ergebnis.ids (evaluateIds results; passed specifications are skipped);
 *   elemente  — geometry elements of the run, for storey and source (also in the map);
 *   parsedElemente — import elements (storey and class of IDS violators without geometry);
 *   modellNamen — file name of the main model (A) and of the comparison model (B);
 *   artLabels — German label per finding kind; falls back to clashRegeln.ART_LABELS.
 * @returns {{titel: string, spalten: Array<{key: string, label: string, typ?: string, breite?: number}>,
 *   zeilen: Array<Record<string, string|number|null>>}}
 */
export function befundTabelle({ clashes = [], nummern = null, ids = [], elemente = [], parsedElemente = [], modellNamen = {}, artLabels = {} } = {}) {
  const suche = elementSuche(elemente);
  const labels = artLabels || {};
  const zeilen = [];

  (Array.isArray(clashes) ? clashes : []).forEach((c, i) => {
    const ea = suche(c?.aGuid, c?.aQuelle, c?.aId);
    const eb = suche(c?.bGuid, c?.bQuelle, c?.bId);
    const stil = BEFUND_STIL[c?.kind];
    const modelle = [modellVon(ea, c?.aQuelle, modellNamen), modellVon(eb, c?.bQuelle, modellNamen)]
      .filter((m, k, alle) => m && alle.indexOf(m) === k);
    zeilen.push({
      nr: (nummern && nummern.get(c)) || i + 1,
      art: text(labels[c?.kind]) ?? text(ART_LABELS[c?.kind]) ?? text(c?.kind),
      schwere: stil ? SCHWERE_TEXT[stil.schwere] ?? null : null,
      fachmodell: modelle.length ? modelle.join(" / ") : null,
      geschoss: text(geschossVonBefund(c, suche)),
      globalIdA: kennung(c?.aGuid, c?.aId),
      globalIdB: kennung(c?.bGuid, c?.bId),
      regel: c?.regel ? text([c.regel.id, c.regel.name].filter(Boolean).join(" ")) : null,
      grundlage: c?.regel ? text(grundlageText(c.regel.grundlage)) : null,
      bauteilA: text(c?.aType),
      bauteilB: text(c?.bType),
      ueberlappung: zahl(c?.overlapVol, 3),
      abweichung: zahl(c?.abweichungMm, 1),
      toleranz: zahl(c?.toleranzMm, 1),
    });
  });

  // IDS: parsed elements are keyed by GlobalId; geometry elements win (they carry the source).
  const parsedNachGuid = new Map();
  for (const e of Array.isArray(parsedElemente) ? parsedElemente : []) {
    const g = e && text(e.guid ?? e.globalId);
    if (g) parsedNachGuid.set(g, e);
  }
  for (const r of Array.isArray(ids) ? ids : []) {
    if (!r || r.bestanden !== false) continue;
    const eigen = r.eigen ? " (eigene Regel)" : "";
    const grundlage = text([r.spec?.beschreibung, r.spec?.hinweise].filter(Boolean).join(" / "));
    const regel = text(r.spec?.name) ? `${r.spec.name}${eigen}` : null;
    const verletzungen = Array.isArray(r.verletzungen) && r.verletzungen.length ? r.verletzungen : [null];
    for (const v of verletzungen) {
      const guid = text(v?.globalId);
      const el = guid ? (suche(guid, null, null) || parsedNachGuid.get(guid) || null) : null;
      const detail = v
        ? `Facette ${text(v.facette) ?? "—"}: erwartet ${text(v.erwartet) ?? "—"}, gefunden ${text(v.gefunden) ?? "—"}`
        : "Spezifikation nicht bestanden";
      zeilen.push({
        nr: null,
        art: ART_IDS,
        schwere: null,
        fachmodell: text(modellNamen && modellNamen.A),
        geschoss: text(el?.storey),
        globalIdA: guid,
        globalIdB: null,
        regel,
        grundlage,
        bauteilA: text(el?.ifcType),
        hinweis: text(v?.elementName) ? `${v.elementName} — ${detail}` : detail,
      });
    }
  }

  return { titel: "Befundliste", spalten: BEFUNDLISTE_SPALTEN.map((s) => ({ ...s })), zeilen };
}

/**
 * File name of the findings list: "<Projekt>_<JJJJ-MM-TT>_befundliste.<endung>". The
 * project (else the model without ".ifc") is reduced to the character class the other
 * exports of the suite use (letters, digits, umlauts, "-", "_"); runs of other
 * characters become one "_", leading/trailing "_" are dropped.
 * @param {{projekt?: string|null, modell?: string|null, datum?: Date, endung?: string}} p
 * @returns {string} e.g. "Buerocampus_Nord_2026-10-06_befundliste.csv"
 */
export function befundlisteDateiname({ projekt, modell, datum = new Date(), endung = "csv" } = {}) {
  const roh = text(projekt) ?? text(String(modell ?? "").replace(/\.ifc$/i, "")) ?? "";
  const basis = roh.replace(/[^\wäöüÄÖÜß-]+/g, "_").replace(/_{2,}/g, "_").replace(/^_+|_+$/g, "") || "befundliste";
  const d = datum instanceof Date && !Number.isNaN(datum.getTime()) ? datum : new Date();
  const jjjj = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const tt = String(d.getDate()).padStart(2, "0");
  const ext = String(endung || "csv").replace(/[^a-z0-9]/gi, "").toLowerCase() || "csv";
  return `${basis}_${jjjj}-${mm}-${tt}_befundliste.${ext}`;
}
