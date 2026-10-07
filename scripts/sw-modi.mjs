// The serverless build modes and the four things that differ between them
// (Phase 70-01). Everything else about the service worker — precache rules, fetch
// strategies, version hash — is identical on purpose and lives in build-sw.mjs.
// Since 83-02 the table has one entry: the online demo (`demo`, /demo/) is gone,
// the client build `lokal` remains. The table stays so a second mode is a row,
// not a rewrite.
//
// Own module so the table can be read by a unit test without running the build
// script, which writes files and exits the process.
//
// In:  a mode name. Out: the build folder, URL base, cache prefix and manifest file.

/**
 * @typedef {{ ziel: string, basis: string, cache: string, manifest: string }} SwModus
 * @property {string} ziel     build folder below the repo root
 * @property {string} basis    URL base the build is served from (leading and trailing slash)
 * @property {string} cache    cache-name prefix; the version hash is appended
 * @property {string} manifest web app manifest file name inside `ziel`
 */

/** @type {Record<string, SwModus>} */
export const MODI = {
  lokal: {
    ziel: 'dist-lokal',
    basis: '/app/',
    cache: 'bit-atelier-lokal',
    manifest: 'manifest.lokal.webmanifest',
  },
};

/**
 * Looks up a mode, or throws with the allowed names.
 * @param {string} name
 * @returns {SwModus}
 */
export function modusPruefen(name) {
  // Object.hasOwn, not MODI[name]: "toString" or "constructor" would otherwise return
  // the inherited function and pass as a valid mode (found by the 70-01 unit test).
  const modus = Object.hasOwn(MODI, name) ? MODI[name] : undefined;
  if (!modus) {
    throw new Error(`Unbekannter Modus "${name}" — erlaubt: ${Object.keys(MODI).join(', ')}.`);
  }
  return modus;
}
