// ifcTestDatei.js — which file GET /api/ifc-test-file may stream (dev route of the IFC test page, phase 30).
//
// Why a module of its own (104-10): the route took `?name=` from the request and joined it to IFC_DIR. The
// name check (basename only, no "..") lived inline in server/index.js and was not testable; it also let a
// Windows device name through ("CON.ifc", "NUL.ifc" — reading them blocks or returns nothing) and did not
// look at the folder itself. Now the whole decision is one pure function under the path rule
// (@core/lib/pfadRichtlinie.js): the folder and the file come from configuration (IFC_DIR / IFC_TEST_FILE),
// so a network share is accepted there; the name from the request must stay a plain file name inside the folder.
//
// In:  the requested name, IFC_DIR / IFC_TEST_FILE, the platform notation. Out: the path to stream, or a status
//      plus a plain-text German error. No file system access.

import path from 'node:path';
import { pfadRichtlinie } from '../packages/nova-core/src/lib/pfadRichtlinie.js';

/**
 * Decides which IFC file the test route streams.
 * @param {{name?: unknown, ifcDir?: string, testDatei?: string, plattform?: 'win32'|'posix'}} o name = ?name=
 *   from the request (untrusted); ifcDir = IFC_DIR; testDatei = IFC_TEST_FILE; plattform = path notation of
 *   this machine (default: process.platform)
 * @returns {{ok: true, pfad: string}|{ok: false, status: number, error: string}} pfad = absolute path to stream
 */
export function ifcTestPfad({ name, ifcDir = '', testDatei = '', plattform = process.platform === 'win32' ? 'win32' : 'posix' }) {
  const p = plattform === 'win32' ? path.win32 : path.posix;
  const ordner = ifcDir || (testDatei ? p.dirname(testDatei) : '');
  let datei = testDatei;
  const mitName = name != null && name !== '';
  if (mitName) {
    const roh = String(name);
    const base = p.basename(roh);
    // A name is one file name: no folder part (either separator on Windows), no "..".
    if (base !== roh || base.includes('..') || (plattform === 'win32' && /[\\/]/.test(roh))) {
      return { ok: false, status: 400, error: 'Ungültiger Dateiname (kein Pfad erlaubt)' };
    }
    if (!ordner) return { ok: false, status: 404, error: 'Kein IFC-Ordner ermittelbar (IFC_DIR oder IFC_TEST_FILE setzen)' };
    datei = p.join(ordner, base);
  }
  if (!datei || !datei.toLowerCase().endsWith('.ifc')) return { ok: false, status: 404, error: 'IFC_TEST_FILE nicht gesetzt (.ifc-Pfad)' };
  // 104-10: before the disk is touched. With a name the file must lie in the folder; device names
  // ("CON.ifc"), device paths and control characters are refused either way.
  const regel = pfadRichtlinie(p.resolve(datei), {
    plattform, netzwerkErlaubt: true, wurzeln: mitName ? [p.resolve(ordner)] : [],
  });
  if (!regel.ok) return { ok: false, status: 400, error: regel.meldung };
  return { ok: true, pfad: regel.pfad };
}
