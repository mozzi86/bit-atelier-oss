// Bridge between the web app and the desktop shell (Phase 70-02).
//
// One question, one place: "does this page run inside the Tauri shell?". The
// answer combines the build (only the serverless `lokal` build is ever packed
// into the shell) with the runtime marker Tauri sets before any page script
// runs (`isTauri()` from @tauri-apps/api/core). The same `lokal` bundle also
// runs as installable PWA in a browser — there inHuelle() is false and nothing
// of the shell is touched.
//
// In:  nothing / a command name plus arguments.
// Out: inHuelle() and huelleAufrufen(); errors of a command arrive as Error
//      with the shell's plain-text message.

import { isTauri, invoke } from '@tauri-apps/api/core';
import { SERVERLOS } from '@core/lib/umgebung';

/**
 * True when the page runs inside the desktop shell.
 * @returns {boolean}
 */
export function inHuelle() {
  if (!SERVERLOS) return false;
  try {
    return isTauri();
  } catch {
    return false;
  }
}

/**
 * Calls a command of the shell (lib.rs `generate_handler!`). The shell returns
 * its errors as plain strings; they are turned into Error objects here so every
 * caller can use `err.message` as everywhere else in the app.
 * @template T
 * @param {string} befehl command name, e.g. "profil_lesen"
 * @param {Record<string, unknown>} [argumente] named arguments (camelCase on this side)
 * @returns {Promise<T>}
 * @throws {Error} outside the shell, or with the shell's message when the command fails
 */
export async function huelleAufrufen(befehl, argumente) {
  if (!inHuelle()) throw new Error(`Desktop-Befehl „${befehl}“ ist nur im Desktop-Client verfügbar.`);
  try {
    return /** @type {T} */ (await invoke(befehl, argumente));
  } catch (fehler) {
    throw fehler instanceof Error ? fehler : new Error(String(fehler));
  }
}
