// 98-01: massing modeller core — many bodies, push/pull, move, copy with "*n" / "/n", groups by
// number (one change → all instances), make unique, typed input, closing lines into a face,
// golden-ratio suggestion, migration of the old single body.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PHI, leererLayer, ausEinzelkoerper, geometrie, koerperAnlegen, pushPull, verschieben, kopieren,
  gruppeBilden, gruppeAendern, eindeutigMachen, eingabeLesen, flaecheSchliessen, goldenerSchnittVorschlag,
} from "@core/lib/massing/massingModell.js";

const Q = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }];

test("Migration: alter Einzelkörper wird Körper 0 (Höhe = Geschosse × Geschosshöhe)", () => {
  const l = ausEinzelkoerper(Q, 4, 3);
  assert.equal(l.koerper.length, 1);
  assert.deepEqual(geometrie(l, l.koerper[0]), { profil: Q, hoehe: 12, basis: 0 });
  assert.deepEqual(ausEinzelkoerper(null, 4, 3), leererLayer());
});

test("Push/Pull ändert die Höhe, nie unter 1 cm", () => {
  let { layer, id } = koerperAnlegen(leererLayer(), Q, 3);
  layer = pushPull(layer, id, 2.5);
  assert.equal(geometrie(layer, layer.koerper[0]).hoehe, 5.5);
  layer = pushPull(layer, id, -100);
  assert.equal(geometrie(layer, layer.koerper[0]).hoehe, 0.01);
  assert.throws(() => koerperAnlegen(leererLayer(), Q.slice(0, 2), 3), /mindestens 3 Punkte/);
});

test("Kopieren: *3 = drei Kopien im selben Abstand, /3 = drei Kopien in den Abstand geteilt", () => {
  const { layer, id } = koerperAnlegen(leererLayer(), Q, 3);
  const mal = kopieren(layer, [id], { x: 6, y: 0 }, { anzahl: 3, modus: "mal" });
  assert.deepEqual(mal.layer.koerper.map((k) => k.pos.x), [0, 6, 12, 18]);
  const teilen = kopieren(layer, [id], { x: 6, y: 0 }, { anzahl: 3, modus: "teilen" });
  assert.deepEqual(teilen.layer.koerper.map((k) => k.pos.x), [0, 2, 4, 6]);
  assert.equal(new Set(teilen.layer.koerper.map((k) => k.id)).size, 4, "eindeutige ids");
  const v = verschieben(layer, [id], { x: 1, y: -2 });
  assert.deepEqual(geometrie(v, v.koerper[0]).profil[0], { x: 1, y: -2 });
});

test("Gruppen: gleiche Nummer ändert sich gemeinsam, andere Nummer nicht", () => {
  let { layer, id } = koerperAnlegen(leererLayer(), Q, 3);
  const k = kopieren(layer, [id], { x: 6, y: 0 }, { anzahl: 2 });
  let g = gruppeBilden(k.layer, [id, ...k.neu]);
  assert.equal(g.nr, "1");
  layer = g.layer;
  // A second, independent group.
  const b = koerperAnlegen(layer, Q, 9);
  const g2 = gruppeBilden(b.layer, [b.id]);
  assert.equal(g2.nr, "2");
  layer = pushPull(g2.layer, k.neu[1], 1); // edit ONE instance of group 1
  const hoehen = layer.koerper.map((x) => [x.gruppe, geometrie(layer, x).hoehe]);
  assert.deepEqual(hoehen, [["1", 4], ["1", 4], ["1", 4], ["2", 9]]);
  layer = gruppeAendern(layer, "1", { profil: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }] });
  assert.ok(layer.koerper.filter((x) => x.gruppe === "1").every((x) => geometrie(layer, x).profil.length === 3));
  assert.equal(geometrie(layer, layer.koerper[3]).profil.length, 4);
});

test("Eindeutig machen: neue Nummer, spätere Änderung trifft nur diese Instanz", () => {
  const a = koerperAnlegen(leererLayer(), Q, 3);
  const k = kopieren(a.layer, [a.id], { x: 6, y: 0 });
  let layer = gruppeBilden(k.layer, [a.id, k.neu[0]]).layer;
  const e = eindeutigMachen(layer, k.neu[0]);
  assert.equal(e.nr, "2");
  layer = pushPull(e.layer, k.neu[0], 5);
  assert.deepEqual(layer.koerper.map((x) => geometrie(layer, x).hoehe), [3, 8]);
  assert.equal(eindeutigMachen(a.layer, a.id).nr, null, "ohne Gruppe nichts zu tun");
});

test("Maßeingabe wie SketchUp: Länge, *n, /n, x;y", () => {
  assert.deepEqual(eingabeLesen("5,40"), { art: "laenge", wert: 5.4 });
  assert.deepEqual(eingabeLesen("540cm"), { art: "laenge", wert: 5.4 });
  assert.deepEqual(eingabeLesen("*3"), { art: "mal", n: 3 });
  assert.deepEqual(eingabeLesen("3x"), { art: "mal", n: 3 });
  assert.deepEqual(eingabeLesen("/4"), { art: "teilen", n: 4 });
  assert.deepEqual(eingabeLesen("4;3"), { art: "xy", x: 4, y: 3 });
  assert.equal(eingabeLesen("abc"), null);
  assert.equal(eingabeLesen(""), null);
});

test("Linien schließen sich zur Fläche; Goldener Schnitt als Vorschlag", () => {
  assert.deepEqual(flaecheSchliessen([...Q, { x: 0.1, y: 0.1 }]), Q);
  assert.equal(flaecheSchliessen([...Q, { x: 2, y: 2 }]), null, "nicht geschlossen");
  assert.equal(flaecheSchliessen([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 0 }]), null, "keine Fläche");
  const v = goldenerSchnittVorschlag({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 });
  assert.equal(v.verhaeltnis, "1 : φ");
  assert.ok(Math.abs(v.punkt.y - 10 / PHI) < 1e-6 && v.punkt.x === 10);
  assert.ok(goldenerSchnittVorschlag({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: -15 }).punkt.y < 0, "Seite des Cursors");
});
