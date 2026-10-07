// Year clock of the liquidity plan (79-10, BUCH-08): a pure geometry and
// drawing-model module, no React, no fetching (pattern of
// packages/nova-ifc-viewer/src/lib/befundkarte.js — "model, then a thin
// renderer"). Jahresuhr.jsx turns the model this file returns into SVG
// without computing any geometry itself; JahresuhrLegende.jsx turns
// legendeEintraege() into a matching <ul>. Both share symbolArten() as the
// one ordered list of what actually gets drawn, so the clock and its legend
// can never show a different set of symbols.
//
// In:  the 12 month figures (liquiditaet.monatsModell), the tax dates
//      (liquiditaet.steuerzahltage), the "send by" deadlines derived from
//      them, and a reference day. Out: segment/mark geometry in SVG user
//      units (viewBox 0 0 360 360) plus the legend's ordered content.

import { BUERO_STANDARD } from "./einstellungen.js";

/** SVG viewBox side length and centre (both axes), in user units. */
export const VIEWBOX = 360;
export const MITTE = 180;

/** Radii (viewBox units) — see 79-RESEARCH "Jahresuhr (Spezifikation)". */
export const RADIEN = Object.freeze({
  zeigerAussen: 48,
  monatslabel: 60,
  ringInnen: 76,
  ringAussen: 124,
  steuerInnen: 127,
  steuerAussen: 139, // 4 px wide radial tick
  fristInnen: 127,
  fristAussen: 149, // 2 px wide radial tick
  hohlkreis: 152.5, // hollow circle (radius 3) capping every deadline tick
  deckung: 164, // coverage symbol of a tax date: check mark or warning triangle
});

/** Rounds to 2 decimal places, never returning -0 or NaN. */
function r2(n) {
  if (!Number.isFinite(n)) return 0;
  const v = Math.round(n * 100) / 100;
  return v === 0 ? 0 : v;
}

/**
 * Point on the clock face at radius r, angle `grad` measured clockwise from
 * 12 o'clock (0° = top, 90° = right, 180° = bottom, 270° = left).
 * @param {number} r radius, viewBox units
 * @param {number} grad degrees clockwise from the top
 * @returns {{x: number, y: number}} viewBox units
 */
export function punkt(r, grad) {
  const rad = (grad * Math.PI) / 180;
  return { x: r2(MITTE + r * Math.sin(rad)), y: r2(MITTE - r * Math.cos(rad)) };
}

/**
 * Angular span [von, bis] of a month, centred, January at the top.
 * @param {number} monat 1–12
 * @returns {[number, number]} degrees, may be negative (month 1 starts at −15)
 */
export function monatsWinkel(monat) {
  const mitte = (monat - 1) * 30;
  return [mitte - 15, mitte + 15];
}

/**
 * Angle of one calendar day within its month's 30° slice (month-relative
 * placement: the 15th of a 30-day month sits at the slice's centre).
 * Accepts an ISO date, or its first 10 characters (a full timestamp).
 * @param {string} tagIso 'YYYY-MM-DD' or a longer ISO string
 * @returns {number|null} degrees in [0, 360), null for an invalid calendar date
 */
export function datumsWinkel(tagIso) {
  const s = typeof tagIso === "string" ? tagIso.slice(0, 10) : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const jahr = Number(s.slice(0, 4));
  const monat = Number(s.slice(5, 7));
  const tag = Number(s.slice(8, 10));
  if (monat < 1 || monat > 12) return null;
  const schaltjahr = (jahr % 4 === 0 && jahr % 100 !== 0) || jahr % 400 === 0;
  const tageImMonat = [31, schaltjahr ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][monat - 1];
  if (tag < 1 || tag > tageImMonat) return null;
  const [von] = monatsWinkel(monat);
  const grad = von + ((tag - 0.5) / tageImMonat) * 30;
  const normiert = ((grad % 360) + 360) % 360;
  return r2(normiert);
}

/**
 * Half the angular gap (degrees) that a linear gap of `spalt` viewBox units
 * subtends at radius r (small-angle: half-gap-radians ≈ (spalt/2)/r).
 * @param {number} r radius
 * @param {number} spalt total linear gap, viewBox units
 */
function halberSpaltGrad(r, spalt) {
  if (!(r > 0)) return 0;
  return ((spalt / 2) / r) * (180 / Math.PI);
}

/**
 * SVG path of one ring sector [a0, a1] (degrees, clockwise from the top)
 * between radius rI (inner) and rA (outer), with a constant LINEAR gap to its
 * neighbours at both radii (the angular gap therefore shrinks with radius, so
 * the visible slit stays the same width all the way from rI to rA).
 * @param {number} rI inner radius
 * @param {number} rA outer radius
 * @param {number} a0 start angle, degrees
 * @param {number} a1 end angle, degrees (> a0)
 * @param {number} [spalt] linear gap, viewBox units (default 2)
 * @returns {string} SVG path `d`
 */
export function ringSektorPfad(rI, rA, a0, a1, spalt = 2) {
  const gA = halberSpaltGrad(rA, spalt);
  const gI = halberSpaltGrad(rI, spalt);
  const a0A = a0 + gA, a1A = a1 - gA;
  const a0I = a0 + gI, a1I = a1 - gI;
  const large = (a1A - a0A) > 180 ? 1 : 0;
  const largeI = (a1I - a0I) > 180 ? 1 : 0;
  const pA0 = punkt(rA, a0A), pA1 = punkt(rA, a1A);
  const pI0 = punkt(rI, a0I), pI1 = punkt(rI, a1I);
  return [
    `M ${pA0.x} ${pA0.y}`,
    `A ${r2(rA)} ${r2(rA)} 0 ${large} 1 ${pA1.x} ${pA1.y}`,
    `L ${pI1.x} ${pI1.y}`,
    `A ${r2(rI)} ${r2(rI)} 0 ${largeI} 0 ${pI0.x} ${pI0.y}`,
    "Z",
  ].join(" ");
}

/**
 * SVG path of an open arc at radius r over [a0, a1] (clockwise), shortened at
 * both ends by the same linear gap as the ring sectors, so the outflow line
 * never bridges the slit between two months.
 * @param {number} r radius, viewBox units
 * @param {number} a0 start angle, degrees
 * @param {number} a1 end angle, degrees (> a0)
 * @param {number} [spalt] linear gap, viewBox units (default 2)
 * @returns {string} SVG path `d`
 */
export function bogenPfad(r, a0, a1, spalt = 2) {
  const g = halberSpaltGrad(r, spalt);
  const p0 = punkt(r, a0 + g), p1 = punkt(r, a1 - g);
  const large = (a1 - a0 - 2 * g) > 180 ? 1 : 0;
  return `M ${p0.x} ${p0.y} A ${r2(r)} ${r2(r)} 0 ${large} 1 ${p1.x} ${p1.y}`;
}

/** Squares of the ring's inner/outer radii, computed once. */
const RI2 = RADIEN.ringInnen * RADIEN.ringInnen;
const RA2 = RADIEN.ringAussen * RADIEN.ringAussen;
/** Smallest radius that is still visibly distinct from the empty ring (viewBox units). */
const MIN_FUELLUNG_RADIUS = 77.5;

/**
 * Area-true fill radius for a share `anteil` (Eingänge / Skala) of the ring's
 * area, so equal AREAS (not equal radii) represent equal amounts. Any share
 * above 0 gets at least MIN_FUELLUNG_RADIUS, so a tiny but real amount stays
 * visible instead of disappearing into the empty ring; exactly 0 draws no
 * fill at all (null — the caller omits the `fuellung` element).
 * @param {number} anteil share of the scale, 0..1 (values above 1 are clamped)
 * @returns {number|null} radius, viewBox units, or null for zero/invalid input
 */
export function flaechentreuerRadius(anteil) {
  if (!Number.isFinite(anteil) || anteil <= 0) return null;
  const a = Math.min(anteil, 1);
  const r = Math.sqrt(RI2 + a * (RA2 - RI2));
  return r2(Math.max(r, MIN_FUELLUNG_RADIUS));
}

/** "Nice" scale steps (a decade multiplied by one of these). */
const SKALA_STUFEN = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

/**
 * Rounds a maximum monthly amount up to a "nice" scale value for the ring's
 * full radius (a fixed step table × a power of ten), so the legend can say
 * "full ring = X €" in a round number. An empty year (max 0) gets 1,000.
 * @param {number} max largest monthly amount to fit, Euro
 * @returns {number} the scale value, Euro
 */
export function skala(max) {
  const m = Number.isFinite(max) ? Math.max(max, 0) : 0;
  if (m <= 0) return 1000;
  const exp = Math.floor(Math.log10(m));
  for (let e = exp - 1; e <= exp + 2; e++) {
    const basis = 10 ** e;
    for (const f of SKALA_STUFEN) {
      const kandidat = f * basis;
      if (kandidat >= m - 1e-6) return Math.round(kandidat);
    }
  }
  return Math.round(m);
}

/** Ordered list of every symbol kind the clock can draw (also the legend's fixed order). */
export const SYMBOL_ARTEN = Object.freeze([
  "segment", "fuellung", "abfluss", "defizit", "steuer", "frist", "deckung-ok", "deckung-warn", "zeiger",
]);

/**
 * German source texts of the legend, one per symbol kind (abfluss has a
 * GmbH/UG variant, E-04). JahresuhrLegende.jsx renders each through a LITERAL
 * t() call with the same text (tests/unit/buchhaltung-jahresuhr.test.js
 * checks that), so the i18n guard sees every one of them.
 */
export const LEGENDE_TEXTE = Object.freeze({
  segment: "Graue Segmente: die 12 Monate — Januar oben, im Uhrzeigersinn",
  fuellung: "Füllstand: erwartete Zahlungseingänge des Monats (voller Ring = {skala}); reicht er über die Linie, ist der Monat gedeckt",
  abfluss: "Linie: erwartete Ausgaben, Entnahmen und Steuern des Monats",
  abflussGfGehalt: "Linie: erwartete Ausgaben einschließlich Geschäftsführergehalt und Steuern des Monats",
  defizit: "Schraffur: ungedeckter Teil — Abflüsse höher als Eingänge",
  steuer: "Schwarze Markierung: Steuerzahltag —",
  frist: "Rote Markierung: spätester Rechnungsversand = Steuertag − {ziel} Tage Zahlungsziel − {puffer} Tage Puffer",
  "deckung-ok": "Haken: Steuertermin gedeckt",
  "deckung-warn": "Warndreieck: Deckung des Steuertermins gefährdet",
  zeiger: "Zeiger: heute (aktueller Monat)",
});

/**
 * Merges same-kind entries whose angles differ by under 2° into one mark (the
 * earliest keeps its date; `anzahl` counts the merged ones). A shared
 * statutory date with several tax types arrives as ONE steuertag already.
 * @param {Array<{winkel: number, art: string, datum: string, arten?: string[], summeCent?: number|null}>} rohe
 * @returns {Array<{art: string, winkel: number, datum: string, arten: string[], summe: number|null, anzahl: number}>}
 */
function markenZusammenlegen(rohe) {
  const sortiert = [...rohe].sort((a, b) => a.winkel - b.winkel);
  /** @type {Array<{art: string, winkel: number, datum: string, arten: string[], summe: number|null, anzahl: number}>} */
  const aus = [];
  for (const roh of sortiert) {
    const vorhandene = aus.find((m) => m.art === roh.art && Math.abs(m.winkel - roh.winkel) < 2);
    if (vorhandene) {
      vorhandene.anzahl += 1;
      for (const a of roh.arten || []) if (!vorhandene.arten.includes(a)) vorhandene.arten.push(a);
      if (typeof roh.summeCent === "number" && typeof vorhandene.summe === "number") vorhandene.summe += roh.summeCent;
      else if (typeof roh.summeCent !== "number") vorhandene.summe = null;
      continue;
    }
    aus.push({
      art: roh.art, winkel: roh.winkel, datum: roh.datum, arten: [...(roh.arten || [])],
      summe: typeof roh.summeCent === "number" ? roh.summeCent : null, anzahl: 1,
    });
  }
  return aus;
}

/**
 * Geometry of one merged mark: path `d` (and for a deadline the hollow cap).
 * steuer = 4 px radial tick 127–139; frist = 2 px tick 127–149 plus a hollow
 * circle r 3 at 152.5; deckung-ok = check mark, deckung-warn = triangle, both
 * centred at r 164 (79-RESEARCH radii).
 * @param {string} art
 * @param {number} winkel degrees
 * @returns {{pfad: string, kreis: {cx: number, cy: number, r: number}|null}}
 */
function markenGeometrie(art, winkel) {
  if (art === "steuer") return { pfad: ringSektorPfad(RADIEN.steuerInnen, RADIEN.steuerAussen, winkel - 0.9, winkel + 0.9, 0), kreis: null };
  if (art === "frist") {
    const c = punkt(RADIEN.hohlkreis, winkel);
    return { pfad: ringSektorPfad(RADIEN.fristInnen, RADIEN.fristAussen, winkel - 0.4, winkel + 0.4, 0), kreis: { cx: c.x, cy: c.y, r: 3 } };
  }
  const c = punkt(RADIEN.deckung, winkel);
  if (art === "deckung-ok") {
    return { pfad: `M ${r2(c.x - 3.5)} ${r2(c.y)} L ${r2(c.x - 1)} ${r2(c.y + 2.5)} L ${r2(c.x + 3.5)} ${r2(c.y - 2.5)}`, kreis: null };
  }
  return { pfad: `M ${r2(c.x)} ${r2(c.y - 5)} L ${r2(c.x + 4.3)} ${r2(c.y + 3.5)} L ${r2(c.x - 4.3)} ${r2(c.y + 3.5)} Z`, kreis: null };
}

/**
 * @typedef {{nenn: string, arten: string[], gedeckt: boolean|null}} SegmentSteuertag
 * @typedef {{monat: number, basis: string, fuellung: {radius: number, pfad: string}|null,
 *   abflussBogen: {radius: number, pfad: string}|null, luecke: {von: number, bis: number, pfad: string}|null,
 *   label: string, labelPunkt: {x: number, y: number}, eingaengeCent: number, abflussCent: number,
 *   defizit: boolean, saldoEndeCent: number|null, steuertage: SegmentSteuertag[]}} Segment
 * @typedef {{art: string, winkel: number, datum: string, pfad: string, kreis: {cx: number, cy: number, r: number}|null,
 *   arten: string[], summe: number|null, anzahl: number}} Marke
 */

/**
 * Builds the full drawing model of the year clock. Deterministic (same input
 * → deep-equal output), every number finite and rounded to 2 decimals, no
 * path ever contains "NaN".
 * @param {{
 *   jahr: number,
 *   heute: string,
 *   monate: Array<{eingaengeCent: number, abflussCent: number, saldoEndeCent?: number}>,
 *   steuertage: Array<{arten: string[], nenn: string, betragCent: number|null, gedeckt: boolean|null, warnung: string|null}>,
 *   fristen: Array<{datum: string}>,
 *   monatsnamen: (monat: number) => string,
 * }} eingabe monate: twelve entries, January first, amounts in cents
 * @returns {{segmente: Segment[], marken: Marke[], ausserhalb: {fristen: number}, zeiger: number|null,
 *   zeigerSpitze: {x: number, y: number}|null, skala: number}} skala in cents (a full ring)
 */
export function uhrModell({ jahr, heute, monate, steuertage, fristen, monatsnamen }) {
  const monatsListe = Array.isArray(monate) && monate.length === 12 ? monate : Array.from({ length: 12 }, () => ({ eingaengeCent: 0, abflussCent: 0, saldoEndeCent: undefined }));
  // skala() works in Euro (an empty year: 1,000 €); the model keeps cents.
  const maxCent = Math.max(0, ...monatsListe.map((m) => Number(m.eingaengeCent) || 0), ...monatsListe.map((m) => Number(m.abflussCent) || 0));
  const skalaCent = Math.max(1, skala(maxCent / 100)) * 100;
  const tageListe = Array.isArray(steuertage) ? steuertage : [];

  const segmente = monatsListe.map((m, i) => {
    const monat = i + 1;
    const [a0, a1] = monatsWinkel(monat);
    const eingaenge = Math.max(0, Number(m.eingaengeCent) || 0);
    const abfluss = Math.max(0, Number(m.abflussCent) || 0);
    const rFuellung = flaechentreuerRadius(eingaenge / skalaCent);
    const rAbfluss = abfluss > 0 ? flaechentreuerRadius(abfluss / skalaCent) ?? RADIEN.ringInnen : null;
    const defizit = abfluss > eingaenge;
    const lueckeVon = rFuellung ?? RADIEN.ringInnen;
    const lueckeBis = rAbfluss ?? RADIEN.ringAussen;
    const mm = String(monat).padStart(2, "0");
    return {
      monat,
      basis: ringSektorPfad(RADIEN.ringInnen, RADIEN.ringAussen, a0, a1),
      fuellung: rFuellung === null ? null : { radius: rFuellung, pfad: ringSektorPfad(RADIEN.ringInnen, rFuellung, a0, a1) },
      abflussBogen: rAbfluss === null ? null : { radius: rAbfluss, pfad: bogenPfad(rAbfluss, a0, a1) },
      luecke: defizit ? { von: lueckeVon, bis: lueckeBis, pfad: ringSektorPfad(lueckeVon, lueckeBis, a0, a1) } : null,
      label: monatsnamen ? monatsnamen(monat) : String(monat),
      labelPunkt: punkt(RADIEN.monatslabel, (monat - 1) * 30),
      eingaengeCent: eingaenge, abflussCent: abfluss, defizit,
      saldoEndeCent: typeof m.saldoEndeCent === "number" && Number.isFinite(m.saldoEndeCent) ? m.saldoEndeCent : null,
      steuertage: tageListe
        .filter((st) => typeof st?.nenn === "string" && st.nenn.startsWith(`${jahr}-${mm}`))
        .map((st) => ({ nenn: st.nenn, arten: [...(st.arten || [])], gedeckt: st.gedeckt ?? null })),
    };
  });

  // Tax marks: one per steuertag entry at its statutory date, plus its coverage symbol.
  /** @type {Array<{winkel: number, art: string, datum: string, arten?: string[], summeCent?: number|null}>} */
  const roheMarken = [];
  for (const st of tageListe) {
    const winkel = datumsWinkel(st.nenn);
    if (winkel === null) continue;
    roheMarken.push({ winkel, art: "steuer", datum: st.nenn, arten: st.arten || [], summeCent: st.betragCent });
    if (st.gedeckt === true) roheMarken.push({ winkel, art: "deckung-ok", datum: st.nenn, arten: [], summeCent: null });
    else if (st.warnung === "knapp" || st.warnung === "ueberschritten" || st.gedeckt === false) roheMarken.push({ winkel, art: "deckung-warn", datum: st.nenn, arten: [], summeCent: null });
  }
  let ausserhalbFristen = 0;
  for (const f of fristen || []) {
    const jahrDerFrist = typeof f?.datum === "string" ? Number(f.datum.slice(0, 4)) : NaN;
    if (jahrDerFrist !== jahr) { if (Number.isFinite(jahrDerFrist)) ausserhalbFristen += 1; continue; }
    const winkel = datumsWinkel(f.datum);
    if (winkel === null) continue;
    roheMarken.push({ winkel, art: "frist", datum: f.datum, arten: [], summeCent: null });
  }
  const marken = markenZusammenlegen(roheMarken).map((m) => ({ ...m, ...markenGeometrie(m.art, m.winkel) }));

  const heuteJahr = typeof heute === "string" ? Number(heute.slice(0, 4)) : NaN;
  const zeiger = heuteJahr === jahr ? datumsWinkel(heute) : null;

  return {
    segmente, marken, ausserhalb: { fristen: ausserhalbFristen },
    zeiger, zeigerSpitze: zeiger === null ? null : punkt(RADIEN.zeigerAussen, zeiger), skala: skalaCent,
  };
}

/**
 * Ordered list of the symbol kinds an actual clock model draws (a subset of
 * SYMBOL_ARTEN) — the single source both the SVG (via data-symbol) and the
 * legend read, so they can never disagree.
 * @param {ReturnType<typeof uhrModell>} modell
 * @returns {string[]}
 */
export function symbolArten(modell) {
  const vorhanden = new Set(["segment"]);
  for (const s of modell.segmente) {
    if (s.fuellung) vorhanden.add("fuellung");
    if (s.abflussBogen) vorhanden.add("abfluss");
    if (s.luecke) vorhanden.add("defizit");
  }
  for (const m of modell.marken) vorhanden.add(m.art);
  if (modell.zeiger !== null) vorhanden.add("zeiger");
  return SYMBOL_ARTEN.filter((a) => vorhanden.has(a));
}

/**
 * Legend entries in the same order as symbolArten(modell) — one source for
 * the clock's drawn symbols and the accessible list beside it. Placeholders
 * `{ziel}`, `{puffer}`, `{skala}` are filled by the caller (literal t() text,
 * see JahresuhrLegende.jsx); the steuer text is composed there from the tax
 * kinds the office pays.
 * @param {ReturnType<typeof uhrModell>} modell
 * @param {{ziel?: number, puffer?: number, skalaText?: string, gfGehalt?: boolean}} [kontext]
 *   ziel/puffer in days (default BUERO_STANDARD), gfGehalt: GmbH/UG — the outflow
 *   line holds the managing director's salary instead of drawings (E-04)
 * @returns {Array<{symbol: string, textSchluessel: string, werte: Record<string, string|number>}>}
 */
export function legendeEintraege(modell, kontext = {}) {
  /** @type {Record<string, Record<string, string|number>>} */
  const WERTE = {
    fuellung: { skala: kontext.skalaText || "" },
    frist: { ziel: kontext.ziel ?? BUERO_STANDARD.zahlungsziel_tage, puffer: kontext.puffer ?? BUERO_STANDARD.puffer_tage },
  };
  return symbolArten(modell).map((a) => ({
    symbol: a,
    textSchluessel: a === "abfluss" && kontext.gfGehalt ? LEGENDE_TEXTE.abflussGfGehalt : LEGENDE_TEXTE[/** @type {keyof typeof LEGENDE_TEXTE} */ (a)],
    werte: WERTE[a] || {},
  }));
}

/**
 * Next month with the given key, wrapping around the year (roving tabindex).
 * @param {number} monat current month 1–12
 * @param {"ArrowLeft"|"ArrowRight"|"Home"|"End"} taste
 * @returns {number} 1–12
 */
export function naechsterMonat(monat, taste) {
  if (taste === "Home") return 1;
  if (taste === "End") return 12;
  if (taste === "ArrowRight") return monat >= 12 ? 1 : monat + 1;
  if (taste === "ArrowLeft") return monat <= 1 ? 12 : monat - 1;
  return monat;
}
