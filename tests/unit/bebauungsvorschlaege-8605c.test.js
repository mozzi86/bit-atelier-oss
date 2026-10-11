// Unit tests for 86-05c (packages/nova-designer/src/lib/bebauungsvorschlaege.js nachbarn +
// besteJeKennzahl): "ähnliche erzeugen" is deterministic (no randomness, no seed), never
// returns a proposal that is already listed (id or same decomposition), respects the axis
// ends (typology order, NACHBAR_MIN_FLAECHE) and marks its results with `ursprung`; the
// comparison picks the best cell per figure by the register direction, null never wins.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  erzeugeVorschlaege, nachbarn, kartenDaten, besteJeKennzahl, KENNZAHLEN, VARIANTEN_ACHSEN,
  NACHBAR_SCHRITT_M2, NACHBAR_MIN_FLAECHE,
} from "@designer/lib/bebauungsvorschlaege";
import { WERKSTATT_TYPEN } from "@designer/lib/wohnungsTypen";
import { FOOTPRINTS } from "../e2e/fixtures/footprints.js";

const STD = WERKSTATT_TYPEN.filter((t) => t.gruppe === "standard").slice(0, 3);
const BASIS = { storeys: 4, einheiten: STD, raumzonen: true, regeln: {}, nordwinkel: 0, okf_m: 9 };
const RECHTECK = FOOTPRINTS.rechteck_70x16.footprintM;
const L = FOOTPRINTS.L.footprintM;
/** Two typologies keep the L runs short (same convention as bebauungsvorschlaege.test.js). */
const KURZ = { ...VARIANTEN_ACHSEN, erschliessung: ["mittelflur", "mfh"] };
const ids = (l) => l.map((v) => v.id);

describe("86-05c — nachbarn (ähnliche erzeugen)", () => {
  const listeL = erzeugeVorschlaege(L, BASIS, { achsen: KURZ }).map(kartenDaten);
  const quelle = listeL.find((v) => v.typologie.erschliessung === "mittelflur");

  it("deterministisch: zwei Aufrufe liefern dieselben Ids in derselben Reihenfolge", () => {
    const a = nachbarn(quelle, L, BASIS, { vorhanden: listeL, achsen: KURZ });
    const b = nachbarn(quelle, L, BASIS, { vorhanden: listeL, achsen: KURZ });
    assert.ok(a.length > 0, "L hat mindestens einen neuen Nachbarn");
    assert.deepEqual(ids(a), ids(b));
  });

  it("keine Duplikate: kein Ergebnis steht schon in der Liste; mit den Ergebnissen erweitert → zweiter Aufruf leer", () => {
    const a = nachbarn(quelle, L, BASIS, { vorhanden: listeL, achsen: KURZ });
    const vorhanden = new Set(ids(listeL));
    assert.ok(a.every((v) => !vorhanden.has(v.id)), "nichts doppelt");
    assert.equal(new Set(ids(a)).size, a.length, "untereinander eindeutig");
    const zweiter = nachbarn(quelle, L, BASIS, { vorhanden: [...listeL, ...a.map(kartenDaten)], achsen: KURZ });
    assert.deepEqual(ids(zweiter), [], "Dedupe greift beim zweiten Klick");
  });

  it("ursprung = Id der Quelle; kartenDaten trägt ihn weiter", () => {
    const a = nachbarn(quelle, L, BASIS, { vorhanden: listeL, achsen: KURZ });
    assert.ok(a.every((v) => v.ursprung === quelle.id));
    assert.equal(kartenDaten(a[0]).ursprung, quelle.id);
    assert.equal(kartenDaten(erzeugeVorschlaege(RECHTECK, BASIS)[0]).ursprung, null, "aufgezählte Vorschläge ohne Ursprung");
  });

  it("Achsengrenzen: Riegel-Mindestfläche im Bereich, Schrittweite Vielfaches von 40 m², Erschließung ±1 in Registerreihenfolge", () => {
    const a = nachbarn(quelle, L, BASIS, { achsen: KURZ });
    for (const v of a) {
      const m = v.typologie.zerlegung.minFlaeche_m2;
      assert.ok(m >= NACHBAR_MIN_FLAECHE.min && m <= NACHBAR_MIN_FLAECHE.max, `m ${m}`);
      assert.equal((m - quelle.typologie.zerlegung.minFlaeche_m2) % NACHBAR_SCHRITT_M2, 0);
      if (v.typologie.erschliessung !== quelle.typologie.erschliessung) {
        const i0 = KURZ.erschliessung.indexOf(quelle.typologie.erschliessung);
        assert.equal(Math.abs(KURZ.erschliessung.indexOf(v.typologie.erschliessung) - i0), 1);
      }
    }
  });

  it("Rechteck: keine Zerlegungsachse, alle Erschließungen schon da → keine Nachbarn", () => {
    const liste = erzeugeVorschlaege(RECHTECK, BASIS).map(kartenDaten);
    for (const k of liste) assert.deepEqual(ids(nachbarn(k, RECHTECK, BASIS, { vorhanden: liste })), [], k.typologie.erschliessung);
  });

  it("Rechteck ohne Liste: nur die Erschließungsnachbarn (erste Typologie hat nur +1)", () => {
    const erste = { id: "x", typologie: { erschliessung: VARIANTEN_ACHSEN.erschliessung[0], zerlegung: { minFlaeche_m2: 120 } } };
    const a = nachbarn(erste, RECHTECK, BASIS);
    assert.deepEqual(a.map((v) => v.typologie.erschliessung), [VARIANTEN_ACHSEN.erschliessung[1]]);
  });

  it("ungültige Eingaben → []; max begrenzt", () => {
    assert.deepEqual(nachbarn(null, L, BASIS), []);
    assert.deepEqual(nachbarn(quelle, [{ x: 0, z: 0 }], BASIS), []);
    assert.equal(nachbarn(quelle, L, BASIS, { achsen: KURZ, max: 1 }).length, 1);
  });
});

describe("86-05c — besteJeKennzahl (Vergleich)", () => {
  const k = (werte) => Object.fromEntries(KENNZAHLEN.map((r) => [r.key, { wert: werte[r.key] ?? null, einheit: r.einheit, quelle: r.quelle }]));
  const a = { id: "a", kennzahlen: k({ we: 40, fails: 2, rettungsweg_max_m: null }) };
  const b = { id: "b", kennzahlen: k({ we: 48, fails: 0, rettungsweg_max_m: null }) };
  const c = { id: "c", kennzahlen: k({ we: 48, fails: 1, rettungsweg_max_m: 30 }) };

  it("absteigend → größter Wert, aufsteigend → kleinster, Gleichstand markiert alle", () => {
    const best = besteJeKennzahl([a, b, c]);
    assert.deepEqual([...best.we].sort(), ["b", "c"], "WE: Gleichstand 48");
    assert.deepEqual([...best.fails], ["b"], "Fails: kleiner ist besser");
  });

  it("null gewinnt nie; nur null → leere Menge", () => {
    assert.deepEqual([...besteJeKennzahl([a, b, c]).rettungsweg_max_m], ["c"]);
    assert.equal(besteJeKennzahl([a, b]).rettungsweg_max_m.size, 0);
  });

  it("jede Kennzahl des Registers hat einen Eintrag", () => {
    assert.deepEqual(Object.keys(besteJeKennzahl([a, b])).sort(), KENNZAHLEN.map((r) => r.key).sort());
    assert.deepEqual(Object.keys(besteJeKennzahl([])).length, KENNZAHLEN.length);
  });
});
