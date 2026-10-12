// 89-06 (D-BW-04): 4D timeline construction section × trade.

import { test } from "node:test";
import assert from "node:assert/strict";
import { zeitstrahlMatrix, standAlsCsv, abschnittVon, sollAnteil, OHNE_ABSCHNITT } from "@/lib/planung/zeitstrahl";

const T = [
  { name: "Bodenplatte", trade: "Rohbau", area: "BA 1", start_date: "2026-03-01T00:00:00Z", end_date: "2026-03-11T00:00:00Z", progress: 100 },
  { name: "Wände EG", trade: "Rohbau", bauabschnitt: "BA 2", area: "alt", start_date: "2026-03-11T00:00:00Z", end_date: "2026-03-21T00:00:00Z" },
  { name: "Fenster", trade: "Fassade", area: "BA 1", start_date: "2026-03-15T00:00:00Z", end_date: "2026-03-25T00:00:00Z", progress: 20 },
  { name: "ohne alles", start_date: "2026-04-01T00:00:00Z", end_date: "2026-04-02T00:00:00Z" },
  { name: "kaputt", trade: "TGA", start_date: "x", end_date: "2026-04-02" },
];
const ms = Date.parse("2026-03-16T00:00:00Z");

test("section: 89-05 field first, then area, never invented", () => {
  assert.equal(abschnittVon(T[1]), "BA 2");
  assert.equal(abschnittVon(T[0]), "BA 1");
  assert.equal(abschnittVon({}), OHNE_ABSCHNITT);
  assert.equal(sollAnteil(T[0], ms), 1);
  assert.equal(sollAnteil(T[4], ms), null);
});

test("matrix at a date: states, order by earliest start, ohne last, invalid counted", () => {
  const m = zeitstrahlMatrix(T, ms);
  assert.deepEqual(m.abschnitte, ["BA 1", "BA 2", OHNE_ABSCHNITT]);
  assert.deepEqual(m.gewerke, ["Rohbau", "Fassade", "ohne Gewerk"]);
  assert.equal(m.zelle("BA 1", "Rohbau").zustand, "fertig");
  assert.equal(m.zelle("BA 2", "Rohbau").zustand, "laeuft");
  assert.equal(m.zelle("BA 1", "Fassade").zustand, "laeuft");
  assert.ok(Math.abs(m.zelle("BA 1", "Fassade").soll - 0.1) < 1e-9);
  assert.equal(m.zelle("BA 1", "Fassade").ist, 0.2);
  assert.equal(m.zelle("BA 2", "Fassade"), null);
  assert.equal(m.zelle(OHNE_ABSCHNITT, "ohne Gewerk").zustand, "offen");
  assert.equal(m.unbewertbar, 1);
  assert.deepEqual(m.aktiv.map((a) => a.gewerk).sort(), ["Fassade", "Rohbau"]);
});

test("CSV of the state: one line per non-empty cell, semicolon, German", () => {
  const csv = standAlsCsv(zeitstrahlMatrix(T, ms), "2026-03-16").split("\n");
  assert.equal(csv[0], "Datum;Bauabschnitt;Gewerk;Zustand;Soll %;Ist %;Vorgänge");
  assert.equal(csv.length, 1 + 4);
  assert.ok(csv.includes("2026-03-16;BA 1;Rohbau;fertig;100;100;1"));
});
