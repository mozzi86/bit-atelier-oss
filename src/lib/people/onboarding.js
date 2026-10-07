// onboarding.js — Fachmodell "Personalvorgang" (Plan 80-09, Task 1): EIN
// Checklisten-Editor für Eintritt UND Austritt. Die 16 Eintritts- und 7
// Austrittspunkte (Schlüssel exakt EINTRITT_SCHLUESSEL/AUSTRITT_SCHLUESSEL aus
// personalEntitaeten.js), ihre Anwendbarkeit nach Personenart/Kammer, ihre
// Fälligkeit relativ zum Stichtag (§§ 187/188 BGB über den Kalender-Kern),
// Fortschritt und die eine aus dem Vertrag abgeleitete Erledigung. Rein (keine
// API-, keine React-Imports).
//
// Jede fertige Checkliste (checklisteAusVorlage) ist eine TIEFE KOPIE der
// wirksamen Vorlage zum Anlagezeitpunkt — eine spätere Vorlagenänderung
// (Deaktivieren, eigener Punkt) wirkt sich nie auf eine bereits angelegte
// Checkliste aus (Behavior 5). Die Vorlage selbst (personal.vorlagen, 80-01/
// Einstellungen › Personal-Vorlagen) trägt KEINE Personaldaten — nur Titel,
// Fälligkeit und Pflicht der Punkte.
//
// In:  Personalvorgang-/Mitarbeiter-/Vertrags-Objekte, ein Stichtag
//      'YYYY-MM-DD', eine optionale Vorlagen-Anpassung (Setting
//      personal.vorlagen).
// Out: VORLAGE_EINTRITT, VORLAGE_AUSTRITT, vorlageWirksam, anwendbarePunkte,
//      checklisteAusVorlage, fortschritt, abgeleiteteErledigungen.

import { fristEnde } from "@core/lib/kalender/fristen.js";
import { plusTage } from "@core/lib/kalender/datum.js";
import { EINTRITT_SCHLUESSEL, AUSTRITT_SCHLUESSEL } from "@core/api/personalEntitaeten.js";

/**
 * Freezes a rule tree; functions stay as they are (same helper as mitarbeiter.js/vertrag.js).
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

/** Kammer condition: any chamber assigned, regardless of Personenart. */
const hatKammer = (m) => Boolean(m?.kammer?.kammer);
/** Minijob/Werkstudent/Praktikum condition (§ 6 Abs. 4 SGB VI ist hier NICHT gemeint — das ist die Kammer-Bedingung). */
const istKurzbeschaeftigt = (m) => ["minijob", "werkstudent", "praktikum_pflicht", "praktikum_freiwillig"].includes(m?.art);

/**
 * Ein Vorlagenpunkt (Standardvorlage). `faellig` ist relativ zum Stichtag:
 * `{tage: n}` (Tagesarithmetik, `plusTage`) oder `{monate: n}` (Ereignisfrist
 * §§ 187 Abs. 1, 188 Abs. 2 Alt. 1 über `fristEnde`, wie bei der RV-Befreiung).
 * `bedingung` fehlt = immer anwendbar.
 * @typedef {{
 *   schluessel: string, titel: string, faellig: {tage: number}|{monate: number}|null,
 *   pflicht: boolean, rechtsgrund: string, gruppe: string,
 *   bedingung?: ((m: object) => boolean)|null,
 * }} VorlagenPunkt
 */

/**
 * Die 16 Eintrittspunkte (80-RESEARCH § Datenmodell, EINTRITT_SCHLUESSEL): 13
 * immer, 2 nur für Kammermitglieder, 1 nur für Minijob/Werkstudent/Praktikum.
 * @type {ReadonlyArray<VorlagenPunkt>}
 */
export const VORLAGE_EINTRITT = tiefGefroren([
  { schluessel: "vertrag_unterschrieben", titel: "Vertrag unterschrieben", faellig: { tage: -1 }, pflicht: true, rechtsgrund: "§ 14 Abs. 4 TzBfG bei Befristung — Schriftform vor Beginn", gruppe: "Vertrag & Nachweise" },
  { schluessel: "nachweis_nachwg", titel: "Nachweis der Arbeitsbedingungen (NachwG)", faellig: { tage: 0 }, pflicht: true, rechtsgrund: "§ 2 NachwG, Textform seit BEG IV [ASSUMED § 2a SchwarzArbG]", gruppe: "Vertrag & Nachweise" },
  { schluessel: "vertraulichkeit", titel: "Vertraulichkeitserklärung", faellig: { tage: 0 }, pflicht: true, rechtsgrund: "Art. 29, 32 Abs. 4 DSGVO; Projekt-Geheimhaltung", gruppe: "Vertrag & Nachweise" },
  { schluessel: "foto_einwilligung", titel: "Einwilligung Foto (optional)", faellig: null, pflicht: false, rechtsgrund: "§ 22 KUG / Art. 6 Abs. 1 lit. a DSGVO", gruppe: "Vertrag & Nachweise" },
  { schluessel: "personalfragebogen_lohnbuero", titel: "Personalfragebogen ans Lohnbüro", faellig: { tage: 0 }, pflicht: true, rechtsgrund: "nur Datum, keine Steuer-ID", gruppe: "Lohnbüro & Sozialversicherung" },
  { schluessel: "sv_anmeldung", titel: "SV-Anmeldung durch das Lohnbüro", faellig: { tage: 42 }, pflicht: true, rechtsgrund: "§ 6 DEÜV, durch das Lohnbüro", gruppe: "Lohnbüro & Sozialversicherung" },
  { schluessel: "elstam", titel: "ELStAM abgerufen", faellig: { tage: 0 }, pflicht: true, rechtsgrund: "§ 39e EStG", gruppe: "Lohnbüro & Sozialversicherung" },
  { schluessel: "nachweis_beschaeftigungsart", titel: "Nachweis der Beschäftigungsart", faellig: { tage: 0 }, pflicht: true, rechtsgrund: "RV-Befreiung, Immatrikulation bzw. Pflichtnachweis ≤ 3 Monate", gruppe: "Lohnbüro & Sozialversicherung", bedingung: istKurzbeschaeftigt },
  { schluessel: "rv_befreiung", titel: "RV-Befreiung beantragt", faellig: { monate: 3 }, pflicht: true, rechtsgrund: "§ 6 Abs. 4 SGB VI", gruppe: "Kammer & Versorgung", bedingung: hatKammer },
  { schluessel: "kammer_haftpflicht", titel: "Berufshaftpflicht über die Kammer geprüft", faellig: { tage: 0 }, pflicht: true, rechtsgrund: "[ASSUMED] Kammersatzung", gruppe: "Kammer & Versorgung", bedingung: hatKammer },
  { schluessel: "unterweisung_arbeitsschutz", titel: "Unterweisung Arbeitsschutz", faellig: { tage: 0 }, pflicht: true, rechtsgrund: "§ 12 ArbSchG; Bauleitung mit PSA", gruppe: "Arbeitsschutz" },
  { schluessel: "vorsorge_bildschirm", titel: "Angebotsvorsorge Bildschirmarbeit", faellig: { tage: 30 }, pflicht: true, rechtsgrund: "ArbMedVV Anh. Teil 4", gruppe: "Arbeitsschutz" },
  { schluessel: "arbeitsmittel", titel: "Arbeitsmittel übergeben", faellig: { tage: 0 }, pflicht: true, rechtsgrund: "Übergabe-Liste", gruppe: "Ausstattung & Konten" },
  { schluessel: "konten_lizenzen", titel: "Konten & Lizenzen eingerichtet", faellig: { tage: 0 }, pflicht: true, rechtsgrund: "E-Mail, Ablage, CAD/AVA; App-Zugang nach Phase 74", gruppe: "Ausstattung & Konten" },
  { schluessel: "einarbeitung", titel: "Einarbeitung/Probezeitgespräche", faellig: { tage: 90 }, pflicht: true, rechtsgrund: "Probezeitgespräche Mitte und vor dem Ende", gruppe: "Einarbeitung" },
  { schluessel: "projektzuordnung", titel: "Projektzuordnung angelegt", faellig: { tage: 0 }, pflicht: true, rechtsgrund: "", gruppe: "Einarbeitung" },
]);

/**
 * Die 7 Austrittspunkte (80-RESEARCH § Datenmodell, AUSTRITT_SCHLUESSEL).
 * `faellig` bezieht sich auf den Stichtag des Austritts-Vorgangs (letzter Tag).
 * @type {ReadonlyArray<VorlagenPunkt>}
 */
export const VORLAGE_AUSTRITT = tiefGefroren([
  { schluessel: "kuendigung_schriftform", titel: "Kündigung in Schriftform, Zugang dokumentiert", faellig: { tage: 0 }, pflicht: true, rechtsgrund: "§ 623 BGB, Zugang dokumentieren", gruppe: "Vertrag & Nachweise" },
  { schluessel: "hinweis_arbeitsuchend", titel: "Hinweis zur Arbeitsuchendmeldung gegeben", faellig: { tage: 0 }, pflicht: true, rechtsgrund: "§ 2 Abs. 2 S. 2 Nr. 3 SGB III", gruppe: "Vertrag & Nachweise" },
  { schluessel: "resturlaub_abgeltung", titel: "Resturlaub genommen oder abgegolten", faellig: { tage: 0 }, pflicht: true, rechtsgrund: "§ 7 Abs. 4 BUrlG", gruppe: "Vertrag & Nachweise" },
  { schluessel: "zeugnis", titel: "Arbeitszeugnis erstellt", faellig: { tage: 0 }, pflicht: true, rechtsgrund: "§ 109 GewO", gruppe: "Ausstattung & Konten" },
  { schluessel: "arbeitsbescheinigung", titel: "Arbeitsbescheinigung ausgestellt", faellig: { tage: 0 }, pflicht: true, rechtsgrund: "§ 312 SGB III", gruppe: "Ausstattung & Konten" },
  { schluessel: "rueckgabe_konten", titel: "Rückgabe von Arbeitsmitteln, Konten gesperrt", faellig: { tage: 0 }, pflicht: true, rechtsgrund: "Arbeitsmittel und Konten sperren", gruppe: "Ausstattung & Konten" },
  { schluessel: "loeschfristen_starten", titel: "Löschfristen der Personalakte gestartet", faellig: { tage: 0 }, pflicht: true, rechtsgrund: "", gruppe: "Ausstattung & Konten" },
]);

// Selbsttest gegen die eine Quelle der Schlüssel (personalEntitaeten.js) —
// eine Abweichung hier wäre ein Programmierfehler, kein Datenzustand, deshalb
// ein throw statt einer stillen Lücke (dieselbe Absicherung wie hrRegeln.js).
if (VORLAGE_EINTRITT.length !== EINTRITT_SCHLUESSEL.length || VORLAGE_EINTRITT.some((p) => !EINTRITT_SCHLUESSEL.includes(p.schluessel))) {
  throw new Error("VORLAGE_EINTRITT weicht von EINTRITT_SCHLUESSEL ab (personalEntitaeten.js).");
}
if (VORLAGE_AUSTRITT.length !== AUSTRITT_SCHLUESSEL.length || VORLAGE_AUSTRITT.some((p) => !AUSTRITT_SCHLUESSEL.includes(p.schluessel))) {
  throw new Error("VORLAGE_AUSTRITT weicht von AUSTRITT_SCHLUESSEL ab (personalEntitaeten.js).");
}

/**
 * @param {string} stichtag 'YYYY-MM-DD'
 * @param {{tage: number}|{monate: number}|null|undefined} faellig
 * @returns {string|null} 'YYYY-MM-DD', null ohne Fälligkeit (z. B. `foto_einwilligung`)
 */
function faelligAmVon(stichtag, faellig) {
  if (!faellig) return null;
  if (typeof (/** @type {any} */ (faellig).monate) === "number") return fristEnde(stichtag, { monate: /** @type {any} */ (faellig).monate });
  if (typeof (/** @type {any} */ (faellig).tage) === "number") return plusTage(stichtag, /** @type {any} */ (faellig).tage);
  return null;
}

/**
 * @typedef {{
 *   deaktiviert?: string[], reihenfolge?: string[],
 *   eigene?: Array<{schluessel: string, titel: string, faellig?: {tage?: number, monate?: number}|null, pflicht?: boolean, rechtsgrund?: string, gruppe?: string}>,
 * }} VorlagenAnpassung Setting "personal.vorlagen" ({eintritt, austritt} je eine VorlagenAnpassung)
 */

/**
 * Die WIRKSAME Vorlage: Standardpunkte ohne die deaktivierten, dazu die
 * eigenen Punkte des Büros angehängt — ein Standardpunkt wird nie entfernt,
 * nur deaktiviert (er verschwindet dadurch aus dem wirksamen Ergebnis, bleibt
 * aber in `standard`/VORLAGE_EINTRITT unverändert erhalten, wie die
 * Einstellungsseite ihn für den Schalter braucht). `reihenfolge` (optional,
 * Schlüssel in Zielreihenfolge) sortiert das Ergebnis um; unbekannte
 * Schlüssel bleiben in ihrer ursprünglichen Reihenfolge am Ende.
 * @param {ReadonlyArray<VorlagenPunkt>} standard VORLAGE_EINTRITT oder VORLAGE_AUSTRITT
 * @param {VorlagenAnpassung|null|undefined} anpassung Setting-Wert (ein Zweig, "eintritt" oder "austritt")
 * @returns {Array<VorlagenPunkt & {eigen: boolean}>}
 */
export function vorlageWirksam(standard, anpassung) {
  const deaktiviert = new Set(Array.isArray(anpassung?.deaktiviert) ? anpassung.deaktiviert : []);
  const aktiveStandard = (Array.isArray(standard) ? standard : [])
    .filter((p) => p && !deaktiviert.has(p.schluessel))
    .map((p) => ({ ...p, eigen: false }));
  const eigene = (Array.isArray(anpassung?.eigene) ? anpassung.eigene : []).map((e) => ({
    schluessel: e.schluessel,
    titel: e.titel,
    faellig: e.faellig ?? null,
    pflicht: e.pflicht !== false,
    rechtsgrund: e.rechtsgrund || "",
    gruppe: e.gruppe || "Einarbeitung",
    bedingung: null,
    eigen: true,
  }));
  let ergebnis = [...aktiveStandard, ...eigene];
  const reihenfolge = Array.isArray(anpassung?.reihenfolge) ? anpassung.reihenfolge : null;
  if (reihenfolge && reihenfolge.length > 0) {
    ergebnis = ergebnis
      .map((p, i) => ({ p, i }))
      .sort((a, b) => {
        const ia = reihenfolge.indexOf(a.p.schluessel);
        const ib = reihenfolge.indexOf(b.p.schluessel);
        const ra = ia === -1 ? Number.MAX_SAFE_INTEGER : ia;
        const rb = ib === -1 ? Number.MAX_SAFE_INTEGER : ib;
        return ra !== rb ? ra - rb : a.i - b.i;
      })
      .map((x) => x.p);
  }
  return ergebnis;
}

/**
 * Die Punkte einer (wirksamen) Vorlage, die für diese Person gelten — filtert
 * nach `bedingung` (Kammer, Kurzbeschäftigung); Punkte ohne `bedingung` gelten
 * immer.
 * @param {ReadonlyArray<VorlagenPunkt & {eigen?: boolean}>} vorlage
 * @param {{art?: string, kammer?: {kammer?: string}}|null|undefined} mitarbeiter
 * @returns {Array<VorlagenPunkt & {eigen?: boolean}>}
 */
export function anwendbarePunkte(vorlage, mitarbeiter) {
  return (Array.isArray(vorlage) ? vorlage : []).filter((p) => !p?.bedingung || p.bedingung(mitarbeiter));
}

/**
 * Eine Checkliste aus einer (wirksamen) Vorlage: eine TIEFE KOPIE — jeder
 * Punkt wird zu einem eigenständigen Objekt mit berechnetem `faellig_am`,
 * unabhängig von der Vorlage (Behavior 5: eine spätere Vorlagenänderung lässt
 * eine bereits erzeugte Checkliste unverändert). Wird als `Personalvorgang.schritte`
 * gespeichert.
 * @param {ReadonlyArray<VorlagenPunkt & {eigen?: boolean}>} vorlage vorlageWirksam(standard, anpassung)
 * @param {{art?: string, kammer?: {kammer?: string}}|null|undefined} mitarbeiter
 * @param {string} stichtag 'YYYY-MM-DD' (Eintrittsdatum bzw. letzter Tag beim Austritt)
 * @returns {Array<{schluessel: string, titel: string, rechtsgrund: string, pflicht: boolean, gruppe: string, faellig_am: string|null, erledigt_am: string|null, notiz: string}>}
 */
export function checklisteAusVorlage(vorlage, mitarbeiter, stichtag) {
  return anwendbarePunkte(vorlage, mitarbeiter).map((p) => ({
    schluessel: p.schluessel,
    titel: p.titel,
    rechtsgrund: p.rechtsgrund || "",
    pflicht: p.pflicht !== false,
    gruppe: p.gruppe || "",
    faellig_am: faelligAmVon(stichtag, p.faellig),
    erledigt_am: null,
    notiz: "",
  }));
}

/**
 * Fortschritt in Prozent (gerundet), aus den Punkten selbst ODER aus
 * `abgeleitet` (Set/Array von Schlüsseln bzw. `{schluessel}`-Objekten aus
 * `abgeleiteteErledigungen`) erledigt — keine Doppelzählung. `0` bei einer
 * leeren Liste.
 * @param {Array<{schluessel?: string, erledigt_am?: string|null}>} punkte
 * @param {Array<string|{schluessel: string}>} [abgeleitet]
 * @returns {number} 0…100
 */
export function fortschritt(punkte, abgeleitet = []) {
  const liste = Array.isArray(punkte) ? punkte : [];
  if (liste.length === 0) return 0;
  const abgeleitetSet = new Set(
    (Array.isArray(abgeleitet) ? abgeleitet : []).map((a) => (typeof a === "string" ? a : a?.schluessel)).filter(Boolean),
  );
  const erledigt = liste.filter((p) => Boolean(p?.erledigt_am) || abgeleitetSet.has(p?.schluessel)).length;
  return Math.round((erledigt / liste.length) * 100);
}

/**
 * Erledigungen, die sich rein aus anderen Personal-Daten ableiten lassen,
 * OHNE dass ein Nutzer den Haken selbst setzt — aktuell nur `vertrag_unterschrieben`,
 * abgeleitet aus dem verknüpften Arbeitsvertrag (`status:'unterschrieben'` und
 * `unterschrieben_am ≤ beginn`). Rein: liest nur, schreibt nichts — die
 * Checkliste selbst bekommt den Haken erst, wenn ihn jemand im Editor setzt
 * oder ausdrücklich bestätigt (die UI zeigt das Badge "aus Vertrag" daneben).
 * @param {{art?: string, arbeitsvertrag_id?: string|null}|null|undefined} vorgang
 * @param {Array<{id?: string, status?: string, unterschrieben_am?: string|null, beginn?: string}>} vertraege
 * @returns {Array<{schluessel: string, quelle: string}>}
 */
export function abgeleiteteErledigungen(vorgang, vertraege) {
  if (!vorgang || vorgang.art !== "eintritt" || !vorgang.arbeitsvertrag_id) return [];
  const vertrag = (Array.isArray(vertraege) ? vertraege : []).find((v) => v && v.id === vorgang.arbeitsvertrag_id);
  if (
    vertrag
    && vertrag.status === "unterschrieben"
    && typeof vertrag.unterschrieben_am === "string"
    && typeof vertrag.beginn === "string"
    && vertrag.unterschrieben_am <= vertrag.beginn
  ) {
    return [{ schluessel: "vertrag_unterschrieben", quelle: "aus Vertrag" }];
  }
  return [];
}
