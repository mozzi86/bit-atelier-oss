// Annual profit statement — EÜR (phase 79, plan 79-11, E-04/E-11/BUCH-14/BUCH-18):
// cash-basis GROSS method as in the official Anlage EÜR (§ 4 Abs. 3 EStG,
// Zufluss/Abfluss § 11 EStG), split into net + VAT lines like the outgoing/
// incoming invoice ledgers, profit allocation by legal form, prior-year
// comparison. GmbH/UG keep books instead (§§ 238, 242 HGB i. V. m. § 13
// Abs. 3 GmbHG) — this module returns only a hint for them, no line items.
//
// In:  Ausgangsrechnung (zahlungen[]), Eingangsrechnung, Steuerzahlung,
//      Fahrzeug/Fahrt (via fuhrpark.js), Anlagegut (via anlagen.js) —
//      datenmodell.js, amounts in EURO — effective settings
//      (wirksameEinstellungen), legal rates (saetzeZum) and a business year.
// Out: pure functions in CENTS (geld.js convention), plus literal t() text
//      helpers for the line-item and hint keys (i18n guard pattern of
//      ausgaben.js kategorieText).

import { afaSumme, anlagenverzeichnis } from "./anlagen.js";
import { KATEGORIEN, kategorieText } from "./ausgaben.js";
import { gewinnanteile, wirksamerSchluessel } from "./entnahmen.js";
import { kilometergeld, nutzungsentnahme } from "./fuhrpark.js";
import { euroZuCent, rundeCent, ustCent } from "./geld.js";
import { rechtsformWirkung } from "./rechtsform.js";

/**
 * One line of the statement, with the receipts it was summed from (T4:
 * "jede Zeile zu ihren Belegen aufklappbar").
 * @typedef {{schluessel: string, betragCent: number, belege: Array<{id: string, datum?: string, cent: number}>}} EuerZeile
 */

/**
 * Full result of euerJahr() for a legal form that keeps books (GmbH/UG) —
 * no line items, only the hint the Reiter shows instead of the table.
 * @typedef {{hinweis: "bilanzierung", ug: boolean}} EuerBilanzHinweis
 */

/**
 * @typedef {{
 *   zeilen: EuerZeile[], einnahmen: number, ausgaben: number, afa: number, gewinn: number,
 *   hinweise: string[],
 * }} EuerErgebnis
 */

/** An outgoing invoice counts once it left draft status (§ 14 UStG-relevant document exists). */
const zaehlend = (/** @type {{status?: string}|null|undefined} */ r) => r?.status === "gestellt" || r?.status === "storniert";

/**
 * The business year a VAT payment/refund (Steuerzahlung art "ust"/"ust_svz")
 * counts in under cash-basis accounting (§ 11 EStG), applying the short-term
 * ("kurze Zeit") 10-day rule of § 11 Abs. 2 S. 2 EStG to the December filing
 * period: paid within the first ten CALENDAR days of the following January
 * counts in the PRIOR year. `[ASSUMED]` BFH line followed here: the 10-day
 * window is a fixed calendar period (1.–10.1.) and is NOT itself pushed by a
 * weekend/holiday due-date shift (§ 108 Abs. 3 AO) — a point disputed in the
 * literature, kept here as a comment for the office to confirm with its tax
 * advisor. A permanent extension (Dauerfristverlängerung) moves the December
 * period's own statutory date to 10 February, outside the window, so the
 * rule never applies then — only the actual PAYMENT year counts. SVZ
 * payments (always due 10.2.) are never inside the window either.
 * @param {{art?: string, zeitraum?: {von: string, bis: string}|null, bezahlt_am?: string|null}} sz Steuerzahlung
 * @param {{dauerfrist?: boolean}} einst effective settings
 * @returns {number|null} business year the payment is booked in, or null when unpaid
 */
export function steuerzahlungJahr(sz, einst) {
  const bezahltAm = sz?.bezahlt_am;
  if (!bezahltAm) return null;
  const zahlJahr = Number(String(bezahltAm).slice(0, 4));
  const periodenEnde = sz?.art === "ust" ? sz?.zeitraum?.bis : null;
  if (periodenEnde && Number(String(periodenEnde).slice(5, 7)) === 12 && einst?.dauerfrist !== true) {
    const periodenJahr = Number(String(periodenEnde).slice(0, 4));
    const grenze = `${periodenJahr + 1}-01-10`;
    if (String(bezahltAm) <= grenze) return periodenJahr;
  }
  return zahlJahr;
}

/** @param {number} wert @returns {number} rounded to one decimal (percent, not money) */
const rundeProzent = (wert) => Math.round(wert * 10) / 10;

/**
 * Adds a line to `zeilen` and its amount to the running total, but only when
 * there is anything to show (a category with no bookings does not clutter the
 * statement with a zero row).
 * @param {EuerZeile[]} zeilen
 * @param {string} schluessel
 * @param {number} betragCent
 * @param {Array<{id: string, datum?: string, cent: number}>} belege
 * @returns {number} betragCent, for the caller's running sum
 */
function zeile(zeilen, schluessel, betragCent, belege) {
  if (betragCent === 0 && belege.length === 0) return 0;
  zeilen.push({ schluessel, betragCent, belege });
  return betragCent;
}

/**
 * The annual profit statement for one business year, cash basis (§ 4 Abs. 3
 * EStG), gross method (net + VAT as separate lines, like the official Anlage
 * EÜR). GmbH/UG (rechtsformWirkung().gewinnermittlung === "bilanz"): returns
 * only the balance-sheet hint, no lines — booking is not this module's job.
 * @param {{daten: Record<string, any[]>, einst: Record<string, any>, saetze: Record<string, any>, jahr: number|string}} eingabe
 * @returns {EuerErgebnis|EuerBilanzHinweis}
 */
export function euerJahr({ daten, einst, saetze, jahr }) {
  const wirkung = rechtsformWirkung(einst);
  if (wirkung.gewinnermittlung === "bilanz") {
    return { hinweis: "bilanzierung", ug: wirkung.rechtsform === "ug" };
  }

  const jahrZahl = Number(jahr);
  const jahrText = String(jahrZahl);
  const ustSatz = Number(saetze?.ust?.saetze?.regel) || 19;

  /** @type {EuerZeile[]} */
  const zeilen = [];
  let einnahmenCent = 0;
  let ausgabenCent = 0;

  // --- Einnahmen: Zahlungseingänge (Ausgangsrechnung.zahlungen), brutto → netto + vereinnahmte
  // USt, same per-payment proration as 79-05's ustAusgang (Ist-Versteuerung: each payment
  // carries its share of the WHOLE invoice's VAT, from the stored r.ust/r.brutto — never
  // re-derived from a rate, so a storno or a rounded historical invoice stays consistent).
  let umsatzCent = 0;
  {
    let nettoCent = 0; let ustGesamtCent = 0;
    /** @type {EuerZeile["belege"]} */
    const belege = [];
    for (const r of Array.isArray(daten?.Ausgangsrechnung) ? daten.Ausgangsrechnung : []) {
      if (!zaehlend(r)) continue;
      const bruttoGesamtCent = euroZuCent(r?.brutto);
      if (bruttoGesamtCent === 0) continue;
      const ustRechnungCent = euroZuCent(r?.ust);
      for (const z of Array.isArray(r?.zahlungen) ? r.zahlungen : []) {
        if (String(z?.datum || "").slice(0, 4) !== jahrText) continue;
        const zCent = euroZuCent(z?.betrag);
        if (!zCent) continue;
        const ustAnteil = rundeCent((ustRechnungCent * zCent) / bruttoGesamtCent);
        nettoCent += zCent - ustAnteil; // net = the rest, so netto + USt is exactly the payment
        ustGesamtCent += ustAnteil;
        belege.push({ id: r.id, datum: z.datum, cent: zCent });
      }
    }
    einnahmenCent += zeile(zeilen, "einnahmen_leistungen_netto", nettoCent, belege);
    einnahmenCent += zeile(zeilen, "einnahmen_leistungen_ust", ustGesamtCent, []);
    umsatzCent = nettoCent + ustGesamtCent;
  }

  // --- Einnahmen: Kfz-Nutzungsentnahme (owner's/partner's private use, fuhrpark.js), split
  // net/VAT. `[ASSUMED]`: the withdrawal's own value is booked as the net income line; the
  // output VAT owed on it (itself computed on fuhrpark.js's own `[ASSUMED]` 80 % assessment
  // base — no real invoice exists for a withdrawal, so no exact split is on file) is booked
  // as a second income line, mirroring how an outgoing invoice's collected VAT is booked.
  {
    const nutzung = nutzungsentnahme(daten, jahrZahl, saetze, einst);
    const bemessungCent = nutzung.zeilen.reduce((n, z) => n + (z.ustBemessungCent || 0), 0);
    const ustCentWert = ustCent(bemessungCent, ustSatz);
    const belege = nutzung.zeilen.map((z) => ({ id: z.fahrzeug_id, cent: z.jahreswertCent }));
    einnahmenCent += zeile(zeilen, "einnahmen_nutzungsentnahme_netto", nutzung.summeCent, belege);
    einnahmenCent += zeile(zeilen, "einnahmen_nutzungsentnahme_ust", ustCentWert, []);
  }

  // --- Ausgaben: bezahlte Eingangsrechnungen ohne anlage_id (die zählen nur über die AfA),
  // je Kategorie außer "personal" (eigene Zeile, siehe unten) — netto- und VSt-Zeile aus den
  // GESPEICHERTEN Feldern (nicht neu aus dem Steuerfall abgeleitet: "brutto darf > netto + VSt
  // sein", 79-RESEARCH Datenmodell — netto/VSt sind die maßgeblichen, abziehbaren Beträge).
  const eingang = Array.isArray(daten?.Eingangsrechnung) ? daten.Eingangsrechnung : [];
  for (const kategorie of Object.keys(KATEGORIEN)) {
    if (kategorie === "personal") continue;
    let nettoCent = 0; let vstCent = 0;
    /** @type {EuerZeile["belege"]} */
    const belege = [];
    for (const e of eingang) {
      if (e?.kategorie !== kategorie || e?.anlage_id || !e?.bezahlt_am) continue;
      if (String(e.bezahlt_am).slice(0, 4) !== jahrText) continue;
      nettoCent += euroZuCent(e.netto);
      vstCent += euroZuCent(e.vorsteuer);
      belege.push({ id: e.id, datum: e.bezahlt_am, cent: euroZuCent(e.netto) + euroZuCent(e.vorsteuer) });
    }
    ausgabenCent += zeile(zeilen, `ausgaben_${kategorie}_netto`, nettoCent, belege);
    ausgabenCent += zeile(zeilen, `ausgaben_${kategorie}_vst`, vstCent, []);
  }

  // --- Ausgaben: Kategorie "personal" (Löhne/Gehälter inkl. GF-Gehalt) — eigene Zeile, immer
  // steuerfrei (KATEGORIEN.personal), also netto = brutto, keine VSt-Zeile.
  {
    let bruttoCent = 0;
    /** @type {EuerZeile["belege"]} */
    const belege = [];
    for (const e of eingang) {
      if (e?.kategorie !== "personal" || e?.anlage_id || !e?.bezahlt_am) continue;
      if (String(e.bezahlt_am).slice(0, 4) !== jahrText) continue;
      bruttoCent += euroZuCent(e.netto);
      belege.push({ id: e.id, datum: e.bezahlt_am, cent: euroZuCent(e.netto) });
    }
    ausgabenCent += zeile(zeilen, "ausgaben_personal", bruttoCent, belege);
  }

  // --- Ausgaben: Kilometergeld (Fahrt.fahrzeug_id === null, private Fahrzeuge) des Jahres.
  {
    const fahrtenDesJahres = (Array.isArray(daten?.Fahrt) ? daten.Fahrt : [])
      .filter((f) => String(f?.datum || "").slice(0, 4) === jahrText);
    const km = kilometergeld(fahrtenDesJahres, saetze);
    const belege = km.zeilen.map((z) => ({ id: `${z.person}|${z.monat}`, datum: `${z.monat}-01`, cent: z.betragCent }));
    ausgabenCent += zeile(zeilen, "ausgaben_kilometergeld", km.summeCent, belege);
  }

  // --- Ausgaben: gezahlte Umsatzsteuer (art ust/ust_svz), 10-Tage-Regel siehe steuerzahlungJahr;
  // Einnahmen: USt-Erstattungen (derselbe Datensatz, negativer Betrag = Erstattung).
  {
    let ustZahlungCent = 0; let erstattungCent = 0;
    /** @type {EuerZeile["belege"]} */
    const zahlungBelege = [];
    /** @type {EuerZeile["belege"]} */
    const erstattungBelege = [];
    for (const s of Array.isArray(daten?.Steuerzahlung) ? daten.Steuerzahlung : []) {
      if (s?.art !== "ust" && s?.art !== "ust_svz") continue;
      if (steuerzahlungJahr(s, einst) !== jahrZahl) continue;
      const cent = euroZuCent(s.betrag);
      if (cent > 0) { ustZahlungCent += cent; zahlungBelege.push({ id: s.id, datum: s.bezahlt_am, cent }); }
      else if (cent < 0) { erstattungCent += -cent; erstattungBelege.push({ id: s.id, datum: s.bezahlt_am, cent: -cent }); }
    }
    ausgabenCent += zeile(zeilen, "ausgaben_ust", ustZahlungCent, zahlungBelege);
    einnahmenCent += zeile(zeilen, "einnahmen_ust_erstattung", erstattungCent, erstattungBelege);
  }

  // --- Ausgaben: Gewerbesteuer, "nicht abziehbar" (§ 4 Abs. 5b EStG) — nur wenn tatsächlich
  // gewerblich (natürliche Person/Personengesellschaft mit gewst_aktiv; GmbH/UG sind hier oben
  // schon draußen). Cash-basis wie jede andere Steuerzahlung, KEINE 10-Tage-Regel (die gilt nur
  // für USt-VA-Perioden, § 11 Abs. 2 S. 2 EStG nennt sie nicht für die GewSt-Vorauszahlung).
  if (wirkung.gewst) {
    let gewstCent = 0;
    /** @type {EuerZeile["belege"]} */
    const belege = [];
    for (const s of Array.isArray(daten?.Steuerzahlung) ? daten.Steuerzahlung : []) {
      if (s?.art !== "gewst" || !s?.bezahlt_am) continue;
      if (String(s.bezahlt_am).slice(0, 4) !== jahrText) continue;
      const cent = euroZuCent(s.betrag);
      gewstCent += cent;
      belege.push({ id: s.id, datum: s.bezahlt_am, cent });
    }
    ausgabenCent += zeile(zeilen, "ausgaben_gewst", gewstCent, belege);
  }

  // --- AfA (anlagen.js), eigene Zeile für den Export, plus als Summenfeld für die Gewinnformel.
  const afaCent = afaSumme(daten, jahrZahl, saetze);
  zeile(zeilen, "afa", afaCent, anlagenverzeichnis(daten, jahrZahl, saetze)
    .filter((a) => a.afaJahrCent > 0).map((a) => ({ id: a.id, datum: a.anschaffung_datum, cent: a.afaJahrCent })));

  // --- Hinweise: § 180 AO Feststellung bei Personengesellschaften; § 141 AO Buchführungsgrenzen
  // bei gewerblicher Tätigkeit natürlicher Personen/Personengesellschaften, GEGEN DIE ECHTEN
  // JAHRESZAHLEN geprüft (schärfer als rechtsform.js' pauschaler Hinweis "gewst_aktiv gesetzt").
  /** @type {string[]} */
  const hinweise = [];
  if (wirkung.schluesselNoetig) hinweise.push("feststellung");
  if (wirkung.gewst) {
    const grenzen = saetze?.buchfuehrung?.grenzen_141_ao;
    if (umsatzCent > euroZuCent(grenzen?.umsatz) || (einnahmenCent - ausgabenCent - afaCent) > euroZuCent(grenzen?.gewinn)) {
      hinweise.push("grenzen_141_ao");
    }
  }

  return { zeilen, einnahmen: einnahmenCent, ausgaben: ausgabenCent, afa: afaCent, gewinn: einnahmenCent - ausgabenCent - afaCent, hinweise };
}

/**
 * Profit allocation by legal form (E-04), delegating to entnahmen.js's own
 * key-resolution + split so the two areas can never disagree: sole
 * proprietor → 100 % to the owner (wirksamerSchluessel already resolves this
 * without a stored key); GbR/PartG → by the year's profit-sharing key, or
 * `{fehlt: "schluessel"}` when none sums to 100 % (never NaN).
 * @param {number} gewinnCent profit of `jahr`, cents (may be 0 or negative)
 * @param {{Gesellschafter?: Array<Record<string, any>>}} daten bh.daten
 * @param {Record<string, any>} einst effective settings
 * @param {number|string} jahr business year
 * @returns {Record<string, number>|{fehlt: "schluessel"}}
 */
export function aufteilung(gewinnCent, daten, einst, jahr) {
  const schluessel = wirksamerSchluessel(daten, einst, jahr);
  if (!schluessel) return { fehlt: "schluessel" };
  return gewinnanteile(gewinnCent, schluessel);
}

/**
 * Prior year's profit for the comparison line: computed the same way as
 * `jahr` when the prior year itself has any booked line (so two consecutive
 * years in this app are always comparable on equal terms), otherwise the
 * manually entered figure (`einst.vorjahr_euer[jahr-1].gewinn`, Euro) — the
 * office's first year in this app, before any bookings exist here.
 * @param {Record<string, any[]>} daten bh.daten
 * @param {Record<string, any>} einst effective settings
 * @param {Record<string, any>} saetze saetzeZum(…) — reused as-is for the prior year (a
 *   simplification: the legal rates this calculation reads rarely change year to year)
 * @param {number|string} jahr business year
 * @returns {number|null} cents, or null when nothing is known
 */
export function vorjahr(daten, einst, saetze, jahr) {
  const vorjahrZahl = Number(jahr) - 1;
  const berechnet = euerJahr({ daten, einst, saetze, jahr: vorjahrZahl });
  if (!("hinweis" in berechnet) && berechnet.zeilen.length > 0) return berechnet.gewinn;
  const eingetragen = einst?.vorjahr_euer?.[vorjahrZahl];
  const wert = eingetragen && typeof eingetragen === "object" ? eingetragen.gewinn : undefined;
  return typeof wert === "number" && Number.isFinite(wert) ? euroZuCent(wert) : null;
}

/**
 * Absolute and percentage change against the prior year's profit.
 * @param {number} istCent this year's profit, cents
 * @param {number|null} vorjahrCent prior year's profit, cents (null = unknown)
 * @returns {{deltaCent: number, prozent: number|null}|null} null when the prior year is unknown;
 *   `prozent` null when the prior year was exactly 0 (percentage undefined)
 */
export function vergleich(istCent, vorjahrCent) {
  if (typeof vorjahrCent !== "number") return null;
  const deltaCent = istCent - vorjahrCent;
  const prozent = vorjahrCent !== 0 ? rundeProzent((deltaCent / Math.abs(vorjahrCent)) * 100) : null;
  return { deltaCent, prozent };
}

/**
 * German label of one euerJahr() line (literal t() calls for the i18n guard —
 * pattern of ausgaben.js kategorieText). Per-category keys reuse
 * ausgaben.kategorieText so the two areas never drift apart.
 * @param {string} schluessel EuerZeile.schluessel
 * @param {(k: string) => string} t translator
 * @returns {string}
 */
export function zeileText(schluessel, t) {
  if (schluessel === "einnahmen_leistungen_netto") return t("Betriebseinnahmen (netto)");
  if (schluessel === "einnahmen_leistungen_ust") return t("vereinnahmte Umsatzsteuer");
  if (schluessel === "einnahmen_nutzungsentnahme_netto") return t("Nutzungsentnahme Kfz (netto)");
  if (schluessel === "einnahmen_nutzungsentnahme_ust") return t("Nutzungsentnahme Kfz, USt");
  if (schluessel === "einnahmen_ust_erstattung") return t("Umsatzsteuererstattungen");
  if (schluessel === "ausgaben_personal") return t("Löhne und Gehälter");
  if (schluessel === "ausgaben_kilometergeld") return t("Kilometergeld");
  if (schluessel === "ausgaben_ust") return t("gezahlte Umsatzsteuer");
  if (schluessel === "ausgaben_gewst") return t("Gewerbesteuer (nicht abziehbar, § 4 Abs. 5b EStG)");
  if (schluessel === "afa") return t("Abschreibungen (AfA)");
  const kategorieTreffer = /^ausgaben_([a-z]+)_(netto|vst)$/.exec(schluessel);
  if (kategorieTreffer) {
    const basis = kategorieText(kategorieTreffer[1], t);
    return kategorieTreffer[2] === "vst" ? `${basis} (${t("Vorsteuer")})` : `${basis} (${t("netto")})`;
  }
  return schluessel;
}

/**
 * German text of one euerJahr() hint key (literal t() calls for the i18n guard).
 * @param {string} schluessel "feststellung" | "grenzen_141_ao"
 * @param {(k: string) => string} t translator
 * @returns {string}
 */
export function hinweisText(schluessel, t) {
  if (schluessel === "feststellung") {
    return t("Der Gewinn wird gesondert und einheitlich festgestellt (§ 180 Abs. 1 S. 1 Nr. 2 Buchst. a AO).");
  }
  if (schluessel === "grenzen_141_ao") {
    return t("Umsatz oder Gewinn über der Buchführungsgrenze — Buchführungspflicht mit dem Steuerberater prüfen (§ 141 AO).");
  }
  return schluessel;
}

/**
 * Table model of one year's EÜR for CSV/XLSX export (ExportKnopf). A
 * balance-sheet legal form (GmbH/UG) exports a single hint row instead.
 * @param {{daten: Record<string, any[]>, einst: Record<string, any>, saetze: Record<string, any>, jahr: number|string}} eingabe
 * @param {(k: string) => string} t translator (column labels, line labels)
 * @returns {import("./tabellenExport.js").Tabellenmodell}
 */
export function euerTabelle(eingabe, t) {
  const ergebnis = euerJahr(eingabe);
  const spalten = [{ key: "zeile", label: t("Zeile"), typ: "text" }, { key: "betrag", label: t("Betrag"), typ: "betrag" }];
  if ("hinweis" in ergebnis) {
    const zeile = ergebnis.ug ? t("Bilanzierungspflicht — keine EÜR (UG zusätzlich: 25 % Rücklage, § 5a Abs. 3 GmbHG)") : t("Bilanzierungspflicht — keine EÜR (§§ 238, 242 HGB i. V. m. § 13 Abs. 3 GmbHG)");
    return { titel: t("Jahresübersicht"), spalten, zeilen: [{ zeile, betrag: 0 }] };
  }
  const zeilen = ergebnis.zeilen.map((z) => ({ zeile: zeileText(z.schluessel, t), betrag: z.betragCent / 100 }));
  zeilen.push({ zeile: t("Gewinn"), betrag: ergebnis.gewinn / 100 });
  return { titel: t("Jahresübersicht"), spalten, zeilen };
}
