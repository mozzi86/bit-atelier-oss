// Phase 81 (81-05): monthly progress history on HoaiPlan (packages/nova-core/src/lib/leistungsstand.js)
// — one entry per month (last save wins), at most 60, the progress valid in a
// month, and the single additive save path in the Designer's ProjectPlanner.
//
// In:  the history helpers; ProjectPlanner.jsx as source text. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fortschrittImMonat, mitVerlauf, VERLAUF_MAX } from "@core/lib/leistungsstand.js";

const P = (lp5) => [100, 100, 100, 100, lp5, 0, 0, 0, null];

test("mitVerlauf: zwei Speicherungen im September → 1 Eintrag (der letzte gewinnt), Oktober → 2", () => {
  let v = mitVerlauf([], P(40), "2026-09-03").verlauf;
  v = mitVerlauf(v, P(55), "2026-09-28").verlauf;
  assert.equal(v.length, 1);
  assert.deepEqual(v[0], { monat: "2026-09", progress: P(55) });
  const r = mitVerlauf(v, P(60), "2026-10-01");
  assert.equal(r.monat, "2026-10");
  assert.deepEqual(r.verlauf.map((e) => e.monat), ["2026-09", "2026-10"]);
  // The input history is not mutated.
  assert.equal(v.length, 1);
});

test("mitVerlauf: mit 60 Einträgen verdrängt der 61. Monat den ältesten; ungültige Einträge fallen weg", () => {
  const voll = Array.from({ length: VERLAUF_MAX }, (_, i) => {
    const jahr = 2021 + Math.floor(i / 12);
    return { monat: `${jahr}-${String((i % 12) + 1).padStart(2, "0")}`, progress: P(i) };
  });
  assert.equal(voll[0].monat, "2021-01");
  const r = mitVerlauf([...voll, { monat: "kaputt", progress: [] }, null], P(99), "2026-01-15").verlauf;
  assert.equal(r.length, VERLAUF_MAX);
  assert.equal(r[0].monat, "2021-02");
  assert.equal(r[r.length - 1].monat, "2026-01");
  assert.throws(() => mitVerlauf([], P(1), "kein Datum"), /ungültiges Datum/);
});

test("fortschrittImMonat: Verlauf 07/08/09 → Stand August; Lücke nimmt den Vormonat; vor dem ersten Eintrag null", () => {
  const verlauf = [{ monat: "2026-07", progress: P(25) }, { monat: "2026-09", progress: P(60) }, { monat: "2026-08", progress: P(40) }];
  assert.deepEqual(fortschrittImMonat(verlauf, "2026-08"), P(40));
  assert.deepEqual(fortschrittImMonat(verlauf.filter((e) => e.monat !== "2026-08"), "2026-08"), P(25));
  assert.equal(fortschrittImMonat(verlauf, "2026-06"), null);
  assert.equal(fortschrittImMonat(null, "2026-08"), null);
});

test("ProjectPlanner speichert {project_id, progress, verlauf} über mitVerlauf — eine additive Stelle, kein zweiter Editor", () => {
  const quelle = fs.readFileSync(new URL("../../packages/nova-designer/src/components/ProjectPlanner.jsx", import.meta.url), "utf8");
  assert.match(quelle, /import \{ mitVerlauf \} from "@core\/lib\/leistungsstand(\.js)?"/);
  assert.match(quelle, /import \{ heuteLokal \} from "@core\/lib\/kalender\/datum(\.js)?"/);
  assert.match(quelle, /const payload = \{ project_id: projectId, progress, verlauf: mitVerlauf\(verlaufRef\.current, progress, heuteLokal\(\)\)\.verlauf \}/);
  assert.equal((quelle.match(/mitVerlauf\(/g) || []).length, 1);
});
