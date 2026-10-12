// Phase 81 (81-01): data contract of a time booking — duration parser, derived
// month/week, status workflow, edit window and bookable work stages.
//
// In:  src/lib/zeit/zeitbuchung.js. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ableiten, bearbeitbar, buchbareLph, buchbareLphFuerProjekt, ERLAUBTE_UEBERGAENGE, kwSchluessel, parseDauer, statusWechsel,
} from "@/lib/zeit/zeitbuchung.js";
import { lphFuerLeistungsbild } from "@core/lib/hoai/honorar.js";
import { HOAI_TAFEL_GEBAEUDE } from "@core/lib/hoai/leistungsbilder.js";

test("parseDauer: Stunden mit Komma, h:mm, Minuten, h + min; Fehlerarten", () => {
  assert.deepEqual(parseDauer("1,5", 15), { ok: true, minuten: 90 });
  assert.deepEqual(parseDauer("1.5", 15), { ok: true, minuten: 90 });
  assert.deepEqual(parseDauer("1:45", 15), { ok: true, minuten: 105 });
  assert.deepEqual(parseDauer("150m", 15), { ok: true, minuten: 150 });
  assert.deepEqual(parseDauer("150 min", 15), { ok: true, minuten: 150 });
  assert.deepEqual(parseDauer("2h30", 15), { ok: true, minuten: 150 });
  assert.deepEqual(parseDauer("2 h 30", 15), { ok: true, minuten: 150 });
  assert.deepEqual(parseDauer("2h", 15), { ok: true, minuten: 120 });
  assert.deepEqual(parseDauer("8", 15), { ok: true, minuten: 480 });
  assert.deepEqual(parseDauer("0", 15), { ok: true, minuten: 0 });
  // 0,1 h = 6 min — not on the 15-minute grid.
  assert.deepEqual(parseDauer("0,1", 15), { ok: false, fehler: "raster" });
  assert.deepEqual(parseDauer("1,1", 6), { ok: true, minuten: 66 }, "float noise of 1,1 h is not a fraction");
  assert.deepEqual(parseDauer("", 15), { ok: false, fehler: "leer" });
  assert.deepEqual(parseDauer("   ", 15), { ok: false, fehler: "leer" });
  assert.deepEqual(parseDauer("abc", 15), { ok: false, fehler: "format" });
  assert.deepEqual(parseDauer("1:75", 15), { ok: false, fehler: "format" });
});

test("ableiten: Monat und ISO-Woche aus dem Datum", () => {
  const b = ableiten({ datum: "2026-09-28", minuten: 90 });
  assert.equal(b.monat, "2026-09");
  assert.equal(b.kw, "2026-W40");
  assert.equal(b.minuten, 90);
  assert.equal(ableiten({ datum: "2027-01-01" }).kw, "2026-W53");
  assert.equal(ableiten({ datum: "2026-01-05" }).kw, "2026-W02");
  assert.equal(ableiten({ datum: "x" }).monat, null);
  assert.equal(kwSchluessel(2026, 4), "2026-W04");
});

test("statusWechsel: erlaubte Wege, Grund beim Ablehnen, Wiederöffnen nur durch die freigebende Person", () => {
  const jetzt = "2026-09-28T09:00:00.000Z";
  const e = { id: "z1", status: "entwurf", minuten: 60 };
  const ein = statusWechsel(e, "eingereicht", { jetztIso: jetzt });
  assert.equal(ein.ok, true);
  assert.equal(ein.ok && ein.buchung.eingereicht_am, jetzt);
  assert.deepEqual(statusWechsel(e, "freigegeben", { nutzerId: "inhaber" }), { ok: false, fehler: "uebergang" });
  const eingereicht = ein.ok ? ein.buchung : e;
  assert.deepEqual(statusWechsel(eingereicht, "abgelehnt", { grund: "  " }), { ok: false, fehler: "grund_fehlt" });
  const abgelehnt = statusWechsel(eingereicht, "abgelehnt", { grund: "falsche LPH" });
  assert.equal(abgelehnt.ok && abgelehnt.buchung.ablehnung_grund, "falsche LPH");
  const frei = statusWechsel(eingereicht, "freigegeben", { nutzerId: "P-001", jetztIso: jetzt });
  assert.equal(frei.ok && frei.buchung.freigegeben_von, "P-001");
  const freigegeben = frei.ok ? frei.buchung : e;
  assert.deepEqual(statusWechsel(freigegeben, "entwurf", { nutzerId: "P-003" }), { ok: false, fehler: "nicht_freigeber" });
  const offen = statusWechsel(freigegeben, "entwurf", { nutzerId: "P-001" });
  assert.equal(offen.ok && offen.buchung.status, "entwurf");
  assert.equal(offen.ok && offen.buchung.freigegeben_von, null);
  assert.deepEqual(Object.keys(ERLAUBTE_UEBERGAENGE).sort(), ["abgelehnt", "eingereicht", "entwurf", "freigegeben"]);
});

test("bearbeitbar: nur Entwürfe innerhalb der Frist", () => {
  const optionen = { bearbeitbarTage: 14 };
  assert.equal(bearbeitbar({ status: "entwurf", datum: "2026-10-01" }, "2026-10-15", optionen), true);
  assert.equal(bearbeitbar({ status: "entwurf", datum: "2026-09-30" }, "2026-10-15", optionen), false);
  assert.equal(bearbeitbar({ status: "eingereicht", datum: "2026-10-14" }, "2026-10-15", optionen), false);
  assert.equal(bearbeitbar({ datum: "2026-10-14" }, "2026-10-15", optionen), true, "ohne Status = Entwurf");
});

test("buchbareLph: beauftragte LPH nach Leistungsbild; ohne Vertrag 1–9", () => {
  const lph = lphFuerLeistungsbild("gebaeude").map((l, i) => ({ ...l, beauftragt: i < 4 }));
  assert.deepEqual(buchbareLph({ leistungsbild: "gebaeude", lph }), [1, 2, 3, 4]);
  assert.deepEqual(buchbareLph(null), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  // Tragwerksplanung has six stages — never a seventh, even if the stored array is longer.
  const tw = [...lphFuerLeistungsbild("tragwerksplanung"), { beauftragt: true, prozent: 0 }, { beauftragt: true, prozent: 0 }];
  assert.deepEqual(buchbareLph({ leistungsbild: "tragwerksplanung", lph: tw }), [1, 2, 3, 4, 5, 6]);
  // Synthetic registry entry with three stages (like 79-02's test injection).
  const dreiStufen = { ...HOAI_TAFEL_GEBAEUDE, leistungsbild: "bebauungsplan", lph: HOAI_TAFEL_GEBAEUDE.lph.slice(0, 3) };
  const neun = Array.from({ length: 9 }, () => ({ beauftragt: true, prozent: 10 }));
  assert.deepEqual(buchbareLph({ leistungsbild: "bebauungsplan", lph: neun }, { weitere: [dreiStufen] }), [1, 2, 3]);
});

test("buchbareLphFuerProjekt: Vereinigung über die Verträge eines Projekts", () => {
  const a = { project_id: "p1", leistungsbild: "gebaeude", lph: lphFuerLeistungsbild("gebaeude").map((l, i) => ({ ...l, beauftragt: i < 2 })) };
  const b = { project_id: "p1", leistungsbild: "innenraeume", lph: lphFuerLeistungsbild("innenraeume").map((l, i) => ({ ...l, beauftragt: i === 4 })) };
  assert.deepEqual(buchbareLphFuerProjekt([a, b], "p1"), [1, 2, 5]);
  assert.deepEqual(buchbareLphFuerProjekt([a, b], "p2"), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
});
