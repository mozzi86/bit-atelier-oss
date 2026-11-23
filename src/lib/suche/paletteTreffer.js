// Ranking and grouping of the command palette's hits (plans 105-28, 111-13).
//
// Every entry of the palette (action, module, setting, project, contact, deadline, minutes, position, document) is
// scored with the shared forgiving matcher (@core/lib/lockereSuche.js). The hits are then shown in result groups: a
// group's place is the rank of its best hit, so the overall best hit is always the first row and Enter opens it
// (tests/e2e/a11y-tastatur-72-03.spec.js types "Komplex-Designer" + Enter). Inside a group the better hit comes first,
// equal hits keep their insertion order.
//
// Pure. In: entries with `gruppe` and a search text, the query. Out: rankeTreffer() → groups with their entries.

import { lockerBewerten, suchNormal } from "@core/lib/lockereSuche.js";

/** Rows shown at most (all groups together). Beyond that the list stops being scannable. */
export const PALETTE_MAX = 12;

/** Rows of one group at most, so one big record source cannot push every other group out. [ASSUMED] */
export const JE_GRUPPE_MAX = 5;

/**
 * @template {{gruppe: string, text: string|import("@core/lib/lockereSuche.js").SuchText, nurMitAnfrage?: boolean}} E
 * @param {ReadonlyArray<E>} eintraege all candidates in insertion order; nurMitAnfrage: shown only for a non-empty query
 *   (the records — an empty palette lists the navigation, not thousands of positions)
 * @param {string} anfrage raw query
 * @param {{max?: number, jeGruppe?: number}} [optionen] max: rows in total; jeGruppe: rows per group (only with a query)
 * @returns {Array<{gruppe: string, eintraege: E[]}>} groups in display order
 */
export function rankeTreffer(eintraege, anfrage, optionen = {}) {
  const max = optionen.max ?? PALETTE_MAX;
  const jeGruppe = optionen.jeGruppe ?? JE_GRUPPE_MAX;
  const mitAnfrage = !!suchNormal(anfrage);
  /** @type {Array<{e: E, i: number, wert: number}>} */
  const bewertet = [];
  (eintraege || []).forEach((e, i) => {
    if (!mitAnfrage) {
      if (!e.nurMitAnfrage) bewertet.push({ e, i, wert: 1 });
      return;
    }
    const wert = lockerBewerten(anfrage, e.text);
    if (wert > 0) bewertet.push({ e, i, wert });
  });
  bewertet.sort((a, b) => b.wert - a.wert || a.i - b.i);
  /** @type {Map<string, E[]>} */
  const gruppen = new Map();
  let anzahl = 0;
  for (const { e } of bewertet) {
    if (anzahl >= max) break;
    const liste = gruppen.get(e.gruppe) || [];
    if (mitAnfrage && liste.length >= jeGruppe) continue;
    liste.push(e);
    gruppen.set(e.gruppe, liste);
    anzahl += 1;
  }
  return [...gruppen.entries()].map(([gruppe, liste]) => ({ gruppe, eintraege: liste }));
}
