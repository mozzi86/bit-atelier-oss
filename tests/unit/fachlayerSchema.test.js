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

describe("107-05 — massing_layer v2 (optionale Innenringe `loecher`)", () => {
  it("v1 → v2 (Innenringe) inhaltlich leer; ein v1-Blob bleibt inhaltlich gleich, nur v steigt (seit 107-06 bis v3)", () => {
    assert.equal(LAYER_VERSION.massing_layer, 6); // 107-06 raised it to 3 (optional oeffnungen), 107-07 to 4 (optional hilfslinien), 107-08 to 5 (optional body fields), 107-10 to 6 (optional dach)
    assert.equal(MIGRATIONEN.massing_layer.length, 6);
    const v1 = { v: 1, koerper: [{ id: "k1", profil: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }], hoehe: 3, basis: 0, pos: { x: 0, y: 0 }, drehung: 0, gruppe: null }], gruppen: {}, naechsteId: 2 };
    const kopie = JSON.stringify(v1);
    const r = migrateLayer("massing_layer", v1);
    assert.equal(r.migriert, true);
    assert.equal(r.von, 1);
    assert.equal(r.wert.v, 6); // 107-10: v6
    const { v: _v, ...rest } = r.wert;
    const { v: _v1, ...rest1 } = v1;
    assert.deepEqual(rest, rest1, "kein Feld umgeschrieben, kein loecher-Feld ergänzt");
    assert.equal(JSON.stringify(v1), kopie, "Eingabe nicht mutiert");
  });
  it("ein v2-Blob mit Innenring bleibt inhaltlich gleich; das Register nennt das Feld", () => {
    const v2 = { v: 2, koerper: [{ id: "k1", profil: [{ x: 0, y: 0 }, { x: 9, y: 0 }, { x: 9, y: 9 }, { x: 0, y: 9 }], loecher: [[{ x: 3, y: 3 }, { x: 6, y: 3 }, { x: 6, y: 6 }, { x: 3, y: 6 }]], hoehe: 3, basis: 0, pos: { x: 0, y: 0 }, drehung: 0, gruppe: null }], gruppen: {}, naechsteId: 2 };
    const m2 = migrateLayer("massing_layer", v2);
    assert.equal(m2.wert.v, 6); // 107-10: v6
    assert.deepEqual(m2.wert.koerper, v2.koerper, "v2 → v6 schreibt nichts um");
    const registerPfad = path.join(REPO, ".planning/FACHLAYER-SCHEMA.md");
    if (fs.existsSync(registerPfad)) assert.ok(/`loecher/.test(fs.readFileSync(registerPfad, "utf8")));
  });
});

describe("107-06 — massing_layer v3 (optionale Öffnungen `oeffnungen`)", () => {
  it("v2 → v3 (seit 107-07 bis v4): ein v2-Blob bleibt inhaltlich gleich, kein oeffnungen-Feld ergänzt", () => {
    assert.equal(LAYER_VERSION.massing_layer, 6); // 107-08: v5, 107-10: v6
    assert.equal(MIGRATIONEN.massing_layer.length, 6);
    const v2 = { v: 2, koerper: [{ id: "k1", profil: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 0.3 }, { x: 0, y: 0.3 }], hoehe: 3, basis: 0, pos: { x: 0, y: 0 }, drehung: 0, gruppe: null }], gruppen: {}, naechsteId: 2 };
    const kopie = JSON.stringify(v2);
    const r = migrateLayer("massing_layer", v2);
    assert.equal(r.migriert, true);
    assert.equal(r.von, 2);
    assert.equal(r.wert.v, 6); // 107-10: v6
    const { v: _v, ...rest } = r.wert;
    const { v: _v2, ...rest2 } = v2;
    assert.deepEqual(rest, rest2);
    assert.equal("oeffnungen" in r.wert.koerper[0], false);
    assert.equal(JSON.stringify(v2), kopie, "Eingabe nicht mutiert");
  });
  it("ein v3-Blob mit Öffnung bleibt inhaltlich gleich (seit 107-07 nur v steigt); das Register nennt das Feld und v3", () => {
    const v3 = { v: 3, koerper: [{ id: "k1", profil: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 0.3 }, { x: 0, y: 0.3 }], oeffnungen: [{ kante: 2, u: 2.5, width: 1.2, height: 1.5, sill: 0.8 }], hoehe: 3, basis: 0, pos: { x: 0, y: 0 }, drehung: 0, gruppe: null }], gruppen: {}, naechsteId: 2 };
    const { v: _v3, ...rest3 } = migrateLayer("massing_layer", v3).wert;
    const { v: _v3a, ...orig3 } = v3;
    assert.deepEqual(rest3, orig3);
    const registerPfad = path.join(REPO, ".planning/FACHLAYER-SCHEMA.md");
    if (fs.existsSync(registerPfad)) {
      const reg = fs.readFileSync(registerPfad, "utf8");
      assert.ok(reg.includes("`oeffnungen[{kante, u, width, height, sill}]`"));
      assert.ok(reg.includes("v3 seit 107-06"));
    }
  });
});

describe("107-07 — massing_layer v4 (optionale Hilfslinien `hilfslinien`)", () => {
  it("Version 4 mit vier Migrationen; ein v3-Blob bleibt inhaltlich gleich, kein hilfslinien-Feld ergänzt", () => {
    assert.equal(LAYER_VERSION.massing_layer, 6); // 107-08: v5, 107-10: v6
    assert.equal(MIGRATIONEN.massing_layer.length, 6);
    const v3 = { v: 3, koerper: [{ id: "k1", profil: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 4 }, { x: 0, y: 4 }], hoehe: 3, basis: 0, pos: { x: 0, y: 0 }, drehung: 0, gruppe: null }], gruppen: {}, naechsteId: 2 };
    const kopie = JSON.stringify(v3);
    const r = migrateLayer("massing_layer", v3);
    assert.equal(r.migriert, true);
    assert.equal(r.von, 3);
    assert.equal(r.wert.v, 6); // 107-10: v6
    const { v: _v, ...rest } = r.wert;
    const { v: _v3, ...rest3 } = v3;
    assert.deepEqual(rest, rest3);
    assert.equal("hilfslinien" in r.wert, false, "fehlendes Feld = keine Hilfslinie, nichts ergänzt");
    assert.equal(JSON.stringify(v3), kopie, "Eingabe nicht mutiert");
  });
  it("ein v4-Blob mit Hilfslinien bleibt dasselbe Objekt; das Register nennt das Feld und v4", () => {
    const v4 = { v: 4, koerper: [], gruppen: {}, naechsteId: 3, hilfslinien: [{ id: "h1", art: "gerade", a: { x: 0, y: 0 }, b: { x: 1, y: 0 } }, { id: "h2", art: "punkt", a: { x: 3, y: 2 } }] };
    // 107-08: v4 is no longer current — the blob migrates to v5 without any content change
    const { v: _v4, ...rest4 } = migrateLayer("massing_layer", v4).wert;
    const { v: _v4b, ...roh4 } = v4;
    assert.deepEqual(rest4, roh4);
    const registerPfad = path.join(REPO, ".planning/FACHLAYER-SCHEMA.md");
    if (fs.existsSync(registerPfad)) {
      const reg = fs.readFileSync(registerPfad, "utf8");
      assert.ok(reg.includes("`hilfslinien[{id, art, a, b?}]`"));
      assert.ok(reg.includes("v4 seit 107-07"));
    }
  });
});

describe("107-08 — massing_layer v5 (optionale Körperfelder guid, spiegel, massstab, bauteil_typ, bauteil_typ_quelle, status)", () => {
  it("Version 5 mit fünf Migrationen (seit 107-10: 6); ein v4-Blob bleibt inhaltlich gleich, kein neues Feld ergänzt", () => {
    assert.equal(LAYER_VERSION.massing_layer, 6); // 107-10: v6
    assert.equal(MIGRATIONEN.massing_layer.length, 6);
    const v4 = { v: 4, koerper: [{ id: "k1", profil: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 0.3 }, { x: 0, y: 0.3 }], hoehe: 2.5, basis: 0, pos: { x: 0, y: 0 }, drehung: 0, gruppe: null }], gruppen: {}, naechsteId: 2 };
    const kopie = JSON.stringify(v4);
    const r = migrateLayer("massing_layer", v4);
    assert.equal(r.migriert, true);
    assert.equal(r.von, 4);
    assert.equal(r.wert.v, 6); // 107-10: through v5 to v6
    const { v: _v, ...rest } = r.wert;
    const { v: _v4, ...rest4 } = v4;
    assert.deepEqual(rest, rest4);
    for (const feld of ["guid", "spiegel", "massstab", "bauteil_typ", "bauteil_typ_quelle", "status"]) assert.equal(feld in r.wert.koerper[0], false, `${feld} nicht ergänzt (alter Körper bleibt untypisiert)`);
    assert.equal(JSON.stringify(v4), kopie, "Eingabe nicht mutiert");
  });
  it("ein v5-Blob mit den neuen Feldern behält seinen Inhalt (seit 107-10 nur v → 6); das Register nennt die Felder und v5", () => {
    const v5 = { v: 5, koerper: [{ id: "k1", profil: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 0.3 }, { x: 0, y: 0.3 }], hoehe: 2.5, basis: 0, pos: { x: 0, y: 0 }, drehung: 0, gruppe: null,
      guid: "0123456789ABCDEFabcdef", spiegel: true, massstab: { x: 1, y: 2, z: 1 }, bauteil_typ: "wand-tragend", bauteil_typ_quelle: "automatisch", status: "neubau" }], gruppen: {}, naechsteId: 2 };
    const { v: _v5neu, ...inhalt5 } = migrateLayer("massing_layer", v5).wert;
    const { v: _v5alt, ...alt5 } = v5;
    assert.deepEqual(inhalt5, alt5); // 107-10: v5 → v6 is an empty migration
    const registerPfad = path.join(REPO, ".planning/FACHLAYER-SCHEMA.md");
    if (fs.existsSync(registerPfad)) {
      const reg = fs.readFileSync(registerPfad, "utf8");
      for (const feld of ["`guid`", "`spiegel`", "`massstab", "`bauteil_typ`", "`bauteil_typ_quelle`", "`status`"]) assert.ok(reg.includes(feld), feld);
      assert.ok(reg.includes("v5 seit 107-08")); // 107-10: v6 is the bold current one now
    }
  });
});

describe("107-14 — csg_cache_layer (Mesh-Zwischenspeicher des CSG-Kerns, Version 1)", () => {
  it("Version 1 mit einer Migration; Blob ohne v behält seinen Inhalt; Stempel setzt v; ist ein Fachlayer", () => {
    assert.equal(LAYER_VERSION.csg_cache_layer, 1);
    assert.equal(MIGRATIONEN.csg_cache_layer.length, 1);
    assert.equal(istFachlayer("csg_cache_layer"), true);
    const alt = { eintraege: { "g|wand": { pruefsumme: "0123456789abcdef", ort: "datenbank", objekt_id: null, inhalt: null, groesse_bytes: 0, dreiecke: 12, volumen_m3: 3, quelle: "solid", warnung: null, erzeugt: "2026-10-26T10:00:00.000Z" } } };
    const r = migrateLayer("csg_cache_layer", alt);
    assert.deepEqual(r.wert.eintraege, alt.eintraege);
    assert.equal(stempelFuerSave("csg_cache_layer", alt, new Date("2026-10-26T10:00:00.000Z")).v, 1);
  });
  it("Altprojekt ohne csg_cache_layer: kein anderer Layer ändert seine Version (rein additiv)", () => {
    assert.equal(LAYER_VERSION.massing_layer, 6); // 107-10 raised it (optional dach), not 107-14
    assert.equal(LAYER_VERSION.aufbauten_layer, 1);
    assert.equal(migrateLayer("csg_cache_layer", undefined).wert ?? null, null);
  });
  it("steht in useFachlayer.js (Feld-Registry, ein Schreiber useCsgCache) und im Register FACHLAYER-SCHEMA.md", () => {
    const kopf = fs.readFileSync(path.join(REPO, "packages/nova-designer/src/lib/useFachlayer.js"), "utf8");
    assert.ok(kopf.includes("csg_cache_layer") && kopf.includes("useCsgCache"));
    const registerPfad = path.join(REPO, ".planning/FACHLAYER-SCHEMA.md");
    if (fs.existsSync(registerPfad)) assert.ok(fs.readFileSync(registerPfad, "utf8").includes("`csg_cache_layer`"));
  });
});

describe("107-10 — massing_layer v6 (optionales Dach `dach`) und solidrelationen_layer v1", () => {
  it("Version 6 mit sechs Migrationen; ein v5-Blob bleibt inhaltlich gleich, kein `dach` ergänzt; ein v6-Blob bleibt dasselbe Objekt", () => {
    assert.equal(LAYER_VERSION.massing_layer, 6);
    assert.equal(MIGRATIONEN.massing_layer.length, 6);
    const v5 = { v: 5, koerper: [{ id: "k1", profil: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 6 }, { x: 0, y: 6 }], hoehe: 6, basis: 0, pos: { x: 0, y: 0 }, drehung: 0, gruppe: null }], gruppen: {}, naechsteId: 2 };
    const kopie = JSON.stringify(v5);
    const r = migrateLayer("massing_layer", v5);
    assert.equal(r.migriert, true);
    assert.equal(r.von, 5);
    assert.equal(r.wert.v, 6);
    assert.equal("dach" in r.wert.koerper[0], false);
    const { v: _a, ...rest } = r.wert;
    const { v: _b, ...rest5 } = v5;
    assert.deepEqual(rest, rest5);
    assert.equal(JSON.stringify(v5), kopie, "Eingabe nicht mutiert");
    const v6 = { ...v5, v: 6, koerper: [{ ...v5.koerper[0], dach: { form: "sattel", neigung_grad: 35 } }] };
    assert.equal(migrateLayer("massing_layer", v6).wert, v6);
  });
  it("solidrelationen_layer: Version 1, eine Migration, Blob ohne v behält seine Relationen, Stempel setzt v", () => {
    assert.equal(LAYER_VERSION.solidrelationen_layer, 1);
    assert.equal(MIGRATIONEN.solidrelationen_layer.length, 1);
    assert.equal(istFachlayer("solidrelationen_layer"), true);
    const alt = { relationen: [{ id: "r1", ziel_guid: "0123456789ABCDEFabcdef", operator_guid: "fedcbaFEDCBA9876543210", operation: "abzug_nach_oben", aktiv: true }] };
    const r = migrateLayer("solidrelationen_layer", alt);
    assert.deepEqual(r.wert.relationen, alt.relationen);
    assert.equal(stempelFuerSave("solidrelationen_layer", alt, new Date("2026-10-26T10:00:00.000Z")).v, 1);
    assert.equal(migrateLayer("solidrelationen_layer", undefined).wert ?? null, null, "Altprojekt ohne Layer bleibt ohne Layer");
  });
  it("beide stehen im Kopf von useFachlayer.js und im Register FACHLAYER-SCHEMA.md (v6, Felder)", () => {
    const kopf = fs.readFileSync(path.join(REPO, "packages/nova-designer/src/lib/useFachlayer.js"), "utf8");
    assert.ok(kopf.includes("solidrelationen_layer"));
    assert.ok(kopf.includes("`dach`") || kopf.includes("dach {"));
    const registerPfad = path.join(REPO, ".planning/FACHLAYER-SCHEMA.md");
    if (fs.existsSync(registerPfad)) {
      const reg = fs.readFileSync(registerPfad, "utf8");
      assert.ok(reg.includes("`solidrelationen_layer`"));
      assert.ok(reg.includes("**v6** seit 107-10"));
    }
  });
});

describe("107-11 — werkstatt_layer v6 (optionale Felder `dachschraege_quelle`, `kniestock_m` am Wohnungstyp)", () => {
  it("Version 6, sechs Migrationen; ein v5-Blob ist inhaltlich ein gültiger v6-Blob", () => {
    assert.equal(LAYER_VERSION.werkstatt_layer, 6);
    assert.equal(MIGRATIONEN.werkstatt_layer.length, 6);
    const v5 = { v: 5, typ: "mfh", einheiten: [{ key: "2zi", dachschraege: { unter1m_m2: 3, zwischen1und2m_m2: 5 } }] };
    const r = migrateLayer("werkstatt_layer", v5);
    assert.equal(r.migriert, true);
    assert.equal(r.wert.v, 6);
    const { v, ...rest } = r.wert;
    const { v: _v5, ...alt } = v5;
    assert.deepEqual(rest, alt, "nichts umgeschrieben");
    assert.equal("dachschraege_quelle" in r.wert.einheiten[0], false, "fehlendes Feld bleibt fehlend (= Handeingabe)");
    const v6 = { v: 6, typ: "mfh", einheiten: [{ key: "2zi", dachschraege_quelle: "geometrie", kniestock_m: 0.8 }] };
    assert.equal(migrateLayer("werkstatt_layer", v6).wert, v6);
  });
  it("Register FACHLAYER-SCHEMA.md und Kopf von useFachlayer.js nennen v6 und die Felder", () => {
    const kopf = fs.readFileSync(path.join(REPO, "packages/nova-designer/src/lib/useFachlayer.js"), "utf8");
    assert.ok(kopf.includes("dachschraege_quelle") && kopf.includes("kniestock_m"));
    const registerPfad = path.join(REPO, ".planning/FACHLAYER-SCHEMA.md");
    if (fs.existsSync(registerPfad)) {
      const reg = fs.readFileSync(registerPfad, "utf8");
      assert.ok(reg.includes("**v6** seit 107-11"));
      assert.ok(reg.includes("`dachschraege_quelle`") && reg.includes("`kniestock_m`"));
    }
  });
});

describe("107-12 — ansicht_layer (gespeicherte Ausschnitte, Version 1)", () => {
  it("Version 1, eine Migration, Blob ohne v behält seine Ausschnitte, Stempel setzt v; Altprojekt ohne Layer bleibt ohne", () => {
    assert.equal(LAYER_VERSION.ansicht_layer, 1);
    assert.equal(MIGRATIONEN.ansicht_layer.length, 1);
    assert.equal(istFachlayer("ansicht_layer"), true);
    const alt = { ausschnitte: [{ id: "a1", name: "Schalplan", type: "grundriss", level: -1, scale: 50, combo: "Rohbau", cutHeight: 1.1, strukturdarstellung: "nur-kern-tragend" }], ebenen: [], kombinationen: {} };
    const r = migrateLayer("ansicht_layer", alt);
    assert.equal(r.migriert, true);
    assert.deepEqual(r.wert.ausschnitte, alt.ausschnitte);
    assert.equal(stempelFuerSave("ansicht_layer", alt, new Date("2026-10-25T10:00:00.000Z")).v, 1);
    assert.equal(migrateLayer("ansicht_layer", undefined).wert ?? null, null);
  });
  it("steht in useFachlayer.js (Feld-Registry) und im Register FACHLAYER-SCHEMA.md", () => {
    assert.ok(fs.readFileSync(path.join(REPO, "packages/nova-designer/src/lib/useFachlayer.js"), "utf8").includes("ansicht_layer"));
    const registerPfad = path.join(REPO, ".planning/FACHLAYER-SCHEMA.md");
    if (fs.existsSync(registerPfad)) assert.ok(fs.readFileSync(registerPfad, "utf8").includes("`ansicht_layer`"));
  });
});
