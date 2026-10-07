// fristen.js — abgeleitete, quittierbare Personal-Fristen (Plan 80-06, Task 3).
// Fristen werden NIE gespeichert (nur die Quittung, `Fristquittung`) — jeder
// Aufruf berechnet sie neu aus den echten Vertrags-/Mitarbeiterdaten. Eine
// erweiterbare Registry (`FRIST_QUELLEN`): 80-08/80-09 hängen ihre eigenen
// Quellen additiv an, ohne diese Datei sonst anzufassen.
//
// Rein bis auf die Registry-Struktur selbst (keine API-, keine React-Imports).
//
// In:  die Personal-Sammlungen (wie usePersonalDaten liefert), ein Stichtag
//      'YYYY-MM-DD', ein regelWert-Leser (personal.vorlauf_*).
// Out: FRIST_QUELLEN, personalFristen.

import { probezeitEnde } from "./vertrag.js";
import { loeschenAb } from "./bewerbung.js";
import { fristEndeBeginn } from "@core/lib/kalender/fristen.js";
import { plusTage } from "@core/lib/kalender/datum.js";
import { PERSONENARTEN } from "./mitarbeiter.js";

/**
 * Füllt `{platzhalter}`-Tokens eines Textes — dieselbe Mini-Vorlagensprache
 * wie `REGEL_PRUEFTEXTE`/`befund()` (@core/lib/regelwerk.js) und
 * `vertrag.js`s `warnung()`: `schluessel` bleibt der UNÜBERSETZTE deutsche
 * i18n-Schlüssel, eine übersetzende Oberfläche ruft `fuellen(t(schluessel),
 * werte)` auf, damit die Zahlen auch auf Englisch stimmen.
 * @param {string} schluessel Text mit `{platzhalter}`-Tokens
 * @param {Record<string, string|number>} werte
 * @returns {string}
 */
function fuellen(schluessel, werte) {
  return schluessel.replace(/\{(\w+)\}/g, (_, k) => String(werte[k] ?? ""));
}

/**
 * Nächstes Auftreten eines jährlich wiederkehrenden Datums 'MM-TT' ab
 * (einschließlich) `heute`.
 * @param {string} heute 'YYYY-MM-DD'
 * @param {string} mmTag 'MM-TT'
 * @returns {string} 'YYYY-MM-DD'
 */
function naechsterJahrestag(heute, mmTag) {
  const jahr = Number(heute.slice(0, 4));
  const dieses = `${jahr}-${mmTag}`;
  return dieses >= heute ? dieses : `${jahr + 1}-${mmTag}`;
}

/**
 * Nächster Immatrikulationstermin (01.04. oder 01.10.) ab (einschließlich)
 * `heute` — Werkstudierende legen die Bescheinigung zu diesen Terminen vor.
 * @param {string} heute 'YYYY-MM-DD'
 * @returns {string} 'YYYY-MM-DD'
 */
function naechsteImmatrikulation(heute) {
  const jahr = Number(heute.slice(0, 4));
  const kandidaten = [`${jahr}-04-01`, `${jahr}-10-01`, `${jahr + 1}-04-01`];
  return kandidaten.find((d) => d >= heute) ?? kandidaten[kandidaten.length - 1];
}

/**
 * Eine Frist-Quelle: berechnet aus den Personal-Sammlungen die (noch nicht
 * gefilterten) Kandidaten einer Art. `vorlaufRegel` ist die HR-Regel-ID des
 * Vorlaufs in Tagen; `vorlaufTageFallback` greift, wenn dafür KEINE eigene
 * HR-Regel existiert (resturlaub_hinweis, uebertrag_ende — hrRegeln.js gehört
 * Spur A/80-01 und liegt außerhalb dieses Plans; `[ASSUMED]` Bürostandard
 * ein Quartal Vorlauf, siehe 80-06-SUMMARY).
 * `erzeuge` liefert `schluessel` (unübersetzter deutscher Text mit
 * `{platzhalter}`-Tokens, die i18n-Wörterbuchzeile) statt einer fertigen
 * Zeichenkette — `personalFristen` füllt daraus sowohl `text` (Deutsch) als
 * auch das, was eine Oberfläche übersetzt anzeigt (`fuellen(t(schluessel),
 * werte)`), damit kein Text mit eingebackenen Zahlen im Wörterbuch landet.
 * @typedef {{
 *   art: string, label: string, norm: string,
 *   vorlaufRegel: string|null, vorlaufTageFallback?: number,
 *   erzeuge: (daten: Record<string, object[]>, heute: string, regelWert: (id: string, stichtag?: string) => any) =>
 *     Array<{faellig_am: string, bezug: {tab: string, id: string}, schluessel: string, werte?: Record<string, string|number>, anzahl?: number}>,
 * }} FristQuelle
 */

/**
 * Die Frist-Quellen dieses Plans. 80-08/80-09 hängen weitere Einträge an
 * dasselbe Array an (eigene Datei, eigener `import`/`push` auf die Registry —
 * diese Datei bleibt für sie unangetastet, wie der Plan-Kommentar es verlangt).
 * @type {FristQuelle[]}
 */
export const FRIST_QUELLEN = [
  {
    art: "probezeit_ende",
    label: "Probezeit endet",
    norm: "§ 622 Abs. 3 BGB",
    vorlaufRegel: "personal.vorlauf_probezeit",
    erzeuge(daten) {
      const vertraege = Array.isArray(daten?.Arbeitsvertrag) ? daten.Arbeitsvertrag : [];
      return vertraege
        .filter((v) => v && (v.status === "unterschrieben" || v.status === "gekuendigt") && typeof v.probezeit_monate === "number" && v.probezeit_monate > 0)
        .map((v) => {
          const faellig_am = probezeitEnde(v.beginn, v.probezeit_monate);
          return faellig_am ? { faellig_am, bezug: { tab: "contracts", id: v.id }, schluessel: "Probezeit endet {datum}", werte: { datum: faellig_am } } : null;
        })
        .filter(Boolean);
    },
  },
  {
    art: "befristung_ende",
    label: "Befristung endet",
    norm: "§ 15 Abs. 2 TzBfG",
    vorlaufRegel: "personal.vorlauf_befristung",
    erzeuge(daten) {
      const vertraege = Array.isArray(daten?.Arbeitsvertrag) ? daten.Arbeitsvertrag : [];
      return vertraege
        .filter((v) => v && typeof v.vertragsart === "string" && v.vertragsart.startsWith("befristet") && typeof v.ende === "string" && (v.status === "unterschrieben" || v.status === "gekuendigt"))
        .map((v) => ({
          faellig_am: v.ende,
          bezug: { tab: "contracts", id: v.id },
          schluessel: "Befristung endet {datum} — Arbeitsuchendmeldung nicht vergessen (§ 38 Abs. 1 SGB III)",
          werte: { datum: v.ende },
        }));
    },
  },
  {
    art: "befristung_entscheidung",
    label: "Über Verlängerung entscheiden",
    norm: "§ 14 TzBfG",
    vorlaufRegel: "personal.vorlauf_befristung_entscheidung",
    erzeuge(daten) {
      const vertraege = Array.isArray(daten?.Arbeitsvertrag) ? daten.Arbeitsvertrag : [];
      return vertraege
        .filter((v) => v && typeof v.vertragsart === "string" && v.vertragsart.startsWith("befristet") && typeof v.ende === "string" && (v.status === "unterschrieben" || v.status === "gekuendigt"))
        .map((v) => ({
          faellig_am: v.ende,
          bezug: { tab: "contracts", id: v.id },
          schluessel: "Über eine Verlängerung der Befristung bis {datum} entscheiden",
          werte: { datum: v.ende },
        }));
    },
  },
  {
    art: "sachgrundlos_grenze",
    label: "Höchstgrenze sachgrundlose Befristung",
    norm: "§ 14 Abs. 2 TzBfG",
    // Dieselbe Quelle wie befristung_ende — kein eigener HR-Vorlaufwert für
    // die Höchstgrenze; thematisch identisch (beide warnen vor demselben
    // Befristungsende), deshalb derselbe Vorlauf.
    vorlaufRegel: "personal.vorlauf_befristung",
    erzeuge(daten, heute, regelWert) {
      const vertraege = Array.isArray(daten?.Arbeitsvertrag) ? daten.Arbeitsvertrag : [];
      const maxMonate = typeof regelWert === "function" ? regelWert("personal.befristung_sachgrundlos_monate") : null;
      if (typeof maxMonate !== "number") return [];
      return vertraege
        .filter((v) => v && v.vertragsart === "befristet_ohne_sachgrund" && typeof v.beginn === "string" && (v.status === "unterschrieben" || v.status === "gekuendigt"))
        .map((v) => {
          const faellig_am = fristEndeBeginn(v.beginn, { monate: maxMonate });
          return faellig_am
            ? { faellig_am, bezug: { tab: "contracts", id: v.id }, schluessel: "Höchstgrenze der sachgrundlosen Befristung: {datum}", werte: { datum: faellig_am } }
            : null;
        })
        .filter(Boolean);
    },
  },
  {
    art: "gehaltsgespraech",
    label: "Gehaltsgespräch",
    norm: "Bürostandard",
    vorlaufRegel: "personal.vorlauf_gehaltsgespraech",
    erzeuge(daten) {
      const gehaelter = Array.isArray(daten?.Gehaltsaenderung) ? daten.Gehaltsaenderung : [];
      return gehaelter
        .filter((g) => g && typeof g.naechste_pruefung === "string")
        .map((g) => ({
          faellig_am: g.naechste_pruefung,
          bezug: { tab: "contracts", id: g.arbeitsvertrag_id },
          schluessel: "Gehaltsgespräch vorgesehen {datum}",
          werte: { datum: g.naechste_pruefung },
        }));
    },
  },
  {
    art: "qualifikation_ablauf",
    label: "Qualifikation läuft ab",
    norm: "Bürostandard",
    vorlaufRegel: "personal.vorlauf_qualifikation",
    erzeuge(daten) {
      const mitarbeiterListe = Array.isArray(daten?.Mitarbeiter) ? daten.Mitarbeiter : [];
      /** @type {Array<{faellig_am: string, bezug: {tab: string, id: string}, schluessel: string, werte: Record<string, string>}>} */
      const ausgabe = [];
      for (const m of mitarbeiterListe) {
        for (const q of Array.isArray(m?.qualifikationen) ? m.qualifikationen : []) {
          if (q && typeof q.gueltig_bis === "string") {
            ausgabe.push({
              faellig_am: q.gueltig_bis, bezug: { tab: "staff", id: m.id },
              schluessel: "Qualifikation „{bezeichnung}“ läuft ab {datum}", werte: { bezeichnung: q.bezeichnung || q.art, datum: q.gueltig_bis },
            });
          }
        }
      }
      return ausgabe;
    },
  },
  {
    art: "immatrikulation",
    label: "Immatrikulationsbescheinigung anfordern",
    norm: "§ 6 Abs. 1 Nr. 3 SGB V",
    vorlaufRegel: "personal.vorlauf_immatrikulation",
    erzeuge(daten, heute) {
      const mitarbeiterListe = Array.isArray(daten?.Mitarbeiter) ? daten.Mitarbeiter : [];
      return mitarbeiterListe
        .filter((m) => m && m.art === "werkstudent" && m.status === "aktiv")
        .map((m) => {
          const faellig_am = naechsteImmatrikulation(heute);
          return { faellig_am, bezug: { tab: "staff", id: m.id }, schluessel: "Immatrikulationsbescheinigung anfordern (nächster Termin {datum})", werte: { datum: faellig_am } };
        });
    },
  },
  {
    art: "resturlaub_hinweis",
    label: "Hinweis auf offenen Urlaub",
    norm: "BAG, Urteil vom 19.02.2019 – 9 AZR 541/15",
    vorlaufRegel: null,
    // [ASSUMED] Bürostandard: ein Quartal Vorlauf, weil hrRegeln.js (Spur A,
    // 80-01) außerhalb dieses Plans liegt und keine eigene Vorlauf-Regel für
    // diesen Bürowert (personal.resturlaub_hinweis_bis) trägt.
    vorlaufTageFallback: 90,
    erzeuge(daten, heute, regelWert) {
      const mitarbeiterListe = Array.isArray(daten?.Mitarbeiter) ? daten.Mitarbeiter : [];
      const mmTag = typeof regelWert === "function" ? regelWert("personal.resturlaub_hinweis_bis") : null;
      if (typeof mmTag !== "string") return [];
      const faellig_am = naechsterJahrestag(heute, mmTag);
      const anzahl = mitarbeiterListe.filter((m) => m?.status === "aktiv" && PERSONENARTEN.find((p) => p.key === m.art)?.arbeitsrecht).length;
      if (anzahl === 0) return [];
      return [{ faellig_am, bezug: { tab: "staff", id: "buero" }, schluessel: "Hinweis auf offenen Urlaub für {anzahl} Beschäftigte", werte: { anzahl }, anzahl }];
    },
  },
  {
    art: "uebertrag_ende",
    label: "Übertragener Urlaub verfällt",
    norm: "§ 7 Abs. 3 S. 3 BUrlG",
    vorlaufRegel: null,
    // [ASSUMED] wie resturlaub_hinweis — kein eigener Regelwerk-Vorlauf, ein
    // Quartal Bürostandard.
    vorlaufTageFallback: 90,
    erzeuge(daten, heute, regelWert) {
      const mmTag = typeof regelWert === "function" ? regelWert("personal.uebertrag_bis") : null;
      if (typeof mmTag !== "string") return [];
      const faellig_am = naechsterJahrestag(heute, mmTag);
      return [{ faellig_am, bezug: { tab: "staff", id: "buero" }, schluessel: "Übertragener Urlaub verfällt {datum}", werte: { datum: faellig_am } }];
    },
  },
  // --- Plan 80-08: Mitarbeitersuche (Stellen & Bewerbungen) --------------------------------
  {
    art: "bewerbung_loeschen",
    label: "Bewerbung löschen",
    norm: "§ 15 Abs. 4 AGG i. V. m. § 61b Abs. 1 ArbGG",
    vorlaufRegel: "personal.vorlauf_bewerbung_loeschen",
    erzeuge(daten, heute, regelWert) {
      const bewerbungen = Array.isArray(daten?.Bewerbung) ? daten.Bewerbung : [];
      return bewerbungen
        .map((b) => {
          const faellig_am = loeschenAb(b, regelWert);
          return faellig_am
            ? { faellig_am, bezug: { tab: "recruiting", id: b.id }, schluessel: "Bewerbung löschen (Frist {datum})", werte: { datum: faellig_am } }
            : null;
        })
        .filter(Boolean);
    },
  },
  {
    art: "talentpool_ablauf",
    label: "Talentpool läuft ab",
    norm: "Art. 7 DSGVO",
    vorlaufRegel: "personal.vorlauf_talentpool",
    erzeuge(daten) {
      const bewerbungen = Array.isArray(daten?.Bewerbung) ? daten.Bewerbung : [];
      return bewerbungen
        // ein widerrufener Talentpool läuft nicht mehr ab — er ist bereits beendet.
        .filter((b) => b?.talentpool?.eingewilligt_am && typeof b?.talentpool?.bis === "string" && !b?.talentpool?.widerrufen_am)
        .map((b) => ({
          faellig_am: b.talentpool.bis, bezug: { tab: "recruiting", id: b.id },
          schluessel: "Talentpool läuft ab {datum}", werte: { datum: b.talentpool.bis },
        }));
    },
  },
  // --- Plan 80-09: Einstellung & Austritt (Personalvorgang-Checklisten) -------------------
  {
    art: "vorgang_punkt_faellig",
    label: "Checklistenpunkt fällig",
    norm: "Bürostandard",
    vorlaufRegel: "personal.vorlauf_checkliste",
    // Nur Punkte, die ihr `faellig_am` bereits TRAGEN (onboarding.js
    // checklisteAusVorlage schreibt es beim Anlegen fest hinein) — ein
    // Personalvorgang aus der Zeit vor diesem Plan (Seed PV-005) hat nur
    // {schluessel, erledigt_am} ohne faellig_am und erzeugt hier bewusst
    // keine Frist (Behavior 11).
    erzeuge(daten) {
      const vorgaenge = Array.isArray(daten?.Personalvorgang) ? daten.Personalvorgang : [];
      /** @type {Array<{faellig_am: string, bezug: {tab: string, id: string}, schluessel: string, werte: Record<string, string>}>} */
      const ausgabe = [];
      for (const v of vorgaenge) {
        if (!v || v.status === "abgeschlossen") continue;
        for (const s of Array.isArray(v.schritte) ? v.schritte : []) {
          if (!s || s.erledigt_am || s.pflicht === false || typeof s.faellig_am !== "string") continue;
          ausgabe.push({
            faellig_am: s.faellig_am,
            bezug: { tab: "onboarding", id: v.id },
            schluessel: "Checklistenpunkt „{titel}“ fällig {datum}",
            werte: { titel: s.titel || s.schluessel, datum: s.faellig_am },
          });
        }
      }
      return ausgabe;
    },
  },
];

/**
 * `text` ist das bereits gefüllte deutsche Ergebnis (Komfort für deutschsprachige
 * Aufrufer/Tests); eine übersetzende Oberfläche zeigt stattdessen
 * `fuellen(t(schluessel), werte)`, damit die Zahlen/Daten auch auf Englisch
 * stimmen (dieselbe Vorlagen-Konvention wie `vertrag.js`s `warnung()`).
 * @typedef {{
 *   art: string, faellig_am: string, bezug: {tab: string, id: string}, text: string,
 *   schluessel: string, werte: Record<string, string|number>,
 *   norm: string, anzahl?: number, ueberfaellig: boolean,
 * }} PersonalFrist
 */

/**
 * Schlüssel der Fristquittung einer Frist (art:bezug_id:faellig_am) — dieselbe
 * Zeile, mit der `Fristquittung.schluessel` sie als erledigt markiert.
 * @param {{art: string, bezug: {id: string}, faellig_am: string}} eintrag
 * @returns {string}
 */
function quittungsSchluessel(eintrag) {
  return `${eintrag.art}:${eintrag.bezug.id}:${eintrag.faellig_am}`;
}

/**
 * Alle fälligen Personal-Fristen, sortiert nach Fälligkeitsdatum. Ein Eintrag
 * erscheint, sobald `heute ≥ faellig_am − vorlauf` ist (oder wenn er bereits
 * überfällig ist — das schließt der Vergleich automatisch mit ein), und fällt
 * heraus, sobald eine passende `Fristquittung` existiert. Nichts davon wird
 * gespeichert außer der Quittung selbst (Fristen sind stets abgeleitet).
 * @param {Record<string, object[]>} daten die Personal-Sammlungen (Mitarbeiter, Arbeitsvertrag, Gehaltsaenderung, Fristquittung, …)
 * @param {string} heute 'YYYY-MM-DD'
 * @param {(id: string, stichtag?: string) => any} regelWert liest personal.vorlauf_*
 * @returns {PersonalFrist[]}
 */
export function personalFristen(daten, heute, regelWert) {
  const quittungen = new Set(
    (Array.isArray(daten?.Fristquittung) ? daten.Fristquittung : []).map((q) => q?.schluessel).filter((s) => typeof s === "string"),
  );
  /** @type {PersonalFrist[]} */
  const ausgabe = [];
  for (const quelle of FRIST_QUELLEN) {
    const vorlaufRoh = quelle.vorlaufRegel && typeof regelWert === "function" ? regelWert(quelle.vorlaufRegel) : null;
    const vorlauf = typeof vorlaufRoh === "number" && Number.isFinite(vorlaufRoh) ? vorlaufRoh : (quelle.vorlaufTageFallback ?? 0);
    for (const roh of quelle.erzeuge(daten, heute, regelWert) || []) {
      if (!roh || typeof roh.faellig_am !== "string") continue;
      const werte = roh.werte || {};
      const eintrag = { art: quelle.art, norm: quelle.norm, ...roh, werte, text: fuellen(roh.schluessel, werte) };
      const schwelle = plusTage(eintrag.faellig_am, -vorlauf);
      const faellig = schwelle !== null && heute >= schwelle;
      if (!faellig) continue;
      if (quittungen.has(quittungsSchluessel(eintrag))) continue;
      ausgabe.push({ ...eintrag, ueberfaellig: eintrag.faellig_am < heute });
    }
  }
  ausgabe.sort((a, b) => (a.faellig_am < b.faellig_am ? -1 : a.faellig_am > b.faellig_am ? 1 : 0));
  return ausgabe;
}
