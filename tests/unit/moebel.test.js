// Unit-Tests für packages/nova-designer/src/lib/moebel.js (Möbelkatalog + Geometrie).
//
// Quelle der Erwartungswerte: die Lib selbst (Katalogmaße als [ASSUMED]-Richtwerte) und
// HANDOFF KD-14 — `kollidiert()` war implementiert, aber nie aufgerufen; inzwischen gibt
// es `kollisionsWarnungen()`. Diese Suite sichert die Geometrie (Rotation, AABB,
// Bewegungsfläche ASR A1.2, Point-in-Polygon) und die „nie fail"-Invariante.
//
// Koordinaten in Metern; x/y = Mittelpunkt eines Items, y entspricht points[].z der Zone.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  MOEBEL_KATALOG,
  BEWEGUNG_TIEFE,
  moebelById,
  itemAusdehnung,
  itemRect,
  bewegungsflaecheRect,
  kollidiert,
  kollisionsWarnungen,
  punktImPolygon,
  imRaum,
  moebelChecks,
  MOEBEL_RASTER,
  snapRaster,
  verschiebeItem,
  EIGENE_GRUPPE,
  MOEBEL_KATEGORIEN,
  setzeEigeneTypen,
  eigeneTypen,
  katalogMitEigenen,
  neuerEigenerTyp,
  typInBenutzung,
  legacyRoomKey,
  zoneKey,
  moebelFuerZone,
  mitMoebelFuerZone,
  migriereMoeblierung,
  verwaisteKeys,
} from "@designer/lib/moebel";
import { roomKey } from "@designer/lib/asr";

// 6 × 4 m Raum, Ursprung links oben (Zone-Points führen x/z).
const RAUM = [{ x: 0, z: 0 }, { x: 6, z: 0 }, { x: 6, z: 4 }, { x: 0, z: 4 }];
const tisch = (over = {}) => ({ id: "a", typ: "schreibtisch", x: 2, y: 1, rot: 0, ...over });

describe("moebel.js — Katalog", () => {
  it("5 Gruppen mit insgesamt 15 Typen (4/2/3/3/3)", () => {
    assert.equal(MOEBEL_KATALOG.length, 5);
    assert.deepEqual(MOEBEL_KATALOG.map((g) => g.gruppe), ["Arbeitsplatz", "Besprechung", "Schränke / Lager", "Sanitär", "Sozial"]);
    assert.deepEqual(MOEBEL_KATALOG.map((g) => g.typen.length), [4, 2, 3, 3, 3]);
    assert.equal(MOEBEL_KATALOG.flatMap((g) => g.typen).length, 15);
  });

  it("jeder Typ hat eindeutige id, positive Maße, Kategorie und benutzerseite-Flag", () => {
    const ids = new Set();
    for (const t of MOEBEL_KATALOG.flatMap((g) => g.typen)) {
      assert.ok(!ids.has(t.id), `doppelte id: ${t.id}`);
      ids.add(t.id);
      assert.ok(t.b > 0 && t.t > 0, `${t.id}: Maße ${t.b} × ${t.t}`);
      assert.ok(["desk", "chair", "furn", "sanitaer"].includes(t.kategorie), `${t.id}: Kategorie ${t.kategorie}`);
      assert.equal(typeof t.benutzerseite, "boolean", `${t.id}: benutzerseite`);
      assert.ok(t.name, `${t.id}: kein Name`);
    }
  });

  it("Schreibtisch 1,60 × 0,80 m mit Benutzerseite; Bürostuhl 0,50 × 0,50 m ohne", () => {
    assert.deepEqual(
      { b: moebelById("schreibtisch").b, t: moebelById("schreibtisch").t, u: moebelById("schreibtisch").benutzerseite },
      { b: 1.6, t: 0.8, u: true },
    );
    assert.equal(moebelById("buerostuhl").benutzerseite, false);
  });

  it("Bewegungstiefe ist 1,00 m (ASR A1.2)", () => {
    assert.equal(BEWEGUNG_TIEFE, 1.0);
  });

  it("moebelById(): unbekannte/leere id ⇒ null (kein Fantasie-Typ)", () => {
    assert.equal(moebelById("gibtsnicht"), null);
    assert.equal(moebelById(undefined), null);
    assert.equal(moebelById(null), null);
    assert.equal(moebelById(""), null);
  });
});

describe("moebel.js — itemAusdehnung() / itemRect() (Rotation)", () => {
  it("rot 0 und 180: w = b, h = t", () => {
    assert.deepEqual(itemAusdehnung(tisch({ rot: 0 })), { w: 1.6, h: 0.8 });
    assert.deepEqual(itemAusdehnung(tisch({ rot: 180 })), { w: 1.6, h: 0.8 });
  });

  it("rot 90 und 270 tauschen b und t", () => {
    assert.deepEqual(itemAusdehnung(tisch({ rot: 90 })), { w: 0.8, h: 1.6 });
    assert.deepEqual(itemAusdehnung(tisch({ rot: 270 })), { w: 0.8, h: 1.6 });
  });

  it("unbekannte Rotation verhält sich wie rot 0", () => {
    assert.deepEqual(itemAusdehnung(tisch({ rot: 45 })), itemAusdehnung(tisch({ rot: 0 })));
    assert.deepEqual(itemAusdehnung(tisch({ rot: undefined })), itemAusdehnung(tisch({ rot: 0 })));
  });

  it("itemRect() zentriert um x/y: Schreibtisch bei (2, 1) ⇒ x 1,2 / y 0,6", () => {
    assert.deepEqual(itemRect(tisch()), { x: 1.2, y: 0.6, w: 1.6, h: 0.8 });
  });

  it("Härtung: unbekannter Typ ⇒ Ausdehnung 0, Rechteck bleibt endlich", () => {
    assert.deepEqual(itemAusdehnung({ typ: "gibtsnicht", rot: 0 }), { w: 0, h: 0 });
    const r = itemRect({ typ: "gibtsnicht", x: 2, y: 1, rot: 0 });
    assert.deepEqual(r, { x: 2, y: 1, w: 0, h: 0 });
    for (const v of Object.values(r)) assert.ok(Number.isFinite(v));
  });

  it("Härtung: fehlende Koordinaten liefern NaN-freie Maße (w/h bleiben definiert)", () => {
    const r = itemRect({ typ: "schreibtisch" });
    assert.equal(r.w, 1.6);
    assert.equal(r.h, 0.8);
  });
});

describe("moebel.js — bewegungsflaecheRect() (ASR A1.2)", () => {
  it("rot 0: Band liegt unten (+y), 1,00 m tief über die volle Breite", () => {
    assert.deepEqual(bewegungsflaecheRect(tisch({ rot: 0 })), { x: 1.2, y: 1.4, w: 1.6, h: 1 });
  });

  it("rot 180: Band liegt oben (−y)", () => {
    assert.deepEqual(bewegungsflaecheRect(tisch({ rot: 180 })), { x: 1.2, y: -0.4, w: 1.6, h: 1 });
  });

  it("rot 90: Band liegt links (−x); rot 270: rechts (+x)", () => {
    // rot 90 ⇒ Ausdehnung 0,8 × 1,6 ⇒ Rechteck x 1,6 … 2,4 / y 0,2 … 1,8
    const links = bewegungsflaecheRect(tisch({ rot: 90 }));
    assert.ok(Math.abs(links.x - 0.6) < 1e-9, `x ${links.x}`);
    assert.ok(Math.abs(links.y - 0.2) < 1e-9, `y ${links.y}`);
    assert.equal(links.w, 1);
    assert.ok(Math.abs(links.h - 1.6) < 1e-9, `h ${links.h}`);

    const rechts = bewegungsflaecheRect(tisch({ rot: 270 }));
    assert.ok(Math.abs(rechts.x - 2.4) < 1e-9, `x ${rechts.x}`);
    assert.equal(rechts.w, 1);
    // beide Bänder liegen auf gegenüberliegenden Seiten des Items
    assert.ok(links.x < itemRect(tisch({ rot: 90 })).x);
    assert.ok(rechts.x >= itemRect(tisch({ rot: 270 })).x);
  });

  it("Typen ohne Benutzerseite haben kein Band ⇒ null", () => {
    assert.equal(bewegungsflaecheRect({ id: "s", typ: "buerostuhl", x: 2, y: 1, rot: 0 }), null);
    assert.equal(bewegungsflaecheRect({ id: "u", typ: "urinal", x: 2, y: 1, rot: 0 }), null);
  });

  it("Härtung: unbekannter Typ ⇒ null (kein 0-Band)", () => {
    assert.equal(bewegungsflaecheRect({ id: "x", typ: "gibtsnicht", x: 0, y: 0, rot: 0 }), null);
    assert.equal(bewegungsflaecheRect({}), null);
  });

  it("das Band grenzt lückenlos an das Item an (keine Überlappung, kein Spalt)", () => {
    const item = tisch({ rot: 0 });
    const r = itemRect(item);
    const band = bewegungsflaecheRect(item);
    assert.equal(band.y, r.y + r.h);
    assert.equal(band.x, r.x);
    assert.equal(band.w, r.w);
  });
});

describe("moebel.js — KD-14: kollidiert() / kollisionsWarnungen()", () => {
  it("zwei überlappende Schreibtische kollidieren", () => {
    const a = tisch({ id: "a", x: 2, y: 1 });
    const b = tisch({ id: "b", x: 2.5, y: 1 });
    assert.equal(kollidiert(a, b), true);
  });

  it("nebeneinanderstehende Möbel kollidieren nicht", () => {
    const a = tisch({ id: "a", x: 1, y: 1 });
    const b = tisch({ id: "b", x: 3, y: 1 });
    assert.equal(kollidiert(a, b), false);
  });

  it("Kante-an-Kante ist KEINE Kollision (strikte Ungleichung)", () => {
    const a = tisch({ id: "a", x: 1, y: 1 });         // x 0,2 … 1,8
    const b = tisch({ id: "b", x: 2.6, y: 1 });       // x 1,8 … 3,4
    assert.equal(kollidiert(a, b), false);
    const c = tisch({ id: "c", x: 2.59, y: 1 });
    assert.equal(kollidiert(a, c), true);
  });

  it("Rotation wirkt auf die Kollision", () => {
    const a = tisch({ id: "a", x: 2, y: 1, rot: 0 });   // 1,6 × 0,8
    const b = tisch({ id: "b", x: 2, y: 2, rot: 0 });   // y 1,6 … 2,4 vs. 0,6 … 1,4 ⇒ frei
    assert.equal(kollidiert(a, b), false);
    const bGedreht = tisch({ id: "b", x: 2, y: 2, rot: 90 }); // 0,8 × 1,6 ⇒ y 1,2 … 2,8 ⇒ überlappt
    assert.equal(kollidiert(a, bGedreht), true);
  });

  it("kollisionsWarnungen(): jedes Paar wird genau EINMAL gemeldet", () => {
    const items = [tisch({ id: "a", x: 2, y: 1 }), tisch({ id: "b", x: 2.2, y: 1 }), tisch({ id: "c", x: 2.4, y: 1 })];
    const w = kollisionsWarnungen(items);
    assert.equal(w.length, 3); // a-b, a-c, b-c
    const paare = w.map((x) => x.itemIds.join("-"));
    assert.deepEqual(paare, ["a-b", "a-c", "b-c"]);
  });

  it("kollisionsWarnungen(): nennt beide Beteiligten und ist immer \"warn\"", () => {
    const w = kollisionsWarnungen([tisch({ id: "a", x: 2, y: 1 }), tisch({ id: "b", x: 2.2, y: 1 })]);
    assert.equal(w.length, 1);
    assert.equal(w[0].status, "warn");
    assert.deepEqual(w[0].itemIds, ["a", "b"]);
    assert.equal(w[0].itemId, "a");
    assert.match(w[0].text, /überlappt/);
  });

  it("Härtung: leer/null/ein Item ⇒ keine Warnungen", () => {
    assert.deepEqual(kollisionsWarnungen([]), []);
    assert.deepEqual(kollisionsWarnungen(null), []);
    assert.deepEqual(kollisionsWarnungen(undefined), []);
    assert.deepEqual(kollisionsWarnungen([tisch()]), []);
  });

  it("Härtung: unbekannte Typen (Ausdehnung 0) kollidieren nicht", () => {
    const a = { id: "a", typ: "gibtsnicht", x: 2, y: 1, rot: 0 };
    const b = { id: "b", typ: "gibtsnicht", x: 2, y: 1, rot: 0 };
    assert.equal(kollidiert(a, b), false);
    assert.deepEqual(kollisionsWarnungen([a, b]), []);
  });
});

describe("moebel.js — punktImPolygon() / imRaum()", () => {
  it("Punkt in der Raummitte liegt drin, Punkt außerhalb nicht", () => {
    assert.equal(punktImPolygon(3, 2, RAUM), true);
    assert.equal(punktImPolygon(7, 2, RAUM), false);
    assert.equal(punktImPolygon(-1, 2, RAUM), false);
    assert.equal(punktImPolygon(3, 5, RAUM), false);
  });

  it("Härtung: null/undefined/< 3 Punkte ⇒ false", () => {
    assert.equal(punktImPolygon(3, 2, null), false);
    assert.equal(punktImPolygon(3, 2, undefined), false);
    assert.equal(punktImPolygon(3, 2, []), false);
    assert.equal(punktImPolygon(3, 2, [{ x: 0, z: 0 }, { x: 6, z: 0 }]), false);
  });

  it("imRaum(): Schreibtisch in der Mitte liegt vollständig im Raum", () => {
    assert.equal(imRaum(tisch({ x: 3, y: 2 }), RAUM), true);
  });

  it("imRaum(): am Rand ragt der Tisch heraus (alle 4 Ecken müssen drin liegen)", () => {
    assert.equal(imRaum(tisch({ x: 0.5, y: 2 }), RAUM), false);
    assert.equal(imRaum(tisch({ x: 5.8, y: 2 }), RAUM), false);
    assert.equal(imRaum(tisch({ x: 3, y: 0.2 }), RAUM), false);
  });

  it("Härtung: ohne Polygon ⇒ false", () => {
    assert.equal(imRaum(tisch(), null), false);
    assert.equal(imRaum(tisch(), []), false);
  });
});

describe("moebel.js — moebelChecks() Invarianten", () => {
  it("Möbel im Raum ohne Konflikte ⇒ keine Warnungen", () => {
    const items = [{ id: "a", typ: "schreibtisch", x: 1.5, y: 1, rot: 0 }];
    assert.deepEqual(moebelChecks(items, RAUM), []);
  });

  it("herausragendes Möbel ⇒ Warnung \"ragt aus dem Raum heraus\"", () => {
    const items = [{ id: "a", typ: "schreibtisch", x: 5.8, y: 2, rot: 0 }];
    const w = moebelChecks(items, RAUM);
    assert.equal(w.length, 1);
    assert.equal(w[0].status, "warn");
    assert.equal(w[0].itemId, "a");
    assert.match(w[0].text, /ragt aus dem Raum heraus/);
  });

  it("Möbel in fremder Bewegungsfläche ⇒ Warnung mit ASR-A1.2-Bezug", () => {
    // Schreibtisch rot 0 bei (2, 1): Band y 1,4 … 2,4 über x 1,2 … 2,8
    const items = [
      { id: "tisch", typ: "schreibtisch", x: 2, y: 1, rot: 0 },
      { id: "schrank", typ: "aktenschrank", x: 2, y: 1.9, rot: 0 },
    ];
    const w = moebelChecks(items, RAUM);
    const band = w.filter((x) => /Bewegungsfläche/.test(x.text));
    assert.ok(band.length >= 1, "keine Bewegungsflächen-Warnung");
    assert.match(band[0].text, /1,00 m, ASR A1\.2/);
    assert.equal(band[0].status, "warn");
  });

  it("das eigene Band eines Möbels löst KEINE Warnung aus (a.id === b.id wird übersprungen)", () => {
    const items = [{ id: "a", typ: "schreibtisch", x: 3, y: 1.5, rot: 0 }];
    assert.deepEqual(moebelChecks(items, RAUM).filter((x) => /Bewegungsfläche/.test(x.text)), []);
  });

  it("INVARIANTE: moebelChecks liefert NIE Status \"fail\" — ausschließlich \"warn\"", () => {
    const varianten = [
      [[], RAUM],
      [[tisch()], RAUM],
      [[tisch({ x: 99, y: 99 })], RAUM],
      [[tisch({ id: "a" }), tisch({ id: "b" })], RAUM],
      [[{ id: "x", typ: "gibtsnicht", x: 0, y: 0, rot: 0 }], RAUM],
      [[tisch()], null],
      [null, RAUM],
      [undefined, undefined],
    ];
    for (const [items, polygon] of varianten) {
      const w = moebelChecks(items, polygon);
      assert.ok(Array.isArray(w));
      for (const x of w) {
        assert.equal(x.status, "warn", `unerwarteter Status ${x.status}`);
        assert.equal(typeof x.text, "string");
        assert.ok(!/NaN|Infinity|undefined/.test(x.text), `Platzhalter im Text: ${x.text}`);
      }
    }
  });

  it("Härtung: ohne Polygon wird die Raum-Prüfung übersprungen (kein Falsch-warn)", () => {
    const items = [{ id: "a", typ: "schreibtisch", x: 99, y: 99, rot: 0 }];
    assert.deepEqual(moebelChecks(items, null), []);
    assert.deepEqual(moebelChecks(items, [{ x: 0, z: 0 }, { x: 1, z: 1 }]), []);
  });

  it("Härtung: unbekannter Typ nutzt die typId als Anzeigename statt \"undefined\"", () => {
    const items = [
      { id: "a", typ: "gibtsnicht", x: 3, y: 2, rot: 0 },
      { id: "b", typ: "schreibtisch", x: 3, y: 2, rot: 0 },
    ];
    for (const w of [...moebelChecks(items, RAUM), ...kollisionsWarnungen(items)]) {
      assert.ok(!/undefined/.test(w.text), `undefined im Text: ${w.text}`);
    }
  });
});

// ---- Phase 43 (MOEBEL-01): Drag-Raster ---------------------------------------------------
describe("moebel.js — Drag-Raster (Phase 43)", () => {
  it("MOEBEL_RASTER ist 5 cm; snapRaster rastet und rundet auf 2 Nachkommastellen", () => {
    assert.equal(MOEBEL_RASTER, 0.05);
    assert.equal(snapRaster(1.234), 1.25);
    assert.equal(snapRaster(1.224), 1.2);
    assert.equal(snapRaster(-0.026), -0.05);
    assert.equal(snapRaster(0.1 + 0.2), 0.3); // kein 0.30000000000000004
    assert.equal(snapRaster(1.23, 0.1), 1.2);
    assert.equal(snapRaster(1.23, 0), 1.25); // ungültiges Raster → Default
  });

  it("verschiebeItem liefert eine gerasterte Kopie und lässt das Original unberührt", () => {
    const it0 = tisch({ x: 2, y: 1 });
    const it1 = verschiebeItem(it0, 2.333, 1.777);
    assert.deepEqual([it1.x, it1.y], [2.35, 1.8]);
    assert.deepEqual([it0.x, it0.y], [2, 1]);
    assert.equal(it1.id, it0.id);
    assert.equal(it1.typ, it0.typ);
    assert.equal(it1.rot, it0.rot);
  });
});

// ---- Phase 43 (MOEBEL-04): Raumschlüssel, Migration, Verwaiste -----------------------------
describe("moebel.js — Raumschlüssel (Phase 43)", () => {
  const mitId = { id: 7, level: 0, name: "Büro" };
  const ohneId = { level: 0, name: "Flur 0 ·WT" };

  it("zoneKey: id:<n> für Zonen mit id, sonst level:name — identisch zu asr.roomKey", () => {
    assert.equal(zoneKey(mitId), "id:7");
    assert.equal(zoneKey({ ...mitId, id: "abc" }), "id:abc");
    assert.equal(zoneKey(ohneId), "0:Flur 0 ·WT");
    assert.equal(zoneKey(ohneId), roomKey(ohneId));
    assert.equal(legacyRoomKey(mitId), roomKey(mitId));
    assert.equal(zoneKey({ id: null, level: 2, name: "X" }), "2:X");
    assert.equal(zoneKey({ id: "", level: 2, name: "X" }), "2:X");
    assert.equal(zoneKey(null), roomKey(null));
  });

  it("moebelFuerZone: id-Schlüssel vor Legacy, Legacy als Fallback, sonst []", () => {
    const a = [tisch({ id: "a" })], b = [tisch({ id: "b" })];
    assert.deepEqual(moebelFuerZone({ "id:7": a, "0:Büro": b }, mitId), a);
    assert.deepEqual(moebelFuerZone({ "0:Büro": b }, mitId), b);
    assert.deepEqual(moebelFuerZone({ "0:Flur 0 ·WT": a }, ohneId), a);
    assert.deepEqual(moebelFuerZone({}, mitId), []);
    assert.deepEqual(moebelFuerZone(null, mitId), []);
  });

  it("mitMoebelFuerZone schreibt unter zoneKey und räumt den Legacy-Eintrag derselben Zone weg", () => {
    const out = mitMoebelFuerZone({ "0:Büro": [tisch()], "0:Anderer": [tisch({ id: "z" })] }, mitId, [tisch({ id: "n" })]);
    assert.deepEqual(Object.keys(out).sort(), ["0:Anderer", "id:7"]);
    assert.equal(out["id:7"][0].id, "n");
    const ohne = mitMoebelFuerZone({}, ohneId, [tisch()]);
    assert.deepEqual(Object.keys(ohne), ["0:Flur 0 ·WT"]);
  });

  it("migriereMoeblierung hebt Legacy → id, ist idempotent, lässt ·WT und Fremdes stehen", () => {
    const start = { "0:Büro": [tisch({ id: "a" })], "0:Flur 0 ·WT": [tisch({ id: "w" })], "3:Weg": [tisch({ id: "f" })] };
    const r1 = migriereMoeblierung(start, [mitId, ohneId]);
    assert.equal(r1.verschoben, 1);
    assert.deepEqual(Object.keys(r1.moeblierung).sort(), ["0:Flur 0 ·WT", "3:Weg", "id:7"]);
    assert.equal(r1.moeblierung["id:7"][0].id, "a");
    assert.equal(start["0:Büro"][0].id, "a", "Eingabe unverändert");
    const r2 = migriereMoeblierung(r1.moeblierung, [mitId, ohneId]);
    assert.equal(r2.verschoben, 0);
    assert.equal(r2.moeblierung, r1.moeblierung, "ohne Änderung dieselbe Referenz");
  });

  it("migriereMoeblierung überschreibt keinen vorhandenen id-Eintrag", () => {
    const r = migriereMoeblierung({ "0:Büro": [tisch({ id: "alt" })], "id:7": [tisch({ id: "neu" })] }, [mitId]);
    assert.equal(r.verschoben, 0);
    assert.equal(r.moeblierung["id:7"][0].id, "neu");
    assert.ok(r.moeblierung["0:Büro"], "Legacy bleibt liegen (als verwaist sichtbar, sobald keine Zone mehr passt)");
  });

  it("verwaisteKeys: Schlüssel ohne passende Zone, leere Listen zählen nicht", () => {
    const m = { "id:7": [tisch()], "0:Flur 0 ·WT": [tisch()], "1:Gelöscht": [tisch()], "id:99": [tisch()], "0:Leer": [] };
    assert.deepEqual(verwaisteKeys(m, [mitId, ohneId]).sort(), ["1:Gelöscht", "id:99"]);
    assert.deepEqual(verwaisteKeys(m, []).sort(), ["0:Flur 0 ·WT", "1:Gelöscht", "id:7", "id:99"]);
    assert.deepEqual(verwaisteKeys(null, [mitId]), []);
  });
});

describe("moebel.js — eigene Typen (Phase 43)", () => {
  const eigen = { id: "eigen-sideboard", name: "Sideboard", b: 1.8, t: 0.45, kategorie: "furn", benutzerseite: true };

  it("Register: setzen, lesen, moebelById findet eigene Typen, Reset leert", () => {
    setzeEigeneTypen([eigen]);
    assert.deepEqual(eigeneTypen(), [eigen]);
    assert.equal(moebelById("eigen-sideboard"), eigen);
    assert.equal(moebelById("schreibtisch").name, "Schreibtisch", "Katalog hat Vorrang und bleibt");
    assert.deepEqual(itemAusdehnung({ typ: "eigen-sideboard", rot: 90 }), { w: 0.45, h: 1.8 });
    assert.ok(bewegungsflaecheRect({ typ: "eigen-sideboard", x: 0, y: 0, rot: 0 }));
    setzeEigeneTypen([]);
    assert.equal(moebelById("eigen-sideboard"), null);
    assert.deepEqual(itemAusdehnung({ typ: "eigen-sideboard", rot: 0 }), { w: 0, h: 0 });
  });

  it("katalogMitEigenen hängt die Gruppe „Eigene“ nur an, wenn es eigene Typen gibt", () => {
    assert.equal(katalogMitEigenen([]), MOEBEL_KATALOG);
    const k = katalogMitEigenen([eigen]);
    assert.equal(k.length, MOEBEL_KATALOG.length + 1);
    assert.equal(k[k.length - 1].gruppe, EIGENE_GRUPPE);
    assert.deepEqual(k[k.length - 1].typen, [eigen]);
    setzeEigeneTypen([eigen]);
    assert.equal(katalogMitEigenen().length, MOEBEL_KATALOG.length + 1, "Default = Register");
    setzeEigeneTypen([]);
  });

  it("neuerEigenerTyp: Validierung im Klartext, Id aus dem Namen, eindeutig, Kategorie-Fallback", () => {
    assert.deepEqual(neuerEigenerTyp({ name: "", b: 1, t: 1 }), { ok: false, fehler: "Name fehlt." });
    assert.equal(neuerEigenerTyp({ name: "X", b: 0, t: 1 }).ok, false);
    assert.equal(neuerEigenerTyp({ name: "X", b: "abc", t: 1 }).ok, false);
    assert.equal(neuerEigenerTyp({ name: "X", b: 25, t: 1 }).ok, false);
    const r = neuerEigenerTyp({ name: " Sideboard Bauherr ", b: "1.8", t: 0.451, kategorie: "quatsch", benutzerseite: 1 });
    assert.equal(r.ok, true);
    assert.deepEqual(r.typ, { id: "eigen-sideboard-bauherr", name: "Sideboard Bauherr", b: 1.8, t: 0.45, kategorie: "furn", benutzerseite: true });
    const r2 = neuerEigenerTyp({ name: "Sideboard Bauherr", b: 1, t: 1 }, [r.typ]);
    assert.equal(r2.typ.id, "eigen-sideboard-bauherr-2");
    assert.equal(neuerEigenerTyp({ name: "Schreibtisch", b: 1, t: 1 }).typ.id, "eigen-schreibtisch", "Präfix trennt von Katalog-Ids");
    assert.equal(neuerEigenerTyp({ name: "Küchenzeile groß", b: 1, t: 1, kategorie: "desk" }).typ.id, "eigen-kuchenzeile-gross");
    assert.ok(MOEBEL_KATEGORIEN.includes("sanitaer"));
  });

  it("typInBenutzung findet den Typ in irgendeinem Raum", () => {
    const m = { "id:7": [tisch({ typ: "eigen-sideboard" })], "0:Flur": [tisch()] };
    assert.equal(typInBenutzung(m, "eigen-sideboard"), true);
    assert.equal(typInBenutzung(m, "regal"), false);
    assert.equal(typInBenutzung(null, "regal"), false);
  });
});
