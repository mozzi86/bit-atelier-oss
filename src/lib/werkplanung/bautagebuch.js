// bautagebuch.js — construction diary of a project (88-02, RE-13/14): one entry per day
// with weather, companies (crew size, works), incidents, defects and hindrance; hints
// for bad weather and the bad-weather days that support a hindrance notice after
// VOB/B § 6 Abs. 1 (the letter itself is the correspondence's, 82-05).
//
// All weather rules are HINTS (warn, never fail): the site manager decides and
// documents protective measures; the thresholds are [ASSUMED] rules of thumb with
// their standard named, to be confirmed by the office.
//
// Data contract — entity `BautagebuchEintrag` (schemaless, new):
//   {project_id, datum 'YYYY-MM-DD', temp_min, temp_max (°C), niederschlag_mm (mm),
//    wind_kmh (km/h), wetter_text, wetter_quelle ('open-meteo'|'manuell'),
//    firmen: [{name, mannstaerke, arbeiten}], vorkommnisse, maengel,
//    behinderung (bool), behinderung_text, ersteller}
//
// In:  entries, the weather API answer. Out: neuerEintrag, normalisiereEintrag,
//      mannstaerke, schlechtwetterHinweise, istSchlechtwetterTag, schlechtwetterTage,
//      behinderungsKontext, wetterVorschlag.

/** Thresholds of the bad-weather rules (°C, mm, km/h) — [ASSUMED] rules of thumb. */
export const SCHWELLEN = Object.freeze({
  /** Concrete, screed, mortar: DIN EN 206 / DIN 1045-3 — below +5 °C protective measures. */
  betonMin: 5,
  /** Masonry: DIN EN 1996 — no laying on frozen ground or with frost. */
  frost: 0,
  /** Coating, plaster, waterproofing: any precipitation. */
  niederschlag: 0,
  /** Crane, scaffold, roof: wind speed from which work is checked. */
  wind: 50,
  /** A day counts as bad-weather day for a hindrance notice from here (mm / km/h / °C). */
  tagNiederschlag: 5,
  tagWind: 60,
  tagFrost: 0,
});

/** Works keywords per rule (German, as typed in the diary) — [ASSUMED] keyword lists. */
const STICHWORTE = Object.freeze({
  beton: /beton|estrich|mörtel|moertel|betonier/i,
  mauerwerk: /mauer|ziegel|ks-|kalksand/i,
  anstrich: /anstrich|maler|streich|putz|abdicht|beschicht|lackier/i,
  wind: /kran|gerüst|geruest|dach|montage|fassade/i,
});

/** @param {unknown} v @returns {number|null} */
const zahl = (v) => (v === "" || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * A new, empty entry for a day.
 * @param {{projectId: string, datum: string}} e
 * @returns {Record<string, any>}
 */
export function neuerEintrag({ projectId, datum }) {
  return {
    project_id: projectId, datum, temp_min: null, temp_max: null, niederschlag_mm: null, wind_kmh: null,
    wetter_text: "", wetter_quelle: "manuell", firmen: [{ name: "", mannstaerke: null, arbeiten: "" }],
    vorkommnisse: "", maengel: "", behinderung: false, behinderung_text: "", ersteller: "",
  };
}

/**
 * Cleans an entry: numbers as numbers, empty company rows removed, crew sizes ≥ 0.
 * @param {Record<string, any>} roh
 * @returns {Record<string, any>}
 */
export function normalisiereEintrag(roh) {
  const firmen = (Array.isArray(roh?.firmen) ? roh.firmen : [])
    .map((f) => ({ name: String(f?.name || "").trim(), mannstaerke: Math.max(0, Math.round(zahl(f?.mannstaerke) ?? 0)), arbeiten: String(f?.arbeiten || "").trim() }))
    .filter((f) => f.name || f.arbeiten || f.mannstaerke > 0);
  return {
    ...roh,
    temp_min: zahl(roh?.temp_min), temp_max: zahl(roh?.temp_max), niederschlag_mm: zahl(roh?.niederschlag_mm), wind_kmh: zahl(roh?.wind_kmh),
    wetter_text: String(roh?.wetter_text || ""), wetter_quelle: roh?.wetter_quelle === "open-meteo" ? "open-meteo" : "manuell",
    firmen, vorkommnisse: String(roh?.vorkommnisse || ""), maengel: String(roh?.maengel || ""),
    behinderung: roh?.behinderung === true, behinderung_text: String(roh?.behinderung_text || ""),
  };
}

/**
 * Total crew on site that day.
 * @param {Record<string, any>} eintrag
 * @returns {number} persons
 */
export function mannstaerke(eintrag) {
  return (eintrag?.firmen || []).reduce((s, f) => s + (zahl(f?.mannstaerke) ?? 0), 0);
}

/**
 * Bad-weather hints of an entry (warn only).
 * @param {Record<string, any>} eintrag
 * @returns {Array<{art: 'beton_kalt'|'mauerwerk_frost'|'anstrich_nass'|'wind', werte: Record<string, any>}>}
 */
export function schlechtwetterHinweise(eintrag) {
  const arbeiten = (eintrag?.firmen || []).map((f) => `${f?.arbeiten || ""} ${f?.name || ""}`).join(" | ");
  const tmin = zahl(eintrag?.temp_min);
  const regen = zahl(eintrag?.niederschlag_mm);
  const wind = zahl(eintrag?.wind_kmh);
  /** @type {Array<{art: any, werte: Record<string, any>}>} */
  const aus = [];
  if (tmin !== null && tmin < SCHWELLEN.betonMin && STICHWORTE.beton.test(arbeiten)) aus.push({ art: "beton_kalt", werte: { temp: tmin, grenze: SCHWELLEN.betonMin } });
  if (tmin !== null && tmin < SCHWELLEN.frost && STICHWORTE.mauerwerk.test(arbeiten)) aus.push({ art: "mauerwerk_frost", werte: { temp: tmin } });
  if (regen !== null && regen > SCHWELLEN.niederschlag && STICHWORTE.anstrich.test(arbeiten)) aus.push({ art: "anstrich_nass", werte: { mm: regen } });
  if (wind !== null && wind >= SCHWELLEN.wind && STICHWORTE.wind.test(arbeiten)) aus.push({ art: "wind", werte: { kmh: wind, grenze: SCHWELLEN.wind } });
  return aus;
}

/**
 * Whether a day counts as bad-weather day (frost, heavy precipitation, storm) or a
 * hindrance was recorded.
 * @param {Record<string, any>} eintrag
 * @returns {boolean}
 */
export function istSchlechtwetterTag(eintrag) {
  const tmin = zahl(eintrag?.temp_min);
  const regen = zahl(eintrag?.niederschlag_mm);
  const wind = zahl(eintrag?.wind_kmh);
  return eintrag?.behinderung === true
    || (tmin !== null && tmin < SCHWELLEN.tagFrost)
    || (regen !== null && regen >= SCHWELLEN.tagNiederschlag)
    || (wind !== null && wind >= SCHWELLEN.tagWind);
}

/**
 * Bad-weather days of a period, sorted by date.
 * @param {ReadonlyArray<Record<string, any>>} eintraege
 * @param {{von?: string, bis?: string}} [zeitraum]
 * @returns {Array<Record<string, any>>}
 */
export function schlechtwetterTage(eintraege, { von = "0000-01-01", bis = "9999-12-31" } = {}) {
  return (eintraege || []).filter((e) => e?.datum >= von && e.datum <= bis && istSchlechtwetterTag(e)).sort((a, b) => String(a.datum).localeCompare(String(b.datum)));
}

/** @param {string} iso @returns {string} 'DD.MM.YYYY' */
const de = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

/**
 * Placeholder data of a hindrance notice from the diary: the period of consecutive
 * documented bad-weather days around an entry and a German text of the recorded
 * weather (document content, not UI).
 * @param {ReadonlyArray<Record<string, any>>} eintraege all entries of the project
 * @param {string} eintragId the entry the notice starts from
 * @returns {{zeitraum: string, tage: number, text: string}|null}
 */
export function behinderungsKontext(eintraege, eintragId) {
  const alle = [...(eintraege || [])].sort((a, b) => String(a.datum).localeCompare(String(b.datum)));
  const start = alle.find((e) => e.id === eintragId);
  if (!start) return null;
  const tage = alle.filter((e) => istSchlechtwetterTag(e) && e.datum >= start.datum).slice(0, 31);
  const liste = tage.length ? tage : [start];
  const zeilen = liste.map((e) => {
    const teile = [
      e.temp_min !== null && e.temp_min !== undefined ? `Tiefstwert ${String(e.temp_min).replace(".", ",")} °C` : "",
      e.niederschlag_mm ? `Niederschlag ${String(e.niederschlag_mm).replace(".", ",")} mm` : "",
      e.wind_kmh ? `Wind ${e.wind_kmh} km/h` : "",
      e.behinderung_text || e.vorkommnisse || "",
    ].filter(Boolean);
    return `${de(e.datum)}: ${teile.join(", ")}`;
  });
  const von = liste[0].datum;
  const bis = liste[liste.length - 1].datum;
  return { zeitraum: von === bis ? de(von) : `${de(von)} – ${de(bis)}`, tage: liste.length, text: zeilen.join("; ") };
}

/**
 * Weather suggestion from the weather API answer — only a real reading
 * (source 'open-meteo'); the offline fallback is never taken over silently.
 * @param {Record<string, any>|null|undefined} w answer of /api/weather
 * @returns {{temp_min: number, temp_max: number, niederschlag_mm: number, wind_kmh: number, wetter_text: string, wetter_quelle: 'open-meteo'}|null}
 */
export function wetterVorschlag(w) {
  if (!w || w.source !== "open-meteo" || !Number.isFinite(Number(w.temperature))) return null;
  const t = Math.round(Number(w.temperature) * 10) / 10;
  return { temp_min: t, temp_max: t, niederschlag_mm: Number(w.precipitation) || 0, wind_kmh: Math.round(Number(w.wind_speed) || 0), wetter_text: String(w.condition || ""), wetter_quelle: "open-meteo" };
}
