// Unit-Tests für packages/nova-designer/src/lib/apartments.js (Wohnungsplaner, Phase 21).
//
// Quelle der Erwartungswerte: die Lib-Dokumentation selbst (self-contained, keine
// Date/Random, node-smoke-fähig) und .planning/phases/21-wohnungsplaner-reiter-.../
// 21-01-PLAN.md. Koordinatensystem = zentriertes Meter-System des Footprints.
//
// Schwerpunkte: ME-03 (istGeneriert erkennt NUR das strikte Suffix " ·W" — sonst
// Datenverlust beim Regenerieren) und die Determinismus-Zusage.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_TYPEN,
  GEN_MARKER,
  istGeneriert,
  layoutApartments,
  wohnflaecheSumme,
  wohnungenAnzahl,
  apartmentChecks,
} from "@designer/lib/apartments";

// 20 × 14 m Footprint, zentriert (= Store-Default).
const FOOTPRINT = [{ x: -10, z: -7 }, { x: 10, z: -7 }, { x: 10, z: 7 }, { x: -10, z: 7 }];
const RUN = { typ: { name: "3-Zimmer", flaeche_m2: 75 }, countPerFloor: 2, floorFrom: 0, floorTo: 2 };

describe("apartments.js — Typenkatalog & Marker", () => {
  it("3 Standardtypen: 2-Zimmer 60 m², 3-Zimmer 75 m², 4-Zimmer 95 m²", () => {
    assert.equal(DEFAULT_TYPEN.length, 3);
    assert.deepEqual(DEFAULT_TYPEN.map((t) => t.flaeche_m2), [60, 75, 95]);
    assert.deepEqual(DEFAULT_TYPEN.map((t) => t.zimmer), [2, 3, 4]);
  });

  it("GEN_MARKER ist \" ·W\" — inklusive führendem Leerzeichen", () => {
    assert.equal(GEN_MARKER, " ·W");
    assert.ok(GEN_MARKER.startsWith(" "), "führendes Leerzeichen fehlt");
  });
});

describe("apartments.js — ME-03: istGeneriert() nur bei striktem Suffix", () => {
  it("erkennt generierte Zonen am Suffix", () => {
    assert.equal(istGeneriert({ name: "3-Zimmer 0-1 ·W" }), true);
    assert.equal(istGeneriert({ name: `Wohnung${GEN_MARKER}` }), true);
  });

  it("DATENVERLUST-SCHUTZ: Nutzer-Zonen mit „·W“ in der Mitte werden NICHT erkannt", () => {
    assert.equal(istGeneriert({ name: "Trakt·West" }), false);
    assert.equal(istGeneriert({ name: "·W Trakt" }), false);
    assert.equal(istGeneriert({ name: "Halle ·West" }), false);
    assert.equal(istGeneriert({ name: "3-Zimmer ·W extra" }), false);
  });

  it("Härtung: fehlender/nicht-String-Name ⇒ false", () => {
    assert.equal(istGeneriert({}), false);
    assert.equal(istGeneriert(undefined), false);
    assert.equal(istGeneriert(null), false);
    assert.equal(istGeneriert({ name: 42 }), false);
    assert.equal(istGeneriert({ name: null }), false);
  });

  it("layoutApartments erzeugt ausschließlich Zonen, die istGeneriert erkennt", () => {
    const zones = layoutApartments(FOOTPRINT, [RUN]);
    assert.ok(zones.length > 0);
    for (const z of zones) {
      assert.equal(istGeneriert(z), true, `nicht erkannt: ${z.name}`);
    }
  });
});

describe("apartments.js — layoutApartments()", () => {
  it("erzeugt count · Geschosse Zonen (2 je Geschoss über 3 Geschosse ⇒ 6)", () => {
    const zones = layoutApartments(FOOTPRINT, [RUN]);
    assert.equal(zones.length, 6);
    assert.deepEqual([...new Set(zones.map((z) => z.level))].sort(), [0, 1, 2]);
  });

  it("jede Zone ist ein Rechteck mit 4 Punkten und positiver Fläche", () => {
    for (const z of layoutApartments(FOOTPRINT, [RUN])) {
      assert.equal(z.points.length, 4);
      const xs = z.points.map((p) => p.x);
      const zs = z.points.map((p) => p.z);
      assert.ok(Math.max(...xs) > Math.min(...xs), "Breite 0");
      assert.ok(Math.max(...zs) > Math.min(...zs), "Tiefe 0");
      for (const p of z.points) {
        assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z), `NaN-Koordinate in ${z.name}`);
      }
    }
  });

  it("Wohnungstiefe = min(BBox-Tiefe, 12 m); Breite = Fläche / Tiefe", () => {
    const zones = layoutApartments(FOOTPRINT, [RUN]);
    const z = zones[0];
    const tiefe = Math.max(...z.points.map((p) => p.z)) - Math.min(...z.points.map((p) => p.z));
    const breite = Math.max(...z.points.map((p) => p.x)) - Math.min(...z.points.map((p) => p.x));
    assert.equal(tiefe, 12); // BBox-Tiefe 14 > 12 ⇒ auf 12 begrenzt
    assert.ok(Math.abs(breite - 75 / 12) < 1e-9, `Breite ${breite}`);
  });

  it("flacher Footprint (Tiefe 8 m) begrenzt die Wohnungstiefe auf 8 m", () => {
    const flach = [{ x: -10, z: -4 }, { x: 10, z: -4 }, { x: 10, z: 4 }, { x: -10, z: 4 }];
    const z = layoutApartments(flach, [RUN])[0];
    const tiefe = Math.max(...z.points.map((p) => p.z)) - Math.min(...z.points.map((p) => p.z));
    assert.equal(tiefe, 8);
  });

  it("Zonennamen sind geschossweise fortlaufend numeriert", () => {
    const zones = layoutApartments(FOOTPRINT, [RUN]);
    const eg = zones.filter((z) => z.level === 0).map((z) => z.name);
    assert.deepEqual(eg, ["3-Zimmer 0-1 ·W", "3-Zimmer 0-2 ·W"]);
  });

  it("mehrere Runs teilen die geschossweise Nummerierung", () => {
    const runs = [
      { typ: { name: "2-Zimmer", flaeche_m2: 60 }, countPerFloor: 1, floorFrom: 0, floorTo: 0 },
      { typ: { name: "3-Zimmer", flaeche_m2: 75 }, countPerFloor: 1, floorFrom: 0, floorTo: 0 },
    ];
    const zones = layoutApartments(FOOTPRINT, runs);
    assert.deepEqual(zones.map((z) => z.name), ["2-Zimmer 0-1 ·W", "3-Zimmer 0-2 ·W"]);
  });

  it("Zeilenumbruch: bei Überbelegung wird eine neue Reihe begonnen (z wächst)", () => {
    const viele = { typ: { name: "3-Zimmer", flaeche_m2: 75 }, countPerFloor: 8, floorFrom: 0, floorTo: 0 };
    const zones = layoutApartments(FOOTPRINT, [viele]);
    assert.equal(zones.length, 8);
    const zWerte = [...new Set(zones.map((z) => Math.min(...z.points.map((p) => p.z))))];
    assert.ok(zWerte.length > 1, "kein Zeilenumbruch erfolgt");
  });

  it("floorFrom > floorTo wird toleriert (Reihenfolge wird normalisiert)", () => {
    const rueckwaerts = { ...RUN, floorFrom: 2, floorTo: 0 };
    const zones = layoutApartments(FOOTPRINT, [rueckwaerts]);
    assert.equal(zones.length, 6);
    assert.deepEqual([...new Set(zones.map((z) => z.level))].sort(), [0, 1, 2]);
  });

  it("DETERMINISMUS: zwei Aufrufe mit identischer Eingabe liefern identische Zonen", () => {
    const a = layoutApartments(FOOTPRINT, [RUN]);
    const b = layoutApartments(FOOTPRINT, [RUN]);
    assert.deepEqual(a, b);
  });

  it("Härtung: kein Footprint ⇒ Default 20 × 14 m; keine Runs ⇒ leeres Array", () => {
    assert.deepEqual(layoutApartments(null, []), []);
    assert.deepEqual(layoutApartments(undefined, undefined), []);
    assert.deepEqual(layoutApartments(FOOTPRINT, "keine Liste"), []);
    const mitDefault = layoutApartments(null, [RUN]);
    assert.equal(mitDefault.length, 6);
    for (const p of mitDefault[0].points) {
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z));
    }
  });

  it("Härtung: Fläche 0/negativ/fehlend ⇒ Mindestbreite, nie NaN oder Division durch 0", () => {
    for (const flaeche of [0, -75, undefined, NaN]) {
      const zones = layoutApartments(FOOTPRINT, [{ typ: { name: "X", flaeche_m2: flaeche }, countPerFloor: 1, floorFrom: 0, floorTo: 0 }]);
      assert.equal(zones.length, 1);
      for (const p of zones[0].points) {
        assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z), `NaN bei Fläche ${String(flaeche)}`);
      }
      const breite = Math.max(...zones[0].points.map((p) => p.x)) - Math.min(...zones[0].points.map((p) => p.x));
      assert.ok(breite >= 0.5, `Mindestbreite unterschritten: ${breite}`);
    }
  });

  it("Härtung: negative/fehlende Anzahl ⇒ keine Zonen; fehlender Typname ⇒ \"Wohnung\"", () => {
    assert.deepEqual(layoutApartments(FOOTPRINT, [{ ...RUN, countPerFloor: -5 }]), []);
    assert.deepEqual(layoutApartments(FOOTPRINT, [{ ...RUN, countPerFloor: undefined }]), []);
    const ohneName = layoutApartments(FOOTPRINT, [{ typ: { flaeche_m2: 75 }, countPerFloor: 1, floorFrom: 0, floorTo: 0 }]);
    assert.match(ohneName[0].name, /^Wohnung 0-1 ·W$/);
  });

  it("Härtung: kaputte Footprint-Punkte erzeugen endliche Koordinaten", () => {
    const kaputt = [{ x: NaN, z: NaN }, { x: 10 }, { z: 7 }, {}];
    const zones = layoutApartments(kaputt, [RUN]);
    for (const z of zones) {
      for (const p of z.points) {
        assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z), `NaN in ${z.name}`);
      }
    }
  });
});

describe("apartments.js — wohnflaecheSumme() / wohnungenAnzahl()", () => {
  it("2 WE à 75 m² über 3 Geschosse ⇒ 450 m² und 6 WE", () => {
    assert.equal(wohnflaecheSumme([RUN]), 450);
    assert.equal(wohnungenAnzahl([RUN]), 6);
  });

  it("Geschossanzahl ist |to − from| + 1 (ein Geschoss ⇒ Faktor 1)", () => {
    const eines = { ...RUN, floorFrom: 3, floorTo: 3 };
    assert.equal(wohnungenAnzahl([eines]), 2);
    assert.equal(wohnflaecheSumme([eines]), 150);
  });

  it("floorTo fehlt ⇒ nur floorFrom (Default-Fallback)", () => {
    const ohneTo = { typ: { name: "X", flaeche_m2: 75 }, countPerFloor: 2, floorFrom: 4 };
    assert.equal(wohnungenAnzahl([ohneTo]), 2);
  });

  it("mehrere Runs summieren sich", () => {
    const runs = [RUN, { typ: { name: "2-Zimmer", flaeche_m2: 60 }, countPerFloor: 1, floorFrom: 0, floorTo: 0 }];
    assert.equal(wohnflaecheSumme(runs), 450 + 60);
    assert.equal(wohnungenAnzahl(runs), 7);
  });

  it("Härtung: kein Array/leer/kaputte Runs ⇒ 0, nie NaN", () => {
    for (const runs of [[], null, undefined, "x", [null, undefined, {}]]) {
      assert.equal(wohnflaecheSumme(runs), 0, `wohnflaecheSumme(${JSON.stringify(runs)})`);
      assert.equal(wohnungenAnzahl(runs), 0);
    }
  });

  it("Härtung: negative Flächen/Anzahlen werden geklemmt ⇒ 0, nie negativ", () => {
    const negativ = { typ: { name: "X", flaeche_m2: -75 }, countPerFloor: -2, floorFrom: 0, floorTo: 2 };
    assert.equal(wohnflaecheSumme([negativ]), 0);
    assert.equal(wohnungenAnzahl([negativ]), 0);
  });

  it("Konsistenz: Zahl der Layout-Zonen entspricht wohnungenAnzahl", () => {
    const runs = [RUN, { typ: { name: "2-Zimmer", flaeche_m2: 60 }, countPerFloor: 3, floorFrom: 0, floorTo: 1 }];
    assert.equal(layoutApartments(FOOTPRINT, runs).length, wohnungenAnzahl(runs));
  });
});

describe("apartments.js — apartmentChecks() Invarianten", () => {
  it("liefert genau 3 Items mit den vereinbarten Keys", () => {
    const c = apartmentChecks([RUN], 1000);
    assert.equal(c.items.length, 3);
    assert.deepEqual(c.items.map((i) => i.key), ["belegung", "typen", "auslastung"]);
  });

  it("450 m² Wohnfläche in 1.000 m² NGF ⇒ Auslastung 45 % ⇒ Reserve-Hinweis", () => {
    const c = apartmentChecks([RUN], 1000);
    const item = c.items.find((i) => i.key === "auslastung");
    assert.equal(item.status, "warn");
    assert.match(item.detail, /Reserve/);
    assert.match(item.detail, /45 %/);
  });

  it("Auslastungsgrenze exakt bei 50 %: 50 % ⇒ pass, 49,9 % ⇒ warn", () => {
    assert.equal(apartmentChecks([RUN], 900).items.find((i) => i.key === "auslastung").status, "pass"); // 450/900 = 50 %
    assert.equal(apartmentChecks([RUN], 901).items.find((i) => i.key === "auslastung").status, "warn");
  });

  it("Überbelegung (Wohnfläche > NGF) ⇒ belegung warn", () => {
    const c = apartmentChecks([RUN], 400);
    const item = c.items.find((i) => i.key === "belegung");
    assert.equal(item.status, "warn");
    assert.match(item.detail, /Überbelegung/);
  });

  it("Grenzwert exakt: Wohnfläche = NGF ist noch keine Überbelegung", () => {
    assert.equal(apartmentChecks([RUN], 450).items.find((i) => i.key === "belegung").status, "pass");
    assert.equal(apartmentChecks([RUN], 449).items.find((i) => i.key === "belegung").status, "warn");
  });

  it("kein Typ mit Anzahl > 0 ⇒ typen warn", () => {
    assert.equal(apartmentChecks([], 1000).items.find((i) => i.key === "typen").status, "warn");
    assert.equal(apartmentChecks([{ ...RUN, countPerFloor: 0 }], 1000).items.find((i) => i.key === "typen").status, "warn");
    assert.equal(apartmentChecks([RUN], 1000).items.find((i) => i.key === "typen").status, "pass");
  });

  it("ohne NGF ⇒ Hinweis \"kein Footprint gesetzt\", aber kein Auslastungs-warn", () => {
    const c = apartmentChecks([RUN], 0);
    const item = c.items.find((i) => i.key === "auslastung");
    assert.equal(item.status, "pass");
    assert.match(item.detail, /kein Footprint gesetzt/);
  });

  it("INVARIANTE: apartmentChecks liefert NIE Status \"fail\" (Konzept-Raster)", () => {
    const varianten = [
      [[], 0], [[RUN], 1000], [[RUN], 1], [[RUN], -1000],
      [null, null], [undefined, undefined], ["x", NaN],
      [[{ typ: { flaeche_m2: 1e9 }, countPerFloor: 1e6, floorFrom: 0, floorTo: 100 }], 1],
    ];
    for (const [runs, ngf] of varianten) {
      const c = apartmentChecks(runs, ngf);
      for (const i of c.items) {
        assert.ok(["pass", "warn"].includes(i.status), `unerwarteter Status "${i.status}" (${i.key})`);
      }
    }
  });

  it("INVARIANTE: Score konsistent, 0–100; Verdict folgt der Hinweiszahl", () => {
    for (const [runs, ngf] of [[[], 0], [[RUN], 1000], [[RUN], 500]]) {
      const c = apartmentChecks(runs, ngf);
      const passes = c.items.filter((i) => i.status === "pass").length;
      assert.equal(c.score, Math.round((passes / c.items.length) * 100));
      assert.ok(c.score >= 0 && c.score <= 100);
      assert.equal(c.warns, c.items.length - passes);
      assert.equal(c.verdict, c.warns > 0 ? "Konzept mit Hinweisen" : "Konzept plausibel");
    }
  });

  it("Härtung: leerer Aufruf liefert 3 Items ohne NaN-Texte", () => {
    for (const c of [apartmentChecks(), apartmentChecks([], 0), apartmentChecks(null, NaN)]) {
      assert.equal(c.items.length, 3);
      assert.ok(Number.isFinite(c.score));
      for (const i of c.items) {
        assert.equal(typeof i.detail, "string");
        assert.ok(!/NaN|Infinity|undefined/.test(i.detail), `Platzhalter in ${i.key}: ${i.detail}`);
      }
    }
  });
});
