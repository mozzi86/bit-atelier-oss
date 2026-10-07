// Who may see the personnel area (80-01, D-P80-04, E-03, DS-04/DS-12). One function,
// read by the menu, the command palette, the settings areas and /People itself, so
// the four never disagree.
//
// Locally this gate is cosmetic — the demo and the Express dev user are always
// admin; the real boundary is the storage class of 80-02, which refuses personnel
// data outside its own namespace. The role model of phase 82 replaces the role check.
//
// In:  data path and role of the signed-in user. Out: PERSONAL_ZUGAENGE, personalZugang.
//      Import-free.

/**
 * The three answers: `erlaubt` (full access), `nur-lokal` (cloud build: personnel data
 * stays on the device until phase 74, E-03), `keine-berechtigung` (another role, or
 * the user is not loaded yet).
 * @type {ReadonlyArray<'erlaubt'|'nur-lokal'|'keine-berechtigung'>}
 */
export const PERSONAL_ZUGAENGE = Object.freeze(["erlaubt", "nur-lokal", "keine-berechtigung"]);

/** Roles with access until the role model of phase 82 exists. */
const ROLLEN_MIT_ZUGANG = new Set(["admin", "owner"]);

/**
 * Access to the personnel area.
 * - `supabase` → 'nur-lokal', checked BEFORE the role: no role opens the cloud (E-03).
 * - role admin or owner → 'erlaubt'.
 * - anything else → 'keine-berechtigung', also `undefined` while the user loads —
 *   the gate never opens on missing data.
 * @param {{datenquelle?: string, rolle?: string|null}} [kontext] datenquelle:
 *   'serverlos' | 'express' | 'supabase' (umgebung.js DATENQUELLE); rolle: user.role
 * @returns {'erlaubt'|'nur-lokal'|'keine-berechtigung'}
 */
export function personalZugang({ datenquelle, rolle } = {}) {
  if (datenquelle === "supabase") return "nur-lokal";
  return typeof rolle === "string" && ROLLEN_MIT_ZUGANG.has(rolle) ? "erlaubt" : "keine-berechtigung";
}
