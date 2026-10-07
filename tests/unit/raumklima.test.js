// Unit-Tests für packages/nova-designer/src/lib/raumklima.js (Phase 45).
//
// Handgerechnete Referenzen (Rechteck-Footprint 10×8 m, zentriert; −z = Nord):
// - Südwand-Fenster 2,0×1,4 m in Raum 40 m²: Kennwert = 2,8·1,0/40 = 0,07
// - Sonneneintrag (Raum 20 m², Südfenster 4 m², g 0,6, Fc 1; g_total = g·Fc
//   nach DIN 4108-2 Gl. 3 — OHNE den 0,9-Heizfall-Faktor):
//   S_vorh = 4·0,6/20 = 0,12 · f_WG = 0,2 → S2 = 0,060 − 0,231·0,2 = 0,0138
//   S1 (Wohnen, erhöhte NL, schwer, B) = 0,113 → S_zul = 0,1268 → pass
//   S1 (ohne NL, schwer, B) = 0,074 → S_zul = 0,0878 → warn
// - Klimaregion: Höchstwert Monatsmittel < 16,5 → A · < 18 → B · sonst C
//
// Diese Tests dokumentieren Richtwerte. Kein Nachweis nach DIN 4108-2.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  polygonAreaXZ, polygonSignedAreaXZ, pointInPolygon, outwardNormal, azimutFromNormal,
  orientierungsLabel, orientFaktor, istNordFenster,
  fensterZuRaeumen, screeningJeGeschoss, DACH_ZUSCHLAG,
  sonneneintrag, klimaregionAusKlima, bauartVorschlag,
  raumklimaChecks, S1_WOHN, S2_WOHN, FC_OPTIONEN,
} from "@designer/lib/raumklima";

const near = (actual, expected, tol, msg) =>
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${msg || ""}: ${actual} weicht von ${expected} um mehr als ${tol} ab`,
  );

// Rechteck 10×8 m um den Ursprung; Kanten wie createBuildingModel (edge i = Pi→Pi+1).
const P = [{ x: -5, z: -4 }, { x: 5, z: -4 }, { x: 5, z: 4 }, { x: -5, z: 4 }];
const waende = (level = 0) => P.map((a, i) => ({
  a, b: P[(i + 1) % 4], level, edge: i, thickness: 0.3,
}));
// edge 0 = Nordseite (z=−4), edge 1 = Ost, edge 2 = Süd, edge 3 = West.
const ZONEN = [
  { name: "Wohnen", level: 0, points: [{ x: -5, z: 0 }, { x: 5, z: 0 }, { x: 5, z: 4 }, { x: -5, z: 4 }] },
  { name: "Schlafen", level: 0, points: [{ x: -5, z: -4 }, { x: 5, z: -4 }, { x: 5, z: 0 }, { x: -5, z: 0 }] },
];
const fensterSued = { level: 0, edge: 2, u: 5, breite: 2, hoehe: 1.4, g: 0.6 };
const fensterNord = { level: 0, edge: 0, u: 5, breite: 2, hoehe: 1.4, g: 0.6 };

describe("Geometrie & Orientierung", () => {
  it("polygonAreaXZ: Rechteck 10×8 = 80 m²", () => {
    near(polygonAreaXZ(P), 80, 1e-9, "Fläche");
  });

  it("pointInPolygon: innen/außen", () => {
    assert.equal(pointInPolygon({ x: 0, z: 0 }, P), true);
    assert.equal(pointInPolygon({ x: 6, z: 0 }, P), false);
  });

  it("Außennormalen der vier Kanten → N/O/S/W-Azimute", () => {
    const umlauf = Math.sign(polygonSignedAreaXZ(P));
    const erwartet = [0, 90, 180, 270];
    waende().forEach((w, i) => {
      const az = azimutFromNormal(outwardNormal(w, umlauf));
      near(az, erwartet[i], 1e-9, `Kante ${i}`);
    });
  });

  it("northAngle dreht die Orientierung (Süd wird bei 180° zu Nord)", () => {
    const umlauf = Math.sign(polygonSignedAreaXZ(P));
    const sued = outwardNormal(waende()[2], umlauf);
    near(azimutFromNormal(sued, 180), 0, 1e-9, "gedrehter Azimut");
    assert.equal(orientierungsLabel(azimutFromNormal(sued, 180)), "N");
  });

  // Regression (Review 45, critical): der frühere Schwerpunkt-Test wählte an
  // einspringenden Ecken die Innenseite — der Eckpunkt-Schwerpunkt der L-Form
  // liegt in der Aussparung (außerhalb des Polygons).
  it("konkave L-Form: alle sechs Außennormalen korrekt (auch einspringende Kanten)", () => {
    const L = [
      { x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 4 },
      { x: 4, z: 4 }, { x: 4, z: 10 }, { x: 0, z: 10 },
    ];
    const wl = L.map((a, i) => ({ a, b: L[(i + 1) % 6], level: 0, edge: i, thickness: 0.3 }));
    const umlauf = Math.sign(polygonSignedAreaXZ(L));
    // −z = Nord: edge 0 = N, 1 = O, 2 = S (einspringend!), 3 = O (einspringend!), 4 = S, 5 = W
    const erwartet = [0, 90, 180, 90, 180, 270];
    wl.forEach((w, i) => {
      near(azimutFromNormal(outwardNormal(w, umlauf)), erwartet[i], 1e-9, `L-Kante ${i}`);
    });
    // Umlaufrichtung umgekehrt (im UZS gezeichnet) → gleiche Außennormalen
    const rueck = { a: { x: 4, z: 4 }, b: { x: 10, z: 4 }, level: 0, edge: 2 };
    const n = outwardNormal(rueck, -1);
    near(n.nx, 0, 1e-9, "Rück-Normale x");
    near(n.nz, 1, 1e-9, "Rück-Normale z");
  });

  it("Sektor-Label und Screening-Gewichte (Süd 1,0 > Nord 0,3)", () => {
    assert.equal(orientierungsLabel(180), "S");
    assert.equal(orientierungsLabel(225), "SW");
    assert.ok(orientFaktor(180) > orientFaktor(0));
    assert.equal(istNordFenster(0), true);
    assert.equal(istNordFenster(315), true);
    assert.equal(istNordFenster(180), false);
  });
});

describe("Fenster → Raum (KLIMA-02)", () => {
  it("Süd-Fenster landet im Süd-Raum, Nord-Fenster im Nord-Raum", () => {
    const z = fensterZuRaeumen({ fenster: [fensterSued, fensterNord], waende: waende(), zonen: ZONEN });
    assert.equal(z.proRaum.get("0:Wohnen").fenster.length, 1);
    assert.equal(z.proRaum.get("0:Wohnen").fenster[0].orient, "S");
    assert.equal(z.proRaum.get("0:Schlafen").fenster.length, 1);
    assert.equal(z.proRaum.get("0:Schlafen").fenster[0].orient, "N");
    assert.equal(z.ohneRaum.length, 0);
  });

  it("Fenster ohne Raum (Geschoss ohne Zonen) landet ehrlich in ohneRaum", () => {
    const og = { ...fensterSued, level: 1 };
    const z = fensterZuRaeumen({ fenster: [og], waende: [...waende(0), ...waende(1)], zonen: ZONEN });
    assert.equal(z.ohneRaum.length, 1);
  });

  it("fehlende Wand (edge unbekannt) → ohneRaum statt Crash", () => {
    const kaputt = { ...fensterSued, edge: 99 };
    const z = fensterZuRaeumen({ fenster: [kaputt], waende: waende(), zonen: ZONEN });
    assert.equal(z.ohneRaum.length, 1);
  });

  // Regression (Review 45, critical): Fenster auf einer einspringenden L-Kante
  // muss im Riegel-Raum landen (früher schritt der Testpunkt nach AUSSEN in
  // die Aussparung → ohneRaum) und Süd-orientiert sein.
  it("konkave L-Form: Fenster der einspringenden Kante findet seinen Raum", () => {
    const L = [
      { x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 4 },
      { x: 4, z: 4 }, { x: 4, z: 10 }, { x: 0, z: 10 },
    ];
    const wl = L.map((a, i) => ({ a, b: L[(i + 1) % 6], level: 0, edge: i, thickness: 0.3 }));
    const riegel = {
      name: "Riegel", level: 0,
      points: [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 4 }, { x: 0, z: 4 }],
    };
    // edge 2 = (10,4)→(4,4), u=3 → Fenstermitte (7|4), innen liegt z<4
    const f = { level: 0, edge: 2, u: 3, breite: 1.5, hoehe: 1.4, g: 0.6 };
    const z = fensterZuRaeumen({ fenster: [f], waende: wl, zonen: [riegel] });
    assert.equal(z.ohneRaum.length, 0, "Fenster darf nicht in der Aussparung landen");
    const eintrag = z.proRaum.get("0:Riegel").fenster[0];
    assert.equal(eintrag.orient, "S");
  });
});

describe("Screening-Ranking (KLIMA-04)", () => {
  it("Süd-Raum rankt über Nord-Raum (0,07 vs. 0,021)", () => {
    const z = fensterZuRaeumen({ fenster: [fensterSued, fensterNord], waende: waende(), zonen: ZONEN });
    const s = screeningJeGeschoss({ proRaum: z.proRaum, storeys: 4 });
    const eg = s.geschosse.get(0);
    assert.equal(eg[0].name, "Wohnen");
    near(eg[0].kennwert, (2.8 * 1.0) / 40, 1e-9, "Kennwert Wohnen");
    near(eg[1].kennwert, (2.8 * 0.3) / 40, 1e-9, "Kennwert Schlafen");
  });

  it("oberstes Geschoss bekommt den Dachzuschlag", () => {
    const zonenOben = ZONEN.map((zo) => ({ ...zo, level: 3 }));
    const z = fensterZuRaeumen({
      fenster: [{ ...fensterSued, level: 3 }], waende: waende(3), zonen: zonenOben,
    });
    const s = screeningJeGeschoss({ proRaum: z.proRaum, storeys: 4 });
    const raum = s.geschosse.get(3)[0];
    assert.equal(raum.dachRaum, true);
    near(raum.kennwert, ((2.8 * 1.0) / 40) * DACH_ZUSCHLAG, 1e-9, "Dachzuschlag");
  });

  it("Freistellung: f_WG 7 % < 10 % → nachweisFrei; Nur-Nord-Grenze 15 %", () => {
    const z = fensterZuRaeumen({ fenster: [fensterSued, fensterNord], waende: waende(), zonen: ZONEN });
    const s = screeningJeGeschoss({ proRaum: z.proRaum, storeys: 4 });
    const [wohnen, schlafen] = [s.raeume.find((r) => r.name === "Wohnen"), s.raeume.find((r) => r.name === "Schlafen")];
    assert.equal(wohnen.nachweisFrei, true, "2,8/40 = 7 % < 10 %");
    // Nord-Raum: 2,8/40 = 7 % < 15 % (Nur-Nord-Grenze) → frei
    assert.equal(schlafen.nachweisFrei, true);
  });
});

describe("Sonneneintragskennwert (KLIMA-05, Anlehnung DIN 4108-2)", () => {
  const raum = {
    flaeche: 20, fWG: 0.2,
    fenster: [{ flaeche: 4, g: 0.6, azimut: 180 }],
  };

  it("Handrechnung: erhöhte NL/schwer/B → pass, ohne NL → warn", () => {
    const gut = sonneneintrag(raum, { klimaregion: "B", bauart: "schwer", nachtlueftung: "erhoeht", fc: 1 });
    near(gut.sVorh, 0.12, 1e-9, "S_vorh = 4·0,6/20 (g·Fc, ohne 0,9-Heizfall-Faktor)");
    near(gut.sZul, 0.113 + 0.0138, 1e-9, "S_zul");
    assert.equal(gut.ueberschreitung, false);

    const schlecht = sonneneintrag(raum, { klimaregion: "B", bauart: "schwer", nachtlueftung: "ohne", fc: 1 });
    near(schlecht.sZul, 0.074 + 0.0138, 1e-9, "S_zul ohne NL");
    assert.equal(schlecht.ueberschreitung, true);
  });

  it("Rollladen (Fc 0,3) drückt S_vorh unter S_zul", () => {
    const fc = FC_OPTIONEN.find((o) => o.id === "rollladen").fc;
    const r = sonneneintrag(raum, { klimaregion: "B", bauart: "schwer", nachtlueftung: "ohne", fc });
    near(r.sVorh, 0.12 * 0.3, 1e-9, "S_vorh mit Fc");
    assert.equal(r.ueberschreitung, false);
  });

  it("Sonnenschutzglas wirkt doppelt: g-Kappung in S_vorh + S3 in S_zul", () => {
    const r = sonneneintrag(raum, { klimaregion: "B", bauart: "schwer", nachtlueftung: "ohne", fc: 1, sonnenschutzglas: true });
    near(r.sVorh, (4 * 0.4) / 20, 1e-9, "g auf 0,4 gekappt");
    near(r.anteile.s3, 0.03, 1e-9, "S3");
    assert.equal(r.ueberschreitung, false);
  });

  it("Nordfenster geben den S5-Bonus (0,10·f_nord)", () => {
    const nordRaum = { flaeche: 20, fWG: 0.2, fenster: [{ flaeche: 4, g: 0.6, azimut: 0 }] };
    const r = sonneneintrag(nordRaum, { klimaregion: "B", bauart: "schwer", nachtlueftung: "ohne", fc: 1 });
    near(r.anteile.s5, 0.10, 1e-9, "f_nord = 1");
  });

  it("S1-Tabelle und S2-Formel entsprechen der Quelle (Stichproben)", () => {
    assert.equal(S1_WOHN.ohne.leicht[0], 0.071);
    assert.equal(S1_WOHN.hoch.schwer[2], 0.160);
    assert.equal(S2_WOHN.a, 0.060);
    assert.equal(S2_WOHN.b, 0.231);
  });

  it("leerer Raum / Fläche 0 → nicht anwendbar, keine NaN", () => {
    const r = sonneneintrag({ flaeche: 0, fenster: [] }, {});
    assert.equal(r.anwendbar, false);
    assert.equal(Number.isFinite(r.sVorh), true);
  });
});

describe("Klimaregion & Bauart", () => {
  it("Klimaregion aus dem Höchstwert der Monatsmittel (16,5/18-Grenzen)", () => {
    const monate = (max) => [{ temp: 2 }, { temp: max }, { temp: 10 }];
    assert.equal(klimaregionAusKlima(monate(16.4)), "A");
    assert.equal(klimaregionAusKlima(monate(17.0)), "B");
    assert.equal(klimaregionAusKlima(monate(18.0)), "C");
    assert.equal(klimaregionAusKlima([{ temp: null }]), null);
    assert.equal(klimaregionAusKlima([]), null);
  });

  it("Bauart-Vorschlag aus dem Hüll-Composite", () => {
    assert.equal(bauartVorschlag("timber"), "leicht");
    assert.equal(bauartVorschlag("cavity"), "schwer");
    assert.equal(bauartVorschlag(null), "mittel");
  });
});

describe("raumklimaChecks (pass/warn/offen — nie fail)", () => {
  it("ohne Räume: offen mit Zeichen-Hinweis", () => {
    const c = raumklimaChecks({ geschosse: new Map() });
    assert.equal(c.ampel, "offen");
    assert.match(c.items[0].detail, /Zone-Werkzeug/);
  });

  it("Geschoss-Ampeln + ohneRaum-Warnung, nie fail", () => {
    const z = fensterZuRaeumen({
      fenster: [fensterSued, fensterNord, { ...fensterSued, level: 1 }],
      waende: [...waende(0), ...waende(1)], zonen: ZONEN,
    });
    const s = screeningJeGeschoss({ proRaum: z.proRaum, storeys: 4 });
    const c = raumklimaChecks({
      geschosse: s.geschosse, ohneRaum: z.ohneRaum,
      optionen: { klimaregion: "B", bauart: "schwer", nachtlueftung: "erhoeht", fc: 1 },
    });
    assert.ok(c.items.some((i) => i.key === "ohne-raum" && i.status === "warn"));
    assert.ok(c.items.every((i) => i.status !== "fail"), "fail ist tabu");
    // EG: kritischster Raum ist freigestellt (f_WG 7 %) → pass
    const eg = c.items.find((i) => i.key === "geschoss-0");
    assert.equal(eg.status, "pass");
  });

  // Regression (Review 45, major): das Kennwert-Ranking (Nordfenster ×0,3) ist
  // kein Majorant für S_vorh−S_zul — der Nachweis muss über ALLE nicht
  // freigestellten Räume laufen, nicht nur über raeume[0].
  it("Nord-Raum überschreitet, obwohl Süd-Raum im Kennwert vorne liegt → warn", () => {
    const optionen = { klimaregion: "B", bauart: "mittel", nachtlueftung: "erhoeht", fc: 1 };
    // X: 1,5 m² Süd in 10 m² — kennwert 0,15, S_vorh 0,09 ≤ S_zul 0,128 → pass
    const suedRaum = {
      name: "Süd-Raum", level: 0, flaeche: 10, fWG: 0.15, nachweisFrei: false,
      kennwert: 0.15, fenster: [{ flaeche: 1.5, g: 0.6, azimut: 180 }],
    };
    // Y: 4,0 m² Nord in 10 m² — kennwert 0,12 (rangiert hinter X),
    // aber S_vorh 0,24 > S_zul 0,171 → Überschreitung
    const nordRaum = {
      name: "Nord-Raum", level: 0, flaeche: 10, fWG: 0.4, nachweisFrei: false,
      kennwert: 0.12, fenster: [{ flaeche: 4, g: 0.6, azimut: 0 }],
    };
    const c = raumklimaChecks({ geschosse: new Map([[0, [suedRaum, nordRaum]]]), optionen });
    const eg = c.items.find((i) => i.key === "geschoss-0");
    assert.equal(eg.status, "warn", "Nord-Raum-Überschreitung darf nicht hinter dem Ranking verschwinden");
    assert.match(eg.label, /Nord-Raum/, "ausgewiesen wird der ungünstigste Raum");
  });

  it("Top-Raum nachweisfrei, zweiter Raum überschreitet → warn (nicht pass)", () => {
    const optionen = { klimaregion: "B", bauart: "mittel", nachtlueftung: "erhoeht", fc: 1 };
    const frei = {
      name: "Kleinfenster", level: 0, flaeche: 10, fWG: 0.09, nachweisFrei: true,
      kennwert: 0.2, fenster: [{ flaeche: 0.9, g: 0.6, azimut: 180 }],
    };
    const schlecht = {
      name: "Nord-Raum", level: 0, flaeche: 10, fWG: 0.4, nachweisFrei: false,
      kennwert: 0.12, fenster: [{ flaeche: 4, g: 0.6, azimut: 0 }],
    };
    const c = raumklimaChecks({ geschosse: new Map([[0, [frei, schlecht]]]), optionen });
    const eg = c.items.find((i) => i.key === "geschoss-0");
    assert.equal(eg.status, "warn");
    assert.match(eg.label, /Nord-Raum/);
  });
});
