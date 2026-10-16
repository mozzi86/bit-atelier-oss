// XRechnung export of outgoing invoices (phase 93, plan 93-01, register lever 156).
//
// Public clients only accept structured e-invoices: the federal administration
// since 27.11.2020 (E-Rechnungsverordnung, § 3 ERechV), the states staggered
// after it, and since 01.01.2025 every business in Germany must be able to
// RECEIVE one (§ 14 Abs. 1 UStG i. d. F. Wachstumschancengesetz). This module
// turns an issued Ausgangsrechnung into an XRechnung 3.0 document — the German
// CIUS of EN 16931-1:2017 — in the UBL 2.1 syntax (CII would be equally
// valid; one syntax is enough). A cancellation (art "storno") becomes a UBL
// CreditNote (type code 381) with positive amounts that references the
// cancelled invoice (BT-25), because EN 16931 does not allow a negative item
// price (BR-27) and a credit note is the document receivers expect.
//
// Three pure steps, so tests can check each on its own:
//   xrechnungModell()  invoice + office profile + letterhead → BT field model (cents)
//   pruefeXRechnung()  model → violated rules (EN 16931 core rules BR-…, BR-CO-…,
//                      BR-S-…/BR-E-… and the XRechnung rules BR-DE-…) that can be
//                      checked without the official KoSIT validator (Schematron)
//   xrechnungUbl()     model → UBL XML text (UTF-8)
// exportiereXRechnung() chains them and refuses the file while a rule is violated
// (liability choice: a document a public client's portal will reject must not
// look like a finished invoice — so fail, never warn).
//
// Rule texts and field numbers: EN 16931-1:2017 (semantic model, BT/BG numbers),
// CEN/TS 16931-3-2 (UBL binding), "Spezifikation XRechnung 3.0.2" (KoSIT,
// rules BR-DE-1 … BR-DE-23), "Format-Spezifikation Leitweg-ID" 2.0.2 (KoSIT).
// NOT done here: the official validator run (KoSIT validator + XRechnung
// Schematron) — an open external step, see 93-01-SUMMARY.
//
// In:  an Ausgangsrechnung record (datenmodell.js, Euro), the effective accounting
//      settings (einst.buero: steuernr, ust_idnr, iban; name only as fallback, 94-02), the letterhead
//      ({office, address, contact} free text, @core/lib/briefkopf.js) and — for a
//      storno — the cancelled original. Out: plain data, XML text; no I/O.

import { euroZuCent } from "./geld.js";
import { bueroNameAus } from "./bueroName.js";

/** CustomizationID (BT-24) of XRechnung 3.0 (BR-DE-21). */
export const XRECHNUNG_KENNUNG = "urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0";

/** ProfileID (BT-23): the PEPPOL billing process, also used by XRechnung for UBL. */
export const PROFIL_KENNUNG = "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0";

/**
 * Invoice type codes (BT-3, UNTDID 1001) XRechnung allows (BR-DE-17).
 * 326 partial invoice (instalment, "Abschlagsrechnung"), 380 commercial invoice,
 * 381 credit note, 384 corrected invoice, 389 self-billed, 875–877 construction invoices.
 */
export const ERLAUBTE_TYPEN = Object.freeze(["326", "380", "384", "389", "381", "875", "876", "877"]);

/**
 * VAT exemption reason (BT-120) for a 0 % invoice. [ASSUMED] An architect's
 * office billing 0 % is most likely a small business under § 19 UStG — the
 * other 0 % cases (reverse charge § 13b, EU services) would need category AE/K
 * and the buyer's VAT ID. Way to a verified value: an office setting
 * "Grund der Steuerbefreiung" once a real 0 % case appears.
 */
export const BEFREIUNG_KLEINUNTERNEHMER = "Kein Ausweis von Umsatzsteuer, da Kleinunternehmer gemäß § 19 UStG";

/**
 * German message per rule ID — the UI shows "<rule>: t(<text>)"; every text has
 * an English entry in i18nTeile/buchhaltung-xrechnung.js (checked by the unit test).
 * @type {Readonly<Record<string, string>>}
 */
export const MELDUNGEN = Object.freeze({
  "BR-02": "Rechnungsnummer fehlt (BT-1) — nur gestellte Rechnungen haben eine Nummer.",
  "BR-03": "Rechnungsdatum fehlt (BT-2).",
  "BR-06": "Name des Büros fehlt (BT-27) — Einstellungen › Büro & Briefkopf.",
  "BR-07": "Name des Rechnungsempfängers fehlt (BT-44).",
  "BR-16": "Die Rechnung hat keine Position (BG-25).",
  "BR-27": "Ein Einzelpreis ist negativ (BT-146).",
  "BR-CO-10": "Summe der Positionen weicht vom Nettobetrag ab (BT-106).",
  "BR-CO-14": "Umsatzsteuer weicht von der Summe der Steueraufschlüsselung ab (BT-110).",
  "BR-CO-15": "Bruttobetrag ist nicht Netto plus Umsatzsteuer (BT-112).",
  "BR-CO-25": "Fälligkeitsdatum oder Zahlungsbedingung fehlt (BT-9/BT-20).",
  "BR-S-09": "Umsatzsteuer passt nicht zu Bemessungsgrundlage und Satz (BT-117).",
  "BR-DE-1": "Zahlungsangaben fehlen (BG-16).",
  "BR-DE-2": "Kontaktangaben des Büros fehlen (BG-6).",
  "BR-DE-3": "Ort des Büros fehlt (BT-37) — Anschrift im Briefkopf mit „PLZ Ort“ angeben.",
  "BR-DE-4": "Postleitzahl des Büros fehlt (BT-38) — Anschrift im Briefkopf mit „PLZ Ort“ angeben.",
  "BR-DE-5": "Ansprechpartner des Büros fehlt (BT-41).",
  "BR-DE-6": "Telefonnummer des Büros fehlt (BT-42) — im Briefkopf unter Kontakt angeben.",
  "BR-DE-7": "E-Mail-Adresse des Büros fehlt (BT-43) — im Briefkopf unter Kontakt angeben.",
  "BR-DE-8": "Ort des Rechnungsempfängers fehlt (BT-52) — Anschrift am Honorarvertrag mit „PLZ Ort“ angeben.",
  "BR-DE-9": "Postleitzahl des Rechnungsempfängers fehlt (BT-53) — Anschrift am Honorarvertrag angeben.",
  "BR-DE-15": "Leitweg-ID bzw. Käuferreferenz fehlt (BT-10) — am Honorarvertrag oder an der Rechnung eintragen.",
  "BR-DE-16": "USt-IdNr. oder Steuernummer des Büros fehlt (BT-31/BT-32) — Buchhaltung › Einstellungen.",
  "BR-DE-17": "Rechnungsart ist für XRechnung nicht zulässig (BT-3).",
  "BR-DE-23": "IBAN des Büros fehlt (BT-84) — Buchhaltung › Einstellungen.",
  "BR-DE-34": "Elektronische Adresse des Büros fehlt (BT-34) — E-Mail im Briefkopf angeben.",
  "LEITWEG": "Leitweg-ID hat kein gültiges Format oder eine falsche Prüfziffer (BT-10/BT-49).",
  "STATUS": "Nur gestellte oder stornierte Rechnungen lassen sich als XRechnung ausgeben.",
});

/**
 * One postal address split from free text.
 * @typedef {{strasse: string, zusatz: string, plz: string, ort: string, land: string}} Anschrift
 */

/** Country prefixes seen in German letterheads ("D-90402", "A-1010", "CH-8001") → ISO 3166-1 alpha-2. */
const LAND_PRAEFIX = Object.freeze({ D: "DE", DE: "DE", A: "AT", AT: "AT", CH: "CH" });

/**
 * Splits a free-text postal address ("Straße 1\n12345 Ort", also comma-separated)
 * into the BG-5/BG-8 parts. The line "PLZ Ort" is searched from the end; the line
 * before it is the street, anything earlier an additional line. Lines equal to
 * `name` (letterheads often repeat the office name) are skipped. Country: from a
 * prefix such as "D-" or "A-", otherwise Germany [ASSUMED: the app targets DACH,
 * German offices first; the country is not a field of the letterhead].
 * @param {string|null|undefined} text free text address
 * @param {string} [name] party name to skip if repeated in the address
 * @returns {Anschrift} empty strings for parts not found
 */
export function anschriftTeile(text, name = "") {
  const zeilen = String(text || "").split(/\r?\n|,/).map((z) => z.trim()).filter((z) => z && z !== name.trim());
  const leer = { strasse: "", zusatz: "", plz: "", ort: "", land: "DE" };
  for (let i = zeilen.length - 1; i >= 0; i -= 1) {
    const m = /^(?:([A-Z]{1,2})\s*-\s*)?(\d{4,5})\s+(.+)$/.exec(zeilen[i]);
    if (!m) continue;
    const land = m[1] ? LAND_PRAEFIX[m[1]] || "DE" : "DE";
    return { strasse: zeilen[i - 1] || "", zusatz: zeilen.slice(0, Math.max(0, i - 1)).join(", "), plz: m[2], ort: m[3].trim(), land };
  }
  return { ...leer, strasse: zeilen[0] || "" };
}

/**
 * Phone number and e-mail address from the letterhead's free-text contact line
 * ("Tel. 0911 123456 · info@example.de").
 * @param {string|null|undefined} text
 * @returns {{telefon: string, email: string}} empty strings when not found
 */
export function kontaktTeile(text) {
  const s = String(text || "");
  const email = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.exec(s)?.[0] || "";
  const ohneMail = email ? s.replace(email, " ") : s;
  const telefon = /\+?\d[\d\s/().-]{5,}\d/.exec(ohneMail)?.[0].replace(/\s+/g, " ").trim() || "";
  return { telefon, email };
}

/**
 * Checks a Leitweg-ID: coarse part (2–12 digits), optional fine part (up to 30
 * letters/digits), two check digits, separated by "-"; check digits by
 * ISO/IEC 7064 MOD 97-10 over coarse+fine with letters as 10…35 (KoSIT
 * "Format-Spezifikation Leitweg-ID" 2.0.2, Abschnitt 4).
 * @param {string|null|undefined} id
 * @returns {boolean}
 */
export function leitwegIdGueltig(id) {
  const s = String(id || "").trim().toUpperCase();
  const m = /^(\d{2,12})(?:-([A-Z0-9]{1,30}))?-(\d{2})$/.exec(s);
  if (!m) return false;
  const ziffern = `${m[1]}${m[2] || ""}`.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  // MOD 97-10 on a long digit string, chunked so no BigInt is needed.
  let rest = 0;
  for (const z of `${ziffern}00`) rest = (rest * 10 + Number(z)) % 97;
  return String(98 - rest).padStart(2, "0") === m[3];
}

/**
 * One invoice line (BG-25) of the model. Amounts in cents, always ≥ 0 in a
 * credit note (the document type carries the sign).
 * @typedef {{id: string, name: string, beschreibung: string, menge: number, preisCent: number, nettoCent: number, kategorie: string, satz: number}} Position
 */

/**
 * The BT field model of one XRechnung. Amounts in whole cents, dates 'YYYY-MM-DD'.
 * @typedef {{
 *   dokument: "Invoice"|"CreditNote",
 *   typ: string, nummer: string, datum: string, faellig: string, waehrung: string,
 *   kaeuferReferenz: string, zahlungsbedingung: string, notizen: string[],
 *   leistungVon: string, leistungBis: string,
 *   vorgaenger: {nummer: string, datum: string}|null,
 *   verkaeufer: Anschrift & {name: string, ustIdnr: string, steuernr: string, kontaktName: string, telefon: string, email: string},
 *   kaeufer: Anschrift & {name: string, ustIdnr: string, leitwegId: string},
 *   zahlung: {code: string, iban: string, kontoinhaber: string, verwendungszweck: string},
 *   positionen: Position[],
 *   steuern: Array<{kategorie: string, satz: number, basisCent: number, steuerCent: number, befreiungsgrund: string}>,
 *   summen: {positionenCent: number, ohneUstCent: number, ustCent: number, mitUstCent: number, zahlbarCent: number},
 * }} XRechnungModell
 */

/** @param {number} satz VAT rate in percent @returns {string} UNCL 5305 category: S standard, E exempt */
const kategorieZu = (satz) => (satz > 0 ? "S" : "E");

/**
 * Invoice type code (BT-3) for an invoice's `art`: the instalment of the HOAI
 * fee chain is a partial invoice (326, "Abschlagsrechnung" — § 15 Abs. 2 HOAI),
 * a storno a credit note (381), everything else a commercial invoice (380).
 * @param {string|undefined} art Ausgangsrechnung.art
 * @returns {string}
 */
export function rechnungstyp(art) {
  if (art === "storno") return "381";
  if (art === "abschlag") return "326";
  return "380";
}

/** @param {string} iso 'YYYY-MM-DD' @returns {string} 'TT.MM.JJJJ' */
const deDatum = (iso) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "");

/**
 * Item name of one lp_pos line: "Leistungsphase 3 (HOAI), Stand 60 %" or the
 * amendment's own label.
 * @param {{lp: number|null, stand?: number, bezeichnung?: string}} pos
 * @returns {string}
 */
function positionsName(pos) {
  if (pos.lp == null) return pos.bezeichnung || "Honorarnachtrag";
  const stand = typeof pos.stand === "number" && pos.stand > 0 ? `, Stand ${pos.stand} %` : "";
  return `Leistungsphase ${pos.lp} (HOAI)${stand}`;
}

/** @param {string|undefined} art @returns {string} German item name for a one-line invoice */
function artName(art) {
  switch (art) {
    case "abschlag": return "Abschlagszahlung Architektenhonorar";
    case "teilschluss": return "Teilschlussrechnung Architektenhonorar";
    case "schluss": return "Schlussrechnung Architektenhonorar";
    case "storno": return "Stornierung";
    default: return "Architektenleistung";
  }
}

/**
 * Builds the BT model of an issued invoice. Lines come from `lp_pos` when their
 * sum equals the invoice's net amount (the form computes netto exactly so), else
 * — storno, legacy records — one line with the invoice's net amount. A credit
 * note carries the lines of the cancelled original when given, with all amounts
 * turned positive.
 * @param {Record<string, any>} rechnung Ausgangsrechnung (status gestellt/storniert)
 * @param {{
 *   einst: Record<string, any>,
 *   briefkopf?: {office?: string, address?: string, contact?: string}|null,
 *   original?: Record<string, any>|null,
 * }} kontext einst = wirksameEinstellungen(); original = the invoice a storno cancels
 * @returns {XRechnungModell}
 */
export function xrechnungModell(rechnung, { einst, briefkopf = null, original = null }) {
  const gutschrift = rechnung.art === "storno";
  const vorzeichen = gutschrift ? -1 : 1;
  const satz = typeof rechnung.ust_satz === "number" ? rechnung.ust_satz : 19;
  const kategorie = kategorieZu(satz);
  const nettoCent = vorzeichen * euroZuCent(rechnung.netto);
  const ustCentWert = vorzeichen * euroZuCent(rechnung.ust);
  const bruttoCent = vorzeichen * euroZuCent(rechnung.brutto);

  const quellePos = gutschrift ? original?.lp_pos : rechnung.lp_pos;
  const pos = Array.isArray(quellePos) ? quellePos : [];
  const posSumme = pos.reduce((n, p) => n + euroZuCent(p?.netto), 0);
  /** @type {Position[]} */
  const positionen = pos.length && posSumme === nettoCent
    ? pos.map((p, i) => {
      const cent = euroZuCent(p.netto);
      // A negative line (e.g. a credited amendment) keeps a positive price and a
      // negative quantity — BR-27 forbids negative prices, not negative quantities.
      return { id: String(i + 1), name: positionsName(p), beschreibung: "", menge: cent < 0 ? -1 : 1, preisCent: Math.abs(cent), nettoCent: cent, kategorie, satz };
    })
    : [{ id: "1", name: artName(rechnung.art), beschreibung: rechnung.project_name || "", menge: nettoCent < 0 ? -1 : 1, preisCent: Math.abs(nettoCent), nettoCent, kategorie, satz }];

  const empf = rechnung.empfaenger || {};
  const leitweg = String(rechnung.leitweg_id || empf.leitweg_id || "").trim();
  const kaeuferAnschrift = anschriftTeile(empf.anschrift, empf.name || "");
  const buero = einst?.buero || {};
  // 94-02: one office name — the letterhead, the old accounting field only as fallback.
  const verkaeuferName = bueroNameAus(briefkopf, einst);
  const verkaeuferAnschrift = anschriftTeile(briefkopf?.address, verkaeuferName);
  const kontakt = kontaktTeile(briefkopf?.contact);

  const notizen = [];
  if (kategorie === "E") notizen.push(BEFREIUNG_KLEINUNTERNEHMER);
  if (rechnung.project_name) notizen.push(`Projekt: ${rechnung.project_name}`);

  const faellig = gutschrift ? "" : String(rechnung.faellig_am || "");
  return {
    dokument: gutschrift ? "CreditNote" : "Invoice",
    typ: rechnungstyp(rechnung.art),
    nummer: String(rechnung.nummer || ""),
    datum: String(rechnung.rechnungsdatum || ""),
    faellig,
    waehrung: "EUR",
    kaeuferReferenz: leitweg,
    // BR-CO-25 also applies to a credit note (positive amount due) — its terms say how it is settled.
    zahlungsbedingung: faellig
      ? `Zahlbar ohne Abzug bis ${deDatum(faellig)}.`
      : gutschrift ? `Gutschrift zur Rechnung ${original?.nummer || ""}; Betrag wird erstattet oder verrechnet.`.replace(" ;", ";") : "",
    notizen,
    leistungVon: String(rechnung.leistung_von || ""),
    leistungBis: String(rechnung.leistung_bis || ""),
    vorgaenger: gutschrift && original?.nummer ? { nummer: String(original.nummer), datum: String(original.rechnungsdatum || "") } : null,
    verkaeufer: {
      name: verkaeuferName, ...verkaeuferAnschrift,
      ustIdnr: String(buero.ust_idnr || "").replace(/\s+/g, ""), steuernr: String(buero.steuernr || "").trim(),
      // [ASSUMED] BT-41 asks for a contact point; the letterhead has no person, so the office name stands in.
      kontaktName: verkaeuferName, telefon: kontakt.telefon, email: kontakt.email,
    },
    kaeufer: { name: String(empf.name || "").trim(), ...kaeuferAnschrift, ustIdnr: String(empf.ust_idnr || "").replace(/\s+/g, ""), leitwegId: leitweg },
    // SEPA credit transfer (UNCL 4461 code 58); remittance information = invoice number (BT-83).
    zahlung: { code: "58", iban: String(buero.iban || "").replace(/\s+/g, "").toUpperCase(), kontoinhaber: verkaeuferName, verwendungszweck: String(rechnung.nummer || "") },
    positionen,
    steuern: [{ kategorie, satz, basisCent: nettoCent, steuerCent: ustCentWert, befreiungsgrund: kategorie === "E" ? BEFREIUNG_KLEINUNTERNEHMER : "" }],
    summen: { positionenCent: positionen.reduce((n, p) => n + p.nettoCent, 0), ohneUstCent: nettoCent, ustCent: ustCentWert, mitUstCent: bruttoCent, zahlbarCent: bruttoCent },
  };
}

/**
 * One violated rule.
 * @typedef {{regel: string, text: string}} Verstoss
 */

/**
 * Checks the rules of EN 16931 and XRechnung 3.0 that need no Schematron engine:
 * mandatory fields, the sums (BR-CO-10/13/14/15/16), the VAT breakdown
 * (BR-S-08/09, BR-E-10) and the German CIUS additions (BR-DE-…). The official
 * validator checks more (code lists, syntax binding) — this is the part that
 * catches missing office or client data before a portal rejects the file.
 * @param {XRechnungModell} m
 * @returns {Verstoss[]} empty = no violation found
 */
export function pruefeXRechnung(m) {
  /** @type {Verstoss[]} */
  const fehler = [];
  const melde = (regel) => { if (!fehler.some((f) => f.regel === regel)) fehler.push({ regel, text: MELDUNGEN[regel] || regel }); };

  if (!m.nummer) melde("BR-02");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(m.datum)) melde("BR-03");
  if (!ERLAUBTE_TYPEN.includes(m.typ)) melde("BR-DE-17");
  if (!m.verkaeufer.name) melde("BR-06");
  if (!m.kaeufer.name) melde("BR-07");
  if (!m.positionen.length) melde("BR-16");
  if (m.positionen.some((p) => p.preisCent < 0)) melde("BR-27");

  // Sums, all in whole cents (EN 16931 § 6.4: amounts with two decimals).
  const posSumme = m.positionen.reduce((n, p) => n + p.nettoCent, 0);
  if (posSumme !== m.summen.positionenCent) melde("BR-CO-10");
  // BR-CO-13: tax exclusive = line sum (no document-level allowances/charges here).
  if (m.summen.ohneUstCent !== m.summen.positionenCent) melde("BR-CO-10");
  const steuerSumme = m.steuern.reduce((n, s) => n + s.steuerCent, 0);
  if (steuerSumme !== m.summen.ustCent) melde("BR-CO-14");
  if (m.summen.mitUstCent !== m.summen.ohneUstCent + m.summen.ustCent) melde("BR-CO-15");
  // BR-CO-25: a positive amount due needs a due date or payment terms.
  if (m.summen.zahlbarCent > 0 && !m.faellig && !m.zahlungsbedingung) melde("BR-CO-25");
  for (const s of m.steuern) {
    // BR-S-08/BR-E-08: taxable amount per category = sum of that category's lines.
    const basis = m.positionen.filter((p) => p.kategorie === s.kategorie && p.satz === s.satz).reduce((n, p) => n + p.nettoCent, 0);
    if (basis !== s.basisCent) melde("BR-CO-10");
    // BR-S-09: tax = taxable amount × rate, rounded to the cent (§ 14 Abs. 4 Nr. 8 UStG rounds per invoice).
    const erwartet = Math.sign(s.basisCent) * Math.round(Math.abs(s.basisCent) * s.satz / 100);
    if (s.kategorie === "S" && s.steuerCent !== erwartet) melde("BR-S-09");
    if (s.kategorie === "E" && (s.steuerCent !== 0 || !s.befreiungsgrund)) melde("BR-S-09");
  }

  // XRechnung CIUS (BR-DE-…).
  if (!m.zahlung.code) melde("BR-DE-1");
  if (!m.verkaeufer.kontaktName && !m.verkaeufer.telefon && !m.verkaeufer.email) melde("BR-DE-2");
  if (!m.verkaeufer.ort) melde("BR-DE-3");
  if (!m.verkaeufer.plz) melde("BR-DE-4");
  if (!m.verkaeufer.kontaktName) melde("BR-DE-5");
  if (!m.verkaeufer.telefon) melde("BR-DE-6");
  if (!m.verkaeufer.email) melde("BR-DE-7");
  if (!m.kaeufer.ort) melde("BR-DE-8");
  if (!m.kaeufer.plz) melde("BR-DE-9");
  // BR-DE-16 / BR-S-02 / BR-E-02: seller VAT ID or tax number for categories S and E.
  if (!m.verkaeufer.ustIdnr && !m.verkaeufer.steuernr) melde("BR-DE-16");
  if (m.zahlung.code === "58" && !m.zahlung.iban) melde("BR-DE-23");
  // XRechnung 3.0: seller and buyer electronic address (BT-34, BT-49) are mandatory.
  if (!m.verkaeufer.email) melde("BR-DE-34");
  // BT-10 and BT-49 both carry the Leitweg-ID of a public client (scope of this
  // export, lever 156). A B2B buyer reference without Leitweg-ID would need the
  // buyer's e-mail as BT-49 — not modelled yet, so such an invoice fails here.
  if (!m.kaeuferReferenz) melde("BR-DE-15");
  else if (!leitwegIdGueltig(m.kaeuferReferenz)) melde("LEITWEG");
  return fehler;
}

/** @param {unknown} s @returns {string} XML-escaped text content/attribute value */
export function xmlText(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** @param {number} cent @returns {string} "1234.50" (EN 16931 decimal point, two places) */
const betrag = (cent) => `${cent < 0 ? "-" : ""}${Math.floor(Math.abs(cent) / 100)}.${String(Math.abs(cent) % 100).padStart(2, "0")}`;

/**
 * UBL 2.1 serialisation of the model (CEN/TS 16931-3-2 binding). Element order
 * follows the UBL schema sequence — a reordered element is a schema error even
 * when every value is right. Amounts of a credit note are positive.
 * @param {XRechnungModell} m
 * @returns {string} XML text with declaration, UTF-8, LF line ends
 */
export function xrechnungUbl(m) {
  const gs = m.dokument === "CreditNote";
  const w = m.waehrung;
  const z = [];
  const tag = (name, inhalt, attr = "") => (inhalt === "" || inhalt == null ? "" : `<${name}${attr}>${xmlText(inhalt)}</${name}>`);
  const geld = (name, cent) => `<${name} currencyID="${w}">${betrag(gs ? Math.abs(cent) : cent)}</${name}>`;
  const sign = (cent) => (gs ? Math.abs(cent) : cent);

  const adresse = (p) => [
    "<cac:PostalAddress>",
    tag("cbc:StreetName", p.strasse), tag("cbc:AdditionalStreetName", p.zusatz), tag("cbc:CityName", p.ort), tag("cbc:PostalZone", p.plz),
    `<cac:Country><cbc:IdentificationCode>${xmlText(p.land || "DE")}</cbc:IdentificationCode></cac:Country>`,
    "</cac:PostalAddress>",
  ].join("");

  const ns = gs ? "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2" : "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2";
  z.push('<?xml version="1.0" encoding="UTF-8"?>');
  z.push(`<${m.dokument} xmlns="${ns}" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">`);
  z.push(tag("cbc:CustomizationID", XRECHNUNG_KENNUNG));
  z.push(tag("cbc:ProfileID", PROFIL_KENNUNG));
  z.push(tag("cbc:ID", m.nummer));
  z.push(tag("cbc:IssueDate", m.datum));
  if (!gs) z.push(tag("cbc:DueDate", m.faellig));
  z.push(tag(gs ? "cbc:CreditNoteTypeCode" : "cbc:InvoiceTypeCode", m.typ));
  for (const n of m.notizen) z.push(tag("cbc:Note", n));
  z.push(tag("cbc:DocumentCurrencyCode", w));
  z.push(tag("cbc:BuyerReference", m.kaeuferReferenz));
  if (m.leistungVon || m.leistungBis) {
    z.push(`<cac:InvoicePeriod>${tag("cbc:StartDate", m.leistungVon)}${tag("cbc:EndDate", m.leistungBis)}</cac:InvoicePeriod>`);
  }
  if (m.vorgaenger) {
    z.push(`<cac:BillingReference><cac:InvoiceDocumentReference>${tag("cbc:ID", m.vorgaenger.nummer)}${tag("cbc:IssueDate", m.vorgaenger.datum)}</cac:InvoiceDocumentReference></cac:BillingReference>`);
  }

  const v = m.verkaeufer;
  z.push("<cac:AccountingSupplierParty><cac:Party>");
  if (v.email) z.push(`<cbc:EndpointID schemeID="EM">${xmlText(v.email)}</cbc:EndpointID>`);
  z.push(`<cac:PartyName>${tag("cbc:Name", v.name)}</cac:PartyName>`);
  z.push(adresse(v));
  if (v.ustIdnr) z.push(`<cac:PartyTaxScheme>${tag("cbc:CompanyID", v.ustIdnr)}<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>`);
  // BT-32 tax number: scheme "FC" (fiscal code) per the XRechnung UBL binding.
  if (v.steuernr) z.push(`<cac:PartyTaxScheme>${tag("cbc:CompanyID", v.steuernr)}<cac:TaxScheme><cbc:ID>FC</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>`);
  z.push(`<cac:PartyLegalEntity>${tag("cbc:RegistrationName", v.name)}</cac:PartyLegalEntity>`);
  z.push(`<cac:Contact>${tag("cbc:Name", v.kontaktName)}${tag("cbc:Telephone", v.telefon)}${tag("cbc:ElectronicMail", v.email)}</cac:Contact>`);
  z.push("</cac:Party></cac:AccountingSupplierParty>");

  const k = m.kaeufer;
  z.push("<cac:AccountingCustomerParty><cac:Party>");
  // BT-49: the Leitweg-ID is the routing address of German public clients, scheme 0204 (ISO 6523 ICD).
  if (k.leitwegId) z.push(`<cbc:EndpointID schemeID="0204">${xmlText(k.leitwegId)}</cbc:EndpointID>`);
  z.push(`<cac:PartyName>${tag("cbc:Name", k.name)}</cac:PartyName>`);
  z.push(adresse(k));
  if (k.ustIdnr) z.push(`<cac:PartyTaxScheme>${tag("cbc:CompanyID", k.ustIdnr)}<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>`);
  z.push(`<cac:PartyLegalEntity>${tag("cbc:RegistrationName", k.name)}</cac:PartyLegalEntity>`);
  z.push("</cac:Party></cac:AccountingCustomerParty>");

  z.push("<cac:PaymentMeans>");
  z.push(tag("cbc:PaymentMeansCode", m.zahlung.code));
  z.push(tag("cbc:PaymentID", m.zahlung.verwendungszweck));
  if (m.zahlung.iban) z.push(`<cac:PayeeFinancialAccount>${tag("cbc:ID", m.zahlung.iban)}${tag("cbc:Name", m.zahlung.kontoinhaber)}</cac:PayeeFinancialAccount>`);
  z.push("</cac:PaymentMeans>");
  if (m.zahlungsbedingung) z.push(`<cac:PaymentTerms>${tag("cbc:Note", m.zahlungsbedingung)}</cac:PaymentTerms>`);

  z.push(`<cac:TaxTotal>${geld("cbc:TaxAmount", m.summen.ustCent)}`);
  for (const s of m.steuern) {
    z.push(`<cac:TaxSubtotal>${geld("cbc:TaxableAmount", s.basisCent)}${geld("cbc:TaxAmount", s.steuerCent)}`);
    z.push(`<cac:TaxCategory>${tag("cbc:ID", s.kategorie)}${tag("cbc:Percent", String(s.satz))}${tag("cbc:TaxExemptionReason", s.befreiungsgrund)}<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory>`);
    z.push("</cac:TaxSubtotal>");
  }
  z.push("</cac:TaxTotal>");

  z.push("<cac:LegalMonetaryTotal>");
  z.push(geld("cbc:LineExtensionAmount", m.summen.positionenCent));
  z.push(geld("cbc:TaxExclusiveAmount", m.summen.ohneUstCent));
  z.push(geld("cbc:TaxInclusiveAmount", m.summen.mitUstCent));
  z.push(geld("cbc:PayableAmount", m.summen.zahlbarCent));
  z.push("</cac:LegalMonetaryTotal>");

  const zeile = gs ? "cac:CreditNoteLine" : "cac:InvoiceLine";
  const menge = gs ? "cbc:CreditedQuantity" : "cbc:InvoicedQuantity";
  for (const p of m.positionen) {
    z.push(`<${zeile}>${tag("cbc:ID", p.id)}<${menge} unitCode="C62">${gs ? Math.abs(p.menge) : p.menge}</${menge}>`);
    z.push(`<cbc:LineExtensionAmount currencyID="${w}">${betrag(sign(p.nettoCent))}</cbc:LineExtensionAmount>`);
    z.push(`<cac:Item>${tag("cbc:Description", p.beschreibung)}${tag("cbc:Name", p.name)}`);
    z.push(`<cac:ClassifiedTaxCategory>${tag("cbc:ID", p.kategorie)}${tag("cbc:Percent", String(p.satz))}<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory></cac:Item>`);
    z.push(`<cac:Price><cbc:PriceAmount currencyID="${w}">${betrag(p.preisCent)}</cbc:PriceAmount></cac:Price></${zeile}>`);
  }
  z.push(`</${m.dokument}>`);
  return `${z.filter(Boolean).join("\n")}\n`;
}

/**
 * File name of the XML: "XRechnung-<number>.xml" with a file-system-safe number.
 * @param {string} nummer invoice number
 * @returns {string}
 */
export function xrechnungDateiname(nummer) {
  const sauber = String(nummer || "entwurf").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "entwurf";
  return `XRechnung-${sauber}.xml`;
}

/**
 * Full export: model, rule check, XML. While a rule is violated there is no
 * XML (a file the receiving portal rejects must not leave the app looking final).
 * @param {Record<string, any>} rechnung Ausgangsrechnung
 * @param {{einst: Record<string, any>, briefkopf?: {office?: string, address?: string, contact?: string}|null, rechnungen?: ReadonlyArray<Record<string, any>>}} kontext
 *   rechnungen: all invoices (to find the original of a storno via storno_von)
 * @returns {{xml: string|null, dateiname: string, fehler: Verstoss[], modell: XRechnungModell}}
 */
export function exportiereXRechnung(rechnung, { einst, briefkopf = null, rechnungen = [] }) {
  const original = rechnung?.storno_von ? (rechnungen || []).find((r) => r?.id === rechnung.storno_von) || null : null;
  const modell = xrechnungModell(rechnung, { einst, briefkopf, original });
  const fehler = pruefeXRechnung(modell);
  if (rechnung?.status !== "gestellt" && rechnung?.status !== "storniert") fehler.unshift({ regel: "STATUS", text: MELDUNGEN.STATUS });
  return { xml: fehler.length ? null : xrechnungUbl(modell), dateiname: xrechnungDateiname(modell.nummer), fehler, modell };
}
