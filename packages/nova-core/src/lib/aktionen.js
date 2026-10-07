// aktionen.js — action registry for the command palette (Phase 69-12, PROD-15).
//
// Why: the palette (65-05) only jumps between pages; buyers expect Ctrl+K to
// run VERBS of the current view („Prüflauf starten", „BCF exportieren"). An
// action is registered ONCE by the page that owns the handler and offered in
// two places (button + palette) — no duplicated handler, no tooltip scraping.
//
// In:  pages call registriereAktionen(ansicht, [...]) (or the useAktionen
//      hook); ansicht is the route path, e.g. "/ModelCheck".
// Out: aktionenFuer(ansicht) → active actions; parseKuerzel/passtKuerzel for
//      the global keydown in Layout.jsx; abonnieren for re-render triggers.
//
// Pure module (Map-based registry, no React) + one thin hook at the bottom.

import { useEffect } from "react";

/**
 * @typedef {{
 *   id: string,
 *   titel: string,
 *   beschreibung?: string,
 *   kuerzel?: string,
 *   ausfuehren: () => void,
 *   aktiv?: boolean
 * }} Aktion
 * One palette/command entry. `titel`/`beschreibung` are already translated by
 * the caller (i18n keys are German sentences — same convention as navFlach).
 * `kuerzel` is a lowercase chord string, e.g. "mod+shift+p" (mod = Ctrl/⌘).
 * `aktiv === false` hides the action (registry keeps it; e.g. „Prüflauf
 * starten" without a loaded model).
 */

/**
 * @typedef {{mod: boolean, shift: boolean, alt: boolean, key: string}} Kuerzel
 * Parsed chord. `key` is a single lowercase KeyboardEvent.key value.
 */

// Registry: ansicht (route path) → array of blocks. Each registriereAktionen
// call is one block, so abmelden() removes exactly what that caller added —
// two components may register actions for the same view without stepping on
// each other. Insertion order within a view is preserved for the palette.
/** @type {Map<string, {aktionen: Aktion[]}[]>} */
const registry = new Map();

// Subscribers are notified after every registry change so React trees (the
// palette, the ?-help) re-render. Version counter lets useSyncExternalStore
// users detect changes cheaply.
let version = 0;
/** @type {Set<() => void>} */
const abos = new Set();

/** Notify all subscribers (internal — called after every mutation). */
function kundtun() {
  version += 1;
  for (const fn of abos) {
    try {
      fn();
    } catch {
      // A throwing subscriber must not break registration for everyone else.
    }
  }
}

/**
 * Subscribe to registry changes (register/unregister).
 * @param {() => void} fn callback, no arguments
 * @returns {() => void} unsubscribe
 */
export function abonnieren(fn) {
  abos.add(fn);
  return () => abos.delete(fn);
}

/**
 * Monotonic change counter — snapshot value for useSyncExternalStore.
 * @returns {number} version, bumped on every registry mutation
 */
export function aktionenVersion() {
  return version;
}

/**
 * Parse a chord string like "mod+shift+p" into its parts.
 * Grammar: "+"-joined tokens, order free; "mod" = Ctrl or ⌘ (platform-
 * independent, the browser maps metaKey on macOS); any other single-character
 * token is the key. Unknown modifier words throw — a typo must not silently
 * register a dead shortcut.
 * @param {string} s chord string, e.g. "mod+shift+p"
 * @returns {Kuerzel} parsed chord with lowercase `key`
 */
export function parseKuerzel(s) {
  const k = { mod: false, shift: false, alt: false, key: "" };
  for (const roh of String(s || "").split("+")) {
    const teil = roh.trim().toLowerCase();
    if (!teil) continue;
    if (teil === "mod" || teil === "ctrl" || teil === "strg") k.mod = true;
    else if (teil === "shift") k.shift = true;
    else if (teil === "alt") k.alt = true;
    else if (teil.length === 1) k.key = teil;
    else throw new Error(`parseKuerzel: unbekannter Bestandteil „${roh}" in „${s}"`);
  }
  if (!k.key) throw new Error(`parseKuerzel: keine Taste in „${s}"`);
  return k;
}

/**
 * Canonical text form of a chord — used to compare two shortcuts for
 * conflicts regardless of token order ("shift+mod+p" === "mod+shift+p").
 * @param {Kuerzel} k parsed chord
 * @returns {string} e.g. "mod+shift+p"
 */
export function kuerzelText(k) {
  return [k.mod ? "mod" : "", k.shift ? "shift" : "", k.alt ? "alt" : "", k.key]
    .filter(Boolean)
    .join("+");
}

/**
 * Does a keyboard event match a chord? Modifiers must match EXACTLY (a
 * plain "p" chord must not fire on Ctrl+P — that belongs to the browser).
 * @param {KeyboardEvent} ev native event
 * @param {Kuerzel} k parsed chord
 * @returns {boolean} true when the event is exactly this chord
 */
export function passtKuerzel(ev, k) {
  if (!ev || !k || !k.key) return false;
  const mod = !!(ev.ctrlKey || ev.metaKey);
  return (
    mod === !!k.mod &&
    !!ev.shiftKey === !!k.shift &&
    !!ev.altKey === !!k.alt &&
    String(ev.key || "").toLowerCase() === k.key
  );
}

/**
 * All registered shortcut texts of one view (across blocks) — used for the
 * conflict check on registration.
 * @param {string} ansicht route path
 * @returns {Map<string, string>} chord text → action id
 */
function kuerzelJeAnsicht(ansicht) {
  /** @type {Map<string, string>} */
  const m = new Map();
  for (const block of registry.get(ansicht) || []) {
    for (const a of block.aktionen) {
      if (a.kuerzel) m.set(kuerzelText(parseKuerzel(a.kuerzel)), a.id);
    }
  }
  return m;
}

/**
 * Register a block of actions for one view (route path). Two actions with the
 * same shortcut in the same view are a programming error — throw with BOTH
 * ids so the conflict is findable in the console (plan 69-12 Task 1).
 * @param {string} ansicht route path, e.g. "/ModelCheck"
 * @param {Aktion[]} aktionen action block (may be empty)
 * @returns {() => void} abmelden — removes exactly this block
 */
export function registriereAktionen(ansicht, aktionen) {
  const liste = (aktionen || []).filter(Boolean);
  // Validate/parse shortcuts up front so a bad chord throws at registration,
  // not on the first keypress.
  const bekannt = kuerzelJeAnsicht(ansicht);
  for (const a of liste) {
    if (!a.kuerzel) continue;
    const text = kuerzelText(parseKuerzel(a.kuerzel));
    if (bekannt.has(text)) {
      throw new Error(
        `aktionen: Kürzel-Konflikt in Ansicht „${ansicht}": „${text}" ist bereits von Aktion „${bekannt.get(text)}" belegt (neu: „${a.id}")`,
      );
    }
    bekannt.set(text, a.id);
  }
  const block = { aktionen: liste };
  if (!registry.has(ansicht)) registry.set(ansicht, []);
  registry.get(ansicht).push(block);
  kundtun();
  return () => {
    const bloecke = registry.get(ansicht);
    if (!bloecke) return;
    const i = bloecke.indexOf(block);
    if (i >= 0) bloecke.splice(i, 1);
    if (bloecke.length === 0) registry.delete(ansicht);
    kundtun();
  };
}

/**
 * Active actions of one view, in registration order. `aktiv === false`
 * entries are hidden (the palette shows runnable verbs only).
 * @param {string} ansicht route path
 * @returns {Aktion[]} active actions (never undefined)
 */
export function aktionenFuer(ansicht) {
  const out = [];
  for (const block of registry.get(ansicht) || []) {
    for (const a of block.aktionen) if (a.aktiv !== false) out.push(a);
  }
  return out;
}

/**
 * React hook: register `liste` for `ansicht` while mounted, unregister on
 * unmount. The caller memoises the list (plan 69-12 Task 1) so a re-render
 * with new action objects re-registers — that is intended, it keeps
 * closures (state, handlers) fresh.
 * @param {string} ansicht route path
 * @param {Aktion[]} liste memoised action list
 * @returns {void}
 */
export function useAktionen(ansicht, liste) {
  useEffect(() => registriereAktionen(ansicht, liste), [ansicht, liste]);
}
