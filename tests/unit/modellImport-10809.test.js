// 108-09: the validator of the geometry JSON (@core bauteil/modellImport.js) — a valid neutral test house passes; every fault names its
// path and a German sentence; warnings for what the studio stores too; the stored form is what the studio's load path reads; the module
// loads in plain Node without the alias hook (the server imports it). Test data: tests/unit/fixtures/efh-108-import.json (invented values).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  modellPruefen, importPatch, listenAnzahl, nummernText, aufMillimeter, IMPORT_LISTEN, GUID_LISTEN,
} from "../../packages/nova-core/src/lib/bauteil/modellImport.js";
import { bauteilGuid } from "../../packages/nova-core/src/lib/bauteil/steckbrief.js";

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIXTURE = JSON.parse(fs.readFileSync(path.join(WURZEL, "tests", "unit", "fixtures", "efh-108-import.json"), "utf8"));
/** A fresh deep copy of the test house, changed by `aendern`. @param {(j: any) => void} [aendern] */
const efh = (aendern) => { const j = structuredClone(FIXTURE); aendern?.(j); return j; };
/** The one error at `pfad` (fails when there is none). @param {any} r @param {string} pfad */
const fehlerBei = (r, pfad) => {
  const f = r.fehler.find((/** @type {any} */ x) => x.pfad === pfad);
  assert.ok(f, `expected an error at ${pfad}, got ${JSON.stringify(r.fehler)}`);
  return f.text;
};

test("the test house passes without errors and warnings; the summary counts the lists", () => {
  const r = modellPruefen(efh());
  assert.equal(r.ok, true, JSON.stringify(r.fehler));
  assert.deepEqual(r.fehler, []);
  assert.deepEqual(r.warnungen, []);
  assert.equal(r.zusammenfassung.customWalls, 3);
  assert.equal(r.zusammenfassung.envOpenings, 3);
  assert.equal(r.zusammenfassung.umrissPunkte, 4);
  assert.equal(r.normalisiert?.unit, "m");
  assert.equal(r.normalisiert?.geschosse[2].kniestock_m, 1);
});

test("head: not an object, wrong format, version, unit (mm named), axes", () => {
  assert.equal(modellPruefen(null).ok, false);
  assert.match(modellPruefen([]).fehler[0].text, /kein JSON-Objekt/);
  const r = modellPruefen(efh((j) => { j.format = "geojson"; j.version = 2; j.einheit = "mm"; j.achsen = "x-y"; }));
  assert.match(fehlerBei(r, "format"), /bit-modell/);
  assert.match(fehlerBei(r, "version"), /nur Version 1/);
  assert.match(fehlerBei(r, "einheit"), /„mm“ wird nicht umgerechnet.*Metern/);
  assert.match(fehlerBei(r, "achsen"), /z nach Süden/);
  assert.equal(r.normalisiert, null, "no stored form while there are errors");
});

test("_idx: duplicates over ALL lists are an error naming the first holder; missing _idx too", () => {
  const r = modellPruefen(efh((j) => { j.customZones[0]._idx = 2; delete j.customStairs[0]._idx; }));
  assert.equal(fehlerBei(r, "customZones[0]._idx"), "Raum 2 (Raum A): _idx 2 ist schon an customWalls[1] vergeben — jede Nummer darf über alle Listen nur einmal vorkommen.");
  assert.match(fehlerBei(r, "customStairs[0]._idx"), /^Treppe ohne Nummer: _idx muss eine ganze Zahl ab 1 sein/);
});

test("orphan wallIdx: the wall does not exist, the existing ones are listed", () => {
  const r = modellPruefen(efh((j) => { j.customWindows[1].wallIdx = 12; }));
  assert.equal(fehlerBei(r, "customWindows[1].wallIdx"), "Tür 5: Wand 12 gibt es nicht (vorhanden: 1–3).");
});

test("hull opening: edge beyond the footprint, level that does not exist", () => {
  const r = modellPruefen(efh((j) => { j.envOpenings[1].edge = 4; j.envOpenings[2].level = 5; }));
  assert.equal(fehlerBei(r, "envOpenings[1].edge"), "Fenster 7 in der Hülle: Kante 4 gibt es nicht (Umriss hat 4 Kanten: 0–3).");
  assert.equal(fehlerBei(r, "envOpenings[2].level"), "Fenster 8 in der Hülle: Geschoss 5 gibt es nicht (vorhanden: −1–1).");
});

test("millimetres instead of metres are named as such", () => {
  const r = modellPruefen(efh((j) => { j.customWalls[0].b = { x: -500, z: 5100 }; }));
  assert.equal(fehlerBei(r, "customWalls[0].b.z"), "Wand 1, Ende b: 5100 m ist unplausibel groß — vermutlich Millimeter statt Meter angegeben.");
  const u = modellPruefen(efh((j) => { j.programm.footprintM = j.programm.footprintM.map((/** @type {any} */ p) => ({ x: p.x / 10, z: p.z / 10 })); }));
  assert.match(fehlerBei(u, "programm.footprintM"), /1,14 m groß — plausibel sind 2 bis 300 m/);
});

test("storey table: duplicate level, knee wall not on the top storey", () => {
  const r = modellPruefen(efh((j) => { j.programm.geschosse[1].level = -1; j.programm.geschosse[0].kniestock_m = 0.5; }));
  assert.equal(fehlerBei(r, "programm.geschosse[1].level"), "Geschoss -1 steht doppelt in der Tabelle (schon in Zeile 0).");
  assert.equal(fehlerBei(r, "programm.geschosse[0].kniestock_m"), "Geschoss -1: kniestock_m ist nur am obersten Geschoss (1) erlaubt.");
});

test("footprint: self-intersecting is an error; points with y instead of z are named", () => {
  const r = modellPruefen(efh((j) => { j.programm.footprintM = [{ x: 0, z: 0 }, { x: 10, z: 10 }, { x: 10, z: 0 }, { x: 0, z: 10 }]; }));
  assert.equal(fehlerBei(r, "programm.footprintM"), "Umriss ungültig: Profil schneidet sich selbst.");
  const y = modellPruefen(efh((j) => { j.programm.footprintM[0] = { x: 0, y: 0 }; }));
  assert.match(fehlerBei(y, "programm.footprintM[0]"), /x und z \(Grundriss\), nicht y/);
});

test("enums: kind, anschlag, aufschlag, dachform", () => {
  const r = modellPruefen(efh((j) => { j.customWindows[0].kind = "tuer"; j.customWindows[0].anschlag = "mitte"; j.customWindows[1].aufschlag = "oben"; j.dachform = "kuppel"; }));
  assert.match(fehlerBei(r, "customWindows[0].kind"), /kind „tuer“ gibt es nicht — erlaubt: window/);
  assert.match(fehlerBei(r, "customWindows[0].anschlag"), /erlaubt: links, rechts/);
  assert.match(fehlerBei(r, "customWindows[1].aufschlag"), /erlaubt: innen, aussen/);
  assert.match(fehlerBei(r, "dachform"), /flach, sattel, walm, pult/);
});

test("warnings, not errors: stair outside the step rule, opening too big for its wall, unknown and not yet supported fields", () => {
  const r = modellPruefen(efh((j) => {
    j.customStairs[0].breite_m = 0.7;
    j.customWindows[0].width = 11;
    j.autoFenster = { aus: true };
    j.farbe = "rot";
    j.programm.achseM = 3;
  }));
  assert.equal(r.ok, true, JSON.stringify(r.fehler));
  const bei = (/** @type {string} */ p) => r.warnungen.filter((/** @type {any} */ w) => w.pfad === p).map((/** @type {any} */ w) => w.text);
  assert.deepEqual(bei("customStairs[0]"), ["Treppe 11: Nutzbare Laufbreite unter 0,80 m (DIN 18065 Tab. 1)."]);
  assert.match(bei("customWindows[0]")[0], /^Tür 4: 11\.00×2\.01 m \(Brüstung 0\.00 m\) passt nicht in die Wand/);
  assert.match(bei("autoFenster")[0], /108-04/);
  assert.deepEqual(bei("farbe"), ["Unbekanntes Feld „farbe“ — wird nicht übernommen."]);
  assert.match(bei("programm.achseM")[0], /Unbekanntes Programmfeld/);
  assert.ok(!("autoFenster" in r.normalisiert) && !("farbe" in r.normalisiert) && !("achseM" in r.normalisiert), "dropped from the stored form");
});

test("a hull window in the gable of the attic is measured against the roof profile, not the plain storey height", () => {
  // edge 1 lies across the ridge (11.40 m along x): the gable wall of the DG reaches far above its 2.6 m storey height
  const r = modellPruefen(efh());
  assert.ok(!r.warnungen.some((/** @type {any} */ w) => w.pfad === "envOpenings[2]"), JSON.stringify(r.warnungen));
  const zuHoch = modellPruefen(efh((j) => { j.envOpenings[2].sill = 9; }));
  assert.match(zuHoch.warnungen.find((/** @type {any} */ w) => w.pfad === "envOpenings[2]")?.text ?? "", /ragt über die Dachkontur/);
});

test("stored form: numbers on mm, element fields kept; the studio's counter would start behind the largest _idx", () => {
  const r = modellPruefen(efh((j) => { j.customWalls[0].a.x = -0.50049; j.customWalls[0].refLine = "left"; }));
  const n = /** @type {any} */ (r.normalisiert);
  assert.equal(n.customWalls[0].a.x, -0.5);
  assert.equal(n.customWalls[0].refLine, "left");
  // BitBimStudio load path: idRef = max(_idx over all element lists) + 1
  const maxIdx = Math.max(0, ...IMPORT_LISTEN.flatMap((l) => (n[l] || []).map((/** @type {any} */ x) => x._idx || 0)));
  assert.equal(maxIdx, 11);
  assert.deepEqual(aufMillimeter({ a: 1.23456, b: [2, 0.0004], c: "x", d: undefined }), { a: 1.235, b: [2, 0], c: "x" });
});

test("importPatch: replaces programme and lists, pins the GUIDs the studio would pin, keeps the additive stair rule", () => {
  const ohneTreppe = efh((j) => { delete j.customStairs; delete j.customZones; });
  const n = /** @type {any} */ (modellPruefen(ohneTreppe).normalisiert);
  const p = importPatch(n, "P1", { jetzt: new Date("2026-11-19T10:00:00.000Z") });
  assert.deepEqual(p.footprintQuelle, { art: "gezeichnet", datum: "2026-11-19T10:00:00.000Z" });
  assert.deepEqual(p.customZones, [], "a list the import does not name is written empty");
  assert.ok(!("customStairs" in p), "customStairs stays absent on a record without it");
  assert.deepEqual(importPatch(n, "P1", { hatteTreppen: true }).customStairs, []);
  for (const l of GUID_LISTEN) for (const el of p[l] || []) assert.equal(el.guid, bauteilGuid("P1", l, { _idx: el._idx }));
  assert.equal(p.customWalls[0].guid.length, 22);
  assert.equal(p.customWindows[0].guid, undefined, "openings are not pinned (the studio does not pin them either)");
  // a 22-character guid of the import survives (stable GUIDs over a re-import)
  const mitGuid = importPatch({ ...n, customWalls: [{ ...n.customWalls[0], guid: "0123456789abcdefABCDEF" }] }, "P1");
  assert.equal(mitGuid.customWalls[0].guid, "0123456789abcdefABCDEF");
  assert.deepEqual(listenAnzahl(p), { customWalls: 3, customColumns: 0, customWindows: 2, envOpenings: 3, customZones: 0, customSlabs: 0, customRoofs: 0, customStairs: 0 });
});

test("nummernText writes runs short", () => {
  assert.equal(nummernText([]), "keine");
  assert.equal(nummernText([3, 1, 2, 5, 7, 6, 9]), "1–3, 5–7, 9");
  assert.equal(nummernText([1, 2]), "1, 2");
  assert.equal(nummernText([-1, 0, 1]), "−1–1");
});

test("the validator loads in plain Node without the alias hook (the server imports it)", () => {
  const r = spawnSync(process.execPath, ["-e", "import('./packages/nova-core/src/lib/bauteil/modellImport.js').then((m) => console.log(typeof m.modellPruefen))"], { cwd: WURZEL, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), "function");
});
