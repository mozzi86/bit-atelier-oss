// Traffic light of the project cards (projectModel.projectHealth, 72-09 / N-04).
//
// The badge is a statement about the schedule. FINDINGS-BACKLOG-20: a project
// without a completion date was shown green "Auf Kurs" — a claim without a basis.
// These cases pin every branch, dates relative to now so the test does not age.

import { test } from "node:test";
import assert from "node:assert/strict";
import { projectHealth } from "../../packages/nova-core/src/lib/projectModel.js";

const TAG_MS = 24 * 3600 * 1000;
/** ISO date `tage` days from now (negative = in the past). */
const inTagen = (tage) => new Date(Date.now() + tage * TAG_MS).toISOString();

test("ohne Fertigstellungstermin: neutral „Kein Termin“ statt „Auf Kurs“", () => {
  for (const projekt of [{ status: "design" }, { status: "construction", completion_date: null }, { status: "concept", completion_date: "" }, {}, null]) {
    const h = projectHealth(projekt);
    assert.equal(h.level, "offen", JSON.stringify(projekt));
    assert.equal(h.label, "Kein Termin");
    assert.match(h.color, /slate/, "keine Ampelfarbe ohne Grundlage");
    assert.match(h.dot, /slate/);
  }
});

test("Termin überschritten", () => {
  const h = projectHealth({ status: "construction", completion_date: inTagen(-10) });
  assert.equal(h.level, "late");
  assert.equal(h.label, "Termin überschritten");
});

test("weniger als 120 Tage bis zum Termin: Beobachten", () => {
  const h = projectHealth({ status: "construction", completion_date: inTagen(60) });
  assert.equal(h.level, "watch");
  assert.equal(h.label, "Beobachten");
});

test("genug Vorlauf: Auf Kurs", () => {
  const h = projectHealth({ status: "design", completion_date: inTagen(400) });
  assert.equal(h.level, "ok");
  assert.equal(h.label, "Auf Kurs");
});

test("abgeschlossen schlägt jeden Termin, auch ein altes Seed-Label", () => {
  assert.equal(projectHealth({ status: "completed", completion_date: inTagen(-300) }).level, "done");
  assert.equal(projectHealth({ status: "operation" }).label, "Abgeschlossen");
  assert.equal(projectHealth({ status: "Fertiggestellt" }).level, "done", "Seed-Label wird normalisiert");
});
