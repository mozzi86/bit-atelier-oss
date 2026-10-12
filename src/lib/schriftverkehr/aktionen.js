// Actions of the correspondence page (phase 82, 82-05): freeze and file a
// letter, mark it sent (outgoing register entry, settles the incoming mail it
// answers), save incoming mail with a scan, regenerate a PDF. Every letter,
// template and register write goes through the office store (bueroEntitaet /
// speichereBuero, 82-01, E-03); the PDF is the shared letter core's (79-03
// with 81-03's options) — no second PDF path; the bytes are filed with
// dokumentAblegen (storage rule: over 1 MB into the object store).
//
// In:  api (bitApi or a fake), records, page context. Out: see the exports.

import { dokumentAblegen } from "@core/lib/ablage";
import { briefLayout } from "@core/lib/brief/briefLayout.js";
import { erzeugeBriefPdf } from "@core/lib/brief/briefPdf.js";
import { bezugErledigen, eintragAusSchreiben, naechsteNummer, nummerSichern } from "@core/lib/brief/postbuch.js";
import { briefModell, dateiIdAus, fehlendIn, festschreiben, LAYOUT_VERSION, statusWechsel, umschreiben } from "@core/lib/brief/schreiben.js";
import { DOKUMENT_BEREICH } from "@core/lib/brief/status.js";
import { bueroEntitaet, speichereBuero } from "@/lib/bueroOrga/speicher.js";

/** Largest scan of incoming mail, bytes — [ASSUMED] 5 MB: a scanned letter of a few pages; larger files belong in the project storage. */
export const SCAN_MAX_BYTES = 5 * 1024 * 1024;

/**
 * 'YYYY-MM-DD' → 'DD.MM.YYYY' (letter date; anything else unchanged).
 * @param {string|null|undefined} iso
 * @returns {string}
 */
export function datumText(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso || "");
}

/**
 * PDF bytes as a data URL (the Document.data convention of 81).
 * @param {Uint8Array} bytes
 * @param {string} [mime]
 * @returns {string}
 */
export function bytesZuDataUrl(bytes, mime = "application/pdf") {
  let binaer = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binaer += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${globalThis.btoa(binaer)}`;
}

/**
 * File name of a letter PDF: date and subject, safe for every file system.
 * @param {Record<string, any>} schreiben
 * @returns {string}
 */
export function dateiname(schreiben) {
  const betreff = String(schreiben.betreff || "Schreiben").normalize("NFKD").replace(/\p{M}/gu, "").replace(/[^\w\- ]+/g, " ").trim().replace(/\s+/g, "_").slice(0, 60) || "Schreiben";
  return `Schreiben_${schreiben.datum || ""}_${betreff}.pdf`;
}

/**
 * PDF of a letter (transliterated first, see umschreiben).
 * @param {Record<string, any>} schreiben
 * @param {{briefkopf: Record<string, any>|null, fixiert?: {erstelltAm: string, dateiId: string}|null}} optionen
 * @returns {Promise<{bytes: Uint8Array, ersetzt: number, schreiben: Record<string, any>}>} schreiben: the transliterated letter
 */
export async function schreibenPdf(schreiben, { briefkopf, fixiert = null }) {
  const { schreiben: u, ersetzt } = umschreiben(schreiben);
  const bytes = await erzeugeBriefPdf(briefLayout(/** @type {any} */ (briefModell(u, { briefkopf, datumText: datumText(u.datum) }))), { fixiert });
  return { bytes, ersetzt, schreiben: u };
}

/**
 * Freezes a draft: saves it (so it has an id), builds the PDF with a fixed
 * creation date and file id, freezes text and hash, files the PDF and stores
 * the fixed letter with its document id. A failed filing leaves the draft as it was.
 * @param {any} api
 * @param {Record<string, any>} entwurf
 * @param {{briefkopf: Record<string, any>|null, jetzt: string, datenquelle: string}} kontext jetzt: ISO timestamp
 * @returns {Promise<{schreiben: Record<string, any>, bytes: Uint8Array, ersetzt: number, hinweis: string|null}>}
 * @throws {Error} plain text (missing data, filing failed, cloud lock)
 */
export async function festschreibenUndAblegen(api, entwurf, { briefkopf, jetzt, datenquelle }) {
  const fehlend = fehlendIn(entwurf);
  if (fehlend.length) throw new Error(`Pflichtangaben fehlen: ${fehlend.join(", ")}`);
  if (entwurf.bereich === "projekt" && !entwurf.project_id) throw new Error("Projekt fehlt");
  const gespeichert = await speichereBuero(api, "Schreiben", entwurf, { datenquelle });
  const fixiert = { erstelltAm: jetzt, dateiId: await dateiIdAus(gespeichert.id) };
  const { bytes, ersetzt, schreiben: u } = await schreibenPdf(gespeichert, { briefkopf, fixiert });
  const fest = await festschreiben(u, { pdfBytes: bytes, jetzt, layoutVersion: LAYOUT_VERSION });
  const ablage = await dokumentAblegen({
    projectId: fest.bereich === "projekt" ? fest.project_id : undefined,
    name: dateiname(fest),
    typ: "Postausgang",
    notiz: fest.betreff || "",
    daten: bytesZuDataUrl(bytes),
    bereich: DOKUMENT_BEREICH[/** @type {'projekt'|'buero'|'buchhaltung'} */ (fest.bereich)] || "projekt",
    sha256: fest.pdf_sha256,
  }, api);
  if (!ablage.ok) throw new Error(`Ablage fehlgeschlagen: ${ablage.grund}`);
  const final = await speichereBuero(api, "Schreiben", { ...fest, document_id: /** @type {any} */ (ablage.dokument).id }, { datenquelle });
  return { schreiben: final, bytes, ersetzt, hinweis: ablage.hinweis || null };
}

/**
 * Marks a fixed letter as sent: outgoing register entry with the next free
 * number (re-checked against the freshly loaded register), the letter points to
 * it, and incoming mail the letter answers is settled.
 * @param {any} api
 * @param {Record<string, any>} schreiben fixed letter
 * @param {{heute: string, versandweg: string, datenquelle: string}} kontext
 * @returns {Promise<{schreiben: Record<string, any>, eintrag: Record<string, any>, hinweis: string|null}>}
 * @throws {Error} plain text
 */
export async function versendetMarkieren(api, schreiben, { heute, versandweg, datenquelle }) {
  const vers = statusWechsel(schreiben, "versendet", { jetzt: heute, versandweg });
  const vorhandene = (await bueroEntitaet(api, "Postbucheintrag", { datenquelle }).list()) || [];
  const { eintrag, hinweis } = nummerSichern(eintragAusSchreiben(vers, vorhandene), vorhandene);
  const neu = await speichereBuero(api, "Postbucheintrag", eintrag, { datenquelle });
  const final = await speichereBuero(api, "Schreiben", { ...vers, postbuch_id: neu.id }, { datenquelle });
  const erledigt = bezugErledigen(vorhandene, vers);
  if (erledigt) await speichereBuero(api, "Postbucheintrag", erledigt, { datenquelle });
  return { schreiben: final, eintrag: neu, hinweis };
}

/**
 * Saves incoming mail: a new entry gets the next PE number; a scan is filed
 * as Posteingang (project folder 09_Schriftverkehr/Eingang, office mail without project).
 * @param {any} api
 * @param {Record<string, any>} eintrag
 * @param {{datenquelle: string, scan?: {name: string, dataUrl: string, bytes: number}|null}} kontext
 * @returns {Promise<{eintrag: Record<string, any>, hinweis: string|null}>}
 * @throws {Error} plain text (scan too large, filing failed, cloud lock)
 */
export async function posteingangSpeichern(api, eintrag, { datenquelle, scan = null }) {
  if (scan && scan.bytes > SCAN_MAX_BYTES) throw new Error("Der Scan ist größer als 5 MB.");
  let neu = /** @type {Record<string, any>} */ ({ ...eintrag, richtung: "eingang" });
  let hinweis = null;
  if (!neu.id) {
    const vorhandene = (await bueroEntitaet(api, "Postbucheintrag", { datenquelle }).list()) || [];
    const r = nummerSichern({ ...neu, nummer: naechsteNummer(vorhandene, "eingang", neu.datum) }, vorhandene);
    neu = r.eintrag;
    hinweis = r.hinweis;
  }
  if (scan) {
    const ablage = await dokumentAblegen({
      projectId: neu.bereich === "projekt" ? neu.project_id : undefined,
      name: scan.name,
      typ: "Posteingang",
      notiz: `${neu.nummer} ${neu.betreff || ""}`.trim(),
      daten: scan.dataUrl,
      bereich: DOKUMENT_BEREICH[/** @type {'projekt'|'buero'|'buchhaltung'} */ (neu.bereich)] || "projekt",
    }, api);
    if (!ablage.ok) throw new Error(`Ablage fehlgeschlagen: ${ablage.grund}`);
    neu.document_id = /** @type {any} */ (ablage.dokument).id;
  }
  return { eintrag: await speichereBuero(api, "Postbucheintrag", neu, { datenquelle }), hinweis };
}

/**
 * Whether a register entry may be deleted: an outgoing entry of a fixed or sent letter never.
 * @param {Record<string, any>} eintrag
 * @param {ReadonlyArray<Record<string, any>>} schreiben
 * @returns {boolean}
 */
export function postbuchLoeschbar(eintrag, schreiben) {
  if (eintrag?.richtung !== "ausgang" || !eintrag.schreiben_id) return true;
  const sc = (schreiben || []).find((s) => s.id === eintrag.schreiben_id);
  return !sc || sc.status === "entwurf";
}
