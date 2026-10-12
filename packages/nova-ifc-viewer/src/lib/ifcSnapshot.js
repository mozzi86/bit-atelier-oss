// 73-06 (BEST-06): an IFC import survives the reload. Builds the BimSnapshot record + element blob in
// EXACTLY the shape projectImport.js (step 4) writes for an imported project — snapshot fields with
// project_id, elemente_blob (blob id) and anzahl; blob { snapshot_id, project_id, anzahl, elemente } — so
// there is no second schema and one reader (snapshotElemente, 73-03) serves both. Adds the L10 key figures
// of the import (ohne_status …) because a figure nobody sees is read as 0.
//
// Storage rule (11.10.2026): elements inline when small (< 256 KB), blob when large (speicherOrt, art bauteile).
//
// In:  parseIfcFile result, file name, project id, optional API (tests inject one).
// Out: modellstandAusIfc → { snapshot, elemente, blobId } (pure); modellstandSpeichern → the created record.
import { mapToClassifiedElements } from "@ifc/lib/ifcImport";
import { speicherOrt } from "@core/lib/speicherOrt";

/**
 * Pure: snapshot record + elements from a parsed IFC file.
 * @param {{schema?: string, storeys?: Array<{name?: string}|string>, elements?: object[], kennzahlen?: any}} parsed
 * @param {{projectId: string, datei?: string, jetzt?: Date}} o
 * @returns {{snapshot: object, elemente: object[], blobId: string}}
 */
export function modellstandAusIfc(parsed, { projectId, datei = "", jetzt = new Date() }) {
  if (!projectId) throw new Error("Kein Projekt gewählt — der Modellstand braucht ein Projekt.");
  const elemente = mapToClassifiedElements(parsed);
  // Unique per save so an older snapshot keeps its blob (versions, 73-02 provenance); projectImport uses
  // elemente-<project> for its single bundle snapshot — same alphabet, same blob store.
  const blobId = `elemente-${projectId}-${jetzt.getTime()}`.replace(/[^A-Za-z0-9_-]/g, "-");
  const k = parsed?.kennzahlen || {};
  const geschosse = (parsed?.storeys || []).map((s) => (typeof s === "string" ? s : s?.name)).filter(Boolean);
  const snapshot = {
    project_id: projectId,
    name: datei ? datei.replace(/\.ifc$/i, "") : `IFC-Import ${jetzt.toLocaleDateString("de-DE")}`,
    quelle: "IFC-Import",
    datei: datei || null,
    schema: parsed?.schema || null,
    geschosse,
    anzahl: elemente.length,
    ohne_status: Number(k.ohne_status) || 0,
    ohne_geschoss: Number(k.ohne_geschoss) || 0,
    status: k.status || null,
    erzeugt_am: jetzt.toISOString(),
    elemente_blob: null,
  };
  // Storage rule (speicherOrt.js): a small model state keeps its elements in the record (inline — the one
  // reader snapshotElemente reads inline first), a large one in the blob store.
  const ablage = elemente.length ? speicherOrt(elemente, { art: "bauteile" }) : { ort: "db" };
  if (ablage.ort === "blob") snapshot.elemente_blob = blobId;
  else snapshot.elemente = elemente;
  return { snapshot, elemente, blobId };
}

/**
 * Save the model state: snapshot record, then the blob — through bitApi (no own fetch).
 * @param {ReturnType<typeof modellstandAusIfc>} m
 * @param {{api?: {entities: any, blobs: any}}} [o]
 * @returns {Promise<object>} the created BimSnapshot
 */
export async function modellstandSpeichern(m, { api } = {}) {
  const bit = api || (await import("@core/api/bitApi")).bitApi;
  const snap = await bit.entities.BimSnapshot.create(m.snapshot);
  if (m.snapshot.elemente_blob && m.elemente.length) {
    try {
      await bit.blobs.put(m.blobId, { snapshot_id: snap?.id ?? m.blobId, project_id: m.snapshot.project_id, anzahl: m.elemente.length, elemente: m.elemente });
    } catch (e) {
      // No snapshot that points to a missing blob: take the record back and report the cause.
      if (snap?.id) await bit.entities.BimSnapshot.delete(snap.id).catch(() => {});
      throw new Error(`Bauteile konnten nicht gespeichert werden: ${e?.message || e}`);
    }
  }
  return snap;
}
