// Phase 81 (81-01): the three tab registries (/TimeTracking, /Fees, /Controlling)
// against their page files, the alias resolution, the lucide icons, the cloud
// lock of the storage layer and the rule "i18n.jsx is touched by 81-01 only".
//
// In:  the registries, the page sources (as text), lucide-react, the storage
//      layer, i18n.jsx (as text). Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as lucide from "lucide-react";
import { waehleTab } from "@core/lib/tabParam.js";
import { ZEIT_REITER, ZEIT_REITER_ALIAS, ZEIT_REITER_SCHLUESSEL, ZEIT_REITER_STANDARD } from "@/lib/zeit/reiter.js";
import { HONORAR_REITER, HONORAR_REITER_ALIAS, HONORAR_REITER_SCHLUESSEL, HONORAR_REITER_STANDARD } from "@/lib/honorar/reiter.js";
import { CONTROLLING_REITER, CONTROLLING_REITER_ALIAS, CONTROLLING_REITER_SCHLUESSEL, CONTROLLING_REITER_STANDARD } from "@/lib/controlling/reiter.js";
import { verfuegbar } from "@/lib/zeitHonorar/speicher.js";

const SEITEN = [
  { datei: "src/pages/TimeTracking.jsx", reiter: ZEIT_REITER, schluessel: ZEIT_REITER_SCHLUESSEL, alias: ZEIT_REITER_ALIAS, standard: ZEIT_REITER_STANDARD, probe: ["freigabe", "approval"] },
  { datei: "src/pages/Fees.jsx", reiter: HONORAR_REITER, schluessel: HONORAR_REITER_SCHLUESSEL, alias: HONORAR_REITER_ALIAS, standard: HONORAR_REITER_STANDARD, probe: ["vertraege", "contracts"] },
  { datei: "src/pages/Controlling.jsx", reiter: CONTROLLING_REITER, schluessel: CONTROLLING_REITER_SCHLUESSEL, alias: CONTROLLING_REITER_ALIAS, standard: CONTROLLING_REITER_STANDARD, probe: ["kostensaetze", "rates"] },
];

const lies = (rel) => fs.readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");

test("Schlüssel eindeutig, englisch; Standard ist ein Schlüssel; Aliase zeigen auf Schlüssel", () => {
  for (const s of SEITEN) {
    assert.equal(new Set(s.schluessel).size, s.schluessel.length, s.datei);
    for (const k of s.schluessel) assert.match(k, /^[a-z]+$/, `${s.datei}: ${k}`);
    assert.ok(s.schluessel.includes(s.standard), s.datei);
    for (const [a, k] of Object.entries(s.alias)) {
      assert.ok(s.schluessel.includes(k), `${s.datei}: ${a} → ${k}`);
      assert.ok(!s.schluessel.includes(a), `${s.datei}: Alias ${a} ist zugleich Schlüssel`);
    }
  }
});

test("je Schlüssel ein literales <TabsContent value> in der Seitendatei", () => {
  for (const s of SEITEN) {
    const quelle = lies(s.datei);
    for (const k of s.schluessel) assert.ok(quelle.includes(`<TabsContent value="${k}"`), `${s.datei}: <TabsContent value="${k}"> fehlt`);
    const werte = [...quelle.matchAll(/<TabsContent value="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual([...werte].sort(), [...s.schluessel].sort(), `${s.datei}: kein überzähliger Reiter`);
  }
});

test("Aliase lösen über waehleTab auf, Unbekanntes fällt auf den Standard", () => {
  for (const s of SEITEN) {
    assert.equal(waehleTab(s.probe[0], s.schluessel, s.standard, s.alias), s.probe[1], s.datei);
    assert.equal(waehleTab("xyz", s.schluessel, s.standard, s.alias), s.standard, s.datei);
    assert.equal(waehleTab(null, s.schluessel, s.standard, s.alias), s.standard, s.datei);
  }
});

test("jedes Icon der Registries ist ein Export von lucide-react", () => {
  for (const s of SEITEN) for (const r of s.reiter) assert.ok(/** @type {any} */ (lucide)[r.icon], `${s.datei}: ${r.icon}`);
});

test("Cloud-Sperre der Speicherschicht (E-03, mit Freigabe E-20)", () => {
  assert.equal(verfuegbar("supabase", false), false);
  assert.equal(verfuegbar("supabase", true), true);
  assert.equal(verfuegbar("serverlos", false), true);
  assert.equal(verfuegbar("express", false), true);
});

test("i18n.jsx trägt nur den 81-01-Block (Folgepläne schreiben nur ihre Teildatei)", () => {
  const i18n = lies("packages/nova-core/src/lib/i18n.jsx");
  assert.equal((i18n.match(/81-0[2-6]/g) || []).length, 0);
  assert.equal((i18n.match(/Zeit & Honorar 81-01/g) || []).length, 1);
});
