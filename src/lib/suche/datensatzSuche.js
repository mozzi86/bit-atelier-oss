// Records for the command palette's full-text search (plan 105-28) — deadlines, meeting minutes, bill-of-quantities
// positions and documents, next to the modules, projects and contacts the palette already offers.
//
// Why a module of its own: the palette sits on every page; the records and their loaders (the deadline registry pulls
// fourteen term sources) must not weigh on the start path. Befehlspalette.jsx imports this file dynamically when it
// opens, like the settings registry (80-01).
//
// Rights first (same rule as the deadline registry, T-82-01): a source whose module the access may not read is never
// loaded; every row must belong to a project of the palette's project list (the context list, already filtered by role
// and project view, 82-02) — a row without a project is dropped [ASSUMED: office-wide documents/minutes are rare and
// their visibility rule is not settled, so they stay out of the palette rather than leak]. Deadlines come from
// ladeTermine(), which applies its own module/project filter; they are kept as it returns them.
// Documents additionally pass the reports page's area rule (sichtbareDokumente, 82-02).
//
// A failing source never breaks the palette: it yields no rows and the others come back.
//
// In:  api (bitApi or a fake), access, the visible project list, today. Out: DATENSATZ_QUELLEN, ladeDatensaetze().
// Every row carries its search text already prepared (suchVorbereiten), so a keystroke only scores, never folds.

import { darf, sichtbareDokumente } from "@core/lib/rechte.js";
import { suchVorbereiten } from "@core/lib/lockereSuche.js";
import { plusTage } from "@core/lib/kalender/datum.js";
import { TERMIN_ARTEN } from "@core/lib/kalender/termin.js";
import { ladeTermine } from "@/lib/termine/quellenRegistry.js";

/** Longest piece of a long text that goes into the search text (characters). [ASSUMED] keeps a keystroke over
 * thousands of positions fast; the start of a long text carries its subject. */
export const LANGTEXT_ZEICHEN = 300;

/** Window of the deadline search around today (days back, days ahead). [ASSUMED] the agenda's "overdue" past plus a year. */
export const FRISTEN_FENSTER = Object.freeze({ zurueck: 30, voraus: 400 });

/**
 * One record row of the palette.
 * @typedef {{
 *   quelle: string, gruppe: string, id: string, titel: string, zusatz: string, ziel: string,
 *   project_id: string|null, text: import("@core/lib/lockereSuche.js").SuchText,
 * }} Datensatz
 *   gruppe: German i18n key of the result group; titel/zusatz: data text (not translated, except the term kind prefix
 *   which is an i18n key passed through `t`); ziel: in-app link; project_id: switched to before jumping
 */

/**
 * Context of the loaders.
 * @typedef {{
 *   zugriff?: any, projekte: ReadonlyArray<{id: string, name?: string}>, heute: string,
 *   t?: (s: string) => string, datenquelle?: string, freigabe?: boolean, rolle?: string|null,
 * }} DatensatzKontext heute 'YYYY-MM-DD'
 */

/**
 * Short date text "TT.MM.JJJJ" of an ISO day (no time zone shift — the string is cut, not parsed).
 * @param {string|undefined|null} iso 'YYYY-MM-DD…'
 * @returns {string}
 */
function datumText(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : "";
}

/**
 * Lists one entity, [] on any failure (missing table in the cloud, offline server).
 * @param {any} api
 * @param {string} name entity name
 * @returns {Promise<any[]>}
 */
async function liste(api, name) {
  try {
    return (await api?.entities?.[name]?.list?.()) || [];
  } catch {
    return [];
  }
}

/**
 * A source of record rows.
 * @typedef {{key: string, gruppe: string, modul: string,
 *   laden: (api: any, ctx: DatensatzKontext) => Promise<any[]>,
 *   zeilen: (roh: any[], ctx: DatensatzKontext & {projektName: (id: string|null|undefined) => string}) => Datensatz[]}} DatensatzQuelle
 */

/** The record sources in group order. @type {ReadonlyArray<DatensatzQuelle>} */
export const DATENSATZ_QUELLEN = Object.freeze([
  {
    key: "fristen",
    gruppe: "Fristen & Termine",
    modul: "fristen",
    laden: async (api, ctx) => {
      // The deadline registry with its default sources and without the page's rule values: a source that needs one
      // falls back to its own default [ASSUMED same dates as the deadline page with untouched settings].
      const r = await ladeTermine(api, {
        von: /** @type {string} */ (plusTage(ctx.heute, -FRISTEN_FENSTER.zurueck)),
        bis: /** @type {string} */ (plusTage(ctx.heute, FRISTEN_FENSTER.voraus)),
        heute: ctx.heute, regelWert: () => undefined, feiertage: [], kalender: null, projectId: null,
        zugriff: ctx.zugriff, datenquelle: ctx.datenquelle, freigabe: ctx.freigabe, rolle: ctx.rolle ?? null,
      });
      return r.termine || [];
    },
    zeilen: (roh, ctx) => roh.map((x) => {
      const art = ctx.t ? ctx.t(TERMIN_ARTEN[x.art]?.label || x.art || "") : (TERMIN_ARTEN[x.art]?.label || x.art || "");
      const titel = [art, x.objekt].filter(Boolean).join(": ");
      const zusatz = [datumText(x.datum), ctx.projektName(x.project_id)].filter(Boolean).join(" · ");
      return {
        quelle: "fristen", gruppe: "Fristen & Termine", id: String(x.id), titel, zusatz,
        ziel: x.ziel || "/Deadlines", project_id: x.project_id || null,
        text: suchVorbereiten(`${titel} ${zusatz} ${x.herkunft || ""}`),
      };
    }),
  },
  {
    key: "protokolle",
    gruppe: "Protokolle",
    modul: "berichte",
    laden: (api) => liste(api, "MeetingMinutes"),
    zeilen: (roh, ctx) => roh.map((p) => {
      const titel = [p.nummer != null ? `${ctx.t ? ctx.t("Nr.") : "Nr."} ${p.nummer}` : "", p.titel].filter(Boolean).join(" · ");
      const zusatz = [datumText(p.datum), ctx.projektName(p.project_id)].filter(Boolean).join(" · ");
      const punkte = (p.punkte || []).map((/** @type {any} */ x) => `${x?.thema || ""} ${x?.text || ""} ${x?.zustaendig || ""}`).join(" ");
      return {
        quelle: "protokolle", gruppe: "Protokolle", id: String(p.id), titel, zusatz,
        ziel: "/Reports?tab=protokolle", project_id: p.project_id || null,
        text: suchVorbereiten(`${titel} ${zusatz} ${p.ort || ""} ${punkte.slice(0, LANGTEXT_ZEICHEN * 4)}`),
      };
    }),
  },
  {
    key: "positionen",
    gruppe: "LV-Positionen",
    modul: "ava",
    laden: (api) => liste(api, "LVPosition"),
    zeilen: (roh, ctx) => roh.map((p) => {
      const titel = [p.oz, p.short_text || p.title].filter(Boolean).join(" ");
      const zusatz = [p.trade, ctx.projektName(p.project_id)].filter(Boolean).join(" · ");
      const lang = String(p.long_text || p.langtext || "").slice(0, LANGTEXT_ZEICHEN);
      return {
        quelle: "positionen", gruppe: "LV-Positionen", id: String(p.id), titel, zusatz,
        ziel: "/AVA?tab=lv", project_id: p.project_id || null,
        text: suchVorbereiten(`${titel} ${p.title || ""} ${zusatz} ${lang}`),
      };
    }),
  },
  {
    key: "dokumente",
    gruppe: "Dokumente",
    modul: "berichte",
    laden: (api) => liste(api, "Document"),
    // Same area rule as the reports page (82-02): personal, accounting and correspondence documents need their own
    // right, so their titles never reach the palette of a role without it (DS-07). Fails closed without an access.
    zeilen: (roh, ctx) => sichtbareDokumente(roh, ctx.zugriff).map((d) => {
      const titel = String(d.name || d.title || d.file_name || "");
      const zusatz = [d.category || d.kategorie, ctx.projektName(d.project_id)].filter(Boolean).join(" · ");
      return {
        quelle: "dokumente", gruppe: "Dokumente", id: String(d.id), titel, zusatz,
        ziel: "/Reports?tab=docs", project_id: d.project_id || null,
        text: suchVorbereiten(`${titel} ${zusatz}`),
      };
    }),
  },
]);

/**
 * Loads the record rows the access may see.
 * @param {any} api bitApi or a fake with `entities.<Name>.list()`
 * @param {DatensatzKontext & {quellen?: ReadonlyArray<DatensatzQuelle>}} ctx quellen: injectable (tests)
 * @returns {Promise<Datensatz[]>} rows in source order; rows without a title are dropped
 */
export async function ladeDatensaetze(api, ctx) {
  const projekte = new Map((ctx.projekte || []).map((p) => [p.id, p.name || ""]));
  const projektName = (/** @type {string|null|undefined} */ id) => (id ? projekte.get(id) || "" : "");
  const quellen = (ctx.quellen || DATENSATZ_QUELLEN).filter((q) => !ctx.zugriff || darf(ctx.zugriff, q.modul, "lesen"));
  const ergebnisse = await Promise.allSettled(quellen.map(async (q) => {
    const zeilen = q.zeilen(await q.laden(api, ctx), { ...ctx, projektName });
    // Deadlines are filtered by their own registry; every other row must belong to a visible project.
    return q.key === "fristen" ? zeilen.filter((z) => !z.project_id || projekte.has(z.project_id))
      : zeilen.filter((z) => z.project_id && projekte.has(z.project_id));
  }));
  return ergebnisse.flatMap((r) => (r.status === "fulfilled" ? r.value : [])).filter((z) => z.titel);
}
