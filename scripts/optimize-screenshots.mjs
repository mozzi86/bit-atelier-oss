// Skaliert die README-Screenshots auf max. 1800 px Breite und re-komprimiert sie.
// Nutzt den bereits vorhandenen Chromium (Playwright) — kein zusaetzliches Paket.
// Start: node scripts/optimize-screenshots.mjs
import { chromium } from "playwright";
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

const DIR = "docs/screenshots";
const MAX_W = 1800;

const files = readdirSync(DIR).filter((f) => f.endsWith(".png"));
const browser = await chromium.launch();
const page = await browser.newPage();

let before = 0, after = 0;
for (const f of files) {
  const p = join(DIR, f);
  before += statSync(p).size;
  const b64 = readFileSync(p).toString("base64");
  const out = await page.evaluate(async ({ b64, maxW }) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "data:image/png;base64," + b64; });
    if (img.width <= maxW) return null;                 // schon klein genug
    const scale = maxW / img.width;
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    const ctx = c.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/png").split(",")[1];
  }, { b64, maxW: MAX_W });
  if (out) writeFileSync(p, Buffer.from(out, "base64"));
  const size = statSync(p).size;
  after += size;
  console.log(`  ${f}: ${(size / 1024).toFixed(0)} kB`);
}

await browser.close();
console.log(`\n${(before / 1024 / 1024).toFixed(1)} MB -> ${(after / 1024 / 1024).toFixed(1)} MB`);
