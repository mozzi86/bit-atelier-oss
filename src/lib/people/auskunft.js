// auskunft.js — data subject rights per person/application (Plan 80-10, Task 1):
// deletion rules for every HR entity (DS-10), the Art. 15/20 information export
// and the deletion/lock plan (Art. 17 Abs. 3, Art. 18). Rein (keine API-, keine
// React-Imports) — nur PERSONAL_ENTITAETEN als Quelle der Entitätsliste und die
// bestehenden Fachmodule (bewerbung.js für loeschenAb).
//
// DS-10-Wächter: LOESCH_REGELN trägt für JEDE Entität aus PERSONAL_ENTITAETEN
// einen Eintrag — eine neue Entität ohne Regel lässt personalAuskunft.test.js
// (und jeden Aufrufer, der Object.keys(LOESCH_REGELN) gegen PERSONAL_ENTITAETEN
// prüft) sofort scheitern, bevor sie irgendwo unbemerkt personenbezogene Daten
// unbegrenzt behält.
//
// In:  die neun Personal-Sammlungen (wie personalDbAuslesen()/usePersonalDaten
//      liefern), ein Stichtag 'YYYY-MM-DD', ein regelWert-Leser
//      (personal.aufbewahrung_*).
// Out: LOESCH_REGELN, personAuskunft, loeschPlan.

import { PERSONAL_ENTITAETEN } from "@core/api/personalEntitaeten.js";
import { loeschenAb } from "./bewerbung.js";

/**
 * Eine Löschregel je Entität.
 * - `bezug`: das Feld, über das ein Datensatz dieser Entität einer Person
 *   zugeordnet wird ('mitarbeiter_id' | 'bewerbung_id' | 'id' | null).
 *   `null` heißt: kein Personenbezug (Stelle) oder ein eigener Ablauf, der
 *   nicht über personAuskunft/loeschPlan läuft (Loeschprotokoll — dessen
 *   eigene Frist prüft loeschlauf.js direkt, Fristquittung — deren Zeilen
 *   über ihren eingebetteten Bezug in Task 2 gefunden werden, nicht über
 *   dieses Feld).
 * - `aufbewahrung`: die HR-Regel-ID (ohne "personal."-Präfix), die die Dauer
 *   der Sperrfrist liefert; `null`, wenn die Entität keine eigene Frist hat
 *   (Mitarbeiter folgt seinen Kindern, Personaldokument folgt dem Besitzer).
 * - `modus`: 'loeschen' (sofort löschbar, sobald keine Sperre mehr greift)
 *   oder 'sperren' (behält den Datensatz bis zum Fristende).
 * - `norm`: die zitierte Rechtsgrundlage, für den Bestätigungsdialog (80-10
 *   Task 5) und die SUMMARY-Tabelle.
 * @typedef {{bezug: 'mitarbeiter_id'|'bewerbung_id'|'id'|null, aufbewahrung: string|null, modus: 'loeschen'|'sperren', norm: string|null}} LoeschRegel
 */

/**
 * Löschregeln je Entität aus PERSONAL_ENTITAETEN (DS-10). Neue Entitäten OHNE
 * Eintrag hier lassen den Wächter-Test scheitern — absichtlich: eine neue
 * Personal-Entität ohne durchdachten Löschweg darf nicht unbemerkt Daten ohne
 * Ende behalten.
 * @type {Readonly<Record<string, LoeschRegel>>}
 */
export const LOESCH_REGELN = Object.freeze({
  Mitarbeiter: { bezug: "id", aufbewahrung: null, modus: "sperren", norm: null },
  Arbeitsvertrag: { bezug: "mitarbeiter_id", aufbewahrung: "aufbewahrung_personalakte_jahre", modus: "sperren", norm: "§§ 195, 199 BGB [ASSUMED]" },
  Gehaltsaenderung: { bezug: "mitarbeiter_id", aufbewahrung: "aufbewahrung_lohnkonto_jahre", modus: "sperren", norm: "§ 41 Abs. 1 S. 9 EStG" },
  Stelle: { bezug: null, aufbewahrung: null, modus: "loeschen", norm: null },
  Bewerbung: { bezug: "id", aufbewahrung: "aufbewahrung_bewerbung_monate", modus: "sperren", norm: "Art. 17 Abs. 3 lit. e DSGVO i. V. m. § 15 Abs. 4 AGG, § 61b Abs. 1 ArbGG" },
  Personalvorgang: { bezug: "mitarbeiter_id", aufbewahrung: "aufbewahrung_personalakte_jahre", modus: "sperren", norm: "§§ 195, 199 BGB [ASSUMED]" },
  Personaldokument: { bezug: null, aufbewahrung: null, modus: "sperren", norm: null }, // folgt dem Besitzer, s. Kommentar unten
  Fristquittung: { bezug: null, aufbewahrung: null, modus: "loeschen", norm: null },
  Loeschprotokoll: { bezug: null, aufbewahrung: "aufbewahrung_loeschprotokoll_jahre", modus: "loeschen", norm: "Art. 5 Abs. 2 DSGVO" },
});

// DS-10-Wächter, sofort beim Laden des Moduls geprüft (nicht erst im Test) —
// eine PERSONAL_ENTITAETEN-Änderung ohne begleitende Regel wirft schon beim
// Import, nicht erst beim nächsten Löschlauf.
{
  const fehlend = PERSONAL_ENTITAETEN.filter((e) => !(e in LOESCH_REGELN));
  if (fehlend.length) {
    throw new Error(`LOESCH_REGELN fehlt für: ${fehlend.join(", ")} (DS-10 — jede Personal-Entität braucht einen Löschweg).`);
  }
}

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function istObjekt(v) {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

/**
 * Baut den Auskunftsdatensatz für Dokumente einer Person aus den Personaldokument-
 * Zeilen und dem Dateispeicher (`personalDbDateienAuslesen()`-Form: id → {mime,
 * name, data}). Fehlt der Dateiinhalt (nicht mitgegeben oder gelöscht), fällt die
 * Zeile aus — die Metadaten stehen bereits in `datensaetze.Personaldokument`.
 * @param {Array<Record<string, any>>} dokumentZeilen Personaldokument-Zeilen dieser Person
 * @param {Record<string, {mime?: string, name?: string, data?: string}>} dateien personalDbDateienAuslesen()
 * @returns {Array<{name: string, mime: string, data: string}>}
 */
function dokumenteAus(dokumentZeilen, dateien) {
  /** @type {Array<{name: string, mime: string, data: string}>} */
  const aus = [];
  for (const d of dokumentZeilen) {
    const datei = dateien?.[d?.datei_ref];
    if (datei?.data) aus.push({ name: d.name || datei.name || d.datei_ref, mime: d.mime || datei.mime || "application/octet-stream", data: datei.data });
  }
  return aus;
}

/**
 * Art. 15/20 DSGVO-Auskunft einer Person oder Bewerbung — nur Datensätze mit
 * echtem Bezug auf genau dieses Subjekt, nie auf eine fremde Person (DS-10,
 * Behavior 2). Bei einem Mitarbeiter zusätzlich die verbundene Bewerbung
 * (`uebernommen_mitarbeiter_id`), falls die Einstellung über die Pipeline lief.
 * @param {{mitarbeiterId?: string, bewerbungId?: string}} subjekt genau eines der beiden Felder
 * @param {Record<string, object[]>} daten die neun Personal-Sammlungen
 * @param {Record<string, {mime?: string, name?: string, data?: string}>} [dateien] personalDbDateienAuslesen(), für die Dokumentinhalte
 * @returns {{schema: 1, art: 'auskunft', erstellt: string, person: object|null, datensaetze: Record<string, object[]>, dokumente: Array<{name: string, mime: string, data: string}>}}
 */
export function personAuskunft(subjekt, daten, dateien = {}) {
  const erstellt = new Date().toISOString();
  const mitarbeiterListe = Array.isArray(daten?.Mitarbeiter) ? daten.Mitarbeiter : [];
  const vertraege = Array.isArray(daten?.Arbeitsvertrag) ? daten.Arbeitsvertrag : [];
  const gehaelter = Array.isArray(daten?.Gehaltsaenderung) ? daten.Gehaltsaenderung : [];
  const vorgaenge = Array.isArray(daten?.Personalvorgang) ? daten.Personalvorgang : [];
  const dokumente = Array.isArray(daten?.Personaldokument) ? daten.Personaldokument : [];
  const bewerbungen = Array.isArray(daten?.Bewerbung) ? daten.Bewerbung : [];

  if (istObjekt(subjekt) && typeof subjekt.mitarbeiterId === "string") {
    const mitarbeiterId = subjekt.mitarbeiterId;
    const mitarbeiter = mitarbeiterListe.find((m) => m?.id === mitarbeiterId) || null;
    const eigeneDokumente = dokumente.filter((d) => d?.mitarbeiter_id === mitarbeiterId);
    const bewerbung = bewerbungen.find((b) => b?.uebernommen_mitarbeiter_id === mitarbeiterId) || null;
    /** @type {Record<string, object[]>} */
    const datensaetze = {
      Mitarbeiter: mitarbeiter ? [mitarbeiter] : [],
      Arbeitsvertrag: vertraege.filter((v) => v?.mitarbeiter_id === mitarbeiterId),
      Gehaltsaenderung: gehaelter.filter((g) => g?.mitarbeiter_id === mitarbeiterId),
      Personalvorgang: vorgaenge.filter((v) => v?.mitarbeiter_id === mitarbeiterId),
      Personaldokument: eigeneDokumente,
      Bewerbung: bewerbung ? [bewerbung] : [],
    };
    return { schema: 1, art: "auskunft", erstellt, person: mitarbeiter, datensaetze, dokumente: dokumenteAus(eigeneDokumente, dateien) };
  }

  if (istObjekt(subjekt) && typeof subjekt.bewerbungId === "string") {
    const bewerbungId = subjekt.bewerbungId;
    const bewerbung = bewerbungen.find((b) => b?.id === bewerbungId) || null;
    const eigeneDokumente = dokumente.filter((d) => d?.bewerbung_id === bewerbungId);
    /** @type {Record<string, object[]>} */
    const datensaetze = { Bewerbung: bewerbung ? [bewerbung] : [], Personaldokument: eigeneDokumente };
    return { schema: 1, art: "auskunft", erstellt, person: bewerbung, datensaetze, dokumente: dokumenteAus(eigeneDokumente, dateien) };
  }

  throw new Error("personAuskunft: subjekt braucht genau {mitarbeiterId} oder {bewerbungId}.");
}

/**
 * Jahreszahl eines 'YYYY-MM-DD'-Strings, oder null bei ungültiger Eingabe.
 * @param {unknown} tagIso
 * @returns {number|null}
 */
function jahrVon(tagIso) {
  return typeof tagIso === "string" && /^\d{4}-\d{2}-\d{2}/.test(tagIso) ? Number(tagIso.slice(0, 4)) : null;
}

/**
 * Letzter Tag eines um `jahre` verschobenen Kalenderjahres.
 * @param {number} basisJahr
 * @param {number} jahre
 * @returns {string} 'YYYY-12-31'
 */
function endeNachJahren(basisJahr, jahre) {
  return `${basisJahr + jahre}-12-31`;
}

/**
 * Bezugs-IDs eines Mitarbeiters, über die eine Fristquittung ihm zugeordnet
 * werden kann: die eigene ID plus jeder Arbeitsvertrag/Personalvorgang, der
 * `mitarbeiter_id` auf ihn trägt. `Fristquittung.schluessel` hat die Form
 * `art:bezugId:faelligAm` (fristen.js `quittungsSchluessel`) — das mittlere
 * Feld ist einer dieser IDs, wenn die Quittung zu dieser Person gehört.
 * @param {Record<string, object[]>} daten
 * @param {string} mitarbeiterId
 * @returns {Set<string>}
 */
function bezugIdsFuerMitarbeiter(daten, mitarbeiterId) {
  const ids = new Set([mitarbeiterId]);
  for (const v of Array.isArray(daten?.Arbeitsvertrag) ? daten.Arbeitsvertrag : []) if (v?.mitarbeiter_id === mitarbeiterId) ids.add(v.id);
  for (const p of Array.isArray(daten?.Personalvorgang) ? daten.Personalvorgang : []) if (p?.mitarbeiter_id === mitarbeiterId) ids.add(p.id);
  return ids;
}

/**
 * @param {string|undefined} schluessel
 * @returns {string|null} das mittlere Feld von "art:bezugId:faelligAm", oder null
 */
function bezugIdAusQuittung(schluessel) {
  const teile = typeof schluessel === "string" ? schluessel.split(":") : [];
  return teile.length === 3 ? teile[1] : null;
}

/**
 * Löschen-oder-Sperren-Plan eines Subjekts (Mitarbeiter oder Bewerbung),
 * Art. 17 Abs. 3, Art. 18 DSGVO. Jede betroffene Zeile landet in genau einer
 * der beiden Listen: `loeschen` (Frist bereits abgelaufen oder gar keine
 * eigene Frist) oder `sperren` (Frist läuft noch — Datensatz bleibt liegen,
 * `bis` nennt das Ende).
 *
 * Mitarbeiter: „Grabstein, solange etwas gesperrt ist, sonst löschen“ (DS-10-
 * Tabelle wörtlich) — sobald KEINE Kindzeile mehr gesperrt werden muss (weder
 * beim Austritt noch bei einem späteren Nachlauf, wenn alle Fristen
 * inzwischen abgelaufen sind), landet auch der Mitarbeiter-Datensatz selbst
 * in `loeschen`; `fuehrePlanAus` macht daraus dann keinen Grabstein mehr,
 * sondern löscht die letzte Zeile tatsächlich.
 * @param {{mitarbeiterId?: string, bewerbungId?: string}} subjekt
 * @param {string} anlass z. B. 'antrag_art17' (Betroffenenantrag) oder 'austritt' (automatischer Lauf)
 * @param {Record<string, object[]>} daten die neun Personal-Sammlungen
 * @param {string} heute 'YYYY-MM-DD'
 * @param {(id: string, stichtag?: string) => any} regelWert liest personal.aufbewahrung_*
 * @returns {{loeschen: Array<{entitaet: string, id: string}>, sperren: Array<{entitaet: string, id: string, bis: string, grund: string, norm: string}>, grabstein: boolean, mitarbeiterId?: string, bewerbungId?: string}}
 */
export function loeschPlan(subjekt, anlass, daten, heute, regelWert) {
  const wert = typeof regelWert === "function" ? regelWert : () => null;
  /** @type {Array<{entitaet: string, id: string}>} */
  const loeschen = [];
  /** @type {Array<{entitaet: string, id: string, bis: string, grund: string, norm: string}>} */
  const sperren = [];

  if (istObjekt(subjekt) && typeof subjekt.bewerbungId === "string") {
    const bewerbungId = subjekt.bewerbungId;
    const bewerbung = (Array.isArray(daten?.Bewerbung) ? daten.Bewerbung : []).find((b) => b?.id === bewerbungId) || null;
    const ab = loeschenAb(bewerbung, wert);
    const regel = LOESCH_REGELN.Bewerbung;
    const eintrag = { entitaet: "Bewerbung", id: bewerbungId };
    const nochGesperrt = typeof ab === "string" && heute < ab;
    if (nochGesperrt) sperren.push({ ...eintrag, bis: ab, grund: "Aufbewahrungsfrist läuft noch — Rechtsanspruch nach AGG", norm: /** @type {string} */ (regel.norm) });
    else loeschen.push(eintrag);

    const eigeneDokumente = (Array.isArray(daten?.Personaldokument) ? daten.Personaldokument : []).filter((d) => d?.bewerbung_id === bewerbungId);
    for (const d of eigeneDokumente) {
      const docEintrag = { entitaet: "Personaldokument", id: d.id };
      if (nochGesperrt) sperren.push({ ...docEintrag, bis: /** @type {string} */ (ab), grund: "folgt der Bewerbung (Aufbewahrungsfrist läuft noch)", norm: /** @type {string} */ (regel.norm) });
      else loeschen.push(docEintrag);
    }

    // Fristquittungen dieser Bewerbung: derselbe schluessel-Aufbau wie beim
    // Mitarbeiter, hier reicht die Bewerbungs-ID selbst als Bezug.
    for (const q of Array.isArray(daten?.Fristquittung) ? daten.Fristquittung : []) {
      if (bezugIdAusQuittung(q?.schluessel) === bewerbungId) loeschen.push({ entitaet: "Fristquittung", id: q.id });
    }

    return { loeschen, sperren, grabstein: false, bewerbungId };
  }

  if (istObjekt(subjekt) && typeof subjekt.mitarbeiterId === "string") {
    const mitarbeiterId = subjekt.mitarbeiterId;
    const mitarbeiter = (Array.isArray(daten?.Mitarbeiter) ? daten.Mitarbeiter : []).find((m) => m?.id === mitarbeiterId) || null;
    const austrittsjahr = jahrVon(mitarbeiter?.austritt) ?? jahrVon(heute) ?? 0;

    // Lohnkonto-Frist (Gehaltsaenderung): EINE Frist je Person, ab dem Jahr der
    // letzten Eintragung — nicht je Zeile, weil § 41 EStG das Lohnkonto als
    // Ganzes betrifft (DS-10-Tabelle).
    const eigeneGehaelter = (Array.isArray(daten?.Gehaltsaenderung) ? daten.Gehaltsaenderung : []).filter((g) => g?.mitarbeiter_id === mitarbeiterId);
    const letzteEintragungJahr = eigeneGehaelter.reduce((max, g) => Math.max(max, jahrVon(g?.gueltig_ab) ?? 0), 0);
    const lohnkontoJahre = Number(wert("personal.aufbewahrung_lohnkonto_jahre")) || 0;
    const lohnkontoBis = letzteEintragungJahr ? endeNachJahren(letzteEintragungJahr, lohnkontoJahre) : null;
    for (const g of eigeneGehaelter) {
      const eintrag = { entitaet: "Gehaltsaenderung", id: g.id };
      if (lohnkontoBis && heute < lohnkontoBis) sperren.push({ ...eintrag, bis: lohnkontoBis, grund: "Lohnkonto-Aufbewahrungsfrist", norm: /** @type {string} */ (LOESCH_REGELN.Gehaltsaenderung.norm) });
      else loeschen.push(eintrag);
    }

    // Personalakte-Frist (Arbeitsvertrag, Personalvorgang): ab dem Austrittsjahr.
    const personalakteJahre = Number(wert("personal.aufbewahrung_personalakte_jahre")) || 0;
    const personalakteBis = mitarbeiter?.austritt ? endeNachJahren(austrittsjahr, personalakteJahre) : null;
    const eigeneVertraege = (Array.isArray(daten?.Arbeitsvertrag) ? daten.Arbeitsvertrag : []).filter((v) => v?.mitarbeiter_id === mitarbeiterId);
    const eigeneVorgaenge = (Array.isArray(daten?.Personalvorgang) ? daten.Personalvorgang : []).filter((v) => v?.mitarbeiter_id === mitarbeiterId);
    for (const [entitaet, zeilen] of /** @type {const} */ ([["Arbeitsvertrag", eigeneVertraege], ["Personalvorgang", eigeneVorgaenge]])) {
      for (const v of zeilen) {
        const eintrag = { entitaet, id: v.id };
        if (personalakteBis && heute < personalakteBis) sperren.push({ ...eintrag, bis: personalakteBis, grund: "Personalakte-Aufbewahrungsfrist", norm: /** @type {string} */ (LOESCH_REGELN.Arbeitsvertrag.norm) });
        else loeschen.push(eintrag);
      }
    }

    // Personaldokumente: folgen dem Besitzer — Kategorie "bescheinigung" der
    // Lohnkonto-Frist, alles andere der Personalakte-Frist.
    const eigeneDokumente = (Array.isArray(daten?.Personaldokument) ? daten.Personaldokument : []).filter((d) => d?.mitarbeiter_id === mitarbeiterId);
    for (const d of eigeneDokumente) {
      const bis = d.kategorie === "bescheinigung" ? lohnkontoBis : personalakteBis;
      const eintrag = { entitaet: "Personaldokument", id: d.id };
      if (bis && heute < bis) sperren.push({ ...eintrag, bis, grund: d.kategorie === "bescheinigung" ? "folgt der Lohnkonto-Frist" : "folgt der Personalakte-Frist", norm: /** @type {string} */ (d.kategorie === "bescheinigung" ? LOESCH_REGELN.Gehaltsaenderung.norm : LOESCH_REGELN.Arbeitsvertrag.norm) });
      else loeschen.push(eintrag);
    }

    // Fristquittungen dieser Person (eigene ID oder eine ihrer Vertrags-/Vorgangs-IDs).
    const bezugIds = bezugIdsFuerMitarbeiter(daten, mitarbeiterId);
    for (const q of Array.isArray(daten?.Fristquittung) ? daten.Fristquittung : []) {
      const bezugId = bezugIdAusQuittung(q?.schluessel);
      if (bezugId && bezugIds.has(bezugId)) loeschen.push({ entitaet: "Fristquittung", id: q.id });
    }

    const grabstein = sperren.length > 0;
    if (!grabstein) loeschen.push({ entitaet: "Mitarbeiter", id: mitarbeiterId });

    return { loeschen, sperren, grabstein, mitarbeiterId };
  }

  throw new Error("loeschPlan: subjekt braucht genau {mitarbeiterId} oder {bewerbungId}.");
}
