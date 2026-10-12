// Phase 82 (82-01): data contracts and rules — acceptance without default rule,
// absence without diagnosis or health data of third persons (E-14), letter
// states, the rule groups fristen/kalender in the rule book (E-16) with the
// calendar standard imported from the calendar core, the one holiday setting
// and the comparison with 81's calculation basis.
//
// In:  abnahme.js, abwesenheit.js, brief/status.js, fristenRegeln.js, kalenderRegeln.js, regelwerke.js. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { normalisiereAbnahme, ABNAHME_REGELN } from "@core/lib/kalender/abnahme.js";
import { abwesenheitStatusWechsel, ABWESENHEIT_ARTEN, ABWESENHEIT_FELDER, direktErfassbar, normalisiereAbwesenheit } from "@/lib/abwesenheit/abwesenheit.js";
import { BEREICHE, DOKUMENT_BEREICH, schreibenStatusWechsel } from "@core/lib/brief/status.js";
import { FRISTEN_REGELWERK } from "@/lib/termine/fristenRegeln.js";
import { feiertagsAbgleich, KALENDER_REGELWERK, kalenderEinstellung } from "@/lib/abwesenheit/kalenderRegeln.js";
import { KALENDER_STANDARD } from "@core/lib/kalender/feiertage.js";
import { REGELWERKE, regelNachId } from "@/lib/settings/regelwerke.js";
import { wirksamerWert } from "@core/lib/regelwerk.js";

test("Abnahme: Regel ohne Standard — ohne Regel ungültig", () => {
  assert.deepEqual(Object.keys(ABNAHME_REGELN), ["vob", "bgb", "individuell"]);
  const leer = normalisiereAbnahme({});
  assert.equal(leer.regel, null);
  assert.equal(leer.gueltig, false);
  assert.equal(leer.grund, "Regel fehlt");
  assert.equal(normalisiereAbnahme({ regel: "vob", datum: "2026-05-15" }).gueltig, true);
  assert.equal(normalisiereAbnahme({ regel: "vob" }).grund, "Datum fehlt");
});

test("Abwesenheit: keine Gesundheitsangabe über Dritte, kein Diagnosefeld, kein Freitext bei Krankheit (E-14)", () => {
  assert.deepEqual(Object.keys(ABWESENHEIT_ARTEN), ["urlaub", "krank", "abwesend", "fortbildung", "sonderurlaub", "ueberstunden", "elternzeit", "betriebsruhe"]);
  assert.ok(!("krank_kind" in ABWESENHEIT_ARTEN));
  for (const f of ABWESENHEIT_FELDER) assert.doesNotMatch(f, /diagnose|grund_text|^au$|arzt/, f);
  assert.equal(normalisiereAbwesenheit({ art: "krank", notiz: "Grippe" }).notiz, undefined);
  assert.equal(normalisiereAbwesenheit({ art: "abwesend", notiz: "Kind krank" }).notiz, undefined);
  assert.equal(normalisiereAbwesenheit({ art: "urlaub", notiz: "Ostsee" }).notiz, "Ostsee");
  assert.equal(normalisiereAbwesenheit({ art: "krank", diagnose: "x" }).diagnose, undefined, "unknown field dropped");
  assert.equal(normalisiereAbwesenheit({ art: "krank" }).status, "genehmigt");
  assert.equal(normalisiereAbwesenheit({ art: "urlaub" }).status, "beantragt");
  assert.equal(direktErfassbar("krank"), true);
  assert.equal(direktErfassbar("urlaub"), false);
  const amt = { von: "nu-1", amIso: "2026-09-28" };
  assert.equal(abwesenheitStatusWechsel({ status: "beantragt" }, "genehmigt", amt).ok, true);
  assert.equal(abwesenheitStatusWechsel({ status: "genehmigt" }, "storniert", amt).ok, true);
  assert.deepEqual(abwesenheitStatusWechsel({ status: "abgelehnt" }, "genehmigt", amt), { ok: false, fehler: "uebergang" });
  const r = abwesenheitStatusWechsel({ status: "beantragt" }, "abgelehnt", amt);
  assert.equal(r.ok && r.abwesenheit.entschieden_von, "nu-1");
});

test("Brief-Status und Bereiche", () => {
  assert.equal(schreibenStatusWechsel("entwurf", "festgeschrieben"), true);
  assert.equal(schreibenStatusWechsel("festgeschrieben", "versendet"), true);
  assert.equal(schreibenStatusWechsel("festgeschrieben", "entwurf"), false);
  assert.deepEqual(Object.keys(BEREICHE), ["projekt", "buero", "buchhaltung"], "no 'personal' in v1 (E-14)");
  assert.deepEqual(DOKUMENT_BEREICH, { projekt: "projekt", buero: "schriftverkehr", buchhaltung: "buchhaltung" });
});

test("Regeln im Regelwerk: Form, Werte, Standard aus KALENDER_STANDARD, Sichtbarkeit", () => {
  for (const g of [FRISTEN_REGELWERK, KALENDER_REGELWERK]) {
    for (const r of g.regeln) {
      for (const f of ["id", "label", "einheit", "typ", "art", "werte", "stand", "quelle", "abschnitt"]) assert.ok(r[f] !== undefined, `${r.id}: ${f}`);
      assert.match(r.id, new RegExp(`^${g.gruppe}\\.`));
    }
    assert.equal(g.sichtbar({ datenquelle: "supabase" }), false);
    assert.equal(g.sichtbar({ datenquelle: "express" }), true);
  }
  assert.deepEqual(wirksamerWert(regelNachId("fristen.vorlauf_frist_tage"), null, "2026-09-28").wert, [30, 7, 1]);
  assert.equal(wirksamerWert(regelNachId("fristen.vob_bauwerk_jahre"), null, "2026-09-28").wert, 4);
  assert.equal(wirksamerWert(regelNachId("kalender.bundesland"), null, "2026-09-28").wert, KALENDER_STANDARD.bundesland);
  assert.equal(wirksamerWert(regelNachId("kalender.mariae_himmelfahrt"), null, "2026-09-28").wert, KALENDER_STANDARD.mariae_himmelfahrt);
  assert.equal(wirksamerWert(regelNachId("kalender.augsburger_friedensfest"), null, "2026-09-28").wert, KALENDER_STANDARD.augsburger_friedensfest);
  assert.deepEqual(REGELWERKE.map((g) => g.gruppe), ["buchhaltung", "personal", "zeit_honorar", "fristen", "kalender"]);
});

test("kalenderEinstellung und feiertagsAbgleich (Kalender-Orakel 81)", () => {
  assert.deepEqual(kalenderEinstellung(() => null), { ...KALENDER_STANDARD });
  assert.equal(kalenderEinstellung((id) => (id === "kalender.mariae_himmelfahrt" ? false : null)).mariae_himmelfahrt, false);
  assert.deepEqual(feiertagsAbgleich(2026, KALENDER_STANDARD, 13), { kalender: 13, anWochentagen: 9, kalkulation: 13, abweichend: false });
  const ohne = feiertagsAbgleich(2026, { ...KALENDER_STANDARD, mariae_himmelfahrt: false }, 13);
  assert.equal(ohne.kalender, 12);
  assert.equal(ohne.abweichend, true);
  const quelle = fs.readFileSync(new URL("../../src/lib/abwesenheit/kalenderRegeln.js", import.meta.url), "utf8");
  assert.doesNotMatch(quelle, /kosten\.feiertage_tage/);
});
