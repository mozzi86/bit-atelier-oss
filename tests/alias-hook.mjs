// Node-Loader-Hook: löst die Vite-Aliase aus vite.config.js für `node --test` auf.
//
// Warum ein Loader-Hook und nicht die `imports`-Map der package.json?
// Node-Subpath-Imports müssen mit "#" beginnen ("#core/…"); die im Repo
// verwendeten Aliase heißen "@core/…" / "@designer/…". Eine imports-Map hätte
// also eine Umbenennung in den Produktivdateien erfordert — genau das soll hier
// NICHT passieren. Relative Imports in den Tests wären möglich, würden aber die
// aliasierten Imports INNERHALB der Libs (compliance.js -> "@designer/lib/…")
// nicht auflösen. Der Hook ist damit die einzige Variante, die ohne Änderung
// an Produktivcode funktioniert.
//
// Registriert wird er über tests/alias-register.mjs (`node --import`).
//
// Redirects of bare package specifiers (none at the moment). 107-14 redirected "three-bvh-csg" to its ESM source here;
// 107-18 replaced that library with manifold-3d, which is an ES module with an `exports` map and needs no redirect.
/** @type {Record<string, string>} bare specifier → file relative to the repo root */
const UMLEITUNGEN = {};

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

// tests/ -> Repo-Wurzel
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Muss mit vite.config.js `resolve.alias` übereinstimmen.
const ALIASES = {
  "@core/": "packages/nova-core/src/",
  "@ifc/": "packages/nova-ifc-viewer/src/",
  "@ava/": "packages/nova-ausschreibung/src/",
  "@pdf/": "packages/nova-pdf/src/",
  "@designer/": "packages/nova-designer/src/",
  "@sketch/": "packages/bit-sketch/src/",
  "@/": "src/",
};

const EXTENSIONS = ["", ".js", ".jsx", ".mjs", "/index.js", "/index.jsx"];

export async function resolve(specifier, context, nextResolve) {
  if (Object.prototype.hasOwnProperty.call(UMLEITUNGEN, specifier)) {
    return nextResolve(pathToFileURL(path.join(ROOT, UMLEITUNGEN[specifier])).href, context);
  }
  for (const [prefix, target] of Object.entries(ALIASES)) {
    if (!specifier.startsWith(prefix)) continue;
    const base = path.join(ROOT, target, specifier.slice(prefix.length));
    for (const ext of EXTENSIONS) {
      const url = pathToFileURL(base + ext).href;
      try {
        return await nextResolve(url, context);
      } catch {
        // nächste Endung probieren
      }
    }
    throw new Error(`Alias "${specifier}" nicht auflösbar (geprüft: ${base}{${EXTENSIONS.join(",")}})`);
  }
  if (specifier.endsWith(".json")) {
    // Node 22 rejects a JSON import without an import attribute. The app sources
    // stay plain `import x from "./datei.json"` so ESLint and Vite keep parsing
    // them; this hook serves the JSON as a default export for the unit tests.
    const url = new URL(specifier, context.parentURL).href;
    return { url, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

/**
 * @param {string} url
 * @param {object} context
 * @param {(url: string, context: object) => Promise<any>} nextLoad
 */
export async function load(url, context, nextLoad) {
  if (url.endsWith(".json")) {
    const source = `export default ${readFileSync(fileURLToPath(url), "utf8")}`;
    return { format: "module", source, shortCircuit: true };
  }
  return nextLoad(url, context);
}
