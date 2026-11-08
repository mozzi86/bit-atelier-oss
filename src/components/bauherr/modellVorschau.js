// modellVorschau.js — the building model of the office preview "Ansicht als …
// Bauherr (Vorschau)" (Phase 110-05).
//
// On the local data paths the BIM studio writes the client's 3D file into the
// blob store (bauherrModellAbgleich.js), not into a bucket. The preview reads
// that local copy. Kept out of BauherrPortal.jsx on purpose: the portal itself
// reads only the client kinds (unit test bauherr-11001); this office-side read
// is reached only with `vorschau`.
//
// In:  file name of the release (`datei`). Out: a blob URL of the GLB (the
// caller revokes it). Side effects: one blob read.

import { bitApi } from '@core/api/bitApi';

/**
 * Blob URL of the local copy of the client's 3D file.
 * @param {string|null|undefined} datei file name of the BauherrModell release
 * @returns {Promise<string>} blob URL (revoke with URL.revokeObjectURL)
 * @throws {Error} plain text when the studio has not written the file yet
 */
export async function vorschauModellUrl(datei) {
  const { lokaleModellBlobId } = await import('@designer/lib/bauherrModellAbgleich');
  const b = datei ? await bitApi.blobs.get(lokaleModellBlobId(datei)).catch(() => null) : null;
  const inhalt = /** @type {any} */ (b)?.inhalt;
  if (typeof inhalt !== 'string' || !inhalt.startsWith('data:')) {
    throw new Error('Die 3D-Datei fehlt noch — bitte das Gebäudemodell einmal im BIM-Studio öffnen.');
  }
  return URL.createObjectURL(await (await fetch(inhalt)).blob());
}
