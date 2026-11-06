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

test("107-05 Bestand: ein v1-Layer liest sich unverändert, gespeicherte Punkte werden nie umgeschrieben", () => {
  // a body saved before 107-05 in the click order that is now the "reversed" one (negative area), plus a group
  const alt = {
    koerper: [
      { id: "k1", name: "", profil: [{ x: 0, y: 0 }, { x: 0, y: 3 }, { x: 4, y: 3 }, { x: 4, y: 0 }], hoehe: 3, basis: 0, pos: { x: 0, y: 0 }, drehung: 0, gruppe: null },
      { id: "k2", name: "", basis: 0, pos: { x: 10, y: 0 }, drehung: 0, gruppe: "1" },
    ],
    gruppen: { "1": { profil: Q, hoehe: 6 } }, naechsteId: 3,
  };
  const json = JSON.stringify(alt);
  assert.deepEqual(geometrie(alt, alt.koerper[1]), { profil: Q.map((p) => ({ x: p.x + 10, y: p.y })), hoehe: 6, basis: 0 });
  const g = geometrie(alt, alt.koerper[0]);
  assert.deepEqual(new Set(g.profil.map((p) => `${p.x},${p.y}`)), new Set(Q.map((p) => `${p.x},${p.y}`)), "dieselben Ecken");
  const v = verschieben(alt, ["k1"], { x: 1, y: 0 });
  assert.deepEqual(v.koerper[0].profil, alt.koerper[0].profil, "Verschieben schreibt das Profil nicht um");
  assert.equal(JSON.stringify(alt), json, "Lesen mutiert nichts");
});

// 107-07: Rotate + Copy as an array, the same typed "*n" / "/n" as Move (shared core reihenFaktoren)
import { drehKopien } from "@core/lib/massing/massingModell.js";

test("107-07 Drehen mit Kopie: *3 = drei Kopien zu 90°, 180°, 270°; /3 = drei Kopien zu 30°, 60°, 90°; Original bleibt", () => {
  const { layer, id } = koerperAnlegen(leererLayer(), Q, 3);
  const um = { x: 0, y: 10 };
  const mal = drehKopien(layer, [id], um, 90, { anzahl: 3, modus: "mal" });
  assert.equal(mal.layer.koerper.length, 4);
  assert.deepEqual(mal.neu, ["k2", "k3", "k4"]);
  assert.deepEqual(mal.layer.koerper[0], layer.koerper[0], "Original unverändert");
  assert.deepEqual(mal.layer.koerper.slice(1).map((k) => k.drehung), [90, 180, 270]);
  // position (0, 0) turned about (0, 10): 90° → (10, 10), 180° → (0, 20), 270° → (−10, 10) (mathematical sense in x/y)
  assert.deepEqual(mal.layer.koerper.slice(1).map((k) => [k.pos.x + 0, k.pos.y + 0]), [[10, 10], [0, 20], [-10, 10]]);
  const teilen = drehKopien(layer, [id], um, 90, { anzahl: 3, modus: "teilen" });
  assert.deepEqual(teilen.layer.koerper.slice(1).map((k) => k.drehung), [30, 60, 90]);
  // the area stays (copies are congruent)
  const fl = (/** @type {any} */ l, /** @type {any} */ k) => { const p = geometrie(l, k).profil; let f = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; f += p[i].x * q.y - q.x * p[i].y; } return Math.abs(f) / 2; };
  for (const k of teilen.layer.koerper) assert.ok(Math.abs(fl(teilen.layer, k) - 12) < 1e-6);
  // drehen with {kopie: true} is the same as drehKopien(...).layer; without it nothing is copied
  assert.deepEqual(drehen(layer, [id], um, 90, { kopie: true, anzahl: 3 }), mal.layer);
  assert.equal(drehen(layer, [id], um, 90).koerper.length, 1);
});

test("107-07 Drehen mit Kopie: Gruppeninstanzen bleiben Instanzen ihrer Nummer", () => {
  let { layer, id } = koerperAnlegen(leererLayer(), Q, 3);
  layer = gruppeBilden(layer, [id]).layer;
  const r = drehKopien(layer, [id], { x: 0, y: 0 }, 45, { anzahl: 2 });
  assert.deepEqual(r.layer.koerper.map((k) => k.gruppe), ["1", "1", "1"]);
  assert.equal("profil" in r.layer.koerper[1], false, "Instanz ohne eigenes Profil");
});

// 107-08 (review: the plan named this file for the extension): instance fields on top of the 98-01 core — a group instance keeps its
// own mirror/scale while the definition stays shared, and a copy row never carries the stored guid of its source.
test("107-08: Gruppen-Instanz mit Spiegel und Maßstab; *3-Kopie ohne gespeicherte guid", async () => {
  const { spiegeln, skalieren, instanzNeutral } = await import("@core/lib/massing/massingModell.js");
  let { layer, id } = koerperAnlegen(leererLayer(), Q, 3);
  layer = gruppeBilden(layer, [id]).layer;
  layer = kopieren(layer, [id], { x: 10, y: 0 }, { anzahl: 1 }).layer;
  const [k1, k2] = layer.koerper;
  // stretch only the copy (instance scale 2 about its own corner): the definition (4 × 3 m) and the first instance stay
  layer = skalieren(layer, [k2.id], { x: 10, y: 0 }, 2, { instanz: true });
  layer = spiegeln(layer, [k2.id]);
  assert.deepEqual(geometrie(layer, layer.koerper[0]), geometrie({ ...layer, koerper: [k1] }, k1));
  const g2 = geometrie(layer, layer.koerper[1]);
  const xs = g2.profil.map((p) => p.x), ys = g2.profil.map((p) => p.y);
  assert.deepEqual([Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), g2.hoehe], [8, 6, 3]); // 4 × 2, 3 × 2, z 1
  assert.equal(instanzNeutral(layer.koerper[0]), true);
  assert.equal(instanzNeutral(layer.koerper[1]), false);
  // a body with a stored guid copied *3: the copies have no guid field at all
  const mitGuid = { ...layer, koerper: layer.koerper.map((k, i) => (i === 0 ? { ...k, guid: "0123456789abcdefABCDEF" } : k)) };
  const r = kopieren(mitGuid, [k1.id], { x: 0, y: 10 }, { anzahl: 3 }).layer;
  assert.equal(r.koerper.length, 5);
  assert.deepEqual(r.koerper.slice(2).map((k) => "guid" in k), [false, false, false]);
  assert.equal(r.koerper[0].guid, "0123456789abcdefABCDEF");
});
