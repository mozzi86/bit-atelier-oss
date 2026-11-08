// 112-01 task 4 (foreign review 08.11.2026, point 4): Tailwind and Vite build messages.
//   - The work-surface breakpoint `ws` is a variant (plugin), not an object screen: a REAL Tailwind run over a sample
//     generates min-[1440px]:… again (portfolio chip, Layout.jsx) and ws:… with the same media query, and prints no
//     "min-* and max-* variants are not supported" warning.
//   - The ws media query is the same string in tailwind.config.js and index.css (both places must change together).
//   - Cascade guard: Tailwind 3.4 emits plugin variants before the responsive ones, so no class string may combine a ws:
//     utility with a breakpoint utility of the same property family (today none does).
//   - vite.config.js aliases node:module to a shim that throws in plain text.
//
// In:  tailwind.config.js, packages/nova-core/src/index.css, vite.config.js, src/shims/nodeModul.js, UI sources.
// Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
// tailwind.config.js is CommonJS inside a "type": "module" package — Tailwind's own loader reads it like the build does.
import loadConfig from "tailwindcss/loadConfig.js";

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));
const lies = (datei) => fs.readFileSync(path.join(WURZEL, datei), "utf8");
const WS_MEDIA = "@media (min-width: 1024px) and (min-height: 760px)";

test("tailwind: ws is a plugin variant, no object screen left", () => {
  const config = loadConfig(path.join(WURZEL, "tailwind.config.js"));
  const screens = { ...(config.theme?.screens || {}), ...(config.theme?.extend?.screens || {}) };
  for (const [name, wert] of Object.entries(screens)) assert.equal(typeof wert, "string", `screen ${name} is an object`);
  /** @type {Array<[string, string]>} */
  const varianten = [];
  for (const p of config.plugins) if (typeof p === "function") p({ addVariant: (n, f) => varianten.push([n, f]) });
  assert.deepEqual(varianten.find(([n]) => n === "ws"), ["ws", WS_MEDIA]);
  // Same media query as the work-surface rule of the page shell.
  assert.ok(lies("packages/nova-core/src/index.css").includes(WS_MEDIA), "index.css media query differs");
});

test("tailwind run: min-[1440px] and ws: are generated, no min/max warning", async () => {
  const config = loadConfig(path.join(WURZEL, "tailwind.config.js"));
  const warnungen = [];
  const original = console.warn;
  console.warn = (...a) => warnungen.push(a.join(" "));
  let css;
  try {
    const ergebnis = await postcss([
      tailwindcss({ ...config, content: [{ raw: '<span class="hidden min-[1440px]:inline-flex"></span><div class="ws:h-full ws:min-h-0 lg:grid-cols-2"></div>', extension: "html" }] }),
    ]).process("@tailwind utilities;", { from: undefined });
    css = ergebnis.css;
  } finally {
    console.warn = original;
  }
  assert.match(css, /@media \(min-width: 1440px\)\s*\{\s*\.min-\\\[1440px\\\]\\:inline-flex/);
  assert.match(css, /@media \(min-width: 1024px\) and \(min-height: 760px\)\s*\{\s*\.ws\\:h-full/);
  assert.ok(!warnungen.some((w) => /min-\*.*max-\*/.test(w)), `Tailwind warned: ${warnungen.join(" | ")}`);
});

/** Property family of a utility (conservative: flex/flex-col/flex-1 share one family, every padding side shares "p"). */
function familie(utility) {
  const u = utility.replace(/^-/, "");
  const lang = ["min-h", "max-h", "min-w", "max-w", "grid-rows", "grid-cols", "overflow-y", "overflow-x"].find((p) => u === p || u.startsWith(p + "-"));
  if (lang) return lang.startsWith("overflow") ? "overflow" : lang;
  const kopf = u.split("-")[0];
  if (/^p[trblxyse]?$/.test(kopf)) return "p";
  if (/^m[trblxyse]?$/.test(kopf)) return "m";
  return kopf;
}

test("cascade guard: no class string mixes ws: with a breakpoint utility of the same property family", () => {
  const dateien = [];
  const laufe = (ordner) => {
    for (const e of fs.readdirSync(ordner, { withFileTypes: true })) {
      if (e.name === "node_modules") continue;
      const voll = path.join(ordner, e.name);
      if (e.isDirectory()) laufe(voll);
      else if (/\.jsx?$/.test(e.name)) dateien.push(voll);
    }
  };
  laufe(path.join(WURZEL, "src"));
  for (const p of fs.readdirSync(path.join(WURZEL, "packages"))) {
    const q = path.join(WURZEL, "packages", p, "src");
    if (fs.existsSync(q)) laufe(q);
  }
  const konflikte = [];
  let mitWs = 0;
  for (const datei of dateien) {
    const text = fs.readFileSync(datei, "utf8");
    for (const [, inhalt] of text.matchAll(/["'`]([^"'`\n]*\bws:[^"'`\n]*)["'`]/g)) {
      mitWs += 1;
      const tokens = inhalt.split(/\s+/);
      const ws = new Set(tokens.filter((t) => t.startsWith("ws:")).map((t) => familie(t.slice(3))));
      for (const t of tokens) {
        const m = /^(?:sm|md|lg|xl|2xl|min-\[[^\]]+\]|max-\[[^\]]+\]):(.+)$/.exec(t);
        if (m && ws.has(familie(m[1]))) konflikte.push(`${path.relative(WURZEL, datei)}: ${t} vs ws:`);
      }
    }
  }
  assert.ok(mitWs > 10, `expected the work-surface class strings, found ${mitWs}`);
  assert.deepEqual(konflikte, []);
});

test("vite: node:module is aliased to a shim that throws in plain text", async () => {
  assert.match(lies("vite.config.js"), /'node:module': path\.resolve\(__dirname, '\.\/src\/shims\/nodeModul\.js'\)/);
  const shim = await import("../../src/shims/nodeModul.js");
  assert.throws(() => shim.createRequire("file:///x.js"), /node:module ist im Browser nicht verfügbar/);
});
