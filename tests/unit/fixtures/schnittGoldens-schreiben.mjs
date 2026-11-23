// Regenerates the golden files of the building SECTION without a roof form (115-02):
//   vektorplan-10801-vorher.json  — keys schnitt / schnittAttika / schnittOhneUg (schnittGrafik primitives); the floor-plan keys stay
//   schnitt-bild-10801-vorher.json — the screen section (BimPlan2D mode "schnitt", server-side rendered) of fixtures/schnitt-bild-10801.js
// with exactly the calls of the comparing test (efh-kleinbefunde-10801.test.js). Run it ONLY after a deliberate change of the section
// drawing and say why in the commit (first use: 115-02, height chains and level marks from schnittMasse.js, decimal comma). The script
// prints per case which layers / how many characters changed, so a change outside the intended layers is seen at once. The tests stay
// the judge — run `npm run test:unit` afterwards.
//
// Run from the repo root: node --import ./tests/alias-register.mjs tests/unit/fixtures/schnittGoldens-schreiben.mjs
// In: nothing. Out: the two golden files rewritten; one line per case on stdout.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { schnittGrafik } from "@designer/lib/vektorPlan";
import { jsxUmgebung } from "../helpers/jsxRender.mjs";
import { efhModell } from "./efh-108.js";

const pfad = (/** @type {string} */ name) => fileURLToPath(new URL(`./${name}`, import.meta.url));

// ---- PDF section primitives -------------------------------------------------------------------------------------------------
const VEKTOR = "vektorplan-10801-vorher.json";
const vektor = JSON.parse(readFileSync(pfad(VEKTOR), "utf8"));
const model = efhModell();
/** @type {Record<string, any>} the calls of the test "PDF-Schnitt ohne Dach …" */
const neu = {
  schnitt: schnittGrafik({ model, storeyHeight: 2.9, massstab: 100 }),
  schnittAttika: schnittGrafik({ model: efhModell({ parapet: { enabled: true, height: 1 } }), storeyHeight: 2.9, massstab: 50 }),
  schnittOhneUg: schnittGrafik({ model: efhModell({ untergeschosse: 0, geschosse: null }), storeyHeight: 3, massstab: 100 }),
};
for (const [name, g] of Object.entries(neu)) {
  const alt = vektor[name];
  // elements per layer as text: a layer is "changed" when its elements differ in content or order
  const jeEbene = (/** @type {any} */ gr) => {
    /** @type {Record<string, string[]>} */
    const m = {};
    for (const e of gr?.elemente || []) (m[e.ebene || "-"] ||= []).push(JSON.stringify(e));
    return m;
  };
  const a = jeEbene(alt), n = jeEbene(g);
  const geaendert = [...new Set([...Object.keys(a), ...Object.keys(n)])].filter((eb) => JSON.stringify(a[eb] || []) !== JSON.stringify(n[eb] || [])).sort();
  console.log(`${JSON.stringify(alt) === JSON.stringify(g) ? "unverändert" : "geschrieben"}  ${VEKTOR} · ${name}: geänderte Ebenen [${geaendert.join(", ")}]${JSON.stringify(alt?.bbox) === JSON.stringify(g.bbox) ? "" : ", bbox"}`);
  vektor[name] = g;
}
writeFileSync(pfad(VEKTOR), JSON.stringify(vektor), "utf8");

// ---- screen section (JSX through vite, as the test) ---------------------------------------------------------------------------
const BILD = "schnitt-bild-10801-vorher.json";
const bildAlt = JSON.parse(readFileSync(pfad(BILD), "utf8"));
const u = await jsxUmgebung();
try {
  const BimPlan2D = (await u.laden("/packages/nova-designer/src/components/BimPlan2D.jsx")).default;
  const { createBuildingModel } = await u.laden("/packages/nova-core/src/lib/buildingModel.js");
  const { SCHNITT_FAELLE } = await u.laden("/tests/unit/fixtures/schnitt-bild-10801.js");
  /** @type {Record<string, string>} */
  const bild = {};
  for (const [name, props] of Object.entries(SCHNITT_FAELLE(createBuildingModel))) {
    bild[name] = u.rendern(BimPlan2D, /** @type {Record<string, any>} */ (props));
    console.log(`${bildAlt[name] === bild[name] ? "unverändert" : "geschrieben"}  ${BILD} · ${name}: ${(bildAlt[name] || "").length} → ${bild[name].length} Zeichen`);
  }
  writeFileSync(pfad(BILD), `${JSON.stringify(bild, null, 1)}\n`, "utf8");
} finally {
  await u.schliessen();
}
