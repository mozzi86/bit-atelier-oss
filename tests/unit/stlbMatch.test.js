// STLB-Zuordnung — Modulverhalten (Phase 33 / W7, Plan 33-04).
//
// Die Bilanz 2/10/485 auf den Realdaten prüft Gate G18. Hier geht es um die
// Stufengrenzen 0,82 und 0,60, den Jaccard-Anteil am Score, den leeren Katalog —
// und um die eine Zusicherung, die nicht verhandelbar ist: **es entsteht nie ein
// Einheitspreis.**

import test from "node:test";
import assert from "node:assert/strict";
import {
  ABGRENZUNG, STUFEN, ordneAlleZu, ordneZu, schwellenAus, score, stlbFeld, stufeVon,
} from "@ava/lib/stlbMatch.js";

const KATALOG = [
  {
    name: "STLB-Bau-Zuordnung (Kurztext-Match)",
    von: "stlb_katalog",
    gewicht_ratcliff: 0.6,
    gewicht_jaccard: 0.4,
    stufe_hoch_ab: 0.82,
    stufe_mittel_ab: 0.6,
    liefert_ep: false,
    verfahren: "0,6 × Ratcliff + 0,4 × Jaccard",
  },
];
const S = schwellenAus(KATALOG);
const KAND = [
  { kurztext: "Bauzaun Stahlrohrrahmen verz Vergitterung H 2m aufstellen räumen", einheit: "m" },
  { kurztext: "Baustelle einrichten räumen", einheit: "St" },
  { kurztext: "Bauwasseranschluss einrichten räumen", einheit: "St", stlb: "<STLBBau/>" },
];

test("die Gewichte und Grenzen kommen aus dem KATALOG", () => {
  assert.equal(S.fehlt, false);
  assert.equal(S.gewicht_ratcliff, 0.6);
  assert.equal(S.gewicht_jaccard, 0.4);
  assert.equal(S.stufe_hoch_ab, 0.82);
  assert.equal(S.stufe_mittel_ab, 0.6);
  assert.equal(S.liefert_ep, false);
  assert.deepEqual(STUFEN, ["hoch", "mittel", "kein"]);
});

test("ohne Katalogzeile wird NICHT geraten — alles bleibt „kein“", () => {
  const leer = schwellenAus([]);
  assert.equal(leer.fehlt, true);
  assert.match(leer.grund, /PreisUebernahmeRegel/);
  const r = ordneZu({ kurztext: "Baustelle einrichten räumen" }, KAND, leer);
  assert.equal(r.stufe, "kein");
  assert.equal(r.kandidat, null);
  assert.ok(r.warnungen.length > 0);
  // Und über `ordneAlleZu` genauso.
  const alle = ordneAlleZu([{ kurztext: "Baustelle einrichten räumen" }], KAND, []);
  assert.equal(alle.bilanz.kein, 1);
  assert.ok(alle.warnungen.length > 0);
});

test("Stufengrenzen: 0,82 und 0,60 — jeweils inklusiv", () => {
  assert.equal(stufeVon(1, S), "hoch");
  assert.equal(stufeVon(0.82, S), "hoch", "genau AUF der Grenze ist hoch");
  assert.equal(stufeVon(0.8199, S), "mittel");
  assert.equal(stufeVon(0.6, S), "mittel", "genau AUF der Grenze ist mittel");
  assert.equal(stufeVon(0.5999, S), "kein");
  assert.equal(stufeVon(0, S), "kein");
  // Ohne Schwellen und ohne Wert: „kein", keine Ausnahme.
  assert.equal(stufeVon(1, { fehlt: true }), "kein");
  assert.equal(stufeVon(null, S), "kein");
});

test("score: beide Anteile bleiben einsehbar und die Gewichtung stimmt", () => {
  const r = score("Bauzaun H 2m aufstellen räumen", "Bauzaun H 2m aufstellen räumen", S);
  assert.equal(r.ratcliff, 1);
  assert.equal(r.jaccard, 1);
  assert.equal(r.score, 1);

  // Reine Umstellung der Wörter: Jaccard bleibt 1, Ratcliff fällt.
  const umgestellt = score("Bauzaun H 2m aufstellen", "aufstellen H 2m Bauzaun", S);
  assert.equal(umgestellt.jaccard, 1);
  assert.ok(umgestellt.ratcliff < 1);
  assert.ok(Math.abs(umgestellt.score - (0.6 * umgestellt.ratcliff + 0.4)) < 1e-12);
  // Genau das ist der Grund für den Jaccard-Anteil: allein mit Ratcliff wäre
  // dieser Fall unter der Mittel-Schwelle.
  assert.ok(umgestellt.score > umgestellt.ratcliff);

  // Nichts gemeinsam ⇒ 0.
  const fremd = score("Bauzaun", "Estrich", S);
  assert.equal(fremd.jaccard, 0);
  assert.ok(fremd.score < 0.3);
});

test("ordneZu: bester Kandidat, Gleichstand an den ERSTEN", () => {
  const r = ordneZu({ kurztext: "Baustelle einrichten räumen" }, KAND, S);
  assert.equal(r.stufe, "hoch");
  assert.equal(r.score, 1);
  assert.equal(r.kandidat.kurztext, "Baustelle einrichten räumen");

  const doppelt = [{ kurztext: "gleich" }, { kurztext: "gleich" }];
  const g = ordneZu({ kurztext: "gleich" }, doppelt, S);
  assert.equal(g.kandidat, doppelt[0]);
});

test("ordneZu: bei Stufe „kein“ wird KEIN Kandidat ausgegeben", () => {
  // Ein angedeuteter Treffer würde als Zuordnung gelesen.
  const r = ordneZu({ kurztext: "Fensterbank Naturstein innen liefern montieren" }, KAND, S);
  assert.equal(r.stufe, "kein");
  assert.equal(r.kandidat, null);
  assert.ok(r.score >= 0, "der Score wird trotzdem ausgewiesen");
});

test("leerer Kandidatenkorpus: „kein“ mit Warnung, keine Ausnahme", () => {
  const r = ordneZu({ kurztext: "Baustelle einrichten" }, [], S);
  assert.equal(r.stufe, "kein");
  assert.equal(r.score, 0);
  assert.ok(r.warnungen.some((w) => /leerer STLB-Kandidatenkorpus/.test(w)));
  // Kandidaten ohne Kurztext werden übersprungen, nicht als Treffer gezählt.
  const luecke = ordneZu({ kurztext: "Baustelle einrichten räumen" }, [{ kurztext: null }], S);
  assert.equal(luecke.stufe, "kein");
});

test("ordneAlleZu: Bilanz zählt vollständig und liefert die Abgrenzung mit", () => {
  const positionen = [
    { gewerk_nr: "004", oz: "1", kurztext: "Baustelle einrichten räumen" },        // hoch
    { gewerk_nr: "004", oz: "2", kurztext: "Bauzaun H 2m aufstellen räumen" },     // mittel
    { gewerk_nr: "004", oz: "3", kurztext: "Fensterbank Naturstein innen" },       // kein
  ];
  const r = ordneAlleZu(positionen, KAND, KATALOG);
  assert.equal(r.bilanz.gesamt, 3);
  assert.equal(r.bilanz.hoch + r.bilanz.mittel + r.bilanz.kein, 3, "die Bilanz summiert auf");
  assert.equal(r.bilanz.hoch, 1);
  assert.equal(r.bilanz.kein, 1);
  assert.match(r.abgrenzung, /nicht bepreisbar/);
  assert.equal(r.abgrenzung, ABGRENZUNG);
  // Position-ID wird gebildet, wenn keine übergeben ist.
  assert.equal(r.zeilen[0].position_id, "004|1");
  assert.ok(r.zeilen[0].normalisiert);
  // Leere Eingabe: leere Bilanz, keine erfundenen Prozente.
  const leer = ordneAlleZu([], KAND, KATALOG);
  assert.deepEqual(leer.bilanz, { hoch: 0, mittel: 0, kein: 0, gesamt: 0 });
});

test("ES ENTSTEHT NIE EIN EINHEITSPREIS — auch nicht, wenn der Katalog es behauptet", () => {
  const r = ordneAlleZu([{ kurztext: "Baustelle einrichten räumen" }], KAND, KATALOG);
  assert.equal("ep" in r.zeilen[0], false);
  assert.equal("unit_price" in r.zeilen[0], false);
  assert.equal(r.zeilen[0].bepreisbar, false);

  const gelogen = [{ ...KATALOG[0], liefert_ep: true }];
  const r2 = ordneAlleZu([{ kurztext: "Baustelle einrichten räumen" }], KAND, gelogen);
  assert.ok(r2.warnungen.some((w) => /liefert_ep/.test(w)), "die Behauptung wird GEMELDET");
  assert.equal(r2.zeilen[0].bepreisbar, false);
  assert.equal("ep" in r2.zeilen[0], false);
});

test("stlbFeld: null bei „kein“, sonst Schlüssel plus Abgrenzung", () => {
  assert.equal(stlbFeld(null), null);
  assert.equal(stlbFeld({ stufe: "kein", stlb_kurztext: "irgendwas" }), null,
    "eine leere Zuordnung ist keine Zuordnung");
  const f = stlbFeld({
    stufe: "hoch",
    stlb_kurztext: "Bauwasseranschluss einrichten räumen",
    stlb_einheit: "St",
    score: 1,
    stlb_ref: "<STLBBau/>",
    stlb_ids: ["4058"],
  });
  assert.equal(f.kurztext, "Bauwasseranschluss einrichten räumen");
  assert.equal(f.unit, "St");
  assert.equal(f.stufe, "hoch");
  assert.equal(f.katalog_ref, "<STLBBau/>");
  assert.deepEqual(f.ids, ["4058"]);
  assert.equal(f.bepreisbar, false);
  assert.equal("ep" in f, false);
  assert.match(f.hinweis, /DBD-BIM-Zugang/);
  // Ohne ids ⇒ leeres Array, nicht undefined.
  assert.deepEqual(stlbFeld({ stufe: "mittel", stlb_kurztext: "x" }).ids, []);
});

test("geänderte Katalogschwellen verschieben die Bilanz — ohne Codeänderung", () => {
  const positionen = [{ kurztext: "Bauzaun H 2m aufstellen räumen" }];
  const streng = ordneAlleZu(positionen, KAND, [{ ...KATALOG[0], stufe_mittel_ab: 0.95 }]);
  assert.equal(streng.bilanz.kein, 1);
  const locker = ordneAlleZu(positionen, KAND, [{ ...KATALOG[0], stufe_hoch_ab: 0.5, stufe_mittel_ab: 0.2 }]);
  assert.equal(locker.bilanz.hoch, 1);
});
