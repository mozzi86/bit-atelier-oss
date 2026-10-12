// Local profile of the desktop client (Phase 70-02): `{ name, buero, ablageort }`.
// No server, no account, no payment — the profile only says who works on this
// device and where the data lives.
//
// The file itself is written by the shell (client/src-tauri/src/profil.rs,
// `<AppConfig>/profil.json`), not into the WebView's storage: from 70-03 on it
// carries the pointer to the storage folder, and that pointer must survive a
// wiped WebView profile.
//
// In:  the profile object. Out: profilPruefen (pure, mirrors profil.rs::pruefen),
//      profilLesen / profilSchreiben (shell commands).

import { huelleAufrufen } from './huelle.js';

/** Upper bound for name and office, in characters — same value as MAX_TEXT in profil.rs. */
export const PROFIL_MAX_TEXT = 200;

/**
 * @typedef {object} Profil
 * @property {string} name person working on this device
 * @property {string} buero office name (may be empty)
 * @property {string|null} ablageort absolute path of the storage folder; null = not chosen (70-02)
 * @property {string|null} [angelegt] ISO time of the first save
 */

/**
 * True for an absolute path on Windows (drive or UNC) or POSIX.
 * @param {string} pfad
 * @returns {boolean}
 */
export function istAbsoluterPfad(pfad) {
  return /^[A-Za-z]:[\\/]/.test(pfad) || /^\\\\[^\\]+\\/.test(pfad) || pfad.startsWith('/');
}

/**
 * Checks a profile before it is sent to the shell. Same rules as
 * profil.rs::pruefen, so the dialog can answer before the round trip; the
 * shell checks again (it never trusts the page).
 * @param {Partial<Profil>|null|undefined} profil
 * @returns {string|null} German reason, or null when the profile is fine
 */
export function profilPruefen(profil) {
  const name = String(profil?.name ?? '');
  const buero = String(profil?.buero ?? '');
  if (!name.trim()) return 'Der Name fehlt.';
  if ([...name].length > PROFIL_MAX_TEXT || [...buero].length > PROFIL_MAX_TEXT) {
    return `Name und Büro dürfen höchstens ${PROFIL_MAX_TEXT} Zeichen lang sein.`;
  }
  const ort = profil?.ablageort;
  if (ort != null && !istAbsoluterPfad(String(ort))) return `Der Ablageort muss ein vollständiger Pfad sein: ${ort}`;
  return null;
}

/**
 * Reads the profile from the shell.
 * @returns {Promise<Profil|null>} null before the first start
 * @throws {Error} when the profile file is damaged or unreadable (plain text from the shell)
 */
export async function profilLesen() {
  return /** @type {Profil|null} */ (await huelleAufrufen('profil_lesen'));
}

/**
 * Stores the profile (shell writes atomically). Trims name and office.
 * @param {Profil} profil
 * @returns {Promise<Profil>} the stored profile
 * @throws {Error} with the reason when the profile is not acceptable or the write failed
 */
export async function profilSchreiben(profil) {
  const sauber = {
    name: String(profil.name ?? '').trim(),
    buero: String(profil.buero ?? '').trim(),
    ablageort: profil.ablageort ?? null,
    angelegt: profil.angelegt ?? new Date().toISOString(),
  };
  const fehler = profilPruefen(sauber);
  if (fehler) throw new Error(fehler);
  await huelleAufrufen('profil_schreiben', { profil: sauber });
  return sauber;
}
