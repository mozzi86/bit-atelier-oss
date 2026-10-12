#!/usr/bin/env node
// a11y-codemod.mjs — mechanical naming of form fields from the label right above them
// (Plan 72-03, task 2).
//
// The pattern is the same ~130 times:
//     <label className="text-xs text-slate-500">Bauweise</label>
//     <Select value={bauweise} onValueChange={setBauweise}>
//       <SelectTrigger><SelectValue /></SelectTrigger>
// The field has no programmatic name, a screen reader announces "Schaltfläche". The
// codemod copies the label text into the field as aria-label={t("Bauweise")}. It touches
// ONLY the opening tag of the field (and, where needed, adds `const { t } = useI18n()` plus
// the import, because new aria-labels are UI strings and go through t()). When the
// field already has an id, the label gets htmlFor instead — a real link, no new string.
//
// Label → field matching comes from scripts/a11y-schulden.mjs (labelFunde): next
// SelectTrigger/Input/Textarea/input/textarea/select at most five lines below the label,
// same parent element, no other label in between.
//
// Left alone and listed in the report (fix by hand or leave with a reason):
//   - label text with nested elements or mixed text and {expressions}
//   - `t` shadowed in the component (a `.map((t) => …)` or `const t =`)
//   - no component body to put the hook in (expression-bodied arrow, lowercase helper)
//
// Usage:
//   node scripts/a11y-codemod.mjs              # dry run: report only
//   node scripts/a11y-codemod.mjs --schreiben  # write the files
//   node scripts/a11y-codemod.mjs --hand <datei>:<zeile> "<Name>" [--schreiben]
//       names the first unnamed field on that line by hand (rests the patterns miss),
//       through the same t()/hook handling; <Name> may also be {expression}
// In:  .jsx under src/ and packages/*/src/. Out: report on stdout; files with --schreiben.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REPO, jsxDateien, labelFunde, tagEnde, tags, zeileVon } from "./a11y-schulden.mjs";
import { englischePaareAlle } from "../tests/unit/helpers/woerterbuch.mjs";

const schreiben = process.argv.includes("--schreiben");

/** @param {string} tag @param {string} name */
const hatAttr = (tag, name) => new RegExp(`[\\s{]${name}\\s*=`).test(tag);

/**
 * Accessible name from the children of a label, or a reason why not.
 * @param {string} roh label children source
 * @returns {{ attr: string, schluessel: string|null } | { grund: string }}
 *   attr = JSX attribute value incl. braces; schluessel = new t() key (literal case)
 */
export function nameAusLabel(roh) {
  let s = roh
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\{\s*(["'])\s*\1\s*\}/g, " ")
    .replace(/<[A-Z][\w.]*(?:\s[^<>]*?)?\/>/g, " ");
  if (/<[A-Za-z]/.test(s)) return { grund: "verschachteltes Element im Label" };
  s = s.trim();
  const nurAusdruck = /^\{([\s\S]*)\}$/.exec(s);
  if (nurAusdruck && !/[{}]/.test(nurAusdruck[1])) {
    const expr = nurAusdruck[1].trim();
    if (/^t\(\s*(["'])(?:(?!\1)[^\\]|\\.)*\1\s*\)$/.test(expr) || /^[\w$.]+$/.test(expr)) {
      return { attr: `{${expr}}`, schluessel: null };
    }
    return { grund: `Ausdruck im Label: {${expr.slice(0, 40)}}` };
  }
  if (/[{}]/.test(s)) return { grund: "Text mit {Ausdruck} gemischt" };
  const text = s
    .replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&nbsp;/g, " ").replace(/&shy;/g, "").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ").replace(/\s*[*:]+\s*$/, "").trim();
  if (!text) return { grund: "leerer Labeltext" };
  return { attr: `{t(${JSON.stringify(text)})}`, schluessel: text };
}

/** Top-level declaration that opens a component or helper (column 0). */
const DEKLARATION = /^(?:export\s+(?:default\s+)?)?(?:async\s+)?(?:function\s*\*?\s*([A-Za-z_$][\w$]*)|(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=)/gm;

/**
 * Finds the top-level declaration that contains `pos`.
 * @param {string} q @param {number} pos
 * @returns {{ start: number, name: string } | null}
 */
function deklarationVor(q, pos) {
  /** @type {{ start: number, name: string } | null} */
  let letzte = null;
  DEKLARATION.lastIndex = 0;
  for (let m = DEKLARATION.exec(q); m && m.index < pos; m = DEKLARATION.exec(q)) {
    letzte = { start: m.index, name: m[1] || m[2] };
  }
  return letzte;
}

const OEFFNEND = { "(": ")", "[": "]", "{": "}" };

/**
 * Index after the bracket that closes the one at `i`, skipping JS string literals.
 * @param {string} q @param {number} i index of `(`, `[` or `{`
 * @returns {number} index after the closing bracket, or -1
 */
function passendesEnde(q, i) {
  /** @type {string[]} */
  const stapel = [];
  for (let j = i; j < q.length; j++) {
    const c = q[j];
    if (c === '"' || c === "'" || c === "`") {
      const k = q.indexOf(c, j + 1);
      if (k < 0 || q.slice(j, k).includes("\n")) continue; // JSX text apostrophe, not a string
      j = k;
      continue;
    }
    if (c in OEFFNEND) stapel.push(OEFFNEND[/** @type {"("|"["|"{"} */ (c)]);
    else if (c === ")" || c === "]" || c === "}") {
      if (stapel.pop() !== c) return -1;
      if (!stapel.length) return j + 1;
    }
  }
  return -1;
}

/**
 * True when some binding of `t` other than the useI18n destructure is in scope at `pos`
 * — then t("…") would call the wrong thing. Checks arrow parameters (`(t) =>`,
 * `t =>`, `(a, t) =>`) and `const|let|var t =` whose scope reaches `pos`. When a scope
 * end cannot be determined the answer is "yes" (conservative).
 * @param {string} q @param {number} von declaration start @param {number} pos field position
 */
export function tVerdeckt(q, von, pos) {
  const bereich = q.slice(von, pos);
  const pfeile = /\(\s*t\s*\)\s*=>|(?<![\w$.])t\s*=>|\(\s*t\s*,[^()]*\)\s*=>|\([^()]*,\s*t\s*\)\s*=>/g;
  for (const m of bereich.matchAll(pfeile)) {
    let i = von + (m.index ?? 0) + m[0].length;
    while (/\s/.test(q[i])) i++;
    let ende;
    if (q[i] === "{" || q[i] === "(") ende = passendesEnde(q, i);
    else {
      // Expression body: runs to the first unbalanced closer or comma/semicolon.
      ende = -1;
      let tiefe = 0;
      for (let j = i; j < q.length; j++) {
        const c = q[j];
        if (c === "(" || c === "[" || c === "{") tiefe++;
        else if (c === ")" || c === "]" || c === "}") {
          if (tiefe-- === 0) { ende = j; break; }
        } else if ((c === "," || c === ";") && tiefe === 0) { ende = j; break; }
      }
    }
    if (ende < 0 || ende > pos) return true;
  }
  for (const m of bereich.matchAll(/(?:const|let|var)\s+t\s*=/g)) {
    // Enclosing block of the declaration: the last unmatched `{` before it.
    let tiefe = 0;
    let auf = -1;
    for (let j = von + (m.index ?? 0); j >= von; j--) {
      if (q[j] === "}") tiefe++;
      else if (q[j] === "{" && tiefe-- === 0) { auf = j; break; }
    }
    const ende = auf < 0 ? -1 : passendesEnde(q, auf);
    if (ende < 0 || ende > pos) return true;
  }
  return false;
}

/**
 * Index right after the `{` that opens the body of the declaration at `start`
 * (`) {`, `) => {`, also inside forwardRef/memo), or -1.
 * @param {string} q @param {number} start @param {number} bis
 */
function koerperOeffnung(q, start, bis) {
  const re = /(\)|=>)\s*\{[ \t]*\r?\n/g;
  re.lastIndex = start;
  const m = re.exec(q);
  if (!m || m.index > bis) return -1;
  return m.index + m[0].indexOf("{") + 1;
}

/**
 * Plans the edits for one file.
 * @param {string} q source
 * @param {{ zeile: number, name: string } | null} [hand] name one field on this line by hand
 *   instead of running the two patterns
 * @returns {{ edits: { start: number, ende: number, text: string }[], treffer: string[],
 *   ausgelassen: string[], schluessel: string[] }}
 */
export function planeDatei(q, hand = null) {
  /** @type {{ start: number, ende: number, text: string }[]} */
  const edits = [];
  /** @type {string[]} */
  const treffer = [];
  /** @type {string[]} */
  const ausgelassen = [];
  /** @type {string[]} */
  const schluessel = [];
  /** @type {Set<number>} declarations that get t (once each) */
  const hookFuer = new Set();
  let brauchtImport = false;

  /** @type {Set<number>} field positions already handled */
  const erledigt = new Set();

  /**
   * Adds aria-label to the field opening tag at `feldStart`, taking care of `t`.
   * @param {number} feldStart @param {string} feldName @param {string} roh label children
   * @param {string} herkunft "label" | "div" for the report
   */
  const benenne = (feldStart, feldName, roh, herkunft) => {
    const zeile = zeileVon(q, feldStart);
    const name = nameAusLabel(roh);
    if ("grund" in name) {
      ausgelassen.push(`${zeile}: ${feldName} — ${name.grund}`);
      return;
    }
    if (name.schluessel !== null || name.attr.startsWith("{t(")) {
      const dekl = deklarationVor(q, feldStart);
      if (!dekl) {
        ausgelassen.push(`${zeile}: ${feldName} — keine umschließende Deklaration`);
        return;
      }
      const bereich = q.slice(dekl.start, feldStart);
      const destr = /const\s*\{([^}]*)\}\s*=\s*useI18n\(\)/.exec(bereich);
      const hatT = !!destr && destr[1].split(",").map((x) => x.trim()).includes("t");
      if (tVerdeckt(q, dekl.start, feldStart)) {
        ausgelassen.push(`${zeile}: ${feldName} — \`t\` in ${dekl.name} anderweitig gebunden`);
        return;
      }
      if (!hatT && !hookFuer.has(dekl.start)) {
        if (!/^[A-Z]/.test(dekl.name)) {
          ausgelassen.push(`${zeile}: ${feldName} — ${dekl.name} ist keine Komponente (kein Hook möglich)`);
          return;
        }
        if (destr) {
          const absStart = dekl.start + destr.index + destr[0].indexOf("{") + 1;
          edits.push({ start: absStart, ende: absStart, text: " t," });
        } else {
          const auf = koerperOeffnung(q, dekl.start, feldStart);
          if (auf < 0) {
            ausgelassen.push(`${zeile}: ${feldName} — ${dekl.name} hat keinen Block-Körper`);
            return;
          }
          const einzug = (/^[ \t]*/.exec(q.slice(q.lastIndexOf("\n", dekl.start) + 1)) || [""])[0];
          edits.push({ start: auf, ende: auf, text: `\n${einzug}  const { t } = useI18n();` });
          brauchtImport = true;
        }
        hookFuer.add(dekl.start);
      }
    }
    const nameEnde = feldStart + feldName.length + 1;
    edits.push({ start: nameEnde, ende: nameEnde, text: ` aria-label=${name.attr}` });
    if (name.schluessel) schluessel.push(name.schluessel);
    erledigt.add(feldStart);
    treffer.push(`${zeile}: ${feldName} → aria-label=${name.attr}${herkunft === "div" ? " (aus <div>-Beschriftung)" : ""}`);
  };

  if (hand) {
    // By hand also icon-only buttons (task 3): their name is the action, not the icon.
    const re = /<(SelectTrigger|Input|Textarea|input|textarea|select|Button|button)(?=[\s/>])/g;
    for (const m of q.matchAll(re)) {
      if (zeileVon(q, m.index ?? 0) !== hand.zeile) continue;
      const tag = q.slice(m.index, tagEnde(q, m.index ?? 0));
      if (/[\s{](?:aria-label|aria-labelledby)\s*=/.test(tag)) continue;
      benenne(m.index ?? 0, m[1], hand.name, "hand");
      break;
    }
    if (!treffer.length && !ausgelassen.length) ausgelassen.push(`${hand.zeile}: kein unbenanntes Feld in dieser Zeile`);
  }

  // Pattern 1: <label>/<Label> right above the field.
  for (const f of hand ? [] : labelFunde(q)) {
    if (!f.feld) continue;
    const feld = f.feld;
    if (hatAttr(feld.tag, "aria-label") || hatAttr(feld.tag, "aria-labelledby")) continue;
    // Field already has an id → link the label (htmlFor), no new string.
    const id = /\sid=("[^"]*"|\{[^{}]*\})/.exec(feld.tag);
    if (id) {
      const nameEnde = f.labelStart + (/^<\w+/.exec(f.labelTag) || [""])[0].length;
      edits.push({ start: nameEnde, ende: nameEnde, text: ` htmlFor=${id[1]}` });
      erledigt.add(feld.start);
      treffer.push(`${zeileVon(q, feld.start)}: ${feld.name} → htmlFor=${id[1]} am Label`);
      continue;
    }
    benenne(feld.start, feld.name, f.text, "label");
  }

  // Pattern 2: a text-only <div> caption as the immediate previous sibling of <Select>:
  //     <div className="text-xs text-slate-500 mb-1">Verfahren</div>
  //     <Select value={verfahren} onValueChange={onVerfahren}>
  //       <SelectTrigger>…
  for (const t of hand ? [] : tags(q, "SelectTrigger")) {
    if (erledigt.has(t.start) || /[\s{](?:aria-label|aria-labelledby|id)\s*=/.test(t.tag)) continue;
    let sel = q.lastIndexOf("<Select", t.start - 1);
    while (sel >= 0 && !/[\s>]/.test(q[sel + 7] || "")) sel = q.lastIndexOf("<Select", sel - 1);
    if (sel < 0) continue;
    const selEnde = tagEnde(q, sel);
    if (selEnde < 0 || q.slice(selEnde, t.start).trim() !== "") continue;
    const vorher = q.slice(0, sel).replace(/\s+$/, "");
    if (!vorher.endsWith("</div>")) continue;
    const zu = vorher.length - "</div>".length;
    const auf = q.lastIndexOf("<div", zu);
    if (auf < 0) continue;
    const aufEnde = tagEnde(q, auf);
    if (aufEnde < 0 || aufEnde > zu) continue;
    const roh = q.slice(aufEnde, zu);
    if (/<[A-Za-z/]/.test(roh)) continue; // not a text-only caption
    benenne(t.start, "SelectTrigger", roh, "div");
  }

  if (brauchtImport && !/import\s*\{[^}]*\buseI18n\b[^}]*\}\s*from\s*["']@core\/lib\/i18n["']/.test(q)) {
    const vorhanden = /import\s*\{([^}]*)\}\s*from\s*["']@core\/lib\/i18n["']/.exec(q);
    if (vorhanden) {
      const pos = vorhanden.index + vorhanden[0].indexOf("{") + 1;
      edits.push({ start: pos, ende: pos, text: " useI18n," });
    } else {
      /** @type {number} */
      let ende = 0;
      for (const m of q.matchAll(/^import\s[^;]*?from\s*["'][^"']+["'];?|^import\s*["'][^"']+["'];?/gm)) {
        ende = (m.index ?? 0) + m[0].length;
      }
      edits.push({ start: ende, ende, text: `${ende ? "\n" : ""}import { useI18n } from "@core/lib/i18n";${ende ? "" : "\n"}` });
    }
  }
  return { edits, treffer, ausgelassen, schluessel };
}

/**
 * Applies non-overlapping edits back to front.
 * @param {string} q @param {{ start: number, ende: number, text: string }[]} edits
 */
export function anwenden(q, edits) {
  let out = q;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.ende);
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const bekannt = new Set(englischePaareAlle().map(([k]) => k));
  /** @type {Set<string>} */
  const neueSchluessel = new Set();
  let nTreffer = 0;
  let nAus = 0;
  let nDateien = 0;
  const handArg = process.argv.includes("--hand") ? process.argv.slice(process.argv.indexOf("--hand") + 1, process.argv.indexOf("--hand") + 3) : null;
  /** @type {{ datei: string, zeile: number, name: string } | null} */
  const hand = handArg ? { datei: path.resolve(REPO, handArg[0].replace(/:\d+$/, "")), zeile: Number(/:(\d+)$/.exec(handArg[0])?.[1]), name: handArg[1] } : null;
  for (const abs of hand ? [hand.datei] : jsxDateien()) {
    const q = fs.readFileSync(abs, "utf8");
    const plan = planeDatei(q, hand ? { zeile: hand.zeile, name: hand.name } : null);
    if (!plan.treffer.length && !plan.ausgelassen.length) continue;
    const rel = path.relative(REPO, abs).replace(/\\/g, "/");
    console.log(`\n${rel}`);
    for (const t of plan.treffer) console.log(`  + ${t}`);
    for (const a of plan.ausgelassen) console.log(`  - AUSGELASSEN ${a}`);
    nTreffer += plan.treffer.length;
    nAus += plan.ausgelassen.length;
    for (const k of plan.schluessel) if (!bekannt.has(k)) neueSchluessel.add(k);
    if (plan.edits.length) {
      nDateien++;
      if (schreiben) fs.writeFileSync(abs, anwenden(q, plan.edits));
    }
  }
  console.log(`\n${nTreffer} Felder benannt/verknüpft in ${nDateien} Dateien, ${nAus} ausgelassen.`);
  console.log(`${neueSchluessel.size} neue t()-Schlüssel ohne englischen Eintrag:`);
  for (const k of [...neueSchluessel].sort((a, b) => a.localeCompare(b, "de"))) console.log(`  ${JSON.stringify(k)}`);
  if (!schreiben) console.log("\nTrockenlauf — mit --schreiben ausführen, um die Dateien zu ändern.");
}
