// 107-05: massing profile — orientation convention (profilNormieren), validity (profilGueltig: self-intersection, double
// point, no area, inner rings), edits that refuse an invalid profile, inner rings (`loecher`) through geometrie, groups, scale
// and the IFC export (IfcArbitraryProfileDefWithVoids, own golden), derived faces, closed Follow me and profile steps.
// Hand calculations next to the assertions.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  leererLayer, geometrie, koerperAnlegen, eckeVerschieben, gruppeBilden, gruppeAendern, eindeutigMachen, skalieren, aufstocken,
  profilNormieren, profilGueltig, koerperGueltig, gespeicherterEckIndex, flaechen, pfadUmriss, pfadRing, folgeMir, profilStufen,
  PROFIL_STUFEN_MASSE, PROFIL_MIN_FLAECHE_M2, PROFIL_GRUND_TEXT, PROFIL_VORLAGEN, profilMaengel,
} from "@core/lib/massing/massingModell.js";
import * as formCore from "@core/lib/formGeometrie.js";
import * as formDesigner from "@designer/lib/formGeometrie";
import { exportIFC, WARNART_MASSING } from "@designer/lib/ifcExport";
import { ifcLoecherSzenario } from "./fixtures/ifcLoecherModell-10705.js";

/** Shoelace area in the x/y frame (positive = the outer-ring convention). */
const A = (/** @type {Array<{x:number,y:number}>} */ r) => r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + p.x * q.y - q.x * p.y; }, 0) / 2;

const Q = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }]; // positive: +12
const Q_ANDERS = [{ x: 0, y: 0 }, { x: 0, y: 3 }, { x: 4, y: 3 }, { x: 4, y: 0 }]; // same square, negative: -12
const HOF = [{ x: 1, y: 1 }, { x: 3, y: 1 }, { x: 3, y: 2 }, { x: 1, y: 2 }]; // 2 × 1 inside Q, positive

describe("107-05 Task 1 — formGeometrie liegt in @core, @designer re-exportiert", () => {
  it("dieselben Funktionen (Identität), alle Exporte vorhanden", () => {
    assert.equal(formDesigner.flaecheSigniert, formCore.flaecheSigniert);
    assert.equal(formDesigner.schneideHalbebeneTeile, formCore.schneideHalbebeneTeile);
    assert.deepEqual(Object.keys(formDesigner).sort(), Object.keys(formCore).sort());
  });
  it("massingModell.js (in @core) importiert nur @core-Dateien", () => {
    const text = readFileSync(fileURLToPath(new URL("../../packages/nova-core/src/lib/massing/massingModell.js", import.meta.url)), "utf8");
    for (const m of text.matchAll(/from\s+"([^"]+)"/g)) assert.ok(m[1].startsWith("../") || m[1].startsWith("./") || m[1].startsWith("@core/"), m[1]);
  });
});

describe("107-05 Task 2 — Orientierung (profilNormieren)", () => {
  it("Außenring positiv, Innenring negativ; erste Ecke bleibt erste Ecke; Eingabe unverändert", () => {
    assert.equal(A(Q), 12);
    assert.equal(A(Q_ANDERS), -12);
    const kopie = JSON.stringify(Q_ANDERS);
    const n = profilNormieren(Q_ANDERS);
    assert.equal(A(n), 12);
    assert.deepEqual(n[0], Q_ANDERS[0]);
    assert.deepEqual(n, [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }]);
    assert.equal(JSON.stringify(Q_ANDERS), kopie);
    assert.deepEqual(profilNormieren(Q), Q, "schon richtig herum: gleiche Punkte");
    assert.equal(A(profilNormieren(HOF, "innen")), -2);
  });

  it("geometrie(): richtig herum unverändert (Form wie vor 107-05), andersherum normalisiert mit Eck-Abbildung", () => {
    const a = koerperAnlegen(leererLayer(), Q, 3);
    assert.deepEqual(geometrie(a.layer, a.layer.koerper[0]), { profil: Q, hoehe: 3, basis: 0 });
    const b = koerperAnlegen(leererLayer(), Q_ANDERS, 3);
    const k = b.layer.koerper[0];
    assert.deepEqual(k.profil, Q_ANDERS, "gespeichert wird die Klickreihenfolge");
    const g = geometrie(b.layer, k);
    assert.equal(g.umgekehrt, true);
    assert.equal(A(g.profil), 12);
    // resolved corner i ↔ stored corner: 0→0, 1→3, 2→2, 3→1
    for (let i = 0; i < 4; i++) assert.deepEqual(g.profil[i], Q_ANDERS[gespeicherterEckIndex(4, i, true)]);
    assert.equal(gespeicherterEckIndex(4, 2, false), 2);
  });

  it("Drehung ändert die Orientierung nicht (gedrehte Instanz bleibt positiv)", () => {
    let { layer, id } = koerperAnlegen(leererLayer(), Q_ANDERS, 3);
    layer = { ...layer, koerper: layer.koerper.map((k) => (k.id === id ? { ...k, drehung: 137 } : k)) };
    assert.ok(A(geometrie(layer, layer.koerper[0]).profil) > 11.99);
  });

  it("Ecke ziehen an einem andersherum gespeicherten Körper trifft die gezeigte Ecke", () => {
    const { layer, id } = koerperAnlegen(leererLayer(), Q_ANDERS, 3);
    const g = geometrie(layer, layer.koerper[0]);
    // resolved corner 1 = (4,0); pull it to (5,0)
    const neu = eckeVerschieben(layer, id, gespeicherterEckIndex(4, 1, g.umgekehrt), { x: 5, y: 0 });
    assert.deepEqual(geometrie(neu, neu.koerper[0]).profil[1], { x: 5, y: 0 });
  });
});

describe("107-05 Task 2 — Gültigkeit (profilGueltig)", () => {
  it("gültig: Rechteck, konkaves L, Rechteck mit Punkt auf der Kante (kollinear erlaubt)", () => {
    assert.deepEqual(profilGueltig(Q), { ok: true });
    assert.equal(profilGueltig([{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 5 }, { x: 0, y: 5 }]).ok, true);
    assert.equal(profilGueltig([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }]).ok, true);
  });
  it("Selbstschnitt: Fliege (gekreuzte Kanten), Rückläufer-Spitze, Berührung nicht benachbarter Kanten", () => {
    const fliege = profilGueltig([{ x: 0, y: 0 }, { x: 4, y: 4 }, { x: 4, y: 0 }, { x: 0, y: 4 }]);
    assert.equal(fliege.ok, false);
    assert.equal(fliege.grund, "selbstschnitt");
    assert.equal(fliege.text, PROFIL_GRUND_TEXT.selbstschnitt);
    assert.equal(fliege.ring, "aussen");
    // spike: (4,3) → (4,6) → (4,1) runs back on its own edge (cross product 0, dot < 0)
    assert.equal(profilGueltig([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 4, y: 6 }, { x: 4, y: 1 }, { x: 0, y: 3 }]).grund, "selbstschnitt");
    // pinch: corner (2,0)… the ring touches itself at (2,2) (two non-neighbouring edges meet in one point)
    assert.equal(profilGueltig([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 2, y: 2 }, { x: 4, y: 4 }, { x: 0, y: 4 }, { x: 2, y: 2 }]).grund, "selbstschnitt");
  });
  it("Doppelpunkt (< 1 mm), keine Fläche (kollinear), zu wenig Punkte, NaN", () => {
    assert.equal(profilGueltig([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 0.0005 }, { x: 4, y: 3 }, { x: 0, y: 3 }]).grund, "doppelpunkt");
    assert.equal(profilGueltig([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }]).grund, "flaeche");
    // 5 mm × 5 mm = 25 cm²... is 0.0025 m² ≥ 1e-4: valid; 5 mm × 1.5 cm triangle = 0.0000375 m² < 1e-4: no area
    assert.equal(profilGueltig([{ x: 0, y: 0 }, { x: 0.005, y: 0 }, { x: 0, y: 0.015 }]).grund, "flaeche");
    assert.ok(PROFIL_MIN_FLAECHE_M2 === 1e-4);
    assert.equal(profilGueltig(Q.slice(0, 2)).grund, "punkte");
    assert.equal(profilGueltig([{ x: 0, y: 0 }, { x: NaN, y: 0 }, { x: 0, y: 3 }]).grund, "zahl");
  });
  it("Innenringe: frei im Profil gültig; außerhalb, berührend, sich schneidend, sich überlappend ungültig", () => {
    assert.equal(profilGueltig(Q, { loecher: [HOF] }).ok, true);
    const aussen = profilGueltig(Q, { loecher: [[{ x: 3, y: 1 }, { x: 5, y: 1 }, { x: 5, y: 2 }, { x: 3, y: 2 }]] });
    assert.deepEqual([aussen.grund, aussen.ring], ["loch", 0]);
    assert.equal(profilGueltig(Q, { loecher: [[{ x: 0, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }, { x: 0, y: 2 }]] }).grund, "loch", "berührt den Außenring");
    const schleife = profilGueltig(Q, { loecher: [[{ x: 1, y: 1 }, { x: 3, y: 2 }, { x: 3, y: 1 }, { x: 1, y: 2 }]] });
    assert.deepEqual([schleife.grund, schleife.text], ["selbstschnitt", "Innenring schneidet sich selbst"]);
    const zwei = profilGueltig(Q, { loecher: [HOF, [{ x: 2, y: 1.5 }, { x: 3.5, y: 1.5 }, { x: 3.5, y: 2.5 }, { x: 2, y: 2.5 }]] });
    assert.deepEqual([zwei.grund, zwei.ring], ["loch", 1]);
  });
});

describe("107-05 Task 2 — Edits lehnen ungültige Profile ab", () => {
  const FLIEGE = [{ x: 0, y: 0 }, { x: 4, y: 4 }, { x: 4, y: 0 }, { x: 0, y: 4 }];
  it("koerperAnlegen: Eingabe abgelehnt (Error mit grund), Import/Backen legt an und markiert abgeleitet", () => {
    assert.throws(() => koerperAnlegen(leererLayer(), FLIEGE, 3), (e) => e.grund === "selbstschnitt" && /schneidet sich selbst/.test(e.message));
    const r = koerperAnlegen(leererLayer(), FLIEGE, 3, { pruefen: false });
    assert.equal(r.layer.koerper.length, 1);
    assert.equal(koerperGueltig(r.layer, r.layer.koerper[0]).grund, "selbstschnitt");
    assert.equal("ungueltig" in r.layer.koerper[0], false, "die Gültigkeit wird nie gespeichert");
  });
  it("eckeVerschieben: Ecke über die Gegenkante ziehen → abgelehnt, Layer unverändert, Grund gemeldet", () => {
    const { layer, id } = koerperAnlegen(leererLayer(), Q, 3);
    let grund = null;
    // corner 1 (4,0) to (-1,1.5): edge (-1,1.5)→(4,3) crosses edge (0,3)→(0,0) at (0, 1.8)
    const neu = eckeVerschieben(layer, id, 1, { x: -1, y: 1.5 }, { abgelehnt: (pr) => { grund = pr.grund; } });
    assert.equal(neu, layer);
    assert.equal(grund, "selbstschnitt");
    const ok = eckeVerschieben(layer, id, 1, { x: 5, y: 0 });
    assert.deepEqual(ok.koerper[0].profil[1], { x: 5, y: 0 });
  });
  it("Gruppe: eine Ecke einer Instanz ungültig ziehen ändert die Definition nicht; gruppeAendern lehnt ab", () => {
    const a = koerperAnlegen(leererLayer(), Q, 3);
    const g = gruppeBilden(a.layer, [a.id]);
    let gemeldet = 0;
    const neu = eckeVerschieben(g.layer, a.id, 1, { x: -1, y: 1.5 }, { abgelehnt: () => { gemeldet++; } });
    assert.equal(neu, g.layer);
    assert.equal(gemeldet, 1);
    assert.equal(gruppeAendern(g.layer, g.nr, { profil: FLIEGE }), g.layer);
    assert.equal(gruppeAendern(g.layer, g.nr, { hoehe: 7 }).gruppen[g.nr].hoehe, 7, "nur die Höhe: keine Profilprüfung nötig");
  });
  it("skalieren: Faktor, der das Profil unter die Mindestfläche drückt, wird als Ganzes abgelehnt", () => {
    const a = koerperAnlegen(leererLayer(), Q, 3);
    let grund = null;
    // 4 × 3 m · 0.002 = 8 mm × 6 mm = 0.000048 m² < 1e-4 m²
    assert.equal(skalieren(a.layer, [a.id], { x: 0, y: 0 }, 0.002, { abgelehnt: (pr) => { grund = pr.grund; } }), a.layer);
    assert.equal(grund, "flaeche");
    assert.notEqual(skalieren(a.layer, [a.id], { x: 0, y: 0 }, 0.5), a.layer);
  });
});

describe("107-05 Task 4 — Innenringe (loecher) im Modell", () => {
  it("koerperAnlegen speichert loecher nur, wenn es welche gibt; geometrie löst sie auf (Lage, Orientierung negativ)", () => {
    const ohne = koerperAnlegen(leererLayer(), Q, 3);
    assert.equal("loecher" in ohne.layer.koerper[0], false);
    let { layer, id } = koerperAnlegen(leererLayer(), Q, 3, { loecher: [HOF] });
    layer = { ...layer, koerper: layer.koerper.map((k) => (k.id === id ? { ...k, pos: { x: 10, y: 20 } } : k)) };
    const g = geometrie(layer, layer.koerper[0]);
    assert.equal(g.loecher.length, 1);
    assert.equal(A(g.loecher[0]), -2);
    assert.deepEqual(g.loecher[0][0], { x: 11, y: 21 });
    assert.equal(koerperGueltig(layer, layer.koerper[0]).ok, true);
    assert.throws(() => koerperAnlegen(leererLayer(), Q, 3, { loecher: [[{ x: 3, y: 1 }, { x: 5, y: 1 }, { x: 5, y: 2 }]] }), (e) => e.grund === "loch");
  });
  it("Gruppe: Loch wandert in die Definition, Instanzen lösen es mit ihrer Lage auf; eindeutig kopiert tief; skalieren skaliert mit", () => {
    const a = koerperAnlegen(leererLayer(), Q, 3, { loecher: [HOF] });
    const g = gruppeBilden(a.layer, [a.id]);
    assert.equal("loecher" in g.layer.koerper[0], false);
    assert.equal(g.layer.gruppen[g.nr].loecher.length, 1);
    assert.equal(geometrie(g.layer, g.layer.koerper[0]).loecher.length, 1);
    const e = eindeutigMachen(g.layer, a.id);
    assert.notEqual(e.layer.gruppen[e.nr].loecher, g.layer.gruppen[g.nr].loecher);
    assert.deepEqual(e.layer.gruppen[e.nr].loecher, g.layer.gruppen[g.nr].loecher);
    const s = skalieren(g.layer, [a.id], { x: 0, y: 0 }, 2);
    assert.deepEqual(s.gruppen[g.nr].loecher[0][2], { x: 6, y: 4 });
    const frei = skalieren(a.layer, [a.id], { x: 0, y: 0 }, 2);
    assert.deepEqual(frei.koerper[0].loecher[0][0], { x: 2, y: 2 });
  });
  it("aufstocken nimmt den Hof mit", () => {
    const a = koerperAnlegen(leererLayer(), Q, 3, { loecher: [HOF] });
    const r = aufstocken(a.layer, a.id, 3);
    assert.equal(geometrie(r.layer, r.layer.koerper[1]).loecher.length, 1);
  });
  it("flaechen(): Deckel, Boden, je Kante eine Seite; Normalen zeigen aus dem Material (auch in den Hof)", () => {
    const { layer } = koerperAnlegen(leererLayer(), Q, 3, { loecher: [HOF], basis: 1 });
    const f = flaechen(layer, layer.koerper[0]);
    assert.equal(f.length, 2 + 4 + 4);
    const deckel = f.find((x) => x.art === "deckel");
    assert.equal(deckel.z, 4);
    assert.equal(f.find((x) => x.art === "boden").z, 1);
    // outer edge 0 (0,0)→(4,0): material lies at y > 0, so the normal is (0,-1)
    const s0 = f.find((x) => x.art === "seite" && x.ring === "aussen" && x.kante === 0);
    assert.deepEqual(s0.normale, { x: 0, y: -1 });
    // every courtyard side points towards the courtyard centre (2, 1.5)
    for (const s of f.filter((x) => x.art === "seite" && x.ring === 0)) {
      const m = { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 };
      assert.ok((2 - m.x) * s.normale.x + (1.5 - m.y) * s.normale.y > 0, JSON.stringify(s));
    }
    assert.equal(JSON.stringify(layer).includes("deckel"), false, "Flächen werden nie gespeichert");
  });
});

describe("107-05 Task 4 — IFC: IfcArbitraryProfileDefWithVoids, ungültige Körper per onWarn", () => {
  const lies = (/** @type {string} */ name) => readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");
  it("eigener Golden (ifc-golden-107-loecher.ifc) Zeichen für Zeichen", () => {
    const { model, opts } = ifcLoecherSzenario();
    const meldungen = [];
    const ifc = exportIFC(model, { ...opts, onWarn: (m, art, daten) => meldungen.push({ m, art, daten }) });
    const pfad = fileURLToPath(new URL("./fixtures/ifc-golden-107-loecher.ifc", import.meta.url));
    if (!existsSync(pfad) && process.env.GOLDEN_SCHREIBEN === "1") writeFileSync(pfad, ifc);
    assert.equal(ifc, lies("ifc-golden-107-loecher.ifc"));
    // the bow-tie body is left out and reported (kind + id + reason), nothing else warns
    assert.deepEqual(meldungen.map((x) => [x.art, x.daten?.id, x.daten?.grund]), [[WARNART_MASSING, "k6", "selbstschnitt"]]);
    assert.match(meldungen[0].m, /Schleife: Profil schneidet sich selbst — nicht exportiert/);
  });
  it("Inhalt des Golden: Hof-Körper mit Voids, Ring mit Voids, Gruppe mit Voids, Andersrum normalisiert, Schleife fehlt", () => {
    const ifc = lies("ifc-golden-107-loecher.ifc");
    const proxies = ifc.split("\n").filter((l) => l.includes("IFCBUILDINGELEMENTPROXY("));
    assert.deepEqual(proxies.map((l) => /'(k\d)',\.ELEMENT\./.exec(l)?.[1]), ["k1", "k2", "k3", "k4", "k5"]);
    assert.equal((ifc.match(/IFCARBITRARYPROFILEDEFWITHVOIDS\(/g) || []).length, 4, "k1, k2, k3, k4");
    assert.ok(/IFCARBITRARYPROFILEDEFWITHVOIDS\(\.AREA\.,\$,#\d+,\(#\d+\)\)/.test(ifc));
    // k5 "Andersrum" (stored (0,0)(0,4)(5,4)(5,0) at pos (-10,0), bezug (20,20)) is written normalised:
    // (-30,-20) (-25,-20) (-25,-16) (-30,-16) — positive area in the IFC profile plane
    const pts = [...ifc.matchAll(/IFCCARTESIANPOINT\(\((-?[\d.]+),(-?[\d.]+)\)\)/g)].map((m) => `${Number(m[1])},${Number(m[2])}`);
    const i = pts.indexOf("-30,-20");
    assert.deepEqual(pts.slice(i, i + 4), ["-30,-20", "-25,-20", "-25,-16", "-30,-16"]);
  });
  it("ohne loecher bleibt das Profil IfcArbitraryClosedProfileDef (Golden 107-01 unverändert, eigener Test)", () => {
    const { model, opts } = ifcLoecherSzenario();
    const ohne = { ...opts.massing, koerper: opts.massing.koerper.filter((k) => k.id === "k5") };
    const ifc = exportIFC(model, { ...opts, massing: ohne });
    assert.equal(ifc.includes("IFCARBITRARYPROFILEDEFWITHVOIDS"), false);
  });
});

describe("107-05 Task 5 — Folge mir: geschlossener Pfad, Selbstschnitt, Profilstufen", () => {
  const QUADRAT = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  it("pfadRing: Quadrat 10 m, Breite 0,3 → Außen 10,3 m, Innen 9,7 m, gültig", () => {
    const r = pfadRing(QUADRAT, 0.3);
    assert.equal(r.pruefung.ok, true);
    assert.ok(Math.abs(Math.abs(A(r.aussen)) - 10.3 * 10.3) < 1e-6);
    assert.ok(Math.abs(Math.abs(A(r.innen)) - 9.7 * 9.7) < 1e-6);
    // a repeated closing point is dropped
    assert.equal(pfadRing([...QUADRAT, { x: 0, y: 0 }], 0.3).aussen.length, 4);
  });
  it("folgeMir geschlossen: ein Körper mit Hof, Grundfläche 10,3² − 9,7² = 12 m²", () => {
    const r = folgeMir(leererLayer(), QUADRAT, 0.3, 3, { geschlossen: true });
    const g = geometrie(r.layer, r.layer.koerper[0]);
    assert.equal(g.loecher.length, 1);
    assert.ok(Math.abs(A(g.profil) + A(g.loecher[0]) - 12) < 1e-6);
    assert.equal(koerperGueltig(r.layer, r.layer.koerper[0]).ok, true);
  });
  it("geschlossen, spitzer Winkel: der Innen-Versatz klappt über sich → gemeldet, nichts angelegt", () => {
    // M-shaped ring with a deep notch (vertex (5, 0.5)): the inner offset point of the notch lands at y ≈ -0.99, below the
    // inner edge y = 1 — the inner ring crosses itself
    const m = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 6 }, { x: 5, y: 0.5 }, { x: 0, y: 6 }];
    const r = pfadRing(m, 2);
    assert.deepEqual([r.pruefung.ok, r.pruefung.grund, r.pruefung.ring], [false, "selbstschnitt", 0]);
    assert.throws(() => folgeMir(leererLayer(), m, 2, 3, { geschlossen: true }), (e) => e.grund === "selbstschnitt" && /Innenring/.test(e.message));
  });
  it("geschlossen, Querschnitt breiter als der Hof: Innenring klappt um → gemeldet (sähe sonst sauber aus)", () => {
    // square 10 m, section 12 m: the "inner ring" (4…6) runs the wrong way round although it lies inside the outer one
    const r = pfadRing(QUADRAT, 12);
    assert.equal(r.pruefung.ok, false);
    assert.match(r.pruefung.text, /klappt um/);
    assert.equal(pfadRing(QUADRAT, 9).pruefung.ok, true, "9 m Querschnitt: Hof 1 × 1 m bleibt");
  });
  it("offen, spitzer Winkel (bisher ungeprüft): der Umriss schneidet sich → abgelehnt", () => {
    const pfad = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 1 }];
    assert.equal(profilGueltig(pfadUmriss(pfad, 2)).grund, "selbstschnitt");
    assert.throws(() => folgeMir(leererLayer(), pfad, 2, 3), (e) => e.grund === "selbstschnitt");
    // the gentle case still works as before
    assert.equal(folgeMir(leererLayer(), [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], 0.3, 3).layer.koerper.length, 1);
  });
  it("Profilstufen: Sockel + Wand = zwei Körper übereinander, Gesamthöhe bleibt die getippte Höhe", () => {
    assert.ok(PROFIL_VORLAGEN.some(([id]) => id === "sockel"));
    const st = profilStufen("sockel", 0.3, 3);
    assert.deepEqual(st.map((s) => [s.name, s.breite, s.hoehe]), [["Sockel", 0.4, PROFIL_STUFEN_MASSE.sockelHoehe], ["Wand", 0.3, 2.5]]);
    const r = folgeMir(leererLayer(), [{ x: 0, y: 0 }, { x: 10, y: 0 }], 0.3, 3, { stufen: st });
    assert.equal(r.ids.length, 2);
    const [s, w] = r.layer.koerper.map((k) => geometrie(r.layer, k));
    assert.deepEqual([s.basis, s.hoehe, w.basis, w.hoehe], [0, 0.5, 0.5, 2.5]);
    // plinth 0.40 wide: y from -0.2 to 0.2; wall 0.30: -0.15 … 0.15
    assert.deepEqual([Math.min(...s.profil.map((p) => p.y)), Math.max(...s.profil.map((p) => p.y))], [-0.2, 0.2]);
    assert.deepEqual([Math.min(...w.profil.map((p) => p.y)), Math.max(...w.profil.map((p) => p.y))], [-0.15, 0.15]);
    assert.deepEqual(profilStufen("sockel-gesims", 0.3, 3).map((x) => x.hoehe), [0.5, 2.3, 0.2]);
    assert.equal(profilStufen("einfach", 0.3, 3).length, 1);
  });
  it("Profilstufen: Versatz verschiebt die Stufe seitlich; geschlossener Pfad mit Stufen hat je Stufe einen Hof", () => {
    const r = folgeMir(leererLayer(), [{ x: 0, y: 0 }, { x: 10, y: 0 }], 0.3, 3, { stufen: [{ name: "Wand", breite: 0.3, hoehe: 3 }, { name: "Gesims", breite: 0.2, hoehe: 0.2, versatz: 0.25 }] });
    const ge = geometrie(r.layer, r.layer.koerper[1]);
    // normal of the path (+x) is (0, 1): offset 0.25 → centre line y = 0.25, cornice from 0.15 to 0.35, base on the wall top
    assert.deepEqual([Math.min(...ge.profil.map((p) => p.y)), Math.max(...ge.profil.map((p) => p.y)), ge.basis], [0.15, 0.35, 3]);
    const zu = folgeMir(leererLayer(), QUADRAT, 0.3, 3, { geschlossen: true, stufen: profilStufen("gesims", 0.3, 3) });
    assert.deepEqual(zu.layer.koerper.map((k) => (geometrie(zu.layer, k).loecher || []).length), [1, 1]);
    assert.throws(() => folgeMir(leererLayer(), QUADRAT, 0.3, 0.4, { stufen: profilStufen("sockel", 0.3, 0.4) }), /reicht nicht/);
  });
});

describe("107-05 Review — ungültige Körper schrittweise reparieren, Versatz auf geschlossenem Pfad", () => {
  // bow-tie with a near-double point: corners (0,6) and (0,6.0004) are 0.4 mm apart (< 1 mm) and edge (0,0)→(6,6) crosses
  // edge (6,0)→(0,6) at (3,3) — two faults, the kind of body an old project or a baked node graph can hold
  const ZWEI_FEHLER = [{ x: 0, y: 0 }, { x: 6, y: 6 }, { x: 6, y: 0 }, { x: 0, y: 6 }, { x: 0, y: 6.0004 }];
  const FLIEGE4 = [{ x: 0, y: 0 }, { x: 4, y: 4 }, { x: 4, y: 0 }, { x: 0, y: 4 }];

  it("profilMaengel zählt je Grund; gültiges Profil = keine Mängel", () => {
    assert.deepEqual(profilMaengel(Q), {});
    const z = profilMaengel(ZWEI_FEHLER);
    assert.equal(z.doppelpunkt, 1);
    assert.ok(z.selbstschnitt >= 1);
  });

  it("eckeVerschieben: Körper mit zwei Fehlern wird Schritt für Schritt repariert, jeder Schritt behebt einen Fehler", () => {
    const a = koerperAnlegen(leererLayer(), ZWEI_FEHLER, 3, { pruefen: false });
    /** @type {string|null} */
    let grund = null;
    // step 1: corner 1 (6,6) → (3,-3) removes the crossing; the double point is still there → allowed, still invalid
    const s1 = eckeVerschieben(a.layer, a.id, 1, { x: 3, y: -3 }, { abgelehnt: (pr) => { grund = pr.grund || null; } });
    assert.notEqual(s1, a.layer);
    assert.equal(grund, null);
    assert.equal(koerperGueltig(s1, s1.koerper[0]).grund, "doppelpunkt");
    // step 2: corner 4 (0,6.0004) → (-1,7) removes the double point: ring (0,0),(3,-3),(6,0),(0,6),(-1,7) is simple
    const s2 = eckeVerschieben(s1, a.id, 4, { x: -1, y: 7 });
    assert.notEqual(s2, s1);
    assert.equal(koerperGueltig(s2, s2.koerper[0]).ok, true);
    // the other order works too: first the double point apart (crossing still there), then the crossing
    const t1 = eckeVerschieben(a.layer, a.id, 4, { x: -1, y: 7 });
    assert.notEqual(t1, a.layer);
    assert.equal(koerperGueltig(t1, t1.koerper[0]).grund, "selbstschnitt");
  });

  it("eckeVerschieben: auf einem ungültigen Körper wird ein Zug abgelehnt, der einen neuen Fehler hinzufügt", () => {
    const a = koerperAnlegen(leererLayer(), FLIEGE4, 3, { pruefen: false });
    /** @type {string|null} */
    let grund = null;
    // corner 3 (0,4) → (4,0.0005): 0.5 mm from corner 2 (4,0) — a double point that was not there before
    assert.equal(eckeVerschieben(a.layer, a.id, 3, { x: 4, y: 0.0005 }, { abgelehnt: (pr) => { grund = pr.grund || null; } }), a.layer);
    assert.equal(grund, "doppelpunkt");
    // a valid body may still not become invalid (unchanged rule)
    const v = koerperAnlegen(leererLayer(), Q, 3);
    assert.equal(eckeVerschieben(v.layer, v.id, 1, { x: -1, y: 1.5 }), v.layer);
  });

  it("gruppeAendern: dieselbe Regel — ungültige Definition darf repariert, aber nicht verschlechtert werden", () => {
    const a = koerperAnlegen(leererLayer(), ZWEI_FEHLER, 3, { pruefen: false });
    const g = gruppeBilden(a.layer, [a.id]);
    const s1 = eckeVerschieben(g.layer, a.id, 1, { x: 3, y: -3 });
    assert.notEqual(s1, g.layer);
    assert.deepEqual(s1.gruppen[g.nr].profil[1], { x: 3, y: -3 });
    assert.equal(koerperGueltig(s1, s1.koerper[0]).grund, "doppelpunkt");
    let gemeldet = 0;
    // a second double point on top of the first → refused
    const schlimmer = ZWEI_FEHLER.map((p, i) => (i === 2 ? { x: 6, y: 6.0005 } : p));
    assert.equal(gruppeAendern(g.layer, g.nr, { profil: schlimmer }, { abgelehnt: () => { gemeldet++; } }), g.layer);
    assert.equal(gemeldet, 1);
  });

  it("geschlossener Pfad: +Versatz liegt außen, gleich in beiden Klickrichtungen", () => {
    const rechts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]; // area +100
    const links = [{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 0 }]; // area -100
    const stufen = [{ name: "Gesims", breite: 0.2, hoehe: 0.2, versatz: 0.25 }];
    for (const pfad of [rechts, links]) {
      const r = folgeMir(leererLayer(), pfad, 0.2, 0.2, { geschlossen: true, stufen });
      const g = geometrie(r.layer, r.layer.koerper[0]);
      const xs = g.profil.map((p) => p.x), ix = (g.loecher || [])[0].map((p) => p.x);
      // centre line 0.25 m outside the path: outer face at -0.35 / 10.35, inner face at -0.15 / 10.15
      assert.deepEqual([Math.min(...xs), Math.max(...xs)], [-0.35, 10.35]);
      assert.deepEqual([Math.min(...ix), Math.max(...ix)], [-0.15, 10.15]);
    }
  });

  it("Vorlage „Wand + Gesims (nur außen)“: Gesims steht nur außen über, innen bündig mit der Wand", () => {
    assert.ok(PROFIL_VORLAGEN.some(([id]) => id === "gesims-aussen"));
    const QUADRAT10 = [{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 0 }];
    const r = folgeMir(leererLayer(), QUADRAT10, 0.3, 3, { geschlossen: true, stufen: profilStufen("gesims-aussen", 0.3, 3) });
    const [w, ge] = r.layer.koerper.map((k) => geometrie(r.layer, k));
    const span = (/** @type {Array<{x:number}>} */ ps) => [Math.min(...ps.map((p) => p.x)), Math.max(...ps.map((p) => p.x))];
    // wall 0.30: outer -0.15 / 10.15, inner 0.15 / 9.85; cornice 0.45 wide, centre 0.075 outside: outer -0.30 / 10.30, inner 0.15 / 9.85
    assert.deepEqual(span(w.profil), [-0.15, 10.15]);
    assert.deepEqual(span(ge.profil), [-0.3, 10.3]);
    assert.deepEqual(span((ge.loecher || [])[0]), span((w.loecher || [])[0]));
    assert.deepEqual(profilStufen("sockel-gesims-aussen", 0.3, 3).map((s) => [s.breite, s.versatz ?? 0]), [[0.35, 0.025], [0.3, 0], [0.45, 0.075]]);
  });
});
