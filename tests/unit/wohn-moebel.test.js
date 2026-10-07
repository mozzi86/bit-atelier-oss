// Unit-Tests für wohnMoebel.js (75-09, Blatt 07) + Wohn-Gruppe in moebel.js.
//
// Erwartungswerte: 75-09-PLAN.md <behavior> Task 1 (Zeilen 240-257) und die Maßtabelle
// Blatt 07 (Textextrakt :183-193). Koordinaten in Metern; x/y = Item-Mitte, y entspricht
// points[].z der Zone (Konvention moebel.js).
//
// Bewusste, in der SUMMARY dokumentierte Abweichungen vom Plan-<behavior>:
// 1. Esstisch „R" liefert 3,40 × 2,90 m (nicht 2,50): bei R wächst nur die VORDERSEITE
//    auf 1,50, die drei Nebenseiten bleiben 0,80 — 0,90 + 1,50 + 0,80 = 3,20 entlang y,
//    die Plan-Zahl 2,50 ist mit „vorn 1,50, Rest 0,80" rechnerisch nicht erreichbar.
// 2. Schrank (rolle „haupt") wächst in B/R auf 1,20/1,50 (Plan-Zeile 43 „Küchenzeile
//    1,20 / 1,20 / 1,50" gilt wörtlich nur für die Küche; der Schrank folgt der
//    haupt-Regel aus Plan Task 1 A: Stufe B/R aus accessibility.bewegungsflaeche).

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  MOEBEL_KATALOG, WOHN_GRUPPE, moebelById, itemRect, bewegungsflaecheRect,
  kollidiert, snapRaster,
} from "@designer/lib/moebel";
import {
  BEWEGUNG_STUFEN, STUFE_DEFAULT, SEITE_RICHTUNG, bewegungTiefe, bewegungsflaechen,
  tuerAufschlag, rechteckTrifftAufschlag, fensterSegmente, sperrGrund, kollisionSperrend,
  anWandEinrasten, wohnMoebelChecks, bewegungsNachweis, raumTypFuer, personenFuerTyp,
  platziereTyp, platziereTuer, autoMoeblierung, fokusKatalog, AUTO_ID_PREFIX, istAutoItem,
  imRaumTolerant,
} from "@designer/lib/wohnMoebel";
import { tesseliere } from "@designer/lib/tesselierung";
import { einheitenAnreichern } from "@designer/lib/werkstattDefaults";

const nah = (ist, soll, eps = 1e-9, msg = "") =>
  assert.ok(Math.abs(ist - soll) < eps, `${msg}: ${ist} ≠ ${soll} (±${eps})`);

// 6 × 4 m Raum, Ursprung links oben (wie moebel.test.js RAUM).
const RAUM = [{ x: 0, z: 0 }, { x: 6, z: 0 }, { x: 6, z: 4 }, { x: 0, z: 4 }];
const moeb = (typ, x, y, rot = 0, over = {}) => ({ id: `i-${typ}-${x}-${y}`, typ, x, y, rot, ...over });

describe("wohnMoebel — WOHN_GRUPPE (Blatt 07, additiv zu moebel.js)", () => {
  it("16 Typen, ids eindeutig und disjunkt zu MOEBEL_KATALOG, Invarianten wie Bestand", () => {
    assert.equal(WOHN_GRUPPE.gruppe, "Wohnen");
    assert.equal(WOHN_GRUPPE.typen.length, 16);
    const katalogIds = new Set(MOEBEL_KATALOG.flatMap((g) => g.typen.map((t) => t.id)));
    const ids = new Set();
    for (const t of WOHN_GRUPPE.typen) {
      assert.ok(!ids.has(t.id), `doppelte id ${t.id}`);
      ids.add(t.id);
      assert.ok(!katalogIds.has(t.id), `id ${t.id} kollidiert mit MOEBEL_KATALOG`);
      assert.ok(t.b > 0 && t.t > 0, `${t.id}: Maße ${t.b} × ${t.t}`);
      assert.ok(["desk", "chair", "furn", "sanitaer"].includes(t.kategorie), `${t.id}: ${t.kategorie}`);
      assert.equal(typeof t.benutzerseite, "boolean", `${t.id}: benutzerseite`);
      assert.ok(t.name, `${t.id}: kein Name`);
    }
  });

  it("MOEBEL_KATALOG bleibt 5 Gruppen / 15 Typen (Bestandstest unverändert)", () => {
    assert.equal(MOEBEL_KATALOG.length, 5);
    assert.equal(MOEBEL_KATALOG.flatMap((g) => g.typen).length, 15);
  });

  it("Maße gepinnt (Blatt 07 :184-193)", () => {
    const mass = (id) => { const t = moebelById(id); return [t.b, t.t]; };
    assert.deepEqual(mass("doppelbett"), [1.8, 2.0]);
    assert.deepEqual(mass("einzelbett"), [0.9, 2.0]);
    // Schrank n × 0,50 breit, 0,60 tief, n = 2…6:
    assert.deepEqual(mass("schrank_100"), [1.0, 0.6]);
    assert.deepEqual(mass("schrank_150"), [1.5, 0.6]);
    assert.deepEqual(mass("schrank_200"), [2.0, 0.6]);
    assert.deepEqual(mass("schrank_250"), [2.5, 0.6]);
    assert.deepEqual(mass("schrank_300"), [3.0, 0.6]);
    assert.deepEqual(mass("sofa_3"), [2.2, 0.9]);
    assert.deepEqual(mass("esstisch_4"), [1.2, 0.8]);
    assert.deepEqual(mass("esstisch_6"), [1.8, 0.9]);
    assert.deepEqual(mass("kuechenzeile_300"), [3.0, 0.6]);
    assert.deepEqual(mass("schreibtisch_kind"), [1.2, 0.6]);
    // Türen (D-P75-09-A, 23.09.2026): b = Rohbaumaß 0,885 / 1,010; lichte_m = Rohbau − 0,025
    // (DIN-18100-Reihe 885 → 860, 1010 → 985 mm).
    assert.deepEqual(mass("tuer_885"), [0.885, 0.1]);
    assert.deepEqual(mass("tuer_1010"), [1.01, 0.1]);
    nah(moebelById("tuer_885").tuer.lichte_m, 0.86);
    nah(moebelById("tuer_1010").tuer.lichte_m, 0.985);
  });

  it("moebelById kennt alle 16 Wohn-Typen", () => {
    for (const t of WOHN_GRUPPE.typen) {
      assert.equal(moebelById(t.id)?.name, t.name, `moebelById(${t.id})`);
    }
  });
});

describe("wohnMoebel — bewegungsflaecheRect(item, stufe?) additiv", () => {
  const tisch = { id: "a", typ: "schreibtisch", x: 2, y: 1, rot: 0 };
  it("ohne Stufe byte-gleich (moebel.test.js:124-Literal)", () => {
    assert.deepEqual(bewegungsflaecheRect(tisch), { x: 1.2, y: 1.4, w: 1.6, h: 1 });
  });
  it("Stufe B ⇒ h 1,2; Stufe R ⇒ h 1,5; standard/unbekannt ⇒ h 1", () => {
    assert.equal(bewegungsflaecheRect(tisch, "B").h, 1.2);
    assert.equal(bewegungsflaecheRect(tisch, "R").h, 1.5);
    assert.equal(bewegungsflaecheRect(tisch, "standard").h, 1);
    assert.equal(bewegungsflaecheRect(tisch, "quatsch").h, 1);
  });
});

describe("wohnMoebel — SEITE_RICHTUNG / bewegungTiefe", () => {
  it("Seiten-Tabelle (Plan Task 1 <behavior>)", () => {
    assert.deepEqual(SEITE_RICHTUNG[0], { vorn: "+y", hinten: "−y", links: "−x", rechts: "+x" });
    assert.deepEqual(SEITE_RICHTUNG[90], { vorn: "−x", hinten: "+x", links: "−y", rechts: "+y" });
    assert.deepEqual(SEITE_RICHTUNG[180], { vorn: "−y", hinten: "+y", links: "+x", rechts: "−x" });
    assert.deepEqual(SEITE_RICHTUNG[270], { vorn: "+x", hinten: "−x", links: "+y", rechts: "−y" });
  });
  it("vorn deckungsgleich mit bewegungsflaecheRect (alle 4 Rotationen)", () => {
    // Schreibtisch hat benutzerseite ⇒ ASR-Band = vorn; bewegungsflaechen liefert dasselbe
    // Rechteck (bewegungsflaechen rundet auf 1e-12 gegen Float-Rauschen ⇒ Toleranzvergleich).
    for (const rot of [0, 90, 180, 270]) {
      const tisch = { id: "a", typ: "schreibtisch", x: 3, y: 2, rot };
      const band = bewegungsflaechen(tisch, "standard")[0];
      const ref = bewegungsflaecheRect(tisch);
      nah(band.x, ref.x, 1e-9, `rot ${rot} x`);
      nah(band.y, ref.y, 1e-9, `rot ${rot} y`);
      nah(band.w, ref.w, 1e-9, `rot ${rot} w`);
      nah(band.h, ref.h, 1e-9, `rot ${rot} h`);
      assert.equal(band.seite, "vorn");
    }
  });
  it("BEWEGUNG_STUFEN / STUFE_DEFAULT", () => {
    assert.deepEqual(BEWEGUNG_STUFEN, ["standard", "B", "R"]);
    assert.equal(STUFE_DEFAULT, "standard");
  });
  it("bewegungTiefe: haupt wächst mit B/R, fest bleibt", () => {
    assert.equal(bewegungTiefe({ rolle: "haupt", standard: 0.9 }, "standard"), 0.9);
    assert.equal(bewegungTiefe({ rolle: "haupt", standard: 0.9 }, "B"), 1.2);
    assert.equal(bewegungTiefe({ rolle: "haupt", standard: 0.9 }, "R"), 1.5);
    assert.equal(bewegungTiefe({ rolle: "fest", standard: 0.8 }, "R"), 0.8);
  });
});

describe("wohnMoebel — bewegungsflaechen (Blatt 07)", () => {
  it("Doppelbett bei (2,2) rot 0: EINE Längsseite 0,90 (Plan-Literal)", () => {
    const bett = moeb("doppelbett", 2, 2);
    assert.deepEqual(bewegungsflaechen(bett, "standard"), [{ x: 0.2, y: 1, w: 0.9, h: 2, seite: "links", tiefe: 0.9 }]);
  });
  it("Bett Stufe B ⇒ w 1,2 (x = 1,1 − 1,2 = −0,1); Stufe R ⇒ w 1,5", () => {
    const bett = moeb("doppelbett", 2, 2);
    const b = bewegungsflaechen(bett, "B")[0];
    nah(b.x, -0.1); assert.equal(b.w, 1.2);
    const r = bewegungsflaechen(bett, "R")[0];
    assert.equal(r.w, 1.5);
  });
  it("Bett rot 90 ⇒ Rechteck oberhalb (−y): Plan-Literal { x:1, y:0.2, w:2, h:0.9 }", () => {
    const bett = moeb("doppelbett", 2, 2, 90);
    assert.deepEqual(bewegungsflaechen(bett, "standard"), [{ x: 1, y: 0.2, w: 2, h: 0.9, seite: "links", tiefe: 0.9 }]);
  });
  it("Esstisch rundum 0,80: Vereinigungs-Bbox 2,80 × 2,40 (4er) bzw. 3,40 × 2,50 (6er) — Blatt 07 :188", () => {
    const bbox = (items, stufe) => {
      const fl = bewegungsflaechen(items, stufe);
      const mitKoerper = [...fl, itemRect(items)];
      const x0 = Math.min(...mitKoerper.map((r) => r.x));
      const y0 = Math.min(...mitKoerper.map((r) => r.y));
      const x1 = Math.max(...mitKoerper.map((r) => r.x + r.w));
      const y1 = Math.max(...mitKoerper.map((r) => r.y + r.h));
      return [nah2(x1 - x0), nah2(y1 - y0)];
    };
    const nah2 = (v) => Math.round(v * 100) / 100;
    assert.deepEqual(bbox(moeb("esstisch_4", 3, 2), "standard"), [2.8, 2.4]);
    assert.deepEqual(bbox(moeb("esstisch_6", 3, 2), "standard"), [3.4, 2.5]);
  });
  it("Esstisch bei R: nur vorn 1,50, Nebenseiten bleiben 0,80 ⇒ Bbox 3,40 × 2,90 (Abweichung 1, s. Kopf)", () => {
    const t6 = moeb("esstisch_6", 3, 2);
    const fl = bewegungsflaechen(t6, "R");
    const vorn = fl.find((f) => f.seite === "vorn");
    assert.equal(vorn.tiefe, 1.5);
    for (const s of ["hinten", "links", "rechts"]) {
      assert.equal(fl.find((f) => f.seite === s).tiefe, 0.8);
    }
    // Bbox: 1,80 + 0,80 + 0,80 = 3,40 (x); 0,90 + 1,50 + 0,80 = 3,20 … Korrektur:
    // 0,80 + 0,90 + 1,50 = 3,20 entlang y. Plan nennt 2,50 — rechnerisch unmöglich
    // (0,80+0,90+1,50). Gemessen wird die tatsächliche Vereinigung.
    const r = itemRect(t6);
    const alle = [...fl, r];
    const x0 = Math.min(...alle.map((q) => q.x)), x1 = Math.max(...alle.map((q) => q.x + q.w));
    const y0 = Math.min(...alle.map((q) => q.y)), y1 = Math.max(...alle.map((q) => q.y + q.h));
    nah(x1 - x0, 3.4, 1e-9, "bbox x");
    nah(y1 - y0, 3.2, 1e-9, "bbox y");
  });
  it("Küchenzeile vorn: standard 1,20 · B 1,20 · R 1,50 (Blatt 07 :189)", () => {
    const k = moeb("kuechenzeile_300", 3, 2);
    assert.equal(bewegungsflaechen(k, "standard")[0].tiefe, 1.2);
    assert.equal(bewegungsflaechen(k, "B")[0].tiefe, 1.2);
    assert.equal(bewegungsflaechen(k, "R")[0].tiefe, 1.5);
  });
  it("Typ ohne bewegung: benutzerseite ⇒ ASR-Band (Schreibtisch), ohne ⇒ [] (Bürostuhl)", () => {
    const tisch = { id: "a", typ: "schreibtisch", x: 2, y: 1, rot: 0 };
    assert.deepEqual(
      bewegungsflaechen(tisch, "standard").map(({ x, y, w, h }) => ({ x, y, w, h })),
      [bewegungsflaecheRect(tisch)],
    );
    const b = bewegungsflaechen(tisch, "B")[0];
    nah(b.h, 1.2);
    assert.deepEqual(bewegungsflaechen({ id: "s", typ: "buerostuhl", x: 1, y: 1, rot: 0 }, "standard"), []);
  });
  it("unbekannter Typ ⇒ []", () => {
    assert.deepEqual(bewegungsflaechen({ id: "x", typ: "gibtsnicht", x: 0, y: 0, rot: 0 }, "standard"), []);
  });
});

describe("wohnMoebel — tuerAufschlag / rechteckTrifftAufschlag (MSB-14)", () => {
  it("tuer_885 bei (2,0) rot 0 links: Plan-Literale (Scharnier, Blattenden, aabb)", () => {
    const tuer = { id: "t", typ: "tuer_885", x: 2, y: 0, rot: 0, aufschlag: "links" };
    const a = tuerAufschlag(tuer);
    nah(a.scharnier.x, 1.5575); nah(a.scharnier.y, 0);
    nah(a.geschlossen.x, 2.4425); nah(a.geschlossen.y, 0);
    nah(a.offen.x, 1.5575); nah(a.offen.y, 0.885);
    nah(a.aabb.x, 1.5575); nah(a.aabb.y, 0); nah(a.aabb.w, 0.885); nah(a.aabb.h, 0.885);
    nah(a.radius, 0.885);
    assert.equal(a.bogen.length, 9);
    for (const p of a.bogen) {
      nah(Math.hypot(p.x - a.scharnier.x, p.y - a.scharnier.y), 0.885, 1e-9, "Bogenpunkt-Radius");
    }
    // Bogen-Endpunkte = geschlossenes/offenes Blattende:
    nah(a.bogen[0].x, a.geschlossen.x); nah(a.bogen[0].y, a.geschlossen.y);
    nah(a.bogen[8].x, a.offen.x, 1e-9); nah(a.bogen[8].y, a.offen.y, 1e-9);
  });
  it("aufschlag rechts ⇒ Scharnier (2,4425; 0); Default links", () => {
    const a = tuerAufschlag({ id: "t", typ: "tuer_885", x: 2, y: 0, rot: 0, aufschlag: "rechts" });
    nah(a.scharnier.x, 2.4425); nah(a.scharnier.y, 0);
    const d = tuerAufschlag({ id: "t", typ: "tuer_885", x: 2, y: 0, rot: 0 });
    nah(d.scharnier.x, 1.5575);
  });
  it("rot 180 ⇒ Aufschlag nach −y", () => {
    const a = tuerAufschlag({ id: "t", typ: "tuer_885", x: 2, y: 2, rot: 180, aufschlag: "links" });
    assert.ok(a.offen.y < a.scharnier.y, `offen.y ${a.offen.y} < scharnier.y ${a.scharnier.y}`);
    nah(a.offen.y, 2 - 0.885);
  });
  it("Nicht-Tür ⇒ null", () => {
    assert.equal(tuerAufschlag(moeb("doppelbett", 2, 2)), null);
    assert.equal(tuerAufschlag({ id: "x", typ: "gibtsnicht", x: 0, y: 0, rot: 0 }), null);
  });
  it("rechteckTrifftAufschlag: Viertelkreis trifft, AABB-Ecke außerhalb des Radius nicht", () => {
    const a = tuerAufschlag({ id: "t", typ: "tuer_885", x: 2, y: 0, rot: 0, aufschlag: "links" });
    // Rechteck mitten im Viertelkreis:
    assert.equal(rechteckTrifftAufschlag({ x: 1.7, y: 0.1, w: 0.3, h: 0.3 }, a), true);
    // AABB ist x 1,5575…2,4425 / y 0…0,885; gegenüberliegende Ecke vom Scharnier = (2,4425; 0,885),
    // Abstand = 1,2516 > 0,885 ⇒ kleines Rechteck dort trifft NICHT:
    assert.equal(rechteckTrifftAufschlag({ x: 2.35, y: 0.79, w: 0.09, h: 0.09 }, a), false);
    // Rechteck ganz außerhalb der AABB:
    assert.equal(rechteckTrifftAufschlag({ x: 5, y: 5, w: 0.4, h: 0.4 }, a), false);
  });
});

describe("wohnMoebel — fensterSegmente", () => {
  it("nur kind window, Felder a/b bleiben", () => {
    const oeff = [
      { kind: "window", a: { x: 0, z: 0 }, b: { x: 1, z: 0 }, width: 1, quelle: "huelle" },
      { kind: "door", a: { x: 2, z: 0 }, b: { x: 3, z: 0 }, width: 1, quelle: "huelle" },
    ];
    assert.deepEqual(fensterSegmente(oeff), [{ a: { x: 0, z: 0 }, b: { x: 1, z: 0 } }]);
    assert.deepEqual(fensterSegmente(null), []);
  });
});

describe("wohnMoebel — sperrGrund / kollisionSperrend (Blockade nur im Fokus)", () => {
  it("zwei überlappende Möbel ⇒ kollision mit mitId; Kante an Kante ⇒ null", () => {
    const a = moeb("sofa_3", 2, 2);
    const b = moeb("couchtisch", 2.5, 2);
    const s = sperrGrund([a], b, RAUM);
    assert.equal(s.grund, "kollision");
    assert.equal(s.mitId, a.id);
    // Kante an Kante: Sofa x 0,9…3,1, Couchtisch daneben x 3,1…4,1:
    const c = moeb("couchtisch", 3.6, 2);
    assert.equal(sperrGrund([a], c, RAUM), null);
  });
  it("das Möbel selbst (gleiche id) kollidiert nie mit sich", () => {
    const a = moeb("sofa_3", 2, 2);
    assert.equal(sperrGrund([a], { ...a, x: 2.05 }, RAUM), null);
  });
  it("Möbel ragt aus dem Polygon ⇒ ausserhalb", () => {
    const s = sperrGrund([], moeb("doppelbett", 5.9, 2), RAUM);
    assert.equal(s.grund, "ausserhalb");
  });
  it("Tür halb außerhalb, aber auf einer Raumkante ⇒ null (Türen sitzen in der Wand)", () => {
    const tuer = { id: "t", typ: "tuer_885", x: 3, y: 0, rot: 0, aufschlag: "links" }; // Mittellinie auf y=0
    assert.equal(sperrGrund([], tuer, RAUM), null);
  });
  it("Tür 1 m im Raum ⇒ tuer_nicht_an_wand", () => {
    const tuer = { id: "t", typ: "tuer_885", x: 3, y: 1, rot: 0, aufschlag: "links" };
    const s = sperrGrund([], tuer, RAUM);
    assert.equal(s.grund, "tuer_nicht_an_wand");
  });
  it("schrank_200 mit Rücken an einem Fenstersegment ⇒ vor_fenster; Sofa dort ⇒ null", () => {
    // Fenster in der Nordwand (y=0) von x 2…3; Schrank bündig an der Nordwand darüber:
    const fenster = [{ a: { x: 2, z: 0 }, b: { x: 3, z: 0 } }];
    const schrank = { id: "s", typ: "schrank_200", x: 2.5, y: 0.3, rot: 0 };
    assert.equal(sperrGrund([], schrank, RAUM, { fenster }).grund, "vor_fenster");
    const sofa = { id: "f", typ: "sofa_3", x: 2.5, y: 0.45, rot: 0 };
    assert.equal(sperrGrund([], sofa, RAUM, { fenster }), null);
  });
  it("kollisionSperrend ist die Boolesche Form", () => {
    const a = moeb("sofa_3", 2, 2);
    assert.equal(kollisionSperrend([a], moeb("couchtisch", 2.5, 2), RAUM), true);
    assert.equal(kollisionSperrend([a], moeb("couchtisch", 4, 2), RAUM), false);
  });
  it("jeder Treffer hat deutschen Text (Lib-Konvention wie moebelChecks)", () => {
    const s = sperrGrund([], moeb("doppelbett", 5.9, 2), RAUM);
    assert.ok(typeof s.text === "string" && s.text.length > 5);
  });
});

describe("wohnMoebel — anWandEinrasten (Blatt 07 :198 Rückseite bündig)", () => {
  it("Schrank 0,10 m vor der Nordwand ⇒ bündig (y = t/2); Ergebnis gerastert", () => {
    const schrank = { id: "s", typ: "schrank_200", x: 3, y: 0.4, rot: 0 }; // Unterkante y 0,1
    const out = anWandEinrasten(schrank, RAUM);
    nah(out.y, 0.3, 1e-9, "bündig y = t/2");
    nah(out.x, 3);
    assert.equal(out.y, snapRaster(out.y));
  });
  it("0,30 m Abstand ⇒ unverändert (außerhalb des Fangbereichs)", () => {
    const schrank = { id: "s", typ: "schrank_200", x: 3, y: 0.6, rot: 0 }; // Unterkante y 0,3
    const out = anWandEinrasten(schrank, RAUM);
    nah(out.y, 0.6);
  });
  it("Türen werden nie verschoben", () => {
    const tuer = { id: "t", typ: "tuer_885", x: 3, y: 0.4, rot: 0 };
    assert.deepEqual(anWandEinrasten(tuer, RAUM), tuer);
  });
});

describe("wohnMoebel — wohnMoebelChecks (warn, nie fail)", () => {
  it("Bewegungsfläche von A trifft Körper von B ⇒ warn", () => {
    // Schrank rot 0 an der Nordwand, Bewegungsfläche 0,90 nach +y; Bett steht hinein:
    const schrank = { id: "s", typ: "schrank_200", x: 2, y: 0.3, rot: 0 };
    const bett = { id: "b", typ: "doppelbett", x: 2, y: 1.5, rot: 0 };
    const w = wohnMoebelChecks([schrank, bett], RAUM, "standard");
    assert.ok(w.some((x) => x.itemId === "b" && x.art === "bewegungsflaeche"), JSON.stringify(w));
  });
  it("zwei überlappende Bewegungsflächen ⇒ KEINE Warnung (Blatt 07 :199)", () => {
    // Zwei Sofas gegenüber, Bänder überlappen in der Mitte, Körper kollidieren nicht:
    const a = { id: "a", typ: "sofa_3", x: 3, y: 1, rot: 0 };   // Band y 1,45…2,25
    const b = { id: "b", typ: "sofa_3", x: 3, y: 3, rot: 180 }; // Band y 1,75…2,55
    const w = wohnMoebelChecks([a, b], RAUM, "standard");
    assert.deepEqual(w.filter((x) => x.art === "bewegungsflaeche"), []);
  });
  it("Bewegungsfläche reicht über die Wand ⇒ warn", () => {
    // Sofa rot 180 an der Nordwand: Band 0,80 nach −y ⇒ y −0,85…−0,05, über die Wand:
    const sofa = { id: "a", typ: "sofa_3", x: 3, y: 0.45, rot: 180 };
    const w = wohnMoebelChecks([sofa], RAUM, "standard");
    assert.ok(w.some((x) => x.art === "wand"), JSON.stringify(w));
    assert.match(w.find((x) => x.art === "wand").text, /reicht über die Wand/);
  });
  it("Türaufschlag trifft Möbel ⇒ warn „Türaufschlag … trifft …“", () => {
    // Tür in der Nordwand bei x=1 (Scharnier 0,5575), Aufschlag nach +y; Nachttisch im Bogen:
    const tuer = { id: "t", typ: "tuer_885", x: 1, y: 0.05, rot: 0, aufschlag: "links" };
    const tisch = { id: "n", typ: "nachttisch", x: 1, y: 0.5, rot: 0 };
    const w = wohnMoebelChecks([tuer, tisch], RAUM, "standard");
    assert.ok(w.some((x) => x.itemId === "t" && x.art === "tuer_moebel"), JSON.stringify(w));
    assert.match(w.find((x) => x.art === "tuer_moebel").text, /Türaufschlag .* trifft /);
  });
  it("Türaufschlag schneidet fremde Bewegungsfläche ⇒ warn", () => {
    // Tür Nordwand bei x=4,5 (Scharnier 4,0575; Aufschlag x 4,0575…4,9425 / y 0,05…0,935);
    // Schrank rot 90 mit Rücken an der Ostwand (SEITE_RICHTUNG[90].hinten = +x, Körper
    // x 5,4…6,0 / y 0…1,0), Band 0,90 nach −x (vorn) ⇒ x 4,5…5,4 / y 0…1,0 — schneidet die
    // Aufschlag-AABB, nächster Bandpunkt zum Scharnier (4,5; 0,05) liegt 0,4425 < 0,885 entfernt:
    const tuer = { id: "t", typ: "tuer_885", x: 4.5, y: 0.05, rot: 0, aufschlag: "links" };
    const schrank = { id: "s", typ: "schrank_100", x: 5.7, y: 0.5, rot: 90 };
    const w = wohnMoebelChecks([tuer, schrank], RAUM, "standard");
    assert.ok(w.some((x) => x.art === "tuer_bewegung"), JSON.stringify(w));
  });
  it("INVARIANTE: nie fail, immer warn mit itemId/art/text", () => {
    const varianten = [
      [[], RAUM],
      [[moeb("doppelbett", 3, 2)], RAUM],
      [[moeb("doppelbett", 99, 99)], RAUM],
      [[{ id: "x", typ: "gibtsnicht", x: 0, y: 0, rot: 0 }], RAUM],
      [[{ id: "y", typ: "sofa_3", x: Number.NaN, y: 1, rot: 0 }], RAUM],
      [null, RAUM],
    ];
    for (const [items, polygon] of varianten) {
      for (const w of wohnMoebelChecks(items, polygon, "standard")) {
        assert.equal(w.status, "warn");
        assert.ok(w.itemId && w.art && typeof w.text === "string");
        assert.ok(!/NaN|undefined/.test(w.text), `Platzhalter: ${w.text}`);
      }
    }
  });
});

describe("wohnMoebel — bewegungsNachweis", () => {
  it("anzahl = Summe aller Flächen, frei = anzahl − Flächen mit Konflikt", () => {
    const raum = {
      zone: { name: "Schlafen (WE 0-1) ·WT", points: RAUM },
      items: [
        { id: "s", typ: "schrank_200", x: 2, y: 0.3, rot: 0 },   // 1 Fläche (y 0,6…1,5)
        // Bett Körper y 0,6…2,6: steht in der Fläche von s ⇒ Konflikt; Kante an Kante mit dem
        // Schrank-Körper (y 0,6), und die Bett-Fläche (x 0,2…1,1 / y 0,6…2,6) berührt den
        // Schrank (y ≤ 0,6) nur an der Kante ⇒ KEIN zweiter Konflikt. 1 Fläche.
        { id: "b", typ: "doppelbett", x: 2, y: 1.6, rot: 0 },
      ],
    };
    const n = bewegungsNachweis([raum], "standard");
    assert.equal(n.anzahl, 2);
    assert.equal(n.konflikte.length, 1);
    assert.equal(n.frei, 1);
    assert.equal(n.konflikte[0].raum, "Schlafen"); // Kurzname ohne (WE …) ·WT
    assert.ok(n.konflikte[0].itemId);
    assert.ok(n.konflikte[0].text.length > 5);
  });
  it("leere Eingabe ⇒ { anzahl: 0, frei: 0, konflikte: [] }", () => {
    assert.deepEqual(bewegungsNachweis([], "standard"), { anzahl: 0, frei: 0, konflikte: [] });
  });
});

describe("wohnMoebel — raumTypFuer / personenFuerTyp (Plan-Abweichungen 5/6)", () => {
  it("Schlafen (aufenthalt) ⇒ schlafen · Wohnen/Essen ⇒ wohnen · Kind/Büro ⇒ kind", () => {
    assert.equal(raumTypFuer({ name: "Schlafen (WE 0-1) ·WT", art: "aufenthalt" }), "schlafen");
    assert.equal(raumTypFuer({ name: "Wohnen/Essen (WE 0-1) ·WT", art: "aufenthalt" }), "wohnen");
    assert.equal(raumTypFuer({ name: "Kind/Büro (WE 0-1) ·WT", art: "aufenthalt" }), "kind");
  });
  it("art kueche ⇒ kueche · sanitaer ⇒ bad · flur/abstell ⇒ null", () => {
    assert.equal(raumTypFuer({ name: "Küche (WE 0-1) ·WT", art: "kueche" }), "kueche");
    assert.equal(raumTypFuer({ name: "Bad (WE 0-1) ·WT", art: "sanitaer" }), "bad");
    assert.equal(raumTypFuer({ name: "Flur 0 ·WT", art: "flur" }), null);
    assert.equal(raumTypFuer({ name: "Abstellraum (WE 0-1) ·WT", art: "abstell" }), null);
  });
  it("personenFuerTyp: /nP im Namen, sonst zimmer, sonst 2", () => {
    assert.equal(personenFuerTyp({ name: "3-Zi/3P (Beispielort)" }), 3);
    assert.equal(personenFuerTyp({ zimmer: 4 }), 4);
    assert.equal(personenFuerTyp({}), 2);
    assert.equal(personenFuerTyp(null), 2);
  });
});

describe("wohnMoebel — autoMoeblierung (Blatt 07 :200, deterministisch)", () => {
  const zoneSchlafen = { points: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 3.5 }, { x: 0, z: 3.5 }], level: 0, name: "Schlafen (WE 0-1) ·WT", art: "aufenthalt" };
  const zoneWohnen = { points: [{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 5, z: 4.2 }, { x: 0, z: 4.2 }], level: 0, name: "Wohnen/Essen (WE 0-1) ·WT", art: "aufenthalt" };

  const pruefe = (items, zone) => {
    // imRaumTolerant (5 mm): Auto-Möbel stehen planmäßig BÜNDIG an der Wand (Blatt 07 :198);
    // moebel.imRaum zählt die Max-x/Max-z-Kante des Polygons per Ray-Casting als außen, ein
    // bündiges Möbel an Süd-/Ostwand könnte also nie „im Raum" sein.
    for (const i of items) assert.ok(imRaumTolerant(i, zone.points), `${i.typ} nicht im Raum`);
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        assert.equal(kollidiert(items[i], items[j]), false, `${items[i].typ} ↔ ${items[j].typ}`);
      }
    }
    assert.deepEqual(wohnMoebelChecks(items, zone.points, "standard"), []);
  };

  it("Schlafen 4,00 × 3,50: Bett + 2 Nachttische + Schrank, gültig, deterministisch, auto-Ids", () => {
    const r1 = autoMoeblierung(zoneSchlafen, { personen: 2, stufe: "standard" });
    const typen = r1.items.map((i) => i.typ).sort();
    assert.deepEqual(typen, ["doppelbett", "nachttisch", "nachttisch", "schrank_300"]);
    pruefe(r1.items, zoneSchlafen);
    assert.deepEqual(r1.hinweise, []);
    const r2 = autoMoeblierung(zoneSchlafen, { personen: 2, stufe: "standard" });
    assert.deepEqual(r2, r1, "zweiter Aufruf deepEqual (deterministisch)");
    const ids = new Set(r1.items.map((i) => i.id));
    assert.equal(ids.size, r1.items.length, "ids eindeutig");
    for (const i of r1.items) {
      assert.ok(i.id.startsWith(AUTO_ID_PREFIX), `id ${i.id}`);
      assert.equal(istAutoItem(i), true);
    }
  });

  it("Wohnen 5,00 × 4,20: personen 3 ⇒ sofa_3 + couchtisch + esstisch_4", () => {
    const r = autoMoeblierung(zoneWohnen, { personen: 3 });
    const typen = r.items.map((i) => i.typ).sort();
    assert.deepEqual(typen, ["couchtisch", "esstisch_4", "sofa_3"]);
    pruefe(r.items, zoneWohnen);
    assert.deepEqual(r.hinweise, []);
  });

  it("Wohnen: personen 5 ⇒ esstisch_6 wenn er passt, sonst esstisch_4 + Hinweis", () => {
    const r = autoMoeblierung(zoneWohnen, { personen: 5 });
    const hat6 = r.items.some((i) => i.typ === "esstisch_6");
    const hat4 = r.items.some((i) => i.typ === "esstisch_4");
    assert.ok(hat6 || hat4, "ein Esstisch ist immer gesetzt");
    if (!hat6) {
      assert.ok(r.hinweise.some((h) => /Esstisch 6 P passt nicht/.test(h)), JSON.stringify(r.hinweise));
    }
    pruefe(r.items, zoneWohnen);
  });

  it("Küche 3,20 × 2,20 ⇒ kuechenzeile_300; Küche 2,40 × 2,00 ⇒ kuechenzeile (1,80 Rückfall)", () => {
    const gross = { points: [{ x: 0, z: 0 }, { x: 3.2, z: 0 }, { x: 3.2, z: 2.2 }, { x: 0, z: 2.2 }], level: 0, name: "Küche (WE 0-1) ·WT", art: "kueche" };
    const r1 = autoMoeblierung(gross);
    assert.deepEqual(r1.items.map((i) => i.typ), ["kuechenzeile_300"]);
    pruefe(r1.items, gross);
    const klein = { points: [{ x: 0, z: 0 }, { x: 2.4, z: 0 }, { x: 2.4, z: 2 }, { x: 0, z: 2 }], level: 0, name: "Küche (WE 0-2) ·WT", art: "kueche" };
    const r2 = autoMoeblierung(klein);
    assert.deepEqual(r2.items.map((i) => i.typ), ["kuechenzeile"]);
    pruefe(r2.items, klein);
  });

  it("Bad/Flur/Abstell ⇒ keine Items + Hinweis", () => {
    for (const zone of [
      { points: [{ x: 0, z: 0 }, { x: 2.5, z: 0 }, { x: 2.5, z: 2 }, { x: 0, z: 2 }], level: 0, name: "Bad (WE 0-1) ·WT", art: "sanitaer" },
      { points: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 1.5 }, { x: 0, z: 1.5 }], level: 0, name: "Flur 0 ·WT", art: "flur" },
      { points: [{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 2, z: 1.5 }, { x: 0, z: 1.5 }], level: 0, name: "Abstellraum (WE 0-1) ·WT", art: "abstell" },
    ]) {
      const r = autoMoeblierung(zone);
      assert.deepEqual(r.items, [], zone.name);
      assert.equal(r.hinweise.length, 1, zone.name);
    }
  });

  it("vorhandene.length > 0 ⇒ { items: [], Hinweis „belegt“ } — überschreibt nie", () => {
    const r = autoMoeblierung(zoneSchlafen, { vorhandene: [moeb("doppelbett", 2, 2)] });
    assert.deepEqual(r.items, []);
    assert.match(r.hinweise[0], /belegt/);
  });

  it("L-förmiges Polygon ⇒ [] + Hinweis „kein Rechteck“", () => {
    const l = {
      points: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 2 }, { x: 2, z: 2 }, { x: 2, z: 4 }, { x: 0, z: 4 }],
      level: 0, name: "Wohnen/Essen (WE 0-1) ·WT", art: "aufenthalt",
    };
    const r = autoMoeblierung(l);
    assert.deepEqual(r.items, []);
    assert.match(r.hinweise[0], /kein Rechteck/);
  });

  it("istAutoItem: nur auto-Präfix", () => {
    assert.equal(istAutoItem({ id: "auto-x-1" }), true);
    assert.equal(istAutoItem({ id: "it-1" }), false);
    assert.equal(istAutoItem(null), false);
  });
});

describe("wohnMoebel — platziereTuer (MSB-14)", () => {
  it("Tür mittig auf der längsten Kante, Aufschlag in den Raum, trifft kein Möbel", () => {
    const zone = { points: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 3.5 }, { x: 0, z: 3.5 }], level: 0, name: "Schlafen (WE 0-1) ·WT", art: "aufenthalt" };
    const t = platziereTuer(zone, [], "tuer_885", { idPrefix: "auto-x-", nr: 9 });
    assert.ok(t, "Tür platziert");
    assert.equal(t.id, "auto-x-9");
    assert.equal(t.typ, "tuer_885");
    assert.equal(t.aufschlag, "links");
    assert.equal(sperrGrund([], t, zone.points), null);
    const a = tuerAufschlag(t);
    // Aufschlag zeigt in den Raum (y > 0) und liegt auf der Nordkante (y = 0):
    nah(t.y, 0, 1e-6, "Mittellinie auf der Wand");
    assert.ok(a.offen.y > a.scharnier.y, "Aufschlag in den Raum");
    nah(t.x, 2, 1e-9, "mittig auf der längsten Kante");
  });
  it("Nicht-Tür-Typ ⇒ null; Zone ohne Punkte ⇒ null", () => {
    const zone = { points: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 3.5 }, { x: 0, z: 3.5 }] };
    assert.equal(platziereTuer(zone, [], "doppelbett"), null);
    assert.equal(platziereTuer({ points: [] }, [], "tuer_885"), null);
  });
});

describe("wohnMoebel — fokusKatalog", () => {
  it("ohne eigene Typen nur WOHN_GRUPPE; mit eigenen plus Gruppe „Eigene“", () => {
    assert.deepEqual(fokusKatalog([]), [WOHN_GRUPPE]);
    assert.deepEqual(fokusKatalog(null), [WOHN_GRUPPE]);
    const eigen = [{ id: "eigen-x", name: "X", b: 1, t: 1, kategorie: "furn", benutzerseite: false }];
    const k = fokusKatalog(eigen);
    assert.equal(k.length, 2);
    assert.equal(k[0], WOHN_GRUPPE);
    assert.equal(k[1].gruppe, "Eigene");
    assert.deepEqual(k[1].typen, eigen);
  });
});

describe("wohnMoebel — Demo-Räume 30 × 20 und 40 × 26 (Pflicht-Akzeptanz)", () => {
  const FOOTPRINT_30 = (() => {
    const p = [{ x: -15, z: -10 }, { x: 15, z: -10 }, { x: 15, z: 10 }, { x: -15, z: 10 }];
    return p;
  })();
  const FOOTPRINT_40 = [{ x: -20, z: -13 }, { x: 20, z: -13 }, { x: 20, z: 13 }, { x: -20, z: 13 }];

  for (const [label, fp] of [["30 × 20 m", FOOTPRINT_30], ["40 × 26 m", FOOTPRINT_40]]) {
    it(`jede WE-Zone (${label}): Auto-Items gültig, Checks leer, deterministisch, ≥ 1 Bett`, () => {
      const r = tesseliere({ footprintM: fp, storeys: 1, typ: "mittelflur", einheiten: einheitenAnreichern([]), raumzonen: true });
      const weZonen = r.zonen.filter((z) => z.we);
      assert.ok(weZonen.length > 0, "tesseliere liefert WE-Zonen");
      let betten = 0;
      let raeume = 0;
      for (const zone of weZonen) {
        const a1 = autoMoeblierung(zone, { personen: 3, stufe: "standard" });
        const a2 = autoMoeblierung(zone, { personen: 3, stufe: "standard" });
        assert.deepEqual(a2, a1, `deterministisch: ${zone.name}`);
        if (!a1.items.length) continue; // Bad/Flur/Abstell/L-Form: Hinweis, keine Items
        raeume++;
        betten += a1.items.filter((i) => i.typ === "doppelbett" || i.typ === "einzelbett").length;
        for (const i of a1.items) assert.ok(imRaumTolerant(i, zone.points), `${i.typ} in ${zone.name} nicht im Raum`);
        for (let i = 0; i < a1.items.length; i++) {
          for (let j = i + 1; j < a1.items.length; j++) {
            assert.equal(kollidiert(a1.items[i], a1.items[j]), false, `Kollision in ${zone.name}`);
          }
        }
        assert.deepEqual(wohnMoebelChecks(a1.items, zone.points, "standard"), [], `Checks in ${zone.name}`);
        const ids = a1.items.map((i) => i.id);
        assert.equal(new Set(ids).size, ids.length, `ids eindeutig in ${zone.name}`);
      }
      assert.ok(raeume > 0, "mindestens ein Raum wurde möbliert");
      assert.ok(betten >= 1, "mindestens ein Raum bekommt ein Bett");
    });
  }
});