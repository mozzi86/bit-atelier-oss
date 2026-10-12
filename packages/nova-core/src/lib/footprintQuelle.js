// 73-05 (BEST-05): provenance of the building outline. BimModel.footprintM stays the ONE geometry field;
// its sibling footprintQuelle says whether the outline was drawn (decision) or measured (derived from a
// survey model), from which source and storey, with the raster deviation of the derivation and the date.
// Without it nobody could tell afterwards whether the outline is a sketched block or a measured building
// (the IFC viewer used to show quelle/hinweis only in a toast).
//
// In:  derivation result of grundrissAusModell (or nothing for a drawn outline).
// Out: plain objects { art, quelle?, geschoss?, abweichung?, flaeche_m2?, datum } and a display line.

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
 * German display line, or null when unknown (legacy models: neither drawn nor measured is claimed).
 * @param {ReturnType<typeof footprintQuelleGemessen>|ReturnType<typeof footprintQuelleGezeichnet>|null|undefined} fq
 * @returns {string|null}
 */
export function footprintQuelleText(fq) {
  if (!fq?.art) return null;
  const datum = fq.datum && !Number.isNaN(Date.parse(fq.datum)) ? new Date(fq.datum).toLocaleDateString("de-DE") : null;
  if (fq.art === "gezeichnet") return `Umriss: gezeichnet${datum ? ` (${datum})` : ""}`;
  const teile = [fq.quelle, fq.geschoss ? `Geschoss ${fq.geschoss}` : "alle Geschosse vereinigt"];
  if (fq.abweichung != null) teile.push(`Rasterabweichung ${Math.round(fq.abweichung * 100)} %`);
  if (datum) teile.push(datum);
  return `Umriss: gemessen (${teile.filter(Boolean).join(", ")})`;
}
