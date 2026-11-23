// 115-05b part 2 (E-5): the ONE way a flush of a pending model change tells the person that it was not written - shared by the BIM
// studio (its own flush and the sketch flush) and useFachlayer. Before, each place carried its own copy of the same then/catch.
// A refused flush ({geschrieben: false}: outdated base, held-back field, replaced model) and a failed one (offline) give one note;
// a written one gives none. Nothing is retried here: the flush runs when the editor leaves the project or unmounts.
//
// In:  the flush function (bimModelNachschreiben of useBimModelSync), project, patch, the note to show, a logger.
// Out: the flush's answer ({geschrieben, grund?}); a failed flush answers {geschrieben: false, grund: "fehler"}.

/**
 * Runs a flush and tells the person when it was not written.
 * @param {(pid: string, patch: Record<string, any>) => Promise<{geschrieben: boolean, grund?: string}>} nachschreiben
 *   the flush (bimModelNachschreiben)
 * @param {string} pid project the pending change belongs to
 * @param {Record<string, any>} patch the pending fields
 * @param {() => void} melden shows the note (a toast with the translated text)
 * @param {(text: string) => void} [protokoll] where a failure is logged (default console.warn)
 * @returns {Promise<{geschrieben: boolean, grund?: string}>}
 */
export function nachschreibenMitHinweis(nachschreiben, pid, patch, melden, protokoll = (text) => console.warn(text)) {
  return nachschreiben(pid, patch).then(
    (r) => {
      if (!r?.geschrieben) melden();
      return r;
    },
    (err) => {
      protokoll(`[nachschreiben] pending model change not written: ${/** @type {any} */ (err)?.message || err}`);
      melden();
      return { geschrieben: false, grund: "fehler" };
    },
  );
}
