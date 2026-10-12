// Phase 82 (82-01): iCalendar export (@core/lib/kalender/ics.js) — frame,
// all-day and timed events, folding at 75 octets, escaping, CRLF, UID, and
// absences never written (D-P82-41).
//
// In:  ics.js. Out: assertions only (also run under TZ=UTC).

import { test } from "node:test";
import assert from "node:assert/strict";
import { alsIcs } from "@core/lib/kalender/ics.js";

const basis = { quelle: "manuell", art: "frist_manuell", klasse: "frist", project_id: null, modul: "fristen", ziel: "/Deadlines" };
const JETZT = "2026-09-28T06:30:00.000Z";

test("Rahmen, ganztägig mit exklusivem Ende, mit Uhrzeit lokal ohne Z, UID, CRLF", () => {
  const text = alsIcs([
    { ...basis, id: "manuell:te-1", datum: "2026-10-14", objekt: "Bauantrag" },
    { ...basis, id: "manuell:te-2:2026-09-29", datum: "2026-09-29", zeit: "10:00", objekt: "Jour fixe" },
  ], { jetzt: JETZT, titel: (t) => t.objekt });
  const zeilen = text.split("\r\n");
  assert.equal(zeilen[0], "BEGIN:VCALENDAR");
  assert.ok(zeilen.includes("VERSION:2.0"));
  assert.ok(zeilen.some((z) => z.startsWith("PRODID:")));
  assert.ok(zeilen.includes("DTSTART;VALUE=DATE:20261014"));
  assert.ok(zeilen.includes("DTEND;VALUE=DATE:20261015"));
  assert.ok(zeilen.includes("DTSTART:20260929T100000"));
  assert.ok(zeilen.includes("DTEND:20260929T110000"));
  assert.ok(zeilen.includes("UID:manuell:te-1@bit-atelier"));
  assert.ok(zeilen.includes("DTSTAMP:20260928T063000Z"));
  assert.ok(text.endsWith("END:VCALENDAR\r\n"));
  assert.ok(!/[^\r]\n/.test(text), "only CRLF line breaks");
});

test("Faltung nach Oktetten (Umlaute), Escaping; Abwesenheiten nie", () => {
  const lang = "Übergabe Ölheizung Größe ä ö ü ".repeat(4).slice(0, 100);
  const text = alsIcs([
    { ...basis, id: "a", datum: "2026-10-01", objekt: lang },
    { ...basis, id: "b", datum: "2026-10-02", objekt: "A, B; C\\D\nE" },
    { ...basis, id: "abw", quelle: "abwesenheit", datum: "2026-10-03", objekt: "Urlaub" },
  ], { jetzt: JETZT, titel: (t) => t.objekt });
  const enc = new TextEncoder();
  for (const z of text.split("\r\n")) assert.ok(enc.encode(z).length <= 75, `Zeile zu lang: ${z}`);
  assert.ok(text.includes("\r\n "), "continuation line starts with a space");
  const entfaltet = text.replace(/\r\n /g, "");
  assert.ok(entfaltet.includes(`SUMMARY:${lang}`));
  assert.ok(entfaltet.includes("SUMMARY:A\\, B\\; C\\\\D\\nE"));
  assert.ok(!text.includes("abw@bit-atelier"));
  assert.ok(!text.includes("Urlaub"));
});
