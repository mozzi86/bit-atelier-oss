// Cloud build for app.bit-atelier.de (57-05).
//
// Wraps `vite build` with the two things a hosted build needs and a plain
// `vite build` does not give: a refusal when the Supabase configuration is
// missing (otherwise the deployed app silently falls back to the Express data
// path and shows an empty, login-less dashboard), and a size report next to the
// output so nobody has to guess what a visitor downloads.
//
// In:  VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY from the hosting environment.
// Out: dist/ and dist/GROESSEN.md. Writes nothing outside the repo, no network.
//
// Usage:  npm run build:cloud
//         npm run build:cloud -- --ohne-pruefung   (local test build, see below)

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { messeBuild, berichtMarkdown, kb } from './groessen.mjs';
import { fehlendeAngaben } from '../packages/nova-core/src/lib/anbieter.js';

const WURZEL = path.resolve(import.meta.dirname, '..');
const DIST = path.join(WURZEL, 'dist');
const ohnePruefung = process.argv.includes('--ohne-pruefung');

// --- 1. Konfiguration prüfen, BEVOR gebaut wird ---------------------------
// Ein Cloud-Build ohne diese beiden Variablen baut die App im Express-Modus:
// sie erwartet dann einen lokalen Server, zeigt keine Anmeldung und lädt keine
// Daten. Das fällt erst dem ersten Besucher auf — deshalb hier abbrechen.
const url = process.env.VITE_SUPABASE_URL;
const anon = process.env.VITE_SUPABASE_ANON_KEY;
if (!ohnePruefung && (!url || !anon)) {
  console.error(
    'ABBRUCH: VITE_SUPABASE_URL und VITE_SUPABASE_ANON_KEY fehlen.\n' +
      'Ohne sie baut Vite die App im Express-Modus — live wäre das eine leere App\n' +
      'ohne Anmeldung. Im Hosting (Cloudflare Pages → Settings → Environment\n' +
      'variables) setzen. Nur für einen lokalen Testbau: --ohne-pruefung.'
  );
  process.exit(1);
}
if (ohnePruefung) {
  console.warn('! Konfigurationsprüfung übersprungen — dieser Build gehört NICHT ins Hosting.');
}

// --- 1b. Impressumsangaben prüfen (57-06 Task 1) --------------------------
// An incomplete imprint is a warnable defect in itself — worse than a missing
// one, because it is a false statement about who is responsible rather than an
// omission. The page renders the gaps visibly in `npm run dev`; here, where the
// build is about to go to real visitors, it is a hard stop.
const luecken = fehlendeAngaben();
if (!ohnePruefung && luecken.length > 0) {
  console.error(
    'ABBRUCH: Das Impressum ist unvollständig. Es fehlen:\n' +
      luecken.map((l) => `  - ${l}`).join('\n') +
      '\n\nEinzutragen in packages/nova-core/src/lib/anbieter.js.\n' +
      'Ein unvollständiges Impressum ist selbst abmahnfähig — deshalb bricht der\n' +
      'Build hier ab, statt die Lücken zu veröffentlichen. Nur für einen lokalen\n' +
      'Testbau: --ohne-pruefung.'
  );
  process.exit(1);
}

// --- 2. bauen -------------------------------------------------------------
console.log('› Cloud-Build (vite build) …');
// Vite wird über seinen JS-Einstiegspunkt mit dem laufenden Node gestartet,
// nicht über den `npx`-Starter. Zwei Gründe: `shell: true` würde die Argumente
// nur aneinanderhängen statt sie zu maskieren (Node DEP0190) — und seit Node 20
// verweigert `execFileSync` das Starten von `.cmd`-Dateien ohne Shell, was unter
// Windows mit `spawnSync npx.cmd EINVAL` abbricht (gemessen mit Node 24.18 am
// 19.09.2026). Der direkte Aufruf umgeht beides und ist auf allen Plattformen
// derselbe Weg.
execFileSync(process.execPath, [path.join(WURZEL, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], {
  cwd: WURZEL,
  stdio: 'inherit',
});
if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('FEHLER: dist/index.html fehlt — der Build hat nichts geliefert.');
  process.exit(1);
}

// --- 3. SPA-Weiche gegenprüfen -------------------------------------------
// Der Cloud-Build nutzt BrowserRouter (App.jsx:18 — HashRouter nur serverlos).
// Ohne _redirects liefert Cloudflare Pages bei /Projects einen 404, weil es die
// Datei sucht statt die App zu laden. public/_redirects wird von Vite kopiert.
if (!fs.existsSync(path.join(DIST, '_redirects'))) {
  console.error(
    'FEHLER: dist/_redirects fehlt. Ohne diese Datei liefert das Hosting bei jedem\n' +
      'Direktaufruf (z. B. /Projects, /anmeldung) einen 404. Erwartet: public/_redirects.'
  );
  process.exit(1);
}

// --- 4. messen ------------------------------------------------------------
const messung = messeBuild(DIST, '/');
// The size report and Vite's chunk manifest stay OUT of dist/: Cloudflare
// publishes dist/ as is, and .vite/manifest.json maps every chunk to its source
// path (phase 78 hotfix — it was publicly reachable). The manifest is only
// needed by build-sw.mjs, which the cloud build does not run.
const BERICHT = path.join(WURZEL, 'build-cloud-groessen.md');
fs.writeFileSync(BERICHT, berichtMarkdown(messung, 'Cloud-Build — app.bit-atelier.de'), 'utf8');
fs.rmSync(path.join(DIST, '.vite'), { recursive: true, force: true });
for (const verboten of ['.vite', 'GROESSEN.md']) {
  if (fs.existsSync(path.join(DIST, verboten))) {
    console.error(`FEHLER: dist/${verboten} darf nicht veröffentlicht werden.`);
    process.exit(1);
  }
}

console.log(
  `\n✓ Build fertig.\n` +
    `  Erste Runde: ${kb(messung.erstePaintGz)} gzip (${messung.erstePaintDateien.length} Dateien)\n` +
    `  Gesamt:      ${kb(messung.gesamtGz)} gzip · ${messung.zeilen.length} Dateien\n` +
    `  Bericht:     build-cloud-groessen.md (nicht in dist/)\n`
);
