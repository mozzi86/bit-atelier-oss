#!/usr/bin/env node
// assumed-register.mjs — list every [ASSUMED] marker in the product code (Plan 87-06).
// The project lives on guide values; they are marked in comments but nobody could see
// them in one place. This writes .planning/ASSUMED-REGISTER.md: file:line, the comment
// text around the marker, grouped by package — a report, not a gate.
//
// Usage: node scripts/assumed-register.mjs            (from the repo root)
// In:  tracked .js/.jsx under packages/, src/, server/. Out: the Markdown file, a count.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ZIEL = path.join(REPO, ".planning", "ASSUMED-REGISTER.md");

const dateien = execFileSync("git", ["ls-files", "packages", "src", "server"], { cwd: REPO, encoding: "utf8" })
  .split(/\r?\n/).filter((f) => /\.(jsx?|mjs)$/.test(f) && !/\/ui\//.test(f) && !/\.test\./.test(f));

/** @type {Map<string, Array<{datei: string, zeile: number, text: string}>>} */
const gruppen = new Map();
let gesamt = 0;
for (const f of dateien) {
  const zeilen = fs.readFileSync(path.join(REPO, f), "utf8").split(/\r?\n/);
  zeilen.forEach((z, i) => {
    if (!z.includes("[ASSUMED")) return;
    gesamt += 1;
    const paket = f.startsWith("packages/") ? f.split("/")[1] : f.split("/")[0];
    // The sentence around the marker: from the comment start to the end of the line,
    // plus the next line when the marker sits at the line end (comment continues).
    let text = z.replace(/^\s*(\/\/|\/\*+|\*)\s?/, "").trim();
    if (/\[ASSUMED[^\]]*\]?\s*$/.test(z) && zeilen[i + 1]) text += " " + zeilen[i + 1].replace(/^\s*(\/\/|\/\*+|\*)\s?/, "").trim();
    if (!gruppen.has(paket)) gruppen.set(paket, []);
    gruppen.get(paket).push({ datei: f, zeile: i + 1, text: text.slice(0, 220) });
  });
}

const heute = new Date().toISOString().slice(0, 10);
const out = [
  "# ASSUMED-Register — alle Richtwert-Annahmen im Produktcode",
  "",
  `Erzeugt ${heute} von \`scripts/assumed-register.mjs\` (87-06). **${gesamt} Stellen** in ${dateien.filter((f) => gruppen.size && [...gruppen.values()].some((g) => g.some((e) => e.datei === f))).length} Dateien.`,
  "Jede Stelle ist ein Richtwert ohne belegte Quelle (Konvention in CLAUDE.md „Kommentare“). Belegen heißt: Norm/Tabelle im Kommentar nennen und den Marker durch `[CITED]` ersetzen — dann verschwindet die Zeile hier beim nächsten Lauf.",
  "",
];
for (const [paket, liste] of [...gruppen.entries()].sort((a, b) => b[1].length - a[1].length)) {
  out.push(`## ${paket} (${liste.length})`, "", "| Datei:Zeile | Annahme |", "|---|---|");
  for (const e of liste) out.push(`| \`${e.datei}:${e.zeile}\` | ${e.text.replace(/\|/g, "\\|")} |`);
  out.push("");
}
fs.writeFileSync(ZIEL, `${out.join("\n")}\n`);
console.log(`${gesamt} [ASSUMED]-Stellen → ${ZIEL}`);
