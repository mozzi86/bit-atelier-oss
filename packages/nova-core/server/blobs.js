// Blob-Store (Phase 33 / W0) — große Nutzlasten AUS db.json heraus.
//
// Warum: `db.json` wird bei jedem `persist()` komplett serialisiert und atomar
// ersetzt. 6.038 Bauteile mit ihren BaseQuantities darin würden jeden Schreibvorgang
// vervielfachen (T-33-03). Elemente liegen deshalb als EINZELNE Blob-Datei daneben;
// `db.json` trägt nur noch die Referenz und bleibt klein.
//
// Sicherheit: die id ist Teil eines Dateipfads ⇒ strikte Whitelist gegen
// Path-Traversal. Kein `path.join` mit ungeprüfter id.
//
// In dieser Welle wird nur die FACTORY gebaut und unit-getestet. Der Schreibweg
// (`GET/PUT /api/blobs/:id`) wird in Plan 33-02 (W3) beim Import angeschlossen.

import fs from 'node:fs';
import path from 'node:path';

// Exported for reuse (57-03): scripts/supabase-import.mjs validates blob ids
// against the SAME whitelist before uploading to Supabase Storage. One truth —
// never redefine this pattern elsewhere.
export const ID_MUSTER = /^[A-Za-z0-9_-]+$/;

export function createBlobStore(dir) {
  if (!dir) throw new Error('createBlobStore: Verzeichnis fehlt');
  const ROOT = path.resolve(dir);
  fs.mkdirSync(ROOT, { recursive: true });

  function pfad(id) {
    if (typeof id !== 'string' || !ID_MUSTER.test(id)) {
      throw new Error(
        `Blob-ID ungültig: ${JSON.stringify(id)} — erlaubt sind nur [A-Za-z0-9_-]`
      );
    }
    const p = path.join(ROOT, `${id}.json`);
    // Doppelt gesichert: der aufgelöste Pfad MUSS im Store liegen.
    if (p !== path.resolve(p) || !p.startsWith(ROOT + path.sep)) {
      throw new Error(`Blob-Pfad verlässt den Store: ${id}`);
    }
    return p;
  }

  return {
    /** JSON schreiben (atomar über tmp + rename). Gibt die Bytezahl zurück. */
    put(id, json) {
      const p = pfad(id);
      const text = JSON.stringify(json);
      const tmp = `${p}.tmp`;
      fs.writeFileSync(tmp, text, 'utf-8');
      fs.renameSync(tmp, p);
      return Buffer.byteLength(text, 'utf8');
    },

    /** JSON lesen; nicht vorhanden ⇒ null (kein Wurf). */
    get(id) {
      const p = pfad(id);
      try {
        return JSON.parse(fs.readFileSync(p, 'utf-8'));
      } catch {
        return null;
      }
    },

    has(id) {
      return fs.existsSync(pfad(id));
    },

    remove(id) {
      const p = pfad(id);
      try {
        fs.unlinkSync(p);
        return true;
      } catch {
        return false;
      }
    },

    /** Alle vorhandenen Blob-IDs. */
    list() {
      try {
        return fs
          .readdirSync(ROOT)
          .filter((f) => f.endsWith('.json'))
          .map((f) => f.slice(0, -5));
      } catch {
        return [];
      }
    },

    /** Größe in Bytes (0, wenn nicht vorhanden). */
    size(id) {
      try {
        return fs.statSync(pfad(id)).size;
      } catch {
        return 0;
      }
    },

    verzeichnis: ROOT,
  };
}
