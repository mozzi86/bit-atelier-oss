// 115-12 (D-115-47): rooms sized / moved by hand in the apartment planner (werkstatt_layer.raumHand) — key, frame,
// surroundings (outline + snap lines), resize with minimum sizes, move with snap, typed sizes, keyboard step,
// overlap area, applying the entries (hand locks rule, byte-identity without entries, doors, marker, clamp into the
// apartment), one path for workshop and rehydrate, bar (86-03) key translation, proposal take-over.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tesseliere } from "@designer/lib/tesselierung";
import { WERKSTATT_TYPEN } from "@designer/lib/wohnungsTypen";
import {
  raumHandSchluessel, istBearbeitbar, raumGeometrie, inRahmen, punkteAus, raumMasse, minMasse, raumUmgebung,
  groesseAendern, verschieben, masseSetzen, rahmenSchritt, eintragAus, raumHandSetzen, ueberlappung,
  wendeRaumHandAn, raumHandFehlend, RAUM_HAND_RASTER_M, RAUM_HAND_MIN_M, RAUM_HAND_FANG_M,
} from "@designer/lib/raumBearbeiten";
import { werkstattZonenAusLayer } from "@designer/lib/useWerkstattRehydrate";
import { WERKSTATT_DEFAULT } from "@designer/lib/werkstattDefaults";
import { LAYOUT_FELDER, uebernehmeVorschlag } from "@designer/lib/bebauungsvorschlaege";

const STD = WERKSTATT_TYPEN.filter((t) => t.gruppe === "standard").slice(0, 3);
const rect = (w, d) => [{ x: -w / 2, z: -d / 2 }, { x: w / 2, z: -d / 2 }, { x: w / 2, z: d / 2 }, { x: -w / 2, z: d / 2 }];
const L = [{ x: 0, z: 0 }, { x: 48, z: 0 }, { x: 48, z: 16 }, { x: 16, z: 16 }, { x: 16, z: 40 }, { x: 0, z: 40 }];
const basis = (fp, extra = {}) => tesseliere({ footprintM: fp, storeys: 2, typ: "mittelflur", einheiten: STD, raumzonen: true, ...extra });
const zone = (zonen, name, level) => zonen.find((z) => z.name === name && z.level === level);
const nah = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
/** A window room of the first unit on the ground floor (rectangular, with a door). */
const erstesZimmer = (zonen) => zonen.find((z) => z.level === 0 && istBearbeitbar(z) && z.fensterpflicht === true && Array.isArray(z.tueren) && z.tueren.length);

// Hand-built apartment 8 × 5 m: two rooms side by side and a storage strip — neutral test data.
const WE = "WE 0-1";
const raum = (name, x0, z0, x1, z1, extra = {}) => ({
  points: [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }], level: 0, name: `${name} (${WE}) ·WT`, we: WE,
  raumart: "wohnen", art: "aufenthalt", flaeche_m2: (x1 - x0) * (z1 - z0), ...extra,
});
const WOHNUNG = () => [
  raum("Zimmer A", 0, 0, 4, 4, { tueren: [{ wand: 2, u_m: 0.5, breite_m: 0.885, nach: `Flur (${WE}) ·WT` }] }),
  raum("Zimmer B", 4, 0, 8, 4),
  raum("Flur", 0, 4, 8, 5, { raumart: "flur", art: "flur" }),
];

describe("115-12 — raumBearbeiten: Schlüssel, Rahmen, Umgebung", () => {
  it("Schlüssel = Geschoss | Zonenname; Konstanten: Oktameter-Raster, 1,20 m Mindestmaß, 0,30 m Fang", () => {
    assert.equal(raumHandSchluessel(0, "Schlafen (WE 0-1) ·WT"), "0|Schlafen (WE 0-1) ·WT");
    assert.equal(RAUM_HAND_RASTER_M, 0.125);
    assert.equal(RAUM_HAND_MIN_M, 1.2);
    assert.equal(RAUM_HAND_FANG_M, 0.3);
  });

  it("bearbeitbar sind nur rechteckige Räume einer Wohnung (kein Balkon, keine Treppe, kein Polygon, kein Gebäudeflur)", () => {
    const [a] = WOHNUNG();
    assert.equal(istBearbeitbar(a), true);
    assert.equal(istBearbeitbar({ ...a, raumart: "balkon" }), false);
    assert.equal(istBearbeitbar({ ...a, art: "treppe" }), false);
    assert.equal(istBearbeitbar({ ...a, we: undefined }), false);
    assert.equal(istBearbeitbar({ ...a, points: [...a.points, { x: -1, z: 2 }] }), false);
    assert.equal(istBearbeitbar(null), false);
  });

  it("Rahmen: Ursprung = Ecke 0, u entlang Kante 0, v entlang Kante 3 rückwärts; Punkte ↔ Rahmen hin und zurück", () => {
    const [a] = WOHNUNG();
    const g = raumGeometrie(a);
    assert.deepEqual(g.rahmen, { o: { x: 0, z: 0 }, u: { x: 1, z: 0 }, v: { x: 0, z: 1 } });
    assert.deepEqual(g.rechteck, { a0: 0, a1: 4, c0: 0, c1: 4 });
    assert.deepEqual(g.regel, { u_m: 4, v_m: 4 });
    assert.equal(g.hand, false);
    assert.deepEqual(inRahmen({ x: 3, z: 1 }, g.rahmen), { a: 3, c: 1 });
    assert.deepEqual(punkteAus(g.rahmen, { a0: 1, a1: 3, c0: 0.5, c1: 2 }), [{ x: 1, z: 0.5 }, { x: 3, z: 0.5 }, { x: 3, z: 2 }, { x: 1, z: 2 }]);
    assert.equal(raumGeometrie({ points: [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 3 }] }), null);
  });

  it("gedrehter Raum (30°): Maße bleiben, Breite liegt entlang der flacheren Kante", () => {
    const w = Math.PI / 6, c = Math.cos(w), s = Math.sin(w);
    const dreh = (p) => ({ x: p.x * c - p.z * s, z: p.x * s + p.z * c });
    const z = { ...raum("Schräg", 0, 0, 5, 3), points: [{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 5, z: 3 }, { x: 0, z: 3 }].map(dreh) };
    const m = raumMasse(z);
    assert.ok(nah(m.breite_m, 5) && nah(m.tiefe_m, 3) && nah(m.flaeche_m2, 15));
    assert.equal(m.breiteAchse, "u");
    // corner order starting on the short side: width follows v
    const z2 = { ...z, points: [z.points[1], z.points[2], z.points[3], z.points[0]] };
    const m2 = raumMasse(z2);
    assert.ok(nah(m2.breite_m, 5) && nah(m2.tiefe_m, 3));
    assert.equal(m2.breiteAchse, "v");
  });

  it("Handmarke: der Rahmen liest auf den Regel-Ursprung zurück", () => {
    const hand = { ...raum("Zimmer A", 1, 0.5, 4, 4), hand: { versatzU_m: 1, versatzV_m: 0.5, regelU_m: 4, regelV_m: 4 } };
    const g = raumGeometrie(hand);
    assert.deepEqual(g.rahmen.o, { x: 0, z: 0 });
    assert.deepEqual(g.rechteck, { a0: 1, a1: 4, c0: 0.5, c1: 4 });
    assert.deepEqual(g.regel, { u_m: 4, v_m: 4 });
    assert.equal(g.hand, true);
  });

  it("Umgebung: Wohnungsumriss = Hülle aller Räume der Wohnung; Fanglinien = Kanten der Nachbarn und des Umrisses", () => {
    const zonen = [...WOHNUNG(), { ...raum("Fremd", 8, 0, 12, 5), we: "WE 0-2", name: "Fremd (WE 0-2) ·WT" }, { ...raum("Balkon", 0, -1.5, 4, 0), raumart: "balkon" }, { ...raum("Oben", 0, 0, 20, 20), level: 1 }];
    const um = raumUmgebung(zonen, zonen[0]);
    assert.deepEqual(um.grenzen, { a0: 0, a1: 8, c0: 0, c1: 5 }, "fremde Wohnung, Balkon und anderes Geschoss zählen nicht");
    assert.deepEqual(um.linien.a, [0, 4, 8]);
    assert.deepEqual(um.linien.c, [0, 4, 5]);
  });

  it("Umriss schrumpft nicht, wenn ein Nachbar von Hand von der Wohnungskante weggerückt wurde (zählt mit Regel-Rechteck)", () => {
    const zonen = WOHNUNG();
    zonen[1] = { ...raum("Zimmer B", 4, 0, 7, 4), hand: { versatzU_m: 0, versatzV_m: 0, regelU_m: 4, regelV_m: 4 } };
    zonen[2] = raum("Flur", 0, 4, 6, 5, { raumart: "flur", art: "flur" });
    assert.equal(raumUmgebung(zonen, zonen[0]).grenzen.a1, 8);
  });

  it("Mindestmaß: 1,20 m bzw. die breiteste Tür an der Seite — ein schmalerer Regel-Raum darf so schmal bleiben", () => {
    const [a] = WOHNUNG();
    assert.deepEqual(minMasse(a), { u_m: 1.2, v_m: 1.2 });
    assert.deepEqual(minMasse({ ...a, tueren: [{ wand: 0, breite_m: 1.51 }, { wand: 3, breite_m: 1.26 }] }), { u_m: 1.51, v_m: 1.26 });
    const schmal = raum("Abstell", 0, 0, 1, 1.2);
    const m = minMasse(schmal);
    assert.ok(nah(m.u_m, 1) && nah(m.v_m, 1.2));
  });
});

describe("115-12 — raumBearbeiten: Griff ziehen, verschieben, Maße tippen", () => {
  const R = { a0: 0, a1: 4, c0: 0, c1: 4 };
  const OPT = { grenzen: { a0: 0, a1: 8, c0: 0, c1: 5 }, linien: { a: [0, 4, 8], c: [0, 4, 5] }, min: { u_m: 1.2, v_m: 1.2 } };

  it("Kantengriff: bewegt nur seine Seite, Wunsch rastet auf 12,5 cm", () => {
    const r = groesseAendern(R, { a: 1, c: 0 }, { da: -0.93, dc: 7 }, OPT);
    assert.deepEqual(r.rechteck, { a0: 0, a1: 3.125, c0: 0, c1: 4 });
    assert.deepEqual(r.fang, { a: null, c: null });
  });

  it("Kantengriff: Kante eines Nachbarn bzw. der Wohnung fängt vor dem Raster (0,30 m)", () => {
    const r = groesseAendern(R, { a: 0, c: 1 }, { da: 0, dc: 0.8 }, OPT);
    assert.equal(r.rechteck.c1, 5, "Wohnungskante bei 5,00 fängt 4,80");
    assert.equal(r.fang.c, 5);
    const ohne = groesseAendern(R, { a: 0, c: 1 }, { da: 0, dc: 0.8 }, { ...OPT, kantenfang: false });
    assert.equal(ohne.rechteck.c1, 4.75, "ohne Objektfang: Raster");
    const frei = groesseAendern(R, { a: 0, c: 1 }, { da: 0, dc: 0.8 }, { ...OPT, alt: true });
    assert.ok(nah(frei.rechteck.c1, 4.8), "Alt = ohne Fang");
    const ohneRaster = groesseAendern(R, { a: 1, c: 0 }, { da: -0.93, dc: 0 }, { ...OPT, raster: false });
    assert.ok(nah(ohneRaster.rechteck.a1, 3.07), "Raster aus: freier Wert");
  });

  it("Eckgriff: beide Seiten; Mindestmaß und Wohnungsumriss klemmen und schlagen den Fang", () => {
    const klein = groesseAendern(R, { a: 1, c: 1 }, { da: -9, dc: -9 }, OPT);
    assert.deepEqual(klein.rechteck, { a0: 0, a1: 1.2, c0: 0, c1: 1.2 });
    const gross = groesseAendern(R, { a: 1, c: 1 }, { da: 99, dc: 99 }, OPT);
    assert.deepEqual(gross.rechteck, { a0: 0, a1: 8, c0: 0, c1: 5 });
    const links = groesseAendern({ a0: 2, a1: 6, c0: 1, c1: 4 }, { a: -1, c: -1 }, { da: -9, dc: 9 }, OPT);
    assert.deepEqual(links.rechteck, { a0: 0, a1: 6, c0: 2.8, c1: 4 });
    assert.deepEqual(links.fang, { a: null, c: null }, "geklemmt, nicht gefangen");
  });

  it("Verschieben: Größe bleibt, jede der beiden parallelen Kanten kann fangen, sonst Raster", () => {
    const start = { a0: 0, a1: 3, c0: 0, c1: 2 };
    const fang = verschieben(start, { da: 0.8, dc: 0 }, OPT);
    assert.deepEqual(fang.rechteck, { a0: 1, a1: 4, c0: 0, c1: 2 }, "rechte Kante fängt die Nachbarkante bei 4,00");
    assert.equal(fang.fang.a, 4);
    const raster = verschieben(start, { da: 0.4, dc: 0.55 }, { ...OPT, linien: { a: [], c: [] } });
    assert.deepEqual(raster.rechteck, { a0: 0.375, a1: 3.375, c0: 0.5, c1: 2.5 });
    const klemme = verschieben(start, { da: 40, dc: -3 }, OPT);
    assert.deepEqual(klemme.rechteck, { a0: 5, a1: 8, c0: 0, c1: 2 }, "bleibt in der Wohnung");
  });

  it("Pfeiltaste: exakter Rasterschritt entlang der nächstliegenden Raumachse", () => {
    const g = raumGeometrie(WOHNUNG()[0]);
    assert.deepEqual(rahmenSchritt(g.rahmen, { x: 1, z: 0 }), { da: 0.125, dc: 0 });
    assert.deepEqual(rahmenSchritt(g.rahmen, { x: 0, z: -1 }), { da: 0, dc: -0.125 });
    assert.deepEqual(rahmenSchritt(g.rahmen, { x: 0, z: 0 }), { da: 0, dc: 0 });
    // mirrored room: u points left, "right" is −u
    const gespiegelt = { o: { x: 4, z: 0 }, u: { x: -1, z: 0 }, v: { x: 0, z: 1 } };
    assert.deepEqual(rahmenSchritt(gespiegelt, { x: 1, z: 0 }), { da: -0.125, dc: 0 });
    const schritt = verschieben({ a0: 0.3, a1: 3.3, c0: 0, c1: 2 }, { da: 0.125, dc: 0 }, { ...OPT, alt: true });
    assert.ok(nah(schritt.rechteck.a0, 0.425) && nah(schritt.rechteck.a1, 3.425));
  });

  it("Maße tippen: exakt (kein Raster), Ecke 0 bleibt; zu groß / zu klein wird geklemmt und gemeldet", () => {
    const r = masseSetzen(R, { u_m: 3.63 }, OPT);
    assert.deepEqual(r.rechteck, { a0: 0, a1: 3.63, c0: 0, c1: 4 });
    assert.deepEqual(r.geklemmt, { u: false, v: false });
    const beide = masseSetzen({ a0: 5, a1: 7, c0: 0, c1: 4 }, { u_m: 4, v_m: 4.5 }, OPT);
    assert.deepEqual(beide.rechteck, { a0: 4, a1: 8, c0: 0, c1: 4.5 }, "passt nur nach Zurückschieben in die Wohnung");
    assert.deepEqual(beide.geklemmt, { u: false, v: false });
    const zuGross = masseSetzen(R, { u_m: 12, v_m: 0.5 }, OPT);
    assert.deepEqual(zuGross.rechteck, { a0: 0, a1: 8, c0: 0, c1: 1.2 });
    assert.deepEqual(zuGross.geklemmt, { u: true, v: true });
    assert.deepEqual(masseSetzen(R, { u_m: NaN, v_m: undefined }, OPT).rechteck, R);
  });

  it("Eintrag: Regel-Rechteck → null (kein Handraum); sonst Versatz + Seitenlängen; Karte wird nicht mutiert", () => {
    assert.equal(eintragAus({ a0: 0, a1: 4, c0: 0, c1: 4 }, { u_m: 4, v_m: 4 }), null);
    assert.deepEqual(eintragAus({ a0: 1, a1: 3.5, c0: 0, c1: 4 }, { u_m: 4, v_m: 4 }), { versatzU_m: 1, versatzV_m: 0, laengeU_m: 2.5, laengeV_m: 4 });
    const karte = { x: { versatzU_m: 0, versatzV_m: 0, laengeU_m: 2, laengeV_m: 2 } };
    const neu = raumHandSetzen(karte, "y", { versatzU_m: 1, versatzV_m: 0, laengeU_m: 2, laengeV_m: 2 });
    assert.deepEqual(Object.keys(neu), ["x", "y"]);
    assert.deepEqual(Object.keys(karte), ["x"]);
    assert.deepEqual(raumHandSetzen(neu, "x", null), { y: neu.y });
    assert.deepEqual(raumHandSetzen(null, "x", null), {});
  });

  it("Überlappung: Rechteck gegen Rechteck und gegen einen L-Flur (m²)", () => {
    const q = (x0, z0, x1, z1) => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
    assert.ok(nah(ueberlappung(q(0, 0, 4, 4), q(3, 1, 6, 3)), 2));
    assert.equal(ueberlappung(q(0, 0, 4, 4), q(4, 0, 8, 4)), 0, "gemeinsame Kante ist keine Überlappung");
    assert.ok(nah(ueberlappung(q(0, 0, 4, 4), q(3, 1, 6, 3).reverse()), 2), "Umlaufsinn egal");
    const lFlur = [{ x: 0, z: 0 }, { x: 6, z: 0 }, { x: 6, z: 1 }, { x: 1, z: 1 }, { x: 1, z: 5 }, { x: 0, z: 5 }];
    assert.ok(nah(ueberlappung(lFlur, q(0.5, 0.5, 3, 3)), 1.25 + 1), "L-Flur: 1,25 m² im Querstreifen + 1,00 m² im Längsstreifen");
  });
});

describe("115-12 — wendeRaumHandAn (Lib)", () => {
  it("ohne (gültigen) Eintrag: dieselbe Array-Referenz (byte-gleich)", () => {
    const z = WOHNUNG();
    assert.equal(wendeRaumHandAn(z, null).zonen, z);
    assert.equal(wendeRaumHandAn(z, {}).zonen, z);
    assert.equal(wendeRaumHandAn(z, { "0|x": { versatzU_m: 0, versatzV_m: 0, laengeU_m: 0, laengeV_m: 2 } }).zonen, z, "ungültiger Eintrag");
    const key = raumHandSchluessel(0, z[0].name);
    const aufRegel = wendeRaumHandAn(z, { [key]: { versatzU_m: 0, versatzV_m: 0, laengeU_m: 4, laengeV_m: 4 } });
    assert.equal(aufRegel.zonen, z, "Eintrag = Regel-Rechteck: kein Handraum");
  });

  it("Handraum: getippte Größe, Lage relativ zur Regel-Ecke, Eckenfolge und Tür bleiben, Marke `hand`, Fläche neu", () => {
    const z = WOHNUNG();
    const key = raumHandSchluessel(0, z[0].name);
    const r = wendeRaumHandAn(z, { [key]: { versatzU_m: 0.5, versatzV_m: 1, laengeU_m: 3, laengeV_m: 3 } });
    const h = r.zonen[0];
    assert.deepEqual(h.points, [{ x: 0.5, z: 1 }, { x: 3.5, z: 1 }, { x: 3.5, z: 4 }, { x: 0.5, z: 4 }]);
    assert.equal(h.flaeche_m2, 9);
    assert.deepEqual(h.hand, { versatzU_m: 0.5, versatzV_m: 1, regelU_m: 4, regelV_m: 4 });
    // door on wall 2 (runs from corner 2 to corner 3): world position kept → u_m shorter by the 0,5 m the corner moved
    assert.ok(nah(h.tueren[0].u_m, 0), "Tür bleibt an ihrem Ort bzw. an der Wand");
    assert.equal(r.zonen[1], z[1], "andere Räume: dieselben Objekte");
    assert.equal(z[0].hand, undefined, "Eingabe nicht mutiert");
    assert.deepEqual(r.angewendet[key], { versatzU_m: 0.5, versatzV_m: 1, laengeU_m: 3, laengeV_m: 3 });
    assert.equal(r.hinweise.length, 0, "liegt ganz im alten Rechteck: keine Überlappung");
  });

  it("Überlappung mit Nachbarn ist ein Hinweis, keine Korrektur", () => {
    const z = WOHNUNG();
    const key = raumHandSchluessel(0, z[0].name);
    const r = wendeRaumHandAn(z, { [key]: { versatzU_m: 0, versatzV_m: 0, laengeU_m: 5, laengeV_m: 4.5 } });
    assert.deepEqual(r.zonen[0].points[2], { x: 5, z: 4.5 });
    assert.equal(r.hinweise.length, 1);
    assert.match(r.hinweise[0], /\[115-12\].*Zimmer A.*überlappt Zimmer B \(4,00 m²\), Flur \(2,50 m²\)/);
  });

  it("Wohnung kleiner geworden: Handraum wird in den Umriss geschoben bzw. gekürzt und gemeldet", () => {
    const z = WOHNUNG();
    const key = raumHandSchluessel(0, z[0].name);
    const r = wendeRaumHandAn(z, { [key]: { versatzU_m: 6, versatzV_m: 0, laengeU_m: 3, laengeV_m: 9 } });
    assert.deepEqual(r.zonen[0].points, [{ x: 5, z: 0 }, { x: 8, z: 0 }, { x: 8, z: 5 }, { x: 5, z: 5 }]);
    assert.ok(r.hinweise.some((h) => /passt mit dem Handmaß nicht mehr in die Wohnung — angepasst auf 3,00 × 5,00 m/.test(h)));
  });

  it("Raum fehlt oder ist kein Rechteck mehr: Eintrag wirkt nicht, wird einmal gemeldet (oder schweigt im Riegelpfad)", () => {
    const z = WOHNUNG();
    const e = { versatzU_m: 0, versatzV_m: 0, laengeU_m: 2, laengeV_m: 2 };
    const fehlt = wendeRaumHandAn(z, { "0|Weg (WE 0-9) ·WT": e });
    assert.equal(fehlt.zonen, z);
    assert.match(fehlt.hinweise[0], /„Weg \(WE 0-9\)" \(Geschoss 0\) gibt es im aktuellen Grundriss nicht mehr/);
    assert.equal(wendeRaumHandAn(z, { "0|Weg (WE 0-9) ·WT": e }, { fehlendMelden: false }).hinweise.length, 0);
    const poly = z.map((x, i) => (i === 0 ? { ...x, points: [...x.points, { x: -1, z: 2 }] } : x));
    assert.match(wendeRaumHandAn(poly, { [raumHandSchluessel(0, z[0].name)]: e }).hinweise[0], /kein Rechteck/);
    assert.equal(raumHandFehlend(z, { "0|Weg (WE 0-9) ·WT": e }).length, 1);
    assert.equal(raumHandFehlend(z, { [raumHandSchluessel(0, z[0].name)]: e }).length, 0);
    assert.deepEqual(raumHandFehlend(z, null), []);
  });
});

describe("115-12 — tesseliere mit raumHand (Hand sperrt Regel)", () => {
  it("ohne Eintrag byte-gleich (auch mit leerem Objekt) — alte Daten verhalten sich wie bisher", () => {
    const a = basis(rect(70, 16));
    assert.equal(JSON.stringify(basis(rect(70, 16), { raumHand: {} })), JSON.stringify(a));
    assert.equal(JSON.stringify(basis(rect(70, 16), { raumHand: null })), JSON.stringify(a));
    assert.ok(a.zonen.every((z) => z.hand === undefined));
  });

  it("Handraum trägt Größe und Marke; die übrigen Zonen sind unverändert", () => {
    const a = basis(rect(70, 16));
    const z0 = erstesZimmer(a.zonen);
    const g = raumGeometrie(z0);
    const key = raumHandSchluessel(z0.level, z0.name);
    const eintrag = { versatzU_m: 0.25, versatzV_m: 0, laengeU_m: g.regel.u_m - 0.5, laengeV_m: g.regel.v_m };
    const b = basis(rect(70, 16), { raumHand: { [key]: eintrag } });
    const h = zone(b.zonen, z0.name, z0.level);
    const m = raumGeometrie(h);
    assert.ok(nah(m.rechteck.a1 - m.rechteck.a0, eintrag.laengeU_m) && nah(m.rechteck.c1 - m.rechteck.c0, eintrag.laengeV_m));
    assert.ok(nah(h.hand.versatzU_m, 0.25) && nah(h.hand.regelU_m, g.regel.u_m));
    assert.ok(nah(h.flaeche_m2, eintrag.laengeU_m * eintrag.laengeV_m));
    assert.deepEqual(m.rahmen.o.x.toFixed(6), g.rahmen.o.x.toFixed(6), "Ursprung = Regel-Ecke");
    const andere = (liste) => JSON.stringify(liste.filter((z) => z.name !== z0.name || z.level !== z0.level));
    assert.equal(andere(b.zonen), andere(a.zonen));
    assert.equal(b.zonen.filter((z) => z.hand).length, 1);
  });

  it("Regeln neu erzeugen überschreibt den Handraum nicht: Größe bleibt bei anderem Mix, anderer Wandlage und Regelschaltern", () => {
    const a = basis(rect(70, 16));
    const z0 = erstesZimmer(a.zonen);
    const key = raumHandSchluessel(z0.level, z0.name);
    const hand = { [key]: { versatzU_m: 0, versatzV_m: 0, laengeU_m: 3.01, laengeV_m: 2.77 } };
    const groesser = STD.map((e, i) => (i === 0 ? { ...e, flaeche_m2: e.flaeche_m2 + 6, max_m2: (e.max_m2 || e.flaeche_m2) + 12 } : e));
    for (const extra of [{}, { einheiten: groesser }, { regeln: { mindestbreiten: true, wandstaerken: true } }, { nordwinkel: 30 }]) {
      const r = basis(rect(70, 16), { ...extra, raumHand: hand });
      const h = zone(r.zonen, z0.name, z0.level);
      assert.ok(h && h.hand, JSON.stringify(extra));
      const m = raumGeometrie(h);
      assert.ok(nah(m.rechteck.a1 - m.rechteck.a0, 3.01, 1e-5) && nah(m.rechteck.c1 - m.rechteck.c0, 2.77, 1e-5), `Handmaß bleibt: ${JSON.stringify(extra)}`);
    }
    // … while the rule room itself did change with the larger mix
    const regelAlt = raumGeometrie(z0).regel, regelNeu = raumGeometrie(zone(basis(rect(70, 16), { einheiten: groesser }).zonen, z0.name, z0.level)).regel;
    assert.ok(Math.abs(regelAlt.u_m - regelNeu.u_m) + Math.abs(regelAlt.v_m - regelNeu.v_m) > 0.01, "Kontrolle: die Regel hat den Raum verändert");
  });

  it("„Auf Regel zurücksetzen“ (Eintrag entfernt) gibt exakt den Regel-Grundriss zurück", () => {
    const a = basis(rect(70, 16));
    const z0 = erstesZimmer(a.zonen);
    const key = raumHandSchluessel(z0.level, z0.name);
    const karte = raumHandSetzen({}, key, { versatzU_m: 0.5, versatzV_m: 0, laengeU_m: 2, laengeV_m: 2 });
    assert.notEqual(JSON.stringify(basis(rect(70, 16), { raumHand: karte })), JSON.stringify(a));
    assert.equal(JSON.stringify(basis(rect(70, 16), { raumHand: raumHandSetzen(karte, key, null) })), JSON.stringify(a));
  });

  it("Wandsegmente und Rettungsweg rechnen mit dem Handraum (späterer Schritt sieht ihn)", () => {
    const regeln = { wandstaerken: true, rettungsweg: true };
    const a = basis(rect(70, 16), { regeln });
    const z0 = erstesZimmer(a.zonen);
    const g = raumGeometrie(z0);
    const key = raumHandSchluessel(z0.level, z0.name);
    const b = basis(rect(70, 16), { regeln, raumHand: { [key]: { versatzU_m: 0, versatzV_m: 0, laengeU_m: g.regel.u_m - 0.75, laengeV_m: g.regel.v_m } } });
    assert.notEqual(JSON.stringify(b.waende), JSON.stringify(a.waende));
    assert.equal(b.weListe.length, a.weListe.length);
    assert.ok(b.weListe.every((w) => Number.isFinite(w.rettungsweg_m)));
  });

  it("ein Pfad für Werkstatt und Rehydrat (Reload erzeugt dieselben Zonen)", () => {
    const fp = rect(70, 16);
    const z0 = erstesZimmer(basis(fp, { einheiten: WERKSTATT_DEFAULT.einheiten }).zonen);
    const layer = { ...WERKSTATT_DEFAULT, angewendet: true, raumHand: { [raumHandSchluessel(z0.level, z0.name)]: { versatzU_m: 0.125, versatzV_m: 0, laengeU_m: 2.5, laengeV_m: 2.5 } } };
    const reload = werkstattZonenAusLayer(layer, { footprintM: fp, storeys: 2, storeyHeight: 3 });
    assert.equal(reload.filter((z) => z.hand).length, 1);
    const ohne = werkstattZonenAusLayer({ ...layer, raumHand: undefined }, { footprintM: fp, storeys: 2, storeyHeight: 3 });
    assert.equal(ohne.filter((z) => z.hand).length, 0, "alter Layer ohne Feld: wie bisher");
    assert.deepEqual(WERKSTATT_DEFAULT.raumHand, {});
  });

  it("Riegelpfad (86-03): Schlüssel mit globaler WE-Nummer trifft den Raum im zweiten Riegel; fehlender Raum wird einmal gemeldet", () => {
    const a = basis(L);
    assert.ok((a.form?.riegel || []).length > 1, "Kontrolle: L-Form ergibt mehrere Riegel");
    const zweiter = a.weListe.find((w) => w.riegel === 2 && w.level === 0);
    const z0 = a.zonen.find((z) => z.we === zweiter.we && z.level === 0 && istBearbeitbar(z) && z.fensterpflicht === true);
    assert.ok(z0, "Raum im zweiten Riegel");
    const g = raumGeometrie(z0);
    const key = raumHandSchluessel(0, z0.name);
    const b = basis(L, { raumHand: { [key]: { versatzU_m: 0, versatzV_m: 0, laengeU_m: g.regel.u_m - 0.5, laengeV_m: g.regel.v_m }, "0|Weg (WE 0-99) ·WT": { versatzU_m: 0, versatzV_m: 0, laengeU_m: 2, laengeV_m: 2 } } });
    const hand = b.zonen.filter((z) => z.hand);
    assert.equal(hand.length, 1);
    assert.equal(hand[0].name, z0.name);
    assert.ok(nah(raumGeometrie(hand[0]).rechteck.a1 - raumGeometrie(hand[0]).rechteck.a0, g.regel.u_m - 0.5, 1e-5));
    assert.equal(b.hinweise.filter((h) => /\[115-12\].*gibt es im aktuellen Grundriss nicht mehr/.test(h)).length, 1);
  });

  it("Vorschlag übernehmen verwirft Handräume wie die anderen layout-gebundenen Eingaben (mit Zählung)", () => {
    assert.ok(LAYOUT_FELDER.includes("raumHand"));
    const cfg = { ...WERKSTATT_DEFAULT, raumHand: { "0|A (WE 0-1) ·WT": { versatzU_m: 0, versatzV_m: 0, laengeU_m: 2, laengeV_m: 2 } } };
    const r = uebernehmeVorschlag(cfg, { id: "v1", typologie: { erschliessung: "mfh", zerlegung: { minFlaeche_m2: 120 } }, parameter: { storeys: 2, nordwinkel: 0 }, footprintHash: "x" });
    assert.equal(r.verworfen.raumHand, 1);
    assert.deepEqual(/** @type {any} */ (r.cfg).raumHand, {});
  });
});
