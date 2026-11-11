// 261111-zs1: "Zeigen und Sagen" for creating elements - grammar (sprachbefehl.js), the geometry behind it (anlegen.js) and the proposal kind
// "anlegen" through the register commands (aenderungsBefehle.js) with the studio's own drawing functions (zeichnenModell.js).
// Proof: every sentence of the task table becomes the expected command; refusals instead of guesses (thickness, width, points, wall, room);
// a creation is only a proposal, runs on confirm, carries its origin and goes away again on undo; door snapping and "wall between rooms".
// All values are synthetic (walls of round lengths on a 10 m grid, room numbers 9.01/9.02).
import { test } from "node:test";
import assert from "node:assert/strict";
import { sprachbefehl, SATZ_HILFE } from "@core/lib/zeigen/sprachbefehl.js";
import { befehlsRegister } from "@core/lib/befehlsregister.js";
import { aenderungsBefehleRegistrieren } from "@core/lib/zeigen/aenderungsBefehle.js";
import { eingabeBefehlRegistrieren } from "@core/lib/zeigen/eingabe.js";
import { vorschlagSpeicher } from "@core/lib/zeigen/vorschlagSpeicher.js";
import { auswahlKontext, KEINE_AUSWAHL_TEXT } from "@core/lib/zeigen/auswahlKontext.js";
import { MARKE_FELD, bauteilImModell, oeffnungGuid, aenderungUmkehren } from "@core/lib/zeigen/aenderungen.js";
import { planFormen } from "@core/lib/zeigen/planVorschau.js";
import {
  punkteHinzu, punktePruefen, wandAmPunkt, tuerLage, raumNachNummer, wandZwischenRaeumen, neuerRaumname, anlegenBauen, anlegenGuid, zonenNummer,
  ZEIGEPUNKTE_MAX, OHNE_ZEICHNEN_TEXT,
} from "@core/lib/zeigen/anlegen.js";
import { bauteilGuid } from "@core/lib/bauteil/steckbrief.js";
import { wandAnlegen, oeffnungAnlegen, notizAnlegen } from "@designer/lib/zeichnenModell.js";

const P = "p-test";
const ZEICHNEN = { wandAnlegen, oeffnungAnlegen, notizAnlegen };
/** wall along x from (0, z) to (len, z), 0.24 m, centre reference line */
const wand = (idx, z = 0, len = 6, extra = {}) => ({ a: { x: 0, z }, b: { x: len, z }, level: 0, thickness: 0.24, height: 3, refLine: "center", _idx: idx, ...extra });
/** rectangular room from x0..x1, z0..z1 */
const raum = (idx, name, x0, z0, x1, z1, extra = {}) => ({ points: [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }], level: 0, name, _idx: idx, ...extra });

// ---------------------------------------------------------------------------------------------------------------
// Grammar

const K2 = { auswahl: { anzahl: 0, bauteile: [] }, punkte: [{ x: 0, z: 0, level: 0 }, { x: 4, z: 0, level: 0 }] };
const K1 = { auswahl: { anzahl: 0, bauteile: [] }, punkte: [{ x: 2, z: 0, level: 0 }] };
const wandSel = { anzahl: 1, bauteile: [{ guid: "WANDTESTGUID0000000001", klasse: "IfcWall", name: "Wand W-1" }] };
const tuerSel = { anzahl: 1, bauteile: [{ guid: "TUERTESTGUID0000000001", klasse: "IfcDoor", name: "Tür 2" }] };
const raumSel = { anzahl: 1, bauteile: [{ guid: "RAUMTESTGUID0000000001", klasse: "IfcSpace", name: "9.01 Test" }] };

/** [sentence, context, command, params] */
const FAELLE = [
  ["neue Trockenbauwand 12,5", K2, "anlegen", { objekt: "wand", wandart: "trockenbau", dicke_m: 0.125 }],
  ["neue Wand 24", K2, "anlegen", { objekt: "wand", wandart: "wand", dicke_m: 0.24 }],
  ["neue Mauerwerkswand 17,5", K2, "anlegen", { objekt: "wand", wandart: "mauerwerk", dicke_m: 0.175 }],
  ["Neue Wand 0,3 m", K2, "anlegen", { objekt: "wand", wandart: "wand", dicke_m: 0.3 }],
  ["neue Wand vierundzwanzig Zentimeter dick", K2, "anlegen", { objekt: "wand", wandart: "wand", dicke_m: 0.24 }],
  ["neue Trockenbauwand zwölf komma fünf", K2, "anlegen", { objekt: "wand", wandart: "trockenbau", dicke_m: 0.125 }],
  ["Tür 1,01", K1, "anlegen", { objekt: "tuer", breite_m: 1.01 }],
  ["Tür 1,01 T30-RS DIN links", K1, "anlegen", { objekt: "tuer", breite_m: 1.01, feuerwiderstand: "T30-RS", din_anschlag: "links" }],
  ["Tür 1,01 T30-RS DIN rechts", K1, "anlegen", { objekt: "tuer", breite_m: 1.01, feuerwiderstand: "T30-RS", din_anschlag: "rechts" }],
  ["neue Tür 0,885 rechts", K1, "anlegen", { objekt: "tuer", breite_m: 0.885, din_anschlag: "rechts" }],
  ["Tür 1,01 T30 RS", K1, "anlegen", { objekt: "tuer", breite_m: 1.01, feuerwiderstand: "T30-RS" }],
  ["Tür 101 cm", K1, "anlegen", { objekt: "tuer", breite_m: 1.01 }],
  ["Raum 1.05 heißt jetzt Lager", {}, "raum-umbenennen", { nummer: "1.05", name: "Lager" }],
  ["Raum 1,05 heisst Lager", {}, "raum-umbenennen", { nummer: "1.05", name: "Lager" }],
  ["dieser Raum heißt Lager", { auswahl: raumSel }, "raum-umbenennen", { name: "Lager" }],
  ["Notiz: Brüstung prüfen", K1, "anlegen", { objekt: "notiz", text: "Brüstung prüfen" }],
  ["Text Brüstung prüfen", K1, "anlegen", { objekt: "notiz", text: "Brüstung prüfen" }],
  ["Notiz „Höhe 2,10 m?“", K1, "anlegen", { objekt: "notiz", text: "Höhe 2,10 m?" }],
  ["Wand abbrechen", { auswahl: wandSel }, "eigenschaft-setzen", { name: "status", wert: "abbruch" }],
  ["diese Wand abreißen", { auswahl: wandSel }, "eigenschaft-setzen", { name: "status", wert: "abbruch" }],
  ["Tür ausbauen", { auswahl: tuerSel }, "eigenschaft-setzen", { name: "status", wert: "abbruch" }],
  ["Wand zwischen Raum 1.05 und 1.06 abbrechen", {}, "wand-zwischen-raeumen", { raum_a: "1.05", raum_b: "1.06" }],
  ["die Wand zwischen Raum 9.01 und Raum 9.02 abreißen", {}, "wand-zwischen-raeumen", { raum_a: "9.01", raum_b: "9.02" }],
];

for (const [satz, kontext, befehl, params] of FAELLE) {
  test(`Grammatik: „${satz}“ → ${befehl}`, () => {
    const r = sprachbefehl(satz, /** @type {any} */ (kontext));
    assert.equal(r?.art, "befehl", JSON.stringify(r));
    assert.equal(/** @type {any} */ (r).befehl, befehl);
    assert.deepEqual(/** @type {any} */ (r).params, params);
    assert.ok(/** @type {any} */ (r).verstanden);
  });
}

/** [sentence, context, part of the refusal] */
const ABLEHNUNGEN = [
  ["neue Wand", K2, /Wanddicke fehlt/],
  ["neue Trockenbauwand", K2, /Wanddicke fehlt/],
  ["neue Wand 24", K1, /genau 2 Punkte.*ist 1 Punkt/],
  ["neue Wand 24", { punkte: [] }, /fehlt der Ort/],
  ["neue Wand 24", { punkte: [{ x: 0, z: 0, level: 0 }, { x: 1, z: 0, level: 0 }, { x: 2, z: 0, level: 0 }] }, /genau 2 Punkte.*sind 3 Punkte/],
  ["neue Wand 24", { punkte: [{ x: 0, z: 0, level: 0 }, { x: 4, z: 0, level: 1 }] }, /verschiedenen Geschossen/],
  ["neue Wand 500", K2, /nicht plausibel/],
  ["neue Wand 24 aus Holz", K2, /„aus“ verstehe ich bei einer neuen Wand nicht/],
  ["Tür", K1, /Türbreite fehlt/],
  ["Tür 101", K1, /in Metern sagen/],
  ["Tür 0,2", K1, /nicht plausibel/],
  ["Tür 1,01 DIN", K1, /DIN links oder DIN rechts/],
  ["Tür 1,01 links rechts", K1, /eine Seite sagen/],
  ["Tür 1,01 T30 T90", K1, /Zwei Feuerwiderstände/],
  ["Tür 1,01 Holz", K1, /„Holz“ verstehe ich bei einer Tür nicht/],
  ["Tür 1,01", K2, /genau einen Punkt/],
  ["Tür 1,01", { punkte: [] }, /fehlt der Ort/],
  ["Notiz:", K1, /Text der Notiz fehlt/],
  ["Notiz: prüfen", K2, /genau einen Punkt/],
  ["Raum 1.05 heißt", {}, /neue Name fehlt/],
  ["Raum Küche heißt Lager", {}, /keine Raumnummer/],
  ["dieser Raum heißt Lager", { auswahl: { anzahl: 0, bauteile: [] } }, new RegExp(KEINE_AUSWAHL_TEXT.slice(0, 20))],
  ["dieser Raum heißt Lager", { auswahl: wandSel }, /Ausgewählt ist eine Wand, nicht ein Raum/],
  ["Wand abbrechen", { auswahl: { anzahl: 0, bauteile: [] } }, new RegExp(KEINE_AUSWAHL_TEXT.slice(0, 20))],
  ["Wand abbrechen", { auswahl: tuerSel }, /Ausgewählt ist eine Tür, nicht eine Wand/],
  ["Wand zwischen Küche und Bad abbrechen", {}, /Zwischen welchen Räumen/],
];

for (const [satz, kontext, muster] of ABLEHNUNGEN) {
  test(`Grammatik lehnt ab: „${satz}“`, () => {
    const r = sprachbefehl(satz, /** @type {any} */ (kontext));
    assert.equal(r?.art, "abgelehnt", JSON.stringify(r));
    assert.match(/** @type {any} */ (r).grund, /** @type {RegExp} */ (muster));
  });
}

test("Grammatik: ohne Punkte im Kontext entscheidet der Befehl (keine Ablehnung in der Grammatik)", () => {
  assert.equal(sprachbefehl("neue Wand 24", {})?.art, "befehl");
  assert.equal(sprachbefehl("Tür 1,01", {})?.art, "befehl");
});

test("Grammatik: bestehende Sätze bleiben, wie sie waren („abbrechen“ allein verwirft, „Wand 24“ ohne „neue“ legt nichts an)", () => {
  assert.equal(/** @type {any} */ (sprachbefehl("abbrechen", {})).befehl, "verwerfen");
  assert.notEqual(/** @type {any} */ (sprachbefehl("Wand 24", K2))?.befehl, "anlegen");
  assert.equal(/** @type {any} */ (sprachbefehl("Markiere dieses als Abbruch", { auswahl: wandSel })).befehl, "eigenschaft-setzen");
});

test("Hilfe: die neuen Beispielsätze sind in der Satzhilfe und werden verstanden", () => {
  for (const s of ["Neue Trockenbauwand 12,5", "Tür 1,01 T30-RS DIN links", "Notiz: Brüstung prüfen", "Raum 1.05 heißt jetzt Lager", "Wand zwischen Raum 1.05 und 1.06 abbrechen"]) {
    const h = SATZ_HILFE.find((x) => x.satz === s);
    assert.ok(h, s);
    assert.equal(/** @type {any} */ (sprachbefehl(s, {})).befehl, h.befehl, s);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// Points, snapping, rooms

test("Punkte: höchstens vier, der fünfte verdrängt den ältesten; ein anderes Geschoss beginnt neu", () => {
  let l = [];
  for (let i = 1; i <= 5; i++) l = punkteHinzu(l, { x: i, z: 0, level: 0 });
  assert.equal(l.length, ZEIGEPUNKTE_MAX);
  assert.deepEqual(l.map((p) => p.x), [2, 3, 4, 5]);
  l = punkteHinzu(l, { x: 9, z: 9, level: 1 });
  assert.deepEqual(l, [{ x: 9, z: 9, level: 1 }]);
  assert.equal(punktePruefen(l, 1, "eine Tür").ok, true);
});

test("Tür fangen: Punkt auf der Wandfläche trifft die Wand, Lage entlang der Wand in m", () => {
  const m = { customWalls: [wand(1, 0, 6), wand(2, 5, 6)] };
  const r = wandAmPunkt(m, { x: 2.5, z: 0.1, level: 0 });
  assert.equal(r.ok, true);
  assert.equal(/** @type {any} */ (r).wand._idx, 1);
  assert.ok(Math.abs(/** @type {any} */ (r).u_m - 2.5) < 1e-9);
  // 0.12 m half thickness + 0.30 m tolerance: 0.4 m from the axis is still on it, 0.5 m is not
  assert.equal(wandAmPunkt(m, { x: 2.5, z: 0.4, level: 0 }).ok, true);
  const weit = wandAmPunkt(m, { x: 2.5, z: 0.5, level: 0 });
  assert.equal(weit.ok, false);
  assert.match(/** @type {any} */ (weit).grund, /an keiner gezeichneten Wand/);
  // beyond the wall end, other storey: no wall
  assert.equal(wandAmPunkt(m, { x: 7, z: 0, level: 0 }).ok, false);
  assert.equal(wandAmPunkt(m, { x: 2.5, z: 0, level: 1 }).ok, false);
});

test("Tür fangen: zwei gleich nahe Wände (Ecke) werden abgelehnt, mit gewählter Wand eindeutig", () => {
  const quer = { a: { x: 3, z: -3 }, b: { x: 3, z: 3 }, level: 0, thickness: 0.24, _idx: 7 };
  const m = { customWalls: [wand(1, 0, 6), quer] };
  const r = wandAmPunkt(m, { x: 3, z: 0, level: 0 });
  assert.equal(r.ok, false);
  assert.match(/** @type {any} */ (r).grund, /an zwei Wänden.*vorher wählen/);
  const mit = wandAmPunkt(m, { x: 3, z: 0, level: 0 }, { wandIdx: 7 });
  assert.equal(mit.ok, true);
  assert.equal(/** @type {any} */ (mit).wand._idx, 7);
  assert.ok(Math.abs(/** @type {any} */ (mit).u_m - 3) < 1e-9);
});

test("Tür fangen: Wand mit Bezugslinie außen - der Wandkörper zählt, nicht nur die Achse", () => {
  // refLine "outside": the body lies on one side of a-b; a point in the body middle is inside it
  const w = wand(3, 0, 6, { refLine: "outside" });
  const m = { customWalls: [w] };
  for (const z of [-0.12, 0.12]) {
    const r = wandAmPunkt(m, { x: 3, z, level: 0 });
    assert.equal(r.ok, true, `z=${z}`);
  }
});

test("Türlage: zu kurze Wand und Überschneidung mit einer Öffnung werden abgelehnt, am Wandende wird eingerückt", () => {
  const w = wand(1, 0, 6);
  assert.match(/** @type {any} */ (tuerLage({}, wand(2, 0, 1), 0.5, 1.01)).grund, /zu kurz/);
  const ende = tuerLage({}, w, 0.1, 1);
  assert.equal(ende.ok, true);
  assert.equal(/** @type {any} */ (ende).u_m, 0.6);
  const m = { customWindows: [{ wallIdx: 1, u: 3, kind: "window", typeId: "single", width: 1.2, _idx: 9 }] };
  assert.match(/** @type {any} */ (tuerLage(m, w, 3.5, 1)).grund, /überschneidet Fenster 9/);
  assert.equal(tuerLage(m, w, 5, 1).ok, true);
});

test("Raum nach Nummer: Feld nummer oder erstes Wort des Namens, exakt; unbekannt und doppelt werden abgelehnt", () => {
  const m = { customZones: [raum(1, "9.01 Test-Büro", 0, 0, 4, 4), raum(2, "Testflur", 4, 0, 8, 4, { nummer: "9,02" }), raum(3, "9.03 A", 0, 4, 4, 8), raum(4, "9.03 B", 4, 4, 8, 8)] };
  assert.equal(zonenNummer(m.customZones[0]), "9.01");
  assert.equal(/** @type {any} */ (raumNachNummer(m, "9.01")).zone._idx, 1);
  assert.equal(/** @type {any} */ (raumNachNummer(m, "9.02")).zone._idx, 2);
  assert.match(/** @type {any} */ (raumNachNummer(m, "9.0")).grund, /gibt es im Modell nicht/);
  assert.match(/** @type {any} */ (raumNachNummer(m, "9.03")).grund, /2-mal/);
  assert.equal(neuerRaumname(m.customZones[0], "Lager"), "9.01 Lager");
  assert.equal(neuerRaumname(m.customZones[1], "Lager"), "Lager");
});

test("Wand zwischen zwei Räumen: genau die eine gekreuzte Wand; keine oder mehrere werden abgelehnt", () => {
  // rooms 9.01 (0..4) and 9.02 (4..8) side by side, wall 5 on x = 4 between them; wall 6 far away
  const trenn = { a: { x: 4, z: 0 }, b: { x: 4, z: 4 }, level: 0, thickness: 0.115, _idx: 5 };
  const fern = wand(6, 20, 6);
  const m = { customZones: [raum(1, "9.01 Test", 0, 0, 4, 4), raum(2, "9.02 Test", 4, 0, 8, 4), raum(3, "9.03 Test", 0, 10, 4, 14)], customWalls: [trenn, fern] };
  const r = wandZwischenRaeumen(m, "9.01", "9.02");
  assert.equal(r.ok, true);
  assert.equal(/** @type {any} */ (r).wand._idx, 5);
  assert.match(/** @type {any} */ (wandZwischenRaeumen(m, "9.01", "9.03")).grund, /keine gezeichnete Wand/);
  const zwei = { ...m, customWalls: [trenn, { ...trenn, a: { x: 4.3, z: 0 }, b: { x: 4.3, z: 4 }, _idx: 8 }] };
  assert.match(/** @type {any} */ (wandZwischenRaeumen(zwei, "9.01", "9.02")).grund, /2 Wände \(W-5, W-8\)/);
  assert.match(/** @type {any} */ (wandZwischenRaeumen(m, "9.01", "9.09")).grund, /Raum 9\.09 gibt es im Modell nicht/);
  assert.match(/** @type {any} */ (wandZwischenRaeumen(m, "9.01", "9.01")).grund, /derselbe Raum/);
});

test("Elementbau: ohne Zeichenfunktionen wird abgelehnt; GUID der Tür = GUID der Auswahl (oeffnungGuid)", () => {
  assert.throws(() => anlegenBauen({}, { objekt: "notiz", punkt: { x: 1, z: 1 }, text: "x" }), new RegExp(OHNE_ZEICHNEN_TEXT.slice(0, 20)));
  const o = { wallIdx: 4, u: 2, kind: "door", _idx: 11 };
  assert.equal(anlegenGuid(P, "tuer", o), oeffnungGuid(P, o, false));
  const w = { _idx: 12 };
  assert.equal(anlegenGuid(P, "wand", w), bauteilGuid(P, "customWalls", w));
});

// ---------------------------------------------------------------------------------------------------------------
// The chain through the register: proposal -> confirm -> origin -> undo

/** Stand-in of the studio surface (like aenderungsBefehle-10603.test.js) with points and the drawing functions. */
function flaeche(modell0, { auswahl = [], punkte = [], zeichnen = ZEICHNEN, naechsteIdx = 50 } = {}) {
  const f = { modell: modell0, auswahl, punkte, angewendet: 0, zurueck: 0, vorschau: new Set(), speicher: vorschlagSpeicher(), idx: naechsteIdx };
  const reg = befehlsRegister();
  const surface = () => ({
    kontext: () => auswahlKontext(f.auswahl),
    modell: () => f.modell,
    optionen: () => ({ projektId: P, geschosshoehe_m: 3, naechsteIdx: f.idx, zeichnen }),
    punkte: () => f.punkte,
    ansicht: () => null,
    zeigepunkt: () => null,
    speicher: f.speicher,
    uebernehmen: (_v, r) => { f.modell = r.modell; f.angewendet += 1; f.idx += 1; },
    zuruecknehmen: (_e, r) => { f.modell = r.modell; f.zurueck += 1; },
    vorschauZeigen: (v) => f.vorschau.add(v.id),
    vorschauEntfernen: (id) => f.vorschau.delete(id),
  });
  aenderungsBefehleRegistrieren(reg, /** @type {any} */ (surface));
  eingabeBefehlRegistrieren(reg, /** @type {any} */ (surface));
  f.reg = reg;
  f.aus = (id, p, ctx) => reg.ausfuehren(id, p, ctx);
  f.satz = (text, herkunft = "text") => reg.ausfuehren("eingabe", { text }, { herkunft });
  return f;
}

test("Satz „neue Trockenbauwand 12,5“ an zwei Punkten: Vorschlag, Bestätigen legt die Wand an, Rückgängig entfernt sie", () => {
  const f = flaeche({ customWalls: [] }, { punkte: [{ x: 0, z: 0, level: 0 }, { x: 4, z: 0, level: 0 }] });
  const r = f.satz("neue Trockenbauwand 12,5", "sprache");
  assert.equal(r.ok, true, JSON.stringify(r));
  const v = r.result.ergebnis;
  assert.equal(v.art, "anlegen");
  assert.match(v.satz, /Neu: Trockenbauwand 12,5 cm, 4 m lang \(Status Neubau\)/);
  assert.equal(v.herkunft, "sprache");
  assert.equal(f.modell.customWalls.length, 0, "nur Vorschlag, nichts angelegt");
  assert.ok(f.vorschau.has(v.id));
  // the plan ghost: the body outline of the new wall (4 corners), dashed in the component
  const offen = f.speicher.offen()[0];
  const formen = planFormen(f.modell, offen, { projektId: P });
  assert.equal(formen.length, 1);
  assert.equal(formen[0].punkte.length, 4);

  const b = f.satz("ja", "sprache");
  assert.equal(b.ok, true, JSON.stringify(b));
  assert.equal(f.modell.customWalls.length, 1);
  const w = f.modell.customWalls[0];
  assert.deepEqual([w.a, w.b], [{ x: 0, z: 0 }, { x: 4, z: 0 }]);
  assert.equal(w.thickness, 0.125);
  assert.equal(w.status, "neubau");
  assert.equal(w.bauteil_typ, "wand-innen");
  assert.equal(w.material, "Trockenbau");
  assert.equal(w.gewerk_lb, "039");
  assert.equal(w._idx, 50);
  assert.equal(w.guid, bauteilGuid(P, "customWalls", { _idx: 50 }));
  assert.equal(w[MARKE_FELD].herkunft, "sprache");
  assert.equal(w[MARKE_FELD].bestaetigt_durch, "sprache");
  assert.ok(bauteilImModell(f.modell, w.guid, { projektId: P }));
  const verlauf = f.speicher.verlauf();
  assert.equal(verlauf.length, 1);
  assert.equal(verlauf[0].art, "anlegen");
  assert.equal(verlauf[0].befehl_text, "neue Trockenbauwand 12,5");

  const z = f.aus("rueckgaengig", {});
  assert.equal(z.ok, true, JSON.stringify(z));
  assert.equal(f.modell.customWalls.length, 0, "Rückgängig entfernt die angelegte Wand");
});

test("Studiozähler: vergibt das Studio beim Bestätigen eine andere Nummer, gilt die echte GUID für das Rückgängig", () => {
  const f = flaeche({ customWalls: [] }, { punkte: [{ x: 0, z: 0, level: 0 }, { x: 3, z: 0, level: 0 }] });
  assert.equal(f.satz("neue Wand 24").ok, true);
  f.idx = 77; // another click drew meanwhile
  assert.equal(f.aus("bestaetigen", {}).ok, true);
  const w = f.modell.customWalls[0];
  assert.equal(w._idx, 77);
  assert.equal(f.speicher.verlauf()[0].ziel.guid, w.guid);
  assert.equal(f.aus("rueckgaengig", {}).ok, true);
  assert.equal(f.modell.customWalls.length, 0);
});

test("Tür an einem Punkt auf der Wand: Breite, T30-RS und DIN links stehen an der Öffnung, Rückgängig entfernt sie", () => {
  const w = wand(1, 0, 6);
  const f = flaeche({ customWalls: [w], customWindows: [] }, { punkte: [{ x: 2, z: 0.05, level: 0 }] });
  const r = f.satz("Tür 1,01 T30-RS DIN links");
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(r.result.ergebnis.satz, /Neu: Tür 1,01 m in Wand W-1, Mitte bei 2 m, T30-RS, DIN links \(Status Neubau\)/);
  const formen = planFormen(f.modell, f.speicher.offen()[0], { projektId: P });
  assert.equal(formen[0].punkte.length, 4, "Türvorschau = Stück des Wandkörpers");
  assert.equal(f.aus("bestaetigen", { durch: "hand" }).ok, true);
  const o = f.modell.customWindows[0];
  assert.equal(o.kind, "door");
  assert.equal(o.wallIdx, 1);
  assert.equal(o.width, 1.01);
  assert.equal(o.u, 2);
  assert.equal(o.feuerwiderstand, "T30-RS");
  assert.equal(o.din_anschlag, "links");
  assert.equal(o.status, "neubau");
  assert.equal(o.guid, oeffnungGuid(P, { ...o, guid: undefined }, false));
  // the new door is found like any other opening (selection, change chain)
  assert.equal(bauteilImModell(f.modell, o.guid, { projektId: P })?.art, "oeffnung");
  assert.equal(f.aus("rueckgaengig", {}).ok, true);
  assert.equal(f.modell.customWindows.length, 0);
});

test("Tür: gewählte Wand + Punkt daneben; Punkt an keiner Wand wird abgelehnt", () => {
  const w = wand(1, 0, 6);
  const f = flaeche({ customWalls: [w] }, { punkte: [{ x: 4, z: 0.9, level: 0 }] });
  const nein = f.satz("Tür 1,01");
  assert.equal(nein.ok, false);
  assert.match(nein.error, /an keiner gezeichneten Wand/);
  f.auswahl = [{ guid: bauteilGuid(P, "customWalls", w), klasse: "IfcWall", name: "Wand W-1" }];
  const ja = f.satz("Tür 1,01");
  assert.equal(ja.ok, true, JSON.stringify(ja));
  assert.match(ja.result.ergebnis.satz, /Mitte bei 4 m/);
});

test("Tür: die Wand wurde nach dem Vorschlag bewegt → Bestätigen verweigert (veraltet), es ändert sich nichts", () => {
  const w = wand(1, 0, 6);
  const f = flaeche({ customWalls: [w] }, { punkte: [{ x: 2, z: 0, level: 0 }] });
  assert.equal(f.satz("Tür 1,01").ok, true);
  f.modell = { ...f.modell, customWalls: [{ ...w, a: { x: 0, z: 1 }, b: { x: 6, z: 1 } }] };
  const b = f.aus("bestaetigen", {});
  assert.equal(b.ok, false);
  assert.match(b.error, /bewegt/);
  assert.equal((f.modell.customWindows || []).length, 0);
});

test("Notiz am Punkt: Vorschlag, Bestätigen legt planNotizen an, Rückgängig entfernt sie", () => {
  const f = flaeche({}, { punkte: [{ x: 1.5, z: 2.5, level: 0 }] });
  const r = f.satz("Notiz: Brüstung prüfen");
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(r.result.ergebnis.satz, /Neu: Notiz „Brüstung prüfen“ bei 1,5 \/ 2,5 m/);
  assert.equal(f.aus("bestaetigen", {}).ok, true);
  assert.equal(f.modell.planNotizen.length, 1);
  assert.deepEqual({ ...f.modell.planNotizen[0], [MARKE_FELD]: undefined, guid: undefined }, { x: 1.5, z: 2.5, level: 0, text: "Brüstung prüfen", _idx: 50, [MARKE_FELD]: undefined, guid: undefined });
  assert.equal(f.aus("rueckgaengig", {}).ok, true);
  assert.equal(f.modell.planNotizen.length, 0);
});

test("Anlegen: ohne Punkte / ohne Zeichenfunktionen wird abgelehnt; ein Agent schlägt vor, bestätigt aber nicht", () => {
  const ohne = flaeche({}, { punkte: [] });
  const a = ohne.aus("anlegen", { objekt: "wand", dicke_m: 0.24 });
  assert.equal(a.ok, false);
  assert.match(a.error, /fehlt der Ort/);
  const ohneZ = flaeche({}, { punkte: [{ x: 0, z: 0 }, { x: 2, z: 0 }], zeichnen: /** @type {any} */ (null) });
  const b = ohneZ.aus("anlegen", { objekt: "wand", dicke_m: 0.24 });
  assert.equal(b.ok, false);
  assert.match(b.error, /Zeichenfunktionen/);
  const f = flaeche({}, { punkte: [{ x: 0, z: 0 }, { x: 2, z: 0 }] });
  const agent = { kanal: "steuerung" };
  const v = f.aus("anlegen", { objekt: "wand", dicke_m: 0.24 }, agent);
  assert.equal(v.ok, true, JSON.stringify(v));
  assert.equal(v.result.herkunft, "agent");
  assert.equal(f.aus("bestaetigen", {}, agent).ok, false);
  assert.equal((f.modell.customWalls || []).length, 0);
});

test("Rückgängig der Wand verweigert, solange eine spätere Tür in ihr steht", () => {
  const f = flaeche({ customWalls: [], customWindows: [] }, { punkte: [{ x: 0, z: 0, level: 0 }, { x: 6, z: 0, level: 0 }] });
  assert.equal(f.satz("neue Wand 24").ok, true);
  assert.equal(f.aus("bestaetigen", {}).ok, true);
  const wandSchritt = f.speicher.verlauf()[0];
  f.punkte = [{ x: 3, z: 0, level: 0 }];
  assert.equal(f.satz("Tür 1,01").ok, true);
  assert.equal(f.aus("bestaetigen", {}).ok, true);
  const r = f.aus("rueckgaengig", { vorschlag_id: wandSchritt.vorschlag_id });
  assert.equal(r.ok, false);
  assert.match(r.error, /steht inzwischen eine Öffnung/);
  // newest first: the door, then the wall
  assert.equal(f.aus("rueckgaengig", {}).ok, true);
  assert.equal(f.aus("rueckgaengig", {}).ok, true);
  assert.equal(f.modell.customWalls.length, 0);
});

test("Rückgängig verweigert, wenn das angelegte Element danach verändert wurde", () => {
  const f = flaeche({}, { punkte: [{ x: 0, z: 0 }, { x: 4, z: 0 }] });
  f.satz("neue Wand 24");
  f.aus("bestaetigen", {});
  const e = f.speicher.verlauf()[0];
  const bewegt = { ...f.modell, customWalls: [{ ...f.modell.customWalls[0], b: { x: 5, z: 0 } }] };
  assert.throws(() => aenderungUmkehren(bewegt, e, { projektId: P }), /danach noch verändert/);
});

test("Raum 9.01 heißt jetzt Lager: Vorschlag auf den Namen, Bestätigen benennt um (Nummer bleibt), Rückgängig zurück", () => {
  const z = raum(3, "9.01 Testraum", 0, 0, 4, 4);
  const f = flaeche({ customZones: [z] });
  const r = f.satz("Raum 9.01 heißt jetzt Lager");
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.result.ergebnis.art, "eigenschaft");
  assert.match(r.result.ergebnis.satz, /Name 9\.01 Testraum → 9\.01 Lager/);
  assert.equal(f.aus("bestaetigen", {}).ok, true);
  assert.equal(f.modell.customZones[0].name, "9.01 Lager");
  assert.equal(f.aus("rueckgaengig", {}).ok, true);
  assert.equal(f.modell.customZones[0].name, "9.01 Testraum");
  const unbekannt = f.satz("Raum 9.99 heißt Lager");
  assert.equal(unbekannt.ok, false);
  assert.match(unbekannt.error, /Raum 9\.99 gibt es im Modell nicht/);
});

test("dieser Raum heißt Lager: der gewählte Raum wird umbenannt", () => {
  const z = raum(3, "Testraum", 0, 0, 4, 4);
  const f = flaeche({ customZones: [z] }, { auswahl: [{ guid: bauteilGuid(P, "customZones", z), klasse: "IfcSpace", name: "Testraum" }] });
  const r = f.satz("dieser Raum heißt Lager");
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(f.aus("bestaetigen", {}).ok, true);
  assert.equal(f.modell.customZones[0].name, "Lager");
});

test("Wand abbrechen / Tür ausbauen laufen über die bestehende Eigenschaftsänderung (Status Abbruch)", () => {
  const w = wand(1, 0, 6, { status: "bestand" });
  const tuer = { wallIdx: 1, u: 3, kind: "door", typeId: "single", width: 1, _idx: 2, status: "bestand" };
  const f = flaeche({ customWalls: [w], customWindows: [tuer] }, { auswahl: [{ guid: bauteilGuid(P, "customWalls", w), klasse: "IfcWall", name: "Wand W-1" }] });
  const r = f.satz("Wand abbrechen");
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.result.ergebnis.art, "eigenschaft");
  assert.match(r.result.ergebnis.satz, /Status bestand → abbruch/);
  f.aus("verwerfen", {});
  f.auswahl = [{ guid: oeffnungGuid(P, tuer, false), klasse: "IfcDoor", name: "Tür 2" }];
  const t = f.satz("Tür ausbauen");
  assert.equal(t.ok, true, JSON.stringify(t));
  assert.equal(f.aus("bestaetigen", {}).ok, true);
  assert.equal(f.modell.customWindows[0].status, "abbruch");
});

test("Wand zwischen Raum 9.01 und 9.02 abbrechen: Vorschlag Status Abbruch an der Trennwand; ohne Wand verweigert", () => {
  const trenn = { a: { x: 4, z: 0 }, b: { x: 4, z: 4 }, level: 0, thickness: 0.115, _idx: 5 };
  const f = flaeche({ customZones: [raum(1, "9.01 Test", 0, 0, 4, 4), raum(2, "9.02 Test", 4, 0, 8, 4), raum(3, "9.03 Test", 0, 10, 4, 14)], customWalls: [trenn] });
  const r = f.satz("Wand zwischen Raum 9.01 und 9.02 abbrechen");
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(r.result.ergebnis.satz, /W-5.*Status .* → abbruch/);
  assert.equal(f.aus("bestaetigen", {}).ok, true);
  assert.equal(f.modell.customWalls[0].status, "abbruch");
  const nein = f.satz("Wand zwischen Raum 9.01 und 9.03 abbrechen");
  assert.equal(nein.ok, false);
  assert.match(nein.error, /keine gezeichnete Wand/);
});

test("Schnellknopf und Satz ergeben denselben Vorschlag (ein Weg: der Befehl „anlegen“)", () => {
  const punkte = [{ x: 0, z: 0, level: 0 }, { x: 4, z: 0, level: 0 }];
  const a = flaeche({}, { punkte });
  const b = flaeche({}, { punkte });
  const ausSatz = a.satz("neue Wand 24").result.ergebnis;
  const ausKnopf = b.aus("anlegen", { objekt: "wand", wandart: "wand", dicke_m: 0.24 }).result;
  assert.equal(ausSatz.satz, ausKnopf.satz);
  assert.deepEqual(a.speicher.offen()[0].params, b.speicher.offen()[0].params);
  assert.deepEqual(a.speicher.offen()[0].nachher.element, b.speicher.offen()[0].nachher.element);
});

test("Zeichenfunktion notizAnlegen: Text Pflicht, Länge begrenzt, Liste entsteht", () => {
  const m = { naechsteIdx: 3 };
  assert.equal(notizAnlegen(/** @type {any} */ (m), { punkt: { x: 1, z: 1 }, text: " " }).ok, false);
  assert.equal(notizAnlegen(/** @type {any} */ (m), { punkt: { x: 1, z: 1 }, text: "x".repeat(201) }).ok, false);
  const r = /** @type {any} */ (notizAnlegen(/** @type {any} */ (m), { punkt: { x: 1.23456, z: 2 }, level: 1, text: " Test " }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.modell.planNotizen, [{ x: 1.235, z: 2, level: 1, text: "Test", _idx: 3 }]);
  assert.equal(r.modell.naechsteIdx, 4);
});

// ---------------------------------------------------------------- follow-up fixes (review findings on PR #25)
test("Wand zwischen zwei Räumen: ein Raum ohne Umriss wird beim Namen genannt, nicht als „keine Wand“ gemeldet", () => {
  const trenn = { a: { x: 4, z: 0 }, b: { x: 4, z: 4 }, level: 0, thickness: 0.115, _idx: 5 };
  const leer = { name: "9.02 Test", level: 0, points: [], _idx: 2 };
  const m = { customZones: [raum(1, "9.01 Test", 0, 0, 4, 4), leer], customWalls: [trenn] };
  assert.match(/** @type {any} */ (wandZwischenRaeumen(m, "9.01", "9.02")).grund, /Raum 9\.02 hat keinen Umriss/);
  assert.match(/** @type {any} */ (wandZwischenRaeumen(m, "9.02", "9.01")).grund, /Raum 9\.02 hat keinen Umriss/);
});

test("Tür bauen: eine seit dem Vorschlag gezeichnete Öffnung an derselben Stelle lehnt die Tür ab", () => {
  const w = wand(1, 0, 6);
  const params = { objekt: "tuer", wandIdx: 1, u_m: 3, breite_m: 1.01, level: 0 };
  const frei = anlegenBauen({ customWalls: [w] }, params, { zeichnen: ZEICHNEN, projektId: P, naechsteIdx: 50 });
  assert.equal(frei.element.kind, "door");
  const belegt = { customWalls: [w], customWindows: [{ wallIdx: 1, u: 3.2, kind: "window", typeId: "single", width: 1.2, _idx: 9 }] };
  assert.throws(() => anlegenBauen(belegt, params, { zeichnen: ZEICHNEN, projektId: P, naechsteIdx: 50 }), /überschneidet Fenster 9/);
});

test("Änderungsliste: „neu angelegt“ hat einen englischen Text (aus abgleich-106, hier nicht doppelt)", async () => {
  const { EN } = await import("@core/lib/i18nTeile/abgleich-106.js");
  assert.equal(EN["neu angelegt"], "newly created");
});
