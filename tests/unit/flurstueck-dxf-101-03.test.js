// Unit tests 101-03 (part 2): parcel import from DXF (flurstueckeAusDxf) and the union into ONE
// plot boundary (grundstueckAusFlurstuecken), including the round trip with the own site plan
// export of 104-06: export → import gives the same boundary. Hand-computed expectations.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { flurstueckeAusDxf, grundstueckAusFlurstuecken, flurstueckeAusGeoJson } from "@designer/lib/flurstueckImport";
import { lageplanDxfDaten, dxfDatei } from "@designer/lib/dxfPlaene";
import { DXF_MELDUNGEN } from "@core/lib/plan/dxfLesen.js";
import { nachUtm } from "@core/lib/utmEtrs89.js";

const ORT = { lat: 49.4521, lng: 11.0767 };

/** Minimal DXF text from entity lines (code, value, …), CRLF. */
const dxf = (/** @type {Array<string|number>} */ ents, header = /** @type {Array<string|number>} */ ([])) =>
  ["0", "SECTION", "2", "HEADER", ...header.map(String), "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES", ...ents.map(String), "0", "ENDSEC", "0", "EOF"].join("\r\n") + "\r\n";
const lw = (/** @type {string} */ ebene, /** @type {number[][]} */ pts, geschlossen = true) =>
  ["0", "LWPOLYLINE", "8", ebene, "90", pts.length, "70", geschlossen ? 1 : 0, ...pts.flatMap(([x, y]) => ["10", x, "20", y])];
const flaeche = (/** @type {Array<{x:number,y:number}>} */ p) => Math.abs(p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a.x * b.y - b.x * a.y; }, 0) / 2);
/** Same ring as a set of points (start and direction free), 0.01 px exact. */
const gleicheGrenze = (/** @type {Array<{x:number,y:number}>} */ a, /** @type {Array<{x:number,y:number}>} */ b) => {
  const k = (/** @type {{x:number,y:number}} */ p) => `${p.x.toFixed(2)}|${p.y.toFixed(2)}`;
  assert.equal(a.length, b.length, `${a.length} vs ${b.length} Ecken`);
  assert.deepEqual(new Set(a.map(k)), new Set(b.map(k)));
};

describe("flurstueckeAusDxf + grundstueckAusFlurstuecken — Import und Vereinigung", () => {
  it("Rundlauf: eigener Lageplan-Export → eigener Import ergibt dieselbe Grenze (0,01 px)", () => {
    const grenze = [{ x: 560, y: 360 }, { x: 640.5, y: 362.25 }, { x: 650, y: 430.13 }, { x: 600, y: 455.75 }, { x: 555.01, y: 420 }];
    const cd = { location: ORT, site_parcel: { assumed: false, m_per_px: 1.25, points: grenze }, buildings: [{ id: "h", x: 590, y: 390, width: 20, height: 10, floors: 3 }] };
    const { text } = dxfDatei(lageplanDxfDaten(cd));
    const r = flurstueckeAusDxf(text, ORT.lat, ORT.lng, 1.25);
    assert.deepEqual(r.gewaehlt, ["GRUNDSTUECK"]); // automatic choice: the plot layer, not the buildings
    assert.equal(r.flurstuecke.length, 1);
    const g = grundstueckAusFlurstuecken(r.flurstuecke, { mPerPx: 1.25 });
    assert.equal(g.ok, true);
    if (g.ok) gleicheGrenze(g.punkte, grenze);
  });

  it("Rundlauf mit zwei Flurstücken: Ebene FLURSTUECKE gewählt, Nummern gelesen, Vereinigung = Grenze", () => {
    const a = [{ x: 560, y: 360 }, { x: 600, y: 360 }, { x: 600, y: 440 }, { x: 560, y: 440 }];
    const b = [{ x: 600, y: 360 }, { x: 650, y: 360 }, { x: 650, y: 440 }, { x: 600, y: 440 }];
    const grenze = [{ x: 560, y: 360 }, { x: 650, y: 360 }, { x: 650, y: 440 }, { x: 560, y: 440 }];
    const cd = { location: ORT, site_parcel: { assumed: false, m_per_px: 0.5, points: grenze },
      grundstueck: { flurstuecke: [{ id: "1", nummer: "1234/5", gemarkung: "", polygon: a, m_per_px: 0.5 }, { id: "2", nummer: "1234/6", gemarkung: "", polygon: b, m_per_px: 0.5 }] } };
    const r = flurstueckeAusDxf(dxfDatei(lageplanDxfDaten(cd)).text, ORT.lat, ORT.lng, 0.5);
    assert.deepEqual(r.gewaehlt, ["FLURSTUECKE"]);
    assert.deepEqual(r.flurstuecke.map((f) => f.nummer).sort(), ["1234/5", "1234/6"]);
    assert.ok(r.warnungen.some((w) => w.includes("automatisch gewählt")), r.warnungen.join("|"));
    const g = grundstueckAusFlurstuecken(r.flurstuecke, { mPerPx: 0.5 });
    assert.equal(g.ok, true);
    if (g.ok) { gleicheGrenze(g.punkte, grenze); assert.equal(g.flaeche_m2, 45 * 40); assert.match(g.meldung, /2 Flurstücke/); }
  });

  it("Rundlauf an einen anderen Standort: Bezug aus dem Kommentar verschiebt, Form und Fläche bleiben", () => {
    const grenze = [{ x: 580, y: 380 }, { x: 620, y: 380 }, { x: 620, y: 420 }, { x: 580, y: 420 }];
    const text = dxfDatei(lageplanDxfDaten({ location: ORT, site_parcel: { assumed: false, m_per_px: 1, points: grenze } })).text;
    const r = flurstueckeAusDxf(text, ORT.lat + 0.0001, ORT.lng, 1); // project 11.13 m further north
    const g = grundstueckAusFlurstuecken(r.flurstuecke, { mPerPx: 1 });
    assert.equal(g.ok, true);
    if (g.ok) {
      assert.ok(Math.abs(g.flaeche_m2 - 1600) <= 1, `Fläche ${g.flaeche_m2}`);
      const ys = g.punkte.map((p) => p.y);
      assert.ok(Math.abs(Math.min(...ys) - (380 + 11.132)) < 0.05, `y ${Math.min(...ys)}`);
    }
  });

  it("ETRS89/UTM (Zone 32, mit und ohne Zonenpräfix) landet am richtigen Ort im Lageplan", () => {
    const m = nachUtm(ORT.lat, ORT.lng, 32);
    const ring = [[0, 0], [30, 0], [30, 20], [0, 20]].map(([dx, dy]) => [m.ost + dx, m.nord + dy]);
    for (const praefix of [0, 32e6]) {
      const r = flurstueckeAusDxf(dxf(lw("AX_FLURSTUECK", ring.map(([x, y]) => [x + praefix, y])), ["9", "$INSUNITS", "70", 6]), ORT.lat, ORT.lng, 1);
      assert.equal(r.flurstuecke.length, 1, r.warnungen.join("|"));
      const p0 = r.flurstuecke[0].polygon[0];
      // Corner 0 = the project location → canvas centre (grid vs. true north turn the rest by < 2°).
      assert.ok(Math.abs(p0.x - 600) < 0.02 && Math.abs(p0.y - 400) < 0.02, JSON.stringify(p0));
      // UTM scale factor near the zone edge ≈ 1.0002 → area 600 m² within 1 m².
      assert.ok(Math.abs(flaeche(r.flurstuecke[0].polygon) - 600) < 1, `Fläche ${flaeche(r.flurstuecke[0].polygon)}`);
    }
  });

  it("Einheit mm ($INSUNITS 4) wird umgerechnet; ohne Georeferenz zentriert mit Warnung", () => {
    const r = flurstueckeAusDxf(dxf(lw("GRENZE", [[0, 0], [10000, 0], [10000, 5000], [0, 5000]]), ["9", "$INSUNITS", "70", 4]), ORT.lat, ORT.lng, 1);
    assert.equal(r.flurstuecke.length, 1);
    assert.equal(flaeche(r.flurstuecke[0].polygon), 50);
    assert.ok(r.warnungen.some((w) => w.includes("ohne Georeferenz")));
    const xs = r.flurstuecke[0].polygon.map((p) => p.x);
    assert.equal((Math.min(...xs) + Math.max(...xs)) / 2, 600);
  });

  it("Gauß-Krüger und zu weit entfernte Flurstücke: ehrlich abgelehnt, nichts übernommen", () => {
    const gk = flurstueckeAusDxf(dxf(lw("FLST", [[4430000, 5480000], [4430030, 5480000], [4430030, 5480020]])), ORT.lat, ORT.lng);
    assert.equal(gk.flurstuecke.length, 0);
    assert.ok(gk.warnungen.some((w) => w.includes("Gauß-Krüger")));
    const weit = nachUtm(ORT.lat + 1, ORT.lng, 32); // ~111 km north
    const r = flurstueckeAusDxf(dxf(lw("FLST", [[weit.ost, weit.nord], [weit.ost + 30, weit.nord], [weit.ost + 30, weit.nord + 20]])), ORT.lat, ORT.lng);
    assert.equal(r.flurstuecke.length, 0);
    assert.ok(r.warnungen.some((w) => /111 km/.test(w)), r.warnungen.join("|"));
  });

  it("Ebenen-Filter von außen; nur offene Linien → Klartext; kaputte Datei → Fehlertext", () => {
    const t = dxf([...lw("A", [[0, 0], [5, 0], [5, 5], [0, 5]]), ...lw("B", [[0, 0], [5, 0], [5, 5]], false)]);
    const nurB = flurstueckeAusDxf(t, ORT.lat, ORT.lng, 1, { ebenen: ["b"] });
    assert.equal(nurB.flurstuecke.length, 0);
    assert.ok(nurB.warnungen.some((w) => w.includes("offene Linienzüge")));
    assert.ok(nurB.warnungen.some((w) => w.includes("keine geschlossene Fläche")));
    assert.deepEqual(nurB.ebenen.map((e) => e.name), ["A", "B"]);
    assert.equal(flurstueckeAusDxf("kein dxf", ORT.lat, ORT.lng).warnungen[0], DXF_MELDUNGEN.keinDxf);
  });

  it("Vereinigung lehnt Lücke mit Abstand in Metern ab; Übersetzer wird benutzt", () => {
    const a = { id: "a", nummer: "1", gemarkung: "", polygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] };
    const b = { id: "b", nummer: "2", gemarkung: "", polygon: [{ x: 12, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 12, y: 10 }] };
    const g = grundstueckAusFlurstuecken([a, b], { mPerPx: 1.25 });
    assert.equal(g.ok, false);
    if (!g.ok) { assert.equal(g.grund, "luecke"); assert.match(g.meldung, /2 Teile, kleinster Abstand 2,5 m/); }
    const en = grundstueckAusFlurstuecken([], { t: (s) => (s.startsWith("Keine Flurstücke") ? "No parcels to unite." : s) });
    assert.equal(en.meldung, "No parcels to unite.");
  });

  it("Vereinigung nimmt Flurstücke mit anderem Maßstab (m_per_px) richtig mit", () => {
    // Two 10 × 10 m squares side by side: one stored at 1 m/px, the other at 2 m/px (5 px wide).
    const a = { id: "a", nummer: "1", gemarkung: "", polygon: [{ x: 600, y: 400 }, { x: 610, y: 400 }, { x: 610, y: 410 }, { x: 600, y: 410 }], m_per_px: 1 };
    const b = { id: "b", nummer: "2", gemarkung: "", polygon: [{ x: 605, y: 400 }, { x: 610, y: 400 }, { x: 610, y: 405 }, { x: 605, y: 405 }], m_per_px: 2 };
    const g = grundstueckAusFlurstuecken([a, b], { mPerPx: 1 });
    assert.equal(g.ok, true);
    if (g.ok) assert.equal(g.flaeche_m2, 200);
  });

  it("GeoJSON-Import im Maßstab der Parzelle; ein Flurstück vereinigt = das Flurstück", () => {
    const ring = [[11.0762, 49.4516], [11.0772, 49.4516], [11.0772, 49.4526], [11.0762, 49.4526], [11.0762, 49.4516]];
    const r = flurstueckeAusGeoJson(JSON.stringify({ type: "Polygon", coordinates: [ring] }), ORT.lat, ORT.lng, 0.5);
    assert.equal(r.flurstuecke[0].m_per_px, 0.5);
    const g = grundstueckAusFlurstuecken(r.flurstuecke, { mPerPx: 0.5 });
    assert.equal(g.ok, true);
    // 0.001° lng × 111 320 m × cos 49.4521° = 72.39 m; 0.001° lat = 111.32 m → 8 058 m².
    if (g.ok) { assert.ok(Math.abs(g.flaeche_m2 - 8058) <= 5, `Fläche ${g.flaeche_m2}`); assert.match(g.meldung, /1 Flurstück/); }
  });
});

describe("flurstueckeAusDxf — Robustheit (Review-Befunde 104-06)", () => {
  it("150 000 Eckpunkte über viele Ringe: kein RangeError, Klartext zum Flurstück-Limit", () => {
    // 60 closed rings of 2 500 points each (every ring within maxPunkte), circles of 10 m radius side by side.
    const ents = [];
    for (let k = 0; k < 60; k++) {
      const pts = [];
      for (let j = 0; j < 2500; j++) { const a = (2 * Math.PI * j) / 2500; pts.push([k * 30 + 10 * Math.cos(a), 10 * Math.sin(a)]); }
      ents.push(...lw("FLURSTUECKE", pts));
    }
    /** @type {any} */
    let r = null;
    assert.doesNotThrow(() => { r = flurstueckeAusDxf(dxf(ents), ORT.lat, ORT.lng, 1.25); });
    assert.equal(r.flurstuecke.length, 50);
    assert.ok(r.warnungen.some((x) => /Mehr als 50 Flurstücke/.test(x)), r.warnungen.join(" | "));
    assert.equal(r.unvollstaendig, true);
  });

  it("Datei mitten in ENTITIES verrutscht: Abbruch mit Zeilennummer gemeldet, Import als unvollständig markiert", () => {
    const a = lw("FLURSTUECKE", [[0, 0], [20, 0], [20, 30], [0, 30]]);
    const b = lw("FLURSTUECKE", [[20, 0], [40, 0], [40, 30], [20, 30]]);
    const r = flurstueckeAusDxf(dxf([...a, "XX", "oops", ...b]), ORT.lat, ORT.lng, 1.25);
    assert.equal(r.flurstuecke.length, 1); // the second parcel is unreadable …
    assert.equal(r.unvollstaendig, true); // … and that is said, not hidden
    // HEADER section (6 lines) + ENTITIES head (4) + parcel A (8 + 16 point lines) = 34 → "XX" is line 35.
    assert.ok(r.warnungen.some((x) => /ab Zeile 35 nicht lesbar/.test(x)), r.warnungen.join(" | "));
    const ganz = flurstueckeAusDxf(dxf([...a, ...b]), ORT.lat, ORT.lng, 1.25);
    assert.equal(ganz.flurstuecke.length, 2);
    assert.equal(ganz.unvollstaendig, false);
  });
});
