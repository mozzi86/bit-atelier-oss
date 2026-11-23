// exportSichtBereiche.js — which office areas a role may not export (wave 1, W1-BUERO-F1).
//
// Before, the area filter of 82-02 (exportBereicheFuer) only decided which checkboxes the export
// DIALOG shows. "Vorher sichern", the error card's save and the installed edition's server export
// called the export without options and wrote every office area — a non-owner's file carried the
// office's books. This module turns the same rule into the generic options of entferneBereiche;
// the access context registers it in @core/api/exportSicht.js (loaded lazily through
// src/lib/zugriffLader.js), and projektAlsBlob()/the server routes apply it on every export.
//
// A `separat` area (Personal, E-14) never enters a .bitproj anyway; it is therefore never counted as
// "hidden" — otherwise an owner without the personnel module would lose the backup status of a file.
//
// In:  a Zugriff (rechte.js). Out: verborgeneExportBereiche.

import { EXPORT_BEREICHE, exportOptionen } from "./exportBereiche.js";
import { exportBereicheFuer } from "./zugriffFilter.js";

/**
 * Office areas of the registry the access may NOT export, as entferneBereiche options.
 * @param {any} zugriff a Zugriff of rechte.js; null/undefined = the narrowest access (nothing visible)
 * @param {ReadonlyArray<import("./exportBereiche.js").ExportBereich>} [registry]
 * @returns {{bereiche: string[], ohne: string[], ohneSettingKeys: string[], ohneDokumentBereiche: string[]}}
 *   bereiche = hidden area keys (never a `separat` one); the other lists also carry the entities of every
 *   `separat` area (they are never in a .bitproj, exportOptionen always lists them)
 */
export function verborgeneExportBereiche(zugriff, registry = EXPORT_BEREICHE) {
  // exportBereicheFuer treats a missing access as "show everything" (dialog without provider); for an
  // export the missing access is the narrowest one instead.
  const eng = { rolle: null, projektIds: new Set(), rechte: {} };
  const sichtbar = new Set(exportBereicheFuer(registry, zugriff || eng).map((r) => r.key));
  const o = exportOptionen([...sichtbar], registry);
  return {
    bereiche: registry.filter((b) => !b.separat && !sichtbar.has(b.key)).map((b) => b.key),
    ohne: o.ohne,
    ohneSettingKeys: o.ohneSettingKeys,
    ohneDokumentBereiche: o.ohneDokumentBereiche,
  };
}
