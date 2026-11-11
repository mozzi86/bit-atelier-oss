// 114-02: writes the IFC export of the catalogue example model (ifcKatalogModell-11402.js) to a file, plus a JSON sidecar with the drawn
// walls (a, b, refLine; same order as the IfcWall entities in the file) — the input of the harness cross-check
// harness/tests/test_app_ifc_export.py, which reads the file with ifcopenshell (WHERE rules, types, GUIDs, layer side).
//
// Run from the repo root: node --import ./tests/alias-register.mjs tests/unit/fixtures/ifcKatalogExport-11402.mjs <out.ifc>
// Variant "kombi" (argv[3]): the mixed model ifcKatalogKombi-11402.js (catalogue types + gable walls + stair opening + dormer).
// In: argv[2] = path of the IFC file to write (the sidecar is <out.ifc>.json), argv[3] = optional "kombi". Out: the two files; exit 1 with the reason on error,
// exit 2 when the export reported a warning (the example model must export without any).
import { writeFileSync } from "node:fs";
import { exportIFCMitKatalog } from "@designer/lib/ifcExport";
import { ifcKatalogSzenario } from "./ifcKatalogModell-11402.js";
import { ifcKombiSzenario } from "./ifcKatalogKombi-11402.js";

const ziel = process.argv[2];
if (!ziel) {
  console.error("Aufruf: node --import ./tests/alias-register.mjs tests/unit/fixtures/ifcKatalogExport-11402.mjs <ziel.ifc>");
  process.exit(1);
}
const { model, opts } = process.argv[3] === "kombi" ? ifcKombiSzenario() : ifcKatalogSzenario();
/** @type {Array<{msg: string, art?: string}>} */
const meldungen = [];
const text = await exportIFCMitKatalog(model, { ...opts, onWarn: (msg, art) => meldungen.push({ msg, art }) });
writeFileSync(ziel, text, "utf8");
writeFileSync(`${ziel}.json`, JSON.stringify({ waende: opts.customWalls.map((w) => ({ a: w.a, b: w.b, refLine: w.refLine || "center", katalog_typ: w.katalog_typ })) }, null, 1), "utf8");
if (meldungen.length) {
  console.error(`Export meldet ${meldungen.length} Warnung(en): ${meldungen.map((m) => `[${m.art}] ${m.msg}`).join(" | ")}`);
  process.exit(2);
}
