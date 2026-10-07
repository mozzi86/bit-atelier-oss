#!/usr/bin/env node
// Builds the service worker of the serverless build from the Vite manifest (Phase 65-04,
// mode table since 70-01; the demo mode was removed in 83-02, `lokal` remains).
//
// Why not vite-plugin-pwa: a new dependency needs a decision, a licence entry and
// a review. What is needed here is a precache list and two fetch strategies —
// about a hundred lines, and no upgrade path to get wrong later.
//
// Why offline at all: the modules that are demonstrably used outdoors — site
// control, walk-through, measuring, photo capture — hang on a first load with no
// cache. In a shell, a basement, an underground car park that is not a tool
// (finding BEF-09 / A-04). Offline capability is also the technical redemption of
// the website's "ohne Cloud-Zwang".
//
// In:  <ziel>/.vite/manifest.json (needs build.manifest: true) + the built files,
//      plus the mode as argv[2]: 'lokal' (default, the only mode since 83-02).
// Out: <ziel>/sw.js with a fixed precache list and a version hash.
//
// Runs as part of `npm run build:lokal`.
//
// The cache name carries a hash over the precache list, so a changed build means a
// changed cache. That matters more than it looks: in the sibling project BIT-Nova PDF
// a service worker kept a FIXED cache name and served June files to every installed
// PWA for six releases. Here the name moves with the content, and the entry document
// is network-first (see below) - keep both properties when touching this file.

import fs from 'node:fs';
import path from 'node:path';

import { modusPruefen } from './sw-modi.mjs';
import { bauePrecache, baueWarmup, versionsHash } from './sw-inhalt.mjs';

const WURZEL = path.resolve(import.meta.dirname, '..');

const MODUS = process.argv[2] || 'lokal';
let modus;
try {
  modus = modusPruefen(MODUS);
} catch (fehler) {
  console.error(`FEHLER: ${fehler.message}`);
  process.exit(1);
}
const DIST = path.join(WURZEL, modus.ziel);
const BASIS = modus.basis;
const CACHE_PRAEFIX = modus.cache;
// Each mode has its own manifest (different name, scope and start_url) - precaching
// the other one would install the wrong identity.
const MANIFEST = modus.manifest;

// 69-04: the pattern tables and list builders moved to sw-inhalt.mjs so the
// unit test can build the lists without running this script (which writes
// files and exits). PRECACHE = shell + sample + icons; WARMUP = heavy
// lazily-loaded files fetched only on demand.

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error(`FEHLER: ${modus.ziel}/index.html fehlt — erst \`npm run build:${MODUS}\`.`);
  process.exit(1);
}

const precache = bauePrecache({ dist: DIST, basis: BASIS, manifest: MANIFEST });
const warmup = baueWarmup({ dist: DIST, basis: BASIS });

// Versions-Hash über BEIDE Listen (69-04): ändert sich eine Datei, ändert sich
// ihr Name (Vite-Hash) und damit der Cache-Schlüssel. Kein Zeitstempel — sonst
// entstünde bei jedem Build ein neuer Cache, auch wenn sich nichts geändert hat.
const version = versionsHash(precache, warmup);

const sw = `// Service worker der lokalen BIT-Atelier-Fassung — ERZEUGT von scripts/build-sw.mjs.
// Nicht von Hand ändern; der Inhalt entsteht bei jedem \`npm run build:lokal\` neu.
const CACHE = '${CACHE_PRAEFIX}-${version}';
const BASIS = '${BASIS}';
const PRECACHE = ${JSON.stringify(precache, null, 2)};
// 69-04: heavy lazily-loaded files — NOT installed eagerly. Fetched on the
// 'warmup' message (route change to ModelCheck/IfcViewer or requestIdleCallback)
// or on first real use (the fetch handler caches assets/ cache-first anyway).
const WARMUP = ${JSON.stringify(warmup, null, 2)};

self.addEventListener('install', (e) => {
  // Kein skipWaiting: eine neue Fassung übernimmt erst, wenn der Nutzer sie
  // annimmt (Meldung in der App). Ein stiller Wechsel mitten in der Arbeit
  // hieße halb alte, halb neue Chunks.
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE)),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((namen) =>
      Promise.all(namen.filter((n) => n.startsWith('${CACHE_PRAEFIX}-') && n !== CACHE).map((n) => caches.delete(n))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.typ === 'skipWaiting') self.skipWaiting();
  // 69-04: warm-up — fetch the heavy files into the cache on demand. Errors
  // are swallowed: being offline is not an error, and addAll failing must
  // never break the page (the runtime cache-first still fills on real use).
  if (e.data && e.data.typ === 'warmup' && WARMUP.length) {
    caches.open(CACHE).then((c) => c.addAll(WARMUP)).catch(() => {});
  }
});

self.addEventListener('fetch', (e) => {
  const anfrage = e.request;
  if (anfrage.method !== 'GET') return;

  const url = new URL(anfrage.url);
  // Nur die eigene Herkunft und nur unterhalb der Basis (/app/) — Kartenkacheln und
  // andere Fremdhosts gehören nicht in unseren Cache.
  if (url.origin !== self.location.origin || !url.pathname.startsWith(BASIS)) return;

  // Gehashte Bau-Artefakte und das Musterprojekt: cache-first. Der Dateiname
  // ändert sich bei jeder Änderung, ein veralteter Treffer ist unmöglich.
  const unveraenderlich = url.pathname.startsWith(BASIS + 'assets/') ||
    url.pathname.startsWith(BASIS + 'beispiel/') ||
    url.pathname.startsWith(BASIS + 'icons/');

  if (unveraenderlich) {
    e.respondWith(
      caches.match(anfrage).then((treffer) =>
        treffer ||
        fetch(anfrage).then((antwort) => {
          if (antwort.ok) {
            const kopie = antwort.clone();
            caches.open(CACHE).then((c) => c.put(anfrage, kopie));
          }
          return antwort;
        }),
      ),
    );
    return;
  }

  // Alles andere (im Wesentlichen das Einstiegsdokument): network-first mit
  // Cache-Rückfall — ohne Netz startet die App aus dem Cache.
  e.respondWith(
    fetch(anfrage)
      .then((antwort) => {
        if (antwort.ok) {
          const kopie = antwort.clone();
          caches.open(CACHE).then((c) => c.put(anfrage, kopie));
        }
        return antwort;
      })
      .catch(() =>
        caches.match(anfrage).then((treffer) => treffer || caches.match(BASIS + 'index.html')),
      ),
  );
});
`;

fs.writeFileSync(path.join(DIST, 'sw.js'), sw, 'utf8');

const bytes = precache.reduce((s, p) => {
  const rel = p.slice(BASIS.length) || 'index.html';
  const datei = path.join(DIST, rel);
  return s + (fs.existsSync(datei) && fs.statSync(datei).isFile() ? fs.statSync(datei).size : 0);
}, 0);
const warmupBytes = warmup.reduce((s, p) => {
  const datei = path.join(DIST, p.slice(BASIS.length));
  return s + (fs.existsSync(datei) && fs.statSync(datei).isFile() ? fs.statSync(datei).size : 0);
}, 0);

console.log(`› sw.js geschrieben — Cache ${CACHE_NAME_LOG(version)}`);
console.log(`  PRECACHE ${precache.length} Einträge, ${(bytes / 1024 / 1024).toFixed(2)} MB roh`);
console.log(`  WARMUP   ${warmup.length} Einträge, ${(warmupBytes / 1024 / 1024).toFixed(2)} MB roh (erst bei Bedarf)`);
for (const p of precache) console.log('   ', p);

/** @param {string} v */
function CACHE_NAME_LOG(v) {
  return `${CACHE_PRAEFIX}-${v}`;
}
