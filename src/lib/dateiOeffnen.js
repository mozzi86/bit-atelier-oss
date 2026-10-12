// dateiOeffnen.js — pure building blocks of the import preview, shared by the file-picker import of the
// serverless build (useSpeicherAktionen in src/demo/speicherDialoge.jsx) and the double-click import of
// plan 93-10 (DateiOeffnenEmpfang.jsx: local server or desktop client).
//
// Why here (src/lib, app-only): the preview rows and the copy options need the export registry
// (src/lib/exportBereiche.js), which a package under packages/ may not import.
//
// In:  a parsed project object, local record counts per collection, the registry. Out: plain objects —
//      the preview the ImportVorschauDialog shows and the options the import/copy/save-back calls take.

import { vorschau as dateiVorschau } from "@core/api/projektDateiFormat.js";
import { EXPORT_BEREICHE, importOptionen } from "./exportBereiche.js";
import { vorschauZeilen } from "@/demo/exportSchritte.js";

/**
 * Record counts per collection of a data object (demoDb/db.json shape).
 * @param {Record<string, unknown>} daten
 * @returns {Record<string, number>}
 */
export function anzahlenVon(daten) {
  /** @type {Record<string, number>} */
  const anzahl = {};
  for (const [entity, rows] of Object.entries(daten || {})) anzahl[entity] = Array.isArray(rows) ? rows.length : 0;
  return anzahl;
}

/**
 * Sum of a registry area's collection counts.
 * @param {{entitaeten: readonly string[]}} bereich
 * @param {Record<string, number>} anzahl
 * @returns {number}
 */
function summe(bereich, anzahl) {
  return bereich.entitaeten.reduce((n, e) => n + (anzahl?.[e] || 0), 0);
}

/**
 * The preview object ImportVorschauDialog shows: file name/date/count, one row per non-separate area
 * ("enthalten — ersetzt …" / "nicht enthalten — … bleibt erhalten"), and the "an EMPTY area replaces a
 * FILLED one" flag that locks the replace buttons until confirmed (79-12/E-07).
 * @param {any} obj parsed project file
 * @param {Record<string, number>} lokalAnzahl local record counts per collection
 * @param {{wiederOeffnen?: Array<{id: string, name: string}>, quelle?: {name: string}|null}} [extra]
 *   93-10: projects of the file that already exist here, and the source file name
 * @returns {{obj: any, vorschau: ReturnType<typeof dateiVorschau>, importOptionen: ReturnType<typeof importOptionen>,
 *   zeilen: Array<{key: string, label: string, enthalten: boolean, leerErsetztGefuellt: boolean}>, separatHinweis: boolean,
 *   wiederOeffnen: Array<{id: string, name: string}>, quelle: {name: string}|null}}
 */
export function vorschauAufbauen(obj, lokalAnzahl, { wiederOeffnen = [], quelle = null } = {}) {
  const importOpt = importOptionen(obj);
  const dateiAnzahl = anzahlenVon(obj?.daten || {});
  const { zeilen: basis, separatHinweis } = vorschauZeilen(EXPORT_BEREICHE, importOpt);
  const zeilen = basis.map((zeile) => {
    const bereich = /** @type {{entitaeten: readonly string[]}} */ (EXPORT_BEREICHE.find((b) => b.key === zeile.key));
    const lokal = summe(bereich, lokalAnzahl);
    const inDatei = zeile.enthalten ? summe(bereich, dateiAnzahl) : 0;
    return { ...zeile, leerErsetztGefuellt: zeile.enthalten && inDatei === 0 && lokal > 0 };
  });
  return { obj, vorschau: dateiVorschau(obj), importOptionen: importOpt, zeilen, separatHinweis, wiederOeffnen, quelle };
}

/**
 * What "als Kopie" leaves out (93-10): every collection and Document area of the export registry (the
 * office's own books, times, personnel, users) — a copied project must not duplicate them. Setting rows
 * and office catalogues (scope "buero") are skipped by kopieAnfuegen itself.
 * @param {ReadonlyArray<{entitaeten: readonly string[], dokumentBereiche?: ReadonlyArray<string>}>} [registry]
 * @returns {{ohne: string[], ohneDokumentBereiche: string[]}}
 */
export function kopieOptionen(registry = EXPORT_BEREICHE) {
  const ohne = new Set();
  const ohneDokumentBereiche = new Set();
  for (const b of registry) {
    for (const e of b.entitaeten) ohne.add(e);
    for (const d of b.dokumentBereiche || []) ohneDokumentBereiche.add(d);
  }
  return { ohne: [...ohne], ohneDokumentBereiche: [...ohneDokumentBereiche] };
}

/**
 * The export options for "save back into the file" (93-10): exactly the areas the source file carried —
 * an area the file lacked was kept locally on import (importOptionen().behalte…) and stays out again.
 * @param {{behalte: string[], behalteSettingKeys: string[], behalteDokumentBereiche: string[]}} importOpt
 * @returns {{ohne: string[], ohneSettingKeys: string[], ohneDokumentBereiche: string[]}}
 */
export function zurueckOptionen(importOpt) {
  return {
    ohne: [...(importOpt?.behalte || [])],
    ohneSettingKeys: [...(importOpt?.behalteSettingKeys || [])],
    ohneDokumentBereiche: [...(importOpt?.behalteDokumentBereiche || [])],
  };
}
