// 96: tax due dates move by the office calendar (state holidays, § 108 Abs. 3 AO);
// without a calendar only the nation-wide holidays apply.
import { test } from "node:test";
import assert from "node:assert/strict";
import { steuerFaellig, vorauszahlungsTermine } from "@/lib/accounting/steuertermine.js";
import { saetzeZum } from "@/lib/accounting/einstellungen.js";

const BAYERN = { bundesland: "BY", mariae_himmelfahrt: true, augsburger_friedensfest: false };

test("ohne Kalender: nur bundeseinheitliche Feiertage", () => {
  // 2026-06-04 is Corpus Christi (Thursday) — no nation-wide holiday.
  assert.equal(steuerFaellig("2026-06-04"), "2026-06-04");
  // Weekend still moves: 2026-01-10 is a Saturday.
  assert.equal(steuerFaellig("2026-01-10"), "2026-01-12");
});

test("mit Bürokalender Bayern: Fronleichnam und Allerheiligen verschieben", () => {
  assert.equal(steuerFaellig("2026-06-04", BAYERN), "2026-06-05");
  // 2027-11-01 (All Saints, Monday) → Tuesday.
  assert.equal(steuerFaellig("2027-11-01", BAYERN), "2027-11-02");
  // Hamburg: Corpus Christi is no public holiday there.
  assert.equal(steuerFaellig("2026-06-04", { bundesland: "HH" }), "2026-06-04");
});

test("Vorauszahlungstermine nehmen den Kalender mit", () => {
  const saetze = saetzeZum("2026-01-01");
  const ohne = vorauszahlungsTermine(2026, "est", saetze);
  const mit = vorauszahlungsTermine(2026, "est", saetze, BAYERN);
  assert.equal(ohne.length, mit.length);
  assert.ok(mit.every((t, i) => t.faellig >= ohne[i].faellig));
});
