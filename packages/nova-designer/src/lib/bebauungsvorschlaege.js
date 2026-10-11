// 86-05a: Bebauungsvorschläge — pure library (no React, no window, isomorphic).
//
// From ONE footprint plus the workshop's base configuration it enumerates a BOUNDED,
// DETERMINISTIC list of proposals (variant space = access typology × bar decomposition
// inside the given footprint), computes figures with unit and source per field and sorts
// them stably by one chosen figure. tesseliere() itself is untouched (its golden hashes stay
// green): a proposal is a parameter set plus the result it produces, nothing more.
//
// In:  footprintM — the building footprint in world metres (any polygon the fit accepts);
//      basis — the workshop inputs WITHOUT layout-bound fields: gesperrteGrenzen, anordnung,
//      grenzenPositionen, tuerAufschlaege and stufeJeWe are dropped here, because they belong
//      to the layout the user has today, not to a proposal (86-05a-PLAN, Arch condition 2).
// Out: Vorschlag[] (see typedef below), figures via kennzahlen(), order via
//      sortiereVorschlaege(); KENNZAHLEN is the register the UI (86-05b) renders from.
//
// Decisions of the Dev-Team round 10.10.2026 (86-05a-PLAN §Entscheidungen):
//   1. form axis = bar decompositions INSIDE the given footprint, never a shape change;
//   2. small data model, no adern/knoten/baender (that is 86-06);
//   3. fixed count VORSCHLAEGE_MAX instead of a time budget — a time limit would break
//      determinism;
//   4. stable order: chosen figure, tie → id (string compare); no hidden total score;
//      proposals with fails are MARKED (hatFails), not moved;
//   5. only figures with a documented computation path, each with `quelle` and `einheit`;
//      what cannot be computed is `null`, never a placeholder number.
import {
  tesseliere, tesselierungsChecks, zerlegungFuer, effektiveRegeln, wohnungsRegeln, ERSCHLIESSUNG, FORM_RIEGEL,
} from "./tesselierung.js";
import { pruefeAlle } from "./raumQualitaet.js";
import { bereinigen, istRechteck, flaeche } from "./formGeometrie.js";

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

/**
 * One figure of a proposal.
 * @typedef {object} Kennzahl
 * @property {number|null} wert value in `einheit`, rounded to 1e-3; null = not computable here
 * @property {string} einheit unit ("WE", "m²", "m", "Stk", "–")
 * @property {string} quelle computation path / source (function or norm)
 */

/**
 * A proposal: parameter set + its tessellation. Figures are computed, never persisted; the
 * UI persists only { id, typologie, parameter, algoVersion, footprintHash } (86-05b).
 * @typedef {object} Vorschlag
 * @property {string} id stable over runs: ALGO_VERSION + footprintHash + axis values
 * @property {{erschliessung: string, zerlegung: {minFlaeche_m2: number}}} typologie axis values
 * @property {{storeys: number, nordwinkel: number}} parameter pass-through values of the base
 * @property {number} algoVersion ALGO_VERSION at creation (a proposal of another version is stale)
 * @property {string} footprintHash footprintHash() of the footprint it was computed for
 * @property {number} riegel number of bars (1 = a single building)
 * @property {Record<string, Kennzahl>} kennzahlen one entry per KENNZAHLEN key
 * @property {boolean} hatFails kennzahlen.fails.wert > 0 — marker, not a sort criterion
 * @property {any} ergebnis the tesseliere() result (zones, units, boundaries, form) for cards and "Übernehmen"
 * @property {string|null} [ursprung] 86-05c: id of the proposal this one was derived from ("ähnliche erzeugen"), null/absent for enumerated ones
 */

/** Version of the enumeration + figures. Raise when ids or figures change meaning. */
export const ALGO_VERSION = 1;

/**
 * Upper bound of proposals per run [ASSUMED — PM question "12 cards instead of 200?" is
 * open with the user; 5 typologies × 3 decomposition steps = 15 stay below it].
 */
export const VORSCHLAEGE_MAX = 24;

/**
 * The variant axes, in enumeration order (outer → inner). Extensible: 86-02 (slanted
 * walls) and 86-04 (courtyard) become NEW VALUES here, never a tool.
 * - erschliessung: the workshop typologies except `efh` (one house = one unit, no variants);
 * - zerlegung: minimum footprint of a further bar, m² — only non-rectangular footprints
 *   vary it (a rectangle is one bar whatever the minimum); steps [ASSUMED], first = the
 *   solver default so the first proposal of every typology equals today's workshop result;
 * - ausrichtung: north angle steps, degrees — in 86-05a a pass-through of `basis.nordwinkel`
 *   only (the footprint does not turn; the angle only changes the compass label of facades).
 */
export const VARIANTEN_ACHSEN = {
  erschliessung: Object.keys(ERSCHLIESSUNG).filter((k) => k !== "efh"),
  zerlegung: [FORM_RIEGEL.minFlaeche_m2, 160, 200].map((m) => ({ minFlaeche_m2: m })),
  ausrichtung: [0],
};

/** Base fields a proposal is computed from (everything else of the workshop config is layout-bound). */
export const BASIS_FELDER = ["storeys", "einheiten", "raumzonen", "regeln", "nordwinkel", "okf_m"];

/** Layout-bound workshop fields — dropped from the base (they belong to the previous layout). */
export const LAYOUT_FELDER = ["gesperrteGrenzen", "anordnung", "grenzenPositionen", "tuerAufschlaege", "stufeJeWe"];

/**
 * Register of the figures: key, German label (i18n key in the UI), unit, default sort
 * direction ("absteigend" = larger is listed first) and the computation path.
 * @type {Array<{key: string, label: string, einheit: string, richtung: "aufsteigend"|"absteigend", quelle: string}>}
 */
export const KENNZAHLEN = [
  { key: "we", label: "Wohneinheiten", einheit: "WE", richtung: "absteigend", quelle: "tesseliere weListe — Einträge je Geschoss, Reihenhaus je Haus" },
  { key: "wohnflaeche_m2", label: "Wohnfläche", einheit: "m²", richtung: "absteigend", quelle: "Σ Raumzonen aller WE und Geschosse (Zonenfläche, nicht WoFlV; ohne Balkone); ohne Raumzonen Σ WE-Rechtecke × Geschosse" },
  { key: "bgf_m2", label: "BGF", einheit: "m²", richtung: "absteigend", quelle: "belegte Grundfläche (form.belegt_m2) × Geschosse — DIN 277 BGF vereinfacht, ohne Dach/Keller [ASSUMED]" },
  { key: "effizienz", label: "Flächeneffizienz", einheit: "–", richtung: "absteigend", quelle: "Wohnfläche / BGF" },
  { key: "fuellgrad", label: "Füllgrad", einheit: "–", richtung: "absteigend", quelle: "tesseliere form.fuellgrad (belegt / Grundfläche je Geschoss)" },
  { key: "kerne", label: "Kerne", einheit: "Stk", richtung: "aufsteigend", quelle: "Skelett-Zonen „Kern“/„Treppenraum“ im EG" },
  { key: "erschliessung_m", label: "Erschließungslänge", einheit: "m", richtung: "aufsteigend", quelle: "Σ Längsmaß der Flurzonen im EG (Flur, Laubengang, Eingangshalle; ohne Kerne und Dielen)" },
  { key: "fassade_je_we_m", label: "Fassade je WE", einheit: "m", richtung: "absteigend", quelle: "Σ fassadeLaenge_m / WE (tesseliere: Bandbreite + Giebel je WE)" },
  { key: "rettungsweg_max_m", label: "Längster Rettungsweg", einheit: "m", richtung: "aufsteigend", quelle: "max rettungsweg_m je WE (rettungsweg.js, nur mit regeln.rettungsweg; sonst null)" },
  { key: "fails", label: "Fails", einheit: "Stk", richtung: "aufsteigend", quelle: "raumQualitaet.pruefeAlle — Befunde der Stufe fail (wie Werkstatt-Qualitätsliste)" },
  { key: "warns", label: "Warnungen", einheit: "Stk", richtung: "aufsteigend", quelle: "pruefeAlle warn + tesselierungsChecks warn + raumWarns" },
  { key: "rest_m2", label: "Restfläche", einheit: "m²", richtung: "aufsteigend", quelle: "tesseliere rest_m2 (Bandlücken + Formrest × Geschosse)" },
];
const REGISTER = new Map(KENNZAHLEN.map((k) => [k.key, k]));

/** FNV-1a 32 bit over a string, hex (8 chars). Isomorphic — no node:crypto in the browser. */
function fnv1a(text, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * Stable 16-hex-char hash of a text (two FNV-1a passes with different seeds). Not
 * cryptographic — it only has to be stable and collision-poor for ids.
 * @param {string} text
 * @returns {string}
 */
export function hashText(text) {
  const s = String(text);
  return fnv1a(s, 0x811c9dc5) + fnv1a(s, 0x9747b28c);
}

/**
 * Hash of a footprint: corners cleaned (bereinigen) and rounded to 1 cm, so float noise does
 * not change it but any real change of the shape or position does. "leer" for < 3 corners.
 * @param {Array<{x:number, z:number}>|null|undefined} footprintM m
 * @returns {string}
 */
export function footprintHash(footprintM) {
  const pts = bereinigen(footprintM);
  if (pts.length < 3) return "leer";
  const r2 = (v) => Math.round(v * 100) / 100 + 0; // +0 turns -0 into 0
  return hashText(JSON.stringify(pts.map((p) => [r2(p.x), r2(p.z)])));
}

/**
 * Stable proposal id: readable prefix (version, typology, minimum bar area) + hash over
 * (footprintHash, algoVersion, axis values). Same inputs → same id, in every run.
 * @param {string} fpHash footprintHash()
 * @param {{erschliessung: string, zerlegung: {minFlaeche_m2: number}, ausrichtung?: number}} achsen axis values
 * @param {number} [algoVersion]
 * @returns {string}
 */
export function vorschlagId(fpHash, achsen, algoVersion = ALGO_VERSION) {
  const e = String(achsen.erschliessung);
  const m = num(achsen.zerlegung?.minFlaeche_m2);
  const a = num(achsen.ausrichtung);
  return `v${algoVersion}-${e}-z${m}-${hashText(`${fpHash}|${algoVersion}|${e}|${m}|${a}`)}`;
}

/**
 * The base a proposal is computed from: only BASIS_FELDER, layout-bound fields dropped,
 * `raumzonen` defaults to true (the workshop always runs in room-zone mode).
 * @param {object|null|undefined} basis workshop inputs (cfg + store values)
 * @returns {{storeys?: number, einheiten?: Array<object>, raumzonen: boolean, regeln?: object, nordwinkel?: number, okf_m?: number|null}}
 */
export function basisBereinigt(basis) {
  const b = basis && typeof basis === "object" ? basis : {};
  /** @type {any} */
  const out = {};
  for (const k of BASIS_FELDER) if (b[k] !== undefined) out[k] = b[k];
  if (out.raumzonen === undefined) out.raumzonen = true;
  return out;
}

/** Signature of a decomposition: bar frames + rectangles rounded to 1 cm; "1" for a single bar. */
function zerlegungsSignatur(zerl) {
  if (!zerl || !Array.isArray(zerl.riegel) || zerl.riegel.length <= 1) return "1";
  const r2 = (v) => Math.round(v * 100);
  return JSON.stringify(zerl.riegel.map((r) => [
    Math.round(r.rahmen.winkel * 1e4), r2(r.rahmen.ox), r2(r.rahmen.oz),
    r2(r.rechteck.x0), r2(r.rechteck.x1), r2(r.rechteck.z0), r2(r.rechteck.z1),
  ]));
}

/** Longest edge of a polygon, m (the long side of a corridor rectangle, also when rotated). */
function laengsteKante(points) {
  const pts = Array.isArray(points) ? points : [];
  let best = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    best = Math.max(best, Math.hypot(num(q.x) - num(p.x), num(q.z) - num(p.z)));
  }
  return best;
}

/** Zone area, m²: the zone's own `flaeche_m2` when present, else the polygon area. */
const zonenFlaeche = (z) => (Number.isFinite(Number(z?.flaeche_m2)) ? Number(z.flaeche_m2) : flaeche(z?.points));

const KERN_NAME = /^(Kern|Treppenraum) /;
const KERN_ODER_AUFZUG = /^(Kern|Treppenraum|Aufzug) /;

/**
 * Figures of ONE tessellation result, each with unit and source. Counts the same things the
 * workshop shows (quality list = pruefeAlle, checks = tesselierungsChecks), so a card and the
 * workshop after "Übernehmen" agree (86-05b QA test). Pure; never changes `ergebnis`.
 * @param {any} ergebnis tesseliere() result
 * @param {{footprintM?: Array<{x:number, z:number}>|null, storeys?: number, regeln?: object|null, einheiten?: Array<object>}} [kontext]
 *   footprintM in m (bbox marks window walls for the quality checks), storeys, the workshop
 *   rules (fail/warn thresholds) and the unit-type list (for the "WE-Anzahl" check)
 * @returns {Record<string, Kennzahl>} one entry per KENNZAHLEN key
 */
export function kennzahlen(ergebnis, kontext = {}) {
  const r = ergebnis && typeof ergebnis === "object" ? ergebnis : {};
  const weListe = Array.isArray(r.weListe) ? r.weListe : [];
  const zonen = Array.isArray(r.zonen) ? r.zonen : [];
  const storeys = Math.max(1, Math.round(num(kontext.storeys, 1)));
  const fp = bereinigen(kontext.footprintM);
  const K = (key, wert) => {
    const reg = REGISTER.get(key);
    if (!reg) throw new Error(`kennzahlen: Kennzahl "${key}" fehlt im Register KENNZAHLEN`);
    const w = wert === null || wert === undefined || !Number.isFinite(Number(wert)) ? null : Math.round(Number(wert) * 1000) / 1000 + 0;
    return { wert: w, einheit: reg.einheit, quelle: reg.quelle };
  };

  const we = weListe.length;

  // Living area: room zones (rooms carry `art`, balconies are excluded) over all storeys;
  // in band mode (no rooms) the unit rectangles, times storeys where a unit spans them.
  const raeume = zonen.filter((z) => z && z.we && z.art && String(z.art) !== "balkon");
  let wohnflaeche = null;
  if (raeume.length) wohnflaeche = raeume.reduce((s, z) => s + zonenFlaeche(z), 0);
  else if (we) {
    wohnflaeche = weListe.reduce((s, w) => {
      const f = num(w.flaeche_m2);
      const typ = ERSCHLIESSUNG[String(w.typ ?? "")];
      return s + f * (typ && typ.weUeberGeschosse ? storeys : 1);
    }, 0);
  }

  const form = r.form && typeof r.form === "object" ? r.form : null;
  const belegt = form ? num(form.belegt_m2) : fp.length >= 3 ? flaeche(fp) : null;
  const bgf = belegt === null ? null : belegt * storeys;
  const effizienz = bgf && wohnflaeche !== null ? wohnflaeche / bgf : null;
  const fuellgrad = form ? num(form.fuellgrad) : fp.length >= 3 ? 1 : null;

  const eg = zonen.filter((z) => z && !z.we && Math.round(num(z.level)) === 0);
  const kerne = eg.filter((z) => KERN_NAME.test(String(z.name || ""))).length;
  const erschliessung = eg
    .filter((z) => z.raumart === "flur" && !KERN_ODER_AUFZUG.test(String(z.name || "")))
    .reduce((s, z) => s + laengsteKante(z.points), 0);

  const fassade = we ? weListe.reduce((s, w) => s + num(w.fassadeLaenge_m), 0) / we : null;
  const rettungswege = weListe.map((w) => Number(w.rettungsweg_m)).filter((v) => Number.isFinite(v));
  const rettungswegMax = rettungswege.length ? Math.max(...rettungswege) : null;

  // Quality findings exactly as the workshop computes them (WohnungsWerkstatt qualitaetJeWe).
  const regeln = effektiveRegeln(kontext.regeln && typeof kontext.regeln === "object" ? kontext.regeln : null);
  let qFails = 0, qWarns = 0;
  if (wohnungsRegeln(regeln).aktiv && fp.length >= 3) {
    const xs = fp.map((p) => p.x), zs = fp.map((p) => p.z);
    const bbox = { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
    const stufeJeWe = Object.fromEntries(weListe.filter((w) => w.stufe).map((w) => [String(w.we), String(w.stufe)]));
    for (const q of pruefeAlle(zonen, { bbox, regeln, stufeJeWe })) {
      qFails += num(q?.zaehler?.fail);
      qWarns += num(q?.zaehler?.warn);
    }
  }
  const checks = tesselierungsChecks({
    weListe, restNachfrage_m2: r.restNachfrage_m2,
    ...(Array.isArray(kontext.einheiten) ? { angefordert: kontext.einheiten.length } : {}),
    ...(fp.length >= 3 ? { zonen, footprintM: fp } : {}),
  });
  const checkWarns = checks.filter((c) => c.status === "warn").length;
  const raumWarns = Array.isArray(r.raumWarns) ? r.raumWarns.length : 0;

  return {
    we: K("we", we),
    wohnflaeche_m2: K("wohnflaeche_m2", wohnflaeche),
    bgf_m2: K("bgf_m2", bgf),
    effizienz: K("effizienz", effizienz),
    fuellgrad: K("fuellgrad", fuellgrad),
    kerne: K("kerne", kerne),
    erschliessung_m: K("erschliessung_m", erschliessung),
    fassade_je_we_m: K("fassade_je_we_m", fassade),
    rettungsweg_max_m: K("rettungsweg_max_m", rettungswegMax),
    fails: K("fails", qFails),
    warns: K("warns", qWarns + checkWarns + raumWarns),
    rest_m2: K("rest_m2", num(r.rest_m2)),
  };
}

/**
 * Enumerate the proposals of one footprint: every typology × every decomposition step (a
 * rectangle has one decomposition), in fixed axis order, at most `max`. Parameter sets that
 * lead to the SAME decomposition (checked via zerlegungFuer before the solver runs) yield
 * one proposal — the first in axis order. Pure, no randomness, no time budget.
 * @param {Array<{x:number, z:number}>|null|undefined} footprintM footprint, m (world)
 * @param {object} basis workshop inputs (layout-bound fields are dropped, see basisBereinigt)
 * @param {{max?: number, achsen?: typeof VARIANTEN_ACHSEN}} [optionen] `max` default VORSCHLAEGE_MAX; `achsen` override for tests
 * @returns {Vorschlag[]} empty for an invalid footprint (< 3 corners)
 */
export function erzeugeVorschlaege(footprintM, basis, optionen = {}) {
  const max = Math.max(1, Math.floor(num(optionen.max, VORSCHLAEGE_MAX)));
  const achsen = optionen.achsen || VARIANTEN_ACHSEN;
  const b = basisBereinigt(basis);
  const fp = bereinigen(footprintM);
  if (fp.length < 3) return [];
  const fpHash = footprintHash(fp);
  const storeys = Math.max(1, Math.round(num(b.storeys, 1)));
  const nordwinkel = num(b.nordwinkel);
  const zerlegungen = istRechteck(fp) ? achsen.zerlegung.slice(0, 1) : achsen.zerlegung;
  /** @type {Vorschlag[]} */
  const out = [];
  for (const typ of achsen.erschliessung) {
    const gesehen = new Set();
    for (const z of zerlegungen) {
      if (out.length >= max) return out;
      const opts = { ...b, footprintM: fp, typ, riegelMinFlaeche_m2: z.minFlaeche_m2 };
      const zerl = zerlegungFuer(opts);
      const sig = zerlegungsSignatur(zerl);
      if (gesehen.has(sig)) continue;
      gesehen.add(sig);
      const ergebnis = tesseliere(opts);
      const kz = kennzahlen(ergebnis, { footprintM: fp, storeys, regeln: b.regeln, einheiten: b.einheiten });
      out.push({
        id: vorschlagId(fpHash, { erschliessung: typ, zerlegung: z, ausrichtung: nordwinkel }),
        typologie: { erschliessung: typ, zerlegung: { minFlaeche_m2: num(z.minFlaeche_m2) } },
        parameter: { storeys, nordwinkel },
        algoVersion: ALGO_VERSION,
        footprintHash: fpHash,
        riegel: zerl && Array.isArray(zerl.riegel) ? zerl.riegel.length : 1,
        kennzahlen: kz,
        hatFails: num(kz.fails.wert) > 0,
        ergebnis,
      });
    }
  }
  return out;
}

/**
 * 86-05b: the card view of a proposal — everything the UI draws and sorts, WITHOUT the full
 * tessellation (unit list, boundaries, upper storeys). Small enough to cross a Worker
 * boundary (structured clone) and to keep per card. Pure.
 * @param {Vorschlag} v
 * @returns {{id: string, typologie: Vorschlag["typologie"], parameter: Vorschlag["parameter"], algoVersion: number, footprintHash: string, riegel: number, kennzahlen: Record<string, Kennzahl>, hatFails: boolean, zonenEG: Array<{points: Array<{x:number, z:number}>, name: string, we: string|null, raumart: string|null, art: string|null}>, riegelUmrisse: Array<Array<{x:number, z:number}>>, rest: Array<Array<{x:number, z:number}>>, ursprung: string|null}}
 */
export function kartenDaten(v) {
  const r = v?.ergebnis && typeof v.ergebnis === "object" ? v.ergebnis : {};
  const zonen = Array.isArray(r.zonen) ? r.zonen : [];
  const form = r.form && typeof r.form === "object" ? r.form : {};
  return {
    id: String(v?.id ?? ""),
    typologie: v?.typologie,
    parameter: v?.parameter,
    algoVersion: num(v?.algoVersion, ALGO_VERSION),
    footprintHash: String(v?.footprintHash ?? ""),
    riegel: num(v?.riegel, 1),
    kennzahlen: v?.kennzahlen || {},
    hatFails: v?.hatFails === true,
    zonenEG: zonen
      .filter((z) => z && Math.round(num(z.level)) === 0 && Array.isArray(z.points) && z.points.length >= 3)
      .map((z) => ({ points: z.points.map((p) => ({ x: num(p.x), z: num(p.z) })), name: String(z.name || ""), we: z.we ?? null, raumart: z.raumart ?? null, art: z.art ?? null })),
    riegelUmrisse: Array.isArray(form.riegel) ? form.riegel.map((b) => (Array.isArray(b.rechteck) ? b.rechteck : [])) : [],
    rest: Array.isArray(form.rest) ? form.rest : [],
    ursprung: v?.ursprung ? String(v.ursprung) : null,
  };
}

/** 86-05c: neighbourhood step of the bar minimum, m² [ASSUMED — one third of the default 120]. */
export const NACHBAR_SCHRITT_M2 = 40;
/** 86-05c: bar minimum reachable through "ähnliche erzeugen", m² [ASSUMED 80 … 400]. */
export const NACHBAR_MIN_FLAECHE = { min: 80, max: 400 };

/**
 * 86-05c "ähnliche erzeugen": the deterministic neighbourhood of ONE proposal — access
 * typology ±1 in VARIANTEN_ACHSEN order (no wrap-around) and bar minimum ±NACHBAR_SCHRITT_M2
 * within NACHBAR_MIN_FLAECHE (rectangles have no bar axis: one bar whatever the minimum).
 * No random element and no seed (Dev-Team round 10.10.2026, QA): the same call returns the
 * same list. Skipped: neighbours whose id is already present (`vorhanden`), and neighbours
 * that decompose like a present proposal of the same typology (same rule as the
 * enumeration). Every result carries `ursprung` = the source id for the "ähnlich zu" chip.
 * @param {{id?: string, typologie: Vorschlag["typologie"]}} vorschlag source (proposal or card data)
 * @param {Array<{x:number, z:number}>} footprintM footprint the source belongs to, m
 * @param {object} basis workshop base inputs (layout-bound fields are dropped)
 * @param {{vorhanden?: Array<string|{id: string, typologie?: Vorschlag["typologie"]}>, achsen?: typeof VARIANTEN_ACHSEN, max?: number}} [optionen]
 *   vorhanden = the current list (ids or card data; card data enables the decomposition dedupe); max = cap on results
 * @returns {Vorschlag[]} axis order: typology −1, typology +1, bar minimum −, bar minimum +
 */
export function nachbarn(vorschlag, footprintM, basis, optionen = {}) {
  const achsen = optionen.achsen || VARIANTEN_ACHSEN;
  const max = Math.max(0, Math.floor(num(optionen.max, VORSCHLAEGE_MAX)));
  const b = basisBereinigt(basis);
  const fp = bereinigen(footprintM);
  if (fp.length < 3 || !vorschlag || typeof vorschlag !== "object" || !vorschlag.typologie) return [];
  const fpHash = footprintHash(fp);
  const storeys = Math.max(1, Math.round(num(b.storeys, 1)));
  const nordwinkel = num(b.nordwinkel);
  const typ0 = String(vorschlag.typologie.erschliessung ?? "");
  const m0 = num(vorschlag.typologie.zerlegung?.minFlaeche_m2, FORM_RIEGEL.minFlaeche_m2);
  const reihe = achsen.erschliessung;
  const i0 = reihe.indexOf(typ0);
  const signatur = (typ, m) => `${typ}|${zerlegungsSignatur(zerlegungFuer({ ...b, footprintM: fp, typ, riegelMinFlaeche_m2: m }))}`;
  const ids = new Set();
  const signaturen = new Set();
  for (const v of Array.isArray(optionen.vorhanden) ? optionen.vorhanden : []) {
    const id = typeof v === "string" ? v : String(v?.id ?? "");
    if (id) ids.add(id);
    const t = v && typeof v === "object" && v.typologie ? v.typologie : null;
    if (t) signaturen.add(signatur(String(t.erschliessung ?? ""), num(t.zerlegung?.minFlaeche_m2, FORM_RIEGEL.minFlaeche_m2)));
  }
  // The source itself is present even when the caller passed no list.
  if (vorschlag.id) ids.add(String(vorschlag.id));
  signaturen.add(signatur(typ0, m0));
  /** @type {Array<{typ: string, m: number}>} */
  const kandidaten = [];
  if (i0 > 0) kandidaten.push({ typ: reihe[i0 - 1], m: m0 });
  if (i0 >= 0 && i0 < reihe.length - 1) kandidaten.push({ typ: reihe[i0 + 1], m: m0 });
  // Bar axis: walk in NACHBAR_SCHRITT_M2 steps per direction up to the FIRST minimum whose
  // decomposition differs from the SOURCE (measurement 10.10.: ±40 alone repeats the
  // decomposition on L/U — the next distinct one may be several steps away, e.g. the
  // single-bar L above 384 m²). The neighbourhood of a card is therefore a fixed set; what is
  // already in the list is dropped below, so a second click adds nothing.
  if (!istRechteck(fp)) {
    const sigQuelle = signatur(typ0, m0);
    for (const richtung of [-1, 1]) {
      for (let m = m0 + richtung * NACHBAR_SCHRITT_M2; m >= NACHBAR_MIN_FLAECHE.min && m <= NACHBAR_MIN_FLAECHE.max; m += richtung * NACHBAR_SCHRITT_M2) {
        if (signatur(typ0, m) === sigQuelle) continue;
        kandidaten.push({ typ: typ0, m });
        break;
      }
    }
  }
  /** @type {Vorschlag[]} */
  const out = [];
  for (const k of kandidaten) {
    if (out.length >= max) break;
    const id = vorschlagId(fpHash, { erschliessung: k.typ, zerlegung: { minFlaeche_m2: k.m }, ausrichtung: nordwinkel });
    if (ids.has(id)) continue;
    const opts = { ...b, footprintM: fp, typ: k.typ, riegelMinFlaeche_m2: k.m };
    const zerl = zerlegungFuer(opts);
    const sig = `${k.typ}|${zerlegungsSignatur(zerl)}`;
    if (signaturen.has(sig)) continue;
    signaturen.add(sig);
    ids.add(id);
    const ergebnis = tesseliere(opts);
    const kz = kennzahlen(ergebnis, { footprintM: fp, storeys, regeln: b.regeln, einheiten: b.einheiten });
    out.push({
      id,
      typologie: { erschliessung: k.typ, zerlegung: { minFlaeche_m2: k.m } },
      parameter: { storeys, nordwinkel },
      algoVersion: ALGO_VERSION,
      footprintHash: fpHash,
      riegel: zerl && Array.isArray(zerl.riegel) ? zerl.riegel.length : 1,
      kennzahlen: kz,
      hatFails: num(kz.fails.wert) > 0,
      ergebnis,
      ursprung: vorschlag.id ? String(vorschlag.id) : null,
    });
  }
  return out;
}

/**
 * 86-05c comparison: per figure the best value among 2–4 proposals by the register
 * direction ("absteigend" → largest wins, "aufsteigend" → smallest). `null` never wins;
 * ties mark every equal best. Pure — the table and its test read the same answer.
 * @template {{id: string, kennzahlen: Record<string, Kennzahl>}} T
 * @param {T[]} liste proposals or card data in selection order
 * @returns {Record<string, Set<string>>} KENNZAHLEN key → ids holding the best value (empty set = no value)
 */
export function besteJeKennzahl(liste) {
  /** @type {Record<string, Set<string>>} */
  const out = {};
  const l = Array.isArray(liste) ? liste : [];
  for (const k of KENNZAHLEN) {
    const werte = l.map((v) => ({ id: String(v?.id ?? ""), w: v?.kennzahlen?.[k.key]?.wert })).filter((e) => e.w !== null && e.w !== undefined && Number.isFinite(Number(e.w)));
    const best = werte.length ? (k.richtung === "aufsteigend" ? Math.min : Math.max)(...werte.map((e) => Number(e.w))) : null;
    out[k.key] = new Set(best === null ? [] : werte.filter((e) => Number(e.w) === best).map((e) => e.id));
  }
  return out;
}

/**
 * 86-05b: what the workshop persists of a chosen proposal (werkstatt_layer.gewaehlterVorschlag,
 * schema v2). Figures are NOT stored — they are recomputed from the parameters.
 * @param {{id: string, typologie: Vorschlag["typologie"], parameter: Vorschlag["parameter"], algoVersion?: number, footprintHash: string}} v proposal or card data
 * @param {Date} [jetzt] for tests
 * @returns {{id: string, typologie: Vorschlag["typologie"], parameter: Vorschlag["parameter"], algoVersion: number, footprintHash: string, gewaehltAm: string}}
 */
export function vorschlagKompakt(v, jetzt = new Date()) {
  return {
    id: String(v.id),
    typologie: { erschliessung: String(v.typologie?.erschliessung ?? ""), zerlegung: { minFlaeche_m2: num(v.typologie?.zerlegung?.minFlaeche_m2, FORM_RIEGEL.minFlaeche_m2) } },
    parameter: { storeys: num(v.parameter?.storeys, 1), nordwinkel: num(v.parameter?.nordwinkel) },
    algoVersion: num(v.algoVersion, ALGO_VERSION),
    footprintHash: String(v.footprintHash ?? ""),
    gewaehltAm: jetzt.toISOString(),
  };
}

/**
 * 86-05b: apply a proposal to the workshop configuration — ONE pure function the UI calls
 * and the tests cover. Sets `typ` and `riegelMinFlaeche_m2` from the proposal, stores it
 * as `gewaehlterVorschlag` and DROPS the layout-bound inputs (LAYOUT_FELDER), because
 * they describe the previous layout (boundary ids, band keys, unit numbers change with
 * the typology). Option `behalteEingaben`: keep them — only honoured when the typology
 * stays the same (Dev-Team decision, 86-05b-PLAN step 2); the return says what happened.
 * @param {object} cfg current workshop configuration (werkstatt_layer + defaults)
 * @param {{id: string, typologie: Vorschlag["typologie"], parameter: Vorschlag["parameter"], algoVersion?: number, footprintHash: string}} vorschlag
 * @param {{behalteEingaben?: boolean, jetzt?: Date}} [optionen]
 * @returns {{cfg: object, verworfen: Record<string, number> & {gesamt: number}, behalten: boolean}}
 *   `verworfen[feld]` = number of dropped entries per layout field (0 when kept)
 */
export function uebernehmeVorschlag(cfg, vorschlag, optionen = {}) {
  /** @type {any} */
  const c = cfg && typeof cfg === "object" ? cfg : {};
  /** @type {any} */
  const v = vorschlag || {};
  const typ = String(v.typologie?.erschliessung || c.typ || "");
  const behalten = optionen.behalteEingaben === true && typ === String(c.typ);
  const anzahl = (x) => (Array.isArray(x) ? x.length : x && typeof x === "object" ? Object.keys(x).length : 0);
  /** @type {any} */
  const neu = {
    ...c,
    typ,
    riegelMinFlaeche_m2: num(v.typologie?.zerlegung?.minFlaeche_m2, FORM_RIEGEL.minFlaeche_m2),
    gewaehlterVorschlag: vorschlagKompakt({ ...v, typologie: { ...v.typologie, erschliessung: typ } }, optionen.jetzt),
  };
  /** @type {Record<string, number> & {gesamt: number}} */
  const verworfen = { gesamt: 0 };
  for (const feld of LAYOUT_FELDER) {
    const n = behalten ? 0 : anzahl(c[feld]);
    verworfen[feld] = n;
    verworfen.gesamt += n;
    if (!behalten) neu[feld] = feld === "gesperrteGrenzen" ? [] : {};
  }
  return { cfg: neu, verworfen, behalten };
}

/**
 * 86-05b: is a stored proposal still the one that was computed? Stale when the footprint
 * changed (hash) or the enumeration changed (ALGO_VERSION). The UI shows a badge and never
 * recomputes silently under the same id (QA concern 2).
 * @param {{footprintHash?: string, algoVersion?: number}|null|undefined} gewaehlt werkstatt_layer.gewaehlterVorschlag
 * @param {Array<{x:number, z:number}>|null|undefined} footprintM current footprint, m
 * @returns {{veraltet: boolean, grund: "grundflaeche"|"algorithmus"|null}}
 */
export function vorschlagVeraltet(gewaehlt, footprintM) {
  if (!gewaehlt || typeof gewaehlt !== "object") return { veraltet: false, grund: null };
  if (num(gewaehlt.algoVersion, -1) !== ALGO_VERSION) return { veraltet: true, grund: "algorithmus" };
  if (String(gewaehlt.footprintHash ?? "") !== footprintHash(footprintM)) return { veraltet: true, grund: "grundflaeche" };
  return { veraltet: false, grund: null };
}

/**
 * Stable sort by one figure: `richtung` (default from KENNZAHLEN), proposals whose value is
 * null go last, ties are broken by `id` (string compare) — so the order never depends on the
 * input order. Returns a new array; the input is untouched. Unknown key → Error. Works on
 * full proposals and on card data alike (anything with `id` and `kennzahlen`).
 * @template {{id: string, kennzahlen: Record<string, Kennzahl>}} T
 * @param {T[]} liste
 * @param {string} kennzahl KENNZAHLEN key, e.g. "we"
 * @param {"aufsteigend"|"absteigend"} [richtung] override of the register default
 * @returns {T[]}
 */
export function sortiereVorschlaege(liste, kennzahl, richtung) {
  const reg = REGISTER.get(String(kennzahl));
  if (!reg) throw new Error(`sortiereVorschlaege: unbekannte Kennzahl "${kennzahl}" (bekannt: ${KENNZAHLEN.map((k) => k.key).join(", ")})`);
  const dir = richtung === "aufsteigend" || richtung === "absteigend" ? richtung : reg.richtung;
  const wert = (v) => { const w = v?.kennzahlen?.[reg.key]?.wert; return Number.isFinite(Number(w)) && w !== null ? Number(w) : null; };
  return [...(Array.isArray(liste) ? liste : [])].sort((a, b) => {
    const va = wert(a), vb = wert(b);
    if ((va === null) !== (vb === null)) return va === null ? 1 : -1;
    if (va !== null && vb !== null && va !== vb) return dir === "aufsteigend" ? va - vb : vb - va;
    const ia = String(a?.id ?? ""), ib = String(b?.id ?? "");
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  });
}
