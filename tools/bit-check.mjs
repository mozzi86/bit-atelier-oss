#!/usr/bin/env node
// bit-check.mjs — CLI entry for the headless BIM check (Phase 77).
//
// Registers the Vite alias loader, then runs @ifc/lib/bitCheck. Exit codes:
//   0 ok / no hard increase (or 0 findings with --streng)
//   1 hard collisions / IDS fail / hartZunahme vs --vorlauf
//   2 argument or file errors
//
// Usage: node tools/bit-check.mjs <modell.ifc> [options]
//    or: bit-check <modell.ifc> …  (package.json "bin")
//
// Assumption D-HR-02 = YES (ordered as a CLI product).

import { register } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "..");
register(pathToFileURL(path.join(REPO, "tests/alias-hook.mjs")).href);

const { bitCheckAusfuehren, hilfeText } = await import("@ifc/lib/bitCheck.js");

const still = process.env.BIT_CHECK_QUIET === "1";
const onProgress = still
  ? undefined
  : (msg) => {
    process.stderr.write(`${msg}\n`);
  };

const ergebnis = await bitCheckAusfuehren(process.argv.slice(2), { onProgress });

if (ergebnis.hilfe) {
  process.stdout.write((ergebnis.text || hilfeText()) + "\n");
  process.exit(0);
}

if (ergebnis.fehler) {
  process.stderr.write(`bit-check: ${ergebnis.fehler}\n`);
  process.exit(ergebnis.exitCode ?? 2);
}

const k = ergebnis.lauf?.kennzahlen || {};
const v = ergebnis.lauf?.vergleichLauf;
process.stdout.write(
  JSON.stringify({
    exitCode: ergebnis.exitCode,
    kennzahlen: k,
    hartZunahme: v ? v.hartZunahme : null,
    geschrieben: ergebnis.geschrieben || [],
  }) + "\n",
);

process.exit(ergebnis.exitCode ?? 0);
