// Atomic file replacement that survives short Windows file locks (19.10.2026).
//
// Why: every store writes `<file>.tmp` and renames it over `<file>`. On Windows a rename fails with
// EPERM / EBUSY / EACCES while another process holds the target open — Google Drive / OneDrive sync,
// a virus scanner, the indexer. The data folder of many users sits in such a synced folder (the
// dev repo itself does). One failed rename left `db.json.tmp` behind during a long E2E run. These
// locks last milliseconds to a few hundred ms, so a short retry fixes almost every case.
// Idea after the "atomic write with lock retry" pattern of storytold/craft-libs, own implementation.
//
// In:  temp file (already written), target path, optional fs + sleep for tests.
// Out: nothing; throws the last error when the target stays locked (callers decide: db.js keeps the
//      data in memory and retries on the next write).

import fs from 'node:fs';

/** Error codes of a transient lock on Windows (retry), everything else fails at once. */
const SPERR_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
/** Wait times between attempts in ms — about 1.5 s in total [ASSUMED: sync tools release within that]. */
export const WARTEZEITEN_MS = Object.freeze([20, 50, 100, 200, 400, 700]);

/** Synchronous sleep without busy-waiting (the stores write synchronously). */
function schlafe(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Rename `tmp` over `ziel`; on a transient lock retry with growing pauses.
 * @param {string} tmp written temp file
 * @param {string} ziel target file
 * @param {{fsImpl?: {renameSync: (a: string, b: string) => void}, warte?: (ms: number) => void}} [opt]
 *   test seams: fs implementation and sleep function
 * @returns {number} number of attempts used (1 = no retry)
 */
export function ersetzeAtomar(tmp, ziel, { fsImpl = fs, warte = schlafe } = {}) {
  let letzter = null;
  for (let versuch = 0; versuch <= WARTEZEITEN_MS.length; versuch++) {
    try {
      fsImpl.renameSync(tmp, ziel);
      return versuch + 1;
    } catch (e) {
      letzter = e;
      if (!SPERR_CODES.has(/** @type {any} */ (e)?.code) || versuch === WARTEZEITEN_MS.length) break;
      warte(WARTEZEITEN_MS[versuch]);
    }
  }
  throw letzter;
}

/**
 * Write `inhalt` to `ziel` atomically (temp file in the same folder + ersetzeAtomar).
 * @param {string} ziel target file
 * @param {string|Uint8Array} inhalt content
 * @param {import('node:fs').WriteFileOptions} [schreibOptionen] options of writeFileSync (encoding, mode)
 */
export function schreibeAtomar(ziel, inhalt, schreibOptionen) {
  const tmp = `${ziel}.tmp`;
  fs.writeFileSync(tmp, inhalt, schreibOptionen);
  ersetzeAtomar(tmp, ziel);
}
