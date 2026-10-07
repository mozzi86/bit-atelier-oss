// Unit-Tests für packages/nova-designer/src/lib/schallschutzPlan.js (Phase 39).
//
// Handgerechnete Referenzen:
// - mischRw(55, 33, 24, 6): τ = (24·10^-5,5 + 6·10^-3,3)/30 = 1,02767e-4
//   → R'w,res = −10·log10(τ) = 39,88 dB
// - Fassade Süd (Rechteck 10×8, 2 Geschosse à 3 m, Kante 10 m → A_ges 60 m²,
//   Fenster 12 m²): gleiche 4:1-Mischung → 39,88 dB < erf 40 dB (Bereich IV,
//   70 dB(A), wohnen) → warn
// - Adjazenz: zwei 4×4-Zonen teilen die Kante x=4 über 4 m → 1 wohnungstrennendes
//   Segment, Anforderung 53 dB (57 dB, wenn eine Seite "laut")
//
// Diese Tests dokumentieren Richtwerte. Kein Nachweis nach DIN 4109.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  PLAN_RAUMARTEN, RAUMART_REIHE, RW_LAUT, RW_FENSTER_DEFAULT,
  zoneKey, weKey, effektiveRaumart, adjazenzKey, segmentUeberlappung, zonenAdjazenzen,
  sektor4, mischRw, fassadenBewertung, schallPlanChecks, rwUebernahme,
} from "@designer/lib/schallschutzPlan";
import { TRENN_RICHTWERTE } from "@designer/lib/acoustics";

const near = (actual, expected, tol, msg) =>
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${msg || ""}: ${actual} weicht von ${expected} um mehr als ${tol} ab`,
  );

// Rechteck 10×8 m um den Ursprung (wie raumklima.test.js); edge 0 = Nord.
const P = [{ x: -5, z: -4 }, { x: 5, z: -4 }, { x: 5, z: 4 }, { x: -5, z: 4 }];
const waende = P.map((a, i) => ({ a, b: P[(i + 1) % 4], level: 0, edge: i }));

const ZONE_A = {
  name: "Typ A 0-1 ·W", level: 0,
  points: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }, { x: 0, z: 4 }],
};
const ZONE_B = {
  name: "Typ A 0-2 ·W", level: 0,
  points: [{ x: 4, z: 0 }, { x: 8, z: 0 }, { x: 8, z: 4 }, { x: 4, z: 4 }],
};

describe("Schlüssel & Segment-Geometrie", () => {
  it("weKey entfernt NUR das strikte ·W-Suffix", () => {
    assert.equal(weKey("Typ A 0-1 ·W"), "Typ A 0-1");
    assert.equal(weKey("Wohnen"), "Wohnen");
    assert.equal(weKey("Trakt·West"), "Trakt·West");
  });

  it("zoneKey = level:name, adjazenzKey reihenfolgeunabhängig", () => {
    assert.equal(zoneKey(ZONE_A), "0:Typ A 0-1 ·W");
    assert.equal(adjazenzKey("b", "a"), adjazenzKey("a", "b"));
  });

  it("segmentUeberlappung: kollineares Teilstück, sonst null", () => {
    const u = segmentUeberlappung({ x: 0, z: 0 }, { x: 8, z: 0 }, { x: 3, z: 0 }, { x: 12, z: 0 });
    near(u.laenge, 5, 1e-9, "Überlappung 3..8");
    near(u.p1.x, 3, 1e-9, "Start");
    near(u.p2.x, 8, 1e-9, "Ende");
    // nicht kollinear / zu weit weg / zu kurz → null
    assert.equal(segmentUeberlappung({ x: 0, z: 0 }, { x: 8, z: 0 }, { x: 0, z: 1 }, { x: 8, z: 1 }), null);
    assert.equal(segmentUeberlappung({ x: 0, z: 0 }, { x: 8, z: 0 }, { x: 2, z: 0 }, { x: 2, z: 5 }), null);
    assert.equal(segmentUeberlappung({ x: 0, z: 0 }, { x: 8, z: 0 }, { x: 7.8, z: 0 }, { x: 12, z: 0 }), null);
  });
});

describe("Wand-Adjazenz WE↔WE (SCHALL-03)", () => {
  it("zwei Wohnungs-Zonen teilen 4 m Kante → wohnungstrennend 53 dB", () => {
    const adj = zonenAdjazenzen({ zonen: [ZONE_A, ZONE_B] });
    const relevante = adj.filter((a) => a.relevant);
    assert.equal(relevante.length, 1);
    near(relevante[0].laenge, 4, 1e-9, "gemeinsame Kante");
    assert.equal(relevante[0].anforderung, TRENN_RICHTWERTE.wand_wohnungstrennend);
  });

  it("Raumart 'laut' hebt die Anforderung auf 57 dB", () => {
    const laut = zonenAdjazenzen({
      zonen: [ZONE_A, ZONE_B],
      raumarten: { [zoneKey(ZONE_B)]: "laut" },
    }).filter((a) => a.relevant);
    assert.equal(laut[0].anforderung, RW_LAUT);
  });

  it("gemeinsamer Hausflur/Treppenraum (andere WE) bleibt wohnungstrennend mit 53 dB", () => {
    // ZONE_B als gemeinsamer Erschließungsflur markiert (anderer weKey als
    // ZONE_A) — DIN 4109-1 Tab. 2 fordert für Wände neben Hausfluren/
    // Treppenräumen 53 dB; die frühere pauschale Flur-Ausnahme strich das.
    const flur = zonenAdjazenzen({
      zonen: [ZONE_A, ZONE_B],
      raumarten: { [zoneKey(ZONE_B)]: "flur" },
    }).filter((a) => a.relevant);
    assert.equal(flur.length, 1, "Hausflur-Adjazenz bleibt relevant");
    assert.equal(flur[0].anforderung, TRENN_RICHTWERTE.wand_wohnungstrennend);
    assert.equal(flur[0].flur, true, "als Flur/Treppenraum markiert (Plan-Label)");
  });

  it("intra-WE-Flur (gleicher weKey) ist NICHT wohnungstrennend", () => {
    // Manuell gezeichneter Flur derselben WE: Name ohne ·W-Suffix, aber
    // gleicher weKey wie die Wohnungsplaner-Zone "Typ A 0-1 ·W".
    const flurA = { name: "Typ A 0-1", level: 0, points: ZONE_B.points };
    const adj = zonenAdjazenzen({
      zonen: [ZONE_A, flurA],
      raumarten: { [zoneKey(flurA)]: "flur" },
    }).filter((a) => a.relevant);
    assert.equal(adj.length, 0, "Flur der eigenen WE bleibt ausgenommen");
  });

  it("kein perverser Effekt mehr: Default 'wohnen' und korrektes 'flur' fordern gleich", () => {
    // Vorher: Flur auf Default "wohnen" → 53 dB gefordert; korrektes
    // Umschalten auf "F" ENTFERNTE die Anforderung. Jetzt identisch.
    const alsWohnen = zonenAdjazenzen({ zonen: [ZONE_A, ZONE_B] }).filter((a) => a.relevant);
    const alsFlur = zonenAdjazenzen({
      zonen: [ZONE_A, ZONE_B],
      raumarten: { [zoneKey(ZONE_B)]: "flur" },
    }).filter((a) => a.relevant);
    assert.equal(alsFlur.length, alsWohnen.length);
    assert.equal(alsFlur[0].anforderung, alsWohnen[0].anforderung);
  });

  it("degenerierte 2-Punkt-Zone erzeugt keine (doppelten) Segmente", () => {
    // Eine 2-Punkt-"Zone" auf der Kante x=4 lieferte früher zwei antiparallele
    // identische Kanten → 2 Segmente / 8 m statt 0. Nur per Import/Handedit
    // erreichbar (der Editor verhindert Zonen < 3 Punkte), trotzdem geguardet.
    const strich = { name: "Strich ·W", level: 0, points: [{ x: 4, z: 0 }, { x: 4, z: 4 }] };
    assert.equal(zonenAdjazenzen({ zonen: [ZONE_A, strich] }).length, 0);
    // Und die 4-Punkt-Nachbarzone gegen den Strich ebenso keine Duplikate:
    assert.equal(zonenAdjazenzen({ zonen: [strich, ZONE_A] }).length, 0);
  });

  it("ausgenommene Adjazenz (gleiche WE per Klick) bleibt gelistet, aber markiert", () => {
    const key = adjazenzKey(zoneKey(ZONE_A), zoneKey(ZONE_B));
    const adj = zonenAdjazenzen({ zonen: [ZONE_A, ZONE_B], ausgenommen: [key] });
    const seg = adj.find((a) => a.relevant);
    assert.equal(seg.ausgenommen, true);
  });

  it("verschiedene Geschosse berühren sich nicht", () => {
    const og = { ...ZONE_B, level: 1 };
    assert.equal(zonenAdjazenzen({ zonen: [ZONE_A, og] }).length, 0);
  });
});

describe("Fassade (SCHALL-04)", () => {
  it("sektor4: Azimut → N/O/S/W", () => {
    assert.equal(sektor4(0), "N");
    assert.equal(sektor4(90), "O");
    assert.equal(sektor4(180), "S");
    assert.equal(sektor4(270), "W");
    assert.equal(sektor4(44), "N");
    assert.equal(sektor4(46), "O");
  });

  it("mischRw: Handrechnung 55/33 dB bei 4:1-Fläche → 39,88 dB; ohne Fenster = Wand", () => {
    near(mischRw(55, 33, 24, 6), 39.88, 0.05, "Mischung");
    near(mischRw(55, RW_FENSTER_DEFAULT, 30, 0), 55, 1e-9, "ohne Fenster");
    assert.equal(mischRw(55, 33, 0, 0), 0, "keine Fläche → 0 (offen)");
  });

  it("fassadenBewertung: Süd mit Fensteranteil kippt auf warn, Nord/West pass", () => {
    const fassaden = fassadenBewertung({
      waende, fensterJeKante: { 2: 12 },
      pegel: { N: 55, O: 60, S: 70, W: 75 },
      storeys: 2, storeyHeight: 3, rwWand: 55, rwFenster: 33, raumart: "wohnen",
    });
    const nord = fassaden.find((f) => f.edge === 0);
    assert.equal(nord.sektor, "N");
    assert.equal(nord.erf, 30, "Bereich I wohnen");
    assert.equal(nord.status, "pass");

    const sued = fassaden.find((f) => f.edge === 2);
    assert.equal(sued.sektor, "S");
    assert.equal(sued.erf, 40, "70 dB(A) → Bereich IV wohnen");
    near(sued.rwRes, 39.88, 0.05, "R'w,res mit 20 % Fensteranteil");
    assert.equal(sued.status, "warn");

    const west = fassaden.find((f) => f.edge === 3);
    assert.equal(west.erf, 45, "75 dB(A) → Bereich V wohnen");
    assert.equal(west.status, "pass");
  });

  it("northAngle dreht die Sektor-Zuordnung (Süd wird bei 180° zu Nord)", () => {
    const gedreht = fassadenBewertung({
      waende, pegel: { N: 55, O: 55, S: 55, W: 55 }, northAngle: 180,
      storeys: 1, storeyHeight: 3, rwWand: 55,
    });
    assert.equal(gedreht.find((f) => f.edge === 2).sektor, "N");
  });
});

describe("schallPlanChecks (pass/warn/offen — nie fail)", () => {
  const fassaden = fassadenBewertung({
    waende, fensterJeKante: { 2: 12 },
    pegel: { N: 55, O: 60, S: 70, W: 75 },
    storeys: 2, storeyHeight: 3, rwWand: 55, rwFenster: 33,
  });
  const adj = zonenAdjazenzen({ zonen: [ZONE_A, ZONE_B] });

  it("Süd-Warnung schlägt auf die Ampel durch, nie fail", () => {
    const c = schallPlanChecks({ fassaden, adjazenzen: adj, rwTrennwand: 53 });
    assert.equal(c.ampel, "warn");
    assert.ok(c.items.every((i) => i.status !== "fail"), "fail ist tabu");
    assert.equal(c.items.find((i) => i.key === "fassade-S").status, "warn");
    assert.equal(c.items.find((i) => i.key === "trennwand").status, "pass");
  });

  it("Trennwand unter Anforderung → warn; ohne Adjazenz → offen", () => {
    const c = schallPlanChecks({ fassaden, adjazenzen: adj, rwTrennwand: 51 });
    assert.equal(c.items.find((i) => i.key === "trennwand").status, "warn");
    const leer = schallPlanChecks({ fassaden: [], adjazenzen: [], rwTrennwand: 53 });
    assert.equal(leer.ampel, "offen");
    assert.match(leer.items.find((i) => i.key === "fassade").detail, /Gebäudemodell/);
  });

  it("Raumarten-Katalog: Reihenfolge fürs Klick-Durchschalten vollständig", () => {
    RAUMART_REIHE.forEach((id) => assert.ok(PLAN_RAUMARTEN[id], id));
  });

  it("rwUebernahme rundet konservativ AB (39,88-Referenzfall bleibt unter erf 40)", () => {
    // Math.round(39,88) = 40 machte Plan-"warn" in der klassischen Prüfung
    // zu "pass" — Abrunden auf 0,1 dB hält beide Ampeln konsistent.
    const rwRes = mischRw(55, 33, 48, 12); // = 39,88 dB (Referenz aus dem Kopf der Datei)
    near(rwUebernahme(rwRes), 39.8, 1e-9, "0,1-dB-Abrundung");
    assert.ok(rwUebernahme(rwRes) < 40, "bleibt unter der Anforderung");
    near(rwUebernahme(40.0), 40, 1e-9, "exakte Werte bleiben erhalten");
    assert.ok(rwUebernahme(39.99) < 40, "nie aufrunden");
  });
});

// --- Plan 61-04 Task 2: weKey Zwei-Wege + zonenAdjazenzen-Raumart-Fallback ---

describe("weKey Zwei-Wege-Signatur (D-P61-08, Phase 61)", () => {
  it("Zone-Objekt MIT we-Feld: we gewinnt vor dem Namen", () => {
    // RESEARCH Pitfall 1: mehrere Raum-Zonen derselben WE müssen sich als EINE
    // WE gruppieren — das explizite we-Feld ist die Quelle der Wahrheit.
    assert.equal(weKey({ we: "WE 0-1", name: "Wohnen (WE 0-1) ·WT" }), "WE 0-1");
    assert.equal(weKey({ we: "WE 0-1", name: "Bad (WE 0-1) ·WT" }), "WE 0-1");
  });

  it("Zone-Objekt OHNE we: Namens-Fallback (Schnellmodus-Kompatibilität)", () => {
    // Objekt ohne we-Feld verhält sich wie der reine Name.
    assert.equal(weKey({ name: "Typ A 0-1 ·W" }), "Typ A 0-1");
    assert.equal(weKey({ name: "Wohnen" }), "Wohnen");
  });

  it("String-Eingaben unverändert (Rückwärtskompatibilität, Regressionsanker)", () => {
    // Die drei Bestands-Assertions bleiben byte-gleich gültig.
    assert.equal(weKey("Typ A 0-1 ·W"), "Typ A 0-1");
    assert.equal(weKey("Wohnen"), "Wohnen");
    assert.equal(weKey("Trakt·West"), "Trakt·West");
  });
});

describe("zonenAdjazenzen mit Werkstatt-Raum-Zonen (61-04)", () => {
  // WE A = zwei Raum-Zonen nebeneinander (x 0..4, 4..8), WE B = eine Zone
  // (x 8..12). Alle auf level 0, z 0..3.
  const WOHNEN = { we: "WE 0-1", name: "Wohnen (WE 0-1) ·WT", level: 0,
    points: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 3 }, { x: 0, z: 3 }] };
  const SCHLAFEN = { we: "WE 0-1", name: "Schlafen (WE 0-1) ·WT", level: 0,
    points: [{ x: 4, z: 0 }, { x: 8, z: 0 }, { x: 8, z: 3 }, { x: 4, z: 3 }] };
  const WE_B = { we: "WE 0-2", name: "Wohnung B (WE 0-2) ·WT", level: 0,
    points: [{ x: 8, z: 0 }, { x: 12, z: 0 }, { x: 12, z: 3 }, { x: 8, z: 3 }] };

  it("Innenwände derselben WE sind NICHT wohnungstrennend", () => {
    // Wohnen ↔ Schlafen teilen die Kante bei x=4, haben aber dasselbe we →
    // keine Wohnungstrennwand (Phase-39-Gruppierung bleibt korrekt).
    const adj = zonenAdjazenzen({ zonen: [WOHNEN, SCHLAFEN] });
    const wohnSchlaf = adj.find((a) => a.a.name.includes("Wohnen") && a.b.name.includes("Schlafen"));
    assert.ok(wohnSchlaf, "Adjazenz erkannt");
    assert.equal(wohnSchlaf.relevant, false, "intra-WE-Innenwand nicht wohnungstrennend");
  });

  it("WE↔WE-Grenze IST wohnungstrennend", () => {
    // Schlafen ↔ B teilen die Kante bei x=8, verschiedene we → Trennwand.
    const adj = zonenAdjazenzen({ zonen: [WOHNEN, SCHLAFEN, WE_B] });
    const ab = adj.find((a) => a.a.name.includes("Schlafen") && a.b.name.includes("WE 0-2"));
    assert.ok(ab, "Adjazenz erkannt");
    assert.equal(ab.relevant, true, "WE↔WE-Grenze wohnungstrennend");
  });

  it("Gemischtes Geschoss: Schnellmodus-Zone + Werkstatt-Zone, kein Crash", () => {
    // Schnellmodus-Zone OHNE we-Feld neben Werkstatt-Raum-Zone → weKey-Fallback
    // (Name) vs. we-Feld; verschiedene Einheit → relevant, kein Wurf.
    const schnell = { name: "Typ A 0-1 ·W", level: 0,
      points: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 3 }, { x: 0, z: 3 }] };
    const werk = { we: "WE 0-2", name: "Wohnen (WE 0-2) ·WT", level: 0,
      points: [{ x: 4, z: 0 }, { x: 8, z: 0 }, { x: 8, z: 3 }, { x: 4, z: 3 }] };
    const adj = zonenAdjazenzen({ zonen: [schnell, werk] });
    assert.equal(adj.length, 1, "eine Adjazenz");
    assert.equal(adj[0].relevant, true, "Schnellmodus ↔ Werkstatt wohnungstrennend");
  });

  it("zone.raumart-Fallback: Gewerbe-Raumart ohne Layer-Eintrag", () => {
    // Werkstatt-Zone mit raumart "buero", KEIN Layer-Eintrag → Phase-39-Logik
    // nutzt zone.raumart (buero ist schutzbedürftig → relevant neben Wohnen).
    const buero = { we: "WE 0-9", name: "Büro (WE 0-9) ·WT", level: 0, raumart: "buero",
      points: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 3 }, { x: 0, z: 3 }] };
    const wohnen = { we: "WE 0-1", name: "Wohnen (WE 0-1) ·WT", level: 0,
      points: [{ x: 4, z: 0 }, { x: 8, z: 0 }, { x: 8, z: 3 }, { x: 4, z: 3 }] };
    const adj = zonenAdjazenzen({ zonen: [buero, wohnen] });
    const bw = adj.find((a) => a.a.name.includes("Büro"));
    assert.ok(bw, "Adjazenz erkannt");
    assert.equal(bw.a.raumart, "buero", "zone.raumart-Fallback greift");
    assert.equal(bw.relevant, true, "buero↔wohnen wohnungstrennend");
  });

  it("expliziter Layer-Eintrag überstimmt zone.raumart", () => {
    // Derselbe Aufbau, aber Layer setzt die Büro-Zone auf "laut" → das Layer
    // gewinnt, zone.raumart wird ignoriert (laut = Quelle, nicht schutzbedürftig).
    const buero = { we: "WE 0-9", name: "Büro (WE 0-9) ·WT", level: 0, raumart: "buero",
      points: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 3 }, { x: 0, z: 3 }] };
    const wohnen = { we: "WE 0-1", name: "Wohnen (WE 0-1) ·WT", level: 0,
      points: [{ x: 4, z: 0 }, { x: 8, z: 0 }, { x: 8, z: 3 }, { x: 4, z: 3 }] };
    const key = zoneKey(buero);
    const adj = zonenAdjazenzen({ zonen: [buero, wohnen], raumarten: { [key]: "laut" } });
    const bw = adj.find((a) => a.a.name.includes("Büro"));
    assert.equal(bw.a.raumart, "laut", "Layer-Eintrag überstimmt zone.raumart");
  });
});

describe("effektiveRaumart — EINE Regel für Rechnung und Plan-Karte (I-03, externe Review 02.09.)", () => {
  const flur = { name: "Flur 0 ·WT", level: 0, raumart: "flur" };
  const links = [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 3 }, { x: 0, z: 3 }];
  const rechts = [{ x: 4, z: 0 }, { x: 8, z: 0 }, { x: 8, z: 3 }, { x: 4, z: 3 }];

  it("Layer-Eintrag gewinnt vor zone.raumart", () => {
    assert.equal(effektiveRaumart({ [zoneKey(flur)]: "laut" }, flur), "laut");
  });

  it("ohne Layer-Eintrag gilt zone.raumart — auch bei fehlender Layer-Map", () => {
    assert.equal(effektiveRaumart({}, flur), "flur");
    assert.equal(effektiveRaumart(undefined, flur), "flur");
  });

  it("ohne beides: wohnen; unbekannte Ids (auch aus dem Layer) fallen auf wohnen zurück (N-09)", () => {
    assert.equal(effektiveRaumart({}, { name: "Raum", level: 0 }), "wohnen");
    assert.equal(effektiveRaumart({}, { ...flur, raumart: "sanitaer" }), "wohnen");
    assert.equal(effektiveRaumart({ [zoneKey(flur)]: "kaputt" }, flur), "wohnen");
    assert.equal(effektiveRaumart({}, undefined), "wohnen");
  });

  it("die zwei Fälle, die OHNE zone.raumart-Fallback kippen (Review-Abschnitt Testqualität, Punkt 3)", () => {
    // laut ↔ wohnen nur über zone.raumart: Anforderung 57 dB statt 53 dB.
    const laut = { we: "WE 0-9", name: "Technik (WE 0-9) ·WT", level: 0, raumart: "laut", points: links };
    const wohnen = { we: "WE 0-1", name: "Wohnen (WE 0-1) ·WT", level: 0, points: rechts };
    const adj = zonenAdjazenzen({ zonen: [laut, wohnen] });
    assert.equal(adj.length, 1);
    assert.equal(adj[0].anforderung, RW_LAUT, "laut über zone.raumart → 57 dB");
    assert.equal(adj[0].a.raumart, "laut", "Ergebnis trägt die effektive Raumart");

    // flur ↔ flur (Werkstatt-Flur neben Werkstatt-Kern, verschiedene Namen =
    // verschiedene weKeys): keine Seite schutzbedürftig → NICHT relevant.
    // Ohne Fallback wären beide "wohnen" und die Adjazenz fälschlich relevant.
    const f1 = { name: "Flur 0 ·WT", level: 0, raumart: "flur", points: links };
    const f2 = { name: "Kern 0 ·WT", level: 0, raumart: "flur", points: rechts };
    const adj2 = zonenAdjazenzen({ zonen: [f1, f2] });
    assert.equal(adj2.length, 1);
    assert.equal(adj2[0].relevant, false, "Flur ↔ Kern nicht wohnungstrennend");
    assert.equal(adj2[0].flur, true);
  });
});
