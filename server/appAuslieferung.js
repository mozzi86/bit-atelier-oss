// appAuslieferung.js — serves the built client (`dist/`) from the local API
// (Plan 83-03, `npm start`). One port for app and API: the downloaded release
// opens http://localhost:3001 and the browser talks to /api on the same origin,
// so no Vite, no proxy and no second process is needed at run time.
//
// Only active in app mode (`--app`, NODE_ENV=production or BIT_APP=1) — the dev
// stack (`npm run dev`, Vite on :5173 with its /api proxy) never calls this.
//
// Routing order inside appAusliefern (mounted AFTER every /api router):
//   1. unknown /api/* → JSON 404 (an API client never gets HTML back)
//   2. files in dist/ → static, hashed assets cached for a year, the rest no-cache
//   3. GET without file extension → dist/index.html (SPA fallback for the
//      BrowserRouter: /Projects, /AVA, … are client routes)
//   4. anything else (a missing .js/.png …) → 404 from Express
//
// In:  the Express app and the dist folder. Out: routes on the app.

import fs from 'node:fs';
import path from 'node:path';
import express from 'express';

/** Cache-Control for Vite's content-hashed files under dist/assets/ (1 year in seconds). */
export const CACHE_LANG = 'public, max-age=31536000, immutable';
/** Cache-Control for index.html and unhashed files: always revalidate (ETag). */
export const CACHE_KEIN = 'no-cache';

/**
 * Whether the server should deliver the built client.
 * @param {string[]} [argv] process arguments (default process.argv)
 * @param {Record<string, string|undefined>} [env] environment (default process.env)
 * @returns {boolean}
 */
export function istAppModus(argv = process.argv, env = process.env) {
  return argv.includes('--app') || env.NODE_ENV === 'production' || env.BIT_APP === '1';
}

/**
 * True for a GET path the SPA fallback answers with index.html: not under /api
 * and without a file extension in its last segment.
 * @param {string} pfad request path (req.path, no query)
 * @returns {boolean}
 */
export function istSpaPfad(pfad) {
  if (pfad === '/api' || pfad.startsWith('/api/')) return false;
  return path.posix.extname(pfad) === '';
}

/**
 * Mounts the built client on the app. Must be called after all /api routers.
 * @param {import('express').Express} app the Express app
 * @param {string} distOrdner absolute path of the build output (contains index.html)
 * @returns {void}
 * @throws {Error} when dist/index.html does not exist
 */
export function appAusliefern(app, distOrdner) {
  const indexDatei = path.join(distOrdner, 'index.html');
  if (!fs.existsSync(indexDatei)) {
    throw new Error(`${indexDatei} is missing — run "npm run build" first.`);
  }

  // 1. Unknown API routes answer JSON, never the SPA shell.
  app.use('/api', (req, res) => {
    res.status(404).json({ error: `Unbekannter API-Pfad: ${req.method} ${req.originalUrl}` });
  });

  // 2. Static files with explicit cache headers.
  app.use(express.static(distOrdner, {
    index: false, // "/" goes through the fallback below so it gets no-cache
    cacheControl: false,
    setHeaders(res, datei) {
      const relativ = path.relative(distOrdner, datei).replace(/\\/g, '/');
      res.setHeader('Cache-Control', relativ.startsWith('assets/') ? CACHE_LANG : CACHE_KEIN);
    },
  }));

  // 3. SPA fallback for client routes.
  app.get('*', (req, res, next) => {
    if (!istSpaPfad(req.path)) return next();
    res.sendFile(indexDatei, { cacheControl: false, headers: { 'Cache-Control': CACHE_KEIN } });
  });
}
