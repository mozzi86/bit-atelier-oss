// Guard test for the designer navigation registry (72-02).
//
// The registry only helps as long as it matches reality. So this test does not
// compare the registry against a hand-written list — it reads
// ComplexDesigner.jsx as TEXT, pulls every <TabsContent value="…"> out of it and
// demands an exact match. A renamed tab, a new panel or a typo in the registry
// fails here instead of silently hiding a tab from the UI.
//
// In:  the registry + the page source. Out: assertions, no side effects.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  DESIGNER_BEREICHE,
  DESIGNER_REITER,
  TAB_ALIAS,
  aufloesen,
  bereichFuerTab,
  istGueltigerTab,
  reiterFuerTab,
  reiterImBereich,
} from "@designer/config/designerNavigation.js";

const SEITE = new URL(
  "../../packages/nova-designer/src/pages/ComplexDesigner.jsx",
  import.meta.url
);

/** @returns {string[]} every TabsContent value in the page, in file order */
function tabsAusDerSeite() {
  const quelle = fs.readFileSync(SEITE, "utf8");
  return [...quelle.matchAll(/<TabsContent\s+value="([^"]+)"/g)].map((m) => m[1]);
}

test("Registry und Seite kennen exakt dieselben Reiter", () => {
  const ausDatei = tabsAusDerSeite();
  const ausRegistry = DESIGNER_REITER.map((r) => r.key);

  assert.equal(ausDatei.length, 30, "ComplexDesigner.jsx soll 30 TabsContent haben");
  assert.equal(ausRegistry.length, 30, "Registry soll 30 Reiter haben");

  const fehltInRegistry = ausDatei.filter((k) => !ausRegistry.includes(k));
  const verwaistInRegistry = ausRegistry.filter((k) => !ausDatei.includes(k));
  assert.deepEqual(fehltInRegistry, [], "Reiter in der Seite ohne Registry-Eintrag");
  assert.deepEqual(verwaistInRegistry, [], "Registry-Einträge ohne Reiter in der Seite");
});

test("keine doppelten Schlüssel", () => {
  const keys = DESIGNER_REITER.map((r) => r.key);
  assert.equal(new Set(keys).size, keys.length);
});

test("genau fünf Bereiche, jeder Reiter in genau einem davon", () => {
  assert.equal(DESIGNER_BEREICHE.length, 5);
  const ids = DESIGNER_BEREICHE.map((b) => b.id);
  assert.deepEqual(ids, ["standort", "baukoerper", "gebaeude", "nachweise", "ergebnis"]);

  for (const reiter of DESIGNER_REITER) {
    assert.ok(ids.includes(reiter.bereich), `${reiter.key} zeigt auf unbekannten Bereich ${reiter.bereich}`);
  }
  // Summe der Bereiche = alle Reiter, also kein Reiter unerreichbar.
  const summe = ids.reduce((n, id) => n + reiterImBereich(id).length, 0);
  assert.equal(summe, DESIGNER_REITER.length);
});

test("jeder Bereich hat mindestens einen Reiter", () => {
  for (const bereich of DESIGNER_BEREICHE) {
    assert.ok(reiterImBereich(bereich.id).length > 0, `Bereich ${bereich.id} ist leer`);
  }
});

test("Pflichtfelder je Reiter sind gesetzt", () => {
  for (const r of DESIGNER_REITER) {
    assert.equal(typeof r.label, "string", `${r.key}: label fehlt`);
    assert.ok(r.label.length > 0, `${r.key}: label leer`);
    assert.ok(r.icon, `${r.key}: icon fehlt`);
    assert.ok(Array.isArray(r.braucht), `${r.key}: braucht muss ein Array sein`);
    assert.ok(Array.isArray(r.liefert), `${r.key}: liefert muss ein Array sein`);
    assert.ok(["modell", "richtwert", "offen"].includes(r.stand), `${r.key}: stand ungültig`);
  }
});

test("studio ist das Massing-Studio, massing die Baufeld-Planung", () => {
  // Historische Vertauschung — der häufigste Fehler beim Umsortieren.
  assert.equal(reiterFuerTab("studio").label, "Massing-Studio");
  assert.equal(reiterFuerTab("massing").label, "Baufeld-Planung");
  assert.equal(bereichFuerTab("studio"), "baukoerper");
  assert.equal(bereichFuerTab("massing"), "baukoerper");
});

test("bereichFuerTab liefert für Unbekanntes null statt eines stillen Fallbacks", () => {
  assert.equal(bereichFuerTab("gibtsnicht"), null);
  assert.equal(bereichFuerTab(undefined), null);
  assert.equal(reiterFuerTab("gibtsnicht"), null);
  assert.equal(istGueltigerTab("gibtsnicht"), false);
  assert.deepEqual(reiterImBereich("gibtsnicht"), []);
});

test("Deep-Link-Auflösung: Alias, gültiger Schlüssel, Müll", () => {
  assert.equal(aufloesen("energie"), "energy", "Alias aus 72-01 A-13");
  assert.equal(aufloesen("studio"), "studio");
  assert.equal(aufloesen("quatsch"), null);
  assert.equal(aufloesen(null), null);
  assert.equal(aufloesen(""), null);
  assert.equal(aufloesen(undefined), null);
});

test("jeder Alias zeigt auf einen existierenden Reiter", () => {
  for (const [alias, ziel] of Object.entries(TAB_ALIAS)) {
    assert.ok(istGueltigerTab(ziel), `Alias ${alias} zeigt ins Leere: ${ziel}`);
  }
});

test("die Seite enthält keine eigene Reiter-Liste mehr", () => {
  // Kern von 72-02: Struktur steht in der Registry, nicht im JSX. Ein
  // wiederauftauchendes TAB_WERTE-Set wäre die zweite Wahrheit.
  const quelle = fs.readFileSync(SEITE, "utf8");
  assert.equal(/const\s+TAB_WERTE\s*=/.test(quelle), false, "TAB_WERTE gehört in die Registry");
  assert.equal(/const\s+TAB_ALIAS\s*=/.test(quelle), false, "TAB_ALIAS gehört in die Registry");
});
