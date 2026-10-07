// mitarbeiter.js — Fachmodell "Mitarbeiter" (Plan 80-04, D-P80-07): Personenarten,
// Status, Feld-Whitelist (E-14/DS-06), Validierung und Suche. Rein (keine API-,
// keine React-Imports).
//
// Die Rechtsform selbst hat HR nicht — sie kommt aus 79
// (`src/lib/accounting/rechtsform.js`, `rechtsformWirkung`/`personenPruefen`);
// dieses Modul bildet die Rechtsform-Schlüssel nirgends selbst nach (Abgleich
// 28.09., E-04). Das Feld heißt bewusst `funktion`, nicht `role` — Kollision
// mit `Contact.role` und `org_members.role`.
//
// In:  rohe Mitarbeiter-Objekte, Listen, die 79-Rechtsform-Wirkung.
// Out: PERSONENARTEN, STATUS, FELDER, normalisiereMitarbeiter, validiereMitarbeiter,
//      gesellschafterHinweise, naechstePersonalnummer, sucheMitarbeiter, anzeigeName.

import { heuteLokal } from "@core/lib/kalender/datum.js";
import { personenPruefen, rechtsformWirkung } from "../accounting/rechtsform.js";

/**
 * Freezes a rule tree; functions stay as they are (same helper as hrRegeln.js).
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
 * Eine Personenart. `arbeitsrecht` steuert, ob Vertrag/Urlaub/Kündigungsfrist
 * gelten; `geldfluss` bestimmt den Weg nach 79 (Personalaufwand, Entnahme oder
 * Honorar).
 * @typedef {{
 *   key: string, label: string, arbeitsrecht: boolean, vertragPflicht: boolean,
 *   geldfluss: 'personalaufwand'|'entnahme'|'honorar', quelle: string, hinweis: string,
 * }} Personenart
 */

/**
 * Die 11 Personenarten (80-RESEARCH § Datenmodell). Gesellschafter und
 * Inhaber:in haben kein Arbeitsrecht (kein Vertrag, kein Urlaub, keine
 * Kündigungsfrist) und fließen als Entnahme bzw. Vorabgewinn nach 79
 * (§ 15 Abs. 1 S. 1 Nr. 2 EStG); `gf_gmbh` (GmbH-Geschäftsführung) ist dagegen
 * Personalaufwand. `frei` ist Honorar, kein Arbeitsvertrag.
 * @type {ReadonlyArray<Personenart>}
 */
export const PERSONENARTEN = tiefGefroren([
  { key: "angestellt", label: "Angestellt", arbeitsrecht: true, vertragPflicht: true, geldfluss: "personalaufwand", quelle: "§ 611a BGB", hinweis: "" },
  { key: "minijob", label: "Minijob", arbeitsrecht: true, vertragPflicht: true, geldfluss: "personalaufwand", quelle: "§ 8 Abs. 1a SGB IV", hinweis: "Verdienstgrenze prüfen (Regelwerk personal.minijob_grenze)" },
  { key: "midijob", label: "Midijob (Übergangsbereich)", arbeitsrecht: true, vertragPflicht: true, geldfluss: "personalaufwand", quelle: "§ 20 Abs. 2 SGB IV", hinweis: "Obergrenze prüfen (Regelwerk personal.midijob_obergrenze)" },
  { key: "werkstudent", label: "Werkstudent:in", arbeitsrecht: true, vertragPflicht: true, geldfluss: "personalaufwand", quelle: "§ 6 Abs. 1 Nr. 3 SGB V", hinweis: "Wochenstunden in der Vorlesungszeit begrenzt (personal.werkstudent_max_h)" },
  { key: "praktikum_pflicht", label: "Pflichtpraktikum", arbeitsrecht: true, vertragPflicht: true, geldfluss: "personalaufwand", quelle: "§ 22 Abs. 1 S. 2 Nr. 1 MiLoG", hinweis: "ohne Mindestlohn" },
  { key: "praktikum_freiwillig", label: "Freiwilliges Praktikum", arbeitsrecht: true, vertragPflicht: true, geldfluss: "personalaufwand", quelle: "§ 22 Abs. 1 S. 2 Nr. 2, 3 MiLoG", hinweis: "ohne Mindestlohn bis 3 Monate (personal.praktikum_ohne_milo_monate)" },
  { key: "azubi", label: "Auszubildende:r", arbeitsrecht: true, vertragPflicht: true, geldfluss: "personalaufwand", quelle: "Berufsbildungsgesetz (BBiG)", hinweis: "" },
  { key: "gf_gmbh", label: "Geschäftsführung (GmbH)", arbeitsrecht: true, vertragPflicht: true, geldfluss: "personalaufwand", quelle: "§ 35 GmbHG; Dienstvertrag der Geschäftsführung", hinweis: "Personalaufwand, keine Entnahme" },
  { key: "frei", label: "Freie Mitarbeit", arbeitsrecht: false, vertragPflicht: false, geldfluss: "honorar", quelle: "§ 611 BGB (Werk-/Dienstvertrag)", hinweis: "Scheinselbstständigkeit prüfen — § 7a SGB IV Statusfeststellung" },
  { key: "gesellschafter", label: "Gesellschafter:in", arbeitsrecht: false, vertragPflicht: false, geldfluss: "entnahme", quelle: "§ 15 Abs. 1 S. 1 Nr. 2 EStG", hinweis: "kein Arbeitsvertrag, Vergütung = Entnahme" },
  { key: "inhaber", label: "Inhaber:in", arbeitsrecht: false, vertragPflicht: false, geldfluss: "entnahme", quelle: "§ 15 Abs. 1 S. 1 Nr. 2 EStG", hinweis: "kein Arbeitsvertrag, Vergütung = Entnahme" },
]);

/** @param {string} key @returns {Personenart|null} */
function personenartNachKey(key) {
  return PERSONENARTEN.find((p) => p.key === key) ?? null;
}

/** Status eines Mitarbeitenden (personalEntitaeten.js Typedef Mitarbeiter). */
export const STATUS = tiefGefroren([
  { key: "onboarding", label: "Im Eintritt" },
  { key: "aktiv", label: "Aktiv" },
  { key: "ruhend", label: "Ruhend" },
  { key: "ausgeschieden", label: "Ausgeschieden" },
  { key: "gesperrt", label: "Gesperrt" },
]);

/**
 * Whitelist erlaubter Felder (Art. 5 Abs. 1 lit. c, Art. 25 DSGVO): jedes
 * Feld, das hier NICHT steht, verwirft normalisiereMitarbeiter() — auch
 * verschachtelt. Ein Positiv-Katalog kann nichts preisgeben, was er nie
 * aufgenommen hat; deshalb steht keine der `VERBOTENE_FELDER` aus
 * `personalEntitaeten.js` (79-02) hier zusätzlich in einer Sperrliste.
 */
export const FELDER = Object.freeze({
  oben: Object.freeze([
    "id", "personalnummer", "vorname", "nachname", "art", "status", "funktion",
    "eintritt", "austritt", "gesellschafter_id", "kontakt_id",
    "an_lohnbuero_uebermittelt_am", "notizen",
  ]),
  dienstlich: Object.freeze(["email", "telefon"]),
  // Art. 88 DSGVO — vertrauliche Unterobjekte.
  privat: Object.freeze(["adresse", "telefon", "email", "notfallkontakt"]),
  kammer: Object.freeze(["kammer", "fachrichtung", "mitgliedsnr", "eingetragen_seit", "bauvorlageberechtigt", "fortbildung"]),
  versorgungswerk: Object.freeze(["befreiung_beantragt_am", "bescheid_am"]),
  qualifikation: Object.freeze(["art", "bezeichnung", "erworben", "gueltig_bis"]),
  projektZuordnung: Object.freeze(["project_id", "funktion", "anteil_prozent", "von", "bis"]),
  sperre: Object.freeze(["grund", "seit", "aufgehoben_am"]),
});

/** @param {unknown} v @returns {Record<string, unknown>} */
function alsObjekt(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? /** @type {any} */ (v) : {};
}

/**
 * Kopiert nur die Schlüssel aus `erlaubt` — der eine Mechanismus, durch den
 * jedes verschachtelte Objekt unten läuft.
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
 * rekursiv alles außerhalb von FELDER — damit sicher auch jedes Feld aus
 * VERBOTENE_FELDER, egal ob top-level oder in `privat`/`kammer` versteckt.
 * @param {unknown} eingabe rohe Formular- oder API-Daten
 * @returns {Record<string, unknown>} nur erlaubte Felder, gleiche Struktur
 */
export function normalisiereMitarbeiter(eingabe) {
  const e = alsObjekt(eingabe);
  const aus = nurErlaubt(e, FELDER.oben);
  if (e.dienstlich !== undefined) aus.dienstlich = nurErlaubt(e.dienstlich, FELDER.dienstlich);
  if (e.privat !== undefined) aus.privat = nurErlaubt(e.privat, FELDER.privat);
  if (e.kammer !== undefined) aus.kammer = nurErlaubt(e.kammer, FELDER.kammer);
  if (e.versorgungswerk !== undefined) aus.versorgungswerk = nurErlaubt(e.versorgungswerk, FELDER.versorgungswerk);
  if (e.sperre !== undefined) aus.sperre = nurErlaubt(e.sperre, FELDER.sperre);
  if (Array.isArray(e.qualifikationen)) aus.qualifikationen = e.qualifikationen.map((q) => nurErlaubt(q, FELDER.qualifikation));
  if (Array.isArray(e.projekt_zuordnungen)) aus.projekt_zuordnungen = e.projekt_zuordnungen.map((p) => nurErlaubt(p, FELDER.projektZuordnung));
  return aus;
}

/** German text of the two 79 warning keys personenPruefen() reports — HR only relays them (never counts people/shares itself). */
const P79_TEXT = Object.freeze({
  einzel_mehrere_personen: "Einzelunternehmen hat keine Gesellschafter — Rechtsform in Einstellungen › Regelwerke prüfen",
  schluessel_fehlt: "Gewinnschlüssel unvollständig — in der Buchhaltung pflegen",
});

/**
 * Ein Plausibilitätshinweis zur Rechtsform. Immer `warn`/`hinweis`, nie
 * `fail` — die Rechtsform bestimmt der Nutzer, das ist kein Rechtsrat.
 * @typedef {{schluessel: string, schwere: 'warn'|'hinweis', text: string, link?: string}} RechtsformHinweis
 */

/**
 * Plausibilitätshinweise zur Rechtsform-Personenart-Kombination. Ruft
 * ausschließlich `rechtsformWirkung(einst)`/`personenPruefen(...)` aus
 * `src/lib/accounting/rechtsform.js` (79-01) auf — keine eigene Abbildung der
 * Rechtsform-Schlüssel hier (Abgleich 28.09.). Immer `warn`, nie `fail`:
 * Plausibilitätshinweis, keine Rechtsberatung.
 * @param {{rechtsform?: unknown, gewst_aktiv?: unknown, schluessel?: object}|null|undefined} einst
 *   Ergebnis von 79s `wirksameEinstellungen(Setting{key:"buchhaltung"}.value)`
 * @param {Array<{art?: string, status?: string}>} [mitarbeiterListe]
 * @param {Array<{id?: string, aktiv?: boolean}>} [gesellschafter79] 79-Entität `Gesellschafter`
 * @returns {RechtsformHinweis[]}
 */
export function gesellschafterHinweise(einst, mitarbeiterListe = [], gesellschafter79 = []) {
  const wirkung = rechtsformWirkung(einst);
  const liste = Array.isArray(mitarbeiterListe) ? mitarbeiterListe : [];
  const aktiveArten = new Set(liste.filter((m) => m && m.status === "aktiv").map((m) => m.art));
  /** @type {RechtsformHinweis[]} */
  const hinweise = [];

  if (wirkung.entnahmen === "inhaber" && aktiveArten.has("gesellschafter")) {
    hinweise.push({ schluessel: "einzelunternehmen_hat_gesellschafter", schwere: "warn",
      text: "Einzelunternehmen hat keine Gesellschafter — Rechtsform in Einstellungen › Regelwerke prüfen" });
  }
  if (wirkung.entnahmen === "gesellschafter" && aktiveArten.has("inhaber")) {
    hinweise.push({ schluessel: "gbr_partg_hat_inhaber", schwere: "warn",
      text: "Bei GbR/PartG sind die Beteiligten Gesellschafter bzw. Partner, nicht Inhaber" });
  }
  if (wirkung.entnahmen === "gf_gehalt" && (aktiveArten.has("gesellschafter") || aktiveArten.has("inhaber"))) {
    hinweise.push({ schluessel: "gmbh_ug_gf_gmbh", schwere: "hinweis",
      text: "Bei GmbH/UG meist gf_gmbh (Geschäftsführergehalt = Personalaufwand)" });
  }

  // 79 zählt Personen und Anteile selbst — HR reicht die Warnschlüssel nur durch.
  const laufendesJahr = Number(heuteLokal().slice(0, 4));
  for (const schluessel of personenPruefen(gesellschafter79, einst, laufendesJahr)) {
    hinweise.push({
      schluessel, schwere: "warn",
      text: P79_TEXT[schluessel] ?? schluessel,
      link: "In der Buchhaltung pflegen",
    });
  }
  return hinweise;
}

/**
 * Ein Validierungseintrag.
 * @typedef {{feld: string, text: string, schwere: 'fail'|'warn'}} ValidierungsEintrag
 */

/**
 * Pflichtfelder plus austritt ≥ eintritt, ergänzt um die Rechtsform-Hinweise.
 * @param {Record<string, any>} m normalisierter Mitarbeiter-Entwurf
 * @param {{einst?: object, mitarbeiterListe?: object[], gesellschafter79?: object[]}} [kontext]
 * @returns {ValidierungsEintrag[]}
 */
export function validiereMitarbeiter(m, kontext = {}) {
  /** @type {ValidierungsEintrag[]} */
  const eintraege = [];
  if (!m?.vorname?.trim()) eintraege.push({ feld: "vorname", text: "Vorname fehlt", schwere: "fail" });
  if (!m?.nachname?.trim()) eintraege.push({ feld: "nachname", text: "Nachname fehlt", schwere: "fail" });
  if (!m?.art || !personenartNachKey(m.art)) eintraege.push({ feld: "art", text: "Personenart fehlt", schwere: "fail" });
  if (m?.austritt && m?.eintritt && m.austritt < m.eintritt) {
    eintraege.push({ feld: "austritt", text: "Austritt liegt vor dem Eintritt", schwere: "fail" });
  }
  if (kontext.einst !== undefined) {
    const liste = kontext.mitarbeiterListe ?? [m];
    for (const h of gesellschafterHinweise(kontext.einst, liste, kontext.gesellschafter79 ?? [])) {
      eintraege.push({ feld: "art", text: h.text, schwere: "warn" });
    }
  }
  return eintraege;
}

/**
 * Nächste freie Personalnummer im Muster "P-NNN" (dreistellig, aufsteigend).
 * @param {readonly string[]} vorhandene bestehende Personalnummern
 * @returns {string} z. B. "P-001"
 */
export function naechstePersonalnummer(vorhandene) {
  const zahlen = (Array.isArray(vorhandene) ? vorhandene : [])
    .map((s) => /^P-(\d+)$/.exec(String(s)))
    .filter(/** @returns {m is RegExpExecArray} */ (m) => m !== null)
    .map((m) => Number(m[1]));
  const naechste = (zahlen.length ? Math.max(...zahlen) : 0) + 1;
  return `P-${String(naechste).padStart(3, "0")}`;
}

/**
 * Groß-/Kleinschreibung und Diakritika entfernen ("ä" ~ "a") — Muster wie
 * packages/nova-designer/src/lib/moebel.js `slug()`.
 * @param {unknown} s
 * @returns {string}
 */
function normSuchtext(s) {
  return String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Sucht über Vorname, Nachname, Funktion und Personalnummer (ohne Groß-/
 * Kleinschreibung und Diakritika); Filter engt zusätzlich ein.
 * @param {Array<Record<string, any>>} liste
 * @param {string} text Suchtext, "" liefert alle (durch den Filter)
 * @param {{entnahme?: boolean, status?: string}} [filter] entnahme: true → nur Personenarten mit geldfluss:'entnahme'
 * @returns {Array<Record<string, any>>}
 */
export function sucheMitarbeiter(liste, text, filter = {}) {
  const basis = Array.isArray(liste) ? liste : [];
  const nadel = normSuchtext(text);
  return basis.filter((m) => {
    if (filter.entnahme && personenartNachKey(m.art)?.geldfluss !== "entnahme") return false;
    if (filter.status && m.status !== filter.status) return false;
    if (!nadel) return true;
    const heuhaufen = [m.vorname, m.nachname, m.funktion, m.personalnummer].map(normSuchtext).join(" ");
    return heuhaufen.includes(nadel);
  });
}

/**
 * Anzeigename "Vorname Nachname" (nie Personalnummer oder ID — DS-07 gilt
 * für den Namen im Titel/URL, nicht hier, aber derselbe Bau-Baustein).
 * @param {{vorname?: string, nachname?: string}|null|undefined} m
 * @returns {string}
 */
export function anzeigeName(m) {
  return [m?.vorname, m?.nachname].filter(Boolean).join(" ").trim();
}
