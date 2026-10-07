// Unit-Tests für Phase 36-02 (KARTE-03 + KARTE-04a):
//   - Punkt-Konverter canvasPointToLngLat/lngLatToCanvasPoint (maplibreStyles)
//   - buildSiteParcel (siteParcel.js): echte Parzelle vs. generisches Quadrat
//   - mapDraw-Builder (areas/buildings/elevation/draft → GeoJSON, ringBounds)

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  canvasPointToLngLat,
  lngLatToCanvasPoint,
  footprintToGeoJson,
} from "@designer/lib/maplibreStyles";
import {
  buildSiteParcel,
  parcelBbox,
  bboxIntersects,
  reanchorPoints,
  reanchorParcel,
  generischeParzellenMasse,
  baukoerperDefaults,
} from "@designer/lib/siteParcel";
import {
  areasToGeoJson,
  buildingsToGeoJson,
  elevationToGeoJson,
  draftToGeoJson,
  ringBounds,
  elevColor,
} from "@designer/lib/mapDraw";
import { polygonAreaM2, metersPerPixel, pxToM, SITE_EDGE_PX } from "@core/lib/geo";

const LAT = 49.4521;
const LNG = 11.0767;
const nah = (ist, soll, eps, msg) =>
  assert.ok(Math.abs(ist - soll) < eps, `${msg || ""}: ${ist} ≠ ${soll} (±${eps})`);

describe("maplibreStyles — Punkt-Konverter (Phase 36-02)", () => {
  it("Canvas-Mitte (600/400) liegt exakt auf dem Standort", () => {
    const [ln, la] = canvasPointToLngLat({ x: 600, y: 400 }, LAT, LNG);
    nah(ln, LNG, 1e-12);
    nah(la, LAT, 1e-12);
  });

  it("Roundtrip Punkt → LngLat → Punkt ist verlustfrei (sub-px)", () => {
    for (const p of [{ x: 0, y: 0 }, { x: 613.7, y: 391.2 }, { x: 1200, y: 800 }]) {
      const zurueck = lngLatToCanvasPoint(canvasPointToLngLat(p, LAT, LNG), LAT, LNG);
      nah(zurueck.x, p.x, 1e-6, "x");
      nah(zurueck.y, p.y, 1e-6, "y");
    }
  });

  it("y wächst nach Süden: Punkt unterhalb der Mitte hat kleinere Breite (lat)", () => {
    const [, la] = canvasPointToLngLat({ x: 600, y: 500 }, LAT, LNG);
    assert.ok(la < LAT);
  });
});

describe("siteParcel — buildSiteParcel (KARTE-04a, 72-01 A-2)", () => {
  // ~125 m × ~62,5 m Rechteck um den Standort (100 × 50 Canvas-Px).
  const RING = [
    canvasPointToLngLat({ x: 550, y: 375 }, LAT, LNG),
    canvasPointToLngLat({ x: 650, y: 375 }, LAT, LNG),
    canvasPointToLngLat({ x: 650, y: 425 }, LAT, LNG),
    canvasPointToLngLat({ x: 550, y: 425 }, LAT, LNG),
  ];

  it("ohne Ring und ohne Projekt: Startquadrat aus der 1.000-m²-Annahme (3.000 m²)", () => {
    for (const ring of [null, undefined, [], [RING[0], RING[1]]]) {
      const p = buildSiteParcel(ring, LAT, LNG);
      assert.equal(p.assumed, true);
      assert.equal(p.source, "generisch");
      assert.equal(p.points.length, 4);
      const bb = parcelBbox(p.points);
      assert.equal(bb.maxX - bb.minX, SITE_EDGE_PX);
      assert.equal(bb.maxY - bb.minY, SITE_EDGE_PX);
      // 72-01 A-2: expliziter Maßstab — Fläche 3.000 m² statt 1.000.000 m².
      assert.equal(p.geschaetzte_flaeche_m2, 3000);
      nah(p.m_per_px, Math.sqrt(3000) / SITE_EDGE_PX, 1e-9, "m_per_px");
      nah(polygonAreaM2(p.points, p), 3000, 2, "Fläche");
    }
  });

  it("500-m²-Projekt → ~1.500 m² Parzelle (Faktor 3, Abnahme A-2)", () => {
    const p = buildSiteParcel(null, LAT, LNG, { building_area: 500 });
    assert.equal(p.geschaetzte_flaeche_m2, 1500);
    nah(polygonAreaM2(p.points, p), 1500, 2, "Fläche");
    // Kantenlänge ≈ √1500 ≈ 38,7 m.
    nah(pxToM(SITE_EDGE_PX, p), Math.sqrt(1500), 0.01, "Kante");
  });

  it("Klammern: 10-m²-Projekt → 400 m²; 100.000-m²-Projekt → 20.000 m²", () => {
    const klein = buildSiteParcel(null, LAT, LNG, { building_area: 10 });
    assert.equal(klein.geschaetzte_flaeche_m2, 400);
    const gross = buildSiteParcel(null, LAT, LNG, { building_area: 100000 });
    assert.equal(gross.geschaetzte_flaeche_m2, 20000);
  });

  it("mit Ring: echte Parzelle — assumed:false, m_per_px:1,25, Fläche stimmt", () => {
    const p = buildSiteParcel(RING, LAT, LNG);
    assert.equal(p.assumed, false);
    assert.equal(p.source, "gezeichnet");
    assert.equal(p.m_per_px, 1.25);
    assert.equal(p.points.length, 4);
    // Punkte gerundet im Canvas-Format zurück.
    assert.deepEqual(p.points[0], { x: 550, y: 375 });
    assert.deepEqual(p.points[2], { x: 650, y: 425 });
    // Maßstab: 1,25 m/px trotz 100-px-Bbox (Bbox-Ableitung ergäbe 10 m/px).
    assert.equal(metersPerPixel(p), 1.25);
    // 125 m × 62,5 m = 7.812,5 m² (gerundet 7.813, ±1 durch Px-Rundung).
    nah(polygonAreaM2(p.points, p), 7812.5, 2, "Fläche");
  });

  it("geschlossener Ring (letzter = erster) wird geöffnet übernommen", () => {
    const geschlossen = [...RING, RING[0]];
    const p = buildSiteParcel(geschlossen, LAT, LNG);
    assert.equal(p.points.length, 4);
  });
});

describe("siteParcel — generischeParzellenMasse + baukoerperDefaults (72-01 A-2/A-3)", () => {
  it("generischeParzellenMasse: Gebäudefläche × 3, geclamt, Kante = √Fläche", () => {
    assert.deepEqual(generischeParzellenMasse({ building_area: 500 }), {
      kanteM: Math.sqrt(1500), flaecheM2: 1500,
    });
    // Ohne Fläche → 1.000-m²-Annahme.
    assert.equal(generischeParzellenMasse(null).flaecheM2, 3000);
    assert.equal(generischeParzellenMasse({}).flaecheM2, 3000);
    // Kaputte Werte → Fallback, kein NaN.
    assert.equal(generischeParzellenMasse({ building_area: "x" }).flaecheM2, 3000);
    assert.equal(generischeParzellenMasse({ building_area: -5 }).flaecheM2, 3000);
  });

  it("baukoerperDefaults: 20 × 15 m, Geschosse je Typ (Gewerbe 4 / Wohnen 3 / Öffentlich 2)", () => {
    assert.deepEqual(baukoerperDefaults("commercial"), { breiteM: 20, tiefeM: 15, geschosse: 4 });
    assert.deepEqual(baukoerperDefaults("residential"), { breiteM: 20, tiefeM: 15, geschosse: 3 });
    assert.deepEqual(baukoerperDefaults("institutional"), { breiteM: 20, tiefeM: 15, geschosse: 2 });
    // Unbekannt/null → Wohnen-Fallback 3.
    assert.equal(baukoerperDefaults(null).geschosse, 3);
    assert.equal(baukoerperDefaults("urban_development").geschosse, 3);
  });

  it("Abnahme A-3: ein Klick auf das 500-m²-Projekt → ~1.200 m² BGF (300 m² × 4 Geschosse)", () => {
    // Baukörper 20 × 15 m = 300 m² Grundfläche; Gewerbe = 4 Geschosse ⇒ 1.200 m² BGF.
    const { breiteM, tiefeM, geschosse } = baukoerperDefaults("commercial");
    assert.equal(breiteM * tiefeM * geschosse, 1200);
  });

  it("Nacharbeit A-2: frisch abgeleitete Parzelle trägt geschaetzte_flaeche_m2 — Altdaten-Stempel fehlt", () => {
    // SiteDesigner unterscheidet darüber den Hinweistext („aus der Gebäudefläche"
    // nur bei echter Ableitung; gespeicherte Altdaten → „gespeicherte Parzelle").
    const frisch = buildSiteParcel(null, LAT, LNG, { building_area: 500 });
    assert.equal(frisch.geschaetzte_flaeche_m2, 1500);
    // Nachbildung einer Alt-Parzelle aus db.json (vor 72-01 gespeichert):
    // assumed:true, source:"generisch", aber OHNE den Stempel.
    const alt = { id: "site_parcel_main", type: "site_boundary", assumed: true, source: "generisch", points: frisch.points };
    assert.equal(Number.isFinite(alt.geschaetzte_flaeche_m2), false);
  });
});

describe("siteParcel — Re-Anchor + Bbox-Schnitt (Review-Fixes 36-02)", () => {
  const NBG = { lat: LAT, lng: LNG };
  // ~50 m Marker-Nudge nach Norden.
  const NBG_NUDGE = { lat: LAT + 0.00045, lng: LNG };
  const HH = { lat: 53.5511, lng: 9.9937 };
  const QUAD = [
    { x: 560, y: 360 }, { x: 640, y: 360 }, { x: 640, y: 440 }, { x: 560, y: 440 },
  ];

  it("reanchorPoints: geografische Lage bleibt — Roundtrip alt→neu→alt ist punktgleich (±1 px Rundung)", () => {
    const hin = reanchorPoints(QUAD, NBG, NBG_NUDGE);
    const zurueck = reanchorPoints(hin, NBG_NUDGE, NBG);
    QUAD.forEach((p, i) => {
      nah(zurueck[i].x, p.x, 1.01, "x");
      nah(zurueck[i].y, p.y, 1.01, "y");
    });
    // Nudge nach Norden ⇒ Punkte wandern im Canvas nach Süden (y wächst).
    assert.ok(hin[0].y > QUAD[0].y);
  });

  it("reanchorParcel: kleiner Standort-Nudge nimmt die gezeichnete Parzelle mit (Fläche bleibt ~gleich)", () => {
    const parcel = { ...buildSiteParcel(null, LAT, LNG), assumed: false, source: "gezeichnet", m_per_px: 1.25, points: QUAD };
    const moved = reanchorParcel(parcel, NBG, NBG_NUDGE);
    assert.ok(moved, "Re-Anchor darf bei ~50 m nicht null liefern");
    assert.equal(moved.source, "gezeichnet");
    assert.equal(moved.m_per_px, 1.25);
    nah(polygonAreaM2(moved.points, moved), polygonAreaM2(QUAD, parcel), 60, "Fläche");
  });

  it("reanchorParcel: Städtewechsel (außer Reichweite) ⇒ null (zurück zum Quadrat)", () => {
    const parcel = { assumed: false, source: "gezeichnet", m_per_px: 1.25, points: QUAD };
    assert.equal(reanchorParcel(parcel, NBG, HH), null);
  });

  it("reanchorParcel/Points: Härtung — kaputte Eingaben ⇒ null", () => {
    assert.equal(reanchorPoints(null, NBG, HH), null);
    assert.equal(reanchorPoints(QUAD, { lat: NaN, lng: 11 }, HH), null);
    assert.equal(reanchorParcel({ points: [{ x: 1, y: 2 }] }, NBG, NBG_NUDGE), null);
  });

  it("bboxIntersects: Überlappung/Randberührung true, disjunkt/null false", () => {
    const a = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    assert.equal(bboxIntersects(a, { minX: 5, minY: 5, maxX: 15, maxY: 15 }), true);
    assert.equal(bboxIntersects(a, { minX: 10, minY: 10, maxX: 20, maxY: 20 }), true);
    assert.equal(bboxIntersects(a, { minX: 11, minY: 0, maxX: 20, maxY: 10 }), false);
    assert.equal(bboxIntersects(a, null), false);
    assert.equal(bboxIntersects(null, a), false);
  });
});

describe("mapDraw — GeoJSON-Builder (KARTE-03)", () => {
  const AREAS = [
    { id: "a1", type: "footprint", points: [{ x: 580, y: 380 }, { x: 620, y: 380 }, { x: 620, y: 420 }] },
    { id: "kaputt", type: "footprint", points: [{ x: 0, y: 0 }] }, // <3 Punkte → raus
  ];

  it("areasToGeoJson: ein geschlossenes Polygon-Feature je gültiger Fläche, id in properties", () => {
    const fc = areasToGeoJson(AREAS, LAT, LNG);
    assert.equal(fc.features.length, 1);
    const f = fc.features[0];
    assert.equal(f.properties.id, "a1");
    const ring = f.geometry.coordinates[0];
    assert.equal(ring.length, 4); // 3 Punkte + Schließpunkt
    assert.deepEqual(ring[0], ring[3]);
  });

  it("buildingsToGeoJson: Rechteck → 4-Eck-Polygon mit floors; entartete Maße gefiltert", () => {
    const fc = buildingsToGeoJson(
      [
        { id: "b1", x: 540, y: 355, width: 120, height: 90, floors: 6 },
        { id: "b0", x: 0, y: 0, width: 0, height: 90 },
      ],
      LAT,
      LNG
    );
    assert.equal(fc.features.length, 1);
    assert.equal(fc.features[0].properties.floors, 6);
    const ring = fc.features[0].geometry.coordinates[0];
    assert.equal(ring.length, 5); // 4 Ecken + Schließpunkt
    // Ecke oben links = (540, 355) → zurückgerechnet identisch.
    const p = lngLatToCanvasPoint(ring[0], LAT, LNG);
    nah(p.x, 540, 1e-6);
    nah(p.y, 355, 1e-6);
  });

  it("elevationToGeoJson: Punkte mit Farbe; ungültige Koordinaten gefiltert", () => {
    const fc = elevationToGeoJson(
      [
        { id: "e1", x: 600, y: 400, elevation: 0 },
        { id: "e2", x: NaN, y: 10, elevation: 3 },
      ],
      LAT,
      LNG
    );
    assert.equal(fc.features.length, 1);
    assert.equal(fc.features[0].properties.color, elevColor(0));
    nah(fc.features[0].geometry.coordinates[0], LNG, 1e-12);
  });

  it("draftToGeoJson: <2 Punkte leer, sonst offene LineString", () => {
    assert.equal(draftToGeoJson([]).features.length, 0);
    assert.equal(draftToGeoJson([[11, 49]]).features.length, 0);
    const fc = draftToGeoJson([[11, 49], [11.001, 49], [11.001, 49.001]]);
    assert.equal(fc.features.length, 1);
    assert.equal(fc.features[0].geometry.type, "LineString");
    assert.equal(fc.features[0].geometry.coordinates.length, 3);
  });

  it("elevColor: klemmt an den Rändern (−10 blau, +10 rot) und liefert rgb()", () => {
    assert.equal(elevColor(-99), "rgb(0,0,255)");
    assert.equal(elevColor(99), "rgb(255,0,0)");
    assert.match(elevColor(0), /^rgb\(\d+,\d+,\d+\)$/);
  });

  it("ringBounds: [[minLng,minLat],[maxLng,maxLat]]; leer → null", () => {
    assert.equal(ringBounds([]), null);
    assert.equal(ringBounds(null), null);
    const b = ringBounds([[11, 49], [11.2, 48.9], [11.1, 49.1]]);
    assert.deepEqual(b, [[11, 48.9], [11.2, 49.1]]);
  });

  it("Integration: footprintToGeoJson(parcel) ↔ ringBounds liefert fitBounds-taugliche Box", () => {
    const parcel = buildSiteParcel(null, LAT, LNG); // generisches Quadrat
    const ring = footprintToGeoJson(parcel.points, LAT, LNG).features[0].geometry.coordinates[0];
    const [[minLng, minLat], [maxLng, maxLat]] = ringBounds(ring);
    assert.ok(minLng < LNG && LNG < maxLng);
    assert.ok(minLat < LAT && LAT < maxLat);
  });
});
