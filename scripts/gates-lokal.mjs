#!/usr/bin/env node
// gates-lokal.mjs — the complete gate run on this machine, one command (plan 105-24).
//
// Why: .github/workflows/gates.yml defines the gates, but GitHub Actions does not start for this account at the
// moment (state 19.11.2026), so the workflow gives no status. Until it does, THIS script is the gate run that
// counts: it runs the gates of gates.yml in the same order, including the harness pytest suite (105-24). Only the
// csg-chunk measuring build of gates.yml (scripts/csg-chunk-budget.mjs, a second build) is left out here to keep
// the local run short; run it by hand when the CSG chunk changes. Keep both lists in sync otherwise.
//
// Steps: lint · tsc baseline · colour baseline · unit tests · build (build.log) · size budget · harness pytest.
// Every step runs even when an earlier one is red, so one run shows all red gates; the exit code is 1 when any
// step is red. The build writes its full output to build.log (never piped through tail — that hides errors).
//
// Usage:
//   npm run gates                         # or: node scripts/gates-lokal.mjs
//   node scripts/gates-lokal.mjs --ohne harness   # skip named steps (ids below), e.g. on a machine without Python
// In:  environment (HARNESS_PYTHON etc., see scripts/harness-pytest.mjs). Out: step output, a summary table,
//      exit code 0 (all green) or 1.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WINDOWS = process.platform === "win32";

/**
 * The gate steps in run order. `log` = file that receives stdout+stderr instead of the terminal.
 * @type {{ id: string, titel: string, befehl: string, args: string[], env?: Record<string, string>, log?: string }[]}
 */
export const SCHRITTE = [
  { id: "lint", titel: "Lint", befehl: "npm", args: ["run", "lint"] },
  { id: "tsc", titel: "tsc-Baseline", befehl: "node", args: ["scripts/tsc-baseline.mjs"] },
  { id: "farben", titel: "Farb-Baseline", befehl: "node", args: ["scripts/farb-baseline.mjs"] },
  { id: "unit", titel: "Unit-Tests", befehl: "npm", args: ["run", "test:unit"] },
  // Node caps the V8 old space at about 2 GB; the CSG graph needs more since 107-09 (same as gates.yml).
  { id: "build", titel: "Build", befehl: "npx", args: ["vite", "build"],
    env: { NODE_OPTIONS: "--max-old-space-size=4096" }, log: "build.log" },
  { id: "budget", titel: "Größen-Budget", befehl: "node", args: ["scripts/groessen-budget.mjs"] },
  { id: "harness", titel: "Harness-pytest", befehl: "node", args: ["scripts/harness-pytest.mjs"] },
];

/**
 * Runs one step synchronously in the repo root.
 * @param {(typeof SCHRITTE)[number]} s the step
 * @returns {{ status: number, sekunden: number }} exit code (1 when it could not start) and duration in seconds
 */
export function fuehreAus(s) {
  const start = Date.now();
  const env = { ...process.env, ...(s.env || {}) };
  let stdio = /** @type {any} */ ("inherit");
  let fd = null;
  if (s.log) {
    fd = fs.openSync(path.join(REPO, s.log), "w");
    stdio = ["ignore", fd, fd];
  }
  // npm/npx are .cmd files on Windows and need a shell there.
  const r = spawnSync(s.befehl, s.args, { cwd: REPO, env, stdio, shell: WINDOWS });
  if (fd !== null) fs.closeSync(fd);
  if (r.error) console.error(`${s.titel}: ${r.error.message}`);
  return { status: r.error ? 1 : (r.status ?? 1), sekunden: (Date.now() - start) / 1000 };
}

function main() {
  const i = process.argv.indexOf("--ohne");
  const ohne = new Set(i >= 0 ? (process.argv[i + 1] || "").split(",").filter(Boolean) : []);
  const ergebnisse = [];
  for (const s of SCHRITTE) {
    if (ohne.has(s.id)) {
      ergebnisse.push({ s, text: "ÜBERSPRUNGEN", rot: false });
      continue;
    }
    console.log(`\n=== ${s.titel} (${[s.befehl, ...s.args].join(" ")}${s.log ? ` > ${s.log}` : ""}) ===`);
    const { status, sekunden } = fuehreAus(s);
    if (s.log) console.log(`${s.titel}: EXIT=${status} (Ausgabe in ${s.log})`);
    ergebnisse.push({ s, text: `${status === 0 ? "grün" : `ROT (Exit ${status})`} ${sekunden.toFixed(0)} s`, rot: status !== 0 });
  }
  console.log("\n=== Gates lokal — Ergebnis ===");
  for (const e of ergebnisse) console.log(`${e.s.titel.padEnd(16)} ${e.text}`);
  const rot = ergebnisse.filter((e) => e.rot).length;
  console.log(rot ? `${rot} Gate(s) ROT` : "Alle Gates grün");
  return rot ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
