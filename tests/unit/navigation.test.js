// Guard test for the app navigation (72-08, N-02).
//
// src/navigation.js feeds the sidebar, the command palette and the page titles,
// so a drift between menu, routes and dictionary shows up as a dead menu entry,
// an unreachable page or a German word in the English UI. This test imports the
// list directly and reads App.jsx and i18n.jsx as TEXT (same approach as
// designer-navigation.test.js): no React, no DOM.
//
// In:  navGroups/navFlach + the two source files. Out: assertions, no side effects.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { navGroups, navFlach, navSichtbar, seitenBreite } from "@/navigation.js";

const APP = new URL("../../src/App.jsx", import.meta.url);
const I18N = new URL("../../packages/nova-core/src/lib/i18n.jsx", import.meta.url);

/**
 * Routes of the protected app (the <Routes> inside HauptApp). The legal pages
 * further down are a separate block and not part of the menu.
 * @returns {{path: string, umleitung: boolean}[]}
 */
function routenAusApp() {
  const quelle = fs.readFileSync(APP, "utf8");
  const start = quelle.indexOf("const HauptApp");
  assert.ok(start >= 0, "HauptApp nicht gefunden in App.jsx");
  const ende = quelle.indexOf("</Routes>", start);
  const block = quelle.slice(start, ende);
  return [...block.matchAll(/<Route\s+path="([^"]+)"\s+element=\{\s*(<\w+)/g)].map((m) => ({
    path: m[1],
    // UmleitungMitSuche (App.jsx, 79-01) is a <Navigate> that keeps the query.
    umleitung: m[2] === "<Navigate" || m[2] === "<UmleitungMitSuche",
  }));
}

/** @returns {Set<string>} every key of DICT.en in i18n.jsx */
function englischeSchluessel() {
  const quelle = fs.readFileSync(I18N, "utf8");
  const start = quelle.indexOf("en: {");
  const ende = quelle.indexOf("\n};", start);
  assert.ok(start >= 0 && ende > start, "DICT.en nicht gefunden in i18n.jsx");
  const block = quelle.slice(start, ende);
  return new Set([...block.matchAll(/^\s*"((?:[^"\\]|\\.)*)"\s*:/gm)].map((m) => m[1]));
}

const LABOR = navGroups.find((g) => g.collapsible);

test("navigation.js lädt unter node, navFlach ist die flache Summe der Gruppen", () => {
  const summe = navGroups.reduce((n, g) => n + g.items.length, 0);
  assert.equal(navFlach.length, summe);
  for (const e of navFlach) {
    assert.match(e.url, /^\/[A-Za-z]+$/, `${e.title}: URL ${e.url} ist kein einfacher Seitenpfad`);
    assert.ok(navGroups.some((g) => g.label === e.gruppe), `${e.title}: Gruppe ${e.gruppe} unbekannt`);
  }
});

test("jede Menü-URL hat eine Route in App.jsx", () => {
  const pfade = new Set(routenAusApp().map((r) => r.path));
  const ohneRoute = navFlach.filter((e) => !pfade.has(e.url)).map((e) => e.url);
  assert.deepEqual(ohneRoute, [], "Menüeinträge ohne <Route path>");
});

test("jede Route außer /, * und Umleitungen steht im Menü", () => {
  const routen = routenAusApp();
  assert.ok(routen.length >= 20, `nur ${routen.length} Routen gelesen — Parser prüfen`);
  const menue = new Set(navFlach.map((e) => e.url));
  const ohneMenue = routen
    .filter((r) => r.path !== "/" && r.path !== "*" && !r.umleitung)
    .filter((r) => !menue.has(r.path))
    .map((r) => r.path);
  assert.deepEqual(ohneMenue, [], "Routen ohne Menüeintrag");
  // Redirects: /EnergyAnalysis → designer tab "Energie"; /Buchhaltung → /Accounting
  // with the query kept (German route alias, E-01).
  assert.ok(routen.some((r) => r.path === "/EnergyAnalysis" && r.umleitung));
  assert.ok(routen.some((r) => r.path === "/Buchhaltung" && r.umleitung), "/Buchhaltung ist keine Umleitung");
  // 80-01 (E-01): the German aliases of /People and /Settings keep the query too.
  assert.ok(routen.some((r) => r.path === "/Personal" && r.umleitung), "/Personal ist keine Umleitung");
  assert.ok(routen.some((r) => r.path === "/Einstellungen" && r.umleitung), "/Einstellungen ist keine Umleitung");
  const quelle = fs.readFileSync(APP, "utf8");
  assert.equal((quelle.match(/<Navigate to="\/(People|Settings)"/g) || []).length, 0, "schlichtes <Navigate> verliert ?tab — UmleitungMitSuche nutzen");
});

test("jeder Titel und jedes Gruppenlabel hat einen englischen Wörterbucheintrag", () => {
  const en = englischeSchluessel();
  const fehlt = [...navGroups.map((g) => g.label), ...navFlach.map((e) => e.title)].filter((k) => !en.has(k));
  assert.deepEqual(fehlt, [], "Schlüssel fehlen in DICT.en");
});

test("kein Titel trägt das Präfix „BIT“", () => {
  const mitPraefix = navFlach.filter((e) => /^BIT\b/.test(e.title)).map((e) => e.title);
  assert.deepEqual(mitPraefix, []);
});

test("Titel sind eindeutig", () => {
  const titel = navFlach.map((e) => e.title);
  assert.equal(new Set(titel).size, titel.length, "doppelter Titel");
});

test("Icons außerhalb des Labors sind eindeutig", () => {
  const kern = navGroups.filter((g) => !g.collapsible).flatMap((g) => g.items);
  for (const e of kern) assert.ok(e.icon, `${e.title}: icon fehlt`);
  const doppelt = kern.filter((e, i) => kern.findIndex((x) => x.icon === e.icon) !== i).map((e) => e.title);
  assert.deepEqual(doppelt, [], "Icon mehrfach vergeben");
});

test("projektfrei und umfang nur an existierenden Routen und mit gültigem Wert", () => {
  const pfade = new Set(routenAusApp().map((r) => r.path));
  // 80-01: "zugang" joins the allowed fields (personnel gate, see the check below).
  // 75-16: "breite" marks drawing pages (one width rule in the shell).
  const erlaubt = new Set(["title", "url", "icon", "labor", "projektfrei", "umfang", "zugang", "breite"]);
  for (const g of navGroups) {
    for (const e of g.items) {
      for (const feld of Object.keys(e)) assert.ok(erlaubt.has(feld), `${e.title}: unbekanntes Feld ${feld}`);
      if ("projektfrei" in e) {
        assert.equal(e.projektfrei, true, `${e.title}: projektfrei muss true sein`);
        assert.ok(pfade.has(e.url), `${e.title}: projektfrei an ${e.url} ohne Route`);
      }
      if ("umfang" in e) {
        assert.equal(e.umfang, "portfolio", `${e.title}: umfang muss 'portfolio' sein`);
        assert.ok(pfade.has(e.url), `${e.title}: umfang an ${e.url} ohne Route`);
      }
      if ("zugang" in e) {
        assert.equal(e.zugang, "personal", `${e.title}: zugang muss 'personal' sein`);
        assert.equal(e.url, "/People", `${e.title}: zugang nur am Personal-Eintrag`);
      }
      if ("breite" in e) {
        assert.equal(e.breite, "voll", `${e.title}: breite muss 'voll' sein`);
        assert.ok(pfade.has(e.url), `${e.title}: breite an ${e.url} ohne Route`);
      }
    }
  }
  // 80-01: Büro-Gruppe vervollständigt (E-02) — Personal and Einstellungen work without a project.
  const projektfrei = navFlach.filter((e) => e.projektfrei).map((e) => e.url).sort();
  assert.deepEqual(projektfrei, ["/Accounting", "/AddressBook", "/BitAegis", "/IfcViewer", "/ModelCheck", "/People", "/Settings", "/SketchStudio"]);
  // 75-16: the drawing pages that lift the 1280 px page cap.
  const voll = navFlach.filter((e) => e.breite === "voll").map((e) => e.url).sort();
  assert.deepEqual(voll, ["/BimViewer", "/ComplexDesigner", "/ModelCheck", "/SiteControl"]);
  const portfolio = navFlach.filter((e) => e.umfang === "portfolio").map((e) => e.url).sort();
  assert.deepEqual(portfolio, ["/AIDashboard", "/Accounting", "/AtelierDeveloper", "/Dashboard", "/InvestmentPlatform"]);
});

test("verbindliche Namenstabelle: Gruppen, Reihenfolge und Titel je Route", () => {
  // Lane B sets its h1 from this table; a rename here must be deliberate.
  const tabelle = navGroups.map((g) => [g.label, g.items.map((e) => [e.url, e.title])]);
  assert.deepEqual(tabelle, [
    ["Übersicht", [
      ["/Dashboard", "Projektübersicht"],
      ["/Projects", "Projekte"],
      ["/Reports", "Berichte & Dokumente"],
    ]],
    ["Planung", [
      ["/RealEstateFeasibility", "Machbarkeit"],
      ["/ComplexDesigner", "Komplex-Designer"],
    ]],
    ["Modell & Prüfung", [
      ["/ModelCheck", "Prüf-Suite"],
      ["/BimViewer", "BIM-Viewer & Tickets"],
      ["/IfcViewer", "IFC-Viewer (LV-gekoppelt)"],
      ["/ModelVersions", "Projektstände"],
    ]],
    ["Ausschreibung & Kosten", [
      ["/AVA", "AVA (Ausschreibung)"],
      ["/Finance", "Finanzen & Nachträge"],
    ]],
    ["KI & Analyse", [
      ["/AIDashboard", "KI-Zentrale"],
    ]],
    // E-02 (79-01): the former master-data group, renamed to "Büro" in place.
    // 80-01: Büro-Gruppe vervollständigt (E-02) — Personal and Einstellungen inserted,
    // Adressbuch moved behind Personal (order [ASSUMED], D-P80-02); still 7 groups.
    ["Büro", [
      ["/Accounting", "Buchhaltung"],
      ["/People", "Personal"],
      ["/AddressBook", "Adressbuch"],
      ["/Settings", "Einstellungen"],
    ]],
    ["Labor", [
      ["/SketchStudio", "Constraint-Zeichner"],
      ["/SiteControl", "Baustellen-Leitstand"],
      ["/InvestmentPlatform", "Investment"],
      ["/BitAegis", "PDF & Ablage"],
      ["/AtelierDeveloper", "Portfolio (Projektentwicklung)"],
      ["/KiTool", "KI Tool"],
    ]],
  ]);
  assert.equal(LABOR?.label, "Labor", "genau die Labor-Gruppe ist zuklappbar");
  assert.equal(navGroups.filter((g) => g.collapsible).length, 1);
  assert.equal(navGroups.length, 7, "80-01 legt keine Gruppe an und löst keine auf");
  // The moved address book entry keeps its 79 fields.
  const adressbuch = navFlach.find((e) => e.url === "/AddressBook");
  assert.deepEqual(Object.keys(adressbuch).sort(), ["gruppe", "icon", "projektfrei", "title", "url"]);
});

test("navSichtbar: der Personal-Eintrag nur mit Personal-Zugang, alle anderen immer (80-01, DS-12)", () => {
  const personal = navFlach.find((e) => e.url === "/People");
  assert.ok(personal, "Personal-Eintrag fehlt");
  assert.equal(navSichtbar(personal, { personalZugang: "erlaubt" }), true);
  assert.equal(navSichtbar(personal, { personalZugang: "nur-lokal" }), false);
  assert.equal(navSichtbar(personal, { personalZugang: "keine-berechtigung" }), false);
  assert.equal(navSichtbar(personal, {}), false);
  for (const e of navFlach.filter((x) => x.url !== "/People")) {
    assert.equal(navSichtbar(e, { personalZugang: "nur-lokal" }), true, e.url);
  }
});

/**
 * Page file of every lazily imported route of HauptApp (route → URL), with
 * the Vite aliases resolved like vite.config.js. Wrappers whose h1 lives in
 * the wrapped component are redirected explicitly (H1_IN_ANDERER_DATEI).
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

// PlanSketchStudio (designer) only hosts the sketcher; the heading is the sketcher's.
const H1_IN_ANDERER_DATEI = {
  "/SketchStudio": new URL("../../packages/bit-sketch/src/pages/SketchStudio.jsx", import.meta.url),
};

/**
 * Text of the first <h1> of a page source: the t("…") key, else the literal
 * text; JSX icons inside the heading are dropped.
 * @param {string} quelle page source
 * @returns {string|null} null when the file has no h1
 */
function ersteUeberschrift(quelle) {
  const m = quelle.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  if (!m) return null;
  const inhalt = m[1].replace(/<[A-Za-z][^>]*\/>/g, "");
  const schluessel = inhalt.match(/\{\s*t\(\s*(["'])((?:(?!\1)[^\\]|\\.)*)\1\s*\)\s*\}/);
  if (schluessel) return schluessel[2];
  return inhalt.replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

test("Menüname = erste Überschrift (h1) der Seite", () => {
  // Merge lesson 27.09.: the lanes set h1s from the N-02 name table, but a
  // page outside both lanes (sketcher: "BIT Sketcher (Labor)", check suite:
  // "Prüf-Suite — Kollisionen, IDS & BCF") kept its own name.
  const dateien = seitenDateien();
  const abweichend = [];
  for (const e of navFlach) {
    const datei = H1_IN_ANDERER_DATEI[e.url] ?? dateien.get(e.url);
    assert.ok(datei && fs.existsSync(datei), `${e.url}: Seitendatei nicht gefunden`);
    const h1 = ersteUeberschrift(fs.readFileSync(datei, "utf8"));
    if (h1 !== e.title) abweichend.push(`${e.url}: Menü „${e.title}“, h1 „${h1}“`);
  }
  assert.deepEqual(abweichend, []);
});

test("die h1-Prüfung erkennt Abweichungen (sonst wäre der Test oben wertlos)", () => {
  assert.equal(ersteUeberschrift('<h1 className="x">{t("Prüf-Suite")}</h1>'), "Prüf-Suite");
  assert.equal(ersteUeberschrift("<h1>\n  <Radio className=\"w-6\" /> Baustellen-Leitstand\n</h1>"), "Baustellen-Leitstand");
  assert.equal(ersteUeberschrift("<h1>{t('KI Tool')}</h1>"), "KI Tool");
  assert.equal(ersteUeberschrift("<h1>BIT Sketcher <span>(Labor)</span></h1>"), "BIT Sketcher");
  assert.equal(ersteUeberschrift("<div>keine</div>"), null);
});

test("seitenBreite: Zeichenseiten voll, alle anderen ohne Angabe (75-16)", () => {
  assert.equal(seitenBreite("/ComplexDesigner"), "voll");
  assert.equal(seitenBreite("/BimViewer"), "voll");
  assert.equal(seitenBreite("/Reports"), undefined);
  assert.equal(seitenBreite("/gibt-es-nicht"), undefined);
});
