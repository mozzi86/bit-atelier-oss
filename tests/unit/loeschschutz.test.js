// Phase 81 (81-06, BUERO-03): project deletion guard and archive — proj-1 of the
// sample is locked with reasons and counts, a project without office records is
// not, invoices count through their contract, the archive filter of the project
// pickers, and the loader queries nothing on a locked data path (E-03); plus
// source checks that ProjectContext stays inside @core and Layout.jsx/startProjekt
// were not touched by the archive.
//
// In:  src/lib/projektLoeschschutz.js, @core/lib/projektArchiv.js, the 79/81 sample. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { istArchiviert, ladeLoeschDaten, loeschSperre } from "@/lib/projektLoeschschutz.js";
import { sichtbareProjekte } from "@core/lib/projektArchiv.js";
import { beispielDatensaetze } from "@/lib/accounting/beispielDaten.js";
import { beispielDatensaetzeZeitHonorar, SEED_REFERENZ_HEUTE } from "@/lib/zeitHonorar/beispielDaten.js";
import { setzeDatenquelleZH } from "@/lib/zeitHonorar/speicher.js";

/** The guard's lists from the 79 + 81 sample. */
function saat() {
  const bh = beispielDatensaetze(SEED_REFERENZ_HEUTE);
  const zh = beispielDatensaetzeZeitHonorar(SEED_REFERENZ_HEUTE, { buchhaltung: bh, personal: null });
  return { zeitbuchungen: zh.Zeitbuchung, angebote: zh.Honorarangebot, vertraege: bh.Honorarvertrag, ausgangsrechnungen: bh.Ausgangsrechnung };
}

test("loeschSperre(proj-1, Saat): gesperrt mit Zeitbuchung, Honorarangebot, Honorarvertrag, Ausgangsrechnung und Anzahlen", () => {
  const daten = saat();
  const r = loeschSperre("proj-1", daten);
  assert.equal(r.gesperrt, true);
  assert.deepEqual(r.gruende.map((g) => g.entitaet), ["Zeitbuchung", "Honorarangebot", "Honorarvertrag", "Ausgangsrechnung"]);
  assert.equal(r.gruende[0].anzahl, daten.zeitbuchungen.filter((b) => b.project_id === "proj-1").length);
  assert.equal(r.gruende[2].anzahl, 1);
  assert.ok(r.gruende.every((g) => g.anzahl > 0));
});

test("Projekt ohne Büro-Daten → nicht gesperrt; Rechnung ohne project_id zählt über den Vertrag", () => {
  assert.deepEqual(loeschSperre("proj-leer", saat()), { gesperrt: false, gruende: [] });
  const r = loeschSperre("p7", { vertraege: [{ id: "hv-7", project_id: "p7" }], ausgangsrechnungen: [{ id: "ar", honorarvertrag_id: "hv-7" }, { id: "ar-x", honorarvertrag_id: "hv-fremd" }] });
  assert.deepEqual(r.gruende, [{ entitaet: "Honorarvertrag", anzahl: 1 }, { entitaet: "Ausgangsrechnung", anzahl: 1 }]);
});

test("istArchiviert und sichtbareProjekte: archivierte fallen weg, außer dem aktiven", () => {
  assert.equal(istArchiviert({ archiviert_am: "2026-09-28" }), true);
  assert.equal(istArchiviert({}), false);
  assert.equal(istArchiviert(null), false);
  const liste = [{ id: "a" }, { id: "b", archiviert_am: "2026-09-28" }, { id: "c", archiviert_am: null }];
  assert.deepEqual(sichtbareProjekte(liste, null).map((p) => p.id), ["a", "c"]);
  assert.deepEqual(sichtbareProjekte(liste, "b").map((p) => p.id), ["a", "b", "c"]);
  assert.deepEqual(sichtbareProjekte(null, "a"), []);
});

test("Lader: Supabase ohne Freigabe → 0 Aufrufe, leere Listen; lokal genau die vier Sammlungen", async () => {
  const aufrufe = [];
  const api = { entities: new Proxy({}, { get: (_, name) => ({
    list: async () => { aufrufe.push(["list", name]); return [{ id: `${String(name)}-1`, project_id: "p1" }]; },
    filter: async (f) => { aufrufe.push(["filter", name, f.project_id]); return [{ id: `${String(name)}-1`, project_id: f.project_id }]; },
  }) }) };
  const leer = await ladeLoeschDaten(api, "p1", { datenquelle: "supabase", cloudFreigabe: false });
  assert.deepEqual(leer, { zeitbuchungen: [], angebote: [], vertraege: [], ausgangsrechnungen: [] });
  assert.equal(aufrufe.length, 0);
  setzeDatenquelleZH("serverlos");
  const d = await ladeLoeschDaten(api, "p1", { datenquelle: "serverlos" });
  assert.deepEqual(aufrufe.map((a) => a[1]).sort(), ["Ausgangsrechnung", "Honorarangebot", "Honorarvertrag", "Zeitbuchung"]);
  assert.equal(loeschSperre("p1", d).gesperrt, true);
});

test("Paketgrenze und E-06: ProjectContext importiert nur @core; Layout.jsx und startProjekt.js kennen kein Archiv", () => {
  const lesen = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
  const ctx = lesen("packages/nova-core/src/lib/ProjectContext.jsx");
  assert.match(ctx, /from "@core\/lib\/projektArchiv(\.js)?"/);
  assert.doesNotMatch(ctx, /from "@\//);
  assert.match(ctx, /alleProjekte/);
  assert.doesNotMatch(lesen("src/Layout.jsx"), /archiv/i);
  assert.doesNotMatch(lesen("packages/nova-core/src/lib/startProjekt.js"), /archiv/i);
});
