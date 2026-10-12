// rechte.js — roles and rights of the office (phase 82, RECHT-01/02).
//
// Rights in the client are order and overview, not access security: whoever
// controls the device or the browser can read the local data anyway.
// Enforcement belongs on the server (phase 74/78); this module says what a role
// is meant to see, so menus, pages, sources and exports agree.
//
// Four fixed roles (§ 5 of the decision list): inhaber, projektleitung,
// mitarbeiter, buchhaltung. Modules are grouped (one key can carry several menu
// entries); each role has a level per module: 'aus' (no access), 'lesen'
// (read), 'voll' (edit). The office stores only deviations from the standard
// matrix (Setting `rechte`), and fixed floors keep the owner in control.
//
// Cloud (E-03, relaxed by E-20 on 28.09.2026): the office modules are locked in
// the Supabase build unless the owner is the organisation's only member
// (BUERO_CLOUD_FREIGABE in umgebung.js — the switch 79/81 read). D-P78-04
// (12.10.2026): the cloud carries only the own office.
//
// Pure, only @core imports (package boundary). The project-list filter is
// called projekteNachZugriff: `sichtbareProjekte` belongs to 81-06
// (@core/lib/projektArchiv.js, archive filter); ProjectContext runs the rights
// filter first, then the archive filter.
//
// In:  roles, the Setting `rechte`, the project assignment projection of the
//      personnel adapter, the data path. Out: constants and pure functions below.

import { BUERO_CLOUD_FREIGABE } from "./umgebung.js";

/** The four office roles. @type {ReadonlyArray<'inhaber'|'projektleitung'|'mitarbeiter'|'buchhaltung'>} */
export const ROLLEN = Object.freeze(["inhaber", "projektleitung", "mitarbeiter", "buchhaltung"]);

/** German labels (i18n keys) of the roles. */
export const ROLLEN_LABELS = Object.freeze({ inhaber: "Inhaber/in", projektleitung: "Projektleitung", mitarbeiter: "Mitarbeiter/in", buchhaltung: "Buchhaltung" });

/** Levels, lowest first. @type {ReadonlyArray<'aus'|'lesen'|'voll'>} */
export const STUFEN = Object.freeze(["aus", "lesen", "voll"]);

/** German labels (i18n keys) of the levels. */
export const STUFEN_LABELS = Object.freeze({ aus: "Kein Zugriff", lesen: "Lesen", voll: "Bearbeiten" });

/**
 * Modules with their German label (i18n key). `zeiterfassung:freigabe` is a
 * sub-right of `zeiterfassung` (tabs approval and export of /TimeTracking) and
 * is never higher than its parent.
 */
export const MODUL_LABELS = Object.freeze({
  projekte: "Projekte",
  berichte: "Berichte & Dokumente",
  planung: "Planung",
  modell: "Modell & Prüfung",
  ava: "AVA (Ausschreibung)",
  finanzen: "Finanzen & Nachträge",
  ki: "KI & Analyse",
  adressbuch: "Adressbuch",
  labor: "Labor",
  buchhaltung: "Buchhaltung",
  personal: "Personal",
  kostensatz: "Kostensätze",
  zeiterfassung: "Zeiterfassung",
  "zeiterfassung:freigabe": "Zeiterfassung › Freigabe & Export",
  auftrag: "Angebot & Auftrag",
  controlling: "Projektcontrolling",
  abwesenheiten: "Abwesenheiten",
  fristen: "Fristen & Termine",
  schriftverkehr: "Schriftverkehr",
  einstellungen: "Einstellungen",
  rechte: "Nutzer & Rechte",
});

/** Module keys in display order. @type {ReadonlyArray<string>} */
export const MODULE = Object.freeze(Object.keys(MODUL_LABELS));

/** Parent of a sub-right. */
export const ELTERNMODUL = Object.freeze({ "zeiterfassung:freigabe": "zeiterfassung" });

/** Existing modules of the app before phase 79: only 'aus' or 'voll' (no read-only mode there). */
export const BESTANDSMODULE = Object.freeze(["projekte", "berichte", "planung", "modell", "ava", "finanzen", "ki", "adressbuch", "labor"]);

/** Office modules locked in the cloud without the release E-20 (E-03 route list: /Accounting, /People, /TimeTracking, /Fees, /Controlling, /Absences, /Correspondence, plus cost rates and rights). */
export const CLOUD_GESPERRT = Object.freeze(["buchhaltung", "personal", "kostensatz", "zeiterfassung", "zeiterfassung:freigabe", "auftrag", "controlling", "abwesenheiten", "schriftverkehr", "rechte"]);

/**
 * Standard matrix (82-RESEARCH § Rechte). Restrictions such as "own projects
 * only" come from the project view (projektIds), not from the level.
 * @type {Readonly<Record<string, Readonly<Record<string, 'aus'|'lesen'|'voll'>>>>}
 */
export const STANDARD_MATRIX = Object.freeze({
  inhaber: Object.freeze(/** @type {Record<string, "voll">} */ (Object.fromEntries(MODULE.map((m) => [m, "voll"])))),
  projektleitung: Object.freeze({
    projekte: "voll", berichte: "voll", planung: "voll", modell: "voll", ava: "voll", finanzen: "voll", ki: "voll", adressbuch: "voll", labor: "voll",
    buchhaltung: "aus", personal: "aus", kostensatz: "aus", zeiterfassung: "voll", "zeiterfassung:freigabe": "voll", auftrag: "voll", controlling: "lesen",
    abwesenheiten: "voll", fristen: "voll", schriftverkehr: "voll", einstellungen: "lesen", rechte: "aus",
  }),
  mitarbeiter: Object.freeze({
    projekte: "voll", berichte: "voll", planung: "voll", modell: "voll", ava: "voll", finanzen: "voll", ki: "voll", adressbuch: "voll", labor: "aus",
    buchhaltung: "aus", personal: "aus", kostensatz: "aus", zeiterfassung: "voll", "zeiterfassung:freigabe": "aus", auftrag: "aus", controlling: "aus",
    abwesenheiten: "voll", fristen: "voll", schriftverkehr: "voll", einstellungen: "aus", rechte: "aus",
  }),
  buchhaltung: Object.freeze({
    projekte: "voll", berichte: "aus", planung: "aus", modell: "aus", ava: "aus", finanzen: "voll", ki: "aus", adressbuch: "voll", labor: "aus",
    buchhaltung: "voll", personal: "voll", kostensatz: "voll", zeiterfassung: "lesen", "zeiterfassung:freigabe": "lesen", auftrag: "lesen", controlling: "lesen",
    abwesenheiten: "voll", fristen: "voll", schriftverkehr: "voll", einstellungen: "lesen", rechte: "aus",
  }),
});

/** Project view per role in the standard: null = all projects, 'zuordnung' = assigned projects. */
const STANDARD_PROJEKTSICHT = Object.freeze({ inhaber: "alle", projektleitung: "zuordnung", mitarbeiter: "zuordnung", buchhaltung: "alle" });

/** Default value of the Setting `rechte`: no deviation. */
export const RECHTE_STANDARD = Object.freeze({ ueberschreibungen: Object.freeze({}), projektsicht: Object.freeze({}) });

/** Modules a mitarbeiter never gets (floor). */
const NIE_FUER_MITARBEITER = Object.freeze(["personal", "buchhaltung", "kostensatz", "zeiterfassung:freigabe"]);

/** @param {string|undefined} stufe @returns {number} rank 0..2, -1 unknown */
const rang = (stufe) => STUFEN.indexOf(/** @type {any} */ (stufe));

/** @param {string} a @param {string} b @returns {'aus'|'lesen'|'voll'} the lower level */
const minStufe = (a, b) => /** @type {any} */ (STUFEN[Math.max(0, Math.min(rang(a), rang(b)))]);

/**
 * Deviations of the Setting `rechte` without the ones the floors forbid
 * (T-82-04): the owner keeps einstellungen and rechte; a mitarbeiter never gets
 * personal, buchhaltung, kostensatz or the approval sub-right; existing modules
 * know only aus/voll ('lesen' becomes 'voll'); unknown roles, modules and levels drop out.
 * @param {Record<string, any>|null|undefined} einstellung value of the Setting `rechte`
 * @returns {{ueberschreibungen: Record<string, Record<string, 'aus'|'lesen'|'voll'>>, projektsicht: Record<string, 'alle'|'zuordnung'>}}
 */
export function bereinigeUeberschreibungen(einstellung) {
  /** @type {Record<string, Record<string, any>>} */
  const ueber = {};
  for (const [rolle, module] of Object.entries(einstellung?.ueberschreibungen || {})) {
    if (!ROLLEN.includes(/** @type {any} */ (rolle)) || !module || typeof module !== "object") continue;
    for (const [modul, stufeRoh] of Object.entries(module)) {
      if (!MODULE.includes(modul) || rang(stufeRoh) < 0) continue;
      let stufe = stufeRoh;
      if (rolle === "inhaber" && (modul === "einstellungen" || modul === "rechte")) continue;
      if (rolle === "mitarbeiter" && NIE_FUER_MITARBEITER.includes(modul) && stufe !== "aus") continue;
      if (BESTANDSMODULE.includes(modul) && stufe === "lesen") stufe = "voll";
      (ueber[rolle] ||= {})[modul] = stufe;
    }
  }
  /** @type {Record<string, any>} */
  const sicht = {};
  for (const [rolle, wert] of Object.entries(einstellung?.projektsicht || {})) {
    if (ROLLEN.includes(/** @type {any} */ (rolle)) && (wert === "alle" || wert === "zuordnung")) sicht[rolle] = wert;
  }
  return { ueberschreibungen: ueber, projektsicht: sicht };
}

/**
 * Levels of a role: standard matrix plus the cleaned deviations; a sub-right
 * never above its parent.
 * @param {string|null} rolle
 * @param {Record<string, any>|null} [einstellung] Setting `rechte`
 * @returns {Record<string, 'aus'|'lesen'|'voll'>}
 */
export function matrixFuer(rolle, einstellung = null) {
  if (!rolle || !STANDARD_MATRIX[rolle]) return Object.fromEntries(MODULE.map((m) => [m, "aus"]));
  const { ueberschreibungen } = bereinigeUeberschreibungen(einstellung);
  /** @type {Record<string, any>} */
  const stufen = { ...STANDARD_MATRIX[rolle], ...(ueberschreibungen[rolle] || {}) };
  for (const [kind, eltern] of Object.entries(ELTERNMODUL)) stufen[kind] = minStufe(stufen[kind], stufen[eltern]);
  return stufen;
}

/**
 * Server role of an office role for phase 74 (documented, not built; reversible).
 * Phase 74 needs a column `buero_rolle` (or equal flags) at org_members and an
 * area `vertraulich` in entity_regeln — finding for 74.
 * @param {string} rolle
 * @returns {{role: string, buero_rolle?: string, can_view_personal?: boolean, can_view_buchhaltung?: boolean}|null}
 */
export function serverAbbildung(rolle) {
  if (rolle === "inhaber") return { role: "owner" };
  if (rolle === "projektleitung") return { role: "planner", buero_rolle: "projektleitung" };
  if (rolle === "mitarbeiter") return { role: "planner", buero_rolle: "mitarbeiter" };
  // Not 'leser': a 74 'leser' never writes, but the bookkeeping writes books and HR.
  if (rolle === "buchhaltung") return { role: "planner", buero_rolle: "buchhaltung", can_view_personal: true, can_view_buchhaltung: true };
  return null;
}

/**
 * Office role of a server role: owner/admin → inhaber; planner/mitglied with
 * buero_rolle → that role, without → projektleitung; leser → mitarbeiter (read
 * mode, see serverLesemodus); external or unknown roles → null (no office role,
 * every office module off — no fifth pseudo role).
 * @param {{role?: string, buero_rolle?: string}|null|undefined} server
 * @returns {'inhaber'|'projektleitung'|'mitarbeiter'|'buchhaltung'|null}
 */
export function rolleAusServerRolle(server) {
  const r = server?.role;
  if (r === "owner" || r === "admin") return "inhaber";
  if (r === "planner" || r === "mitglied") {
    const b = server?.buero_rolle;
    return ROLLEN.includes(/** @type {any} */ (b)) ? /** @type {any} */ (b) : "projektleitung";
  }
  if (r === "leser") return "mitarbeiter";
  return null;
}

/**
 * Whether a server role only reads (74 'leser').
 * @param {{role?: string}|null|undefined} server
 * @returns {boolean}
 */
export function serverLesemodus(server) {
  return server?.role === "leser";
}

/**
 * Supabase: per module the intersection of server role and user role — never
 * widened. Null server role (external) → all 'aus'.
 * @param {string|null} nutzerRolle
 * @param {{role?: string, buero_rolle?: string}|null} server
 * @param {Record<string, any>|null} [einstellung]
 * @returns {Record<string, 'aus'|'lesen'|'voll'>}
 */
export function schnittStufen(nutzerRolle, server, einstellung = null) {
  const sr = rolleAusServerRolle(server);
  const a = matrixFuer(sr, einstellung);
  const lesen = serverLesemodus(server);
  const b = matrixFuer(nutzerRolle, einstellung);
  return Object.fromEntries(MODULE.map((m) => {
    const s = minStufe(a[m], b[m]);
    return [m, lesen && s === "voll" ? "lesen" : s];
  }));
}

/**
 * Whether an office module is locked on a data path: only in the Supabase build
 * and only without the release E-20 (BUERO_CLOUD_FREIGABE). Floors do not apply there.
 * @param {string} modul
 * @param {string} datenquelle 'serverlos'|'express'|'supabase'
 * @param {boolean} [freigabe] E-20 switch, default BUERO_CLOUD_FREIGABE
 * @returns {boolean}
 */
export function cloudGesperrt(modul, datenquelle, freigabe = BUERO_CLOUD_FREIGABE) {
  return datenquelle === "supabase" && freigabe !== true && CLOUD_GESPERRT.includes(modul);
}

/**
 * Access object of a session.
 * @typedef {{
 *   rolle: string|null, nutzer: Record<string, any>|null, mitarbeiterId: string|null,
 *   stufen: Record<string, 'aus'|'lesen'|'voll'>, projektIds: Set<string>|null,
 *   lesemodus: boolean, datenquelle: string, istEchteAnmeldung: boolean, hinweisOhneMitarbeiter: boolean,
 * }} Zugriff
 */

/**
 * Builds the access object. Without a user record (sole owner, E-17) the role
 * is the given one or inhaber. Project view: inhaber/buchhaltung (or a role
 * set to 'alle' in the Setting) see every project; projektleitung/mitarbeiter
 * see their assignments — a person WITHOUT assignment sees all projects
 * (81 zuordnungenFuer → alle: true, E-17); a user record of such a role
 * without a linked person sees none (hint).
 * @param {{
 *   rolle?: string|null, serverRolle?: {role?: string, buero_rolle?: string}|null, nutzer?: Record<string, any>|null,
 *   einstellung?: Record<string, any>|null, zuordnungen?: ReadonlyArray<{mitarbeiter_id: string, alle: boolean, zuordnungen: ReadonlyArray<{project_id: string}>}>|null,
 *   datenquelle?: string, lesemodus?: boolean, freigabe?: boolean,
 * }} eingabe
 * @returns {Zugriff}
 */
export function baueZugriff({ rolle = null, serverRolle = null, nutzer = null, einstellung = null, zuordnungen = null, datenquelle = "express", lesemodus = false, freigabe = BUERO_CLOUD_FREIGABE }) {
  const effRolle = nutzer?.rolle ?? rolle ?? "inhaber";
  const roh = datenquelle === "supabase" && serverRolle ? schnittStufen(effRolle, serverRolle, einstellung) : matrixFuer(effRolle, einstellung);
  const lesen = lesemodus || (datenquelle === "supabase" && serverLesemodus(serverRolle));
  /** @type {Record<string, any>} */
  const stufen = {};
  for (const m of MODULE) {
    let s = roh[m];
    if (lesen && s === "voll") s = "lesen";
    if (cloudGesperrt(m, datenquelle, freigabe)) s = "aus";
    stufen[m] = s;
  }
  const mitarbeiterId = nutzer?.mitarbeiter_id ?? null;
  const { projektsicht } = bereinigeUeberschreibungen(einstellung);
  const sicht = projektsicht[effRolle] || STANDARD_PROJEKTSICHT[effRolle] || "zuordnung";
  /** @type {Set<string>|null} */
  let projektIds = null;
  let hinweisOhneMitarbeiter = false;
  if (sicht === "zuordnung" && nutzer) {
    if (!mitarbeiterId) {
      projektIds = new Set();
      hinweisOhneMitarbeiter = true;
    } else {
      const eintrag = (zuordnungen || []).find((z) => z?.mitarbeiter_id === mitarbeiterId);
      // No entry or alle: true → all projects (E-17, same reading as 81's time tracking).
      if (eintrag && !eintrag.alle) projektIds = new Set((eintrag.zuordnungen || []).map((z) => z.project_id).filter(Boolean));
    }
  }
  return { rolle: effRolle, nutzer: nutzer || null, mitarbeiterId, stufen, projektIds, lesemodus: lesen, datenquelle, istEchteAnmeldung: Boolean(nutzer), hinweisOhneMitarbeiter };
}

/**
 * Whether the access allows a module at a level. A sub-right counts with its parent.
 * @param {Pick<Zugriff, 'stufen'>|null|undefined} zugriff
 * @param {string} modul
 * @param {'lesen'|'voll'} [stufe]
 * @returns {boolean}
 */
export function darf(zugriff, modul, stufe = "lesen") {
  if (!zugriff?.stufen) return false;
  let ist = zugriff.stufen[modul];
  const eltern = ELTERNMODUL[modul];
  if (eltern) ist = minStufe(ist, zugriff.stufen[eltern]);
  return rang(ist) >= Math.max(1, rang(stufe));
}

/**
 * Whether a project is in the access's project view. Records without a project
 * (office records) are always in.
 * @param {Pick<Zugriff, 'projektIds'>|null|undefined} zugriff
 * @param {string|null|undefined} projectId
 * @returns {boolean}
 */
export function darfProjekt(zugriff, projectId) {
  if (!projectId || !zugriff || zugriff.projektIds === null || zugriff.projektIds === undefined) return true;
  return zugriff.projektIds.has(projectId);
}

/**
 * Rights filter of the project list (runs before 81-06's archive filter).
 * @template {{id: string}} P
 * @param {ReadonlyArray<P>|null|undefined} projekte
 * @param {Pick<Zugriff, 'projektIds'>|null|undefined} zugriff
 * @returns {P[]}
 */
export function projekteNachZugriff(projekte, zugriff) {
  return (projekte || []).filter((p) => darfProjekt(zugriff, p?.id));
}

/**
 * Documents a role may see, by Document.bereich: none/'projekt' → project view;
 * 'buero' (81: fee PDFs in "00_Vertrag & Honorar") → auftrag + project view;
 * 'schriftverkehr' → schriftverkehr; 'buchhaltung' → buchhaltung; 'personal' →
 * personal; unknown area → owner only.
 * @template {{bereich?: string, project_id?: string|null}} D
 * @param {ReadonlyArray<D>|null|undefined} dokumente
 * @param {Zugriff|null|undefined} zugriff
 * @returns {D[]}
 */
export function sichtbareDokumente(dokumente, zugriff) {
  return (dokumente || []).filter((d) => {
    const b = d?.bereich;
    if (!b || b === "projekt") return darfProjekt(zugriff, d?.project_id);
    if (b === "buero") return darf(zugriff, "auftrag") && darfProjekt(zugriff, d?.project_id);
    if (b === "schriftverkehr") return darf(zugriff, "schriftverkehr");
    if (b === "buchhaltung") return darf(zugriff, "buchhaltung");
    if (b === "personal") return darf(zugriff, "personal");
    return zugriff?.rolle === "inhaber";
  });
}

/**
 * Whether the access may see the reason of an absence (E-14): with the right
 * personal, or for the own entry.
 * @param {Zugriff|null|undefined} zugriff
 * @param {string|null|undefined} mitarbeiterId the absence's person
 * @returns {boolean}
 */
export function darfGrundSehen(zugriff, mitarbeiterId) {
  if (darf(zugriff, "personal")) return true;
  return Boolean(mitarbeiterId) && zugriff?.mitarbeiterId === mitarbeiterId;
}

/**
 * Whether a user is the last active owner (then neither demotable nor deactivatable).
 * @param {ReadonlyArray<{id?: string, rolle?: string, aktiv?: boolean}>} nutzer all user records
 * @param {string} [id] the user to check (default: true when exactly one active owner exists)
 * @returns {boolean}
 */
export function letzterInhaberGeschuetzt(nutzer, id) {
  const inhaber = (nutzer || []).filter((n) => n?.rolle === "inhaber" && n.aktiv !== false);
  if (inhaber.length !== 1) return false;
  return id === undefined || inhaber[0].id === id;
}
