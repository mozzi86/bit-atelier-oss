// Cost rate per person (Kostensatz, phase 81, ZEIT-05): what one productive hour
// of a person costs the office, derived from the salary and contract of phase 80
// and the calculation rules zeit_honorar.* (E-16). Pure: the caller passes the
// rule values (useRegelWerte(REGELWERKE)) and the 80 records (through the
// adapter src/lib/people/zeitHonorarPersonal.js).
//
// Formula (81-RESEARCH § Formeln, [ASSUMED] office calculation, not a norm):
//   jahresbrutto   = monthly gross × 12 + yearly extras   (salary per month)
//                  = hourly wage × weekly hours × 52       (salary per hour)
//   jahreskosten   = jahresbrutto × (1 + ag_anteil / 100)  (employer share, E-16 single source)
//   produktiv_h    = (52 × wh − leave × wh/at − (holidays + sick days) × wh/5) × productivity
//                    (wh = weekly hours, at = working days per week; holidays and sickness
//                    fall evenly on the weekdays [ASSUMED] — for at = 5 identical to the
//                    classic formula)
//   direkt         = jahreskosten / produktiv_h            (Euro/hour)
//   satz           = round2(jahreskosten × (1 + gemeinkosten / 100) / produktiv_h)
//                    from the UNROUNDED direct rate.
// Owners and partners have no contract and no salary (drawings) → manual rate.
//
// Kostensatz (personnel storage class, E-14): {mitarbeiter_id (also "inhaber"),
// gueltig_ab, satz_eur_h, direkt_eur_h, herkunft 'berechnet'|'manuell', basis{…}, notiz}.
//
// In:  salary, contract, rule values; cost rate lists. Out: jahresbrutto,
//      satzAusGehalt, gueltigerSatz, buerosatz.

/**
 * Rounds to cents (two decimals) without float drift.
 * @param {number} x Euro
 * @returns {number}
 */
const rund2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;

/**
 * Whether a salary record is an hourly wage. 80 stores the occasion in
 * `Gehaltsaenderung.art` ('einstellung', 'korrektur' …) and treats working
 * students as hourly (src/lib/people/kosten.js); an explicit art 'stunde' counts too.
 * @param {Record<string, any>|null|undefined} gehalt
 * @param {string} [personArt] Mitarbeiter.art
 * @returns {boolean}
 */
export function istStundenlohn(gehalt, personArt) {
  return gehalt?.art === "stunde" || personArt === "werkstudent";
}

/**
 * Yearly gross pay in Euro.
 * Monthly: brutto_eur × 12 + Σ zusatz entries with an amount (betrag_eur per
 * month × 12 with rhythmus 'monatlich', once with 'jaehrlich'; 80 stores plain
 * text extras without amount — they do not count). Hourly: brutto_eur ×
 * wochenstunden × 52 [ASSUMED: paid weeks = 52].
 * @param {Record<string, any>|null|undefined} gehalt Gehaltsaenderung (brutto_eur in Euro/month or Euro/hour)
 * @param {Record<string, any>|null|undefined} vertrag Arbeitsvertrag (wochenstunden in hours)
 * @param {string} [personArt] Mitarbeiter.art
 * @returns {number} Euro/year, 0 without a salary
 */
export function jahresbrutto(gehalt, vertrag, personArt) {
  const brutto = Number(gehalt?.brutto_eur) || 0;
  if (!brutto) return 0;
  if (istStundenlohn(gehalt, personArt)) return rund2(brutto * (Number(vertrag?.wochenstunden) || 0) * 52);
  let zusatz = 0;
  for (const z of Array.isArray(gehalt?.zusatz) ? gehalt.zusatz : []) {
    const betrag = Number(z?.betrag_eur);
    if (!Number.isFinite(betrag) || !betrag) continue; // text-only extras (80) have no amount
    zusatz += z.rhythmus === "monatlich" ? betrag * 12 : betrag;
  }
  return rund2(brutto * 12 + zusatz);
}

/**
 * Cost rate of a person from salary and contract.
 * @param {{gehalt: Record<string, any>|null, vertrag: Record<string, any>|null, personArt?: string}} quelle
 * @param {{ag_anteil: number, gemeinkosten: number, produktivquote: number, feiertage: number, krankheitstage: number}} werte
 *   ag_anteil, gemeinkosten, produktivquote in percent; feiertage, krankheitstage in days/year (zeit_honorar.*)
 * @returns {{satz_eur_h: number, direkt_eur_h: number, basis: Record<string, number>}|null}
 *   Euro/hour; null without salary, contract or productive hours
 */
export function satzAusGehalt({ gehalt, vertrag, personArt }, werte) {
  const brutto = jahresbrutto(gehalt, vertrag, personArt);
  const wh = Number(vertrag?.wochenstunden) || 0;
  const at = Number(vertrag?.arbeitstage_woche) || 5;
  if (!brutto || !wh) return null;
  const urlaub = Number(vertrag?.urlaub_tage_jahr) || 0;
  const ag = Number(werte?.ag_anteil) || 0;
  const gk = Number(werte?.gemeinkosten) || 0;
  const quote = (Number(werte?.produktivquote) || 0) / 100;
  const feiertage = Number(werte?.feiertage) || 0;
  const krank = Number(werte?.krankheitstage) || 0;
  const jahreskosten = brutto * (1 + ag / 100);
  // Leave is counted in the person's own working days (wh/at hours each); holidays and
  // sickness fall evenly on the five weekdays (wh/5 hours each) [ASSUMED].
  const produktiv = (52 * wh - urlaub * (wh / at) - (feiertage + krank) * (wh / 5)) * quote;
  if (!(produktiv > 0)) return null;
  const direkt = jahreskosten / produktiv;
  return {
    satz_eur_h: rund2((jahreskosten * (1 + gk / 100)) / produktiv),
    direkt_eur_h: rund2(direkt),
    basis: {
      jahresbrutto_eur: brutto,
      ag_anteil_prozent: ag,
      jahreskosten_eur: rund2(jahreskosten),
      produktive_stunden_h: Math.round(produktiv * 100) / 100,
      gemeinkosten_prozent: gk,
      produktivquote_prozent: quote * 100,
      urlaub_tage: urlaub,
      feiertage_tage: feiertage,
      krankheit_tage: krank,
      wochenstunden: wh,
      arbeitstage_woche: at,
    },
  };
}

/**
 * The cost rate valid on a day: the one with the latest gueltig_ab ≤ datum
 * (D-P81-11 — costs are read at the booking's date, not frozen at approval).
 * @param {ReadonlyArray<Record<string, any>>} saetze Kostensatz records
 * @param {string} mitarbeiterId
 * @param {string} datumIso 'YYYY-MM-DD'
 * @returns {Record<string, any>|null}
 */
export function gueltigerSatz(saetze, mitarbeiterId, datumIso) {
  let treffer = null;
  for (const s of Array.isArray(saetze) ? saetze : []) {
    if (!s || s.mitarbeiter_id !== mitarbeiterId || typeof s.gueltig_ab !== "string" || s.gueltig_ab > datumIso) continue;
    if (typeof s.satz_eur_h !== "number") continue;
    if (!treffer || s.gueltig_ab > treffer.gueltig_ab) treffer = s;
  }
  return treffer;
}

/**
 * Office rate in Euro/hour: the fixed rule value zeit_honorar.buerosatz when
 * set, otherwise the mean of the rates valid on the day (one per person).
 * 115,00 / 111,41 / 74,27 → 100,23. Null when neither exists.
 * @param {ReadonlyArray<Record<string, any>>} saetze Kostensatz records
 * @param {string} datumIso 'YYYY-MM-DD'
 * @param {number|null|undefined} festwert zeit_honorar.buerosatz (Euro/hour) or null
 * @returns {{satz: number, quelle: 'regel'|'mittel'}|null}
 */
export function buerosatz(saetze, datumIso, festwert) {
  if (typeof festwert === "number" && festwert > 0) return { satz: rund2(festwert), quelle: "regel" };
  const personen = new Set((Array.isArray(saetze) ? saetze : []).map((s) => s?.mitarbeiter_id).filter(Boolean));
  const werte = [];
  for (const id of personen) {
    const s = gueltigerSatz(saetze, id, datumIso);
    if (s) werte.push(s.satz_eur_h);
  }
  if (!werte.length) return null;
  return { satz: rund2(werte.reduce((a, b) => a + b, 0) / werte.length), quelle: "mittel" };
}
