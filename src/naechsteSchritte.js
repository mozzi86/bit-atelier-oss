// "Weiter mit …": the next steps each page offers at its end (72-09, N-03).
//
// Before this table the core modules were dead ends: AVA, both viewers, the
// check suite, project stages, reports and feasibility linked to no other
// module. One table plus one bar that Layout.jsx puts under every page closes
// all of them at once, including pages whose own files must not be touched
// (the check suite and the designer are maintained by Hermes).
//
// In:  nothing — deliberately import-free, so the unit test and the node
//      alias loader can read it without React or lucide.
// Out: NAECHSTE_SCHRITTE (route → at most three steps) and
//      naechsteSchritteFuer(pathname).
//
// `text` is the German source string; the bar passes it through t(). `ziel` is
// a router path, optionally with a query (?tab=… is resolved by the target
// page; a page that does not read it yet lands on its default tab, which is
// still the right module). tests/unit/naechsteSchritte.test.js checks every
// target against the routes in App.jsx, the designer tab registry and the
// TabsTrigger values in AVA.jsx.

/**
 * One offered next step.
 * @typedef {{ text: string, ziel: string }} NaechsterSchritt
 */

/**
 * Menu route (exact pathname, no query) → next steps, at most three, never
 * pointing back at the route itself. Every non-Labor menu route has a key; an
 * empty list means "this page is the hub" (the overview links everywhere).
 * @type {Readonly<Record<string, ReadonlyArray<NaechsterSchritt>>>}
 */
export const NAECHSTE_SCHRITTE = Object.freeze({
  "/Dashboard": [],
  "/Projects": [
    { text: "Projekt im Entwurf öffnen", ziel: "/ComplexDesigner?tab=site" },
    { text: "Musterprojekt prüfen", ziel: "/ModelCheck?beispiel=1" },
  ],
  "/Reports": [
    { text: "Prüfbericht in der Prüf-Suite", ziel: "/ModelCheck" },
    { text: "Kostenkontrolle", ziel: "/AVA?tab=control" },
    { text: "Brandschutz-Nachweis", ziel: "/ComplexDesigner?tab=brandschutz" },
  ],
  // The page's own sample banner already links the site tab ("Eigenes
  // Grundstück im Komplex-Designer erfassen", 72-16 N-17); the bar offers the
  // step after the sample instead: a project of one's own.
  "/RealEstateFeasibility": [
    { text: "Neues Projekt anlegen", ziel: "/Projects?neu=1" },
  ],
  "/ComplexDesigner": [
    { text: "Modell prüfen", ziel: "/ModelCheck" },
    { text: "Kosten in der AVA", ziel: "/AVA?tab=kostenberechnung" },
    { text: "Bericht erzeugen", ziel: "/Reports" },
  ],
  "/ModelCheck": [
    { text: "Tickets im BIM-Viewer verfolgen", ziel: "/BimViewer" },
    { text: "Mengen in die AVA", ziel: "/AVA?tab=takeoff" },
    { text: "Berichte & Dokumente", ziel: "/Reports" },
  ],
  // No "Im IFC-Viewer ansehen" here: the BIM viewer's own head already links
  // /IfcViewer under that name (72-13, N-10) — the bar must not repeat it.
  "/BimViewer": [
    { text: "Nachträge entscheiden", ziel: "/Finance" },
    { text: "Modell prüfen", ziel: "/ModelCheck" },
    { text: "Bericht erzeugen", ziel: "/Reports" },
  ],
  "/IfcViewer": [
    { text: "Modell prüfen", ziel: "/ModelCheck" },
    { text: "Mengen im LV prüfen", ziel: "/AVA?tab=lv" },
  ],
  "/ModelVersions": [
    { text: "Kostenkontrolle", ziel: "/AVA?tab=control" },
    { text: "Tickets", ziel: "/BimViewer" },
  ],
  "/AVA": [
    { text: "Im Modell prüfen", ziel: "/ModelCheck" },
    { text: "Nachträge entscheiden", ziel: "/Finance" },
    { text: "Bericht erzeugen", ziel: "/Reports" },
  ],
  // No "Kostenkontrolle" here: the finance head offers "Kostenkontrolle (AVA)"
  // as its first cross link (72-14, N-14). Tickets are where change orders start.
  "/Finance": [
    { text: "Abrechnung prüfen", ziel: "/AVA?tab=settlement" },
    { text: "Tickets", ziel: "/BimViewer" },
    { text: "Bericht erzeugen", ziel: "/Reports" },
  ],
  "/AIDashboard": [
    { text: "Offene Tickets", ziel: "/BimViewer" },
    { text: "Modell prüfen", ziel: "/ModelCheck" },
  ],
  "/AddressBook": [
    { text: "Bieter ausschreiben", ziel: "/AVA?tab=tender" },
    { text: "Tickets", ziel: "/BimViewer" },
  ],
  // Phase 79 (D-P79-24): the invoice follows the work stages, the change orders
  // and the report; the page itself links none of these.
  "/Accounting": [
    { text: "Leistungsstand je LP pflegen", ziel: "/ComplexDesigner?tab=planner" },
    { text: "Nachträge entscheiden", ziel: "/Finance" },
    { text: "Bericht erzeugen", ziel: "/Reports" },
  ],
  // Phase 80 (80-01): the letterhead shows up in the reports; from personnel the
  // retention periods of the rule books and back to the projects.
  "/Settings": [
    { text: "Bericht mit Briefkopf erzeugen", ziel: "/Reports" },
  ],
  "/People": [
    { text: "Aufbewahrungsfristen einstellen", ziel: "/Settings?tab=rules" },
    { text: "Projekte", ziel: "/Projects" },
  ],
  // Labor routes: optional. The bar adds the Labor notice and the way back to
  // the overview on every Labor page, with or without steps.
  "/SiteControl": [
    { text: "Tickets", ziel: "/BimViewer" },
    { text: "Nachträge", ziel: "/Finance" },
  ],
  "/SketchStudio": [
    { text: "Zurück zum Gebäudemodell", ziel: "/ComplexDesigner?tab=bim" },
  ],
  "/BitAegis": [
    { text: "Berichte & Dokumente", ziel: "/Reports" },
  ],
});

/**
 * Router path of a step target, without query or hash.
 * @param {string} ziel target as stored in the table, e.g. "/AVA?tab=lv"
 * @returns {string} the bare path, e.g. "/AVA"
 */
export function zielPfad(ziel) {
  return ziel.split(/[?#]/, 1)[0];
}

/**
 * Next steps for a pathname. Unknown routes (including "/" and the 404) get an
 * empty list, so the bar renders nothing there.
 * @param {string} pathname router pathname without query, e.g. "/AVA"
 * @returns {ReadonlyArray<NaechsterSchritt>} at most three steps, possibly empty
 */
export function naechsteSchritteFuer(pathname) {
  const pfad = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return Object.prototype.hasOwnProperty.call(NAECHSTE_SCHRITTE, pfad) ? NAECHSTE_SCHRITTE[pfad] : [];
}
