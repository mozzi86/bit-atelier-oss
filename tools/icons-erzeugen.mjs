#!/usr/bin/env node
// Generates the demo's app icons (Phase 65-04).
//
// Why a generator: the icons must be reproducible and must not be a binary
// nobody can regenerate. Playwright is already a dev dependency (the headless
// checks use it), so its Chromium renders the SVG — no image library needed.
//
// In:  the inline SVG below (wordmark "BIT" on the platform's dark ground).
// Out: public/icons/icon-192.png, icon-512.png, icon-512-maskable.png
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
} finally {
  await browser.close();
}
