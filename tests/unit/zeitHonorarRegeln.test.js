// Phase 81 (81-01): the rule book "Zeit, Honorar & Controlling" (E-16) — shape,
// values, no duplicate of 79's incidental costs / VAT, visibility, and the
// number pattern through 79's number range.
//
// In:  src/lib/zeitHonorar/regeln.js, REGELWERKE (80), regelwerk core, nummernkreis.
//      Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ZEIT_HONORAR_REGELN, ZEIT_HONORAR_REGELWERK } from "@/lib/zeitHonorar/regeln.js";
import { ZEIT_HONORAR_ENTITAETEN, ZEIT_HONORAR_SETTING_KEYS } from "@/lib/zeitHonorar/entitaeten.js";
import { REGELWERKE, regelNachId } from "@/lib/settings/regelwerke.js";
import { wirksamerWert, regelWerteAus, pruefeOverride } from "@core/lib/regelwerk.js";
import { naechsteNummer } from "@core/lib/nummernkreis.js";

const wert = (id) => ZEIT_HONORAR_REGELN.find((r) => r.id === id)?.werte[0].wert;

test("jede Regel hat die Form des Regelkerns mit Quelle, Stand und Abschnitt", () => {
  assert.ok(ZEIT_HONORAR_REGELN.length >= 18);
  for (const r of ZEIT_HONORAR_REGELN) {
    assert.match(r.id, /^zeit_honorar\.[a-z_]+$/, r.id);
    assert.ok(r.label && r.einheit && r.abschnitt && r.quelle, r.id);
    assert.equal(r.art, "buero", r.id);
    assert.equal(r.stand, "2026-09-27", r.id);
    assert.equal(r.werte[0].ab, "2026-09-27", r.id);
    assert.ok(r.werte[0].quelle, r.id);
    assert.ok(r.assumed, r.id);
    assert.ok(["zahl", "prozent", "ja_nein", "text"].includes(r.typ), r.id);
  }
  assert.equal(new Set(ZEIT_HONORAR_REGELN.map((r) => r.id)).size, ZEIT_HONORAR_REGELN.length, "ids eindeutig");
});

test("E-16-Werte; keine Nebenkosten- oder USt-Regel (gehören 79)", () => {
  assert.equal(wert("zeit_honorar.tagessoll"), 480);
  assert.equal(wert("zeit_honorar.ag_anteil"), 21);
  assert.equal(wert("zeit_honorar.gemeinkosten"), 80);
  assert.equal(wert("zeit_honorar.produktivquote"), 85);
  assert.equal(wert("zeit_honorar.feiertage"), 13);
  assert.equal(wert("zeit_honorar.krankheitstage"), 10);
  assert.equal(wert("zeit_honorar.raster"), 15);
  assert.equal(wert("zeit_honorar.ampel_gelb"), 0);
  assert.equal(wert("zeit_honorar.ampel_rot"), 10);
  assert.equal(wert("zeit_honorar.angebot_gueltigkeit"), 30);
  assert.equal(wert("zeit_honorar.nummer_angebot"), "HA-{jahr}-{nr3}");
  assert.equal(wert("zeit_honorar.nummer_vertrag"), "AV-{jahr}-{nr3}");
  assert.ok(!ZEIT_HONORAR_REGELN.some((r) => /nebenkosten|ust/.test(r.id)), "eine Quelle je Wert (E-16)");
  assert.equal(wirksamerWert(/** @type {any} */ (regelNachId("zeit_honorar.gemeinkosten")), null, "2026-09-28").wert, 80);
});

test("REGELWERKE trägt die Gruppe zeit_honorar mit Speicher 'zeilen'; sichtbar wie die Buchhaltung (E-03/E-20)", () => {
  const g = REGELWERKE.find((x) => x.gruppe === "zeit_honorar");
  assert.ok(g);
  assert.equal(g, ZEIT_HONORAR_REGELWERK);
  assert.deepEqual(g.speicher, { art: "zeilen" });
  assert.equal(g.titel, "Zeit, Honorar & Controlling");
  assert.equal(g.sichtbar({ datenquelle: "supabase" }), false);
  assert.equal(g.sichtbar({ datenquelle: "supabase", buchhaltungCloud: true }), true);
  assert.equal(g.sichtbar({ datenquelle: "serverlos" }), true);
  assert.equal(g.sichtbar({ datenquelle: "express", personalZugang: "keine-berechtigung" }), true);
});

test("Override-Zeilen werden gelesen, Grenzen geprüft", () => {
  const leser = regelWerteAus(REGELWERKE, [{ id: "s1", key: "regel:zeit_honorar.gemeinkosten", value: { wert: 95, gueltig_ab: "2026-10-01" } }]);
  assert.equal(leser.wert("zeit_honorar.gemeinkosten", "2026-09-30"), 80);
  assert.equal(leser.wert("zeit_honorar.gemeinkosten", "2026-10-01"), 95);
  assert.equal(pruefeOverride(/** @type {any} */ (regelNachId("zeit_honorar.raster")), 3)?.schwere, "fail");
  assert.equal(pruefeOverride(/** @type {any} */ (regelNachId("zeit_honorar.tagessoll")), 800)?.schwere, "warn");
  assert.equal(pruefeOverride(/** @type {any} */ (regelNachId("zeit_honorar.tagesrahmen")), false), null);
});

test("Nummernkreis der Honorarangebote über 79s naechsteNummer", () => {
  assert.equal(naechsteNummer(wert("zeit_honorar.nummer_angebot"), ["HA-2026-001", "RE-2026-014"], "2026-09-28"), "HA-2026-002");
  assert.equal(naechsteNummer(wert("zeit_honorar.nummer_vertrag"), [], "2026-09-28"), "AV-2026-001");
});

test("Entitäten und Setting-Schlüssel der Phase (Exportzeile 81-06)", () => {
  assert.deepEqual([...ZEIT_HONORAR_ENTITAETEN], ["Zeitbuchung", "Arbeitszeit", "Honorarangebot", "Honorarnachtrag"]);
  assert.equal(ZEIT_HONORAR_SETTING_KEYS[0], "zeit_honorar");
  assert.ok(ZEIT_HONORAR_SETTING_KEYS.includes("regel:zeit_honorar.gemeinkosten"));
  assert.equal(ZEIT_HONORAR_SETTING_KEYS.length, ZEIT_HONORAR_REGELN.length + 1);
});
