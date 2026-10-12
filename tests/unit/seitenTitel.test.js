// Unit tests for the browser tab titles (72-10, N-06): src/seitenTitel.js.
//
// The tab title reuses the menu titles of src/navigation.js, so these tests run
// against the real navFlach: a new menu entry gets its tab title for free, and
// a legal route added to App.jsx without a title shows up here.
//
// In:  seitenTitel.js, navFlach and the public route list. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { navFlach } from "@/navigation.js";
import { seitenTitelFuer, dokumentTitel, RECHTSWEG_TITEL, PRODUKTNAME } from "@/seitenTitel.js";
import { OEFFENTLICHE_WEGE } from "@core/lib/oeffentlicheWege";

test("jeder Menüeintrag liefert seinen Menütitel", () => {
  assert.ok(navFlach.length >= 19, `nur ${navFlach.length} Menüeinträge`);
  for (const eintrag of navFlach) {
    assert.equal(seitenTitelFuer(eintrag.url, navFlach), eintrag.title, eintrag.url);
  }
});

test("Prüf-Suite und Komplex-Designer haben eigene Titel", () => {
  assert.equal(seitenTitelFuer("/ModelCheck", navFlach), "Prüf-Suite");
  assert.equal(seitenTitelFuer("/ComplexDesigner", navFlach), "Komplex-Designer");
  assert.equal(seitenTitelFuer("/AVA", navFlach), "AVA (Ausschreibung)");
});

test("Pfad wie im Router: Groß/Klein egal, abschließender Schrägstrich, / = Projektübersicht", () => {
  assert.equal(seitenTitelFuer("/modelcheck", navFlach), "Prüf-Suite");
  assert.equal(seitenTitelFuer("/AVA/", navFlach), "AVA (Ausschreibung)");
  assert.equal(seitenTitelFuer("/", navFlach), "Projektübersicht");
});

test("Rechtswege haben einen Titel, auch ohne Menüliste", () => {
  assert.equal(seitenTitelFuer("/impressum", navFlach), "Impressum");
  assert.equal(seitenTitelFuer("/datenschutz", navFlach), "Datenschutz");
  assert.equal(seitenTitelFuer("/nutzungsbedingungen", navFlach), "Nutzungsbedingungen");
  assert.equal(seitenTitelFuer("/rueckerstattung", navFlach), "Rückerstattung");
  assert.equal(seitenTitelFuer("/cookies", navFlach), "Cookies");
  assert.equal(seitenTitelFuer("/anmeldung"), "Anmeldung");
  assert.equal(seitenTitelFuer("/passwort-zuruecksetzen", []), "Passwort zurücksetzen");
});

// 57-06: the list moved from App.jsx into @core/lib/oeffentlicheWege.js; App.jsx
// reads it from there (tests/unit/rechtstexte.test.js checks routes ↔ list).
test("jeder öffentliche Weg (oeffentlicheWege.js) steht in der Titeltabelle", () => {
  const wege = [...OEFFENTLICHE_WEGE];
  assert.ok(wege.length >= 7, `nur ${wege.length} öffentliche Wege gelesen`);
  assert.deepEqual(wege.filter((w) => !RECHTSWEG_TITEL[w]), [], "Rechtswege ohne Titel");
  assert.deepEqual(Object.keys(RECHTSWEG_TITEL).filter((w) => !wege.includes(w)), [], "Titel ohne Route");
});

test("unbekannter Pfad und fehlende Eingaben liefern null", () => {
  assert.equal(seitenTitelFuer("/GibtEsNicht", navFlach), null);
  assert.equal(seitenTitelFuer("/hauptinhalt", navFlach), null);
  assert.equal(seitenTitelFuer("/EnergyAnalysis", navFlach), null);
  assert.equal(seitenTitelFuer("/AVA", undefined), null);
  assert.equal(seitenTitelFuer("/AVA", [{ url: "/AVA" }]), null);
});

test("Titelformat: „{Titel} · BIT-Atelier“, ohne Titel nur der Produktname", () => {
  assert.equal(PRODUKTNAME, "BIT-Atelier");
  assert.equal(dokumentTitel("AVA (Ausschreibung)"), "AVA (Ausschreibung) · BIT-Atelier");
  assert.equal(dokumentTitel("  Check Suite  "), "Check Suite · BIT-Atelier");
  assert.equal(dokumentTitel(null), "BIT-Atelier");
  assert.equal(dokumentTitel(""), "BIT-Atelier");
  assert.equal(dokumentTitel("   "), "BIT-Atelier");
  assert.equal(dokumentTitel(undefined), "BIT-Atelier");
});
