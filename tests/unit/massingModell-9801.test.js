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

// 98-03/04: rotate, scale (group definition scales for all instances), follow-me.
import { drehen, skalieren, pfadUmriss, folgeMir, schwerpunkt } from "@core/lib/massing/massingModell.js";
test("Drehen um den Schwerpunkt: 90° vertauscht Breite und Tiefe, Fläche bleibt", () => {
  const { layer, id } = koerperAnlegen(leererLayer(), Q, 3);
  const z = schwerpunkt(layer, [id]);
  assert.deepEqual(z, { x: 2, y: 1.5 });
  const d = drehen(layer, [id], z, 90);
  const p = geometrie(d, d.koerper[0]).profil;
  const xs = p.map((q) => q.x), ys = p.map((q) => q.y);
  assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - 3) < 1e-6 && Math.abs(Math.max(...ys) - Math.min(...ys) - 4) < 1e-6);
  assert.equal(d.koerper[0].drehung, 90);
});
test("Skalieren: eigener Körper skaliert, Gruppe skaliert ihre Definition für alle Instanzen", () => {
  const a = koerperAnlegen(leererLayer(), Q, 3);
  const s = skalieren(a.layer, [a.id], { x: 0, y: 0 }, 2);
  assert.deepEqual(geometrie(s, s.koerper[0]).profil[2], { x: 8, y: 6 });
  const k = kopieren(a.layer, [a.id], { x: 10, y: 0 });
  const g = gruppeBilden(k.layer, [a.id, k.neu[0]]).layer;
  const s2 = skalieren(g, [a.id], schwerpunkt(g, [a.id]), 0.5);
  assert.deepEqual(s2.gruppen["1"].profil[2], { x: 2, y: 1.5 });
  assert.equal(geometrie(s2, s2.koerper[1]).profil[2].x - geometrie(s2, s2.koerper[1]).profil[0].x, 2, "andere Instanz mitgeändert");
  assert.throws(() => skalieren(g, [a.id], { x: 0, y: 0 }, 0), /größer als 0/);
});
test("Folge mir: Querschnitt entlang eines L-Pfads ergibt einen Körper mit richtiger Fläche", () => {
  const pfad = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 6 }];
  const u = pfadUmriss(pfad, 0.4);
  assert.equal(u.length, 6);
  let f = 0;
  for (let i = 0; i < u.length; i++) { const q = u[(i + 1) % u.length]; f += u[i].x * q.y - q.x * u[i].y; }
  assert.ok(Math.abs(Math.abs(f) / 2 - 0.4 * 16) < 1e-6, `Fläche ${Math.abs(f) / 2}`);
  const r = folgeMir(leererLayer(), pfad, 0.4, 2.5);
  assert.equal(geometrie(r.layer, r.layer.koerper[0]).hoehe, 2.5);
  assert.throws(() => pfadUmriss([{ x: 0, y: 0 }], 1), /mindestens 2 Punkte/);
});

// 98-05: editing a corner of a group instance changes the definition — all instances follow,
// also a rotated one; an own body changes alone.
import { eckeVerschieben } from "@core/lib/massing/massingModell.js";
test("Ecke ziehen: eigener Körper allein, Gruppeninstanz ändert alle (auch gedrehte)", () => {
  const a = koerperAnlegen(leererLayer(), Q, 3);
  const e = eckeVerschieben(a.layer, a.id, 2, { x: 6, y: 5 });
  assert.deepEqual(geometrie(e, e.koerper[0]).profil[2], { x: 6, y: 5 });
  const k = kopieren(a.layer, [a.id], { x: 20, y: 0 });
  let g = gruppeBilden(k.layer, [a.id, k.neu[0]]).layer;
  g = drehen(g, [k.neu[0]], schwerpunkt(g, [k.neu[0]]), 90);
  const ziel = { x: 5, y: 4 };
  const n = eckeVerschieben(g, a.id, 2, ziel);
  assert.deepEqual(n.gruppen["1"].profil[2], { x: 5, y: 4 });
  const p2 = geometrie(n, n.koerper[1]).profil;
  const breite = Math.max(...p2.map((p) => p.y)) - Math.min(...p2.map((p) => p.y));
  assert.ok(Math.abs(breite - 5) < 1e-6, "gedrehte Instanz: neue Breite 5 m quer");
  const r = koerperAnlegen(leererLayer(), Q, 3);
  const g2 = gruppeBilden(r.layer, [r.id]).layer;
  const versetzt = verschieben(g2, [r.id], { x: 10, y: 10 });
  const n2 = eckeVerschieben(versetzt, r.id, 0, { x: 9, y: 9 });
  assert.deepEqual(n2.gruppen["1"].profil[0], { x: -1, y: -1 }, "in Gruppenkoordinaten");
});

// 98-03: Ctrl + push/pull stacks a new body on top instead of stretching.
import { aufstocken } from "@core/lib/massing/massingModell.js";
test("Aufstocken: neuer Körper mit gleichem Umriss auf der Oberkante, Quelle unverändert", () => {
  const { layer, id } = koerperAnlegen(leererLayer(), Q, 9);
  const r = aufstocken(layer, id, 3);
  assert.equal(r.layer.koerper.length, 2);
  const neu = geometrie(r.layer, r.layer.koerper[1]);
  assert.deepEqual([neu.basis, neu.hoehe], [9, 3]);
  assert.deepEqual(neu.profil, Q);
  assert.equal(geometrie(r.layer, r.layer.koerper[0]).hoehe, 9);
  assert.equal(aufstocken(layer, id, 0).id, null);
});
