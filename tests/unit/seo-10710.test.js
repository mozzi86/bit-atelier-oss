// 107-10 — roof library, solid relations (wall under roof, body against body), basement with terrain subtraction, IFC output.
// Every expected value is calculated by hand (comment next to it); the library result is never its own reference.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { csgLaden } from "@core/lib/csg/laden.js";
import {
  dachBerechnen, dachDreiecke, dachRahmen, dachEbenen, dachHoeheAn, dachVonDachelement, globalerDachAnstieg_m, DACHFORMEN,
} from "@core/lib/bauteil/dachGeometrie.js";
import { dachNeigung_grad, dachFirsthoehe_m, dachMigrieren } from "@core/lib/bauteil/hoehen.js";
import {
  wandUnterDach, aufgeloesteGeometrie, koerperOperation, relationAnlegen, relationAktivSetzen, relationWirkt, relationenVon,
  analytischWandUnterDach, dachImRahmen, wandProfilUnterDach, seoSchnittFlaechen,
} from "@core/lib/bauteil/seo.js";
import { wandBasis } from "@core/lib/csg/bauteil.js";
import { untergeschossMitGelaende, gelaendeBlock, gelaendeAbgleich, GELAENDE_SCHWELLE_REL } from "@core/lib/bauteil/gelaendeSolid.js";
import { stempeln } from "@core/lib/massing/gelaende.js";
import { istWasserdicht } from "@core/lib/csg/wasserdicht.js";
import { volumen_m3 } from "@core/lib/csg/volumen.js";
import { csgWarnungText } from "@core/lib/bauteil/csgWarnung.js";
import { createBuildingModel } from "@core/lib/buildingModel.js";
import { dachSetzen, geometrie as massingGeometrie } from "@core/lib/massing/massingModell.js";
import { FELD_NAMEN } from "@core/lib/abgleich/modellAbgleich.js";
import { exportIFC, WARNART_SEO, WARNART_DACH } from "@designer/lib/ifcExport";

// 107-18: the backend is a WebAssembly library — csgLaden() instantiates it before the first boolean
const kern = await csgLaden();

const nahe = (/** @type {number} */ ist, /** @type {number} */ soll, /** @type {number} */ tol, /** @type {string} */ was) =>
  assert.ok(Math.abs(ist - soll) <= tol, `${was}: ${ist} statt ${soll} (±${tol})`);
const rechteck = (/** @type {number} */ x0, /** @type {number} */ z0, /** @type {number} */ x1, /** @type {number} */ z1) =>
  [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];

// ---------------------------------------------------------------------------------------------------------------------------
// the old builders of BitBimStudio.jsx (until 107-10), copied verbatim as the reference of the old/new comparison
function altSattel(points, baseY, height) {
  const xs = points.map((p) => p.x), zs = points.map((p) => p.z);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2, hY = baseY + height;
  const pos = []; const tri = (a, b, c) => pos.push(...a, ...b, ...c);
  if ((maxX - minX) >= (maxZ - minZ)) {
    const A = [minX, baseY, minZ], B = [maxX, baseY, minZ], C = [maxX, baseY, maxZ], D = [minX, baseY, maxZ];
    const R1 = [minX, hY, cz], R2 = [maxX, hY, cz];
    tri(A, B, R2); tri(A, R2, R1); tri(R1, R2, C); tri(R1, C, D); tri(A, R1, D); tri(B, C, R2);
  } else {
    const A = [minX, baseY, minZ], B = [maxX, baseY, minZ], C = [maxX, baseY, maxZ], D = [minX, baseY, maxZ];
    const R1 = [cx, hY, minZ], R2 = [cx, hY, maxZ];
    tri(A, D, R2); tri(A, R2, R1); tri(B, R1, R2); tri(B, R2, C); tri(A, B, R1); tri(D, R2, C);
  }
  return pos;
}
function altWalm(points, baseY, height) {
  const xs = points.map((p) => p.x), zs = points.map((p) => p.z);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2, hY = baseY + height;
  const spanX = maxX - minX, spanZ = maxZ - minZ, inset = Math.min(spanX, spanZ) * 0.25;
  const pos = []; const tri = (a, b, c) => pos.push(...a, ...b, ...c);
  const A = [minX, baseY, minZ], B = [maxX, baseY, minZ], C = [maxX, baseY, maxZ], D = [minX, baseY, maxZ];
  let R1, R2;
  if (spanX >= spanZ) { R1 = [minX + inset, hY, cz]; R2 = [maxX - inset, hY, cz]; } else { R1 = [cx, hY, minZ + inset]; R2 = [cx, hY, maxZ - inset]; }
  if (spanX >= spanZ) { tri(A, B, R2); tri(A, R2, R1); tri(D, R1, R2); tri(D, R2, C); tri(A, R1, D); tri(B, C, R2); }
  else { tri(A, R1, D); tri(D, R1, R2); tri(B, R2, R1); tri(B, C, R2); tri(A, B, R1); tri(D, R2, C); }
  return pos;
}
function altPult(points, baseY, height) {
  const xs = points.map((p) => p.x), zs = points.map((p) => p.z);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const hY = baseY + height; const pos = []; const tri = (a, b, c) => pos.push(...a, ...b, ...c);
  let A, B, C, D;
  if ((maxX - minX) >= (maxZ - minZ)) { A = [minX, baseY, minZ]; B = [maxX, baseY, minZ]; C = [maxX, hY, maxZ]; D = [minX, hY, maxZ]; }
  else { A = [minX, baseY, minZ]; B = [minX, baseY, maxZ]; C = [maxX, hY, maxZ]; D = [maxX, hY, minZ]; }
  tri(A, B, C); tri(A, C, D);
  return pos;
}
function altAnstieg(points, form, pitchDeg) {
  const xs = points.map((p) => p.x), zs = points.map((p) => p.z);
  const spanX = Math.max(...xs) - Math.min(...xs), spanZ = Math.max(...zs) - Math.min(...zs);
  const t = Math.tan(Math.max(1, Math.min(60, pitchDeg || 30)) * Math.PI / 180);
  if (form === "pult") { const run = Math.max(spanX, spanZ); return Math.max(0.3, Math.min(run * t, run)); }
  const halfRun = Math.max(0.1, Math.min(spanX, spanZ) / 2);
  return Math.max(0.3, Math.min(halfRun * t, Math.min(spanX, spanZ)));
}
/** Surface of a triangle list: distinct corners, total area, and the highest surface point over a plan grid (ray from above). */
function flaeche(pos) {
  const ecken = new Set();
  let a = 0;
  const tris = [];
  for (let i = 0; i < pos.length; i += 9) {
    const p = [pos.slice(i, i + 3), pos.slice(i + 3, i + 6), pos.slice(i + 6, i + 9)];
    p.forEach((q) => ecken.add(q.map((v) => v.toFixed(6)).join(",")));
    const u = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]], v = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
    a += Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
    tris.push(p);
  }
  const hoehe = (x, z) => {
    let h = -Infinity;
    for (const [p, q, r] of tris) {
      const d = (q[2] - r[2]) * (p[0] - r[0]) + (r[0] - q[0]) * (p[2] - r[2]);
      if (Math.abs(d) < 1e-12) continue;
      const l1 = ((q[2] - r[2]) * (x - r[0]) + (r[0] - q[0]) * (z - r[2])) / d, l2 = ((r[2] - p[2]) * (x - r[0]) + (p[0] - r[0]) * (z - r[2])) / d, l3 = 1 - l1 - l2;
      if (l1 >= -1e-9 && l2 >= -1e-9 && l3 >= -1e-9) h = Math.max(h, l1 * p[1] + l2 * q[1] + l3 * r[1]);
    }
    return h;
  };
  return { ecken: [...ecken].sort(), a, hoehe };
}

describe("107-10 Dach-Lib (dachGeometrie.js)", () => {
  it("Satteldach über 6 m Spannweite bei 45°: Firsthöhe 3,0 m (tan 45° · 3 m), beide Flächen 45°", () => {
    const d = dachBerechnen(rechteck(0, 0, 10, 6), { form: "sattel", neigung_grad: 45 }, { traufhoehe_m: 2.5 });
    assert.equal(d.ok, true);
    nahe(d.anstieg_m, 3.0, 1e-9, "Anstieg");
    nahe(d.neigung_grad, 45, 1e-9, "Neigung");
    const dachf = d.flaechen.filter((f) => f.art === "dachflaeche");
    assert.equal(dachf.length, 2);
    for (const f of dachf) nahe(f.neigung_grad, 45, 1e-9, f.id);
    assert.equal(d.flaechen.filter((f) => f.art === "giebel").length, 2, "zwei senkrechte Giebel");
    // First entlang der langen Seite (x): Firstpunkte bei z = 3 auf 2,5 + 3,0 = 5,5 m
    const f0 = d.punkte.find((p) => p.id === "f0"), f1 = d.punkte.find((p) => p.id === "f1");
    assert.deepEqual([f0.x, f0.y, f0.z, f1.x, f1.y, f1.z].map((v) => +v.toFixed(9)), [0, 5.5, 3, 10, 5.5, 3]);
    // Dachhöhe = kleinste der Ebenen: an der Traufe 2,5 m, 1 m einwärts 3,5 m, am First 5,5 m
    const e = dachEbenen(d);
    nahe(dachHoeheAn(e, 4, 0), 2.5, 1e-9, "Traufe"); nahe(dachHoeheAn(e, 4, 1), 3.5, 1e-9, "1 m einwärts"); nahe(dachHoeheAn(e, 4, 3), 5.5, 1e-9, "First");
  });

  it("Walmdach 10 × 6 m: First 10 − 2 · (¼ · 6) = 7 m lang; Pultdach 10 × 6 m bei 30°: Anstieg 6 · tan 30° = 3,4641 m; Flachdach = Umriss", () => {
    const w = dachBerechnen(rechteck(0, 0, 10, 6), { form: "walm", firsthoehe_m: 2 });
    const f0 = w.punkte.find((p) => p.id === "f0"), f1 = w.punkte.find((p) => p.id === "f1");
    nahe(Math.hypot(f1.x - f0.x, f1.z - f0.z), 7, 1e-9, "Firstlänge");
    assert.deepEqual(w.flaechen.map((f) => f.art).sort(), ["dachflaeche", "dachflaeche", "walm", "walm"]);
    const p = dachBerechnen(rechteck(0, 0, 10, 6), { form: "pult", neigung_grad: 30 });
    nahe(p.anstieg_m, 6 * Math.tan(Math.PI / 6), 1e-9, "Pult-Anstieg");
    nahe(p.flaechen[0].neigung_grad, 30, 1e-9, "Pultfläche 30°");
    const fl = dachBerechnen(rechteck(0, 0, 10, 6), { form: "flach" });
    assert.equal(fl.flaechen.length, 1);
    assert.equal(fl.anstieg_m, 0);
    assert.deepEqual(dachDreiecke(fl.flaechen), [], "Flachdach wird als Platte gezeichnet, nicht als Dreiecksfläche");
  });

  it("Vergleich Alt/Neu auf den drei Formen: gleiche Ecken, gleiche Fläche, gleiche Dachhöhe auf einem Raster (x-lang, z-lang, L-Umriss als BBox)", () => {
    const umrisse = { x: rechteck(-5, -3, 5, 3), z: rechteck(-2, -6, 2, 6), L: [{ x: 0, z: 0 }, { x: 8, z: 0 }, { x: 8, z: 4 }, { x: 4, z: 4 }, { x: 4, z: 10 }, { x: 0, z: 10 }] };
    for (const [name, fp] of Object.entries(umrisse)) {
      for (const [form, alt] of [["sattel", altSattel], ["walm", altWalm], ["pult", altPult]]) {
        const a = flaeche(alt(fp, 6, 2.5));
        const d = dachBerechnen(fp, { form }, { traufhoehe_m: 6, anstieg_m: 2.5 });
        const n = flaeche(dachDreiecke(d.flaechen));
        assert.deepEqual(n.ecken, a.ecken, `${name}/${form}: Ecken`);
        nahe(n.a, a.a, 1e-9, `${name}/${form}: Fläche`);
        const xs = fp.map((p) => p.x), zs = fp.map((p) => p.z);
        for (let i = 0; i <= 10; i += 1) for (let j = 0; j <= 10; j += 1) {
          const x = Math.min(...xs) + (i / 10) * (Math.max(...xs) - Math.min(...xs)), z = Math.min(...zs) + (j / 10) * (Math.max(...zs) - Math.min(...zs));
          nahe(n.hoehe(x, z), a.hoehe(x, z), 1e-9, `${name}/${form}: Höhe bei ${x}/${z}`);
        }
      }
    }
  });

  it("globale Dachform: Sattel/Walm-Anstieg wie roofRiseFromPitch; Pult bewusst korrigiert (Lauf = kürzere Spannweite, Neigung wie eingestellt)", () => {
    const fp = rechteck(-5, -3, 5, 3);
    for (const g of [5, 30, 45, 60, 0]) {
      nahe(globalerDachAnstieg_m(fp, "sattel", g), altAnstieg(fp, "sattel", g), 1e-12, `sattel ${g}`);
      nahe(globalerDachAnstieg_m(fp, "walm", g), altAnstieg(fp, "walm", g), 1e-12, `walm ${g}`);
    }
    // alt: 10 · tan 30° = 5,77 m über eine Fläche, die nur 6 m tief ansteigt (also 43,9° statt 30°); neu: 6 · tan 30° = 3,4641 m
    nahe(altAnstieg(fp, "pult", 30), 10 * Math.tan(Math.PI / 6), 1e-12, "alt");
    nahe(globalerDachAnstieg_m(fp, "pult", 30), 6 * Math.tan(Math.PI / 6), 1e-12, "neu");
  });

  it("Rechteck exakt im eigenen Rahmen (auch gedreht), sonst BBox; Firstrichtung längs/quer", () => {
    const w = (30 * Math.PI) / 180, c = Math.cos(w), s = Math.sin(w);
    const gedreht = rechteck(0, 0, 10, 6).map((p) => ({ x: p.x * c - p.z * s, z: p.x * s + p.z * c }));
    const r = dachRahmen(gedreht);
    assert.equal(r.quelle, "rechteck");
    nahe(r.halbL_m, 5, 1e-9, "halbe Länge"); nahe(r.halbB_m, 3, 1e-9, "halbe Breite");
    nahe(Math.abs(r.u.x * c + r.u.z * s), 1, 1e-9, "First parallel zur langen Seite");
    const q = dachRahmen(gedreht, "quer");
    nahe(q.halbB_m, 5, 1e-9, "quer: Lauf über die lange Seite");
    assert.equal(dachRahmen([{ x: 0, z: 0 }, { x: 8, z: 0 }, { x: 8, z: 4 }, { x: 0, z: 9 }]).quelle, "bbox");
  });

  it("Dachpunkte mit Kennung (Grundlage für ziehbare Punkte, 107-16): Flächen verweisen auf t0…t3, f0, f1", () => {
    const d = dachBerechnen(rechteck(0, 0, 10, 6), { form: "sattel", firsthoehe_m: 2 });
    assert.deepEqual(d.punkte.map((p) => p.id), ["t0", "t1", "t2", "t3", "f0", "f1"]);
    for (const f of d.flaechen) for (const id of f.punktIds) assert.ok(d.punkte.some((p) => p.id === id), id);
    for (const f of d.flaechen.filter((x) => x.art === "dachflaeche")) assert.ok(f.normale.y > 0, "Dachflächen zeigen nach oben");
  });

  it("gekrümmte oder unbekannte Form: offen, nie ein stilles Satteldach", () => {
    const d = dachBerechnen(rechteck(0, 0, 10, 6), { form: "tonne", firsthoehe_m: 2 });
    assert.deepEqual(d, { ok: false, grund: "form-offen", form: "tonne" });
    assert.deepEqual([...DACHFORMEN], ["flach", "sattel", "walm", "pult"]);
  });

  it("pitch-Altdaten: ein Dach nur mit `pitch` (m) bleibt ein Satteldach mit dieser Firsthöhe; Neigung = atan(2,5 / 3) = 39,81°", () => {
    const alt = { points: rechteck(0, 0, 8, 6), pitch: 2.5, level: 0 };
    const { dach, anstieg_m } = dachVonDachelement(dachMigrieren(alt));
    assert.equal(dach.form, "sattel");
    nahe(anstieg_m, 2.5, 1e-12, "Firsthöhe");
    nahe(dachNeigung_grad(alt), (Math.atan2(2.5, 3) * 180) / Math.PI, 1e-9, "Neigung");
    // ohne `form` unverändert; mit form "pult" läuft die Neigung über die ganze Spannweite: atan(3 / 6) = 26,57°
    nahe(dachNeigung_grad({ points: rechteck(0, 0, 8, 6), firsthoehe_m: 3 }), 45, 1e-9, "ohne form");
    nahe(dachNeigung_grad({ form: "pult", points: rechteck(0, 0, 8, 6), firsthoehe_m: 3 }), (Math.atan2(3, 6) * 180) / Math.PI, 1e-9, "pult");
    nahe(dachFirsthoehe_m({ form: "pult", points: rechteck(0, 0, 8, 6), neigung_grad: 45 }), 6, 1e-9, "pult aus Neigung");
  });
});

// roof over x ∈ [0; 6] (fall direction x), z ∈ [0; 10], ridge along z at x = 3; eaves 2.5 m
const dachGiebel = dachBerechnen(rechteck(0, 0, 6, 10), { form: "sattel", firsthoehe_m: 3 }, { traufhoehe_m: 2.5 });
const dach45 = dachBerechnen(rechteck(0, 0, 6, 10), { form: "sattel", neigung_grad: 45 }, { traufhoehe_m: 2.5 });
// gable wall 6.0 m long along x (parallel to the fall direction), 0.30 m thick, 6 m high
const giebelwand = { _idx: 1, a: { x: 0, z: 0.15 }, b: { x: 6, z: 0.15 }, thickness: 0.3, height: 6, level: 0 };
// eaves wall 8.0 m along z at x ∈ [0; 0.3], 3.0 m high
const traufwand = { _idx: 2, a: { x: 0.15, z: 1 }, b: { x: 0.15, z: 9 }, thickness: 0.3, height: 3, level: 0 };

describe("107-10 Wand unter Dach (seo.js, CSG-Kern 107-14)", () => {
  it("Giebelwand: Profilfläche 6 · 2,5 + ½ · 6 · 3 = 24 m², Volumen 24 · 0,30 = 7,2 m³ — analytisch, Solid und IFC-Profil", async () => {
    const r = await wandUnterDach(giebelwand, [], [dachGiebel], { kern });
    assert.equal(r.status, "solid");
    nahe(r.volumen.analytisch_m3, 7.2, 1e-9, "analytisch");
    nahe(r.volumen.solid_m3, 7.2, 1e-5, "Solid");
    assert.equal(r.quelle, "solid");
    const basis = wandBasis(giebelwand, []);
    const prof = wandProfilUnterDach({ laenge_m: 6, hoehe_m: 6, dicke_m: 0.3 }, dachImRahmen(dachGiebel, r.platzierung));
    nahe(prof.flaeche_m2, 24, 1e-9, "Profilfläche");
    assert.equal(prof.quer_geneigt, false);
    nahe(analytischWandUnterDach(basis, dachImRahmen(dachGiebel, r.platzierung)).gesamt_m3, 7.2, 1e-9, "Referenz direkt");
  });

  it("Giebelwand mit Schichtaufbau: je Schicht 24 m² · d, Summe gleich (Solid je Schicht gegen Handrechnung)", async () => {
    const r = await wandUnterDach({ ...giebelwand, composite: "cavity" }, [], [dachGiebel], { kern });
    assert.equal(r.status, "solid");
    const summe = r.volumen.jeSchicht.reduce((s, x) => s + x.analytisch_m3, 0);
    nahe(summe, r.volumen.analytisch_m3, 1e-9, "Summe der Schichten");
    // every layer runs through the whole profile plane: 24 m² × its own thickness (from the build-up of the record)
    const schichten = wandBasis({ ...giebelwand, composite: "cavity" }, []).schichten;
    assert.ok(schichten.length >= 3, "mehrschichtiger Aufbau");
    for (const s of r.volumen.jeSchicht) {
      nahe(s.analytisch_m3, 24 * schichten[s.index].dicke_m, 1e-9, `Schicht ${s.index} Handrechnung`);
      nahe(s.solid_m3, s.analytisch_m3, 1e-5, `Schicht ${s.index} Solid`);
    }
    const dicke = schichten.reduce((s, x) => s + x.dicke_m, 0);
    nahe(r.volumen.analytisch_m3, 24 * dicke, 1e-9, "24 m² × Gesamtdicke");
  });

  it("Traufwand: Querschnitt 0,3 · (2,5 + 2,8) / 2 = 0,795 m², Volumen 8 · 0,795 = 6,36 m³; im IFC quer geneigt gemeldet", async () => {
    const r = await wandUnterDach(traufwand, [], [dach45], { kern });
    assert.equal(r.status, "solid");
    nahe(r.volumen.analytisch_m3, 6.36, 1e-9, "analytisch");
    nahe(r.volumen.solid_m3, 6.36, 1e-5, "Solid");
    const prof = wandProfilUnterDach({ laenge_m: 8, hoehe_m: 3, dicke_m: 0.3 }, dachImRahmen(dach45, r.platzierung));
    assert.equal(prof.quer_geneigt, true);
    nahe(prof.flaeche_m2, 8 * 2.5, 1e-9, "IFC bis zur niedrigsten Höhe (Außenkante 2,5 m)");
  });

  it("Öffnung bleibt: Giebelwand mit Fenster 1,0 × 1,2 m (Brüstung 1,0 m, ganz unter dem Dach): 7,2 − 1,2 · 0,3 = 6,84 m³", async () => {
    const r = await wandUnterDach(giebelwand, [{ u: 3, width: 1, height: 1.2, sill: 1 }], [dachGiebel], { kern });
    nahe(r.volumen.analytisch_m3, 6.84, 1e-9, "analytisch");
    nahe(r.volumen.solid_m3, 6.84, 1e-5, "Solid");
  });

  it("verfälschtes Solid → Warnung am Bauteil und analytische Menge (nie die falsche)", async () => {
    const falsch = { boolesch: (a, b, op) => { const r = kern.boolesch(a, b, op); if (r.ok) r.geometrie.scale(1, 1.05, 1); return r; } };
    const r = await wandUnterDach(giebelwand, [], [dachGiebel], { kern: falsch });
    assert.equal(r.ok, false);
    assert.equal(r.status, "analytisch");
    assert.equal(r.quelle, "analytisch");
    nahe(r.menge_m3, 7.2, 1e-9, "Menge aus der Handrechnung");
    assert.equal(r.warnung.code, "csg-abweichung");
    assert.match(csgWarnungText(r.warnung), /weicht um/);
  });

  it("offene Eingabe → Rückfall ohne Solid (Menge analytisch, Warnung csg-offen)", async () => {
    const offen = { boolesch: () => ({ ok: false, grund: "offen", eingabe: "b", bericht: null }) };
    const r = await wandUnterDach(giebelwand, [], [dachGiebel], { kern: offen });
    assert.equal(r.geometrie, null);
    assert.equal(r.warnung.code, "csg-offen");
    nahe(r.menge_m3, 7.2, 1e-9, "Menge");
  });

  it("zwei Dächer auf einer Wand: keine analytische Referenz → Menge offen, nicht geraten", async () => {
    const r = await wandUnterDach(giebelwand, [], [dachGiebel, dach45], { kern });
    assert.equal(r.menge_m3, null);
    assert.equal(r.quelle, "offen");
    assert.equal(r.warnung.code, "seo-ohne-referenz");
  });

  it("Schnitt aus dem Solid: Schnittlinie z = 0,15 durch die Giebelwand zeigt die Giebelspitze auf 5,5 m", async () => {
    const r = await wandUnterDach(giebelwand, [], [dachGiebel], { kern });
    const f = seoSchnittFlaechen(new Map([["cw:1", r]]), { a: { x: -10, z: 0.1 }, b: { x: 20, z: 0.1 } });
    assert.ok(f.length >= 1);
    const hmax = Math.max(...f.flatMap((x) => x.ringe.flat().map((p) => p.h)));
    nahe(hmax, 5.5, 1e-4, "Firsthöhe im Schnitt");
  });
});

describe("107-10 Relationen (solidrelationen_layer, aufgeloesteGeometrie)", () => {
  const wandGuid = "0123456789ABCDEFabcdef", dachGuid = "fedcbaFEDCBA9876543210";
  const bauteile = (/** @type {any} */ wand = giebelwand) => new Map([
    [wandGuid, { art: "wand", element: wand, wand, oeffnungen: [] }],
    [dachGuid, { art: "dach", element: {}, dach: dachGiebel }],
  ]);

  it("Relation ein: Wand abgeschrägt (7,2 m³); aus (aktiv: false): keine Operation; das Ziel bleibt unverändert gespeichert", async () => {
    const vorher = JSON.stringify(giebelwand);
    const { layer, id } = relationAnlegen(undefined, { ziel_guid: wandGuid, operator_guid: dachGuid, operation: "abzug_nach_oben" });
    assert.equal(id, "r1");
    assert.deepEqual(relationAnlegen(layer, { ziel_guid: wandGuid, operator_guid: dachGuid, operation: "abzug_nach_oben" }).layer.relationen.length, 1, "kein Duplikat");
    const ein = await aufgeloesteGeometrie({ bauteile: bauteile() }, layer, { kern });
    const r = ein.get(wandGuid);
    assert.equal(r.status, "solid");
    assert.deepEqual(r.relationen, ["r1"]);
    nahe(r.menge_m3, 7.2, 1e-5, "Menge");
    const aus = relationAktivSetzen(layer, id, false);
    assert.equal(relationenVon(aus)[0].aktiv, false, "die Relation bleibt gespeichert");
    assert.equal((await aufgeloesteGeometrie({ bauteile: bauteile() }, aus, { kern })).size, 0);
    assert.equal(JSON.stringify(giebelwand), vorher, "kein Rückschreiben in a, b, height");
    assert.throws(() => relationAnlegen(layer, { ziel_guid: wandGuid, operator_guid: dachGuid, operation: "zaubern" }));
  });

  it("Ziel in Gruppe 0 → boolesch wird nicht aufgerufen, das Volumen ist das Einzelvolumen 6 · 6 · 0,3 = 10,8 m³", async () => {
    let aufrufe = 0;
    const spion = { boolesch: (a, b, op) => { aufrufe += 1; return kern.boolesch(a, b, op); } };
    const { layer } = relationAnlegen(undefined, { ziel_guid: wandGuid, operator_guid: dachGuid, operation: "abzug_nach_oben" });
    const wand0 = { ...giebelwand, verschneidungsgruppe: 0 };
    const r = (await aufgeloesteGeometrie({ bauteile: bauteile(wand0) }, layer, { kern: spion })).get(wandGuid);
    assert.equal(aufrufe, 0);
    assert.equal(r.status, "gruppe-0");
    nahe(r.menge_m3, 10.8, 1e-9, "Einzelvolumen");
    assert.equal(csgWarnungText(r.warnung), "Bauteil verschneidet nie (Gruppe 0) — die Relation bleibt gespeichert, wirkt aber nicht");
    assert.deepEqual(relationWirkt({ verschneidungsgruppe: 2 }, { verschneidungsgruppe: 5 }), { wirkt: true, grund: null }, "[ASSUMED] ausdrückliche Relation wirkt über Gruppen hinweg");
  });

  it("Körper gegen Körper (BK-05 Teil-Durchbruch): 10 · 8 · 6 = 480 m³ minus 2 · 3 · 3 = 18 m³ Überlappung = 462 m³", async () => {
    const ziel = { profil: rechteck(0, 0, 10, 8), y0_m: 0, y1_m: 6 }, op = { profil: rechteck(2, -1, 4, 3), y0_m: 1, y1_m: 4 };
    const r = await koerperOperation(ziel, op, "abzug", { kern });
    assert.equal(r.status, "solid");
    nahe(r.menge_m3, 462, 1e-4, "abzug");
    nahe((await koerperOperation(ziel, op, "schnitt", { kern })).menge_m3, 18, 1e-4, "schnitt");
    nahe((await koerperOperation(ziel, op, "vereinigung", { kern })).menge_m3, 480 + 24 - 18, 1e-4, "vereinigung 480 + 2·4·3 − 18");
  });

  it("FELD_NAMEN kennt den neuen Layer (Konfliktkarte)", () => {
    assert.equal(FELD_NAMEN.solidrelationen_layer, "Bauteil-Operationen");
  });
});

describe("107-10 Massing-Körper mit Dach (massing_layer v6)", () => {
  it("dachSetzen: am Körper, an der Gruppendefinition, null entfernt; geometrie() reicht `dach` nur durch, wenn gesetzt", () => {
    const layer = { koerper: [{ id: "a", profil: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 6 }, { x: 0, y: 6 }], hoehe: 6, basis: 0, pos: { x: 0, y: 0 }, drehung: 0, gruppe: null },
      { id: "b", basis: 0, pos: { x: 20, y: 0 }, drehung: 0, gruppe: "1" }], gruppen: { 1: { profil: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }], hoehe: 3 } }, naechsteId: 3 };
    assert.equal("dach" in massingGeometrie(layer, layer.koerper[0]), false);
    const l2 = dachSetzen(layer, ["a", "b"], { form: "sattel", neigung_grad: 35 });
    assert.deepEqual(l2.koerper[0].dach, { form: "sattel", neigung_grad: 35 });
    assert.deepEqual(l2.gruppen[1].dach, { form: "sattel", neigung_grad: 35 }, "Instanz ändert die Definition");
    assert.equal("dach" in l2.koerper[1], false);
    assert.deepEqual(massingGeometrie(l2, l2.koerper[1]).dach, { form: "sattel", neigung_grad: 35 });
    const l3 = dachSetzen(l2, ["a"], null);
    assert.equal("dach" in l3.koerper[0], false);
    assert.equal(layer.koerper[0].dach, undefined, "Eingabe nicht mutiert");
  });
});

describe("107-10 IFC: geneigte Dachplatten, Wandprofil, byte-gleich ohne neue Felder", () => {
  const model = createBuildingModel({ footprintM: rechteck(-5, -3, 5, 3), storeys: 1, storeyHeight: 3 });
  const dachOhne = { _idx: 1, level: 0, points: rechteck(-5, -3, 5, 3), firsthoehe_m: 3 };
  const zaehle = (/** @type {string} */ t, /** @type {string} */ k) => (t.match(new RegExp(`=${k}\\(`, "g")) || []).length;

  it("Dach mit form „sattel“ (45°): je Dachfläche eine extrudierte Platte in geneigter Platzierung, Normale (0, ±0,7071, 0,7071)", () => {
    const meldungen = [];
    const ohne = exportIFC(model, { customRoofs: [dachOhne] });
    const mit = exportIFC(model, { customRoofs: [{ ...dachOhne, form: "sattel", neigung_grad: 45 }], onWarn: (m, art) => meldungen.push(art) });
    assert.equal(zaehle(mit, "IFCROOF"), 1);
    assert.match(mit, /IFCROOF\([^;]*\.GABLE_ROOF\.\);/);
    // the roof of `ohne` is one flat polySolid; `mit` has two inclined plates instead (one more extruded solid)
    assert.equal(zaehle(mit, "IFCEXTRUDEDAREASOLID"), zaehle(ohne, "IFCEXTRUDEDAREASOLID") + 1);
    // the Axis (normal) of every IfcAxis2Placement3D of a plate: (0, ±sin 45°, cos 45°) — one per roof face, falling to both eaves
    const richtung = (/** @type {string} */ ref) => /** @type {RegExpExecArray} */ (new RegExp(`${ref}=IFCDIRECTION\\(\\(([-\\d.E]+),([-\\d.E]+),([-\\d.E]+)\\)\\);`).exec(mit)).slice(1).map(Number);
    const achsen = [...mit.matchAll(/=IFCAXIS2PLACEMENT3D\((#\d+),(#\d+),(#\d+)\);/g)].map((m) => richtung(m[2])).filter((d) => Math.abs(d[2] - 1) > 1e-9);
    assert.equal(achsen.length, 2, "zwei geneigte Platten");
    for (const d of achsen) { nahe(Math.abs(d[1]), Math.SQRT1_2, 1e-4, "|n.y|"); nahe(d[2], Math.SQRT1_2, 1e-4, "n.z nach oben"); nahe(d[0], 0, 1e-9, "n.x"); }
    assert.deepEqual(achsen.map((d) => Math.sign(d[1])).sort(), [-1, 1], "die Flächen fallen zu beiden Traufen");
    assert.deepEqual(meldungen, []);
  });

  it("ohne `form` und ohne Optionen: der alte flache Export (Golden 107-01 bleibt grün, siehe ifcGolden-10701); globale Dachform „flach“ schreibt nichts", () => {
    const a = exportIFC(model, { customRoofs: [dachOhne] });
    assert.equal(exportIFC(model, { customRoofs: [dachOhne], dachGlobal: { form: "flach", neigung_grad: 30 }, seo: null }), a);
    assert.equal(exportIFC(model, { customRoofs: [dachOhne], dachGlobal: null, seo: { waende: new Map() } }), a);
    assert.match(a, /IFCROOF\([^;]*\.GABLE_ROOF\.\);/);
  });

  it("globale Dachform „walm“: ein IfcRoof HIP_ROOF mit vier Platten auf der Traufe", () => {
    const t = exportIFC(model, { dachGlobal: { form: "walm", neigung_grad: 30 } });
    assert.match(t, /IFCROOF\('[^']+',\$,'Dach',[^;]*\.HIP_ROOF\.\);/);
    assert.equal(zaehle(t, "IFCEXTRUDEDAREASOLID") - zaehle(exportIFC(model, {}), "IFCEXTRUDEDAREASOLID"), 4);
  });

  it("gekrümmte Form: flache Platte und Meldung WARNART_DACH", () => {
    const arten = [];
    const t = exportIFC(model, { customRoofs: [{ ...dachOhne, form: "tonne" }], onWarn: (m, art) => arten.push(art) });
    assert.deepEqual(arten, [WARNART_DACH]);
    assert.equal(zaehle(t, "IFCROOF"), 1);
  });

  it("Wand unter Dach (Option seo): Profil in der Wandebene mit 24 m² (IfcArbitraryClosedProfileDef, Achse −Y, Tiefe 0,30)", () => {
    const meldungen = [];
    const t = exportIFC(model, { customWalls: [giebelwand], seo: { waende: new Map([["cw:1", [dachGiebel]]]) }, onWarn: (m, art, d) => meldungen.push([art, d?.grund]) });
    const profil = /#(\d+)=IFCARBITRARYCLOSEDPROFILEDEF\(\.AREA\.,\$,#(\d+)\);\n#\d+=IFCCARTESIANPOINT\(\(0\.,0\.1500,0\.\)\);\n#\d+=IFCDIRECTION\(\(0\.,-1\.,0\.\)\);/.exec(t);
    assert.ok(profil, "Profil mit Ursprung bei +Dicke/2 und Achse −Y");
    assert.match(t, new RegExp(`=IFCEXTRUDEDAREASOLID\\(#${profil[1]},#\\d+,#\\d+,0\\.3000\\);`), "über die Dicke 0,30 m extrudiert");
    const refs = new RegExp(`#${profil[2]}=IFCPOLYLINE\\(\\(([^;]*)\\)\\);`).exec(t)[1].split(",");
    const xy = refs.map((r) => new RegExp(`#${r.slice(1)}=IFCCARTESIANPOINT\\(\\(([-\\d.E]+),([-\\d.E]+)\\)\\);`).exec(t).slice(1).map(Number));
    let a = 0;
    for (let i = 0; i + 1 < xy.length; i += 1) a += xy[i][0] * xy[i + 1][1] - xy[i + 1][0] * xy[i][1];
    nahe(Math.abs(a) / 2, 24, 1e-6, "Profilfläche");
    assert.ok(xy.length >= 6, "Rechteck bis zur Traufe plus Giebeldreieck (geschlossener Linienzug)");
    assert.deepEqual(meldungen, []);
    const quer = [];
    exportIFC(model, { customWalls: [traufwand], seo: { waende: new Map([["cw:2", [dach45]]]) }, onWarn: (m, art, d) => quer.push([art, d?.grund]) });
    assert.deepEqual(quer, [[WARNART_SEO, "quer"]]);
  });

  it("Untergeschoss mit Massing-Gelände: nur eine Meldung (Geländeabzug nicht im IFC); ohne Untergeschoss keine", () => {
    const g = { nx: 3, ny: 3, zelle: 1, x0: 0, y0: 0, h: new Array(9).fill(0) };
    const arten = [];
    exportIFC(model, { massing: { koerper: [], gruppen: {}, gelaende: g }, onWarn: (m, art) => arten.push(art) });
    assert.deepEqual(arten, []);
    const ug = createBuildingModel({ footprintM: rechteck(-5, -3, 5, 3), storeys: 1, storeyHeight: 3, untergeschosse: 1 });
    exportIFC(ug, { massing: { koerper: [], gruppen: {}, gelaende: g }, onWarn: (m, art) => arten.push(art) });
    assert.deepEqual(arten, [WARNART_SEO]);
  });

  it("Massing-Körper mit Dach: IfcRoof SHED_ROOF auf der Körperoberkante", () => {
    const massing = { koerper: [{ id: "k1", profil: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 6 }, { x: 0, y: 6 }], hoehe: 6, basis: 0, pos: { x: 0, y: 0 }, drehung: 0, gruppe: null, dach: { form: "pult", neigung_grad: 20 } }], gruppen: {}, bezug: { x: 5, y: 3 } };
    const t = exportIFC(model, { massing });
    assert.match(t, /IFCROOF\('[^']+',\$,'Dach k1',[^;]*\.SHED_ROOF\.\);/);
  });
});

// grid 21 × 17 nodes, cell 1 m, from (−5, −4): the footprint 10 × 8 m on whole metres (0…10, 0…8) lies inside with a margin
const raster = (/** @type {(x: number, y: number) => number} */ f) => {
  const nx = 21, ny = 17, x0 = -5, y0 = -4, h = [];
  for (let j = 0; j < ny; j += 1) for (let i = 0; i < nx; i += 1) h.push(f(x0 + i, y0 + j));
  return { nx, ny, zelle: 1, x0, y0, h };
};
const ugProfil = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 8 }, { x: 0, y: 8 }];

describe("107-10 Untergeschoss mit Geländeabzug (gelaendeSolid.js)", () => {
  it("Geländeblock ist geschlossen: ebenes Raster 20 × 16 m, Boden 5 m tief: 20 · 16 · 5 = 1 600 m³", () => {
    const b = gelaendeBlock(raster(() => 0), -5);
    assert.equal(istWasserdicht(b).ok, true);
    nahe(volumen_m3(b), 1600, 1e-6, "Blockvolumen");
  });

  it("ebenes Gelände h = 0: Aushub 80 m² · 3,0 m = 240 m³ (Solid und stempeln gleich); Gelände danach = Block − Aushub", async () => {
    const r = await untergeschossMitGelaende({ gelaende: raster(() => 0), profil: ugProfil, fusshoehe_m: -3 }, { kern });
    nahe(r.aushub.solid_m3, 240, 1e-5, "Solid");
    nahe(r.aushub.raster_m3, 240, 1e-9, "stempeln");
    assert.equal(r.aushub.quelle, "solid");
    nahe(r.gelaendeNach.volumen_m3, r.block_m3 - r.aushub.solid_m3, 1e-5, "Bilanz");
    assert.equal(r.dicht, true);
    nahe(r.ug.volumen_m3, 240, 1e-9, "UG-Körper 80 m² · 3 m");
  });

  it("Hang h = 0,1 · x: exakt 80 · (0,5 + 3,0) = 280 m³ aus dem Solid; stempeln 276 m³ (1,4 % darunter, innerhalb 2 %)", async () => {
    const g = raster((x) => 0.1 * x);
    nahe(stempeln(g, ugProfil, -3).abtrag, 276, 1e-9, "Knotenmethode");
    const r = await untergeschossMitGelaende({ gelaende: g, profil: ugProfil, fusshoehe_m: -3 }, { kern });
    nahe(r.aushub.solid_m3, 280, 1e-5, "Solid");
    assert.equal(r.aushub.quelle, "solid");
    nahe(r.aushub.abweichung_rel, 4 / 276, 1e-6, "Abweichung");
    assert.ok(r.aushub.abweichung_rel < GELAENDE_SCHWELLE_REL);
    nahe(r.gelaendeNach.volumen_m3, r.block_m3 - r.aushub.solid_m3, 1e-5, "Bilanz Block = Aushub + Rest");
  });

  it("erdberührte UG-Wände aus dem Gebäudemodell (107-13): ebenes Gelände auf ±0 → die ganze UG-Wand (10 · 0,24 · 3 = 7,2 m³ bzw. 8 · 0,24 · 3 = 5,76 m³)", async () => {
    const m = createBuildingModel({ footprintM: [{ x: -5, z: -4 }, { x: 5, z: -4 }, { x: 5, z: 4 }, { x: -5, z: 4 }], storeys: 2, storeyHeight: 3, untergeschosse: 1 });
    const waende = m.walls.filter((w) => /** @type {any} */ (w).unterirdisch);
    assert.equal(m.fusshoehe_m, -3);
    const r = await untergeschossMitGelaende({ gelaende: raster(() => 0), profil: ugProfil, fusshoehe_m: m.fusshoehe_m, waende, bezug: { x: 5, y: 4 } }, { kern });
    assert.equal(r.erdberuehrt.length, 4);
    const werte = r.erdberuehrt.map((e) => e.solid_m3).sort((a, b) => a - b);
    nahe(werte[0], 5.76, 1e-5, "kurze Wand"); nahe(werte[3], 7.2, 1e-5, "lange Wand");
    for (const e of r.erdberuehrt) assert.equal(e.quelle, "solid");
  });

  it("ohne Geländeraster: nur der UG-Körper, Menge = Grundfläche · Tiefe; Abweichung über 2 % → Menge aus dem Raster", async () => {
    const r = await untergeschossMitGelaende({ gelaende: null, profil: ugProfil, fusshoehe_m: -3 }, { kern });
    assert.equal(r.mitGelaende, false);
    nahe(r.aushub.menge_m3, 240, 1e-9, "80 · 3");
    assert.equal(r.aushub.quelle, "analytisch");
    const a = gelaendeAbgleich(300, 276);
    assert.equal(a.ok, false);
    assert.equal(a.menge_m3, 276);
    assert.equal(a.warnung.code, "csg-abweichung");
  });
});
