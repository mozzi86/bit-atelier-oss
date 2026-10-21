// 104-09: incremental ("appending") PDF writer — own implementation, no new dependency.
//
// Why: pdf-lib (1.17) can only rewrite a whole file (doc.save() renumbers and re-serialises every
// object). That changes bytes the user never touched and breaks anything that relies on them
// (signatures, checksums, "is this still the file the client sent?"). PDF itself has the answer
// (ISO 32000-1 § 7.5.6 "Incremental Updates"): leave the original bytes alone and append a section
// with the changed/new objects, a new cross-reference section whose trailer points back with /Prev,
// and a new startxref. Readers follow the newest trailer; the first N bytes stay the original file.
//
// This module is the format layer only: it reads the last startxref / trailer of a file, serialises
// pdf-lib objects (pdf-lib parses the original and builds the objects; its parser is a linear scan in
// which later definitions win, so it reads our updates back as well) and appends them with a classic
// xref table or — when the file already uses one — a cross-reference stream (§ 7.5.8). anhangPruefen()
// checks the appended section strictly (every offset points at "n g obj"), because pdf-lib's tolerant
// scanner would also accept a broken table.
//
// In:  original bytes (Uint8Array), a pdf-lib PDFContext of the same file, the objects to write.
// Out: new bytes = original + update section (Uint8Array); checks as plain objects.

import { PDFName } from "pdf-lib";

const KODIERER = new TextEncoder();

/**
 * Bytes as Latin-1 text (1 byte = 1 char), for searching the ASCII keywords of the PDF syntax.
 * @param {Uint8Array} bytes
 * @param {number} von start offset, bytes
 * @param {number} bis end offset (exclusive), bytes
 * @returns {string}
 */
function latin1(bytes, von, bis) {
  let s = "";
  const ende = Math.min(bis, bytes.length);
  for (let i = Math.max(0, von); i < ende; i += 0x4000) {
    s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, Math.min(ende, i + 0x4000))));
  }
  return s;
}

/**
 * Byte search for an ASCII keyword (no full-text decode of large files).
 * @param {Uint8Array} bytes
 * @param {string} muster ASCII keyword
 * @param {number} ab start offset, bytes
 * @returns {number} offset of the first match or -1
 */
function suche(bytes, muster, ab) {
  const m = KODIERER.encode(muster);
  outer: for (let i = Math.max(0, ab); i <= bytes.length - m.length; i += 1) {
    for (let j = 0; j < m.length; j += 1) if (bytes[i + j] !== m[j]) continue outer;
    return i;
  }
  return -1;
}

/**
 * Offset of the newest cross-reference section: the number after the LAST "startxref" in the file tail.
 * @param {Uint8Array} bytes whole PDF
 * @returns {number} byte offset
 * @throws {Error} plain-text message when the file has no usable startxref (damaged or truncated)
 */
export function letzteStartxref(bytes) {
  const start = Math.max(0, bytes.length - 4096); // spec: %%EOF within the last 1024 bytes — generous margin
  const schwanz = latin1(bytes, start, bytes.length);
  const i = schwanz.lastIndexOf("startxref");
  if (i < 0) throw new Error("PDF hat kein „startxref“ — Datei beschädigt oder unvollständig.");
  const m = /^startxref\s+(\d+)/.exec(schwanz.slice(i));
  if (!m) throw new Error("PDF: „startxref“ ohne gültige Position.");
  const off = Number(m[1]);
  if (!(off >= 0 && off < bytes.length)) throw new Error("PDF: „startxref“ zeigt außerhalb der Datei.");
  return off;
}

/**
 * Reads the kind and /Size of the cross-reference section at `offset` (classic "xref" table with a
 * "trailer" dictionary, or a cross-reference stream object).
 * @param {Uint8Array} bytes whole PDF
 * @param {number} offset byte offset of the section (letzteStartxref)
 * @returns {{art: "tabelle"|"stream", groesse: number}} groesse = trailer /Size (highest object number + 1)
 * @throws {Error} plain-text message when neither form is found or /Size is missing
 */
export function xrefAbschnitt(bytes, offset) {
  const kopf = latin1(bytes, offset, offset + 64).replace(/^\s+/, "");
  if (kopf.startsWith("xref")) {
    const t = suche(bytes, "trailer", offset);
    if (t < 0) throw new Error("PDF: Querverweistabelle ohne „trailer“.");
    const ende = suche(bytes, "startxref", t);
    const text = latin1(bytes, t, ende > 0 ? ende : t + 4096);
    const m = /\/Size\s+(\d+)/.exec(text);
    if (!m) throw new Error("PDF: Trailer ohne /Size.");
    return { art: "tabelle", groesse: Number(m[1]) };
  }
  if (/^\d+\s+\d+\s+obj/.test(kopf)) {
    const s = suche(bytes, "stream", offset);
    const text = latin1(bytes, offset, s > 0 ? s : offset + 4096);
    if (!/\/Type\s*\/XRef/.test(text)) throw new Error("PDF: „startxref“ zeigt auf kein Querverweis-Objekt.");
    const m = /\/Size\s+(\d+)/.exec(text);
    if (!m) throw new Error("PDF: Querverweis-Stream ohne /Size.");
    return { art: "stream", groesse: Number(m[1]) };
  }
  throw new Error("PDF: „startxref“ zeigt weder auf „xref“ noch auf ein Objekt.");
}

/**
 * Serialised bytes of one pdf-lib object (dictionary, array, stream …) exactly as pdf-lib writes it.
 * @param {any} objekt PDFObject
 * @returns {Uint8Array}
 */
function objektBytes(objekt) {
  const puffer = new Uint8Array(objekt.sizeInBytes());
  objekt.copyBytesInto(puffer, 0);
  return puffer;
}

/**
 * Runs of consecutive object numbers, for the xref subsections / the /Index array.
 * @param {number[]} nummern sorted ascending, unique
 * @returns {Array<[number, number]>} [first number, count]
 */
function laeufe(nummern) {
  /** @type {Array<[number, number]>} */
  const out = [];
  for (const n of nummern) {
    const letzter = out[out.length - 1];
    if (letzter && letzter[0] + letzter[1] === n) letzter[1] += 1;
    else out.push([n, 1]);
  }
  return out;
}

/**
 * One changed or new indirect object of an update.
 * @typedef {object} AnhangObjekt
 * @property {import("pdf-lib").PDFRef} ref object number + generation (existing number = replaced object)
 * @property {any} objekt pdf-lib PDFObject to write under that number
 */

/**
 * Appends one incremental-update section to `original` and returns the whole new file. The original
 * bytes are copied unchanged (the result's first original.length bytes ARE the original); behind them
 * come the objects, a cross-reference section of the same kind as the file's newest one, and the
 * trailer with /Prev → the previous section, /Root /Info /ID taken over from the context.
 * Writes nothing when `objekte` is empty (returns null) — an empty update would only add noise.
 * @param {Uint8Array} original the current file (may already contain earlier updates)
 * @param {any} kontext pdf-lib PDFContext of `original` (trailerInfo and object factory are used)
 * @param {AnhangObjekt[]} objekte changed and new objects; numbers must be unique
 * @returns {{bytes: Uint8Array, angehaengt: number, xref: number, art: "tabelle"|"stream", groesse: number}|null}
 *   angehaengt = bytes added; xref = offset of the new section; groesse = new trailer /Size
 */
export function anhangSchreiben(original, kontext, objekte) {
  if (!objekte.length) return null;
  const prev = letzteStartxref(original);
  const { art, groesse: groesseAlt } = xrefAbschnitt(original, prev);
  const sortiert = [...objekte].sort((a, b) => a.ref.objectNumber - b.ref.objectNumber);
  for (let i = 1; i < sortiert.length; i += 1) {
    if (sortiert[i].ref.objectNumber === sortiert[i - 1].ref.objectNumber) {
      throw new Error(`Objekt ${sortiert[i].ref.objectNumber} doppelt im Anhang.`);
    }
  }

  /** @type {Uint8Array[]} */
  const teile = [];
  let pos = original.length;
  const anfuegen = (/** @type {Uint8Array|string} */ t) => {
    const u = typeof t === "string" ? KODIERER.encode(t) : t;
    teile.push(u);
    pos += u.length;
  };
  // The update starts on a fresh line; the newline belongs to the update, the original stays as is.
  const letztes = original[original.length - 1];
  if (letztes !== 0x0a && letztes !== 0x0d) anfuegen("\n");

  /** @type {Array<{num: number, gen: number, off: number}>} */
  const eintraege = [];
  for (const { ref, objekt } of sortiert) {
    eintraege.push({ num: ref.objectNumber, gen: ref.generationNumber, off: pos });
    anfuegen(`${ref.objectNumber} ${ref.generationNumber} obj\n`);
    anfuegen(objektBytes(objekt));
    anfuegen("\nendobj\n");
  }
  let groesse = Math.max(groesseAlt, sortiert[sortiert.length - 1].ref.objectNumber + 1);
  const { Root, Info, ID } = kontext.trailerInfo || {};
  if (!Root) throw new Error("PDF: Trailer ohne /Root — Anhängen nicht möglich.");

  let xref;
  if (art === "stream") {
    // Cross-reference stream (§ 7.5.8): the stream object gets the next free number and lists itself.
    const xnum = groesse;
    groesse += 1;
    xref = pos;
    eintraege.push({ num: xnum, gen: 0, off: xref });
    eintraege.sort((a, b) => a.num - b.num);
    const maxOff = Math.max(...eintraege.map((e) => e.off));
    let breite = 1;
    while (maxOff >= 2 ** (8 * breite)) breite += 1;
    const daten = new Uint8Array(eintraege.length * (1 + breite + 2));
    eintraege.forEach((e, i) => {
      let o = i * (1 + breite + 2);
      daten[o++] = 1; // type 1 = in use, uncompressed
      for (let b = breite - 1; b >= 0; b -= 1) daten[o++] = Math.floor(e.off / 2 ** (8 * b)) % 256;
      daten[o++] = (e.gen >> 8) & 0xff;
      daten[o] = e.gen & 0xff;
    });
    const index = laeufe(eintraege.map((e) => e.num)).flat();
    /** @type {Record<string, any>} */
    const dict = { Type: "XRef", Size: groesse, Index: index, W: [1, breite, 2], Root, Prev: prev };
    if (Info) dict.Info = Info;
    if (ID) dict.ID = ID;
    anfuegen(`${xnum} 0 obj\n`);
    anfuegen(objektBytes(kontext.stream(daten, dict)));
    anfuegen("\nendobj\n");
  } else {
    xref = pos;
    let text = "xref\n";
    let i = 0;
    for (const [start, anzahl] of laeufe(eintraege.map((e) => e.num))) {
      text += `${start} ${anzahl}\n`;
      for (let k = 0; k < anzahl; k += 1, i += 1) {
        const e = eintraege[i];
        // Fixed 20-byte entry (§ 7.5.4): 10-digit offset, 5-digit generation, "n", two-char EOL.
        text += `${String(e.off).padStart(10, "0")} ${String(e.gen).padStart(5, "0")} n\r\n`;
      }
    }
    const trailer = kontext.obj({ Size: groesse, Root, Prev: prev });
    if (Info) trailer.set(PDFName.of("Info"), Info);
    if (ID) trailer.set(PDFName.of("ID"), ID);
    anfuegen(text);
    anfuegen("trailer\n");
    anfuegen(objektBytes(trailer));
    anfuegen("\n");
  }
  anfuegen(`startxref\n${xref}\n%%EOF\n`);

  const bytes = new Uint8Array(pos);
  bytes.set(original, 0);
  let o = original.length;
  for (const t of teile) { bytes.set(t, o); o += t.length; }
  return { bytes, angehaengt: pos - original.length, xref, art, groesse };
}

/**
 * True when `bytes` begins with exactly the bytes of `original` (the guarantee of this plan).
 * @param {Uint8Array} bytes new file
 * @param {Uint8Array} original
 * @returns {boolean}
 */
export function beginntMit(bytes, original) {
  if (bytes.length < original.length) return false;
  for (let i = 0; i < original.length; i += 1) if (bytes[i] !== original[i]) return false;
  return true;
}

/**
 * Strict check of the NEWEST cross-reference section (as written by anhangSchreiben, uncompressed):
 * every in-use entry must point at "<num> <gen> obj", /Prev must point at an "xref" keyword or an
 * object, and the file must end with %%EOF. pdf-lib alone would not notice a wrong offset (its parser
 * scans the file linearly) — pdf.js and Acrobat would, so this is checked before anything is stored.
 * A compressed (filtered) cross-reference stream is reported as not checkable instead of guessed.
 * @param {Uint8Array} bytes whole PDF
 * @returns {{ok: boolean, fehler: string[], eintraege: number, prev: number|null, art: "tabelle"|"stream"|null}}
 */
export function anhangPruefen(bytes) {
  /** @type {string[]} */
  const fehler = [];
  let eintraege = 0;
  let prev = null;
  /** @type {"tabelle"|"stream"|null} */
  let art = null;
  const zeigtAufObjekt = (/** @type {number} */ off, /** @type {number} */ num, /** @type {number} */ gen) =>
    new RegExp(`^${num}\\s+${gen}\\s+obj\\b`).test(latin1(bytes, off, off + 32));
  try {
    if (!/%%EOF\s*$/.test(latin1(bytes, bytes.length - 32, bytes.length))) fehler.push("Datei endet nicht mit %%EOF");
    const x = letzteStartxref(bytes);
    art = xrefAbschnitt(bytes, x).art;
    if (art === "tabelle") {
      const t = suche(bytes, "trailer", x);
      const tabelle = latin1(bytes, x, t).replace(/^\s*xref\s*/, "");
      const zeilen = tabelle.split(/\r\n|\r|\n/).map((z) => z.trim()).filter(Boolean);
      let num = 0;
      let rest = 0;
      for (const z of zeilen) {
        const kopf = /^(\d+)\s+(\d+)$/.exec(z);
        if (rest === 0 && kopf) { num = Number(kopf[1]); rest = Number(kopf[2]); continue; }
        const e = /^(\d{10})\s+(\d{5})\s+([nf])$/.exec(z);
        if (!e) { fehler.push(`Ungültige Querverweis-Zeile „${z}“`); break; }
        if (e[3] === "n") {
          eintraege += 1;
          if (!zeigtAufObjekt(Number(e[1]), num, Number(e[2]))) fehler.push(`Objekt ${num}: Position ${Number(e[1])} zeigt nicht auf „${num} ${Number(e[2])} obj“`);
        }
        num += 1;
        rest -= 1;
      }
      const tr = latin1(bytes, t, suche(bytes, "startxref", t));
      const p = /\/Prev\s+(\d+)/.exec(tr);
      prev = p ? Number(p[1]) : null;
    } else {
      const s = suche(bytes, "stream", x);
      const dictText = latin1(bytes, x, s);
      if (/\/Filter/.test(dictText)) {
        fehler.push("Querverweis-Stream ist komprimiert — nicht prüfbar");
      } else {
        const w = /\/W\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(dictText);
        const idx = /\/Index\s*\[([\d\s]+)\]/.exec(dictText);
        const groesse = Number((/\/Size\s+(\d+)/.exec(dictText) || [])[1] || 0);
        const p = /\/Prev\s+(\d+)/.exec(dictText);
        prev = p ? Number(p[1]) : null;
        if (!w) fehler.push("Querverweis-Stream ohne /W");
        else {
          const [w1, w2, w3] = [Number(w[1]), Number(w[2]), Number(w[3])];
          const zahlen = idx ? idx[1].trim().split(/\s+/).map(Number) : [0, groesse];
          let start = s + "stream".length;
          if (bytes[start] === 0x0d) start += 1;
          if (bytes[start] === 0x0a) start += 1;
          const lesen = (/** @type {number} */ o, /** @type {number} */ n) => { let v = 0; for (let k = 0; k < n; k += 1) v = v * 256 + bytes[o + k]; return v; };
          let o = start;
          for (let i = 0; i < zahlen.length; i += 2) {
            for (let k = 0; k < zahlen[i + 1]; k += 1) {
              const typ = w1 ? lesen(o, w1) : 1;
              const f2 = lesen(o + w1, w2);
              const f3 = lesen(o + w1 + w2, w3);
              o += w1 + w2 + w3;
              if (typ === 1) {
                eintraege += 1;
                const num = zahlen[i] + k;
                if (!zeigtAufObjekt(f2, num, f3)) fehler.push(`Objekt ${num}: Position ${f2} zeigt nicht auf „${num} ${f3} obj“`);
              }
            }
          }
        }
      }
    }
    if (prev != null) {
      const k = latin1(bytes, prev, prev + 32).replace(/^\s+/, "");
      if (!k.startsWith("xref") && !/^\d+\s+\d+\s+obj/.test(k)) fehler.push(`/Prev ${prev} zeigt auf keinen Querverweis-Abschnitt`);
    }
  } catch (e) {
    fehler.push(String(/** @type {any} */ (e)?.message || e));
  }
  return { ok: fehler.length === 0, fehler, eintraege, prev, art };
}

/**
 * Raises the context's object counter so that new references (context.nextRef()) start behind the
 * file's trailer /Size. Needed because pdf-lib does not register the cross-reference STREAM object
 * itself (it parses it away), so its counter can be lower than numbers the file already uses.
 * @param {any} kontext pdf-lib PDFContext
 * @param {Uint8Array} bytes the file the context was loaded from
 * @returns {void}
 */
export function nummernAbSize(kontext, bytes) {
  const { groesse } = xrefAbschnitt(bytes, letzteStartxref(bytes));
  kontext.largestObjectNumber = Math.max(kontext.largestObjectNumber, groesse - 1);
}

