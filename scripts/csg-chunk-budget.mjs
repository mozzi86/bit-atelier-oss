#!/usr/bin/env node
// Size gate of the lazy CSG chunk (plan 107-14, review): builds a tiny entry that only lazy-loads the CSG core
// (`csgLaden()`, @core/lib/csg/laden.js) with the repo's own vite.config.js (same manualChunks rule `csg`) and checks the
// gzip size of chunk `csg` against budget.json `grenzen.chunks.csg`; since 107-18 also the raw size of the library's
// WebAssembly binary against `grenzen.assets.manifold`.
//
// Why a separate build: until plan 107-09 calls the core from the app, Rollup emits no `csg` chunk in the real build, and
// scripts/groessen-budget.mjs reports `fehlt chunks.csg` — by design no failure. Without this script a growth of the
// library (since 107-18 manifold-3d, before three-bvh-csg + three-mesh-bvh) could not fail any gate. Here a missing chunk or
// binary IS a failure (the entry always loads the core). groessen-budget checks both in the real build as well; this script
// stays as the cheap check of the library alone.
//
// Usage:  node scripts/csg-chunk-budget.mjs [--budget budget.json]
// Exit:   0 = within budget, 1 = over budget, chunk missing, no limit or build error.
//
// In:  vite.config.js, budget.json. Out: report on stdout; temporary files under node_modules/.cache (removed afterwards).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { groesse, alleDateien, kb } from './groessen.mjs';
import { chunkName } from './groessen-budget.mjs';

/**
 * The verdict for one WebAssembly asset of the measuring build (pure, 107-18). Raw bytes (binaries are not gzipped by
 * groessen.mjs, see groessen-budget.mjs).
 * @param {Array<{rel: string, gz: number|null, roh: number}>} dateien files of the measuring build
 * @param {string} name asset name without hash ("manifold")
 * @param {number|undefined} grenze budget.json grenzen.assets.<name>, bytes
 * @returns {{status: "ok"|"ueber"|"fehlt"|"ohne_grenze", wert: number|null, grenze: number|null}}
 */
export function assetPruefen(dateien, name, grenze) {
  const treffer = dateien.filter((d) => /\.wasm$/.test(d.rel) && chunkName(d.rel) === name);
  const wert = treffer.length ? Math.max(...treffer.map((d) => d.gz ?? d.roh)) : null;
  if (typeof grenze !== 'number') return { status: 'ohne_grenze', wert, grenze: null };
  if (wert == null) return { status: 'fehlt', wert, grenze };
  return { status: wert > grenze ? 'ueber' : 'ok', wert, grenze };
}

/**
 * The verdict for chunk `csg` (pure).
 * @param {Array<{rel: string, gz: number|null, roh: number}>} dateien JS files of the measuring build (gzip bytes)
 * @param {number|undefined} grenze budget.json grenzen.chunks.csg, gzip bytes
 * @returns {{status: "ok"|"ueber"|"fehlt"|"ohne_grenze", wert: number|null, grenze: number|null}}
 */
export function csgChunkPruefen(dateien, grenze) {
  const csg = dateien.filter((d) => /\.m?js$/.test(d.rel) && chunkName(d.rel) === 'csg');
  const wert = csg.length ? Math.max(...csg.map((d) => d.gz ?? d.roh)) : null;
  if (typeof grenze !== 'number') return { status: 'ohne_grenze', wert, grenze: null };
  if (wert == null) return { status: 'fehlt', wert, grenze };
  return { status: wert > grenze ? 'ueber' : 'ok', wert, grenze };
}

async function main() {
  const wurzel = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const i = process.argv.indexOf('--budget');
  const budgetPfad = path.resolve(wurzel, i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : 'budget.json');
  const budget = JSON.parse(fs.readFileSync(budgetPfad, 'utf8'));
  const grenze = budget?.grenzen?.chunks?.csg;
  const wasmGrenze = budget?.grenzen?.assets?.manifold;

  // inside the repo (node_modules is ignored by git and ESLint), so the aliases and node_modules resolve as in the app
  const arbeit = path.join(wurzel, 'node_modules', '.cache', 'csg-chunk-budget');
  const eintrag = path.join(arbeit, 'eintrag.js');
  const out = path.join(arbeit, 'dist');
  fs.mkdirSync(arbeit, { recursive: true });
  fs.writeFileSync(eintrag, 'import { csgLaden } from "@core/lib/csg/laden.js";\nglobalThis.__csgLaden = () => csgLaden();\n');
  try {
    const { build, loadConfigFromFile } = await import('vite');
    const geladen = await loadConfigFromFile({ command: 'build', mode: 'production' }, path.join(wurzel, 'vite.config.js'));
    if (!geladen) throw new Error('vite.config.js could not be loaded');
    const { config } = geladen;
    await build({
      ...config,
      root: wurzel,
      configFile: false,
      logLevel: 'warn',
      plugins: [], // no app plugins (PWA, licence copy …): only the chunk split of rollupOptions.output matters here
      build: { ...config.build, outDir: out, emptyOutDir: true, manifest: false, rollupOptions: { ...config.build?.rollupOptions, input: eintrag } },
    });
    const dateien = alleDateien(out).map((rel) => ({ rel, ...groesse(path.join(out, rel)) }));
    const r = csgChunkPruefen(dateien, grenze);
    for (const d of dateien.filter((x) => /\.m?js$/.test(x.rel))) console.log(`  ${d.rel.padEnd(40)} ${kb(d.roh)} roh, ${d.gz == null ? '—' : kb(d.gz)} gzip`);
    if (r.status === 'ohne_grenze') {
      console.error(`Keine Grenze grenzen.chunks.csg in ${budgetPfad}.`);
      process.exitCode = 1;
    } else if (r.status === 'fehlt') {
      console.error('Chunk csg fehlt im Messbuild — manualChunks-Regel in vite.config.js oder der dynamische Import in csg/laden.js ist gebrochen.');
      process.exitCode = 1;
    } else {
      const marke = r.status === 'ok' ? 'ok   ' : 'ÜBER ';
      console.log(`Größen-Budget csg — gzip:\n  ${marke} chunks.csg ${kb(/** @type {number} */ (r.wert))} / ${kb(/** @type {number} */ (r.grenze))} (${r.wert} B)`);
      if (r.status === 'ueber') {
        console.error('Chunk csg über dem Budget. Bibliotheksversion prüfen; eine Anhebung nur bewusst von Hand in budget.json (im Commit begründen).');
        process.exitCode = 1;
      } else console.log('Im Budget.');
    }
    const w = assetPruefen(dateien, 'manifold', wasmGrenze);
    if (w.status === 'ohne_grenze') {
      console.error(`Keine Grenze grenzen.assets.manifold in ${budgetPfad}.`);
      process.exitCode = 1;
    } else if (w.status === 'fehlt') {
      console.error('WebAssembly-Datei manifold fehlt im Messbuild — der ?url-Import in csg/manifoldWasm.js ist gebrochen.');
      process.exitCode = 1;
    } else {
      console.log(`  ${w.status === 'ok' ? 'ok   ' : 'ÜBER '} assets.manifold ${kb(/** @type {number} */ (w.wert))} / ${kb(/** @type {number} */ (w.grenze))} (${w.wert} B roh)`);
      if (w.status === 'ueber') {
        console.error('WebAssembly-Datei manifold über dem Budget. Bibliotheksversion prüfen; eine Anhebung nur bewusst von Hand.');
        process.exitCode = 1;
      }
    }
  } finally {
    fs.rmSync(arbeit, { recursive: true, force: true });
  }
}

// Run only as a script (the unit test imports the pure function).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`Messbuild csg fehlgeschlagen: ${e?.stack || e}`);
    process.exit(1);
  });
}
