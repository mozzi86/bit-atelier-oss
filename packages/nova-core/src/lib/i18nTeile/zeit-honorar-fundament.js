// Besitzer: 81-01 — nur diese Datei ändern.
//
// English dictionary part of phase 81 "Zeit, Honorar & Controlling — Fundament":
// page shells, tab labels, the cloud card, the labels of the data contracts, the
// rule book zeit_honorar and — entered once ahead of the two lanes — the generic
// words both lanes need (lesson of the 79 merges 4a726bb/c8858d0: such words in
// two lane files made the duplicate guard red only at the merge).
// Menu group, menu titles and "Weiter mit" texts stay in i18n.jsx (block 81-01),
// because navigation.test.js reads that file alone.
//
// Format: one line per entry, "Deutscher Schlüssel": "English text", double
// quotes. The guard (tests/unit/i18nAbdeckung.test.js) reads every part file and
// refuses a key that already exists in i18n.jsx or in another part file.
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

export const EN = {
  // Page shells
  "Projektzeiten und Tagesrahmen — Hinweise ersetzen keine Rechtsprüfung": "Project hours and working day — hints are no legal review",
  "Zeiten werden geladen …": "Loading hours …",
  "Bereiche der Zeiterfassung": "Areas of the time tracking",
  "Honorarangebot · Architektenvertrag · Honorarnachtrag — nach HOAI 2021": "Fee offer · architect's contract · fee amendment — under HOAI 2021",
  "Honorardaten werden geladen …": "Loading fee data …",
  "Bereiche von Angebot & Auftrag": "Areas of offers & contracts",
  "Honorar gegen Aufwand je Projekt und Leistungsphase": "Fee against effort per project and work stage",
  "Controlling wird geladen …": "Loading controlling …",
  "Bereiche des Projektcontrollings": "Areas of the project controlling",
  "Erst nach Zugriffstrennung (Phase 74) verfügbar": "Available only after access separation (phase 74)",
  "Zeiten, Honorare und Kostensätze sähen sonst alle Mitglieder einer Organisation. Nutzen Sie bis dahin die lokale Version.": "Otherwise every member of an organisation would see hours, fees and cost rates. Until then, use the local version.",
  "Zeiten und Honorare konnten nicht geladen werden": "Hours and fees could not be loaded",
  "Dieser Reiter ist noch im Aufbau": "This tab is still being built",
  "Er kommt mit Plan {plan} der Phase 81.": "It arrives with plan {plan} of phase 81.",
  // Tab labels (src/lib/{zeit,honorar,controlling}/reiter.js)
  "Wochenansicht": "Week",
  "Tagesansicht": "Day",
  "Freigabe": "Approval",
  "Honorarangebote": "Fee offers",
  "Honorarnachträge": "Fee amendments",
  "Honorarrechner": "Fee calculator",
  "Kostensätze": "Cost rates",
  // Data contracts: status, kinds of work, office categories (src/lib/zeit, src/lib/honorar)
  "im Entwurf": "draft",
  "Eingereicht": "Submitted",
  "Freigegeben": "Approved",
  "Abgelehnt": "Rejected",
  "Versendet": "Sent",
  "Angenommen": "Accepted",
  "Beauftragt": "Commissioned",
  "Angeboten": "Offered",
  "Ruht": "On hold",
  "Grundleistung": "Basic service",
  "Besondere Leistung": "Special service",
  "Honorarnachtrag": "Fee amendment",
  "Akquise": "Acquisition",
  "Gewährleistung": "Warranty",
  "Verwaltung": "Administration",
  "Fortbildung": "Training",
  // Rule book zeit_honorar (src/lib/zeitHonorar/regeln.js)
  "Zeit, Honorar & Controlling": "Time, fees & controlling",
  "Kostensatz": "Cost rate",
  "Honorar": "Fee",
  "Controlling": "Controlling",
  "Raster der Zeiterfassung": "Time tracking grid",
  "Tagessoll ohne Arbeitsvertrag": "Daily target without employment contract",
  "Buchungen bearbeitbar bis": "Bookings editable for",
  "Wochen müssen freigegeben werden": "Weeks must be approved",
  "Tagesrahmen (Beginn, Ende, Pause) erfassen": "Record the working day (start, end, break)",
  "Gemeinkostenzuschlag": "Overhead surcharge",
  "Arbeitgeberanteil Sozialversicherung": "Employer's social security share",
  "Produktivquote": "Productivity rate",
  "Feiertage je Jahr (Kalkulation)": "Public holidays per year (calculation)",
  "Krankheitstage je Jahr (Kalkulation)": "Sick days per year (calculation)",
  "Bürosatz (leer = Mittel der Kostensätze)": "Office rate (empty = mean of the cost rates)",
  "Honorarangebot gültig": "Fee offer valid for",
  "Nummernkreis Honorarangebote": "Number range of fee offers",
  "Nummernkreis Architektenverträge": "Number range of architect's contracts",
  "Verrechnungssatz Inhaber/in": "Charge-out rate owner",
  "Verrechnungssatz Projektleitung": "Charge-out rate project lead",
  "Verrechnungssatz Mitarbeit": "Charge-out rate staff",
  "Ampel gelb ab Aufwand über Fortschritt": "Amber when effort exceeds progress by",
  "Ampel rot ab Aufwand über Fortschritt": "Red when effort exceeds progress by",
  "Nutzerentscheidung E-16 vom 27.09.2026": "User decision E-16 of 27 Sep 2026",
  "Annahme Phase 81": "Assumption of phase 81",
  // Generic words of both lanes (entered once, ahead of 81-02…81-05)
  "Stunden": "Hours",
  "Minuten": "minutes",
  "Soll": "Target",
  "Woche": "Week",
  "KW": "CW",
  "Mitarbeiter:in": "Staff member",
  "LPH": "WS",
  "Bürosatz": "Office rate",
  "Stundensatz": "Hourly rate",
  "Architektenvertrag": "Architect's contract",
  "Honorarangebot": "Fee offer",
  "Fassung": "Version",
  "Bürozeit": "Office time",
  "Leistung": "Service",
  "Ampel": "Traffic light",
  "Fortschritt": "Progress",
  "Aufwand": "Effort",
  "ohne Kostensatz": "without cost rate",
};
