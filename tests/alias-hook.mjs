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
  return nextResolve(specifier, context);
}
