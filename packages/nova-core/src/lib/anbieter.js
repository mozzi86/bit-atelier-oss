// Provider details for the legal pages (57-06 Task 0/1).
//
// This is the ONE place the operator fills in. rechtstexte.jsx renders from it
// and never carries a literal name, address or number of its own.
//
// Why a separate file and not inline text: an imprint with invented values is
// worse than a missing one - it is a false statement about who is responsible,
// not an omission. The fields carry the operator's real details (filled in
// 22.09.2026); scripts/build-cloud.mjs refuses to build for hosting while a
// required field is blank (fehlendeAngaben below). Anyone running their own
// instance from the open-source code replaces these values with their own —
// a blank field renders as "— fehlt —" instead of being silently invented.
//
// The German legal classifications are [ASSUMED] throughout - a lawyer has to
// read this before the first paying customer (57-06 Task 9).
//
// Plain .js on purpose (no JSX, no imports): the build guard imports it from
// Node, where the @core alias and JSX do not exist.

/**
 * Everything that only the operator knows. What is still missing shows
 * `fehlendeAngaben()` below; `npm run build:cloud` aborts on any gap.
 */
export const ANBIETER = {
  // --- § 5 DDG: who is offering this ------------------------------------
  /** Civil name. Required even when trading as "BIT-Atelier" - a business
   *  name alone does not satisfy § 5 DDG. [ASSUMED] */
  name: 'Mohamed Elmokadem',
  /** Trading name shown next to the civil name. Optional. */
  geschaeftsbezeichnung: 'bit-atelier',
  /** Wording taken verbatim from the existing imprint on bit-atelier.de so the
   *  two do not state different things about the same person. */
  rechtsform: 'Freiberufliche Tätigkeit — keine Eintragung im Handelsregister',
  strasse: 'Am Röthenbacher Landgraben 36',
  plz: '90451',
  ort: 'Nürnberg',
  land: 'Deutschland',
  /** Person authorised to represent. For a sole trader: the same as `name`. */
  vertretungsberechtigt: 'Mohamed Elmokadem',
  email: 'me@bit-atelier.de',
  /** § 5 Abs. 1 Nr. 2 DDG wants a second, immediate channel next to e-mail. */
  telefon: '0176 74554989',
  /** USt-IdNr. (NOT the Steuernummer - that one does not belong in an imprint).
   *  Taken from the operator's own record of 27.08.2026. CONFIRM before the
   *  first publish: a wrong number here is a wrong imprint. */
  ustIdNr: 'DE464635659',
  /** § 18 Abs. 2 MStV, only needed for journalistic-editorial content; set it
   *  anyway, it costs nothing and is usually the operator. */
  verantwortlichMstv: 'Mohamed Elmokadem',

  // --- What this offering is --------------------------------------------
  /** Decision of 19.09.2026: offered as a SOFTWARE service, not as an
   *  architect's service. Therefore NO chamber, no professional title, no
   *  professional code of conduct in the imprint. If this ever flips, those
   *  three become mandatory and § 2 DL-InfoV additionally wants the
   *  professional indemnity insurer with NAME AND ADDRESS plus its
   *  geographical scope. [ASSUMED] */
  artDesAngebots: 'software',

  // --- Data protection ---------------------------------------------------
  /** Supervisory authority the visitor may complain to, Art. 13 Abs. 2 lit. d.
   *  Pre-filled for a controller seated in Bavaria. [ASSUMED] - correct it if
   *  the seat is elsewhere. */
  aufsichtsbehoerde:
    'Bayerisches Landesamt für Datenschutzaufsicht (BayLDA), Promenade 18, 91522 Ansbach',
  /** Either the DPO's contact details, or the empty string. Empty produces the
   *  sentence "Ein Datenschutzbeauftragter ist nicht bestellt." - which is a
   *  statement, not a gap, so it is NOT part of the required fields. */
  datenschutzbeauftragter: '',
  /** Address the access requests are sent to. May differ from `email` so it can
   *  be switched off on its own if it ever gets harvested. */
  anfrageEmail: 'zugang@bit-atelier.de',

  // --- Numbers that appear in the text and therefore have to be true -----
  /** Deletion period for requests that never become a contract. Note the
   *  tension a lawyer has to resolve: once a request turns into an offer it is
   *  a commercial letter and §§ 257 HGB / 147 AO demand far longer retention.
   *  [ASSUMED] */
  loeschfristAnfragenMonate: 6,
  /** Promised response time. Five working days, not three: the operator is
   *  regularly on site for days and there is no automatic acknowledgement. */
  antwortfristWerktage: 5,

  // --- Target group (VERK-06) -------------------------------------------
  /** true = offered exclusively to entrepreneurs under § 14 BGB. This decides
   *  whether a right of withdrawal, the § 36 VSBG statement and the PAngV
   *  price rules apply at all. [ASSUMED] */
  nurUnternehmer: true,
};

/**
 * Fields without which the imprint would be incomplete - and an incomplete
 * imprint is itself a warnable defect, so these gate the hosting build.
 * `datenschutzbeauftragter` is deliberately absent: empty is a valid answer.
 */
const PFLICHTFELDER = [
  ['name', 'Name des Anbieters (bürgerlicher Name)'],
  ['rechtsform', 'Rechtsform'],
  ['strasse', 'Straße und Hausnummer'],
  ['plz', 'Postleitzahl'],
  ['ort', 'Ort'],
  ['vertretungsberechtigt', 'Vertretungsberechtigte Person'],
  ['email', 'E-Mail-Adresse'],
  ['telefon', 'Telefonnummer'],
  ['ustIdNr', 'Umsatzsteuer-Identifikationsnummer'],
  ['verantwortlichMstv', 'Verantwortlicher nach § 18 Abs. 2 MStV'],
  ['anfrageEmail', 'E-Mail-Adresse für Zugangsanfragen'],
];

/** Labels of the fields still blank. Empty array = ready to publish. */
export function fehlendeAngaben(daten = ANBIETER) {
  return PFLICHTFELDER.filter(([schluessel]) => !String(daten[schluessel] || '').trim()).map(
    ([, beschriftung]) => beschriftung
  );
}

/** True once every required field carries a value. */
export function anbieterVollstaendig(daten = ANBIETER) {
  return fehlendeAngaben(daten).length === 0;
}

/**
 * What a field renders as while it is still blank. Never an invented value -
 * a visible gap is honest, a plausible-looking placeholder is a false
 * statement about the provider.
 */
export const FEHLT = '— fehlt —';

/** Reads a field for display, showing the gap marker instead of nothing. */
export function angabe(schluessel, daten = ANBIETER) {
  const wert = String(daten[schluessel] || '').trim();
  return wert || FEHLT;
}
