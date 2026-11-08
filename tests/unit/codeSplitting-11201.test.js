// 112-01 task 2 (foreign review 08.11.2026, point 2): the browser-database modules (demoDb, personalDb, schnappschuesse,
// demoIdb) and pdf-lib are no longer "dynamically imported … but also statically imported" in the same chunk.
//
// The build itself is checked in the gates (grep on build.log); this test guards the source causes so a later edit does not
// bring the warnings back unnoticed:
//   - App.jsx and Layout.jsx (entry chunk) do not import the storage chain statically;
//   - demoDb and schnappschuesse no longer import each other dynamically (the ring module breaks the cycle);
//   - DatenBereich imports the snapshot list statically (its dynamic import was ineffective);
//   - vite.config.js gives pdf-lib its own manual chunk and budget.json a limit for it.
// It also proves the split keeps behaviour: demoDbErsetzen still takes the snapshot before replacing.
//
// In:  source text of the named files; demoDb + schnappschuesse with an in-memory adapter. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const lies = (datei) => fs.readFileSync(new URL(`../../${datei}`, import.meta.url), "utf8");

test("entry chunk: App and Layout do not import the browser-database chain statically", () => {
  const app = lies("src/App.jsx");
  assert.doesNotMatch(app, /^import[^\n]*['"]@core\/api\/projektDatei['"]/m);
  assert.match(app, /await import\('@core\/api\/projektDatei'\)/);
  const layout = lies("src/Layout.jsx");
  assert.doesNotMatch(layout, /^import SpeicherStatus/m);
  assert.match(layout, /SERVERLOS \? React\.lazy\(\(\) => import\("\.\/demo\/SpeicherStatus"\)\) : null/);
});

test("demoDb and schnappschuesse: no mutual dynamic import, no cycle through the ring module", () => {
  const demoDb = lies("packages/nova-core/src/api/demoDb.js");
  const schnapp = lies("packages/nova-core/src/api/schnappschuesse.js");
  const ring = lies("packages/nova-core/src/api/schnappschussRing.js");
  assert.doesNotMatch(demoDb, /import\(['"]\.\/schnappschuesse\.js['"]\)/);
  assert.doesNotMatch(schnapp, /import\(['"]\.\/demoDb\.js['"]\)/);
  assert.match(demoDb, /from '\.\/schnappschussRing\.js'/);
  // The ring must never reach demoDb (directly or through projektDatei.js, which imports demoDb).
  assert.doesNotMatch(ring, /from ['"]\.\/(demoDb|projektDatei|schnappschuesse)\.js['"]/);
  const datenBereich = lies("src/components/settings/DatenBereich.jsx");
  assert.doesNotMatch(datenBereich, /import\("@core\/api\/schnappschuesse"\)/);
});

test("pdf-lib has its own chunk and its own size limit", () => {
  assert.match(lies("vite.config.js"), /node_modules\/pdf-lib\/'\)[^\n]*return 'pdflib'/);
  const budget = JSON.parse(lies("budget.json"));
  assert.ok(budget.grenzen.chunks.pdflib > 0, "budget.json grenzen.chunks.pdflib fehlt");
});

test("pdflib is a named chunk of the budget script (a later --schreiben keeps its own limit)", async () => {
  const { BENANNTE_CHUNKS } = await import("../../scripts/groessen-budget.mjs");
  assert.ok(BENANNTE_CHUNKS.includes("pdflib"), "BENANNTE_CHUNKS kennt pdflib nicht");
});

test("demoDbErsetzen still snapshots the previous state first (behaviour kept after the split)", async () => {
  const { setzeSpeicher, demoDbErsetzen, demoDbAuslesen } = await import("@core/api/demoDb.js");
  const { schnappschuesseListe, setzeSchnappschussSpeicher } = await import("@core/api/schnappschuesse.js");
  /** In-memory adapter shaped like demoIdb (pattern of schnappschuesse.test.js; entities() hides the snapshot store). */
  const speicher = () => {
    /** @type {Record<string, any[]>} */
    const daten = { Project: [{ id: "p1", name: "Vorher" }] };
    return {
      async entities() { return Object.keys(daten).filter((n) => n !== "_meta" && n !== "schnappschuesse"); },
      async alle(n) { return structuredClone(daten[n] || []); },
      async schreiben(n, r) {
        daten[n] = (daten[n] || []).filter((x) => x.id !== r.id);
        daten[n].push(structuredClone(r));
      },
      async schreibeViele(n, rows) { daten[n] = structuredClone(rows); },
      async loeschen(n, id) { daten[n] = (daten[n] || []).filter((x) => x.id !== id); },
      async leeren(n) { delete daten[n]; },
      async meta() { return null; },
    };
  };
  const a = speicher();
  setzeSpeicher(/** @type {any} */ (a), async () => ({ Project: [{ id: "p1", name: "Vorher" }] }));
  setzeSchnappschussSpeicher(/** @type {any} */ (a));
  await demoDbAuslesen();
  const r = await demoDbErsetzen({ Project: [{ id: "p2", name: "Nachher" }] }, "vor Test");
  assert.equal(r.schnappschussFehler, null, String(r.schnappschussFehler));
  const liste = await schnappschuesseListe();
  assert.equal(liste.length, 1);
  assert.equal(liste[0].grund, "vor Test");
  assert.deepEqual(liste[0].projekt.daten.Project.map((p) => p.name), ["Vorher"]);
});
