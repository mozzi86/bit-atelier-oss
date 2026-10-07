// Unit tests for the H-2 fix (BEFUNDE-79 §1 (H-2, behoben in §7), 79-14-SUMMARY finding 1):
// HonorarvertragFormular.jsx used to seed its `lph` (work-stage percentages)
// state once via `useState` from the profile shown at mount and never
// rebuild it when the user switched the Leistungsbild in the OPEN dialog —
// a stale percentage stayed positionally attached to a stage NUMBER that
// meant something else under the newly picked profile, silently mis-pricing
// the contract. The fix extracted the rebuild into the pure, exported
// `lphFuerLeistungsbild()` (@core/lib/hoai/honorar.js) so it can be proven
// here without a JSX/React test setup.
//
// In:  @core/lib/hoai/honorar.js (lphFuerLeistungsbild, honorarVertrag).
// Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { honorarVertrag, lphFuerLeistungsbild } from "@core/lib/hoai/honorar.js";

test("lphFuerLeistungsbild: Tragwerksplanung liefert die eigenen § 51-Prozente (3/10/15/30/40/2), nicht die von Gebäude", () => {
  const lph = lphFuerLeistungsbild("tragwerksplanung");
  assert.equal(lph.length, 6, "Tragwerksplanung hat nur LP 1–6, § 51 Abs. 1");
  assert.deepEqual(lph.map((z) => z.prozent), [3, 10, 15, 30, 40, 2]);
  assert.ok(lph.every((z) => z.beauftragt === true), "ein frischer Profilwechsel beauftragt alle Phasen");
});

test("lphFuerLeistungsbild: Gebäude liefert die 9 Prozente aus § 34 Abs. 3", () => {
  const lph = lphFuerLeistungsbild("gebaeude");
  assert.deepEqual(lph.map((z) => z.prozent), [2, 7, 15, 3, 25, 10, 4, 32, 2]);
  assert.equal(lph.length, 9);
});

test("lphFuerLeistungsbild: Profil ohne amtliche Tafel liefert 9 Phasen mit 0 % (Fallback der Tafel-fehlt-Anzeige)", () => {
  const lph = lphFuerLeistungsbild("unregistriertes_leistungsbild");
  assert.equal(lph.length, 9);
  assert.ok(lph.every((z) => z.beauftragt === true && z.prozent === 0));
});

test("H-2: Profilwechsel Gebäude → Tragwerksplanung im offenen Dialog — Gegenprobe gegen den gemeldeten Fehler", () => {
  // Simulates the BUGGY state before the fix: the form's `lph` array was
  // still Gebäude's [2,7,15,3,25,10,4,32,2] (useState never rebuilt), read
  // positionally by honorarVertrag() for Tragwerksplanung's 6 stages
  // (nr 1–6 → the first six Gebäude percentages [2,7,15,3,25,10]).
  const gebaeudeLph = lphFuerLeistungsbild("gebaeude");
  const vertragMitStalemLph = {
    leistungsbild: "tragwerksplanung",
    bezugswert: 425000,
    honorarzone: "III",
    satz_position_prozent: 0,
    lph: gebaeudeLph,
    umbauzuschlag_prozent: 0,
    nebenkosten_prozent: 5,
    ust_satz: 19,
  };
  const buggig = honorarVertrag(vertragMitStalemLph);
  assert.equal(buggig.grund, 24306.81, "Beleg des gemeldeten Fehlers (BEFUNDE-79 H-2): 24.306,81 € statt 39.204,51 €");

  // The fix: the form now calls lphFuerLeistungsbild("tragwerksplanung") on
  // the Leistungsbild change instead of keeping the stale array.
  const vertragMitNeuemLph = { ...vertragMitStalemLph, lph: lphFuerLeistungsbild("tragwerksplanung") };
  const behoben = honorarVertrag(vertragMitNeuemLph);
  assert.notEqual(behoben.grund, buggig.grund, "der Fix muss das falsche Ergebnis tatsächlich verändern");
});

test("H-2: Tragwerksplanung, Zone III, 425.000 €, Basissatz — Grundhonorar 39.204,51 € nach dem Fix (BEFUNDE-79 H-2)", () => {
  const vertrag = {
    leistungsbild: "tragwerksplanung",
    bezugswert: 425000,
    honorarzone: "III",
    satz_position_prozent: 0,
    lph: lphFuerLeistungsbild("tragwerksplanung"),
    umbauzuschlag_prozent: 0,
    nebenkosten_prozent: 5,
    ust_satz: 19,
  };
  const ergebnis = honorarVertrag(vertrag);
  assert.equal(ergebnis.quelle, "tafel");
  assert.equal(ergebnis.grund, 39204.51, "nicht die im Befund gemeldeten 24.306,81 €");
  assert.equal(ergebnis.netto, 41164.74);
});
