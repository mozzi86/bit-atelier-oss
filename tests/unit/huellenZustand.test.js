// Unit tests for the shell state (72-10, N-05): src/huellenZustand.js.
//
// Covers every branch of huellenZustand (project-free routes, error, loading,
// empty, content), the portfolio scope and the footer office name. Runs the
// real navigation list (navFlach) as input, so a module that loses its
// `projektfrei` flag in src/navigation.js fails here as well.
//
// In: the pure module + navFlach. Out: assertions, no side effects.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  huellenZustand,
  istProjektfreieRoute,
  istPortfolioRoute,
  bueroAnzeige,
  BUERO_RUECKFALL,
  IMMER_ERREICHBAR,
} from "@/huellenZustand.js";
import { navFlach } from "@/navigation.js";

const basis = { loading: false, fehler: null, projektAnzahl: 2, pathname: "/AVA", eintraege: navFlach };

test("inhalt: Projekte geladen, Modul des aktiven Projekts", () => {
  assert.equal(huellenZustand(basis), "inhalt");
});

test("leer: keine Projekte auf einer Projekt-Route", () => {
  assert.equal(huellenZustand({ ...basis, projektAnzahl: 0 }), "leer");
  // A missing count is treated as "no project", never as content.
  assert.equal(huellenZustand({ ...basis, projektAnzahl: undefined }), "leer");
});

test("laden: solange die Projektliste lädt", () => {
  assert.equal(huellenZustand({ ...basis, loading: true, projektAnzahl: 0 }), "laden");
});

test("fehler: Ladefehler schlägt Laden und Leerzustand", () => {
  const fehler = "Failed to fetch";
  assert.equal(huellenZustand({ ...basis, fehler, projektAnzahl: 0 }), "fehler");
  assert.equal(huellenZustand({ ...basis, fehler, loading: true }), "fehler");
  // An empty string is no error message.
  assert.equal(huellenZustand({ ...basis, fehler: "", projektAnzahl: 0 }), "leer");
});

test("/Projects rendert immer, auch bei Fehler, Laden und ohne Projekt", () => {
  for (const zustand of [{ fehler: "x" }, { loading: true }, { projektAnzahl: 0 }]) {
    assert.equal(huellenZustand({ ...basis, ...zustand, pathname: "/Projects" }), "inhalt");
  }
  assert.deepEqual([...IMMER_ERREICHBAR], ["/Projects"]);
});

test("projektfreie Module (navFlach) rendern ohne Projekt und trotz Fehler", () => {
  const frei = navFlach.filter((e) => e.projektfrei).map((e) => e.url);
  assert.ok(frei.includes("/ModelCheck") && frei.includes("/IfcViewer"), `projektfrei: ${frei.join(", ")}`);
  for (const url of frei) {
    assert.equal(huellenZustand({ ...basis, pathname: url, projektAnzahl: 0 }), "inhalt", url);
    assert.equal(huellenZustand({ ...basis, pathname: url, fehler: "x" }), "inhalt", url);
    assert.equal(huellenZustand({ ...basis, pathname: url, loading: true }), "inhalt", url);
  }
});

test("Projekt-Module ohne Flag bleiben gesperrt (AVA, BIM-Viewer, Dashboard, unbekannte Route)", () => {
  for (const url of ["/AVA", "/BimViewer", "/Dashboard", "/", "/GibtEsNicht"]) {
    assert.equal(istProjektfreieRoute(url, navFlach), false, url);
    assert.equal(huellenZustand({ ...basis, pathname: url, projektAnzahl: 0 }), "leer", url);
  }
});

test("Pfadvergleich: Schrägstrich am Ende und Groß-/Kleinschreibung egal", () => {
  assert.equal(istProjektfreieRoute("/ModelCheck/", navFlach), true);
  assert.equal(istProjektfreieRoute("/modelcheck", navFlach), true);
  assert.equal(istProjektfreieRoute("/projects", navFlach), true);
});

test("robust gegen fehlende Eingaben", () => {
  assert.equal(huellenZustand(), "leer");
  assert.equal(huellenZustand({ pathname: "/Projects" }), "inhalt");
  assert.equal(istProjektfreieRoute(undefined, undefined), false);
  assert.equal(istProjektfreieRoute("/ModelCheck", null), false);
});

test("Portfolio-Umfang: Dashboard (auch /) und KI-Zentrale ja, AVA nein", () => {
  assert.equal(istPortfolioRoute("/Dashboard", navFlach), true);
  assert.equal(istPortfolioRoute("/", navFlach), true);
  assert.equal(istPortfolioRoute("/AIDashboard", navFlach), true);
  assert.equal(istPortfolioRoute("/AVA", navFlach), false);
  assert.equal(istPortfolioRoute("/Projects", navFlach), false);
  assert.equal(istPortfolioRoute("/GibtEsNicht", navFlach), false);
});

test("Büro-Anzeige: Name und Initialen, Rückfall BIT-Atelier/BA", () => {
  assert.deepEqual(bueroAnzeige("Büro Test"), { name: "Büro Test", initialen: "BT" });
  assert.deepEqual(bueroAnzeige("  Müller & Partner Architekten "), { name: "Müller & Partner Architekten", initialen: "MP" });
  assert.deepEqual(bueroAnzeige("Planwerk"), { name: "Planwerk", initialen: "P" });
  assert.deepEqual(bueroAnzeige("ärger-büro"), { name: "ärger-büro", initialen: "ÄB" });
  assert.deepEqual(bueroAnzeige("3D Studio"), { name: "3D Studio", initialen: "3S" });
  assert.deepEqual(bueroAnzeige("& 123"), { name: "& 123", initialen: "1" });
  assert.deepEqual(bueroAnzeige("&"), { name: "&", initialen: "&" });
  for (const leer of ["", "   ", null, undefined, 42]) {
    assert.deepEqual(bueroAnzeige(/** @type {any} */ (leer)), { name: "BIT-Atelier", initialen: "BA" }, String(leer));
  }
  // The fallback is consistent with the rule itself.
  assert.deepEqual(bueroAnzeige(BUERO_RUECKFALL.name), BUERO_RUECKFALL);
});
