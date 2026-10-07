// Dictionary parts per area (decision list § 5, D-P79-27): the generic mechanism
// that keeps i18n.jsx out of every area plan. i18n.jsx spreads TEILE_EN as the
// last line of DICT.en; each area writes its English texts into its own part file.
//
// Adding a phase (80–82): create the part files, add ONE import line and ONE
// spread entry per file below — i18n.jsx itself stays untouched. The guard
// (tests/unit/i18nAbdeckung.test.js via tests/unit/helpers/woerterbuch.mjs)
// reads every file of this folder and refuses a key defined twice anywhere.
//
// In:  the part files. Out: TEILE_EN, all English entries of the parts merged.

import { EN as BUCHHALTUNG_FUNDAMENT } from "./buchhaltung-fundament.js";
import { EN as BUCHHALTUNG_RECHNUNGEN } from "./buchhaltung-rechnungen.js";
import { EN as BUCHHALTUNG_MAHNWESEN } from "./buchhaltung-mahnwesen.js";
import { EN as BUCHHALTUNG_UMSATZSTEUER } from "./buchhaltung-umsatzsteuer.js";
import { EN as BUCHHALTUNG_BANK } from "./buchhaltung-bank.js";
import { EN as BUCHHALTUNG_JAHRESUHR } from "./buchhaltung-jahresuhr.js";
import { EN as BUCHHALTUNG_AUSGABEN } from "./buchhaltung-ausgaben.js";
import { EN as BUCHHALTUNG_ENTNAHMEN } from "./buchhaltung-entnahmen.js";
import { EN as BUCHHALTUNG_FUHRPARK } from "./buchhaltung-fuhrpark.js";
import { EN as BUCHHALTUNG_ANLAGEN } from "./buchhaltung-anlagen.js";
import { EN as BUCHHALTUNG_JAHRESUEBERSICHT } from "./buchhaltung-jahresuebersicht.js";
import { EN as BUCHHALTUNG_WEITERGABE } from "./buchhaltung-weitergabe.js";
import { EN as BUCHHALTUNG_GESAMT } from "./buchhaltung-gesamt.js";
// Phase 80 (80-01): lane A settings, lane B personnel — one part file per plan.
import { EN as EINSTELLUNGEN } from "./einstellungen.js";
import { EN as PERSONAL_ALLGEMEIN } from "./personal-allgemein.js";
import { EN as PERSONAL_MITARBEITENDE } from "./personal-mitarbeitende.js";
import { EN as PERSONAL_VERTRAEGE } from "./personal-vertraege.js";
import { EN as PERSONAL_SUCHE } from "./personal-suche.js";
import { EN as PERSONAL_EINTRITT } from "./personal-eintritt.js";
import { EN as PERSONAL_DATENSCHUTZ } from "./personal-datenschutz.js";
// Phase 75 (75-15): massing studio / apartment focus.
import { EN as MASSING_STUDIO } from "./massing-studio.js";
// Plan 66-14: check suite findings list (CSV / Excel).
import { EN as MODELCHECK_EXPORT } from "./modelcheck-export.js";
// Plan 83-02: open source — feedback dialog, registration request, footer link.
import { EN as OPEN_SOURCE } from "./open-source.js";

/**
 * English entries of all dictionary parts (German source text → English).
 * @type {Readonly<Record<string, string>>}
 */
export const TEILE_EN = Object.freeze({
  ...BUCHHALTUNG_FUNDAMENT,
  ...BUCHHALTUNG_RECHNUNGEN,
  ...BUCHHALTUNG_MAHNWESEN,
  ...BUCHHALTUNG_UMSATZSTEUER,
  ...BUCHHALTUNG_BANK,
  ...BUCHHALTUNG_JAHRESUHR,
  ...BUCHHALTUNG_AUSGABEN,
  ...BUCHHALTUNG_ENTNAHMEN,
  ...BUCHHALTUNG_FUHRPARK,
  ...BUCHHALTUNG_ANLAGEN,
  ...BUCHHALTUNG_JAHRESUEBERSICHT,
  ...BUCHHALTUNG_WEITERGABE,
  ...BUCHHALTUNG_GESAMT,
  ...EINSTELLUNGEN,
  ...PERSONAL_ALLGEMEIN,
  ...PERSONAL_MITARBEITENDE,
  ...PERSONAL_VERTRAEGE,
  ...PERSONAL_SUCHE,
  ...PERSONAL_EINTRITT,
  ...PERSONAL_DATENSCHUTZ,
  ...MASSING_STUDIO,
  ...MODELCHECK_EXPORT,
  ...OPEN_SOURCE,
});
