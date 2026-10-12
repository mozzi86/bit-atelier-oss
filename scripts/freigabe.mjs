// 78-06 (HOHEIT-07, D-P78-06): production only after an explicit release. The hosted app is built
// from the branch `produktion`, not from `main`; this script is the only intended way to move it.
//
// What it does, in this order (stops at the first problem, changes nothing before the end):
//   1. checks the repo: no modified tracked file, the release commit (default: HEAD of `main`) exists
//      and lies on `main`;
//   2. runs the gates (lint, tsc baseline, unit tests, build) unless --ohne-gates;
//   3. checks that `produktion` can be FAST-FORWARDED to the commit (never rewrites history; a missing
//      `produktion` branch is created at the commit);
//   4. moves `produktion` and creates the annotated tag `freigabe-YYYY-MM-DD[-n]` whose message names
//      the commit, the gate results and the optional note;
//   5. prints the push command. It never pushes — pushing stays a human decision (agents never push).
//
// Usage:  node scripts/freigabe.mjs [--commit <sha|ref>] [--notiz "text"] [--ohne-gates] [--trocken]
//   --trocken   only report what would happen (no branch move, no tag)
// External one-time step (not done by this script): set the Cloudflare Pages production branch of the
// hosted app to `produktion`.
import { execFileSync, spawnSync } from "node:child_process";
import process from "node:process";

/**
 * Tag name for a release on a given day; adds -2, -3 … when earlier releases of that day exist.
 * @param {Date} datum release date (local time)
 * @param {string[]} vorhandene existing tag names
 * @returns {string}
 */
export function tagName(datum, vorhandene) {
  const p = (n) => String(n).padStart(2, "0");
  const basis = `freigabe-${datum.getFullYear()}-${p(datum.getMonth() + 1)}-${p(datum.getDate())}`;
  const menge = new Set(vorhandene);
  if (!menge.has(basis)) return basis;
  let n = 2;
  while (menge.has(`${basis}-${n}`)) n++;
  return `${basis}-${n}`;
}

/**
 * Parse the command line.
 * @param {string[]} argv arguments after the script name
 * @returns {{commit: string, notiz: string, ohneGates: boolean, trocken: boolean}}
 */
export function argumente(argv) {
  const a = { commit: "main", notiz: "", ohneGates: false, trocken: false };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === "--commit") a.commit = String(argv[++i] ?? "");
    else if (x === "--notiz") a.notiz = String(argv[++i] ?? "");
    else if (x === "--ohne-gates") a.ohneGates = true;
    else if (x === "--trocken") a.trocken = true;
    else throw new Error(`Unbekannte Option: ${x}`);
  }
  if (!a.commit) throw new Error("--commit braucht einen Wert.");
  return a;
}

/** The gates of the Definition of Done (CLAUDE.md), as [label, command, args]. */
export const GATES = [
  ["Lint", "npm", ["run", "lint"]],
  ["tsc-Baseline", "node", ["scripts/tsc-baseline.mjs"]],
  ["Unit-Tests", "npm", ["run", "test:unit"]],
  ["Build", "npx", ["vite", "build"]],
];

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const gitOk = (cwd, ...args) => spawnSync("git", args, { cwd, stdio: "ignore" }).status === 0;

/**
 * Run a release in the repository `cwd`.
 * @param {{commit: string, notiz: string, ohneGates: boolean, trocken: boolean}} a
 * @param {{cwd?: string, jetzt?: Date, log?: (s: string) => void}} [o]
 * @returns {{sha: string, tag: string, neuerZweig: boolean, gates: string[], pushBefehl: string, trocken: boolean}}
 */
export function freigeben(a, o = {}) {
  const cwd = o.cwd || process.cwd();
  const log = o.log || ((s) => console.log(s));
  if (git(cwd, "status", "--porcelain", "--untracked-files=no")) throw new Error("Arbeitsbaum hat geänderte Dateien — erst committen oder verwerfen.");
  if (!gitOk(cwd, "rev-parse", "--verify", "--quiet", `${a.commit}^{commit}`)) throw new Error(`Commit nicht gefunden: ${a.commit}`);
  const sha = git(cwd, "rev-parse", `${a.commit}^{commit}`);
  if (!gitOk(cwd, "merge-base", "--is-ancestor", sha, "main")) throw new Error(`${sha.slice(0, 7)} liegt nicht auf main — freigegeben wird nur, was in main ist.`);

  const gates = [];
  if (a.ohneGates) gates.push("Gates übersprungen (--ohne-gates)");
  else {
    if (git(cwd, "rev-parse", "HEAD") !== sha) throw new Error("Für die Gates muss der freizugebende Commit ausgecheckt sein (oder --ohne-gates).");
    for (const [name, cmd, args] of GATES) {
      log(`Gate: ${name} …`);
      const r = spawnSync(cmd, args, { cwd, stdio: "ignore", shell: process.platform === "win32" });
      if (r.status !== 0) throw new Error(`Gate „${name}“ ist rot (Exit ${r.status}) — keine Freigabe.`);
      gates.push(`${name}: grün`);
    }
  }

  const hatZweig = gitOk(cwd, "rev-parse", "--verify", "--quiet", "refs/heads/produktion");
  if (hatZweig && !gitOk(cwd, "merge-base", "--is-ancestor", "produktion", sha)) {
    throw new Error("produktion lässt sich nicht vorspulen (die Zweige sind auseinandergelaufen) — von Hand klären, nie überschreiben.");
  }
  const tag = tagName(o.jetzt || new Date(), git(cwd, "tag", "--list", "freigabe-*").split("\n").filter(Boolean));
  const pushBefehl = `git push origin produktion ${tag}`;
  if (!a.trocken) {
    if (hatZweig) git(cwd, "branch", "-f", "produktion", sha);
    else git(cwd, "branch", "produktion", sha);
    const text = [`Freigabe ${tag}`, "", `Commit: ${sha}`, ...gates, ...(a.notiz ? ["", a.notiz] : [])].join("\n");
    git(cwd, "tag", "-a", tag, sha, "-m", text);
  }
  return { sha, tag, neuerZweig: !hatZweig, gates, pushBefehl, trocken: a.trocken };
}

const direkt = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());
if (direkt) {
  try {
    const r = freigeben(argumente(process.argv.slice(2)));
    console.log(`${r.trocken ? "(trocken) Würde freigeben" : "Freigegeben"}: ${r.sha.slice(0, 7)} → produktion${r.neuerZweig ? " (Zweig neu)" : ""}, Tag ${r.tag}`);
    for (const g of r.gates) console.log(`  ${g}`);
    console.log(`Ausliefern (nur mit ausdrücklichem Ja): ${r.pushBefehl}`);
  } catch (e) {
    console.error(`Keine Freigabe: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
}
