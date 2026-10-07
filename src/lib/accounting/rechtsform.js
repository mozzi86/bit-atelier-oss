// Legal form × effect (decision E-04): the ONLY source of the matrix
// "Rechtsform × Wirkung" in 79-RESEARCH. Every area (drawings, VAT, year clock,
// fleet, annual summary) asks rechtsformWirkung() instead of testing the legal
// form itself, and texts stay literal t() calls in the components.
//
// The switch only changes plan values, required fields and texts — never
// recorded actual data: switching to GmbH and back deletes nothing, actual
// drawings keep counting in the balance, partners and profit shares stay stored.
//
// In:  the effective settings (wirksameEinstellungen) or any object with
//      `rechtsform` and `gewst_aktiv`. Import-free on purpose.
// Out: RECHTSFORMEN, rechtsformWirkung(einst), personenPruefen(gesellschafter, einst, jahr).

/**
 * Legal-form keys in fixed order. Labels live in the UI (t()), not here.
 * einzelunternehmen = sole proprietor / freelancer (§ 18 EStG, default),
 * gbr, partg (also PartG mbB), gmbh, ug (UG haftungsbeschränkt, GmbH variant).
 */
export const RECHTSFORMEN = Object.freeze(["einzelunternehmen", "gbr", "partg", "gmbh", "ug"]);

/**
 * Effect of the legal form on plan, required fields and texts.
 * @typedef {{
 *   rechtsform: string,
 *   klasse: "natuerlich"|"personengesellschaft"|"kapitalgesellschaft",
 *   gewinnermittlung: "euer"|"bilanz",
 *   entnahmen: "inhaber"|"gesellschafter"|"gf_gehalt",
 *   schluesselNoetig: boolean,
 *   vorauszahlung: "est"|"kst",
 *   gewst: boolean,
 *   istFreiberuflerRegel: boolean,
 *   dienstwagen: "nutzungsentnahme"|"geldwerter_vorteil",
 *   hinweise: string[],
 * }} RechtsformWirkung
 */

/**
 * The matrix of 79-RESEARCH "Rechtsform × Wirkung" as a function.
 * - gewinnermittlung: EÜR (§ 4 Abs. 3 EStG) for natural persons and partnerships;
 *   GmbH/UG keep books (§§ 238, 242 HGB i. V. m. § 13 Abs. 3 GmbHG) — only a hint.
 * - entnahmen: owner's drawings / per partner with profit shares / managing
 *   director's salary instead of drawings (GmbH/UG).
 * - vorauszahlung: income tax (§ 37 EStG) or corporate tax (§ 31 KStG).
 * - gewst: GmbH/UG always (trade by legal form, § 2 Abs. 2 GewStG), otherwise only
 *   with `gewst_aktiv` (commercial activity, § 15 Abs. 3 Nr. 1 EStG).
 * - istFreiberuflerRegel: cash accounting allowed as freelancer (§ 20 S. 1 Nr. 3 UStG).
 * - dienstwagen: private use as withdrawal (EÜR) or as benefit in kind of the
 *   managing director (employee), informative only.
 * Unknown legal form → einzelunternehmen.
 * @param {{rechtsform?: unknown, gewst_aktiv?: unknown}|null|undefined} einst effective settings
 * @returns {RechtsformWirkung}
 */
export function rechtsformWirkung(einst) {
  const roh = einst && typeof einst === "object" ? einst.rechtsform : undefined;
  const rechtsform = RECHTSFORMEN.includes(/** @type {string} */ (roh)) ? /** @type {string} */ (roh) : "einzelunternehmen";
  const gewstAktiv = Boolean(einst && typeof einst === "object" && einst.gewst_aktiv === true);
  const kapital = rechtsform === "gmbh" || rechtsform === "ug";
  const personen = rechtsform === "gbr" || rechtsform === "partg";

  /** @type {string[]} */
  const hinweise = [];
  if (kapital) hinweise.push("bilanz_pflicht", "keine_privatentnahmen", "ist_grenze");
  if (rechtsform === "ug") hinweise.push("ug_ruecklage"); // 25 % of the annual surplus, § 5a Abs. 3 GmbHG
  if (personen) hinweise.push("schluessel_pflicht");
  if (!kapital && gewstAktiv) hinweise.push("buchfuehrung_141_pruefen"); // § 141 AO thresholds

  return {
    rechtsform,
    klasse: kapital ? "kapitalgesellschaft" : personen ? "personengesellschaft" : "natuerlich",
    gewinnermittlung: kapital ? "bilanz" : "euer",
    entnahmen: kapital ? "gf_gehalt" : personen ? "gesellschafter" : "inhaber",
    schluesselNoetig: personen,
    vorauszahlung: kapital ? "kst" : "est",
    gewst: kapital || gewstAktiv,
    istFreiberuflerRegel: !kapital,
    dienstwagen: kapital ? "geldwerter_vorteil" : "nutzungsentnahme",
    hinweise,
  };
}

/**
 * Checks the people of the office against the legal form. Warnings only — the
 * user decides; nothing is blocked (a liability choice: the tool must not
 * refuse a legal constellation it cannot see in full).
 * - "einzel_mehrere_personen": sole proprietor with more than one active person.
 * - "schluessel_fehlt": partnership with at least two active persons and no
 *   profit share summing to 100 % (for `jahr`, or for any year when `jahr` is omitted).
 * @param {Array<{id?: string, aktiv?: boolean}>|null|undefined} gesellschafter partner records
 * @param {{rechtsform?: unknown, gewst_aktiv?: unknown, schluessel?: Record<string, Record<string, number>>}|null|undefined} einst effective settings
 * @param {number|string} [jahr] business year, e.g. 2026
 * @returns {string[]} warning keys, empty when everything fits
 */
export function personenPruefen(gesellschafter, einst, jahr) {
  const wirkung = rechtsformWirkung(einst);
  const aktive = (Array.isArray(gesellschafter) ? gesellschafter : []).filter((g) => g && g.aktiv !== false);
  /** @type {string[]} */
  const warnungen = [];
  if (wirkung.rechtsform === "einzelunternehmen" && aktive.length > 1) warnungen.push("einzel_mehrere_personen");
  if (wirkung.schluesselNoetig && aktive.length >= 2) {
    const alle = einst && typeof einst === "object" && einst.schluessel && typeof einst.schluessel === "object" ? einst.schluessel : {};
    const jahre = jahr === undefined ? Object.keys(alle) : [String(jahr)];
    const summe = (/** @type {unknown} */ s) => (s && typeof s === "object"
      ? Object.values(s).reduce((n, p) => n + (typeof p === "number" && Number.isFinite(p) ? p : 0), 0) : 0);
    const vollstaendig = jahre.some((j) => Math.abs(summe(alle[j]) - 100) < 1e-9);
    if (!vollstaendig) warnungen.push("schluessel_fehlt");
  }
  return warnungen;
}
