// 98-02…98-05: SketchUp-like modelling tools in the Massing Studio (user brief 17.10.2026).
// Tools: Linie (L) — click points, the chain closes into a face at its first point and becomes a
// body; Push/Pull (P) — type the distance; Verschieben (M) — two clicks, Ctrl = copy, then typed
// "*3" (three copies at that distance) or "/3" (three copies dividing it); Leertaste = selection.
// Typed input ("VCB", bottom right of the plan) works like SketchUp: type, Enter.
// Groups: "Gruppe bilden" gives the selection a NUMBER — every body with that number is an
// instance; changing one changes all of that number; "Eindeutig" gives a new number.
//
// 107-05: every edit that would leave a self-intersecting or degenerate profile is refused with the reason in the command
// line (corner drag, drawn face, scale, Follow me); a body that is invalid anyway (import, node graph "Backen") is drawn with
// the error token colour, a dashed outline and a "!" (never colour alone, skill bit-farbsehen) and the toolbar names the reason.
// Follow me knows a closed path (click the first point again) and stepped profiles (several bodies: plinth, cornice, parapet).
// 107-06: push/pull acts on the face picked last in 3D (side, top, Alt = bottom; flaecheWaehlen of the core) — by drag or by the
// typed distance; without a pick it is the top face as before. "B;H" typed on a side face sets a part rectangle around the hit;
// pushed into a wall-like body until the opposite face it becomes an opening (no 3D boolean, CSG core 107-14).
// 107-07: inference — the tracking ray takes its axis colour (FangGlyphe), Shift held locks the axis for the running command
// (ortho, nothing stored), resting the pointer on an edge (or the one-shot "par" / "senk" / "verl") makes it the reference edge
// for the parallel / perpendicular tracks and its extension, the origin (0;0) is a snap point. Guide lines and points (tool
// "Hilfslinie", H / hl / hs / hp) are stored in massing_layer.hilfslinien, drawn dashed, snapped to, never printed or exported.
// Rotate knows copies: Ctrl+Enter (or the "Kopie" switch) gives a rotated copy, then "*n" / "/n" an array; a click beside the
// bodies sets the centre. The row of a typed "*n" / "/n" is previewed (dashed) before Enter.
//
// 107-08: inspector of ONE selected body — its type (set automatically from the proportions and marked "abgeleitet (Annahme)", one
// click "Automatik zurücknehmen" or Ctrl+Z takes it back, D-BK-09), a type or status set by hand, the data sheet (opening it pins
// the GUID), mirror, and "Als Bauteil übernehmen" (walls/slabs/columns into the BIM record through saveBimModel, D-BK-10) with its
// own "Übernahme zurücknehmen" (full inspector in the selection tool; while another tool runs only the compact type mark with the
// take-back button, so the plan does not move). The automatic runs in setLayer, so every edit path (draw, push/pull, copy …) is covered.
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
  profilGueltig, gespeicherterEckIndex, profilStufen, PROFIL_VORLAGEN,
  flaechen, flaecheWaehlen, seiteVerschieben, teilflaecheDruecken, oeffnungenPruefen, FLAECHE_TEXT,
  drehKopien, hilfslinieAnlegen, hilfslinienLoeschen, hilfslinienSegmente,
  typAutomatik, typZuruecknehmen, typAutomatikZulassen, typSetzen, statusSetzen, guidsSichern, spiegeln, koerperElement, dachSetzen,
  bauteileAusKoerper, uebernahmeEntfernen, istUebernommen,
} from "@core/lib/massing/massingModell.js";
import { steckbrief, bauteilGuid, BAUTEIL_TYPEN, TYP_ABGELEITET_TEXT, TYP_OFFEN_TEXT } from "@core/lib/bauteil/steckbrief.js";
import { useI18n } from "@core/lib/i18n";
import { ZEIGE_ZUSTAENDE } from "@core/lib/zeigen/zustaende.js";
import { leererStack, merke, zurueck, vor } from "@core/lib/undoStack";
import { punktInnen } from "@core/lib/polygonInnen";
import { auswerten, beispielGraph } from "@core/lib/massing/knoten.js";
import { leeresGelaende, formen, glaetten, stempeln } from "@core/lib/massing/gelaende.js";
import { riegelLayout, WOHNUNGSTYPEN, MIX_VORLAGEN, RIEGEL_STANDARD } from "@core/lib/massing/riegel.js";
import { koordinateLesen, zielPunkt } from "@core/lib/massing/koordinaten.js";
import { befehlsRegister } from "@core/lib/befehlsregister.js";
import { editorKuerzel } from "@designer/lib/zeichnenModell.js";
import { starteSteuerungsBruecke } from "@core/lib/steuerungsBruecke.js";
import Befehlszeile from "@core/components/Befehlszeile";
import FangGlyphe, { strahlEnden } from "@core/components/FangGlyphe";
import { befehlsAufforderung } from "@core/lib/befehlszeile";
// 104-05: object snap (endpoint, midpoint, intersection, perpendicular, nearest, polar, ortho, grid) — one core
// for the modeller and the site plan; settings shared through one store (F3/F8/F9/F10, command line, menu).
import { fangIndex, fangPunkt, orthoPunkt, segmenteAusRingen, segmenteNahe, naechsterAufSegment, QUELLE_URSPRUNG, HILFSGERADE_HALB_M } from "@core/lib/objektfang.js";
import { useFangEinstellungen, useFangTasten, fangBefehleRegistrieren, fangBefehlLesen, fangEinstellungen, fangKontextEintraege, fangSchalter, FANG_LABEL } from "@core/lib/fangEinstellungen.js";
import { loadBimModel, saveBimModel } from "@core/lib/useBimModelSync";

/** Tools with their SketchUp shortcut. */
export const WERKZEUGE = Object.freeze([
  { id: "auswahl", taste: " ", label: "Auswahl", hilfe: "Körper anklicken, Umschalt = mehrere; Ecken eines Körpers ziehen formt ihn (Gruppe: alle)" },
  { id: "linie", taste: "l", label: "Linie", hilfe: "Punkte klicken, am Startpunkt schließen = Fläche; Länge tippen + Enter" },
  { id: "pushpull", taste: "p", label: "Push/Pull", hilfe: "Körper wählen, Abstand tippen + Enter (Strg+Enter = aufstocken); in 3D eine Fläche anklicken und ziehen (Seite, Oberseite, Alt = Unterseite); B;H tippen = Teilfläche, minus = hineindrücken" },
  { id: "verschieben", taste: "m", label: "Verschieben", hilfe: "Körper, dann Ziel klicken; Strg = Kopie; danach *3 oder /3 tippen" },
  { id: "drehen", taste: "q", label: "Drehen", hilfe: "Körper wählen, Winkel in Grad tippen + Enter (um den Schwerpunkt oder einen geklickten Drehpunkt); Strg+Enter = Kopie, danach *4 oder /4" },
  { id: "skalieren", taste: "s", label: "Skalieren", hilfe: "Körper wählen, Faktor tippen + Enter (Gruppe: alle Instanzen)" },
  { id: "folgemir", taste: "f", label: "Folge mir", hilfe: "Pfad klicken; Enter = 30 cm × Geschosshöhe, oder Breite;Höhe tippen + Enter" },
  { id: "gelaende", taste: "g", label: "Gelände", hilfe: "Sandbox: anheben, absenken, glätten oder Körper stempeln — Klick in den Plan" },
  { id: "riegel", taste: "r", label: "Riegel", hilfe: "Pfad klicken, Enter = Wohnriegel mit Mittelflur und Wohnungsmix; Werte in der Zeile darunter" },
  // 107-07: construction geometry (snap targets, never printed or exported)
  { id: "hilfslinie", taste: "h", label: "Hilfslinie", hilfe: "Zwei Punkte klicken = Hilfslinie (Gerade), hs = Strecke, hp = Punkt; wird gefangen, nie gedruckt oder exportiert" },
]);

/** 104-02: typed short forms of the tools (besides the key and the full name), CAD convention. */
const KURZFORMEN = Object.freeze({
  auswahl: ["a", "au"], linie: ["l", "li"], pushpull: ["p", "pp"], verschieben: ["m", "v", "ve"],
  drehen: ["q", "dr", "ro"], skalieren: ["s", "sk", "sc"], folgemir: ["f", "fm"], gelaende: ["g", "ge"], riegel: ["r", "ri"],
  hilfslinie: ["hl"],
});

/** 107-07: kinds of guide geometry with their typed short form and label (German UI text, translated by the caller). */
export const HILFSLINIEN_WAHL = Object.freeze([["gerade", "hl", "Gerade"], ["strecke", "hs", "Strecke"], ["punkt", "hp", "Punkt"]]);

/** 107-07: resting time of the pointer on an edge before it becomes the reference edge, ms [ASSUMED: CAD tracking ~0.5 s]. */
export const BEZUG_VERWEIL_MS = 600;

/** 107-08: types a body may carry in the inspector (keys of BAUTEIL_TYPEN whose IFC class the Massing export can write, D-BK-10). */
export const KOERPER_TYPEN = Object.freeze(["wand-aussen", "wand-tragend", "wand-innen", "decke", "bodenplatte", "stuetze", "traeger", "fundament", "dach-flach", "bekleidung"]);

/** 107-08: renovation status of a body (value, German label; "" = ohne Status, D-BW-03 never a default). */
export const KOERPER_STATUS = Object.freeze([["", "ohne Status"], ["bestand", "Bestand"], ["neubau", "Neubau"], ["abbruch", "Abbruch"], ["temporaer", "Temporär"]]);

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
const PUNKT_WERKZEUGE = Object.freeze(["linie", "folgemir", "riegel", "verschieben", "hilfslinie", "drehen"]); // 107-07: + guide lines, rotate centre

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

/**
 * 107-07: the row of a typed "*n" / "/n" from the last copy — shifted copies (move + Ctrl) or turned copies (rotate + Ctrl), both
 * from the layer BEFORE that copy, so "*4" replaces the single copy by four (one shared array core, reihenFaktoren).
 * @param {{vorher: any, ids: string[], delta: {x:number,y:number}|null, winkel?: number, zentrum?: {x:number,y:number}}} lk last copy
 * @param {number} n number of copies
 * @param {'mal'|'teilen'} modus
 * @returns {{layer: any, neu: string[]}}
 */
export function reiheBilden(lk, n, modus) {
  if (lk.winkel != null && lk.zentrum) return drehKopien(lk.vorher, lk.ids, lk.zentrum, lk.winkel, { anzahl: n, modus });
  return kopieren(lk.vorher, lk.ids, lk.delta || { x: 0, y: 0 }, { anzahl: n, modus });
}

export function useModellierer({ projectId, geschossHoehe, flaeche = null, bezug = null }) {
  // 107-05: refusals carry a reason from the core (German i18n key); the line shows "<what>: <why>" already translated
  const { t: tz } = useI18n();
  const [layer, setLayerRoh] = useState(/** @type {import("@core/lib/massing/massingModell.js").MassingLayer} */ (leererLayer()));
  const [stack, setStack] = useState(leererStack());
  const [werkzeug, setWerkzeug] = useState(/** @type {string|null} */ (null)); // null = modelling off
  const [punkte, setPunkte] = useState(/** @type {Array<{x:number,y:number}>} */ ([]));
  const [cursor, setCursor] = useState(/** @type {{x:number,y:number}|null} */ (null));
  const [auswahl, setAuswahl] = useState(/** @type {string[]} */ ([]));
  const [start, setStart] = useState(/** @type {{x:number,y:number}|null} */ (null));
  // 107-07: a rotated copy remembers its angle and centre (then "*n" / "/n" turns the row instead of shifting it)
  // Review 107-07: `nach` = the layer the copy (or the last row) produced — the row is only built while the layer is still exactly
  // that one; any other edit since (plain rotate, guide line, push/pull, delete, undo …) ends it, so nothing is silently reverted.
  const [letzteKopie, setLetzteKopie] = useState(/** @type {{vorher: any, nach: any, ids: string[], delta: {x:number,y:number}|null, winkel?: number, zentrum?: {x:number,y:number}}|null} */ (null));
  // 107-07: rotate tool — clicked centre (site m, null = centroid of the selection) and the "Kopie" switch
  const [drehZentrum, setDrehZentrum] = useState(/** @type {{x:number,y:number}|null} */ (null));
  const [drehKopie, setDrehKopie] = useState(false);
  // 107-07: guide tool — kind being drawn; Shift held = axis lock for the running command (never stored); reference edge
  const [hlArt, setHlArt] = useState(/** @type {'gerade'|'strecke'|'punkt'} */ ("gerade"));
  // review 107-07: null = no lock; {winkel_grad: number|null, art} = Shift held with the ray direction frozen at the press (null = ortho fallback)
  const [achsSperre, setAchsSperreRoh] = useState(/** @type {{winkel_grad: number|null, art: string}|null} */ (null));
  const [bezugKante, setBezugKante] = useState(/** @type {{a: {x:number,y:number}, b: {x:number,y:number}, quelle?: string}|null} */ (null));
  const [eingabe, setEingabe] = useState("");
  // 107-05: Follow me — the clicked path is closed (first point clicked again) and the profile template (PROFIL_VORLAGEN).
  const [pfadZu, setPfadZu] = useState(false);
  const [folgeVorlage, setFolgeVorlage] = useState("einfach");
  // 98-05: corner being dragged in the selection tool ({id, index}) — applied on release.
  const [eckeZieht, setEckeZieht] = useState(/** @type {{id: string, index: number}|null} */ (null));
  // 107-06: the face picked last for push/pull (flaecheWaehlen result) and an optional part rectangle on a side face
  // (TeilRechteck: kante, u, width, height, sill in m). UI state, never saved; re-resolved against the layer on every change.
  const [flaecheWahl, setFlaecheWahl] = useState(/** @type {any} */ (null));
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
      // 107-08 review (lazy GUID): every save pins the GlobalId of each body (guidsSichern = the derived value, so the IFC export is
      // byte-identical) — the modeller is the one writer of massing_layer, so this is where bodies get their stored guid; the BIM
      // studio's export only reads the layer. The pinned copy is stored, the state stays as it is (undo snapshots without a guid are
      // pinned again on the next save with the same value).
      const gesichert = guidsSichern(layer, projectId);
      saveBimModel(projectId, { massing_layer: bezug ? { ...gesichert, bezug } : gesichert })
        .then(() => { gespeichertAls.current = json; })
        .catch((e) => setMeldung(`Speichern fehlgeschlagen: ${e?.message || e}`));
    }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer, projectId, bezug?.x, bezug?.y]);

  /**
   * Every edit goes through here — one undo step. 107-08 (D-BK-09): the box automatic runs on every edit (typAutomatik: new bodies and
   * bodies whose form changed). When it SETS a type, the edit is stored as two undo steps: the first Ctrl+Z leaves the body with the
   * type taken back ("Bauteiltyp offen", source "zurueckgenommen" — the automatic does not set it again), the second undoes the edit.
   * @param {any} neu layer after the edit
   * @param {any} [vergleich] layer the automatic compares with (default: the current one; a row built from the layer before the copy
   *   passes that one, so every copy of the row counts as new)
   * @returns {any} the layer actually set (with the automatic types)
   */
  const setLayer = useCallback((neu, vergleich = undefined) => {
    const auto = typAutomatik(vergleich === undefined ? layer : vergleich, neu);
    const vorherTyp = new Map(neu.koerper.map((/** @type {any} */ k) => [k.id, k.bauteil_typ]));
    const gesetzt = auto.koerper.filter((/** @type {any} */ k) => k.bauteil_typ_quelle === "automatisch" && vorherTyp.get(k.id) !== k.bauteil_typ).map((/** @type {any} */ k) => k.id);
    // review 107-08: the intermediate step is built from `auto` (not `neu`): a type the same edit removed on another body stays removed
    setStack((s) => (gesetzt.length ? merke(merke(s, layer), typZuruecknehmen(auto, gesetzt)) : merke(s, layer)));
    setLayerRoh(auto);
    return auto;
  }, [layer]);
  // Review 107-07: the last copy counts only while the layer is the one it produced (see letzteKopie.nach)
  const kopieAktiv = letzteKopie && letzteKopie.nach === layer ? letzteKopie : null;
  const undo = () => { const r = zurueck(stack, layer); if (r) { setStack(r.stack); setLayerRoh(r.snapshot); } };
  const redo = () => { const r = vor(stack, layer); if (r) { setStack(r.stack); setLayerRoh(r.snapshot); } };

  // 107-05: with the derived validity (never stored) — the plan, 3D and the toolbar mark invalid bodies from it.
  const aufgeloest = useMemo(() => layer.koerper.map((k) => {
    const g = geometrie(layer, k);
    /** @type {ReturnType<typeof geometrie> & {id: string, gruppe: string|null, gueltig: ReturnType<typeof profilGueltig>, oeffnungenGeprueft?: ReturnType<typeof oeffnungenPruefen>}} */
    const r = { id: k.id, gruppe: k.gruppe, ...g, gueltig: profilGueltig(g.profil, { loecher: g.loecher || null }) };
    // 107-06: openings checked against the current geometry (derived) — 3D draws the ones that fit, the plan marks the others
    if (g.oeffnungen) r.oeffnungenGeprueft = oeffnungenPruefen(layer, k);
    return r;
  }), [layer]);
  /**
   * 107-06: the picked face resolved against the CURRENT layer (null when the body or the edge is gone) plus what the 3D view
   * draws: outline (site m, z up), middle, outward normal and the part rectangle.
   * Review 107-06: only while its body is selected — "Auswahl aufheben", a copy or any other new selection ends the face pick, so a
   * typed distance never moves a face of a body that is no longer selected.
   */
  const flaecheAktuell = useMemo(() => {
    const w = flaecheWahl;
    if (!w || !auswahl.includes(w.koerperId)) return null;
    const k = layer.koerper.find((x) => x.id === w.koerperId);
    if (!k) return null;
    const fl = flaechen(layer, k);
    if (w.art === "oben" || w.art === "unten") {
      const f = /** @type {any} */ (fl.find((x) => x.art === (w.art === "oben" ? "deckel" : "boden")));
      const n = f.ring.length || 1;
      const mitte = { x: f.ring.reduce((s, p) => s + p.x, 0) / n, y: f.ring.reduce((s, p) => s + p.y, 0) / n, z: f.z };
      return { wahl: { koerperId: k.id, art: w.art }, marke: { art: w.art, kennung: w.art, punkte: f.ring.map((/** @type {any} */ p) => ({ ...p, z: f.z })), mitte, normale: { x: 0, y: 0, z: w.art === "oben" ? 1 : -1 } } };
    }
    const f = /** @type {any} */ (fl.find((x) => x.art === "seite" && x.ring === w.ring && x.kante === w.kante));
    if (!f) return null;
    const L = Math.hypot(f.b.x - f.a.x, f.b.y - f.a.y) || 1, ex = (f.b.x - f.a.x) / L, ey = (f.b.y - f.a.y) / L;
    const P = (/** @type {number} */ u, /** @type {number} */ z) => ({ x: f.a.x + ex * u, y: f.a.y + ey * u, z });
    const t = w.teil;
    const teil = t ? [P(t.u - t.width / 2, f.z0 + t.sill), P(t.u + t.width / 2, f.z0 + t.sill), P(t.u + t.width / 2, f.z0 + t.sill + t.height), P(t.u - t.width / 2, f.z0 + t.sill + t.height)] : null;
    const mitte = t ? P(t.u, f.z0 + t.sill + t.height / 2) : P(L / 2, (f.z0 + f.z1) / 2);
    return {
      wahl: { ...w, a: f.a, b: f.b, z0: f.z0, z1: f.z1, normale: f.normale, laenge: L },
      marke: { art: "seite", kennung: `seite:${f.ring}:${f.kante}`, punkte: [P(0, f.z0), P(L, f.z0), P(L, f.z1), P(0, f.z1)], mitte, normale: { x: f.normale.x, y: f.normale.y, z: 0 }, ...(teil ? { teil } : {}) },
    };
  }, [flaecheWahl, layer, auswahl]);
  /** "<what>: <why>" in the current language for a refused edit. */
  const ablehnung = (/** @type {string} */ was, /** @type {{text?: string}|null|undefined} */ pr) => `${tz(was)}: ${tz(pr?.text || "Profil ungültig")}`;
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
    // 107-05: baked bodies are never refused — an invalid one is created and shown as invalid (derived marker)
    for (const k of ergebnis.koerper) { const r = koerperAnlegen(l, k.profil, k.hoehe, { name: "Parametrik", pruefen: false }); l = r.layer; neu.push(r.id); }
    setLayer(l); setAuswahl(neu);
    setMeldung(`${neu.length} Körper aus der Parametrik übernommen`);
  };
  // 107-05: a click into a courtyard (inner ring) does not hit the body
  const treffer = (p) => [...aufgeloest].reverse().find((k) => punktInnen(k.profil, p) && !(k.loecher || []).some((r) => punktInnen(r, p)))?.id || null;

  // 104-05: an armed one-shot snap belongs to the running command; Esc, a tool change or "off" drop it too.
  // 107-07: the reference edge and the rotate centre belong to the running command too
  const zuruecksetzen = () => { setPunkte([]); setPfadZu(false); setStart(null); setEingabe(""); einmalLoesen(); setBezugKante(null); setDrehZentrum(null); };
  // 101-07: the last real command (not the selection) for "Letzten Befehl wiederholen".
  const letzterBefehl = useRef(/** @type {string|null} */ (null));
  /** @param {string|null} id tool @param {'gerade'|'strecke'|'punkt'} [art] 107-07: kind of guide for the guide tool */
  const waehle = (id, art = "gerade") => {
    zuruecksetzen(); setFlaecheWahl(null); setWerkzeug(id); setMeldung("");
    if (id === "hilfslinie") setHlArt(art);
    if (id && id !== "auswahl") letzterBefehl.current = id;
  };

  // 104-05: snap geometry = the outlines of all bodies (one index per model change, not per pointer move).
  // 107-07: plus the guide lines / points (an infinite line clipped to ±HILFSGERADE_HALB_M) and the origin (0;0 = "#0;0").
  const hilfsSegmente = useMemo(() => hilfslinienSegmente(layer, HILFSGERADE_HALB_M), [layer]);
  const fangIdx = useMemo(() => fangIndex([
    ...segmenteAusRingen([
      ...aufgeloest.flatMap((k) => [{ punkte: k.profil, quelle: k.id }, ...(k.loecher || []).map((r) => ({ punkte: r, quelle: k.id }))]),
      { punkte: [{ x: 0, y: 0 }], quelle: QUELLE_URSPRUNG },
    ]),
    ...hilfsSegmente,
  ]), [aufgeloest, hilfsSegmente]);

  /**
   * Snap (104-05: through the shared core objektfang.js). Object snaps (endpoint wins, as the old corner snap) come
   * first; otherwise polar tracking from the previous point (default 90° ± 5° = the old axis lock) and the grid;
   * then the golden-ratio suggestion for the 3rd point and closing at the first point (both as in 98-02).
   * @param {{x:number,y:number}} roh raw point, site metres
   * @param {Array<{x:number,y:number}>} [liste] points of the running chain (the last one is the polar base)
   * @param {{basis?: {x:number,y:number}|null, ausser?: string[], aus?: boolean, sperre?: boolean}} [o] base point other than the chain's
   *   last one, body ids to ignore (corner drag), aus = Alt (no snapping), sperre = Shift (107-07: axis lock = ortho for this
   *   snap only, the shared settings stay untouched)
   * @returns {{x:number, y:number, ecke?: boolean, art?: string, quelle?: string, strahl?: {von: {x:number,y:number}, winkel_grad: number}}}
   */
  const fange = (roh, liste = punkte, o = {}) => {
    const basis = o.basis !== undefined ? o.basis : liste[liste.length - 1] || null;
    const aus = o.aus ?? fangAus;
    const sperre = o.sperre ?? !!achsSperre;
    // review 107-07: Shift freezes the ray direction it found when pressed (achsSperre.winkel_grad) until it is released; without
    // a direction yet (no base point at that moment) it falls back to ortho for this snap
    const fest = sperre && achsSperre && Number.isFinite(achsSperre.winkel_grad) ? achsSperre : null;
    const modi = sperre && !fest ? { ...fangEinst, ortho: true, polar: false } : fangEinst;
    const r = fangPunkt(roh, fangIdx, { toleranz_m: ECK_FANG_M, modi, basis, ausser: o.ausser || null, aus, einmal: einmalFang, bezug: bezugKante, sperre: fest });
    if (!r) return roh;
    if (r.art === "endpunkt") return { x: r.punkt.x, y: r.punkt.y, ecke: true, art: r.art, quelle: r.quelle };
    /** @type {{x:number, y:number, art?: string, quelle?: string, strahl?: any}} */
    let p = { ...r.punkt, art: r.art, ...(r.quelle != null ? { quelle: r.quelle } : {}), ...(r.strahl ? { strahl: r.strahl } : {}) };
    // review 107-07: the 107-07 snaps (guide line, extension, the reference-edge tracks) are deliberate targets too — the golden-ratio
    // suggestion must not override them at the third point
    const objekt = ["schnitt", "mitte", "lot", "naechster", "hilfsgerade", "verlaengerung", "parallel", "senkrecht"].includes(r.art);
    if (liste.length === 2 && !aus && !objekt) {
      const v = goldenerSchnittVorschlag(liste[0], liste[1], roh);
      if (v && Math.hypot(v.punkt.x - roh.x, v.punkt.y - roh.y) < PHI_FANG_M) p = { ...v.punkt, art: "phi" };
    }
    if (liste.length >= 3 && Math.hypot(liste[0].x - roh.x, liste[0].y - roh.y) < SCHLIESS_M) p = { ...liste[0], art: "schliessen" };
    return p;
  };
  /** A click consumed the armed one-shot snap. */
  const einmalVerbraucht = () => { if (einmalFang) einmalLoesen(); };

  // 107-07: reference edge — the pointer resting BEZUG_VERWEIL_MS on an edge (body outline or guide piece, not an infinite
  // guide line) makes it the reference for the parallel / perpendicular tracks and its extension; with the one-shot "par" /
  // "senk" / "verl" armed the edge under the pointer is taken at once. Only while a tool takes points.
  const nimmtPunkteJetzt = PUNKT_WERKZEUGE.includes(werkzeug || "") && werkzeug !== "drehen";
  // review 107-07: which armed one-shot already took its edge (null after the click / Esc drops the one-shot)
  const einmalKante = useRef(/** @type {any} */ (null));
  useEffect(() => { if (!einmalFang) einmalKante.current = null; }, [einmalFang]);
  // review 107-07: a reference edge whose segment left the snap geometry (body moved, deleted, undone) is dropped
  useEffect(() => {
    if (!bezugKante) return;
    const da = fangIdx.segmente.some((s) => s.a.x === bezugKante.a.x && s.a.y === bezugKante.a.y && s.b.x === bezugKante.b.x && s.b.y === bezugKante.b.y);
    if (!da) setBezugKante(null);
  }, [fangIdx, bezugKante]);
  useEffect(() => {
    if (!cursor || !nimmtPunkteJetzt || fangAus) return undefined;
    const kante = segmenteNahe(fangIdx, cursor, ECK_FANG_M)
      .filter((s) => !s.gerade && Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) > 1e-6)
      .sort((p, q) => Math.hypot(naechsterAufSegment(cursor, p.a, p.b).punkt.x - cursor.x, naechsterAufSegment(cursor, p.a, p.b).punkt.y - cursor.y)
        - Math.hypot(naechsterAufSegment(cursor, q.a, q.b).punkt.x - cursor.x, naechsterAufSegment(cursor, q.a, q.b).punkt.y - cursor.y))[0];
    if (!kante) return undefined;
    const einmalOffen = (einmalFang === "parallel" || einmalFang === "senkrecht" || einmalFang === "verlaengerung") && einmalKante.current !== einmalFang;
    const gleich = bezugKante && bezugKante.a.x === kante.a.x && bezugKante.a.y === kante.a.y && bezugKante.b.x === kante.b.x && bezugKante.b.y === kante.b.y;
    if (gleich) { if (einmalOffen) einmalKante.current = einmalFang; return undefined; }
    // the plan marks the reference edge (dashed, "∥" label); a message only for the one-shot, so a resting pointer never
    // overwrites the hint of the running step (e.g. "Kopie gesetzt — *3 …")
    const setzen = (/** @type {boolean} */ melden) => {
      setBezugKante({ a: kante.a, b: kante.b, quelle: kante.quelle });
      if (melden) setMeldung("Bezugskante gewählt — parallel, senkrecht oder Verlängerung");
    };
    // review 107-07: an armed one-shot takes the edge under the pointer ONCE and keeps it until the click (passing other edges on
    // the way to the target must not replace it); a later rest of the pointer still picks another edge
    if (einmalOffen) {
      einmalKante.current = einmalFang;
      setzen(true);
      return undefined;
    }
    const t = setTimeout(() => setzen(false), BEZUG_VERWEIL_MS);
    return () => clearTimeout(t);
    // the effect restarts the timer on every pointer move — only a resting pointer sets the edge
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, nimmtPunkteJetzt, fangIdx, einmalFang, fangAus]);

  const linieSetzen = (p) => {
    const neu = [...punkte, p];
    const flaeche = flaecheSchliessen(neu, SCHLIESS_M);
    if (flaeche) {
      // 107-05: a self-intersecting chain is refused — the chain stays (Esc discards it, or keep drawing after undoing)
      let r;
      try { r = koerperAnlegen(layer, flaeche, geschossHoehe); } catch (e) { setMeldung(ablehnung("Fläche nicht angelegt", /** @type {any} */ (e)?.pruefung || { text: e?.message })); return; }
      setLayer(r.layer);
      setAuswahl([r.id]);
      setPunkte([]);
      setBezugKante(null); // review 107-07: the reference edge belongs to the line command that just ended
      setWerkzeug("pushpull"); // like SketchUp: a closed face invites push/pull
      hake("flaeche");
      setMeldung("Fläche geschlossen — Höhe tippen + Enter (Push/Pull)");
      return;
    }
    setPunkte(neu);
  };

  /**
   * 107-07: one point of the guide tool — a guide point at once, a guide line / piece after its second point. The tool stays
   * active for the next guide (Esc ends it). Refusals (two equal points) land in the command line.
   * @param {{x:number, y:number}} p snapped point, site m
   */
  const hilfsPunktSetzen = (p) => {
    const q = { x: p.x, y: p.y };
    if (hlArt !== "punkt" && !punkte.length) { setPunkte([q]); return; }
    try {
      const r = hlArt === "punkt" ? hilfslinieAnlegen(layer, "punkt", q) : hilfslinieAnlegen(layer, hlArt, punkte[0], q);
      setLayer(r.layer);
      setPunkte([]);
      setMeldung(hlArt === "punkt" ? "Hilfspunkt gesetzt" : hlArt === "strecke" ? "Hilfsstrecke gesetzt" : "Hilfslinie gesetzt");
    } catch (e) {
      setMeldung(String(/** @type {any} */ (e)?.message || e));
    }
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
    // 107-07: Shift at the click = axis lock (ortho) for this point, like Shift held while moving
    if (werkzeug === "linie") { einmalVerbraucht(); return linieSetzen(fange(p, punkte, { aus: alt, sperre: umschalt })); }
    if (werkzeug === "hilfslinie") { einmalVerbraucht(); return hilfsPunktSetzen(fange(p, punkte, { aus: alt, sperre: umschalt })); }
    if (werkzeug === "folgemir" && pfadZu) { setMeldung("Pfad geschlossen — Enter oder Breite;Höhe tippen"); return; }
    if (werkzeug === "folgemir" || werkzeug === "riegel") {
      einmalVerbraucht();
      const q = fange(p, punkte, { aus: alt, sperre: umschalt });
      // 107-05: Follow me closes the path when the first point is clicked again (ring → body with a courtyard)
      if (werkzeug === "folgemir" && q.art === "schliessen" && punkte.length >= 3) { setPfadZu(true); setMeldung("Pfad geschlossen — Enter oder Breite;Höhe tippen"); return; }
      setPunkte((a) => [...a, q]); return;
    }
    const id = treffer(p);
    // 107-07: rotate — a click beside the bodies (with a selection) sets the centre, snapped like a drawn point
    if (werkzeug === "drehen" && !id && auswahl.length) {
      einmalVerbraucht();
      const z = fange(p, [], { basis: null, aus: alt });
      setDrehZentrum({ x: z.x, y: z.y });
      setMeldung(`${tz("Drehpunkt gesetzt")}: ${z.x.toFixed(2).replace(".", ",")} ; ${(-z.y).toFixed(2).replace(".", ",")}`);
      return;
    }
    if (werkzeug === "auswahl" || werkzeug === "pushpull" || werkzeug === "drehen" || werkzeug === "skalieren") {
      setFlaecheWahl(null); // 107-06: a pick in the plan means the whole body again (push/pull = top face)
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
      const ziel = fange(p, [], { basis: start, aus: alt, sperre: umschalt });
      ziehen({ x: ziel.x - start.x, y: ziel.y - start.y }, strg);
    }
  };

  const ziehen = (delta, kopie) => {
    if (kopie) {
      const r = kopieren(layer, auswahl, delta);
      const nach = setLayer(r.layer); // 107-08: with the automatic types — the row check compares with exactly this layer
      setLetzteKopie({ vorher: layer, nach, ids: auswahl, delta });
      hake("kopie");
      setAuswahl(r.neu);
      setMeldung("Kopie gesetzt — *3 = drei Kopien im Abstand, /3 = drei Kopien im geteilten Abstand");
    } else {
      setLayer(verschieben(layer, auswahl, delta));
      setLetzteKopie(null);
    }
    setStart(null);
  };

  /** Finish "Folge mir": sweep the cross-section along the clicked path (107-05: closed ring, stepped profile). */
  const folgeFertig = (breite = FOLGE_BREITE_M, hoehe = geschossHoehe) => {
    if (punkte.length < 2) { setMeldung("Pfad braucht mindestens 2 Punkte"); return; }
    let r;
    try {
      r = folgeMir(layer, punkte, breite, hoehe, { geschlossen: pfadZu, stufen: folgeVorlage === "einfach" ? null : profilStufen(folgeVorlage, breite, hoehe) });
    } catch (e) {
      // refused (self-intersecting outline at a sharp corner, folded inner ring, height too small for the steps): path stays
      setMeldung(ablehnung("Folge mir nicht angelegt", /** @type {any} */ (e)?.pruefung || { text: e?.message }));
      return;
    }
    setLayer(r.layer); setAuswahl(r.ids); setPunkte([]); setPfadZu(false);
    // review 107-05: the message goes through i18n with placeholders (t() of the command line finds no composed sentence)
    const zahl = (/** @type {number} */ v) => v.toFixed(2).replace(".", ",");
    const text = r.ids.length > 1 ? tz("Folge mir: {{b}} m × {{h}} m · {{n}} Körper") : tz("Folge mir: {{b}} m × {{h}} m");
    setMeldung(text.replace("{{b}}", zahl(breite)).replace("{{h}}", zahl(hoehe)).replace("{{n}}", String(r.ids.length)));
  };

  /**
   * Push/pull from typed input or a 3D drag. strg = stack a new body on top (SketchUp Ctrl) instead
   * of stretching the selected one.
   */
  const pushPullAnwenden = (ids, delta, strg = false, wahl = null) => {
    if (!ids.length || !Number.isFinite(delta) || Math.abs(delta) < 0.005) return;
    // 107-06: a 3D drag carries the face it started on; a typed distance takes the face picked last
    const w = wahl || (flaecheAktuell && ids.includes(flaecheAktuell.wahl.koerperId) ? flaecheAktuell.wahl : null);
    if (w && w.art !== "oben") return flaecheAnwenden(w, delta, strg);
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

  /**
   * 107-06: a 3D hit on a modelled body → the face under it (core flaecheWaehlen on the derived faces). The body becomes the
   * selection; a part rectangle stays when the same side face is hit again (so "B;H", then a drag pushes that rectangle).
   * @param {string} id body
   * @param {{x: number, y: number, z: number}} punkt site m, z up
   * @param {{x: number, y: number, z: number}} normale x/y plan, z up
   * @param {{unten?: boolean}} [opt] unten = Alt held: the bottom face of the body, wherever the hit lies
   * @returns {any} the picked face (with `teil` when kept) or null — null when the hit lies on no face of the body (review
   *   107-06: a reveal, sill or lintel of a body opening); the 3D view then starts no drag
   */
  const flaecheTreffen = (id, punkt, normale, { unten = false } = {}) => {
    const k = layer.koerper.find((x) => x.id === id);
    const w = !k ? null : unten
      ? flaecheWaehlen(layer, k, { ...punkt, z: geometrie(layer, k).basis }, { x: 0, y: 0, z: -1 })
      : flaecheWaehlen(layer, k, punkt, normale);
    if (!w) { setFlaecheWahl(null); setMeldung(tz("Keine Körperfläche getroffen (Laibung einer Öffnung)")); return null; }
    const alt = flaecheWahl;
    const gleich = alt && alt.teil && w.art === "seite" && alt.art === "seite" && alt.koerperId === w.koerperId && alt.ring === w.ring && alt.kante === w.kante;
    const neu = gleich ? { ...w, teil: alt.teil } : w;
    setFlaecheWahl(neu);
    setAuswahl([id]);
    setMeldung(w.art === "seite" ? tz("Fläche: Seite {{n}}").replace("{{n}}", String(w.kante + 1)) : tz(w.art === "oben" ? "Fläche: Oberseite" : "Fläche: Unterseite"));
    return neu;
  };

  /**
   * 107-06: push/pull one picked face by `delta` m (outwards positive): bottom → base variant, side → seiteVerschieben, side with
   * a part rectangle → teilflaecheDruecken (step, opening, refusal or a new body in front). Refusals land in the command line.
   * @param {any} w picked face (flaecheWaehlen result, optional `teil`)
   * @param {number} delta m
   * @param {boolean} strg Ctrl held (stacking exists only on the top face)
   */
  const flaecheAnwenden = (w, delta, strg) => {
    if (strg) { setMeldung("Aufstocken nur an der Oberseite"); return; }
    /** @type {any} */
    let abgelehnt = null;
    /** @type {any} */
    let hinweis = null;
    const opt = { abgelehnt: (/** @type {any} */ pr) => { abgelehnt = pr; }, hinweis: (/** @type {any} */ h) => { hinweis = h; } };
    if (w.art === "unten") {
      const neu = pushPull(layer, w.koerperId, delta, { flaeche: "unten", abgelehnt: opt.abgelehnt });
      if (abgelehnt) { setMeldung(ablehnung("Unterseite nicht verschoben", abgelehnt)); return; }
      setLayer(neu); hake("pushpull"); return;
    }
    /**
     * Pick the face again where it lies after the edit (it moved by `d` along its normal and may have a new index after a step).
     * @param {import("@core/lib/massing/massingModell.js").MassingLayer} neu layer after the edit
     * @param {number} u position along the old face from its start corner, m
     * @param {number} d m moved along the outward normal
     */
    const wiederWaehlen = (neu, u, d) => {
      const k = neu.koerper.find((x) => x.id === w.koerperId);
      const L = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) || 1, n = w.normale;
      const punkt = { x: w.a.x + ((w.b.x - w.a.x) / L) * u + n.x * d, y: w.a.y + ((w.b.y - w.a.y) / L) * u + n.y * d, z: (w.z0 + w.z1) / 2 };
      return k ? flaecheWaehlen(neu, k, punkt, { x: n.x, y: n.y, z: 0 }) : null;
    };
    if (w.teil && w.ring === "aussen") {
      const r = teilflaecheDruecken(layer, w.koerperId, { ...w.teil, kante: w.kante }, delta, opt);
      if (abgelehnt || !r.art) { setMeldung(ablehnung(delta < 0 ? "Nicht durchgedrückt" : "Teilfläche nicht verschoben", abgelehnt)); return; }
      setLayer(r.layer);
      hake("pushpull");
      if (r.art === "oeffnung") {
        const zahl = (/** @type {number} */ v) => v.toFixed(2).replace(".", ",");
        setMeldung(tz("Öffnung angelegt: {{b}} m × {{h}} m, Brüstung {{s}} m").replace("{{b}}", zahl(w.teil.width)).replace("{{h}}", zahl(w.teil.height)).replace("{{s}}", zahl(w.teil.sill)));
      } else if (r.art === "anbau") setMeldung("Anbau vor der Fläche angelegt (eigener Körper)");
      else setMeldung(hinweis ? tz(hinweis.text) : "");
      // review 107-06: a step ("profil") or a whole-face push split/moved the edge — the old index now names another piece, so the
      // moved part is picked again at its middle (u kept inside the face as teilflaecheDruecken does); opening/extension keep the face
      if (r.art === "profil" || r.art === "seite") {
        const L = w.laenge || Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
        const u = Math.min(Math.max(w.teil.u, w.teil.width / 2), L - w.teil.width / 2);
        setFlaecheWahl(wiederWaehlen(r.layer, u, delta));
      } else setFlaecheWahl({ ...w, teil: null });
      return;
    }
    const neu = seiteVerschieben(layer, w.koerperId, w.kante, delta, { ring: w.ring, ...opt });
    if (abgelehnt) { setMeldung(ablehnung("Kante nicht verschoben", abgelehnt)); return; }
    setLayer(neu);
    hake("pushpull");
    setMeldung(hinweis ? tz(hinweis.text) : "");
    // the face moved (and may have a new index after a step): pick it again where it now lies
    setFlaecheWahl(wiederWaehlen(neu, Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) / 2, delta));
  };

  /**
   * 107-06: typed "B;H" with a side face picked → a part rectangle of width B and height H around the hit (kept inside the face).
   * @param {number} breite m
   * @param {number} hoehe m
   * @returns {boolean} true when the rectangle was set
   */
  const teilSetzen = (breite, hoehe) => {
    const w = flaecheAktuell?.wahl;
    if (!w || w.art !== "seite") return false;
    if (w.ring !== "aussen") { setMeldung("Teilfläche nur auf einer Außenseite"); return true; }
    const H = w.z1 - w.z0, L = w.laenge;
    if (!(breite > 0) || !(hoehe > 0) || breite > L || hoehe > H) { setMeldung(tz(FLAECHE_TEXT.passtNicht)); return true; }
    const u = Math.min(Math.max(w.u ?? L / 2, breite / 2), L - breite / 2);
    const sill = Math.min(Math.max((w.v ?? H / 2) - hoehe / 2, 0), H - hoehe);
    const r3 = (/** @type {number} */ v) => Math.round(v * 1000) / 1000;
    setFlaecheWahl({ ...flaecheWahl, teil: { u: r3(u), width: breite, height: hoehe, sill: r3(sill) } });
    const zahl = (/** @type {number} */ v) => v.toFixed(2).replace(".", ",");
    setMeldung(tz("Teilfläche {{b}} m × {{h}} m — Tiefe tippen (minus = hineindrücken) oder ziehen").replace("{{b}}", zahl(breite)).replace("{{h}}", zahl(hoehe)));
    return true;
  };

  /** Release after dragging a corner: snap (outlines of OTHER bodies, grid — 104-05 shared core) and apply. */
  const eckeLoslassen = (p, { alt = false } = {}) => {
    if (!eckeZieht) return;
    einmalVerbraucht();
    const f = fange(p, [], { basis: null, ausser: [eckeZieht.id], aus: alt });
    const ziel = { x: f.x, y: f.y };
    const k = layer.koerper.find((x) => x.id === eckeZieht.id);
    // 107-05: the handle index belongs to the resolved (normalised) profile; the core edits the stored one
    const g = aufgeloest.find((x) => x.id === eckeZieht.id);
    const index = gespeicherterEckIndex(g?.profil.length || 0, eckeZieht.index, !!g?.umgekehrt);
    /** @type {any} */
    let abgelehnt = null;
    const neu = eckeVerschieben(layer, eckeZieht.id, index, ziel, { abgelehnt: (pr) => { abgelehnt = pr; } });
    setEckeZieht(null);
    if (abgelehnt) { setMeldung(ablehnung("Ecke nicht verschoben", abgelehnt)); return; }
    setLayer(neu);
    if (k?.gruppe != null) setMeldung(`Gruppe ${k.gruppe} geändert — alle Körper mit dieser Nummer folgen`);
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
      if (werkzeug === "hilfslinie") return hilfsPunktSetzen(ziel.punkt); // 107-07
      // review 107-05: a closed Follow-me path takes no further point (same guard as a click)
      if (werkzeug === "folgemir" && pfadZu) { setMeldung("Pfad geschlossen — Enter oder Breite;Höhe tippen"); return; }
      if (werkzeug === "folgemir" || werkzeug === "riegel") { setPunkte([...punkte, ziel.punkt]); return; }
      if (werkzeug === "verschieben" && start) return ziehen({ x: ziel.punkt.x - start.x, y: ziel.punkt.y - start.y }, false);
      setMeldung("Koordinaten passen nicht zum Werkzeug");
      return;
    }
    const e = eingabeLesen(text);
    setEingabe("");
    if (!e) { setMeldung(`Eingabe nicht verstanden: „${text}“`); return; }
    if ((e.art === "mal" || e.art === "teilen") && letzteKopie && !kopieAktiv) {
      // review 107-07: the model changed since the copy — a row from the old state would undo that change without a word
      setLetzteKopie(null);
      setMeldung(tz("Seit der Kopie geändert — erst neu kopieren, dann *3 oder /3"));
      return;
    }
    if ((e.art === "mal" || e.art === "teilen") && kopieAktiv) {
      // 107-07: after a rotated copy the row turns (copy i by i · angle, or the angle divided), otherwise it shifts
      const r = reiheBilden(kopieAktiv, e.n, e.art);
      // 107-08: the row is built from the layer before the copy, so the automatic compares with that one (every copy is new)
      const nach = setLayer(r.layer, kopieAktiv.vorher); setAuswahl(r.neu);
      setLetzteKopie({ ...kopieAktiv, nach }); // typing again ("*5" after "*3") replaces this row
      hake("reihe");
      if (kopieAktiv.winkel != null) setMeldung(e.art === "mal" ? `${e.n} ${tz("gedrehte Kopien im Winkel")}` : `${e.n} ${tz("gedrehte Kopien im geteilten Winkel")}`);
      else setMeldung(e.art === "mal" ? `${e.n} ${tz("Kopien im Abstand")}` : `${e.n} ${tz("Kopien im geteilten Abstand")}`);
      return;
    }
    if (werkzeug === "drehen" && e.art === "laenge" && auswahl.length) {
      const zentrum = drehZentrum || schwerpunkt(layer, auswahl);
      // 107-07: Ctrl+Enter or the "Kopie" switch = one rotated copy; "*n" / "/n" next turns it into a row
      if (strg || drehKopie) {
        const r = drehKopien(layer, auswahl, zentrum, e.wert);
        const nach = setLayer(r.layer);
        setLetzteKopie({ vorher: layer, nach, ids: auswahl, delta: null, winkel: e.wert, zentrum });
        setAuswahl(r.neu);
        hake("kopie");
        setMeldung("Gedrehte Kopie gesetzt — *4 = vier Kopien im Winkel, /4 = vier Kopien im geteilten Winkel");
        return;
      }
      setLayer(drehen(layer, auswahl, zentrum, e.wert));
      return;
    }
    if (werkzeug === "hilfslinie" && e.art === "laenge" && punkte.length && cursor) {
      // 107-07: second point of a guide at the typed distance towards the pointer
      const a = punkte[0], d = Math.hypot(cursor.x - a.x, cursor.y - a.y) || 1;
      return hilfsPunktSetzen({ x: +(a.x + ((cursor.x - a.x) / d) * e.wert).toFixed(3), y: +(a.y + ((cursor.y - a.y) / d) * e.wert).toFixed(3) });
    }
    if (werkzeug === "skalieren" && e.art === "laenge" && auswahl.length) {
      if (!(e.wert > 0)) { setMeldung("Faktor muss größer als 0 sein"); return; }
      /** @type {any} */
      let abgelehnt = null;
      const neu = skalieren(layer, auswahl, schwerpunkt(layer, auswahl), e.wert, { abgelehnt: (pr) => { abgelehnt = pr; } });
      if (abgelehnt) { setMeldung(ablehnung("Nicht skaliert", abgelehnt)); return; }
      setLayer(neu); return;
    }
    if (werkzeug === "folgemir" && e.art === "xy") return folgeFertig(e.x, e.y);
    if (werkzeug === "folgemir" && e.art === "laenge" && pfadZu) { setMeldung("Pfad geschlossen — Enter oder Breite;Höhe tippen"); return; }
    if (werkzeug === "folgemir" && e.art === "laenge" && punkte.length && cursor) {
      const a = punkte[punkte.length - 1], d = Math.hypot(cursor.x - a.x, cursor.y - a.y) || 1;
      setPunkte([...punkte, { x: +(a.x + ((cursor.x - a.x) / d) * e.wert).toFixed(3), y: +(a.y + ((cursor.y - a.y) / d) * e.wert).toFixed(3) }]);
      return;
    }
    // 107-06: "B;H" on a picked side face = part rectangle; a typed distance acts on the face picked last (top without a pick)
    if (werkzeug === "pushpull" && e.art === "xy" && teilSetzen(e.x, e.y)) return;
    if (werkzeug === "pushpull" && e.art === "laenge" && flaecheAktuell && flaecheAktuell.wahl.art !== "oben") return flaecheAnwenden(flaecheAktuell.wahl, e.wert, strg);
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
      if (!e.defaultPrevented) {
        const kuerzel = editorKuerzel(e);
        if (kuerzel === "undo") { e.preventDefault(); undo(); return; }
        if (kuerzel === "redo") { e.preventDefault(); redo(); return; }
      }
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

  // ---- 107-08: inspector of one body — type (D-BK-09), status, data sheet with lazy GUID, mirror, takeover (D-BK-10) ----
  // ids of the bodies with a takeover in the BIM record (read on load, updated by the two actions; the BIM studio is a tab of its own
  // and not mounted at the same time, so nothing else changes these lists while the modeller is open)
  const [uebernommen, setUebernommen] = useState(/** @type {Set<string>} */ (new Set()));
  useEffect(() => {
    if (!projectId) { setUebernommen(new Set()); return undefined; }
    let aktiv = true;
    loadBimModel(projectId)
      .then((m) => { if (aktiv) setUebernommen(new Set([...(m?.customWalls || []), ...(m?.customSlabs || []), ...(m?.customColumns || [])].map((e) => e?.quelle_koerper).filter(Boolean))); })
      .catch(() => { /* the takeover button reads the record itself again */ });
    return () => { aktiv = false; };
  }, [projectId]);
  const [steckbriefOffen, setSteckbriefOffen] = useState(false);
  /** One click: the automatic type goes away, "Bauteiltyp offen" (an edit of its own, Ctrl+Z brings it back). */
  const typZurueck = (/** @type {string[]} */ ids) => { setLayer(typZuruecknehmen(layer, ids)); setMeldung(tz("Automatik zurückgenommen — Bauteiltyp offen")); };
  const typZulassen = (/** @type {string[]} */ ids) => { setLayer(typAutomatikZulassen(layer, ids)); setMeldung(tz("Automatik wieder zugelassen")); };
  const typVonHand = (/** @type {string[]} */ ids, /** @type {string} */ typ) => setLayer(typSetzen(layer, ids, typ || null));
  const statusVonHand = (/** @type {string[]} */ ids, /** @type {string} */ st) => setLayer(statusSetzen(layer, ids, st || null));
  /** 107-10: roof of bodies (massing_layer v6 `dach`; a group instance changes its definition), null = no roof. */
  const dachVonHand = (/** @type {string[]} */ ids, /** @type {any} */ dach) => setLayer(dachSetzen(layer, ids, dach));
  const spiegelnAuswahl = () => { if (auswahl.length) setLayer(spiegeln(layer, auswahl)); };
  /**
   * Pins the GUID of the bodies `ids` in the state (lazy, the derived value; no undo step — it changes nothing visible, and the save
   * pins every body again anyway). Review 107-08: a running copy row follows the pinned layer, so "*3" after opening the data sheet
   * still builds the row.
   * @param {string[]} ids
   */
  const guidAnheften = (ids) => {
    const neu = guidsSichern(layer, projectId, ids);
    if (neu === layer) return;
    setLetzteKopie((l) => (l && l.nach === layer ? { ...l, nach: neu } : l));
    setLayerRoh(neu);
  };
  /** Opening the data sheet pins the GUID of the selected body. */
  const steckbriefUmschalten = () => {
    const auf = !steckbriefOffen;
    setSteckbriefOffen(auf);
    if (auf && auswahl.length === 1) guidAnheften(auswahl);
  };
  // review 107-08: with the data sheet open, selecting another body pins that one too (the sheet shows it at once)
  useEffect(() => {
    if (steckbriefOffen && auswahl.length === 1 && projectId) guidAnheften(auswahl);
    // only on a change of the selected body; the layer is read fresh inside
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steckbriefOffen, auswahl.length === 1 ? auswahl[0] : null, projectId]);
  /** GUID shown in the data sheet: the stored one, else the derived one the IFC export writes (never "—" for a body). */
  const koerperGuid = (/** @type {any} */ k) => bauteilGuid(projectId ?? null, "massing", { id: k.id, guid: k.guid });
  /** The data sheet of a body (derived; the body seen as an element), null for an untyped one. */
  const koerperSteckbrief = (/** @type {any} */ k) => (k?.bauteil_typ && BAUTEIL_TYPEN[k.bauteil_typ]
    ? steckbrief(koerperElement(layer, k, bezug), k.bauteil_typ, { projektId: projectId ?? null, quelle: "massing", storeyHeight: geschossHoehe }) : null);
  /**
   * "Als Bauteil übernehmen" (D-BK-10): walls / slabs / columns of the body into the BIM record (one write path saveBimModel, strict:
   * nothing is written over a change of another device), each with quelle_koerper. A second takeover of the same body is refused.
   * @param {string} id body
   */
  const alsBauteil = async (id) => {
    const k = layer.koerper.find((x) => x.id === id);
    if (!k || !projectId) return;
    try {
      const m = (await loadBimModel(projectId)) || {};
      if (istUebernommen(m, id)) { setUebernommen((u) => new Set([...u, id])); setMeldung(tz("Schon übernommen — erst „Übernahme zurücknehmen“")); return; }
      const alle = ["customWalls", "customColumns", "customWindows", "envOpenings", "customZones", "customSlabs", "customRoofs"].flatMap((f) => (Array.isArray(m[f]) ? m[f] : []));
      const startIdx = Math.max(0, ...alle.map((e) => Number(e?._idx) || 0)) + 1;
      const ue = bauteileAusKoerper(layer, k, { geschossHoehe_m: geschossHoehe, startIdx, composite: m.envComposite || null, bezug });
      // review 107-08: a type without a BIM element of its own, a wall/column without a rectangle, a slab off the storey ceilings —
      // refused with the reason, nothing is written
      if (ue.art === "abgelehnt" && ue.abgelehnt) {
        const a = ue.abgelehnt;
        const label = a.typ && BAUTEIL_TYPEN[a.typ] ? tz(BAUTEIL_TYPEN[a.typ].label) : "";
        const m2 = (/** @type {number|undefined} */ v) => (v ?? 0).toFixed(2).replace(".", ",");
        setMeldung(a.grund === "lage"
          ? tz("Übernahme nicht verfügbar: Decke liegt auf keiner Geschossdecke (Unterkante {{u}} m, Oberkante {{o}} m)").replace("{{u}}", m2(a.unterkante_m)).replace("{{o}}", m2(a.oberkante_m))
          : a.grund === "profil"
            ? tz("Übernahme nicht verfügbar: Bauteiltyp „{{typ}}“ braucht ein Rechteckprofil").replace("{{typ}}", label)
            : tz("Übernahme für Bauteiltyp „{{typ}}“ nicht verfügbar — nur Wand, Stütze, Decke oder ohne Typ").replace("{{typ}}", label));
        return;
      }
      /** @type {Record<string, any[]>} */
      const patch = {};
      if (ue.customWalls.length) patch.customWalls = [...(m.customWalls || []), ...ue.customWalls];
      if (ue.customSlabs.length) patch.customSlabs = [...(m.customSlabs || []), ...ue.customSlabs];
      if (ue.customColumns.length) patch.customColumns = [...(m.customColumns || []), ...ue.customColumns];
      await saveBimModel(projectId, patch, { streng: true });
      setUebernommen((u) => new Set([...u, id]));
      setMeldung(`${tz("Als Bauteil übernommen")}: ${ue.customWalls.length} ${tz("Wände")}, ${ue.customSlabs.length} ${tz("Decken")}, ${ue.customColumns.length} ${tz("Stützen")}`);
    } catch (e) {
      setMeldung(`${tz("Übernahme fehlgeschlagen")}: ${/** @type {any} */ (e)?.message || e}`);
    }
  };
  /** "Übernahme zurücknehmen": removes every element with quelle_koerper = this body from the BIM record; the body stays. */
  const uebernahmeZurueck = async (/** @type {string} */ id) => {
    if (!projectId) return;
    try {
      const m = (await loadBimModel(projectId)) || {};
      const r = uebernahmeEntfernen(m, id);
      if (r.entfernt) await saveBimModel(projectId, { customWalls: r.customWalls, customSlabs: r.customSlabs, customColumns: r.customColumns }, { streng: true });
      setUebernommen((u) => { const n = new Set(u); n.delete(id); return n; });
      setMeldung(`${tz("Übernahme zurückgenommen")}: ${r.entfernt} ${tz("Bauteile entfernt")}`);
    } catch (e) {
      setMeldung(`${tz("Übernahme fehlgeschlagen")}: ${/** @type {any} */ (e)?.message || e}`);
    }
  };

  // 104-03: ONE command register for this surface — command line, keys, right-click menu and agents call the
  // same records. The commands read the latest state through `aktuell` (the register is built once).
  const aktuell = useRef(/** @type {Record<string, any>} */ ({}));
  aktuell.current = { waehle, aus: () => { zuruecksetzen(); setWerkzeug(null); }, undo, redo, loeschen, eingabeAnwenden, setAuswahl,
    kannUndo: stack.past.length > 0, kannRedo: stack.future.length > 0, auswahl, werkzeug, layer, melden: setMeldung,
    einmal: (/** @type {string} */ art) => { setEinmalFang(art); setMeldung(`${EINMAL_PREFIX}${/** @type {any} */ (FANG_LABEL)[art] || art}`); },
    nimmtPunkte: PUNKT_WERKZEUGE.includes(werkzeug || "") || !!eckeZieht,
    hilfslinienWeg: () => { setLayer(hilfslinienLoeschen(layer)); setMeldung("Hilfslinien gelöscht"); } };
  const befehle = useMemo(() => {
    const reg = befehlsRegister();
    const a = () => aktuell.current;
    for (const w of WERKZEUGE) {
      reg.registrieren({ id: w.id, label: w.label, menue: "Werkzeuge", taste: w.taste === " " ? "Leertaste" : w.taste.toUpperCase(), kurz: KURZFORMEN[w.id] || [],
        ausfuehren: () => { a().waehle(w.id); return w.id; } });
    }
    // 107-07: guide piece and guide point as commands of their own (the guide line is the tool "hilfslinie", short form hl);
    // removing all guides is one undo step
    reg.registrieren({ id: "hilfsstrecke", label: "Hilfsstrecke", menue: "Werkzeuge", kurz: ["hs"], ausfuehren: () => { a().waehle("hilfslinie", "strecke"); return "strecke"; } });
    reg.registrieren({ id: "hilfspunkt", label: "Hilfspunkt", menue: "Werkzeuge", kurz: ["hp"], ausfuehren: () => { a().waehle("hilfslinie", "punkt"); return "punkt"; } });
    reg.registrieren({ id: "hilfslinien-loeschen", label: "Hilfslinien löschen", menue: "Bearbeiten", aktiv: () => (a().layer?.hilfslinien || []).length > 0,
      ausfuehren: () => { const n = a().layer.hilfslinien.length; a().hilfslinienWeg(); return n; } });
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
      // 107-06: base and openings in the read-out too (additive)
      // 107-07: position/rotation (rotated copies) and the guide lines too (additive)
      ausfuehren: () => ({ werkzeug: a().werkzeug, auswahl: a().auswahl, koerper: (a().layer?.koerper || []).map((k) => ({ id: k.id, name: k.name, hoehe: k.hoehe, basis: k.basis, profil: k.profil, gruppe: k.gruppe, pos: k.pos, drehung: k.drehung, ...(k.oeffnungen ? { oeffnungen: k.oeffnungen } : {}),
          // 107-08: type with its source, status, stored guid and the instance transform (additive)
          ...Object.fromEntries(["bauteil_typ", "bauteil_typ_quelle", "status", "guid", "spiegel", "massstab"].filter((f) => /** @type {any} */ (k)[f] != null).map((f) => [f, /** @type {any} */ (k)[f]])) })),
        hilfslinien: a().layer?.hilfslinien || [] }) });
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
  }, [cursor, werkzeug, punkte, fangIdx, fangEinst, fangAus, einmalFang, start, eckeZieht, bezugKante, achsSperre]);

  // review 107-07: Shift = axis lock for the running command. Pressing it freezes the direction of the ray shown at that moment
  // (polar, ortho, parallel, perpendicular); without a ray the nearest axis from the base point; without a base point ortho as
  // the fallback. Released = free again. Fed by keydown/keyup (no pointer move needed) and by the pointer's shiftKey.
  const sperrQuelle = useRef(/** @type {{f: any, basis: {x:number,y:number}|null, cursor: {x:number,y:number}|null}} */ ({ f: null, basis: null, cursor: null }));
  sperrQuelle.current = { f: fangCursor, basis: werkzeug === "verschieben" ? start : punkte[punkte.length - 1] || null, cursor };
  const setAchsSperre = useCallback((/** @type {boolean} */ an) => {
    if (!an) { setAchsSperreRoh((s) => (s ? null : s)); return; }
    setAchsSperreRoh((s) => {
      if (s) return s;
      const { f, basis, cursor: c } = sperrQuelle.current;
      if (f?.strahl && Number.isFinite(f.strahl.winkel_grad)) return { winkel_grad: f.strahl.winkel_grad, art: f.art || "polar" };
      if (basis && c && Math.hypot(c.x - basis.x, c.y - basis.y) > 1e-9) return { winkel_grad: orthoPunkt(basis, c).winkel_grad, art: "ortho" };
      return { winkel_grad: null, art: "ortho" };
    });
  }, []);
  useEffect(() => {
    if (!werkzeug) { setAchsSperre(false); return undefined; }
    const runter = (/** @type {KeyboardEvent} */ e) => { if (e.key === "Shift") setAchsSperre(true); };
    const hoch = (/** @type {KeyboardEvent} */ e) => { if (e.key === "Shift") setAchsSperre(false); };
    const weg = () => setAchsSperre(false);
    window.addEventListener("keydown", runter);
    window.addEventListener("keyup", hoch);
    window.addEventListener("blur", weg);
    return () => { window.removeEventListener("keydown", runter); window.removeEventListener("keyup", hoch); window.removeEventListener("blur", weg); };
  }, [werkzeug, setAchsSperre]);

  // 107-07: preview of the row while "*n" / "/n" is typed (before Enter) — outlines of the copies it would make
  const reihenVorschau = useMemo(() => {
    const e = kopieAktiv && /^\s*[*/x]/i.test(eingabe) ? eingabeLesen(eingabe) : null;
    if (!e || (e.art !== "mal" && e.art !== "teilen") || !kopieAktiv) return [];
    try {
      const r = reiheBilden(kopieAktiv, e.n, e.art);
      const neu = new Set(r.neu);
      return r.layer.koerper.filter((/** @type {any} */ k) => neu.has(k.id)).map((/** @type {any} */ k) => ({ id: k.id, profil: geometrie(r.layer, k).profil }));
    } catch { return []; }
  }, [kopieAktiv, eingabe]);

  return { flaecheTreffen, flaecheAktuell, flaecheMarke: flaecheAktuell ? flaecheAktuell.marke : null,
    flaecheSetzen: (/** @type {'oben'|'unten'} */ art) => { if (auswahl.length === 1) { setFlaecheWahl({ koerperId: auswahl[0], art }); setMeldung(tz(art === "oben" ? "Fläche: Oberseite" : "Fläche: Unterseite")); } },
    // 107-07: guide lines, rotate centre / copy switch, reference edge, Shift axis lock, row preview
    hilfslinien: layer.hilfslinien || [], hlArt, setHlArt, drehZentrum, drehKopie, setDrehKopie, bezugKante, setAchsSperre, reihenVorschau,
    hilfslinienWeg: () => { setLayer(hilfslinienLoeschen(layer)); setMeldung("Hilfslinien gelöscht"); },
    pfadZu, folgeVorlage, setFolgeVorlage, fangCursor, fangEinst, einmalFang, setFangAus, befehle, merkeLeerZug: () => { leerZug.current = true; }, rOpt, setROpt, riegelAbgeleitet, aktiverRiegel, setAktiverRiegel, riegelLoeschen, pushPullAnwenden, eckeZieht, setEckeZieht, eckeLoslassen, erledigt, layer, aufgeloest, gelaende: layer.gelaende || null, gModus, setGModus, gRadius, setGRadius, gSchritt, setGSchritt,
    gelaendeLoeschen: () => { const { gelaende: _g, ...rest } = layer; setLayer(/** @type {any} */ (rest)); }, graph, setGraph, ergebnis, vorschau, backen, beispiel: (mitteSite) => setGraph(beispielGraph(mitteSite)), werkzeug, waehle, aus: () => { zuruecksetzen(); setWerkzeug(null); }, punkte, cursor, setCursor, fange, auswahl, start,
    klick, eingabe, setEingabe, eingabeAnwenden, meldung, gruppe, eindeutig, loeschen, undo, redo,
    // 107-08: inspector of one body
    typZurueck, typZulassen, typVonHand, statusVonHand, dachVonHand, spiegelnAuswahl, steckbriefOffen, steckbriefUmschalten, koerperSteckbrief, koerperGuid,
    alsBauteil, uebernahmeZurueck, uebernommen,
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
      <button type="button" className={`${knopf} border-border text-foreground hover:bg-muted`} onClick={m.redo} disabled={!m.kannRedo} aria-label={t("Wiederholen")} data-testid="mm-redo">↷</button>
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
        {(() => {
          // 107-05: inspector line of an invalid selected body — symbol + word + reason, the colour is only the third cue;
          // solid border like the "fehler" state of 106-01 (dashed is reserved for "warnung")
          const k = m.auswahl.length ? m.aufgeloest.find((x) => m.auswahl.includes(x.id) && !x.gueltig.ok) : null;
          if (!k || k.gueltig.ok) return null;
          return (
            <span role="status" className="flex items-center gap-1 rounded border border-fehler-rand bg-fehler-flaeche px-1.5 py-0.5 text-fehler" data-testid="mm-ungueltig" data-grund={k.gueltig.grund}>
              <span aria-hidden="true" className="font-bold">!</span>{t("Körper ungültig")}: {t(k.gueltig.text || "Profil ungültig")}
            </span>
          );
        })()}
        {m.auswahl.length === 1 && (() => {
          // 107-08: inspector of one body — type with its origin (D-BK-09: automatic = "abgeleitet (Annahme)", dashed hint frame plus
          // the word, never colour alone), take back / allow again, type and status by hand, mirror, takeover, data sheet
          const k = m.layer.koerper.find((x) => x.id === m.auswahl[0]);
          if (!k) return null;
          const typ = k.bauteil_typ && BAUTEIL_TYPEN[k.bauteil_typ] ? BAUTEIL_TYPEN[k.bauteil_typ] : null;
          const auto = !!typ && k.bauteil_typ_quelle === "automatisch";
          const sb = m.steckbriefOffen ? m.koerperSteckbrief(k) : null;
          const zahl = (/** @type {number} */ v) => v.toLocaleString("de-DE", { maximumFractionDigits: 2 });
          const klein = "rounded-md border border-border px-1.5 py-0.5 hover:bg-muted";
          // while a drawing/editing tool runs only the compact mark (type, origin, take back / allow) — it shares the line of the tool
          // row, so the plan and the 3D view do not move down; the full inspector belongs to the selection tool (or no tool)
          const voll = !m.werkzeug || m.werkzeug === "auswahl";
          return (
            <span className="flex flex-wrap items-center gap-1.5" data-testid="mm-bauteil" data-typ={k.bauteil_typ || ""} data-quelle={k.bauteil_typ_quelle || ""}>
              <span className="font-semibold text-foreground" data-testid="mm-bauteil-typ">{typ ? t(typ.label) : t(TYP_OFFEN_TEXT)}</span>
              {auto && <span className="rounded border border-dashed border-hinweis-rand bg-hinweis-flaeche px-1 text-hinweis" data-testid="mm-bauteil-abgeleitet">{t(TYP_ABGELEITET_TEXT)}</span>}
              {typ && !auto && <span className="text-muted-foreground" data-testid="mm-bauteil-gesetzt">{t("gesetzt")}</span>}
              {auto && <button type="button" className={klein} onClick={() => m.typZurueck([k.id])} data-testid="mm-typ-zurueck">{t("Automatik zurücknehmen")}</button>}
              {k.bauteil_typ_quelle === "zurueckgenommen" && <button type="button" className={klein} onClick={() => m.typZulassen([k.id])} data-testid="mm-typ-zulassen">{t("Automatik wieder zulassen")}</button>}
              {voll && <>
              <label className="flex items-center gap-1 text-muted-foreground">{t("Typ")}
                <select value={typ ? k.bauteil_typ : ""} onChange={(e) => m.typVonHand([k.id], e.target.value)} className="rounded-md border border-border bg-card px-1 py-0.5" data-testid="mm-typ-wahl">
                  <option value="">{t(TYP_OFFEN_TEXT)}</option>
                  {KOERPER_TYPEN.map((id) => <option key={id} value={id}>{t(BAUTEIL_TYPEN[id].label)}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-1 text-muted-foreground">{t("Status")}
                <select value={k.status || ""} onChange={(e) => m.statusVonHand([k.id], e.target.value)} className="rounded-md border border-border bg-card px-1 py-0.5" data-testid="mm-status">
                  {KOERPER_STATUS.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}
                </select>
              </label>
              {(() => {
                // 107-10: roof on the body (faces from the roof library; the same faces in 3D and in the IFC). [ASSUMED] a newly chosen pitched
                // form starts at 30° — the default of the BIM studio's global roof slope; the field changes it at once.
                const kd = (k.gruppe != null ? m.layer.gruppen?.[k.gruppe]?.dach : k.dach) || null;
                return <>
                  <label className="flex items-center gap-1 text-muted-foreground">{t("Dachform")}
                    <select value={kd?.form || ""} onChange={(e) => m.dachVonHand([k.id], e.target.value ? { form: e.target.value, neigung_grad: kd?.neigung_grad ?? 30, firstrichtung: kd?.firstrichtung } : null)} className="rounded-md border border-border bg-card px-1 py-0.5" data-testid="mm-dachform">
                      <option value="">{t("Kein Dach")}</option><option value="flach">{t("Flachdach")}</option><option value="sattel">{t("Satteldach")}</option><option value="walm">{t("Walmdach")}</option><option value="pult">{t("Pultdach")}</option>
                    </select>
                  </label>
                  {kd && kd.form !== "flach" && <label className="flex items-center gap-1 text-muted-foreground">{t("Neigung (°)")}
                    <input type="number" min="1" max="85" step="1" value={kd.neigung_grad ?? 30} onChange={(e) => m.dachVonHand([k.id], { ...kd, neigung_grad: +e.target.value })} className="w-14 rounded-md border border-border bg-card px-1 py-0.5" data-testid="mm-dachneigung" />
                  </label>}
                  {/* 107-10 review: ridge direction of the body roof (roof library dachRahmen: along / across the longest side), as in the BIM roof inspector */}
                  {kd && kd.form !== "flach" && <label className="flex items-center gap-1 text-muted-foreground">{t("First")}
                    <select value={kd.firstrichtung === "quer" ? "quer" : "laengs"} onChange={(e) => { const { firstrichtung: _f, ...rest } = kd; m.dachVonHand([k.id], e.target.value === "quer" ? { ...rest, firstrichtung: "quer" } : rest); }} className="rounded-md border border-border bg-card px-1 py-0.5" data-testid="mm-dachfirst" aria-label={t("First")}>
                      <option value="laengs">{t("längs zur längsten Seite")}</option><option value="quer">{t("quer zur längsten Seite")}</option>
                    </select>
                  </label>}
                </>;
              })()}
              <button type="button" aria-pressed={!!k.spiegel} className={klein} onClick={m.spiegelnAuswahl} data-testid="mm-spiegeln">{k.spiegel ? "✓ " : ""}{t("Spiegeln")}</button>
              {m.uebernommen.has(k.id)
                ? <button type="button" className={klein} onClick={() => m.uebernahmeZurueck(k.id)} data-testid="mm-uebernahme-zurueck">{t("Übernahme zurücknehmen")}</button>
                : <button type="button" className={klein} onClick={() => m.alsBauteil(k.id)} data-testid="mm-als-bauteil">{t("Als Bauteil übernehmen")}</button>}
              <button type="button" aria-expanded={m.steckbriefOffen} className={klein} onClick={m.steckbriefUmschalten} data-testid="mm-steckbrief">{t("Steckbrief")}</button>
              {m.steckbriefOffen && (
                <span className="flex basis-full flex-wrap items-center gap-x-3 gap-y-0.5 text-muted-foreground" data-testid="mm-steckbrief-inhalt">
                  <span>GUID <span className="font-mono text-foreground" data-testid="mm-steckbrief-guid" data-gespeichert={k.guid ? "ja" : "nein"}>{m.koerperGuid(k)}</span></span>
                  <span>IFC {sb ? `${sb.ifc.klasse} ${sb.ifc.typ}` : "IfcBuildingElementProxy"}</span>
                  {sb && <span>{t("KG")} {sb.kg ?? t("offen")}</span>}
                  {sb && <span>{t("Menge")} {zahl(sb.menge.wert)} {sb.menge.einheit}</span>}
                  {sb && sb.annahmen.map((a, i) => <span key={i} className="text-hinweis">{t(a)}</span>)}
                </span>
              )}
              </>}
            </span>
          );
        })()}
        {m.werkzeug === "pushpull" && (() => {
          // 107-06: which face push/pull acts on — the 3D pick, or top/bottom chosen here for the selected body (the iso view never
          // shows the bottom); the part rectangle with its size
          const w = m.flaecheAktuell?.wahl;
          const teil = w?.art === "seite" ? w.teil : null;
          const zahl = (/** @type {number} */ v) => v.toFixed(2).replace(".", ",");
          const text = !w ? t("Fläche: Oberseite (ohne Treffer)") : w.art === "seite"
            ? `${t(w.ring === "aussen" ? "Fläche: Seite {{n}}" : "Fläche: Hofseite {{n}}").replace("{{n}}", String(w.kante + 1))}${teil ? ` · ${t("Teilfläche")} ${zahl(teil.width)} × ${zahl(teil.height)} m` : ""}`
            : t(w.art === "oben" ? "Fläche: Oberseite" : "Fläche: Unterseite");
          const einer = m.auswahl.length === 1;
          return (
            <span className="flex flex-wrap items-center gap-1.5" data-testid="mm-flaeche-zeile">
              <span className="text-muted-foreground" data-testid="mm-flaeche-wahl" data-art={w?.art || "oben"} data-kante={w?.art === "seite" ? String(w.kante) : ""} data-teil={teil ? "1" : ""}>{text}</span>
              <button type="button" disabled={!einer} onClick={() => m.flaecheSetzen("oben")} data-testid="mm-flaeche-oben"
                className="rounded-md border border-border px-1.5 py-0.5 hover:bg-muted disabled:opacity-40">{t("Oberseite")}</button>
              <button type="button" disabled={!einer} onClick={() => m.flaecheSetzen("unten")} data-testid="mm-flaeche-unten"
                className="rounded-md border border-border px-1.5 py-0.5 hover:bg-muted disabled:opacity-40">{t("Unterseite")}</button>
            </span>
          );
        })()}
        {m.werkzeug === "folgemir" && (
          <span className="flex flex-wrap items-center gap-1.5" data-testid="mm-folge-zeile">
            <label className="flex items-center gap-1 text-muted-foreground">{t("Profil")}
              <select value={m.folgeVorlage} onChange={(e) => m.setFolgeVorlage(e.target.value)} className="rounded-md border border-border bg-card px-1 py-0.5" data-testid="mm-folge-profil">
                {PROFIL_VORLAGEN.map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}
              </select>
            </label>
            <span className="text-muted-foreground">{m.pfadZu ? t("Pfad geschlossen (Ring mit Hof)") : t("Startpunkt erneut klicken = geschlossener Pfad")}</span>
          </span>
        )}
        {m.werkzeug === "drehen" && (
          // 107-07: rotated copies (same as Ctrl+Enter) and the centre (clicked beside the bodies, else the centroid)
          <span className="flex flex-wrap items-center gap-1.5" data-testid="mm-dreh-zeile">
            <button type="button" aria-pressed={m.drehKopie} onClick={() => m.setDrehKopie(!m.drehKopie)} data-testid="mm-dreh-kopie"
              className={`rounded-md border px-1.5 py-0.5 ${m.drehKopie ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"}`}>
              {m.drehKopie ? "✓ " : ""}{t("Kopie")}
            </button>
            <span className="text-muted-foreground" data-testid="mm-drehpunkt" data-gesetzt={m.drehZentrum ? "1" : "0"}>
              {m.drehZentrum ? t("Drehpunkt gesetzt") : t("Drehpunkt: Schwerpunkt (Klick daneben setzt ihn)")}
            </span>
          </span>
        )}
        {m.werkzeug === "hilfslinie" && (
          // 107-07: kind of guide; guides are snap targets and never reach PDF, DXF or IFC
          <span className="flex flex-wrap items-center gap-1.5" data-testid="mm-hilfslinie-zeile">
            {HILFSLINIEN_WAHL.map(([art, kurz, label]) => (
              <button key={art} type="button" aria-pressed={m.hlArt === art} onClick={() => m.waehle("hilfslinie", /** @type {any} */ (art))} data-testid={`mm-hl-${art}`}
                className={`rounded-md border px-1.5 py-0.5 ${m.hlArt === art ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"}`}>
                {t(label)} <span className="opacity-60">{kurz}</span>
              </button>
            ))}
            <span className="text-muted-foreground">{t("Fangziel, nie gedruckt oder exportiert")}</span>
            {m.hilfslinien.length > 0 && (
              <button type="button" className="rounded-md border border-border px-1.5 py-0.5 text-fehler hover:bg-muted" onClick={m.hilfslinienWeg} data-testid="mm-hl-loeschen">
                {t("Hilfslinien löschen")} ({m.hilfslinien.length})
              </button>
            )}
          </span>
        )}
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
  const { t } = useI18n(); // 107-06: tooltip of an opening that no longer fits
  const pfad = (pts) => pts.map((p, i) => `${i ? "L" : "M"}${mx(p.x)},${my(p.y)}`).join(" ") + " Z";
  // 107-05: look of an invalid body from the "fehler" pointing state of 106-01 (colour, outline form, symbol). The light-theme
  // hex is right here: the plan canvas is light in both themes (fixed light slate background in MassingStudio, every other plan stroke is a light-theme hex).
  const FZ = ZEIGE_ZUSTAENDE.fehler;
  const FEHLER = FZ.hex;
  const fehlerStrich = FZ.strich ? FZ.strich.split(" ").map((v) => px(Number(v))).join(" ") : undefined; // null for "fehler" = solid
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
        // 107-05: inner rings as sub-paths (evenodd = courtyard stays open); an invalid body gets the error colour, the outline
        // of the "fehler" state (solid, stronger) and "!" in front of its label (three cues, FARB-01). A selected invalid body
        // keeps its selection as a halo in the selection colour under the error outline, so both states stay visible.
        const d = [k.profil, ...(k.loecher || [])].map(pfad).join(" ");
        const ungueltig = !k.gueltig.ok;
        return (
          <g key={k.id} data-testid="mm-koerper" data-id={k.id} data-gruppe={k.gruppe ?? ""} data-hoehe={k.hoehe} data-loecher={(k.loecher || []).length} data-ungueltig={ungueltig ? k.gueltig.grund || "" : ""}>
            {ungueltig && sel && <path d={d} fill="none" stroke="#0f766e" strokeOpacity={0.55} strokeWidth={px(6)} strokeLinejoin="round" data-testid="mm-auswahl-halo" style={{ pointerEvents: "none" }} />}
            <path d={d} fillRule="evenodd" fill={ungueltig ? FEHLER : k.gruppe != null ? "#a8a29e" : "#d6d3d1"} fillOpacity={ungueltig ? 0.25 : 0.55}
              stroke={ungueltig ? FEHLER : sel ? "#0f766e" : "#44403c"} strokeDasharray={ungueltig ? fehlerStrich : undefined} strokeWidth={px(ungueltig ? 2.2 : sel ? 2.5 : 1.2)} />
            <text x={mx(cx)} y={my(cy)} textAnchor="middle" fontSize={px(10)} fill={ungueltig ? FEHLER : "#292524"} fontWeight={ungueltig ? 700 : undefined} style={{ pointerEvents: "none" }}>
              {`${ungueltig ? `${FZ.symbol || "!"} ` : ""}${k.hoehe.toFixed(2).replace(".", ",")} m${k.gruppe != null ? ` · G${k.gruppe}` : ""}`}
            </text>
            {/* 107-06: openings through the body — the tunnel as a white gap in the plan (entry edge to exit edge); one that no
                longer fits after a later edit is drawn on its edge in the error token with a dashed outline (form + colour) */}
            {(k.oeffnungenGeprueft || []).map((/** @type {any} */ o) => {
              if (o.ok) {
                const ex = (o.b.x - o.a.x) / o.laenge, ey = (o.b.y - o.a.y) / o.laenge, tiefe = o.durchgang.tiefe;
                // u along the entry edge, s into the body (inward normal = (−ey, ex)), both m
                const P = (/** @type {number} */ u, /** @type {number} */ s) => ({ x: o.a.x + ex * u - ey * s, y: o.a.y + ey * u + ex * s });
                const u0 = o.mitte - o.masse.w / 2, u1 = o.mitte + o.masse.w / 2;
                return <path key={`oe${o.index}`} d={pfad([P(u0, 0), P(u1, 0), P(u1, tiefe), P(u0, tiefe)])} fill="#ffffff" stroke="#44403c" strokeWidth={px(0.8)}
                  data-testid="mm-oeffnung" data-ok="1" data-index={o.index} style={{ pointerEvents: "none" }} />;
              }
              const kk = o.oeffnung?.kante, a = k.profil[kk], b = a ? k.profil[(kk + 1) % k.profil.length] : null;
              if (!a || !b) return null;
              return <line key={`oe${o.index}`} x1={mx(a.x)} y1={my(a.y)} x2={mx(b.x)} y2={my(b.y)} stroke={FEHLER} strokeWidth={px(3)} strokeDasharray={`${px(4)} ${px(3)}`}
                data-testid="mm-oeffnung" data-ok="0" data-grund={o.grund} data-index={o.index} style={{ pointerEvents: "none" }}><title>{t(o.text)}</title></line>;
            })}
          </g>
        );
      })}
      {/* 107-06: the side face picked in 3D shows as its edge in the plan (colour of the "auswahl" state, thick stroke) */}
      {m.flaecheAktuell?.wahl?.art === "seite" && (() => {
        const w = m.flaecheAktuell.wahl;
        return <line x1={mx(w.a.x)} y1={my(w.a.y)} x2={mx(w.b.x)} y2={my(w.b.y)} stroke={ZEIGE_ZUSTAENDE.auswahl.hex} strokeWidth={px(4)} strokeLinecap="round"
          data-testid="mm-flaeche-kante" data-kante={w.kante} style={{ pointerEvents: "none" }} />;
      })()}
      {m.vorschau.map((k) => (
        <path key={k.id} d={pfad(k.profil)} fill="#0f766e" fillOpacity={0.12} stroke="#0f766e" strokeDasharray={`${px(4)} ${px(3)}`} strokeWidth={px(1.2)} data-testid="mm-vorschau" style={{ pointerEvents: "none" }} />
      ))}
      {/* 107-07: guide lines / pieces / points — dashed in the "hinweis" token, never printed (print:hidden; PDF, DXF and IFC read
          only the bodies). An infinite line is drawn ±HILFSGERADE_HALB_M around its point. */}
      {m.hilfslinien.length > 0 && (
        <g className="print:hidden" data-testid="mm-hilfslinien" data-anzahl={m.hilfslinien.length} style={{ pointerEvents: "none" }}>
          {m.hilfslinien.map((h) => {
            if (h.art === "punkt" || !h.b) {
              const r = px(5);
              return <path key={h.id} d={`M${mx(h.a.x) - r},${my(h.a.y)} L${mx(h.a.x) + r},${my(h.a.y)} M${mx(h.a.x)},${my(h.a.y) - r} L${mx(h.a.x)},${my(h.a.y) + r}`}
                className="stroke-hinweis" strokeWidth={px(1.2)} data-testid="mm-hilfslinie-plan" data-art="punkt" data-id={h.id} />;
            }
            const L = Math.hypot(h.b.x - h.a.x, h.b.y - h.a.y) || 1, ux = (h.b.x - h.a.x) / L, uy = (h.b.y - h.a.y) / L;
            const [p, q] = h.art === "gerade"
              ? [{ x: h.a.x - ux * HILFSGERADE_HALB_M, y: h.a.y - uy * HILFSGERADE_HALB_M }, { x: h.a.x + ux * HILFSGERADE_HALB_M, y: h.a.y + uy * HILFSGERADE_HALB_M }]
              : [h.a, h.b];
            return <line key={h.id} x1={mx(p.x)} y1={my(p.y)} x2={mx(q.x)} y2={my(q.y)} className="stroke-hinweis" strokeWidth={px(1)}
              strokeDasharray={h.art === "gerade" ? `${px(6)} ${px(4)}` : `${px(3)} ${px(3)}`} data-testid="mm-hilfslinie-plan" data-art={h.art} data-id={h.id} />;
          })}
        </g>
      )}
      {/* 107-07: the reference edge of the parallel / perpendicular tracks — thick dashed, with "∥" at its middle (form, not colour only) */}
      {m.bezugKante && PUNKT_WERKZEUGE.includes(m.werkzeug || "") && m.werkzeug !== "drehen" && (
        <g data-testid="mm-bezugskante" style={{ pointerEvents: "none" }}>
          <line x1={mx(m.bezugKante.a.x)} y1={my(m.bezugKante.a.y)} x2={mx(m.bezugKante.b.x)} y2={my(m.bezugKante.b.y)} className="stroke-hinweis" strokeWidth={px(3)} strokeOpacity={0.6} strokeDasharray={`${px(2)} ${px(2)}`} />
          <text x={(mx(m.bezugKante.a.x) + mx(m.bezugKante.b.x)) / 2 + px(6)} y={(my(m.bezugKante.a.y) + my(m.bezugKante.b.y)) / 2 - px(6)} fontSize={px(11)} className="fill-hinweis">∥</text>
        </g>
      )}
      {/* 107-07: row preview of a typed "*n" / "/n" before Enter */}
      {m.reihenVorschau.map((k) => (
        <path key={`rv${k.id}`} d={pfad(k.profil)} fill="none" className="stroke-primary" strokeDasharray={`${px(4)} ${px(3)}`} strokeWidth={px(1.2)} data-testid="mm-reihe-vorschau" style={{ pointerEvents: "none" }} />
      ))}
      {/* 107-07: rotate centre (cross in a circle) */}
      {m.werkzeug === "drehen" && m.drehZentrum && (
        <g data-testid="mm-drehzentrum" style={{ pointerEvents: "none" }}>
          <circle cx={mx(m.drehZentrum.x)} cy={my(m.drehZentrum.y)} r={px(6)} fill="none" className="stroke-primary" strokeWidth={px(1.5)} />
          <path d={`M${mx(m.drehZentrum.x) - px(9)},${my(m.drehZentrum.y)} L${mx(m.drehZentrum.x) + px(9)},${my(m.drehZentrum.y)} M${mx(m.drehZentrum.x)},${my(m.drehZentrum.y) - px(9)} L${mx(m.drehZentrum.x)},${my(m.drehZentrum.y) + px(9)}`} className="stroke-primary" strokeWidth={px(1)} />
        </g>
      )}
      {m.punkte.length > 0 && (m.pfadZu ? (
        <polygon points={m.punkte.map((p) => `${mx(p.x)},${my(p.y)}`).join(" ")} fill="none" stroke="#0f766e" strokeWidth={px(1.5)} data-testid="mm-entwurf" data-zu="1" />
      ) : (
        <polyline points={[...m.punkte, ...(m.fangCursor ? [m.fangCursor] : [])].map((p) => `${mx(p.x)},${my(p.y)}`).join(" ")}
          fill="none" stroke="#0f766e" strokeWidth={px(1.5)} data-testid="mm-entwurf" />
      ))}
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
          onPointerMove={(e) => { const p = toSite(e); if (p) m.setCursor(p); m.setFangAus(e.altKey); m.setAchsSperre(e.shiftKey); }}
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
  const { befehl, aufforderung } = befehlsAufforderung(m.werkzeug, { punkte: m.punkte, auswahl: m.auswahl, start: m.start, hlArt: m.hlArt, kopie: m.drehKopie });
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
