// Unit-Tests für packages/nova-designer/src/lib/gefaelledaemmung.js (Phase 63, ENTW-03).
//
// Kulisse nach 63-RESEARCH.md §4: ein 20 × 14 m großes Flachdach, Mittelpunkt im Ursprung
// (x −10…+10, z −7…+7), zwei Abläufe auf der Mittelachse bei x = −5 und x = +5.
//
// Handrechnungen — jede Erwartungszahl unten ist so entstanden, keine ist aus dem Code abgelesen:
//   Dachfläche      20 · 14 = 280 m²
//   Teilflächen     die Trennlinie liegt bei x = 0 → je Ablauf 10 · 14 = 140 m²
//   d_max           weiteste Ecke (10 | 7) zum Ablauf (5 | 0): √(5² + 7²) = √74 = 8,602 m
//                   → 0,12 + 0,02 · 8,602 = 0,292 m
//   Fließweg        derselbe Wert, gemessen an der weitesten Zellmitte (9,75 | 6,75):
//                   √(4,75² + 6,75²) = 8,254 m → d = 0,12 + 0,165 = 0,285 m
//   Staffeln        2-cm-Stufen ab 0,12 m; ihre Summe ist die gerasterte Fläche = 280 m²
//   U-Werte         mehr Dämmung → kleineres U, also U(d_max) < U(d_min)

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  GEFAELLE_DEFAULT_PCT, DMIN_DEFAULT_M, RASTER_M, FLIESSWEG_MAX_M, FLAECHE_JE_ABLAUF_MAX_M2,
  DMAX_WARN_M, STAFFEL_M, DACH_AUFBAU,
  gefaelleplan, uWerteDach, gefaelleChecks, gefaelleMengen,
} from "@designer/lib/gefaelledaemmung";

/** 20 × 14 m Dach um den Ursprung. */
const DACH = [{ x: -10, z: -7 }, { x: 10, z: -7 }, { x: 10, z: 7 }, { x: -10, z: 7 }];
const ABLAEUFE = [{ id: "ab_1", x: -5, z: 0 }, { id: "ab_2", x: 5, z: 0 }];

describe("Kennwerte und Aufbau", () => {
  it("die Vorgabewerte sind die der Flachdachrichtlinie bzw. die dokumentierten Annahmen", () => {
    assert.equal(GEFAELLE_DEFAULT_PCT, 2);
    assert.equal(DMIN_DEFAULT_M, 0.12);
    assert.equal(RASTER_M, 0.5, "gleiches Raster wie der Lasteinzug in Phase 40");
    assert.equal(FLIESSWEG_MAX_M, 15);
    assert.equal(FLAECHE_JE_ABLAUF_MAX_M2, 300);
    assert.equal(DMAX_WARN_M, 0.4);
    assert.equal(STAFFEL_M, 0.02);
  });

  it("der Dachaufbau enthält genau eine Dämmschicht — sie ist die variable", () => {
    const daemmung = DACH_AUFBAU.filter((l) => l.material === "eps032");
    assert.equal(daemmung.length, 1);
    assert.equal(DACH_AUFBAU[DACH_AUFBAU.length - 1].material, "beton", "Tragschale innen");
  });
});

describe("gefaelleplan — Geometrie des Keils", () => {
  it("280 m² Dachfläche, je Ablauf 140 m² — die Trennlinie liegt in der Mitte", () => {
    const plan = gefaelleplan(DACH, ABLAEUFE);
    assert.equal(plan.flaeche_m2, 280);
    assert.equal(plan.jeAblauf.length, 2);
    assert.equal(plan.jeAblauf[0].flaeche_m2, 140);
    assert.equal(plan.jeAblauf[1].flaeche_m2, 140);
    assert.equal(plan.jeAblauf[0].id, "ab_1");
  });

  it("d_max wird an der Ecke gemessen: 0,12 + 0,02 · √74 = 0,292 m", () => {
    const plan = gefaelleplan(DACH, ABLAEUFE);
    assert.equal(plan.dmin_m, 0.12);
    assert.equal(plan.dmax_m, 0.292);
    assert.ok(plan.dMittel_m > plan.dmin_m && plan.dMittel_m < plan.dmax_m, "der Mittelwert liegt dazwischen");
  });

  it("der Fließweg je Ablauf ist der Abstand zur weitesten Zelle, nicht zur Ecke", () => {
    const plan = gefaelleplan(DACH, ABLAEUFE);
    assert.equal(plan.jeAblauf[0].fliessweg_m, 8.25);   // √(4,75² + 6,75²) = 8,2537
    assert.equal(plan.jeAblauf[0].dmax_m, 0.285);       // 0,12 + 0,02 · 8,2537
    assert.ok(plan.jeAblauf[0].dmax_m < plan.dmax_m, "die Ecke ist dicker als die letzte Zellmitte");
  });

  it("die Grate liegen zwischen den Einzugsgebieten, also bei x ≈ 0", () => {
    const plan = gefaelleplan(DACH, ABLAEUFE);
    assert.ok(plan.grate.length > 0);
    for (const g of plan.grate) {
      assert.ok(Math.abs(g.a.x) <= RASTER_M, `Grat bei x = ${g.a.x} statt bei 0`);
      assert.ok(Math.abs(g.b.x) <= RASTER_M);
    }
  });

  it("die Pfeile zeigen zum Ablauf und sind Einheitsvektoren", () => {
    const plan = gefaelleplan(DACH, ABLAEUFE);
    assert.ok(plan.pfeile.length > 0);
    assert.ok(plan.pfeile.length < plan.zellen.length / 4, "ausgedünnt, sonst ist der Plan schwarz");
    for (const p of plan.pfeile) {
      assert.ok(Math.abs(Math.hypot(p.dx, p.dz) - 1) < 0.02, "Länge 1");
      const ablauf = p.x < 0 ? ABLAEUFE[0] : ABLAEUFE[1];
      if (Math.abs(p.x - ablauf.x) > 0.5) {
        assert.equal(Math.sign(p.dx), Math.sign(ablauf.x - p.x), "der Pfeil zeigt zum Ablauf");
      }
    }
  });

  it("die Staffeln summieren zur Dachfläche und stufen in 2 cm", () => {
    const plan = gefaelleplan(DACH, ABLAEUFE);
    const summe = plan.staffeln.reduce((s, st) => s + st.m2, 0);
    assert.equal(Math.round(summe), 280);
    assert.equal(plan.staffeln[0].von, 0.12, "die erste Staffel beginnt am Ablauf");
    for (const st of plan.staffeln) assert.equal(Math.round((st.bis - st.von) * 1000), 20);
  });

  it("das Volumen entspricht mittlerer Dicke × Fläche", () => {
    const plan = gefaelleplan(DACH, ABLAEUFE);
    const erwartet = plan.dMittel_m * 280;
    assert.ok(Math.abs(plan.volumen_m3 - erwartet) < 0.5, `${plan.volumen_m3} m³ gegen ${erwartet.toFixed(2)} m³`);
  });

  it("ein steileres Gefälle macht den Keil dicker, ein größeres dmin verschiebt alles nach oben", () => {
    const flach = gefaelleplan(DACH, ABLAEUFE, { gefaelle_pct: 2 });
    const steil = gefaelleplan(DACH, ABLAEUFE, { gefaelle_pct: 3 });
    assert.ok(steil.dmax_m > flach.dmax_m);
    assert.ok(steil.volumen_m3 > flach.volumen_m3);

    const dicker = gefaelleplan(DACH, ABLAEUFE, { dmin_m: 0.2 });
    assert.equal(dicker.dmin_m, 0.2);
    assert.equal(rndDiff(dicker.dmax_m, flach.dmax_m), 0.08, "dmin +8 cm → dmax +8 cm");
  });

  it("ein dritter Ablauf in der Mitte verkleinert die Flächen — die Ecke bleibt aber gleich dick", () => {
    const zwei = gefaelleplan(DACH, ABLAEUFE);
    const mitte = gefaelleplan(DACH, [...ABLAEUFE, { id: "ab_3", x: 0, z: 0 }]);
    assert.equal(mitte.jeAblauf.length, 3);
    assert.ok(
      Math.max(...mitte.jeAblauf.map((a) => a.flaeche_m2)) < Math.max(...zwei.jeAblauf.map((a) => a.flaeche_m2)),
      "die größte Teilfläche schrumpft",
    );
    assert.equal(mitte.dmax_m, zwei.dmax_m, "die Ecke (10|7) gehört weiterhin zum Ablauf (5|0) — Abläufe in der Mitte helfen ihr nicht");

    // d_max ist die SCHLECHTESTE Ecke. Ein einzelner Eckablauf senkt sie nicht — es gibt vier.
    const eineEcke = gefaelleplan(DACH, [...ABLAEUFE, { id: "ab_4", x: 9, z: 6 }]);
    assert.equal(eineEcke.dmax_m, zwei.dmax_m, "die drei übrigen Ecken bleiben, wie sie waren");

    const alleEcken = gefaelleplan(DACH, [
      { id: "ab_1", x: -9, z: -6 }, { id: "ab_2", x: 9, z: -6 },
      { id: "ab_3", x: 9, z: 6 }, { id: "ab_4", x: -9, z: 6 },
    ]);
    assert.ok(alleEcken.dmax_m < zwei.dmax_m, "erst Abläufe an allen vier Ecken senken den Hochpunkt");
    assert.equal(alleEcken.dmax_m, 0.148, "Ecke (10|7) zum Ablauf (9|6): √2 = 1,414 m → 0,12 + 0,0283");
  });

  it("ohne Abläufe oder ohne Umriss entsteht kein Plan, sondern ein leerer", () => {
    const ohneAblauf = gefaelleplan(DACH, []);
    assert.deepEqual(ohneAblauf.zellen, []);
    assert.deepEqual(ohneAblauf.staffeln, []);
    assert.equal(ohneAblauf.flaeche_m2, 280, "die Fläche ist trotzdem bekannt");
    assert.equal(ohneAblauf.volumen_m3, 0);

    const ohneDach = gefaelleplan([{ x: 0, z: 0 }, { x: 1, z: 0 }], ABLAEUFE);
    assert.deepEqual(ohneDach.zellen, []);
    assert.equal(ohneDach.flaeche_m2, 0);
  });
});

describe("uWerteDach", () => {
  it("mehr Dämmung heißt kleineres U — uMin gehört zum dicken Punkt", () => {
    const u = uWerteDach({ dmin_m: 0.12, dmax_m: 0.292 });
    assert.ok(u.uMin < u.uMax, `${u.uMin} muss unter ${u.uMax} liegen`);
    assert.ok(u.uMax > 0.15 && u.uMax < 0.35, `U bei 12 cm EPS 032 erwartet ~0,24 W/(m²K), war ${u.uMax}`);
    assert.ok(u.uMin > 0.05 && u.uMin < 0.15, `U bei 29 cm erwartet ~0,10 W/(m²K), war ${u.uMin}`);
    assert.match(u.aufbau, /eps032/);
  });

  it("gleiche Dicke oben wie unten → beide U-Werte gleich", () => {
    const u = uWerteDach({ dmin_m: 0.2, dmax_m: 0.2 });
    assert.equal(u.uMin, u.uMax);
  });
});

describe("gefaelleChecks", () => {
  it("das Standard-Dach besteht alle vier Prüfungen", () => {
    const plan = gefaelleplan(DACH, ABLAEUFE);
    const items = gefaelleChecks(plan, { nNot: 2 });
    assert.deepEqual(items.map((i) => i.key), ["fliessweg", "flaeche", "aufbauhoehe", "notueberlaeufe"]);
    assert.ok(items.every((i) => i.status === "pass"), items.map((i) => `${i.key}:${i.status}`).join(" "));
  });

  it("zu wenige Notüberläufe sind eine Warnung, keine stillschweigende Zustimmung", () => {
    const plan = gefaelleplan(DACH, ABLAEUFE);
    const items = gefaelleChecks(plan, { nNot: 1 });
    assert.equal(items.find((i) => i.key === "notueberlaeufe").status, "warn");
  });

  it("ein einzelner Ablauf auf großem Dach: Fließweg und Teilfläche schlagen an", () => {
    const gross = [{ x: 0, z: 0 }, { x: 40, z: 0 }, { x: 40, z: 20 }, { x: 0, z: 20 }];
    const plan = gefaelleplan(gross, [{ id: "ab_1", x: 2, z: 2 }]);
    const items = gefaelleChecks(plan, { nNot: 1 });
    assert.equal(items.find((i) => i.key === "fliessweg").status, "warn");
    assert.equal(items.find((i) => i.key === "flaeche").status, "warn");
    assert.equal(items.find((i) => i.key === "aufbauhoehe").status, "warn", "42 m Weg · 2 % ergibt über 0,40 m Aufbau");
  });

  it("ohne Abläufe und bei anderer Dachform bleibt es offen — nie pass", () => {
    assert.equal(gefaelleChecks(gefaelleplan(DACH, []), {})[0].status, "offen");
    assert.equal(gefaelleChecks(null, {})[0].status, "offen");
    const steil = gefaelleChecks(gefaelleplan(DACH, ABLAEUFE), { dachform: "sattel" });
    assert.equal(steil.length, 1);
    assert.equal(steil[0].key, "dachform");
    assert.equal(steil[0].status, "offen");
  });

  it("kein Check liefert je fail — das ist eine Haftungsentscheidung", () => {
    const plan = gefaelleplan(DACH, ABLAEUFE);
    for (const nNot of [0, 2]) {
      for (const i of gefaelleChecks(plan, { nNot })) {
        assert.ok(["pass", "warn", "offen"].includes(i.status), `${i.key} lieferte ${i.status}`);
      }
    }
  });
});

describe("gefaelleMengen", () => {
  it("je Staffel eine Zeile in m², dazu Volumen und Stückzahl", () => {
    const plan = gefaelleplan(DACH, ABLAEUFE);
    const mengen = gefaelleMengen(plan);
    const staffelZeilen = mengen.filter((m) => m.key.startsWith("staffel_"));
    assert.equal(staffelZeilen.length, plan.staffeln.length);
    assert.ok(staffelZeilen.every((m) => m.einheit === "m²"));
    assert.match(staffelZeilen[0].label, /^Gefälledämmung 120–140 mm$/);
    assert.equal(Math.round(staffelZeilen.reduce((s, m) => s + m.menge, 0)), 280);

    const volumen = mengen.find((m) => m.key === "daemmung_volumen");
    assert.equal(volumen.menge, plan.volumen_m3);
    assert.equal(volumen.einheit, "m³");
    assert.equal(mengen.find((m) => m.key === "ablaeufe").menge, 2);
  });

  it("ohne Plan gibt es keine Phantom-Positionen", () => {
    assert.deepEqual(gefaelleMengen(null), []);
    assert.deepEqual(gefaelleMengen(gefaelleplan(DACH, [])), []);
  });
});

/** Differenz zweier Meter-Werte auf cm gerundet — gegen Fließkomma-Rauschen im Test. */
function rndDiff(a, b) {
  return Math.round((a - b) * 100) / 100;
}
