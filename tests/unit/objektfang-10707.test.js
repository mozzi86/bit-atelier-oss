// 107-07: inference, arrays, guide lines — axis colour as a function of the ray angle, parallel / perpendicular tracks to a
// reference edge, extension of an edge (perpendicular foot with t outside 0…1), origin as a snap point (modeller and site
// plan), guide lines in the snap index (infinite line without t limit), the shared array core for typed "*n" / "/n" (site plan
// blocks, rotated copies), guide lines stored in massing_layer and never in the IFC export.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  FANG_STANDARD, FANG_ARTEN, fangIndex, fangPunkt, segmenteAusRingen, strahlAchse, spurPunkt, verlaengerungPunkt,
  fangEinstellungenNormalisieren, QUELLE_URSPRUNG, QUELLE_HILFSLINIE, HILFSGERADE_HALB_M, VERLAENGERUNG_MAX_M,
} from "@core/lib/objektfang.js";
import { fangBefehlLesen, fangBefehleRegistrieren, FANG_HILFE, EINMAL_FAENGE } from "@core/lib/fangEinstellungen.js";
import { befehlsRegister } from "@core/lib/befehlsregister.js";
import {
  leererLayer, koerperAnlegen, reihenFaktoren, hilfslinieAnlegen, hilfslinienLoeschen, hilfslinienSegmente, REIHE_MAX,
} from "@core/lib/massing/massingModell.js";
import { kopieren as blockKopieren, drehKopieren } from "@core/lib/massing/bloecke.js";
import { befehlsAufforderung } from "@core/lib/befehlszeile.js";
import { exportIFC } from "@designer/lib/ifcExport";
import { ifcKoerperOeffnungSzenario } from "./fixtures/ifcKoerperOeffnungModell-10706.js";

const nah = (/** @type {any} */ p, /** @type {number} */ x, /** @type {number} */ y, eps = 1e-9) => {
  assert.ok(p, "Punkt erwartet");
  assert.ok(Math.abs(p.x - x) < eps && Math.abs(p.y - y) < eps, `(${p.x}, ${p.y}) ≠ (${x}, ${y})`);
};
const OHNE_RASTER = { ...FANG_STANDARD, raster: false };

describe("107-07 Task 1 — Achsfarbe als Funktion von winkel_grad", () => {
  test("0°/180° = x (Token fehler), 90°/270° = y (Token erfolg), sonst hinweis; Winkel außerhalb 0…360 werden gefaltet", () => {
    assert.deepEqual(strahlAchse(0), { achse: "x", token: "fehler" });
    assert.deepEqual(strahlAchse(180), { achse: "x", token: "fehler" });
    assert.deepEqual(strahlAchse(360), { achse: "x", token: "fehler" });
    assert.deepEqual(strahlAchse(90), { achse: "y", token: "erfolg" });
    assert.deepEqual(strahlAchse(270), { achse: "y", token: "erfolg" });
    assert.deepEqual(strahlAchse(-90), { achse: "y", token: "erfolg" });
    assert.deepEqual(strahlAchse(45), { achse: null, token: "hinweis" });
    assert.deepEqual(strahlAchse(0.5), { achse: null, token: "hinweis" });
    assert.deepEqual(strahlAchse(NaN), { achse: null, token: "hinweis" });
  });
  test("ein Polarstrahl trägt seinen Winkel — die Glyphe färbt danach (0° x, 90° y)", () => {
    const r0 = fangPunkt({ x: 5, y: 0.1 }, null, { modi: OHNE_RASTER, basis: { x: 0, y: 0 } });
    assert.equal(r0?.art, "polar");
    assert.equal(strahlAchse(/** @type {number} */ (r0?.winkel_grad)).achse, "x");
    const r90 = fangPunkt({ x: 0.1, y: -5 }, null, { modi: OHNE_RASTER, basis: { x: 0, y: 0 } });
    assert.equal(r90?.winkel_grad, 90);
    assert.equal(strahlAchse(90).token, "erfolg");
  });
  test("Achssperre (Umschalt) = ortho für diesen Fang: schlägt Polar und Parallel", () => {
    const bezug = { a: { x: 0, y: 0 }, b: { x: 10, y: -10 } }; // 45° edge
    const roh = { x: 20 + 4, y: -4.2 }; // ~46° from the base point
    const frei = fangPunkt(roh, null, { modi: OHNE_RASTER, basis: { x: 20, y: 0 }, bezug });
    assert.equal(frei?.art, "parallel");
    const gesperrt = fangPunkt(roh, null, { modi: { ...OHNE_RASTER, ortho: true, polar: false }, basis: { x: 20, y: 0 }, bezug });
    assert.equal(gesperrt?.art, "ortho");
    assert.ok([0, 90].includes(/** @type {number} */ (gesperrt?.winkel_grad)));
  });
});

describe("107-07 Task 2 — Parallel, Senkrecht, Verlängerung", () => {
  // reference edge at 30° (drafting angle, y down): from (0, 0) towards (cos 30°, −sin 30°)
  const c = Math.cos(Math.PI / 6), s = Math.sin(Math.PI / 6);
  const bezug = { a: { x: 0, y: 0 }, b: { x: 10 * c, y: -10 * s } };
  const basis = { x: 20, y: 0 };
  test("parallel: Zeiger 2° neben der 30°-Richtung → Punkt auf dem Strahl durch den Basispunkt, art parallel, 30°", () => {
    const w = (32 * Math.PI) / 180;
    const r = fangPunkt({ x: 20 + 6 * Math.cos(w), y: -6 * Math.sin(w) }, null, { modi: OHNE_RASTER, basis, bezug });
    assert.equal(r?.art, "parallel");
    assert.ok(Math.abs(/** @type {number} */ (r?.winkel_grad) - 30) < 1e-9);
    // on the ray: (p − basis) × direction = 0
    const p = /** @type {any} */ (r?.punkt);
    assert.ok(Math.abs((p.x - 20) * -s - p.y * c) < 1e-9);
    assert.equal(strahlAchse(30).achse, null, "schräge Spur = Token hinweis");
  });
  test("parallel auch in Gegenrichtung (210°); senkrecht = 120° bzw. 300°", () => {
    const g = (/** @type {number} */ grad, /** @type {number} */ l) => ({ x: 20 + l * Math.cos((grad * Math.PI) / 180), y: -l * Math.sin((grad * Math.PI) / 180) });
    const r210 = fangPunkt(g(211, 5), null, { modi: OHNE_RASTER, basis, bezug });
    assert.equal(r210?.art, "parallel");
    assert.ok(Math.abs(/** @type {number} */ (r210?.winkel_grad) - 210) < 1e-9);
    const r120 = fangPunkt(g(118, 5), null, { modi: OHNE_RASTER, basis, bezug });
    assert.equal(r120?.art, "senkrecht");
    assert.ok(Math.abs(/** @type {number} */ (r120?.winkel_grad) - 120) < 1e-9);
    const r300 = fangPunkt(g(301, 5), null, { modi: OHNE_RASTER, basis, bezug });
    assert.equal(r300?.art, "senkrecht");
  });
  test("ohne Bezugskante bleibt alles wie 104-05 (Polar), Schalter aus = keine Spur; Einmal \"par\" wirkt auch bei ausgeschaltetem Schalter", () => {
    const w = (32 * Math.PI) / 180;
    const roh = { x: 20 + 6 * Math.cos(w), y: -6 * Math.sin(w) };
    assert.equal(fangPunkt(roh, null, { modi: OHNE_RASTER, basis })?.art, "frei");
    assert.equal(fangPunkt(roh, null, { modi: { ...OHNE_RASTER, parallel: false }, basis, bezug })?.art, "frei");
    assert.equal(fangPunkt(roh, null, { modi: { ...OHNE_RASTER, parallel: false }, basis, bezug, einmal: "parallel" })?.art, "parallel");
    assert.equal(fangPunkt(roh, null, { modi: OHNE_RASTER, basis, bezug, einmal: "senkrecht" })?.art, "frei", "Einmal senkrecht: nur die Senkrechte");
  });
  test("mit Raster: die Länge auf der schrägen Spur wird gerundet (0,25 m)", () => {
    const w = (31 * Math.PI) / 180;
    const r = fangPunkt({ x: 20 + 6.1 * Math.cos(w), y: -6.1 * Math.sin(w) }, null, { modi: FANG_STANDARD, basis, bezug });
    assert.equal(r?.art, "parallel");
    const p = /** @type {any} */ (r?.punkt);
    const l = Math.hypot(p.x - 20, p.y);
    assert.ok(Math.abs(l / 0.25 - Math.round(l / 0.25)) < 1e-9, `Länge ${l}`);
  });
  test("spurPunkt: außerhalb der Toleranz null, am Basispunkt null", () => {
    assert.equal(spurPunkt({ x: 0, y: 0 }, { x: 5, y: -5 }, 0, 5), null);
    assert.equal(spurPunkt({ x: 0, y: 0 }, { x: 0, y: 0 }, 0, 5), null);
    nah(spurPunkt({ x: 0, y: 0 }, { x: 5, y: 0.2 }, 0, 5)?.punkt, 5, 0);
  });
  test("Verlängerung: Lot mit t > 1 bzw. t < 0 auf der Geraden der Bezugskante, Strahl ab dem Kantenende", () => {
    const kante = { a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, quelle: "k1" };
    const idx = fangIndex([kante]);
    const r = fangPunkt({ x: 13.1, y: 0.2 }, idx, { modi: FANG_STANDARD, bezug: kante });
    assert.equal(r?.art, "verlaengerung");
    nah(r?.punkt, 13, 0); // 3.1 m beyond b, rounded to the 0.25 m grid → 3.0
    assert.deepEqual(r?.strahl, { von: { x: 10, y: 0 }, winkel_grad: 0 });
    assert.equal(r?.quelle, "k1");
    const links = fangPunkt({ x: -2.3, y: -0.1 }, idx, { modi: OHNE_RASTER, bezug: kante });
    assert.equal(links?.art, "verlaengerung");
    nah(links?.punkt, -2.3, 0, 1e-9);
    assert.equal(links?.strahl?.winkel_grad, 180);
    // on the edge itself (t inside 0…1) it is no extension
    assert.notEqual(fangPunkt({ x: 5, y: 0.2 }, idx, { modi: { ...OHNE_RASTER, lot: false, mitte: false }, bezug: kante })?.art, "verlaengerung");
    // without a reference edge no extension (104-05 default unchanged); the one-shot "verl" extends every edge
    assert.notEqual(fangPunkt({ x: 13.1, y: 0.2 }, idx, { modi: FANG_STANDARD })?.art, "verlaengerung");
    assert.equal(fangPunkt({ x: 13.1, y: 0.2 }, idx, { modi: FANG_STANDARD, einmal: "verlaengerung" })?.art, "verlaengerung");
    // switched off, too far beyond the end, too far from the line
    assert.notEqual(fangPunkt({ x: 13.1, y: 0.2 }, idx, { modi: { ...FANG_STANDARD, verlaengerung: false }, bezug: kante })?.art, "verlaengerung");
    assert.equal(verlaengerungPunkt([kante], { x: 10 + VERLAENGERUNG_MAX_M + 1, y: 0.1 }, 0.4), null);
    assert.equal(verlaengerungPunkt([kante], { x: 13, y: 0.6 }, 0.4), null);
  });
  test("Vorrang: Endpunkt schlägt Verlängerung; neue Arten nur angehängt, Standard kennt die drei neuen Schalter", () => {
    assert.deepEqual(FANG_ARTEN.slice(0, 5), ["endpunkt", "schnitt", "mitte", "lot", "naechster"]);
    assert.deepEqual(FANG_ARTEN.slice(5), ["verlaengerung", "hilfsgerade"]);
    assert.equal(FANG_STANDARD.parallel, true);
    assert.equal(FANG_STANDARD.senkrecht, true);
    assert.equal(FANG_STANDARD.verlaengerung, true);
    const kante = { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } };
    const idx = fangIndex([kante, { a: { x: 12, y: 0 }, b: { x: 12, y: 5 } }]);
    assert.equal(fangPunkt({ x: 12.1, y: 0.1 }, idx, { modi: OHNE_RASTER, bezug: kante })?.art, "endpunkt");
    const n = fangEinstellungenNormalisieren({ parallel: false, verlaengerung: "ja" });
    assert.equal(n.parallel, false);
    assert.equal(n.verlaengerung, true);
    assert.equal(n.senkrecht, true);
  });
  test("Befehle: par/senk/verl als Einmal-Fang, Fang-Hilfe nennt Umschalt und Alt", () => {
    assert.deepEqual(fangBefehlLesen("par"), { id: "par", art: "parallel" });
    assert.deepEqual(fangBefehlLesen("senk"), { id: "senk", art: "senkrecht" });
    assert.deepEqual(fangBefehlLesen("verl"), { id: "verl", art: "verlaengerung" });
    assert.deepEqual(Object.keys(EINMAL_FAENGE).slice(0, 5), ["end", "mit", "sch", "lot", "nae"], "alte Kurzformen unverändert");
    const reg = befehlsRegister();
    /** @type {string[]} */
    const meldungen = [];
    let einmal = "";
    fangBefehleRegistrieren(reg, { einmal: (a) => { einmal = a; }, melden: (t) => meldungen.push(t) });
    assert.equal(reg.ausfuehren("par").ok, true);
    assert.equal(einmal, "parallel");
    assert.equal(reg.ausfuehren("fanghilfe").ok, true);
    assert.equal(meldungen.at(-1), FANG_HILFE);
    assert.match(FANG_HILFE, /Umschalt hält die Achse/);
    assert.match(FANG_HILFE, /Alt = ohne Fang/);
  });
});

describe("107-07 Task 3 — Ursprung als Fangpunkt", () => {
  test("Modellierer-Index: ein Einzelpunkt (0;0) mit quelle ursprung fängt als Endpunkt", () => {
    const idx = fangIndex(segmenteAusRingen([{ punkte: [{ x: 0, y: 0 }], quelle: QUELLE_URSPRUNG }]));
    const r = fangPunkt({ x: 0.15, y: -0.2 }, idx, { modi: FANG_STANDARD });
    assert.equal(r?.art, "endpunkt");
    assert.equal(r?.quelle, QUELLE_URSPRUNG);
    nah(r?.punkt, 0, 0);
  });
  test("Lageplan: lageplanFangSegmente nimmt den Ursprung in Lagemetern auf (nicht in Zeichnungseinheiten)", async () => {
    const { lageplanFangSegmente } = await import("@designer/lib/lageplanFang.js");
    const ohne = lageplanFangSegmente({ mSite: 1.25 });
    assert.equal(ohne.length, 0);
    const mit = lageplanFangSegmente({ mSite: 1.25, ursprung: { x: 0, y: 0 } });
    assert.deepEqual(mit, [{ a: { x: 0, y: 0 }, b: { x: 0, y: 0 }, quelle: QUELLE_URSPRUNG }]);
    const r = fangPunkt({ x: 0.3, y: 0.1 }, fangIndex(mit), { toleranz_m: 0.5 });
    assert.equal(r?.quelle, QUELLE_URSPRUNG);
  });
});

describe("107-07 Task 4 — Hilfslinien und Hilfspunkte", () => {
  test("anlegen, löschen; ein Layer ohne Hilfslinie bleibt ohne Feld", () => {
    const l0 = leererLayer();
    assert.equal("hilfslinien" in l0, false);
    const r1 = hilfslinieAnlegen(l0, "gerade", { x: 0, y: 0 }, { x: 1, y: 1 });
    const r2 = hilfslinieAnlegen(r1.layer, "punkt", { x: 3, y: 4 });
    const r3 = hilfslinieAnlegen(r2.layer, "strecke", { x: 0, y: 5 }, { x: 4, y: 5 });
    assert.deepEqual(r3.layer.hilfslinien?.map((h) => [h.id, h.art]), [["h1", "gerade"], ["h2", "punkt"], ["h3", "strecke"]]);
    assert.equal("b" in /** @type {any} */ (r3.layer.hilfslinien || [])[1], false);
    assert.equal(r3.layer.naechsteId, 4, "teilt den Id-Zähler mit den Körpern");
    assert.throws(() => hilfslinieAnlegen(l0, "gerade", { x: 1, y: 1 }, { x: 1, y: 1.0001 }), /zwei verschiedene Punkte/);
    assert.throws(() => hilfslinieAnlegen(l0, /** @type {any} */ ("kreis"), { x: 0, y: 0 }), /unbekannte Art/);
    assert.deepEqual(hilfslinienLoeschen(r3.layer, ["h2"]).hilfslinien?.map((h) => h.id), ["h1", "h3"]);
    const leer = hilfslinienLoeschen(r3.layer);
    assert.equal("hilfslinien" in leer, false, "letzte gelöscht = Feld weg");
    assert.equal(hilfslinienLoeschen(l0), l0);
  });
  test("Fangsegmente: Gerade auf ±HILFSGERADE_HALB_M, Strecke, Punkt; kaputte Einträge werden übersprungen", () => {
    const layer = { ...leererLayer(), hilfslinien: [
      { id: "h1", art: "gerade", a: { x: 0, y: 0 }, b: { x: 3, y: 4 } },
      { id: "h2", art: "punkt", a: { x: 2, y: 2 } },
      { id: "h3", art: "strecke", a: { x: 0, y: 9 }, b: { x: 4, y: 9 } },
      { id: "h4", art: "gerade", a: { x: NaN, y: 0 }, b: { x: 1, y: 0 } },
      { id: "h5", art: "strecke", a: { x: 0, y: 0 } },
    ] };
    const segs = hilfslinienSegmente(/** @type {any} */ (layer), HILFSGERADE_HALB_M);
    assert.deepEqual(segs.map((s) => s.id), ["h1", "h2", "h3"]);
    assert.equal(segs[0].gerade, true);
    nah(segs[0].a, -600, -800, 1e-6);
    nah(segs[0].b, 600, 800, 1e-6);
    assert.ok(segs.every((s) => s.quelle === QUELLE_HILFSLINIE));
  });
  test("Hilfsgerade: weit weg von ihren Punkten gefangen (Lot ohne t-Grenze), kein Endpunkt an den Kappenden; Schnitt mit einer Körperkante", () => {
    const layer = { ...leererLayer(), hilfslinien: [{ id: "h1", art: "gerade", a: { x: 0, y: 0 }, b: { x: 1, y: 1 } }] };
    const koerper = segmenteAusRingen([{ punkte: [{ x: 40, y: 30 }, { x: 60, y: 30 }, { x: 60, y: 70 }, { x: 40, y: 70 }], quelle: "k1" }]);
    const idx = fangIndex([...koerper, ...hilfslinienSegmente(/** @type {any} */ (layer))]);
    const r = fangPunkt({ x: 52.2, y: 51.9 }, idx, { modi: OHNE_RASTER });
    assert.equal(r?.art, "hilfsgerade");
    nah(r?.punkt, 52.05, 52.05, 1e-9);
    // the diagonal guide crosses the edge y = 30 at (30, 30)? no: the body edge x = 40 at (40, 40) — an intersection snap
    const s = fangPunkt({ x: 40.2, y: 40.1 }, idx, { modi: OHNE_RASTER });
    assert.equal(s?.art, "schnitt");
    nah(s?.punkt, 40, 40, 1e-9);
    const ende = fangPunkt({ x: HILFSGERADE_HALB_M / Math.SQRT2 + 0.1, y: HILFSGERADE_HALB_M / Math.SQRT2 }, idx, { modi: OHNE_RASTER });
    assert.notEqual(ende?.art, "endpunkt");
    // a guide point snaps as an endpoint
    const p = hilfslinieAnlegen(leererLayer(), "punkt", { x: 7, y: 8 }).layer;
    const rp = fangPunkt({ x: 7.2, y: 8.1 }, fangIndex(hilfslinienSegmente(p)), { modi: FANG_STANDARD });
    assert.equal(rp?.art, "endpunkt");
    assert.equal(rp?.quelle, QUELLE_HILFSLINIE);
  });
  test("nie im IFC: der Export mit Hilfslinien ist Zeichen für Zeichen der Export ohne", () => {
    const { model, opts } = ifcKoerperOeffnungSzenario();
    const ohne = exportIFC(model, opts);
    const mit = exportIFC(model, { ...opts, massing: { ...opts.massing, v: 4, hilfslinien: [
      { id: "h9", art: "gerade", a: { x: 0, y: 0 }, b: { x: 5, y: 5 } }, { id: "h10", art: "punkt", a: { x: 3, y: 3 } },
    ] } });
    assert.equal(mit, ohne);
  });
  test("Befehlszeile: Hilfslinie fragt nach Punkten, Drehen nennt Kopie und Drehpunkt", () => {
    assert.deepEqual(befehlsAufforderung("hilfslinie", { punkte: [] }), { befehl: "Hilfslinie", aufforderung: "Ersten Punkt der Hilfslinie klicken" });
    assert.equal(befehlsAufforderung("hilfslinie", { punkte: [], hlArt: "punkt" }).aufforderung, "Hilfspunkt klicken");
    assert.match(befehlsAufforderung("hilfslinie", { punkte: [1] }).aufforderung, /Länge tippen/);
    assert.match(befehlsAufforderung("drehen", { auswahl: ["k1"] }).aufforderung, /Strg\+Enter = Kopie/);
    assert.match(befehlsAufforderung("drehen", { auswahl: ["k1"], kopie: true }).aufforderung, /\*4 oder \/4/);
  });
});

describe("107-07 Task 5 — gemeinsamer Reihen-Kern und Lageplan", () => {
  test("reihenFaktoren: *3 = 1, 2, 3; /3 = 1/3, 2/3, 1; geklemmt auf 1 … REIHE_MAX", () => {
    assert.deepEqual(reihenFaktoren(3, "mal"), [1, 2, 3]);
    assert.deepEqual(reihenFaktoren(3, "teilen"), [1 / 3, 2 / 3, 1]);
    assert.deepEqual(reihenFaktoren(0), [1]);
    assert.deepEqual(reihenFaktoren(Number.NaN), [1]);
    assert.equal(reihenFaktoren(1e6).length, REIHE_MAX);
  });
  test("Lageplan: kopieren mit modus teilen (7. Parameter), Standard mal unverändert", () => {
    const b = [{ id: "a", cx: 0, cy: 0, w: 10, t: 8, drehung: 0, geschosse: 3 }];
    let n = 0;
    const id = () => `n${n++}`;
    const mal = blockKopieren(/** @type {any} */ (b), ["a"], 12, 0, id, 3);
    assert.deepEqual(mal.bloecke.map((k) => k.cx), [0, 12, 24, 36]);
    assert.deepEqual(mal.neu, ["n2"], "neu = letzte Reihe (wie bisher)");
    const teilen = blockKopieren(/** @type {any} */ (b), ["a"], 12, 6, id, 3, "teilen");
    assert.deepEqual(teilen.bloecke.map((k) => [k.cx, k.cy]), [[0, 0], [4, 2], [8, 4], [12, 6]]);
  });
  test("Lageplan: gedrehte Kopien um einen Drehpunkt (*4 = 90°, 180°, 270°, 360°), Original bleibt", () => {
    const b = [{ id: "a", cx: 10, cy: 0, w: 4, t: 2, drehung: 0, geschosse: 2 }];
    let n = 0;
    const r = drehKopieren(/** @type {any} */ (b), ["a"], 90, { x: 0, y: 0 }, () => `d${n++}`, 4);
    assert.equal(r.bloecke.length, 5);
    assert.deepEqual(r.neu, ["d0", "d1", "d2", "d3"]);
    assert.deepEqual(r.bloecke[0], b[0]);
    const pos = r.bloecke.slice(1).map((k) => [Math.round(k.cx * 1e9) / 1e9 + 0, Math.round(k.cy * 1e9) / 1e9 + 0]); // + 0 turns −0 into 0
    assert.deepEqual(pos, [[0, 10], [-10, 0], [0, -10], [10, 0]]);
    const geteilt = drehKopieren(/** @type {any} */ (b), ["a"], 90, { x: 0, y: 0 }, () => `e${n++}`, 3, "teilen");
    assert.deepEqual(geteilt.bloecke.slice(1).map((k) => Math.round(k.drehung)), [30, 60, 90]);
  });
  test("Körper-Bestand: ein Layer mit Körpern und ohne Hilfslinien liest sich wie vorher (kein Feld ergänzt)", () => {
    const { layer } = koerperAnlegen(leererLayer(), [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }], 3);
    assert.deepEqual(Object.keys(layer).sort(), ["gruppen", "koerper", "naechsteId"]);
  });
});

describe("107-07 Review — Ursprung im Lageplan, Reihe auf dem aktuellen Stand, Umschalt-Sperre", () => {
  test("Lageplan-Ursprung = Projektstandort = DXF-Ursprung (Zeichnungsmitte × mSite), nicht die Ecke 0;0 der Zeichenfläche", async () => {
    const { lageplanFangSegmente, lageplanUrsprungM } = await import("@designer/lib/lageplanFang.js");
    const { CANVAS_CENTER_X, CANVAS_CENTER_Y } = await import("@designer/lib/maplibreStyles.js");
    const { lageplanDxfDaten } = await import("@designer/lib/dxfPlaene.js");
    const m = 1.25;
    const u = lageplanUrsprungM(m);
    assert.deepEqual(u, { x: CANVAS_CENTER_X * m, y: CANVAS_CENTER_Y * m });
    // the DXF export of a parcel corner on the canvas centre lies on DXF 0;0 — the same point the snap offers
    const parcel = { m_per_px: m, assumed: false, points: [{ x: CANVAS_CENTER_X, y: CANVAS_CENTER_Y }, { x: CANVAS_CENTER_X + 40, y: CANVAS_CENTER_Y }, { x: CANVAS_CENTER_X + 40, y: CANVAS_CENTER_Y + 30 }] };
    const dxf = lageplanDxfDaten({ site_parcel: parcel, areas: [], buildings: [] });
    const grenze = dxf.elemente.find((/** @type {any} */ e) => e.ebene === "GRUNDSTUECK");
    nah(grenze.punkte[0], 0, 0, 1e-9);
    // a click near the project location snaps to the origin; near the canvas corner nothing is there any more
    const idx = fangIndex(lageplanFangSegmente({ mSite: m, ursprung: u }));
    const r = fangPunkt({ x: u.x + 0.3, y: u.y - 0.2 }, idx, { toleranz_m: 0.5, modi: FANG_STANDARD });
    assert.equal(r?.art, "endpunkt");
    assert.equal(r?.quelle, QUELLE_URSPRUNG);
    nah(r?.punkt, u.x, u.y);
    assert.notEqual(fangPunkt({ x: 0.1, y: 0.1 }, idx, { toleranz_m: 0.5, modi: FANG_STANDARD })?.quelle, QUELLE_URSPRUNG);
  });

  test("Lageplan-Reihe nach Kopie: eine Pfeil-Verschiebung der Kopie bestimmt den Schritt, ein gelöschter Block bleibt gelöscht", async () => {
    const { kopieMerken, reiheAusKopie } = await import("@core/lib/massing/bloecke.js");
    let n = 0;
    const id = () => `n${n++}`;
    const a = { id: "a", cx: 0, cy: 0, breite: 10, tiefe: 5, drehung: 0, geschosse: 2 };
    const anderer = { id: "x", cx: 100, cy: 100, breite: 10, tiefe: 5, drehung: 0, geschosse: 2 };
    const basis = [a, anderer];
    const k = blockKopieren(basis, ["a"], 20, 0, id);
    const lk = kopieMerken(basis, k.bloecke, ["a"], 1);
    assert.deepEqual(lk.kopien, ["n0"]);
    // nudge the copy 1 m in +x (arrow keys) and delete the other block — then "*3"
    const jetzt = k.bloecke.filter((b) => b.id !== "x").map((b) => (b.id === "n0" ? { ...b, cx: b.cx + 1 } : b));
    const r = reiheAusKopie(jetzt, lk, 3, "mal", id);
    assert.ok(!("fehler" in r));
    if ("fehler" in r) return;
    assert.deepEqual(r.bloecke.map((b) => b.id).includes("x"), false, "der gelöschte Block kommt nicht zurück");
    assert.deepEqual(r.bloecke.filter((b) => b.id !== "a").map((b) => b.cx), [21, 42, 63], "Schritt = tatsächlicher Versatz der Kopie (21 m)");
    // typing again ("/3") replaces that row, the step stays 21 m
    const r2 = reiheAusKopie(r.bloecke, r.kopie, 3, "teilen", id);
    assert.ok(!("fehler" in r2));
    if ("fehler" in r2) return;
    assert.deepEqual(r2.bloecke.filter((b) => b.id !== "a").map((b) => Math.round(b.cx * 1000) / 1000), [7, 14, 21]);
    // the copy undone (gone) → refused, nothing rebuilt from an old snapshot
    const weg = reiheAusKopie(basis, lk, 3, "mal", id);
    assert.ok("fehler" in weg);
  });

  test("Lageplan-Reihe einer gedrehten Kopie: Winkel um den Drehpunkt auf den aktuellen Blöcken; Bruchzahl wie kopieren abgerundet", async () => {
    const { kopieMerken, reiheAusKopie } = await import("@core/lib/massing/bloecke.js");
    let n = 0;
    const id = () => `d${n++}`;
    const a = { id: "a", cx: 10, cy: 0, breite: 4, tiefe: 2, drehung: 0, geschosse: 1 };
    const k = drehKopieren([a], ["a"], 90, { x: 0, y: 0 }, id);
    const lk = kopieMerken([a], k.bloecke, ["a"], 1, { grad: 90, um: { x: 0, y: 0 } });
    const r = reiheAusKopie(k.bloecke, lk, 3, "mal", id);
    assert.ok(!("fehler" in r));
    if ("fehler" in r) return;
    assert.equal(r.bloecke.length, 4);
    assert.equal(drehKopieren([a], ["a"], 90, { x: 0, y: 0 }, id, 2.7).neu.length, 2, "2,7 → 2 wie kopieren");
  });

  test("Umschalt-Sperre: die beim Drücken eingefrorene Richtung hält über 45° hinaus; ohne Richtung bleibt ortho", () => {
    const basis = { x: 0, y: 0 };
    // frozen at 0° (x axis): the pointer at ~60° still runs on the x line, art ortho
    const r = fangPunkt({ x: 2, y: -3.5 }, null, { modi: OHNE_RASTER, basis, sperre: { winkel_grad: 0, art: "ortho" } });
    assert.equal(r?.art, "ortho");
    nah(r?.punkt, 2, 0);
    assert.equal(r?.strahl?.winkel_grad, 0);
    // behind the base point the same line, ray 180°
    const h = fangPunkt({ x: -2, y: 0.5 }, null, { modi: OHNE_RASTER, basis, sperre: { winkel_grad: 0 } });
    nah(h?.punkt, -2, 0);
    assert.equal(h?.strahl?.winkel_grad, 180);
    // a frozen parallel track keeps its kind
    const p = fangPunkt({ x: 1, y: -3 }, null, { modi: OHNE_RASTER, basis, sperre: { winkel_grad: 30, art: "parallel" } });
    assert.equal(p?.art, "parallel");
    assert.equal(p?.strahl?.winkel_grad, 30);
    // without sperre the behaviour is the old one (polar 90° ± 5°: at 60° no ray)
    assert.equal(fangPunkt({ x: 2, y: -3.5 }, null, { modi: OHNE_RASTER, basis })?.art, "frei");
  });

  test("Einmal-Spur par/senk ohne Bezugskante: Polar bleibt als Rückfall (der Zeiger war vorher ganz frei)", () => {
    const r = fangPunkt({ x: 5, y: 0.1 }, null, { modi: OHNE_RASTER, basis: { x: 0, y: 0 }, einmal: "parallel" });
    assert.equal(r?.art, "polar");
    nah(r?.punkt, 5, 0);
  });
});
