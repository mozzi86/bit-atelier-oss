// ics.js — terms as an iCalendar file (RFC 5545) for Outlook and phone
// calendars (82-01, FRIST-01). The app reminds only while it is open; the
// .ics export is the honest way to get a reminder anywhere else.
//
// Absences are never written: the file leaves the app and may be forwarded,
// and an absence is personnel data (D-P82-41, E-14).
//
// Pure: the caller passes "now" and a title function (the translated title),
// so this module needs no clock and no dictionary.
//
// In:  terms (termin.js shape), {jetzt, titel}. Out: alsIcs → text with CRLF.

import { parseTag, plusTage } from "./datum.js";

/** Default length of a term with a start time, minutes [ASSUMED: one hour, no end time is stored]. */
const STANDARD_DAUER_MIN = 60;

/** Maximum line length in octets before folding (RFC 5545 § 3.1). */
const ZEILE_OKTETTE = 75;

/**
 * Escapes TEXT values (RFC 5545 § 3.3.11): backslash, semicolon, comma, newline.
 * @param {string} text
 * @returns {string}
 */
function escape(text) {
  return String(text ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/**
 * Folds one content line at 75 octets (UTF-8), never inside a character;
 * continuation lines start with one space, which counts towards their 75.
 * @param {string} zeile
 * @returns {string} with CRLF + space between the parts
 */
function falte(zeile) {
  const enc = new TextEncoder();
  const teile = [];
  let aktuell = "";
  let laenge = 0;
  for (const zeichen of zeile) {
    const n = enc.encode(zeichen).length;
    const grenze = teile.length === 0 ? ZEILE_OKTETTE : ZEILE_OKTETTE - 1;
    if (laenge + n > grenze) {
      teile.push(aktuell);
      aktuell = "";
      laenge = 0;
    }
    aktuell += zeichen;
    laenge += n;
  }
  teile.push(aktuell);
  return teile.join("\r\n ");
}

/** @param {string} tagIso 'YYYY-MM-DD' @returns {string} 'YYYYMMDD' */
const kompakt = (tagIso) => tagIso.replace(/-/g, "");

/**
 * UTC stamp 'YYYYMMDDTHHMMSSZ' of "now".
 * @param {Date|string|number} jetzt
 * @returns {string}
 */
function stempel(jetzt) {
  const d = jetzt instanceof Date ? jetzt : new Date(jetzt);
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/**
 * Local date-time 'YYYYMMDDTHHMMSS' (floating, no Z: the term is meant in the
 * office's local time) plus minutes, rolling over midnight.
 * @param {string} tagIso
 * @param {string} zeit 'HH:MM'
 * @param {number} plusMin minutes
 * @returns {string}
 */
function lokal(tagIso, zeit, plusMin = 0) {
  const [h, m] = zeit.split(":").map(Number);
  const gesamt = h * 60 + m + plusMin;
  const tage = Math.floor(gesamt / 1440);
  const rest = gesamt - tage * 1440;
  const tag = /** @type {string} */ (plusTage(tagIso, tage));
  return `${kompakt(tag)}T${String(Math.floor(rest / 60)).padStart(2, "0")}${String(rest % 60).padStart(2, "0")}00`;
}

/**
 * The terms as an iCalendar text (VCALENDAR with one VEVENT each).
 * All-day terms: DTSTART;VALUE=DATE and an exclusive DTEND the day after the
 * last day. Terms with a time: local start, end = start + dauer_min (default 60).
 * @param {ReadonlyArray<import("./termin.js").Termin>} termine
 * @param {{jetzt: Date|string|number, titel: (termin: import("./termin.js").Termin) => string}} optionen
 * @returns {string} RFC 5545 text, lines separated by CRLF, ending with CRLF
 */
export function alsIcs(termine, { jetzt, titel }) {
  const dtstamp = stempel(jetzt);
  const zeilen = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//BIT-Atelier//Fristen und Termine//DE", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for (const t of termine || []) {
    if (!t || t.quelle === "abwesenheit" || !parseTag(t.datum)) continue;
    zeilen.push("BEGIN:VEVENT", `UID:${t.id}@bit-atelier`, `DTSTAMP:${dtstamp}`);
    if (t.zeit && /^\d{2}:\d{2}$/.test(t.zeit)) {
      zeilen.push(`DTSTART:${lokal(t.datum, t.zeit)}`, `DTEND:${lokal(t.datum, t.zeit, Number(t.dauer_min) || STANDARD_DAUER_MIN)}`);
    } else {
      const letzter = parseTag(t.bis) || t.datum;
      zeilen.push(`DTSTART;VALUE=DATE:${kompakt(t.datum)}`, `DTEND;VALUE=DATE:${kompakt(/** @type {string} */ (plusTage(letzter, 1)))}`);
    }
    zeilen.push(`SUMMARY:${escape(titel ? titel(t) : t.objekt)}`);
    zeilen.push("END:VEVENT");
  }
  zeilen.push("END:VCALENDAR");
  return zeilen.map(falte).join("\r\n") + "\r\n";
}
