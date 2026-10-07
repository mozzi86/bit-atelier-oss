// Guard test for the "Weiter mit …" table (72-09, N-03).
//
// A next-step link is only worth something if it lands on a real page and, for
// ?tab=…, on a real tab. So every target is checked against the source of
// truth instead of a copy: the <Route path> list in App.jsx (read as TEXT, same
// parser idea as navigation.test.js), the menu in src/navigation.js, the
// designer tab registry, and the TabsTrigger values in AVA.jsx (also TEXT; Lane
// B's N-16 reads ?tab there and keeps these literals by contract).
//
// In:  NAECHSTE_SCHRITTE + the source files above. Out: assertions only.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { NAECHSTE_SCHRITTE, naechsteSchritteFuer, zielPfad } from "@/naechsteSchritte.js";
import { navGroups, navFlach } from "@/navigation.js";
import { istGueltigerTab } from "@designer/config/designerNavigation.js";
import { REITER_SCHLUESSEL } from "@/lib/accounting/reiter.js";
import { EINSTELLUNGS_REITER } from "@/lib/settings/bereiche.js";
import { PERSONAL_REITER } from "@/lib/people/reiter.js";

const APP = new URL("../../src/App.jsx", import.meta.url);
const AVA = new URL("../../packages/nova-ausschreibung/src/pages/AVA.jsx", import.meta.url);
const MODELCHECK = new URL("../../packages/nova-ifc-viewer/src/pages/ModelCheck.jsx", import.meta.url);
const PROJECTS = new URL("../../src/pages/Projects.jsx", import.meta.url);

/** @returns {Set<string>} every <Route path> of the protected app (HauptApp) */
function routenAusApp() {
  const quelle = fs.readFileSync(APP, "utf8");
  const start = quelle.indexOf("const HauptApp");
  assert.ok(start >= 0, "HauptApp nicht gefunden in App.jsx");
  const block = quelle.slice(start, quelle.indexOf("</Routes>", start));
  return new Set([...block.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]));
}

/** @returns {Set<string>} every <TabsTrigger value="…"> in AVA.jsx */
function avaReiter() {
  const quelle = fs.readFileSync(AVA, "utf8");
  return new Set([...quelle.matchAll(/<TabsTrigger\s+value="([^"]+)"/g)].map((m) => m[1]));
}

const ROUTEN = routenAusApp();
const AVA_REITER = avaReiter();
const MENUE = new Set(navFlach.map((e) => e.url));
const LABOR = new Set(navGroups.find((g) => g.collapsible)?.items.map((e) => e.url) ?? []);

/**
 * Query parameters a target may carry, per target path, and how each value is
 * validated. Anything else is a problem: a parameter no page reads is a promise
 * the link cannot keep.
 * @type {Record<string, Record<string, (wert: string) => boolean>>}
 */
const ERLAUBTE_PARAMETER = {
  "/ComplexDesigner": { tab: (w) => istGueltigerTab(w) },
  "/AVA": { tab: (w) => AVA_REITER.has(w) },
  "/ModelCheck": { beispiel: (w) => w === "1" },
  "/Projects": { neu: (w) => w === "1" },
  // 79-01: the accounting tabs come from their registry (src/lib/accounting/reiter.js).
  "/Accounting": { tab: (w) => REITER_SCHLUESSEL.includes(w) },
  // 80-01: Büro-Gruppe vervollständigt (E-02) — settings areas and personnel tabs from their registries.
  "/Settings": { tab: (w) => EINSTELLUNGS_REITER.includes(w) },
  "/People": { tab: (w) => PERSONAL_REITER.includes(w) },
};

/**
 * All problems of one target — empty when the link is sound.
 * @param {string} ziel e.g. "/AVA?tab=lv"
 * @returns {string[]} human-readable problems
 */
function problemeDesZiels(ziel) {
  const probleme = [];
  const pfad = zielPfad(ziel);
  if (!ROUTEN.has(pfad)) probleme.push(`${ziel}: keine <Route path="${pfad}"> in App.jsx`);
  const query = ziel.includes("?") ? ziel.slice(ziel.indexOf("?") + 1) : "";
  for (const [name, wert] of new URLSearchParams(query)) {
    const pruefer = ERLAUBTE_PARAMETER[pfad]?.[name];
    if (!pruefer) probleme.push(`${ziel}: Parameter ${name} wird von ${pfad} nicht gelesen`);
    else if (!pruefer(wert)) probleme.push(`${ziel}: ${name}=${wert} ist kein gültiger Wert`);
  }
  return probleme;
}

test("Quellen gelesen: Routen, AVA-Reiter und Menü sind nicht leer", () => {
  assert.ok(ROUTEN.size >= 20, `nur ${ROUTEN.size} Routen gelesen — Parser prüfen`);
  // AVA.jsx:801-808 today; the contract with Lane B (N-16) keeps these literals.
  for (const r of ["lv", "mengenregeln", "takeoff", "kostenberechnung", "tender", "prices", "settlement", "control"]) {
    assert.ok(AVA_REITER.has(r), `AVA-Reiter ${r} fehlt in AVA.jsx`);
  }
  assert.ok(LABOR.size > 0, "Labor-Gruppe nicht gefunden");
});

test("jedes Ziel ist eine Route, jeder Reiter und Parameter gültig", () => {
  const probleme = Object.values(NAECHSTE_SCHRITTE).flatMap((liste) => liste.flatMap((s) => problemeDesZiels(s.ziel)));
  assert.deepEqual(probleme, []);
});

test("die Prüfung erkennt kaputte Ziele (sonst wäre der Test oben wertlos)", () => {
  assert.equal(problemeDesZiels("/GibtsNicht").length, 1);
  assert.equal(problemeDesZiels("/AVA?tab=gibtsnicht").length, 1);
  assert.equal(problemeDesZiels("/ComplexDesigner?tab=gibtsnicht").length, 1);
  // The German alias resolves in the page, but the table must use the real key.
  assert.equal(problemeDesZiels("/ComplexDesigner?tab=energie").length, 1);
  assert.equal(problemeDesZiels("/BimViewer?tab=lv").length, 1);
  assert.equal(problemeDesZiels("/ModelCheck?beispiel=2").length, 1);
  assert.deepEqual(problemeDesZiels("/AVA?tab=control"), []);
  assert.deepEqual(problemeDesZiels("/ComplexDesigner?tab=brandschutz"), []);
  // 80-01 (behavior 15): English area keys only; the German alias resolves in the page.
  assert.deepEqual(problemeDesZiels("/Settings?tab=rules"), []);
  assert.equal(problemeDesZiels("/Settings?tab=xyz").length, 1);
  assert.equal(problemeDesZiels("/Settings?tab=regeln").length, 1);
  assert.deepEqual(problemeDesZiels("/People?tab=contracts"), []);
  assert.equal(problemeDesZiels("/People?tab=vertraege").length, 1);
});

test("80-01: Weiter mit für /Settings (1 Schritt) und /People (2 Schritte)", () => {
  assert.equal(NAECHSTE_SCHRITTE["/Settings"].length, 1);
  assert.equal(NAECHSTE_SCHRITTE["/People"].length, 2);
  assert.deepEqual(NAECHSTE_SCHRITTE["/People"].map((s) => s.ziel), ["/Settings?tab=rules", "/Projects"]);
});

test("?beispiel=1 wird von der Prüf-Suite tatsächlich gelesen", () => {
  const quelle = fs.readFileSync(MODELCHECK, "utf8");
  assert.match(quelle, /\.get\("beispiel"\)\s*===\s*"1"/);
});

test("?neu=1 wird von der Projektseite tatsächlich gelesen", () => {
  const quelle = fs.readFileSync(PROJECTS, "utf8");
  assert.match(quelle, /\.get\("neu"\)\s*===\s*"1"/);
});

test("jeder Schlüssel ist eine Menü-Route", () => {
  const fremd = Object.keys(NAECHSTE_SCHRITTE).filter((k) => !MENUE.has(k));
  assert.deepEqual(fremd, []);
});

test("jede Menü-Route außerhalb des Labors hat einen Schlüssel (auch leer)", () => {
  const ohne = navFlach.filter((e) => !LABOR.has(e.url) && !(e.url in NAECHSTE_SCHRITTE)).map((e) => e.url);
  assert.deepEqual(ohne, []);
});

test("höchstens drei Schritte, kein Selbstverweis, keine Doppelung, Text vorhanden", () => {
  for (const [route, liste] of Object.entries(NAECHSTE_SCHRITTE)) {
    assert.ok(liste.length <= 3, `${route}: ${liste.length} Schritte`);
    for (const s of liste) {
      assert.notEqual(zielPfad(s.ziel), route, `${route} verweist auf sich selbst`);
      assert.ok(s.text.trim().length > 0, `${route}: leerer Text`);
    }
    assert.equal(new Set(liste.map((s) => s.ziel)).size, liste.length, `${route}: Ziel doppelt`);
  }
});

test("naechsteSchritteFuer: bekannte, unbekannte und Sonderpfade", () => {
  assert.equal(naechsteSchritteFuer("/ModelCheck").length, 3);
  assert.equal(naechsteSchritteFuer("/ModelCheck")[0].ziel, "/BimViewer");
  assert.equal(naechsteSchritteFuer("/ModelCheck/")[0].ziel, "/BimViewer");
  assert.deepEqual(naechsteSchritteFuer("/Dashboard"), []);
  assert.deepEqual(naechsteSchritteFuer("/"), []);
  assert.deepEqual(naechsteSchritteFuer("/GibtsNicht"), []);
  // Inherited object keys must not leak in as "steps".
  assert.deepEqual(naechsteSchritteFuer("constructor"), []);
  // /AVA?tab=control is the finance head's own first link (72-14), not a bar step.
  assert.deepEqual(naechsteSchritteFuer("/Finance").map((s) => s.ziel), ["/AVA?tab=settlement", "/BimViewer", "/Reports"]);
});

/**
 * Page file of every lazily imported route in App.jsx (route → absolute path).
 * Resolves the Vite aliases the same way vite.config.js does.
 * @returns {Map<string, URL>}
 */
function seitenDateien() {
  const quelle = fs.readFileSync(APP, "utf8");
  const ALIAS = {
    "./": "../../src/",
    "@core/": "../../packages/nova-core/src/",
    "@ifc/": "../../packages/nova-ifc-viewer/src/",
    "@ava/": "../../packages/nova-ausschreibung/src/",
    "@pdf/": "../../packages/nova-pdf/src/",
    "@designer/": "../../packages/nova-designer/src/",
  };
  const module = new Map();
  for (const m of quelle.matchAll(/const (\w+) = React\.lazy\(\(\) => import\('([^']+)'\)\)/g)) {
    const praefix = Object.keys(ALIAS).find((p) => m[2].startsWith(p));
    if (praefix) module.set(m[1], new URL(ALIAS[praefix] + m[2].slice(praefix.length) + ".jsx", import.meta.url));
  }
  const dateien = new Map();
  for (const m of quelle.matchAll(/<Route\s+path="([^"]+)"\s+element=\{\s*<(\w+)/g)) {
    if (module.has(m[2])) dateien.set(m[1], module.get(m[2]));
  }
  return dateien;
}

test("die Leiste wiederholt keinen Link, den die Seite selbst schon anbietet", () => {
  // Merge lesson 27.09.: lane A's bar and lane B's page heads both linked
  // /IfcViewer from the BIM viewer and /AVA?tab=control from finance — two
  // identical links on one page, and the lane B proofs broke on the double.
  const dateien = seitenDateien();
  assert.ok(dateien.size >= 15, `nur ${dateien.size} Seitendateien aufgelöst — Parser prüfen`);
  const doppelt = [];
  for (const [route, liste] of Object.entries(NAECHSTE_SCHRITTE)) {
    const datei = dateien.get(route);
    if (!datei || !fs.existsSync(datei)) continue;
    const quelle = fs.readFileSync(datei, "utf8");
    const eigene = new Set([...quelle.matchAll(/<Link\s+to="([^"]+)"/g)].map((m) => m[1]));
    for (const s of liste) if (eigene.has(s.ziel)) doppelt.push(`${route} → ${s.ziel}`);
  }
  assert.deepEqual(doppelt, [], "Schritte, die die Seite schon selbst verlinkt");
});

test("zielPfad schneidet Query und Hash ab", () => {
  assert.equal(zielPfad("/AVA?tab=lv"), "/AVA");
  assert.equal(zielPfad("/Reports"), "/Reports");
  assert.equal(zielPfad("/ModelCheck#oben"), "/ModelCheck");
});
