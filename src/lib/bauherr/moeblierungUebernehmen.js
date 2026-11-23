// moeblierungUebernehmen.js — the office takes a client's furniture proposal over into the model (W-1118-22).
//
// Reads the FRESH design record of the project (the designer or another tab may have stored anything since this page loaded),
// applies the checked entries to ITS furnishing (centre and rotation only, @core/lib/bauherrMoeblierung vorschlagAnwenden) and
// writes this one field on the strict stand of that read (106-09): a write in between answers 409 and nothing is overwritten.
//
// In:  the entity client of BuildingComplex, the project id, entries that passed vorschlagPruefen.
// Out: how many pieces were moved and which are gone. Side effects: one filter read, at most one update.

import { vorschlagAnwenden } from '@core/lib/bauherrMoeblierung';

/**
 * @param {{ api: { filter: (f: Record<string, any>) => Promise<any[]>, update: (id: string, data: Record<string, any>, opts?: { stand?: string|null }) => Promise<any> },
 *   projektId: string, aenderungen: ReadonlyArray<[string, string, number, number, number]> }} a
 * @returns {Promise<{ uebernommen: number, uebersprungen: string[] }>} uebersprungen: ids of furniture no longer in the model
 * @throws {Error & { status?: number }} when the project has no design record, or 409 when it was written in between
 */
export async function moeblierungUebernehmen({ api, projektId, aenderungen }) {
  const zeilen = await api.filter({ project_id: projektId });
  // the newest record is the design (as the designer picks it, komplexDatensatzWaehlen)
  const frisch = [...(zeilen || [])].sort((x, y) => String(y.updated_date || '').localeCompare(String(x.updated_date || '')))[0];
  if (!frisch) throw new Error('Für dieses Projekt ist kein Entwurf gespeichert.');
  const r = vorschlagAnwenden(frisch.moeblierung, aenderungen);
  if (r.uebernommen) await api.update(frisch.id, { moeblierung: r.moeblierung }, { stand: frisch.updated_date });
  return { uebernommen: r.uebernommen, uebersprungen: r.uebersprungen };
}
