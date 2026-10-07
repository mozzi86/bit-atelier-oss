// Unit tests of the rule core (80-01, behavior 4–8): dated standard series,
// formulas, effective value with office override, checks of an override against
// its rule, overrides from the Setting rows in both storage kinds. The worked
// numbers are written next to each assertion.
//
// In:  packages/nova-core/src/lib/regelwerk.js, the HR rule book and the rule registry.
// Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  REGEL_PRAEFIX, REGEL_PRUEFTEXTE, berechneFormel, heuteLokal, istEditierbar, overridesAus, pruefeOverride,
  regelSchluessel, regelWerteAus, wertAm, wirksamerWert,
} from "@core/lib/regelwerk.js";
import { heuteLokal as heuteKalender } from "@core/lib/kalender/datum.js";
import { HR_REGELN } from "@/lib/people/hrRegeln.js";
import { REGELWERKE } from "@/lib/settings/regelwerke.js";

const hr = (name) => {
  const r = HR_REGELN.find((x) => x.id === `personal.${name}`);
  assert.ok(r, `HR-Regel ${name} fehlt`);
  return r;
};
const MINDESTLOHN = hr("mindestlohn");
const MINIJOB = hr("minijob_grenze");
const URLAUB_BUERO = hr("urlaub_buero_standard");
const BUCHHALTUNG = REGELWERKE.find((g) => g.gruppe === "buchhaltung");
const PERSONAL = REGELWERKE.find((g) => g.gruppe === "personal");

/** Standard value reader over the HR rules (no overrides). */
const wertVon = (id, stichtag) => wirksamerWert(HR_REGELN.find((r) => r.id === id), null, stichtag).wert;

test("Schlüssel der Setting-Zeile und Re-Export des Kalenders", () => {
  assert.equal(REGEL_PRAEFIX, "regel:");
  assert.equal(regelSchluessel("personal.mindestlohn"), "regel:personal.mindestlohn");
  assert.equal(heuteLokal, heuteKalender, "kein zweites Datum: heuteLokal kommt aus @core/lib/kalender/datum.js");
});

test("Behavior 4: wertAm liefert den jüngsten Eintrag mit ab ≤ Stichtag", () => {
  assert.equal(wertAm(MINDESTLOHN, "2024-12-31"), null, "vor dem ersten Eintrag (2025-01-01)");
  assert.equal(wertAm(MINDESTLOHN, "2025-12-31"), 12.82);
  assert.equal(wertAm(MINDESTLOHN, "2026-01-01"), 13.9);
  assert.equal(wertAm(MINDESTLOHN, "2027-01-01"), 14.6);
  // Unsorted series: the latest ab wins, not the last row.
  const unsortiert = { werte: [{ ab: "2026-01-01", wert: 2 }, { ab: "2024-01-01", wert: 1 }] };
  assert.equal(wertAm(/** @type {any} */ (unsortiert), "2026-06-01"), 2);
});

test("Behavior 5: Minijob-Grenze = ⌈Mindestlohn × 130 / 3⌉", () => {
  // 12,82 × 130 / 3 = 555,53 → 556; 13,90 × 130 / 3 = 602,33 → 603; 14,60 × 130 / 3 = 632,67 → 633
  assert.equal(berechneFormel(MINIJOB, "2025-06-01", wertVon), 556);
  assert.equal(berechneFormel(MINIJOB, "2026-06-01", wertVon), 603);
  assert.equal(berechneFormel(MINIJOB, "2027-06-01", wertVon), 633);
  assert.equal(berechneFormel(MINIJOB, "2024-06-01", wertVon), null, "ohne Mindestlohn keine Grenze");
  assert.equal(berechneFormel(MINIJOB, "2026-06-01", undefined), null, "ohne Leser keine Rechnung");
  assert.equal(berechneFormel(MINDESTLOHN, "2026-06-01", wertVon), null, "keine Formel");
  // An exact integer product is not rounded up one euro too many (13,50 × 130 / 3 = 585).
  assert.equal(berechneFormel(MINIJOB, "2026-06-01", () => 13.5), 585);
  // wirksamerWert computes formulas as well and ignores an override.
  const w = wirksamerWert(MINIJOB, { wert: 700 }, "2026-06-01", wertVon);
  assert.equal(w.wert, 603);
  assert.equal(w.herkunft, "standard");
});

test("Behavior 6: Bürowert mit gültig ab gewinnt ab seinem Datum", () => {
  const ov = { wert: 30, gueltig_ab: "2027-01-01", basis_stand: "2026-09-27" };
  const vorher = wirksamerWert(URLAUB_BUERO, ov, "2026-12-31");
  assert.equal(vorher.wert, 28);
  assert.equal(vorher.herkunft, "standard");
  const ab = wirksamerWert(URLAUB_BUERO, ov, "2027-01-01");
  assert.equal(ab.wert, 30);
  assert.equal(ab.herkunft, "eigen");
  assert.equal(ab.abweichend, true);
  assert.equal(ab.veraltet, false);
  assert.equal(ab.ab, "2027-01-01");
  // Standard stand 2026-09-27 > basis_stand 2025-06-01 → the office should look again.
  assert.equal(wirksamerWert(URLAUB_BUERO, { ...ov, basis_stand: "2025-06-01" }, "2027-01-01").veraltet, true);
  // Legal value: override ignored → 13,90 on 2026-06-01.
  const ml = wirksamerWert(MINDESTLOHN, { wert: 20, gueltig_ab: "2026-01-01" }, "2026-06-01");
  assert.equal(ml.wert, 13.9);
  assert.equal(ml.herkunft, "standard");
  assert.equal(ml.quelle, "§ 1 MiLoG, Fünfte Mindestlohnanpassungsverordnung");
});

test("Behavior 6: Gleichstand → Override; gleicher Wert → nicht abweichend; undatierter Override gilt immer", () => {
  const regel = /** @type {any} */ ({ id: "x.y", art: "buero", typ: "zahl", stand: "2026-09-27", werte: [{ ab: "2026-01-01", wert: 10 }] });
  assert.equal(wirksamerWert(regel, { wert: 12, gueltig_ab: "2026-01-01" }, "2026-01-01").herkunft, "eigen");
  assert.equal(wirksamerWert(regel, { wert: 10, gueltig_ab: "2026-02-01" }, "2026-03-01").abweichend, false);
  // A standard row younger than the override wins again.
  const neu = { ...regel, werte: [...regel.werte, { ab: "2026-06-01", wert: 11 }] };
  assert.equal(wirksamerWert(neu, { wert: 12, gueltig_ab: "2026-02-01" }, "2026-07-01").wert, 11);
  // Storage kind `setting` (79) has no gueltig_ab: the stored value always applies,
  // also against the 79 standard row (ab = 2026-09-27) and before it.
  const ziel = BUCHHALTUNG.regeln.find((r) => r.id === "buchhaltung.zahlungsziel_tage");
  assert.equal(wirksamerWert(ziel, { wert: 21 }, "2026-12-01").wert, 21);
  assert.equal(wirksamerWert(ziel, { wert: 21 }, "2026-01-01").wert, 21);
  assert.equal(wirksamerWert(ziel, null, "2026-12-01").wert, 14, "79-Standard (E-12)");
  // editierbar:false ignores an override as well.
  const fest = BUCHHALTUNG.regeln.find((r) => r.id === "buchhaltung.beleg_max_bytes");
  assert.equal(wirksamerWert(fest, { wert: 1 }, "2026-12-01").herkunft, "standard");
});

test("Behavior 7: pruefeOverride — gesetzlich, Grenzen, Formel, Warnung", () => {
  const m = pruefeOverride(hr("urlaub_mindest_werktage"), 18);
  assert.equal(m?.schwere, "fail");
  assert.match(m.text, /nur lesend/);
  assert.ok(m.text.includes("§ 3 BUrlG"), m.text);

  const p = pruefeOverride(hr("probezeit_max_monate"), 7);
  assert.equal(p?.schwere, "fail");
  assert.ok(p.text.includes("§ 622 Abs. 3"), p.text);

  assert.equal(pruefeOverride(URLAUB_BUERO, 30), null);
  const u = pruefeOverride(URLAUB_BUERO, 18);
  assert.equal(u?.schwere, "fail");
  assert.ok(u.text.includes("§ 3 BUrlG"), u.text);
  assert.match(u.text, /^Mindestens 20 Arbeitstage/);

  const f = pruefeOverride(MINIJOB, 700);
  assert.equal(f?.schwere, "fail");
  assert.match(f.text, /nicht überschreibbar/);

  const w = pruefeOverride(hr("wochenstunden_standard"), 50);
  assert.equal(w?.schwere, "warn");
  assert.ok(w.text.includes("§ 3 ArbZG"), w.text);
});

test("Behavior 7: Typprüfung für Zahl, Monatstag und Auswahl; Vorlage für die Übersetzung", () => {
  assert.equal(pruefeOverride(URLAUB_BUERO, "30")?.schwere, "fail", "Text statt Zahl");
  assert.equal(pruefeOverride(URLAUB_BUERO, Number.NaN)?.schwere, "fail");
  const hinweis = hr("resturlaub_hinweis_bis");
  assert.equal(pruefeOverride(hinweis, "10-15"), null);
  assert.equal(pruefeOverride(hinweis, "02-29"), null, "29.02. gibt es (Schaltjahr)");
  assert.equal(pruefeOverride(hinweis, "02-30")?.schwere, "fail");
  assert.equal(pruefeOverride(hinweis, "2026-10-15")?.schwere, "fail");
  const rechtsform = BUCHHALTUNG.regeln.find((r) => r.id === "buchhaltung.rechtsform");
  assert.equal(pruefeOverride(rechtsform, "gmbh"), null);
  assert.equal(pruefeOverride(rechtsform, "ag")?.schwere, "fail");
  const dauerfrist = BUCHHALTUNG.regeln.find((r) => r.id === "buchhaltung.dauerfrist");
  assert.equal(pruefeOverride(dauerfrist, true), null);
  assert.equal(pruefeOverride(dauerfrist, "ja")?.schwere, "fail");
  assert.equal(pruefeOverride(null, 1)?.schwere, "fail");
  // Every result names its template, and every template is a known text.
  const r = pruefeOverride(URLAUB_BUERO, 18);
  assert.equal(r.schluessel, REGEL_PRUEFTEXTE.min);
  assert.equal(r.werte.grenze, "20");
  assert.equal(r.text, r.schluessel.replace(/\{(\w+)\}/g, (_, k) => r.werte[k]));
});

test("Ein Override auf Regel X ändert keine andere Regel", () => {
  const zeilen = [{ id: "s1", key: "regel:personal.urlaub_buero_standard", value: { wert: 30, gueltig_ab: "2026-01-01" } }];
  const leser = regelWerteAus([PERSONAL], zeilen);
  assert.equal(leser.wert("personal.urlaub_buero_standard", "2026-06-01"), 30);
  for (const r of HR_REGELN) {
    if (r.id === "personal.urlaub_buero_standard") continue;
    const ohne = wirksamerWert(r, null, "2026-06-01", wertVon).wert;
    assert.deepEqual(leser.wert(r.id, "2026-06-01"), ohne, r.id);
  }
  assert.equal(leser.wert("personal.minijob_grenze", "2026-06-01"), 603, "Formel liest über denselben Leser");
  assert.equal(leser.wert("gibt.es.nicht", "2026-06-01"), null);
  assert.equal(leser.details("gibt.es.nicht"), null);
});

test("regelWerteAus meldet eine Formel, die auf sich selbst verweist, im Klartext", () => {
  const kreis = /** @type {any} */ ({
    gruppe: "t", titel: "t", sichtbar: () => true, speicher: { art: "zeilen" },
    regeln: [{ id: "t.a", typ: "formel", art: "gesetz", werte: [], stand: "2026-09-27", quelle: "q", formel: (_s, w) => w("t.a") }],
  });
  assert.throws(() => regelWerteAus([kreis], []).wert("t.a", "2026-01-01"), /verweist in ihrer Formel auf sich selbst/);
});

test("Behavior 8: overridesAus — Speicherart setting (79) nimmt die erste Zeile, nur editierbare Regeln", () => {
  const aus = overridesAus(BUCHHALTUNG, [{ id: "b1", key: "buchhaltung", value: { zahlungsziel_tage: 21, unbekannt: 5 } }]);
  assert.deepEqual(aus.get("buchhaltung.zahlungsziel_tage"), { wert: 21 });
  assert.equal(aus.size, 1, "kein Eintrag für „unbekannt“");
  // Duplicate: the first row counts, as in 79 einstellungLesen (filter({key})[0]).
  const dublette = overridesAus(BUCHHALTUNG, [
    { id: "b1", key: "buchhaltung", value: { zahlungsziel_tage: 21 }, updated_date: "2026-01-01" },
    { id: "b2", key: "buchhaltung", value: { zahlungsziel_tage: 30 }, updated_date: "2026-09-01" },
  ]);
  assert.deepEqual(dublette.get("buchhaltung.zahlungsziel_tage"), { wert: 21 });
  // Read-only fields are not overrides even when stored (beleg_max_bytes, mahnstufen).
  const fest = overridesAus(BUCHHALTUNG, [{ id: "b1", key: "buchhaltung", value: { beleg_max_bytes: 1, mahnstufen: [] } }]);
  assert.equal(fest.size, 0);
  assert.equal(overridesAus(BUCHHALTUNG, []).size, 0);
});

test("Behavior 8: overridesAus — Speicherart zeilen, je Schlüssel die neueste Zeile", () => {
  const aus = overridesAus(PERSONAL, [
    { id: "p1", key: "regel:personal.urlaub_buero_standard", value: { wert: 30, gueltig_ab: "2027-01-01" } },
    { id: "b1", key: "buchhaltung", value: { zahlungsziel_tage: 21 } },
    { id: "z1", key: "regel:zeit_honorar.gemeinkosten", value: { wert: 90 } },
  ]);
  assert.equal(aus.size, 1);
  assert.deepEqual(aus.get("personal.urlaub_buero_standard"), { wert: 30, gueltig_ab: "2027-01-01" });
  const zwei = overridesAus(PERSONAL, [
    { id: "p1", key: "regel:personal.urlaub_buero_standard", value: { wert: 29 }, updated_date: "2026-01-01" },
    { id: "p2", key: "regel:personal.urlaub_buero_standard", value: { wert: 31 }, updated_date: "2026-02-01" },
  ]);
  assert.equal(zwei.get("personal.urlaub_buero_standard").wert, 31);
});

test("istEditierbar: nur Bürowerte ohne Formel und ohne editierbar:false", () => {
  assert.equal(istEditierbar(URLAUB_BUERO), true);
  assert.equal(istEditierbar(MINDESTLOHN), false);
  assert.equal(istEditierbar(MINIJOB), false);
  assert.equal(istEditierbar(hr("aufbewahrung_bewerbung_monate")), false, "Praxiswert, nur lesend");
  assert.equal(istEditierbar(null), false);
});
