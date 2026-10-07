// Unit tests of the tax dates (79-01 T2, decisions E-04/E-09): prepayment dates
// with the working-day shift and the VAT return dates of every switch position.
// Check table: 79-RESEARCH "Steuertermine 2026" (weekdays recomputed there).
//
// In:  src/lib/accounting/steuertermine.js. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ustTerminDaten, vorauszahlungsTermine } from "@/lib/accounting/steuertermine.js";
import { saetzeZum } from "@/lib/accounting/einstellungen.js";

test("ESt: 10.03./10.06./10.09./10.12., 2026 alle Werktage", () => {
  const t = vorauszahlungsTermine(2026, "est");
  assert.deepEqual(t.map((x) => x.nenn), ["2026-03-10", "2026-06-10", "2026-09-10", "2026-12-10"]);
  assert.deepEqual(t.map((x) => x.faellig), ["2026-03-10", "2026-06-10", "2026-09-10", "2026-12-10"]);
  assert.deepEqual(t.map((x) => x.quartal), [1, 2, 3, 4]);
  assert.deepEqual(vorauszahlungsTermine(2026, "kst", saetzeZum("2026-01-01")).map((x) => x.nenn), t.map((x) => x.nenn));
});

test("GewSt: 15.02./15.05./15.08./15.11. (§ 19 GewStG), fällig nach Werktagsregel", () => {
  const t = vorauszahlungsTermine(2026, "gewst");
  assert.deepEqual(t.map((x) => x.nenn), ["2026-02-15", "2026-05-15", "2026-08-15", "2026-11-15"]);
  assert.deepEqual(t.map((x) => x.faellig), ["2026-02-16", "2026-05-15", "2026-08-17", "2026-11-16"]);
  assert.deepEqual(vorauszahlungsTermine(2026, "gibtsnicht"), []);
});

test("USt vierteljährlich ohne DFV (Bürostandard E-09): Q4/Vorjahr bis Q3", () => {
  const t = ustTerminDaten(2026, { ust_zeitraum: "quartal", dauerfrist: false });
  assert.deepEqual(t.map((x) => x.nenn), ["2026-01-10", "2026-04-10", "2026-07-10", "2026-10-10"]);
  assert.deepEqual(t.map((x) => x.faellig), ["2026-01-12", "2026-04-10", "2026-07-10", "2026-10-12"]);
  assert.deepEqual(t[0].zeitraum, { von: "2025-10-01", bis: "2025-12-31" });
  assert.deepEqual(t[3].zeitraum, { von: "2026-07-01", bis: "2026-09-30" });
  assert.ok(t.every((x) => x.art === "ust"));
});

test("USt vierteljährlich mit DFV: Q1 am 10.05. (So) → 11.05., keine Sondervorauszahlung", () => {
  const t = ustTerminDaten(2026, { ust_zeitraum: "quartal", dauerfrist: true });
  const q1 = t.find((x) => x.zeitraum?.von === "2026-01-01");
  assert.equal(q1.nenn, "2026-05-10");
  assert.equal(q1.faellig, "2026-05-11");
  assert.equal(t.some((x) => x.art === "ust_svz"), false);
  assert.deepEqual(t.map((x) => x.nenn), ["2026-02-10", "2026-05-10", "2026-08-10", "2026-11-10"]);
});

test("USt monatlich mit DFV: 12 VA-Nenntermine 10.01.–10.12. plus SVZ am 10.02.", () => {
  const t = ustTerminDaten(2026, { ust_zeitraum: "monat", dauerfrist: true });
  const va = t.filter((x) => x.art === "ust");
  assert.equal(va.length, 12);
  assert.deepEqual(va.map((x) => x.nenn), Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}-10`));
  const svz = t.filter((x) => x.art === "ust_svz");
  assert.equal(svz.length, 1);
  assert.equal(svz[0].nenn, "2026-02-10");
  const august = va.find((x) => x.zeitraum.von === "2026-08-01");
  assert.equal(august.nenn, "2026-10-10");
  assert.equal(august.faellig, "2026-10-12");
  assert.equal(va[0].zeitraum.von, "2025-11-01", "VA November des Vorjahres am 10.01.");
  assert.deepEqual(t.map((x) => x.nenn), [...t.map((x) => x.nenn)].sort(), "sortiert");
});

test("USt monatlich ohne DFV: Dezember 2026 am 10.01.2027 (So) → 11.01.2027", () => {
  const t = ustTerminDaten(2027, { ust_zeitraum: "monat", dauerfrist: false });
  assert.equal(t[0].zeitraum.von, "2026-12-01");
  assert.equal(t[0].nenn, "2027-01-10");
  assert.equal(t[0].faellig, "2027-01-11");
  assert.equal(t.some((x) => x.art === "ust_svz"), false);
});

test("USt jährlich (keine Voranmeldung): keine Termine, DFV wirkungslos", () => {
  assert.deepEqual(ustTerminDaten(2026, { ust_zeitraum: "jahr", dauerfrist: true }), []);
  assert.deepEqual(ustTerminDaten(2026, { ust_zeitraum: "jahr", dauerfrist: false }), []);
  assert.deepEqual(ustTerminDaten(2026, {}), []);
});
