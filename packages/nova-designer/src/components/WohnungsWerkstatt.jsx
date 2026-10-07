import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, Puzzle, Eraser, Plus, Trash2, Lock, Unlock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Badge } from "@core/components/ui/badge";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@core/components/ui/select";
import { NumberField } from "@core/components/Field";
import { STATUS_STYLE } from "@designer/lib/compliance";
import { useI18n } from "@core/lib/i18n";
import { useBuildingProgram, polygonAreaM } from "@core/lib/useBuildingProgram";
import { useProject } from "@core/lib/ProjectContext";
import { openingTypeById } from "@core/lib/buildingModel";
import { autoEnvOpenings, fensterJeRaum, raeumeOhneRegelfenster } from "@designer/lib/autoOpenings";
import { usePlanModel } from "@designer/lib/usePlanModel";
import { useFachlayer } from "@designer/lib/useFachlayer";
import { useSvgDrag } from "@core/lib/useSvgDrag";
import {
  ERSCHLIESSUNG, tesseliere, istWerkstattZone, tesselierungsChecks, empfehleErschliessung,
  // 75-13: core rules (lift default = duty), balcony rule values.
  kernRegeln, TREPPENRAUM, BALKON, AUFZUG_SCHWELLEN,
} from "@designer/lib/tesselierung";
import {
  WERKSTATT_TYPEN, validiereTyp, woflvFlaeche, mfgFlaeche, belichtungJeWE,
} from "@designer/lib/wohnungsTypen";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@core/components/ui/tabs";
import { kellerLayout, kellerChecks, kellerOptionen, eindeutigeWEs, footprintBBox } from "@designer/lib/keller";
import { tiefgarageLayout, tiefgarageChecks, tiefgarageOptionen, rampeLaenge, TG_STPL_B, TG_ZUSCHLAG_WAND } from "@designer/lib/tiefgarage";
import TiefgaragenPlaner from "./TiefgaragenPlaner";
import KatalogPanel from "./KatalogPanel";
import WohnungsFokus from "./WohnungsFokus";
import KellerabteilPlaner from "./KellerabteilPlaner";
import BimPlan2D from "./BimPlan2D";
import { usePlanHoehe } from "@designer/lib/usePlanHoehe";
// 75-09 Task 6: occupant count for the focus auto-furnishing (pure lib read).
import { personenFuerTyp } from "@designer/lib/wohnMoebel";
// 75-14: room-quality checks per unit (hall/doors/access, 10 m², ratio, wardrobe
// wall) — computed HERE once, the focus gets its unit's record as a prop.
import { pruefeAlle, wohnungsRegeln } from "@designer/lib/raumQualitaet";
import ZonenTueren from "./ZonenTueren";
import { kurzRaumname } from "@designer/lib/massstab";

const de1 = (n) => (Number(n) || 0).toLocaleString("de-DE", { maximumFractionDigits: 1 });
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

// "offen" ergänzen (SP_STATUS-Muster aus SchallschutzPlanner) — "fail" wird nie gerendert.
const WT_STATUS = {
  ...STATUS_STYLE,
  offen: { color: "bg-slate-100 text-slate-600", dot: "bg-slate-400", label: "offen" },
};

// Persistente Werkstatt-Konfiguration (werkstatt_layer im BimModel, KD-17).
// Zonen selbst sind Session-State im Store; beim angewendet: true wird live
// deterministisch re-generiert (D-P61-04). Schema-Erweiterungen (61-05):
// eigeneTypen, gesperrteGrenzen, balkonJeTyp — Migrations-Guard defaultet.
// 75-06 Task 0: the defaults table moved to @designer/lib/werkstattDefaults.js
// (pure .js) so useWerkstattRehydrate — and the unit tests under bare node,
// which cannot parse JSX — read the SAME table. Re-exported here for every
// existing importer of the component.
export { WERKSTATT_DEFAULT } from "@designer/lib/werkstattDefaults";
import { WERKSTATT_DEFAULT, einheitenAnreichern } from "@designer/lib/werkstattDefaults";

// [ASSUMED] Automatic garage length when the user gives none and the cellar is
// active: 60 % of the footprint length, but never less than ramp + two stalls —
// on the 40 m demo footprint 60 % (24 m) left ONE stall beside the 20 m ramp
// (pane finding 05.09.). Capped at the footprint; shown in the UI as the length.
const TG_LAENGE_ANTEIL_MIT_KELLER = 0.6;
const TG_LAENGE_MIN_NEBEN_RAMPE_M = 2 * TG_STPL_B + 2 * TG_ZUSCHLAG_WAND; // two regular stalls incl. wall surcharge, m

const RAUM_ARTEN = [
  { id: "aufenthalt", label: "Aufenthalt" },
  { id: "kueche", label: "Küche" },
  { id: "sanitaer", label: "Bad/WC" },
  { id: "abstell", label: "Abstell" },
  { id: "flur", label: "Flur" },
];

// Wohnungs-Werkstatt (Phase 61): regelbasierter Typen-Editor, Typologie-
// Live-Switch, ±-Knautschzonen (sperrbar), Bewohnbarkeits-Checks und
// WoFlV/MF-G-Anzeige je WE, Wohnungs-Fokusansicht (TESS-07). Fachlogik kommt
// aus den Libs (61-02/03/04) — diese Komponente rendert und verdrahtet nur.
//
// 75-09 Task 6: vier OPTIONALE Möbel-Props (ohne sie verhält sich die Werkstatt
// exakt wie vorher; der Fokus zeigt Möbel dann nur an). Der Fokus schreibt nie
// selbst — onMoeblierungChange reicht er nach ComplexDesigner (updateComplexData).
/**
 * @param {object} [props]
 * @param {Record<string, Array<object>>} [props.moeblierung] complexData.moeblierung (Schlüssel zoneKey)
 * @param {Array<object>} [props.moebelEigene] complexData.moebel_eigene (eigene Möbeltypen)
 * @param {(m: Record<string, Array<object>>) => void} [props.onMoeblierungChange]
 *   ein Schreibweg: updateComplexData('moeblierung', …) — fehlt er, ist der Fokus read-only
 * @param {boolean} [props.speicherbar] Entwurf hat Name + Standort („Entwurf speichern" möglich)
 */
export default function WohnungsWerkstatt({ moeblierung, moebelEigene, onMoeblierungChange, speicherbar } = {}) {
  const { t } = useI18n();
  const { project } = useProject();
  const plan = usePlanModel(project?.id);
  const store = useBuildingProgram();
  const zones = Array.isArray(store.zones) ? store.zones : [];
  const [layer, setLayer] = useFachlayer(project?.id, "werkstatt_layer", WERKSTATT_DEFAULT);
  // 75-16: floor-plan height follows the window (≥ the old fixed 420 px).
  const planHoehe = usePlanHoehe();
  const [level, setLevel] = useState(0);
  const [selIdx, setSelIdx] = useState(0);
  const [offenIdx, setOffenIdx] = useState(null); // aufgeklappte Check-Card (WE-Index)
  const [fokusWe, setFokusWe] = useState(null);
  const fokusNonce = useRef(0);
  const checkCardRef = useRef(null); // "Checks dieser WE" scrolls here

  // Migrations-Guard: fehlende Felder defaulten statt den Layer zu ersetzen.
  // Gespeicherte Einheiten im Alt-Format (61-01: ohne raumprogramm/balkon)
  // werden hier additiv mit den Katalog-Definitionen angereichert — so bleibt
  // der raumzonen-Modus auch für ältere Layer funktionsfähig.
  // 75-06 Task 0: Anreicherung als geteilter reiner Pfad in werkstattDefaults
  // (einheitenAnreichern) — useWerkstattRehydrate benutzt dieselbe Funktion,
  // damit der Reload exakt die Zonen regeneriert, die die Werkstatt bauen würde.
  // Memoised on the layer (61-05 finish): a fresh array per render made
  // `ergebnis`, the store-sync effect and every downstream useMemo recompute
  // on every render — including each keystroke in the editor.
  const angereicherteEinheiten = useMemo(() => einheitenAnreichern(layer?.einheiten), [layer?.einheiten]);
  const cfg = useMemo(() => ({
    ...WERKSTATT_DEFAULT,
    ...(layer || {}),
    einheiten: angereicherteEinheiten,
    // Migrations-Guard 61-06: ältere Layer ohne keller-Feld defaulten additiv.
    keller: {
      ...WERKSTATT_DEFAULT.keller,
      ...(layer?.keller || {}),
      optionen: kellerOptionen(layer?.keller?.optionen),
    },
    // Migrations-Guard 62-02: ältere Layer ohne tiefgarage-Feld defaulten additiv.
    tiefgarage: {
      ...WERKSTATT_DEFAULT.tiefgarage,
      ...(layer?.tiefgarage || {}),
      optionen: tiefgarageOptionen(layer?.tiefgarage?.optionen),
    },
    // Migrations-Guard 61-07: plain objects, never null.
    anordnung: layer?.anordnung && typeof layer.anordnung === "object" ? layer.anordnung : {},
    grenzenPositionen: layer?.grenzenPositionen && typeof layer.grenzenPositionen === "object" ? layer.grenzenPositionen : {},
    // Migrations-Guard 75-07: ältere Layer ohne regeln/nordwinkel.
    regeln: layer?.regeln && typeof layer.regeln === "object" ? layer.regeln : {},
    nordwinkel: Number.isFinite(Number(layer?.nordwinkel)) ? Number(layer.nordwinkel) : 0,
    // Migrations-Guard 75-14: door-swing overrides, plain object.
    tuerAufschlaege: layer?.tuerAufschlaege && typeof layer.tuerAufschlaege === "object" ? layer.tuerAufschlaege : {},
  }), [layer, angereicherteEinheiten]);
  const setCfg = (patch) => setLayer({ ...cfg, ...patch });
  const [ansicht, setAnsicht] = useState("geschosse"); // Sub-Tab: Geschosse | Kellerabteile

  const maxLevel = Math.max(0, Math.round(store.storeys || 1) - 1);
  const lvl = Math.min(level, maxLevel);

  // Deterministisches Tesselierungs-Ergebnis (raumzonen-Modus, Knautsch-Sperren).
  const ergebnis = useMemo(
    () => tesseliere({
      footprintM: store.footprintM,
      storeys: store.storeys,
      typ: cfg.typ,
      einheiten: cfg.einheiten,
      gesperrteGrenzen: cfg.gesperrteGrenzen,
      raumzonen: true,
      // 61-07: manual arrangement inputs
      anordnung: cfg.anordnung,
      grenzenPositionen: cfg.grenzenPositionen,
      // 75-07: Architekturregeln + Nordwinkel (optional; ohne Regeln byte-gleich zu 61).
      regeln: cfg.regeln,
      nordwinkel: cfg.nordwinkel,
      // 75-14: door swings toggled in the focus (only read with regeln.wohnungsgrundriss).
      tuerAufschlaege: cfg.tuerAufschlaege,
      // 75-13: top-storey floor level for the lift duty (OKF ≈ (storeys − 1) · storey height).
      okf_m: (Math.max(1, Math.round(store.storeys || 1)) - 1) * (store.storeyHeight || 3),
    }),
    [store.footprintM, store.storeys, store.storeyHeight, cfg.typ, cfg.einheiten, cfg.gesperrteGrenzen, cfg.anordnung, cfg.grenzenPositionen, cfg.regeln, cfg.nordwinkel, cfg.tuerAufschlaege]
  );
  // 75-13: resolved core rules for the switches (lift default = duty by office rule / OKF).
  const kernInfo = useMemo(
    () => kernRegeln(cfg.regeln, Math.max(1, Math.round(store.storeys || 1)), (Math.max(1, Math.round(store.storeys || 1)) - 1) * (store.storeyHeight || 3)),
    [cfg.regeln, store.storeys, store.storeyHeight]
  );
  // 75-13: per-room window cap by ZONE name, expanded from the type|room keys of the
  // layer (fensterJeRaum only knows zone names, the editor only knows type rooms).
  const raumBasis = (name) => String(name || "").replace(/(?: \d+)? \([^)]*\) ·WT$/, "");
  const typKeyJeWe = useMemo(() => /** @type {Map<string, string>} */ (new Map(ergebnis.weListe.map((w) => /** @type {[string, string]} */ ([w.we, w.typKey])))), [ergebnis.weListe]);
  const fensterMaxJeZone = useMemo(() => {
    const m = cfg.regeln?.fensterMaxJeRaum;
    if (!m || typeof m !== "object") return {};
    /** @type {Record<string, number>} */
    const out = {};
    for (const z of ergebnis.zonen) {
      if (!z.we) continue;
      const v = m[`${typKeyJeWe.get(z.we)}|${raumBasis(z.name)}`];
      if (v === 1 || v === 2) out[String(z.name)] = v;
    }
    return out;
  }, [cfg.regeln, ergebnis.zonen, typKeyJeWe]);
  // 75-14: quality list per unit (access graph, 10 m², ratio, wardrobe wall) —
  // only with the rule on; the footprint bbox marks the window walls of legacy zones.
  const wohnungsgrundrissAktiv = wohnungsRegeln(cfg.regeln).aktiv;
  const qualitaetJeWe = useMemo(() => {
    if (!wohnungsgrundrissAktiv) return [];
    const bb = footprintBBox(store.footprintM);
    return pruefeAlle(ergebnis.zonen, { bbox: { minX: bb.minX, maxX: bb.maxX, minZ: bb.minZ, maxZ: bb.maxZ }, regeln: cfg.regeln });
  }, [wohnungsgrundrissAktiv, ergebnis.zonen, store.footprintM, cfg.regeln]);
  const qualitaetZaehler = useMemo(() => qualitaetJeWe.reduce((s, q) => ({
    ok: s.ok + (q.zaehler.ok || 0), warn: s.warn + (q.zaehler.warn || 0), fail: s.fail + (q.zaehler.fail || 0),
  }), { ok: 0, warn: 0, fail: 0 }), [qualitaetJeWe]);
  // 75-07: Erschließungs-Empfehlung aus der kürzeren Footprint-Seite (Blatt 06).
  const empfehlung = useMemo(() => {
    const bb = footprintBBox(store.footprintM);
    return empfehleErschliessung(Math.min(bb.w, bb.d));
  }, [store.footprintM]);
  const setRegel = (k, v) => setCfg({ regeln: { ...cfg.regeln, [k]: v } });

  // 62-02: Tiefgarage im Kopfbereich des Footprints (level −1). Effective length:
  // user value, else the whole footprint, else 60 % when the cellar is active.
  const tgErgebnis = useMemo(() => {
    const bb = footprintBBox(store.footprintM);
    const L = Math.max(bb.w, bb.d);
    const rampe = rampeLaenge(plan.storeyHeight, cfg.tiefgarage.optionen.rampeNeigung);
    const auto = Math.min(L, Math.max(L * TG_LAENGE_ANTEIL_MIT_KELLER, rampe + TG_LAENGE_MIN_NEBEN_RAMPE_M));
    const laenge = cfg.tiefgarage.optionen.laenge_m ?? (cfg.keller.aktiv ? Math.round(auto * 10) / 10 : null);
    return tiefgarageLayout({
      footprintM: store.footprintM,
      storeyHeight: plan.storeyHeight,
      weAnzahl: eindeutigeWEs(ergebnis.weListe).length,
      optionen: { ...cfg.tiefgarage.optionen, laenge_m: laenge },
    });
  }, [store.footprintM, plan.storeyHeight, ergebnis.weListe, cfg.tiefgarage.optionen, cfg.keller.aktiv]);
  const tgChecksListe = useMemo(() => tiefgarageChecks(tgErgebnis), [tgErgebnis]);

  // 61-06: Kellergeschoss aus DERSELBEN weListe — ein Abteil je WE, level −1.
  // 62-02: with the garage applied the cellar starts behind it (uStart).
  const kellerErgebnis = useMemo(
    () => kellerLayout({
      footprintM: store.footprintM, weListe: ergebnis.weListe, optionen: cfg.keller.optionen,
      uStart: cfg.tiefgarage.aktiv ? tgErgebnis.laenge_m : 0,
    }),
    [store.footprintM, ergebnis.weListe, cfg.keller.optionen, cfg.tiefgarage.aktiv, tgErgebnis.laenge_m]
  );
  const kellerChecksListe = useMemo(() => kellerChecks(kellerErgebnis), [kellerErgebnis]);

  // Live-Regenerieren: bei angewendet: true jede Parameter-/Typologie-Änderung
  // sofort in den Store spiegeln. Ping-Pong-Guard wie BitBimStudio (JSON-
  // Vergleich vor set, T-61-15).
  //
  // I-01 (externe Review 02.09.): the 61-01 tracer guarded this effect with
  // `!zones.some(istWerkstattZone)` — once ·WT zones existed nothing updated
  // them, so a footprint or storey change in the Gebäudemodell left the old
  // bands standing outside the building. There is no such guard any more:
  // `ergebnis` depends on store.footprintM/storeys, and every change replaces
  // the ·WT part of the store. The D-P61-04 mount regeneration is the same
  // path, idempotent through the JSON guard. Documented limit: while this tab
  // is unmounted nothing regenerates; the next mount catches up.
  //
  // 61-06: the basement (level −1) rides the same path. With keller.aktiv the
  // kellerLayout zones are appended, so a changed unit mix regenerates the
  // compartments too; the persisted AVA hand-over list (keller.mengen) follows
  // through the same JSON guard.
  useEffect(() => {
    if (!cfg.angewendet) return undefined;
    const ohneWT = zones.filter((z) => !istWerkstattZone(z));
    // 62-02: the garage rides the same path — one effect owns every ·WT zone.
    const naechste = [
      ...ohneWT, ...ergebnis.zonen,
      ...(cfg.tiefgarage.aktiv ? tgErgebnis.zonen : []),
      ...(cfg.keller.aktiv ? kellerErgebnis.zonen : []),
    ];
    if (JSON.stringify(zones) !== JSON.stringify(naechste)) store.set({ zones: naechste });
    const patch = {};
    if (cfg.keller.aktiv && JSON.stringify(cfg.keller.mengen) !== JSON.stringify(kellerErgebnis.mengen)) {
      patch.keller = { ...cfg.keller, mengen: kellerErgebnis.mengen };
    }
    if (cfg.tiefgarage.aktiv && JSON.stringify(cfg.tiefgarage.mengen) !== JSON.stringify(tgErgebnis.mengen)) {
      patch.tiefgarage = { ...cfg.tiefgarage, mengen: tgErgebnis.mengen };
    }
    if (Object.keys(patch).length) setCfg(patch);
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.angewendet, ergebnis, cfg.keller.aktiv, kellerErgebnis, cfg.tiefgarage.aktiv, tgErgebnis]);

  // D-P61-04: bei angewendet: true (persistierte Konfiguration) beim Tab-Mount
  // einmalig deterministisch re-generieren — der Live-Effekt oben erledigt das
  // idempotent (JSON-Guard).

  const anwenden = () => setCfg({ angewendet: true });
  // Entfernt ALLE ·WT-Zonen (Geschosse und Keller) — der Keller hängt an der
  // Tesselierung und kann ohne sie nicht stehen bleiben.
  const entfernen = () => {
    store.set({ zones: zones.filter((z) => !istWerkstattZone(z)) });
    setCfg({ angewendet: false, keller: { ...cfg.keller, aktiv: false }, tiefgarage: { ...cfg.tiefgarage, aktiv: false } });
    setFokusWe(null);
  };
  // 61-06: Keller anwenden/entfernen — isoliert (T-61-18): die Geschoss-Zonen
  // bleiben unangetastet, der Live-Effekt oben schreibt den Store. 62-02: the
  // basement now holds cellar AND garage zones, so "level === -1" is no longer
  // selective — cellar zones carry `keller`, garage zones carry `tg`.
  const kellerAnwenden = () => setCfg({ keller: { ...cfg.keller, aktiv: true, mengen: kellerErgebnis.mengen } });
  const kellerEntfernen = () => {
    store.set({ zones: zones.filter((z) => !(istWerkstattZone(z) && z.level === -1 && z.keller)) });
    setCfg({ keller: { ...cfg.keller, aktiv: false } });
  };
  const setKellerOptionen = (patch) => setCfg({
    keller: { ...cfg.keller, optionen: kellerOptionen({ ...cfg.keller.optionen, ...patch }) },
  });
  // 62-02: Tiefgarage anwenden/entfernen — same isolation, keyed on `tg`.
  const tgAnwenden = () => setCfg({ tiefgarage: { ...cfg.tiefgarage, aktiv: true, mengen: tgErgebnis.mengen } });
  const tgEntfernen = () => {
    store.set({ zones: zones.filter((z) => !(istWerkstattZone(z) && z.level === -1 && z.tg)) });
    setCfg({ tiefgarage: { ...cfg.tiefgarage, aktiv: false } });
  };
  const setTgOptionen = (patch) => setCfg({
    tiefgarage: { ...cfg.tiefgarage, optionen: tiefgarageOptionen({ ...cfg.tiefgarage.optionen, ...patch }) },
  });

  // --- Typen-Katalog (beide Preset-Gruppen + eigene Typen) --------------------
  const katalog = useMemo(() => [
    {
      gruppe: "Referenzmix Laubengang (2023)",
      typen: WERKSTATT_TYPEN.filter((t) => t.gruppe === "referenz")
        .map((t) => ({ id: t.key, name: t.name, zimmer: t.zimmer, min_m2: t.min_m2, max_m2: t.max_m2, nutzung: t.nutzung })),
    },
    {
      gruppe: "1–5 Zimmer (Richtwerte dt. Baurecht)",
      typen: WERKSTATT_TYPEN.filter((t) => t.gruppe === "standard")
        .map((t) => ({ id: t.key, name: t.name, zimmer: t.zimmer, min_m2: t.min_m2, max_m2: t.max_m2, nutzung: t.nutzung })),
    },
    {
      gruppe: "Eigene Typen",
      typen: (cfg.eigeneTypen || []).map((t, i) => ({
        id: `eigen:${i}`, name: t.name, zimmer: t.zimmer, min_m2: t.min_m2, max_m2: t.max_m2, nutzung: t.nutzung,
      })),
    },
  ], [cfg.eigeneTypen]);

  const typHinzufuegen = (id) => {
    const quelle = id.startsWith("eigen:")
      ? cfg.eigeneTypen[Number(id.slice(6))]
      : WERKSTATT_TYPEN.find((t) => t.key === id);
    if (!quelle) return;
    setCfg({ einheiten: [...cfg.einheiten, { ...quelle }], angewendet: cfg.angewendet });
    setSelIdx(cfg.einheiten.length);
  };

  // --- Typen-Editor (ausgewählte Einheit) --------------------------------------
  const sel = cfg.einheiten[Math.min(selIdx, cfg.einheiten.length - 1)];
  const setSel = (patch) => {
    const einheiten = cfg.einheiten.map((e, i) => (i === Math.min(selIdx, cfg.einheiten.length - 1) ? { ...e, ...patch } : e));
    setCfg({ einheiten });
  };
  const validierung = useMemo(() => (sel ? validiereTyp(sel) : null), [sel]);

  const alsEigenenTypSpeichern = () => {
    if (!sel) return;
    setCfg({ eigeneTypen: [...(cfg.eigeneTypen || []), { ...sel, key: `eigen-${Date.now()}` }] });
  };

  // --- Fenster für die Belichtungs-Checks (platziert + auto) -------------------
  // 75-11 Task 3 (MSB-13): with cfg.regeln.fensterJeRaum the windows come from
  // the rooms' OWN facade segments (fensterJeRaum); default off = the old
  // autoEnvOpenings path, byte-identical to before. The zones MUST come from
  // ergebnis.zonen, NOT plan.zones: usePlanModel reduces the zones to
  // points/level/name/we/raumart and drops fensterpflicht (usePlanModel.js:60-65)
  // — that is why the wiring lives here and not in usePlanModel.
  const fensterJeRaumAktiv = cfg.regeln?.fensterJeRaum === true;
  const fensterListe = useMemo(() => {
    const walls = plan.model?.walls || [];
    const platziert = (plan.envOpenings || []).map((o) => {
      const ty = openingTypeById(o.kind, o.typeId);
      return { ...o, width: ty.w, height: ty.h };
    });
    const platziertKurz = platziert.map((o) => ({ level: o.level, edge: o.edge, u: o.u, width: o.width }));
    // 75-13: window cap 1|2 (global + per room) rides on the same cfg object.
    const auto = fensterJeRaumAktiv
      ? fensterJeRaum(ergebnis.zonen, walls, { ...(plan.entranceCfg ? { entrance: plan.entranceCfg } : {}), fensterMax: cfg.regeln?.fensterMax === 2 ? 2 : 1, fensterMaxJeRaum: fensterMaxJeZone }, platziertKurz)
      : autoEnvOpenings(walls, plan.entranceCfg ? { entrance: plan.entranceCfg } : {}, platziertKurz);
    // Rename width/height → breite/hoehe unchanged so belichtungJeWE computes
    // WITHOUT any API change (only the input data gets better).
    return [...platziert, ...auto].map((w) => ({
      level: w.level, edge: w.edge, u: w.u, breite: w.width, hoehe: w.height, raum: w.raum, hinweis: w.hinweis,
    }));
  }, [plan.model, plan.envOpenings, plan.entranceCfg, fensterJeRaumAktiv, ergebnis.zonen, cfg.regeln?.fensterMax, fensterMaxJeZone]);

  // 75-11 Task 3: rooms without a rule window (narrowed or none) — shown in the
  // existing hint box while the rule is ON. Empty when the rule is off.
  const raeumeOhneFenster = useMemo(
    () => (fensterJeRaumAktiv
      ? raeumeOhneRegelfenster(ergebnis.zonen, plan.model?.walls || [], fensterListe.map((f) => ({ ...f, kind: "window", width: f.breite })))
      : []),
    [fensterJeRaumAktiv, ergebnis.zonen, plan.model, fensterListe]
  );
  // 75-11 Task 3: window ticks for the overlay — the NEW windows only (the
  // placed ones are drawn by BimPlan2D from envOpenings already).
  const fensterTicks = useMemo(
    () => (fensterJeRaumAktiv ? fensterListe.filter((f) => f.raum !== undefined) : []),
    [fensterJeRaumAktiv, fensterListe]
  );

  // --- Bewohnbarkeits-Checks je WE (geometrische Belichtung, 61-04) ------------
  const checksJeWe = useMemo(
    () => belichtungJeWE({
      zonen: ergebnis.zonen,
      fenster: fensterListe,
      waende: plan.model?.walls || [],
      northAngle: 0,
      storeyHeight: plan.storeyHeight,
      amErschliessungsweg: true, // Bänder liegen konstruktiv am Erschließungsweg
    }),
    [ergebnis.zonen, fensterListe, plan.model, plan.storeyHeight]
  );

  // angefordert = number of unit TYPES (the list is repeated per band and
  // storey, M-04) — the check reports both types and apartments.
  const tessChecks = useMemo(
    () => tesselierungsChecks({
      weListe: ergebnis.weListe, restNachfrage_m2: ergebnis.restNachfrage_m2, angefordert: cfg.einheiten.length,
    }),
    [ergebnis, cfg.einheiten.length]
  );
  const toteCheck = tessChecks.find((c) => c.key === "zwischenraeume");
  const anzahlCheck = tessChecks.find((c) => c.key === "anzahl");
  const ueberbelegung = ergebnis.restNachfrage_m2 > 0.05;

  // --- WoFlV/MF-G je WE ----------------------------------------------------------
  const woflvJeWe = useMemo(() => {
    const oberstes = maxLevel;
    return ergebnis.weListe.map((w) => {
      const eintrag = cfg.einheiten.find((e) => e.key === w.typKey) || {};
      const nutzung = eintrag.nutzung === "gewerbe" ? "gewerbe" : "wohnen";
      // 75-13: balcony zones are NOT rooms — they enter via `balkone` below.
      const alleZonen = ergebnis.zonen.filter((z) => z.we === w.we && z.level === w.level);
      const raumZonen = alleZonen.filter((z) => z.raumart !== "balkon");
      const balkonZonen = alleZonen.filter((z) => z.raumart === "balkon");
      /** @type {Array<{name: string, flaeche_m2: number, dachschraege?: {unter1m_m2?: number, zwischen1und2m_m2?: number}}>} */
      let raeume = raumZonen.map((z) => ({ name: z.name, flaeche_m2: num(z.flaeche_m2, polygonAreaM(z.points)) }));
      // Gross zone area of the unit = what the Wohnungsplaner used to call
      // "Wohnfläche" (the former flat assumption, shown next to WoFlV).
      const brutto_m2 = raeume.reduce((s, r) => s + r.flaeche_m2, 0);
      // Dachschrägen (CITED WoFlV §4 Abs. 2) — v1 [ASSUMED]: the partial areas
      // are entered per TYPE and apply to the unit as a whole in the top storey
      // only. They are booked once against the unit's total, not repeated per
      // room (woflvFlaeche clamps them to the room area — per room they would
      // have been deducted several times).
      const ds = eintrag.dachschraege;
      if (nutzung === "wohnen" && w.level === oberstes && ds
        && (num(ds.unter1m_m2) > 0 || num(ds.zwischen1und2m_m2) > 0)) {
        raeume = [{ name: w.we, flaeche_m2: brutto_m2, dachschraege: ds }];
      }
      if (nutzung === "gewerbe") {
        // any: the two branches return different WoFlV/MF-G shapes, readers use `|| 0`.
        return /** @type {any} */ ({ we: w.we, nutzung, brutto_m2, ...mfgFlaeche({ raeume }) });
      }
      // Balkon: 75-13 — GEOMETRY first: balcony zones of this unit (polygon area ×
      // anrechnung); without any balcony zone the old flat value stays as fallback
      // (type default of the reference presets or the per-type editor entry; 0 m² =
      // "kein Balkon").
      const balkonCfg = cfg.balkonJeTyp?.[w.typKey] || {};
      const anrechnung = balkonCfg.anrechnung ?? BALKON.anrechnung;
      let balkone;
      if (balkonZonen.length) {
        balkone = balkonZonen.map((z) => ({ m2: num(z.flaeche_m2, polygonAreaM(z.points)), anrechnung }));
      } else {
        const balkonM2 = num(balkonCfg.m2, (eintrag.balkon?.anzahl || 0) > 0 ? num(eintrag.balkon?.m2, 8) : 0);
        balkone = balkonM2 > 0 ? [{ m2: balkonM2, anrechnung }] : [];
      }
      return /** @type {any} */ ({ we: w.we, nutzung, brutto_m2, balkon_m2: balkone.reduce((s, b) => s + b.m2, 0), balkonGeometrie: balkonZonen.length > 0, ...woflvFlaeche({ raeume, balkone }) });
    });
  }, [ergebnis, cfg.einheiten, cfg.balkonJeTyp, maxLevel]);
  const wohnflaecheGesamt = woflvJeWe.reduce((s, w) => s + (w.wohnflaeche_m2 || 0), 0);
  const mfgGesamt = woflvJeWe.reduce((s, w) => s + (w.mfg_m2 || 0), 0);
  const bruttoGesamt = woflvJeWe.reduce((s, w) => s + (w.brutto_m2 || 0), 0);

  // 75-09 Task 6: occupant count of the focused unit for the auto-furnishing
  // inventory — read from the SAME type entry the workshop table uses
  // (weListe[].typKey → cfg.einheiten), so the focus never re-derives a type.
  // personenFuerTyp reads "/nP" from the name, else zimmer, else 2 (pure lib).
  const personenFokusWe = useMemo(() => {
    if (!fokusWe) return 2;
    const weEintrag = ergebnis.weListe.find((w) => w.we === fokusWe);
    const typ = cfg.einheiten.find((e) => e.key === weEintrag?.typKey) || null;
    return personenFuerTyp(typ);
  }, [fokusWe, ergebnis.weListe, cfg.einheiten]);

  // Editor writes per type key (balkonJeTyp, Plan 61-05 schema).
  const setBalkon = (key, patch) => setCfg({
    balkonJeTyp: { ...(cfg.balkonJeTyp || {}), [key]: { ...(cfg.balkonJeTyp?.[key] || {}), ...patch } },
  });
  // 75-13: per-room switches, keyed "<typKey>|<raum>" in regeln.balkon / regeln.fensterMaxJeRaum
  // (one layer write path — the focus toggles call the same setters).
  const balkonKey = (typKey, raum) => `${typKey}|${raum}`;
  const setBalkonRaum = (typKey, raum, an) => {
    const m = { ...(cfg.regeln?.balkon || {}) };
    if (an) m[balkonKey(typKey, raum)] = true; else delete m[balkonKey(typKey, raum)];
    setRegel("balkon", m);
  };
  const setFensterMaxRaum = (typKey, raum, wert) => {
    const m = { ...(cfg.regeln?.fensterMaxJeRaum || {}) };
    if (wert === 1 || wert === 2) m[balkonKey(typKey, raum)] = wert; else delete m[balkonKey(typKey, raum)];
    setRegel("fensterMaxJeRaum", m);
  };

  // --- 61-07: manual arrangement by drag --------------------------------------------
  // A WE dragged onto another WE of the same band swaps the two in that band's
  // order; a boundary dragged along its band becomes a lock at the wanted
  // position (the solver clamps it to the neighbours' Knautschzone). Taps keep
  // the old behaviour (focus view / lock toggle). The overlay hands us
  // `toMeters(e)` from BimPlan2D, so no pixel arithmetic lives here.
  const bandKeyOf = (w) => `L${w.level}-B${w.band}`;
  // Extent of a unit along its band axis, from the zones that carry its `we`
  // (room slicing makes every room a zone). weListe's _a/_b are internal solver
  // fields and are not guaranteed in the raumzonen result — measure the geometry.
  const weExtent = (we, level, achse) => {
    let lo = Infinity, hi = -Infinity;
    for (const z of ergebnis.zonen) {
      if (z.we !== we || (z.level ?? 0) !== level || !Array.isArray(z.points)) continue;
      for (const p of z.points) { const u = achse === "x" ? p.x : p.z; if (u < lo) lo = u; if (u > hi) hi = u; }
    }
    return lo <= hi ? { lo, hi } : null;
  };
  const achseOf = (level, band) => ergebnis.grenzen.find((g) => g.level === level && g.band === band)?.achse || "x";
  const bandOrderOf = (w) => {
    const achse = achseOf(w.level, w.band);
    return ergebnis.weListe
      .filter((x) => x.level === w.level && x.band === w.band)
      .map((x) => ({ x, e: weExtent(x.we, x.level, achse) }))
      .sort((a, b) => (a.e?.lo ?? 0) - (b.e?.lo ?? 0))
      .map((o) => o.x.typKey);
  };
  const weTauschen = (weVon, weNach) => {
    const a = ergebnis.weListe.find((x) => x.we === weVon);
    const b = ergebnis.weListe.find((x) => x.we === weNach);
    if (!a || !b || a.we === b.we || a.level !== b.level || a.band !== b.band) return false;
    const order = bandOrderOf(a);
    const ia = order.indexOf(a.typKey), ib = order.indexOf(b.typKey);
    if (ia < 0 || ib < 0) return false;
    [order[ia], order[ib]] = [order[ib], order[ia]];
    setCfg({ anordnung: { ...(cfg.anordnung || {}), [bandKeyOf(a)]: order } });
    return true;
  };
  const weUnterPunkt = (level, band, p) => {
    const achse = achseOf(level, band);
    const u = achse === "x" ? p.x : p.z;
    return ergebnis.weListe.find((x) => {
      if (x.level !== level || x.band !== band) return false;
      const e = weExtent(x.we, level, achse);
      return !!e && u >= e.lo - 1e-6 && u <= e.hi + 1e-6;
    });
  };
  const grenzeSetzen = (g, p) => {
    const pos = g.achse === "x" ? p.x : p.z;
    if (!Number.isFinite(pos)) return;
    setCfg({ grenzenPositionen: { ...(cfg.grenzenPositionen || {}), [g.id]: Math.round(pos * 100) / 100 } });
  };
  const grenzeFreigeben = (id) => {
    const rest = { ...(cfg.grenzenPositionen || {}) };
    delete rest[id];
    setCfg({ grenzenPositionen: rest });
  };
  const anordnungZuruecksetzen = () => setCfg({ anordnung: {}, grenzenPositionen: {} });
  const hatManuell = Object.keys(cfg.anordnung || {}).length > 0 || Object.keys(cfg.grenzenPositionen || {}).length > 0;
  const toMetersRef = useRef(null); // the overlay's converter, set on every render
  const { startDrag } = useSvgDrag({
    onDragEnd: (d, e, { cancelled }) => {
      if (cancelled || !toMetersRef.current) return;
      const p = toMetersRef.current(e);
      if (!p) return;
      if (d.kind === "we") {
        const src = ergebnis.weListe.find((x) => x.we === d.we);
        const ziel = src ? weUnterPunkt(src.level, src.band, p) : null;
        if (ziel && ziel.we !== d.we) weTauschen(d.we, ziel.we);
      } else if (d.kind === "grenze") {
        grenzeSetzen(d.grenze, p);
      }
    },
    onTap: (d) => {
      if (d.kind === "we") fokusOeffnen(d.we);
      else if (d.kind === "grenze") {
        if (d.grenze.verschoben) grenzeFreigeben(d.grenze.id);
        else toggleSperre(d.grenze.id);
      }
    },
  });

  // --- Knautschzonen-Sperre umschalten ------------------------------------------
  const toggleSperre = (id) => {
    const hat = (cfg.gesperrteGrenzen || []).includes(id);
    setCfg({
      gesperrteGrenzen: hat
        ? (cfg.gesperrteGrenzen || []).filter((x) => x !== id)
        : [...(cfg.gesperrteGrenzen || []), id],
    });
  };

  const grenzenImLevel = ergebnis.grenzen.filter((g) => g.level === lvl);

  // --- Fokusansicht ---------------------------------------------------------------
  const fokusOeffnen = (we) => {
    fokusNonce.current += 1;
    setFokusWe(we);
  };
  const fokusSchliessen = () => setFokusWe(null);
  // 75-05 (MS-05): Deep-Link ?we=<key> aus dem Massing-Studio (Doppelklick auf ein WE-Label) öffnet
  // den Fokus dieser WE. Der Parameter wird danach in EINEM setSearchParams entfernt (Stolperstein
  // 20.09.: zwei Aufrufe im selben Render überschreiben sich). Unbekannte WE → Klartext, kein Fallback.
  const [searchParams, setSearchParams] = useSearchParams();
  const weParam = searchParams.get("we");
  const [weHinweis, setWeHinweis] = useState(null);
  useEffect(() => {
    if (!weParam) return;
    const zonenListe = ergebnis?.zonen || [];
    if (!zonenListe.length) return; // layer/plan still loading — keep the parameter and wait
    const bekannt = zonenListe.some((z) => String(z?.we ?? "") === weParam);
    if (bekannt) fokusOeffnen(weParam);
    else setWeHinweis(weParam);
    const next = new URLSearchParams(searchParams);
    next.delete("we");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weParam, ergebnis?.zonen]);
  // Sprungbrett "Checks dieser WE": back to the storey plan, that unit's
  // check card expanded and scrolled into view.
  const zuChecks = (we) => {
    const i = checksJeWe.findIndex((c) => c.we === we);
    setFokusWe(null);
    setOffenIdx(i >= 0 ? i : null);
    setTimeout(() => checkCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };
  const gotoInnenausbau = () => {
    // Sprungbrett: CustomEvent statt Prop-Drilling — ComplexDesigner abonniert
    // „werkstatt:goto-innenausbau" und wechselt den Tab (einfachste im Code
    // verfügbare Variante, begründet im Plan 61-05 Task 3).
    window.dispatchEvent(new CustomEvent("werkstatt:goto-innenausbau"));
  };

  return (
    <div className="space-y-4">
      {/* Ehrlichkeits-Banner — NICHT konditional (Ehrlichkeits-Konvention). */}
      <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
        <span>
          {t("Regel-Grundriss — Konzept, kein geprüfter Bauantrag")}
          {t(". Richtwerte teils [ASSUMED].")}
        </span>
      </div>

      {/* 75-16: control column fixed (20/22 rem ≈ the old ¼ at 1280 px), the
          plan column takes the rest — it used to stop at ¾ of a 1280 px page. */}
      <div className="grid grid-cols-1 xl:grid-cols-[20rem_minmax(0,1fr)] 2xl:grid-cols-[22rem_minmax(0,1fr)] gap-4">
        {/* Linke Spalte: Katalog + Steuerung + Typen-Editor */}
        <div className="space-y-4 min-w-0">
          <KatalogPanel
            titel={t("Typen-Katalog")}
            katalog={katalog}
            onAdd={typHinzufuegen}
            chipTitle={(t2) => `${t2.name} · ${t2.zimmer || 0} Zi · ${de1(t2.min_m2)}–${de1(t2.max_m2)} m²${t2.nutzung === "gewerbe" ? " · Gewerbe" : ""}`}
          />

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Puzzle className="w-4 h-4" /> {t("Werkstatt")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <div className="text-xs text-slate-500">{t("Erschließung")}</div>
                <Select value={cfg.typ} onValueChange={(v) => setCfg({ typ: v })}>
                  <SelectTrigger data-testid="wt-typologie"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(ERSCHLIESSUNG).map(([key, e]) => (
                      <SelectItem key={key} value={key}>{e.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {/* 75-07: Empfehlung aus der Tiefe — Chip, kein Zwang. [ASSUMED] Blatt 06 */}
                <div
                  className={`mt-1 rounded border px-2 py-1 text-[11px] ${empfehlung.typen.includes(cfg.typ) ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}
                  data-testid="wt-empfehlung" data-stufe={empfehlung.stufe} title={t("Richtwert aus der Gebäudetiefe, kein Norm-Anspruch")}
                >
                  {t("Empfehlung")}: {empfehlung.text}
                  {!empfehlung.typen.includes(cfg.typ) && (
                    <span> · {t("passend")}: {empfehlung.typen.map((k) => ERSCHLIESSUNG[k]?.label || k).join(" / ")}</span>
                  )}
                </div>
              </div>

              {/* 75-07: Architekturregeln — jede optional, Default aus (Phase 61 unverändert). */}
              <div className="space-y-1" data-testid="wt-regeln">
                <div className="text-xs text-slate-500">{t("Architekturregeln")} <span className="text-slate-400">[ASSUMED]</span></div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  {[
                    ["mindestbreiten", t("Mindestbreiten je Raumart")],
                    ["himmelsrichtung", t("Himmelsrichtung je WE")],
                    ["phi", t("φ-Proportion (Ziel + Hinweis)")],
                    ["wandstaerken", t("Wandstärken zeigen")],
                    ["rettungsweg", t("Rettungsweg ≤ 35 m (MBO §35)")],
                    // 75-11 (MSB-13): windows per room instead of every 3.5 m.
                    ["fensterJeRaum", t("Fenster je Raum (statt je 3,5 m)")],
                    // 75-14: hall + doors + access graph, ≥ 10 m², ≤ 1 : 1,8, wardrobe wall 3 m.
                    ["wohnungsgrundriss", t("Wohnungsgrundriss: Diele, Türen, ≥ 10 m², ≤ 1 : 1,8, Schrankwand 3 m")],
                    // 75-13: necessary stair enclosure (+ lift switch, + extension) for MFH/Spänner.
                    ["treppenraum", t("Notwendiger Treppenraum + Aufzug (MBO §35/§39)")],
                  ].map(([k, label]) => (
                    // min-w-0 + wrapping span: the long 75-13/75-14 labels no longer run into the neighbour column.
                    <label key={k} className="flex min-w-0 items-start gap-1.5">
                      <input type="checkbox" className="mt-0.5 shrink-0" checked={!!cfg.regeln?.[k]} onChange={(e) => setRegel(k, e.target.checked)} data-testid={`wt-regel-${k}`} />
                      <span className="min-w-0 break-words">{label}</span>
                    </label>
                  ))}
                </div>
                {/* 75-13 Task 2: global window cap — only meaningful with the per-room window rule. */}
                {cfg.regeln?.fensterJeRaum && (
                  <label className="flex items-center gap-2 text-xs" title={t("Deckel je Raum: 1 Fenster mittig auf der längsten Fassade (Eckraum 2, eins je Fassade); Belichtung 1/8 verbreitert zuerst bis 2,4 m, erst dann ein zweites Fenster")}>
                    {t("Fenster je Raum")}
                    <select className="h-7 rounded-md border border-slate-200 px-1 text-xs" value={cfg.regeln?.fensterMax === 2 ? "2" : "1"}
                      onChange={(e) => setRegel("fensterMax", Number(e.target.value))} data-testid="wt-fenster-max">
                      <option value="1">1 ({t("Eckraum 2")})</option>
                      <option value="2">2</option>
                    </select>
                  </label>
                )}
                {/* 75-13 Task 4: lift switch (default = duty) + stair-enclosure extension slider. */}
                {cfg.regeln?.treppenraum && (
                  <div className="space-y-1 rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs" data-testid="wt-treppenraum">
                    <label className="flex items-center gap-1.5">
                      <input type="checkbox" checked={kernInfo.aufzug} onChange={(e) => setRegel("aufzug", e.target.checked)} data-testid="wt-regel-aufzug" />
                      {t("Aufzug")} ({kernInfo.aufzug ? `${t("Kern")} ${de1(TREPPENRAUM.mitAufzug.gesamt)} × ${de1(TREPPENRAUM.mitAufzug.tiefe)} m` : `${t("Treppenraum")} ${de1(TREPPENRAUM.treppe.w)} × ${de1(TREPPENRAUM.treppe.d)} m`})
                      {cfg.regeln?.aufzug === undefined && <span className="text-slate-400">— {t("Vorgabe")}: {kernInfo.aufzugPflicht ? t("Pflicht") : t("keine Pflicht")}</span>}
                    </label>
                    <div className="text-[10px] text-slate-500" data-testid="wt-aufzug-hinweis">
                      {t("Büro-Vorgabe: Aufzug ab mehr als")} {AUFZUG_SCHWELLEN.geschosse} {t("Geschossen")} · MBO §39 Abs. 4 (OKF &gt; {AUFZUG_SCHWELLEN.okf_m} m) [CITED] / BayBO Art. 37 Abs. 4 ({t("Gebäudehöhe")} &gt; {AUFZUG_SCHWELLEN.okf_m} m, 06.10.2026 geprüft)
                    </div>
                    <label className="flex items-center gap-2" title={t("Treppenraum wächst entlang des Flurs; Grenze = Brandwand mit T30-RS-Tür, Messung endet dort (MBO §35 Abs. 4–6)")}>
                      {t("Treppenraum-Erweiterung")}
                      <input type="range" min={0} max={TREPPENRAUM.erweiterungMax_m} step={0.5} value={kernInfo.erweiterung_m}
                        onChange={(e) => setRegel("treppenraumErweiterung_m", Number(e.target.value))} className="w-28 accent-red-700" data-testid="wt-treppenraum-erweiterung"
                        // 75-16: explicit name + spoken value — the browser pane read the slider without a name (Sichtprüfung 07.10.).
                        aria-label={t("Treppenraum-Erweiterung je Seite (m)")}
                        aria-valuetext={`${kernInfo.erweiterung_m.toLocaleString("de-DE", { minimumFractionDigits: 1 })} m ${t("je Seite")}`} />
                      <span className="tabular-nums" data-testid="wt-treppenraum-erweiterung-wert">{kernInfo.erweiterung_m.toLocaleString("de-DE", { minimumFractionDigits: 1 })} m {t("je Seite")}</span>
                    </label>
                  </div>
                )}
                {cfg.regeln?.himmelsrichtung && (
                  <label className="flex items-center gap-2 text-xs">
                    {t("Nordwinkel")} (°)
                    {/* natives input statt <Input>: jede shadcn-Instanz zählt in der tsc-Altlast (CLAUDE.md Typecheck-Hinweis) */}
                    <input type="number" step="1" className="h-7 w-20 rounded-md border border-slate-200 px-2 text-xs" value={cfg.nordwinkel}
                      onChange={(e) => setCfg({ nordwinkel: Number(e.target.value) || 0 })} data-testid="wt-nordwinkel" />
                  </label>
                )}
              </div>

              <div className="space-y-1">
                <div className="text-xs text-slate-500">{t("Geschoss")}</div>
                <Select value={String(lvl)} onValueChange={(v) => setLevel(Number(v))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: maxLevel + 1 }, (_, i) => (
                      <SelectItem key={i} value={String(i)}>{i === 0 ? t("EG") : `${i}. ${t("OG")}`}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={anwenden} disabled={cfg.angewendet}>{t("Tesselierung anwenden")}</Button>
                <Button size="sm" variant="outline" onClick={entfernen} disabled={!zones.some(istWerkstattZone)}>
                  <Eraser className="w-3.5 h-3.5 mr-1" /> {t("Entfernen")}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Einheiten-Liste (freier Ziel-Mix) */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{t("Einheiten")} ({cfg.einheiten.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {cfg.einheiten.map((e, i) => (
                <button
                  key={`einheit-${i}`}
                  type="button"
                  data-testid={`einheit-${i}`}
                  onClick={() => setSelIdx(i)}
                  className={`w-full text-left rounded border px-2 py-1 text-xs transition-colors ${
                    // explicit text colour: the light tint stays readable in dark mode
                    i === selIdx ? "border-sky-400 bg-sky-50 text-slate-800" : "border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
                  }`}
                >
                  <span className="font-medium">{e.name}</span>
                  <span className="text-slate-500"> · {e.zimmer || 0} {t("Zi")} · {de1(e.flaeche_m2)} m²{e.nutzung === "gewerbe" ? ` · ${t("Gewerbe")}` : ""}</span>
                </button>
              ))}
              {sel && (
                <div className="pt-1">
                  <Button
                    size="sm" variant="ghost"
                    onClick={() => {
                      setCfg({ einheiten: cfg.einheiten.filter((_, i) => i !== selIdx) });
                      setSelIdx(0);
                    }}
                    disabled={cfg.einheiten.length <= 1}
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1" /> {t("Ausgewählte Einheit entfernen")}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Typen-Editor */}
          {sel && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{t("Typ bearbeiten")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1">
                  <div className="text-xs text-slate-500">{t("Name")}</div>
                  <Input value={sel.name || ""} onChange={(e) => setSel({ name: e.target.value.slice(0, 40) })} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <div className="text-xs text-slate-500">{t("Nutzung")}</div>
                    <Select value={sel.nutzung || "wohnen"} onValueChange={(v) => setSel({ nutzung: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="wohnen">{t("Wohnen")}</SelectItem>
                        <SelectItem value="gewerbe">{t("Gewerbe/Büro")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <NumberField label={t("Zimmer")} value={sel.zimmer ?? 0} min={0} onChange={(v) => setSel({ zimmer: v })} />
                </div>
                <div className="grid grid-cols-3 gap-2" data-testid="einheit-flaechen">
                  <NumberField label={t("Fläche")} suffix="m²" value={sel.flaeche_m2} onChange={(v) => setSel({ flaeche_m2: v })} />
                  <NumberField label={t("min")} suffix="m²" value={sel.min_m2} onChange={(v) => setSel({ min_m2: v })} />
                  <NumberField label={t("max")} suffix="m²" value={sel.max_m2} onChange={(v) => setSel({ max_m2: v })} />
                </div>

                {sel.nutzung === "gewerbe" ? (
                  <div className="space-y-2 rounded border border-blue-200 bg-blue-50 p-2 text-xs text-blue-900">
                    <div>{t("Gewerbe-Regel-Set: MF/G-Flächen statt WoFlV [ASSUMED].")}</div>
                    <div className="space-y-1">
                      <div className="text-blue-800">{t("Schallschutz-Raumart")}</div>
                      <Select value={sel.raumartSchall || "buero"} onValueChange={(v) => setSel({ raumartSchall: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="buero">{t("Büro")}</SelectItem>
                          <SelectItem value="laut">{t("laut (Technik/Gewerbe)")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <NumberField label={t("Balkon")} suffix="m²" min={0}
                        value={cfg.balkonJeTyp?.[sel.key]?.m2 ?? ((sel.balkon?.anzahl || 0) > 0 ? (sel.balkon?.m2 ?? 8) : 0)}
                        onChange={(v) => setBalkon(sel.key, { m2: Math.max(0, v) })} />
                      <NumberField label={t("Anrechnung")} suffix="%" min={0}
                        value={Math.round((cfg.balkonJeTyp?.[sel.key]?.anrechnung ?? 0.25) * 100)}
                        onChange={(v) => setBalkon(sel.key, { anrechnung: Math.max(0, Math.min(50, v)) / 100 })} />
                    </div>
                    {/* Dachschrägen je Typ (CITED WoFlV §4 Abs. 2) — v1 [ASSUMED]:
                        gilt für die WE als Ganzes, nur im obersten Geschoss. */}
                    <div className="grid grid-cols-2 gap-2" data-testid="einheit-dachschraege">
                      <NumberField label={t("Dachschräge < 1 m")} suffix="m²" min={0} value={sel.dachschraege?.unter1m_m2 ?? 0}
                        onChange={(v) => setSel({ dachschraege: { ...(sel.dachschraege || {}), unter1m_m2: Math.max(0, v) } })} />
                      <NumberField label={t("Dachschräge 1–2 m")} suffix="m²" min={0} value={sel.dachschraege?.zwischen1und2m_m2 ?? 0}
                        onChange={(v) => setSel({ dachschraege: { ...(sel.dachschraege || {}), zwischen1und2m_m2: Math.max(0, v) } })} />
                    </div>
                    <div className="text-[10px] text-slate-400">
                      {t("Balkon 0 m² = kein Balkon. Dachschrägen-Teilflächen gelten je WE im obersten Geschoss [ASSUMED v1].")}
                    </div>
                  </div>
                )}

                {/* Escher-Varianten */}
                <div className="grid grid-cols-2 gap-2 items-end">
                  <label className="flex items-center gap-2 text-xs text-slate-600">
                    <input type="checkbox" checked={!!sel.verschraenkbar} onChange={(e) => setSel({ verschraenkbar: e.target.checked })} />
                    {t("verschraenkbar (L-Paar)")}
                  </label>
                  <div className="space-y-1">
                    <div className="text-xs text-slate-500">{t("Variante")}</div>
                    <Select value={sel.variante === "gespiegelt" ? "gespiegelt" : "normal"} onValueChange={(v) => setSel({ variante: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="normal">{t("normal")}</SelectItem>
                        <SelectItem value="gespiegelt">{t("gespiegelt")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-slate-500">{t("Verzahnungsraum (max. einer je Typ)")}</div>
                  <Select
                    value={sel.verzahnungsRaum || "—"}
                    onValueChange={(v) => setSel({ verzahnungsRaum: v === "—" ? undefined : v })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="—">{t("— kein Zahn —")}</SelectItem>
                      {(sel.raumprogramm || []).map((r, i) => (
                        <SelectItem key={`${r.raum}-${i}`} value={r.raum}>{r.raum}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Raumprogramm-Zeilen: Raum · Art · min · max · Fensterpflicht · löschen.
                    Row key is the index, not the name — a name-based key remounted
                    the input on every keystroke and lost the focus. */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-slate-500">{t("Raumprogramm")}</div>
                    <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[11px]" data-testid="raum-add"
                      onClick={() => setSel({
                        raumprogramm: [...(sel.raumprogramm || []),
                          { raum: t("Raum"), art: "aufenthalt", min_m2: 10, max_m2: 16, fensterpflicht: true }],
                      })}>
                      <Plus className="w-3 h-3 mr-0.5" /> {t("Raum")}
                    </Button>
                  </div>
                  <div className="grid grid-cols-12 gap-1 px-0.5 text-[10px] text-slate-400">
                    <span className="col-span-3">{t("Raum")}</span>
                    <span className="col-span-3">{t("Art")}</span>
                    <span className="col-span-2">min m²</span>
                    <span className="col-span-2">max m²</span>
                    <span className="col-span-1 text-center" title={t("Fensterpflicht")}>{t("Fe.")}</span>
                    <span className="col-span-1" />
                  </div>
                  {/* 75-13: per-room switches for OUTER rooms only (fensterpflicht = facade
                      row): balcony and window cap 1|2. Inner rooms show nothing. */}
                  {(sel.raumprogramm || []).some((r) => r.fensterpflicht) && (
                    <div className="grid grid-cols-12 gap-1 px-0.5 text-[10px] text-slate-400">
                      <span className="col-span-6">{t("Außenliegende Räume")}</span>
                      <span className="col-span-3" title={t("Balkon 1,5 m tief vor der Raumfassade, 0,5 m Rand [ASSUMED]")}>{t("Balkon")}</span>
                      <span className="col-span-3" title={t("Fenster je Raum (leer = Regel)")}>{t("Fenster")}</span>
                    </div>
                  )}
                  {(sel.raumprogramm || []).filter((r) => r.fensterpflicht).map((r) => (
                    <div key={`raum-aussen-${r.raum}`} className="grid grid-cols-12 items-center gap-1 text-xs" data-testid="raum-aussen" data-raum={r.raum}>
                      <span className="col-span-6 truncate text-slate-600">{r.raum}</span>
                      <label className="col-span-3 flex items-center">
                        <input type="checkbox" checked={cfg.regeln?.balkon?.[balkonKey(sel.key, r.raum)] === true}
                          onChange={(e) => setBalkonRaum(sel.key, r.raum, e.target.checked)} data-testid="raum-balkon" />
                      </label>
                      <select className="col-span-3 h-6 rounded border border-slate-200 text-[11px]" value={String(cfg.regeln?.fensterMaxJeRaum?.[balkonKey(sel.key, r.raum)] ?? "")}
                        onChange={(e) => setFensterMaxRaum(sel.key, r.raum, e.target.value === "" ? null : Number(e.target.value))} data-testid="raum-fenster-max">
                        <option value="">{t("Regel")}</option>
                        <option value="1">1</option>
                        <option value="2">2</option>
                      </select>
                    </div>
                  ))}
                  {(sel.raumprogramm || []).map((r, ri) => {
                    const setRaum = (patch) => setSel({
                      raumprogramm: sel.raumprogramm.map((x, xi) => (xi === ri ? { ...x, ...patch } : x)),
                    });
                    return (
                      <div key={`raum-${ri}`} className="grid grid-cols-12 gap-1 items-center text-xs" data-testid={`raum-${ri}`}>
                        <Input className="col-span-3 h-7 text-xs" value={r.raum}
                          onChange={(e) => setRaum({ raum: e.target.value.slice(0, 40) })} />
                        <select className="col-span-3 h-7 rounded border border-slate-200 text-xs" value={r.art}
                          onChange={(e) => setRaum({ art: e.target.value })}>
                          {RAUM_ARTEN.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                        </select>
                        <Input className="col-span-2 h-7 text-xs" type="number" min={0} value={r.min_m2 ?? ""}
                          onChange={(e) => setRaum({ min_m2: Math.max(0, Number(e.target.value) || 0) })} />
                        <Input className="col-span-2 h-7 text-xs" type="number" min={0} value={r.max_m2 ?? ""}
                          onChange={(e) => setRaum({ max_m2: Math.max(0, Number(e.target.value) || 0) })} />
                        <label className="col-span-1 flex items-center justify-center" title={t("Fensterpflicht")}>
                          <input type="checkbox" checked={!!r.fensterpflicht}
                            onChange={(e) => setRaum({ fensterpflicht: e.target.checked })} />
                        </label>
                        <button type="button" className="col-span-1 text-slate-400 hover:text-red-600 disabled:opacity-30"
                          title={t("Raum entfernen")} data-testid={`raum-del-${ri}`}
                          disabled={(sel.raumprogramm || []).length <= 1}
                          onClick={() => setSel({
                            raumprogramm: sel.raumprogramm.filter((_, xi) => xi !== ri),
                            // a removed room cannot stay the Verzahnungsraum
                            verzahnungsRaum: sel.verzahnungsRaum === r.raum ? undefined : sel.verzahnungsRaum,
                          })}>
                          <Trash2 className="w-3 h-3 mx-auto" />
                        </button>
                      </div>
                    );
                  })}
                </div>

                {/* Validierung live */}
                {validierung && (
                  <div className="flex flex-wrap gap-1">
                    <Badge className={validierung.warns ? WT_STATUS.warn.color : WT_STATUS.pass.color}>
                      {validierung.warns ? `${validierung.warns} ${t("Hinweise")}` : t("vollständig")}
                    </Badge>
                    {validierung.checks.filter((c) => c.status === "warn").map((c) => (
                      <Badge key={c.key} className={WT_STATUS.warn.color} title={c.detail}>{c.label}</Badge>
                    ))}
                  </div>
                )}

                <Button size="sm" variant="outline" onClick={alsEigenenTypSpeichern}>
                  <Plus className="w-3.5 h-3.5 mr-1" /> {t("Als eigenen Typ speichern")}
                </Button>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Rechte Spalte: Sub-Tabs Geschosse | Kellerabteile (61-06) */}
        <div className="min-w-0 space-y-4">
          <Tabs value={ansicht} onValueChange={setAnsicht}>
            <TabsList>
              <TabsTrigger value="geschosse" data-testid="wt-tab-geschosse">{t("Geschosse")}</TabsTrigger>
              <TabsTrigger value="keller" data-testid="wt-tab-keller">
                {t("Kellerabteile")}{cfg.keller.aktiv ? ` (${kellerErgebnis.mengen.abteile_stk})` : ""}
              </TabsTrigger>
              <TabsTrigger value="tiefgarage" data-testid="wt-tab-tiefgarage">
                {t("Tiefgarage")}{cfg.tiefgarage.aktiv ? ` (${tgErgebnis.mengen.stellplaetze_stk})` : ""}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="tiefgarage">
              <TiefgaragenPlaner
                plan={plan}
                ergebnis={tgErgebnis}
                checks={tgChecksListe}
                optionen={cfg.tiefgarage.optionen}
                setOptionen={setTgOptionen}
                aktiv={cfg.tiefgarage.aktiv}
                tesselierungAngewendet={cfg.angewendet}
                kellerAktiv={cfg.keller.aktiv}
                onAnwenden={tgAnwenden}
                onEntfernen={tgEntfernen}
                mengenPersistiert={cfg.tiefgarage.mengen}
              />
            </TabsContent>
            <TabsContent value="keller">
              <KellerabteilPlaner
                plan={plan}
                ergebnis={kellerErgebnis}
                checks={kellerChecksListe}
                optionen={cfg.keller.optionen}
                setOptionen={setKellerOptionen}
                aktiv={cfg.keller.aktiv}
                tesselierungAngewendet={cfg.angewendet}
                onAnwenden={kellerAnwenden}
                onEntfernen={kellerEntfernen}
                mengenPersistiert={cfg.keller.mengen}
              />
            </TabsContent>
            <TabsContent value="geschosse" className="space-y-4">
          {weHinweis && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800" role="status">
              {t("Wohneinheit aus dem Link nicht gefunden")}: {weHinweis} — {t("Tesselierung anwenden oder WE im Plan wählen.")}
            </div>
          )}
          {fokusWe ? (
            <WohnungsFokus
              plan={plan}
              we={fokusWe}
              zonen={ergebnis.zonen}
              checks={checksJeWe.find((c) => c.we === fokusWe)}
              nonce={fokusNonce.current}
              onClose={fokusSchliessen}
              onGotoInnenausbau={gotoInnenausbau}
              onGotoChecks={() => zuChecks(fokusWe)}
              /* 75-09 Task 6: furniture wiring (all optional — without
                 onMoeblierungChange the focus only DISPLAYS furniture) +
                 the KPI inputs from the SAME computation paths as the
                 workshop table (woflvJeWe / checksJeWe) — no second calc. */
              moeblierung={moeblierung}
              moebelEigene={moebelEigene}
              onMoeblierungChange={onMoeblierungChange}
              speicherbar={speicherbar}
              woflv={woflvJeWe.find((w) => w.we === fokusWe) || null}
              personen={personenFokusWe}
              fensterNaeherung={!fensterJeRaumAktiv}
              /* 75-14: door swings (layer field, ONE write path) + this unit's quality record. */
              tuerAufschlaege={cfg.tuerAufschlaege}
              onTuerAufschlaegeChange={wohnungsgrundrissAktiv ? (m) => setCfg({ tuerAufschlaege: m }) : undefined}
              qualitaet={qualitaetJeWe.find((q) => q.we === fokusWe) || null}
              /* 75-13: balcony toggle at the room (type|room key — same setter as the editor row). */
              balkonAktiv={(zone) => cfg.regeln?.balkon?.[balkonKey(typKeyJeWe.get(zone?.we), raumBasis(zone?.name))] === true}
              onBalkonToggle={(zone, an) => setBalkonRaum(typKeyJeWe.get(zone?.we), raumBasis(zone?.name), an)}
            />
          ) : (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  {t("Grundriss")} ({lvl === 0 ? t("EG") : `${lvl}. ${t("OG")}`}) — {t("Klick auf eine WE öffnet die Fokusansicht")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <BimPlan2D
                  model={plan.model}
                  mode="grundriss"
                  level={lvl}
                  storeyHeight={plan.storeyHeight}
                  readOnly
                  /* 75-13: balcony zones are drawn by the overlay (outline + hatch), not as rooms.
                     75-17: the lift shaft keeps its fill but gets the overlay's plan symbol
                     + label instead of a collision-checked room label (it lost every
                     collision against the bigger stair enclosure next to it). */
                  customZones={plan.zones.filter((z) => z.raumart !== "balkon").map((z) => (z.raumart === "aufzug" ? { ...z, ohneLabel: true } : z))}
                  envOpenings={plan.envOpenings}
                  unit={plan.unit}
                  height={planHoehe}
                  fuellen
                  overlay={({ X, Z, SCALE, level: overlayLevel, toMeters, px: pxOv }) => {
                    toMetersRef.current = toMeters;
                    const beschriftungen = zones.filter((z) => z.we && (z.level ?? 0) === overlayLevel);
                    const grenzen = grenzenImLevel.filter((g) => g.level === overlayLevel);
                    // 75-07: Wandstärken als Darstellung (D-P75-06) — Strichstärke in
                    // Metern über den Plan-Maßstab, Zonen bleiben lichte Maße.
                    const pxJeM = Math.abs(X(1) - X(0)) || 1;
                    const waende = (ergebnis.waende || []).filter((w) => w.level === overlayLevel);
                    // 75-11 Task 3 (MSB-13): window ticks in the wall — a short
                    // segment perpendicular to the wall axis at position u,
                    // length = window width. World point from the wall
                    // (a + (b−a)·u/len), light colour = opening. Playwright
                    // trap: axis-parallel lines count as hidden → specs count().
                    const walls = plan.model?.walls || [];
                    const ticks = (fensterTicks || []).filter((f) => (f.level ?? 0) === overlayLevel);
                    // 75-13: balcony zones (outline + hatch) and fire walls of the stair extension.
                    const balkone = ergebnis.zonen.filter((z) => z.raumart === "balkon" && z.level === overlayLevel);
                    const brandwaende = ergebnis.zonen
                      .filter((z) => z.level === overlayLevel && Array.isArray(z.brandwaende) && z.brandwaende.length)
                      .flatMap((z) => z.brandwaende.map((bi) => ({ a: z.points[bi], b: z.points[(bi + 1) % z.points.length] })))
                      .filter((s) => s.a && s.b);
                    // 75-17: lift shafts with the usual plan symbol (diagonal cross) and a label.
                    const aufzuege = ergebnis.zonen.filter((z) => z.raumart === "aufzug" && z.level === overlayLevel && Array.isArray(z.points) && z.points.length >= 3);
                    const bildPx = (n) => (pxOv ? pxOv(n) : n); // screen px → viewBox units
                    return (
                      <g>
                        <defs>
                          <pattern id="wt-balkon-schraffur" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                            <line x1="0" y1="0" x2="0" y2="6" stroke="#0369a1" strokeWidth="0.6" />
                          </pattern>
                        </defs>
                        {balkone.map((z, i) => (
                          <polygon key={`bk-${i}`} points={z.points.map((p) => `${X(p.x)},${Z(p.z)}`).join(" ")}
                            fill="url(#wt-balkon-schraffur)" stroke="#0369a1" strokeWidth="0.7" pointerEvents="none"
                            data-testid="wt-balkon" data-we={z.we} data-raum={z.raum} data-m2={Math.round((z.flaeche_m2 || 0) * 100) / 100} />
                        ))}
                        {brandwaende.map((s, i) => (
                          <line key={`bw-${i}`} x1={X(s.a.x)} y1={Z(s.a.z)} x2={X(s.b.x)} y2={Z(s.b.z)}
                            stroke="#b91c1c" strokeWidth={Math.max(2, 0.24 * pxJeM)} strokeLinecap="square" pointerEvents="none" data-testid="wt-brandwand" />
                        ))}
                        {aufzuege.map((z, i) => {
                          const xs = z.points.map((p) => p.x), zs = z.points.map((p) => p.z);
                          const x0 = X(Math.min(...xs)), x1 = X(Math.max(...xs)), y0 = Z(Math.min(...zs)), y1 = Z(Math.max(...zs));
                          const fs = bildPx(10);
                          // Rotate the label when the shaft is narrower on screen than the word (~0,6 · font · 6 chars).
                          const hoch = Math.abs(x1 - x0) < fs * 0.6 * 6 + bildPx(4) && Math.abs(y1 - y0) > Math.abs(x1 - x0);
                          const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
                          return (
                            <g key={`az-${i}`} pointerEvents="none" data-testid="wt-aufzug" data-name={z.name}>
                              <line x1={x0} y1={y0} x2={x1} y2={y1} stroke="#475569" strokeWidth={bildPx(0.8)} />
                              <line x1={x0} y1={y1} x2={x1} y2={y0} stroke="#475569" strokeWidth={bildPx(0.8)} />
                              <text x={cx} y={cy} dy={fs * 0.35} fontSize={fs} fontWeight="600" textAnchor="middle" fill="#1e293b"
                                stroke="#f8fafc" strokeWidth={bildPx(3)} paintOrder="stroke" transform={hoch ? `rotate(-90 ${cx} ${cy})` : undefined}>
                                {t("Aufzug")}
                              </text>
                            </g>
                          );
                        })}
                        {waende.map((w, i) => (
                          <line key={`wd-${i}`} x1={X(w.a.x)} y1={Z(w.a.z)} x2={X(w.b.x)} y2={Z(w.b.z)}
                            stroke={w.klasse === "leicht" ? "#64748b" : "#1e293b"} strokeWidth={Math.max(0.6, w.staerke * pxJeM)}
                            strokeLinecap="square" pointerEvents="none" data-testid="wt-wand" data-klasse={w.klasse} />
                        ))}
                        {ticks.map((f, i) => {
                          const w = walls.find((x) => x.level === (f.level ?? 0) && x.edge === f.edge);
                          if (!w) return null;
                          const len = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z) || 1;
                          const dx = (w.b.x - w.a.x) / len, dz = (w.b.z - w.a.z) / len;
                          // Centre of the window ON the wall axis (a + dir·u) and
                          // the tick PERPENDICULAR to the axis (normal (−dz, dx)),
                          // length = window width — readable as an opening in the wall.
                          const mitte = { x: w.a.x + dx * f.u, z: w.a.z + dz * f.u };
                          const halb = Math.max(0.2, (f.breite || 0.6) / 2);
                          return (
                            <line key={`wf-${i}`}
                              x1={X(mitte.x + dz * halb)} y1={Z(mitte.z - dx * halb)}
                              x2={X(mitte.x - dz * halb)} y2={Z(mitte.z + dx * halb)}
                              stroke="#38bdf8" strokeWidth={Math.max(1.2, 0.15 * pxJeM)}
                              strokeLinecap="round" pointerEvents="none"
                              data-testid="wt-fenster" data-raum={f.raum} data-breite={f.breite} />
                          );
                        })}
                        {/* 75-14: door openings of the room zones (opening only at
                            1:200 — leaf and arc belong to the 1:50 focus). */}
                        <ZonenTueren zonen={ergebnis.zonen.filter((z) => z.level === overlayLevel)} X={X} Z={Z} SCALE={SCALE} nurOeffnung prefix="wt" />
                        {/* WE-Zonen: Tipp = Fokusansicht, Drag auf eine Nachbar-WE
                            desselben Bands = Reihenfolge tauschen (61-07). Labels
                            rendert BimPlan2D selbst (Zonen sind in customZones). */}
                        {beschriftungen.map((z, i) => {
                          if (!z.points || z.points.length < 3) return null;
                          const d = z.points.map((p, k) => `${k ? "L" : "M"}${X(p.x)},${Z(p.z)}`).join(" ") + " Z";
                          const w = ergebnis.weListe.find((x) => x.we === z.we);
                          return (
                            <path
                              key={`wt-${i}`} d={d} fill="transparent"
                              stroke="#0f766e" strokeWidth="0.8" strokeDasharray="3 2"
                              style={{ cursor: cfg.angewendet ? "grab" : "pointer" }}
                              data-testid="wt-we" data-we={z.we} data-typ={w?.typKey || ""} data-band={w ? bandKeyOf(w) : ""}
                              onPointerDown={(e) => {
                                // Middle button belongs to BimPlan2D's pan; left button is ours —
                                // stop it here or the plan pans instead of the unit moving.
                                if (e.button !== 0) return;
                                e.stopPropagation();
                                startDrag(e, { kind: "we", we: z.we });
                              }}
                            />
                          );
                        })}
                        {/* Knautschzonen: ± je Grenze, Klick = sperren/freigeben.
                            N-01: min_m/max_m of a grenze are the neighbours' width
                            limits, NOT a travel corridor of the boundary — only
                            delta_m (deviation from the target position) is drawn. */}
                        {cfg.angewendet && grenzen.map((g) => {
                          // Grenze steht senkrecht zur Band-Laufrichtung und
                          // spannt quer über die Bandtiefe (achse/quer0/quer1
                          // aus tesseliere, serialisierbar).
                          const deltaCm = Math.round((g.delta_m || 0) * 100);
                          // 61-07: a dragged boundary shows where it was pinned by hand.
                          const label = g.verschoben ? `📌 ${t("verschoben")}` : `${g.gesperrt ? "🔒 " : "±"}${deltaCm} cm`;
                          const verzahnt = !!(g.verzahnung && !g.verzahnung.warn);
                          const p = g.pos_m;
                          const x1 = g.achse === "z" ? X(g.quer0) : X(p);
                          const y1 = g.achse === "z" ? Z(p) : Z(g.quer0);
                          const x2 = g.achse === "z" ? X(g.quer1) : X(p);
                          const y2 = g.achse === "z" ? Z(p) : Z(g.quer1);
                          const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
                          // gesperrt rot · verzahnt violett (gestufte Trennwand,
                          // der Zahn selbst ist die Raum-Zone) · flexibel amber
                          const farbe = g.gesperrt ? "#dc2626" : verzahnt ? "#7c3aed" : "#f59e0b";
                          return (
                            <g key={`gr-${g.id}`} data-testid="wt-grenze" data-gesperrt={g.gesperrt ? "1" : "0"}
                              data-verschoben={g.verschoben ? "1" : "0"} data-pos={Math.round(g.pos_m * 100) / 100} data-id={g.id}
                              style={{ cursor: g.achse === "x" ? "ew-resize" : "ns-resize" }}
                              onPointerDown={(e) => { if (e.button !== 0) return; e.stopPropagation(); startDrag(e, { kind: "grenze", grenze: g }); }}>
                              <title>{g.verzahnung?.warn
                                ? `${t("Verzahnung")}: ${g.verzahnung.warn}`
                                : g.verschoben ? t("von Hand gesetzt — Ziehen verschiebt, Klick gibt frei")
                                  : g.gesperrt ? t("gesperrt — Klick gibt frei, Ziehen verschiebt") : t("flexibel — Klick sperrt, Ziehen verschiebt")}</title>
                              {/* wide invisible hit area so the thin line is easy to grab */}
                              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth="10" />
                              <line x1={x1} y1={y1} x2={x2} y2={y2}
                                stroke={farbe} strokeWidth={g.gesperrt || verzahnt ? 2 : 1.2}
                                strokeDasharray={g.gesperrt ? undefined : verzahnt ? "2 2" : "4 3"} />
                              <rect x={mx - 22} y={my - 6} width="44" height="12" rx="3"
                                fill={g.gesperrt ? "#fecaca" : "#fef3c7"} stroke="none" />
                              <text x={mx} y={my + 3} textAnchor="middle" fontSize="8"
                                fill={g.gesperrt ? "#b91c1c" : "#92400e"} fontWeight="600">
                                {label}
                              </text>
                              {verzahnt && (
                                <text x={mx} y={my - 9} textAnchor="middle" fontSize="7" fill="#7c3aed">
                                  {t("Verzahnung")}: {g.verzahnung.raum}
                                </text>
                              )}
                            </g>
                          );
                        })}
                      </g>
                    );
                  }}
                />
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                  <span className="font-semibold text-slate-600">{t("Knautschzonen — hier atmet das Puzzle")}</span>
                  <span><Unlock className="inline w-3 h-3 mr-0.5" />{t("flexibel (Klick sperrt)")}</span>
                  <span><Lock className="inline w-3 h-3 mr-0.5 text-red-600" />{t("gesperrt (bleibt beim nächsten Lauf stehen)")}</span>
                  <span>📌 {t("Grenze ziehen = von Hand setzen · WE auf Nachbar ziehen = tauschen")}</span>
                  {grenzenImLevel.length > 0 && <span>{grenzenImLevel.length} {t("Grenzen im Geschoss")}</span>}
                  {hatManuell && (
                    <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={anordnungZuruecksetzen} data-testid="wt-anordnung-reset">
                      <Eraser className="w-3 h-3 mr-1" /> {t("Anordnung zurücksetzen")}
                    </Button>
                  )}
                </div>
                {/* 75-13: escape-route exceedances are WARN (legal limit MBO §35 Abs. 2) — red, above the hints. */}
                {(ergebnis.rettungswegWarnungen || []).map((w) => (
                  <div key={`rw-${w.we}`} className="mt-2 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900"
                    data-testid="wt-rettungsweg-warn" data-we={w.we} data-laenge={w.laenge_m} data-vorschlag={w.vorschlag_m} data-stufe="warn">
                    <span className="font-semibold">warn</span> · {w.text}
                  </div>
                ))}
                {(ergebnis.hinweise || []).map((h) => (
                  <div key={h} className="mt-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900" data-testid="wt-hinweis">{h}</div>
                ))}
                {/* 75-11 Task 3 (MSB-13): rooms without a RULE window while the
                    rule is on — one line per room in the existing hint box,
                    shape like the 75-07 hints (room, reason, suggestion). */}
                {raeumeOhneFenster.map((r) => (
                  <div key={`rf-${r.name}`} className="mt-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
                    data-testid="wt-hinweis" data-fenster-hinweis={r.name}>
                    <span className="font-semibold">{r.name}</span>: {r.grund} — {t("Fenster von Hand setzen oder Raumtausch prüfen")}
                  </div>
                ))}
                {toteCheck && toteCheck.status === "offen" && (
                  <div className="mt-2 rounded border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-700">
                    {t("Tote Zwischenräume")}: {de1(toteCheck.rest_m2)} m² — {t("Knautschzonen freigeben/anpassen")}
                  </div>
                )}
                {/* Überbelegung prominent unter dem Plan (Plan 61-05 Task 2 (4)):
                    restNachfrage_m2 is ONLY the target area of units that did not
                    fit (M-03), summed over all bands and storeys. */}
                {ueberbelegung && (
                  <div className="mt-2 flex items-start gap-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
                    data-testid="wt-ueberbelegung">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
                    <span>
                      <span className="font-semibold">{t("Überbelegung")}:</span>{" "}
                      {de1(ergebnis.restNachfrage_m2)} m² {t("Zielfläche nicht platzierbar")}
                      {anzahlCheck && <span className="text-amber-800"> · {anzahlCheck.detail}</span>}
                      {" — "}{t("min-Werte senken, Einheiten entfernen oder Typologie wechseln.")}
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* 75-14 Task 5: room-quality list per unit — counts in the header, one
              row per unit with its fail/warn/ok counts and a jump into the focus.
              Only with the rule on (the list would be empty otherwise). */}
          {/* Plain divs on purpose: every new shadcn Card instance adds a tsc legacy error
              in this file (75-11 pattern). */}
          {wohnungsgrundrissAktiv && (
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm" data-testid="wt-qualitaet" data-ok={qualitaetZaehler.ok} data-warn={qualitaetZaehler.warn} data-fail={qualitaetZaehler.fail}>
              <div className="px-6 pt-5 pb-2">
                <div className="text-base font-semibold flex flex-wrap items-center gap-2">
                  {t("Raumqualität je WE")}
                  <span className="text-xs font-normal text-slate-500" data-testid="wt-qualitaet-zaehler">
                    {qualitaetZaehler.ok} ok · {qualitaetZaehler.warn} warn · {qualitaetZaehler.fail} fail
                  </span>
                  <span className="text-[10px] font-normal text-slate-400">[ASSUMED {t("Büro-Vorgabe")}]</span>
                </div>
              </div>
              <div className="px-6 pb-5 space-y-1">
                {qualitaetJeWe.length === 0 && <div className="text-xs text-slate-500">{t("Keine WEs platziert — Tesselierung anwenden.")}</div>}
                {qualitaetJeWe.map((q) => (
                  <div key={q.we} className="rounded border border-slate-200 px-2 py-1.5 text-xs" data-testid="wt-qualitaet-we" data-we={q.we}
                    data-ok={q.zaehler.ok} data-warn={q.zaehler.warn} data-fail={q.zaehler.fail}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{q.we}</span>
                      <span className="flex items-center gap-2">
                        <span className={q.zaehler.fail ? "text-red-600" : q.zaehler.warn ? "text-amber-600" : "text-emerald-600"}>
                          {q.zaehler.fail} fail · {q.zaehler.warn} warn · {q.zaehler.ok} ok
                        </span>
                        <button type="button" className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50"
                          onClick={() => fokusOeffnen(q.we)} data-testid="wt-qualitaet-fokus">{t("Fokus")}</button>
                      </span>
                    </div>
                    {q.eintraege.filter((e) => e.stufe !== "ok").slice(0, 4).map((e, i) => (
                      <div key={i} className="mt-0.5 flex items-start gap-1.5 text-[11px] text-slate-600" data-regel={e.regel} data-stufe={e.stufe}>
                        <span className={`mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${e.stufe === "fail" ? "bg-red-500" : "bg-amber-500"}`} />
                        <span><span className="font-medium">{e.raum === "WE" ? q.we : kurzRaumname(e.raum)}</span> — {e.text}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Check-Cards je WE */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div ref={checkCardRef} data-testid="wt-check-card">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex flex-wrap items-center gap-2">
                  {t("Bewohnbarkeit je WE")}
                  {/* 75-11 Task 3 (MSB-13, honesty): while the per-room window
                      rule is OFF the window positions are an approximation —
                      the daylight check is a guide value, not a proof. Plain
                      span on purpose: a new shadcn <Badge> instance would add
                      a tsc legacy error in this file. */}
                  {!fensterJeRaumAktiv && (
                    <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800"
                      data-testid="wt-fenster-naeherung">
                      {t("Fensterlage genähert (je 3,5 m) — Belichtung ist ein Richtwert")}
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {checksJeWe.length === 0 && <div className="text-xs text-slate-500">{t("Keine WEs platziert — Tesselierung anwenden.")}</div>}
                {checksJeWe.map((c, i) => {
                  const st = WT_STATUS[c.status] || WT_STATUS.offen;
                  return (
                    <div key={c.we} className="rounded border border-slate-200">
                      <button
                        type="button"
                        className="w-full flex items-center justify-between px-2 py-1.5 text-left text-xs hover:bg-slate-50 hover:text-slate-800"
                        onClick={() => setOffenIdx(offenIdx === i ? null : i)}
                      >
                        <span className="font-medium">{c.we}</span>
                        <Badge className={st.color}>{st.label}</Badge>
                      </button>
                      {offenIdx === i && (
                        <div className="border-t border-slate-200 px-2 py-1 space-y-1">
                          {c.checks.map((ck) => {
                            const cks = WT_STATUS[ck.status] || WT_STATUS.offen;
                            return (
                              <div key={ck.key} className="flex items-start gap-2 text-[11px]">
                                <span className={`mt-0.5 inline-block h-2 w-2 rounded-full ${cks.dot}`} />
                                <span>
                                  <span className="font-medium">{ck.label}</span>
                                  <span className="text-slate-500"> — {ck.detail}</span>
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
            </div>

            {/* WoFlV/MF-G-Card: je WE Zonenfläche brutto (bisherige Pauschale)
                → WoFlV bzw. MF/G; Summenzeile beides nebeneinander. */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{t("Wohnfläche (WoFlV) / Gewerbefläche (MF/G)")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-center justify-between text-[10px] text-slate-400">
                  <span>{t("WE")}</span>
                  <span>{t("Zonenfläche (Pauschale)")} → {t("angerechnet")}</span>
                </div>
                {woflvJeWe.map((w) => (
                  <div key={w.we} className="flex items-center justify-between text-xs" data-testid="wt-woflv-zeile">
                    <span>{w.we}{w.nutzung === "gewerbe" ? ` (${t("Gewerbe")})` : ""}</span>
                    <span>
                      <span className="text-slate-400">{de1(w.brutto_m2)} m² → </span>
                      <span className="font-medium" data-balkon-m2={w.balkon_m2 ? Math.round(w.balkon_m2 * 100) / 100 : undefined} data-balkon-geometrie={w.balkonGeometrie ? "1" : "0"}>
                        {w.nutzung === "gewerbe"
                          ? `${de1(w.mfg_m2)} m² MF/G`
                          : `${de1(w.wohnflaeche_m2)} m² WoFlV`}
                      </span>
                      {/* 75-13: balcony share — from geometry when a balcony zone exists, else the flat value. */}
                      {w.nutzung !== "gewerbe" && w.balkon_m2 > 0 && (
                        <span className="text-slate-400"> · {t("Balkon")} {de1(w.balkon_m2)} m²{w.balkonGeometrie ? "" : ` (${t("Pauschale")})`}</span>
                      )}
                    </span>
                  </div>
                ))}
                {woflvJeWe.length > 0 && (
                  <div className="border-t border-slate-200 pt-2 flex items-center justify-between text-xs font-semibold">
                    <span>{t("Gesamt")} ({woflvJeWe.length} {t("WE")})</span>
                    <span>
                      <span className="text-slate-400 font-normal">{de1(bruttoGesamt)} m² {t("Pauschale")} → </span>
                      {wohnflaecheGesamt > 0 && `${de1(wohnflaecheGesamt)} m² ${t("Wohnfläche")}`}
                      {wohnflaecheGesamt > 0 && mfgGesamt > 0 && " · "}
                      {mfgGesamt > 0 && `${de1(mfgGesamt)} m² MF/G`}
                    </span>
                  </div>
                )}
                <div className="text-[10px] text-slate-400">
                  {t("Balkon 25 % (max. 50 %), Dachschrägen 0/50/100 % — CITED WoFlV §4; MF/G [ASSUMED]. Dachschrägen-Eingabe je Typ nur fürs oberste Geschoss (v1).")}
                </div>
              </CardContent>
            </Card>
          </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
