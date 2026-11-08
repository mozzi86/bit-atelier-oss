import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import path from 'path';
import fs from 'fs';

/**
 * Ships the licence notices with every build output. The imprint links
 * `THIRD-PARTY-LICENSES.md`; the LGPL-2.1 solver planegcs requires the licence
 * text itself to travel with the binary (LGPL § 1). Before this plugin the
 * legal text pointed at a file that only existed in the repo - a false
 * statement in the imprint. Files are read at build time from the repo root
 * and node_modules; a missing file fails the build loudly instead of shipping
 * an imprint that lies.
 * @returns {import('vite').Plugin}
 */
function lizenzdateien() {
  const quellen = [
    ['THIRD-PARTY-LICENSES.md', path.resolve(__dirname, 'THIRD-PARTY-LICENSES.md')],
    ['LICENSES/planegcs-LGPL-2.1.txt', path.resolve(__dirname, 'node_modules/@salusoft89/planegcs/LICENSE')],
    // 107-18 (D-BK-08c): the Apache-2.0 text of the CSG library travels with the build (Apache-2.0 § 4 a). The package has
    // no NOTICE file (checked in tests/unit/csg-backend-10718.test.js; a NOTICE in a later version fails that test).
    ['LICENSES/manifold-3d-Apache-2.0.txt', path.resolve(__dirname, 'node_modules/manifold-3d/LICENSE')],
  ];
  return {
    name: 'lizenzdateien',
    apply: 'build',
    generateBundle() {
      for (const [ziel, quelle] of quellen) {
        if (!fs.existsSync(quelle)) {
          throw new Error(`Lizenzdatei fehlt: ${quelle} — Build abgebrochen, sonst verweist das Impressum ins Leere.`);
        }
        this.emitFile({ type: 'asset', fileName: ziel, source: fs.readFileSync(quelle) });
      }
    },
  };
}

/**
 * Links the PWA manifest of the serverless client build `lokal` (70-01) into
 * index.html. Installable is only that build, served under /app/ with its own
 * manifest; the online demo (/demo/) is gone since 83-02 and the office build
 * (server) stays without a manifest.
 *
 * 70-02: the Tauri shell builds the SAME mode with base "/" (build:client). It
 * is not a PWA — without this check WebView2 would request
 * /app/manifest.lokal.webmanifest and log a 404 on every start. So the
 * manifest goes in only when the resolved base is the PWA's base.
 * @param {string} mode Vite build mode
 * @returns {import('vite').Plugin}
 */
function pwaManifest(mode) {
  let gebauteBasis = '/';
  return {
    name: 'pwa-manifest',
    configResolved(config) {
      gebauteBasis = config.base;
    },
    transformIndexHtml(html) {
      const basis = { lokal: '/app/' }[mode];
      if (!basis || gebauteBasis !== basis) return html;
      const datei = 'manifest.lokal.webmanifest';
      return html.replace(
        '</head>',
        [
          `    <link rel="manifest" href="${basis}${datei}" />`,
          '    <meta name="theme-color" content="#0f172a" />',
          `    <link rel="apple-touch-icon" href="${basis}icons/icon-192.png" />`,
          '  </head>',
        ].join('\n'),
      );
    },
  };
}

// 83-02: the app version from package.json, shown in the feedback dialog and in
// Settings › System (packages/nova-core/src/lib/projektInfo.js reads
// __APP_VERSION__). Read at config time — no dependency, no import assertion.
const PAKET_VERSION = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')).version;

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // 112-01: a second dev server (E2E on 5183 beside a running 5173) can use its own dependency cache, e.g.
  // BIT_VITE_CACHE_DIR=node_modules/.vite-e2e — two servers re-optimising ONE node_modules/.vite clear each other's deps
  // (108-08 SUMMARY, "Stolperstein der Umgebung"). Unset: Vite's default, unchanged.
  cacheDir: process.env.BIT_VITE_CACHE_DIR || 'node_modules/.vite',
  define: {
    __APP_VERSION__: JSON.stringify(PAKET_VERSION),
  },
  plugins: [
    react(),
    lizenzdateien(),
    pwaManifest(mode),
  ],
  resolve: {
    // Reihenfolge spezifisch→generisch — Vites matches() greift nur bei
    // id === find oder id.startsWith(find + '/'), '@' schluckt '@core/…' nicht.
    alias: {
      '@core': path.resolve(__dirname, './packages/nova-core/src'),
      '@ifc': path.resolve(__dirname, './packages/nova-ifc-viewer/src'),
      '@ava': path.resolve(__dirname, './packages/nova-ausschreibung/src'),
      '@pdf': path.resolve(__dirname, './packages/nova-pdf/src'),
      '@designer': path.resolve(__dirname, './packages/nova-designer/src'),
      '@sketch': path.resolve(__dirname, './packages/bit-sketch/src'),
      '@': path.resolve(__dirname, './src'),
      // 112-01: the Emscripten loaders of planegcs and manifold-3d import the Node built-in only in their Node branch; the
      // shim replaces Vite's "externalized for browser compatibility" stub and throws in plain text if ever called.
      'node:module': path.resolve(__dirname, './src/shims/nodeModul.js'),
    },
  },
  build: {
    // Für scripts/build-sw.mjs: die Chunk-Liste des Builds (Phase 65-04).
    manifest: true,
    // Große Bibliotheken in eigene Chunks — kleineres Hauptbundle, besseres Caching.
    rollupOptions: {
      output: {
        // Function form, not the object form (Phase 65-01). The object form
        // pulls a library AND every dependency it does not share with another
        // manual chunk into that chunk — which dragged clsx/tailwind-merge into
        // `charts` and the Vite preload helper into `planegcs`. Both are used by
        // the shell, so both chunks ended up on the start path and were
        // module-preloaded even though no start route needs recharts or the
        // constraint solver. Matching on node_modules paths keeps each heavy
        // library in its own chunk and leaves shared utilities where Rollup puts
        // them (a small common chunk next to the entry).
        manualChunks(id) {
          // Vite's virtual preload helper is needed by every chunk that has a
          // dynamic import. Left unassigned it gets folded into whichever manual
          // chunk claims it first — it landed in `planegcs`, which made the LGPL
          // solver a static import of the entry. It belongs in vendor.
          if (id.includes('vite/preload-helper')) return 'vendor';
          if (!id.includes('node_modules')) return undefined;
          const p = id.replace(/\\/g, '/');
          // 107-14/107-18 (D-BK-08c): the JS part of the CSG library (manifold-3d) gets its own chunk. Only the lazily loaded
          // csg/kern.js imports it, so the chunk is never on the start path and is measured on its own (budget.json
          // chunks.csg); its WebAssembly binary is a separate asset (budget.json assets.manifold).
          if (p.includes('/node_modules/manifold-3d/')) return 'csg';
          // 110-05: glTF exporter (BIM studio writes the client's 3D file) and loader (client portal viewer) are reached only by
          // dynamic imports; in the shared `three` chunk they would ride along on every 3D page (budget chunks.three).
          if (/\/node_modules\/three\/examples\/jsm\/(exporters\/GLTFExporter|loaders\/GLTFLoader)\.js$/.test(p)) return 'three-gltf';
          if (p.includes('/node_modules/three/') || p.includes('three-stdlib')) return 'three';
          if (p.includes('/node_modules/recharts/') || p.includes('victory-vendor') || /\/node_modules\/d3-/.test(p)) return 'charts';
          if (p.includes('/node_modules/maplibre-gl/')) return 'map';
          if (p.includes('/node_modules/framer-motion/')) return 'motion';
          // 112-01: pdf-lib in its own chunk. It is imported statically by the PDF tools (nova-pdf, VHB form, check
          // stamp, vector plan) and dynamically by zeigen/planStandLaden.js; without a chunk of its own Rollup put it next to
          // that dynamic importer and Vite warned "dynamic import will not move module into another chunk".
          if (p.includes('/node_modules/pdf-lib/') || p.includes('/node_modules/@pdf-lib/')) return 'pdflib';
          // LGPL-Compliance: planegcs (LGPL-2.1+) als eigener, austauschbarer
          // Chunk — nie ins App-Bundle mischen (siehe THIRD-PARTY-LICENSES.md).
          if (p.includes('planegcs')) return 'planegcs';
          // web-ifc carries the generated IFC schema tables — by far the largest
          // text block in the bundle. Its own chunk keeps it off the start path;
          // only BIM viewer, IFC viewer, model versions and the check suite pull it.
          if (p.includes('/node_modules/web-ifc/')) return 'ifc';
          // The shell's own vendor set. These must be named explicitly: they are
          // shared between the shell and heavy libraries (recharts uses clsx),
          // and an unassigned shared module gets folded into whichever manual
          // chunk also reaches it — which is exactly how `charts` and `planegcs`
          // ended up as static imports of the entry. Naming them keeps them in
          // vendor, where the shell can reach them without dragging a feature
          // chunk along. lucide-react belongs here too, otherwise every icon
          // becomes its own ~300-byte chunk.
          if (/\/node_modules\/(react|react-dom|react-router|react-router-dom|scheduler|clsx|tailwind-merge|class-variance-authority|lucide-react|sonner|@radix-ui|@tanstack)\//.test(p)) return 'vendor';
          return undefined;
        },
      },
    },
    chunkSizeWarningLimit: 900,
  },
  // 107-14/107-18: pre-bundle the CSG library at dev start. It is reached only through a dynamic import (csg/laden.js), so the
  // optimizer would discover it on first use and reload the page. Its WebAssembly binary is not part of the pre-bundle: the
  // URL comes from csg/manifoldWasm.js (`?url`). Dev server only — the build is unaffected.
  // 110-05: same for the glTF exporter/loader (client 3D file, "3D ansehen") — found on first use, the reload threw away the
  // click (E2E bauherrenzugang-110-03).
  optimizeDeps: { include: ['manifold-3d', 'three/examples/jsm/exporters/GLTFExporter.js', 'three/examples/jsm/loaders/GLTFLoader.js'] },
  // 69-21: the IFC reading worker imports the WASM bootstrap dynamically (code splitting) —
  // only the ES worker format supports that.
  worker: { format: 'es' },
  server: {
    // PORT env lets a second dev instance (e.g. the Browser pane of a parallel
    // session) run beside the default 5173 without editing this file.
    port: Number(process.env.PORT) || 5173,
    // Pre-transform the lazy page chunks at start (22.10.2026): under the full E2E load the first
    // visit of a page waited several seconds for the on-demand compile and random specs ran into
    // their 5-s / 30-s limits. Dev server only — the build is unaffected.
    warmup: { clientFiles: ['./src/pages/*.jsx', './packages/*/src/pages/*.jsx'] },
    proxy: {
      // Forward API calls to the local Express backend (see /server).
      '/api': {
        // API_PORT moves the backend too (E2E beside a running local install on 3001).
        target: `http://localhost:${Number(process.env.API_PORT) || 3001}`,
        changeOrigin: true,
      },
    },
  },
}));
