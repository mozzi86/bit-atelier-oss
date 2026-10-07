// Registry of office areas the project-file export dialog offers as one
// checkbox each (79-12, decision E-07, D-P79-29): the .bitproj file is today
// both a backup AND the handover route to specialist planners and the client
// (packages/nova-core/src/api/projektDatei.js), so from the first accounting
// seed onward it would carry drawings, bank balance and bank transactions of
// the office into every handover — and importing one would replace the
// visitor's own books. This file is the ONE place that lists which entities
// belong to which area; the generic api/ functions (projektDatei.js, demoDb.js)
// only take entity/Setting-key lists as plain options, because a package may
// not import from `@/` (App-only) — Phase 80 appends `{key: "personal", …,
// separat: ".bitpers"}` (E-14: personnel never enters the .bitproj, it travels
// as its own encrypted file), Phase 81 appends `{key: "zeiten", …}" — each ONE
// line, no own filter per phase (D-P79-29).
//
// In:  nothing (import-free except the accounting entity list). Out: the
// registry plus three pure functions that turn a chosen key list, or a parsed
// project file, into the generic options projektDatei.js/demoDb.js expect.

import { BUCHHALTUNG_ENTITAETEN, SETTING_KEY } from "./accounting/datenmodell.js";
import { PERSONAL_EXPORT_BEREICH } from "./people/exportBereich.js";

/**
 * @typedef {object} ExportBereich
 * @property {string} key stable identifier, used in the file's `bereiche` list
 * @property {string} label German label, shown via t(label); has an EN dictionary entry
 * @property {readonly string[]} entitaeten collection names this area owns
 * @property {readonly string[]} settingKeys `Setting.key` values this area owns (Setting is one
 *   shared collection across areas, rows are told apart by `key`)
 * @property {string|null} separat non-null = this area never enters the `.bitproj` at all
 *   (E-14: it goes into its own file with this extension instead, e.g. ".bitpers")
 */

/**
 * The office areas the export dialog can filter. Phase 79 enters exactly one
 * (accounting); 80/81 append their own entry (see file header) — this array is
 * the only thing they touch here.
 * @type {ReadonlyArray<ExportBereich>}
 */
export const EXPORT_BEREICHE = Object.freeze([
  Object.freeze({
    key: "buchhaltung",
    label: "Buchhaltung",
    entitaeten: BUCHHALTUNG_ENTITAETEN,
    settingKeys: [SETTING_KEY],
    separat: null,
  }),
  // 80-10 (E-07/E-14): die eine Registry-Zeile "Personal" — nie im .bitproj,
  // immer als eigene verschlüsselte Sicherungsdatei (siehe deren Bereichsdatei).
  PERSONAL_EXPORT_BEREICH,
]);

/**
 * Turns the checked area keys into the options projektAlsBlob()/exportProjekt()
 * take. A `separat` area (Personal, E-14) never reaches the `.bitproj` — its
 * entities always land in `ohne`, checking it only adds its key to `separat`
 * for the caller (Phase 80 builds the encrypted side file from that).
 * @param {string[]} gewaehlt checked area keys
 * @param {ReadonlyArray<ExportBereich>} [registry]
 * @returns {{ohne: string[], ohneSettingKeys: string[], art: "sicherung"|"weitergabe", bereiche: string[], separat: string[]}}
 */
export function exportOptionen(gewaehlt, registry = EXPORT_BEREICHE) {
  const gewaehltSet = new Set(gewaehlt || []);
  const ohne = [];
  const ohneSettingKeys = [];
  const bereiche = [];
  const separat = [];
  let alleGewaehlt = true;
  for (const bereich of registry) {
    const istGewaehlt = gewaehltSet.has(bereich.key);
    if (bereich.separat) {
      // E-14: personnel (and any future `separat` area) is NEVER part of the
      // .bitproj, checked or not — it always counts as "removed" here, and a
      // checked box only records the wish to also build the side file.
      ohne.push(...bereich.entitaeten);
      ohneSettingKeys.push(...bereich.settingKeys);
      if (istGewaehlt) separat.push(bereich.key);
      else alleGewaehlt = false;
      continue;
    }
    if (istGewaehlt) {
      bereiche.push(bereich.key);
    } else {
      ohne.push(...bereich.entitaeten);
      ohneSettingKeys.push(...bereich.settingKeys);
      alleGewaehlt = false;
    }
  }
  return { ohne, ohneSettingKeys, art: alleGewaehlt ? "sicherung" : "weitergabe", bereiche, separat };
}

/**
 * Area keys that ARE in a parsed project file: presence-based, so an old file
 * from before Phase 79 (no `bereiche`, no accounting collections at all) is
 * correctly read as "not present" rather than crashing or being guessed at.
 * An area counts as present when every one of its collections is an own key of
 * `obj.daten` (an empty array still counts — the checkbox was on, the office
 * simply had nothing yet) or when the file's own `bereiche` list names it.
 * @param {object} obj parsed project file (projektDatei.parseProjektDatei())
 * @param {ReadonlyArray<ExportBereich>} [registry]
 * @returns {string[]} area keys found in the file
 */
export function bereicheInDatei(obj, registry = EXPORT_BEREICHE) {
  const daten = obj?.daten || {};
  const genannt = new Set(Array.isArray(obj?.bereiche) ? obj.bereiche : []);
  const gefunden = [];
  for (const bereich of registry) {
    const praesent = bereich.entitaeten.every((e) => Object.prototype.hasOwnProperty.call(daten, e));
    if (praesent || genannt.has(bereich.key)) gefunden.push(bereich.key);
  }
  return gefunden;
}

/**
 * Turns a parsed project file into the options uebernehmeProjekt()/
 * demoDbErsetzen() take: every area NOT found in the file is kept locally —
 * on purpose present-based (see bereicheInDatei) so a handover file without
 * Personal, or an old backup from before Phase 79, never deletes the office's
 * own books.
 * @param {object} obj parsed project file
 * @param {ReadonlyArray<ExportBereich>} [registry]
 * @returns {{behalte: string[], behalteSettingKeys: string[], ersetzt: string[], behalten: string[]}}
 */
export function importOptionen(obj, registry = EXPORT_BEREICHE) {
  const vorhanden = new Set(bereicheInDatei(obj, registry));
  const behalte = [];
  const behalteSettingKeys = [];
  const ersetzt = [];
  const behalten = [];
  for (const bereich of registry) {
    if (vorhanden.has(bereich.key)) {
      ersetzt.push(bereich.key);
    } else {
      behalte.push(...bereich.entitaeten);
      behalteSettingKeys.push(...bereich.settingKeys);
      behalten.push(bereich.key);
    }
  }
  return { behalte, behalteSettingKeys, ersetzt, behalten };
}
