// 108-01 review: renders React components of the app to a static HTML string inside `node --test`. The test runner has no JSX loader,
// so the module graph is loaded through vite's ssrLoadModule (vite is a direct devDependency; no new package) with the same aliases as
// vite.config.js and the automatic JSX runtime. Used for byte snapshots of screen drawings (BimPlan2D section) against a golden.
//
// In:  module paths relative to the repo root ("/packages/…/X.jsx"). Out: jsxUmgebung() → { laden(pfad) (the loaded module),
//      rendern(Komponente, props) (renderToStaticMarkup), schliessen() }; mitJsx(fn) wraps it and closes the vite server afterwards.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".."); // tests/unit/helpers → repo root

/**
 * Starts a vite server in middleware mode (no port, no file watcher) for SSR module loading.
 * @returns {Promise<{laden: (pfad: string) => Promise<any>, rendern: (komponente: any, props: Record<string, any>) => string, schliessen: () => Promise<void>}>}
 */
export async function jsxUmgebung() {
  const server = await createServer({
    configFile: false, root: ROOT, logLevel: "error", appType: "custom",
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    esbuild: { jsx: "automatic" },
    // must match vite.config.js resolve.alias (specific before generic)
    resolve: { alias: {
      "@core": path.join(ROOT, "packages/nova-core/src"), "@ifc": path.join(ROOT, "packages/nova-ifc-viewer/src"),
      "@ava": path.join(ROOT, "packages/nova-ausschreibung/src"), "@pdf": path.join(ROOT, "packages/nova-pdf/src"),
      "@designer": path.join(ROOT, "packages/nova-designer/src"), "@sketch": path.join(ROOT, "packages/bit-sketch/src"),
      "@": path.join(ROOT, "src"),
    } },
  });
  return {
    laden: (pfad) => server.ssrLoadModule(pfad),
    rendern: (komponente, props) => renderToStaticMarkup(React.createElement(komponente, props)),
    schliessen: () => server.close(),
  };
}

/**
 * @template T
 * @param {(werkzeug: {laden: (pfad: string) => Promise<any>, rendern: (komponente: any, props: Record<string, any>) => string}) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function mitJsx(fn) {
  const u = await jsxUmgebung();
  try {
    return await fn(u);
  } finally {
    await u.schliessen();
  }
}
