// Encryption at rest for the personnel store (plan 96-01). personal.json and
// personal-blobs/*.json held employment contracts, salaries and ID scans as
// plain JSON — readable by anyone who got the data folder, e.g. through a
// cloud-synced folder or a copied backup. They are now written as
// AES-256-GCM ciphertext; the server decrypts in memory, so routes and the
// .bitpers export (its own passphrase encryption) are unchanged.
//
// Key: 32 random bytes in a key file OUTSIDE the data folder (default: the
// user's config directory, see standardSchluesselPfad). A key next to the
// ciphertext — in the data folder or inside every backup zip — would protect
// nothing. No password at start-up (a single-seat office app must start
// unattended); the file is created with owner-only permissions where the OS
// supports them.
//
// Never lose data: a missing key is only CREATED when no encrypted personnel
// file exists yet. Encrypted data without its key make the store refuse to
// write (createDb `gesperrt`) instead of starting empty and overwriting the
// ciphertext. Plain files from before 96-01 are still read and re-written
// encrypted (migration).
//
// File format: the text "BITENC1:" followed by base64(iv[12] | tag[16] | ciphertext).
//
// In:  key file path, env, platform. Out: standardSchluesselPfad, ladeSchluessel,
//      verschluesselungsCodec, istVerschluesselt, KLARTEXT_CODEC. Only node:crypto/fs/path.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/** Prefix that marks an encrypted file (also the format version). */
export const MAGIC = 'BITENC1:';

/** Key length in bytes (AES-256). */
const SCHLUESSEL_BYTES = 32;
/** GCM nonce length in bytes (NIST SP 800-38D recommends 96 bit). */
const IV_BYTES = 12;
/** GCM authentication tag length in bytes. */
const TAG_BYTES = 16;

/**
 * Codec that changes nothing — the default of createDb/createBlobStore.
 * @type {{encode: (text: string) => string, decode: (text: string) => string, aktiv: false}}
 */
export const KLARTEXT_CODEC = Object.freeze({ encode: (t) => t, decode: (t) => t, aktiv: false });

/**
 * Whether a stored text is in the encrypted format.
 * @param {string} text file content
 * @returns {boolean}
 */
export function istVerschluesselt(text) {
  return typeof text === 'string' && text.startsWith(MAGIC);
}

/**
 * Default location of the personnel key: BIT_PERSONAL_SCHLUESSEL wins; else the
 * per-user config directory (Windows %APPDATA%\BIT-Atelier, macOS
 * ~/Library/Application Support/BIT-Atelier, else $XDG_CONFIG_HOME or ~/.config /bit-atelier).
 * @param {{env?: Record<string, string|undefined>, plattform?: string, home?: string}} [umgebung] injectable for tests
 * @returns {string} absolute path of the key file
 */
export function standardSchluesselPfad({ env = process.env, plattform = process.platform, home = os.homedir() } = {}) {
  if (env.BIT_PERSONAL_SCHLUESSEL) return path.resolve(env.BIT_PERSONAL_SCHLUESSEL);
  if (plattform === 'win32') return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'BIT-Atelier', 'personal.key');
  if (plattform === 'darwin') return path.join(home, 'Library', 'Application Support', 'BIT-Atelier', 'personal.key');
  return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'bit-atelier', 'personal.key');
}

/**
 * Reads the key file, or creates it when `erzeugen` is true and it is missing.
 * @param {string} pfad key file path
 * @param {{erzeugen?: boolean}} [optionen] erzeugen: create a new random key if the file is missing
 * @returns {Buffer|null} 32-byte key; null when missing and not created
 * @throws {Error} plain-text message when the file exists but is not a valid key
 */
export function ladeSchluessel(pfad, { erzeugen = false } = {}) {
  if (fs.existsSync(pfad)) {
    const roh = fs.readFileSync(pfad, 'utf-8').trim();
    const key = Buffer.from(roh, 'base64');
    if (key.length !== SCHLUESSEL_BYTES) throw new Error(`Personal-Schlüssel ${pfad} ist ungültig (erwartet ${SCHLUESSEL_BYTES} Byte, base64).`);
    return key;
  }
  if (!erzeugen) return null;
  const key = crypto.randomBytes(SCHLUESSEL_BYTES);
  fs.mkdirSync(path.dirname(pfad), { recursive: true });
  // wx: never overwrite a key another process created in the meantime.
  fs.writeFileSync(pfad, key.toString('base64') + '\n', { encoding: 'utf-8', mode: 0o600, flag: 'wx' });
  return key;
}

/**
 * Fingerprint of a key for display and for sicherung.json (105-12): the first 16 hex digits of SHA-256(key).
 * Lets the user check which key file belongs to a backup — it reveals nothing usable about the key itself.
 * @param {Buffer} key 32-byte key
 * @returns {string} 16 lowercase hex digits
 */
export function schluesselFingerabdruck(key) {
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
}

/**
 * AES-256-GCM codec for createDb/createBlobStore. decode() passes plain text
 * (pre-96-01 files) through unchanged so they can be migrated; it throws on a
 * tampered file or a wrong key (GCM authentication fails).
 * @param {Buffer} key 32-byte key
 * @returns {{encode: (text: string) => string, decode: (text: string) => string, aktiv: true}}
 */
export function verschluesselungsCodec(key) {
  if (!Buffer.isBuffer(key) || key.length !== SCHLUESSEL_BYTES) throw new Error('verschluesselungsCodec: 32-Byte-Schlüssel erwartet');
  return {
    aktiv: true,
    encode(text) {
      const iv = crypto.randomBytes(IV_BYTES);
      const c = crypto.createCipheriv('aes-256-gcm', key, iv);
      const daten = Buffer.concat([c.update(String(text), 'utf-8'), c.final()]);
      return MAGIC + Buffer.concat([iv, c.getAuthTag(), daten]).toString('base64');
    },
    decode(text) {
      if (!istVerschluesselt(text)) return text;
      const roh = Buffer.from(text.slice(MAGIC.length), 'base64');
      if (roh.length < IV_BYTES + TAG_BYTES) throw new Error('Verschlüsselte Datei ist beschädigt (zu kurz).');
      const d = crypto.createDecipheriv('aes-256-gcm', key, roh.subarray(0, IV_BYTES));
      d.setAuthTag(roh.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
      try {
        return Buffer.concat([d.update(roh.subarray(IV_BYTES + TAG_BYTES)), d.final()]).toString('utf-8');
      } catch {
        throw new Error('Entschlüsseln fehlgeschlagen — falscher Personal-Schlüssel oder beschädigte Datei.');
      }
    },
  };
}

/**
 * Whether any personnel file on disk is already encrypted — then a missing key
 * must NOT be replaced by a new one (the old data would become unreadable).
 * @param {string} dbPfad personal.json path
 * @param {string} blobOrdner personal-blobs directory
 * @returns {boolean}
 */
export function verschluesselteDatenVorhanden(dbPfad, blobOrdner) {
  const kopf = (p) => {
    try {
      const fd = fs.openSync(p, 'r');
      const buf = Buffer.alloc(MAGIC.length);
      fs.readSync(fd, buf, 0, MAGIC.length, 0);
      fs.closeSync(fd);
      return buf.toString('utf-8') === MAGIC;
    } catch {
      return false;
    }
  };
  if (kopf(dbPfad) || kopf(`${dbPfad}.bak`)) return true;
  try {
    return fs.readdirSync(blobOrdner).some((f) => f.endsWith('.json') && kopf(path.join(blobOrdner, f)));
  } catch {
    return false;
  }
}
