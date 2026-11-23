// 115-05b part 2 (E-4 of the final review, unit test asked for in part 1): the furniture migration stores only the migrated field
// of the FRESH design record on its strict stand; the answer (another tab's changes included) goes into the designer's three-way
// path - a field both this tab and the other one changed becomes a conflict (card + lock), it is never dropped, and the base moves
// only together with that merge. Without the designer of the project mounted the base stays (the next write answers 409).
//   moeblierungMigrationSchreiben (@designer, lazily loaded by ComplexDesigner) + komplexFremdUebernehmen (@core) - the two
//   pieces ComplexDesigner.komplexStandNehmen wires to its state.
//
// In: nothing. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { bimServer } from "./bimServerAttrappe.js";

const T0 = "2026-11-19T10:00:00.000Z";
const T1 = "2026-11-19T10:05:00.000Z";
const G = "2Wohnraum11505bTestGuX"; // 22 characters
const RAUM = { points: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }, { x: 0, z: 4 }], level: 0, name: "Raum Nord", id: 1, guid: G };
const ALT = { "0:Raum Nord": [{ id: "m1", typ: "tisch", x: 1, y: 1, rot: 0 }] };

/** The normal form of the designer (start values + record, without administration fields) for this test. @param {any} r */
const normal = (r) => Object.fromEntries(Object.entries({ name: "", moeblierung: {}, ...(r || {}) })
  .filter(([k]) => !["id", "created_date", "updated_date", "project_id"].includes(k)));

test("E-4: the migration answer goes into the three-way path — a field both changed becomes a conflict, the base moves with it", async () => {
  // this tab loaded name "Testprojekt A" (T0) and renamed it locally; another tab stored another name (T1) meanwhile
  const srv = bimServer({ BuildingComplex: [{ id: "k4", project_id: "pM4", updated_date: T1, name: "Testprojekt A fremd", moeblierung: ALT }] });
  const altFetch = globalThis.fetch;
  globalThis.fetch = /** @type {any} */ (srv.fetch);
  try {
    const { bitApi } = await import("@core/api/bitApi");
    const { moeblierungMigrationSchreiben } = await import("@designer/lib/moebelMigrationSpeichern.js");
    const { komplexFremdUebernehmen } = await import("@core/lib/abgleich/komplexAbgleich.js");
    const basis = { id: "k4", updated_date: T0, felder: normal({ name: "Testprojekt A", moeblierung: ALT }) };
    const mein = normal({ name: "Testprojekt A lokal", moeblierung: ALT });
    /** @type {any[]} */ const ergebnisse = [];
    const r = await moeblierungMigrationSchreiben({ api: bitApi.entities.BuildingComplex, pid: "pM4", id: "k4", zonen: [RAUM], opts: {},
      aktiv: () => true,
      nehmen: (/** @type {any} */ gespeichert) => { ergebnisse.push(komplexFremdUebernehmen({ basis, mein, gespeichert, gesperrt: new Set(), normal })); } });
    assert.equal(r, "abgeglichen");
    assert.equal(srv.schreiben.length, 1, "one PUT");
    assert.deepEqual(Object.keys(srv.schreiben[0].body), ["moeblierung"], "only the migrated field is written");
    assert.equal(srv.schreiben[0].stand, T1, "on the stand of the fresh record");
    assert.equal(srv.rec("BuildingComplex", "pM4").name, "Testprojekt A fremd", "the other tab's name stays stored");
    assert.equal(ergebnisse.length, 1, "the answer was handed on, not dropped");
    const e = ergebnisse[0];
    assert.deepEqual(e.konflikte.map((/** @type {any} */ k) => k.einheit), ["name"], "the name both changed is a conflict (card + lock)");
    assert.equal(e.basis.updated_date, srv.rec("BuildingComplex", "pM4").updated_date, "the base moves to the stored state with the merge");
    assert.deepEqual(Object.keys(e.basis.felder.moeblierung), [`guid:${G}`]);
  } finally {
    globalThis.fetch = altFetch;
  }
});

test("E-4: the designer of the project is not mounted → written, nothing merged, the base stays", async () => {
  const srv = bimServer({ BuildingComplex: [{ id: "k5", project_id: "pM5", updated_date: T1, name: "Testprojekt B", moeblierung: ALT }] });
  const altFetch = globalThis.fetch;
  globalThis.fetch = /** @type {any} */ (srv.fetch);
  try {
    const { bitApi } = await import("@core/api/bitApi");
    const { moeblierungMigrationSchreiben } = await import("@designer/lib/moebelMigrationSpeichern.js");
    let genommen = 0;
    const r = await moeblierungMigrationSchreiben({ api: bitApi.entities.BuildingComplex, pid: "pM5", id: "k5", zonen: [RAUM], opts: {},
      aktiv: () => false, nehmen: () => { genommen += 1; } });
    assert.equal(r, "geschrieben");
    assert.equal(genommen, 0);
    // a record of another project (switched meanwhile) is never written
    const r2 = await moeblierungMigrationSchreiben({ api: bitApi.entities.BuildingComplex, pid: "pAnders", id: "k5", zonen: [RAUM], opts: {},
      aktiv: () => true, nehmen: () => { genommen += 1; } });
    assert.equal(r2, "anderes_projekt");
    assert.equal(srv.schreiben.length, 1);
  } finally {
    globalThis.fetch = altFetch;
  }
});
