// 87-06 Golden hashes for tesseliere(): the snapshots 7513/7514 cover axis-parallel
// rectangles only; every other shape (L, long L, U, pentagon, trapezoid, rotated
// rectangle) × typology × room-zone mode is frozen here as a SHA-256 over a stable JSON
// (sorted keys, numbers rounded to 1e-6). An unintended change in the solver, the
// fit (86-01) or the bar network (86-03) turns red with the name of the case; an
// intended one is frozen with GOLDEN_UPDATE=1 and a commit that says "bewusst neu".
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { tesseliere } from "@designer/lib/tesselierung";
import { WERKSTATT_TYPEN } from "@designer/lib/wohnungsTypen";
import { schwerpunkt } from "@designer/lib/formGeometrie";

const REPO = path.resolve(import.meta.dirname, "../..");
const GOLDEN = path.join(REPO, "tests/unit/fixtures/tesseliere-golden.json");
const UPDATE = process.env.GOLDEN_UPDATE === "1";

const STD = WERKSTATT_TYPEN.filter((t) => t.gruppe === "standard").slice(0, 3);
const rect = (w, d) => [{ x: -w / 2, z: -d / 2 }, { x: w / 2, z: -d / 2 }, { x: w / 2, z: d / 2 }, { x: -w / 2, z: d / 2 }];
const dreh = (pts, grad) => { const a = (grad * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a); return pts.map((p) => ({ x: c * p.x - s * p.z, z: s * p.x + c * p.z })); };
const FUENFECK = (() => {
  const px = [[596, 688], [736, 204], [1099, 104], [1433, 261], [1268, 550]];
  const p = px.map(([x, y]) => ({ x: x / 13.5, z: -y / 13.5 }));
  const c = schwerpunkt(p);
  return p.map((q) => ({ x: q.x - c.x, z: q.z - c.z }));
})();
export const FORMEN = {
  rechteck_70x16: rect(70, 16),
  rechteck_40x16_gedreht_23: dreh(rect(40, 16), 23),
  L: [{ x: 0, z: 0 }, { x: 48, z: 0 }, { x: 48, z: 16 }, { x: 16, z: 16 }, { x: 16, z: 40 }, { x: 0, z: 40 }],
  L_lang: [{ x: 0, z: 0 }, { x: 48, z: 0 }, { x: 48, z: 16 }, { x: 16, z: 16 }, { x: 16, z: 72 }, { x: 0, z: 72 }],
  U: [{ x: 0, z: 0 }, { x: 60, z: 0 }, { x: 60, z: 40 }, { x: 44, z: 40 }, { x: 44, z: 16 }, { x: 16, z: 16 }, { x: 16, z: 40 }, { x: 0, z: 40 }],
  fuenfeck: FUENFECK,
  trapez: [{ x: -30, z: -8 }, { x: 30, z: -8 }, { x: 22, z: 9 }, { x: -24, z: 9 }],
};
const TYPEN = ["mittelflur", "mfh", "laubengang", "spaenner", "reihenhaus"];

/** Stable JSON: sorted keys, numbers rounded to 1e-6 (float noise after rotations). */
function stabil(v) {
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : String(v);
  if (Array.isArray(v)) return v.map(stabil);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, stabil(v[k])]));
  return v;
}
const hashVon = (obj) => createHash("sha256").update(JSON.stringify(stabil(obj))).digest("hex");

describe("87-06 — Golden-Hashes tesseliere()", () => {
  const ist = {};
  for (const [form, fp] of Object.entries(FORMEN)) {
    for (const typ of TYPEN) {
      const r = tesseliere({ footprintM: fp, storeys: 4, typ, einheiten: STD, raumzonen: true });
      ist[`${form}|${typ}`] = { hash: hashVon(r), we: r.weListe.length, zonen: r.zonen.length, riegel: r.form?.riegel?.length ?? 1 };
    }
  }

  it("Determinismus: zwei Läufe, gleiche Hashes", () => {
    const r1 = tesseliere({ footprintM: FORMEN.fuenfeck, storeys: 4, typ: "mittelflur", einheiten: STD, raumzonen: true });
    const r2 = tesseliere({ footprintM: FORMEN.fuenfeck, storeys: 4, typ: "mittelflur", einheiten: STD, raumzonen: true });
    assert.equal(hashVon(r1), hashVon(r2));
  });

  it(`${Object.keys(ist).length} Fälle gegen tests/unit/fixtures/tesseliere-golden.json`, () => {
    if (UPDATE || !fs.existsSync(GOLDEN)) {
      fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
      fs.writeFileSync(GOLDEN, `${JSON.stringify({ stand: new Date().toISOString().slice(0, 10), faelle: ist }, null, 2)}\n`);
      if (!UPDATE) assert.fail("Golden-Datei fehlte — angelegt; Lauf wiederholen und committen");
      return;
    }
    const soll = JSON.parse(fs.readFileSync(GOLDEN, "utf8")).faelle;
    const abweichend = Object.keys(ist).filter((k) => !soll[k] || soll[k].hash !== ist[k].hash);
    const neu = Object.keys(ist).filter((k) => !soll[k]);
    assert.deepEqual(abweichend, [], `Golden-Abweichung (bewusst? GOLDEN_UPDATE=1): ${abweichend.map((k) => `${k} [we ${soll[k]?.we ?? "–"}→${ist[k].we}, zonen ${soll[k]?.zonen ?? "–"}→${ist[k].zonen}, riegel ${soll[k]?.riegel ?? "–"}→${ist[k].riegel}]`).join("; ")}`);
    assert.deepEqual(neu, [], "neue Fälle ohne Golden");
  });
});
