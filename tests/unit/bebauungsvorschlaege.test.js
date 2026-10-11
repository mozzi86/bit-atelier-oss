// Unit tests for 86-05a (packages/nova-designer/src/lib/bebauungsvorschlaege.js): determinism,
// fixed upper bound, stable sort with id tie-break, rectangle = one proposal per typology,
// L/U = proposals with several bars, fails marker, every figure with unit + source, null
// instead of placeholders, layout-bound fields dropped from the base.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  ALGO_VERSION, VORSCHLAEGE_MAX, VARIANTEN_ACHSEN, KENNZAHLEN, LAYOUT_FELDER,
  footprintHash, vorschlagId, basisBereinigt, erzeugeVorschlaege, kennzahlen, sortiereVorschlaege, hashText,
} from "@designer/lib/bebauungsvorschlaege";
import { tesseliere } from "@designer/lib/tesselierung";
import { pruefeAlle } from "@designer/lib/raumQualitaet";
import { effektiveRegeln } from "@designer/lib/tesselierung";
import { WERKSTATT_TYPEN } from "@designer/lib/wohnungsTypen";
import { FOOTPRINTS } from "../e2e/fixtures/footprints.js";

const STD = WERKSTATT_TYPEN.filter((t) => t.gruppe === "standard").slice(0, 3);
const BASIS = { storeys: 4, einheiten: STD, raumzonen: true, regeln: {}, nordwinkel: 0, okf_m: 9 };
/** Layout-bound inputs that must NOT reach a proposal. */
const LAYOUT = { gesperrteGrenzen: ["L0-B0-G1"], anordnung: { "L0-B0": ["st-1zi"] }, grenzenPositionen: { "L0-B0-G1": 12 }, tuerAufschlaege: { "0|Bad (WE 0-1) ·WT|0": "links" }, stufeJeWe: { "0|st-1zi|1": "R" } };
const RECHTECK = FOOTPRINTS.rechteck_70x16.footprintM;
const L = FOOTPRINTS.L.footprintM;
const U = FOOTPRINTS.U.footprintM;
/** Two typologies keep the L/U runs short; the golden test runs the full axes. */
const KURZ = { ...VARIANTEN_ACHSEN, erschliessung: ["mittelflur", "mfh"] };
const json = (v) => JSON.stringify(v);

describe("86-05a — Hashes und Ids", () => {
  it("footprintHash: stabil unter 1-mm-Rauschen und Punktduplikaten, anders bei Verschiebung", () => {
    const h = footprintHash(RECHTECK);
    assert.equal(h.length, 16);
    assert.equal(footprintHash(RECHTECK.map((p) => ({ x: p.x + 0.001, z: p.z - 0.001 }))), h);
    assert.equal(footprintHash([RECHTECK[0], RECHTECK[0], ...RECHTECK.slice(1)]), h);
    assert.notEqual(footprintHash(RECHTECK.map((p) => ({ x: p.x + 1, z: p.z }))), h);
    assert.equal(footprintHash(null), "leer");
    assert.equal(footprintHash([{ x: 0, z: 0 }, { x: 1, z: 0 }]), "leer");
  });

  it("hashText deterministisch, vorschlagId trägt Version/Typologie/Mindestfläche", () => {
    assert.equal(hashText("abc"), hashText("abc"));
    assert.notEqual(hashText("abc"), hashText("abd"));
    const id = vorschlagId("h", { erschliessung: "mfh", zerlegung: { minFlaeche_m2: 160 }, ausrichtung: 0 });
    assert.match(id, /^v1-mfh-z160-[0-9a-f]{16}$/);
    assert.notEqual(id, vorschlagId("h2", { erschliessung: "mfh", zerlegung: { minFlaeche_m2: 160 } }));
  });

  it("basisBereinigt lässt layout-gebundene Felder weg, raumzonen default true", () => {
    const b = basisBereinigt({ ...BASIS, ...LAYOUT });
    for (const k of LAYOUT_FELDER) assert.equal(k in b, false, k);
    assert.equal(b.storeys, 4);
    assert.equal(basisBereinigt({}).raumzonen, true);
    assert.equal(basisBereinigt(null).raumzonen, true);
  });
});

describe("86-05a — erzeugeVorschlaege", () => {
  it("Rechteck 70 × 16: genau ein Vorschlag je Erschließung, je ein Riegel, Default-Mindestfläche", () => {
    const liste = erzeugeVorschlaege(RECHTECK, { ...BASIS, ...LAYOUT });
    assert.equal(liste.length, VARIANTEN_ACHSEN.erschliessung.length);
    assert.deepEqual(liste.map((v) => v.typologie.erschliessung), VARIANTEN_ACHSEN.erschliessung);
    for (const v of liste) {
      assert.equal(v.riegel, 1);
      assert.equal(v.typologie.zerlegung.minFlaeche_m2, VARIANTEN_ACHSEN.zerlegung[0].minFlaeche_m2);
      assert.equal(v.algoVersion, ALGO_VERSION);
      assert.equal(v.footprintHash, footprintHash(RECHTECK));
      assert.equal(v.parameter.storeys, 4);
    }
    assert.equal(new Set(liste.map((v) => v.id)).size, liste.length, "ids eindeutig");
  });

  it("Erster Vorschlag je Typologie = heutiges Werkstatt-Ergebnis (Default-Parameter, Layout-Felder verworfen)", () => {
    const liste = erzeugeVorschlaege(RECHTECK, { ...BASIS, ...LAYOUT }, { achsen: KURZ });
    const direkt = tesseliere({ ...BASIS, footprintM: RECHTECK, typ: "mittelflur" });
    assert.equal(json(liste[0].ergebnis), json(direkt));
  });

  it("Determinismus: zwei Läufe byte-gleich (Rechteck und L)", () => {
    assert.equal(json(erzeugeVorschlaege(RECHTECK, BASIS)), json(erzeugeVorschlaege(RECHTECK, BASIS)));
    assert.equal(json(erzeugeVorschlaege(L, BASIS, { achsen: KURZ })), json(erzeugeVorschlaege(L, BASIS, { achsen: KURZ })));
  });

  it("Obergrenze greift und ist ein Präfix der vollen Liste; ≤ VORSCHLAEGE_MAX ohne Angabe", () => {
    const voll = erzeugeVorschlaege(RECHTECK, BASIS);
    const zwei = erzeugeVorschlaege(RECHTECK, BASIS, { max: 2 });
    assert.equal(zwei.length, 2);
    assert.deepEqual(zwei.map((v) => v.id), voll.slice(0, 2).map((v) => v.id));
    assert.ok(voll.length <= VORSCHLAEGE_MAX);
    assert.equal(erzeugeVorschlaege(RECHTECK, BASIS, { max: 0 }).length, 1, "max < 1 → 1");
  });

  it("L und U: Vorschläge mit 2–3 Riegeln, Füllgrad ≥ 0,9 bei mindestens einem; gleiche Zerlegungen nur einmal", () => {
    for (const [name, fp, riegelSoll] of [["L", L, 2], ["U", U, 3]]) {
      const liste = erzeugeVorschlaege(fp, BASIS, { achsen: KURZ });
      assert.ok(liste.some((v) => v.riegel === riegelSoll), `${name}: ein Vorschlag mit ${riegelSoll} Riegeln`);
      assert.ok(liste.some((v) => (v.kennzahlen.fuellgrad.wert ?? 0) >= 0.9), `${name}: Füllgrad ≥ 0,9`);
      assert.ok(liste.length <= KURZ.erschliessung.length * KURZ.zerlegung.length);
      assert.equal(new Set(liste.map((v) => v.id)).size, liste.length);
      // Same decomposition → one proposal: no two proposals of a typology share the bar count AND figures.
      const sig = liste.map((v) => `${v.typologie.erschliessung}|${v.riegel}|${json(v.kennzahlen)}`);
      assert.equal(new Set(sig).size, sig.length, `${name}: keine doppelten Zerlegungen`);
    }
  });

  it("Ungültige Grundfläche → leere Liste", () => {
    assert.deepEqual(erzeugeVorschlaege(null, BASIS), []);
    assert.deepEqual(erzeugeVorschlaege([{ x: 0, z: 0 }, { x: 5, z: 0 }], BASIS), []);
  });
});

describe("86-05a — kennzahlen", () => {
  const ergebnis = tesseliere({ ...BASIS, footprintM: RECHTECK, typ: "mittelflur" });
  const kz = kennzahlen(ergebnis, { footprintM: RECHTECK, storeys: 4, regeln: {}, einheiten: STD });

  it("jede Kennzahl aus dem Register vorhanden, mit einheit und quelle; wert Zahl oder null", () => {
    for (const k of KENNZAHLEN) {
      const e = kz[k.key];
      assert.ok(e, k.key);
      assert.equal(e.einheit, k.einheit);
      assert.equal(e.quelle, k.quelle);
      assert.ok(e.quelle.length > 10, `${k.key}: Rechenweg genannt`);
      assert.ok(e.wert === null || Number.isFinite(e.wert), `${k.key}: Zahl oder null`);
    }
    assert.deepEqual(Object.keys(kz).sort(), KENNZAHLEN.map((k) => k.key).sort());
  });

  it("Werte plausibel: WE = weListe, BGF = 70 × 16 × 4, Effizienz < 1, Füllgrad 1, Kerne ≥ 0, Fassade > 0", () => {
    assert.equal(kz.we.wert, ergebnis.weListe.length);
    assert.equal(kz.bgf_m2.wert, 70 * 16 * 4);
    assert.ok(kz.wohnflaeche_m2.wert > 0 && kz.wohnflaeche_m2.wert < kz.bgf_m2.wert);
    assert.ok(kz.effizienz.wert > 0.5 && kz.effizienz.wert < 1);
    assert.equal(kz.fuellgrad.wert, 1);
    assert.ok(kz.erschliessung_m.wert > 0 && kz.erschliessung_m.wert <= 70 + 1e-6);
    assert.ok(kz.fassade_je_we_m.wert > 0);
    assert.equal(kz.rest_m2.wert, Math.round(ergebnis.rest_m2 * 1000) / 1000);
  });

  it("null statt Platzhalter: Rettungsweg ohne Regel null, mit regeln.rettungsweg eine Zahl", () => {
    assert.equal(kz.rettungsweg_max_m.wert, null);
    const mitRegel = tesseliere({ ...BASIS, regeln: { rettungsweg: true }, footprintM: RECHTECK, typ: "mittelflur" });
    const kz2 = kennzahlen(mitRegel, { footprintM: RECHTECK, storeys: 4, regeln: { rettungsweg: true } });
    assert.ok(Number.isFinite(kz2.rettungsweg_max_m.wert) && kz2.rettungsweg_max_m.wert > 0);
    const leer = kennzahlen({}, {});
    assert.equal(leer.we.wert, 0);
    assert.equal(leer.wohnflaeche_m2.wert, null);
    assert.equal(leer.bgf_m2.wert, null);
    assert.equal(leer.effizienz.wert, null);
    assert.equal(leer.fassade_je_we_m.wert, null);
  });

  it("fails/warns zählen wie die Werkstatt (pruefeAlle über die Zonen)", () => {
    const bb = { minX: -35, maxX: 35, minZ: -8, maxZ: 8 };
    const q = pruefeAlle(ergebnis.zonen, { bbox: bb, regeln: effektiveRegeln({}), stufeJeWe: {} });
    const fails = q.reduce((s, x) => s + (x.zaehler.fail || 0), 0);
    const warns = q.reduce((s, x) => s + (x.zaehler.warn || 0), 0);
    assert.equal(kz.fails.wert, fails);
    assert.ok(kz.warns.wert >= warns, "warns = Qualität + Checks + raumWarns");
    const liste = erzeugeVorschlaege(RECHTECK, BASIS, { max: 1 });
    assert.equal(liste[0].hatFails, liste[0].kennzahlen.fails.wert > 0);
  });

  it("Ergebnis bleibt unverändert (reine Funktion)", () => {
    const vorher = json(ergebnis);
    kennzahlen(ergebnis, { footprintM: RECHTECK, storeys: 4 });
    assert.equal(json(ergebnis), vorher);
  });
});

describe("86-05a — sortiereVorschlaege", () => {
  const V = (id, we, fails = 0) => ({ id, kennzahlen: { we: { wert: we, einheit: "WE", quelle: "" }, fails: { wert: fails, einheit: "Stk", quelle: "" } } });
  const liste = [V("b", 10), V("a", 10), V("c", 12), V("d", null), V("e", 8, 3)];

  it("Standardrichtung aus dem Register: WE absteigend, Fails aufsteigend; Gleichstand → id; null zuletzt", () => {
    assert.deepEqual(sortiereVorschlaege(liste, "we").map((v) => v.id), ["c", "a", "b", "e", "d"]);
    // d has fails 0 (only its WE value is null), so it sorts among the zeros by id; e (3) last.
    assert.deepEqual(sortiereVorschlaege(liste, "fails").map((v) => v.id), ["a", "b", "c", "d", "e"]);
  });

  it("Richtung überschreibbar, Eingabe unverändert, Reihenfolge der Eingabe egal", () => {
    assert.deepEqual(sortiereVorschlaege(liste, "we", "aufsteigend").map((v) => v.id), ["e", "a", "b", "c", "d"]);
    assert.deepEqual(liste.map((v) => v.id), ["b", "a", "c", "d", "e"]);
    const gedreht = [...liste].reverse();
    assert.deepEqual(sortiereVorschlaege(gedreht, "we").map((v) => v.id), sortiereVorschlaege(liste, "we").map((v) => v.id));
  });

  it("unbekannte Kennzahl → Fehler im Klartext", () => {
    assert.throws(() => sortiereVorschlaege(liste, "score"), /unbekannte Kennzahl "score"/);
  });

  it("auf echten Vorschlägen: Fails verändern die Reihenfolge nicht, nur die Marke", () => {
    const echt = erzeugeVorschlaege(RECHTECK, BASIS);
    const nachWe = sortiereVorschlaege(echt, "we");
    for (let i = 1; i < nachWe.length; i += 1) {
      const a = nachWe[i - 1].kennzahlen.we.wert, b = nachWe[i].kennzahlen.we.wert;
      assert.ok(a > b || (a === b && nachWe[i - 1].id < nachWe[i].id));
    }
  });
});
