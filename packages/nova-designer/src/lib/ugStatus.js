// 107-10 review (truth 7 of plan 107-10, D-BK-08b "bei Abweichung Warnung am Bauteil und analytische Menge"): the visible state of the
// basement with terrain subtraction in the Massing studio's 3D view. Until the review the excavation quantity, the comparison warning,
// a load error of the CSG core and the earth-contact quantities stood only in data attributes; now MassingView3D shows these lines.
//
// In: the basement prop of MassingView3D, whether a terrain grid exists, the result of gelaendeSolid.untergeschossMitGelaende, a load
// error, the translate function. Out: lines and warnings (German source texts through t) plus the quantity and its source. Pure.

import { stempeln } from "@core/lib/massing/gelaende.js";

/**
 * 107-10 review (truth 7, D-BK-08b "Warnung am Bauteil und Menge"): the visible state of the basement with terrain subtraction — excavation
 * quantity with its source, the warning of the comparison, the earth-contact quantity of the basement walls, or a plain "nicht
 * verfügbar" message. Pure (texts through t), the view only shows the lines.
 * @param {{ug: any, gelaende?: any, gelaendeGueltig: boolean, ergebnis: any, fehler: string|null, t: (k: string) => string, lang?: string}} e
 *   ug: the basement prop ({profil (site m), fusshoehe_m < 0}); gelaende: massing_layer.gelaende (for the grid quantity when the module
 *   failed to load); ergebnis: untergeschossMitGelaende(); fehler: load error of the module
 * @returns {{zeilen: string[], warnungen: string[], aushub_m3: number|null, quelle: string}|null} null without a basement
 */
export function ugStatusText({ ug, gelaende = null, gelaendeGueltig, ergebnis, fehler, t, lang = "de" }) {
  if (!ug || !Array.isArray(ug.profil) || ug.profil.length < 3 || !(ug.fusshoehe_m < 0)) return null;
  const zahl = (/** @type {number} */ v, /** @type {number} */ st = 1) => v.toLocaleString(lang === "en" ? "en-GB" : "de-DE", { maximumFractionDigits: st });
  // footprint area (shoelace, m²) × depth (m): the quantity without a terrain grid (plan task 6) and the fallback while nothing else is known
  let a2 = 0;
  ug.profil.forEach((/** @type {any} */ p, /** @type {number} */ i) => { const q = ug.profil[(i + 1) % ug.profil.length]; a2 += p.x * q.y - q.x * p.y; });
  const flaecheMalTiefe = (Math.abs(a2) / 2) * -ug.fusshoehe_m;
  const aushubZeile = (/** @type {number} */ m3, /** @type {string} */ quelle) => t("Untergeschoss: Aushub {{m3}} m³ ({{quelle}})").replace("{{m3}}", zahl(m3)).replace("{{quelle}}", quelle);
  if (!gelaendeGueltig) return { zeilen: [aushubZeile(flaecheMalTiefe, t("Grundfläche × Tiefe, kein Geländeraster"))], warnungen: [], aushub_m3: flaecheMalTiefe, quelle: "analytisch" };
  if (fehler) {
    // the module did not load: no solid, the quantity from the grid (stempeln, the reference of D-BK-08b), said as "nicht verfügbar"
    const raster = gelaende ? stempeln(gelaende, ug.profil, ug.fusshoehe_m).abtrag : flaecheMalTiefe;
    return { zeilen: [aushubZeile(raster, gelaende ? t("aus dem Geländeraster") : t("Grundfläche × Tiefe"))], warnungen: [t("Geländeabzug nicht verfügbar: {{text}}").replace("{{text}}", fehler)], aushub_m3: raster, quelle: gelaende ? "raster" : "analytisch" };
  }
  if (!ergebnis) return { zeilen: [t("Geländeabzug wird berechnet …")], warnungen: [], aushub_m3: null, quelle: "" };
  const a = ergebnis.aushub;
  const quelleText = a.quelle === "solid" ? t("aus dem 3D-Körper") : a.quelle === "raster" ? t("aus dem Geländeraster") : t("Grundfläche × Tiefe");
  /** @param {any} w @returns {string} */
  const warnText = (w) => {
    if (!w) return "";
    if (w.code === "csg-abweichung") {
      const p = w.abweichung_rel == null || !Number.isFinite(w.abweichung_rel) ? "–" : zahl(w.abweichung_rel * 100, 2);
      return t("Aushub aus dem 3D-Körper weicht um {{prozent}} % vom Geländeraster ab — Menge aus dem Raster").replace("{{prozent}}", p);
    }
    if (w.code === "csg-offen") return t("Geländeabzug nicht verfügbar: ein Körper ist nicht geschlossen — Menge aus dem Geländeraster");
    return t("Geländeabzug nicht verfügbar: {{text}}").replace("{{text}}", String(w.text || w.code || "?"));
  };
  const zeilen = [aushubZeile(a.menge_m3, quelleText)];
  const warnungen = [warnText(ergebnis.fehler || a.warnung)].filter(Boolean);
  const erd = Array.isArray(ergebnis.erdberuehrt) ? ergebnis.erdberuehrt : [];
  if (erd.length) {
    const summe = erd.reduce((/** @type {number} */ s, /** @type {any} */ x) => s + (Number(x.menge_m3) || 0), 0);
    zeilen.push(t("Erdberührte UG-Wände: {{m3}} m³ ({{n}} Wände)").replace("{{m3}}", zahl(summe, 2)).replace("{{n}}", String(erd.length)));
    const abw = erd.filter((/** @type {any} */ x) => x.warnung);
    if (abw.length) warnungen.push(t("{{n}} erdberührte Wand/Wände weichen vom Geländeraster ab — Menge aus dem Raster").replace("{{n}}", String(abw.length)));
  }
  return { zeilen, warnungen, aushub_m3: a.menge_m3, quelle: a.quelle };
}
