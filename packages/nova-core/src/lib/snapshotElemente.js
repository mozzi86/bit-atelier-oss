// 73-03: the ONE way to the building elements of a BimSnapshot. The project import (projectImport.js,
// step 4) stores the elements as a blob (`elemente_blob` = blob id) and NOT inline on the snapshot, so
// every reader that only looked at `snapshot.elemente` found nothing — the "Bestand → Raumprogramm" offer in
// SpaceProgram (bestandsProgramm.js) never fired for an imported project. Order: inline → blob → plain-text
// error. The consumers stay pure and synchronous; only this function talks to the blob store.
//
// In:  snapshot ({ elemente?, elemente_blob? }), optional blob getter (default bitApi.blobs.get, imported
//      lazily so node tests do not load the API layer).
// Out: { elemente: object[], quelle: "inline"|"blob"|"leer", fehler: string|null } — never throws.

/**
 * Elements of a snapshot, wherever they are stored.
 * @param {{elemente?: unknown, elemente_blob?: string|null}|null|undefined} snapshot BimSnapshot entity
 * @param {{blobGet?: (id: string) => Promise<any>}} [o] blob reader (tests inject one)
 * @returns {Promise<{elemente: object[], quelle: "inline"|"blob"|"leer", fehler: string|null}>}
 */
export async function snapshotElemente(snapshot, { blobGet = async (id) => (await import("@core/api/bitApi")).bitApi.blobs.get(id) } = {}) {
  if (Array.isArray(snapshot?.elemente) && snapshot.elemente.length) return { elemente: snapshot.elemente, quelle: "inline", fehler: null };
  const id = snapshot?.elemente_blob;
  if (!id) return { elemente: [], quelle: "leer", fehler: null };
  try {
    const blob = await blobGet(String(id));
    const elemente = Array.isArray(blob?.elemente) ? blob.elemente : Array.isArray(blob) ? blob : null;
    if (!elemente) return { elemente: [], quelle: "blob", fehler: `Bauteil-Ablage „${id}“ enthält keine Bauteilliste.` };
    return { elemente, quelle: "blob", fehler: null };
  } catch (e) {
    return { elemente: [], quelle: "blob", fehler: `Bauteile des Modellstands konnten nicht geladen werden (${id}): ${e?.message || e}` };
  }
}

/**
 * 73-10: write a new Erfassungsgrad onto ONE element of a model state — where the elements live (inline on
 * the record or in the blob). Whether raising is allowed decides the caller (bestandsBefund.darfAnheben).
 * @param {{id: string, elemente?: object[], elemente_blob?: string|null}} snapshot
 * @param {string} guid element GlobalId (or id)
 * @param {string} erfassung new value
 * @param {{api?: {entities: any, blobs: any}}} [o]
 * @returns {Promise<{ok: boolean, grund?: string}>}
 */
export async function elementErfassungSetzen(snapshot, guid, erfassung, { api } = {}) {
  const bit = api || (await import("@core/api/bitApi")).bitApi;
  const setzen = (els) => {
    let treffer = 0;
    const neu = els.map((e) => {
      if ((e?.guid ?? e?.id) !== guid) return e;
      treffer += 1;
      return { ...e, erfassung };
    });
    return { neu, treffer };
  };
  try {
    if (Array.isArray(snapshot?.elemente) && snapshot.elemente.length) {
      const { neu, treffer } = setzen(snapshot.elemente);
      if (!treffer) return { ok: false, grund: `Bauteil ${guid} nicht im Modellstand.` };
      await bit.entities.BimSnapshot.update(snapshot.id, { elemente: neu });
      return { ok: true };
    }
    if (!snapshot?.elemente_blob) return { ok: false, grund: "Modellstand ohne Bauteile." };
    const blob = await bit.blobs.get(snapshot.elemente_blob);
    const { neu, treffer } = setzen(Array.isArray(blob?.elemente) ? blob.elemente : []);
    if (!treffer) return { ok: false, grund: `Bauteil ${guid} nicht im Modellstand.` };
    await bit.blobs.put(snapshot.elemente_blob, { ...blob, elemente: neu });
    return { ok: true };
  } catch (e) {
    return { ok: false, grund: `Erfassungsgrad konnte nicht gespeichert werden: ${e?.message || e}` };
  }
}
