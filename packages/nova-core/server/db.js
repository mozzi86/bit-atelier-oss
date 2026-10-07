// Tiny JSON-file database. No external deps — atomic-ish writes to db.json.
// Swap this module for a Supabase/Postgres adapter later without touching routes.
//
// Phase 31: Factory statt __dirname-Singleton — die Kompositionswurzel übergibt
// den Pfad (Monorepo: server/db.json; Shells: eigenes server/db.json).
import fs from 'fs';

export function createDb(dbPath) {
  const DB_PATH = dbPath;
  const BAK_PATH = dbPath + '.bak';

  function readRaw() {
    // Hauptdatei lesen; bei korruptem JSON auf das letzte Backup zurückfallen.
    try {
      return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
    } catch {
      try {
        const fromBak = JSON.parse(fs.readFileSync(BAK_PATH, 'utf-8'));
        console.warn('[db] db.json unlesbar — Backup db.json.bak geladen');
        return fromBak;
      } catch {
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
    try {
      try {
        if (fs.existsSync(DB_PATH)) fs.copyFileSync(DB_PATH, BAK_PATH);
      } catch { /* Backup best-effort */ }
      const tmp = DB_PATH + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), 'utf-8');
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
  };
}
