// kennzahlen.js — project feasibility figures (88-09, RE-23…25): measure of building use
// after BauNVO (GRZ incl. § 19 Abs. 4, GFZ, BMZ) target vs. actual, full-storey check per
// storey (Vollgeschoss) and the residual land value (Residualwertverfahren).
//
// Data contract — entity `Machbarkeit` (one record per project, inputs only; every figure
// below is derived, never stored):
//   {project_id, grundstueck_m2, grz_max, gfz_max, bmz_max,          (B-Plan / § 34 target)
//    grundflaeche_m2 (main building, m²), nebenanlagen_m2 (garages, parking, access, TG under
//    ground — § 19 Abs. 4 BauNVO, m²), baumasse_m3 (m³; null → derived from the storeys),
//    geschosse: [{name, flaeche_m2, flaeche_h230_m2 (area with clear height ≥ 2.30 m),
//                 doK_ueber_gelaende_m (mean height of the top of the ceiling above ground, m),
//                 hoehe_m (storey height floor-to-floor, m)}],
//    residual: {modus 'verkauf'|'ertrag', flaeche_m2 (sellable/lettable), preis_eur_m2,
//               miete_eur_m2_monat, bewirtschaftung_anteil, liegenschaftszins, restnutzungsdauer_a,
//               bgf_m2, baukosten_eur_m2_bgf, nebenkosten_anteil, finanzierung_zins, bauzeit_monate,
//               gewinn_anteil, erwerbsnebenkosten_anteil}}
//
// In:  the record. Out: figures, findings (warn only), residual value breakdown. Pure.

const zahl = (v) => {
  if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) return null;
  const n = Number(typeof v === "string" ? v.replace(",", ".") : v);
  return Number.isFinite(n) ? n : null;
};
const r = (v, s = 2) => (v === null ? null : Math.round(v * 10 ** s) / 10 ** s);

/**
 * Full-storey check (Vollgeschoss) after the widespread state definition (MBO 1997 § 2 Abs. 4;
 * in Bavaria still applicable via Art. 83 Abs. 6 BayBO for development plans): a storey is
 * full when (a) the top of its ceiling lies on average more than 1.40 m above ground AND
 * (b) at least two thirds of its floor area have a clear height of ≥ 2.30 m.
 * [ASSUMED] state law differs in detail (e.g. attic rule related to the storey below) —
 * the result is a hint, the state code decides.
 * @param {{flaeche_m2?: any, flaeche_h230_m2?: any, doK_ueber_gelaende_m?: any}} g one storey
 * @returns {{voll: boolean|null, grund: string}} voll null = not decidable (inputs missing)
 */
export function vollgeschoss(g) {
  const a = zahl(g?.flaeche_m2);
  const a230 = zahl(g?.flaeche_h230_m2);
  const dok = zahl(g?.doK_ueber_gelaende_m);
  if (dok === null || a === null || a <= 0) return { voll: null, grund: "Angaben fehlen" };
  if (dok <= 1.4) return { voll: false, grund: "Decke im Mittel ≤ 1,40 m über Gelände" };
  const anteil = a230 === null ? 1 : a230 / a;
  if (anteil < 2 / 3) return { voll: false, grund: "weniger als 2/3 der Fläche mit 2,30 m lichter Höhe" };
  return { voll: true, grund: "Vollgeschoss" };
}

/**
 * @typedef {object} MassErgebnis
 * @property {number|null} grz actual GRZ I (main building) — GR / site area
 * @property {number|null} grz2 actual GRZ II incl. § 19 Abs. 4 areas
 * @property {number|null} grz2_max allowed GRZ II = min(grz_max × 1.5, 0.8), never below grz_max
 * @property {number|null} gfz actual GFZ (floor area of full storeys / site area)
 * @property {number|null} bmz actual BMZ (m³ / m² site)
 * @property {number|null} gf_m2 floor area of the full storeys (§ 20 Abs. 3, outer dimensions), m²
 * @property {number|null} baumasse_m3 used building volume, m³
 * @property {number} vollgeschosse number of full storeys
 * @property {Array<{name: string, voll: boolean|null, grund: string}>} geschosse
 * @property {Array<{code: string, stufe: 'warn'|'hinweis', text: string}>} hinweise
 */

/**
 * Measure of building use, target vs. actual (BauNVO 2017 §§ 19–21).
 * Exceedances are warn, never fail: exemptions (§ 31 BauGB), exceptions in the
 * development plan and § 19 Abs. 4 S. 3/4 (plan may allow more) decide.
 * @param {Record<string, any>} m Machbarkeit record
 * @returns {MassErgebnis}
 */
export function massDerNutzung(m) {
  const flaeche = zahl(m?.grundstueck_m2);
  const gr = zahl(m?.grundflaeche_m2);
  const neben = zahl(m?.nebenanlagen_m2) ?? 0;
  const geschosse = (Array.isArray(m?.geschosse) ? m.geschosse : []).map((g, i) => ({ g, name: String(g?.name || `Geschoss ${i + 1}`), ...vollgeschoss(g) }));
  const voll = geschosse.filter((x) => x.voll === true);
  const gf = voll.length ? voll.reduce((s, x) => s + (zahl(x.g.flaeche_m2) ?? 0), 0) : null;
  // § 21 Abs. 2 BauNVO: volume of the full storeys by outer dimensions (area × storey height).
  const bmAbgeleitet = voll.length && voll.every((x) => zahl(x.g.hoehe_m) !== null)
    ? voll.reduce((s, x) => s + (zahl(x.g.flaeche_m2) ?? 0) * /** @type {number} */ (zahl(x.g.hoehe_m)), 0) : null;
  const baumasse = zahl(m?.baumasse_m3) ?? bmAbgeleitet;
  const quote = (z) => (z === null || !flaeche ? null : z / flaeche);
  const grzMax = zahl(m?.grz_max);
  // § 19 Abs. 4 S. 2 BauNVO: GRZ may be exceeded by the § 19 (4) areas by up to 50 %, capped at 0.8.
  const grz2Max = grzMax === null ? null : Math.max(grzMax, Math.min(grzMax * 1.5, 0.8));
  const e = {
    grz: r(quote(gr), 3), grz2: r(quote(gr === null ? null : gr + neben), 3), grz2_max: r(grz2Max, 3),
    gfz: r(quote(gf), 3), bmz: r(quote(baumasse), 2), gf_m2: r(gf, 1), baumasse_m3: r(baumasse, 1),
    vollgeschosse: voll.length,
    geschosse: geschosse.map(({ name, voll: v, grund }) => ({ name, voll: v, grund })),
    hinweise: /** @type {Array<{code: string, stufe: 'warn'|'hinweis', text: string}>} */ ([]),
  };
  const ueber = (ist, max, code, text) => {
    if (ist !== null && max !== null && ist > max + 1e-9) e.hinweise.push({ code, stufe: "warn", text });
  };
  ueber(e.grz, grzMax, "grz", "GRZ über dem zulässigen Wert (§ 19 BauNVO)");
  ueber(e.grz2, e.grz2_max, "grz2", "GRZ mit Nebenanlagen über der Grenze nach § 19 Abs. 4 BauNVO");
  ueber(e.gfz, zahl(m?.gfz_max), "gfz", "GFZ über dem zulässigen Wert (§ 20 BauNVO)");
  ueber(e.bmz, zahl(m?.bmz_max), "bmz", "BMZ über dem zulässigen Wert (§ 21 BauNVO)");
  if (!flaeche) e.hinweise.push({ code: "grundstueck", stufe: "hinweis", text: "Grundstücksfläche fehlt" });
  if (geschosse.some((x) => x.voll === null)) e.hinweise.push({ code: "geschoss_angaben", stufe: "hinweis", text: "Vollgeschoss nicht entscheidbar — Angaben je Geschoss ergänzen" });
  if (geschosse.length) e.hinweise.push({ code: "landesrecht", stufe: "hinweis", text: "Vollgeschoss-Definition ist Landesrecht — vor Abgabe mit der Landesbauordnung abgleichen" });
  return e;
}

/**
 * Default rates of the residual calculation. [ASSUMED] typical office planning values,
 * to be replaced by project figures: ancillary costs 20 % of construction cost (KG 700),
 * financing 5 % p.a. on half the costs over the construction time, developer's risk and
 * profit 15 % of revenue, purchase costs 8 % (land transfer tax 3.5–6.5 % + notary/land
 * register ~1.5–2 %), management costs 20 % of gross rent.
 */
export const RESIDUAL_STANDARD = Object.freeze({
  nebenkosten_anteil: 0.2, finanzierung_zins: 0.05, bauzeit_monate: 24, gewinn_anteil: 0.15,
  erwerbsnebenkosten_anteil: 0.08, bewirtschaftung_anteil: 0.2, liegenschaftszins: 0.035, restnutzungsdauer_a: 80,
});

/**
 * Present value factor (Barwertfaktor) for capitalisation, ImmoWertV 2021 § 34 Abs. 2:
 * (q^n − 1) / (q^n × (q − 1)), q = 1 + p.
 * @param {number} p interest rate (0.035 = 3.5 %)
 * @param {number} n remaining economic life in years
 * @returns {number}
 */
export function barwertfaktor(p, n) {
  if (!(p > 0) || !(n > 0)) return 0;
  const qn = (1 + p) ** n;
  return (qn - 1) / (qn * p);
}

/**
 * Residual land value (Residualwertverfahren): the price the site can bear.
 * Revenue − construction − ancillary − financing − risk/profit = residual; divided by
 * (1 + purchase costs) = bearable land value. All amounts in euros.
 * @param {Record<string, any>} res inputs (see data contract); missing rates → RESIDUAL_STANDARD
 * @returns {{erloes: number|null, baukosten: number|null, nebenkosten: number|null, finanzierung: number|null,
 *   gewinn: number|null, residuum: number|null, bodenwert: number|null, bodenwert_je_m2: number|null,
 *   jahresreinertrag: number|null, barwertfaktor: number|null}}
 *   bodenwert_je_m2 only with a site area (second argument)
 * @param {number|null} [grundstueckM2] site area in m²
 */
export function residualwert(res, grundstueckM2 = null) {
  const w = (k) => zahl(res?.[k]) ?? /** @type {any} */ (RESIDUAL_STANDARD)[k] ?? null;
  const flaeche = zahl(res?.flaeche_m2);
  let erloes = null;
  let reinertrag = null;
  let bwf = null;
  if (res?.modus === "ertrag") {
    const miete = zahl(res?.miete_eur_m2_monat);
    if (flaeche !== null && miete !== null) {
      reinertrag = flaeche * miete * 12 * (1 - /** @type {number} */ (w("bewirtschaftung_anteil")));
      bwf = barwertfaktor(/** @type {number} */ (w("liegenschaftszins")), /** @type {number} */ (w("restnutzungsdauer_a")));
      erloes = reinertrag * bwf;
    }
  } else {
    const preis = zahl(res?.preis_eur_m2);
    if (flaeche !== null && preis !== null) erloes = flaeche * preis;
  }
  const bgf = zahl(res?.bgf_m2);
  const kosten = zahl(res?.baukosten_eur_m2_bgf);
  const baukosten = bgf !== null && kosten !== null ? bgf * kosten : null;
  if (erloes === null || baukosten === null) {
    return { erloes: r(erloes), baukosten: r(baukosten), nebenkosten: null, finanzierung: null, gewinn: null, residuum: null, bodenwert: null, bodenwert_je_m2: null, jahresreinertrag: r(reinertrag), barwertfaktor: r(bwf, 4) };
  }
  const nebenkosten = baukosten * /** @type {number} */ (w("nebenkosten_anteil"));
  // Financing [ASSUMED]: on average half of the costs are drawn over the construction time.
  const finanzierung = (baukosten + nebenkosten) * 0.5 * /** @type {number} */ (w("finanzierung_zins")) * (/** @type {number} */ (w("bauzeit_monate")) / 12);
  const gewinn = erloes * /** @type {number} */ (w("gewinn_anteil"));
  const residuum = erloes - baukosten - nebenkosten - finanzierung - gewinn;
  const bodenwert = residuum / (1 + /** @type {number} */ (w("erwerbsnebenkosten_anteil")));
  const gm2 = zahl(grundstueckM2);
  return {
    erloes: r(erloes), baukosten: r(baukosten), nebenkosten: r(nebenkosten), finanzierung: r(finanzierung), gewinn: r(gewinn),
    residuum: r(residuum), bodenwert: r(bodenwert), bodenwert_je_m2: gm2 ? r(bodenwert / gm2) : null,
    jahresreinertrag: r(reinertrag), barwertfaktor: r(bwf, 4),
  };
}
