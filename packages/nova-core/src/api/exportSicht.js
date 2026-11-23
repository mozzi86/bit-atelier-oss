// exportSicht.js — what a .bitproj export of the active role may carry (wave 1, BEFUNDE-82 H-2,
// W1-BUERO-F1/F3).
//
// The access context (lib/ZugriffContext.jsx) registers the active access here every time it changes,
// together with the app's area calculator (the export registry lives in src/, which @core may not
// import). projektAlsBlob() (api/projektDatei.js) asks exportEinschraenkung() on EVERY export — the
// dialog, "vorher sichern", the error card, the desktop shell's save-back — so no caller can forget
// the filter. The installed edition's server export and save-back get the same restriction as request
// parameters (exportEinschraenkungAbfrage / exportEinschraenkungKoerper) and apply it with the same
// pure function (projektDateiFormat.wendeEinschraenkungAn).
//
// Three states:
// - "laedt" (the DEFAULT, and while the provider has not loaded the access yet, or the load failed):
//   every export is refused (ExportGesperrtFehler) — deny until loaded, never "all". [ASSUMED] A refusal
//   is narrower and more honest than an empty file: "vorher sichern" must not hand out a near-empty
//   file the user takes for a backup before the import replaces the data.
// - "ladefehler" (R-BUERO-2, EXPORT_LADEFEHLER): loading failed and no earlier answer exists. Ordinary
//   exports are refused with their own message; only the error card's emergency backup
//   ({notsicherung: true}) writes the full local state. [ASSUMED] Reason: in this state the app already
//   runs on the owner fallback (ermittleZugriff without users = owner), so refusing protects nothing,
//   while the error card's backup is the one rescue in a broken state.
// - "geladen": the role's project view plus the office areas the role may not export completely.
// - "frei": no restriction (explicit, setzeExportZugriff(null): no rights system, e.g. unit tests).
//
// Rights in the client are order, not access security (rechte.js, BEFUNDE-82 H-1): this keeps a
// handover file of a non-owner role free of projects and office books the role does not see; it does
// not stop someone with access to this device from switching "Ansicht als" back to the owner.
//
// In:  the state of exportSichtStand.js. Out: setzeExportZugriff(), setzeExportBereichsRechner(), exportEinschraenkung(),
//      exportEinschraenkungAbfrage(), exportEinschraenkungKoerper(), ExportGesperrtFehler,
//      EXPORT_GESPERRT_TEXT, EXPORT_LADEFEHLER_TEXT. ZugriffContext imports only exportSichtStand.js (entry chunk budget).

import { exportSichtStand, setzeExportSicht, EXPORT_LADEFEHLER } from './exportSichtStand.js';

/** German message of a refused export (EN in lib/i18nTeile/export-sicht-w1.js). */
export const EXPORT_GESPERRT_TEXT = 'Die Rechte sind noch nicht geladen. Der Export ist erst danach möglich.';

/** German message of an export refused because loading the rights failed (EN in i18nTeile/export-sicht-w1.js). */
export const EXPORT_LADEFEHLER_TEXT = 'Die Rechte konnten nicht geladen werden. Bitte die Seite neu laden; der Export ist erst danach möglich.';

/** Error of a refused export (access not loaded yet, or no area calculator for a non-owner). */
export class ExportGesperrtFehler extends Error {
  /** @param {string} [text] */
  constructor(text = EXPORT_GESPERRT_TEXT) {
    super(text);
    this.name = 'ExportGesperrtFehler';
    this.code = 'export-gesperrt';
  }
}

/**
 * Office areas a role may not export, as the generic options of entferneBereiche.
 * @typedef {{bereiche: string[], ohne: string[], ohneSettingKeys: string[], ohneDokumentBereiche: string[]}} VerborgeneBereiche
 */

/**
 * What one export may carry. `projektIds` null = every project.
 * @typedef {VerborgeneBereiche & {projektIds: Set<string>|null}} Einschraenkung
 */

/**
 * Registers the access alone, keeping the registered calculator (tests; the app uses setzeExportSicht).
 * @param {any} z undefined = not loaded yet (refuse); null = no restriction; otherwise a Zugriff
 * @returns {void}
 */
export function setzeExportZugriff(z) {
  setzeExportSicht(z, exportSichtStand().rechner);
}

/**
 * Registers the area calculator alone, keeping the registered access.
 * @param {((zugriff: any) => any)|null} fn see exportSichtStand.setzeExportSicht
 * @returns {void}
 */
export function setzeExportBereichsRechner(fn) {
  setzeExportSicht(exportSichtStand().zugriff, typeof fn === 'function' ? fn : null);
}

/**
 * What the next export may carry.
 * @param {{notsicherung?: boolean}} [optionen] notsicherung: the error card's emergency backup — only in
 *   the state "ladefehler" it lifts the refusal (full local state); everywhere else it changes nothing
 * @returns {Promise<Einschraenkung|null>} null = no restriction (owner, "frei", or an emergency backup after a failed load)
 * @throws {ExportGesperrtFehler} while the access is not loaded, after a failed load (except the
 *   emergency backup), or for a non-owner without calculator
 */
export async function exportEinschraenkung({ notsicherung = false } = {}) {
  const { zugriff: z, rechner } = exportSichtStand();
  if (z === null) return null; // "frei"
  if (z === EXPORT_LADEFEHLER) {
    if (notsicherung) return null;
    throw new ExportGesperrtFehler(EXPORT_LADEFEHLER_TEXT);
  }
  if (!z) throw new ExportGesperrtFehler(); // "laedt"
  const ids = z.projektIds;
  const projektIds = ids === null || ids === undefined ? null : new Set(ids);
  /** @type {VerborgeneBereiche} */
  let verborgen = { bereiche: [], ohne: [], ohneSettingKeys: [], ohneDokumentBereiche: [] };
  if (typeof rechner === 'function') {
    const r = await rechner(z);
    verborgen = {
      bereiche: [...(r?.bereiche || [])], ohne: [...(r?.ohne || [])],
      ohneSettingKeys: [...(r?.ohneSettingKeys || [])], ohneDokumentBereiche: [...(r?.ohneDokumentBereiche || [])],
    };
  } else if (z.rolle !== 'inhaber') {
    // Without the registry nobody can tell which collections are office books: refuse, never guess "all".
    throw new ExportGesperrtFehler();
  }
  if (projektIds === null && !verborgen.bereiche.length) return null;
  return { projektIds, ...verborgen };
}

/**
 * The restriction as a query string for GET /api/datei/export ("" = none), see
 * server/dateiOeffnenRouter.js einschraenkungAus: `?sicht=zuordnung&projekt=<id>…` limits the projects,
 * `ohne`, `ohneSettingKey`, `ohneDokumentBereich` drop office areas.
 * @returns {Promise<string>} query string including the leading "?", or ""
 * @throws {ExportGesperrtFehler} see exportEinschraenkung
 */
export async function exportEinschraenkungAbfrage() {
  const e = await exportEinschraenkung();
  if (!e) return '';
  const q = new URLSearchParams();
  if (e.projektIds) {
    q.set('sicht', 'zuordnung');
    for (const id of e.projektIds) q.append('projekt', id);
  }
  for (const x of e.ohne) q.append('ohne', x);
  for (const x of e.ohneSettingKeys) q.append('ohneSettingKey', x);
  for (const x of e.ohneDokumentBereiche) q.append('ohneDokumentBereich', x);
  q.set('eingeschraenkt', '1');
  return `?${q.toString()}`;
}

/**
 * The restriction as JSON body fields for POST /api/datei/zurueckschreiben ({} = none).
 * @returns {Promise<Record<string, any>>}
 * @throws {ExportGesperrtFehler} see exportEinschraenkung
 */
export async function exportEinschraenkungKoerper() {
  const e = await exportEinschraenkung();
  if (!e) return {};
  return {
    eingeschraenkt: '1',
    ...(e.projektIds ? { sicht: 'zuordnung', projekt: [...e.projektIds] } : {}),
    ohne: e.ohne, ohneSettingKey: e.ohneSettingKeys, ohneDokumentBereich: e.ohneDokumentBereiche,
  };
}
