// 98-02…98-05: SketchUp-like modelling tools in the Massing Studio (user brief 17.10.2026).
// Tools: Linie (L) — click points, the chain closes into a face at its first point and becomes a
// body; Push/Pull (P) — type the distance; Verschieben (M) — two clicks, Ctrl = copy, then typed
// "*3" (three copies at that distance) or "/3" (three copies dividing it); Leertaste = selection.
// Typed input ("VCB", bottom right of the plan) works like SketchUp: type, Enter.
// Groups: "Gruppe bilden" gives the selection a NUMBER — every body with that number is an
// instance; changing one changes all of that number; "Eindeutig" gives a new number.
//
// The data model is pure (@core/lib/massing/massingModell.js); this file is input and drawing
// only. Bodies live in the BimModel field `massing_layer` (saved debounced through saveBimModel);
// the studio's own main body (footprint + storeys) stays as it is.
//
// In:  projectId, plan transforms of the studio (mx, my, px, offX, offY, scale, svgRef, clampPt),
//      storey height, t. Out: hook state + <ModellWerkzeugleiste/> (HTML) + <ModellEbene/> (SVG).
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  leererLayer, geometrie, koerperAnlegen, pushPull, verschieben, kopieren, gruppeBilden, eindeutigMachen,
  eingabeLesen, flaecheSchliessen, goldenerSchnittVorschlag, drehen, skalieren, folgeMir, schwerpunkt, eckeVerschieben, aufstocken,
} from "@core/lib/massing/massingModell.js";
import { leererStack, merke, zurueck, vor } from "@core/lib/undoStack";
import { punktInnen } from "@core/lib/polygonInnen";
import { auswerten, beispielGraph } from "@core/lib/massing/knoten.js";
import { leeresGelaende, formen, glaetten, stempeln } from "@core/lib/massing/gelaende.js";
import { riegelLayout, WOHNUNGSTYPEN, MIX_VORLAGEN, RIEGEL_STANDARD } from "@core/lib/massing/riegel.js";
import { koordinateLesen, zielPunkt } from "@core/lib/massing/koordinaten.js";
import { befehlsRegister } from "@core/lib/befehlsregister.js";
import { starteSteuerungsBruecke } from "@core/lib/steuerungsBruecke.js";
import Befehlszeile from "@core/components/Befehlszeile";
import FangGlyphe, { strahlEnden } from "@core/components/FangGlyphe";
import { befehlsAufforderung } from "@core/lib/befehlszeile";
// 104-05: object snap (endpoint, midpoint, intersection, perpendicular, nearest, polar, ortho, grid) — one core
// for the modeller and the site plan; settings shared through one store (F3/F8/F9/F10, command line, menu).
import { fangIndex, fangPunkt, segmenteAusRingen } from "@core/lib/objektfang.js";
import { useFangEinstellungen, useFangTasten, fangBefehleRegistrieren, fangBefehlLesen, fangEinstellungen, fangKontextEintraege, fangSchalter, FANG_LABEL } from "@core/lib/fangEinstellungen.js";
import { loadBimModel, saveBimModel } from "@core/lib/useBimModelSync";

/** Tools with their SketchUp shortcut. */
export const WERKZEUGE = Object.freeze([
  { id: "auswahl", taste: " ", label: "Auswahl", hilfe: "Körper anklicken, Umschalt = mehrere; Ecken eines Körpers ziehen formt ihn (Gruppe: alle)" },
  { id: "linie", taste: "l", label: "Linie", hilfe: "Punkte klicken, am Startpunkt schließen = Fläche; Länge tippen + Enter" },
  { id: "pushpull", taste: "p", label: "Push/Pull", hilfe: "Körper wählen, Abstand tippen + Enter (Strg+Enter = aufstocken); in 3D am Körper ziehen" },
  { id: "verschieben", taste: "m", label: "Verschieben", hilfe: "Körper, dann Ziel klicken; Strg = Kopie; danach *3 oder /3 tippen" },
  { id: "drehen", taste: "q", label: "Drehen", hilfe: "Körper wählen, Winkel in Grad tippen + Enter (um den Schwerpunkt)" },
  { id: "skalieren", taste: "s", label: "Skalieren", hilfe: "Körper wählen, Faktor tippen + Enter (Gruppe: alle Instanzen)" },
  { id: "folgemir", taste: "f", label: "Folge mir", hilfe: "Pfad klicken; Enter = 30 cm × Geschosshöhe, oder Breite;Höhe tippen + Enter" },
  { id: "gelaende", taste: "g", label: "Gelände", hilfe: "Sandbox: anheben, absenken, glätten oder Körper stempeln — Klick in den Plan" },
  { id: "riegel", taste: "r", label: "Riegel", hilfe: "Pfad klicken, Enter = Wohnriegel mit Mittelflur und Wohnungsmix; Werte in der Zeile darunter" },
]);

/** 104-02: typed short forms of the tools (besides the key and the full name), CAD convention. */
const KURZFORMEN = Object.freeze({
  auswahl: ["a", "au"], linie: ["l", "li"], pushpull: ["p", "pp"], verschieben: ["m", "v", "ve"],
  drehen: ["q", "dr", "ro"], skalieren: ["s", "sk", "sc"], folgemir: ["f", "fm"], gelaende: ["g", "ge"], riegel: ["r", "ri"],
});

/** Sandbox modes. */
export const GELAENDE_MODI = Object.freeze([["anheben", "Anheben"], ["absenken", "Absenken"], ["glaetten", "Glätten"], ["stempeln", "Körper stempeln"]]);

/** Empty parametric graph (one constant, stable identity). */
const LEERER_GRAPH = Object.freeze({ knoten: [], kanten: [] });

/** Default cross-section of "Folge mir" (m) [ASSUMED: a 30 cm wall/bar]. */
const FOLGE_BREITE_M = 0.3;

/** Closing distance 0.4 m; golden-ratio capture 0.5 m. */
/** Object snap capture distance (m) [ASSUMED, the 98-02 body-corner snap], wins over grid and polar tracking.
 *  104-05: grid (0.25 m) and axis lock (polar 90° ± 5°) now come from the shared snap settings (FANG_STANDARD). */
const SCHLIESS_M = 0.4, PHI_FANG_M = 0.5, ECK_FANG_M = 0.4;
/** Tools that take points — a one-shot snap ("end", "mit" …) applies to their next click. */
const PUNKT_WERKZEUGE = Object.freeze(["linie", "folgemir", "riegel", "verschieben"]);

/**
 * State and actions of the modeller (one instance per studio).
 * @param {{projectId: string|null, geschossHoehe: number, flaeche?: {w: number, d: number}|null, bezug?: {x: number, y: number}|null}} o
 *   flaeche: drawing area in m (terrain extent); bezug: site point of the main body's bbox centre = origin of the
 *   building model (footprintM is centred there) — saved with the layer so the IFC export can place the bodies.
 */
/** Layer as JSON without the derived plot reference `bezug` (compared to skip no-op saves). */
function ohneBezug(/** @type {any} */ l) {
  const { bezug: _b, ...rest } = l || {};
  return JSON.stringify(rest);
}

export function useModellierer({ projectId, geschossHoehe, flaeche = null, bezug = null }) {
  const [layer, setLayerRoh] = useState(/** @type {import("@core/lib/massing/massingModell.js").MassingLayer} */ (leererLayer()));
  const [stack, setStack] = useState(leererStack());
  const [werkzeug, setWerkzeug] = useState(/** @type {string|null} */ (null)); // null = modelling off
  const [punkte, setPunkte] = useState(/** @type {Array<{x:number,y:number}>} */ ([]));
  const [cursor, setCursor] = useState(/** @type {{x:number,y:number}|null} */ (null));
  const [auswahl, setAuswahl] = useState(/** @type {string[]} */ ([]));
  const [start, setStart] = useState(/** @type {{x:number,y:number}|null} */ (null));
  const [letzteKopie, setLetzteKopie] = useState(/** @type {{vorher: any, ids: string[], delta: {x:number,y:number}}|null} */ (null));
  const [eingabe, setEingabe] = useState("");
  // 98-05: corner being dragged in the selection tool ({id, index}) — applied on release.
  const [eckeZieht, setEckeZieht] = useState(/** @type {{id: string, index: number}|null} */ (null));
  // 98-08: "Erste Schritte" — which basic moves the user has done in this session.
  // Remembered per viewer in the browser (bit.erste-schritte) — a convenience, never model data.
  const [erledigt, setErledigt] = useState(() => {
    /** @type {Record<string, boolean>} */
    let wert = {};
    try { wert = JSON.parse(window.localStorage.getItem("bit.erste-schritte") || "{}") || {}; } catch { wert = {}; }
    return wert;
  });
  const hake = (schritt) => setErledigt((e) => {
    if (e[schritt]) return e;
    const neu = { ...e, [schritt]: true };
    try { window.localStorage.setItem("bit.erste-schritte", JSON.stringify(neu)); } catch { /* storage blocked: keep in memory */ }
    return neu;
  });
  const [meldung, setMeldung] = useState("");
  const geladen = useRef(false);
  // JSON of the layer the record holds (without `bezug`) — the save effect only writes changes.
  const gespeichertAls = useRef(/** @type {string|null} */ (null));
  /** 95-03: a drag happened while the space bar was held (= pan, not "selection tool"). */
  const leerZug = useRef(false);
  // 98-06: sandbox settings (UI state) — mode, radius (m), step (m per click).
  const [gModus, setGModus] = useState("anheben");
  const [gRadius, setGRadius] = useState(6);
  const [gSchritt, setGSchritt] = useState(0.5);
  // 98-09: parameters of the residential bar tool (new bars and the active one).
  const [rOpt, setROptRoh] = useState(() => ({ ...RIEGEL_STANDARD, geschossHoehe }));
  const [aktiverRiegel, setAktiverRiegel] = useState(/** @type {string|null} */ (null));
  // 104-05: snap settings (shared store), Alt held = no snapping, armed one-shot snap.
  const fangEinst = useFangEinstellungen();
  useFangTasten();
  const [fangAus, setFangAus] = useState(false);
  const [einmalFang, setEinmalFang] = useState(/** @type {any} */ (null));
  const EINMAL_PREFIX = "Einmal-Fang: ";
  /** Drop the armed one-shot snap and its status line (the line stays if something else was reported since). */
  const einmalLoesen = () => {
    setEinmalFang(null);
    setMeldung((m) => (typeof m === "string" && m.startsWith(EINMAL_PREFIX) ? "" : m));
  };

  // Load once per project; an absent layer is an empty one (nothing migrates silently).
  useEffect(() => {
    geladen.current = false;
    // F1 (102): the undo history belongs to one project — after a switch an undo would bring the
    // previous project's bodies into this one and the autosave below would store them there.
    setStack(leererStack());
    if (!projectId) { setLayerRoh(leererLayer()); return undefined; }
    let aktiv = true;
    loadBimModel(projectId)
      .then((m) => {
        if (!aktiv) return;
        const l = m?.massing_layer;
        const neu = l && Array.isArray(l.koerper) ? { ...leererLayer(), ...l } : leererLayer();
        gespeichertAls.current = ohneBezug(neu);
        setLayerRoh(neu); geladen.current = true;
      })
      .catch((e) => { if (aktiv) setMeldung(`Modell nicht geladen: ${e?.message || e}`); });
    return () => { aktiv = false; };
  }, [projectId]);

  // Save debounced (0.8 s) through the ONE write path; only after loading (never overwrite unread data).
  useEffect(() => {
    if (!projectId || !geladen.current) return undefined;
    // Only real changes are written: opening the studio used to re-save the loaded layer (and
    // stamped an empty massing_layer onto projects that never modelled anything).
    const json = ohneBezug(layer);
    if (json === gespeichertAls.current) return undefined;
    const t = setTimeout(() => {
      saveBimModel(projectId, { massing_layer: bezug ? { ...layer, bezug } : layer })
        .then(() => { gespeichertAls.current = json; })
        .catch((e) => setMeldung(`Speichern fehlgeschlagen: ${e?.message || e}`));
    }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer, projectId, bezug?.x, bezug?.y]);

  /** Every edit goes through here — one undo step. */
  const setLayer = useCallback((neu) => { setStack((s) => merke(s, layer)); setLayerRoh(neu); }, [layer]);
  const undo = () => { const r = zurueck(stack, layer); if (r) { setStack(r.stack); setLayerRoh(r.snapshot); } };
  const redo = () => { const r = vor(stack, layer); if (r) { setStack(r.stack); setLayerRoh(r.snapshot); } };

  const aufgeloest = useMemo(() => layer.koerper.map((k) => ({ id: k.id, gruppe: k.gruppe, ...geometrie(layer, k) })), [layer]);
  // 98-07: parametric graph lives in the same layer (saved with it); its result is a preview.
  // Stable identity: a fresh empty graph per render would re-run the evaluation and hand the 3D view a
  // new preview list on every mouse move.
  const graph = layer.parametrik || LEERER_GRAPH;
  const setGraph = (g) => setLayerRoh({ ...layer, parametrik: g });
  const ergebnis = useMemo(() => auswerten(graph), [graph]);
  const vorschau = useMemo(() => ergebnis.koerper.map((k, i) => ({ id: `p${i}`, gruppe: null, vorschau: true, profil: k.profil, hoehe: k.hoehe, basis: 0 })), [ergebnis]);
  const backen = () => {
    let l = layer;
    const neu = [];
    for (const k of ergebnis.koerper) { const r = koerperAnlegen(l, k.profil, k.hoehe, { name: "Parametrik" }); l = r.layer; neu.push(r.id); }
    setLayer(l); setAuswahl(neu);
    setMeldung(`${neu.length} Körper aus der Parametrik übernommen`);
  };
  const treffer = (p) => [...aufgeloest].reverse().find((k) => punktInnen(k.profil, p))?.id || null;

  // 104-05: an armed one-shot snap belongs to the running command; Esc, a tool change or "off" drop it too.
  const zuruecksetzen = () => { setPunkte([]); setStart(null); setEingabe(""); einmalLoesen(); };
  // 101-07: the last real command (not the selection) for "Letzten Befehl wiederholen".
  const letzterBefehl = useRef(/** @type {string|null} */ (null));
  const waehle = (id) => { zuruecksetzen(); setWerkzeug(id); setMeldung(""); if (id && id !== "auswahl") letzterBefehl.current = id; };

  // 104-05: snap geometry = the outlines of all bodies (one index per model change, not per pointer move).
  const fangIdx = useMemo(() => fangIndex(segmenteAusRingen(aufgeloest.map((k) => ({ punkte: k.profil, quelle: k.id })))), [aufgeloest]);

  /**
   * Snap (104-05: through the shared core objektfang.js). Object snaps (endpoint wins, as the old corner snap) come
   * first; otherwise polar tracking from the previous point (default 90° ± 5° = the old axis lock) and the grid;
   * then the golden-ratio suggestion for the 3rd point and closing at the first point (both as in 98-02).
   * @param {{x:number,y:number}} roh raw point, site metres
   * @param {Array<{x:number,y:number}>} [liste] points of the running chain (the last one is the polar base)
   * @param {{basis?: {x:number,y:number}|null, ausser?: string[], aus?: boolean}} [o] base point other than the chain's
   *   last one, body ids to ignore (corner drag), aus = Alt (no snapping)
   * @returns {{x:number, y:number, ecke?: boolean, art?: string, quelle?: string, strahl?: {von: {x:number,y:number}, winkel_grad: number}}}
   */
  const fange = (roh, liste = punkte, o = {}) => {
    const basis = o.basis !== undefined ? o.basis : liste[liste.length - 1] || null;
    const aus = o.aus ?? fangAus;
    const r = fangPunkt(roh, fangIdx, { toleranz_m: ECK_FANG_M, modi: fangEinst, basis, ausser: o.ausser || null, aus, einmal: einmalFang });
    if (!r) return roh;
    if (r.art === "endpunkt") return { x: r.punkt.x, y: r.punkt.y, ecke: true, art: r.art, quelle: r.quelle };
    /** @type {{x:number, y:number, art?: string, quelle?: string, strahl?: any}} */
    let p = { ...r.punkt, art: r.art, ...(r.quelle != null ? { quelle: r.quelle } : {}), ...(r.strahl ? { strahl: r.strahl } : {}) };
    const objekt = ["schnitt", "mitte", "lot", "naechster"].includes(r.art);
    if (liste.length === 2 && !aus && !objekt) {
      const v = goldenerSchnittVorschlag(liste[0], liste[1], roh);
      if (v && Math.hypot(v.punkt.x - roh.x, v.punkt.y - roh.y) < PHI_FANG_M) p = { ...v.punkt, art: "phi" };
    }
    if (liste.length >= 3 && Math.hypot(liste[0].x - roh.x, liste[0].y - roh.y) < SCHLIESS_M) p = { ...liste[0], art: "schliessen" };
    return p;
  };
  /** A click consumed the armed one-shot snap. */
  const einmalVerbraucht = () => { if (einmalFang) einmalLoesen(); };

  const linieSetzen = (p) => {
    const neu = [...punkte, p];
    const flaeche = flaecheSchliessen(neu, SCHLIESS_M);
    if (flaeche) {
      const r = koerperAnlegen(layer, flaeche, geschossHoehe);
      setLayer(r.layer);
      setAuswahl([r.id]);
      setPunkte([]);
      setWerkzeug("pushpull"); // like SketchUp: a closed face invites push/pull
      hake("flaeche");
      setMeldung("Fläche geschlossen — Höhe tippen + Enter (Push/Pull)");
      return;
    }
    setPunkte(neu);
  };

  /** 98-06: one sandbox click — the terrain is created on first use over the drawing area. */
  const gelaendeKlick = (p) => {
    const w = flaeche?.w || 60, d = flaeche?.d || 40;
    // Cell 1 m, coarser for large sites so the node limit holds [ASSUMED].
    const g0 = layer.gelaende || leeresGelaende(w, d, { zelle: w * d > 15000 ? 2 : 1 });
    let g = g0, text = "";
    if (gModus === "anheben" || gModus === "absenken") g = formen(g0, p, gRadius, gModus === "anheben" ? gSchritt : -gSchritt);
    else if (gModus === "glaetten") g = glaetten(g0, p, gRadius, 0.6);
    else {
      const id = treffer(p);
      const k = id ? aufgeloest.find((x) => x.id === id) : null;
      if (!k) { setMeldung("Körper anklicken, der gestempelt werden soll"); return; }
      const res = stempeln(g0, k.profil, k.basis || 0);
      g = res.gelaende;
      text = `Gestempelt: Abtrag ${res.abtrag.toLocaleString("de-DE")} m³, Auftrag ${res.auftrag.toLocaleString("de-DE")} m³`;
    }
    setLayer({ ...layer, gelaende: g });
    if (text) setMeldung(text);
  };

  /** Pointer down in the plan (site metres). */
  const klick = (p, { strg = false, umschalt = false, alt = false } = {}) => {
    if (werkzeug === "gelaende") return gelaendeKlick(p);
    if (werkzeug === "linie") { einmalVerbraucht(); return linieSetzen(fange(p, punkte, { aus: alt })); }
    if (werkzeug === "folgemir" || werkzeug === "riegel") { einmalVerbraucht(); const q = fange(p, punkte, { aus: alt }); setPunkte((a) => [...a, q]); return; }
    const id = treffer(p);
    if (werkzeug === "auswahl" || werkzeug === "pushpull" || werkzeug === "drehen" || werkzeug === "skalieren") {
      if (!id) { setAuswahl([]); return; }
      setAuswahl((a) => (umschalt ? (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]) : [id]));
      return;
    }
    if (werkzeug === "verschieben") {
      if (!start) {
        if (!id) return;
        const ids = auswahl.includes(id) ? auswahl : [id];
        setAuswahl(ids);
        einmalVerbraucht();
        const s0 = fange(p, [], { basis: null, aus: alt });
        setStart({ x: s0.x, y: s0.y });
        return;
      }
      einmalVerbraucht();
      // 104-05: the target snaps like a drawn point, with polar tracking from the base point
      const ziel = fange(p, [], { basis: start, aus: alt });
      ziehen({ x: ziel.x - start.x, y: ziel.y - start.y }, strg);
    }
  };

  const ziehen = (delta, kopie) => {
    if (kopie) {
      const r = kopieren(layer, auswahl, delta);
      setLetzteKopie({ vorher: layer, ids: auswahl, delta });
      hake("kopie");
      setLayer(r.layer);
      setAuswahl(r.neu);
      setMeldung("Kopie gesetzt — *3 = drei Kopien im Abstand, /3 = drei Kopien im geteilten Abstand");
    } else {
      setLayer(verschieben(layer, auswahl, delta));
      setLetzteKopie(null);
    }
    setStart(null);
  };

  /** Finish "Folge mir": sweep the cross-section along the clicked path. */
  const folgeFertig = (breite = FOLGE_BREITE_M, hoehe = geschossHoehe) => {
    if (punkte.length < 2) { setMeldung("Pfad braucht mindestens 2 Punkte"); return; }
    const r = folgeMir(layer, punkte, breite, hoehe);
    setLayer(r.layer); setAuswahl([r.id]); setPunkte([]);
    setMeldung(`Folge mir: ${breite.toFixed(2).replace(".", ",")} m × ${hoehe.toFixed(2).replace(".", ",")} m`);
  };

  /**
   * Push/pull from typed input or a 3D drag. strg = stack a new body on top (SketchUp Ctrl) instead
   * of stretching the selected one.
   */
  const pushPullAnwenden = (ids, delta, strg = false) => {
    if (!ids.length || !Number.isFinite(delta) || Math.abs(delta) < 0.005) return;
    if (strg) {
      if (!(delta > 0)) { setMeldung("Aufstocken braucht eine positive Höhe"); return; }
      let l = layer; const neu = [];
      for (const id of ids) { const r = aufstocken(l, id, delta); l = r.layer; if (r.id) neu.push(r.id); }
      setLayer(l); setAuswahl(neu);
      setMeldung(`Aufgestockt: ${neu.length} neue(r) Körper, ${delta.toFixed(2).replace(".", ",")} m`);
      return;
    }
    let l = layer;
    for (const id of ids) l = pushPull(l, id, delta);
    setLayer(l);
    hake("pushpull");
  };

  /** Release after dragging a corner: snap (outlines of OTHER bodies, grid — 104-05 shared core) and apply. */
  const eckeLoslassen = (p, { alt = false } = {}) => {
    if (!eckeZieht) return;
    einmalVerbraucht();
    const f = fange(p, [], { basis: null, ausser: [eckeZieht.id], aus: alt });
    const ziel = { x: f.x, y: f.y };
    const k = layer.koerper.find((x) => x.id === eckeZieht.id);
    setLayer(eckeVerschieben(layer, eckeZieht.id, eckeZieht.index, ziel));
    if (k?.gruppe != null) setMeldung(`Gruppe ${k.gruppe} geändert — alle Körper mit dieser Nummer folgen`);
    setEckeZieht(null);
  };

  /** 98-09: finish a bar along the clicked path with the current parameters. */
  const riegelFertig = () => {
    if (punkte.length < 2) { setMeldung("Pfad braucht mindestens 2 Punkte"); return; }
    const id = `r${(layer.riegel || []).length + 1}-${layer.naechsteId}`;
    const neu = { id, pfad: punkte.map((q) => ({ x: q.x, y: q.y })), opt: { ...rOpt } };
    setLayer({ ...layer, naechsteId: layer.naechsteId + 1, riegel: [...(layer.riegel || []), neu] });
    setAktiverRiegel(id); setPunkte([]);
    const k = riegelLayout(neu.pfad, neu.opt).kennzahlen;
    setMeldung(`Riegel: ${k.wohnungen} Wohnungen, BGF ${Math.round(k.bgf).toLocaleString("de-DE")} m²`);
  };
  /** Change parameters — applies to the active bar too (live, like a parametric model). */
  const setROpt = (patch) => {
    const neu = { ...rOpt, ...patch };
    setROptRoh(neu);
    if (aktiverRiegel && (layer.riegel || []).some((r) => r.id === aktiverRiegel)) {
      setLayer({ ...layer, riegel: (layer.riegel || []).map((r) => (r.id === aktiverRiegel ? { ...r, opt: neu } : r)) });
    }
  };
  const riegelLoeschen = () => {
    if (!aktiverRiegel) return;
    setLayer({ ...layer, riegel: (layer.riegel || []).filter((r) => r.id !== aktiverRiegel) });
    setAktiverRiegel(null);
  };
  /** Derived units of all bars (per storey for 3D), with the key figures summed. */
  const riegelAbgeleitet = useMemo(() => (layer.riegel || []).map((r) => {
    try { return { id: r.id, opt: r.opt, ...riegelLayout(r.pfad, r.opt) }; } catch { return null; }
  }).filter(Boolean), [layer.riegel]);

  /** Enter in the typed input (VCB). */
  // 106-05: `ctx` = the register context of whoever typed (a call over the control channel carries {kanal: "steuerung"}); it goes on to every
  // command this line runs, so a guarded command (the change commands refuse an agent) cannot be reached through the line without the marker.
  const eingabeAnwenden = (text = eingabe, { strg = false, ctx = undefined } = {}) => {
    // 104-05: snap commands work idle and inside a running command ("ortho", "polar 15", "raster 0,5", "end" …)
    const fb = fangBefehlLesen(text);
    if (fb) {
      setEingabe("");
      if ("fehler" in fb) { setMeldung(`${fb.fehler}: „${text}“`); return; }
      const r = befehle.ausfuehren(fb.id, fb.wert != null ? { wert: fb.wert } : {}, ctx);
      if ("error" in r) setMeldung(r.error);
      return;
    }
    // 104-02: no command running — the typed text is a command name / short form ("l", "pp", "ver…")
    if (werkzeug == null) {
      setEingabe("");
      const b = befehle.finden(text);
      if (b && "id" in b) { befehle.ausfuehren(b.id, {}, ctx); return; }
      if (b && "kandidaten" in b) { setMeldung(`Mehrdeutig: ${b.kandidaten.map((id) => befehle.holen(id)?.label).join(", ")}`); return; }
      setMeldung(`Befehl unbekannt: „${text}“`);
      return;
    }
    if (werkzeug === "folgemir" && !String(text).trim()) return folgeFertig();
    if (werkzeug === "riegel" && !String(text).trim()) return riegelFertig();
    // 104-02: CAD coordinates — "@dx;dy" relative, "@d<winkel" polar, "#x;y" absolute (north up)
    if (/^\s*[@#]/.test(String(text))) {
      setEingabe("");
      const ziel = zielPunkt(koordinateLesen(text), { letzter: werkzeug === "verschieben" ? start : punkte[punkte.length - 1] || null, cursor });
      if ("fehler" in ziel) { setMeldung(`${ziel.fehler}: „${text}“`); return; }
      if (werkzeug === "linie") return linieSetzen(ziel.punkt);
      if (werkzeug === "folgemir" || werkzeug === "riegel") { setPunkte([...punkte, ziel.punkt]); return; }
      if (werkzeug === "verschieben" && start) return ziehen({ x: ziel.punkt.x - start.x, y: ziel.punkt.y - start.y }, false);
      setMeldung("Koordinaten passen nicht zum Werkzeug");
      return;
    }
    const e = eingabeLesen(text);
    setEingabe("");
    if (!e) { setMeldung(`Eingabe nicht verstanden: „${text}“`); return; }
    if ((e.art === "mal" || e.art === "teilen") && letzteKopie) {
      const r = kopieren(letzteKopie.vorher, letzteKopie.ids, letzteKopie.delta, { anzahl: e.n, modus: e.art });
      setLayer(r.layer); setAuswahl(r.neu);
      hake("reihe");
      setMeldung(e.art === "mal" ? `${e.n} Kopien im Abstand` : `${e.n} Kopien im geteilten Abstand`);
      return;
    }
    if (werkzeug === "drehen" && e.art === "laenge" && auswahl.length) { setLayer(drehen(layer, auswahl, schwerpunkt(layer, auswahl), e.wert)); return; }
    if (werkzeug === "skalieren" && e.art === "laenge" && auswahl.length) {
      if (!(e.wert > 0)) { setMeldung("Faktor muss größer als 0 sein"); return; }
      setLayer(skalieren(layer, auswahl, schwerpunkt(layer, auswahl), e.wert)); return;
    }
    if (werkzeug === "folgemir" && e.art === "xy") return folgeFertig(e.x, e.y);
    if (werkzeug === "folgemir" && e.art === "laenge" && punkte.length && cursor) {
      const a = punkte[punkte.length - 1], d = Math.hypot(cursor.x - a.x, cursor.y - a.y) || 1;
      setPunkte([...punkte, { x: +(a.x + ((cursor.x - a.x) / d) * e.wert).toFixed(3), y: +(a.y + ((cursor.y - a.y) / d) * e.wert).toFixed(3) }]);
      return;
    }
    if (werkzeug === "pushpull" && e.art === "laenge" && auswahl.length) {
      if (strg) return pushPullAnwenden(auswahl, e.wert, true);
      let l = layer;
      for (const id of auswahl) l = pushPull(l, id, e.wert);
      setLayer(l);
      hake("pushpull");
      return;
    }
    if (werkzeug === "linie" && e.art === "laenge" && punkte.length && cursor) {
      const a = punkte[punkte.length - 1], d = Math.hypot(cursor.x - a.x, cursor.y - a.y) || 1;
      return linieSetzen({ x: +(a.x + ((cursor.x - a.x) / d) * e.wert).toFixed(3), y: +(a.y + ((cursor.y - a.y) / d) * e.wert).toFixed(3) });
    }
    if (werkzeug === "verschieben" && start && cursor && (e.art === "laenge" || e.art === "xy")) {
      const d = Math.hypot(cursor.x - start.x, cursor.y - start.y) || 1;
      const delta = e.art === "xy" ? { x: e.x, y: e.y } : { x: ((cursor.x - start.x) / d) * e.wert, y: ((cursor.y - start.y) / d) * e.wert };
      return ziehen(delta, false);
    }
    setMeldung("Eingabe passt nicht zum Werkzeug");
  };

  const gruppe = (nr) => {
    if (!auswahl.length) return;
    const r = gruppeBilden(layer, auswahl, nr || undefined);
    setLayer(r.layer);
    hake("gruppe");
    setMeldung(`Gruppe ${r.nr}: ${auswahl.length} Körper — eine Änderung gilt für alle mit Nummer ${r.nr}`);
  };
  const eindeutig = () => {
    let l = layer;
    for (const id of auswahl) l = eindeutigMachen(l, id).layer;
    setLayer(l);
  };
  const loeschen = () => {
    if (!auswahl.length) return;
    setLayer({ ...layer, koerper: layer.koerper.filter((k) => !auswahl.includes(k.id)) });
    setAuswahl([]);
  };

  // Keys while a tool is active (not in form fields): shortcuts, typed input, Enter, Esc.
  useEffect(() => {
    const onKey = (e) => {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || "") || e.altKey) return;
      if ((e.ctrlKey || e.metaKey) && e.key !== "Enter") return;
      const w = WERKZEUGE.find((x) => x.taste === e.key.toLowerCase());
      // 104-02: idle — letters go to the command line, Enter runs it or repeats the last command
      if (werkzeug == null) {
        if (/^[a-zäöüß]$/i.test(e.key) && !e.ctrlKey && !e.metaKey) { e.preventDefault(); setEingabe((v) => v + e.key); return; }
        // 104-05: a value after a typed command word ("polar 15", "raster 0,5")
        if (eingabe && /^[0-9 .,]$/.test(e.key)) { e.preventDefault(); setEingabe((v) => v + e.key); return; }
        if (e.key === "Backspace" && eingabe) { e.preventDefault(); setEingabe((v) => v.slice(0, -1)); return; }
        if (e.key === "Escape" && eingabe) { e.preventDefault(); setEingabe(""); return; }
        if (e.key === "Enter") {
          if (eingabe) { e.preventDefault(); eingabeAnwenden(eingabe); return; }
          if (letzterBefehl.current) { e.preventDefault(); waehle(letzterBefehl.current); }
        }
        return;
      }
      if (/^[0-9.,;*/xX@#<-]$/.test(e.key) || (e.key.toLowerCase() === "c" && eingabe) || (e.key.toLowerCase() === "m" && /[\dcm]$/.test(eingabe))) { e.preventDefault(); setEingabe((v) => v + e.key); return; }
      if (e.key === "Backspace" && eingabe) { e.preventDefault(); setEingabe((v) => v.slice(0, -1)); return; }
      if (e.key === "Enter" && (eingabe || ((werkzeug === "folgemir" || werkzeug === "riegel") && punkte.length >= 2))) { e.preventDefault(); eingabeAnwenden(eingabe, { strg: e.ctrlKey || e.metaKey }); return; }
      if (e.key === "Escape") { e.preventDefault(); zuruecksetzen(); return; }
      if (e.key === "Delete") { e.preventDefault(); loeschen(); return; }
      // 95-03: the space bar also pans the plan (held + drag). It selects the selection tool only when
      // released WITHOUT a drag in between — a pan must not end the line being drawn.
      if (e.key === " ") { e.preventDefault(); leerZug.current = false; return; }
      if (w) { e.preventDefault(); waehle(w.id); }
    };
    const onKeyUp = (e) => {
      if (e.key !== " " || werkzeug == null || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || "")) return;
      if (!leerZug.current) waehle("auswahl");
      leerZug.current = false;
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("keyup", onKeyUp); };
  });

  // 104-03: ONE command register for this surface — command line, keys, right-click menu and agents call the
  // same records. The commands read the latest state through `aktuell` (the register is built once).
  const aktuell = useRef(/** @type {Record<string, any>} */ ({}));
  aktuell.current = { waehle, aus: () => { zuruecksetzen(); setWerkzeug(null); }, undo, redo, loeschen, eingabeAnwenden, setAuswahl,
    kannUndo: stack.past.length > 0, kannRedo: stack.future.length > 0, auswahl, werkzeug, layer, melden: setMeldung,
    einmal: (/** @type {string} */ art) => { setEinmalFang(art); setMeldung(`${EINMAL_PREFIX}${/** @type {any} */ (FANG_LABEL)[art] || art}`); },
    nimmtPunkte: PUNKT_WERKZEUGE.includes(werkzeug || "") || !!eckeZieht };
  const befehle = useMemo(() => {
    const reg = befehlsRegister();
    const a = () => aktuell.current;
    for (const w of WERKZEUGE) {
      reg.registrieren({ id: w.id, label: w.label, menue: "Werkzeuge", taste: w.taste === " " ? "Leertaste" : w.taste.toUpperCase(), kurz: KURZFORMEN[w.id] || [],
        ausfuehren: () => { a().waehle(w.id); return w.id; } });
    }
    reg.registrieren({ id: "beenden", label: "Befehl beenden", menue: "Bearbeiten", taste: "Esc", aktiv: () => a().werkzeug != null, ausfuehren: () => a().aus() });
    reg.registrieren({ id: "rueckgaengig", label: "Rückgängig", menue: "Bearbeiten", taste: "Strg+Z", aktiv: () => a().kannUndo, ausfuehren: () => a().undo() });
    reg.registrieren({ id: "wiederholen", label: "Wiederholen", menue: "Bearbeiten", taste: "Strg+Y", aktiv: () => a().kannRedo, ausfuehren: () => a().redo() });
    reg.registrieren({ id: "loeschen", label: "Löschen", menue: "Bearbeiten", taste: "Entf", aktiv: () => a().auswahl.length > 0, ausfuehren: () => a().loeschen() });
    reg.registrieren({ id: "auswahl-aufheben", label: "Auswahl aufheben", menue: "Bearbeiten", aktiv: () => a().auswahl.length > 0, ausfuehren: () => a().setAuswahl([]) });
    // for agents / scripts: typed input of the running command ("@3;4", "5,40", "*3" …) and a read-out of the model
    reg.registrieren({ id: "eingabe", label: "Eingabe", menue: "Befehlszeile", parameter: { text: "text" }, aktiv: () => a().werkzeug != null,
      ausfuehren: (p, ctx) => { if (!p?.text) throw new Error("text fehlt"); a().eingabeAnwenden(String(p.text), { ctx }); return true; } });
    // 104-05: snap switches and one-shot snaps (fang, ortho, polar <Grad>, raster <Maß>, end/mit/sch/lot/nae)
    fangBefehleRegistrieren(reg, { einmal: (art) => a().einmal(art), einmalAktiv: () => a().nimmtPunkte, melden: (text) => a().melden(text) });
    reg.registrieren({ id: "modell", label: "Modell lesen", menue: "Abfrage",
      ausfuehren: () => ({ werkzeug: a().werkzeug, auswahl: a().auswahl, koerper: (a().layer?.koerper || []).map((k) => ({ id: k.id, name: k.name, hoehe: k.hoehe, profil: k.profil, gruppe: k.gruppe })) }) });
    return reg;
  }, []);
  // reachable for local agents / tests while the modeller is open (window.__bitBefehle.zeileBearbeiten('{"method":"befehle"}'))
  // 104-04: and through the local control channel (server/steuerungRouter.js) while the studio is open.
  useEffect(() => {
    /** @type {any} */ (window).__bitBefehle = befehle;
    const stopp = starteSteuerungsBruecke(befehle);
    return () => {
      stopp();
      if (/** @type {any} */ (window).__bitBefehle === befehle) delete /** @type {any} */ (window).__bitBefehle;
    };
  }, [befehle]);

  // 104-05: ONE snap result per pointer position (the plan used to call fange 3–4 times per render).
  const fangCursor = useMemo(() => {
    if (!cursor || !werkzeug || werkzeug === "gelaende") return null;
    if (eckeZieht) return fange(cursor, [], { basis: null, ausser: [eckeZieht.id] });
    if (werkzeug === "verschieben") return fange(cursor, [], { basis: start });
    return fange(cursor);
    // fange closes over exactly these values
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, werkzeug, punkte, fangIdx, fangEinst, fangAus, einmalFang, start, eckeZieht]);

  return { fangCursor, fangEinst, einmalFang, setFangAus, befehle, merkeLeerZug: () => { leerZug.current = true; }, rOpt, setROpt, riegelAbgeleitet, aktiverRiegel, setAktiverRiegel, riegelLoeschen, pushPullAnwenden, eckeZieht, setEckeZieht, eckeLoslassen, erledigt, layer, aufgeloest, gelaende: layer.gelaende || null, gModus, setGModus, gRadius, setGRadius, gSchritt, setGSchritt,
    gelaendeLoeschen: () => { const { gelaende: _g, ...rest } = layer; setLayer(/** @type {any} */ (rest)); }, graph, setGraph, ergebnis, vorschau, backen, beispiel: (mitteSite) => setGraph(beispielGraph(mitteSite)), werkzeug, waehle, aus: () => { zuruecksetzen(); setWerkzeug(null); }, punkte, cursor, setCursor, fange, auswahl, start,
    klick, eingabe, setEingabe, eingabeAnwenden, meldung, gruppe, eindeutig, loeschen, undo, redo,
    letzterBefehl: () => letzterBefehl.current, auswahlAufheben: () => setAuswahl([]),
    kannUndo: stack.past.length > 0, kannRedo: stack.future.length > 0 };
}

/**
 * Toolbar with the typed input (HTML, above/below the plan).
 * @param {{m: ReturnType<typeof useModellierer>, t: (s: string) => string}} props
 */
export function ModellWerkzeugleiste({ m, t }) {
  const [nr, setNr] = useState("");
  const knopf = "rounded-md border px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-card p-1.5" data-testid="mm-leiste" data-werkzeug={m.werkzeug || "aus"}>
      <span className="px-1 text-[11px] font-semibold text-muted-foreground">{t("Modellieren")}</span>
      {WERKZEUGE.map((w) => (
        <button key={w.id} type="button" title={`${t(w.hilfe)} (${w.taste === " " ? t("Leertaste") : w.taste.toUpperCase()})`} data-testid={`mm-${w.id}`}
          aria-pressed={m.werkzeug === w.id} onClick={() => (m.werkzeug === w.id ? m.aus() : m.waehle(w.id))}
          className={`${knopf} ${m.werkzeug === w.id ? "border-primary bg-primary text-primary-foreground" : "border-border text-foreground hover:bg-muted"}`}>
          {t(w.label)} <span className="opacity-60">{w.taste === " " ? "␣" : w.taste.toUpperCase()}</span>
        </button>
      ))}
      <button type="button" className={`${knopf} border-border text-foreground hover:bg-muted`} onClick={m.undo} disabled={!m.kannUndo} aria-label={t("Rückgängig")} data-testid="mm-undo">↶</button>
      <button type="button" className={`${knopf} border-border text-foreground hover:bg-muted`} onClick={m.redo} disabled={!m.kannRedo} aria-label={t("Wiederholen")}>↷</button>
      {/* Always rendered (disabled without selection) so the bar keeps its height — no plan jump. */}
      {(
        <span className="flex items-center gap-1 border-l border-border pl-1.5" aria-disabled={!m.auswahl.length}>
          <input value={nr} disabled={!m.auswahl.length} onChange={(e) => setNr(e.target.value.replace(/\D/g, ""))} placeholder="Nr." aria-label={t("Gruppennummer")}
            className="w-12 rounded-md border border-border bg-card px-1 py-0.5 text-xs" data-testid="mm-gruppe-nr" />
          <button type="button" className={`${knopf} border-border text-foreground hover:bg-muted`} disabled={!m.auswahl.length} onClick={() => { m.gruppe(nr); setNr(""); }} data-testid="mm-gruppe">{t("Gruppe bilden")}</button>
          <button type="button" className={`${knopf} border-border text-foreground hover:bg-muted`} disabled={!m.auswahl.length} onClick={m.eindeutig} data-testid="mm-eindeutig">{t("Eindeutig")}</button>
          <button type="button" className={`${knopf} border-border text-fehler hover:bg-muted`} disabled={!m.auswahl.length} onClick={m.loeschen}>{t("Löschen")}</button>
        </span>
      )}
      {/* 101-06: the typed input and the messages live in the command line under the plan (Befehlszeile). */}
      <div className="flex basis-full flex-wrap items-center gap-2 px-1 text-[11px] empty:hidden">
        {m.werkzeug === "gelaende" && (
          <span className="flex items-center gap-1.5" data-testid="mm-gelaende-zeile">
            <select value={m.gModus} onChange={(e) => m.setGModus(e.target.value)} className="rounded-md border border-border bg-card px-1 py-0.5" aria-label={t("Gelände-Modus")} data-testid="mm-gelaende-modus">
              {GELAENDE_MODI.map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}
            </select>
            <label className="flex items-center gap-1 text-muted-foreground">{t("Radius")}
              <input type="number" min="1" max="50" step="1" value={m.gRadius} onChange={(e) => m.setGRadius(Math.max(1, Number(e.target.value) || 1))} className="w-12 rounded border border-border bg-card px-1 text-right" /> m</label>
            <label className="flex items-center gap-1 text-muted-foreground">{t("Schritt")}
              <input type="number" min="0.1" max="10" step="0.1" value={m.gSchritt} onChange={(e) => m.setGSchritt(Math.max(0.1, Number(e.target.value) || 0.1))} className="w-12 rounded border border-border bg-card px-1 text-right" /> m</label>
            {m.gelaende && <button type="button" className="rounded-md border border-border px-1.5 py-0.5 hover:bg-muted" onClick={m.gelaendeLoeschen}>{t("Gelände zurücksetzen")}</button>}
          </span>
        )}
        {m.werkzeug === "riegel" && (
          <span className="flex flex-wrap items-center gap-1.5" data-testid="mm-riegel-zeile">
            <label className="flex items-center gap-1 text-muted-foreground">{t("Geschosse")}
              <input type="number" min="1" max="40" value={m.rOpt.geschosse} onChange={(e) => m.setROpt({ geschosse: Math.max(1, Math.min(40, Math.round(Number(e.target.value) || 1))) })} className="w-11 rounded border border-border bg-card px-1 text-right" data-testid="mm-riegel-geschosse" /></label>
            <label className="flex items-center gap-1 text-muted-foreground">{t("Tiefe")}
              <input type="number" min="4" max="16" step="0.5" value={m.rOpt.tiefe} onChange={(e) => m.setROpt({ tiefe: Math.max(4, Number(e.target.value) || 7) })} className="w-12 rounded border border-border bg-card px-1 text-right" /> m</label>
            <label className="flex items-center gap-1 text-muted-foreground">{t("Flur")}
              <input type="number" min="0" max="4" step="0.1" value={m.rOpt.flur} onChange={(e) => m.setROpt({ flur: Math.max(0, Number(e.target.value) || 0) })} className="w-11 rounded border border-border bg-card px-1 text-right" /> m</label>
            <select value={m.rOpt.art} onChange={(e) => m.setROpt({ art: e.target.value })} className="rounded-md border border-border bg-card px-1 py-0.5" aria-label={t("Erschließung")}>
              <option value="mittelflur">{t("Mittelflur (zweibündig)")}</option><option value="einhueftig">{t("einhüftig")}</option>
            </select>
            <select value={typeof m.rOpt.mix === "string" ? m.rOpt.mix : "ausgewogen"} onChange={(e) => m.setROpt({ mix: e.target.value })} className="rounded-md border border-border bg-card px-1 py-0.5" aria-label={t("Wohnungsmix")} data-testid="mm-riegel-mix">
              {Object.keys(MIX_VORLAGEN).map((k) => <option key={k} value={k}>{t(`Mix ${k}`)}</option>)}
            </select>
            {m.aktiverRiegel && <button type="button" className="rounded-md border border-border px-1.5 py-0.5 text-fehler hover:bg-muted" onClick={m.riegelLoeschen}>{t("Riegel löschen")}</button>}
            {Object.entries(WOHNUNGSTYPEN).map(([k, v]) => <span key={k} className="flex items-center gap-0.5 text-muted-foreground"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: v.farbe }} />{k}</span>)}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * 98-06: terrain as height cells (green-brown raised, blue lowered), only cells that differ from
 * ±0, so an untouched terrain draws nothing. Hypsometric tints [ASSUMED], 35 % opacity.
 * @param {{g: import("@core/lib/massing/gelaende.js").Gelaende, mx: (x: number) => number, my: (y: number) => number}} props
 */
function GelaendeZellen({ g, mx, my }) {
  const max = Math.max(0.01, ...g.h.map((h) => Math.abs(h)));
  const zellen = [];
  for (let k = 0; k < g.h.length; k++) {
    const h = g.h[k];
    if (Math.abs(h) < 0.01) continue;
    const x = g.x0 + (k % g.nx) * g.zelle - g.zelle / 2, y = g.y0 + Math.floor(k / g.nx) * g.zelle - g.zelle / 2;
    const a = Math.min(1, Math.abs(h) / max);
    const farbe = h > 0 ? `rgb(${Math.round(120 + 90 * a)},${Math.round(150 - 40 * a)},${Math.round(80 - 30 * a)})` : `rgb(${Math.round(90 - 40 * a)},${Math.round(140 - 30 * a)},190)`;
    zellen.push(<rect key={k} x={mx(x)} y={my(y)} width={mx(x + g.zelle) - mx(x)} height={my(y + g.zelle) - my(y)} fill={farbe} fillOpacity={0.35} />);
  }
  return <g style={{ pointerEvents: "none" }} data-testid="mm-gelaende-zellen" data-anzahl={zellen.length}>{zellen}</g>;
}

/**
 * Bodies, draft lines and guides inside the studio's plan SVG, plus the input surface while a
 * tool is active.
 * @param {{m: ReturnType<typeof useModellierer>, mx: (x: number) => number, my: (y: number) => number, px: (v: number) => number,
 *   toSite: (e: React.PointerEvent) => {x: number, y: number}|null, breite: number, hoehe: number, leertaste?: (() => boolean)|null}} props
 */
export function ModellEbene({ m, mx, my, px, toSite, breite, hoehe, leertaste = null }) {
  const pfad = (pts) => pts.map((p, i) => `${i ? "L" : "M"}${mx(p.x)},${my(p.y)}`).join(" ") + " Z";
  const letzter = m.punkte[m.punkte.length - 1];
  const vorschlag = m.werkzeug === "linie" && m.punkte.length === 2 && m.cursor ? goldenerSchnittVorschlag(m.punkte[0], m.punkte[1], m.cursor) : null;
  return (
    <g data-testid="mm-ebene" data-koerper={m.aufgeloest.length}>
      {m.gelaende && <GelaendeZellen g={m.gelaende} mx={mx} my={my} />}
      {m.riegelAbgeleitet.map((r) => (
        <g key={r.id} data-testid="mm-riegel-plan" data-id={r.id} data-wohnungen={r.kennzahlen.wohnungen} data-bgf={Math.round(r.kennzahlen.bgf)} style={{ pointerEvents: "none" }}>
          {r.flur.map((f, i) => <path key={`f${i}`} d={pfad(f)} fill="#e7e5e4" stroke="#a8a29e" strokeWidth={px(0.6)} />)}
          {r.einheiten.map((e, i) => <path key={`e${i}`} d={pfad(e.profil)} fill={WOHNUNGSTYPEN[e.typ]?.farbe || "#d6d3d1"} fillOpacity={m.aktiverRiegel === r.id ? 0.9 : 0.7} stroke="#ffffff" strokeWidth={px(0.8)} data-typ={e.typ} />)}
        </g>
      ))}
      {m.aufgeloest.map((k) => {
        const sel = m.auswahl.includes(k.id);
        const cx = k.profil.reduce((s, p) => s + p.x, 0) / k.profil.length, cy = k.profil.reduce((s, p) => s + p.y, 0) / k.profil.length;
        return (
          <g key={k.id} data-testid="mm-koerper" data-id={k.id} data-gruppe={k.gruppe ?? ""} data-hoehe={k.hoehe}>
            <path d={pfad(k.profil)} fill={k.gruppe != null ? "#a8a29e" : "#d6d3d1"} fillOpacity={0.55} stroke={sel ? "#0f766e" : "#44403c"} strokeWidth={px(sel ? 2.5 : 1.2)} />
            <text x={mx(cx)} y={my(cy)} textAnchor="middle" fontSize={px(10)} fill="#292524" style={{ pointerEvents: "none" }}>
              {`${k.hoehe.toFixed(2).replace(".", ",")} m${k.gruppe != null ? ` · G${k.gruppe}` : ""}`}
            </text>
          </g>
        );
      })}
      {m.vorschau.map((k) => (
        <path key={k.id} d={pfad(k.profil)} fill="#0f766e" fillOpacity={0.12} stroke="#0f766e" strokeDasharray={`${px(4)} ${px(3)}`} strokeWidth={px(1.2)} data-testid="mm-vorschau" style={{ pointerEvents: "none" }} />
      ))}
      {m.punkte.length > 0 && (
        <polyline points={[...m.punkte, ...(m.fangCursor ? [m.fangCursor] : [])].map((p) => `${mx(p.x)},${my(p.y)}`).join(" ")}
          fill="none" stroke="#0f766e" strokeWidth={px(1.5)} data-testid="mm-entwurf" />
      )}
      {m.punkte.map((p, i) => <circle key={i} cx={mx(p.x)} cy={my(p.y)} r={px(i === 0 ? 5 : 3)} fill={i === 0 ? "#f59e0b" : "#0f766e"} />)}
      {vorschlag && (
        <g data-testid="mm-phi" style={{ pointerEvents: "none" }}>
          <line x1={mx(m.punkte[1].x)} y1={my(m.punkte[1].y)} x2={mx(vorschlag.punkt.x)} y2={my(vorschlag.punkt.y)} stroke="#b45309" strokeDasharray={`${px(4)} ${px(3)}`} strokeWidth={px(1)} />
          <circle cx={mx(vorschlag.punkt.x)} cy={my(vorschlag.punkt.y)} r={px(4)} fill="none" stroke="#b45309" strokeWidth={px(1.2)} />
          <text x={mx(vorschlag.punkt.x) + px(6)} y={my(vorschlag.punkt.y)} fontSize={px(10)} fill="#b45309">{vorschlag.verhaeltnis}</text>
        </g>
      )}
      {m.fangCursor && m.fangCursor.art && (() => {
        // 104-05: snap glyph per kind (square = endpoint, as the 98-02 corner marker; triangle, X, ⊥, tracking ray …)
        const f = m.fangCursor;
        const st = f.strahl ? strahlEnden({ x: mx(f.strahl.von.x), y: my(f.strahl.von.y) }, { x: mx(f.x), y: my(f.y) }, px(40), f.strahl.winkel_grad) : null;
        return <FangGlyphe x={mx(f.x)} y={my(f.y)} s={px(1)} art={f.art} strahl={st} testid="mm-fang" eckeTestid="mm-fang-ecke" />;
      })()}
      {m.werkzeug === "verschieben" && m.start && m.cursor && (
        <line x1={mx(m.start.x)} y1={my(m.start.y)} x2={mx(m.cursor.x)} y2={my(m.cursor.y)} stroke="#0f766e" strokeDasharray={`${px(5)} ${px(3)}`} strokeWidth={px(1.2)} />
      )}
      {letzter && m.cursor && (m.werkzeug === "linie" || m.werkzeug === "folgemir") && (
        <text x={mx(m.cursor.x) + px(8)} y={my(m.cursor.y) - px(8)} fontSize={px(10)} fill="#0f766e" style={{ pointerEvents: "none" }} data-testid="mm-laenge">
          {Math.hypot((m.fangCursor || m.cursor).x - letzter.x, (m.fangCursor || m.cursor).y - letzter.y).toFixed(2).replace(".", ",")} m
        </text>
      )}
      {m.werkzeug && (
        <rect x={0} y={0} width={breite} height={hoehe} fill="transparent" style={{ cursor: "crosshair" }} data-testid="mm-flaeche"
          onPointerMove={(e) => { const p = toSite(e); if (p) m.setCursor(p); m.setFangAus(e.altKey); }}
          onPointerUp={(e) => { if (!m.eckeZieht) return; const p = toSite(e); if (p) m.eckeLoslassen(p, { alt: e.altKey }); }}
          onPointerDown={(e) => {
            // 95-03: space held = the plan pans (event goes on to the SVG); otherwise the tool clicks.
            if (e.button !== 0) return;
            if (leertaste?.()) { m.merkeLeerZug(); return; }
            e.stopPropagation(); const p = toSite(e); if (p) m.klick(p, { strg: e.ctrlKey || e.metaKey, umschalt: e.shiftKey, alt: e.altKey });
          }} />
      )}
      {/* 98-05: corner handles of a single selected body (selection tool) — drag to reshape; a
          group instance reshapes its definition, so every body with that number follows. */}
      {m.werkzeug === "auswahl" && m.auswahl.length === 1 && (() => {
        const k = m.aufgeloest.find((x) => x.id === m.auswahl[0]);
        if (!k) return null;
        return k.profil.map((q, i) => (
          <circle key={`eg${i}`} cx={mx(q.x)} cy={my(q.y)} r={px(6)} fill="#ffffff" stroke="#0f766e" strokeWidth={px(2)} style={{ cursor: "move" }}
            data-testid="mm-eckgriff" data-index={i}
            onPointerDown={(e) => { e.stopPropagation(); m.setEckeZieht({ id: k.id, index: i }); }} />
        ));
      })()}
      {m.eckeZieht && m.cursor && <circle cx={mx((m.fangCursor || m.cursor).x)} cy={my((m.fangCursor || m.cursor).y)} r={px(5)} fill="#0f766e" fillOpacity={0.5} style={{ pointerEvents: "none" }} />}
    </g>
  );
}

/** 98-08: the basic moves of the SketchUp tutorials, in order — each ticks when done. */
export const ERSTE_SCHRITTE = Object.freeze([
  { id: "flaeche", taste: "L", text: "Mit der Linie (L) vier Punkte klicken und am Startpunkt schließen — die Fläche wird ein Körper" },
  { id: "pushpull", taste: "P", text: "Push/Pull (P): Körper wählen, eine Höhe tippen, z. B. 9 + Enter" },
  { id: "kopie", taste: "M", text: "Verschieben (M): Körper, dann Ziel klicken — mit gedrückter Strg-Taste wird es eine Kopie" },
  { id: "reihe", taste: "*3", text: "Direkt nach der Kopie *3 tippen + Enter: drei Kopien im selben Abstand (oder /3: dazwischen)" },
  { id: "gruppe", taste: "␣", text: "Mit Umschalt mehrere wählen und „Gruppe bilden“ — ändern Sie dann einen, ändern sich alle" },
]);

/**
 * "Erste Schritte" card next to the toolbar — folded by default (101-01: room to draw); the summary line shows the progress.
 * @param {{m: ReturnType<typeof useModellierer>, t: (s: string) => string}} props
 */
export function ErsteSchritte({ m, t }) {
  const fertig = ERSTE_SCHRITTE.filter((s) => m.erledigt[s.id]).length;
  return (
    <details className="rounded-lg border border-border bg-card px-3 py-2 text-xs" data-testid="mm-erste-schritte" data-fertig={fertig}>
      <summary className="cursor-pointer select-none font-semibold text-foreground">{t("Erste Schritte")} · {fertig}/{ERSTE_SCHRITTE.length}</summary>
      <ol className="mt-2 space-y-1">
        {ERSTE_SCHRITTE.map((s) => (
          <li key={s.id} className={`flex items-start gap-2 ${m.erledigt[s.id] ? "text-muted-foreground line-through" : "text-foreground"}`} data-testid={`mm-schritt-${s.id}`} data-erledigt={m.erledigt[s.id] ? "1" : "0"}>
            <span className={`mt-0.5 inline-flex h-4 min-w-[1.5rem] items-center justify-center rounded border px-1 text-[10px] ${m.erledigt[s.id] ? "border-erfolg-rand bg-erfolg-flaeche text-erfolg" : "border-border"}`}>{m.erledigt[s.id] ? "✓" : s.taste}</span>
            <span>{t(s.text)}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}

/**
 * 101-06: command line of the modeller — command, expected next input, typed input (Maße), last message.
 * @param {{m: ReturnType<typeof useModellierer>, t: (s: string) => string}} props
 */
export function ModellBefehlszeile({ m, t }) {
  const { befehl, aufforderung } = befehlsAufforderung(m.werkzeug, { punkte: m.punkte, auswahl: m.auswahl, start: m.start });
  return (
    <Befehlszeile
      schalter={fangSchalter(m.fangEinst, t)}
      schalterTestid="mm-schalter"
      befehl={t(befehl)}
      aufforderung={t(aufforderung)}
      meldung={m.meldung ? t(m.meldung) : ""}
      meldungTestid="mm-meldung"
      eingabe={{ id: "mm-eingabe", testid: "mm-eingabe", label: t("Eingabe"), value: m.eingabe, onChange: m.setEingabe,
        onSubmit: m.eingabeAnwenden,
        // 104-02: idle = command input with autocomplete; while a command runs = measures / coordinates
        placeholder: m.werkzeug ? "5,40 · @3;4 · @10<30 · #x;y · *3" : t("Befehl, z. B. L = Linie"),
        vorschlaege: m.werkzeug ? undefined : WERKZEUGE.map((w) => t(w.label)) }}
    />
  );
}

/**
 * 101-07: right-click menu entries of the modeller (CAD-like).
 * @param {ReturnType<typeof useModellierer>} m
 * @param {(s: string) => string} t
 * @param {() => void} einpassen zoom extents of the plan
 * @returns {Array<{label: string, taste?: string, onClick: () => void, disabled?: boolean, gefahr?: boolean, trenner?: boolean, an?: boolean, gruppe?: string}>}
 */
export function modellKontext(m, t, einpassen) {
  const letzter = m.letzterBefehl();
  const name = WERKZEUGE.find((w) => w.id === letzter)?.label;
  return [
    { label: t("Befehl beenden"), taste: "Esc", onClick: () => m.befehle.ausfuehren("beenden"), disabled: !m.werkzeug },
    { label: name ? `${t("Wiederholen:")} ${t(name)}` : t("Letzten Befehl wiederholen"), taste: "Enter", onClick: () => letzter && m.waehle(letzter), disabled: !letzter },
    { label: t("Rückgängig"), taste: "Strg+Z", onClick: () => m.befehle.ausfuehren("rueckgaengig"), disabled: !m.kannUndo, trenner: true },
    { label: t("Wiederholen"), taste: "Strg+Y", onClick: () => m.befehle.ausfuehren("wiederholen"), disabled: !m.kannRedo },
    { label: t("Auswahl aufheben"), onClick: () => m.befehle.ausfuehren("auswahl-aufheben"), disabled: !m.auswahl.length, trenner: true },
    { label: t("Löschen"), taste: "Entf", onClick: () => m.befehle.ausfuehren("loeschen"), disabled: !m.auswahl.length, gefahr: true },
    { label: t("Alles einpassen"), taste: t("2× Mausrad"), onClick: einpassen, trenner: true },
    // 104-05: snap switches (checkbox entries)
    ...fangKontextEintraege(fangEinstellungen(), t),
  ];
}
