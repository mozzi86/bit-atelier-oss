// stellenanzeige.js — Anzeigentext aus einer Stelle (Plan 80-08): reiner
// Text zum Kopieren oder als PDF, OHNE Netzzugriff und OHNE jede Form von
// Veröffentlichung — die App verschickt und postet nichts selbst (das wäre
// externe Kommunikation und bräuchte eine eigene Freigabe).
//
// Text ist gespeicherte, ausgehende Fachlichkeit (wie nachtraegeAusTicket()s
// Beschreibungstext in nachtraege.js) — deutsch, nicht über t() übersetzt.
//
// [ASSUMED] Die Gehaltsspanne-Pflichtangabe folgt RL (EU) 2023/970 Art. 5
// (Entgelttransparenz); die Umsetzung ins deutsche Recht steht zum Stand
// dieses Plans noch aus (D-P80-19) — die Anzeige zeigt die Spanne trotzdem
// schon jetzt als Bürostandard.
//
// Anforderungen bleiben gespeichert, wie der 80-02-Typedef sie festlegt:
// `string[]`, jede Zeile genau so, wie sie in der Anzeige steht. "Kann" ist
// deshalb kein eigenes Feld, sondern der sichtbare Zusatz "(von Vorteil)" —
// leseAnforderung/schreibeAnforderung übersetzen zwischen dieser Zeile und der
// Formularform {bezeichnung, muss}.
//
// In:  eine Stelle (personalEntitaeten.js Typedef Stelle), ein Briefkopf
//      ({office, tagline, address, contact}, Setting "briefkopf").
// Out: stellenanzeigeText, leseAnforderung, schreibeAnforderung.

import { PERSONENARTEN } from "./mitarbeiter.js";

/** Gespeicherter Zusatz einer Kann-Anforderung (ausgehende Fachlichkeit, deutsch ohne t()). */
const KANN_ZUSATZ = "(von Vorteil)";
// Also accepts the unbracketed idiom ("ByAK-Mitgliedschaft von Vorteil", as
// the 80-02 seed writes it), so a stored Kann line never shows up as Muss.
const KANN_MUSTER = /\s*[,–-]?\s*\(?\s*von\s+Vorteil\s*\)?\s*$/iu;

/**
 * Formularform einer gespeicherten Anforderung. Nimmt die gespeicherte Zeile
 * (`string`, Typedef) ebenso wie ein `{bezeichnung, muss}`-Objekt entgegen.
 * @param {unknown} eintrag gespeicherte Zeile oder Formularobjekt
 * @returns {{bezeichnung: string, muss: boolean}|null} null für leere/unbrauchbare Einträge
 */
export function leseAnforderung(eintrag) {
  if (typeof eintrag === "string") {
    const text = eintrag.trim();
    if (!text) return null;
    const ohneZusatz = text.replace(KANN_MUSTER, "").trim();
    if (ohneZusatz && ohneZusatz !== text) return { bezeichnung: ohneZusatz, muss: false };
    return { bezeichnung: text, muss: true };
  }
  if (eintrag && typeof eintrag === "object" && typeof (/** @type {any} */ (eintrag)).bezeichnung === "string") {
    const roh = /** @type {{bezeichnung: string, muss?: unknown}} */ (eintrag);
    const gelesen = leseAnforderung(roh.bezeichnung);
    if (!gelesen) return null;
    return { bezeichnung: gelesen.bezeichnung, muss: roh.muss === undefined ? gelesen.muss : Boolean(roh.muss) && gelesen.muss };
  }
  return null;
}

/**
 * Gespeicherte Zeile einer Anforderung (Typedef `anforderungen: string[]`):
 * Muss als reiner Text, Kann mit dem Zusatz "(von Vorteil)".
 * @param {unknown} anforderung Formularobjekt oder bereits gespeicherte Zeile
 * @returns {string|null} null für leere/unbrauchbare Einträge
 */
export function schreibeAnforderung(anforderung) {
  const a = leseAnforderung(anforderung);
  if (!a) return null;
  return a.muss ? a.bezeichnung : `${a.bezeichnung} ${KANN_ZUSATZ}`;
}

/** @param {string} key @returns {string} deutsches Label oder der Rohschlüssel, wenn unbekannt */
function beschaeftigungsartLabel(key) {
  return PERSONENARTEN.find((p) => p.key === key)?.label || key || "";
}

/**
 * Baut den Anzeigentext einer Stelle: Titel, Büro (aus dem Briefkopf),
 * Aufgaben, Anforderungen (Muss/Kann), Umfang, Beginn und die Gehaltsspanne.
 * Kein `fetch`, keine Veröffentlichung — nur der Text selbst.
 * @param {{titel?: string, aufgaben?: string, anforderungen?: Array<string|{bezeichnung: string, muss?: boolean}>,
 *   beschaeftigungsart?: string, wochenstunden?: number, befristet?: boolean,
 *   beginn_ab?: string, gehaltsspanne?: {von_eur?: number, bis_eur?: number, einheit?: 'Monat'|'Stunde'}}|null|undefined} stelle
 * @param {{office?: string, tagline?: string, address?: string, contact?: string}|null|undefined} briefkopf Setting "briefkopf" (src/Layout.jsx/Reports.jsx)
 * @returns {string} mehrzeiliger Klartext, '' ohne Stelle
 */
export function stellenanzeigeText(stelle, briefkopf) {
  if (!stelle) return "";
  const zeilen = [];

  zeilen.push(stelle.titel || "");
  if (briefkopf?.office) zeilen.push(briefkopf.office);
  if (briefkopf?.tagline) zeilen.push(briefkopf.tagline);
  zeilen.push("");

  if (stelle.aufgaben) {
    zeilen.push("Aufgaben:");
    zeilen.push(stelle.aufgaben);
    zeilen.push("");
  }

  const anforderungen = Array.isArray(stelle.anforderungen) ? stelle.anforderungen.map(schreibeAnforderung).filter(Boolean) : [];
  if (anforderungen.length > 0) {
    zeilen.push("Anforderungen:");
    for (const a of anforderungen) zeilen.push(`– ${a}`);
    zeilen.push("");
  }

  const umfangTeile = [];
  if (typeof stelle.wochenstunden === "number") umfangTeile.push(`${stelle.wochenstunden} Std./Woche`);
  const art = beschaeftigungsartLabel(stelle.beschaeftigungsart);
  if (art) umfangTeile.push(art);
  if (stelle.befristet) umfangTeile.push("befristet");
  if (umfangTeile.length > 0) zeilen.push(`Umfang: ${umfangTeile.join(", ")}`);
  if (stelle.beginn_ab) zeilen.push(`Beginn ab: ${stelle.beginn_ab}`);

  const spanne = stelle.gehaltsspanne;
  if (spanne && typeof spanne.von_eur === "number" && typeof spanne.bis_eur === "number") {
    const von = spanne.von_eur.toLocaleString("de-DE");
    const bis = spanne.bis_eur.toLocaleString("de-DE");
    const einheit = spanne.einheit === "Stunde" ? "€/Stunde" : "€/Monat";
    zeilen.push(`Gehalt: ${von} – ${bis} ${einheit}`);
  }

  if (briefkopf?.address) zeilen.push(briefkopf.address);
  if (briefkopf?.contact) zeilen.push(briefkopf.contact);

  return zeilen.join("\n").trim();
}
