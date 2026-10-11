#!/usr/bin/env node
// tsc-baseline.mjs — the typecheck gate as a NUMBER instead of "count per touched file"
// (Plan 87-03). Runs `tsc -p ./jsconfig.json`, counts `error TS` lines and compares with
// tests/tsc-baseline.json. More errors than the baseline → exit 1 (CI goes red); fewer →
// a hint to lower the baseline. The legacy errors (React `children` typing, three.js)
// are the reason a baseline exists at all — see CLAUDE.md "Definition of Done".
//
// Usage:
//   node scripts/tsc-baseline.mjs              # compare, exit 1 when above the baseline
//   node scripts/tsc-baseline.mjs --schreiben  # write the current count as the new baseline
//   node scripts/tsc-baseline.mjs --je-datei   # also print the 20 files with most errors
//   node scripts/tsc-baseline.mjs --datei X    # compare only one file's count (local gate)
// In:  nothing (runs tsc). Out: text on stdout, exit code.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = path.join(REPO, "tests", "tsc-baseline.json");
const args = process.argv.slice(2);
const schreiben = args.includes("--schreiben");
const jeDatei = args.includes("--je-datei");
const nurDatei = args.includes("--datei") ? args[args.indexOf("--datei") + 1] : null;

const tsc = spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["tsc", "-p", "./jsconfig.json"], {
  cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, shell: process.platform === "win32",
});
const zeilen = `${tsc.stdout || ""}\n${tsc.stderr || ""}`.split(/\r?\n/).filter((l) => /error TS\d+/.test(l));
const gesamt = zeilen.length;

/** @type {Map<string, number>} */
const proDatei = new Map();
for (const l of zeilen) {
  const m = /^(.*?)\(\d+,\d+\): error TS/.exec(l);
  const datei = (m ? m[1] : "?").replace(/\\/g, "/");
  proDatei.set(datei, (proDatei.get(datei) || 0) + 1);
}

if (nurDatei) {
  const n = [...proDatei.entries()].filter(([d]) => d.endsWith(nurDatei.replace(/\\/g, "/"))).reduce((s, [, k]) => s + k, 0);
  console.log(`${nurDatei}: ${n} Fehler`);
  process.exit(0);
}

if (schreiben) {
  const datei = Object.fromEntries([...proDatei.entries()].sort((a, b) => b[1] - a[1]));
  fs.writeFileSync(BASELINE, `${JSON.stringify({ gesamt, stand: new Date().toISOString().slice(0, 10), hinweis: "tsc-Fehler gesamt; darf nie steigen (scripts/tsc-baseline.mjs). Senken, wenn Fehler behoben wurden.", je_datei: datei }, null, 2)}\n`);
  console.log(`Baseline geschrieben: ${gesamt} Fehler (${BASELINE})`);
  process.exit(0);
}

if (!fs.existsSync(BASELINE)) {
  console.error(`Baseline fehlt: ${BASELINE} — einmal mit --schreiben erzeugen.`);
  process.exit(2);
}
const basis = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
console.log(`tsc: ${gesamt} Fehler, Baseline ${basis.gesamt} (Stand ${basis.stand})`);
if (jeDatei) {
  const top = [...proDatei.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
  for (const [d, n] of top) {
    const vorher = basis.je_datei?.[d];
    console.log(`  ${String(n).padStart(4)}  ${d}${vorher !== undefined && vorher !== n ? `  (Baseline ${vorher})` : ""}`);
  }
}
if (gesamt > basis.gesamt) {
  const neu = [...proDatei.entries()].filter(([d, n]) => n > (basis.je_datei?.[d] || 0)).map(([d, n]) => `${d}: ${n} (Baseline ${basis.je_datei?.[d] || 0})`);
  console.error(`FEHLER: ${gesamt - basis.gesamt} neue tsc-Fehler über der Baseline.\n  ${neu.join("\n  ")}`);
  process.exit(1);
}
if (gesamt < basis.gesamt) console.log(`Hinweis: ${basis.gesamt - gesamt} Fehler weniger als die Baseline — mit --schreiben senken.`);
process.exit(0);
