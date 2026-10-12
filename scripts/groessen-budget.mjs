#!/usr/bin/env node
// Size budget of the client build (plan 93-09, lever 164): fails when a build grows beyond budget.json.
//
// Why: scripts/groessen.mjs has measured builds since 65-03, but only build-cloud printed the numbers —
// nobody had to look at them, so a 300 KB library pulled onto the start path would only be noticed by a
// user on a slow line. This script turns the measurement into a gate: CI runs it right after the build.
//
// What is measured (all gzip bytes, the transfer size a browser actually loads; images/fonts raw):
//   entry        the entry script of index.html
//   css          every stylesheet the entry loads (its own + those of statically imported chunks)
//   vendor       the shell's vendor chunk (vite.config.js manualChunks "vendor")
//   erste_runde  everything index.html loads before the first paint (groessen.mjs erstePaintGz)
//   route_max    the largest "sum before a route": entry closure ∪ route chunk closure (JS + CSS) over every
//                lazily loaded page (dynamic entries below a pages/ folder, from dist/.vite/manifest.json)
//   chunks.<n>   each named manual chunk (three, charts, map, motion, planegcs, ifc, …)
//   chunk_max    the largest JS chunk that has no limit of its own
//   gesamt       all files of dist/ together
// Limits live in budget.json (repo root, unit "Byte (gzip)"). `--schreiben` sets them to today's
// measurement plus the buffer (puffer_prozent, rounded UP to whole KB) — only after a deliberate decision
// that the growth is worth it; the commit then shows the raise.
//
// Usage:  node scripts/groessen-budget.mjs [--dist dist] [--budget budget.json] [--schreiben]
// Exit:   0 = within budget, 1 = over budget or no build, 2 = usage error.
//
// In:  dist/ (after `vite build`), budget.json. Out: report on stdout; budget.json only with --schreiben.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { kb, messeBuild } from './groessen.mjs';

/** Default buffer on top of a measured value, percent. [ASSUMED] 10 % ≈ one mid-sized feature per release. */
export const STANDARD_PUFFER_PROZENT = 10;

/**
 * Chunk name of a build file: the file name without folder, extension and Vite's content hash
 * ("assets/vendor-BkUj3_4a.js" → "vendor", "assets/foo-bar-12345678.css" → "foo-bar").
 * @param {string} rel path relative to dist/
 * @returns {string}
 */
export function chunkName(rel) {
  const datei = rel.split('/').pop() || rel;
  const ohneEndung = datei.replace(/\.[^.]+$/, '');
  return ohneEndung.replace(/-[A-Za-z0-9_-]{8}$/, '');
}

/**
 * Every file a manifest entry pulls in statically (its own file, its static imports recursively, and
 * all their CSS). Dynamic imports are not followed — they load later.
 * @param {Record<string, {file: string, imports?: string[], css?: string[]}>} manifest dist/.vite/manifest.json
 * @param {string} schluessel manifest key
 * @param {Set<string>} [dateien] accumulator
 * @returns {Set<string>} paths relative to dist/
 */
export function statischeHuelle(manifest, schluessel, dateien = new Set()) {
  const e = manifest[schluessel];
  if (!e || dateien.has(e.file)) return dateien;
  dateien.add(e.file);
  for (const css of e.css || []) dateien.add(css);
  for (const imp of e.imports || []) statischeHuelle(manifest, imp, dateien);
  return dateien;
}

/**
 * The measured values of a build.
 * @param {{zeilen: Array<{rel: string, roh: number, gz: number|null}>, gesamtGz: number, erstePaintGz: number}} messung
 *   result of groessen.mjs messeBuild()
 * @param {Record<string, {file: string, src?: string, name?: string, isEntry?: boolean, isDynamicEntry?: boolean, imports?: string[], css?: string[]}>} manifest
 * @returns {{
 *   entry: number, css: number, vendor: number|null, erste_runde: number, route_max: number, route_max_name: string,
 *   routen: Record<string, number>, chunks: Record<string, number>, gesamt: number,
 * }} gzip bytes; `routen` = sum before each route; `chunks` = every JS chunk by name (largest file if a name repeats)
 */
export function messwerteAus(messung, manifest) {
  const gz = new Map(messung.zeilen.map((z) => [z.rel, z.gz ?? z.roh]));
  const summe = (dateien) => [...dateien].reduce((n, rel) => n + (gz.get(rel) ?? 0), 0);
  const entryKey = Object.keys(manifest).find((k) => manifest[k].isEntry && /index\.html$/.test(k))
    || Object.keys(manifest).find((k) => manifest[k].isEntry);
  if (!entryKey) throw new Error('Kein Einstiegspunkt im Vite-Manifest gefunden (build.manifest: true?).');
  const entryHuelle = statischeHuelle(manifest, entryKey);
  const entryDatei = manifest[entryKey].file;

  /** @type {Record<string, number>} */
  const routen = {};
  for (const [k, e] of Object.entries(manifest)) {
    if (!e.isDynamicEntry || !/(^|\/)pages\//.test(e.src || k)) continue;
    routen[e.src || k] = summe(statischeHuelle(manifest, k, new Set(entryHuelle)));
  }
  let routeMaxName = '';
  let routeMax = 0;
  for (const [name, wert] of Object.entries(routen)) if (wert > routeMax) { routeMax = wert; routeMaxName = name; }

  /** @type {Record<string, number>} */
  const chunks = {};
  for (const z of messung.zeilen) {
    if (!/\.m?js$/.test(z.rel)) continue;
    const n = chunkName(z.rel);
    chunks[n] = Math.max(chunks[n] ?? 0, z.gz ?? z.roh);
  }
  const vendorDatei = messung.zeilen.find((z) => /\.m?js$/.test(z.rel) && chunkName(z.rel) === 'vendor');

  return {
    entry: gz.get(entryDatei) ?? 0,
    css: summe([...entryHuelle].filter((rel) => rel.endsWith('.css'))),
    vendor: vendorDatei ? vendorDatei.gz ?? vendorDatei.roh : null,
    erste_runde: messung.erstePaintGz,
    route_max: routeMax,
    route_max_name: routeMaxName,
    routen,
    chunks,
    gesamt: messung.gesamtGz,
  };
}

/**
 * Limits of budget.json.
 * @typedef {{entry?: number, css?: number, vendor?: number, erste_runde?: number, route_max?: number,
 *   chunk_max?: number, gesamt?: number, chunks?: Record<string, number>}} Grenzen
 */

/**
 * One compared value.
 * @typedef {{schluessel: string, wert: number|null, grenze: number, status: "ok"|"ueber"|"fehlt"}} Vergleich
 */

/**
 * Compares the measured values with the limits (pure). A named chunk with a limit that no longer exists is
 * "fehlt" — reported, but no failure (a removed chunk is shrinkage; update the budget). `chunk_max` applies to
 * every JS chunk that has no own limit (keyed "chunk:<name>" in the result).
 * @param {ReturnType<typeof messwerteAus>} werte
 * @param {Grenzen} grenzen gzip bytes
 * @returns {{vergleiche: Vergleich[], ueber: Vergleich[]}}
 */
export function pruefeBudget(werte, grenzen) {
  /** @type {Vergleich[]} */
  const vergleiche = [];
  const vergleiche1 = (schluessel, wert, grenze) => {
    if (typeof grenze !== 'number') return;
    vergleiche.push({ schluessel, wert, grenze, status: wert == null ? 'fehlt' : wert > grenze ? 'ueber' : 'ok' });
  };
  for (const k of /** @type {const} */ (['entry', 'css', 'vendor', 'erste_runde', 'route_max', 'gesamt'])) vergleiche1(k, werte[k], grenzen[k]);
  const eigene = grenzen.chunks || {};
  for (const [name, grenze] of Object.entries(eigene)) vergleiche1(`chunks.${name}`, werte.chunks[name] ?? null, grenze);
  if (typeof grenzen.chunk_max === 'number') {
    for (const [name, wert] of Object.entries(werte.chunks)) {
      if (Object.prototype.hasOwnProperty.call(eigene, name) || name === 'vendor') continue;
      if (wert > grenzen.chunk_max) vergleiche.push({ schluessel: `chunk:${name}`, wert, grenze: grenzen.chunk_max, status: 'ueber' });
    }
    const groesster = Object.entries(werte.chunks)
      .filter(([name]) => !Object.prototype.hasOwnProperty.call(eigene, name) && name !== 'vendor')
      .reduce((m, [, w]) => Math.max(m, w), 0);
    vergleiche.push({ schluessel: 'chunk_max', wert: groesster, grenze: grenzen.chunk_max, status: groesster > grenzen.chunk_max ? 'ueber' : 'ok' });
  }
  return { vergleiche, ueber: vergleiche.filter((v) => v.status === 'ueber') };
}

/**
 * A limit from a measured value: value plus buffer, rounded UP to whole KB.
 * @param {number} wert gzip bytes
 * @param {number} pufferProzent percent
 * @returns {number} bytes, a multiple of 1024
 */
export function grenzeAus(wert, pufferProzent) {
  return Math.ceil((wert * (1 + pufferProzent / 100)) / 1024) * 1024;
}

/**
 * New limits from today's measurement (for --schreiben): every top-level value, every named manual chunk
 * of vite.config.js that exists, and chunk_max over the remaining chunks.
 * @param {ReturnType<typeof messwerteAus>} werte
 * @param {number} pufferProzent
 * @param {ReadonlyArray<string>} benannte chunk names that get their own limit
 * @returns {Grenzen}
 */
export function grenzenAus(werte, pufferProzent, benannte) {
  /** @type {Record<string, number>} */
  const chunks = {};
  for (const n of benannte) if (typeof werte.chunks[n] === 'number' && n !== 'vendor') chunks[n] = grenzeAus(werte.chunks[n], pufferProzent);
  const rest = Object.entries(werte.chunks).filter(([n]) => !(n in chunks) && n !== 'vendor').reduce((m, [, w]) => Math.max(m, w), 0);
  return {
    entry: grenzeAus(werte.entry, pufferProzent),
    css: grenzeAus(werte.css, pufferProzent),
    ...(werte.vendor != null ? { vendor: grenzeAus(werte.vendor, pufferProzent) } : {}),
    erste_runde: grenzeAus(werte.erste_runde, pufferProzent),
    route_max: grenzeAus(werte.route_max, pufferProzent),
    chunk_max: grenzeAus(rest, pufferProzent),
    gesamt: grenzeAus(werte.gesamt, pufferProzent),
    chunks,
  };
}

/** Named manual chunks of vite.config.js (manualChunks) that get a limit of their own. */
export const BENANNTE_CHUNKS = Object.freeze(['three', 'charts', 'map', 'motion', 'planegcs', 'ifc']);

/** @param {string[]} argv @returns {{dist: string, budget: string, schreiben: boolean}} */
function argumente(argv) {
  const wert = (name, standard) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : standard; };
  return { dist: wert('dist', 'dist'), budget: wert('budget', 'budget.json'), schreiben: argv.includes('--schreiben') };
}

function main() {
  const { dist, budget, schreiben } = argumente(process.argv.slice(2));
  const distAbs = path.resolve(dist);
  const manifestPfad = path.join(distAbs, '.vite', 'manifest.json');
  if (!fs.existsSync(path.join(distAbs, 'index.html')) || !fs.existsSync(manifestPfad)) {
    console.error(`Kein Build unter ${distAbs} (index.html und .vite/manifest.json fehlen) — erst \`npx vite build\`.`);
    process.exit(1);
  }
  const werte = messwerteAus(messeBuild(distAbs), JSON.parse(fs.readFileSync(manifestPfad, 'utf8')));
  const budgetAbs = path.resolve(budget);
  const datei = fs.existsSync(budgetAbs) ? JSON.parse(fs.readFileSync(budgetAbs, 'utf8')) : {};
  const puffer = typeof datei.puffer_prozent === 'number' ? datei.puffer_prozent : STANDARD_PUFFER_PROZENT;

  if (schreiben) {
    const neu = {
      beschreibung: 'Größen-Budget des Client-Builds (93-09). Grenzen in Byte (gzip); Prüfung: node scripts/groessen-budget.mjs; neu setzen nur bewusst: --schreiben.',
      einheit: 'Byte (gzip)',
      puffer_prozent: puffer,
      gemessen: {
        datum: new Date().toISOString().slice(0, 10),
        werte: { entry: werte.entry, css: werte.css, vendor: werte.vendor, erste_runde: werte.erste_runde, route_max: werte.route_max, route_max_name: werte.route_max_name, gesamt: werte.gesamt, chunks: werte.chunks },
      },
      grenzen: grenzenAus(werte, puffer, BENANNTE_CHUNKS),
    };
    fs.writeFileSync(budgetAbs, `${JSON.stringify(neu, null, 2)}\n`);
    console.log(`Budget geschrieben: ${budgetAbs} (Messung + ${puffer} %, auf volle KB aufgerundet).`);
    return;
  }

  if (!datei.grenzen) {
    console.error(`Keine Grenzen in ${budgetAbs} — mit --schreiben aus dem heutigen Build anlegen.`);
    process.exit(1);
  }
  const { vergleiche, ueber } = pruefeBudget(werte, datei.grenzen);
  console.log(`Größen-Budget (${path.relative(process.cwd(), budgetAbs) || budget}) — gzip:`);
  for (const v of vergleiche) {
    const marke = v.status === 'ok' ? 'ok   ' : v.status === 'ueber' ? 'ÜBER ' : 'fehlt';
    const anteil = v.wert == null ? '' : ` (${Math.round((v.wert / v.grenze) * 100)} %)`;
    console.log(`  ${marke} ${v.schluessel.padEnd(22)} ${v.wert == null ? '—' : kb(v.wert)} / ${kb(v.grenze)}${anteil}`);
  }
  if (werte.route_max_name) console.log(`  größte Route: ${werte.route_max_name}`);
  if (ueber.length) {
    console.error(`\n${ueber.length} Wert(e) über dem Budget. Entweder verkleinern (lazy laden, Abhängigkeit prüfen) oder bewusst anheben: node scripts/groessen-budget.mjs --schreiben (im Commit begründen).`);
    process.exit(1);
  }
  console.log('Im Budget.');
}

// Run only as a script (the unit test imports the pure functions).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

