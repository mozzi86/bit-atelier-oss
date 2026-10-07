// Preisschichten — kaufmännisches Modulverhalten (Phase 33 / W4).
//
// Der Schwerpunkt liegt auf den drei Stellen, an denen ein bequemer Default
// fachlich falsch wäre:
//   1. die Ampel bei „Index gegen Index" (n/a statt grün),
//   2. `im_vertrag_enthalten` (GB 0 an der Position, Σ-invariant),
//   3. die 5 ungeklärten Deckungsfälle (ausweisen, nicht stumm mitzählen).

import test from "node:test";
import assert from "node:assert/strict";
import {
  AMPEL_NA, AMPEL_NA_GRUND, ARTEN, ampelVon, baueSchichten, gbDerPosition,
  kennzahlen, neueSchicht, schwellenAus, summen, zaehler,
} from "@ava/lib/preisschichten.js";
import { rangfolge } from "@core/lib/rules/priceStack.js";

const KATALOG = [
  { art: "schlussrechnung", rang: 90 }, { art: "nachtrag", rang: 80 },
  { art: "vertrag", rang: 70 }, { art: "angebot", rang: 60 },
  { art: "markt", rang: 50 }, { art: "stlb", rang: 40 },
  { art: "referenzprojekt", rang: 30 }, { art: "index", rang: 20 },
  { art: "kostenanschlag", rang: 10 },
];
const RF = rangfolge(KATALOG);
const REIHEN = { r1: { punkte: [{ periode: "2020-11", wert: 95 }, { periode: "2026-05", wert: 141 }] } };
const SCHWELLEN = schwellenAus([{ kontext: "preisabweichung", gruen_bis: 0.1, gelb_bis: 0.2 }]);

const stapel = (extra = []) => [
  { id: "ka", art: "kostenanschlag", ep: 100 },
  { id: "ix", art: "index", basis: { schicht_id: "ka", reihe_id: "r1", von: "2020-11", bis: "2026-05" } },
  ...extra,
];

test("die 9 Arten sind vollständig und tragen ihre Semantik", () => {
  assert.equal(Object.keys(ARTEN).length, 9);
  assert.equal(ARTEN.index.berechnet, true);
  assert.equal(ARTEN.kostenanschlag.eingefroren, true);
  assert.equal(ARTEN.markt.beleg_pflicht, true);
  // Der Kostenanschlag ist NICHT editierbar — er ist ein Dokumentenstand.
  assert.equal(ARTEN.kostenanschlag.editierbar, false);
});

test("EHRLICHKEITSREGEL: aktive Schicht = index ⇒ Ampel n/a, NICHT grün", () => {
  const k = kennzahlen({ quantity: 1 }, stapel(), REIHEN, SCHWELLEN, RF);
  assert.equal(k.art_aktiv, "index");
  assert.equal(k.delta_ep_index.ampel, AMPEL_NA);
  assert.equal(k.delta_ep_index.grund, AMPEL_NA_GRUND);
  assert.notEqual(k.delta_ep_index.ampel, "gruen");
  assert.equal(k.delta_ep_index.wert, null);
});

test("liegt eine Quelle ÜBER dem Index, wird die Ampel echt gerechnet", () => {
  const epIdx = Math.round(100 * (141 / 95) * 100) / 100; // 148.42
  const k = kennzahlen({ quantity: 1 }, stapel([{ id: "m", art: "markt", ep: epIdx * 1.3, herkunft: { typ: "markt" } }]), REIHEN, SCHWELLEN, RF);
  assert.equal(k.art_aktiv, "markt");
  assert.ok(Math.abs(k.delta_ep_index.wert - 0.3) < 1e-9);
  assert.equal(k.delta_ep_index.ampel, "rot");
});

test("Ampel ohne Katalogschwellen ⇒ n/a mit Grund, nicht grün", () => {
  const k = kennzahlen({ quantity: 1 }, stapel([{ id: "m", art: "markt", ep: 200, herkunft: { typ: "markt" } }]), REIHEN, schwellenAus([]), RF);
  assert.equal(k.delta_ep_index.ampel, AMPEL_NA);
  assert.match(k.delta_ep_index.grund, /AmpelSchwelle/);
});

test("Δ EP vs. Index ist MENGENNEUTRAL — die Menge ändert sie nicht", () => {
  const s = stapel([{ id: "m", art: "markt", ep: 200, herkunft: { typ: "markt" } }]);
  const a = kennzahlen({ quantity: 1 }, s, REIHEN, SCHWELLEN, RF);
  const b = kennzahlen({ quantity: 9999 }, s, REIHEN, SCHWELLEN, RF);
  assert.equal(a.delta_ep_index.wert, b.delta_ep_index.wert);
});

test("Δ Menge nur bei modellbasierter Quelle", () => {
  const s = stapel();
  const pauschal = kennzahlen({ quantity: 2, menge_kostenanschlag: 1, mengen_quelle: "pauschal" }, s, REIHEN, SCHWELLEN, RF);
  assert.equal(pauschal.delta_menge, null, "bei einer Pauschalposition ist Δ Menge bedeutungslos");
  const modell = kennzahlen({ quantity: 2, menge_kostenanschlag: 1, mengen_quelle: "IFC (NetSideArea)" }, s, REIHEN, SCHWELLEN, RF);
  assert.equal(modell.delta_menge, 1);
});

test("ampelVon: Grenzen kommen aus dem Katalog", () => {
  assert.equal(ampelVon(0.05, SCHWELLEN), "gruen");
  assert.equal(ampelVon(-0.15, SCHWELLEN), "gelb");
  assert.equal(ampelVon(0.25, SCHWELLEN), "rot");
  assert.equal(ampelVon(null, SCHWELLEN), null);
});

test("neueSchicht erzeugt eine NEUE Schicht mit ersetzt_id (Historie ohne Löschen)", () => {
  const alt = { id: "m1", art: "markt", ep: 100, herkunft: { typ: "markt", beleg: "Shop A" } };
  const neu = neueSchicht(alt, { ep: 120, herkunft: { typ: "markt", beleg: "Angebot B" } });
  assert.equal(neu.ersetzt_id, "m1");
  assert.equal(neu.id, null, "die DB vergibt die neue id — nie die alte übernehmen");
  assert.equal(neu.ep, 120);
  assert.equal(alt.ep, 100, "die alte Schicht bleibt unangetastet");
  assert.ok(neu.stand, "eine neue Schicht trägt einen Stand");
});

test("Handpreis ohne Beleg wird ABGEWIESEN", () => {
  assert.throws(() => neueSchicht(null, { art: "markt", ep: 5 }), /Herkunft/);
  assert.throws(() => neueSchicht(null, { art: "index", ep: 5 }), /gerechnet, nicht gesetzt/);
  assert.throws(() => neueSchicht(null, { art: "phantasie", ep: 5 }), /Unbekannte Preisart/);
});

test("im_vertrag_enthalten ⇒ GB 0 an der Position", () => {
  const s = stapel([{ id: "v", art: "vertrag", ep: 50, herkunft: { typ: "vertrag" } }]);
  const frei = gbDerPosition({ quantity: 10 }, { schichten: s, reihen: REIHEN, rangfolge: RF });
  assert.equal(frei.gb, 500);
  const gesperrt = gbDerPosition({ quantity: 10, im_vertrag_enthalten: true }, { schichten: s, reihen: REIHEN, rangfolge: RF });
  assert.equal(gesperrt.gb, 0);
  assert.equal(gesperrt.gesperrt, true);
  // Der ungesperrte Betrag bleibt sichtbar — sonst ist nicht prüfbar, was der
  // Vertrag eigentlich trägt.
  assert.equal(gesperrt.gb_ohne_sperre, 500);
});

test("Vertragssperre ist Σ-INVARIANT", () => {
  const s = stapel([{ id: "v", art: "vertrag", ep: 50, herkunft: { typ: "vertrag" } }]);
  const pos = [
    { id: "p1", quantity: 10, schichten: s },
    { id: "p2", quantity: 10, schichten: s },
  ];
  const offen = summen(pos, { reihen: REIHEN, rangfolge: RF });
  const beauftragt = summen(
    pos.map((p) => ({ ...p, im_vertrag_enthalten: true })),
    { reihen: REIHEN, rangfolge: RF, vertraege: [{ summe_netto: offen.gb_positionen }] },
  );
  assert.equal(beauftragt.gb_positionen, 0);
  assert.equal(beauftragt.gb_gesamt, offen.gb_gesamt, "die Gesamtsumme darf sich nicht verschieben");
});

test("ungeklärte Deckungsfälle werden AUSGEWIESEN, nicht stumm mitgezählt", () => {
  const s = stapel();
  const pos = [{ id: "p1", oz: "01020010", quantity: 1, im_vertrag_enthalten: true, schichten: s }];
  const r = summen(pos, {
    reihen: REIHEN, rangfolge: RF,
    deckungJePosition: { p1: { deckung: "ungeklaert", grund: "im KS-LV nicht auffindbar" } },
  });
  assert.equal(r.ungeklaert, 1);
  assert.equal(r.ungeklaert_liste[0].oz, "01020010");
  assert.match(r.ungeklaert_liste[0].grund, /nicht auffindbar/);
});

test("zaehler trennt „Quelle vorhanden\" von „Quelle wirkt\"", () => {
  const mitReview = stapel([{ id: "r", art: "referenzprojekt", ep: 38, review: { flag: true } }]);
  const z = zaehler([{ id: "p", quantity: 1, schichten: mitReview }], null, REIHEN, SCHWELLEN, RF);
  assert.equal(z.preisquelle_ueber_index, 1, "die Referenz LIEGT vor");
  assert.equal(z.aktiv_ueber_index, 0, "sie WIRKT aber nicht (review)");
  assert.equal(z.ampel[AMPEL_NA], 1, "und die Ampel bleibt n/a");
});

test("baueSchichten: keine Index-Schicht ohne Basis, kein ep an der Index-Schicht", () => {
  const s = baueSchichten({
    positionen: [{ id: "p1", gewerk_nr: "001", oz: "01010010" }, { id: "p2", gewerk_nr: "001", oz: "09999999" }],
    kostenanschlag: { "001|01010010": { menge: 1, ep: 100, gb: 100 } },
    index: { reihe_id: "r1", von: "2020-11", bis: "2026-05" },
  });
  const idxSchichten = s.filter((x) => x.art === "index");
  assert.equal(idxSchichten.length, 1, "nur die Position MIT Basis bekommt eine Index-Schicht");
  assert.equal("ep" in idxSchichten[0], false, "der ep einer Index-Schicht wird nie gesetzt");
  assert.equal(s.filter((x) => x.position_id === "p2").length, 0);
});

test("baueSchichten: review-Referenz bleibt als Schicht erhalten", () => {
  const s = baueSchichten({
    positionen: [{ id: "p1", gewerk_nr: "001", oz: "01030010" }],
    kostenanschlag: { "001|01030010": { menge: 1, ep: 100 } },
    referenzpreise: { "001|01030010": { ep: 38, sim: 0.75, ratio: 0.79, review: true, grund: "sim=0.75" } },
    index: { reihe_id: "r1", von: "2020-11", bis: "2026-05" },
  });
  const r = s.find((x) => x.art === "referenzprojekt");
  assert.ok(r);
  assert.equal(r.review.flag, true);
  assert.equal(r.match.sim, 0.75);
});

test("baueSchichten: Vertragspreis NUR über gepflegte Zuordnung (kein OZ-Join)", () => {
  const gemeinsam = {
    positionen: [{ id: "p1", gewerk_nr: "001", oz: "01010010" }],
    kostenanschlag: { "001|01010010": { ep: 100 } },
  };
  // Eine Vertragsposition mit gleicher OZ, aber OHNE `oz_lv`-Zuordnung darf
  // NICHTS bewirken — sie lebt in einem eigenen OZ-Raum.
  const ohne = baueSchichten({ ...gemeinsam, vertragspositionen: [{ gewerk_nr: "001", oz: "01010010", ep: 77 }] });
  assert.equal(ohne.filter((x) => x.art === "vertrag").length, 0);
  const mit = baueSchichten({ ...gemeinsam, vertragspositionen: [{ gewerk_nr: "001", oz: "0100010", oz_lv: "01010010", ep: 77 }] });
  assert.equal(mit.filter((x) => x.art === "vertrag").length, 1);
});
