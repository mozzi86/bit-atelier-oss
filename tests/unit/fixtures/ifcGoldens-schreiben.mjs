// Regenerates the IFC golden files of phases 107/108 (tests/unit/fixtures/ifc-golden-*.ifc) with exactly the scenario and options
// the comparing tests use. Run it ONLY after a deliberate change of the export text, and say why in the commit (first use:
// B-114-02-01, spaces aggregated under their storey). The tests themselves stay the judge — run `npm run test:unit` afterwards.
//
// Run from the repo root: node --import ./tests/alias-register.mjs tests/unit/fixtures/ifcGoldens-schreiben.mjs
// In: nothing. Out: the ten golden files rewritten; prints one line per file (unchanged / rewritten).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { exportIFC } from "@designer/lib/ifcExport";
import { setzeProjektAufbauten } from "@core/lib/bauteil/aufbauten.js";
import { verschneidungsWaende, modellBaender } from "@core/lib/bauteil/verschneidung.js";
import { ifcGoldenSzenario } from "./ifcGoldenModell-107.js";
import { ifcReflinieSzenario } from "./ifcReflinieModell-10701.js";
import { ifcOeffnungSzenario } from "./ifcOeffnungModell-10704.js";
import { ifcLoecherSzenario } from "./ifcLoecherModell-10705.js";
import { ifcKoerperOeffnungSzenario } from "./ifcKoerperOeffnungModell-10706.js";
import { ifcInstanzSzenario } from "./ifcInstanzModell-10708.js";
import { ifcVerschneidungSzenario } from "./ifcVerschneidungModell-10709.js";
import { ifcUgSzenario } from "./ifcUgModell-10713.js";
import { ifcKniestockSzenario } from "./ifcKniestockModell-10802.js";
import { ifcAufbauSzenario } from "./ifcAufbauModell-10703.js";

/** Writes one golden and reports whether its text changed. */
function schreibe(/** @type {string} */ name, /** @type {string} */ text) {
  const pfad = fileURLToPath(new URL(`./${name}`, import.meta.url));
  let alt = null;
  try { alt = readFileSync(pfad, "utf8"); } catch { /* new golden */ }
  if (alt === text) { console.log(`unverändert  ${name}`); return; }
  writeFileSync(pfad, text, "utf8");
  console.log(`geschrieben  ${name}`);
}

setzeProjektAufbauten(null);
{ const { model, ohne, mit } = ifcGoldenSzenario(); schreibe("ifc-golden-107.ifc", exportIFC(model, ohne)); schreibe("ifc-golden-107-steckbrief.ifc", exportIFC(model, mit)); }
{ const { model, opts } = ifcReflinieSzenario(); schreibe("ifc-golden-107-reflinie.ifc", exportIFC(model, opts)); }
{ const { model, opts } = ifcOeffnungSzenario(); schreibe("ifc-golden-107-oeffnung.ifc", exportIFC(model, opts)); }
{ const { model, opts } = ifcLoecherSzenario(); schreibe("ifc-golden-107-loecher.ifc", exportIFC(model, opts)); }
{ const { model, opts } = ifcKoerperOeffnungSzenario(); schreibe("ifc-golden-107-koerperoeffnung.ifc", exportIFC(model, { ...opts, onWarn: () => {} })); }
{ const { model, opts } = ifcInstanzSzenario(); schreibe("ifc-golden-107-instanz.ifc", exportIFC(model, opts)); }
{
  const { model, opts } = ifcVerschneidungSzenario();
  const mb = modellBaender(verschneidungsWaende(model, opts.customWalls, { geschosse: 3 }), { geschosse: 3 });
  schreibe("ifc-golden-107-verschneidung.ifc", exportIFC(model, { ...opts, verschneidung: { jeSchluessel: mb.jeSchluessel }, onWarn: () => {} }));
}
{ const { model, optionen } = ifcUgSzenario(); schreibe("ifc-golden-107-13-ug.ifc", exportIFC(model, optionen)); }
{ const { model, optionen } = ifcKniestockSzenario(); schreibe("ifc-golden-108-02-kniestock.ifc", exportIFC(model, optionen)); }
// last: this scenario sets the project build-ups (module state)
{ const { model, opts, AUFBAUTEN_LAYER } = ifcAufbauSzenario(); setzeProjektAufbauten(AUFBAUTEN_LAYER); schreibe("ifc-golden-107-aufbau.ifc", exportIFC(model, opts)); setzeProjektAufbauten(null); }
