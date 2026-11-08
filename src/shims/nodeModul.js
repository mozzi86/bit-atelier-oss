// nodeModul.js — browser stand-in for the Node built-in "node:module" (112-01, foreign review point 4).
//
// Why it exists: the Emscripten loaders of the constraint solver (@salusoft89/planegcs) and of the CSG library (manifold-3d)
// contain `const { createRequire } = await import("node:module")`. Vite cannot bundle a Node built-in for the browser and
// printed "Module "node:module" has been externalized for browser compatibility" on every build. vite.config.js aliases
// "node:module" to this file instead.
//
// Why it is never called: both loaders reach that import only inside `if (ENVIRONMENT_IS_NODE)`, i.e. when
// globalThis.process.versions.node is set — never in a browser, a web worker or the desktop shell's web view. If a future
// version ever took that branch in the bundle, the call fails loudly with a plain-text message instead of a silent
// `undefined is not a function`.
//
// In: nothing. Out: createRequire (throws).

/**
 * Stand-in for node:module's createRequire. Never reached in a browser build (see the file header).
 * @param {string|URL} _url module URL the real function would resolve from (unused)
 * @returns {never}
 * @throws {Error} always, in plain text
 */
export function createRequire(_url) {
  throw new Error(
    "node:module ist im Browser nicht verfügbar — eine Bibliothek hat ihren Node-Zweig betreten (createRequire). " +
      "Das darf im Browser-Bundle nicht passieren; bitte melden (Shim src/shims/nodeModul.js)."
  );
}

export default { createRequire };
