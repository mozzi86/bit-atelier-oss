// Undo/redo for the building model in BitBimStudio.
//
// In:  a history object and the model snapshot from BEFORE a change.
// Out: a new history object (never mutated) and, on undo/redo, the snapshot to restore.
// A drag counts as one step: zieheStart marks the gesture, the first mutation
// inside it is stored, later mutations of the same gesture are not.
// Load, undo apply and the change-step writer pass still:true and record nothing.
// The stack itself is @core/lib/undoStack.js (same one as the massing studio).

import { leererStack, merke, zurueck, vor } from "@core/lib/undoStack";
import { feldDreiWege, gleichWert } from "@core/lib/abgleich/dreiWege";
import { naechsteFreieIdx } from "@core/lib/abgleich/idxListen.js";
import { bauteilGuid } from "@core/lib/bauteil/steckbrief.js";

/**
 * 115-05b (E-2): an element of list `feld` that moves from number `alt` to `neu`. A `guid` equal to the one derived from the OLD
 * number (bauteilGuid(projektId, feld, {_idx: alt}) - what guidsAnheften pinned) is dropped: the other writer's element that keeps
 * number `alt` derives the same GUID, so both would share one furniture key (rooms) and one IFC GlobalId. A GUID of its own stays.
 * Without a project id nothing is dropped (the derivation is unknown).
 * @param {any} el element @param {string} feld list name @param {number} alt old `_idx` @param {number} neu new `_idx`
 * @param {string|null|undefined} projektId project the GUIDs were derived for
 * @returns {any} a new element with `_idx` = neu (and without the derived guid)
 */
export function umnummernOhneAltGuid(el, feld, alt, neu, projektId) {
  const out = { ...el, _idx: neu };
  if (projektId != null && typeof el?.guid === "string" && el.guid === bauteilGuid(projektId, feld, { _idx: alt })) delete out.guid;
  return out;
}

/**
 * 115-05b (E-2): after the live merge renumbered this page's new elements (neueKollisionenUmnummern umbenanntJeListe), each of them
 * drops a `guid` derived from its OLD number (same rule as umnummernOhneAltGuid).
 * @param {Record<string, any>} lokal element lists after the renumbering @param {Record<string, Array<[number, number]>>} umbenanntJeListe
 *   [old, new] `_idx` per list @param {string|null|undefined} projektId
 * @returns {{lokal: Record<string, any>, geaendert: string[]}} the lists (changed ones new) and the names of the lists that changed
 */
export function altGuidsVerwerfen(lokal, umbenanntJeListe, projektId) {
  /** @type {Record<string, any>} */ const out = { ...lokal };
  /** @type {string[]} */ const geaendert = [];
  for (const [feld, paare] of Object.entries(umbenanntJeListe || {})) {
    if (!Array.isArray(out[feld]) || !paare?.length) continue;
    const alt = new Map(paare.map(([a, n]) => [n, a]));
    const liste = out[feld].map((/** @type {any} */ e) => (e && alt.has(e._idx) ? umnummernOhneAltGuid(e, feld, /** @type {number} */ (alt.get(e._idx)), e._idx, projektId) : e));
    if (liste.some((/** @type {any} */ e, /** @type {number} */ i) => e?.guid !== out[feld][i]?.guid)) { out[feld] = liste; geaendert.push(feld); }
  }
  return { lokal: out, geaendert };
}

/**
 * 115-05c (K8 fallback, 115-05-PLAN §6.4 point 8: "Verweise per umbenanntJeListe umschlüsseln"): the solid relations of THIS page
 * that point at an own new element by its derived GUID follow the element when the live merge renumbers it. Without this, the
 * relation would keep the GUID derived from the OLD number - the GUID of the other writer's element that keeps that number - and
 * silently cut or be cut by a foreign element.
 * Relations equal to one of a stored layer (the base or the other writer's state) are never touched: they are not this page's.
 * @param {any} layer the page's solidrelationen_layer ({relationen: [{id, ziel_guid, operator_guid, operation, aktiv}]})
 * @param {Record<string, Array<[number, number]>>} umbenanntJeListe [old, new] `_idx` per element list (neueKollisionenUmnummern)
 * @param {string|null|undefined} projektId project the GUIDs are derived for (without one nothing is changed)
 * @param {ReadonlyArray<any>} [gespeichert] stored layers whose relations stay as they are
 * @returns {any} the same layer when nothing points at a renumbered element, else a new layer
 */
export function relationenUmschluesseln(layer, umbenanntJeListe, projektId, gespeichert = []) {
  const liste = Array.isArray(layer?.relationen) ? layer.relationen : null;
  if (!liste || projektId == null) return layer;
  /** @type {Map<string, string>} */ const neuFuer = new Map();
  for (const [feld, paare] of Object.entries(umbenanntJeListe || {})) {
    for (const [alt, neu] of paare || []) neuFuer.set(bauteilGuid(projektId, feld, { _idx: alt }), bauteilGuid(projektId, feld, { _idx: neu }));
  }
  if (!neuFuer.size) return layer;
  const fremd = gespeichert.flatMap((l) => (Array.isArray(l?.relationen) ? l.relationen : []));
  let anders = false;
  const relationen = liste.map((/** @type {any} */ r) => {
    if (!r || fremd.some((x) => gleichWert(x, r))) return r;
    const ziel = neuFuer.get(r.ziel_guid), op = neuFuer.get(r.operator_guid);
    if (!ziel && !op) return r;
    anders = true;
    return { ...r, ...(ziel ? { ziel_guid: ziel } : {}), ...(op ? { operator_guid: op } : {}) };
  });
  return anders ? { ...layer, relationen } : layer;
}

// ---- 115-05d (C-2): the history outlives the tab ----
// The designer unmounts the tab that is not shown, and with it the studio and its history. The history is put away here on unmount
// and taken back on the next mount of the SAME project - but only when the model then is exactly the model it was put away with
// (same elements, same numbers): after a foreign change, a discard or another draft the snapshots would bring old elements back,
// so the history is dropped instead. A project switch inside the mounted studio still starts with an empty history.

/** @type {Map<string, {historie: ReturnType<typeof leereHistorie>, bild: string}>} */
const abgelegt = new Map();

/**
 * The state a put-away history belongs to, as text. Saved views (`ausschnitte`) are left out: they come from their own layer, which
 * may load after the model, and a snapshot restoring them is harmless.
 * @param {Record<string, any>|null|undefined} modellStand the studio's undo snapshot of now
 * @returns {string}
 */
function standBild(modellStand) {
  const { ausschnitte: _a, ...rest } = modellStand || {};
  return JSON.stringify(rest);
}

/**
 * Puts the history of a project away (studio unmounts). An empty history changes nothing (React's development double mount
 * unmounts once with an empty history right after the mount; the entry of the real unmount before must survive that).
 * @param {string|number|null|undefined} pid project id
 * @param {ReturnType<typeof leereHistorie>} h
 * @param {Record<string, any>|null} modellStand the studio's undo snapshot at this moment
 */
export function historieAblegen(pid, h, modellStand) {
  if (!pid) return;
  const leer = !h || (!h.stack.past.length && !h.stack.future.length);
  if (leer) return;
  abgelegt.set(String(pid), { historie: { stack: h.stack, ziehe: false, gemerkt: false }, bild: standBild(modellStand) });
}

/**
 * Takes the put-away history of a project back (studio mounted and loaded). The entry is consumed either way.
 * @param {string|number|null|undefined} pid project id
 * @param {Record<string, any>|null} modellStand the studio's undo snapshot after the load
 * @returns {ReturnType<typeof leereHistorie>|null} null: none put away, or the model is not the one it belongs to
 */
export function historieHolen(pid, modellStand) {
  if (!pid) return null;
  const e = abgelegt.get(String(pid));
  if (!e) return null;
  abgelegt.delete(String(pid));
  return e.bild === standBild(modellStand) ? e.historie : null;
}

/** Forgets put-away histories: of one project, or all (sign-out, tests). @param {string|number|null} [pid] */
export function historieVergessen(pid = null) {
  if (pid == null) abgelegt.clear(); else abgelegt.delete(String(pid));
}

/**
 * Empty history: no steps, no open drag.
 * @returns {{ stack: {past: any[], future: any[]}, ziehe: boolean, gemerkt: boolean }}
 */
export function leereHistorie() {
  return { stack: leererStack(), ziehe: false, gemerkt: false };
}

/**
 * Remember `vorher` (the state before this mutation) unless the call is silent
 * or it continues a drag whose first mutation was already stored.
 * @param {{ stack: {past: any[], future: any[]}, ziehe: boolean, gemerkt: boolean }} h
 * @param {any} vorher snapshot before the change (JSON-serialisable)
 * @param {{ still?: boolean }} [opt] still: load, applying undo/redo, or a remote/change-step write
 * @returns {{ stack: {past: any[], future: any[]}, ziehe: boolean, gemerkt: boolean }}
 */
export function vorAenderung(h, vorher, { still = false } = {}) {
  if (still) return h;
  if (h.ziehe && h.gemerkt) return h;
  return { stack: merke(h.stack, vorher), ziehe: h.ziehe, gemerkt: h.ziehe };
}

/**
 * A grip drag begins. No snapshot yet — the first real mutation stores one step.
 * @param {{ stack: {past: any[], future: any[]}, ziehe: boolean, gemerkt: boolean }} h
 * @returns {{ stack: {past: any[], future: any[]}, ziehe: boolean, gemerkt: boolean }}
 */
export function zieheStart(h) {
  if (h.ziehe) return h;
  return { ...h, ziehe: true, gemerkt: false };
}

/**
 * The grip was released. The next mutation is a new step.
 * @param {{ stack: {past: any[], future: any[]}, ziehe: boolean, gemerkt: boolean }} h
 * @returns {{ stack: {past: any[], future: any[]}, ziehe: boolean, gemerkt: boolean }}
 */
export function zieheEnde(h) {
  if (!h.ziehe && !h.gemerkt) return h;
  return { ...h, ziehe: false, gemerkt: false };
}

/**
 * Grundriss-Bedienung part 2: a drag was cancelled (Esc) and the caller has written the state of the press back. The step this drag
 * stored is taken off again, so the next undo does not land on a state equal to the present one. Only removed when the newest
 * undo entry equals `vorher` (JSON), i.e. really is the snapshot of this drag; the redo branch the drag cleared stays cleared.
 * @param {{ stack: {past: any[], future: any[]}, ziehe: boolean, gemerkt: boolean }} h
 * @param {any} vorher snapshot of the press (the state written back)
 * @returns {{ stack: {past: any[], future: any[]}, ziehe: boolean, gemerkt: boolean }} drag closed (ziehe false)
 */
export function zieheAbbrechen(h, vorher) {
  const past = h.stack.past;
  const letzter = past[past.length - 1];
  const weg = h.ziehe && h.gemerkt && letzter !== undefined && JSON.stringify(letzter) === JSON.stringify(vorher);
  return { stack: weg ? { past: past.slice(0, -1), future: h.stack.future } : h.stack, ziehe: false, gemerkt: false };
}

/**
 * @param {{ stack: {past: any[], future: any[]}, ziehe: boolean, gemerkt: boolean }} h
 * @param {any} aktuell state now (moves to the redo branch)
 * @returns {{ historie: {stack: {past: any[], future: any[]}, ziehe: boolean, gemerkt: boolean}, snapshot: any }|null}
 */
export function schrittZurueck(h, aktuell) {
  const r = zurueck(h.stack, aktuell);
  if (!r) return null;
  return { historie: { stack: r.stack, ziehe: false, gemerkt: false }, snapshot: r.snapshot };
}

/**
 * @param {{ stack: {past: any[], future: any[]}, ziehe: boolean, gemerkt: boolean }} h
 * @param {any} aktuell state now (moves back to the undo branch)
 * @returns {{ historie: {stack: {past: any[], future: any[]}, ziehe: boolean, gemerkt: boolean}, snapshot: any }|null}
 */
export function schrittVor(h, aktuell) {
  const r = vor(h.stack, aktuell);
  if (!r) return null;
  return { historie: { stack: r.stack, ziehe: false, gemerkt: false }, snapshot: r.snapshot };
}

/**
 * 108-08 (finding 12): values another device changed are not part of THIS studio's history. Every snapshot of the undo and the
 * redo branch takes them over, so undoing a local step (e.g. the entrance switch) no longer writes the storey count, basements or
 * storey table of the other device back to the state before it (before, "Rückgängig" restored the whole programme of the snapshot).
 * Only keys a snapshot already carries are replaced; the open drag flags stay.
 * @param {{ stack: {past: any[], future: any[]}, ziehe: boolean, gemerkt: boolean }} h
 * @param {Record<string, any>} werte field → value as it is now (after the foreign change was taken over)
 * @returns {{ stack: {past: any[], future: any[]}, ziehe: boolean, gemerkt: boolean }} the same object when nothing changed
 */
export function historieUmbasieren(h, werte) {
  const felder = Object.keys(werte || {});
  if (!felder.length || (!h.stack.past.length && !h.stack.future.length)) return h;
  let geaendert = false;
  /** @param {any} s */
  const umbasieren = (s) => {
    if (!s || typeof s !== "object") return s;
    const treffer = felder.filter((k) => k in s && JSON.stringify(s[k]) !== JSON.stringify(werte[k]));
    if (!treffer.length) return s;
    geaendert = true;
    return { ...s, ...Object.fromEntries(treffer.map((k) => [k, werte[k]])) };
  };
  const past = h.stack.past.map(umbasieren);
  const future = h.stack.future.map(umbasieren);
  return geaendert ? { ...h, stack: { past, future } } : h;
}

/**
 * 115-05a (A-6): element lists (and the entrance / envelope appearance) another device changed and this studio took over follow
 * into every snapshot of the undo and the redo branch, so Strg+Z after a foreign change takes back only the own step - it no
 * longer removes the other device's new elements or brings back the ones it deleted (before, a snapshot restored whole old lists
 * and the autosave wrote them over the other device's change).
 * Per snapshot: (1) first the renumbering of the merge (neueKollisionenUmnummern umbenanntJeListe): a local new element with the
 * old number (missing in the base of its list) gets the new one, openings follow a renumbered wall (customWindows.wallIdx);
 * (1b) review K03 - the rule of neueKollisionenUmnummern for elements only a snapshot holds (drawn and deleted again, or waiting in
 * the redo branch): another writer's counter also starts at "stored max + 1" and may hand out the same number. An own element
 * whose number is missing in the base of its list, while a foreign new element (number missing in the base of ITS list, any list)
 * carries it with other content, gets a free number from `naechsteIdx` on - the same new number in every snapshot - and the
 * openings of that snapshot follow a renumbered wall. A foreign "new" element equal to the page's own element of the same list
 * and number (`lokal`: its own save raced the event) is not foreign. Before, both met under one key `_idx:N` in the three ways,
 * "mine" won and Strg+Z / Strg+Y dropped the other writer's element;
 * (2) then per field the snapshot carries: three ways base / snapshot / foreign (dreiWege.js) - the snapshot's own changes win,
 * foreign new elements come in, foreign deleted untouched elements go. A snapshot without a field (older snapshot) keeps it
 * absent. The drag flags stay; historieUmbasieren (programme fields) is unchanged. The caller raises its counter afterwards
 * (historieNaechsteIdx).
 * @param {{ stack: {past: any[], future: any[]}, ziehe: boolean, gemerkt: boolean }} h
 * @param {{basis: Record<string, any>|null|undefined, fremd: Record<string, any>|null|undefined,
 *   umbenanntJeListe?: Record<string, Array<[number, number]>>, felder: ReadonlyArray<string>, lokal?: Record<string, any>|null,
 *   naechsteIdx?: number, projektId?: string|null}} a
 *   basis = the stored record before the foreign change; fremd = the stored record after it; umbenanntJeListe = [old, new] `_idx`
 *   per list of the merge (empty when the studio reloaded); felder = fields to rebase (element lists, entranceCfg, huelle_erscheinung);
 *   lokal = the page's element lists before it took the foreign state over; naechsteIdx = the first number the page's counter hands
 *   out next (new numbers start at or above it and above every number of basis, fremd, lokal and all snapshots); projektId (115-05b,
 *   E-2) = the open project: a renumbered element drops a guid derived from its old number (umnummernOhneAltGuid)
 * @returns {{ stack: {past: any[], future: any[]}, ziehe: boolean, gemerkt: boolean }} the same object when nothing changed
 */
export function historieElementeUmbasieren(h, { basis, fremd, umbenanntJeListe = {}, felder, lokal = null, naechsteIdx = 1, projektId = null }) {
  if (!basis || !fremd || (!h.stack.past.length && !h.stack.future.length)) return h;
  const listen = Object.entries(umbenanntJeListe || {}).filter(([, paare]) => Array.isArray(paare) && paare.length);
  const waende = new Map((umbenanntJeListe?.customWalls || []).map(([alt, neu]) => [alt, neu]));
  /** @param {any} v @returns {any[]} */
  const alsListe = (v) => (Array.isArray(v) ? v : []);
  // (1b) foreign new elements per number, without the page's own elements a racing save stored
  const elementListen = felder.filter((k) => Array.isArray(basis[k]) || Array.isArray(fremd[k]));
  /** @type {Map<number, Array<{feld: string, el: any}>>} */ const fremdNeu = new Map();
  /** numbers of the stored base per list (built once, read for every snapshot) @type {Map<string, Set<any>>} */ const basisIdx = new Map();
  for (const feld of elementListen) {
    const bekannt = new Set(alsListe(basis[feld]).map((e) => e?._idx));
    basisIdx.set(feld, bekannt);
    const eigen = new Map(alsListe(lokal?.[feld]).map((e) => [e?._idx, e]));
    for (const el of alsListe(fremd[feld])) {
      if (typeof el?._idx !== "number" || bekannt.has(el._idx) || gleichWert(eigen.get(el._idx), el)) continue;
      fremdNeu.set(el._idx, [...(fremdNeu.get(el._idx) || []), { feld, el }]);
    }
  }
  let frei = Math.max(naechsteIdx, naechsteFreieIdx(basis), naechsteFreieIdx(fremd), naechsteFreieIdx(lokal), historieNaechsteIdx(h),
    ...listen.flatMap(([, paare]) => paare.map(([, n]) => n + 1)));
  /** own number → new number per list (one element, one new number in every snapshot) @type {Record<string, Map<number, number>>} */
  const neuJeListe = {};
  let geaendert = false;
  /** @param {any} s */
  const umbasieren = (s) => {
    if (!s || typeof s !== "object") return s;
    /** @type {Record<string, any>} */
    let neu = s;
    // (1) renumbering first, so the three-way step below sees this page's new element under its new number
    for (const [feld, paare] of listen) {
      if (!Array.isArray(neu[feld])) continue;
      const bekannt = new Set((Array.isArray(basis[feld]) ? basis[feld] : []).map((/** @type {any} */ e) => e?._idx));
      const karte = new Map(paare);
      const liste = neu[feld].map((/** @type {any} */ e) => (e && karte.has(e._idx) && !bekannt.has(e._idx)
        ? umnummernOhneAltGuid(e, feld, e._idx, /** @type {number} */ (karte.get(e._idx)), projektId) : e));
      if (liste.some((/** @type {any} */ e, /** @type {number} */ i) => e !== neu[feld][i])) neu = { ...neu, [feld]: liste };
    }
    if (waende.size && Array.isArray(neu.customWindows)) {
      const liste = neu.customWindows.map((/** @type {any} */ o) => (o && waende.has(o.wallIdx) ? { ...o, wallIdx: waende.get(o.wallIdx) } : o));
      if (liste.some((/** @type {any} */ o, /** @type {number} */ i) => o !== neu.customWindows[i])) neu = { ...neu, customWindows: liste };
    }
    // (1b) an own element of this snapshot that meets a foreign new element with the same number gets a free one
    /** @type {Map<number, number>} */ const waendeHier = new Map();
    for (const feld of fremdNeu.size ? elementListen : []) {
      if (!Array.isArray(neu[feld])) continue;
      const bekannt = /** @type {Set<any>} */ (basisIdx.get(feld));
      const karte = (neuJeListe[feld] ||= new Map());
      const liste = neu[feld].map((/** @type {any} */ e) => {
        const treffer = typeof e?._idx === "number" && !bekannt.has(e._idx) ? fremdNeu.get(e._idx) : undefined;
        if (!treffer || treffer.some((f) => f.feld === feld && gleichWert(f.el, e))) return e;
        if (!karte.has(e._idx)) karte.set(e._idx, frei++);
        if (feld === "customWalls") waendeHier.set(e._idx, karte.get(e._idx));
        return umnummernOhneAltGuid(e, feld, e._idx, /** @type {number} */ (karte.get(e._idx)), projektId);
      });
      if (liste.some((/** @type {any} */ e, /** @type {number} */ i) => e !== neu[feld][i])) neu = { ...neu, [feld]: liste };
    }
    if (waendeHier.size && Array.isArray(neu.customWindows)) {
      neu = { ...neu, customWindows: neu.customWindows.map((/** @type {any} */ o) => (o && waendeHier.has(o.wallIdx) ? { ...o, wallIdx: waendeHier.get(o.wallIdx) } : o)) };
    }
    // (2) three ways per field the snapshot carries
    for (const k of felder) {
      if (!(k in neu)) continue;
      const wert = feldDreiWege(basis[k], neu[k], fremd[k]).wert;
      if (!gleichWert(wert, neu[k])) neu = { ...neu, [k]: wert };
    }
    if (neu !== s) geaendert = true;
    return neu;
  };
  const past = h.stack.past.map(umbasieren);
  const future = h.stack.future.map(umbasieren);
  return geaendert ? { ...h, stack: { past, future } } : h;
}

/**
 * Review 115-05a (K03): the first `_idx` no snapshot of the undo or the redo branch uses (over all element lists) - the studio raises
 * its counter to it after historieElementeUmbasieren handed out new numbers, so the next element drawn never takes one of them.
 * @param {{ stack: {past: any[], future: any[]} }} h
 * @returns {number} highest `_idx` of every snapshot + 1, at least 1
 */
export function historieNaechsteIdx(h) {
  let n = 1;
  for (const s of [...h.stack.past, ...h.stack.future]) n = Math.max(n, naechsteFreieIdx(s));
  return n;
}
