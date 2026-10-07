// uebersicht.js — View-Model des Personal-Überblicks (Plan 80-04, Task 3): eine
// reine Funktion, die alle Personal-Sammlungen zu den drei Kacheln
// Team/Recruiting/Eintritte verdichtet. 80-06/80-08/80-10 erweitern das
// Ergebnisobjekt NUR additiv (faellig, loeschung_ueberfaellig, sicherung_tage,
// personalkosten) — bestehende Felder ändern sich nicht mehr.
//
// 80-10 Task 4: `personalkosten` (laufender Monat, personalkostenMonat()) und
// `sicherung_tage` kommen additiv hinzu. `sicherung_tage` braucht den bereits
// gelesenen Wert von `personalMeta('letzte_sicherung')` — diese Funktion bleibt
// synchron/rein (kein eigener IndexedDB-Zugriff), deshalb übergibt der
// Aufrufer (PersonalUebersicht.jsx, Task 6) ihn als `letzteSicherung`.
//
// In:  daten (die neun Personal-Sammlungen als {Mitarbeiter, Arbeitsvertrag,
//      Stelle, Bewerbung, Personalvorgang, …}), heute 'YYYY-MM-DD',
//      regelWert (id: string) => any — Leser der HR-Regeln (useRegelWerte.wert),
//      optional {letzteSicherung}.
// Out: personalUebersicht(daten, heute, regelWert, optionen).

import { PERSONENARTEN } from "./mitarbeiter.js";
import { aktiverVertrag } from "./vertrag.js";
import { kopfzahlKSchG, schwellenFuer, vzae as vzaeVon } from "./kopfzahl.js";
import { personalFristen } from "./fristen.js";
import { loeschenAb } from "./bewerbung.js";
import { personalkostenMonat } from "./kosten.js";
import { tageZwischen } from "@core/lib/kalender/datum.js";

/** @param {string} key @returns {import("./mitarbeiter.js").Personenart|null} */
function personenartNachKey(key) {
  return PERSONENARTEN.find((p) => p.key === key) ?? null;
}

/**
 * @typedef {{
 *   team: {
 *     aktiv: number, im_eintritt: number, inhaber_gesellschafter: number,
 *     beschaeftigte: number, vzae: number, kopfzahl_kschg: number,
 *     kleinbetrieb: boolean, schwellen: import("./kopfzahl.js").Schwelle[],
 *   },
 *   recruiting: { stellen_offen: number, bewerbungen_aktiv: number, loeschung_ueberfaellig: number },
 *   eintritte: Array<{vorgang_id: string, mitarbeiter_id: string, stichtag: string, erledigt: number, gesamt: number}>,
 *   faellig: import("./fristen.js").PersonalFrist[],
 *   personalkosten: ReturnType<typeof personalkostenMonat>,
 *   sicherung_tage: number|null,
 * }} PersonalUebersicht
 */

/**
 * Verdichtet die Personal-Sammlungen zum Überblick über dem Reiterbereich.
 * @param {Record<string, object[]>} daten alle Personal-Sammlungen (wie usePersonalDaten liefert; Mitarbeiter, Arbeitsvertrag, Gehaltsaenderung, Stelle, Bewerbung, Personalvorgang, Fristquittung, …)
 * @param {string} heute 'YYYY-MM-DD' — Stichtag für "aktiver Vertrag" und für personalFristen (80-06 Task 3)
 * @param {(id: string, stichtag?: string) => any} regelWert liest personal.wochenstunden_standard und personal.vorlauf_*; Rückfall 40 h, wenn (noch) keine Zahl kommt
 * @param {{letzteSicherung?: string|null}} [optionen] 80-10 Task 4: letzteSicherung = Wert von personalMeta('letzte_sicherung') (schon vom Aufrufer gelesen, s. Dateikopf); fehlt/null → sicherung_tage: null ("noch nie gesichert")
 * @returns {PersonalUebersicht}
 */
export function personalUebersicht(daten, heute, regelWert, { letzteSicherung } = {}) {
  const mitarbeiter = Array.isArray(daten?.Mitarbeiter) ? daten.Mitarbeiter : [];
  const vertraege = Array.isArray(daten?.Arbeitsvertrag) ? daten.Arbeitsvertrag : [];
  const stellen = Array.isArray(daten?.Stelle) ? daten.Stelle : [];
  const bewerbungen = Array.isArray(daten?.Bewerbung) ? daten.Bewerbung : [];
  const vorgaenge = Array.isArray(daten?.Personalvorgang) ? daten.Personalvorgang : [];

  const aktive = mitarbeiter.filter((m) => m?.status === "aktiv");
  const imEintritt = mitarbeiter.filter((m) => m?.status === "onboarding");
  const inhaberGesellschafter = aktive.filter((m) => personenartNachKey(m.art)?.geldfluss === "entnahme");

  // beschaeftigte: aktiv, Personenart MIT Arbeitsrecht, aktiver Vertrag am Stichtag
  // (die Inhaberin hat kein Arbeitsrecht und keinen Vertrag — zählt hier nie mit).
  /** @type {Array<{h: number, art?: string}>} */
  const beschaeftigteStunden = [];
  for (const m of aktive) {
    const art = personenartNachKey(m.art);
    if (!art?.arbeitsrecht) continue;
    const vertrag = aktiverVertrag(vertraege, m.id, heute);
    if (!vertrag) continue;
    beschaeftigteStunden.push({ h: Number(vertrag.wochenstunden) || 0, art: m.art });
  }

  const standardRoh = typeof regelWert === "function" ? regelWert("personal.wochenstunden_standard") : undefined;
  const standardStunden = typeof standardRoh === "number" && Number.isFinite(standardRoh) ? standardRoh : 40;
  const kopfzahlKschg = kopfzahlKSchG(beschaeftigteStunden);

  const stellenOffen = stellen.filter((s) => s?.status === "offen").length;
  // Eine Bewerbung ist aktiv, solange keine Entscheidung getroffen ist
  // (entscheidung.art leer/fehlt); eine Absage oder Einstellung schließt die Pipeline.
  const bewerbungenAktiv = bewerbungen.filter((b) => !b?.entscheidung?.art).length;
  // 80-08: entschiedene Bewerbungen, deren DSGVO-Löschfrist (DS-13) bereits
  // überschritten ist — derselbe Rechenweg wie die Frist-Quelle
  // bewerbung_loeschen (fristen.js), hier nur gezählt statt aufgelistet.
  const loeschungUeberfaellig = bewerbungen.filter((b) => {
    const faelligAm = loeschenAb(b, regelWert);
    return typeof faelligAm === "string" && faelligAm < heute;
  }).length;

  const eintritte = vorgaenge
    .filter((v) => v?.art === "eintritt" && v?.status !== "abgeschlossen")
    .map((v) => {
      const schritte = Array.isArray(v.schritte) ? v.schritte : [];
      const erledigt = schritte.filter((s) => s?.erledigt_am).length;
      return { vorgang_id: v.id, mitarbeiter_id: v.mitarbeiter_id, stichtag: v.stichtag, erledigt, gesamt: schritte.length };
    });

  return {
    team: {
      aktiv: aktive.length,
      im_eintritt: imEintritt.length,
      inhaber_gesellschafter: inhaberGesellschafter.length,
      beschaeftigte: beschaeftigteStunden.length,
      vzae: vzaeVon(beschaeftigteStunden, standardStunden),
      kopfzahl_kschg: kopfzahlKschg,
      kleinbetrieb: kopfzahlKschg <= 10,
      schwellen: schwellenFuer(kopfzahlKschg),
    },
    recruiting: { stellen_offen: stellenOffen, bewerbungen_aktiv: bewerbungenAktiv, loeschung_ueberfaellig: loeschungUeberfaellig },
    eintritte,
    // 80-06 Task 3: additiv, rein abgeleitet — personalFristen speichert nichts,
    // liest nur die bereits geladenen Sammlungen plus Fristquittung erneut aus.
    faellig: personalFristen(daten, heute, regelWert),
    // 80-10 Task 4: additiv — Personalkosten-Soll des laufenden Monats (Phase-79-Schnittstelle) und das Alter der letzten .bitpers-Sicherung.
    personalkosten: personalkostenMonat(heute.slice(0, 7), daten, regelWert),
    sicherung_tage: typeof letzteSicherung === "string" ? tageZwischen(letzteSicherung, heute) : null,
  };
}
