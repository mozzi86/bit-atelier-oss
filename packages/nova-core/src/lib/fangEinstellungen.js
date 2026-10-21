// Object snap settings shared by every drawing surface (phase 104-05): one module-level store, so the Massing
// modeller and the site plan show and change the same switches (F3 object snap, F8 ortho, F9 grid, F10 polar).
// Remembered per viewer in the browser (localStorage "bit.fang") — a convenience, never model data.
//
// Also: the command records of the snap switches for a command register (befehlsregister.js) and the parser
// for typed snap commands ("polar 15", "raster 0,5", "end" …) of the command line.
//
// In:  user toggles (keys, command line, context menu, chips). Out: the current FangEinstellungen, a React hook,
//      the key handler, register helpers. Browser storage is optional: blocked storage keeps the store in memory.

import { useEffect, useSyncExternalStore } from "react";
import { FANG_STANDARD, fangEinstellungenNormalisieren } from "./objektfang.js";
import { meterLesen } from "./massing/koordinaten.js";

/** @typedef {import("./objektfang.js").FangEinstellungen} FangEinstellungen */

const SPEICHER = "bit.fang";

/** @returns {FangEinstellungen} */
function laden() {
  try {
    if (typeof window === "undefined" || !window.localStorage) return { ...FANG_STANDARD };
    return fangEinstellungenNormalisieren(JSON.parse(window.localStorage.getItem(SPEICHER) || "null"));
  } catch {
    return { ...FANG_STANDARD };
  }
}

let zustand = laden();
/** @type {Set<() => void>} */
const hoerer = new Set();

/**
 * Current settings (stable object until the next change).
 * @returns {FangEinstellungen}
 */
export function fangEinstellungen() {
  return zustand;
}

/**
 * Change settings (merged, normalised, remembered in the browser, all surfaces re-render).
 * @param {Partial<FangEinstellungen>} patch
 * @returns {FangEinstellungen} the new settings
 */
export function fangEinstellungenSetzen(patch) {
  zustand = fangEinstellungenNormalisieren({ ...zustand, ...(patch || {}) });
  try { window.localStorage.setItem(SPEICHER, JSON.stringify(zustand)); } catch { /* storage blocked: keep in memory */ }
  for (const f of hoerer) f();
  return zustand;
}

/**
 * Toggle one switch.
 * @param {'objektfang'|'endpunkt'|'mitte'|'schnitt'|'lot'|'naechster'|'polar'|'ortho'|'raster'} schalter
 * @returns {boolean} the new state
 */
export function fangUmschalten(schalter) {
  /** @type {any} */
  const patch = { [schalter]: !zustand[schalter] };
  // CAD convention: ortho and polar tracking exclude each other.
  if (schalter === "ortho" && patch.ortho) patch.polar = false;
  if (schalter === "polar" && patch.polar) patch.ortho = false;
  return /** @type {any} */ (fangEinstellungenSetzen(patch))[schalter];
}

/** @param {() => void} f */
function abonnieren(f) {
  hoerer.add(f);
  return () => { hoerer.delete(f); };
}

/**
 * React hook: the current settings, re-rendering on every change from any surface.
 * @returns {FangEinstellungen}
 */
export function useFangEinstellungen() {
  return useSyncExternalStore(abonnieren, fangEinstellungen, fangEinstellungen);
}

/** Function keys of the switches (AutoCAD convention). */
export const FANG_TASTEN = Object.freeze({ F3: "objektfang", F8: "ortho", F9: "raster", F10: "polar" });

/**
 * Key handler for F3 / F8 / F9 / F10. Browsers may keep F3 (find) or F10 (menu bar) for themselves even with
 * preventDefault — the command line ("fang", "ortho", "polar", "raster") is the fallback.
 * @param {{key: string, target?: any, preventDefault?: () => void, altKey?: boolean, ctrlKey?: boolean, metaKey?: boolean}} e
 * @returns {string|null} the toggled switch, or null when the key was not one of them
 */
export function fangTaste(e) {
  const schalter = /** @type {Record<string, string>} */ (FANG_TASTEN)[e.key];
  if (!schalter || e.altKey || e.ctrlKey || e.metaKey) return null;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || "")) return null;
  e.preventDefault?.();
  fangUmschalten(/** @type {any} */ (schalter));
  return schalter;
}

let tastenNutzer = 0;
/** @param {KeyboardEvent} e */
const tastenHoerer = (e) => { fangTaste(e); };

/**
 * Hook: listen to F3/F8/F9/F10 while at least one drawing surface is mounted (one window listener for all
 * surfaces, so two open surfaces do not toggle twice).
 * @param {boolean} [aktiv]
 */
export function useFangTasten(aktiv = true) {
  useEffect(() => {
    if (!aktiv) return undefined;
    if (tastenNutzer++ === 0) window.addEventListener("keydown", tastenHoerer);
    return () => { if (--tastenNutzer === 0) window.removeEventListener("keydown", tastenHoerer); };
  }, [aktiv]);
}

/** One-shot snaps: typed short command → snap kind. */
export const EINMAL_FAENGE = Object.freeze({ end: "endpunkt", mit: "mitte", sch: "schnitt", lot: "lot", nae: "naechster" });

/** Labels of the switches (German UI text, translated by the caller). */
export const FANG_LABEL = Object.freeze({
  objektfang: "Objektfang", endpunkt: "Endpunkt", mitte: "Mitte", schnitt: "Schnittpunkt", lot: "Lot", naechster: "Nächster",
  ortho: "Ortho", polar: "Polar", raster: "Raster",
});

/**
 * Typed snap command → action. "fang" / "of" / "fa", "ortho", "polar [Grad]", "raster [Maß]", "end" / "mit" / "sch" /
 * "lot" / "nae". Only exact words (no prefixes), so a running command's typed input is never taken over by accident.
 * @param {string} text typed text
 * @returns {{id: string, wert?: number, art?: string}|{fehler: string}|null}
 *   id: command id in the register (fang, ortho, polar, raster, or the one-shot short form end/mit/sch/lot/nae);
 *   wert: degrees (polar) or metres (raster); art: snap kind of a one-shot; null = not a snap command
 */
export function fangBefehlLesen(text) {
  const teile = String(text || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!teile.length || teile.length > 2) return null;
  const [wort, arg] = teile;
  const einmal = /** @type {Record<string, string>} */ (EINMAL_FAENGE)[wort];
  if (einmal && !arg) return { id: wort, art: einmal };
  if (["fang", "of", "fa"].includes(wort) && !arg) return { id: "fang" };
  if (["ortho", "or"].includes(wort) && !arg) return { id: "ortho" };
  if (wort === "polar") {
    if (!arg) return { id: "polar" };
    const w = /^\d+(?:[.,]\d+)?$/.test(arg) ? Number(arg.replace(",", ".")) : NaN;
    return w >= 1 && w <= 180 ? { id: "polar", wert: w } : { fehler: "Polarwinkel 1 bis 180 Grad" };
  }
  if (["raster", "ra"].includes(wort)) {
    if (!arg) return { id: "raster" };
    const m = meterLesen(arg);
    return m != null && m > 0 && m <= 100 ? { id: "raster", wert: m } : { fehler: "Rastermaß größer 0 bis 100 m" };
  }
  return null;
}

/**
 * Register the snap commands in a command register (one record each — command line, menu and agents call them alike).
 * @param {{registrieren: (b: any) => () => void}} reg command register (befehlsregister.js)
 * @param {{einmal?: (art: string) => void, einmalAktiv?: () => boolean, melden?: (text: string) => void}} [o]
 *   einmal: arm a one-shot snap on the running command; einmalAktiv: whether a command takes points now;
 *   melden: show a message in the command line
 * @returns {() => void} removes the commands again
 */
export function fangBefehleRegistrieren(reg, { einmal = undefined, einmalAktiv = () => true, melden = () => {} } = {}) {
  const an = (/** @type {boolean} */ v) => (v ? "an" : "aus");
  /** @type {Array<() => void>} */
  const weg = [];
  weg.push(reg.registrieren({ id: "fang", label: "Objektfang", menue: "Fang", taste: "F3", kurz: ["of", "fa"],
    ausfuehren: () => { const v = fangUmschalten("objektfang"); melden(`Objektfang ${an(v)}`); return v; } }));
  weg.push(reg.registrieren({ id: "ortho", label: "Ortho", menue: "Fang", taste: "F8", kurz: ["or"],
    ausfuehren: () => { const v = fangUmschalten("ortho"); melden(`Ortho ${an(v)}`); return v; } }));
  weg.push(reg.registrieren({ id: "polar", label: "Polar", menue: "Fang", taste: "F10", parameter: { wert: "zahl" },
    ausfuehren: (/** @type {any} */ p) => {
      const w = Number(p?.wert);
      if (p?.wert != null && p.wert !== "") {
        if (!(w >= 1 && w <= 180)) throw new Error("Polarwinkel 1 bis 180 Grad");
        fangEinstellungenSetzen({ polar: true, ortho: false, polarSchritt_grad: w });
        melden(`Polar an, ${String(w).replace(".", ",")}°`);
        return true;
      }
      const v = fangUmschalten("polar"); melden(`Polar ${an(v)}`); return v;
    } }));
  weg.push(reg.registrieren({ id: "raster", label: "Raster", menue: "Fang", taste: "F9", kurz: ["ra"], parameter: { wert: "zahl" },
    ausfuehren: (/** @type {any} */ p) => {
      const m = typeof p?.wert === "string" ? meterLesen(p.wert) : Number(p?.wert);
      if (p?.wert != null && p.wert !== "") {
        if (!(m != null && m > 0 && m <= 100)) throw new Error("Rastermaß größer 0 bis 100 m");
        fangEinstellungenSetzen({ raster: true, raster_m: m });
        melden(`Raster an, ${String(m).replace(".", ",")} m`);
        return true;
      }
      const v = fangUmschalten("raster"); melden(`Raster ${an(v)}`); return v;
    } }));
  if (einmal) {
    for (const [kurz, art] of Object.entries(EINMAL_FAENGE)) {
      weg.push(reg.registrieren({ id: kurz, label: `Einmal: ${/** @type {any} */ (FANG_LABEL)[art]}`, menue: "Fang", aktiv: einmalAktiv,
        ausfuehren: () => { einmal(art); return art; } }));
    }
  }
  return () => { for (const f of weg) f(); };
}

/**
 * Right-click menu group "Fang" (checkbox entries, Kontextmenue.jsx `an`).
 * @param {FangEinstellungen} e current settings
 * @param {(s: string) => string} t i18n
 * @returns {Array<{label: string, taste?: string, an: boolean, onClick: () => void, trenner?: boolean, gruppe?: string}>}
 */
export function fangKontextEintraege(e, t) {
  /** @type {Array<[keyof typeof FANG_LABEL, string|undefined]>} */
  const liste = [["objektfang", "F3"], ["endpunkt", undefined], ["mitte", undefined], ["schnitt", undefined], ["lot", undefined],
    ["naechster", undefined], ["ortho", "F8"], ["polar", "F10"], ["raster", "F9"]];
  return liste.map(([k, taste], i) => ({
    label: k === "polar" && e.polar ? `${t(FANG_LABEL[k])} ${String(e.polarSchritt_grad).replace(".", ",")}°`
      : k === "raster" && e.raster ? `${t(FANG_LABEL[k])} ${String(e.raster_m).replace(".", ",")} m` : t(FANG_LABEL[k]),
    taste, an: !!/** @type {any} */ (e)[k], onClick: () => { fangUmschalten(/** @type {any} */ (k)); },
    ...(i === 0 ? { trenner: true, gruppe: t("Fang") } : {}),
  }));
}

/**
 * Switch chips of the command line (FANG ORTHO POLAR RASTER, like a CAD status bar).
 * @param {FangEinstellungen} e current settings
 * @param {(s: string) => string} t i18n
 * @returns {Array<{id: string, label: string, an: boolean, titel: string, onClick: () => void}>}
 */
export function fangSchalter(e, t) {
  /** @type {Array<['objektfang'|'ortho'|'polar'|'raster', string, string]>} */
  const liste = [["objektfang", "Fang", "F3"], ["ortho", "Ortho", "F8"], ["polar", "Polar", "F10"], ["raster", "Raster", "F9"]];
  return liste.map(([k, label, taste]) => ({
    id: k, label: t(label), an: !!e[k], titel: `${t(FANG_LABEL[k])} (${taste})`, onClick: () => { fangUmschalten(k); },
  }));
}
