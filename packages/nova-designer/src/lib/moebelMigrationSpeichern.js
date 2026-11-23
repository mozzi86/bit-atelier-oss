// 115-05b part 2 (E-4): the write of the furniture migration (W-1118-02 final review F1), moved out of ComplexDesigner.jsx - loaded
// lazily there (the designer's chunk is at its size budget) and testable without the page.
// Stores ONLY the migrated furniture field of the project's design record: reads the FRESH record (another tab may have stored
// furniture or anything else since this tab loaded it), migrates ITS furniture with the same rooms and writes this one field on
// the strict stand of that read (106-09). The answer - with the other tab's changes - is handed to the designer's three-way path
// (`nehmen`, komplexFremdUebernehmen): a field both changed becomes a card, never dropped (E-4). Without the designer of the
// project mounted (`aktiv` false) nothing is merged and the base stays: the next write of a pending change answers 409 and goes
// through the designer's merge (or its refusal with a note).
//
// In:  the entity client (get / update), project, record id, rooms and GUID evidence, the designer's callbacks.
// Out: what happened (see the return value). Side effects: one GET, at most one PUT, the callback.

import { migriereMoeblierung } from "@designer/lib/moebel";

/**
 * @param {{api: {get: (id: string) => Promise<any>, update: (id: string, data: Record<string, any>, opts?: {stand?: string|null}) => Promise<any>},
 *   pid: string, id: string, zonen: any[], opts: import("@designer/lib/moebel").IdPruefOptionen, aktiv: () => boolean,
 *   nehmen: (gespeichert: any) => void}} a
 *   aktiv = the designer of `pid` is mounted and loaded; nehmen = its merge of the stored record
 * @returns {Promise<"anderes_projekt"|"nichts"|"geschrieben"|"abgeglichen">} anderes_projekt = the record belongs to another
 *   project (switched meanwhile), nothing written; nichts = nothing to move; geschrieben = written, base left as it was;
 *   abgeglichen = written and merged into the page
 * @throws {Error & {status?: number}} a 409 when the record was written in between (not overwritten; the next open migrates again)
 */
export async function moeblierungMigrationSchreiben({ api, pid, id, zonen, opts, aktiv, nehmen }) {
  const frisch = await api.get(id);
  if (!frisch || frisch.project_id !== pid) return "anderes_projekt";
  const r = migriereMoeblierung(frisch.moeblierung, zonen, opts);
  if (!r.verschoben) return "nichts";
  const antwort = await api.update(id, { moeblierung: r.moeblierung }, { stand: frisch.updated_date });
  if (!aktiv()) return "geschrieben";
  nehmen({ ...frisch, ...(antwort || {}), moeblierung: r.moeblierung });
  return "abgeglichen";
}
