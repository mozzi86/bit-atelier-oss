// Unit tests for 87-07: every registered layer migrates from "no version" to the current
// version without changing its content, newer blobs are left alone, save stamps v and
// updatedAt, and the register in .planning/FACHLAYER-SCHEMA.md lists every field the code
// uses (grep over useFachlayer calls and the literal "<name>_layer" keys).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { LAYER_VERSION, MIGRATIONEN, migrateLayer, stempelFuerSave, istFachlayer } from "@core/lib/fachlayerSchema";

const REPO = path.resolve(import.meta.dirname, "../..");

describe("87-07 — Fachlayer-Schema", () => {
  it("jeder registrierte Layer hat Version ≥ 1 und genau so viele Migrationen", () => {
    for (const [feld, v] of Object.entries(LAYER_VERSION)) {
      assert.ok(Number.isInteger(v) && v >= 1, feld);
      assert.equal(MIGRATIONEN[feld].length, v, `${feld}: Migrationen`);
    }
  });

  it("Blob ohne v → aktuelle Version, Inhalt unverändert, Eingabe nicht mutiert", () => {
    for (const feld of Object.keys(LAYER_VERSION)) {
      const alt = { a: 1, liste: [{ x: 2 }], tief: { y: "z" } };
      const kopie = JSON.stringify(alt);
      const r = migrateLayer(feld, alt);
      assert.equal(r.migriert, true, feld);
      assert.equal(r.von, 0);
      assert.equal(r.nach, LAYER_VERSION[feld]);
      assert.equal(r.wert.v, LAYER_VERSION[feld]);
      const { v, ...rest } = r.wert;
      assert.deepEqual(rest, alt, `${feld}: Inhalt`);
      assert.equal(JSON.stringify(alt), kopie, `${feld}: Eingabe mutiert`);
    }
  });

  it("aktueller Blob bleibt dasselbe Objekt; neuerer Blob wird nicht angefasst", () => {
    const aktuell = { v: LAYER_VERSION.werkstatt_layer, typ: "mfh" };
    assert.equal(migrateLayer("werkstatt_layer", aktuell).wert, aktuell);
    const neuer = { v: LAYER_VERSION.werkstatt_layer + 5, typ: "x" };
    const r = migrateLayer("werkstatt_layer", neuer);
    assert.equal(r.wert, neuer);
    assert.equal(r.zuNeu, true);
  });

  it("unbekanntes Feld, null, Array, Primitive: unverändert", () => {
    assert.equal(migrateLayer("fremd_layer", { a: 1 }).migriert, false);
    assert.equal(migrateLayer("werkstatt_layer", null).wert, null);
    const arr = [1];
    assert.equal(migrateLayer("werkstatt_layer", arr).wert, arr);
    assert.equal(migrateLayer("werkstatt_layer", "s").wert, "s");
    assert.equal(istFachlayer("ifc_layer"), false, "ifc_layer ist eine Filterachse, kein BimModel-Feld");
  });

  it("stempelFuerSave setzt v und updatedAt (ISO), lässt Nicht-Objekte durch", () => {
    const t = new Date("2026-10-09T10:00:00.000Z");
    const s = stempelFuerSave("netz_layer", { knoten: [] }, t);
    assert.equal(s.v, LAYER_VERSION.netz_layer);
    assert.equal(s.updatedAt, "2026-10-09T10:00:00.000Z");
    assert.equal(stempelFuerSave("netz_layer", null, t), null);
    assert.equal(stempelFuerSave("fremd", { a: 1 }, t).v, undefined);
  });

  it("Register: jedes im Code benutzte *_layer-Feld ist registriert und steht in FACHLAYER-SCHEMA.md", () => {
    const quellen = execFileSync("git", ["ls-files", "packages", "src"], { cwd: REPO, encoding: "utf8" })
      .split(/\r?\n/).filter((f) => /\.(jsx?|mjs)$/.test(f) && !/\/ui\//.test(f));
    const benutzt = new Set();
    for (const f of quellen) {
      const text = fs.readFileSync(path.join(REPO, f), "utf8");
      for (const m of text.matchAll(/["'`]([a-z]+_layer)["'`]/g)) benutzt.add(m[1]);
    }
    benutzt.delete("ifc_layer"); // filter axis on an IFC attribute, not a BimModel field
    // .planning/ is private and not part of the public export (scripts/oss-export.mjs): there the code
    // register (LAYER_VERSION) is still checked, only the comparison with the planning document is skipped.
    const registerPfad = path.join(REPO, ".planning/FACHLAYER-SCHEMA.md");
    const register = fs.existsSync(registerPfad) ? fs.readFileSync(registerPfad, "utf8") : null;
    for (const feld of benutzt) {
      assert.ok(istFachlayer(feld), `${feld} fehlt in LAYER_VERSION`);
      if (register) assert.ok(register.includes(`\`${feld}\``), `${feld} fehlt in FACHLAYER-SCHEMA.md`);
    }
    if (register) for (const feld of Object.keys(LAYER_VERSION)) assert.ok(register.includes(`\`${feld}\``), `${feld} nur im Code registriert`);
  });
});

describe("107-03 — aufbauten_layer (projektbezogene Aufbauten, Version 1)", () => {
  it("Version 1 mit einer Migration, Blob ohne v behält seinen Inhalt, Stempel setzt v", () => {
    assert.equal(LAYER_VERSION.aufbauten_layer, 1);
    assert.equal(MIGRATIONEN.aufbauten_layer.length, 1);
    const alt = { aufbauten: { "p-1": { name: "Wand", skins: [{ name: "Ziegel", material: "hlz", thickness: 365 }] } } };
    const r = migrateLayer("aufbauten_layer", alt);
    assert.equal(r.migriert, true);
    assert.deepEqual(r.wert.aufbauten, alt.aufbauten);
    assert.equal(stempelFuerSave("aufbauten_layer", alt, new Date("2026-10-25T10:00:00.000Z")).v, 1);
  });
  it("steht in useFachlayer.js (Feld-Registry) und im Register FACHLAYER-SCHEMA.md", () => {
    assert.ok(fs.readFileSync(path.join(REPO, "packages/nova-designer/src/lib/useFachlayer.js"), "utf8").includes("aufbauten_layer"));
    const registerPfad = path.join(REPO, ".planning/FACHLAYER-SCHEMA.md");
    if (fs.existsSync(registerPfad)) assert.ok(fs.readFileSync(registerPfad, "utf8").includes("`aufbauten_layer`"));
  });
});
