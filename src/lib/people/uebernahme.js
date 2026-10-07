// uebernahme.js — "Zusage → Einstellung" in einem Schritt (Plan 80-09, Task 2):
// legt aus einer Bewerbung in Stufe "zusage" GENAU EINEN Mitarbeiter
// (status:'onboarding'), GENAU EINEN Vertragsentwurf und GENAU EINE
// Eintritts-Checkliste an, kopiert die Anhänge (Lebenslauf/Zeugnis/
// Qualifikation) INHALTLICH (nie per geteiltem datei_ref) und markiert die
// Bewerbung als übernommen. Gesprächsnotizen und Bewertungen werden NICHT
// übernommen (Art. 5 Abs. 1 lit. c DSGVO — Zweckbindung; AGG-Risiko, eine
// Bewertung aus dem Bewerbungsprozess hat im aktiven Arbeitsverhältnis nichts
// zu suchen). Bei einem Fehler wird alles bereits Angelegte in umgekehrter
// Reihenfolge zurückgebaut, danach ein Klartext-Fehler mit dem Namen des
// gescheiterten Schritts.
//
// Reine Orchestrierung: `api` wird injiziert (dieselbe Form wie
// bitApi.personal — {<Entität>: {create,update,delete,filter,get}, dateien:
// {get,put,delete}}), kein eigener Import von bitApi. Dadurch mit einer
// Fake-API ohne IndexedDB testbar (personalUebernahme.test.js).
//
// In:  bewerbung (Bewerbung-Objekt), api, regelWert ((id: string) => any —
//      liest personal.wochenstunden_standard/arbeitstage_standard/
//      urlaub_buero_standard/probezeit_standard_monate), heute 'YYYY-MM-DD'.
// Out: uebernahmeAusBewerbung(bewerbung, api, regelWert, heute).

import { neueId } from "@core/api/sammlungKern.js";
import { plusTage } from "@core/lib/kalender/datum.js";
import { normalisiereMitarbeiter } from "./mitarbeiter.js";
import { effektiveStufe } from "./bewerbung.js";
import { VORLAGE_EINTRITT, checklisteAusVorlage } from "./onboarding.js";

// Anhang-Kategorien, die inhaltlich in die neue Personalakte kopiert werden.
// Der Plantext nennt "bewerbung, zeugnis und qualifikation" — eine eigene
// Kategorie "bewerbung" gibt es in PersonalDokumente.jsx (80-06, außerhalb
// dieses Plans' files_modified) nicht; dort trägt BewerbungFormular.jsx
// Lebenslauf/Anschreiben unter "sonstiges" ein (dieselben sechs Kategorien
// wie bei einem Mitarbeitenden). Angepasst an den echten Code (Abgleich-Regel
// des Auftrags): "sonstiges" statt "bewerbung".
const KOPIER_KATEGORIEN = Object.freeze(["sonstiges", "zeugnis", "qualifikation"]);

/** German name of each step, for the plain-text rollback error (Behavior 8). */
const SCHRITT_NAME = Object.freeze({
  mitarbeiter: "Person",
  vertrag: "Arbeitsvertrag",
  vorgang: "Eintritts-Checkliste",
  dokumente: "Anhänge",
  abschluss: "Bewerbung aktualisieren",
});

/**
 * @param {Array<() => Promise<any>>} rueckbau bereits ausgeführte Undo-Schritte, in Anlage-Reihenfolge
 * @returns {Promise<void>} führt sie in UMGEKEHRTER Reihenfolge aus; ein einzelner Fehler bricht den Rückbau nicht ab (best effort — der ursprüngliche Fehler zählt)
 */
async function rueckgaengigMachen(rueckbau) {
  for (const schritt of [...rueckbau].reverse()) {
    try {
      await schritt();
    } catch {
      // Best effort: ein Rückbau-Fehler (z. B. Datensatz schon weg) darf den
      // ursprünglichen Fehler nicht verdecken — er wird unten geworfen.
    }
  }
}

/**
 * @param {string} schrittName SCHRITT_NAME-Eintrag
 * @param {unknown} err
 * @returns {Error}
 */
function fehlerFuer(schrittName, err) {
  const nachricht = /** @type {any} */ (err)?.message || String(err);
  return new Error(`Übernahme fehlgeschlagen bei Schritt „${schrittName}“: ${nachricht}`);
}

/**
 * Zusage → Person + Vertragsentwurf + Eintritts-Checkliste, mit Rückbau bei
 * Fehler. Die Eintritts-Checkliste nutzt die UNVERÄNDERTE Standardvorlage
 * (VORLAGE_EINTRITT) — diese Funktion bekommt keine Vorlagen-Anpassung
 * übergeben (Signatur des Plans); eine büroeigene Anpassung (Einstellungen ›
 * Personal-Vorlagen) wirkt sich nur auf einen über "Eintritt starten" (ohne
 * Bewerbung, MitarbeiterDetail-Slot) neu angelegten Vorgang aus.
 * @param {{id: string, stufe?: string, entscheidung?: {art?: string}, stelle_id?: string|null,
 *   vorname: string, nachname: string, kontakt?: {email?: string, telefon?: string},
 *   verfuegbar_ab?: string|null}} bewerbung Bewerbung in Stufe "zusage"
 * @param {{
 *   Mitarbeiter: {create: (d: object) => Promise<object>, delete: (id: string) => Promise<any>},
 *   Arbeitsvertrag: {create: (d: object) => Promise<object>, delete: (id: string) => Promise<any>},
 *   Personalvorgang: {create: (d: object) => Promise<object>, delete: (id: string) => Promise<any>},
 *   Personaldokument: {create: (d: object) => Promise<object>, delete: (id: string) => Promise<any>, filter: (q: object) => Promise<object[]>},
 *   Bewerbung: {update: (id: string, d: object) => Promise<object>},
 *   Stelle: {get: (id: string) => Promise<object>},
 *   dateien: {get: (id: string) => Promise<object>, put: (id: string, d: object) => Promise<any>, delete: (id: string) => Promise<any>},
 * }} api dieselbe Form wie bitApi.personal (injiziert, testbar mit einer Fake-API)
 * @param {(id: string) => any} regelWert liest personal.wochenstunden_standard/arbeitstage_standard/urlaub_buero_standard/probezeit_standard_monate
 * @param {string} heute 'YYYY-MM-DD'
 * @returns {Promise<{mitarbeiter: object, vertrag: object, vorgang: object}>}
 * @throws {Error} "Nur eine Bewerbung in Stufe „Zusage“…" (Vorbedingung) oder ein
 *   Rückbau-Fehler, der den gescheiterten Schritt nennt (SCHRITT_NAME)
 */
export async function uebernahmeAusBewerbung(bewerbung, api, regelWert, heute) {
  if (effektiveStufe(bewerbung) !== "zusage") {
    throw new Error('Nur eine Bewerbung in Stufe „Zusage“ kann übernommen werden.');
  }

  const wert = (id) => (typeof regelWert === "function" ? regelWert(id) : undefined);
  /** @type {Array<() => Promise<any>>} */
  const rueckbau = [];

  let stelle = null;
  if (bewerbung.stelle_id) {
    try { stelle = await api.Stelle.get(bewerbung.stelle_id); } catch { stelle = null; }
  }
  const eintritt = bewerbung.verfuegbar_ab || plusTage(heute, 30);

  // Schritt 1: Mitarbeiter (status:'onboarding'). Bewusst OHNE gespraeche/
  // bewertung — normalisiereMitarbeiter kennt diese Felder ohnehin nicht
  // (Whitelist, DS-06), der neue Datensatz kann sie also strukturell nie tragen.
  let mitarbeiter;
  try {
    mitarbeiter = await api.Mitarbeiter.create(normalisiereMitarbeiter({
      status: "onboarding",
      vorname: bewerbung.vorname,
      nachname: bewerbung.nachname,
      art: stelle?.beschaeftigungsart || "angestellt",
      funktion: stelle?.titel || "",
      eintritt,
      austritt: null,
      privat: { email: bewerbung.kontakt?.email || "", telefon: bewerbung.kontakt?.telefon || "" },
    }));
    rueckbau.push(() => api.Mitarbeiter.delete(mitarbeiter.id));
  } catch (err) {
    throw fehlerFuer(SCHRITT_NAME.mitarbeiter, err);
  }

  // Schritt 2: Arbeitsvertrag (status:'entwurf'), Bürostandard-Regeln.
  let vertrag;
  try {
    vertrag = await api.Arbeitsvertrag.create({
      mitarbeiter_id: mitarbeiter.id,
      vertragsart: stelle?.befristet ? "befristet_ohne_sachgrund" : "unbefristet",
      sachgrund: null,
      status: "entwurf",
      beginn: eintritt,
      // Die Stelle trägt kein Befristungsende als Datum — bei einer
      // befristeten Stelle bleibt "ende" offen, im Entwurf nachzutragen.
      ende: null,
      probezeit_monate: wert("personal.probezeit_standard_monate") ?? 6,
      wochenstunden: stelle?.wochenstunden ?? (wert("personal.wochenstunden_standard") ?? 40),
      arbeitstage_woche: wert("personal.arbeitstage_standard") ?? 5,
      urlaub_tage_jahr: wert("personal.urlaub_buero_standard") ?? 28,
      zusatzurlaub_tage: 0,
      kuendigung: {},
      verlaengerungen: [],
      unterschrieben_am: null,
      schriftform_vor_beginn: false,
      nachweis_ausgehaendigt_am: null,
      beendigung: {},
      ersetzt_vertrag_id: null,
    });
    rueckbau.push(() => api.Arbeitsvertrag.delete(vertrag.id));
  } catch (err) {
    await rueckgaengigMachen(rueckbau);
    throw fehlerFuer(SCHRITT_NAME.vertrag, err);
  }

  // Schritt 3: Personalvorgang (art:'eintritt'), Checkliste aus der Standardvorlage.
  let vorgang;
  try {
    vorgang = await api.Personalvorgang.create({
      art: "eintritt",
      mitarbeiter_id: mitarbeiter.id,
      bewerbung_id: bewerbung.id,
      arbeitsvertrag_id: vertrag.id,
      stichtag: eintritt,
      status: "offen",
      schritte: checklisteAusVorlage(VORLAGE_EINTRITT, mitarbeiter, eintritt),
      ausstattung: [],
    });
    rueckbau.push(() => api.Personalvorgang.delete(vorgang.id));
  } catch (err) {
    await rueckgaengigMachen(rueckbau);
    throw fehlerFuer(SCHRITT_NAME.vorgang, err);
  }

  // Schritt 4: Anhänge INHALTLICH kopieren (kein geteilter datei_ref — der
  // Löschlauf der Bewerbung, 80-10, würde sonst beim Löschen der Original-
  // Datei auch die neue Personalakte beschädigen).
  try {
    const dokumente = await api.Personaldokument.filter({ bewerbung_id: bewerbung.id });
    for (const dok of (Array.isArray(dokumente) ? dokumente : []).filter((d) => KOPIER_KATEGORIEN.includes(d?.kategorie))) {
      const datei = await api.dateien.get(dok.datei_ref);
      const neueDateiId = neueId();
      await api.dateien.put(neueDateiId, datei);
      rueckbau.push(() => api.dateien.delete(neueDateiId));
      const neuesDok = await api.Personaldokument.create({
        mitarbeiter_id: mitarbeiter.id,
        bewerbung_id: null,
        kategorie: dok.kategorie,
        name: dok.name,
        mime: dok.mime,
        groesse_bytes: dok.groesse_bytes,
        datei_ref: neueDateiId,
      });
      rueckbau.push(() => api.Personaldokument.delete(neuesDok.id));
    }
  } catch (err) {
    await rueckgaengigMachen(rueckbau);
    throw fehlerFuer(SCHRITT_NAME.dokumente, err);
  }

  // Schritt 5: Bewerbung als übernommen markieren (letzter Schritt — erst
  // jetzt ist die neue Personalakte vollständig).
  try {
    await api.Bewerbung.update(bewerbung.id, { uebernommen_mitarbeiter_id: mitarbeiter.id });
  } catch (err) {
    await rueckgaengigMachen(rueckbau);
    throw fehlerFuer(SCHRITT_NAME.abschluss, err);
  }

  return { mitarbeiter, vertrag, vorgang };
}
