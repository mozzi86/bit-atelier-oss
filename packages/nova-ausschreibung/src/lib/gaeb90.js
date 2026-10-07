// GAEB 90 (DA 83) — Leser für echte Ausschreibungs-LVs. Phase 33 / W3.
//
// GAEB 90 IST KEIN XML. Es ist ein Zeilenformat mit FESTEN Spalten, 80 Zeichen je Zeile,
// CRLF, codiert in **CP437** (DOS-Zeichensatz). Der bisherige `gaeb.js` suchte in diesen
// Dateien XML-Tags — Ergebnis: aus 15 echten `.d83` wurden 0 Positionen gelesen, und
// `.d83` stand nicht einmal im `accept` des Datei-Dialogs.
//
// ZWEI FALLEN, DIE HIER GELÖST SIND:
//
// 1. `new TextDecoder('cp437'|'ibm437'|'437')` wirft `RangeError` — Node und alle
//    Browser kennen die Codierung nicht (gemessen, s. Test). Deshalb steht unten eine
//    eigene Tabelle für die 128 Hochbytes. Ohne sie wird aus „Gebäude" „Gebde",
//    aus „für" „fr" und aus „m²" „mý" — also aus Leistungstexten Datenmüll.
// 2. `file.text()` dekodiert IMMER UTF-8. Ein CP437-`ä` (0x84) ist kein gültiges
//    UTF-8 und wird zu U+FFFD — unwiederbringlich. Eingabe ist deshalb ein
//    `ArrayBuffer`/`Uint8Array`, NIE ein bereits dekodierter String.
//
// Isomorph: kein DOMParser, kein window, keine Aliase — läuft in `node --test` (Gate G7)
// genauso wie im Browser.

// --- CP437: die 128 Hochbytes (0x80–0xFF) ------------------------------------------------
//
// Reihenfolge = Codepage 437 der IBM-PC. Die ersten 32 Einträge sind die
// westeuropäischen Akzentzeichen, danach Rahmen-, Block- und Mathematiksymbole.
// 0xFD ist das Hochzeichen ² — genau damit steht und fällt „m²" in 155 Positionen.
const CP437_HIGH = [
  "Ç", "ü", "é", "â", "ä", "à", "å", "ç", "ê", "ë", "è", "ï", "î", "ì", "Ä", "Å",
  "É", "æ", "Æ", "ô", "ö", "ò", "û", "ù", "ÿ", "Ö", "Ü", "¢", "£", "¥", "₧", "ƒ",
  "á", "í", "ó", "ú", "ñ", "Ñ", "ª", "º", "¿", "⌐", "¬", "½", "¼", "¡", "«", "»",
  "░", "▒", "▓", "│", "┤", "╡", "╢", "╖", "╕", "╣", "║", "╗", "╝", "╜", "╛", "┐",
  "└", "┴", "┬", "├", "─", "┼", "╞", "╟", "╚", "╔", "╩", "╦", "╠", "═", "╬", "╧",
  "╨", "╤", "╥", "╙", "╘", "╒", "╓", "╫", "╪", "┘", "┌", "█", "▄", "▌", "▐", "▀",
  "α", "ß", "Γ", "π", "Σ", "σ", "µ", "τ", "Φ", "Θ", "Ω", "δ", "∞", "φ", "ε", "∩",
  "≡", "±", "≥", "≤", "⌠", "⌡", "÷", "≈", "°", "∙", "·", "√", "ⁿ", "²", "■", "\u00A0", // 0xFF = GESCHÜTZTES Leerzeichen, nicht das gewöhnliche
];
// Hinweis zu 0xFF: CP437 legt dort U+00A0 (NBSP) ab. In Festbreitenfeldern ist es ein
// Füllzeichen — `String.prototype.trim()` erfasst U+00A0 mit, die Felder bleiben sauber.

if (CP437_HIGH.length !== 128) {
  // Ein Tippfehler in der Tabelle würde alle Texte um ein Zeichen verschieben.
  throw new Error(`CP437-Tabelle muss 128 Einträge haben, hat ${CP437_HIGH.length}`);
}

/** Höchstgröße einer D83-Datei (ASVS V5 — kein unbegrenzter Speicherverbrauch). */
export const MAX_BYTES = 32 * 1024 * 1024;

/**
 * CP437-Bytes → String. 0x00–0x7F sind ASCII, 0x80–0xFF kommen aus der Tabelle.
 * @param {ArrayBuffer|Uint8Array} daten Rohbytes (ein Node-`Buffer` ist ein Uint8Array)
 */
export function decodeCp437(daten) {
  const bytes =
    daten instanceof Uint8Array ? daten
      : daten && typeof daten.byteLength === "number" ? new Uint8Array(daten)
        : null;
  if (!bytes) {
    throw new Error(
      "GAEB-90-Dateien müssen als ArrayBuffer gelesen werden (file.arrayBuffer()), " +
      "nicht als Text — file.text() dekodiert UTF-8 und zerstört die Umlaute.",
    );
  }
  if (bytes.length > MAX_BYTES) {
    throw new Error(`Datei zu groß: ${bytes.length} Bytes, erlaubt sind ${MAX_BYTES}.`);
  }
  let out = "";
  const teile = [];
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    out += b < 0x80 ? String.fromCharCode(b) : CP437_HIGH[b - 0x80];
    if (out.length >= 8192) { teile.push(out); out = ""; }
  }
  teile.push(out);
  return teile.join("");
}

// --- Satzarten ---------------------------------------------------------------------------
//
// Whitelist statt „alles, was kommt": eine unbekannte Satzart wird GEZÄHLT und gemeldet,
// aber nie interpretiert. Zusammen mit dem Zeilen-für-Zeilen-Durchlauf (kein Rücksprung,
// kein while über einen beweglichen Index) ist eine Endlosschleife strukturell
// ausgeschlossen (T-33-11).
export const SATZARTEN = {
  "00": "Dateikopf",
  "01": "LV-Name und Datum",
  "02": "Projektnummer",
  "03": "Auftraggeber",
  "08": "Währung",
  "11": "Gruppenbeginn (OZ)",
  "12": "Gruppentitel",
  "20": "Abschnittswechsel",
  "21": "Position",
  "25": "Kurztext",
  "26": "Langtext",
  "31": "Gruppenende",
  79: "STLB-Bau-Verweis",
  "99": "Dateiende",
  T0: "Vorbemerkung (Kopf)",
  T1: "Vorbemerkung (Text)",
  T9: "Vorbemerkung (Ende)",
};

// Feste Spalten der Satzart 21 (0-basiert, Ende exklusiv) — am Bestand verifiziert und
// identisch zum eingefrorenen Python-Orakel (parity/oracle/parse_gaeb.py).
/** @type {{oz: [number, number], kennz: [number, number], menge: [number, number], einheit: [number, number]}} */
export const SPALTEN_21 = {
  oz: [2, 11],
  kennz: [11, 23],
  menge: [23, 34], // 11 Stellen, drei Nachkommastellen ⇒ int / 1000
  einheit: [34, 38],
};

/** @param {string} zeile @param {[number, number]} spalten */
const feld = (zeile, spalten) => zeile.slice(spalten[0], spalten[1]);

/**
 * Menge aus dem 11-stelligen Festkommafeld. Rückgabe `null` (nicht 0!), wenn das Feld
 * unlesbar ist — eine stille 0 wäre eine erfundene Menge.
 */
export function mengeAusFeld(roh) {
  const s = String(roh ?? "").trim();
  if (!/^\d+$/.test(s)) return null;
  return Number.parseInt(s, 10) / 1000;
}

/**
 * Eine GAEB-90-D83-Datei lesen.
 *
 * @param {ArrayBuffer|Uint8Array} daten Rohbytes (NIE ein String; ein Node-`Buffer` zählt als Uint8Array)
 * @param {{gewerk_nr?: string, datei?: string}} [meta]
 * @returns {{lv_name: string, lv_datum: string, projekt: string|null,
 *            auftraggeber: string|null, waehrung: string|null,
 *            positionen: Array, vorbemerkung: string,
 *            pruefung: {positionen_laut_datei: number|null, zeilen_laut_datei: number|null,
 *                       positionen_gelesen: number, zeilen_gelesen: number, stimmig: boolean},
 *            satzarten: Object<string, number>, warnungen: string[]}}
 */
export function parseD83(daten, meta = {}) {
  const text = typeof daten === "string"
    ? (() => { throw new Error("parseD83 erwartet Bytes, keinen String — s. decodeCp437."); })()
    : decodeCp437(daten);

  const zeilen = text.split(/\r\n|\n|\r/).filter((z) => z.length > 0);
  /** @type {string[]} */
  const warnungen = [];
  /** @type {Object<string, number>} */
  const satzarten = {};

  let lv_name = "";
  let lv_datum = "";
  let projekt = null;
  let auftraggeber = null;
  let waehrung = null;
  const vorbemerkung = [];

  const positionen = [];
  const gruppen = []; // [{ oz, titel }]
  let offeneGruppeOz = null;
  let aktuell = null;
  let positionenLautDatei = null;
  let zeilenLautDatei = null;

  const abschliessen = () => {
    if (!aktuell) return;
    aktuell.kurztext = aktuell._kurz.join(" ").trim();
    aktuell.langtext = aktuell._lang.join("\n").replace(/\s+$/, "");
    delete aktuell._kurz;
    delete aktuell._lang;
    positionen.push(aktuell);
    aktuell = null;
  };

  for (const zeile of zeilen) {
    const art = zeile.slice(0, 2);
    satzarten[art] = (satzarten[art] || 0) + 1;

    switch (art) {
      case "01":
        // Der LV-Name ist im Format auf 40 Zeichen GEKÜRZT — genau so übernehmen,
        // nicht „reparieren" (er ist der Schlüssel zu den Losen der Pipeline).
        lv_name = zeile.slice(2, 42).trim();
        lv_datum = zeile.slice(42, 52).trim();
        break;

      case "02":
        projekt = zeile.slice(2, 72).trim() || null;
        break;

      case "03":
        auftraggeber = zeile.slice(2, 72).trim() || null;
        break;

      case "08":
        waehrung = zeile.slice(2, 8).trim() || null;
        break;

      case "T1":
        vorbemerkung.push(zeile.slice(2, 72).replace(/\s+$/, ""));
        break;

      case "11":
        abschliessen();
        offeneGruppeOz = zeile.slice(2, 11).trim();
        break;

      case "12":
        if (offeneGruppeOz !== null) {
          gruppen.push({ oz: offeneGruppeOz, titel: zeile.slice(2, 72).trim() });
          offeneGruppeOz = null;
        }
        break;

      case "31": {
        abschliessen();
        const oz = zeile.slice(2, 11).trim();
        // Gruppen bis zur passenden Ebene schließen (Titel-Stack).
        while (gruppen.length && (gruppen[gruppen.length - 1].oz === oz
          || gruppen[gruppen.length - 1].oz.length >= oz.length)) {
          const raus = gruppen.pop();
          if (raus.oz === oz) break;
        }
        break;
      }

      case "21": {
        abschliessen();
        const oz = feld(zeile, SPALTEN_21.oz).trim();
        const kennz = feld(zeile, SPALTEN_21.kennz).trim();
        const mengeRoh = feld(zeile, SPALTEN_21.menge);
        const menge = mengeAusFeld(mengeRoh);
        if (menge === null) {
          warnungen.push(`OZ ${oz}: Mengenfeld unlesbar (${JSON.stringify(mengeRoh)}) — Menge bleibt null.`);
        }
        aktuell = {
          gewerk_nr: meta.gewerk_nr ?? null,
          gewerk: lv_name || null,
          oz,
          // `kennz` bleibt erhalten: Normal-/Bedarfs-/Eventualposition und Zulage sind
          // VOB-relevant (eine Bedarfsposition darf nicht in die Angebotssumme).
          kennz,
          menge,
          einheit: feld(zeile, SPALTEN_21.einheit).trim(),
          titel: gruppen.map((g) => g.titel),
          titel_oz: gruppen.map((g) => g.oz),
          kurztext: '',
          langtext: '',
          // Wird aus Satzart 79 gefüllt, falls die Position einen STLB-Verweis trägt.
          stlb: /** @type {null | {kennung: object|null, baumasse: object[], roh: string[]}} */ (null),
          /** @type {string[]} */ _kurz: [],
          /** @type {string[]} */ _lang: [],
        };
        break;
      }

      case "25":
        if (aktuell) aktuell._kurz.push(zeile.slice(2, 72).trim());
        break;

      case "26":
        if (aktuell) {
          const roh = zeile.slice(2, 72).replace(/\s+$/, "");
          // Langtextzeilen tragen drei Spalten Einzug — der gehört nicht zum Text.
          aktuell._lang.push(roh.startsWith("   ") ? roh.slice(3) : roh);
        }
        break;

      case "79":
        // STLB-Bau-Verweis der Position: „VJ 2020 VM 10 LB 003 TLG 1262" ist die
        // Leistungsbereich-/Teilleistungs-Kennung, die folgenden „BM … BMI … AP …"
        // sind die gewählten Baumaße. Der Python-Upstream hat diese Zeilen ignoriert —
        // sie sind aber genau die Brücke zum STLB-Katalog und damit zu belegten
        // Referenzpreisen. Die verglichenen Felder verändert das nicht.
        if (aktuell) {
          const inhalt = zeile.slice(2, 72).trim();
          const stlb = (aktuell.stlb ||= { kennung: null, baumasse: [], roh: [] });
          stlb.roh.push(inhalt);
          const tl = /VJ\s+(\d+)\s+VM\s+(\d+)\s+LB\s+(\d+)\s+TLG\s+(\d+)/.exec(inhalt);
          if (tl) {
            stlb.kennung = { vj: tl[1], vm: tl[2], lb: tl[3], tlg: tl[4] };
          } else {
            const bm = /BM\s+(\d+)\s+BMI\s+(\d+)\s+AP\s+(\d+)/.exec(inhalt);
            if (bm) stlb.baumasse.push({ bm: bm[1], bmi: bm[2], ap: bm[3] });
          }
        }
        break;

      case "20":
        abschliessen();
        break;

      case "99": {
        abschliessen();
        // Das Dateiende trägt Positions- und Zeilenzahl — eine eingebaute Prüfsumme,
        // die der Python-Upstream nicht ausgewertet hat. Genau die nutzen wir.
        const p = zeile.slice(69, 74).trim();
        const z = zeile.slice(74, 80).trim();
        positionenLautDatei = /^\d+$/.test(p) ? Number.parseInt(p, 10) : null;
        zeilenLautDatei = /^\d+$/.test(z) ? Number.parseInt(z, 10) : null;
        break;
      }

      case "00":
      case "T0":
      case "T9":
        break;

      default:
        if (!(art in SATZARTEN)) {
          const key = `unbekannt:${art}`;
          satzarten[key] = (satzarten[key] || 0) + 1;
          if (warnungen.length < 50) {
            warnungen.push(`Unbekannte Satzart ${JSON.stringify(art)} — Zeile übersprungen.`);
          }
        }
        break;
    }
  }
  abschliessen();

  const pruefung = {
    positionen_laut_datei: positionenLautDatei,
    zeilen_laut_datei: zeilenLautDatei,
    positionen_gelesen: positionen.length,
    zeilen_gelesen: zeilen.length,
    stimmig:
      positionenLautDatei === positionen.length && zeilenLautDatei === zeilen.length,
  };
  if (positionenLautDatei != null && positionenLautDatei !== positionen.length) {
    warnungen.push(
      `Die Datei nennt ${positionenLautDatei} Positionen, gelesen wurden ${positionen.length}.`,
    );
  }

  return {
    lv_name,
    lv_datum,
    projekt,
    auftraggeber,
    waehrung,
    positionen,
    vorbemerkung: vorbemerkung.join("\n").replace(/\s+$/, ""),
    pruefung,
    satzarten,
    warnungen,
  };
}

/**
 * Erkennt anhand des Datei-Inhalts, ob es ein GAEB-90-Satzformat ist.
 * Nicht an der Endung: eine falsch benannte Datei soll nicht falsch geparst werden.
 */
export function istGaeb90(daten) {
  try {
    const bytes = daten instanceof Uint8Array ? daten : new Uint8Array(daten);
    const kopf = decodeCp437(bytes.slice(0, 240));
    const zeilen = kopf.split(/\r\n|\n/);
    return zeilen.length > 1 && zeilen[0].length === 80 && /^(00|T0)/.test(zeilen[0]);
  } catch {
    return false;
  }
}

/** Endungen, die der Datei-Dialog anbieten muss. */
export const GAEB90_ENDUNGEN = [".d81", ".d83", ".d84", ".p83", ".x83"];
