// Kostengruppen-Vorschlag über TypeSafe (Phase 76-03) — die Orchestrierung
// zwischen kgVerdichtung (reine Daten) und dem Client (Netz).
//
// Blöcke sequenziell (Fehler brechen früh ab), answers aller Blöcke gemergt,
// Ergebnis in der Vorschlagsform von vorschlaegeAus. Nie eine Zuordnung —
// der Aufrufer (Formular, Tabelle) schreibt erst nach Annahme des Nutzers.

import { urteile } from '@core/integrations/Typesafe.js';
import { kgOptionen, typesafeAuftrag, vorschlaegeAusTypesafe } from './kgVerdichtung.js';

/**
 * @param {string[]} kurztexte
 * @param {Array<object>} dinKatalog Din276Katalog-Zeilen
 * @param {string|null} gewerk
 * @param {{ urteileFn?: Function, sprache?: 'de'|'en' }} [opts]
 * @returns {Promise<{ vorschlaege: Array<object>, verworfen: Array<object>, hinweis: string, modell: string|null }>}
 */
export async function kgVorschlaege(kurztexte, dinKatalog, gewerk = null, { urteileFn = urteile, sprache = 'de' } = {}) {
  if (Object.keys(kgOptionen(dinKatalog)).length < 2) {
    throw new Error('Din276Katalog leer — kein Kostengruppen-Vorschlag möglich');
  }
  const bloecke = typesafeAuftrag(kurztexte, dinKatalog, gewerk, { sprache });
  const answers = {};
  let modell = null;
  for (const block of bloecke) {
    const data = await urteileFn({ ...block });
    modell = modell ?? data?.model ?? null;
    Object.assign(answers, data?.answers || {});
  }
  const r = vorschlaegeAusTypesafe(answers, kurztexte, dinKatalog, { modell });
  return { ...r, modell };
}
