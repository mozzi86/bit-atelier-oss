// personalDatei.js — the encrypted personnel backup `.bitpers` (Plan 80-10,
// Task 3, D-P80-15). Modelled on projektDatei.js's format/preview/parse shape,
// but personnel data NEVER travels unencrypted: the whole point of D-P80-15 is
// that a `.bitpers` file left on a shared drive or in a mail attachment is
// worthless without the passphrase — E-14 forbids storing personal data
// anywhere else outside the app (no snapshot ring, never inside `.bitproj`).
//
// Why its own module instead of an option on projektDatei.js: the personal
// storage class is structurally separate from demoDb (80-02) — this file reads
// personalDb.js, never demoDb.js, so the same "HR is unreachable through the
// project-export path" guarantee that personalLeck.test.js checks for the rest
// of the codebase holds here too (istPersonalStore stays the only place HR
// stores are named).
//
// Crypto: AES-GCM 256 via the browser/Node WebCrypto API (globalThis.crypto.
// subtle) — no dependency. Key derivation PBKDF2-SHA-256, 600 000 iterations
// [ASSUMED, OWASP Password Storage Cheat Sheet 2023] — the caller may lower
// this for tests (`iterationen`), production code never does. The passphrase
// itself is never stored anywhere, by design (D-P80-15: "Passphrase weg =
// Sicherung weg").
//
// Format v1: { schema: 1, app: "bit-atelier-personal", verschluesselt: true,
//   exportiert: <ISO>, kdf: {name:"PBKDF2", hash:"SHA-256", iterationen, salz},
//   iv: <base64>, daten: <base64 AES-GCM ciphertext> }.
// The plaintext the ciphertext holds is { daten: personalDbAuslesen(),
// dateien: personalDbDateienAuslesen(), einstellungen: [{key, value}, …] } —
// the HR Setting rows travel INSIDE the encrypted payload, never as a plain
// top-level field, because a `separat` export area (src/lib/exportBereiche.js,
// 79-12) never lets its own Setting rows into `.bitproj` even in a full backup.
//
// In:  the personal collections/files (personalDb.js), a passphrase, the
//      Setting keys the caller (Task 7b's PERSONAL_EXPORT_BEREICH) wants
//      carried along.
// Out: serialisierePersonal, lesePersonalDatei, parsePersonalDatei,
//      vorschauPersonal, exportPersonal, importPersonal.

import { personalDbAuslesen, personalDbDateienAuslesen, personalDbErsetzen, personalMeta } from "./personalDb.js";
import { leseEinstellung, setzeEinstellung } from "../lib/useEinstellung.js";
import { heuteLokal } from "../lib/kalender/datum.js";

/** Current file format version. */
export const SCHEMA = 1;
export const DATEI_ENDUNG = ".bitpers";
const APP_KENNUNG = "bit-atelier-personal";
/** [ASSUMED] OWASP Password Storage Cheat Sheet (2023) recommendation for PBKDF2-SHA-256. */
export const PBKDF2_ITERATIONEN_STANDARD = 600000;

/**
 * Uint8Array → base64 via the binary-string dance (btoa/atob) — available in
 * both the browser and Node ≥ 18 as globals, no dependency either way. HR
 * payloads are small (an office's personnel data), so the per-byte loop costs
 * nothing worth optimising for.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function bytesZuBase64(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/**
 * base64 → Uint8Array (Gegenstück zu bytesZuBase64).
 * @param {string} b64
 * @returns {Uint8Array}
 */
function base64ZuBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Derives an AES-GCM 256 key from a passphrase (PBKDF2-SHA-256).
 * @param {string} passphrase
 * @param {Uint8Array} salz
 * @param {number} iterationen
 * @returns {Promise<CryptoKey>}
 */
async function schluesselAbleiten(passphrase, salz, iterationen) {
  const roh = await globalThis.crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return globalThis.crypto.subtle.deriveKey(
    // Cast: lib.dom's BufferSource wants a Uint8Array<ArrayBuffer> specifically;
    // a JSDoc-typed plain Uint8Array is the broader Uint8Array<ArrayBufferLike> —
    // functionally identical at runtime (getRandomValues/base64ZuBytes always
    // hand back a real ArrayBuffer-backed view), the cast only narrows the type.
    { name: "PBKDF2", salt: /** @type {any} */ (salz), iterations: iterationen, hash: "SHA-256" },
    roh,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * @typedef {{daten: Record<string, object[]>, dateien: Record<string, object>, einstellungen: Array<{key: string, value: unknown}>}} PersonalInhalt
 */
/**
 * @typedef {{schema: number, app: string, verschluesselt: true, exportiert: string, kdf: {name: string, hash: string, iterationen: number, salz: string}, iv: string, daten: string}} PersonalDatei
 */

/**
 * Encrypts a personnel-backup payload. The passphrase is used once (to derive
 * the key) and never appears in the output.
 * @param {PersonalInhalt} inhalt
 * @param {string} passphrase mindestens 12 Zeichen (geprüft von der Oberfläche, Task 6) — diese Funktion selbst erzwingt keine Mindestlänge, damit sie auch für Tests mit kurzen Werten nutzbar bleibt
 * @param {{iterationen?: number}} [optionen] `iterationen` niedriger nur in Tests — Produktionscode lässt PBKDF2_ITERATIONEN_STANDARD
 * @returns {Promise<PersonalDatei>}
 */
export async function serialisierePersonal(inhalt, passphrase, { iterationen = PBKDF2_ITERATIONEN_STANDARD } = {}) {
  const salz = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const schluessel = await schluesselAbleiten(passphrase, salz, iterationen);
  const klartext = new TextEncoder().encode(JSON.stringify(inhalt));
  const chiffrat = await globalThis.crypto.subtle.encrypt({ name: "AES-GCM", iv }, schluessel, klartext);
  return {
    schema: SCHEMA,
    app: APP_KENNUNG,
    verschluesselt: true,
    exportiert: new Date().toISOString(),
    kdf: { name: "PBKDF2", hash: "SHA-256", iterationen, salz: bytesZuBase64(salz) },
    iv: bytesZuBase64(iv),
    daten: bytesZuBase64(new Uint8Array(chiffrat)),
  };
}

/**
 * Decrypts a `.bitpers` file object. A wrong passphrase or a manipulated file
 * fails identically (the GCM authentication tag does not verify) — the message
 * deliberately does not distinguish the two, so it never confirms to an
 * attacker which one it was.
 * @param {PersonalDatei} obj result of parsePersonalDatei()
 * @param {string} passphrase
 * @returns {Promise<PersonalInhalt>}
 * @throws {Error} "Passphrase falsch oder Datei beschädigt."
 */
export async function lesePersonalDatei(obj, passphrase) {
  try {
    const salz = base64ZuBytes(obj.kdf.salz);
    const iv = base64ZuBytes(obj.iv);
    const schluessel = await schluesselAbleiten(passphrase, salz, obj.kdf.iterationen);
    const chiffrat = base64ZuBytes(obj.daten);
    const klartext = await globalThis.crypto.subtle.decrypt({ name: "AES-GCM", iv: /** @type {any} */ (iv) }, schluessel, /** @type {any} */ (chiffrat));
    return JSON.parse(new TextDecoder().decode(klartext));
  } catch {
    throw new Error("Passphrase falsch oder Datei beschädigt.");
  }
}

/**
 * Parses raw `.bitpers` bytes/text, or accepts an already-parsed object
 * (e.g. to reject a `.bitproj` object passed by mistake) — rejects anything
 * that is not this format's `app` marker. `projektDatei.js`'s own
 * `parseProjektDatei` already rejects a `.bitpers` file the same way (its
 * `app` check, unrelated to this function, no change needed there — Task 3
 * acceptance criterion, covered by projektDatei.test.js unchanged).
 * @param {ArrayBuffer|Uint8Array|object} roh
 * @returns {PersonalDatei}
 * @throws {Error} "Diese Datei ist keine Personal-Sicherung von BIT-Atelier."
 */
export function parsePersonalDatei(roh) {
  let obj;
  if (roh instanceof Uint8Array || roh instanceof ArrayBuffer) {
    const bytes = roh instanceof Uint8Array ? roh : new Uint8Array(roh);
    const text = new TextDecoder().decode(bytes);
    try {
      obj = JSON.parse(text);
    } catch {
      throw new Error("Die Datei ist keine gültige Personal-Sicherung (JSON nicht lesbar).");
    }
  } else {
    obj = roh;
  }
  if (!obj || obj.app !== APP_KENNUNG) {
    throw new Error("Diese Datei ist keine Personal-Sicherung von BIT-Atelier.");
  }
  return /** @type {PersonalDatei} */ (obj);
}

/**
 * Record counts per entity, for the import preview (compared against the
 * current state before anything is overwritten — same "nothing unseen"
 * principle as projektDatei.js's vorschau()).
 * @param {PersonalInhalt} inhalt result of lesePersonalDatei()
 * @returns {Record<string, number>}
 */
export function vorschauPersonal(inhalt) {
  /** @type {Record<string, number>} */
  const anzahl = {};
  for (const [entitaet, zeilen] of Object.entries(inhalt?.daten || {})) anzahl[entitaet] = Array.isArray(zeilen) ? zeilen.length : 0;
  return anzahl;
}

/**
 * Triggers a `.bitpers` download of the whole personal storage class plus the
 * given HR Setting rows, and stamps `personalMeta('letzte_sicherung', heute)`
 * — the "vor N Tagen ungesichert" nudge (Task 6) reads only this marker, never
 * a file the browser cannot see again after the download.
 * @param {string} passphrase
 * @param {{settingKeys?: string[], settingClient?: any}} [optionen] settingKeys: exact keys from PERSONAL_EXPORT_BEREICH.settingKeys (Task 7b) — this module cannot import that registry itself (the package-boundary rule forbids importing the app alias from a package), so the caller supplies the list; settingClient: injectable Setting client for unit tests (default is bitApi.entities.Setting, via leseEinstellung's own default)
 * @returns {Promise<string>} the file name offered to the browser
 */
export async function exportPersonal(passphrase, { settingKeys = [], settingClient } = {}) {
  const daten = await personalDbAuslesen();
  const dateien = await personalDbDateienAuslesen();
  const einstellungen = [];
  for (const key of settingKeys) {
    // eslint-disable-next-line no-await-in-loop -- small, fixed list of HR setting rows
    const { zeile } = settingClient ? await leseEinstellung(key, settingClient) : await leseEinstellung(key);
    if (zeile) einstellungen.push({ key, value: zeile.value });
  }
  const obj = await serialisierePersonal({ daten, dateien, einstellungen }, passphrase);
  const text = JSON.stringify(obj);
  const tag = new Date().toISOString().slice(0, 10);
  const dateiname = `bit-atelier-personal_${tag}${DATEI_ENDUNG}`;

  if (typeof document !== "undefined") {
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = dateiname;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const heute = heuteLokal();
  await personalMeta("letzte_sicherung", heute);
  return dateiname;
}

/**
 * Restores a `.bitpers` backup: decrypts it (same passphrase check as
 * lesePersonalDatei — a wrong passphrase throws and touches nothing), replaces
 * EVERY personal collection and file (personalDbErsetzen clears first, same as
 * a `.bitproj` import replaces demoDb's collections), then writes back only
 * the HR Setting rows whose key is in `settingKeys` — a whitelist, so a
 * tampered or foreign file cannot smuggle an unrelated Setting key back in
 * (e.g. `briefkopf`). Decrypts again rather than reusing an earlier preview's
 * plaintext on purpose: the decrypted content never needs to live longer than
 * the call that uses it.
 * @param {PersonalDatei} obj result of parsePersonalDatei() — the still-encrypted file object
 * @param {string} passphrase
 * @param {{settingKeys?: string[], settingClient?: any}} [optionen] settingClient: injectable Setting client for unit tests
 * @returns {Promise<void>}
 * @throws {Error} "Passphrase falsch oder Datei beschädigt." (nothing is written)
 */
export async function importPersonal(obj, passphrase, { settingKeys = [], settingClient } = {}) {
  const inhalt = await lesePersonalDatei(obj, passphrase);
  await personalDbErsetzen(inhalt?.daten || {}, inhalt?.dateien || {});
  const erlaubt = new Set(settingKeys);
  for (const zeile of Array.isArray(inhalt?.einstellungen) ? inhalt.einstellungen : []) {
    if (zeile && erlaubt.has(zeile.key)) {
      // eslint-disable-next-line no-await-in-loop -- small, fixed list
      if (settingClient) await setzeEinstellung(zeile.key, zeile.value, settingClient);
      else await setzeEinstellung(zeile.key, zeile.value);
    }
  }
}
