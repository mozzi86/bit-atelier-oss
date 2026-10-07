// Unit tests of the tab registry of /Accounting (79-01 T8, E-01): unique English
// keys, one literal <TabsContent value="…"> per key in the page, every German
// alias resolves through waehleTab, default = year clock, lucide icons exist,
// the cloud lock (E-03) of the storage layer.
//
// In:  src/lib/accounting/reiter.js, src/pages/Accounting.jsx (as TEXT), lucide-react.
// Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as lucide from "lucide-react";
import { BUCHHALTUNG_REITER, REITER_ALIAS, REITER_SCHLUESSEL, STANDARD_REITER } from "@/lib/accounting/reiter.js";
import { waehleTab } from "@core/lib/tabParam.js";
import { verfuegbar } from "@/lib/accounting/speicher.js";

const SEITE = fs.readFileSync(new URL("../../src/pages/Accounting.jsx", import.meta.url), "utf8");

test("neun Reiter in fester Reihenfolge, Schlüssel eindeutig, Standard = Jahresuhr", () => {
  assert.deepEqual([...REITER_SCHLUESSEL], ["invoices", "expenses", "liquidity", "vat", "drawings", "bank", "fleet", "assets", "annual"]);
  assert.deepEqual(BUCHHALTUNG_REITER.map((r) => r.label), [
    "Ausgangsrechnungen", "Eingangsrechnungen", "Jahresuhr", "Umsatzsteuer", "Entnahmen", "Bank-Abgleich", "Fuhrpark", "Anlagen", "Jahresübersicht",
  ]);
  assert.equal(new Set(REITER_SCHLUESSEL).size, REITER_SCHLUESSEL.length);
  assert.equal(STANDARD_REITER, "liquidity");
  assert.ok(REITER_SCHLUESSEL.includes(STANDARD_REITER));
  assert.ok(Object.isFrozen(BUCHHALTUNG_REITER) && Object.isFrozen(BUCHHALTUNG_REITER[0]));
});

test("jeder Schlüssel hat ein literales <TabsContent value=…> in Accounting.jsx, keiner mehr", () => {
  const inhalte = [...SEITE.matchAll(/<TabsContent value="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(inhalte, [...REITER_SCHLUESSEL]);
  assert.match(SEITE, /activationMode="manual"/);
  assert.match(SEITE, /useTabParam\(REITER_SCHLUESSEL, STANDARD_REITER, \{ alias: REITER_ALIAS \}\)/);
});

test("jeder Alias löst über waehleTab auf seinen Schlüssel auf; Unbekanntes auf die Jahresuhr", () => {
  for (const r of BUCHHALTUNG_REITER) {
    for (const a of r.alias) assert.equal(waehleTab(a, REITER_SCHLUESSEL, STANDARD_REITER, REITER_ALIAS), r.key, a);
    assert.equal(waehleTab(r.key.toUpperCase(), REITER_SCHLUESSEL, STANDARD_REITER, REITER_ALIAS), r.key);
  }
  assert.equal(REITER_ALIAS.ausgang, "invoices", "Name, den Phase 81 erwartet");
  assert.equal(REITER_ALIAS.jahresuhr, "liquidity");
  assert.equal(REITER_ALIAS.ust, "vat");
  assert.equal(waehleTab("xyz", REITER_SCHLUESSEL, STANDARD_REITER, REITER_ALIAS), "liquidity");
  assert.equal(waehleTab(null, REITER_SCHLUESSEL, STANDARD_REITER, REITER_ALIAS), "liquidity");
});

test("jedes Icon ist ein Export von lucide-react und in der Seite eingebunden", () => {
  for (const r of BUCHHALTUNG_REITER) {
    assert.ok(lucide[r.icon], `${r.icon} ist kein lucide-Export`);
    assert.match(SEITE, new RegExp(`\\b${r.icon}\\b`), `${r.icon} fehlt in Accounting.jsx`);
  }
});

test("Cloud-Sperre: verfuegbar('supabase') === false ohne E-20-Freigabe", () => {
  assert.equal(verfuegbar("supabase", false), false);
  assert.equal(verfuegbar("serverlos"), true);
});

test("die Seite verlinkt die Ziele ihrer Weiter-mit-Leiste nicht selbst", () => {
  for (const ziel of ["/ComplexDesigner?tab=planner", "/Finance", "/Reports"]) assert.equal(SEITE.includes(ziel), false, ziel);
});
