// exportSichtLaden.js — the lazy half of the export restriction for the running app (wave 1, W1-BUERO-F1).
//
// zugriffLader.verborgeneExportBereiche imports this module on the first export: it registers the
// English refusal text (lazy i18n part, the entry chunk is at its budget) and hands on to the pure
// rule in exportSichtBereiche.js (which stays importable from Node unit tests — i18n.jsx is not).
//
// In:  a Zugriff (rechte.js). Out: verborgen.

import { englischErgaenzen } from "@core/lib/i18n";
import { EN } from "@core/lib/i18nTeile/export-sicht-w1.js";
import { verborgeneExportBereiche } from "./exportSichtBereiche.js";

englischErgaenzen(EN);

/**
 * Office areas the access may not export (see exportSichtBereiche.verborgeneExportBereiche).
 * @param {any} zugriff a Zugriff of rechte.js; null/undefined = narrowest
 * @returns {{bereiche: string[], ohne: string[], ohneSettingKeys: string[], ohneDokumentBereiche: string[]}}
 */
export function verborgen(zugriff) {
  return verborgeneExportBereiche(zugriff);
}
