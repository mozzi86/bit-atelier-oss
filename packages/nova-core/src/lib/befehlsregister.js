// One command register per drawing surface (phase 104-03). Idea: the command model seen in the Craft apps
// (cadcraft) — every command is one record that menu, command line, keyboard, right-click menu, scripts and an AI
// agent all call the same way; own implementation.
//
// A command: { id, label, menue?, taste?, kurz?, aktiv?(ctx) → boolean, ausfuehren(params, ctx) → result,
//              parameter?: { name: "zahl"|"text"|"punkt", … } (documentation for agents / scripts) }.
// Calls never open a dialog and never throw: ausfuehren() answers { ok: true, result } or { ok: false, error }.
// zeileBearbeiten() is the JSON-line form for agents: {"id":…, "method":…, "params":{…}} → one answer line.
//
// In:  commands registered by the surface (they close over its state); ctx = whatever the surface passes.
// Out: lookup (befehlFinden), list with "aktiv", uniform execution and the JSON-line protocol.
//      105-14: registerAnmelden() publishes the register of a MOUNTED surface, so the app-wide shortcut help ("?",
//      src/components/KuerzelHilfe.jsx) lists its keys without a hand-written list; angemeldeteRegister() reads them.

import { befehlFinden } from "./befehlszeile.js";

/**
 * @typedef {{id: string, label: string, menue?: string, taste?: string, kurz?: string[],
 *   parameter?: Record<string, string>, aktiv?: (ctx: any) => boolean, ausfuehren: (params: any, ctx: any) => any}} Befehl
 */

/** @returns register of one drawing surface */
export function befehlsRegister() {
  /** @type {Map<string, Befehl>} */
  const befehle = new Map();
  const reg = {
    /**
     * Add (or replace) a command. @param {Befehl} b @returns {() => void} removes it again
     */
    registrieren(b) {
      if (!b || typeof b.id !== "string" || !b.id || typeof b.ausfuehren !== "function") throw new Error("Befehl braucht id und ausfuehren()");
      befehle.set(b.id, b);
      return () => { if (befehle.get(b.id) === b) befehle.delete(b.id); };
    },
    /** @param {string} id */
    holen(id) { return befehle.get(id) || null; },
    /**
     * All commands with their state (for menus, suggestions, agents).
     * @param {any} [ctx]
     * @returns {Array<{id: string, label: string, menue?: string, taste?: string, kurz: string[], parameter?: Record<string, string>, aktiv: boolean}>}
     */
    alle(ctx) {
      return [...befehle.values()].map((b) => ({ id: b.id, label: b.label, menue: b.menue, taste: b.taste, kurz: b.kurz || [], parameter: b.parameter, aktiv: istAktiv(b, ctx) }));
    },
    /** Typed text → command (short form, name, unique prefix). @param {string} text */
    finden(text) {
      return befehlFinden(text, [...befehle.values()].map((b) => ({ id: b.id, label: b.label, kurz: b.kurz })));
    },
    /**
     * Run a command — never throws, never opens a dialog.
     * @param {string} id
     * @param {any} [params]
     * @param {any} [ctx]
     * @returns {{ok: true, result: any} | {ok: false, error: string}}
     */
    ausfuehren(id, params = {}, ctx = undefined) {
      const b = befehle.get(id);
      if (!b) return { ok: false, error: `Befehl unbekannt: ${id}` };
      if (!istAktiv(b, ctx)) return { ok: false, error: `Befehl gerade nicht möglich: ${b.label}` };
      try {
        const result = b.ausfuehren(params ?? {}, ctx);
        return { ok: true, result: result === undefined ? null : result };
      } catch (e) {
        return { ok: false, error: String(/** @type {any} */ (e)?.message || e) };
      }
    },
    /**
     * JSON-line protocol for agents / scripts: one request line → one answer line.
     * Methods: "befehle" (list), "ausfuehren" ({befehl, params}), "finden" ({text}).
     * @param {string} zeile request, e.g. {"id":1,"method":"ausfuehren","params":{"befehl":"linie"}}
     * @param {any} [ctx]
     * @returns {string} answer line {"id":…, "ok":…, "result"|"error":…}
     */
    zeileBearbeiten(zeile, ctx = undefined) {
      let anfrage;
      try { anfrage = JSON.parse(zeile); } catch { return JSON.stringify({ id: null, ok: false, error: "Kein gültiges JSON" }); }
      const id = anfrage?.id ?? null;
      const p = anfrage?.params || {};
      /** @type {{ok: boolean, result?: any, error?: string}} */
      let antwort;
      if (anfrage?.method === "befehle") antwort = { ok: true, result: reg.alle(ctx) };
      else if (anfrage?.method === "finden") antwort = { ok: true, result: reg.finden(p.text) };
      else if (anfrage?.method === "ausfuehren") antwort = reg.ausfuehren(p.befehl, p.params, ctx);
      else antwort = { ok: false, error: `Methode unbekannt: ${anfrage?.method}` };
      return JSON.stringify({ id, ...antwort });
    },
  };
  return reg;
}

/** @param {Befehl} b @param {any} ctx */
function istAktiv(b, ctx) {
  try { return b.aktiv ? !!b.aktiv(ctx) : true; } catch { return false; }
}

// ---------------------------------------------------------------------------
// 105-14: registers of the surfaces that are mounted right now (for the shortcut help)
// ---------------------------------------------------------------------------

/** @type {Array<{bereich: string, reg: ReturnType<typeof befehlsRegister>}>} mounted registers in mount order */
let angemeldet = [];
let anmeldeStand = 0;
/** @type {Set<() => void>} */
const anmeldeAbos = new Set();

function anmeldungMelden() {
  anmeldeStand += 1;
  for (const fn of anmeldeAbos) {
    try { fn(); } catch { /* a throwing subscriber must not stop the others */ }
  }
}

/**
 * Publishes the register of a mounted drawing surface for the shortcut help. Call it in an effect and return the result
 * as the cleanup, e.g. `useEffect(() => registerAnmelden(befehle, { bereich: "Massenmodell" }), [befehle])`.
 * @param {ReturnType<typeof befehlsRegister>} reg the surface's register
 * @param {{bereich: string}} optionen bereich: German i18n key naming the surface (heading in the help)
 * @returns {() => void} removes exactly this publication again
 */
export function registerAnmelden(reg, optionen) {
  const eintrag = { bereich: String(optionen?.bereich || ""), reg };
  angemeldet = [...angemeldet, eintrag];
  anmeldungMelden();
  return () => {
    const vorher = angemeldet.length;
    angemeldet = angemeldet.filter((e) => e !== eintrag);
    if (angemeldet.length !== vorher) anmeldungMelden();
  };
}

/**
 * Registers of the surfaces mounted right now, in mount order.
 * @returns {ReadonlyArray<{bereich: string, reg: ReturnType<typeof befehlsRegister>}>}
 */
export function angemeldeteRegister() {
  return angemeldet;
}

/**
 * Subscribe to (un)publications — for useSyncExternalStore together with registerStand().
 * @param {() => void} fn
 * @returns {() => void} unsubscribe
 */
export function registerAbonnieren(fn) {
  anmeldeAbos.add(fn);
  return () => { anmeldeAbos.delete(fn); };
}

/**
 * Change counter of the publications (snapshot value for useSyncExternalStore).
 * @returns {number}
 */
export function registerStand() {
  return anmeldeStand;
}
