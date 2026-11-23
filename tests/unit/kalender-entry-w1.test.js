// Wave 1 (B-81-04), size budget: the holiday tables of the 16 federal states
// must not sit in the entry chunk. Before this fix the entry reached
// packages/nova-core/src/lib/kalender/feiertage.js statically on two ways:
//   Layout → useFaelligZaehler → quellenRegistry → quellen/steuer → steuertermine → feiertage
//   Layout → useFaelligZaehler → settings/regelwerke → abwesenheit/kalenderRegeln → feiertage
// and the entry grew by 0.7 KB (gzip) with the 16-state table.
//
// The build is measured by scripts/groessen-budget.mjs; this test guards the
// source cause: it walks the STATIC imports from src/main.jsx (dynamic
// import() is not followed — it is a lazy chunk) and fails when the holiday
// module is reachable. The walk is a plain text scan of import/export-from
// lines with the five Vite aliases; good enough for this repo's import style.
//
// In:  source files under the repo root. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Vite aliases (vite.config.js), longest first so "@core" wins over "@". */
const ALIAS = [
  ["@designer", "packages/nova-designer/src"], ["@core", "packages/nova-core/src"], ["@ifc", "packages/nova-ifc-viewer/src"],
  ["@ava", "packages/nova-ausschreibung/src"], ["@pdf", "packages/nova-pdf/src"], ["@", "src"],
];

/**
 * @param {string} von importing file (absolute)
 * @param {string} spez import specifier
 * @returns {string|null} absolute path of a repo source file, null for packages/unknown
 */
function aufloesen(von, spez) {
  let basis = null;
  if (spez.startsWith(".")) basis = path.resolve(path.dirname(von), spez);
  else {
    const treffer = ALIAS.find(([a]) => spez === a || spez.startsWith(a + "/"));
    if (treffer) basis = path.join(WURZEL, treffer[1], spez.slice(treffer[0].length));
  }
  if (!basis) return null;
  for (const k of [basis, basis + ".js", basis + ".jsx", path.join(basis, "index.js"), path.join(basis, "index.jsx")]) {
    if (fs.existsSync(k) && fs.statSync(k).isFile()) return k;
  }
  return null;
}

/**
 * Static import graph from src/main.jsx: file → the file that first imported it.
 * @returns {Map<string, string|null>}
 */
function statischErreichbar() {
  const start = path.join(WURZEL, "src/main.jsx");
  const vorher = new Map([[start, null]]);
  const offen = [start];
  while (offen.length) {
    const datei = /** @type {string} */ (offen.shift());
    const text = fs.readFileSync(datei, "utf8");
    for (const m of text.matchAll(/^\s*(?:import|export)\s[^;]*?\sfrom\s+["']([^"']+)["']|^\s*import\s+["']([^"']+)["']/gm)) {
      const ziel = aufloesen(datei, m[1] || m[2]);
      if (ziel && !vorher.has(ziel)) { vorher.set(ziel, datei); offen.push(ziel); }
    }
  }
  return vorher;
}

/**
 * @param {Map<string, string|null>} graph
 * @param {string} datei absolute path
 * @returns {string} import chain from main.jsx, repo-relative
 */
function kette(graph, datei) {
  const teile = [];
  for (let d = /** @type {string|null|undefined} */ (datei); d; d = graph.get(d)) teile.unshift(path.relative(WURZEL, d));
  return teile.join(" → ");
}

test("entry chunk: the 16-state holiday tables are not statically reachable from src/main.jsx", () => {
  const graph = statischErreichbar();
  assert.ok(graph.size > 50, `import walk found only ${graph.size} files — scanner broken?`);
  const feiertage = path.join(WURZEL, "packages/nova-core/src/lib/kalender/feiertage.js");
  assert.equal(graph.has(feiertage), false, `entry reaches the holiday tables: ${graph.has(feiertage) ? kette(graph, feiertage) : ""}`);
});

test("entry chunk: the rule registry gets the state codes from the table-free module", () => {
  const graph = statischErreichbar();
  assert.ok(graph.has(path.join(WURZEL, "src/lib/abwesenheit/kalenderRegeln.js")), "kalenderRegeln.js is expected in the entry (rule registry)");
  assert.ok(graph.has(path.join(WURZEL, "packages/nova-core/src/lib/kalender/bundeslaender.js")));
});
