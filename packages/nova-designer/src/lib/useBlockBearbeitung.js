// Interaction controller for the blocks of the site plan (phase 95-04…06), shared by the map view
// and the SVG fallback of SiteDesigner — the views only translate their pointer events into site
// metres + screen pixels and call runter / bewegen / hoch.
//
// In:  stored buildings (canvas units), m_per_px, plot polygon and building envelopes (metres),
//      onChange (gets the new stored array), an `aktiv` flag (selection mode) and a container ref
//      (keys only act while the plan is visible).
// Out: selection, live preview while dragging, frame, snap target, rotate handle, the check
//      result after each move, undo/redo and `commit` for every other edit (add / delete).
//
// Interaction like CAD / SketchUp:
//   click = select, Shift+click = toggle, empty drag left→right = window, right→left = crossing;
//   drag a block = move (Ctrl = copy, Alt = snapping off); rotate handle = 15° steps (Alt = free);
//   Delete, Esc, Ctrl+A/C/V/Z/Y, arrows 0.1 m (Shift 1 m).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  alsBlock, alsGebaeude, auswahlMitte, drehen, ecken, FANG_PX, fangKorrektur, klickAuswahl,
  kopieren, pruefen, rahmenAuswahl, rahmenModus, trefferBlock, verschieben, winkelFang, GESCHOSS_HOEHE_M,
} from "@core/lib/massing/bloecke";
import { abstandsTiefe } from "@core/lib/massing/baurecht";

/** Max. undo depth (snapshots of the buildings array). [ASSUMED] */
const VERLAUF_MAX = 100;
/** Below this many screen px a frame drag counts as a click. */
const KLICK_PX = 4;

/**
 * @typedef {{x: number, y: number}} P
 * @typedef {{umschalt?: boolean, strg?: boolean, alt?: boolean}} Tasten
 */

/**
 * @param {{buildings: any[], mpp: number, onChange: (b: any[]) => void, aktiv: boolean,
 *   grenzeM?: P[]|null, baufelderM?: P[][], containerRef?: {current: HTMLElement|null}}} opt
 *   grenzeM = plot polygon in site metres, baufelderM = building envelopes in site metres
 */
export function useBlockBearbeitung({ buildings, mpp, onChange, aktiv, grenzeM = null, baufelderM = [], containerRef }) {
  const [auswahl, setAuswahl] = useState(/** @type {string[]} */ ([]));
  const [live, setLive] = useState(/** @type {any[]|null} */ (null));
  const [rahmen, setRahmen] = useState(/** @type {{a: P, b: P, sa: P, sb: P, modus: 'fenster'|'kreuzen'}|null} */ (null));
  const [fangZiel, setFangZiel] = useState(/** @type {string|null} */ (null));
  const [winkel, setWinkel] = useState(/** @type {number|null} */ (null));
  const zugRef = useRef(/** @type {any} */ (null));
  const undoRef = useRef(/** @type {any[][]} */ ([]));
  const redoRef = useRef(/** @type {any[][]} */ ([]));
  const ablageRef = useRef(/** @type {any[]} */ ([]));
  const cursorRef = useRef(/** @type {P|null} */ (null));
  const [, setVerlaufStand] = useState(0); // re-render after undo stack changes (button states)

  const anzeige = live || buildings;
  const bloecke = useMemo(() => anzeige.filter((b) => Number(b?.width) > 0 && Number(b?.height) > 0).map((b) => alsBlock(b, mpp)), [anzeige, mpp]);
  const pruefung = useMemo(() => pruefen(bloecke, { grenze: grenzeM }), [bloecke, grenzeM]);
  // Selection of ids that no longer exist (deleted elsewhere, undo) is dropped silently.
  const gueltig = useMemo(() => auswahl.filter((id) => bloecke.some((k) => k.id === id)), [auswahl, bloecke]);

  /** Every edit goes through here: one undo step, then up to the parent. */
  const commit = useCallback((/** @type {any[]} */ next) => {
    undoRef.current = [...undoRef.current.slice(-(VERLAUF_MAX - 1)), buildings];
    redoRef.current = [];
    setVerlaufStand((n) => n + 1);
    onChange(next);
  }, [buildings, onChange]);

  /** Blocks (metres) → stored array, keeping unknown fields of existing records. */
  const speichern = useCallback((/** @type {any[]} */ neu) => {
    const roh = Object.fromEntries(buildings.map((b) => [b.id, b]));
    return neu.map((k) => alsGebaeude(k, mpp, roh[k.id] || {}));
  }, [buildings, mpp]);

  const rueckgaengig = useCallback(() => {
    const prev = undoRef.current.pop();
    if (!prev) return;
    redoRef.current.push(buildings);
    setVerlaufStand((n) => n + 1);
    onChange(prev);
  }, [buildings, onChange]);
  const wiederholen = useCallback(() => {
    const next = redoRef.current.pop();
    if (!next) return;
    undoRef.current.push(buildings);
    setVerlaufStand((n) => n + 1);
    onChange(next);
  }, [buildings, onChange]);

  /** Snap targets for a moving selection: plot edges (0 / setback depth), envelopes, other blocks. */
  const fangZiele = useCallback((/** @type {string[]} */ ids) => {
    const sel = bloecke.filter((k) => ids.includes(k.id));
    const T = abstandsTiefe(Math.max(1, ...sel.map((k) => k.geschosse)) * GESCHOSS_HOEHE_M);
    /** @type {Array<{a: P, b: P, abstaende?: number[], art: string}>} */
    const z = [];
    const kanten = (/** @type {P[]} */ poly, /** @type {string} */ art, /** @type {number[]} */ abst) => poly.forEach((a, i) => z.push({ a, b: poly[(i + 1) % poly.length], abstaende: abst, art }));
    if (grenzeM?.length >= 3) kanten(grenzeM, "grenze", [T]);
    for (const f of baufelderM) if (f?.length >= 3) kanten(f, "baufeld", []);
    for (const k of bloecke) if (!ids.includes(k.id)) kanten(ecken(k), "block", [T]);
    return z;
  }, [bloecke, grenzeM, baufelderM]);

  /**
   * Pointer down on the plan (selection mode).
   * @param {P} p site metres
   * @param {P} s screen px
   * @param {Tasten} t modifier keys
   * @param {number} mProPx metres per screen pixel (snap radius)
   */
  const runter = useCallback((p, s, t, mProPx) => {
    cursorRef.current = p;
    const hit = trefferBlock(bloecke, p);
    if (hit) {
      if (t.umschalt && gueltig.includes(hit)) { setAuswahl(gueltig.filter((x) => x !== hit)); return; }
      const ids = gueltig.includes(hit) ? gueltig : klickAuswahl(gueltig, hit, !!t.umschalt);
      setAuswahl(ids);
      zugRef.current = { art: "verschieben", start: p, ids, kopie: !!t.strg, basis: bloecke, mProPx, bewegt: false };
      return;
    }
    zugRef.current = { art: "rahmen", start: p, sstart: s, umschalt: !!t.umschalt };
  }, [bloecke, gueltig]);

  /** Pointer down on the rotate handle. @param {P} p site metres */
  const griffRunter = useCallback((p) => {
    const um = auswahlMitte(bloecke, gueltig);
    if (!um) return;
    zugRef.current = { art: "drehen", um, w0: Math.atan2(p.y - um.y, p.x - um.x), ids: gueltig, basis: bloecke, bewegt: false };
  }, [bloecke, gueltig]);

  /** @param {P} p site metres @param {P} s screen px @param {Tasten} t */
  const bewegen = useCallback((p, s, t) => {
    cursorRef.current = p;
    const z = zugRef.current;
    if (!z) return;
    if (z.art === "rahmen") {
      if (Math.hypot(s.x - z.sstart.x, s.y - z.sstart.y) < KLICK_PX) return;
      setRahmen({ a: z.start, b: p, sa: z.sstart, sb: s, modus: rahmenModus(z.sstart.x, s.x) });
      return;
    }
    if (z.art === "drehen") {
      let g = ((Math.atan2(p.y - z.um.y, p.x - z.um.x) - z.w0) * 180) / Math.PI;
      if (!t.alt) g = winkelFang(g);
      z.bewegt = true;
      setWinkel(Math.round(g));
      z.ergebnis = speichern(drehen(z.basis, z.ids, g, z.um));
      setLive(z.ergebnis);
      return;
    }
    // verschieben / kopieren
    let dx = p.x - z.start.x, dy = p.y - z.start.y;
    let ziel = null;
    if (!t.alt) {
      const punkte = z.basis.filter((k) => z.ids.includes(k.id)).flatMap(ecken).map((q) => ({ x: q.x + dx, y: q.y + dy }));
      const k = fangKorrektur(punkte, fangZiele(z.ids), FANG_PX * (z.mProPx || 0.1));
      dx += k.dx; dy += k.dy; ziel = k.ziel;
    }
    z.bewegt = z.bewegt || Math.hypot(dx, dy) > 1e-3;
    z.d = { dx, dy };
    setFangZiel(ziel);
    if (z.kopie || t.strg) {
      let n = 0;
      setLive(speichern(kopieren(z.basis, z.ids, dx, dy, () => `vorschau_${n++}`).bloecke));
    } else {
      setLive(speichern(verschieben(z.basis, z.ids, dx, dy)));
    }
  }, [fangZiele, speichern]);

  /** Pointer up. @param {Tasten} [t] */
  const hoch = useCallback((t = {}) => {
    const z = zugRef.current;
    zugRef.current = null;
    setFangZiel(null);
    setWinkel(null);
    if (!z) return;
    if (z.art === "rahmen") {
      setRahmen(null);
      if (!rahmen) { if (!z.umschalt) setAuswahl([]); return; } // click on empty ground
      const ids = rahmenAuswahl(bloecke, rahmen.a, rahmen.b, rahmen.modus);
      setAuswahl(z.umschalt ? [...new Set([...gueltig, ...ids])] : ids);
      return;
    }
    setLive(null);
    if (!z.bewegt) return;
    if (z.art === "drehen") { commit(z.ergebnis); return; }
    const { dx, dy } = z.d || { dx: 0, dy: 0 };
    if (z.kopie || t.strg) {
      const { bloecke: neu, neu: ids } = kopieren(z.basis, z.ids, dx, dy, neueId);
      commit(speichern(neu));
      setAuswahl(ids);
    } else {
      commit(speichern(verschieben(z.basis, z.ids, dx, dy)));
    }
  }, [bloecke, commit, gueltig, rahmen, speichern]);

  /** Escape during a drag: drop the preview. */
  const abbrechen = useCallback(() => {
    zugRef.current = null;
    setLive(null); setRahmen(null); setFangZiel(null); setWinkel(null);
  }, []);

  const loeschen = useCallback(() => {
    if (!gueltig.length) return;
    commit(buildings.filter((b) => !gueltig.includes(b.id)));
    setAuswahl([]);
  }, [buildings, commit, gueltig]);

  // Keys act only while the plan is visible (the designer tabs stay mounted) and never while
  // typing into a field.
  useEffect(() => {
    const taste = (/** @type {KeyboardEvent} */ e) => {
      const el = /** @type {HTMLElement|null} */ (e.target && "tagName" in e.target ? e.target : null);
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (el?.isContentEditable) return;
      if (!containerRef?.current || containerRef.current.offsetParent === null) return;
      const strg = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
      if (strg && (k === "z" || k === "y")) {
        e.preventDefault();
        if (k === "y" || e.shiftKey) wiederholen(); else rueckgaengig();
        return;
      }
      if (!aktiv) return;
      if (k === "escape") { abbrechen(); setAuswahl([]); return; }
      if (k === "delete" || k === "backspace") { if (gueltig.length) { e.preventDefault(); loeschen(); } return; }
      if (strg && k === "a") { e.preventDefault(); setAuswahl(bloecke.map((b) => b.id)); return; }
      if (strg && k === "c") { ablageRef.current = bloecke.filter((b) => gueltig.includes(b.id)); return; }
      if (strg && k === "v") {
        const quelle = ablageRef.current;
        if (!quelle.length) return;
        e.preventDefault();
        const m = /** @type {P} */ (auswahlMitte(quelle, quelle.map((b) => b.id)));
        // Paste at the last cursor position on the plan; without one 5 m to the right. [ASSUMED]
        const ziel = cursorRef.current || { x: m.x + 5, y: m.y };
        const kopien = quelle.map((b) => ({ ...b, id: neueId(), cx: b.cx + ziel.x - m.x, cy: b.cy + ziel.y - m.y }));
        commit(speichern([...bloecke, ...kopien]));
        setAuswahl(kopien.map((b) => b.id));
        return;
      }
      const pfeil = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] }[k];
      if (pfeil && gueltig.length) {
        e.preventDefault();
        const schritt = e.shiftKey ? 1 : 0.1; // m
        commit(speichern(verschieben(bloecke, gueltig, pfeil[0] * schritt, pfeil[1] * schritt)));
      }
    };
    window.addEventListener("keydown", taste);
    return () => window.removeEventListener("keydown", taste);
  }, [aktiv, abbrechen, bloecke, commit, containerRef, gueltig, loeschen, rueckgaengig, speichern, wiederholen]);

  // Rotate handle anchor: top centre of the selection (metres). The views draw the handle a fixed
  // number of SCREEN pixels above it — a metre offset covered small blocks at low zoom.
  const griff = useMemo(() => {
    if (!aktiv || !gueltig.length) return null;
    const e = bloecke.filter((k) => gueltig.includes(k.id)).flatMap(ecken);
    const ys = e.map((p) => p.y), xs = e.map((p) => p.x);
    return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: Math.min(...ys) };
  }, [aktiv, bloecke, gueltig]);

  return {
    auswahl: gueltig, setAuswahl, anzeige, bloecke, pruefung, rahmen, fangZiel, winkel, griff,
    runter, griffRunter, bewegen, hoch, abbrechen, loeschen, commit, rueckgaengig, wiederholen,
    kannZurueck: undoRef.current.length > 0, kannVor: redoRef.current.length > 0,
  };
}

let zaehler = 0;
/** Unique id for new blocks (same pattern as SiteDesigner's `bld_<time>`). */
function neueId() {
  zaehler = (zaehler + 1) % 1e6;
  return `bld_${Date.now()}_${zaehler}`;
}
