// Tab components of /People (80-01, D-P80-F): key of PERSONAL_REITER →
// {Komponente, BEREIT}. /People shows a tab only when its file says BEREIT, so
// until lane B lands a tab the page shows "Personal wird eingerichtet".
//
// Only 80-01 writes this file. The lane-B plans fill their own tab file and flip
// BEREIT there (staff: 80-04, contracts: 80-06, recruiting: 80-08, onboarding: 80-09).
//
// Props contract of every tab component: {kontext: {datenquelle,
// personalZugang}}; a tab is only rendered with personalZugang === 'erlaubt'.
//
// In:  the four tab files. Out: REITER_KOMPONENTEN.

import MitarbeitendeReiter, { BEREIT as MITARBEITENDE_BEREIT } from "./MitarbeitendeReiter.jsx";
import SucheReiter, { BEREIT as SUCHE_BEREIT } from "./SucheReiter.jsx";
import EinstellungReiter, { BEREIT as EINSTELLUNG_BEREIT } from "./EinstellungReiter.jsx";
import VertraegeReiter, { BEREIT as VERTRAEGE_BEREIT } from "./VertraegeReiter.jsx";

/**
 * Component and readiness per tab key (same keys as PERSONAL_REITER).
 * @type {Readonly<Record<string, {Komponente: (props: {kontext?: any}) => any, BEREIT: boolean}>>}
 */
export const REITER_KOMPONENTEN = Object.freeze({
  staff: { Komponente: MitarbeitendeReiter, BEREIT: MITARBEITENDE_BEREIT },
  recruiting: { Komponente: SucheReiter, BEREIT: SUCHE_BEREIT },
  onboarding: { Komponente: EinstellungReiter, BEREIT: EINSTELLUNG_BEREIT },
  contracts: { Komponente: VertraegeReiter, BEREIT: VERTRAEGE_BEREIT },
});
