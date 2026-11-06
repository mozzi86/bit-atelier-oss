// 73-05 (BEST-05): provenance of the building outline. BimModel.footprintM stays the ONE geometry field;
// its sibling footprintQuelle says whether the outline was drawn (decision) or measured (derived from a
// survey model), from which source and storey, with the raster deviation of the derivation and the date.
// Without it nobody could tell afterwards whether the outline is a sketched block or a measured building
// (the IFC viewer used to show quelle/hinweis only in a toast).
//
// 108-01 (D-EFH-05): a third provenance "baufeld-planung" — the outline came from the footprint area of the site planning (BuildingComplex
// designated_areas, type "footprint"); it carries a hash of that area so a later change of the area can be told from the same one.
// footprintUebernahme() is the rule when such an area may overwrite footprintM. Additive: old values keep their meaning.
//
// In:  derivation result of grundrissAusModell (or nothing for a drawn outline); px points of a site-planning area.
// Out: plain objects { art, quelle?, geschoss?, abweichung?, flaeche_m2?, hash?, datum } and a display line.

/**
 * Provenance of an outline derived from a survey/IFC model.
 * @param {{quelle?: string, geschoss?: string|null, flaeche?: number, rasterFlaeche?: number, datei?: string}} r
 *   grundrissAusModell result (flaeche/rasterFlaeche in m²) + optional file name
 * @param {Date} [jetzt]
 * @returns {{art: "gemessen", quelle: string, geschoss: string|null, abweichung: number|null, flaeche_m2: number|null, datei: string|null, datum: string}}
 *   abweichung = |polygon − raster| / raster (share, 0…1), null without raster
 */
export function footprintQuelleGemessen(r, jetzt = new Date()) {
  const f = Number(r?.flaeche), rf = Number(r?.rasterFlaeche);
  return {
    art: "gemessen",
    quelle: String(r?.quelle || "IFC"),
    geschoss: r?.geschoss || null,
    abweichung: rf > 0 && Number.isFinite(f) ? Math.round((Math.abs(f - rf) / rf) * 1000) / 1000 : null,
    flaeche_m2: Number.isFinite(f) ? f : null,
    datei: r?.datei || null,
    datum: jetzt.toISOString(),
  };
}

/**
 * Provenance of a drawn outline (any edit of footprintM that does not carry its own provenance).
 * @param {Date} [jetzt]
 * @returns {{art: "gezeichnet", datum: string}}
 */
export function footprintQuelleGezeichnet(jetzt = new Date()) {
  return { art: "gezeichnet", datum: jetzt.toISOString() };
}

/**
 * 108-01: hash of a site-planning area — FNV-1a 32 bit over its px points rounded to 0.01 px and the scale m/px rounded to 1e-6
 * (the scale is part of it because the same px points give another outline at another scale). Stable across reloads.
 * @param {Array<{x: number, y: number}>} punkte area points in px
 * @param {number|null} [mProPx] metres per pixel of the parcel
 * @returns {string} 8 hex digits
 */
export function flaechenHash(punkte, mProPx = null) {
  const text = (Array.isArray(punkte) ? punkte : []).map((p) => `${Math.round(Number(p?.x) * 100)},${Math.round(Number(p?.y) * 100)}`).join(";")
    + `|${mProPx == null ? "" : Math.round(Number(mProPx) * 1e6)}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

/**
 * 108-01 (D-EFH-05): provenance of an outline taken over from the footprint area of the site planning.
 * @param {Array<{x: number, y: number}>} punkte area points in px
 * @param {Date} [jetzt]
 * @param {number|null} [mProPx] metres per pixel of the parcel (part of the hash)
 * @returns {{art: "baufeld-planung", hash: string, datum: string}}
 */
export function footprintQuelleBaufeldPlanung(punkte, jetzt = new Date(), mProPx = null) {
  return { art: "baufeld-planung", hash: flaechenHash(punkte, mProPx), datum: jetzt.toISOString() };
}

/**
 * 108-01 (D-EFH-05): may the footprint area of the site planning overwrite the stored outline?
 *  - "gleich": nothing to do — the area is the one already taken over (same hash), or the outline already equals it (within 1 mm,
 *    e.g. an old project whose outline was copied from the area before 108-01 and stamped "gezeichnet")
 *  - "uebernehmen": take it over silently — no provenance yet, or the outline came from the site planning and the area changed
 *  - "rueckfrage": the outline was drawn or measured in the model; the area differs → ask ("Übernehmen")
 * @param {{art?: string, hash?: string}|null|undefined} quelle stored footprintQuelle
 * @param {string} hash flaechenHash of the area now
 * @param {Array<{x: number, z: number}>|null|undefined} aktuell stored footprintM (m)
 * @param {Array<{x: number, z: number}>|null|undefined} neu outline of the area (m, footprintToMeters)
 * @returns {"gleich"|"uebernehmen"|"rueckfrage"}
 */
export function footprintUebernahme(quelle, hash, aktuell, neu) {
  if (quelle?.art === "baufeld-planung" && quelle.hash === hash) return "gleich";
  if (gleicherUmriss(aktuell, neu)) return "gleich";
  if (!quelle?.art || quelle.art === "baufeld-planung") return "uebernehmen";
  return "rueckfrage";
}

/** @param {Array<{x: number, z: number}>|null|undefined} a @param {Array<{x: number, z: number}>|null|undefined} b @returns {boolean} same points within 1 mm */
function gleicherUmriss(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return false;
  return a.every((p, i) => Math.abs(p.x - b[i].x) <= 1e-3 && Math.abs(p.z - b[i].z) <= 1e-3);
}

/**
 * German display line, or null when unknown (legacy models: neither drawn nor measured is claimed).
 * @param {ReturnType<typeof footprintQuelleGemessen>|ReturnType<typeof footprintQuelleGezeichnet>|ReturnType<typeof footprintQuelleBaufeldPlanung>|null|undefined} fq
 * @returns {string|null}
 */
export function footprintQuelleText(fq) {
  if (!fq?.art) return null;
  const datum = fq.datum && !Number.isNaN(Date.parse(fq.datum)) ? new Date(fq.datum).toLocaleDateString("de-DE") : null;
  if (fq.art === "gezeichnet") return `Umriss: gezeichnet${datum ? ` (${datum})` : ""}`;
  if (fq.art === "baufeld-planung") return `Umriss: aus der Baufeld-Planung${datum ? ` (${datum})` : ""}`; // 108-01
  const teile = [fq.quelle, fq.geschoss ? `Geschoss ${fq.geschoss}` : "alle Geschosse vereinigt"];
  if (fq.abweichung != null) teile.push(`Rasterabweichung ${Math.round(fq.abweichung * 100)} %`);
  if (datum) teile.push(datum);
  return `Umriss: gemessen (${teile.filter(Boolean).join(", ")})`;
}
