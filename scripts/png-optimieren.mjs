#!/usr/bin/env node
// png-optimieren.mjs — lossless re-compression of PNG screenshots (Plan 72-06), without a
// dependency: node:zlib only.
//
// Playwright writes 8-bit RGBA PNGs with a fast deflate setting. For the visual baseline in
// the repo that wastes space. This script, per file:
//   1. reads the PNG (8-bit RGB or RGBA, not interlaced — anything else is left alone),
//   2. drops the alpha channel when every pixel is opaque (RGBA → RGB, 25 % less raw data),
//   3. chooses the row filter per scanline by the minimum-sum-of-absolute-differences rule
//      (the heuristic of the PNG spec, section 12.8),
//   4. deflates with level 9 and memLevel 9,
// and writes the file only if it got smaller. Pixels stay bit-identical (verified by
// decoding the result and comparing with the original before writing).
//
// Usage: node scripts/png-optimieren.mjs <file-or-folder> [...]
// In:  PNG files. Out: rewritten files, a size report on stdout.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const SIGNATUR = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** CRC-32 table of the PNG spec. */
const CRC_TABELLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

/** @param {Buffer} buf @returns {number} CRC-32 of the buffer */
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABELLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** @param {string} typ chunk type @param {Buffer} daten @returns {Buffer} complete chunk */
function chunk(typ, daten) {
  const kopf = Buffer.alloc(8);
  kopf.writeUInt32BE(daten.length, 0);
  kopf.write(typ, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([kopf.subarray(4), daten])), 0);
  return Buffer.concat([kopf, daten, crc]);
}

/**
 * Decodes an 8-bit RGB/RGBA non-interlaced PNG.
 * @param {Buffer} png
 * @returns {{ breite: number, hoehe: number, kanaele: number, pixel: Buffer } | null} raw pixels (no filter bytes), null if unsupported
 */
export function lesen(png) {
  if (!png.subarray(0, 8).equals(SIGNATUR)) return null;
  let pos = 8;
  let breite = 0, hoehe = 0, kanaele = 0;
  /** @type {Buffer[]} */
  const idat = [];
  while (pos < png.length) {
    const laenge = png.readUInt32BE(pos);
    const typ = png.toString("ascii", pos + 4, pos + 8);
    const daten = png.subarray(pos + 8, pos + 8 + laenge);
    if (typ === "IHDR") {
      breite = daten.readUInt32BE(0);
      hoehe = daten.readUInt32BE(4);
      const tiefe = daten[8], farbtyp = daten[9], interlace = daten[12];
      if (tiefe !== 8 || interlace !== 0 || (farbtyp !== 2 && farbtyp !== 6)) return null;
      kanaele = farbtyp === 6 ? 4 : 3;
    } else if (typ === "IDAT") idat.push(daten);
    else if (typ === "IEND") break;
    pos += 12 + laenge;
  }
  const roh = zlib.inflateSync(Buffer.concat(idat));
  const zeile = breite * kanaele;
  const pixel = Buffer.alloc(zeile * hoehe);
  for (let y = 0; y < hoehe; y++) {
    const filter = roh[y * (zeile + 1)];
    const ein = roh.subarray(y * (zeile + 1) + 1, (y + 1) * (zeile + 1));
    const aus = pixel.subarray(y * zeile, (y + 1) * zeile);
    const oben = y > 0 ? pixel.subarray((y - 1) * zeile, y * zeile) : null;
    for (let i = 0; i < zeile; i++) {
      const a = i >= kanaele ? aus[i - kanaele] : 0;
      const b = oben ? oben[i] : 0;
      const c = oben && i >= kanaele ? oben[i - kanaele] : 0;
      let v = ein[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      aus[i] = v & 0xff;
    }
  }
  return { breite, hoehe, kanaele, pixel };
}

/**
 * Encodes raw pixels as PNG with per-row adaptive filtering and deflate level 9.
 * @param {number} breite px @param {number} hoehe px @param {number} kanaele 3 or 4 @param {Buffer} pixel
 * @returns {Buffer}
 */
export function schreiben(breite, hoehe, kanaele, pixel) {
  const zeile = breite * kanaele;
  const roh = Buffer.alloc((zeile + 1) * hoehe);
  const kandidat = Buffer.alloc(zeile);
  for (let y = 0; y < hoehe; y++) {
    const akt = pixel.subarray(y * zeile, (y + 1) * zeile);
    const oben = y > 0 ? pixel.subarray((y - 1) * zeile, y * zeile) : null;
    let besterFilter = 0, besteSumme = Infinity;
    for (let f = 0; f <= 4; f++) {
      let summe = 0;
      for (let i = 0; i < zeile; i++) {
        const a = i >= kanaele ? akt[i - kanaele] : 0;
        const b = oben ? oben[i] : 0;
        const c = oben && i >= kanaele ? oben[i - kanaele] : 0;
        let pred = 0;
        if (f === 1) pred = a;
        else if (f === 2) pred = b;
        else if (f === 3) pred = (a + b) >> 1;
        else if (f === 4) {
          const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        }
        const v = (akt[i] - pred) & 0xff;
        summe += v < 128 ? v : 256 - v;
        if (summe >= besteSumme) break;
      }
      if (summe < besteSumme) { besteSumme = summe; besterFilter = f; }
    }
    const ziel = roh.subarray(y * (zeile + 1), (y + 1) * (zeile + 1));
    ziel[0] = besterFilter;
    for (let i = 0; i < zeile; i++) {
      const a = i >= kanaele ? akt[i - kanaele] : 0;
      const b = oben ? oben[i] : 0;
      const c = oben && i >= kanaele ? oben[i - kanaele] : 0;
      let pred = 0;
      if (besterFilter === 1) pred = a;
      else if (besterFilter === 2) pred = b;
      else if (besterFilter === 3) pred = (a + b) >> 1;
      else if (besterFilter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      kandidat[i] = (akt[i] - pred) & 0xff;
    }
    kandidat.copy(ziel, 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(breite, 0);
  ihdr.writeUInt32BE(hoehe, 4);
  ihdr[8] = 8;
  ihdr[9] = kanaele === 4 ? 6 : 2;
  const idat = zlib.deflateSync(roh, { level: 9, memLevel: 9 });
  return Buffer.concat([SIGNATUR, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

/** @param {Buffer} rgba @returns {Buffer|null} RGB pixels when every alpha is 255, else null */
function ohneAlpha(rgba) {
  const rgb = Buffer.alloc((rgba.length / 4) * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    if (rgba[i + 3] !== 255) return null;
    rgb[j] = rgba[i];
    rgb[j + 1] = rgba[i + 1];
    rgb[j + 2] = rgba[i + 2];
  }
  return rgb;
}

/**
 * Optimises one file in place.
 * @param {string} datei
 * @returns {{ vorher: number, nachher: number }} sizes in bytes
 */
export function optimieren(datei) {
  const alt = fs.readFileSync(datei);
  const bild = lesen(alt);
  if (!bild) return { vorher: alt.length, nachher: alt.length };
  let { kanaele, pixel } = bild;
  if (kanaele === 4) {
    const rgb = ohneAlpha(pixel);
    if (rgb) { pixel = rgb; kanaele = 3; }
  }
  const neu = schreiben(bild.breite, bild.hoehe, kanaele, pixel);
  if (neu.length >= alt.length) return { vorher: alt.length, nachher: alt.length };
  // Safety: decode the result and compare every pixel with the original.
  const probe = lesen(neu);
  if (!probe || !probe.pixel.equals(pixel)) throw new Error(`${datei}: Neukodierung nicht verlustfrei — Datei unverändert`);
  fs.writeFileSync(datei, neu);
  return { vorher: alt.length, nachher: neu.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ziele = process.argv.slice(2);
  if (!ziele.length) {
    console.error("Aufruf: node scripts/png-optimieren.mjs <datei-oder-ordner> [...]");
    process.exit(2);
  }
  /** @type {string[]} */
  const dateien = [];
  for (const z of ziele) {
    if (fs.statSync(z).isDirectory()) for (const n of fs.readdirSync(z)) { if (n.endsWith(".png")) dateien.push(path.join(z, n)); }
    else dateien.push(z);
  }
  let vorher = 0, nachher = 0;
  for (const d of dateien.sort()) {
    const r = optimieren(d);
    vorher += r.vorher;
    nachher += r.nachher;
    console.log(`  ${path.basename(d)}: ${(r.vorher / 1024).toFixed(0)} kB → ${(r.nachher / 1024).toFixed(0)} kB`);
  }
  console.log(`\n${dateien.length} Dateien: ${(vorher / 1024 / 1024).toFixed(2)} MB → ${(nachher / 1024 / 1024).toFixed(2)} MB`);
}
