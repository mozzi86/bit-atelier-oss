// screenshots.mjs — the five README screenshots under docs/screenshots/ (Plan 83-04).
//
// Replaces the ten pictures of the old demo state (they showed real organisations and
// went to the private archive in 83-01). Every picture now comes from neutral sample
// data only: the seeder (server/seed.js) and the sample project (?beispiel=1).
//
// In:  a running app with FRESHLY seeded sample data in its own data folder, e.g.
//        PowerShell:  $env:BIT_DATA_DIR = "<empty scratch folder>"; npm run seed
//                     npm run build; npm start          (same $env:BIT_DATA_DIR)
//      Never seed the data folder you work with: the seeder overwrites db.json. The
//      script itself changes data of that instance (it applies a tessellation).
// Out: docs/screenshots/01-uebersicht.png … 05-ki-verbindungen.png — 1600 × 1000 px,
//      German UI, light theme, the floating AI button hidden, no request leaves
//      localhost (map tiles, neighbours and the like stay empty on purpose).
//
// Usage:  node scripts/screenshots.mjs              all five, app on http://localhost:3001
//         node scripts/screenshots.mjs 02 05        single motifs
//         SHOT_BASE=http://localhost:5173 SHOT_OUT=<folder> node scripts/screenshots.mjs
//
// Look at every picture before committing it: the block-list guard
// (tests/unit/projektneutral.test.js) checks image FILE NAMES only, never their content.

import { chromium } from "@playwright/test";
import { mkdirSync, statSync } from "node:fs";
import path from "node:path";

const BASE = process.env.SHOT_BASE || "http://localhost:3001";
const OUT = process.env.SHOT_OUT || "docs/screenshots";
/** Viewport in CSS pixels; device scale 1 keeps a PNG around 300–400 kB. */
const VIEWPORT = { width: 1600, height: 1000 };
const ONLY = process.argv.slice(2);
const LOKAL = ["localhost", "127.0.0.1", "[::1]"];

/** Sample projects of server/seed.js (fictional names, `.example` addresses). */
const PROJEKT = {
  uebersicht: "Bürocampus Parkseite",
  designer: "Wohnpark am See",
  ava: "Demoprojekt AVA (Beispieldaten)",
};

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const want = (id) => ONLY.length === 0 || ONLY.includes(id);
const mitProjekt = (route, name) => `${BASE}${route}${route.includes("?") ? "&" : "?"}projekt=${encodeURIComponent(name)}`;

/**
 * Save the current viewport and print the file size.
 * @param {import("@playwright/test").Page} page
 * @param {string} name file name without extension
 */
async function shot(page, name) {
  const datei = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: datei });
  console.log(`  ✓ ${datei} (${Math.round(statSync(datei).size / 1024)} kB)`);
}

/**
 * Scroll the app's main column (it scrolls itself, the document does not) so that
 * the element sits `oben` pixels below the top of the viewport.
 * @param {import("@playwright/test").Locator} ziel
 * @param {number} oben distance from the viewport top in px (the header is ~57 px)
 */
async function scrolleZu(ziel, oben) {
  await ziel.evaluate((el, abstand) => {
    const main = el.closest("main");
    if (!main) return;
    main.scrollTop += el.getBoundingClientRect().top - abstand;
  }, oben);
  await sleep(900);
}

/** Hide the floating AI button: it covers the lower right corner of every page. */
async function ohneSchwebeknopf(page) {
  await page.addStyleTag({ content: 'button[aria-label="KI-Assistent"]{display:none!important}' });
}

const run = async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: VIEWPORT, deviceScaleFactor: 1, locale: "de-DE", timezoneId: "Europe/Berlin", colorScheme: "light",
  });
  // Nothing leaves the machine: no tiles, no neighbour buildings, no fonts from a CDN.
  await ctx.route("**/*", (route) => {
    const url = route.request().url();
    if (/^(blob|data):/.test(url) || LOKAL.includes(new URL(url).hostname)) return route.continue();
    return route.abort();
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { if (!/WebGL|THREE/i.test(String(e))) console.warn("  ! pageerror:", String(e).slice(0, 200)); });

  /* 01 Project overview */
  if (want("01")) {
    console.log("01 Projektübersicht …");
    await page.goto(mitProjekt("/Dashboard", PROJEKT.uebersicht), { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Projektübersicht" }).waitFor();
    await ohneSchwebeknopf(page);
    await sleep(1500);
    await shot(page, "01-uebersicht");
  }

  /* 02 Check suite: sample project, after the automatic run */
  if (want("02")) {
    console.log("02 Prüf-Suite …");
    await page.goto(`${BASE}/ModelCheck?beispiel=1`, { waitUntil: "load" });
    const csv = page.getByTestId("befundliste-csv");
    await csv.waitFor({ timeout: 120000 });
    await page.waitForFunction(() => !document.querySelector('[data-testid="befundliste-csv"]')?.disabled, null, { timeout: 120000 });
    await ohneSchwebeknopf(page);
    // Finding groups stay closed and the picture starts at the export row: then the
    // findings map with both numbered markers fits into one 1000 px viewport.
    await sleep(800);
    await scrolleZu(page.getByTestId("stand-teilen"), 72);
    await shot(page, "02-pruef-suite");
  }

  /* 03 Komplex-Designer: apartment tessellation in the workshop */
  if (want("03")) {
    console.log("03 Komplex-Designer …");
    await page.goto(`${mitProjekt("/ComplexDesigner", PROJEKT.designer)}&tab=werkstatt`, { waitUntil: "networkidle" });
    await page.getByTestId("wt-regeln").waitFor({ timeout: 30000 });
    await ohneSchwebeknopf(page);
    await sleep(1500);
    // Gallery access ("Laubengang"): on the seed footprint all three default unit types
    // fit, so the plan shows a complete storey instead of an overload warning.
    const typologie = page.getByTestId("wt-typologie");
    if ((await typologie.textContent())?.trim() !== "Laubengang") {
      await typologie.click();
      await page.getByRole("option", { name: "Laubengang", exact: true }).click();
      await sleep(1000);
    }
    const anwenden = page.getByRole("button", { name: /Tesselierung anwenden/ });
    const entfernen = page.getByRole("button", { name: /^Entfernen$/ }).first();
    if ((await anwenden.isDisabled()) && (await entfernen.count())) { await entfernen.click(); await sleep(800); }
    for (let i = 0; i < 3 && !(await anwenden.isDisabled()); i += 1) { await anwenden.click(); await sleep(1500); }
    await sleep(1500);
    console.log(`    Wohneinheiten im Plan: ${await page.getByTestId("wt-we").count()}`);
    await scrolleZu(page.getByTestId("wt-tab-geschosse"), 76);
    // The plan starts at 100 % with a wide margin; two zoom steps fill its frame.
    const groesser = page.getByRole("button", { name: "Vergrößern" }).first();
    for (let i = 0; i < 2; i += 1) { await groesser.click(); await sleep(500); }
    await sleep(800);
    await shot(page, "03-komplex-designer");
  }

  /* 04 AVA: bill of quantities of the isolated sample project */
  if (want("04")) {
    console.log("04 AVA …");
    await page.goto(mitProjekt("/AVA", PROJEKT.ava), { waitUntil: "networkidle" });
    await page.locator("table tbody tr").first().waitFor({ timeout: 30000 });
    await ohneSchwebeknopf(page);
    await sleep(1200);
    await shot(page, "04-ava");
  }

  /* 05 AI connections: a preset chosen, nothing saved, no key typed */
  if (want("05")) {
    console.log("05 KI-Verbindungen …");
    await page.goto(mitProjekt("/Settings?tab=ai", PROJEKT.uebersicht), { waitUntil: "networkidle" });
    const vorlage = page.getByTestId("ki-vorlage");
    await vorlage.waitFor();
    await ohneSchwebeknopf(page);
    await page.getByPlaceholder("z. B. Büro-Claude").fill("Lokales Modell");
    await vorlage.selectOption("ollama");
    await page.getByPlaceholder("z. B. llama3.2").fill("llama3.2");
    await page.getByTestId("ki-ziel-url").filter({ hasText: "11434" }).waitFor();
    await sleep(800);
    await shot(page, "05-ki-verbindungen");
  }

  await browser.close();
  console.log("\nFertig — jedes Bild ansehen, bevor es eingecheckt wird.");
};

run().catch((e) => { console.error("FEHLER:", e.message); process.exit(1); });
