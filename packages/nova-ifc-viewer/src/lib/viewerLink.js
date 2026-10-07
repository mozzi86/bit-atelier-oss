// Shareable viewer state in a URL (Phase 65-05).
//
// Why: "look at this collision" currently has to be described in words. With a
// link it is a click — and a demo that gets forwarded is a demo that spreads.
// The IFC GlobalId is the anchor: it is stable across model versions (Phase 33
// W2), unlike the expressId, which changes on every export.
//
// In:  camera position/target in metres, the selected element's GlobalId, the
//      active filter flags.
// Out: a query string, and back again; the full link for the router of the
//      running build (hash form in demo/lokal, plain path in Express/cloud).
//
// Rounded to 2 decimals (centimetres): a link is meant to be readable and short,
// and the extra digits move the camera by less than the eye can see.
//
// Everything here is pure — no DOM, no three.js — so it is testable under Node.
// The router family comes from the build (SERVERLOS) and is injectable for tests.

import { SERVERLOS } from '@core/lib/umgebung';
import { seitenUrl } from '@core/lib/seitenLink';

/** Nachkommastellen der Koordinaten im Link (2 = Zentimeter). */
const STELLEN = 2;

/**
 * Rounds and drops the numeric noise, or returns null for anything unusable.
 * @param {unknown} v
 * @returns {number|null}
 */
function zahl(v) {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Number(n.toFixed(STELLEN)) : null;
}

/**
 * A triple of finite numbers, or null.
 * @param {unknown} p
 * @returns {number[]|null}
 */
function tripel(p) {
  if (!Array.isArray(p) || p.length !== 3) return null;
  const raus = p.map(zahl);
  return raus.every((x) => x !== null) ? /** @type {number[]} */ (raus) : null;
}

/**
 * Serialises the viewer state. Parameter order is fixed so the same state always
 * yields the same string — otherwise two identical links would not compare equal.
 * @param {{cam?: {pos?: number[], target?: number[]}, sel?: string, filter?: Record<string, unknown>}} zustand
 * @returns {string} query string without the leading "?"
 */
export function serialisiereZustand(zustand = {}) {
  const teile = [];

  const pos = tripel(zustand.cam?.pos);
  const ziel = tripel(zustand.cam?.target);
  if (pos) teile.push(['cam', pos.join(',')]);
  if (ziel) teile.push(['ziel', ziel.join(',')]);

  if (typeof zustand.sel === 'string' && zustand.sel) teile.push(['sel', zustand.sel]);

  // Nur gesetzte Flags, alphabetisch — sonst hinge der Link an der
  // Einfügereihenfolge eines Objekts.
  const aktiv = Object.entries(zustand.filter || {})
    .filter(([, v]) => v === true)
    .map(([k]) => k)
    .sort();
  if (aktiv.length) teile.push(['f', aktiv.join(',')]);

  const p = new URLSearchParams();
  for (const [k, v] of teile) p.set(k, v);
  return p.toString();
}

/**
 * Reads a viewer state back. Returns null when nothing usable is in there —
 * a half-read state would move the camera somewhere arbitrary.
 * @param {string|URLSearchParams} suche
 * @returns {{cam?: {pos: number[], target: number[]|null}, sel?: string, filter?: Record<string, boolean>}|null}
 */
export function parseZustand(suche) {
  if (!suche) return null;
  let p;
  try {
    p = suche instanceof URLSearchParams ? suche : new URLSearchParams(String(suche));
  } catch {
    return null;
  }

  /** @type {any} */
  const raus = {};

  const pos = tripel(String(p.get('cam') || '').split(',').map(Number));
  if (pos) {
    raus.cam = { pos, target: tripel(String(p.get('ziel') || '').split(',').map(Number)) };
  }

  const sel = p.get('sel');
  if (sel) raus.sel = sel;

  const f = p.get('f');
  if (f) {
    raus.filter = {};
    for (const name of f.split(',').filter(Boolean)) raus.filter[name] = true;
  }

  return Object.keys(raus).length ? raus : null;
}

/**
 * The full link to a viewer state, for the copy button.
 *
 * Serverless builds (HashRouter): `basis + "#/" + route + "?" + state`, as since
 * 65-05. Express/cloud (BrowserRouter, 72-16 N-18): the path of `basis` is the
 * CURRENT route there (e.g. "/BimViewer"), so only its origin (and search) is
 * kept and seitenUrl builds origin + base path + route + state. The fixed "#/"
 * produced "/BimViewer#/IfcViewer", which the BrowserRouter never routes.
 *
 * @param {string} basis e.g. location.origin + location.pathname
 * @param {string} route page route, e.g. "IfcViewer"
 * @param {object} zustand see serialisiereZustand
 * @param {import("@core/lib/seitenLink").SeitenUmgebung} [umgebung] router family
 *   and base path override (tests); defaults to the running build
 * @returns {string} absolute URL
 */
export function viewerLink(basis, route, zustand, umgebung = {}) {
  const q = serialisiereZustand(zustand);
  const serverlos = umgebung.serverlos ?? SERVERLOS;
  if (serverlos) return `${basis}#/${route}${q ? `?${q}` : ''}`;
  let origin = '';
  let search = '';
  try {
    const u = new URL(basis);
    origin = u.origin;
    search = u.search;
  } catch {
    // Relative or empty basis: the link stays relative to the base path.
  }
  return seitenUrl(route, q, { origin, search, ...umgebung, serverlos: false });
}
