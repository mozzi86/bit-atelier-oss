// wohneinheiten.js — the apartment as a stored object (99-01). Until now apartments were only
// computed (tesseliere().weListe of the apartment workshop, riegelLayout() of the massing
// bars) and got new ids on every re-cut. A buyer, a special request or a deadline needs an
// apartment that keeps its number. This module turns the computed units into candidates,
// matches them against the stored apartments and says what changed — it never renumbers.
//
// Data contract — entity `Wohneinheit` (schemaless, new):
//   {project_id, nr ("W-001", stable, never reused), geschoss (storey index, 0 = ground
//    floor), typ (type name), typ_key, zimmer (rooms|null), flaeche_m2 (m², net area of the
//    source), umriss [{x, y}] (m, frame of the source: workshop = footprint-centred, bar =
//    site metres), quelle 'werkstatt'|'riegel', quelle_ref (unit id in the source at the
//    last match, e.g. "WE 0-1" or "r1-2|0|3"), status 'frei'|'reserviert'|'verkauft',
//    kaeufer (text, placeholder name of the buyer), bauabschnitt (text, for the deadline of
//    99-03), entfallen (bool: unit no longer in the model — kept, never deleted),
//    uebernommen_am / abgleich_am (ISO)}
//
// In:  tesseliere() result, massing_layer.riegel, stored Wohneinheit rows.
// Out: candidates, match result with reported deviations, write plan (create / patch).
// Pure — no React, no API.

import { werkstattErgebnisAusLayer } from "@designer/lib/useWerkstattRehydrate";
import { einheitenAnreichern } from "@designer/lib/werkstattDefaults";
import { riegelLayout } from "@core/lib/massing/riegel";
import { konvexeHuelle, clipSutherlandHodgman, flaecheM2 } from "@core/lib/polygonInnen";

/** Sales status of an apartment (labels double as i18n keys). */
export const WOHNUNG_STATUS = Object.freeze([
  Object.freeze({ key: "frei", label: "frei" }),
  Object.freeze({ key: "reserviert", label: "reserviert" }),
  Object.freeze({ key: "verkauft", label: "verkauft" }),
]);

/**
 * [ASSUMED] minimum overlap (share of the smaller outline, 0…1) for "same apartment" after a
 * re-cut. 0.5: a unit that moved by less than half its width is still the same unit. Which of
 * several eligible pairs wins is decided by the intersection over union (see abgleichen), so a
 * unit that was split in two keeps its number on the larger half, the other half is new.
 */
export const UEBERLAPP_MIN = 0.5;

/** [ASSUMED] area change (m²) below which a re-cut is not reported (rounding of the solver). */
export const FLAECHE_TOLERANZ_M2 = 0.5;

/**
 * @typedef {{x: number, y: number}} Punkt
 * @typedef {{
 *   quelle: 'werkstatt'|'riegel', quelle_ref: string, geschoss: number, typ: string,
 *   typ_key: string, zimmer: number|null, flaeche_m2: number, umriss: Punkt[],
 * }} Kandidat a unit of the model (not stored yet); flaeche_m2 in m², umriss in m
 * @typedef {{
 *   id?: string, nr?: string, geschoss?: number, typ?: string, typ_key?: string, zimmer?: number|null,
 *   flaeche_m2?: number, umriss?: Punkt[], quelle?: string, quelle_ref?: string, status?: string,
 *   kaeufer?: string, bauabschnitt?: string, entfallen?: boolean,
 * }} WohneinheitRecord
 * @typedef {{feld: 'flaeche_m2'|'typ'|'zimmer'|'entfallen', alt: any, neu: any}} Abweichung
 */

const r2 = (/** @type {number} */ v) => Math.round(v * 100) / 100;
const num = (/** @type {unknown} */ v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * German storey label: 0 → "EG", 1 → "1. OG", −1 → "1. UG".
 * @param {number} level storey index
 * @returns {string}
 */
export function geschossLabel(level) {
  const n = Math.round(num(level));
  if (n === 0) return "EG";
  return n > 0 ? `${n}. OG` : `${-n}. UG`;
}

/**
 * German label of a sales status.
 * @param {unknown} s
 * @returns {string}
 */
export function wohnungStatusLabel(s) {
  return WOHNUNG_STATUS.find((x) => x.key === s)?.label || String(s || "");
}

/**
 * Rooms from a type name ("3-Zimmer-Wohnung", "2-Zi") — null when the name has no number
 * (corner unit of a bar).
 * @param {unknown} name
 * @returns {number|null}
 */
export function zimmerAusName(name) {
  const m = /(\d+)\s*-?\s*Zi/i.exec(String(name || ""));
  return m ? Number(m[1]) : null;
}

/**
 * Candidates from a workshop result: one per weListe entry. The outline is the convex hull
 * of the unit's zones on its storey — exact for the rectangular units of the solver, an
 * envelope for a cut corner [ASSUMED: enough to recognise the unit after a re-cut].
 * Units over several storeys (terraced house) stay ONE apartment on the storey of the entry.
 * @param {{weListe?: any[], zonen?: any[]}|null|undefined} ergebnis tesseliere() result
 * @param {Array<{key?: string, name?: string, zimmer?: number}>} [einheiten] mix of the layer (type names)
 * @returns {Kandidat[]}
 */
export function kandidatenAusWerkstatt(ergebnis, einheiten = []) {
  const liste = Array.isArray(ergebnis?.weListe) ? ergebnis.weListe : [];
  const zonen = Array.isArray(ergebnis?.zonen) ? ergebnis.zonen : [];
  /** @type {Kandidat[]} */
  const out = [];
  const gesehen = new Set();
  for (const w of liste) {
    const we = String(w?.we || "");
    if (!we || gesehen.has(we)) continue;
    gesehen.add(we);
    const level = Math.round(num(w.level));
    const punkte = zonen.filter((z) => z?.we === we && Math.round(num(z.level)) === level)
      .flatMap((z) => (Array.isArray(z.points) ? z.points : []))
      .map((p) => ({ x: num(p.x), y: num(p.z ?? p.y) }));
    const typ = (einheiten || []).find((e) => e?.key === w.typKey);
    const name = String(typ?.name || w.typKey || "");
    out.push({
      quelle: "werkstatt", quelle_ref: we, geschoss: level, typ: name, typ_key: String(w.typKey || ""),
      zimmer: Number.isFinite(Number(typ?.zimmer)) ? Number(typ?.zimmer) : zimmerAusName(name),
      flaeche_m2: r2(num(w.flaeche_m2)), umriss: punkte.length >= 3 ? konvexeHuelle(punkte) : [],
    });
  }
  return out;
}

/**
 * Candidates from the massing bars (massing_layer.riegel, 98-09): every unit of the storey
 * layout on every storey. A bar that cannot be laid out (broken path) is skipped.
 * @param {Array<{id?: string, pfad?: Punkt[], opt?: any}>|null|undefined} riegel
 * @returns {Kandidat[]}
 */
export function kandidatenAusRiegel(riegel) {
  /** @type {Kandidat[]} */
  const out = [];
  for (const r of Array.isArray(riegel) ? riegel : []) {
    let layout;
    try { layout = riegelLayout(/** @type {Punkt[]} */ (r?.pfad), r?.opt || {}); } catch { continue; }
    const geschosse = Math.max(1, Math.round(num(layout.kennzahlen.geschosse) || 1));
    for (let g = 0; g < geschosse; g++) {
      layout.einheiten.forEach((e, i) => {
        out.push({
          quelle: "riegel", quelle_ref: `${r?.id || "r"}|${g}|${i}`, geschoss: g, typ: e.typ, typ_key: e.typ,
          zimmer: zimmerAusName(e.typ), flaeche_m2: r2(flaecheM2(e.profil)), umriss: e.profil.map((p) => ({ x: p.x, y: p.y })),
        });
      });
    }
  }
  return out;
}

/**
 * All candidates of a project's BimModel: workshop units when the tessellation is applied,
 * plus the massing bars. Without footprint/applied layer and without bars → [].
 * @param {any} modell BimModel record (footprintM, storeys, storeyHeight, achseM, werkstatt_layer, massing_layer)
 * @returns {Kandidat[]}
 */
export function kandidatenAusModell(modell) {
  if (!modell) return [];
  /** @type {Kandidat[]} */
  const out = [];
  const layer = modell.werkstatt_layer;
  if (layer?.angewendet === true && Array.isArray(modell.footprintM) && modell.footprintM.length >= 3) {
    const s = { footprintM: modell.footprintM, storeys: modell.storeys || 4, storeyHeight: modell.storeyHeight || 3, achseM: modell.achseM ?? null };
    // One solver config for workshop, rehydrate and 99-01; type names from the same enriched mix.
    out.push(...kandidatenAusWerkstatt(werkstattErgebnisAusLayer(layer, s), einheitenAnreichern(layer.einheiten)));
  }
  out.push(...kandidatenAusRiegel(modell.massing_layer?.riegel));
  return out;
}

/**
 * Overlap of two outlines as share of the smaller one (0…1), on their convex hulls.
 * @param {Punkt[]} a outline (m)
 * @param {Punkt[]} b outline (m)
 * @returns {number}
 */
export function ueberlappung(a, b) {
  return ueberlappungMasse(a, b).anteil;
}

/**
 * Both overlap measures of two outlines, on their convex hulls:
 * `anteil` = intersection / smaller area (0…1, decides whether a pair is eligible: a moved
 * unit stays the same unit) and `iou` = intersection / union (0…1, ranks eligible pairs: a
 * split unit's halves both have anteil 1, but the larger half has the larger iou).
 * @param {Punkt[]} a outline (m)
 * @param {Punkt[]} b outline (m)
 * @returns {{anteil: number, iou: number}}
 */
export function ueberlappungMasse(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length < 3 || b.length < 3) return { anteil: 0, iou: 0 };
  const ha = konvexeHuelle(a), hb = konvexeHuelle(b);
  const fa = flaecheM2(ha), fb = flaecheM2(hb);
  if (!(fa > 0 && fb > 0)) return { anteil: 0, iou: 0 };
  const schnitt = Math.min(flaecheM2(clipSutherlandHodgman(ha, hb)), fa, fb);
  return { anteil: Math.min(1, schnitt / Math.min(fa, fb)), iou: Math.min(1, schnitt / (fa + fb - schnitt)) };
}

/**
 * Deviations between a stored apartment and its candidate (what a buyer would notice).
 * @param {WohneinheitRecord} w
 * @param {Kandidat} k
 * @returns {Abweichung[]}
 */
export function abweichungenVon(w, k) {
  /** @type {Abweichung[]} */
  const a = [];
  if (w.entfallen === true) a.push({ feld: "entfallen", alt: true, neu: false });
  if (Math.abs(num(w.flaeche_m2) - num(k.flaeche_m2)) > FLAECHE_TOLERANZ_M2) a.push({ feld: "flaeche_m2", alt: num(w.flaeche_m2), neu: k.flaeche_m2 });
  if (String(w.typ_key || "") !== String(k.typ_key || "")) a.push({ feld: "typ", alt: w.typ || "", neu: k.typ });
  if ((w.zimmer ?? null) !== (k.zimmer ?? null)) a.push({ feld: "zimmer", alt: w.zimmer ?? null, neu: k.zimmer ?? null });
  return a;
}

/**
 * Matches the model's candidates against the stored apartments. Same source and storey only;
 * a pair is eligible with an outline overlap ≥ UEBERLAPP_MIN (share of the smaller outline),
 * without outlines by the source id. Eligible pairs are taken by the larger intersection over
 * union first — a split unit keeps its number on the larger half. Active apartments are
 * matched before ones already marked `entfallen` (a unit that comes back at the same place
 * gets its old number back).
 * @param {WohneinheitRecord[]} bestand stored apartments of the project
 * @param {Kandidat[]} kandidaten units of the current model
 * @returns {{
 *   gleich: Array<{wohnung: WohneinheitRecord, kandidat: Kandidat}>,
 *   geaendert: Array<{wohnung: WohneinheitRecord, kandidat: Kandidat, abweichungen: Abweichung[]}>,
 *   neu: Kandidat[], entfallen: WohneinheitRecord[],
 * }}
 */
export function abgleichen(bestand, kandidaten) {
  const alle = (bestand || []).filter(Boolean);
  const ks = (kandidaten || []).filter(Boolean);
  /** @type {Array<{w: number, k: number, wert: number, rang: number}>} */
  const paare = [];
  alle.forEach((w, wi) => {
    ks.forEach((k, ki) => {
      if (String(w.quelle || "") !== k.quelle || Math.round(num(w.geschoss)) !== k.geschoss) return;
      const geo = Array.isArray(w.umriss) && w.umriss.length >= 3 && k.umriss.length >= 3;
      const gleicheRef = String(w.quelle_ref || "") === k.quelle_ref ? 1 : 0;
      const m = geo ? ueberlappungMasse(/** @type {Punkt[]} */ (w.umriss), k.umriss) : { anteil: gleicheRef, iou: gleicheRef };
      // wert = iou rounded to 1e-6 so solver noise does not outweigh the source-id tie-break.
      if (m.anteil >= UEBERLAPP_MIN) paare.push({ w: wi, k: ki, wert: Math.round(m.iou * 1e6) / 1e6, rang: w.entfallen === true ? 1 : 0 });
    });
  });
  // Active before dropped, then the larger intersection over union, then the same source id,
  // then stable order.
  paare.sort((a, b) => (a.rang - b.rang) || (b.wert - a.wert)
    || (Number(ks[b.k].quelle_ref === alle[b.w].quelle_ref) - Number(ks[a.k].quelle_ref === alle[a.w].quelle_ref))
    || (a.w - b.w) || (a.k - b.k));
  const wFrei = new Set(alle.map((_, i) => i));
  const kFrei = new Set(ks.map((_, i) => i));
  const gleich = [], geaendert = [];
  for (const p of paare) {
    if (!wFrei.has(p.w) || !kFrei.has(p.k)) continue;
    wFrei.delete(p.w); kFrei.delete(p.k);
    const abw = abweichungenVon(alle[p.w], ks[p.k]);
    if (abw.length) geaendert.push({ wohnung: alle[p.w], kandidat: ks[p.k], abweichungen: abw });
    else gleich.push({ wohnung: alle[p.w], kandidat: ks[p.k] });
  }
  return {
    gleich, geaendert,
    neu: [...kFrei].map((i) => ks[i]),
    // Already dropped ones are not reported again.
    entfallen: [...wFrei].map((i) => alle[i]).filter((w) => w.entfallen !== true),
  };
}

/**
 * Next free apartment number "W-001" … — the highest number ever given + 1, so a dropped
 * apartment's number is never reused.
 * @param {WohneinheitRecord[]} alle
 * @returns {string}
 */
export function naechsteWohnungNr(alle) {
  const max = (alle || []).reduce((m, w) => {
    const n = /^W-(\d+)$/.exec(String(w?.nr || ""));
    return n ? Math.max(m, Number(n[1])) : m;
  }, 0);
  return `W-${String(max + 1).padStart(3, "0")}`;
}

/** Reading order of new units: storey, then front to back, left to right (outline centre, m). */
function leseReihenfolge(/** @type {Kandidat} */ a, /** @type {Kandidat} */ b) {
  const m = (/** @type {Kandidat} */ k) => {
    const p = k.umriss.length ? k.umriss : [{ x: 0, y: 0 }];
    return { x: p.reduce((s, q) => s + q.x, 0) / p.length, y: p.reduce((s, q) => s + q.y, 0) / p.length };
  };
  const ma = m(a), mb = m(b);
  return (a.geschoss - b.geschoss) || (Math.round(ma.y) - Math.round(mb.y)) || (ma.x - mb.x) || a.quelle_ref.localeCompare(b.quelle_ref, "de", { numeric: true });
}

/** Stored fields taken from a candidate (geometry and type; sales data is never touched). */
function modellFelder(/** @type {Kandidat} */ k) {
  return { geschoss: k.geschoss, typ: k.typ, typ_key: k.typ_key, zimmer: k.zimmer, flaeche_m2: k.flaeche_m2, umriss: k.umriss, quelle: k.quelle, quelle_ref: k.quelle_ref };
}

/**
 * Write plan of a match: new apartments with the next free numbers, patches for matched ones
 * (model fields only — status, buyer and construction section stay), dropped ones marked.
 * @param {ReturnType<typeof abgleichen>} ergebnis
 * @param {{projectId: string, alle: WohneinheitRecord[], jetzt?: Date}} k alle = every stored apartment (number pool)
 * @returns {{anlegen: Array<Record<string, any>>, aendern: Array<{id: string, patch: Record<string, any>}>}}
 */
export function abgleichPlan(ergebnis, { projectId, alle, jetzt = new Date() }) {
  const am = jetzt.toISOString();
  let pool = [...(alle || [])];
  const anlegen = [...ergebnis.neu].sort(leseReihenfolge).map((k) => {
    const rec = { project_id: projectId, nr: naechsteWohnungNr(pool), ...modellFelder(k), status: "frei", kaeufer: "", bauabschnitt: "", entfallen: false, uebernommen_am: am, abgleich_am: am };
    pool = [...pool, rec];
    return rec;
  });
  /** @type {Array<{id: string, patch: Record<string, any>}>} */
  const aendern = [];
  for (const { wohnung, kandidat } of [...ergebnis.gleich, ...ergebnis.geaendert]) {
    if (!wohnung.id) continue;
    aendern.push({ id: wohnung.id, patch: { ...modellFelder(kandidat), entfallen: false, abgleich_am: am } });
  }
  for (const w of ergebnis.entfallen) if (w.id) aendern.push({ id: w.id, patch: { entfallen: true, abgleich_am: am } });
  return { anlegen, aendern };
}

/**
 * Reported deviations of a match, one line per apartment, most serious first. `warn` when
 * the apartment is reserved/sold or carries special requests (a contract or a decision hangs
 * on it — the program reports, people decide); `hinweis` otherwise. Never blocks: a re-cut
 * is a design decision.
 * @param {ReturnType<typeof abgleichen>} ergebnis
 * @param {Set<string>} [mitWuenschen] ids of apartments with special requests
 * @returns {Array<{nr: string, art: 'geaendert'|'entfallen'|'neu', stufe: 'warn'|'hinweis', abweichungen: Abweichung[], text: string}>}
 */
export function abgleichMeldungen(ergebnis, mitWuenschen = new Set()) {
  const ernst = (/** @type {WohneinheitRecord} */ w) => (w.status && w.status !== "frei") || (w.id ? mitWuenschen.has(w.id) : false);
  const zeilen = [
    ...ergebnis.geaendert.map(({ wohnung, abweichungen }) => ({
      nr: String(wohnung.nr || ""), art: /** @type {const} */ ("geaendert"), stufe: /** @type {'warn'|'hinweis'} */ (ernst(wohnung) ? "warn" : "hinweis"), abweichungen,
      text: abweichungen.map((a) => (a.feld === "flaeche_m2" ? `Fläche ${fmt(a.alt)} → ${fmt(a.neu)} m²` : a.feld === "entfallen" ? "wieder im Modell" : a.feld === "typ" ? `Typ ${a.alt || "—"} → ${a.neu || "—"}` : `Zimmer ${a.alt ?? "—"} → ${a.neu ?? "—"}`)).join(" · "),
    })),
    ...ergebnis.entfallen.map((w) => ({ nr: String(w.nr || ""), art: /** @type {const} */ ("entfallen"), stufe: /** @type {'warn'|'hinweis'} */ (ernst(w) ? "warn" : "hinweis"), abweichungen: [], text: "nicht mehr im Modell" })),
    ...ergebnis.neu.map((k) => ({ nr: "", art: /** @type {const} */ ("neu"), stufe: /** @type {'warn'|'hinweis'} */ ("hinweis"), abweichungen: [], text: `${geschossLabel(k.geschoss)} · ${k.typ || "—"} · ${fmt(k.flaeche_m2)} m²` })),
  ];
  return zeilen.sort((a, b) => (a.stufe === b.stufe ? 0 : a.stufe === "warn" ? -1 : 1));
}

/** German number with up to two decimals. */
function fmt(/** @type {unknown} */ v) {
  return num(v).toLocaleString("de-DE", { maximumFractionDigits: 2 });
}

/**
 * Bounding box of all outlines of one storey (m) — the frame of the plan drawing.
 * @param {WohneinheitRecord[]} wohnungen
 * @returns {{minX: number, minY: number, maxX: number, maxY: number}|null}
 */
export function planRahmen(wohnungen) {
  const p = (wohnungen || []).flatMap((w) => (Array.isArray(w.umriss) ? w.umriss : []));
  if (!p.length) return null;
  return {
    minX: Math.min(...p.map((q) => q.x)), minY: Math.min(...p.map((q) => q.y)),
    maxX: Math.max(...p.map((q) => q.x)), maxY: Math.max(...p.map((q) => q.y)),
  };
}

/**
 * Patch of the sales data of an apartment (status, buyer, construction section) from form
 * values — model fields and the number are never part of it (they belong to the match).
 * Unknown status → unchanged. A buyer on a 'frei' apartment is kept [ASSUMED: an interested
 * party may be noted before the reservation; the sales module 99-08 will separate them].
 * @param {WohneinheitRecord} w stored apartment
 * @param {{status?: string, kaeufer?: string, bauabschnitt?: string}} werte form values
 * @returns {{status: string, kaeufer: string, bauabschnitt: string}|null} null = nothing changed
 */
export function wohnungPatch(w, werte) {
  const status = WOHNUNG_STATUS.some((s) => s.key === werte?.status) ? String(werte.status) : String(w?.status || "frei");
  const kaeufer = String(werte?.kaeufer ?? w?.kaeufer ?? "").trim();
  const bauabschnitt = String(werte?.bauabschnitt ?? w?.bauabschnitt ?? "").trim();
  if (status === (w?.status || "frei") && kaeufer === String(w?.kaeufer || "") && bauabschnitt === String(w?.bauabschnitt || "")) return null;
  return { status, kaeufer, bauabschnitt };
}

/**
 * Transform of model metres into SVG pixels for the plan drawing of one storey: uniform
 * scale, y of the outline = downwards on the sheet (workshop z / site y), margin around.
 * @param {{minX: number, minY: number, maxX: number, maxY: number}|null} rahmen bounding box (m)
 * @param {number} breitePx drawing width (px)
 * @param {number} hoehePx drawing height (px)
 * @param {number} [randPx] margin (px)
 * @returns {{massstab: number, punkt: (p: Punkt) => Punkt}} massstab in px per m
 */
export function planTransform(rahmen, breitePx, hoehePx, randPx = 16) {
  if (!rahmen) return { massstab: 1, punkt: (p) => ({ x: p.x, y: p.y }) };
  const bm = Math.max(rahmen.maxX - rahmen.minX, 1e-6), hm = Math.max(rahmen.maxY - rahmen.minY, 1e-6);
  const massstab = Math.min((breitePx - 2 * randPx) / bm, (hoehePx - 2 * randPx) / hm);
  const ox = (breitePx - bm * massstab) / 2, oy = (hoehePx - hm * massstab) / 2;
  return { massstab, punkt: (p) => ({ x: ox + (p.x - rahmen.minX) * massstab, y: oy + (p.y - rahmen.minY) * massstab }) };
}
