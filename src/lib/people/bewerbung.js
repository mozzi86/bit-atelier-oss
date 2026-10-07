// bewerbung.js — Fachmodell "Bewerbung" (Plan 80-08): Pipeline-Stufen,
// erlaubte Übergänge, die DSGVO-Löschuhr und die Feld-Whitelist (DS-06). Rein
// (keine API-, keine React-Imports) — nur der 79-Kalender-Kern.
//
// Abgleich 28.09.: die 80-02-Seed-Daten (personalSeed.json) und die
// bestehende personalUebersicht.js-Zählung nutzen `entscheidung.art` (nicht
// `entscheidung.ergebnis`, wie die Plan-Beispielzeilen es informell
// schreiben) — dieses Modul folgt der echten Datenform, damit B-1..B-4 des
// Seeds und die bestehende `bewerbungenAktiv`-Zählung unverändert bleiben.
//
// In:  rohe Bewerbung-Objekte, ein regelWert-Leser (personal.aufbewahrung_*).
// Out: STUFEN, UEBERGAENGE, darfWechseln, naechsteStufe, vorigeStufe,
//      loeschenAb, FELDER_BEWERBUNG, normalisiereBewerbung, entscheidungMitArt,
//      absageText.

import { plusMonate } from "@core/lib/kalender/datum.js";

/**
 * Freezes a rule tree (same helper as mitarbeiter.js/vertrag.js/hrRegeln.js).
 * @template T
 * @param {T} wert
 * @returns {T}
 */
function tiefGefroren(wert) {
  if (wert && typeof wert === "object" && !Object.isFrozen(wert)) {
    for (const k of Object.keys(wert)) tiefGefroren(/** @type {any} */ (wert)[k]);
    Object.freeze(wert);
  }
  return wert;
}

/**
 * Die 9 Pipeline-Stufen (personalEntitaeten.js Typedef Bewerbung `stufe`).
 * `arbeitsprobe` steht für Portfolio/Arbeitsprobe, typisch im Architekturbüro.
 * Die drei letzten Einträge sind die Endstufen (fest, keine weiteren
 * Übergänge — eine erneute Bewerbung ist eine neue Zeile, kein Reaktivieren).
 * @type {ReadonlyArray<{key: string, label: string}>}
 */
export const STUFEN = tiefGefroren([
  { key: "eingang", label: "Eingang" },
  { key: "sichtung", label: "Sichtung" },
  { key: "gespraech_1", label: "Gespräch 1" },
  { key: "arbeitsprobe", label: "Arbeitsprobe" },
  { key: "gespraech_2", label: "Gespräch 2" },
  { key: "angebot", label: "Angebot" },
  { key: "zusage", label: "Zusage" },
  { key: "absage", label: "Absage" },
  { key: "zurueckgezogen", label: "Zurückgezogen" },
]);

/** Positionsreihenfolge der offenen Kette plus Zusage (für naechsteStufe/vorigeStufe). */
const KETTE = ["eingang", "sichtung", "gespraech_1", "arbeitsprobe", "gespraech_2", "angebot", "zusage"];

/**
 * Erlaubte Übergänge je Stufe: vorwärts und rückwärts je eine Stufe in der
 * offenen Kette, `zusage` nur aus `angebot`, `absage`/`zurueckgezogen` aus
 * jeder offenen Stufe. Die drei Endstufen haben keine ausgehenden Übergänge.
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
export const UEBERGAENGE = tiefGefroren({
  eingang: ["sichtung", "absage", "zurueckgezogen"],
  sichtung: ["eingang", "gespraech_1", "absage", "zurueckgezogen"],
  gespraech_1: ["sichtung", "arbeitsprobe", "absage", "zurueckgezogen"],
  arbeitsprobe: ["gespraech_1", "gespraech_2", "absage", "zurueckgezogen"],
  gespraech_2: ["arbeitsprobe", "angebot", "absage", "zurueckgezogen"],
  angebot: ["gespraech_2", "zusage", "absage", "zurueckgezogen"],
  zusage: [],
  absage: [],
  zurueckgezogen: [],
});

/**
 * Ob der Wechsel von `von` nach `nach` erlaubt ist (UEBERGAENGE).
 * @param {string} von aktuelle Stufe
 * @param {string} nach Zielstufe
 * @returns {boolean}
 */
export function darfWechseln(von, nach) {
  const ziele = UEBERGAENGE[von];
  return Array.isArray(ziele) && ziele.includes(nach);
}

/**
 * Nächste Stufe in der offenen Kette (rein positional — ob der Wechsel
 * erlaubt ist, entscheidet darfWechseln, nicht diese Funktion).
 * @param {string} stufe
 * @returns {string|null} null am Ende der Kette oder außerhalb (Endstufen absage/zurueckgezogen)
 */
export function naechsteStufe(stufe) {
  const i = KETTE.indexOf(stufe);
  return i === -1 || i === KETTE.length - 1 ? null : KETTE[i + 1];
}

/**
 * Vorige Stufe in der offenen Kette (rein positional, s. naechsteStufe).
 * @param {string} stufe
 * @returns {string|null}
 */
export function vorigeStufe(stufe) {
  const i = KETTE.indexOf(stufe);
  return i <= 0 ? null : KETTE[i - 1];
}

/**
 * Die Stufe, nach der eine Bewerbung tatsächlich einsortiert wird: sobald
 * eine Entscheidung getroffen ist, zählt IMMER `entscheidung.art`
 * (zusage/absage/zurueckgezogen), unabhängig vom gespeicherten `stufe`-Feld.
 * Grund: der 80-02-Seed trägt für längst entschiedene Bewerbungen (B-1, B-2)
 * noch den Altwert `stufe:"abgeschlossen"` — kein Wert aus STUFEN — weil
 * dieser Plan die 9 Pipeline-Stufen erst einführt; `personalSeed.json` liegt
 * außerhalb der files_modified dieses Plans und wird nicht angefasst.
 * @param {{stufe?: string, entscheidung?: {art?: string}}} bewerbung
 * @returns {string}
 */
export function effektiveStufe(bewerbung) {
  return bewerbung?.entscheidung?.art || bewerbung?.stufe || "eingang";
}

/**
 * Der spätere zweier Tage (String-Vergleich reicht für 'YYYY-MM-DD').
 * @param {string} a
 * @param {string} b
 * @returns {string}
 */
function spaeterVon(a, b) {
  return a >= b ? a : b;
}

/**
 * DSGVO-Löschuhr einer Bewerbung (DS-13). Solange keine Entscheidung
 * getroffen ist (`entscheidung.art` fehlt), gibt es noch keine Löschfrist.
 * Basis ist die AGG-Frist (§ 15 Abs. 4 AGG i. V. m. § 61b Abs. 1 ArbGG) ab
 * dem Entscheidungsdatum; ein gültiger (eingewilligter, nicht widerrufener)
 * Talentpool verlängert auf dessen Enddatum, ein Widerruf der Einwilligung
 * (Art. 7 Abs. 3 DSGVO) ersetzt das Talentpool-Ende durch das Widerrufsdatum
 * — die AGG-Frist selbst läuft trotz Widerruf unverändert weiter
 * (Art. 17 Abs. 3 lit. e DSGVO: Rechtsansprüche gehen der Löschpflicht vor).
 * [ASSUMED] Praxiswert der AGG-Frist, s. hrRegeln.js `aufbewahrung_bewerbung_monate`.
 * @param {{entscheidung?: {art?: string, am?: string},
 *   talentpool?: {eingewilligt_am?: string|null, bis?: string|null, widerrufen_am?: string|null}}} bewerbung
 * @param {(id: string) => any} regelWert liest personal.aufbewahrung_bewerbung_monate
 * @returns {string|null} 'YYYY-MM-DD', null solange offen oder bei ungültiger Eingabe
 */
export function loeschenAb(bewerbung, regelWert) {
  const entscheidung = bewerbung?.entscheidung;
  if (!entscheidung?.art || typeof entscheidung.am !== "string") return null;
  const monateRoh = typeof regelWert === "function" ? regelWert("personal.aufbewahrung_bewerbung_monate") : null;
  const monate = typeof monateRoh === "number" && Number.isFinite(monateRoh) ? monateRoh : 6;
  const basis = plusMonate(entscheidung.am, monate);
  if (!basis) return null;
  const talentpool = bewerbung?.talentpool;
  if (talentpool?.widerrufen_am) return spaeterVon(basis, talentpool.widerrufen_am);
  if (talentpool?.eingewilligt_am && talentpool?.bis) return spaeterVon(basis, talentpool.bis);
  return basis;
}

/**
 * Whitelist erlaubter Felder (Art. 5 Abs. 1 lit. c DSGVO, DS-06): jedes Feld
 * außerhalb wird von normalisiereBewerbung verworfen — ausdrücklich OHNE
 * `bisheriges_gehalt` (RL (EU) 2023/970 Art. 5, Entgelttransparenz) und ohne
 * jedes Merkmal nach § 1 AGG.
 */
export const FELDER_BEWERBUNG = Object.freeze({
  oben: Object.freeze([
    "id", "stelle_id", "vorname", "nachname", "eingang_am", "quelle", "stufe",
    "gehaltswunsch_eur", "verfuegbar_ab", "datenschutzhinweis_am", "uebernommen_mitarbeiter_id",
  ]),
  kontakt: Object.freeze(["email", "telefon"]),
  // absage_versandt_am: der Nutzer trägt es selbst ein, NACHDEM er den
  // Absagetext (nur ein kopierbarer Text, kein Versand aus der App) verschickt hat.
  entscheidung: Object.freeze(["art", "am", "grund", "absage_versandt_am"]),
  talentpool: Object.freeze(["eingewilligt_am", "text_version", "bis", "widerrufen_am"]),
  stufenVerlauf: Object.freeze(["stufe", "am"]),
  gespraech: Object.freeze(["datum", "art", "teilnehmende", "notiz", "ergebnis"]),
  bewertung: Object.freeze(["kriterium", "wert"]),
});

/** @param {unknown} v @returns {Record<string, unknown>} */
function alsObjekt(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? /** @type {any} */ (v) : {};
}

/**
 * Kopiert nur die Schlüssel aus `erlaubt` (Muster wie mitarbeiter.js `nurErlaubt`).
 * @param {unknown} quelle
 * @param {readonly string[]} erlaubt
 * @returns {Record<string, unknown>}
 */
function nurErlaubt(quelle, erlaubt) {
  const q = alsObjekt(quelle);
  /** @type {Record<string, unknown>} */
  const aus = {};
  for (const feld of erlaubt) if (q[feld] !== undefined) aus[feld] = q[feld];
  return aus;
}

/**
 * Whitelist-Normalisierung vor jedem create/update (DS-06). Verwirft
 * rekursiv alles außerhalb von FELDER_BEWERBUNG, auch `bisheriges_gehalt`
 * oder ein Merkmal nach § 1 AGG, egal ob top-level oder verschachtelt.
 * @param {unknown} eingabe rohe Formulardaten
 * @returns {Record<string, unknown>} nur erlaubte Felder, gleiche Struktur
 */
export function normalisiereBewerbung(eingabe) {
  const e = alsObjekt(eingabe);
  const aus = nurErlaubt(e, FELDER_BEWERBUNG.oben);
  if (e.kontakt !== undefined) aus.kontakt = nurErlaubt(e.kontakt, FELDER_BEWERBUNG.kontakt);
  if (e.entscheidung !== undefined) aus.entscheidung = nurErlaubt(e.entscheidung, FELDER_BEWERBUNG.entscheidung);
  if (e.talentpool !== undefined) aus.talentpool = nurErlaubt(e.talentpool, FELDER_BEWERBUNG.talentpool);
  if (Array.isArray(e.stufen_verlauf)) aus.stufen_verlauf = e.stufen_verlauf.map((s) => nurErlaubt(s, FELDER_BEWERBUNG.stufenVerlauf));
  if (Array.isArray(e.gespraeche)) aus.gespraeche = e.gespraeche.map((g) => nurErlaubt(g, FELDER_BEWERBUNG.gespraech));
  if (Array.isArray(e.bewertung)) aus.bewertung = e.bewertung.map((b) => nurErlaubt(b, FELDER_BEWERBUNG.bewertung));
  return aus;
}

/**
 * Entscheidung nach einer neuen Auswahl im Formular. "Offen" (`art` leer)
 * leert die GANZE Entscheidung — sonst blieben `am`/`absage_versandt_am` als
 * verwaiste Datumsfelder im gespeicherten Datensatz stehen, ohne sichtbares
 * Feld zum Entfernen. `absage_versandt_am` gehört nur zu einer Absage und
 * fällt beim Wechsel auf Zusage/Rückzug weg; `am` und `grund` bleiben.
 * @param {{art?: string, am?: string, grund?: string, absage_versandt_am?: string}|null|undefined} entscheidung bisherige Entscheidung
 * @param {string|null|undefined} art neue Auswahl: zusage | absage | zurueckgezogen, leer = offen
 * @returns {Record<string, string>} neue Entscheidung, `{}` für offen
 */
export function entscheidungMitArt(entscheidung, art) {
  if (!art) return {};
  /** @type {Record<string, unknown>} */
  const neu = { ...alsObjekt(entscheidung), art };
  if (art !== "absage") delete neu.absage_versandt_am;
  return /** @type {Record<string, string>} */ (neu);
}

/**
 * Absagetext — nur zum Kopieren, kein Versand aus der App. Gespeicherte,
 * ausgehende Fachlichkeit (wie stellenanzeigeText), deshalb Deutsch ohne t().
 * @param {{vorname?: string, nachname?: string}|null|undefined} bewerbung
 * @param {{office?: string}|null|undefined} briefkopf Setting "briefkopf" (Büroname in `office`)
 * @returns {string} mehrzeiliger Klartext
 */
export function absageText(bewerbung, briefkopf) {
  const name = [bewerbung?.vorname, bewerbung?.nachname].filter(Boolean).join(" ") || "Bewerber:in";
  const buero = typeof briefkopf?.office === "string" && briefkopf.office.trim() ? briefkopf.office.trim() : "unserem Büro";
  return `Sehr geehrte/r ${name},\n\nvielen Dank für Ihr Interesse an ${buero} und die Zeit, die Sie in Ihre Bewerbung investiert haben.\nNach sorgfältiger Prüfung können wir Ihnen für diese Position leider keine Zusage geben.\n\nWir wünschen Ihnen für Ihren weiteren Weg alles Gute.\n\nMit freundlichen Grüßen`;
}
