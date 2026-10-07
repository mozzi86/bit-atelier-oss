/// <reference types="vite/client" />
// One place that answers "which build is running?" (Phase 65-02, extended 70-01,
// public demo removed in 83-02).
//
// The answer was being recomputed in four modules (App, Layout, bitApi, Core),
// each spelling out `import.meta.env.MODE === '<mode>'`. That is exactly the
// second source of truth the project rules warn about: change the mode name and
// three of the four keep working, which is worse than all four failing.
//
// Build modes since 83-02 (the serverless online demo is gone — the app is open
// source now, there is nothing left to show off in a shop window):
//   normal  — the app against the local Express API (development, self-hosting)
//             or, with VITE_SUPABASE_URL set, against the cloud (build:cloud)
//   lokal   — serverless: the installable PWA and the Tauri shell, all data in
//             the browser's IndexedDB
//
// `SERVERLOS` is the DATA question ("is there an API to talk to?").
//
// In:  Vite's build mode (+ VITE_SUPABASE_URL since 57-02). Out: boolean
//      constants, the data-path constant DATENQUELLE and the pure rule behind them.
//
// Vite replaces `import.meta.env` with a literal at build time, so these stay
// compile-time constants and branch-only code still tree-shakes out of the other
// builds. The optional chain (`?.`) is what keeps the module importable under plain
// node, where `import.meta.env` does not exist — and that shape was measured, not
// assumed: wrapping the same expression in a `typeof` guard DID break folding, the
// optional chain does not. So keep the `import.meta.env?.MODE === '<modus>'` shape below.
// `flaggenFuer` mirrors the same rule as a pure function, so it can be read and
// tested; rename a mode and both places change together.
//
// The reference directive above pulls in Vite's ImportMeta typing. jsconfig has
// `types: []`, so without it `import.meta.env` is an error.

/** Build modes that run without the Express API. */
export const SERVERLOSE_MODI = ['lokal'];

/**
 * The rule behind the constants, as a pure function — so it can be tested under
 * node, where `import.meta.env` does not exist.
 *
 * Phase 57-02 (D-P57-06): `datenquelle` is the ONE data-path switch. The
 * serverless mode wins over a configured Supabase URL (lokal must never talk to
 * the cloud, ROADMAP phase-70 rule); otherwise the presence of VITE_SUPABASE_URL
 * decides between 'supabase' and the local Express API.
 *
 * @param {string|undefined} modus Vite build mode
 * @param {string|undefined} [supabaseUrl] value of VITE_SUPABASE_URL (public by design)
 * @returns {{ istLokal: boolean, serverlos: boolean,
 *   datenquelle: 'serverlos'|'supabase'|'express' }}
 */
export function flaggenFuer(modus, supabaseUrl) {
  const istLokal = modus === 'lokal';
  const serverlos = istLokal;
  // One source, one rule: serverless builds NEVER use Supabase, even if the
  // URL leaked into the environment.
  const datenquelle = serverlos ? 'serverlos' : (supabaseUrl ? 'supabase' : 'express');
  return { istLokal, serverlos, datenquelle };
}

/** True in the client build (`vite build --mode lokal`) — serverless, IndexedDB. */
export const IST_LOKAL = import.meta.env?.MODE === 'lokal';
/** True whenever there is no Express API to talk to. The data question. */
export const SERVERLOS = IST_LOKAL;
/**
 * True when the build carries a cloud Supabase URL (public by design — RLS
 * protects the data; the service_role key never reaches a client bundle).
 *
 * Spelled as a DIRECT literal comparison, not as a call into flaggenFuer:
 * Rollup folds `!!import.meta.env?.X` (Vite replaces import.meta.env with an
 * object literal, and an unset key evaluates to a known undefined) but it does
 * NOT evaluate cross-module function calls for literal values. Measured 57-02:
 * with `DATENQUELLE = flaggenFuer(...).datenquelle` the
 * `DATENQUELLE === 'supabase'` guards stayed unknown and supabase-js (8 chunks
 * of it, incl. gotrue/auth-js) shipped in the serverless bundles — the exact
 * regression the guard exists to prevent. flaggenFuer stays the single TESTED
 * rule; the constants below must agree with it (asserted in umgebung.test.js).
 * Truthiness (not `!== undefined`) mirrors flaggenFuer's `supabaseUrl ?`:
 * the repo's .env carries `VITE_SUPABASE_URL=` as an EMPTY string — a defined
 * empty variable must NOT switch the cloud path on.
 */
const IST_SUPABASE_URL = !SERVERLOS && !!import.meta.env?.VITE_SUPABASE_URL;

/**
 * The data path (Phase 57-02, D-P57-06): 'serverlos' (lokal, IndexedDB),
 * 'supabase' (cloud) or 'express' (local development / self-hosting).
 * Serverless wins over a configured URL (ROADMAP phase-70 rule). Same
 * foldable-constant shape as SERVERLOS so `DATENQUELLE === 'supabase'`
 * tree-shakes supabase-js out of the other builds.
 */
export const DATENQUELLE = SERVERLOS ? 'serverlos' : IST_SUPABASE_URL ? 'supabase' : 'express';

/** True only on the cloud path — handy for UI that exists solely there. */
export const IST_SUPABASE = DATENQUELLE === 'supabase';
/**
 * E-20 (28.09.2026): the office modules (accounting; HR later) may run on the
 * cloud path. The lock E-03 existed because the generic `records` table is
 * readable by every member of the organisation until phase 74 — the owner is the
 * organisation's only member, so the risk does not exist today. Set to false
 * again as soon as a second member joins the organisation before phase 74 ships.
 */
export const BUERO_CLOUD_FREIGABE = true;
