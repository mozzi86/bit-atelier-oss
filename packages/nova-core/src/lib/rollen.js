// Roles and rights of a membership, client side (Phase 74-01 Task 14).
//
// The database is the boundary (supabase/migrations/0006-0011); this module
// only decides what the UI SHOWS — a hidden button is no access control. It
// must work against both schemas: the live project still stores the stage-1
// roles admin/mitglied without flags until 0006 is applied, afterwards
// owner/planner/leser and bidder/investor/gast with four flags.
//
// Fail-shut like the SQL guards: an unknown role is `gast` (external, no
// rights), a missing flag is false. No membership at all is `gast` too — such
// a user sees the external portal with the note that no office is assigned,
// never the office modules.
//
// In:  a row of org_members (any schema) or a role string. Out: normalised
//      role, group, rights. Pure, no imports.

/** Internal roles after 0006, in descending power. @type {ReadonlyArray<string>} */
export const ROLLEN_INTERN = Object.freeze(['owner', 'planner', 'leser']);

/** External roles after 0006. @type {ReadonlyArray<string>} */
export const ROLLEN_EXTERN = Object.freeze(['bidder', 'investor', 'gast']);

/** The four permission flags of org_members (0006). @type {ReadonlyArray<string>} */
export const RECHTE = Object.freeze(['can_edit_model', 'can_export_ifc', 'can_view_audit_reports', 'can_submit_bid']);

/** Stage-1 words → 0006 words (the migration does the same in SQL). */
const ALTROLLEN = Object.freeze({ admin: 'owner', mitglied: 'planner' });

/**
 * Normalises any role string to the 0006 vocabulary. Unknown or empty → 'gast'.
 * @param {unknown} rolle e.g. 'admin', 'planner', undefined
 * @returns {string} one of ROLLEN_INTERN or ROLLEN_EXTERN
 */
export function rolleNormalisieren(rolle) {
  const r = typeof rolle === 'string' ? rolle.trim() : '';
  if (ALTROLLEN[r]) return ALTROLLEN[r];
  if (ROLLEN_INTERN.includes(r) || ROLLEN_EXTERN.includes(r)) return r;
  return 'gast';
}

/**
 * @param {unknown} rolle any role string
 * @returns {boolean} true for owner/planner/leser (and the stage-1 words)
 */
export function istInterneRolle(rolle) {
  return ROLLEN_INTERN.includes(rolleNormalisieren(rolle));
}

/**
 * @param {unknown} rolle any role string
 * @returns {boolean} true for bidder/investor/gast — and for anything unknown
 */
export function istExterneRolle(rolle) {
  return !istInterneRolle(rolle);
}

/**
 * Rights of a membership row, tolerant of the stage-1 schema: before 0006 the
 * row has no flag columns, and the migration backfills the stock with the
 * office rights — so a stage-1 admin/mitglied row maps to the same rights the
 * migration would give it (model editing and IFC export; audit reports for the
 * owner). After 0006 the flags are read as stored.
 * @param {Record<string, any> | null | undefined} zeile org_members row (select *)
 * @returns {{ rolle: string, intern: boolean, extern: boolean, mitglied: boolean,
 *   zugriffstrennung: boolean, stufe: string,
 *   rechte: { can_edit_model: boolean, can_export_ifc: boolean,
 *             can_view_audit_reports: boolean, can_submit_bid: boolean } }}
 *   extern: a membership WITH an external role exists — the only case that
 *   routes to the bidder portal. No membership is NOT extern: such a user keeps
 *   the office shell with its plain-text "no office assigned" (as before 74-01),
 *   instead of a portal that would suggest a bidder account.
 *   zugriffstrennung: the row comes from the 0006 schema (flag columns exist) —
 *   the AVA controls for submission/award are shown only then, because before
 *   the migrations their RPCs do not exist.
 */
export function mitgliedschaftAuswerten(zeile) {
  const rolle = rolleNormalisieren(zeile?.role);
  const intern = ROLLEN_INTERN.includes(rolle);
  const mitglied = !!zeile && typeof zeile === 'object';
  const altesSchema = mitglied && !('can_edit_model' in zeile);
  /** @param {string} flag @returns {boolean} */
  const flag = (flag) => {
    if (altesSchema && intern) {
      if (flag === 'can_submit_bid') return false;
      if (flag === 'can_view_audit_reports') return rolle === 'owner';
      return true;
    }
    return zeile?.[flag] === true;
  };
  return {
    rolle,
    intern,
    extern: mitglied && !intern,
    mitglied,
    zugriffstrennung: mitglied && !altesSchema,
    stufe: typeof zeile?.stufe === 'string' ? zeile.stufe : (altesSchema && intern ? 'enterprise' : 'free'),
    rechte: {
      can_edit_model: flag('can_edit_model'),
      can_export_ifc: flag('can_export_ifc'),
      can_view_audit_reports: flag('can_view_audit_reports'),
      can_submit_bid: flag('can_submit_bid'),
    },
  };
}
