import test from "node:test";
import assert from "node:assert/strict";
import {
  rasterAusDreiecken, groessteFlaeche, umriss, vereinfachen, polygonFlaeche,
  zentrieren, grundrissAusModell, UMRISS_KLASSEN, DECKEN_KLASSEN, geschosseAusModell,
} from "@ifc/lib/grundriss";

// Ein achsparalleles Rechteck in der XZ-Ebene als zwei Dreiecke.
const rechteck = (x0, z0, x1, z1) => [
  [[x0, z0], [x1, z0], [x1, z1]],
  [[x0, z0], [x1, z1], [x0, z1]],
];

test("rasterAusDreiecken — belegt die Fläche eines Rechtecks korrekt", () => {
  const r = rasterAusDreiecken(rechteck(0, 0, 10, 6), 0.5);
  const belegt = r.grid.reduce((a, v) => a + v, 0);
  const flaeche = belegt * 0.25;
  // 60 m² Soll; Rasterung darf leicht abweichen, aber nicht um mehr als 10 %.
  assert.ok(Math.abs(flaeche - 60) / 60 < 0.1, `gerastert ${flaeche} m², erwartet ~60`);
});

test("rasterAusDreiecken — leere oder entartete Eingabe liefert null statt zu werfen", () => {
  assert.equal(rasterAusDreiecken([]), null);
  assert.equal(rasterAusDreiecken(null), null);
  assert.equal(rasterAusDreiecken([[[1, 1], [1, 1], [1, 1]]]), null, "Punkt ohne Ausdehnung");
});

test("groessteFlaeche — ein abgesetztes Nebengebäude fällt weg", () => {
  const r = rasterAusDreiecken([...rechteck(0, 0, 20, 10), ...rechteck(60, 0, 63, 3)], 0.5);
  const g = groessteFlaeche(r);
  const flaeche = g.zellen * 0.25;
  assert.ok(flaeche > 150 && flaeche < 230, `Hauptbau ~200 m², erhalten ${flaeche}`);
  assert.ok(flaeche < 250, "das 9-m²-Nebengebäude ist nicht mitgezählt");
});

test("polygonFlaeche + zentrieren — Fläche bleibt, Schwerpunkt liegt im Ursprung", () => {
  const p = [{ x: 100, z: 50 }, { x: 120, z: 50 }, { x: 120, z: 60 }, { x: 100, z: 60 }];
  assert.equal(polygonFlaeche(p), 200);
  const z = zentrieren(p);
  assert.equal(polygonFlaeche(z), 200, "Zentrieren ändert die Fläche nicht");
  const cx = z.reduce((a, q) => a + q.x, 0) / z.length;
  assert.ok(Math.abs(cx) < 0.01, "x-Schwerpunkt im Ursprung");
});

test("vereinfachen — reduziert eine gerasterte Kante auf ihre Endpunkte", () => {
  const treppe = [];
  for (let i = 0; i <= 20; i++) treppe.push({ x: i * 0.5, z: 0 });
  const v = vereinfachen(treppe, 0.8);
  assert.ok(v.length <= 3, `21 Punkte auf einer Geraden => ${v.length} übrig`);
});

test("vereinfachen — behält eine echte Ecke", () => {
  const ecke = [{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 5 }, { x: 10, z: 10 }];
  const v = vereinfachen(ecke, 0.8);
  assert.ok(v.some((p) => p.x === 10 && p.z === 0), "die Ecke bei (10,0) überlebt");
});

test("umriss — ein Rechteck ergibt einen geschlossenen Rand in Metergröße", () => {
  const raster = rasterAusDreiecken(rechteck(0, 0, 20, 10), 0.5);
  const rand = umriss({ ...raster, grid: groessteFlaeche(raster).grid });
  assert.ok(rand.length > 8, "der Rand hat Punkte");
  const xs = rand.map((p) => p.x), zs = rand.map((p) => p.z);
  assert.ok(Math.max(...xs) - Math.min(...xs) > 18, "Breite ~20 m");
  assert.ok(Math.max(...zs) - Math.min(...zs) > 8, "Tiefe ~10 m");
});

// --- Ende-zu-Ende über ein synthetisches Modell -------------------------------------

const modellAus = (dreiecke, { klasse = "IfcWall", geschoss = "EG" } = {}) => {
  const positions = [];
  const index = [];
  for (const t of dreiecke) {
    for (const [x, z] of t) {
      index.push(positions.length / 3);
      positions.push(x, 0, z); // Y = 0, die Höhe entfällt bei der Projektion
    }
  }
  return {
    elements: [{ expressId: 1, ifc_klasse: klasse, geschoss }],
    merged: {
      positions: Float32Array.from(positions),
      index,
      ranges: [{ eid: 1, start: 0, count: index.length }],
    },
  };
};

test("grundrissAusModell — Rechteckbau: Fläche stimmt, Polygon ist zentriert", () => {
  const r = grundrissAusModell(modellAus(rechteck(0, 0, 40, 26)));
  assert.ok(r, "Ergebnis vorhanden");
  // 1.040 m² Soll — Rasterung/Vereinfachung dürfen ein paar Prozent abweichen.
  assert.ok(Math.abs(r.flaeche - 1040) / 1040 < 0.1, `Fläche ${r.flaeche} m², erwartet ~1040`);
  assert.equal(r.hinweis, null, "kompakter Bau => kein Innenhof-Hinweis");
  const cx = r.polygon.reduce((a, p) => a + p.x, 0) / r.polygon.length;
  assert.ok(Math.abs(cx) < 1, "zentriert");
});

test("grundrissAusModell — L-Form wird NICHT zur Hülle aufgeblasen", () => {
  // Genau der Grund für Raster statt konvexer Hülle: die Hülle läge bei 600 m².
  const L = [...rechteck(0, 0, 30, 10), ...rechteck(0, 10, 10, 20)];
  const r = grundrissAusModell(modellAus(L));
  assert.ok(r.flaeche < 500, `L-Form ${r.flaeche} m² — deutlich unter der Hülle (600)`);
  assert.ok(r.flaeche > 330, "aber die echten ~400 m² sind erfasst");
});

test("grundrissAusModell — Innenhof wird als Abweichung gemeldet, nicht verschwiegen", () => {
  // Ring: außen 40×40, innen 20×20 frei => echte Belegung 1.200 m², Umriss 1.600 m².
  const ring = [
    ...rechteck(0, 0, 40, 10), ...rechteck(0, 30, 40, 40),
    ...rechteck(0, 10, 10, 30), ...rechteck(30, 10, 40, 30),
  ];
  const r = grundrissAusModell(modellAus(ring));
  assert.ok(r.hinweis, "der Nutzer wird auf den Innenhof hingewiesen");
  assert.ok(r.hinweis.includes("Innenhof"));
  assert.ok(r.rasterFlaeche < r.flaeche, "die gerasterte Belegung ist kleiner als der Umriss");
});

test("grundrissAusModell — filtert auf Geschoss und auf Umriss-Klassen", () => {
  const modell = modellAus(rechteck(0, 0, 20, 10), { geschoss: "EG" });
  assert.ok(grundrissAusModell(modell, { geschoss: "EG" }), "EG trifft");
  assert.equal(grundrissAusModell(modell, { geschoss: "3.OG" }), null, "anderes Geschoss => nichts");

  const raum = modellAus(rechteck(0, 0, 20, 10), { klasse: "IfcSpace" });
  assert.equal(grundrissAusModell(raum), null, "IfcSpace bildet keinen Umriss");
  assert.ok(UMRISS_KLASSEN.has("IfcWall") && !UMRISS_KLASSEN.has("IfcSpace"));
});

test("grundrissAusModell — unvollständige Eingaben liefern null statt zu werfen", () => {
  for (const leer of [null, {}, { merged: {} }, { merged: { positions: new Float32Array(), index: [], ranges: [] } }]) {
    assert.equal(grundrissAusModell(leer), null);
  }
});

// --- Deckenvorrang und Geschoss-Ableitung (26.08.2026, aus der Messung am Referenzprojekt) -------

test("grundrissAusModell — Decken haben Vorrang vor der Hülle", () => {
  // Am Referenzprojekt gemessen: IfcSlab ergibt im EG 5.103 m², Wände allein nur 522 m² (im
  // Grundriss dünne, fragmentierte Linien). Liegen beide vor, zählt die Decke.
  const modell = {
    elements: [
      { expressId: 1, ifc_klasse: "IfcSlab", geschoss: "EG" },
      { expressId: 2, ifc_klasse: "IfcWall", geschoss: "EG" },
    ],
    merged: (() => {
      const positions = []; const index = []; const ranges = [];
      const lege = (eid, tris) => {
        const start = index.length;
        for (const t of tris) for (const [x, z] of t) { index.push(positions.length / 3); positions.push(x, 0, z); }
        ranges.push({ eid, start, count: index.length - start });
      };
      lege(1, rechteck(0, 0, 20, 10));      // Decke: 200 m²
      lege(2, rechteck(0, 0, 40, 0.2));     // Wandstreifen: 8 m²
      return { positions: Float32Array.from(positions), index, ranges };
    })(),
  };
  const r = grundrissAusModell(modell);
  assert.equal(r.quelle, "Deckenplatten (IfcSlab)");
  assert.ok(Math.abs(r.flaeche - 200) / 200 < 0.1, `Deckenfläche ${r.flaeche}, erwartet ~200`);
});

test("grundrissAusModell — ohne Decken fällt es auf die Hülle zurück, statt aufzugeben", () => {
  const nurWand = modellAus(rechteck(0, 0, 20, 10), { klasse: "IfcWall" });
  const r = grundrissAusModell(nurWand);
  assert.ok(r, "Ergebnis statt null");
  assert.equal(r.quelle, "Hülle (keine Decken im Modell)");
});

test("geschosseAusModell — leere Geschosse zählen nicht für Kennzahlen", () => {
  // Am Referenzprojekt führt das Modell „−2.UG", dort liegt aber kein Bauteil mit Geometrie.
  const modell = {
    storeys: ["-2.UG", "-1.UG", "EG", "1.OG"],
    elements: [
      { expressId: 1, geschoss: "-1.UG" },
      { expressId: 2, geschoss: "EG" },
      { expressId: 3, geschoss: "1.OG" },
      { expressId: 9, geschoss: "-2.UG" }, // ohne Geometrie
    ],
    merged: { ranges: [{ eid: 1 }, { eid: 2 }, { eid: 3 }] },
  };
  const g = geschosseAusModell(modell);
  assert.equal(g.anzahl, 3, "drei belegte Geschosse");
  assert.deepEqual(g.leer, ["-2.UG"]);
  assert.equal(g.alle.length, 4, "das leere Geschoss bleibt sichtbar");
});

test("geschosseAusModell — ohne Range-Tabelle zählen alle Bauteile", () => {
  const g = geschosseAusModell({ storeys: ["EG", "1.OG"], elements: [{ expressId: 1, geschoss: "EG" }] });
  assert.equal(g.anzahl, 1);
});

test("geschosseAusModell — leeres Modell wirft nicht", () => {
  assert.equal(geschosseAusModell({}).anzahl, 0);
  assert.equal(geschosseAusModell(null).anzahl, 0);
});
