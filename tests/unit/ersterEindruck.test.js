// Guard test for the first impression (72-12, N-09).
//
// Three contracts that break silently, without an error anywhere:
//   - page titles are plain text (no gradient text); a new gradient heading
//     would be unreadable in dark mode until someone looks at it there;
//   - index.html carries a static loading note and a head script that sets the
//     dark class before the bundle. The script repeats ThemeProvider's storage
//     key; if one side changes, the cold start follows a stale setting;
//   - the new loading and toast texts need an EN entry.
// Reads the source files as TEXT (like navigation.test.js): no React, no DOM.
//
// In:  index.css, index.html, ThemeProvider.jsx, i18n.jsx, every .jsx under
//      src/ and packages/*/src. Out: assertions, no side effects.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), "utf8");
const CSS = lies("packages/nova-core/src/index.css");
const HTML = lies("index.html");

/** Every .jsx file below a directory, skipping node_modules. */
function jsxDateien(verzeichnis) {
  const raus = [];
  for (const e of fs.readdirSync(verzeichnis, { withFileTypes: true })) {
    const voll = path.join(verzeichnis, e.name);
    if (e.isDirectory() && e.name !== "node_modules") raus.push(...jsxDateien(voll));
    else if (e.isFile() && e.name.endsWith(".jsx")) raus.push(voll);
  }
  return raus;
}

/**
 * Files that still make gradient text (bg-clip-text + text-transparent).
 * @returns {string[]} repo-relative paths
 */
function dateienMitVerlaufstext() {
  const quellen = [path.join(WURZEL, "src")];
  for (const p of fs.readdirSync(path.join(WURZEL, "packages"))) {
    const src = path.join(WURZEL, "packages", p, "src");
    if (fs.existsSync(src)) quellen.push(src);
  }
  const treffer = [];
  for (const datei of quellen.flatMap(jsxDateien)) {
    for (const m of fs.readFileSync(datei, "utf8").matchAll(/className="([^"]*)"/g)) {
      const klassen = m[1].split(/\s+/);
      if (klassen.includes("bg-clip-text") && klassen.includes("text-transparent")) { treffer.push(path.relative(WURZEL, datei)); break; }
    }
  }
  return treffer;
}

// Redesign 2026-11: page titles are plain text-foreground. Gradient text needed
// its own dark-mode rules (72-12) and reached 1.3:1 without them; with the
// rules gone, a new gradient heading must not come back.
test("kein Verlaufstext: Seitentitel stehen in text-foreground", () => {
  assert.deepEqual(dateienMitVerlaufstext(), []);
  assert.doesNotMatch(CSS, /\.dark \.bg-clip-text\./, "tote Dunkelmodus-Regel für Verlaufstext in index.css");
});

test("index.html: deutscher Titel und statischer Ladehinweis in #root", () => {
  assert.match(HTML, /<title>BIT-Atelier — Bauprojekt-Plattform<\/title>/);
  assert.match(HTML, /<div id="root"><p class="kaltstart" role="status">BIT-Atelier wird geladen …<\/p><\/div>/);
  // Without JavaScript the note would contradict the noscript message.
  assert.match(HTML, /<noscript><style>\.kaltstart \{ display: none; \}<\/style><\/noscript>/);
});

test("index.html: der Kopf-Skript liest denselben Theme-Schlüssel wie ThemeProvider", () => {
  const provider = lies("packages/nova-core/src/components/theme/ThemeProvider.jsx");
  const schluessel = provider.match(/const STORAGE_KEY = "([^"]+)"/)?.[1];
  assert.ok(schluessel, "STORAGE_KEY nicht gefunden in ThemeProvider.jsx");
  const skript = HTML.match(/<script>([\s\S]*?)<\/script>/)?.[1] || "";
  assert.ok(skript.includes(`localStorage.getItem("${schluessel}")`), `Kopf-Skript liest nicht "${schluessel}"`);
  assert.ok(skript.includes("prefers-color-scheme: dark") && provider.includes("prefers-color-scheme: dark"), "beide folgen ohne Wahl dem System");
  assert.ok(skript.includes('classList.add("dark")'), "Kopf-Skript setzt die Klasse dark");
  // Classic inline script before the module entry: it must run before React.
  assert.ok(HTML.indexOf("<script>") < HTML.indexOf('<script type="module"'), "Kopf-Skript steht vor dem Modul-Einstieg");
});

test("Lade- und Toast-Texte haben einen EN-Eintrag und werden über t() benutzt", () => {
  const i18n = lies("packages/nova-core/src/lib/i18n.jsx");
  const en = i18n.slice(i18n.indexOf("en: {"), i18n.indexOf("\n};", i18n.indexOf("en: {")));
  const verwendung = {
    "Wird geladen …": "src/App.jsx",
    "Wird geladen": "packages/nova-core/src/components/common/LoadingState.jsx",
    "Benachrichtigungen": "packages/nova-core/src/components/ui/toaster.jsx",
    "Meldung schließen": "packages/nova-core/src/components/ui/toaster.jsx",
  };
  for (const [text, datei] of Object.entries(verwendung)) {
    assert.ok(en.includes(`"${text}":`), `kein EN-Eintrag für „${text}“`);
    assert.ok(lies(datei).includes(`t("${text}")`), `„${text}“ nicht über t() in ${datei}`);
  }
});
