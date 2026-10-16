// Tiny JSON-file database. No external deps — atomic-ish writes to db.json.
// Swap this module for a Supabase/Postgres adapter later without touching routes.
//
// Phase 31: Factory statt __dirname-Singleton — die Kompositionswurzel übergibt
// den Pfad (Monorepo: server/db.json; Shells: eigenes server/db.json).
//
// 96-01: optional `codec` ({encode, decode, aktiv}, ruheVerschluesselung.js) —
// the personnel store passes an AES-256-GCM codec, every other store keeps the
// plain default. A file the codec cannot decrypt (key missing or wrong) makes
// the store `gesperrt`: it serves nothing and NEVER writes, so the ciphertext
// on disk is not replaced by an empty database. Plain files from before
// encryption are read and re-written encrypted once (migration, incl. .bak).
import fs from 'fs';
import { KLARTEXT_CODEC, istVerschluesselt } from './ruheVerschluesselung.js';

/**
 * @param {string} dbPath JSON file of the store
 * @param {{codec?: {encode: (t: string) => string, decode: (t: string) => string, aktiv: boolean}}} [optionen]
 *   codec: at-rest encoding (default: plain JSON)
 */
export function createDb(dbPath, { codec = KLARTEXT_CODEC } = {}) {
  const DB_PATH = dbPath;
  const BAK_PATH = dbPath + '.bak';
  /** @type {string|null} 96-01: why the store refuses to work (undecryptable file), or null */
  let gesperrt = null;
  /** 96-01: a plain (pre-encryption) file was loaded while a codec is active → migrate. */
  let klartextGeladen = false;

  /** @param {string} pfad @returns {any} parsed content; throws on missing/corrupt/undecryptable */
  function lies(pfad) {
    const text = fs.readFileSync(pfad, 'utf-8');
    const json = JSON.parse(codec.decode(text));
    if (codec.aktiv && !istVerschluesselt(text)) klartextGeladen = true;
    return json;
  }

  function readRaw() {
    // Hauptdatei lesen; bei korruptem JSON auf das letzte Backup zurückfallen.
    let fehler = null;
    try {
      return lies(DB_PATH);
    } catch (e) {
      fehler = e;
      try {
        const fromBak = lies(BAK_PATH);
        console.warn('[db] db.json unlesbar — Backup db.json.bak geladen');
        return fromBak;
      } catch (e2) {
        // 96-01: a decryption failure is not "no data" — lock instead of starting empty.
        const entschluesselung = [fehler, e2].find((x) => /Entschlüsseln|beschädigt/.test(String(x?.message)));
        if (entschluesselung) {
          gesperrt = `${DB_PATH}: ${entschluesselung.message}`;
          console.error(`[db] GESPERRT — ${gesperrt} Es wird nichts geschrieben.`);
        }
        return {};
      }
    }
  }

  let cache = readRaw();

  // --- Schreibpfad (Phase 33 / W0, T-33-03) ---------------------------------
  // `persistNow()` ist der alte `persist()`: Backup + atomar ersetzen.
  // `schedulePersist()` bündelt Schreibvorgänge über ein kurzes Debounce-Fenster.
  // Grund: `create()` rief nach JEDEM Datensatz `persist()` mit vollem
  // copyFileSync + writeFileSync — bei ~7.400 Creates ist das O(n²).
  const PERSIST_DEBOUNCE_MS = 120;
  let persistTimer = null;
  let persistPending = false;

  function persistNow() {
    // Robustes Schreiben: erst Backup der intakten Datei, dann atomar ersetzen.
    // Fehler dürfen den Server nicht abwerfen (Daten bleiben im Speicher erhalten).
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    persistPending = false;
    if (gesperrt) {
      console.error(`[db] Schreiben verweigert (gesperrt): ${gesperrt}`);
      return;
    }
    try {
      try {
        if (fs.existsSync(DB_PATH)) fs.copyFileSync(DB_PATH, BAK_PATH);
      } catch { /* Backup best-effort */ }
      const tmp = DB_PATH + '.tmp';
      fs.writeFileSync(tmp, codec.encode(JSON.stringify(cache, null, 2)), 'utf-8');
      fs.renameSync(tmp, DB_PATH);
    } catch (e) {
      console.error('[db] Persist fehlgeschlagen (Daten bleiben im Speicher):', e?.message || e);
    }
  }

  function schedulePersist() {
    persistPending = true;
    if (persistTimer) return;
    persistTimer = setTimeout(() => {
      persistTimer = null;
      if (persistPending) persistNow();
    }, PERSIST_DEBOUNCE_MS);
    // Ein ausstehendes Debounce darf den Prozess nicht offen halten.
    if (typeof persistTimer?.unref === 'function') persistTimer.unref();
  }

  // Beim Beenden nichts verlieren.
  if (typeof process !== 'undefined' && typeof process.on === 'function') {
    process.on('exit', () => {
      if (persistPending) persistNow();
    });
    // 87-02: Ctrl-C / `concurrently --kill-others` send SIGINT/SIGTERM — on Windows
    // that path did not always reach 'exit', and the 120 ms debounce was lost.
    // Flush, step aside, and re-raise the signal when nobody else handles it, so
    // the default termination still happens (a db must not keep a process alive).
    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.once(signal, () => {
        if (persistPending) persistNow();
        if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
      });
    }
  }

  // 96-01 migration: a plain file under an active codec is re-written encrypted at
  // once, and a plain .bak is replaced by a copy of the encrypted file (otherwise
  // the previous state would stay readable next to it).
  if (codec.aktiv && !gesperrt) {
    if (klartextGeladen && fs.existsSync(DB_PATH)) persistNow();
    try {
      if (fs.existsSync(BAK_PATH) && fs.existsSync(DB_PATH) && !istVerschluesselt(fs.readFileSync(BAK_PATH, 'utf-8'))) {
        fs.copyFileSync(DB_PATH, BAK_PATH);
      }
    } catch (e) {
      console.error('[db] Backup konnte nicht verschlüsselt werden:', e?.message || e);
    }
  }

  // Bestehende Aufrufer erwarten synchrones Verhalten NICHT — sie erwarten nur,
  // dass geschrieben wird. `persist` bleibt daher der Name im Code unten und
  // zeigt jetzt auf den gebündelten Schreibvorgang.
  const persist = schedulePersist;

  function id() {
    // Compact unique id (timestamp + random), good enough for a local app.
    return (
      Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    );
  }

  function collection(name) {
    if (!cache[name]) {
      cache[name] = [];
      persist();
    }
    return cache[name];
  }

  // Order helper: accepts a bitApi-style sort string like "-created_date" or "name".
  function sortRecords(records, sortStr) {
    if (!sortStr) return records;
    const desc = sortStr.startsWith('-');
    const field = desc ? sortStr.slice(1) : sortStr;
    return [...records].sort((a, b) => {
      const av = a?.[field];
      const bv = b?.[field];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return desc ? 1 : -1;
      if (av > bv) return desc ? -1 : 1;
      return 0;
    });
  }

  function matchesQuery(record, query) {
    // Tolerant equality, same rule as demoDb.filter (57-02): URL queries via
    // req.query ALWAYS arrive as strings, so strict === found nothing for
    // number/boolean fields (e.g. ?aktiv=true never matched aktiv:true). The
    // strict check stays first so identical JS values short-circuit; the
    // String() fallback makes express, demo and PostgREST (data->>k text
    // comparison) agree — measured by the parity test in abfrage.test.js.
    return Object.entries(query).every(
      ([k, v]) => record?.[k] === v || String(record?.[k]) === String(v)
    );
  }

  return {
    list(entity, sort) {
      return sortRecords(collection(entity), sort);
    },

    filter(entity, query = {}, sort) {
      const filtered = collection(entity).filter((r) => matchesQuery(r, query));
      return sortRecords(filtered, sort);
    },

    get(entity, recordId) {
      return collection(entity).find((r) => r.id === recordId) || null;
    },

    create(entity, data) {
      const now = new Date().toISOString();
      const record = {
        id: id(),
        created_date: now,
        updated_date: now,
        ...data,
      };
      collection(entity).push(record);
      persist();
      return record;
    },

    // Viele Datensätze, GENAU EIN Schreibvorgang (G19). API-kompatibel additiv.
    bulkCreate(entity, records) {
      const liste = Array.isArray(records) ? records : [];
      const col = collection(entity);
      const now = new Date().toISOString();
      const angelegt = [];
      for (const data of liste) {
        const record = { id: id(), created_date: now, updated_date: now, ...data };
        col.push(record);
        angelegt.push(record);
      }
      // Ein einziger Schreibvorgang am Ende — nicht einer je Datensatz.
      persistNow();
      return angelegt;
    },

    // Vorhandene aktualisieren, neue anlegen — ein Schreibvorgang.
    bulkUpsert(entity, records, key = 'id') {
      const liste = Array.isArray(records) ? records : [];
      const col = collection(entity);
      const now = new Date().toISOString();
      const index = new Map();
      col.forEach((r, i) => {
        if (r?.[key] !== undefined) index.set(r[key], i);
      });
      let updated = 0;
      const created = [];
      for (const data of liste) {
        const k = data?.[key];
        const pos = k !== undefined ? index.get(k) : undefined;
        if (pos !== undefined) {
          col[pos] = { ...col[pos], ...data, id: col[pos].id, updated_date: now };
          updated += 1;
        } else {
          const record = { id: id(), created_date: now, updated_date: now, ...data };
          col.push(record);
          if (k !== undefined) index.set(k, col.length - 1);
          created.push(record);
        }
      }
      persistNow();
      return { updated, created };
    },

    // Erzwingt einen ausstehenden Debounce-Write (Tests, Shutdown).
    flush() {
      if (persistPending) persistNow();
      return true;
    },

    update(entity, recordId, data) {
      const col = collection(entity);
      const idx = col.findIndex((r) => r.id === recordId);
      if (idx === -1) return null;
      col[idx] = {
        ...col[idx],
        ...data,
        id: recordId,
        updated_date: new Date().toISOString(),
      };
      persist();
      return col[idx];
    },

    remove(entity, recordId) {
      const col = collection(entity);
      const idx = col.findIndex((r) => r.id === recordId);
      if (idx === -1) return false;
      col.splice(idx, 1);
      persist();
      return true;
    },

    // Replace the whole DB (used by the seeder). Synchron — der Seeder erwartet,
    // dass die Datei nach dem Aufruf auf der Platte steht.
    _reset(data) {
      cache = data;
      persistNow();
    },

    _raw() {
      return cache;
    },

    /** 96-01: reason the store is locked (undecryptable file), or null. @returns {string|null} */
    gesperrt() {
      return gesperrt;
    },
  };
}
