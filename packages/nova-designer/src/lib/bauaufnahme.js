// 73-09: the survey of an existing building as data — deliveries (method, accuracy class, provider,
// registration report, date) and the georeference (project origin, finished-floor level of the ground
// floor as NHN height, rotation). Stored in its own Fachlayer field `bauaufnahme_layer` (KD-17: one
// writer per field — BauaufnahmePanel).
//
// Deliberately NO point-cloud rendering here: a registered office scan is tens to hundreds of millions of
// points and gigabytes (E57/RCP); reading and tiling it belongs outside the browser (73-20 research, 73-21
// harness skill). This tab records WHAT was delivered and HOW the model is placed, and shows the two ways
// the measured data already flows (outline from the model, room programme from the survey state).
//
// In:  stored layer (any shape) or user patches. Out: hardened layer, checks with plain-text warnings.

/** Survey methods (German labels for the UI). */
export const VERFAHREN = Object.freeze({
  tls: "Terrestrisches Laserscanning (TLS)",
  slam: "Mobiles Scanning (SLAM)",
  photogrammetrie: "Photogrammetrie",
  handaufmass: "Handaufmaß / Tachymetrie",
});

/** Accuracy classes after the USIBD Level of Accuracy specification [ASSUMED as office vocabulary; the
 * contract may name tolerances directly]: upper bound of the measured deviation in mm (2σ). */
export const GENAUIGKEIT = Object.freeze({
  LOA10: { label: "LOA10 (> 50 mm)", mm: null },
  LOA20: { label: "LOA20 (15–50 mm)", mm: 50 },
  LOA30: { label: "LOA30 (5–15 mm)", mm: 15 },
  LOA40: { label: "LOA40 (1–5 mm)", mm: 5 },
  LOA50: { label: "LOA50 (0–1 mm)", mm: 1 },
});

/** Empty layer. Coordinates in m, rotation in degrees (clockwise from grid north). */
export const BAUAUFNAHME_DEFAULT = Object.freeze({
  lieferungen: [],
  georeferenz: { crs: "", nullpunkt_e: null, nullpunkt_n: null, okff_eg_nhn: null, drehung_grad: null },
});

const zahl = (v) => (v === "" || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const text = (v) => (typeof v === "string" ? v : "");

/**
 * Normalise a stored layer: unknown keys dropped, numbers as numbers or null, every delivery with an id.
 * @param {any} raw
 * @returns {{lieferungen: Array<{id: string, verfahren: string, genauigkeit: string, dienstleister: string, bericht: string, datum: string, bemerkung: string}>, georeferenz: {crs: string, nullpunkt_e: number|null, nullpunkt_n: number|null, okff_eg_nhn: number|null, drehung_grad: number|null}}}
 */
export function bauaufnahmeHardened(raw) {
  const l = raw && typeof raw === "object" ? raw : {};
  const g = l.georeferenz && typeof l.georeferenz === "object" ? l.georeferenz : {};
  return {
    lieferungen: (Array.isArray(l.lieferungen) ? l.lieferungen : []).map((x, i) => ({
      id: text(x?.id) || `lf-${i + 1}`,
      verfahren: Object.prototype.hasOwnProperty.call(VERFAHREN, x?.verfahren) ? x.verfahren : "",
      genauigkeit: Object.prototype.hasOwnProperty.call(GENAUIGKEIT, x?.genauigkeit) ? x.genauigkeit : "",
      dienstleister: text(x?.dienstleister), bericht: text(x?.bericht), datum: text(x?.datum), bemerkung: text(x?.bemerkung),
    })),
    georeferenz: {
      crs: text(g.crs), nullpunkt_e: zahl(g.nullpunkt_e), nullpunkt_n: zahl(g.nullpunkt_n),
      okff_eg_nhn: zahl(g.okff_eg_nhn), drehung_grad: zahl(g.drehung_grad),
    },
  };
}

/**
 * Add an empty delivery with the next free id.
 * @param {ReturnType<typeof bauaufnahmeHardened>} layer
 * @returns {ReturnType<typeof bauaufnahmeHardened>}
 */
export function lieferungHinzu(layer) {
  const ids = new Set(layer.lieferungen.map((x) => x.id));
  let n = layer.lieferungen.length + 1;
  while (ids.has(`lf-${n}`)) n += 1;
  return { ...layer, lieferungen: [...layer.lieferungen, { id: `lf-${n}`, verfahren: "", genauigkeit: "", dienstleister: "", bericht: "", datum: "", bemerkung: "" }] };
}

/**
 * Checks of the georeference and the deliveries — warn/offen only (planning aid, no survey approval).
 * The UTM trap: UTM grid coordinates are distorted (scale factor 0.9996 at the central meridian, growing
 * towards the zone edge, plus the height reduction) — a model built in UTM metres is up to several cm per
 * 100 m off the real building [ASSUMED order of magnitude for Bavaria]. Keep the model in local project
 * coordinates and convert only at the origin.
 * @param {ReturnType<typeof bauaufnahmeHardened>} layer
 * @returns {Array<{key: string, status: "warn"|"offen", text: string}>}
 */
export function bauaufnahmeChecks(layer) {
  /** @type {Array<{key: string, status: "warn"|"offen", text: string}>} */
  const out = [];
  const g = layer.georeferenz;
  if (!layer.lieferungen.length) out.push({ key: "keine_lieferung", status: "offen", text: "Noch keine Lieferung eingetragen — Verfahren, Genauigkeit und Registrierbericht gehören zur Bauaufnahme." });
  for (const l of layer.lieferungen) {
    if (!l.genauigkeit) out.push({ key: `genauigkeit_${l.id}`, status: "warn", text: `Lieferung ${l.datum || l.id}: Genauigkeitsklasse fehlt — ohne sie ist „gemessen“ keine prüfbare Zusage.` });
    if (l.verfahren && l.verfahren !== "handaufmass" && !l.bericht) out.push({ key: `bericht_${l.id}`, status: "warn", text: `Lieferung ${l.datum || l.id}: Registrierbericht fehlt (Restabweichungen der Scanpositionen).` });
  }
  const eGross = g.nullpunkt_e != null && Math.abs(g.nullpunkt_e) >= 100000;
  const nGross = g.nullpunkt_n != null && Math.abs(g.nullpunkt_n) >= 1000000;
  if (eGross || nGross || /utm|25832|25833/i.test(g.crs)) {
    out.push({ key: "utm", status: "warn", text: "UTM-Koordinaten erkannt: UTM-Meter sind verzerrt (Maßstab 0,9996 und Höhenreduktion, je nach Lage mehrere cm auf 100 m). Modell in lokalen Projektkoordinaten führen und nur am Nullpunkt umrechnen." });
  }
  if (g.okff_eg_nhn == null) out.push({ key: "okff", status: "offen", text: "OKFF EG als NHN-Höhe fehlt — Höhenbezug zu Lageplan und Entwässerung nicht gesichert." });
  else if (g.okff_eg_nhn < -10 || g.okff_eg_nhn > 3000) out.push({ key: "okff_unplausibel", status: "warn", text: `OKFF EG ${g.okff_eg_nhn} m ü. NHN ist für Deutschland unplausibel — Wert prüfen.` });
  if (g.drehung_grad != null && (g.drehung_grad < -360 || g.drehung_grad > 360)) out.push({ key: "drehung", status: "warn", text: "Drehung außerhalb ±360° — Wert prüfen." });
  return out;
}
