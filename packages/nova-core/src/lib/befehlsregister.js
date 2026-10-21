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
