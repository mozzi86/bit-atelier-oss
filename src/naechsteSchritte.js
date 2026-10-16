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
  // 88-06: from the plan list to cost control and change orders; NAV-PLAN 2026-10-13:
  // and on to the site page (station 8).
  "/Werkplanung": [
    { text: "Kostenkontrolle", ziel: "/AVA?tab=control" },
    { text: "Nachträge entscheiden", ziel: "/Finance" },
    { text: "Bautagebuch führen", ziel: "/Baustelle?tab=bautagebuch" },
  ],
  // NAV-PLAN 2026-10-13: the site page (LP 8) — minutes, deadlines, change orders.
  "/Baustelle": [
    { text: "Protokolle", ziel: "/Reports" },
    { text: "Fristen & Termine", ziel: "/Deadlines?tab=agenda" },
    { text: "Nachträge entscheiden", ziel: "/Finance" },
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
    // 82-01: leave and absences of the staff.
    { text: "Abwesenheiten & Urlaub", ziel: "/Absences?tab=balance" },
  ],
  // Phase 82 (82-01): deadlines lead to the mail register, absences and the books;
  // absences back to the deadlines and the hours; correspondence to the agenda,
  // the contacts and the reports. English routes only.
  "/Deadlines": [
    { text: "Posteingang prüfen", ziel: "/Correspondence?tab=register" },
    { text: "Abwesenheiten", ziel: "/Absences" },
    { text: "Buchhaltung", ziel: "/Accounting" },
  ],
  "/Absences": [
    { text: "Fristen & Termine", ziel: "/Deadlines" },
    { text: "Stunden erfassen", ziel: "/TimeTracking" },
  ],
  "/Correspondence": [
    { text: "Fristen & Termine", ziel: "/Deadlines?tab=agenda" },
    { text: "Adressbuch", ziel: "/AddressBook" },
    { text: "Berichte & Dokumente", ziel: "/Reports" },
  ],
  // Phase 81 (81-01): hours feed the controlling, offers become contracts and
  // invoices, the controlling needs the work-stage progress and approved hours.
  // English routes only; the pages themselves link none of these.
  "/TimeTracking": [
    { text: "Projektcontrolling", ziel: "/Controlling" },
    { text: "Angebot & Auftrag", ziel: "/Fees" },
    // 82-01: an absence instead of hours.
    { text: "Abwesenheit eintragen", ziel: "/Absences?tab=requests" },
  ],
  "/Fees": [
    { text: "Rechnungen in der Buchhaltung", ziel: "/Accounting?tab=invoices" },
    { text: "Leistungsstand je LP pflegen", ziel: "/ComplexDesigner?tab=planner" },
    { text: "Projektcontrolling", ziel: "/Controlling?tab=project" },
  ],
  "/Controlling": [
    { text: "Leistungsstand je LP pflegen", ziel: "/ComplexDesigner?tab=planner" },
    { text: "Zeiten freigeben", ziel: "/TimeTracking?tab=approval" },
    { text: "Architektenverträge", ziel: "/Fees?tab=contracts" },
  ],
  // Labor routes: optional. The bar adds the Labor notice and the way back to
  // the overview on every Labor page, with or without steps. 94-07: SiteControl,
  // SketchStudio, BitAegis and KiTool left the lab — their entries are now required.
  "/KiTool": [
    { text: "KI-Verbindungen einstellen", ziel: "/Settings?tab=ai" },
    { text: "KI-Zentrale", ziel: "/AIDashboard" },
  ],
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
