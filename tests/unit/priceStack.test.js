// Preisstapel — Modulverhalten an den Rändern (Phase 33 / W4).
//
// Die Parität gegen die 497 echten Positionen prüfen die Gates G10–G13
// (parity/g1*.test.mjs). Hier geht es um das, was Realdaten NICHT enthalten:
// fehlende Kataloge, fehlende Basis-Schichten, review-gesperrte Schichten und
// den einen Fall, der die ganze Konstruktion trägt — dass ein Index-Preis
// GERECHNET und nicht gespeichert wird.

import test from "node:test";
import assert from "node:assert/strict";
import {
  aktiveSchicht, bewerteSchichten, epDerSchicht, epDerSchichtDetail,
  indexFaktor, pruefeKeinIndexEp, rangVon, rangfolge, round2, zumSpeichern,
} from "@core/lib/rules/priceStack.js";

// Rangfolge wie im Katalog `PreisRangfolge` (höher = stärker).
const KATALOG = [
  { art: "schlussrechnung", rang: 90 }, { art: "nachtrag", rang: 80 },
  { art: "vertrag", rang: 70 }, { art: "angebot", rang: 60 },
  { art: "markt", rang: 50 }, { art: "stlb", rang: 40 },
  { art: "referenzprojekt", rang: 30 }, { art: "index", rang: 20 },
  { art: "kostenanschlag", rang: 10 },
];

// Zwei Punkte reichen für einen Faktor; die Reihe ist DATEN, nie Code.
const REIHE = {
  punkte: [
    { periode: "2020-11", wert: 95 },
    { periode: "2026-05", wert: 141 },
    { periode: "2027-06", wert: 150, prognose: true },
  ],
};
const REIHEN = { r1: REIHE };

const ka = (ep) => ({ id: "ka", art: "kostenanschlag", ep });
const idx = (von = "2020-11", bis = "2026-05", basis = "ka") => ({
  id: "ix", art: "index", basis: { schicht_id: basis, reihe_id: "r1", von, bis },
});

test("indexFaktor rechnet aus den Punkten der Reihe (kein Literal im Code)", () => {
  const f = indexFaktor(REIHE, "2020-11", "2026-05");
  assert.ok(Math.abs(f - 141 / 95) < 1e-12);
  assert.ok(Math.abs(f - 1.48) <= 0.01, `1,48 erwartet, gemessen ${f}`);
  const p = indexFaktor(REIHE, "2020-11", "2027-06");
  assert.ok(Math.abs(p - 1.58) <= 0.01, `1,58 erwartet, gemessen ${p}`);
});

test("indexFaktor liefert null (nicht 1) bei unbekannter Periode-Schreibweise", () => {
  assert.equal(indexFaktor(REIHE, "Mai 2026", "2026-05"), null);
  assert.equal(indexFaktor(null, "2020-11", "2026-05"), null);
});

test("epDerSchicht: Literalschicht gibt ihr ep zurück", () => {
  assert.equal(epDerSchicht(ka(100), [ka(100)], REIHEN), 100);
});

test("epDerSchicht: Index-Schicht wird GERECHNET und auf Cent gerundet", () => {
  const schichten = [ka(18000), idx()];
  const d = epDerSchichtDetail(schichten[1], schichten, REIHEN);
  assert.equal(d.berechnet, true);
  assert.equal(d.ep, round2(18000 * (141 / 95)));
  assert.ok(d.formel.includes("2020-11 → 2026-05"), "die Formel muss lesbar sein");
});

test("Index-Schicht: fehlende Basis ⇒ null MIT Warnung, nie stille 0", () => {
  const schichten = [idx("2020-11", "2026-05", "gibtsnicht")];
  const d = epDerSchichtDetail(schichten[0], schichten, REIHEN);
  assert.equal(d.ep, null);
  assert.notEqual(d.ep, 0);
  assert.ok(d.warnungen.some((w) => /Basis-Schicht/.test(w)));
});

test("Index-Schicht: fehlende Reihe ⇒ null MIT Warnung", () => {
  const schichten = [ka(100), idx()];
  const d = epDerSchichtDetail(schichten[1], schichten, {});
  assert.equal(d.ep, null);
  assert.ok(d.warnungen.some((w) => /Preisindexreihe/.test(w)));
});

test("ein persistiertes ep an der Index-Schicht wird IGNORIERT und gemeldet", () => {
  const schichten = [ka(100), { ...idx(), ep: 999999 }];
  const d = epDerSchichtDetail(schichten[1], schichten, REIHEN);
  assert.notEqual(d.ep, 999999);
  assert.equal(d.ep, round2(100 * (141 / 95)));
  assert.ok(d.warnungen.some((w) => /nicht gespeichert|ignoriert/.test(w)));
  // …und der Wächter findet den Verstoß, statt ihn still zu reparieren.
  assert.equal(pruefeKeinIndexEp(schichten).length, 1);
});

test("zumSpeichern entfernt den ep der Index-Schicht (T-33-16)", () => {
  const gespeichert = zumSpeichern({ ...idx(), ep: 42 });
  assert.equal("ep" in gespeichert, false);
  // Literalschichten behalten ihr ep.
  assert.equal(zumSpeichern(ka(100)).ep, 100);
});

test("aktive Schicht = höchster Rang mit ep != null", () => {
  const schichten = [ka(100), idx(), { id: "v", art: "vertrag", ep: 123 }];
  const a = aktiveSchicht(schichten, REIHEN, rangfolge(KATALOG));
  assert.equal(a.art, "vertrag");
  assert.equal(a.ep, 123);
  assert.equal(a.rang, 70);
});

test("review.flag blockiert die Schicht — sie bleibt aber SICHTBAR", () => {
  const schichten = [
    ka(100), idx(),
    { id: "r", art: "referenzprojekt", ep: 38, review: { flag: true, grund: "sim=0.75" } },
  ];
  const a = aktiveSchicht(schichten, REIHEN, rangfolge(KATALOG));
  assert.equal(a.art, "index", "die gesperrte Referenz darf nicht aktiv werden");
  const sichtbar = a.alle.find((s) => s.id === "r");
  assert.ok(sichtbar, "die Schicht muss in der Liste stehen (nicht weggeworfen)");
  assert.equal(sichtbar.review_sperre, true);
  assert.match(sichtbar.nicht_aktiv_grund, /Review/);
});

test("ohne Katalog gibt es KEINE geratene Rangfolge", () => {
  const a = aktiveSchicht([ka(100), { id: "v", art: "vertrag", ep: 5 }], REIHEN, rangfolge([]));
  assert.equal(a.schicht, null);
  assert.equal(a.ep, null);
  assert.ok(a.warnungen.some((w) => /PreisRangfolge/.test(w)));
});

test("unbekannte Art wird nicht still eingeordnet", () => {
  assert.equal(rangVon("phantasie", rangfolge(KATALOG)), null);
  const b = bewerteSchichten([{ id: "x", art: "phantasie", ep: 9 }], { reihen: REIHEN, rangfolge: rangfolge(KATALOG) });
  assert.equal(b[0].waehlbar, false);
});

test("Rangwechsel wirkt in BEIDE Richtungen", () => {
  const basis = [ka(18000), idx()];
  const rf = rangfolge(KATALOG);
  const ohne = aktiveSchicht(basis, REIHEN, rf);
  assert.equal(ohne.art, "index");
  const mit = aktiveSchicht([...basis, { id: "v", art: "vertrag", ep: 20000 }], REIHEN, rf);
  assert.equal(mit.art, "vertrag");
  // Vertrag entfernt ⇒ Index kommt zurück, mit demselben Wert wie vorher.
  const wieder = aktiveSchicht(basis, REIHEN, rf);
  assert.equal(wieder.art, "index");
  assert.equal(wieder.ep, ohne.ep);
});

test("round2 rundet auf Cent und lässt null null", () => {
  assert.equal(round2(1.014), 1.01);
  assert.equal(round2(1.016), 1.02);
  assert.equal(round2(null), null);
  assert.equal(round2("keine Zahl"), null);
});

test("round2: der Halb-Cent-Fall ist FLIESSKOMMA, nicht Rundungsregel", () => {
  // Festgenagelt, damit niemand später „das rundet falsch" debuggt:
  // 1.005 * 100 ist als Double 100.49999999999999, also rundet Math.round auf
  // 100 ⇒ 1.00. Das ist keine Bankers-Rounding-Regel, sondern die binäre
  // Darstellung von 1.005. Python `round(1.005, 2)` liefert aus demselben Grund
  // ebenfalls 1.0. Wo es fachlich auf den halben Cent ankommt, muss die
  // Rundungsstelle benannt werden, nicht geraten.
  assert.equal(round2(1.005), 1);
  // Liegt der Double dagegen EXAKT auf .5 (2.675*100 = 267.5, 0.125*100 = 12.5),
  // rundet `Math.round` AUF — Python `round()` würde hier zur GERADEN Ziffer
  // runden (2.67 bzw. 0.12). Das ist der in 33-01 dokumentierte Unterschied
  // (~142 Feinaggregat-Gruppen, keine der 15 Modellmengen betroffen).
  assert.equal(round2(2.675), 2.68);
  assert.equal(round2(0.125), 0.13);
});
