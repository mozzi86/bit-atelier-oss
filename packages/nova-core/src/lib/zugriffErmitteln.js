// Determines the access of a session (phase 82, 82-02, RECHT-02/04): which
// user record is active ("Ansicht als …"), its role, levels and project view.
// Pure — the provider (ZugriffContext.jsx) feeds it the loaded data.
//
// Rules:
// - no active user record → the owner (E-17, the sole-owner path; an update
//   never loses a menu entry); in the cloud the role comes from the server role;
// - the stored "Ansicht als" id wins when that user exists and is active;
//   otherwise the first active owner, otherwise the first active user;
// - in the cloud there is no switching (the server role is the identity): a
//   user record with the same e-mail as the signed-in account applies, cut
//   down to the server role (schnittStufen in baueZugriff, never widened).
// Rights in the client are order, not access security (see rechte.js).
//
// In:  loaded users, assignments projection, rights setting, auth data. Out: ermittleZugriff, ANSICHT_ALS_SCHLUESSEL.

import { baueZugriff, rolleAusServerRolle } from "./rechte.js";

/** Browser key of the "Ansicht als" user id per device (registered in the browser-storage registry). */
export const ANSICHT_ALS_SCHLUESSEL = "bit-atelier-ansicht-als";

/**
 * @param {{
 *   user?: Record<string, any>|null, serverRolle?: {role?: string, buero_rolle?: string}|null,
 *   nutzerListe?: ReadonlyArray<Record<string, any>>, zuordnungen?: ReadonlyArray<any>|null, einstellung?: Record<string, any>|null,
 *   datenquelle: string, gespeicherteNutzerId?: string|null, freigabe?: boolean,
 * }} eingabe
 * @returns {{zugriff: import("./rechte.js").Zugriff, nutzerListe: Array<Record<string, any>>, aktiverNutzerId: string|null, kannWechseln: boolean}}
 *   nutzerListe: the active users (for the switch); kannWechseln: "Ansicht als" is offered
 */
export function ermittleZugriff({ user = null, serverRolle = null, nutzerListe = [], zuordnungen = null, einstellung = null, datenquelle, gespeicherteNutzerId = null, freigabe }) {
  const aktive = (nutzerListe || []).filter((n) => n && n.id && n.aktiv !== false);
  const cloud = datenquelle === "supabase";
  const basis = { serverRolle: cloud ? serverRolle : null, einstellung, zuordnungen, datenquelle, ...(freigabe !== undefined ? { freigabe } : {}) };
  /** @type {Record<string, any>|null} */
  let nutzer = null;
  if (cloud) {
    const mail = String(user?.email || "").toLowerCase();
    nutzer = mail ? aktive.find((n) => String(n.email || "").toLowerCase() === mail) || null : null;
  } else if (aktive.length) {
    nutzer = aktive.find((n) => n.id === gespeicherteNutzerId) || aktive.find((n) => n.rolle === "inhaber") || aktive[0];
  }
  const rolle = cloud ? rolleAusServerRolle(serverRolle) ?? "mitarbeiter" : "inhaber";
  const zugriff = baueZugriff({ ...basis, rolle, nutzer });
  return { zugriff, nutzerListe: aktive, aktiverNutzerId: nutzer?.id ?? null, kannWechseln: !cloud && aktive.length > 1 };
}
