// 112-01 task 1 (foreign review 08.11.2026, point 1): the portfolio page shows no invented figures.
//
// In:  src/lib/portfolio/portfolioKennzahlen.js (pure functions) and the source text of the two pages that carried fixed
//      demo values (AtelierDeveloper.jsx, ProjectDashboard.jsx).
// Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { portfolioKennzahlen, letzteAktivitaeten } from "@/lib/portfolio/portfolioKennzahlen.js";

/** Source text without comments — the file headers name the removed values on purpose. */
const lies = (datei) =>
  fs.readFileSync(new URL(`../../${datei}`, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

test("empty database: no area, no screening result, no activity", () => {
  const k = portfolioKennzahlen([], []);
  assert.deepEqual(k, { anzahl: 0, flaecheM2: null, mitFlaeche: 0, screening: { eingehalten: 0, mitErgebnis: 0 } });
  assert.deepEqual(letzteAktivitaeten([], []), []);
  // Defensive: missing lists behave like empty ones.
  assert.equal(portfolioKennzahlen(/** @type {any} */ (null), /** @type {any} */ (undefined)).anzahl, 0);
});

test("area = sum of the entered project areas (m²), null when no project has one", () => {
  const projekte = [
    { id: "a", building_area: 1200 },
    { id: "b", area_net: 300.4 },
    { id: "c" },
  ];
  const k = portfolioKennzahlen(projekte, []);
  assert.equal(k.anzahl, 3);
  assert.equal(k.flaecheM2, 1500.4);
  assert.equal(k.mitFlaeche, 2);
  assert.equal(portfolioKennzahlen([{ id: "x" }], []).flaecheM2, null);
});

test("screening counts only the given (role-filtered) projects", () => {
  const szenarien = [
    { project_id: "a", created_date: "2026-11-01T10:00:00Z", geg_compliance: { passes_geg: true } },
    { project_id: "versteckt", created_date: "2026-11-02T10:00:00Z", geg_compliance: { passes_geg: true } },
  ];
  assert.deepEqual(portfolioKennzahlen([{ id: "a" }], szenarien).screening, { eingehalten: 1, mitErgebnis: 1 });
});

test("activities: real timestamps, newest first, hidden projects and undated records left out", () => {
  const projekte = [
    { id: "a", name: "Haus A", updated_date: "2026-11-03T08:00:00Z" },
    { id: "b", name: "Haus B", updated_date: "kein Datum" },
  ];
  const szenarien = [
    { id: "s1", project_id: "a", created_date: "2026-11-05T08:00:00Z" },
    { id: "s2", project_id: "versteckt", created_date: "2026-11-06T08:00:00Z" },
  ];
  const zeilen = letzteAktivitaeten(projekte, szenarien, 5);
  assert.deepEqual(zeilen.map((z) => [z.art, z.projektName, z.datum]), [
    ["screening", "Haus A", "2026-11-05T08:00:00Z"],
    ["projekt", "Haus A", "2026-11-03T08:00:00Z"],
  ]);
  assert.equal(letzteAktivitaeten(projekte, szenarien, 1).length, 1);
});

test("activities: a project never changed since creation is 'angelegt', not 'geändert'", () => {
  const zeilen = letzteAktivitaeten([
    { id: "neu", name: "Neu", created_date: "2026-11-04T08:00:00Z", updated_date: "2026-11-04T08:00:00Z" },
    { id: "nurAnlage", name: "", created_date: "2026-11-02T08:00:00Z" },
    { id: "geaendert", name: "Alt", created_date: "2026-10-01T08:00:00Z", updated_date: "2026-11-03T08:00:00Z" },
  ], [], 5);
  assert.deepEqual(zeilen.map((z) => [z.art, z.projektName]), [["angelegt", "Neu"], ["projekt", "Alt"], ["angelegt", ""]]);
  const seite = lies("src/pages/AtelierDeveloper.jsx");
  assert.match(seite, /t\("Projekt angelegt"\)/);
  assert.match(seite, /a\.projektName \|\| t\("\(ohne Namen\)"\)/);
  // The count tile has no status filter, so it must not claim "Aktive Projekte".
  assert.doesNotMatch(seite, /Aktive Projekte/);
});

test("pages carry no fixed demo figures any more", () => {
  const seite = lies("src/pages/AtelierDeveloper.jsx");
  for (const muster of [/mock data/i, /125000/, /82\.4/, /23\.1/, /45600000/, /vor \d+ Stunden/, /Systemzustand<\/CardTitle>/, /value=\{(98|94|100)\}/]) {
    assert.doesNotMatch(seite, muster, `AtelierDeveloper.jsx still contains ${muster}`);
  }
  // Count and screening come from the role-filtered list (portfolioKennzahlen(projects, …)), not from the raw response.
  assert.match(seite, /portfolioKennzahlen\(projects,/);
  assert.doesNotMatch(seite, /screeningZaehlung\(projectsData/);
  assert.doesNotMatch(lies("src/components/investment/ProjectDashboard.jsx"), /value=\{30\}|>30%</);
  assert.doesNotMatch(lies("src/components/investment/ProjectDashboard.jsx"), />Grundstückseigentümer<|>Beteiligte</);
});
