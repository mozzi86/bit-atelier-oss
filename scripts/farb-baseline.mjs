#!/usr/bin/env node
// farb-baseline.mjs — ratchet for hardcoded colours in the UI code (decision 2026-10-13,
// dev-team round "Frontend-Design entlang des Arbeitsablaufs"). Counts Tailwind palette
// classes (text-slate-500, bg-emerald-50, dark:border-gray-700, bg-[#123456] …) and
// gradient classes (bg-gradient-to-r) in src/ and packages/*/src/ and compares with
// tests/farb-baseline.json. More than the baseline → exit 1 (CI goes red); fewer → a hint
// to lower it. Design tokens (text-muted-foreground, bg-card, border-border …) are not
// counted: they are the target.
//
// Why: ~9 600 hardcoded colour classes against ~100 token uses; dark mode works through an
// override layer in packages/nova-core/src/index.css. Every new hardcoded class makes the
// token migration longer, so the number may only go down — same pattern as tsc-baseline.
//
// Usage:
//   node scripts/farb-baseline.mjs              # compare, exit 1 when above the baseline
//   node scripts/farb-baseline.mjs --schreiben  # write the current counts as the new baseline
//   node scripts/farb-baseline.mjs --je-datei   # also print the 20 files with most classes
// In:  nothing (reads the source tree). Out: text on stdout, exit code.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = path.join(REPO, "tests", "farb-baseline.json");

const PALETTE = "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black|white";
const UTILITY = "text|bg|border|border-[trblxy]|ring|ring-offset|outline|divide|from|via|to|fill|stroke|placeholder|decoration|shadow|accent|caret";

/** Tailwind palette class, optionally with opacity, e.g. hover:bg-slate-700/50; black/white have no shade. */
const PALETTE_KLASSE = new RegExp(`(?<![\\w-])(?:${UTILITY})-(?:(?:${PALETTE})-\\d{2,3}|black|white)(?:\\/\\d{1,3})?(?![\\w-])`, "g");
/** Arbitrary colour value, e.g. bg-[#0f172a] or text-[rgb(1,2,3)]. */
const BELIEBIG_KLASSE = new RegExp(`(?<![\\w-])(?:${UTILITY})-\\[(?:#|rgb|hsl)[^\\]]*\\]`, "g");
/** Gradient direction class, e.g. bg-gradient-to-r. */
const VERLAUF_KLASSE = /(?<![\w-])bg-gradient-to-[a-z]{1,2}(?![\w-])/g;

/**
 * Counts hardcoded colour classes in one source text.
 * @param {string} text file content
 * @returns {{ farben: number, verlaeufe: number }} palette + arbitrary colour classes, gradient classes
 */
export function zaehlen(text) {
  const farben = (text.match(PALETTE_KLASSE) || []).length + (text.match(BELIEBIG_KLASSE) || []).length;
  const verlaeufe = (text.match(VERLAUF_KLASSE) || []).length;
  return { farben, verlaeufe };
}

/**
 * Walks the UI source folders and counts per file.
 * @param {string} wurzel repository root
 * @returns {Map<string, { farben: number, verlaeufe: number }>} repo-relative path → counts (only files with hits)
 */
export function messen(wurzel = REPO) {
  const ordner = [path.join(wurzel, "src")];
  const pakete = path.join(wurzel, "packages");
  if (fs.existsSync(pakete)) {
    for (const p of fs.readdirSync(pakete)) {
      const quelle = path.join(pakete, p, "src");
      if (fs.existsSync(quelle)) ordner.push(quelle);
    }
  }
  /** @type {Map<string, { farben: number, verlaeufe: number }>} */
  const ergebnis = new Map();
  const laufen = (/** @type {string} */ dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const voll = path.join(dir, e.name);
      if (e.isDirectory()) laufen(voll);
      else if (/\.(jsx?|mjs|tsx?)$/.test(e.name)) {
        const z = zaehlen(fs.readFileSync(voll, "utf8"));
        if (z.farben || z.verlaeufe) ergebnis.set(path.relative(wurzel, voll).replace(/\\/g, "/"), z);
      }
    }
  };
  ordner.filter((o) => fs.existsSync(o)).forEach(laufen);
  return ergebnis;
}

function main() {
  const args = process.argv.slice(2);
  const proDatei = messen();
  const farben = [...proDatei.values()].reduce((s, z) => s + z.farben, 0);
  const verlaeufe = [...proDatei.values()].reduce((s, z) => s + z.verlaeufe, 0);

  if (args.includes("--schreiben")) {
    const je = Object.fromEntries([...proDatei.entries()].sort((a, b) => b[1].farben - a[1].farben).map(([d, z]) => [d, z.farben + z.verlaeufe]));
    fs.writeFileSync(BASELINE, `${JSON.stringify({ farben, verlaeufe, stand: new Date().toISOString().slice(0, 10), hinweis: "Fest eingetragene Farbklassen und Verläufe; dürfen nie steigen (scripts/farb-baseline.mjs). Senken, wenn auf Tokens umgestellt wurde.", je_datei: je }, null, 2)}\n`);
    console.log(`Baseline geschrieben: ${farben} Farbklassen, ${verlaeufe} Verläufe (${BASELINE})`);
    return 0;
  }
  if (!fs.existsSync(BASELINE)) {
    console.error(`Baseline fehlt: ${BASELINE} — einmal mit --schreiben erzeugen.`);
    return 2;
  }
  const basis = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
  console.log(`Farben: ${farben} Klassen (Baseline ${basis.farben}), Verläufe: ${verlaeufe} (Baseline ${basis.verlaeufe}), Stand ${basis.stand}`);
  if (args.includes("--je-datei") || farben > basis.farben || verlaeufe > basis.verlaeufe) {
    const alt = basis.je_datei || {};
    const top = [...proDatei.entries()]
      .map(([d, z]) => ({ d, n: z.farben + z.verlaeufe, vorher: alt[d] || 0 }))
      .sort((a, b) => (b.n - b.vorher) - (a.n - a.vorher) || b.n - a.n)
      .slice(0, 20);
    for (const { d, n, vorher } of top) console.log(`  ${String(n).padStart(5)}  (Basis ${vorher})  ${d}`);
  }
  if (farben > basis.farben || verlaeufe > basis.verlaeufe) {
    console.error("Mehr fest eingetragene Farben als in der Baseline. Neue Stellen mit Design-Tokens schreiben (bg-card, text-muted-foreground, border-border …), nicht die Baseline anheben.");
    return 1;
  }
  if (farben < basis.farben || verlaeufe < basis.verlaeufe) {
    console.log("Weniger als in der Baseline — mit --schreiben senken und mitcommitten.");
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
