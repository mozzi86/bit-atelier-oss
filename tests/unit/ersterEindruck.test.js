// Guard test for the first impression (72-12, N-09).
//
// Three contracts that break silently, without an error anywhere:
//   - dark mode lifts the gradient page titles through CSS rules in index.css.
//     Each rule may only set the variable its own utility owns, otherwise the
//     via and to stops vanish; and a new gradient heading with a dark stop
//     would stay unreadable until someone looks at it in dark mode;
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

/**
 * Bodies of the dark text-gradient rules, keyed by utility class.
 * @returns {Map<string, string>} e.g. "from-slate-800" → "--tw-gradient-from: …"
 */
function dunkleTextVerlaeufe() {
  const regeln = new Map();
  for (const m of CSS.matchAll(/\.dark \.bg-clip-text\.((?:from|via|to)-[\w\\/-]+)\s*\{([^}]*)\}/g)) {
    regeln.set(m[1].replace(/\\/g, ""), m[2].trim());
  }
  return regeln;
}

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
 * Gradient stops (from-/via-/to-colour-shade) of every class string that makes
 * gradient text (bg-clip-text + text-transparent) in the app and its packages.
 * @returns {Map<string, string>} utility → first file that uses it (repo-relative)
 */
function stoppsVonVerlaufstiteln() {
  const quellen = [path.join(WURZEL, "src")];
  for (const p of fs.readdirSync(path.join(WURZEL, "packages"))) {
    const src = path.join(WURZEL, "packages", p, "src");
    if (fs.existsSync(src)) quellen.push(src);
  }
  const stopps = new Map();
  for (const datei of quellen.flatMap(jsxDateien)) {
    for (const m of fs.readFileSync(datei, "utf8").matchAll(/className="([^"]*)"/g)) {
      const klassen = m[1].split(/\s+/);
      if (!klassen.includes("bg-clip-text") || !klassen.includes("text-transparent")) continue;
      for (const k of klassen) {
        if (/^(from|via|to)-[a-z]+-\d{2,3}$/.test(k) && !stopps.has(k)) stopps.set(k, path.relative(WURZEL, datei));
      }
    }
  }
  return stopps;
}

test("dunkle Titel-Verläufe: jede Regel setzt nur die Variable ihrer Utility", () => {
  const regeln = dunkleTextVerlaeufe();
  assert.ok(regeln.size >= 3, `nur ${regeln.size} Regeln gefunden`);
  for (const [klasse, rumpf] of regeln) {
    const variablen = [...rumpf.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]);
    const erwartet = { from: "--tw-gradient-from", via: "--tw-gradient-stops", to: "--tw-gradient-to" }[klasse.split("-")[0]];
    assert.deepEqual(variablen, [erwartet], `${klasse}: setzt ${variablen.join(", ")} statt nur ${erwartet}`);
  }
  // The via rule has to keep the from and to colours of the element itself.
  for (const [klasse, rumpf] of regeln) {
    if (klasse.startsWith("via-")) {
      assert.match(rumpf, /^--tw-gradient-stops:\s*var\(--tw-gradient-from\),\s*#[0-9a-f]{6} var\(--tw-gradient-via-position\),\s*var\(--tw-gradient-to\);$/i, klasse);
    }
  }
});

test("jeder dunkle Verlaufsstopp eines Seitentitels hat eine helle Dunkelmodus-Regel", () => {
  const regeln = dunkleTextVerlaeufe();
  const stopps = stoppsVonVerlaufstiteln();
  assert.ok(stopps.has("from-slate-800"), "die Seitentitel (from-slate-800 …) wurden nicht gefunden");
  // Shades 500 and up are too dark for #0b1220; lighter stops read on both.
  const fehlend = [...stopps].filter(([k]) => Number(k.split("-").pop()) >= 500 && !regeln.has(k));
  assert.deepEqual(fehlend, [], `ohne .dark .bg-clip-text-Regel in index.css: ${fehlend.map(([k, d]) => `${k} (${d})`).join(", ")}`);
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
