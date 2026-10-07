// GAEB — FASSADE. Phase 33 / W5 (Plan 33-03): entkernt.
//
// Diese Datei enthält KEINE GAEB-Logik mehr. Sie delegiert:
//   `detectAndParse` → `gaeb90.js` (GAEB 90 / D83, CP437) bzw.
//                      `gaebXmlRead.js` (GAEB DA XML, eigener Tokenizer) bzw.
//                      den CSV-Leser hier unten.
//   `downloadGaeb`   → schreibt, was `gaebX83.js` gebaut hat.
//
// WAS ENTFERNT WURDE UND WARUM (die Entkernung ist der Punkt dieser Welle):
//
//  * Der alte Export schrieb ZWEI frei erfundene Tags — eines für das Los,
//    eines für die Kostengruppe. Beide existieren im GAEB-Schema nicht. Ein
//    Ziel-Import ignoriert unbekannte Tags stillschweigend: Los und
//    Kostengruppe kamen also nie an, und niemand sah einen Fehler. Ersetzt
//    durch `gaebX83.js` mit `LblBoQ` (Los) und `CtlgAssign/CtlgCode`
//    (Kostengruppe, beide DIN-Fassungen).
//  * Der alte Leser nahm die Ordnungszahl aus `Item@ID` — das ergab
//    `I00101010010` statt `01010010` — und die Kostengruppe aus dem erfundenen
//    Tag, also aus 0 von 497 Positionen. Ersetzt durch `gaebXmlRead.js`
//    (OZ aus der `RNoPart`-Kette, Kostengruppe aus `CtlgAssign`, Gewerk aus
//    `LblBoQ`, Langtext aus `DetailTxt`).
//  * Der Pfad für das Angebots-RÜCKGABEformat (Namespace-Variante 3.2) ist
//    entfallen. Er wurde nie gegen eine echte Datei dieses Formats geprüft und
//    ist nicht das Format eines Leistungsverzeichnisses.
//  * Damit ist auch der browserabhängige XML-Parser aus dem GAEB-Pfad
//    verschwunden — er ist in Node `undefined`, weshalb der alte Leser
//    überhaupt nicht testbar war (Pitfall 11).
//
// Die exakten Namen der entfernten Tags stehen in `33-03-SUMMARY.md`; sie
// tauchen hier ABSICHTLICH nicht mehr als Zeichenkette auf, damit ein
// grep-Gate den Rückfall sofort findet.
//
// `priceReference.js` bleibt UNVERÄNDERT: TED/DÖE sind Marktkontext auf
// LOS-Ebene und werden nie zu €/Einheit in einer Preisschicht. Diese
// Ehrlichkeitsgrenze ist ein Feature, kein fehlendes Mapping.
//
// EINGABE: `detectAndParse` nimmt Rohbytes (`ArrayBuffer`/`Uint8Array`) ODER
// einen String. Bei GAEB 90 sind Bytes PFLICHT — CP437 überlebt kein `file.text()`.
//
// Feldname: kanonisch ist `title`. Der Import schrieb früher `description`, die
// Tabelle rendert `title` — importierte Positionen waren dadurch NAMENLOS.
// Beides wird gesetzt (`description` als Altfeld), Quelle der Wahrheit ist `title`.

import { parseD83, istGaeb90, GAEB90_ENDUNGEN, decodeCp437 } from "./gaeb90.js";
import { readX83, menge } from "./gaebXmlRead.js";

export { buildX83, buildX83Dateien } from "./gaebX83.js";

/**
 * Eine erzeugte Datei herunterladen (GAEB-XML oder D83). Nur im Browser.
 */
export function downloadGaeb(filename, inhalt) {
  const blob = new Blob([inhalt], { type: "application/xml;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * GAEB-DA-XML in flache LV-Zeilen parsen — delegiert an `gaebXmlRead.js`.
 * Bei Parserfehler: `[]` (der Aufrufer soll nicht abstürzen, aber auch keine
 * erfundenen Zeilen bekommen).
 */
export function parseGaebXml(xmlString) {
  try {
    return readX83(xmlString).positionen;
  } catch (err) {
    console.error("GAEB-XML nicht lesbar:", err);
    return [];
  }
}

// Eine CSV-Zeile (Semikolon-getrennt, mit "..."-Quoting) in Felder zerlegen.
function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ";") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// Header-Spalte einem LV-Feld zuordnen (tolerant gegenüber deutschen/englischen Namen).
function headerField(h) {
  const k = h.trim().toLowerCase();
  if (["oz", "position", "pos", "ordnungszahl"].includes(k)) return "oz";
  if (["beschreibung", "description", "kurztext", "titel", "title", "text"].includes(k)) return "description";
  if (["menge", "quantity", "qty"].includes(k)) return "quantity";
  if (["einheit", "unit", "me", "qu"].includes(k)) return "unit";
  if (["ep", "unit_price", "einheitspreis", "preis"].includes(k)) return "unit_price";
  if (["gewerk", "trade", "los", "lot"].includes(k)) return "trade";
  if (["din276", "kg", "kostengruppe", "din 276"].includes(k)) return "din276";
  return null;
}

// Zahl aus einer CSV-Zelle. `null` statt 0, wenn nicht lesbar — eine 0 im
// Einheitspreis sieht wie ein belegter Nullpreis aus (Konvention aus W2/W4).
// Die Zahlenerkennung selbst liegt in `gaebXmlRead.menge` (eine Stelle, ein Verhalten).
const csvZahl = (v) => menge(v);

// Semikolon-CSV mit Headerzeile in LV-Zeilen parsen (BOM strippen, Dezimalkomma).
export function parseLvCsv(text) {
  const clean = String(text || "").replace(/^\uFEFF/, "");
  const lines = clean.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map(headerField);
  if (!headers.some(Boolean)) return [];
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const row = { oz: "", description: "", quantity: null, unit: "St", unit_price: null, trade: "", din276: "" };
    headers.forEach((field, idx) => {
      if (!field || cells[idx] == null) return;
      const v = cells[idx].trim();
      if (field === "quantity" || field === "unit_price") row[field] = csvZahl(v);
      else row[field] = v;
    });
    // `title` ist der kanonische Feldname (die Tabelle rendert ihn); die CSV-Spalte
    // heisst je nach Herkunft Beschreibung/Kurztext/Titel und landet in `description`.
    row.title = row.description;
    if (row.oz || row.title) rows.push(row);
  }
  return rows;
}

/**
 * GAEB-90-Positionen (`.d83`) in LV-Zeilen übersetzen.
 *
 * Der Modus ist `uebernahme`, nicht `handeingabe`: die Menge stammt BELEGT aus dem
 * Ausschreibungs-LV (Datei, OZ, Datum stehen in `menge_herkunft`) und nicht daraus, dass
 * jemand eine Zahl getippt hat. Ein Einheitspreis ist in einer Angebotsaufforderung
 * nicht enthalten — `unit_price` bleibt deshalb `null` und wird NICHT erfunden.
 */
export function gaeb90Rows(daten, { filename = null, gewerk_nr = null } = {}) {
  const res = parseD83(daten, { gewerk_nr, datei: filename });
  const rows = res.positionen.map((p) => ({
    oz: p.oz,
    title: p.kurztext || p.oz,
    description: p.kurztext || p.oz, // Altfeld, damit nichts Bestehendes ins Leere liest
    short_text: p.kurztext || "",
    long_text: p.langtext || "",
    quantity: p.menge ?? 0,
    unit: p.einheit || "",
    unit_price: null, // GAEB 90 D83 = Angebotsaufforderung, es GIBT hier keinen Preis
    trade: p.gewerk || res.lv_name || "",
    din276: "",
    kennz: p.kennz || null,
    titel_pfad: p.titel || [],
    stlb: p.stlb || null,
    mengen_modus: "uebernahme",
    menge_herkunft: {
      quelle: "GAEB 90 (D83)",
      datei: filename,
      lv_name: res.lv_name || null,
      lv_datum: res.lv_datum || null,
      quell_oz: p.oz,
      gewerk_nr: p.gewerk_nr ?? gewerk_nr ?? null,
    },
  }));
  return { rows, meta: res };
}

/**
 * Anhand von Inhalt UND Endung parsen: GAEB 90 (Festbreiten/CP437),
 * GAEB-DA-XML oder Semikolon-CSV.
 *
 * @param {string} filename
 * @param {ArrayBuffer|Uint8Array|string} daten Rohbytes bevorzugt (Pflicht für GAEB 90)
 */
export function detectAndParse(filename, daten) {
  const ext = "." + (filename || "").toLowerCase().split(".").pop();
  const sindBytes = typeof daten !== "string";

  // GAEB 90 zuerst: die Inhaltsprüfung entscheidet, nicht die Endung — eine als `.x83`
  // benannte Satzdatei soll nicht als XML durch den Parser fallen (und umgekehrt).
  if (sindBytes && (GAEB90_ENDUNGEN.includes(ext) || istGaeb90(daten)) && istGaeb90(daten)) {
    return gaeb90Rows(daten, { filename }).rows;
  }

  // Ab hier Text. Bytes werden als UTF-8 gelesen; scheitert das, als CP437.
  let text;
  if (sindBytes) {
    const bytes = daten instanceof Uint8Array ? daten : new Uint8Array(daten);
    const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    text = utf8.includes("�") ? decodeCp437(bytes) : utf8;
  } else {
    text = daten;
  }

  const xmlEndungen = ["x81", "x82", "x83", "x84", "x86", "xml"];
  if (xmlEndungen.includes(ext.slice(1)) || /^\s*<\?xml/.test(text)) {
    return parseGaebXml(text);
  }
  return parseLvCsv(text);
}
