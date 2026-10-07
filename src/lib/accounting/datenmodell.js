// Data contract of the accounting module (phase 79): entity names, the key of
// the office Setting, and the key lists (status, categories, tax cases …) that
// every area plan reads. Keys only — labels live in the components (t()).
//
// Storage rules (79-RESEARCH "Datenmodell"): dates always 'YYYY-MM-DD'; amounts
// in Euro with two decimals (computed in cents, geld.js); never stored: overdue
// status, VAT payable, balance, coverage, depreciation, book value. Write
// always get → update | create (speicher.js), filters only on string ids.
//
// In:  nothing (import-free). Out: constants and JSDoc typedefs.

/** Entity names (bitApi.entities.<name>). */
export const ENTITAET = Object.freeze({
  HONORARVERTRAG: "Honorarvertrag",
  AUSGANGSRECHNUNG: "Ausgangsrechnung",
  EINGANGSRECHNUNG: "Eingangsrechnung",
  WIEDERKEHRENDE_AUSGABE: "WiederkehrendeAusgabe",
  VERSICHERUNG: "Versicherung",
  STEUERZAHLUNG: "Steuerzahlung",
  GESELLSCHAFTER: "Gesellschafter",
  ENTNAHME: "Entnahme",
  BANKUMSATZ: "Bankumsatz",
  FAHRZEUG: "Fahrzeug",
  FAHRT: "Fahrt",
  ANLAGEGUT: "Anlagegut",
  BELEG: "Beleg",
});

/** The 13 accounting collections, loaded together by speicher.ladeAlles. */
export const BUCHHALTUNG_ENTITAETEN = Object.freeze(Object.values(ENTITAET));

/** Key of the office Setting record: Setting{key: "buchhaltung", value}. */
export const SETTING_KEY = "buchhaltung";

/** Stored status of an outgoing invoice (GoBD: gestellt → only storno). */
export const AUSGANGSRECHNUNG_STATUS = Object.freeze(["geplant", "entwurf", "gestellt", "storniert"]);
/** Computed status of an outgoing invoice (grundlagen.rechnungsStatus), never stored. */
export const RECHNUNGS_STATUS = Object.freeze(["geplant", "entwurf", "offen", "teilbezahlt", "ueberfaellig", "bezahlt", "storniert"]);
/** Kind of an outgoing invoice. */
export const RECHNUNGS_ARTEN = Object.freeze(["abschlag", "teilschluss", "schluss", "sonstige", "storno"]);
/** Kind of client: decides default interest and the flat fee (§ 288 BGB). */
export const BAUHERR_ARTEN = Object.freeze(["unternehmer", "verbraucher", "oeffentlich"]);
/** Source of the anrechenbare Kosten of a fee contract. */
export const ANRECHENBARE_QUELLEN = Object.freeze(["manuell", "lv"]);
/** Category of an incoming invoice; `personal` = wages incl. managing director's salary (E-04), not in the DATEV batch. */
export const EINGANG_KATEGORIEN = Object.freeze(["miete", "software", "versicherung", "kammer", "fahrzeug", "personal", "sonstiges"]);
/** Tax case of an incoming invoice. */
export const STEUERFAELLE = Object.freeze(["regel19", "regel7", "steuerfrei", "versicherungsteuer", "reverse_charge_13b"]);
/** Rhythm of a recurring expense. */
export const RHYTHMEN = Object.freeze(["monat", "quartal", "jahr"]);
/** Kind of insurance or guarantee. */
export const VERSICHERUNG_TYPEN = Object.freeze(["berufshaftpflicht", "betriebshaftpflicht", "buergschaft", "sonstige"]);
/** Payment interval of a premium. */
export const ZAHLWEISEN = Object.freeze(["monat", "quartal", "halbjahr", "jahr"]);
/** Kind of tax payment (negative amount = refund). */
export const STEUER_ARTEN = Object.freeze(["ust", "ust_svz", "est", "kst", "gewst"]);
/** Role of a person in the office (E-04): sole proprietor = exactly one active `inhaber`. */
export const GESELLSCHAFTER_ROLLEN = Object.freeze(["inhaber", "gesellschafter", "partner", "geschaeftsfuehrer"]);
/** Kind of a drawing. */
export const ENTNAHME_ARTEN = Object.freeze(["bar", "ueberweisung", "sache", "steuer"]);
/** Status of a bank transaction. */
export const BANKUMSATZ_STATUS = Object.freeze(["offen", "zugeordnet", "ignoriert"]);
/** Drive of a vehicle. */
export const ANTRIEBE = Object.freeze(["verbrenner", "hybrid", "elektro"]);
/** User of a company car: owner/partner (withdrawal) or employee (benefit in kind). */
export const NUTZER_ARTEN = Object.freeze(["gesellschafter", "arbeitnehmer"]);
/** Method for the private use of a company car. */
export const FAHRZEUG_METHODEN = Object.freeze(["pauschal", "fahrtenbuch"]);
/** Purchase or lease of a vehicle. */
export const KAUF_LEASING = Object.freeze(["kauf", "leasing"]);
/** Kind of a trip. */
export const FAHRT_ARTEN = Object.freeze(["dienstlich", "privat", "wohnung_arbeit"]);
/** Category of a fixed asset (keys of GESETZ.AFA.nd_tabelle). */
export const ANLAGE_KATEGORIEN = Object.freeze(["bueroausstattung", "rechner", "plotter", "fahrzeug", "software", "sonstiges"]);
/** Depreciation method of a fixed asset. */
export const AFA_METHODEN = Object.freeze(["linear", "gwg", "sammel", "sofort"]);

/**
 * Fee contract (flat, as phase 81 expects; ≥ 1 per project).
 * Amounts in Euro, percentages in percent, `bezugswert` in Euro or hectares
 * (unit from leistungsbildInfo), dates 'YYYY-MM-DD'.
 * @typedef {{
 *   id: string, project_id: string, leistungsbild: string,
 *   bauherr_contact_id?: string, bauherr_name?: string, bauherr_anschrift?: string, bauherr_ust_idnr?: string,
 *   bauherr_art?: "unternehmer"|"verbraucher"|"oeffentlich",
 *   zahlungsziel_tage?: number, zahlungsziel_vertraglich?: boolean,
 *   anrechenbare_quelle?: "manuell"|"lv", kg300_euro?: number, kg400_euro?: number, sonstige_euro?: number,
 *   bezugswert?: number, mvb_euro?: number, honorarzone?: string, satz_position_prozent?: number,
 *   lph?: Array<{beauftragt: boolean, prozent: number}>, umbauzuschlag_prozent?: number,
 *   nebenkosten_prozent?: number, pauschal_euro?: number|null, ust_satz?: number, textform_am?: string,
 *   beispiel?: boolean,
 * }} Honorarvertrag
 */

/**
 * Outgoing invoice. `netto`, `ust`, `brutto` and payment amounts in Euro; `nummer`
 * only once "gestellt"; recipient, number, due date and term are frozen on "Stellen".
 * @typedef {{
 *   id: string, project_id?: string, project_name?: string, honorarvertrag_id?: string, nummer?: string,
 *   art?: string, lp_pos?: Array<{lp: number, stand: number, netto: number}>,
 *   netto: number, ust_satz: number, ust: number, brutto: number,
 *   rechnungsdatum?: string, leistung_von?: string, leistung_bis?: string,
 *   zahlungsziel_tage?: number, faellig_am?: string,
 *   status: "geplant"|"entwurf"|"gestellt"|"storniert", versand_geplant_am?: string,
 *   empfaenger?: object, verzugshinweis?: boolean,
 *   zahlungen?: Array<{datum: string, betrag: number, bankumsatz_id?: string}>,
 *   mahnungen?: Array<{stufe: number, datum: string, frist?: string, zinsen?: number, pauschale?: number}>,
 *   storno_von?: string, beispiel?: boolean,
 * }} Ausgangsrechnung
 */

/**
 * Incoming invoice / expense. Amounts in Euro (`brutto` may exceed netto + VSt,
 * e.g. insurance tax). `anlage_id` set → depreciation instead of an expense.
 * @typedef {{
 *   id: string, lieferant: string, contact_id?: string, kategorie: string, steuerfall: string, fremd_nr?: string,
 *   rechnungsdatum?: string, leistungsdatum?: string, netto: number, vorsteuer: number, brutto: number,
 *   faellig_am?: string, bezahlt_am?: string|null, beleg_id?: string, project_id?: string, fahrzeug_id?: string,
 *   anlage_id?: string, versicherung_id?: string, wiederkehrend_id?: string, periode?: string, beispiel?: boolean,
 * }} Eingangsrechnung
 */

/**
 * Recurring expense (template like an incoming invoice). Occurrences are
 * computed (grundlagen.wiederkehrendeVorkommen); "paid" creates an
 * Eingangsrechnung with id `wa:<id>:<periode>` (idempotent).
 * @typedef {Eingangsrechnung & {rhythmus: "monat"|"quartal"|"jahr", start: string, bis?: string, aktiv?: boolean}} WiederkehrendeAusgabe
 */

/**
 * Insurance or guarantee. Amounts in Euro, `aval_prozent` in percent per year,
 * `kuendigung_tage` in days.
 * @typedef {{
 *   id: string, typ: string, versicherer: string, police?: string, deckung?: number, beginn?: string, ende?: string,
 *   kuendigung_tage?: number, praemie?: number, zahlweise?: string, naechste_faelligkeit?: string,
 *   project_id?: string, buergschaft_betrag?: number, aval_prozent?: number, rueckgabe_am?: string, beispiel?: boolean,
 * }} Versicherung
 */

/**
 * Tax payment (one truth for clock, EÜR and bank). `betrag` in Euro, negative = refund.
 * @typedef {{
 *   id: string, art: "ust"|"ust_svz"|"est"|"kst"|"gewst", zeitraum: {von: string, bis: string}|null,
 *   betrag: number, faellig_am: string, bezahlt_am?: string|null, bankumsatz_id?: string, beispiel?: boolean,
 * }} Steuerzahlung
 */

/**
 * Person of the office. `entnahme_plan_monat` in Euro per month.
 * @typedef {{
 *   id: string, name: string, rolle: "inhaber"|"gesellschafter"|"partner"|"geschaeftsfuehrer",
 *   aktiv?: boolean, entnahme_plan_monat?: number, iban?: string, beispiel?: boolean,
 * }} Gesellschafter
 */

/**
 * Drawing. `betrag` in Euro.
 * @typedef {{
 *   id: string, gesellschafter_id: string, datum: string, betrag: number,
 *   art: "bar"|"ueberweisung"|"sache"|"steuer", bankumsatz_id?: string, beispiel?: boolean,
 * }} Entnahme
 */

/**
 * Bank transaction. `betrag` in Euro, signed (+ incoming).
 * @typedef {{
 *   id: string, buchungstag: string, valuta?: string, betrag: number, zweck?: string, gegenpartei?: string,
 *   iban?: string, import_id?: string, hash?: string, status: "offen"|"zugeordnet"|"ignoriert",
 *   zuordnung?: {typ: string, id: string, modus: "auto"|"manuell"}|null, beispiel?: boolean,
 * }} Bankumsatz
 */

/**
 * Vehicle. `blp` (list price) in Euro, `co2_g_km` in g/km, `e_reichweite_km` and
 * `entfernung_km` (home–office distance) in km.
 * @typedef {{
 *   id: string, kennzeichen: string, nutzer?: string, nutzer_art: "gesellschafter"|"arbeitnehmer",
 *   blp: number, antrieb: "verbrenner"|"hybrid"|"elektro", co2_g_km?: number, e_reichweite_km?: number,
 *   anschaffung_datum: string, entfernung_km?: number, nutzung_ab?: string, nutzung_bis?: string,
 *   methode: "pauschal"|"fahrtenbuch", kauf_leasing: "kauf"|"leasing", beispiel?: boolean,
 * }} Fahrzeug
 */

/**
 * Trip. `fahrzeug_id: null` = private car (mileage allowance); `km` in km.
 * `mitarbeiter_id` (80-10, Task 7b, additiv): an opaque reference into the
 * personal storage class (Personal-Zugang), never a copied name — `person`
 * (free text) stays the fallback for offices without personnel records
 * (E-17: a solo owner works fully without a single Mitarbeiter row).
 * @typedef {{
 *   id: string, fahrzeug_id: string|null, person: string, datum: string, ziel?: string, zweck?: string,
 *   km: number, km_start?: number, km_ende?: number, art: "dienstlich"|"privat"|"wohnung_arbeit",
 *   project_id?: string, beispiel?: boolean, mitarbeiter_id?: string|null,
 * }} Fahrt
 */

/**
 * Fixed asset. `ak_netto` (acquisition cost) in Euro, `nutzungsdauer` in years.
 * @typedef {{
 *   id: string, bezeichnung: string, kategorie: string, anschaffung_datum: string, ak_netto: number,
 *   nutzungsdauer: number, methode: "linear"|"gwg"|"sammel"|"sofort", fahrzeug_id?: string,
 *   eingangsrechnung_id?: string, abgang?: {datum: string, erloes: number}|null, beispiel?: boolean,
 * }} Anlagegut
 */

/**
 * Receipt file (data URL, at most BUERO_STANDARD.beleg_max_bytes). `groesse` in bytes.
 * @typedef {{
 *   id: string, name: string, mime: string, groesse: number, data: string,
 *   bezug?: {typ: string, id: string}, beispiel?: boolean,
 * }} Beleg
 */
