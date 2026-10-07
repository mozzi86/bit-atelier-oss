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

// 83-02: the app version from package.json, shown in the feedback dialog and in
// Settings › System (packages/nova-core/src/lib/projektInfo.js reads
// __APP_VERSION__). Read at config time — no dependency, no import assertion.
const PAKET_VERSION = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')).version;

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  define: {
    __APP_VERSION__: JSON.stringify(PAKET_VERSION),
  },
  plugins: [
    react(),
    lizenzdateien(),
    // Installierbar ist der serverlose Client-Build `lokal` (70-01) mit seinem
    // eigenen Manifest. Die Online-Demo (/demo/, eigenes Manifest) ist seit
    // 83-02 entfernt. Der Bürobetrieb (Server-Build) bleibt ohne Manifest.
    {
      name: 'pwa-manifest',
      transformIndexHtml(html) {
        const basis = { lokal: '/app/' }[mode];
        if (!basis) return html;
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
    },
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
          if (p.includes('/node_modules/three/') || p.includes('three-stdlib')) return 'three';
          if (p.includes('/node_modules/recharts/') || p.includes('victory-vendor') || /\/node_modules\/d3-/.test(p)) return 'charts';
          if (p.includes('/node_modules/maplibre-gl/')) return 'map';
          if (p.includes('/node_modules/framer-motion/')) return 'motion';
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
  server: {
    // PORT env lets a second dev instance (e.g. the Browser pane of a parallel
    // session) run beside the default 5173 without editing this file.
    port: Number(process.env.PORT) || 5173,
    proxy: {
      // Forward API calls to the local Express backend (see /server).
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
}));
