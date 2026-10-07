// Which project is "current" when the app starts (72-08, N-01; moved into this
// module in 83-02, when the online demo and its preferred sample project were
// removed).
//
// In:  the loaded project list (already sorted by name), the ?projekt= value
//      and the stored id.
// Out: the id to select ('' when there is nothing to select).
//
// Deliberately pure: it only decides, it never reads the URL, localStorage or
// the data layer itself — so it runs under node --test without a browser.

/**
 * Picks the start project. Order: URL value (matched by id, then by exact
 * name) → a stored id that still exists → the first project of the list → ''.
 *
 * @param {Array<{ id: string, name?: string }>} projekte loaded projects, in display order (by name)
 * @param {{ urlWert?: string, gespeichert?: string }} [optionen]
 *   urlWert: raw ?projekt= value (id or name); gespeichert: id from localStorage
 *   or the current selection
 * @returns {string} project id, or '' when the list is empty
 */
export function waehleStartProjekt(projekte, { urlWert = '', gespeichert = '' } = {}) {
  const liste = Array.isArray(projekte) ? projekte : [];
  if (urlWert) {
    const treffer = liste.find((p) => p.id === urlWert) || liste.find((p) => p.name === urlWert);
    if (treffer) return treffer.id;
  }
  if (gespeichert && liste.some((p) => p.id === gespeichert)) return gespeichert;
  return liste[0]?.id || '';
}
