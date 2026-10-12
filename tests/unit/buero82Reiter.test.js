// Phase 82 (82-01): the three tab registries (/Deadlines, /Absences,
// /Correspondence) against their page files, the alias resolution, the lucide
// icons, and the honesty sentence about reminders on the deadline page.
//
// In:  the registries, the page sources (as text), lucide-react. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as lucide from "lucide-react";
import { waehleTab } from "@core/lib/tabParam.js";
import * as fristen from "@/lib/termine/reiter.js";
import * as abwesenheit from "@/lib/abwesenheit/reiter.js";
import * as schrift from "@/lib/schriftverkehr/reiter.js";

const SEITEN = [
  { datei: "src/pages/Deadlines.jsx", reiter: fristen.FRISTEN_REITER, m: fristen, probe: ["monat", "month"], schluessel: ["agenda", "month", "warranty"] },
  { datei: "src/pages/Absences.jsx", reiter: abwesenheit.ABWESENHEIT_REITER, m: abwesenheit, probe: ["konto", "balance"], schluessel: ["team", "requests", "balance", "holidays"] },
  { datei: "src/pages/Correspondence.jsx", reiter: schrift.SCHRIFT_REITER, m: schrift, probe: ["postbuch", "register"], schluessel: ["letters", "register", "templates"] },
];

const lies = (rel) => fs.readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");

test("Schlüssel wie E-01 festgelegt, eindeutig, englisch; Standard ist der erste; Aliase zeigen auf Schlüssel", () => {
  for (const s of SEITEN) {
    assert.deepEqual([...s.m.REITER_SCHLUESSEL], s.schluessel, s.datei);
    assert.equal(s.m.STANDARD_REITER, s.schluessel[0], s.datei);
    for (const [a, k] of Object.entries(s.m.REITER_ALIAS)) {
      assert.ok(s.schluessel.includes(k), `${s.datei}: ${a} → ${k}`);
      assert.ok(!s.schluessel.includes(a), `${s.datei}: Alias ${a} ist zugleich Schlüssel`);
    }
  }
});

test("je Schlüssel ein literales <TabsContent value> in der Seitendatei, kein überzähliger", () => {
  for (const s of SEITEN) {
    const quelle = lies(s.datei);
    const werte = [...quelle.matchAll(/<TabsContent value="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual([...werte].sort(), [...s.schluessel].sort(), s.datei);
  }
});

test("Aliase lösen über waehleTab auf, Unbekanntes fällt auf den Standard; Icons sind lucide-Exporte", () => {
  for (const s of SEITEN) {
    assert.equal(waehleTab(s.probe[0], s.m.REITER_SCHLUESSEL, s.m.STANDARD_REITER, s.m.REITER_ALIAS), s.probe[1], s.datei);
    assert.equal(waehleTab("xyz", s.m.REITER_SCHLUESSEL, s.m.STANDARD_REITER, s.m.REITER_ALIAS), s.m.STANDARD_REITER, s.datei);
    for (const r of s.reiter) assert.ok(/** @type {any} */ (lucide)[r.icon], `${s.datei}: ${r.icon}`);
  }
});

test("Ehrlichkeit: Erinnerungen nur bei geöffneter App (Fristen); Abwesenheiten und Schriftverkehr zeigen die Cloud-Karte selbst", () => {
  assert.match(lies("src/pages/Deadlines.jsx"), /Erinnerungen erscheinen nur bei geöffneter App – für Outlook als \.ics exportieren\./);
  for (const d of ["src/pages/Absences.jsx", "src/pages/Correspondence.jsx"]) assert.match(lies(d), /cloudGesperrt\(/, d);
});
