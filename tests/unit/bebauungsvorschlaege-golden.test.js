// 86-05a Golden test for erzeugeVorschlaege(): for the rectangle, the L and the U footprint
// the ORDERED id list plus every figure is frozen as a SHA-256 over a stable JSON (sorted
// keys, numbers rounded to 1e-6). A change in the enumeration, the ids, the decomposition
// or any figure turns red with the shape's name; an intended change is frozen with
// GOLDEN_UPDATE=1 and a commit that says "bewusst neu" (same convention as tesseliere-golden).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

import { erzeugeVorschlaege } from "@designer/lib/bebauungsvorschlaege";
import { WERKSTATT_TYPEN } from "@designer/lib/wohnungsTypen";
import { FOOTPRINTS } from "../e2e/fixtures/footprints.js";

const REPO = path.resolve(import.meta.dirname, "../..");
const GOLDEN = path.join(REPO, "tests/unit/fixtures/bebauungsvorschlaege-golden.json");
const UPDATE = process.env.GOLDEN_UPDATE === "1";

const STD = WERKSTATT_TYPEN.filter((t) => t.gruppe === "standard").slice(0, 3);
const BASIS = { storeys: 4, einheiten: STD, raumzonen: true, regeln: {}, nordwinkel: 0, okf_m: 9 };

/** Stable JSON: sorted keys, numbers rounded to 1e-6. */
function stabil(v) {
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : String(v);
  if (Array.isArray(v)) return v.map(stabil);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, stabil(v[k])]));
  return v;
}
const hashVon = (obj) => createHash("sha256").update(JSON.stringify(stabil(obj))).digest("hex");

describe("86-05a — Golden erzeugeVorschlaege()", () => {
  const ist = {};
  for (const key of ["rechteck_70x16", "L", "U"]) {
    const liste = erzeugeVorschlaege(FOOTPRINTS[key].footprintM, BASIS);
    const kompakt = liste.map((v) => ({ id: v.id, riegel: v.riegel, typologie: v.typologie, kennzahlen: Object.fromEntries(Object.entries(v.kennzahlen).map(([k, e]) => [k, e.wert])) }));
    ist[key] = { hash: hashVon(kompakt), anzahl: liste.length, ids: liste.map((v) => v.id) };
  }

  it(`${Object.keys(ist).length} Formen gegen tests/unit/fixtures/bebauungsvorschlaege-golden.json`, () => {
    if (UPDATE || !fs.existsSync(GOLDEN)) {
      fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
      fs.writeFileSync(GOLDEN, `${JSON.stringify({ stand: new Date().toISOString().slice(0, 10), faelle: ist }, null, 2)}\n`);
      if (!UPDATE) assert.fail("Golden-Datei fehlte — angelegt; Lauf wiederholen und committen");
      return;
    }
    const soll = JSON.parse(fs.readFileSync(GOLDEN, "utf8")).faelle;
    const abweichend = Object.keys(ist).filter((k) => !soll[k] || soll[k].hash !== ist[k].hash);
    assert.deepEqual(abweichend, [], `Golden-Abweichung (bewusst? GOLDEN_UPDATE=1): ${abweichend.map((k) => `${k} [Anzahl ${soll[k]?.anzahl ?? "–"}→${ist[k].anzahl}]`).join("; ")}`);
  });
});
