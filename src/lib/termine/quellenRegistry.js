// Source registry of the deadline calendar (phase 82, FRIST-01) — the one file
// that imports the term sources (pattern naechsteSchritte.js).
//
// Model "aggregate instead of table" (D-P82-04): every source knows where its
// dates live (projects, books, personnel, contracts …) and turns them into the
// Termin shape of @core/lib/kalender/termin.js. A source has two halves:
//   laden(api, ctx)      reads records (in the browser, through bitApi or an adapter),
//   berechnen(roh, ctx)  turns them into terms — pure, testable under node.
//
// Rights first (T-82-01): a source whose module the role may not read is never
// even loaded (what must not be visible is not fetched), and every term is
// filtered again by its own module and project — a source may deliver terms of
// other modules. A failing source does not break the agenda: the other terms
// come back plus `fehler` in plain text.
//
// Acknowledging: a source with its own acknowledgement (personnel deadlines →
// 80's Fristquittung, D-P82-40) handles it; every other term gets one
// Terminquittung {termin_id, erledigt_am, von}.
//
// In:  api, access, window, rule reader. Out: QUELLEN, ladeTermine, quittiereTermin.

import { cloudGesperrt, darf, darfProjekt } from "@core/lib/rechte.js";
import { sammleTermine } from "@core/lib/kalender/termin.js";
import { QUELLE as projekt } from "./quellen/projekt.js";
import { QUELLE as manuell } from "./quellen/manuell.js";
import { QUELLE as abnahme } from "./quellen/abnahme.js";
import { QUELLE as steuer } from "./quellen/steuer.js";
import { QUELLE as personal } from "./quellen/personal.js";
import { QUELLE as vertrag } from "./quellen/vertrag.js";
import { QUELLE as honorarangebot } from "./quellen/honorarangebot.js";
import { QUELLE as bauzeitenplan } from "./quellen/bauzeitenplan.js";
import { QUELLE as ausschreibung } from "./quellen/ausschreibung.js";
import { QUELLE as lieferplan } from "./quellen/lieferplan.js";
import { QUELLE as foerderung } from "./quellen/foerderung.js";
import { QUELLE as abwesenheit } from "./quellen/abwesenheit.js";
import { QUELLE as postbuch } from "./quellen/postbuch.js";
import { QUELLE as genehmigung } from "./quellen/genehmigung.js";

/**
 * Context every source gets.
 * @typedef {{
 *   von: string, bis: string, heute: string, regelWert?: (id: string) => any, feiertage?: any[], kalender?: {bundesland?: string, mariae_himmelfahrt?: boolean, augsburger_friedensfest?: boolean}|null,
 *   projectId?: string|null, zugriff?: any, datenquelle?: string, rolle?: string|null, freigabe?: boolean,
 * }} QuellenKontext dates 'YYYY-MM-DD'; datenquelle/rolle: data path and server role (personnel adapter, cloud lock)
 */

/**
 * One source of terms.
 * @typedef {{
 *   key: string, label: string, modul: string, standardAn: boolean,
 *   laden: (api: any, ctx: QuellenKontext) => Promise<any>,
 *   berechnen: (roh: any, ctx: QuellenKontext) => import("@core/lib/kalender/termin.js").Termin[],
 *   quittiere?: (api: any, termin: import("@core/lib/kalender/termin.js").Termin, opt: {jetzt: string, nutzerId: string|null}) => Promise<any>,
 *   verfuegbar?: (ctx: QuellenKontext) => {ok: boolean, grund?: string},
 * }} TerminQuelle
 */

/** All 14 sources in display order (88-04 added genehmigung). @type {ReadonlyArray<TerminQuelle>} */
export const QUELLEN = Object.freeze([projekt, manuell, abnahme, steuer, personal, vertrag, honorarangebot, bauzeitenplan, ausschreibung, lieferplan, foerderung, genehmigung, abwesenheit, postbuch]);

/** German reason (i18n key) of a source locked in the cloud (E-03 without E-20). */
export const GRUND_CLOUD = "erst nach Zugriffstrennung (Phase 74)";

/**
 * Whether a source can deliver on this data path: off in a locked cloud build
 * when its module is locked there (E-03), or when the source itself says so
 * (a missing module, e.g. without phase 79).
 * @param {TerminQuelle} q
 * @param {QuellenKontext} ctx
 * @returns {{ok: boolean, grund?: string}}
 */
export function verfuegbarkeit(q, ctx) {
  if (ctx?.datenquelle && cloudGesperrt(q.modul, ctx.datenquelle, ctx.freigabe)) return { ok: false, grund: GRUND_CLOUD };
  return q.verfuegbar ? q.verfuegbar(ctx) : { ok: true };
}

/**
 * State of every source for the filter: key, label, module, default, availability.
 * @param {QuellenKontext} ctx
 * @returns {Array<{key: string, label: string, modul: string, standardAn: boolean, ok: boolean, grund?: string}>}
 */
export function quellenStatus(ctx) {
  return QUELLEN.map((q) => ({ key: q.key, label: q.label, modul: q.modul, standardAn: q.standardAn, ...verfuegbarkeit(q, ctx) }));
}

/** @param {unknown} fehler @returns {string} */
const text = (fehler) => /** @type {any} */ (fehler)?.message || String(fehler);

/**
 * Loads and collects the terms of all active sources the access may read.
 * @param {any} api bitApi or a fake
 * @param {QuellenKontext & {aktiveQuellen?: Iterable<string>|null, quellen?: ReadonlyArray<TerminQuelle>}} ctx
 *   quellen: injectable source list (tests); default QUELLEN
 * @returns {Promise<{termine: import("@core/lib/kalender/termin.js").Termin[], fehler: Array<{quelle: string, meldung: string}>}>}
 */
export async function ladeTermine(api, ctx) {
  const aktiv = ctx.aktiveQuellen ? new Set(ctx.aktiveQuellen) : null;
  const zugriff = ctx.zugriff || null;
  const gewaehlt = (ctx.quellen || QUELLEN).filter((q) => (aktiv ? aktiv.has(q.key) : q.standardAn)
    && (!zugriff || darf(zugriff, q.modul, "lesen"))
    && verfuegbarkeit(q, ctx).ok);
  const [ergebnisse, quittungen] = await Promise.all([
    Promise.allSettled(gewaehlt.map(async (q) => q.berechnen(await q.laden(api, ctx), ctx))),
    (async () => { try { return (await api?.entities?.Terminquittung?.list()) || []; } catch { return []; } })(),
  ]);
  /** @type {Array<{quelle: string, meldung: string}>} */
  const fehler = [];
  const listen = ergebnisse.map((r, i) => {
    if (r.status === "fulfilled") return r.value || [];
    fehler.push({ quelle: gewaehlt[i].key, meldung: text(r.reason) });
    return [];
  });
  const sichtbar = listen.map((liste) => liste.filter((t) => (!zugriff || (darf(zugriff, t.modul, "lesen") && darfProjekt(zugriff, t.project_id)))
    && (!ctx.projectId || !t.project_id || t.project_id === ctx.projectId)));
  return { termine: sammleTermine(sichtbar, { von: ctx.von, bis: ctx.bis, quittungen }), fehler };
}

/**
 * Acknowledges a term: through its source when the source has its own way,
 * otherwise as one Terminquittung.
 * @param {any} api
 * @param {import("@core/lib/kalender/termin.js").Termin} termin
 * @param {{jetzt: string, nutzerId: string|null}} opt jetzt 'YYYY-MM-DD'
 * @returns {Promise<any>}
 */
export async function quittiereTermin(api, termin, { jetzt, nutzerId }) {
  const quelle = QUELLEN.find((q) => q.key === termin?.quelle);
  if (quelle?.quittiere) return quelle.quittiere(api, termin, { jetzt, nutzerId });
  return api.entities.Terminquittung.create({ termin_id: termin.id, erledigt_am: jetzt, von: nutzerId ?? null });
}
