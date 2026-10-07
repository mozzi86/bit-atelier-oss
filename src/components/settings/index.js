// Area components of /Settings (80-01, D-P80-F): key of EINSTELLUNGS_BEREICHE →
// {Komponente, BEREIT}. Every area file exports `BEREIT`; the page and the command
// palette offer an area only when it is visible (src/lib/settings/bereiche.js) AND
// ready, so a placeholder never shows up as a tab.
//
// Only 80-01 writes this file. A lane plan fills its own area file and flips
// BEREIT there (office/display/ai: 80-03, data/privacy: 80-05, rules: 80-07,
// templates: 80-09/80-10); nothing changes here.
//
// Props contract of every area component: {kontext: {datenquelle,
// personalZugang}} (EinstellungsKontext in bereiche.js).
//
// In:  the nine area files. Out: BEREICH_KOMPONENTEN.

import BueroBereich, { BEREIT as BUERO_BEREIT } from "./BueroBereich.jsx";
import DarstellungBereich, { BEREIT as DARSTELLUNG_BEREIT } from "./DarstellungBereich.jsx";
import DatenBereich, { BEREIT as DATEN_BEREIT } from "./DatenBereich.jsx";
import DatenschutzBereich, { BEREIT as DATENSCHUTZ_BEREIT } from "./DatenschutzBereich.jsx";
import KiBereich, { BEREIT as KI_BEREIT } from "./KiBereich.jsx";
import KatalogeBereich, { BEREIT as KATALOGE_BEREIT } from "./KatalogeBereich.jsx";
import RegelwerkBereich, { BEREIT as REGELWERK_BEREIT } from "./RegelwerkBereich.jsx";
import PersonalBereich, { BEREIT as PERSONAL_BEREIT } from "./PersonalBereich.jsx";
import SystemBereich, { BEREIT as SYSTEM_BEREIT } from "./SystemBereich.jsx";

/**
 * Component and readiness per area key (same keys as EINSTELLUNGS_REITER).
 * @type {Readonly<Record<string, {Komponente: (props: {kontext?: any}) => any, BEREIT: boolean}>>}
 */
export const BEREICH_KOMPONENTEN = Object.freeze({
  office: { Komponente: BueroBereich, BEREIT: BUERO_BEREIT },
  display: { Komponente: DarstellungBereich, BEREIT: DARSTELLUNG_BEREIT },
  data: { Komponente: DatenBereich, BEREIT: DATEN_BEREIT },
  privacy: { Komponente: DatenschutzBereich, BEREIT: DATENSCHUTZ_BEREIT },
  ai: { Komponente: KiBereich, BEREIT: KI_BEREIT },
  catalogs: { Komponente: KatalogeBereich, BEREIT: KATALOGE_BEREIT },
  rules: { Komponente: RegelwerkBereich, BEREIT: REGELWERK_BEREIT },
  templates: { Komponente: PersonalBereich, BEREIT: PERSONAL_BEREIT },
  system: { Komponente: SystemBereich, BEREIT: SYSTEM_BEREIT },
});
