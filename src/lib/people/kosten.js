// kosten.js — Personalkosten-Soll für Phase 79 und den Personal-Überblick
// (Plan 80-10, Task 4, D-P80-08). EIN Vertrag mit 79 (80-RESEARCH § Vertrag
// Punkt 4–7): HR liefert nur ein aggregiertes, namenloses SOLL je Monat — 79
// bucht das IST aus dem Lohnjournal, keine Doppelbuchung. Gesellschafter und
// Inhaber:innen (geldfluss:'entnahme') fließen hier nie mit, sie sind Entnahme.
//
// Rein (keine API-, keine React-Imports) — nur die bestehenden Fachmodule
// (mitarbeiter.js PERSONENARTEN, vertrag.js aktiverVertrag/gehaltAm) und der
// Kalender-Kern.
//
// In:  ein Monat 'YYYY-MM', die Personal-Sammlungen (Mitarbeiter,
//      Arbeitsvertrag, Gehaltsaenderung), ein regelWert-Leser (liest
//      zeit_honorar.ag_anteil, Phase 81 — bis dahin die Code-Konstante unten).
// Out: personalkostenMonat, AG_ANTEIL_RUECKFALL_PROZENT.

import { tageImMonat, tageZwischen } from "@core/lib/kalender/datum.js";
import { PERSONENARTEN } from "./mitarbeiter.js";
import { aktiverVertrag, gehaltAm } from "./vertrag.js";

/**
 * Rückfallwert des Arbeitgeberanteils in Prozent, solange Phase 81 die Gruppe
 * `zeit_honorar` (E-16: `zeit_honorar.ag_anteil`) noch nicht in REGELWERKE
 * einträgt. [ASSUMED] E-16-Wert "AG-Anteil 21 %". Bewusst KEINE eigene
 * Editor-Zeile in 80 (weder `personal.ag_kostenfaktor` noch
 * `buchhaltung.ag_kostenfaktor`) — der Arbeitgeberanteil hat genau EINE
 * Quelle, sobald 81 sie liefert; zwei Editor-Zeilen für denselben Wert wären
 * nach 81 tot.
 */
export const AG_ANTEIL_RUECKFALL_PROZENT = 21;

/**
 * Letzter Kalendertag eines 'YYYY-MM'-Monats.
 * @param {string} jahrMonat 'YYYY-MM'
 * @returns {string} 'YYYY-MM-DD'
 */
function monatsletzter(jahrMonat) {
  const jahr = Number(jahrMonat.slice(0, 4));
  const monat = Number(jahrMonat.slice(5, 7));
  return `${jahrMonat}-${String(tageImMonat(jahr, monat)).padStart(2, "0")}`;
}

/**
 * The contract of one person that overlaps the month. `aktiverVertrag` checks
 * a single reference day only — asking it for the last day of the month alone
 * drops an exit within the month (contract end before month end) entirely.
 * So: the last day of the month first, then every contract end falling into
 * the month, latest first — i.e. the last day of the month on which the
 * person still had a contract. Status and date rules stay in `aktiverVertrag`
 * alone.
 * @param {Array<Record<string, any>>} vertraege all employment contracts (unfiltered)
 * @param {string} mitarbeiterId
 * @param {string} monatsanfang first day of the month, 'YYYY-MM-DD'
 * @param {string} monatsende last day of the month, 'YYYY-MM-DD'
 * @returns {Record<string, any>|null}
 */
function vertragImMonat(vertraege, mitarbeiterId, monatsanfang, monatsende) {
  const amMonatsende = aktiverVertrag(vertraege, mitarbeiterId, monatsende);
  if (amMonatsende) return amMonatsende;
  const endenImMonat = vertraege
    .filter((v) => v?.mitarbeiter_id === mitarbeiterId && typeof v.ende === "string" && v.ende >= monatsanfang && v.ende < monatsende)
    .map((v) => v.ende)
    .sort()
    .reverse();
  for (const stichtag of endenImMonat) {
    const vertrag = aktiverVertrag(vertraege, mitarbeiterId, stichtag);
    if (vertrag) return vertrag;
  }
  return null;
}

/**
 * Personalkosten-Soll eines Monats: Summe über jede Person mit
 * `geldfluss:'personalaufwand'` (mitarbeiter.js PERSONENARTEN) und einem am
 * Monat aktiven Vertrag (Status unterschrieben/gekündigt, Zeitraum überlappt
 * den Monat). Ein Ein- oder Austritt IM Monat zählt anteilig nach
 * Kalendertagen; das Monatsbrutto kommt aus `gehaltAm` zum Monatsersten bzw.
 * — bei Eintritt im Monat — zum Eintrittstag selbst (derselbe Tag, den die
 * Anteilsrechnung als Start nimmt). Werkstudierende zahlen €/Stunde
 * (`brutto_eur × Wochenstunden × 13/3`, wie `vertrag.js`s
 * `mindestlohnPruefen` dieselbe Umrechnung schon für die Mindestlohnprüfung
 * nutzt); alle anderen zahlen €/Monat. Gerundet wird erst am Ende, auf Cent
 * (`[ASSUMED]` Näherung — das Lohnbüro rechnet exakt tagesgenau nach
 * Sozialversicherungslogik, hier reicht eine kalendertägliche Annäherung fürs
 * Planungs-Soll).
 * @param {string} jahrMonat 'YYYY-MM'
 * @param {Record<string, object[]>} daten Personal-Sammlungen (mindestens Mitarbeiter, Arbeitsvertrag, Gehaltsaenderung)
 * @param {(id: string, stichtag?: string) => any} regelWert liest zeit_honorar.ag_anteil (Phase 81); fehlt die Regel (noch) in REGELWERKE, greift AG_ANTEIL_RUECKFALL_PROZENT
 * @returns {{summe_brutto_eur: number, summe_ag_eur: number, koepfe: number, stand: 'soll', faktor: number, faktor_quelle: 'zeit_honorar.ag_anteil'|'rueckfall'}}
 *   enthält KEINEN Namen, keine mitarbeiter_id — nur die aggregierte Summe (D-P80-08)
 */
export function personalkostenMonat(jahrMonat, daten, regelWert) {
  const monatsanfang = `${jahrMonat}-01`;
  const monatsende = monatsletzter(jahrMonat);
  const tageImMonatGesamt = tageImMonat(Number(jahrMonat.slice(0, 4)), Number(jahrMonat.slice(5, 7)));

  const mitarbeiterListe = Array.isArray(daten?.Mitarbeiter) ? daten.Mitarbeiter : [];
  const vertraege = Array.isArray(daten?.Arbeitsvertrag) ? daten.Arbeitsvertrag : [];
  const gehaelter = Array.isArray(daten?.Gehaltsaenderung) ? daten.Gehaltsaenderung : [];

  let summeBruttoRoh = 0;
  let koepfe = 0;
  for (const m of mitarbeiterListe) {
    const art = PERSONENARTEN.find((p) => p.key === m?.art);
    if (art?.geldfluss !== "personalaufwand") continue;
    const vertrag = vertragImMonat(vertraege, m.id, monatsanfang, monatsende);
    if (!vertrag) continue; // no contract overlapping the month (not started yet or ended before it)
    const effektivStart = vertrag.beginn > monatsanfang ? vertrag.beginn : monatsanfang;
    const effektivEnde = vertrag.ende && vertrag.ende < monatsende ? vertrag.ende : monatsende;
    if (effektivStart > effektivEnde) continue; // Vertrag beginnt erst nach dem Monat oder endete davor
    const gehalt = gehaltAm(gehaelter, m.id, effektivStart);
    if (!gehalt || typeof gehalt.brutto_eur !== "number") continue;
    const monatsbrutto = m.art === "werkstudent" ? gehalt.brutto_eur * (Number(vertrag.wochenstunden) || 0) * (13 / 3) : gehalt.brutto_eur;
    const tageAktiv = (tageZwischen(effektivStart, effektivEnde) ?? 0) + 1;
    summeBruttoRoh += monatsbrutto * (tageAktiv / tageImMonatGesamt);
    koepfe += 1;
  }

  const agRoh = typeof regelWert === "function" ? regelWert("zeit_honorar.ag_anteil", monatsende) : null;
  const hatRegel = typeof agRoh === "number" && Number.isFinite(agRoh);
  const faktor = 1 + (hatRegel ? agRoh : AG_ANTEIL_RUECKFALL_PROZENT) / 100;
  const faktorQuelle = hatRegel ? "zeit_honorar.ag_anteil" : "rueckfall";

  return {
    summe_brutto_eur: Math.round(summeBruttoRoh * 100) / 100,
    summe_ag_eur: Math.round(summeBruttoRoh * faktor * 100) / 100,
    koepfe,
    stand: "soll",
    faktor,
    faktor_quelle: faktorQuelle,
  };
}
