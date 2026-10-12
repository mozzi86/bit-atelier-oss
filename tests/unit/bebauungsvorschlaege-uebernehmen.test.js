// Unit tests for 86-05b (library part): uebernehmeVorschlag drops layout-bound inputs and
// counts them, keeps them only with behalteEingaben AND the same typology, stores the compact
// proposal; vorschlagVeraltet detects footprint and algorithm changes; kartenDaten carries only
// the ground floor and no unit list; werkstatt_layer migrates 1 → 2 without content change.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  ALGO_VERSION, LAYOUT_FELDER, erzeugeVorschlaege, footprintHash, kartenDaten, uebernehmeVorschlag, vorschlagKompakt, vorschlagVeraltet, sortiereVorschlaege,
} from "@designer/lib/bebauungsvorschlaege";
import { LAYER_VERSION, MIGRATIONEN, migrateLayer } from "@core/lib/fachlayerSchema";
import { WERKSTATT_DEFAULT } from "@designer/lib/werkstattDefaults";
import { WERKSTATT_TYPEN } from "@designer/lib/wohnungsTypen";
import { FOOTPRINTS } from "../e2e/fixtures/footprints.js";

const STD = WERKSTATT_TYPEN.filter((t) => t.gruppe === "standard").slice(0, 3);
const RECHTECK = FOOTPRINTS.rechteck_70x16.footprintM;
const BASIS = { storeys: 4, einheiten: STD, raumzonen: true, regeln: {}, nordwinkel: 0, okf_m: 9 };
const JETZT = new Date("2026-10-10T18:00:00.000Z");
const CFG = {
  ...WERKSTATT_DEFAULT, typ: "mittelflur", einheiten: STD,
  gesperrteGrenzen: ["L0-B0-G1", "L0-B0-G2"], anordnung: { "L0-B0": ["st-2zi"] }, grenzenPositionen: { "L0-B0-G1": 12.5 },
  tuerAufschlaege: { "0|Bad (WE 0-1) ·WT|0": "links", "0|Bad (WE 0-2) ·WT|0": "rechts", "0|Bad (WE 0-3) ·WT|0": "links" }, stufeJeWe: { "0|st-2zi|1": "R" },
};
const liste = erzeugeVorschlaege(RECHTECK, BASIS);
const mfh = liste.find((v) => v.typologie.erschliessung === "mfh");
const mittelflur = liste.find((v) => v.typologie.erschliessung === "mittelflur");

describe("86-05b — uebernehmeVorschlag", () => {
  it("setzt typ + riegelMinFlaeche_m2, speichert den Vorschlag kompakt, verwirft Layout-Felder mit Zählung", () => {
    const { cfg, verworfen, behalten } = uebernehmeVorschlag(CFG, mfh, { jetzt: JETZT });
    assert.equal(cfg.typ, "mfh");
    assert.equal(cfg.riegelMinFlaeche_m2, 120);
    assert.equal(behalten, false);
    assert.deepEqual(cfg.gewaehlterVorschlag, vorschlagKompakt(mfh, JETZT));
    assert.equal(cfg.gewaehlterVorschlag.gewaehltAm, "2026-10-10T18:00:00.000Z");
    assert.equal(cfg.gewaehlterVorschlag.footprintHash, footprintHash(RECHTECK));
    assert.equal(cfg.gewaehlterVorschlag.algoVersion, ALGO_VERSION);
    assert.deepEqual(cfg.gesperrteGrenzen, []);
    for (const f of LAYOUT_FELDER.filter((k) => k !== "gesperrteGrenzen")) assert.deepEqual(cfg[f], {}, f);
    // 75-12: raumGrenzen joined LAYOUT_FELDER (none set in CFG → 0 dropped).
    assert.deepEqual(verworfen, { gesamt: 8, gesperrteGrenzen: 2, anordnung: 1, grenzenPositionen: 1, tuerAufschlaege: 3, stufeJeWe: 1, raumGrenzen: 0, geschosseJeRiegel: 0 });
    assert.equal(cfg.einheiten, CFG.einheiten, "Mix bleibt");
    assert.equal(CFG.typ, "mittelflur", "Eingabe unverändert");
    assert.equal(CFG.gesperrteGrenzen.length, 2);
  });

  it("behalteEingaben: nur bei gleicher Typologie, sonst verwerfen", () => {
    const gleich = uebernehmeVorschlag(CFG, mittelflur, { behalteEingaben: true, jetzt: JETZT });
    assert.equal(gleich.behalten, true);
    assert.deepEqual(gleich.cfg.gesperrteGrenzen, CFG.gesperrteGrenzen);
    assert.equal(gleich.verworfen.gesamt, 0);
    const anders = uebernehmeVorschlag(CFG, mfh, { behalteEingaben: true, jetzt: JETZT });
    assert.equal(anders.behalten, false);
    assert.equal(anders.verworfen.gesamt, 8);
  });

  it("funktioniert mit Kartendaten (Worker-Ausgabe) genauso wie mit dem vollen Vorschlag", () => {
    const a = uebernehmeVorschlag(CFG, mfh, { jetzt: JETZT }).cfg;
    const b = uebernehmeVorschlag(CFG, kartenDaten(mfh), { jetzt: JETZT }).cfg;
    assert.equal(JSON.stringify(a), JSON.stringify(b));
  });

  it("Übernahme erzeugt die Konfiguration, mit der die Werkstatt dasselbe Ergebnis rechnet (Default-Mindestfläche 120)", () => {
    const { cfg } = uebernehmeVorschlag(CFG, mfh, { jetzt: JETZT });
    assert.equal(cfg.riegelMinFlaeche_m2, mfh.typologie.zerlegung.minFlaeche_m2);
    assert.equal(cfg.typ, mfh.typologie.erschliessung);
  });
});

describe("86-05b — vorschlagVeraltet", () => {
  const gewaehlt = vorschlagKompakt(mfh, JETZT);
  it("aktuell: nicht veraltet; verschobene Grundfläche: grundflaeche; andere Version: algorithmus; ohne Vorschlag: nein", () => {
    assert.deepEqual(vorschlagVeraltet(gewaehlt, RECHTECK), { veraltet: false, grund: null });
    assert.deepEqual(vorschlagVeraltet(gewaehlt, RECHTECK.map((p) => ({ x: p.x + 0.5, z: p.z }))), { veraltet: true, grund: "grundflaeche" });
    assert.deepEqual(vorschlagVeraltet({ ...gewaehlt, algoVersion: ALGO_VERSION + 1 }, RECHTECK), { veraltet: true, grund: "algorithmus" });
    assert.deepEqual(vorschlagVeraltet(null, RECHTECK), { veraltet: false, grund: null });
    assert.deepEqual(vorschlagVeraltet(gewaehlt, FOOTPRINTS.L.footprintM), { veraltet: true, grund: "grundflaeche" });
  });
});

describe("86-05b — kartenDaten", () => {
  it("nur EG-Zonen mit Punkten, Riegel-Umrisse, Rest; keine weListe; Kennzahlen + Ids unverändert; sortierbar", () => {
    const k = kartenDaten(mfh);
    assert.equal(k.id, mfh.id);
    assert.equal("ergebnis" in k, false);
    assert.equal("weListe" in k, false);
    assert.ok(k.zonenEG.length > 0);
    assert.ok(k.zonenEG.every((z) => z.points.length >= 3));
    assert.equal(k.zonenEG.length, mfh.ergebnis.zonen.filter((z) => Math.round(z.level) === 0).length);
    assert.deepEqual(k.kennzahlen, mfh.kennzahlen);
    assert.deepEqual(k.riegelUmrisse, []);
    const sortiert = sortiereVorschlaege(liste.map(kartenDaten), "we");
    assert.deepEqual(sortiert.map((v) => v.id), sortiereVorschlaege(liste, "we").map((v) => v.id));
    const l = erzeugeVorschlaege(FOOTPRINTS.L.footprintM, BASIS, { max: 1 })[0];
    assert.equal(kartenDaten(l).riegelUmrisse.length, l.riegel);
    assert.equal(kartenDaten(l).riegelUmrisse.length, 2);
    // Structured-clone safe: no functions anywhere.
    assert.doesNotThrow(() => structuredClone(k));
  });
});

describe("86-05b — werkstatt_layer Schema v2", () => {
  it("Version 2 mit zwei Migrationen; v1-Blob ohne neue Felder bleibt inhaltlich gleich; Defaults tragen die neuen Felder", () => {
    // 75-12 raised the layer to v3 (raumGrenzen), 86-04 to v4 (zerlegung, geschosseJeRiegel),
    // 75-10 to v5 (bewertungsGewichte) — the 86-05b step 1 → 2 stays in the chain.
    assert.equal(LAYER_VERSION.werkstatt_layer, 5);
    assert.equal(MIGRATIONEN.werkstatt_layer.length, 5);
    const alt = { v: 1, typ: "mfh", einheiten: [], stufeJeWe: { a: "R" } };
    const r = migrateLayer("werkstatt_layer", alt);
    assert.equal(r.migriert, true);
    assert.equal(r.wert.v, 5); // 75-12/86-04/75-10: the chain now runs on to v5 (identity steps)
    const { v, ...rest } = r.wert;
    assert.deepEqual(rest, { typ: "mfh", einheiten: [], stufeJeWe: { a: "R" } });
    assert.equal("gewaehlterVorschlag" in r.wert, false, "Feld fehlt → unverändert (Default füllt)");
    assert.equal(WERKSTATT_DEFAULT.riegelMinFlaeche_m2, 120);
    assert.equal(WERKSTATT_DEFAULT.gewaehlterVorschlag, null);
  });
});
