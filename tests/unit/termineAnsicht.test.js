// Phase 82 (82-03): view rules of the deadline calendar — agenda groups on the
// reference day with the sample sources {projekt, manuell, abnahme}, only
// deadlines overdue, sort order, the month grid of October 2026 with the
// holiday 03.10., the due counter and the rights filter (project view, E-17).
//
// In:  termineAnsicht.js, the source registry, the 82 sample, rechte.js. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { filterNachZugriff, gruppiere, monatsRaster, zaehleFaellige } from "@/lib/termine/termineAnsicht.js";
import { ladeTermine } from "@/lib/termine/quellenRegistry.js";
import { baueZugriff } from "@core/lib/rechte.js";
import { feiertage, KALENDER_STANDARD } from "@core/lib/kalender/feiertage.js";
import { beispielDatensaetzeBueroOrga } from "@/lib/bueroOrga/beispielDaten.js";
import { regelNachId } from "@/lib/settings/regelwerke.js";
import { wirksamerWert } from "@core/lib/regelwerk.js";
import { projects } from "../../packages/nova-core/server/seed-data.js";
import { AGENDA_BEITRAG, AGENDA_FENSTER_BIS, SEED82_ANKER } from "./helpers/seed82Erwartung.mjs";

const HEUTE = SEED82_ANKER;

/** Terms of the sources {projekt, manuell, abnahme} of the sample on the reference day. */
async function saatTermine() {
  const s = beispielDatensaetzeBueroOrga(HEUTE, {});
  const listen = { Project: projects, Termin: s.Termin, Abnahme: s.Abnahme };
  const api = { entities: new Proxy({}, { get: (_, n) => ({ list: async () => listen[n] || [] }) }) };
  const regelWert = (id) => wirksamerWert(regelNachId(id), null, HEUTE)?.wert ?? null;
  return (await ladeTermine(api, { von: "2025-09-28", bis: AGENDA_FENSTER_BIS, heute: HEUTE, regelWert, aktiveQuellen: ["projekt", "manuell", "abnahme"] })).termine;
}

test("gruppiere: Seed-Quellen {projekt, manuell, abnahme}, Inhaber = Summe der AGENDA_BEITRAG-Konstanten (1 · 1 · 2 · 1 · 12)", async () => {
  const g = gruppiere(await saatTermine(), HEUTE, { agendaTage: 90 });
  const summe = (gruppe) => ["projekt", "manuell", "abnahme"].reduce((n, q) => n + (AGENDA_BEITRAG[q][gruppe] || 0), 0);
  const anzahl = Object.fromEntries(Object.entries(g).map(([k, v]) => [k, v.length]));
  assert.deepEqual(anzahl, { ueberfaellig: summe("ueberfaellig"), heute: summe("heute"), diese_woche: summe("diese_woche"), naechste_woche: summe("naechste_woche"), spaeter: summe("spaeter") });
  assert.deepEqual(anzahl, { ueberfaellig: 1, heute: 1, diese_woche: 2, naechste_woche: 1, spaeter: 12 });
  assert.equal(g.ueberfaellig[0].art, "begehung_vor_ablauf");
});

test("nur Fristen überfällig; vergangene Termine entfallen; erledigte nur auf Wunsch; Sortierung", () => {
  const t = (id, datum, klasse, extra = {}) => ({ id, datum, klasse, quelle: "x", art: "x", project_id: null, modul: "fristen", objekt: id, ziel: "/", ...extra });
  const liste = [t("termin-alt", "2026-09-01", "termin"), t("frist-alt", "2026-09-01", "frist"), t("erledigt", "2026-09-01", "frist", { erledigt: true }),
    t("b", "2026-09-30", "hinweis"), t("a", "2026-09-30", "frist"), t("c", "2026-09-30", "termin", { zeit: "09:00" }), t("laeuft", "2026-09-21", "hinweis", { bis: "2026-10-02" })];
  const g = gruppiere(liste, HEUTE);
  assert.deepEqual(g.ueberfaellig.map((x) => x.id), ["frist-alt"]);
  assert.deepEqual(g.heute.map((x) => x.id), ["laeuft"]);
  assert.deepEqual(g.diese_woche.map((x) => x.id), ["a", "c", "b"]);
  assert.equal(gruppiere(liste, HEUTE, { zeigeErledigte: true }).ueberfaellig.length, 1, "done deadline is not overdue");
  assert.equal(gruppiere([t("fern", "2027-06-01", "frist")], HEUTE, { agendaTage: 90 }).spaeter.length, 0);
});

test("monatsRaster Oktober 2026: 5 Wochen von Mo 28.09. bis So 01.11., 03.10. Feiertag", () => {
  const r = monatsRaster(2026, 10, [{ id: "x", datum: "2026-10-14", klasse: "frist", quelle: "x", art: "x", project_id: null, modul: "fristen", objekt: "x", ziel: "/" }], feiertage(2026, KALENDER_STANDARD));
  assert.equal(r.length, 5);
  assert.equal(r[0][0].datum, "2026-09-28");
  assert.equal(r[4][6].datum, "2026-11-01");
  const tag = (d) => r.flat().find((x) => x.datum === d);
  assert.equal(tag("2026-10-03")?.feiertag, true);
  assert.equal(tag("2026-09-28")?.imMonat, false);
  assert.equal(tag("2026-10-14")?.termine.length, 1);
  assert.equal(tag("2026-10-04")?.wochenende, true);
});

test("zaehleFaellige = Überfällig + Heute (Seed {projekt, manuell, abnahme}: 2)", async () => {
  assert.equal(zaehleFaellige(await saatTermine(), HEUTE), 2);
});

test("filterNachZugriff: Modul und Projektsicht; Person ohne Zuordnung behält alle (E-17)", () => {
  const t = (id, modul, project_id) => ({ id, modul, project_id, datum: "2026-10-01", klasse: "frist", quelle: "x", art: "x", objekt: id, ziel: "/" });
  const liste = [t("p", "personal", null), t("ha", "auftrag", "proj-3"), t("lph5", "auftrag", "proj-1"), t("ab", "fristen", "proj-4"), t("ohne", "fristen", null)];
  const pl = baueZugriff({ nutzer: { rolle: "projektleitung", mitarbeiter_id: "P-003" }, zuordnungen: [{ mitarbeiter_id: "P-003", alle: false, zuordnungen: [{ project_id: "proj-1" }, { project_id: "proj-2" }] }], datenquelle: "express" });
  assert.deepEqual(filterNachZugriff(liste, pl).map((x) => x.id), ["lph5", "ohne"]);
  const ma = baueZugriff({ nutzer: { rolle: "mitarbeiter", mitarbeiter_id: "P-004" }, zuordnungen: [{ mitarbeiter_id: "P-004", alle: true, zuordnungen: [] }], datenquelle: "express" });
  assert.deepEqual(filterNachZugriff(liste, ma).map((x) => x.id), ["ab", "ohne"]);
  assert.equal(filterNachZugriff(liste, baueZugriff({ rolle: "inhaber", datenquelle: "express" })).length, 5);
  assert.equal(filterNachZugriff(liste, null).length, 5);
});
