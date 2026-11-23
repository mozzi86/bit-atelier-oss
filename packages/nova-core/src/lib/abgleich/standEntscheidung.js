// 115-05a (A-2, K1 of the 115-05 review): what a viewer does with ANOTHER stored state of its record - pure decisions, the
// studio wires them to its refs. 115-05b part 2: moved here unchanged from standWaechter.js, which now holds the focus check hook
// and re-exports both functions - the studio imports this small file, so the hook is not pulled into the designer's chunk:
//   studioSauber      is the tab "clean": its values are the stored state it knows (value comparison, not the save
//                     status), no save is waiting or on its way, the last save did not fail, no field is held back by an
//                     open conflict and no grip drag is open. A clean tab may take a foreign state over as a whole.
//   standEntscheiden  current / reload / merge. Compares the record id and updated_date for INEQUALITY, never "newer":
//                     an import, a seed or a restore keeps an older updated_date and is another state all the same.
//
// In:  plain values (see the JSDoc). Out: booleans / a decision word. No I/O, no React.

import { gleichWert } from "./dreiWege.js";

/**
 * Whether a studio tab holds no own change of the model (K1).
 * @param {{abbild: Record<string, any>|null|undefined, jetzt: Record<string, any>, ausstehend: boolean, imFlug: boolean,
 *   fehler: boolean, gesperrt: ReadonlyArray<string>, ziehe: boolean}} z
 *   abbild = the stored state in the studio's representation (studioLaden.js; null until loaded); jetzt = the studio's values
 *   now (same keys); ausstehend = an autosave timer is open; imFlug = a save request is on its way; fehler = the last save
 *   failed (saveState "error"); gesperrt = autosave fields held back by an open conflict (felderZurueckgehalten); ziehe = a
 *   grip drag is open (bimHistorie)
 * @returns {boolean} true = nothing of this tab would get lost when the stored state replaces its values
 */
export function studioSauber({ abbild, jetzt, ausstehend, imFlug, fehler, gesperrt, ziehe }) {
  if (!abbild || ausstehend || imFlug || fehler || ziehe) return false;
  if (Array.isArray(gesperrt) && gesperrt.length) return false;
  return gleichWert(jetzt, abbild);
}

/**
 * Which way a stored state goes into a tab.
 * @param {{basis: {id?: any, updated_date?: any}|null|undefined, server: {id?: any, updated_date?: any}|null|undefined, sauber: boolean}} a
 *   basis = the stored record the tab built on; server = the stored record now; sauber = studioSauber of the tab
 * @returns {"aktuell"|"neu-laden"|"abgleichen"} aktuell = the same record version (id and updated_date equal); neu-laden =
 *   another version and the tab is clean → take it over as a whole; abgleichen = another version and the tab has own changes →
 *   three ways per element (without a base there is nothing to compare against: always abgleichen)
 */
export function standEntscheiden({ basis, server, sauber }) {
  if (!basis || !server) return "abgleichen";
  const gleich = String(basis.id ?? "") === String(server.id ?? "") && String(basis.updated_date ?? "") === String(server.updated_date ?? "");
  if (gleich) return "aktuell";
  return sauber ? "neu-laden" : "abgleichen";
}
