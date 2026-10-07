// vertrag.js — Fachmodell "Arbeitsvertrag" (Plan 80-04): Vertragsarten, Status
// und der aktive Vertrag zu einem Stichtag. Nur das Basis-Vokabular; Fristen,
// Kündigung und Gehaltsverlauf ergänzt 80-06 additiv in derselben Datei.
//
// 80-06 Task 1 (additiv, bestehende Exporte unverändert): Probezeitende,
// Befristungs- und Mindestlohn-Prüfung, die Gesamtprüfung eines Vertrags und
// der Gehaltsstand an einem Stichtag. D-P80-17: alle Prüfungen sind `warn`,
// nie `fail` — die App dokumentiert bestehende Verträge, ein unwirksamer
// Vertragsinhalt bleibt trotzdem Realität und muss erfassbar sein.
//
// Rein (keine API-, keine React-Imports); nur der 79-Kalender-Kern über
// fristen.js und die Personenarten aus mitarbeiter.js (kein Zyklus:
// mitarbeiter.js importiert vertrag.js nicht).
//
// In:  rohe Arbeitsvertrag-Objekte, Listen, ein Stichtag 'YYYY-MM-DD'.
// Out: VERTRAGSARTEN, VERTRAGS_STATUS, aktiverVertrag, probezeitEnde,
//      befristungPruefen, mindestlohnPruefen, pruefeVertrag, gehaltAm.

import { fristEndeBeginn, volleMonate } from "@core/lib/kalender/fristen.js";
import { PERSONENARTEN } from "./mitarbeiter.js";
import { urlaubMindest } from "./urlaub.js";

/**
 * Freezes a rule tree (same helper as mitarbeiter.js/hrRegeln.js).
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
 * Vertragsarten (personalEntitaeten.js Typedef Arbeitsvertrag `vertragsart`).
 * @type {ReadonlyArray<{key: string, label: string}>}
 */
export const VERTRAGSARTEN = tiefGefroren([
  { key: "unbefristet", label: "Unbefristet" },
  { key: "befristet_ohne_sachgrund", label: "Befristet ohne Sachgrund" },
  { key: "befristet_sachgrund", label: "Befristet mit Sachgrund" },
  { key: "befristet_gruender", label: "Befristet (Neugründung, § 14 Abs. 2a TzBfG)" },
  { key: "befristet_52plus", label: "Befristet ab 52 Jahren (§ 14 Abs. 3 TzBfG)" },
  { key: "minijob", label: "Minijob-Vertrag" },
  { key: "werkstudent", label: "Werkstudierendenvertrag" },
  { key: "praktikum", label: "Praktikumsvertrag" },
  { key: "ausbildung", label: "Ausbildungsvertrag" },
  { key: "freier_dienstvertrag", label: "Freier Dienstvertrag" },
]);

/**
 * Vertragsstatus (personalEntitaeten.js Typedef Arbeitsvertrag `status`).
 * "aktiv" wird abgeleitet (aktiverVertrag), nie gespeichert.
 * @type {ReadonlyArray<{key: string, label: string}>}
 */
export const VERTRAGS_STATUS = tiefGefroren([
  { key: "entwurf", label: "Entwurf" },
  { key: "unterschrieben", label: "Unterschrieben" },
  { key: "gekuendigt", label: "Gekündigt" },
  { key: "beendet", label: "Beendet" },
  { key: "ersetzt", label: "Ersetzt" },
]);

/**
 * Der zu `stichtag` aktive Vertrag einer Person: Status unterschrieben oder
 * gekündigt (ein Entwurf ist nie aktiv), `beginn ≤ stichtag` und (kein `ende`
 * oder `stichtag ≤ ende`). Bei mehreren Treffern gewinnt der mit dem
 * spätesten `beginn` (der jüngste, z. B. nach einer Verlängerung/einem
 * Vertragswechsel).
 * @param {Array<Record<string, any>>} vertraege alle Arbeitsverträge (ungefiltert)
 * @param {string} mitarbeiterId
 * @param {string} stichtag 'YYYY-MM-DD'
 * @returns {Record<string, any>|null}
 */
export function aktiverVertrag(vertraege, mitarbeiterId, stichtag) {
  const kandidaten = (Array.isArray(vertraege) ? vertraege : [])
    .filter((v) => v && v.mitarbeiter_id === mitarbeiterId)
    .filter((v) => v.status === "unterschrieben" || v.status === "gekuendigt")
    .filter((v) => typeof v.beginn === "string" && v.beginn <= stichtag)
    .filter((v) => !v.ende || stichtag <= v.ende);
  if (!kandidaten.length) return null;
  return kandidaten.reduce((bester, v) => (v.beginn > bester.beginn ? v : bester));
}

/**
 * One warning of a contract check: never `fail` (D-P80-17). `schluessel` is
 * the UNTRANSLATED German template (the i18n dictionary key, `{platzhalter}`
 * tokens intact — same pattern as `REGEL_PRUEFTEXTE`/`befund()` in
 * `@core/lib/regelwerk.js`, because the concrete text differs by case and
 * therefore cannot be a literal dictionary entry). `text` is the already
 * filled German message (for German-only callers/tests); a translating UI
 * calls `fuellen(t(item.schluessel), item.werte)` instead, so the numbers
 * stay correct in English too.
 * @param {string} regel stable id, e.g. "probezeit_max"
 * @param {string} norm the cited provision, e.g. "§ 622 Abs. 3 BGB"
 * @param {string} schluessel German template with `{platzhalter}` tokens
 * @param {Record<string, string|number>} [werte] substitution values
 * @returns {{regel: string, text: string, schluessel: string, werte: Record<string, string|number>, norm: string, schwere: 'warn'}}
 */
function warnung(regel, norm, schluessel, werte = {}) {
  const text = schluessel.replace(/\{(\w+)\}/g, (_, k) => String(werte[k] ?? ""));
  return { regel, text, schluessel, werte, norm, schwere: "warn" };
}

/**
 * @typedef {{regel: string, text: string, schluessel: string, werte: Record<string, string|number>, norm: string|null, schwere: 'warn'|'hinweis'}} VertragsWarnung
 */

/**
 * Ende der Probezeit (§ 622 Abs. 3 BGB): eine Beginnfrist, exakt derselbe
 * Rechenweg wie jede andere Beginnfrist des Kalender-Kerns (§§ 187 Abs. 2,
 * 188 Abs. 2 Alt. 2, Abs. 3) — reiner Alias für Lesbarkeit im Vertragskontext.
 * @param {string} beginn 'YYYY-MM-DD' erster Arbeitstag
 * @param {number} monate Probezeit in Monaten (0…6, personal.probezeit_max_monate)
 * @returns {string|null} 'YYYY-MM-DD', null bei ungültiger Eingabe
 */
export function probezeitEnde(beginn, monate) {
  return fristEndeBeginn(beginn, { monate });
}

/**
 * Befristungsprüfung (§ 14 TzBfG) — nur für Verträge, deren `vertragsart` mit
 * "befristet" beginnt; ein unbefristeter Vertrag liefert `[]`. Jede Regel warnt
 * nur (D-P80-17): eine unwirksam befristete Klausel wandelt sich kraft Gesetzes
 * in ein unbefristetes Arbeitsverhältnis (§ 16 TzBfG) — die App erfasst den
 * Vertrag trotzdem, damit das Büro reagieren kann.
 * @param {Record<string, any>} vertrag der zu prüfende Arbeitsvertrag
 * @param {Array<Record<string, any>>} historie ALLE Arbeitsverträge der Person (für die Vorbeschäftigungsprüfung), ohne den geprüften selbst
 * @param {(id: string, stichtag?: string) => any} regelWert liest personal.befristung_*
 * @returns {VertragsWarnung[]}
 */
export function befristungPruefen(vertrag, historie, regelWert) {
  /** @type {VertragsWarnung[]} */
  const warnungen = [];
  const art = vertrag?.vertragsart;
  if (!vertrag || typeof vertrag.beginn !== "string" || typeof art !== "string" || !art.startsWith("befristet")) return warnungen;
  const wert = typeof regelWert === "function" ? regelWert : () => null;
  const laufzeitMonate = typeof vertrag.ende === "string" ? volleMonate(vertrag.beginn, vertrag.ende) : null;

  if (art === "befristet_ohne_sachgrund") {
    const maxMonate = wert("personal.befristung_sachgrundlos_monate");
    if (typeof laufzeitMonate === "number" && typeof maxMonate === "number" && laufzeitMonate > maxMonate) {
      warnungen.push(warnung("befristung_sachgrundlos_monate", "§ 14 Abs. 2 TzBfG",
        "Sachgrundlose Befristung {monate} Monate überschreitet die Höchstdauer von {max} Monaten.",
        { monate: laufzeitMonate, max: maxMonate }));
    }
    const maxVerlaengerungen = wert("personal.befristung_sachgrundlos_verlaengerungen");
    const anzahlVerlaengerungen = Array.isArray(vertrag.verlaengerungen) ? vertrag.verlaengerungen.length : 0;
    if (typeof maxVerlaengerungen === "number" && anzahlVerlaengerungen > maxVerlaengerungen) {
      warnungen.push(warnung("befristung_sachgrundlos_verlaengerungen", "§ 14 Abs. 2 TzBfG",
        "{anzahl} Verlängerungen überschreiten die Höchstzahl von {max}.",
        { anzahl: anzahlVerlaengerungen, max: maxVerlaengerungen }));
    }
    // Vorbeschäftigungsverbot (§ 14 Abs. 2 S. 2 TzBfG): das BVerfG (Beschluss
    // vom 06.06.2018 – 1 BvL 7/14) hat die starre Drei-Jahres-Grenze der
    // Rechtsprechung verworfen und den Instanzgerichten eine Einzelfallprüfung
    // aufgegeben — deshalb hier nur `warn`, nie `fail`: ein Treffer in der
    // Historie ist ein Anlass zu prüfen, keine automatische Unwirksamkeit.
    const vorbeschaeftigt = (Array.isArray(historie) ? historie : [])
      .some((h) => h && h.id !== vertrag.id && h.mitarbeiter_id === vertrag.mitarbeiter_id);
    if (vorbeschaeftigt) {
      warnungen.push(warnung("befristung_vorbeschaeftigung", "§ 14 Abs. 2 S. 2 TzBfG",
        "Vorbeschäftigung bei diesem Arbeitgeber gefunden — Einzelfallprüfung nach BVerfG, Beschluss vom 06.06.2018 (1 BvL 7/14)."));
    }
  }
  if (art === "befristet_gruender") {
    const max = wert("personal.befristung_gruendung_monate");
    if (typeof laufzeitMonate === "number" && typeof max === "number" && laufzeitMonate > max) {
      warnungen.push(warnung("befristung_gruendung_monate", "§ 14 Abs. 2a TzBfG",
        "Befristung {monate} Monate überschreitet die Höchstdauer von {max} Monaten für Neugründungen.",
        { monate: laufzeitMonate, max }));
    }
  }
  if (art === "befristet_52plus") {
    const max = wert("personal.befristung_52plus_monate");
    if (typeof laufzeitMonate === "number" && typeof max === "number" && laufzeitMonate > max) {
      warnungen.push(warnung("befristung_52plus_monate", "§ 14 Abs. 3 TzBfG",
        "Befristung {monate} Monate überschreitet die Höchstdauer von {max} Monaten ab dem 52. Lebensjahr.",
        { monate: laufzeitMonate, max }));
    }
  }
  // § 14 Abs. 4 TzBfG: die Befristung braucht die Schriftform VOR Beginn —
  // sonst gilt der Vertrag kraft Gesetzes als unbefristet (§ 16 TzBfG).
  if (vertrag.schriftform_vor_beginn !== true || (typeof vertrag.unterschrieben_am === "string" && vertrag.unterschrieben_am > vertrag.beginn)) {
    warnungen.push(warnung("befristung_schriftform", "§ 14 Abs. 4 TzBfG",
      "Schriftform nicht vor Beginn nachgewiesen — der Vertrag gilt sonst kraft Gesetzes als unbefristet (§ 16 TzBfG)."));
  }
  // § 15 Abs. 3 TzBfG: keine feste Prozentgrenze im Gesetz; das BAG (Urteil
  // vom 06.12.2023 – 2 AZR 275/23) lehnt starre Prozentsätze ausdrücklich ab.
  // [ASSUMED] Schwelle 50 % der Laufzeit als Warnauslöser — ein Anlass zu
  // prüfen, keine Rechtsfolge.
  if (typeof laufzeitMonate === "number" && laufzeitMonate > 0 && typeof vertrag.probezeit_monate === "number" && vertrag.probezeit_monate > laufzeitMonate / 2) {
    warnungen.push(warnung("befristung_probezeit_unverhaeltnismaessig", "§ 15 Abs. 3 TzBfG",
      "Probezeit {probezeit} Monate ist mehr als die Hälfte der Vertragslaufzeit ({laufzeit} Monate) — im Einzelfall prüfen ([ASSUMED] 50 %-Schwelle, BAG 2 AZR 275/23 lehnt feste Prozentsätze ab).",
      { probezeit: vertrag.probezeit_monate, laufzeit: laufzeitMonate }));
  }
  return warnungen;
}

/**
 * Mindestlohnprüfung (§ 1 MiLoG) an einem Stichtag. Monatsgehälter werden mit
 * dem Faktor 13/3 (= 52 Wochen / 12 Monate) in Wochen- bzw. Stundenlohn
 * umgerechnet: `Monatsstunden = Wochenstunden × 13/3`.
 * Ausnahmen je Personenart (§ 22 MiLoG): Pflichtpraktikum ist IMMER ausgenommen
 * (§ 22 Abs. 1 S. 2 Nr. 1 MiLoG); freiwilliges Praktikum und Azubi-Vergütung
 * werden hier ebenfalls nicht geprüft — [ASSUMED] vereinfacht: § 22 Abs. 1 S. 2
 * Nr. 2/3 MiLoG befreit ein freiwilliges Praktikum nur innerhalb von
 * `personal.praktikum_ohne_milo_monate` (3 Monate); ohne ein Praktikumsstart-
 * datum kann diese Funktion die Frist nicht selbst prüfen — im Einzelfall mit
 * dem Lohnbüro abgleichen.
 * @param {number} betrag Bruttolohn in der angegebenen Einheit
 * @param {'monat'|'stunde'} einheit
 * @param {number} wochenstunden Stunden/Woche (nur für `einheit:'monat'` gebraucht)
 * @param {string} datum 'YYYY-MM-DD' Stichtag (Mindestlohn ändert sich jährlich)
 * @param {(id: string, stichtag?: string) => any} regelWert liest personal.mindestlohn
 * @param {string} [art] Personenart (mitarbeiter.js PERSONENARTEN-Schlüssel) für die Ausnahmen
 * @returns {VertragsWarnung|null} null = keine Warnung oder Ausnahme
 */
export function mindestlohnPruefen(betrag, einheit, wochenstunden, datum, regelWert, art) {
  if (art === "praktikum_pflicht" || art === "praktikum_freiwillig" || art === "azubi") return null;
  const mindestlohn = typeof regelWert === "function" ? regelWert("personal.mindestlohn", datum) : null;
  if (typeof mindestlohn !== "number" || !Number.isFinite(mindestlohn)) return null;
  const monatsstunden = (Number(wochenstunden) || 0) * (13 / 3);
  const stundenlohn = einheit === "stunde" ? Number(betrag) : (monatsstunden > 0 ? Number(betrag) / monatsstunden : null);
  if (typeof stundenlohn !== "number" || !Number.isFinite(stundenlohn)) return null;
  if (stundenlohn >= mindestlohn) return null;
  const gerundet = Math.round(stundenlohn * 100) / 100;
  return warnung("mindestlohn", "§ 1 MiLoG",
    "{betrag} €/Stunde unterschreitet den Mindestlohn von {mindestlohn} €/Stunde (Stand {datum}).",
    { betrag: gerundet.toLocaleString("de-DE"), mindestlohn: mindestlohn.toLocaleString("de-DE"), datum });
}

/**
 * Gesamtprüfung eines Arbeitsvertrags: Probezeit (§ 622 Abs. 3 BGB), Urlaub
 * (§ 3 BUrlG), Wochenstunden (§ 3 ArbZG), Befristung (§ 14 TzBfG) und
 * Mindestlohn (§ 1 MiLoG) — alle als `warn` (D-P80-17, Kommentar im
 * Vertragsformular). Für Personenarten OHNE Arbeitsrecht (Gesellschafter,
 * Inhaber:in) gibt es keinen Arbeitsvertrag zu prüfen: das Ergebnis ist dann
 * EIN Eintrag mit dem Personenart-Hinweis ("kein Arbeitsvertrag, Vergütung =
 * Entnahme") statt einer echten Warnung.
 * @param {Record<string, any>|null} vertrag der zu prüfende Arbeitsvertrag (null zulässig für Personenarten ohne Arbeitsrecht)
 * @param {{mitarbeiter?: Record<string, any>, historie?: Array<Record<string, any>>, gehaelter?: Array<Record<string, any>>}} kontext
 * @param {(id: string, stichtag?: string) => any} regelWert liest die HR-Regeln
 * @returns {VertragsWarnung[]}
 */
export function pruefeVertrag(vertrag, { mitarbeiter, historie, gehaelter } = {}, regelWert) {
  const artInfo = PERSONENARTEN.find((p) => p.key === mitarbeiter?.art) ?? null;
  if (artInfo && !artInfo.arbeitsrecht) {
    // artInfo.hinweis ist bereits ein literaler i18n-Schlüssel ohne Platzhalter
    // (mitarbeiter.js PERSONENARTEN) — hier als eigenes "schluessel" wiederholt,
    // damit die UI JEDEN Eintrag gleich behandeln kann (fuellen(t(schluessel), werte)).
    return [{ regel: "kein_arbeitsvertrag", text: artInfo.hinweis, schluessel: artInfo.hinweis, werte: {}, norm: artInfo.quelle, schwere: "hinweis" }];
  }
  if (!vertrag) return [];
  /** @type {VertragsWarnung[]} */
  const ergebnisse = [];
  const wert = typeof regelWert === "function" ? regelWert : () => null;

  const probezeitMaxRoh = wert("personal.probezeit_max_monate");
  const probezeitMax = typeof probezeitMaxRoh === "number" ? probezeitMaxRoh : 6;
  if (typeof vertrag.probezeit_monate === "number" && vertrag.probezeit_monate > probezeitMax) {
    ergebnisse.push(warnung("probezeit_max", "§ 622 Abs. 3 BGB",
      "Probezeit {monate} Monate überschreitet die Höchstdauer von {max} Monaten.",
      { monate: vertrag.probezeit_monate, max: probezeitMax }));
  }

  if (typeof vertrag.urlaub_tage_jahr === "number" && typeof vertrag.arbeitstage_woche === "number") {
    const mindest = urlaubMindest(vertrag.arbeitstage_woche, regelWert);
    if (vertrag.urlaub_tage_jahr < mindest) {
      ergebnisse.push(warnung("urlaub_mindest", "§ 3 BUrlG",
        "Urlaub {tage} Tage unterschreitet den gesetzlichen Mindesturlaub von {mindest} Tagen bei {arbeitstage} Arbeitstagen/Woche.",
        { tage: vertrag.urlaub_tage_jahr, mindest, arbeitstage: vertrag.arbeitstage_woche }));
    }
  }

  if (typeof vertrag.wochenstunden === "number" && vertrag.wochenstunden > 48) {
    ergebnisse.push(warnung("arbeitszeit_hoechst", "§ 3 ArbZG",
      "Wochenstunden {stunden} überschreiten die Höchstgrenze von 48 Stunden.",
      { stunden: vertrag.wochenstunden }));
  }

  const eigeneHistorie = (Array.isArray(historie) ? historie : []).filter((h) => h && h.mitarbeiter_id === vertrag.mitarbeiter_id);
  ergebnisse.push(...befristungPruefen(vertrag, eigeneHistorie, regelWert));

  const gehalt = gehaltAm(gehaelter, vertrag.mitarbeiter_id, vertrag.beginn);
  if (gehalt && typeof gehalt.brutto_eur === "number") {
    const einheit = mitarbeiter?.art === "werkstudent" ? "stunde" : "monat";
    const ml = mindestlohnPruefen(gehalt.brutto_eur, einheit, vertrag.wochenstunden, gehalt.gueltig_ab || vertrag.beginn, regelWert, mitarbeiter?.art);
    if (ml) ergebnisse.push(ml);
  }

  return ergebnisse;
}

/**
 * Gehalt/Vergütung einer Person an einem Stichtag: der jüngste
 * Gehaltsaenderung-Eintrag mit `gueltig_ab ≤ datum`. Die Historie ist nur
 * anhängend (nie überschrieben), deshalb genügt der jüngste Treffer.
 * @param {Array<Record<string, any>>} gehaelter alle Gehaltsaenderung-Datensätze (ungefiltert)
 * @param {string} mitarbeiterId
 * @param {string} datum 'YYYY-MM-DD'
 * @returns {Record<string, any>|null}
 */
export function gehaltAm(gehaelter, mitarbeiterId, datum) {
  const kandidaten = (Array.isArray(gehaelter) ? gehaelter : [])
    .filter((g) => g && g.mitarbeiter_id === mitarbeiterId && typeof g.gueltig_ab === "string" && g.gueltig_ab <= datum);
  if (!kandidaten.length) return null;
  return kandidaten.reduce((bester, g) => (g.gueltig_ab > bester.gueltig_ab ? g : bester));
}
