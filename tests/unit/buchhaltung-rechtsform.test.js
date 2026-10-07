// Unit tests of the legal-form matrix (79-01 T1, decision E-04): the one
// function rechtsformWirkung(), the people check and the taxes per legal form.
//
// In:  src/lib/accounting/rechtsform.js, steuertermine.js, einstellungen.js.
// Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { RECHTSFORMEN, personenPruefen, rechtsformWirkung } from "@/lib/accounting/rechtsform.js";
import { steuerartenFuer } from "@/lib/accounting/steuertermine.js";
import { wirksameEinstellungen } from "@/lib/accounting/einstellungen.js";

test("RECHTSFORMEN: fünf Schlüssel in fester Reihenfolge, gleich der Whitelist der Einstellungen", () => {
  assert.deepEqual([...RECHTSFORMEN], ["einzelunternehmen", "gbr", "partg", "gmbh", "ug"]);
  assert.ok(Object.isFrozen(RECHTSFORMEN));
  // einstellungen.js keeps its own copy (single-entry-point rule); both must agree.
  for (const r of RECHTSFORMEN) assert.equal(wirksameEinstellungen({ rechtsform: r }).rechtsform, r);
  assert.equal(wirksameEinstellungen({ rechtsform: "ag" }).rechtsform, "einzelunternehmen");
});

test("Einzelunternehmen (Standard, auch für leere und unbekannte Eingaben)", () => {
  for (const eingabe of [{}, null, undefined, { rechtsform: "ag" }, { rechtsform: "einzelunternehmen" }]) {
    const w = rechtsformWirkung(eingabe);
    assert.equal(w.rechtsform, "einzelunternehmen");
    assert.equal(w.klasse, "natuerlich");
    assert.equal(w.gewinnermittlung, "euer");
    assert.equal(w.entnahmen, "inhaber");
    assert.equal(w.schluesselNoetig, false);
    assert.equal(w.vorauszahlung, "est");
    assert.equal(w.gewst, false);
    assert.equal(w.istFreiberuflerRegel, true);
    assert.equal(w.dienstwagen, "nutzungsentnahme");
  }
  assert.equal(rechtsformWirkung({ gewst_aktiv: true }).gewst, true);
  assert.ok(rechtsformWirkung({ gewst_aktiv: true }).hinweise.includes("buchfuehrung_141_pruefen"));
});

test("GbR und PartG: Entnahmen je Gesellschafter, Schlüssel nötig, ESt, GewSt nur bei gewst_aktiv", () => {
  for (const rechtsform of ["gbr", "partg"]) {
    const w = rechtsformWirkung({ rechtsform });
    assert.equal(w.klasse, "personengesellschaft");
    assert.equal(w.entnahmen, "gesellschafter");
    assert.equal(w.schluesselNoetig, true);
    assert.equal(w.vorauszahlung, "est");
    assert.equal(w.gewst, false);
    assert.equal(w.gewinnermittlung, "euer");
    assert.equal(rechtsformWirkung({ rechtsform, gewst_aktiv: true }).gewst, true);
  }
});

test("GmbH und UG: Bilanz, GF-Gehalt, KSt, GewSt immer, geldwerter Vorteil; UG mit Rücklage-Hinweis", () => {
  for (const rechtsform of ["gmbh", "ug"]) {
    const w = rechtsformWirkung({ rechtsform, gewst_aktiv: false });
    assert.equal(w.klasse, "kapitalgesellschaft");
    assert.equal(w.gewinnermittlung, "bilanz");
    assert.equal(w.entnahmen, "gf_gehalt");
    assert.equal(w.vorauszahlung, "kst");
    assert.equal(w.gewst, true, `${rechtsform}: GewSt kraft Rechtsform`);
    assert.equal(w.istFreiberuflerRegel, false);
    assert.equal(w.dienstwagen, "geldwerter_vorteil");
    assert.equal(w.schluesselNoetig, false);
  }
  assert.ok(rechtsformWirkung({ rechtsform: "ug" }).hinweise.includes("ug_ruecklage"));
  assert.ok(!rechtsformWirkung({ rechtsform: "gmbh" }).hinweise.includes("ug_ruecklage"));
});

test("personenPruefen: Warnungen je Rechtsform, nie blockierend", () => {
  const zwei = [{ id: "g1", aktiv: true }, { id: "g2" }];
  assert.deepEqual(personenPruefen(zwei, { rechtsform: "einzelunternehmen" }), ["einzel_mehrere_personen"]);
  assert.deepEqual(personenPruefen([{ id: "g1", aktiv: true }], { rechtsform: "einzelunternehmen" }), []);
  assert.deepEqual(personenPruefen([...zwei, { id: "g3", aktiv: false }].slice(0, 1), {}), []);
  assert.deepEqual(personenPruefen(zwei, { rechtsform: "gbr" }, 2026), ["schluessel_fehlt"]);
  assert.deepEqual(personenPruefen(zwei, { rechtsform: "gbr", schluessel: { 2026: { g1: 60, g2: 40 } } }, 2026), []);
  assert.deepEqual(personenPruefen(zwei, { rechtsform: "gbr", schluessel: { 2025: { g1: 60, g2: 40 } } }, 2026), ["schluessel_fehlt"]);
  assert.deepEqual(personenPruefen(zwei, { rechtsform: "partg", schluessel: { 2026: { g1: 60, g2: 30 } } }, 2026), ["schluessel_fehlt"]);
  assert.deepEqual(personenPruefen(zwei, { rechtsform: "gmbh" }), []);
  assert.deepEqual(personenPruefen(null, null), []);
});

test("steuerartenFuer: Rechtsform und USt-Schalter", () => {
  assert.deepEqual(steuerartenFuer({ rechtsform: "einzelunternehmen", ust_zeitraum: "quartal" }), ["est", "ust"]);
  assert.deepEqual(steuerartenFuer({ rechtsform: "gmbh", ust_zeitraum: "monat" }), ["kst", "gewst", "ust"]);
  assert.deepEqual(steuerartenFuer({ rechtsform: "gbr", gewst_aktiv: true, ust_zeitraum: "quartal" }), ["est", "gewst", "ust"]);
  assert.deepEqual(steuerartenFuer({ rechtsform: "einzelunternehmen", ust_zeitraum: "jahr" }), ["est"]);
  assert.deepEqual(steuerartenFuer({ rechtsform: "ug", ust_zeitraum: "jahr" }), ["kst", "gewst"]);
});
