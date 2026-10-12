#!/usr/bin/env node
// Generates the demo's app icons (Phase 65-04).
//
// Why a generator: the icons must be reproducible and must not be a binary
// nobody can regenerate. Playwright is already a dev dependency (the headless
// checks use it), so its Chromium renders the SVG — no image library needed.
//
// In:  the inline SVG below (wordmark "BIT" on the platform's dark ground).
// Out: public/icons/icon-192.png, icon-512.png, icon-512-maskable.png and public/favicon.ico
//      (Windows shortcut/desktop icon of the installer: a rounded tile on a transparent ground,
//      PNG frames 16…256 px packed into ICO — Windows Vista+ reads PNG-compressed ICO frames).
//
// The maskable variant keeps the mark inside the safe zone (80 % of the edge
// length); Android crops icons to whatever shape the launcher uses.
//
// Usage: node tools/icons-erzeugen.mjs

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ZIEL = path.join(path.resolve(import.meta.dirname, '..'), 'public', 'icons');

/** Design-System-Farben (tailwind slate-900 / emerald-500). */
const GRUND = '#0f172a';
const AKZENT = '#10b981';

/**
 * @param {number} groesse Kantenlänge in Pixeln
 * @param {number} anteil Anteil der Kantenlänge, den die Marke einnimmt (1 = randlos)
 * @returns {string} SVG
 */
function svg(groesse, anteil) {
  const m = groesse / 2;
  const r = (groesse * anteil) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${groesse}" height="${groesse}" viewBox="0 0 ${groesse} ${groesse}">
  <rect width="${groesse}" height="${groesse}" fill="${GRUND}"/>
  <g transform="translate(${m} ${m})">
    <rect x="${-r}" y="${-r}" width="${r * 2}" height="${r * 2}" rx="${r * 0.18}" fill="none" stroke="${AKZENT}" stroke-width="${groesse * 0.035}"/>
    <text x="0" y="${r * 0.34}" text-anchor="middle" fill="#ffffff"
          font-family="Helvetica, Arial, sans-serif" font-weight="700"
          font-size="${r * 0.95}" letter-spacing="${-r * 0.04}">BIT</text>
  </g>
</svg>`;
}

/**
 * Tile for the Windows icon: rounded dark square on a transparent ground (desktop icons are
 * not squares on Windows), stroke and wordmark scaled so they stay legible at 16 px.
 * @param {number} groesse Kantenlänge in Pixeln
 * @returns {string} SVG
 */
function kachel(groesse) {
  const rand = Math.max(0.5, groesse * 0.02);
  const radius = groesse * 0.2;
  const strich = Math.max(1, groesse * (groesse <= 32 ? 0.07 : 0.045));
  const innen = groesse * 0.14;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${groesse}" height="${groesse}" viewBox="0 0 ${groesse} ${groesse}">
  <rect x="${rand}" y="${rand}" width="${groesse - 2 * rand}" height="${groesse - 2 * rand}" rx="${radius}" fill="${GRUND}"/>
  <rect x="${innen}" y="${innen}" width="${groesse - 2 * innen}" height="${groesse - 2 * innen}" rx="${radius * 0.6}" fill="none" stroke="${AKZENT}" stroke-width="${strich}"/>
  <text x="${groesse / 2}" y="${groesse * 0.62}" text-anchor="middle" fill="#ffffff"
        font-family="Helvetica, Arial, sans-serif" font-weight="700"
        font-size="${groesse * (groesse <= 24 ? 0.36 : 0.32)}" letter-spacing="${-groesse * 0.01}">BIT</text>
</svg>`;
}

/**
 * Pack PNG frames into an ICO file (header, one 16-byte directory entry per frame, PNG data).
 * @param {Array<{groesse: number, png: Buffer}>} bilder frames, edge length in pixels (≤ 256)
 * @returns {Buffer}
 */
export function icoAusPngs(bilder) {
  const kopf = Buffer.alloc(6);
  kopf.writeUInt16LE(0, 0); kopf.writeUInt16LE(1, 2); kopf.writeUInt16LE(bilder.length, 4);
  const eintraege = [];
  let versatz = 6 + 16 * bilder.length;
  for (const { groesse, png } of bilder) {
    const e = Buffer.alloc(16);
    e.writeUInt8(groesse >= 256 ? 0 : groesse, 0); // 0 = 256 px
    e.writeUInt8(groesse >= 256 ? 0 : groesse, 1);
    e.writeUInt8(0, 2); e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8); e.writeUInt32LE(versatz, 12);
    versatz += png.length;
    eintraege.push(e);
  }
  return Buffer.concat([kopf, ...eintraege, ...bilder.map((b) => b.png)]);
}

const ICO_GROESSEN = [16, 24, 32, 48, 64, 128, 256];

const VARIANTEN = [
  { datei: 'icon-192.png', groesse: 192, anteil: 0.78 },
  { datei: 'icon-512.png', groesse: 512, anteil: 0.78 },
  // Maskable: Marke deutlich kleiner, damit der Launcher-Zuschnitt nichts abschneidet.
  { datei: 'icon-512-maskable.png', groesse: 512, anteil: 0.56 },
];

fs.mkdirSync(ZIEL, { recursive: true });
const browser = await chromium.launch();
try {
  for (const v of VARIANTEN) {
    const seite = await browser.newPage({
      viewport: { width: v.groesse, height: v.groesse },
      deviceScaleFactor: 1,
    });
    await seite.setContent(
      `<body style="margin:0">${svg(v.groesse, v.anteil)}</body>`,
      { waitUntil: 'load' },
    );
    const png = await seite.screenshot({ omitBackground: false });
    fs.writeFileSync(path.join(ZIEL, v.datei), png);
    console.log(`  ${String((png.length / 1024).toFixed(1)).padStart(6)} KB  public/icons/${v.datei}`);
    await seite.close();
  }
  const frames = [];
  for (const groesse of ICO_GROESSEN) {
    const seite = await browser.newPage({ viewport: { width: groesse, height: groesse }, deviceScaleFactor: 1 });
    await seite.setContent(`<body style="margin:0;background:transparent">${kachel(groesse)}</body>`, { waitUntil: 'load' });
    frames.push({ groesse, png: await seite.screenshot({ omitBackground: true }) });
    await seite.close();
  }
  const ico = icoAusPngs(frames);
  fs.writeFileSync(path.join(ZIEL, '..', 'favicon.ico'), ico);
  console.log(`  ${String((ico.length / 1024).toFixed(1)).padStart(6)} KB  public/favicon.ico (${ICO_GROESSEN.join('/')} px)`);
} finally {
  await browser.close();
}
