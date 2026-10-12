#!/usr/bin/env node
// a11y-schulden.mjs — counts accessibility debts in the JSX source (Plan 72-03).
//
// Reads every .jsx under src/ and packages/*/src/ as TEXT (no parser dependency) and finds
// four kinds of debt:
//   select — <SelectTrigger> without aria-label / aria-labelledby / id
//   icon   — <Button size="icon"…> without aria-label / aria-labelledby
//   label  — <Label> without htmlFor
//   fokus  — a class list with `outline-none` but no visible replacement
//            (focus-visible:…, focus:ring…, focus-within:ring…)
//
// Used by tests/unit/a11y-schulden.test.js (ceilings) and scripts/a11y-codemod.mjs.
//
// Usage:
//   node scripts/a11y-schulden.mjs            # totals per kind
//   node scripts/a11y-schulden.mjs --liste    # every finding with file:line
// In:  repository files. Out: report on stdout (CLI) or plain objects (API).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** @typedef {"select"|"icon"|"label"|"fokus"} SchuldArt */
/** @typedef {{ art: SchuldArt, datei: string, zeile: number, start: number, tag: string }} Schuld */

/** @returns {string[]} absolute paths of all .jsx files in src/ and packages/*\/src/ */
export function jsxDateien(repo = REPO) {
  /** @type {string[]} */
  const wurzeln = [path.join(repo, "src")];
  const pakete = path.join(repo, "packages");
  if (fs.existsSync(pakete)) {
    for (const p of fs.readdirSync(pakete)) {
      const s = path.join(pakete, p, "src");
      if (fs.existsSync(s)) wurzeln.push(s);
    }
  }
  /** @type {string[]} */
  const out = [];
  const lauf = (/** @type {string} */ dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === "__tests__") continue;
        lauf(p);
      } else if (e.name.endsWith(".jsx") && !e.name.includes(".test.")) {
        out.push(p);
      }
    }
  };
  for (const w of wurzeln) lauf(w);
  return out.sort();
}

/**
 * Returns the end index (exclusive, after `>`) of the JSX opening tag starting at `start`
 * (which points at `<`). Skips over `{…}` expressions and quoted attribute values.
 * @param {string} q source
 * @param {number} start index of `<`
 * @returns {number} index after the closing `>`, or -1
 */
export function tagEnde(q, start) {
  let tiefe = 0;
  /** @type {string|null} */
  let quote = null;
  for (let i = start + 1; i < q.length; i++) {
    const c = q[i];
    if (quote) {
      if (c === "\\") { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      // Outside braces only "…" and '…' delimit attribute values; inside braces any JS string.
      if (tiefe > 0 || c !== "`") quote = c;
      continue;
    }
    if (c === "{") tiefe++;
    else if (c === "}") tiefe--;
    else if (c === ">" && tiefe === 0) return i + 1;
  }
  return -1;
}

/** @param {string} tag @param {string} name */
const hatAttr = (tag, name) => new RegExp(`[\\s{]${name}\\s*=`).test(tag) || new RegExp(`\\s${name}[\\s/>]`).test(tag);

const NAMEN = ["aria-label", "aria-labelledby"];

/**
 * @param {string} q source
 * @param {string} name component name, e.g. "SelectTrigger"
 * @returns {{ start: number, ende: number, tag: string }[]} all opening tags of that component
 */
export function tags(q, name) {
  const re = new RegExp(`<${name}(?=[\\s/>])`, "g");
  /** @type {{ start: number, ende: number, tag: string }[]} */
  const out = [];
  for (const m of q.matchAll(re)) {
    const start = m.index ?? 0;
    const ende = tagEnde(q, start);
    if (ende < 0) continue;
    out.push({ start, ende, tag: q.slice(start, ende) });
  }
  return out;
}

/** @param {string} q @param {number} idx */
export const zeileVon = (q, idx) => q.slice(0, idx).split("\n").length;

/** @param {string} tag opening tag text @returns {string} element name */
export const tagName = (tag) => (/^<([A-Za-z][\w.]*)/.exec(tag) || ["", ""])[1];

/** @param {string} tag @returns {boolean} true for `<X … />` */
export const selbstSchliessend = (tag) => /\/\s*>$/.test(tag);

/**
 * Index of the matching closing tag `</name>` for an element whose opening tag ends at
 * `from`; nested elements of the same name are skipped.
 * @param {string} q @param {string} name @param {number} from
 * @returns {number} index of `</name`, or -1
 */
export function schlussVon(q, name, from) {
  const esc = name.replace(/\./g, "\\.");
  const re = new RegExp(`<(/?)${esc}(?=[\\s/>])`, "g");
  re.lastIndex = from;
  let tiefe = 1;
  for (let m = re.exec(q); m; m = re.exec(q)) {
    if (m[1]) {
      if (--tiefe === 0) return m.index;
      continue;
    }
    const e = tagEnde(q, m.index);
    if (e < 0) return -1;
    if (!selbstSchliessend(q.slice(m.index, e))) tiefe++;
    re.lastIndex = e;
  }
  return -1;
}

/**
 * Walks the elements between `a` and `b` and reports whether `b` is still inside the
 * parent element that contains `a` (no closing tag pops below the starting depth).
 * @param {string} q @param {number} a @param {number} b
 */
export function selberElternblock(q, a, b) {
  const re = /<(\/?)([A-Za-z][\w.]*)/g;
  re.lastIndex = a;
  let tiefe = 0;
  for (let m = re.exec(q); m && m.index < b; m = re.exec(q)) {
    if (m[1]) {
      if (--tiefe < 0) return false;
      continue;
    }
    const e = tagEnde(q, m.index);
    if (e < 0 || e > b) break;
    if (!selbstSchliessend(q.slice(m.index, e))) tiefe++;
    re.lastIndex = e;
  }
  return true;
}

/** Self-closing elements with a capitalised name — the lucide icons in this code base. */
const ICON = /<[A-Z][\w.]*(?:\s[^<>]*?)?\/>/g;

/**
 * True when the children of a button are nothing but icon elements (optionally switched
 * by a condition such as `{busy ? <Loader2 /> : <Trash2 />}`) — no text, no t(), no
 * expression that could print text.
 * @param {string} inhalt children source between the opening and the closing tag
 */
export function nurIcon(inhalt) {
  const c = inhalt.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  let icons = 0;
  let i = 0;
  let aussen = "";
  while (i < c.length) {
    if (c[i] !== "{") {
      aussen += c[i++];
      continue;
    }
    let tiefe = 0;
    let j = i;
    for (; j < c.length; j++) {
      if (c[j] === "{") tiefe++;
      else if (c[j] === "}" && --tiefe === 0) break;
    }
    const block = c.slice(i + 1, j);
    const n = (block.match(ICON) || []).length;
    const rest = block.replace(ICON, "");
    // A fragment (<>…</>) next to an icon carries visible text such as "<Pause /> Pause".
    if (n === 0 || /<[A-Za-z]|<\/?>/.test(rest) || /["'`]/.test(rest) || /\bt\(/.test(rest)) return false;
    icons += n;
    i = j + 1;
  }
  icons += (aussen.match(ICON) || []).length;
  return icons > 0 && aussen.replace(ICON, "").trim() === "";
}

/** Form controls that a preceding label is meant to name. */
const FELD = /<(SelectTrigger|Input|Textarea|input|textarea|select)(?=[\s/>])/g;
/** Controls that, when inside a label, are named by it (wrapping association). */
const UMSCHLOSSEN = /<(?:Input|Textarea|input|textarea|select|Select|SelectTrigger|Checkbox|Switch|RadioGroupItem|Slider)(?=[\s/>])/;

/**
 * @typedef {{ labelStart: number, labelTagEnde: number, labelTag: string, text: string,
 *   feld: { name: string, start: number, ende: number, tag: string } | null }} LabelFund
 */

/**
 * Every `<label>`/`<Label>` without htmlFor that does not wrap a control, together with
 * the control it visually labels: the next SelectTrigger/Input/Textarea/input/textarea/
 * select at most eight lines below the label (a multi-line <Select …> opening sits in
 * between), in the same parent element, with no other
 * label in between. Checkbox, radio, hidden and file inputs are not named by a heading
 * label and are ignored.
 * @param {string} q source
 * @returns {LabelFund[]}
 */
export function labelFunde(q) {
  /** @type {LabelFund[]} */
  const out = [];
  for (const name of ["label", "Label"]) {
    for (const t of tags(q, name)) {
      if (hatAttr(t.tag, "htmlFor") || selbstSchliessend(t.tag)) continue;
      const schluss = schlussVon(q, name, t.ende);
      if (schluss < 0) continue;
      const text = q.slice(t.ende, schluss);
      if (UMSCHLOSSEN.test(text)) continue;
      const nachLabel = q.indexOf(">", schluss) + 1;
      const letzteZeile = zeileVon(q, nachLabel) + 8;
      /** @type {LabelFund["feld"]} */
      let feld = null;
      FELD.lastIndex = nachLabel;
      const m = FELD.exec(q);
      if (m && zeileVon(q, m.index) <= letzteZeile) {
        const zwischen = q.slice(nachLabel, m.index);
        const ende = tagEnde(q, m.index);
        const tag = ende > 0 ? q.slice(m.index, ende) : "";
        const ignoriert = m[1] === "input" && /\stype="(?:checkbox|radio|hidden|file)"/.test(tag);
        if (ende > 0 && !ignoriert && !/<[lL]abel[\s>]/.test(zwischen) && selberElternblock(q, nachLabel, m.index)) {
          feld = { name: m[1], start: m.index, ende, tag };
        }
      }
      out.push({ labelStart: t.start, labelTagEnde: t.ende, labelTag: t.tag, text, feld });
    }
  }
  return out.sort((a, b) => a.labelStart - b.labelStart);
}

const FOKUS_ERSATZ = /focus-visible:|focus:ring|focus-within:ring|focus:border|focus:shadow|focus:bg-|data-\[highlighted\]/;

/**
 * The JSX opening tag that contains `idx` (e.g. a className string), or null.
 * @param {string} q @param {number} idx
 */
function umschliessenderTag(q, idx) {
  let pos = idx;
  for (let n = 0; n < 60; n++) {
    pos = q.lastIndexOf("<", pos - 1);
    if (pos < 0) return null;
    if (!/[A-Za-z]/.test(q[pos + 1] || "")) continue;
    const e = tagEnde(q, pos);
    if (e > idx) return q.slice(pos, e);
  }
  return null;
}

/**
 * Opening tag of the element that directly contains `pos`, found with a tag stack from
 * the start of the file, or null.
 * @param {string} q @param {number} pos
 */
function elternTag(q, pos) {
  /** @type {{ name: string, tag: string }[]} */
  const stapel = [];
  const re = /<(\/?)([A-Za-z][\w.]*)/g;
  for (let m = re.exec(q); m && m.index < pos; m = re.exec(q)) {
    if (m[1]) {
      const i = stapel.map((s) => s.name).lastIndexOf(m[2]);
      if (i >= 0) stapel.length = i;
      continue;
    }
    const e = tagEnde(q, m.index);
    if (e < 0) continue;
    if (e > pos) break; // the element whose own tag contains pos
    const tag = q.slice(m.index, e);
    if (!selbstSchliessend(tag)) stapel.push({ name: m[2], tag });
    re.lastIndex = e;
  }
  return stapel.length ? stapel[stapel.length - 1].tag : null;
}

/**
 * All debts in one source text.
 * @param {string} q source
 * @param {string} datei repo-relative path for the report
 * @returns {Schuld[]}
 */
export function schuldenInQuelle(q, datei) {
  /** @type {Schuld[]} */
  const out = [];
  const push = (/** @type {SchuldArt} */ art, /** @type {number} */ start, /** @type {string} */ tag) =>
    out.push({ art, datei, zeile: zeileVon(q, start), start, tag });

  // (a) select fields without a programmatic name.
  for (const t of tags(q, "SelectTrigger")) {
    if (![...NAMEN, "id"].some((n) => hatAttr(t.tag, n))) push("select", t.start, t.tag);
  }
  // (b) icon-only buttons without a name — size="icon…" or children that are only icons.
  //     A title is no substitute: it only shows on mouse hover.
  for (const name of ["Button", "button"]) {
    for (const t of tags(q, name)) {
      if (NAMEN.some((n) => hatAttr(t.tag, n)) || selbstSchliessend(t.tag)) continue;
      const iconGroesse = /\ssize=(?:"icon[^"]*"|\{"icon[^"]*"\})/.test(t.tag);
      const schluss = schlussVon(q, name, t.ende);
      if (iconGroesse || (schluss > 0 && nurIcon(q.slice(t.ende, schluss)))) push("icon", t.start, t.tag);
    }
  }
  // (c) a label that visually names a field but is not linked to it: no htmlFor, not
  //     wrapping it, and the field has neither aria-label nor aria-labelledby. Select
  //     fields are counted in (a), not twice here.
  for (const f of labelFunde(q)) {
    if (!f.feld || f.feld.name === "SelectTrigger") continue;
    if (NAMEN.some((n) => hatAttr(/** @type {{tag: string}} */ (f.feld).tag, n))) continue;
    push("label", f.labelStart, f.labelTag);
  }
  // (d) outline-none without a visible replacement in the same element. Elements that only
  //     receive focus programmatically (tabIndex={-1}, Radix *Content containers) are exempt.
  for (const m of q.matchAll(/(["'`])((?:(?!\1)[^\\\n]|\\.)*?\boutline-none\b(?:(?!\1)[^\\\n]|\\.)*?)\1/g)) {
    if (FOKUS_ERSATZ.test(m[2])) continue;
    const tag = umschliessenderTag(q, m.index ?? 0);
    if (tag) {
      if (FOKUS_ERSATZ.test(tag)) continue;
      if (/tabIndex=\{-1\}/.test(tag) || /Content$/.test(tagName(tag))) continue;
      // Ring on the direct container (focus-within:ring…) is a visible replacement too.
      const eltern = elternTag(q, m.index ?? 0);
      if (eltern && /focus-within:ring/.test(eltern)) continue;
    }
    push("fokus", m.index ?? 0, m[0]);
  }
  return out;
}

/** @returns {Schuld[]} all debts in the repository */
export function alleSchulden(repo = REPO) {
  return jsxDateien(repo).flatMap((abs) =>
    schuldenInQuelle(fs.readFileSync(abs, "utf8"), path.relative(repo, abs).replace(/\\/g, "/"))
  );
}

/** @param {Schuld[]} liste @returns {Record<SchuldArt, number>} */
export function zaehlen(liste) {
  /** @type {Record<SchuldArt, number>} */
  const z = { select: 0, icon: 0, label: 0, fokus: 0 };
  for (const s of liste) z[s.art]++;
  return z;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const liste = alleSchulden();
  if (process.argv.includes("--liste")) {
    for (const s of liste) console.log(`${s.art.padEnd(6)} ${s.datei}:${s.zeile}`);
    console.log("");
  }
  console.log(JSON.stringify(zaehlen(liste)));
}
