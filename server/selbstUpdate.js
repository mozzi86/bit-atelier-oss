// selbstUpdate.js — self-update of the downloaded (local) BIT-Atelier: find out whether a newer release
// exists and install it from inside the app, without sending the user to a download page.
// Plan 92-01 (user 11.10.2026: "make it know if there is an update, make the update clickable, fetch and
// install it automatically without linking to the newest version").
//
// Source of truth: the GitHub releases of the public repo (default mozzi86/bit-atelier-oss, override with
// BIT_UPDATE_REPO). A release must carry BIT-Atelier.zip AND BIT-Atelier.zip.sha256 — without the checksum
// the app refuses to install (a download that cannot be verified is never executed).
//
// Flow: pruefen() → herunterladenUndVorbereiten() (download with a host allow-list, SHA-256, unzip into
// <app>/.update/neu with a path-traversal guard) → the server starts tools/update-anwenden.mjs detached and
// exits; that script swaps the program files (keeping daten/, .env, node_modules/, .update/), reinstalls
// runtime packages only when package-lock.json changed, rolls back on any error and restarts the app.
//
// Never runs in a developer checkout (a .git folder next to package.json): there, updates come from git.
//
// In:  app root folder, fetch (injectable for tests). Out: pure helpers + async steps; no Express here.

import fs from 'node:fs';
import { ersetzeAtomar } from '../packages/nova-core/server/atomarErsetzen.js';
import path from 'node:path';
import crypto from 'node:crypto';
import { unzipSync } from 'fflate';

/** Public repo whose releases are the updates. */
export const UPDATE_REPO = process.env.BIT_UPDATE_REPO || 'mozzi86/bit-atelier-oss';
/** Asset names (version-free on purpose, see the release workflow). */
export const ZIP_NAME = 'BIT-Atelier.zip';
export const SHA_NAME = 'BIT-Atelier.zip.sha256';
/** Entries of the app folder an update never touches. */
export const BEWAHREN = Object.freeze(['daten', '.env', 'node_modules', '.update', 'server/db.json', 'server/personal.json']);
/** Hosts a release download may come from (GitHub API → redirect to the asset CDN). */
export const ERLAUBTE_HOSTS = Object.freeze(['api.github.com', 'github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']);
/** Upper bound of a release zip, bytes [ASSUMED — v1.0.1 is 9.5 MB; 200 MB leaves room, stops a runaway download]. */
export const MAX_ZIP_BYTES = 200 * 1024 * 1024;

/**
 * Compare two versions "1.2.3" (a leading "v" and a pre-release suffix are ignored).
 * @param {string} a
 * @param {string} b
 * @returns {number} >0 when a is newer, <0 when b is newer, 0 when equal
 */
export function versionVergleich(a, b) {
  const teile = (v) => String(v || '').trim().replace(/^v/i, '').split(/[-+]/)[0].split('.').map((x) => Number.parseInt(x, 10) || 0);
  const x = teile(a), y = teile(b);
  for (let i = 0; i < Math.max(x.length, y.length, 3); i += 1) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d;
  }
  return 0;
}

/**
 * Why this installation cannot update itself, or null when it can.
 * @param {{root: string, appModus: boolean}} p
 * @returns {string|null} German reason for the UI
 */
export function updateSperre({ root, appModus }) {
  if (!appModus) return 'Die App läuft nicht als installierte Fassung (Entwicklungsmodus).';
  if (fs.existsSync(path.join(root, '.git'))) return 'Quellcode-Arbeitskopie (git) – Updates bitte über git holen.';
  return null;
}

/**
 * Read the latest release from the GitHub API.
 * @param {{fetchFn?: typeof fetch, repo?: string}} [o]
 * @returns {Promise<{version: string, tag: string, datum: string|null, notizen: string, seite: string|null, zip: {url: string, groesse: number}|null, sha: {url: string}|null}>}
 */
export async function neuesteVersion({ fetchFn = fetch, repo = UPDATE_REPO } = {}) {
  const r = await fetchFn(`https://api.github.com/repos/${repo}/releases/latest`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'BIT-Atelier-Updater' } });
  // The unauthenticated API allows 60 requests per hour and IP (403/429 when used up — offices behind one
  // address hit it). Fallback without the API: github.com/<repo>/releases/latest redirects to the tag page;
  // the asset URLs follow from the tag. Size and notes are unknown there; a missing checksum file still
  // stops the installation later with a clear message (laden() → 404).
  if (r.status === 403 || r.status === 429) return neuesteUeberWeiterleitung({ fetchFn, repo });
  if (!r.ok) throw new Error(`Update-Server antwortet mit ${r.status}`);
  const j = await r.json();
  const asset = (name) => (j.assets || []).find((a) => a.name === name) || null;
  const zip = asset(ZIP_NAME), sha = asset(SHA_NAME);
  return {
    version: String(j.tag_name || '').replace(/^v/i, ''), tag: String(j.tag_name || ''), datum: j.published_at || null,
    notizen: String(j.body || '').slice(0, 4000), seite: typeof j.html_url === 'string' ? j.html_url : null,
    zip: zip ? { url: zip.browser_download_url, groesse: Number(zip.size) || 0 } : null,
    sha: sha ? { url: sha.browser_download_url } : null,
  };
}

/**
 * Latest release without the GitHub API (fallback when the API rate limit is used up): read the tag from
 * the redirect of github.com/<repo>/releases/latest.
 * @param {{fetchFn?: typeof fetch, repo?: string}} [o]
 * @returns {Promise<Awaited<ReturnType<typeof neuesteVersion>>>}
 */
export async function neuesteUeberWeiterleitung({ fetchFn = fetch, repo = UPDATE_REPO } = {}) {
  const r = await fetchFn(`https://github.com/${repo}/releases/latest`, { redirect: 'manual', headers: { 'User-Agent': 'BIT-Atelier-Updater' } });
  const ziel = r.headers?.get?.('location') || r.url || '';
  const tag = (/\/releases\/tag\/([^/?#]+)/.exec(ziel) || [])[1];
  if (!tag) throw new Error(`Update-Server antwortet mit ${r.status} (kein Release gefunden)`);
  const basis = `https://github.com/${repo}/releases/download/${tag}`;
  return {
    version: decodeURIComponent(tag).replace(/^v/i, ''), tag: decodeURIComponent(tag), datum: null, notizen: '',
    seite: `https://github.com/${repo}/releases/tag/${tag}`,
    zip: { url: `${basis}/${ZIP_NAME}`, groesse: 0 }, sha: { url: `${basis}/${SHA_NAME}` },
  };
}

/** Is a URL (after redirects) on an allowed host over https? */
export function hostErlaubt(url) {
  try { const u = new URL(url); return u.protocol === 'https:' && ERLAUBTE_HOSTS.includes(u.hostname); } catch { return false; }
}

/**
 * Download bytes from an allowed host with a size limit.
 * @param {string} url
 * @param {{fetchFn?: typeof fetch, max?: number, fortschritt?: (geladen: number, gesamt: number) => void}} [o]
 * @returns {Promise<Uint8Array>}
 */
export async function laden(url, { fetchFn = fetch, max = MAX_ZIP_BYTES, fortschritt } = {}) {
  if (!hostErlaubt(url)) throw new Error(`Download-Adresse nicht erlaubt: ${url}`);
  const r = await fetchFn(url, { headers: { 'User-Agent': 'BIT-Atelier-Updater' }, redirect: 'follow' });
  if (!r.ok) throw new Error(`Download fehlgeschlagen (${r.status})`);
  if (r.url && !hostErlaubt(r.url)) throw new Error(`Download wurde auf eine nicht erlaubte Adresse umgeleitet: ${r.url}`);
  const gesamt = Number(r.headers?.get?.('content-length')) || 0;
  if (gesamt > max) throw new Error('Update-Datei ist zu groß.');
  if (!r.body || typeof r.body.getReader !== 'function') {
    const b = new Uint8Array(await r.arrayBuffer());
    if (b.length > max) throw new Error('Update-Datei ist zu groß.');
    return b;
  }
  const reader = r.body.getReader();
  const teile = []; let geladen = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    geladen += value.length;
    if (geladen > max) throw new Error('Update-Datei ist zu groß.');
    teile.push(value);
    fortschritt?.(geladen, gesamt);
  }
  const out = new Uint8Array(geladen); let o = 0;
  for (const t of teile) { out.set(t, o); o += t.length; }
  return out;
}

/** SHA-256 of bytes as lower-case hex. */
export function sha256Hex(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

/** First 64-hex token of a .sha256 file ("<hash>  BIT-Atelier.zip" or the bare hash). */
export function shaAusDatei(text) {
  const m = /\b([a-f0-9]{64})\b/i.exec(String(text || ''));
  return m ? m[1].toLowerCase() : null;
}

/**
 * Unzip a release into `ziel`, stripping the top folder "BIT-Atelier/". Refuses absolute paths and "..".
 * @param {Uint8Array} zipBytes
 * @param {string} ziel empty or missing folder
 * @returns {{dateien: number}}
 */
export function entpacken(zipBytes, ziel) {
  const eintraege = unzipSync(zipBytes);
  const zielAbs = path.resolve(ziel);
  fs.rmSync(zielAbs, { recursive: true, force: true });
  fs.mkdirSync(zielAbs, { recursive: true });
  let dateien = 0;
  for (const [name, daten] of Object.entries(eintraege)) {
    const rel = name.replace(/\\/g, '/').replace(/^BIT-Atelier\//, '');
    if (!rel || rel.endsWith('/')) continue;
    if (rel.startsWith('/') || /^[A-Za-z]:/.test(rel) || rel.split('/').includes('..')) throw new Error(`Unsicherer Pfad im Update: ${name}`);
    const datei = path.resolve(zielAbs, rel);
    if (!datei.startsWith(zielAbs + path.sep)) throw new Error(`Unsicherer Pfad im Update: ${name}`);
    fs.mkdirSync(path.dirname(datei), { recursive: true });
    fs.writeFileSync(datei, daten);
    dateien += 1;
  }
  if (!fs.existsSync(path.join(zielAbs, 'package.json')) || !fs.existsSync(path.join(zielAbs, 'server', 'index.js'))) {
    throw new Error('Das Update enthält keine vollständige App (package.json / server/index.js fehlt).');
  }
  return { dateien };
}

/**
 * Top-level entries of the app folder that an update replaces (everything except BEWAHREN top-level names).
 * Nested preserved paths (server/db.json …) are handled by the apply script.
 * @param {string[]} eintraege names in the app root
 * @returns {string[]}
 */
export function zuErsetzen(eintraege) {
  const oben = new Set(BEWAHREN.filter((b) => !b.includes('/')));
  return eintraege.filter((e) => !oben.has(e));
}

/** SHA-256 of package-lock.json in a folder, or null. Decides whether `npm ci` must run after the swap. */
export function lockHash(ordner) {
  const p = path.join(ordner, 'package-lock.json');
  return fs.existsSync(p) ? sha256Hex(fs.readFileSync(p)) : null;
}

// --- 92-04: release notes, opt-out and "hold this version until …" ---------------------------------

/**
 * Marker the release workflow writes between the changelog section and the install instructions
 * (an HTML comment: invisible on the GitHub release page). Everything above it is "what changed".
 */
export const NOTIZ_MARKE = '<!-- bit-atelier:installation -->';

/**
 * The changelog part of a release note: the text above NOTIZ_MARKE, trimmed. Releases before 92-04
 * carry no marker — then the whole note is returned (the banner shows what the release says).
 * @param {string} notiz release body
 * @returns {string}
 */
export function aenderungenAusNotiz(notiz) {
  const text = String(notiz || '').replace(/\r\n?/g, '\n');
  const i = text.indexOf(NOTIZ_MARKE);
  return (i >= 0 ? text.slice(0, i) : text).trim();
}

/**
 * Is the update check switched off for the whole installation (environment)?
 * BIT_KEIN_UPDATECHECK=1 (also "true", "ja", "yes") — then the server never contacts GitHub.
 * @param {Record<string, string|undefined>} [env] environment (default process.env)
 * @returns {boolean}
 */
export function updateCheckAus(env = process.env) {
  return /^(1|true|ja|yes)$/i.test(String(env.BIT_KEIN_UPDATECHECK ?? '').trim());
}

/** Defaults of the update settings file (automatic check on, no hold date). */
export const EINSTELLUNGEN_STANDARD = Object.freeze({ automatisch: true, festhaltenBis: /** @type {string|null} */ (null) });

/**
 * Today as a local calendar date "YYYY-MM-DD" (the hold date is a calendar day of the office, not UTC).
 * @param {Date} [jetzt]
 * @returns {string}
 */
export function heuteLokal(jetzt = new Date()) {
  const z = (n) => String(n).padStart(2, '0');
  return `${jetzt.getFullYear()}-${z(jetzt.getMonth() + 1)}-${z(jetzt.getDate())}`;
}

/**
 * Validate a (partial) settings object from the UI.
 * @param {any} eingabe e.g. { automatisch: false } or { festhaltenBis: "2026-12-01" } or { festhaltenBis: null }
 * @returns {{ok: true, werte: {automatisch?: boolean, festhaltenBis?: string|null}} | {ok: false, fehler: string}}
 */
export function einstellungenPruefen(eingabe) {
  if (!eingabe || typeof eingabe !== 'object' || Array.isArray(eingabe)) return { ok: false, fehler: 'Ungültige Einstellungen.' };
  /** @type {{automatisch?: boolean, festhaltenBis?: string|null}} */
  const werte = {};
  if ('automatisch' in eingabe) {
    if (typeof eingabe.automatisch !== 'boolean') return { ok: false, fehler: '„automatisch“ muss ja oder nein sein.' };
    werte.automatisch = eingabe.automatisch;
  }
  if ('festhaltenBis' in eingabe) {
    const v = eingabe.festhaltenBis;
    if (v === null || v === '') werte.festhaltenBis = null;
    else if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))) werte.festhaltenBis = v;
    else return { ok: false, fehler: 'Datum bitte als JJJJ-MM-TT.' };
  }
  return { ok: true, werte };
}

/**
 * Read the update settings (missing or broken file → defaults; a broken file must never stop the app).
 * @param {string} datei absolute path of update-einstellungen.json
 * @returns {{automatisch: boolean, festhaltenBis: string|null}}
 */
export function einstellungenLesen(datei) {
  try {
    const roh = JSON.parse(fs.readFileSync(datei, 'utf8'));
    const p = einstellungenPruefen(roh);
    return { ...EINSTELLUNGEN_STANDARD, ...(p.ok ? p.werte : {}) };
  } catch {
    return { ...EINSTELLUNGEN_STANDARD };
  }
}

/**
 * Merge validated values into the settings file (written via a temp file + rename).
 * @param {string} datei absolute path of update-einstellungen.json
 * @param {{automatisch?: boolean, festhaltenBis?: string|null}} werte output of einstellungenPruefen
 * @returns {{automatisch: boolean, festhaltenBis: string|null}} the stored settings
 */
export function einstellungenSchreiben(datei, werte) {
  const neu = { ...einstellungenLesen(datei), ...werte };
  fs.mkdirSync(path.dirname(datei), { recursive: true });
  const tmp = `${datei}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(neu, null, 2)}\n`);
  ersetzeAtomar(tmp, datei);
  return neu;
}

/**
 * Is the installed version held (no banner, no install) on this day? The hold date counts inclusively.
 * @param {{festhaltenBis: string|null}} einst
 * @param {string} heute local date "YYYY-MM-DD"
 * @returns {boolean}
 */
export function istFestgehalten(einst, heute) {
  return Boolean(einst.festhaltenBis) && heute <= /** @type {string} */ (einst.festhaltenBis);
}
