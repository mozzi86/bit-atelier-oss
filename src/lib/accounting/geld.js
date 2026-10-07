// Money in whole cents (phase 79). Amounts are stored in Euro with two decimals
// and computed in integer cents, so a bank reconciliation never fails on 0.01 €
// of float noise (79-RESEARCH risk 7). VAT is rounded per invoice.
//
// In:  numbers (Euro or cents) and German amount texts.
// Out: pure functions, no imports, no side effects.

/**
 * Commercial rounding (half away from zero) to a whole number, robust against
 * float noise such as 1.005 * 100 = 100.49999999999999.
 * @param {number} wert amount in cents, possibly fractional
 * @returns {number} whole cents; 0 for non-finite input
 */
export function rundeCent(wert) {
  if (!Number.isFinite(wert)) return 0;
  const betrag = Math.round(Number(Math.abs(wert).toPrecision(15)));
  return (wert < 0 ? -betrag : betrag) || 0;
}

/**
 * Euro → cents.
 * @param {number|null|undefined} euro amount in Euro
 * @returns {number} whole cents (0 for missing or non-finite input)
 */
export function euroZuCent(euro) {
  return typeof euro === "number" ? rundeCent(euro * 100) : 0;
}

/**
 * Cents → Euro (two decimals).
 * @param {number} cent whole cents
 * @returns {number} Euro
 */
export function centZuEuro(cent) {
  return rundeCent(cent) / 100;
}

/**
 * VAT of one invoice from its net amount, rounded commercially.
 * @param {number} nettoCent net amount in cents
 * @param {number} satz VAT rate in percent (19, 7, 0)
 * @returns {number} VAT in cents
 */
export function ustCent(nettoCent, satz) {
  return rundeCent((nettoCent * satz) / 100);
}

/**
 * Splits a gross amount into net and VAT (net rounded, VAT = the rest, so
 * net + VAT is exactly the gross amount).
 * @param {number} bruttoCent gross amount in cents
 * @param {number} satz VAT rate in percent
 * @returns {{netto: number, ust: number}} cents
 */
export function ausBruttoCent(bruttoCent, satz) {
  const netto = rundeCent((bruttoCent * 100) / (100 + satz));
  return { netto, ust: rundeCent(bruttoCent) - netto };
}

/**
 * Splits an amount by shares with the largest-remainder method: every part is
 * a whole cent, the parts sum exactly to the amount, ties go to the earlier share.
 * @param {number} cent amount in cents (may be negative)
 * @param {number[]} anteile non-negative shares in any unit (percent, weights)
 * @returns {number[]} cents per share
 * @throws {Error} when the shares do not sum to more than zero
 */
export function verteileNachSchluessel(cent, anteile) {
  const liste = Array.isArray(anteile) ? anteile.map((a) => (Number.isFinite(a) && a > 0 ? a : 0)) : [];
  const summe = liste.reduce((n, a) => n + a, 0);
  if (!(summe > 0)) throw new Error("Verteilung nicht möglich: Der Schlüssel hat keine Anteile.");
  const gesamt = rundeCent(cent);
  const vorzeichen = gesamt < 0 ? -1 : 1;
  const betrag = Math.abs(gesamt);
  const exakt = liste.map((a) => (betrag * a) / summe);
  const teile = exakt.map((x) => Math.floor(x));
  let rest = betrag - teile.reduce((n, x) => n + x, 0);
  const reihenfolge = exakt
    .map((x, i) => ({ i, bruch: x - Math.floor(x) }))
    .sort((a, b) => b.bruch - a.bruch || a.i - b.i);
  for (const { i } of reihenfolge) {
    if (rest <= 0) break;
    teile[i] += 1;
    rest -= 1;
  }
  return teile.map((x) => (x * vorzeichen) || 0);
}

/**
 * German amount text → cents. Accepts "1.234,56", "-12,5", "12", "1.234",
 * "1234.56" (a single dot followed by one or two digits counts as decimal
 * point), surrounding spaces and a "€" sign. More than two decimals is refused.
 * @param {unknown} text user input
 * @returns {number|null} whole cents, or null when empty or not an amount
 */
export function parseBetragDe(text) {
  if (typeof text !== "string" && typeof text !== "number") return null;
  let s = String(text).replace(/€/g, "").replace(/[\s\u00a0\u202f]/g, "");
  if (!s) return null;
  let negativ = false;
  if (/^[-−]/.test(s)) { negativ = true; s = s.slice(1); }
  else if (s.startsWith("+")) s = s.slice(1);
  let ganz;
  let bruch = "";
  if (s.includes(",")) {
    const [links, rechts, ...zuviel] = s.split(",");
    if (zuviel.length) return null;
    if (!/^\d{1,3}(\.\d{3})*$|^\d+$/.test(links) || !/^\d{0,2}$/.test(rechts)) return null;
    ganz = links.replace(/\./g, "");
    bruch = rechts;
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    ganz = s.replace(/\./g, "");
  } else if (/^\d+\.\d{1,2}$/.test(s)) {
    [ganz, bruch] = s.split(".");
  } else if (/^\d+$/.test(s)) {
    ganz = s;
  } else {
    return null;
  }
  const cent = Number(ganz) * 100 + Number((bruch + "00").slice(0, 2));
  if (!Number.isFinite(cent)) return null;
  return negativ ? -cent : cent;
}

/**
 * Cents as a currency text ("1.234,56 €" in German, "€1,234.56" in English).
 * The German form contains a no-break space before "€" (Intl default).
 * @param {number} cent whole cents
 * @param {string} [sprache] "de" (default) or "en"
 * @returns {string}
 */
export function formatEuro(cent, sprache = "de") {
  const format = new Intl.NumberFormat(sprache === "en" ? "en-GB" : "de-DE", { style: "currency", currency: "EUR" });
  return format.format(rundeCent(cent) / 100);
}
