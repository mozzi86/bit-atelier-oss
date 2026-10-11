// 87-06 Zahlen-Smoke: three reference projects with FROZEN numbers along the chain the
// user trusts — IFC import → classified elements → quantities per class → rule-based
// position quantities × unit prices; and the apartment tessellation of the review house.
// A changed sum is red until someone freezes it on purpose (ZAHLEN_UPDATE=1 and a commit
// that says why). Import skips (87-02) must be 0 for every reference model.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { extractFromModel, mapToClassifiedElements } from "@ifc/lib/ifcImport.js";
import { filterQuantity } from "@ava/lib/avaFilters.js";
import { positionsMenge } from "@ava/lib/mengenregeln.js";
import { tesseliere } from "@designer/lib/tesselierung";
import { WERKSTATT_TYPEN } from "@designer/lib/wohnungsTypen";

const require = createRequire(import.meta.url);
const REPO = path.resolve(import.meta.dirname, "../..");
const FIXTURES = path.join(REPO, "tests/unit/fixtures/zahlen-smoke");
const UPDATE = process.env.ZAHLEN_UPDATE === "1";

/** Fixed unit prices for the smoke, EUR per unit [ASSUMED — a smoke needs stable prices, not market ones]. */
const EP = { "Wand Beton": 320, "Decke Beton": 280, "Träger": 1450, "Räume": 1 };
/** Rule positions over the classified elements (art "modell": Σ qty[mengenbasis] of the hits). */
const POSITIONEN = [
  { name: "Wand Beton", regeln: [{ art: "modell", selektor: { was: { ifc_klasse: ["IfcWall", "IfcWallStandardCase"] } }, mengenbasis: "NetVolume" }] },
  { name: "Decke Beton", regeln: [{ art: "modell", selektor: { was: { ifc_klasse: ["IfcSlab"] } }, mengenbasis: "NetVolume" }] },
  { name: "Träger", regeln: [{ art: "modell", selektor: { was: { ifc_klasse: ["IfcBeam"] } }, mengenbasis: "Count" }] },
  { name: "Räume", regeln: [{ art: "modell", selektor: { was: { ifc_klasse: ["IfcSpace"] } }, mengenbasis: "NetFloorArea" }] },
];

const r2 = (v) => Math.round(v * 100) / 100;

let WebIFC;
before(async () => {
  WebIFC = require("web-ifc");
});

/** Numbers of one IFC model: per class count + sums, rule positions × EP, import skips. */
async function zahlenVonIfc(datei) {
  const api = new WebIFC.IfcAPI();
  await api.Init();
  const modelID = api.OpenModel(new Uint8Array(fs.readFileSync(datei)), { COORDINATE_TO_ORIGIN: true });
  assert.ok(modelID >= 0, `web-ifc konnte ${datei} nicht öffnen`);
  try {
    const meta = extractFromModel(api, modelID);
    const elemente = mapToClassifiedElements(meta);
    const klassen = {};
    for (const k of [...new Set(elemente.map((e) => e.ifc_klasse))].sort()) {
      const f = { was: { ifc_klasse: [k] } };
      klassen[k] = {
        anzahl: filterQuantity(elemente, f, "area").treffer,
        area_m2: filterQuantity(elemente, f, "area").menge,
        volume_m3: filterQuantity(elemente, f, "volume").menge,
        length_m: filterQuantity(elemente, f, "length").menge,
      };
    }
    // Raw classified elements, exactly as the AVA hands them to the rule engine (87-06
    // found that class rules hit 0 on them before B-87-08 — this is the guard).
    const positionen = {};
    let kosten = 0;
    for (const p of POSITIONEN) {
      const m = positionsMenge(p.regeln, elemente);
      positionen[p.name] = { menge: r2(m.menge), treffer: m.element_ids?.length ?? null, gp_eur: r2(m.menge * EP[p.name]) };
      kosten += m.menge * EP[p.name];
    }
    return {
      bauteile: meta.kennzahlen.anzahl,
      mit_qty: meta.kennzahlen.mit_qty,
      uebersprungen: meta.kennzahlen.uebersprungen.gesamt,
      klassen,
      positionen,
      kosten_eur: r2(kosten),
    };
  } finally {
    api.CloseModel(modelID);
  }
}

/** Numbers of the review house tessellation (70 × 16 m, 4 storeys, standard mix). */
function zahlenVomTesthaus() {
  const STD = WERKSTATT_TYPEN.filter((t) => t.gruppe === "standard").slice(0, 3);
  const fp = [{ x: -35, z: -8 }, { x: 35, z: -8 }, { x: 35, z: 8 }, { x: -35, z: 8 }];
  const out = {};
  for (const typ of ["mittelflur", "mfh", "spaenner", "laubengang"]) {
    const r = tesseliere({ footprintM: fp, storeys: 4, typ, einheiten: STD, raumzonen: true });
    const flaeche = (z) => Math.abs(z.points.reduce((a, p, k) => { const q = z.points[(k + 1) % z.points.length]; return a + (p.x * q.z - q.x * p.z); }, 0) / 2);
    const we = r.weListe.filter((w) => w.level === 0).length;
    const wohnflaeche = r2(r.zonen.filter((z) => z.we && z.level === 0 && z.raumart !== "balkon").reduce((s, z) => s + flaeche(z), 0));
    out[typ] = { we_eg: we, wohnflaeche_eg_m2: wohnflaeche, rest_m2: r2(r.rest_m2), hinweise: r.hinweise.length };
  }
  return out;
}

function vergleiche(name, ist) {
  const datei = path.join(FIXTURES, `${name}.json`);
  if (UPDATE || !fs.existsSync(datei)) {
    fs.mkdirSync(FIXTURES, { recursive: true });
    fs.writeFileSync(datei, `${JSON.stringify(ist, null, 2)}\n`);
    if (!UPDATE) assert.fail(`Fixture ${datei} fehlte — angelegt; Lauf wiederholen und die Datei committen`);
    return;
  }
  const soll = JSON.parse(fs.readFileSync(datei, "utf8"));
  assert.deepEqual(ist, soll, `${name}: Zahlen weichen von der Fixture ab (bewusst? ZAHLEN_UPDATE=1 und im Commit begründen)`);
}

describe("87-06 — Zahlen-Smoke", () => {
  it("Musterprojekt (public/beispiel/musterprojekt.ifc): Mengen je Klasse, Positionen, Kosten", async () => {
    const ist = await zahlenVonIfc(path.join(REPO, "public/beispiel/musterprojekt.ifc"));
    assert.equal(ist.uebersprungen, 0, "Import hat nichts übersprungen");
    assert.ok(ist.kosten_eur > 0);
    vergleiche("musterprojekt", ist);
  });

  it("Mini-Modell (tests/e2e/fixtures/mini.ifc): drei Bauteile, Zustandszahlen", async () => {
    const ist = await zahlenVonIfc(path.join(REPO, "tests/e2e/fixtures/mini.ifc"));
    assert.equal(ist.uebersprungen, 0);
    assert.equal(ist.bauteile, 3);
    vergleiche("mini", ist);
  });

  it("Review-Testhaus (Tesselierung 70 × 16, 4 Geschosse, Standard-Mix): WE, Wohnfläche, Rest", () => {
    const ist = zahlenVomTesthaus();
    for (const [typ, z] of Object.entries(ist)) assert.ok(z.we_eg > 0 && z.wohnflaeche_eg_m2 > 0, typ);
    vergleiche("testhaus-tesselierung", ist);
  });
});
