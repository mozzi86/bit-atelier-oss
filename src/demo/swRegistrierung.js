// Registers the demo's service worker and reports a waiting update (65-04).
//
// Two deliberate restrictions:
//
// 1. Demo build only. In the office build a service worker would sit between the
//    app and its own Express backend and cache things that must not be cached;
//    in dev it fights Vite's HMR. Nothing good comes of it there.
// 2. No silent update. The bundle is large and split across many chunks — a
//    worker that takes over mid-session can leave the page half old and half
//    new. The new version waits until the user says so.
//
// In:  nothing (called once from main.jsx).
// Out: registers <basis>sw.js (/demo/ or /app/); calls `beiUpdate` when a new
//      version is waiting.

import { SERVERLOS } from '@core/lib/umgebung';

/**
 * @param {() => void} beiUpdate called when a new version is installed and waiting
 * @returns {Promise<ServiceWorkerRegistration|null>}
 */
export async function registriereSw(beiUpdate) {
  // Both serverless builds ship a worker: the demo and the client (70-01).
  if (!SERVERLOS || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;

  try {
    const basis = import.meta.env.BASE_URL || '/';
    const reg = await navigator.serviceWorker.register(`${basis}sw.js`, { scope: basis });

    // Fall 1: beim Laden wartet bereits eine neue Fassung (anderer Tab hat sie
    // installiert, oder die Seite wurde zwischendurch nicht neu geladen).
    if (reg.waiting && navigator.serviceWorker.controller) beiUpdate?.();

    // Fall 2: eine neue Fassung wird jetzt installiert.
    reg.addEventListener('updatefound', () => {
      const neu = reg.installing;
      if (!neu) return;
      neu.addEventListener('statechange', () => {
        // controller !== null heißt: es lief schon eine Fassung. Beim allerersten
        // Besuch ist "installed" kein Update, sondern der Normalfall.
        if (neu.state === 'installed' && navigator.serviceWorker.controller) beiUpdate?.();
      });
    });

    return reg;
  } catch (fehler) {
    // Kein Grund, die App anzuhalten — sie läuft ohne Worker genauso, nur ohne
    // Offline-Betrieb. Aber sichtbar bleiben soll es (Klartext in der Konsole).
    console.error('Service Worker konnte nicht registriert werden:', fehler);
    return null;
  }
}

/**
 * Activates the waiting version and reloads once it has taken over.
 * @param {ServiceWorkerRegistration} reg
 */
export function uebernehmeUpdate(reg) {
  if (!reg?.waiting) {
    window.location.reload();
    return;
  }
  // controllerchange feuert, sobald der neue Worker das Ruder hat — erst DANN
  // neu laden, sonst holt die Seite noch einmal die alten Chunks.
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), {
    once: true,
  });
  reg.waiting.postMessage({ typ: 'skipWaiting' });
}

// 69-04: has warmup already been requested this page-life? The message is
// cheap and idempotent server-side (addAll on an existing cache), but calling
// it on every route change would re-fetch the heavy files for no reason.
let warmupGefragt = false;

/**
 * Asks the active service worker to fetch the heavy lazily-loaded files
 * (both WASM + the ifc chunk) into the cache — the warm-up that the offline
 * promise now depends on (69-04). Idempotent per page-life: a second call is
 * a no-op. No-op without a controller (no worker active, or dev build).
 * @returns {boolean} true when the message was sent
 */
export function warmup() {
  if (warmupGefragt) return false;
  const controller = typeof navigator !== 'undefined' && navigator.serviceWorker?.controller;
  if (!controller) return false; // no active worker — nothing to warm
  warmupGefragt = true;
  try {
    controller.postMessage({ typ: 'warmup' });
    return true;
  } catch {
    warmupGefragt = false; // let a later call try again
    return false;
  }
}
