// Besitzer: 81-05, Spur A — nur diese Datei ändern.
//
// English dictionary part of phase 81 "Projektcontrolling (Übersicht, Projekt, Monat, Kostensätze)".
// Decision list § 5 / HANDOFF § 5: i18n.jsx is touched once per phase (81-01, menu
// and "Weiter mit" only); every plan writes its English texts only into its own
// part file under i18nTeile/. Only texts of this area here — a generic word that
// is missing after 81-01 goes here too and is named in the plan's SUMMARY (it
// moves to zeit-honorar-fundament.js when the lanes are merged, 79 pattern).
//
// Format: one line per entry, "Deutscher Schlüssel": "English text", double
// quotes. The guard (tests/unit/i18nAbdeckung.test.js) reads every part file and
// refuses a key that already exists in i18n.jsx or in another part file.
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

export const EN = {
  // Page head and switches
  "nur freigegebene Buchungen": "approved bookings only",
  "persönliche Sätze": "personal rates",
  "kalkuliert mit Bürosatz {satz}/h": "calculated with office rate {satz}/h",
  "Kein Bürosatz: in den Regelwerken „Bürosatz“ eintragen.": "No office rate: enter “office rate” in the rule books.",
  "kalkuliert mit persönlichen Kostensätzen": "calculated with personal cost rates",
  "Bis Rollen & Rechte (Phase 82) für alle mit Personal-Zugang sichtbar": "Until roles & rights (phase 82) visible to everyone with HR access",
  "Persönliche Kostensätze nur mit Personal-Zugang": "Personal cost rates only with HR access",
  "Projekt wählen": "Choose project",
  // Traffic light
  "kritisch": "critical",
  "Achtung": "attention",
  "im Plan": "on track",
  "ohne Zeiten": "no hours",
  "ohne Daten": "no data",
  "Controlling: Tafel fehlt": "Controlling: fee table missing",
  "Controlling: kritisch": "Controlling: critical",
  "Controlling: Achtung": "Controlling: attention",
  "Controlling: im Plan": "Controlling: on track",
  "Controlling: ohne Zeiten": "Controlling: no hours",
  "Controlling: ohne Daten": "Controlling: no data",
  // Overview
  "Noch kein Projekt mit Architektenvertrag oder gebuchten Stunden.": "No project with an architect's contract or booked hours yet.",
  "Honorar gegen Aufwand je Projekt": "Fee against effort per project",
  "Kosten bisher": "Cost so far",
  "Erarbeitet": "Earned",
  "Deckungsbeitrag": "Contribution margin",
  "Verbrauch / Fortschritt": "Consumption / progress",
  "Reststunden": "Remaining hours",
  "archiviert": "archived",
  "kein Architektenvertrag": "no architect's contract",
  "Offenes Honorarangebot": "Open fee offer",
  "Honorarangebot erstellen": "Create fee offer",
  // Project
  "Für dieses Projekt gibt es weder einen Architektenvertrag noch gebuchte Stunden.": "This project has neither an architect's contract nor booked hours.",
  "Stunden werden bewertet, ein Honorar fehlt.": "hours are valued, a fee is missing.",
  "Weitere Architektenverträge des Projekts: {n} — gerechnet wird mit {nummer}.": "Further architect's contracts of the project: {n} — calculated with {nummer}.",
  "Für dieses Leistungsbild ist die Honorartafel noch nicht amtlich übertragen. Ein Honorar und damit eine Ampel gibt es erst mit einer Pauschale im Architektenvertrag.":
    "The fee table of this service profile has not been transferred from the official text yet. A fee, and with it a traffic light, only exists with a lump sum in the architect's contract.",
  "Pauschale anteilig nach LPH-Prozent": "Lump sum split by work-stage percentage",
  "Leistungsstand nur für die Objektplanung": "Progress only for the object planning profiles",
  "die Ampel bleibt grau.": "the traffic light stays grey.",
  "Noch kein Leistungsstand erfasst — im Architektenvertrag (Angebot & Auftrag) oder im Designer-Reiter „Planer“ eintragen.": "No progress recorded yet — enter it in the architect's contract (Offer & contract) or in the Designer tab “Planner”.",
  "{stunden} ohne Kostensatz": "{stunden} without a cost rate",
  "Kostensätze pflegen": "Maintain cost rates",
  "Honorar gegen Aufwand je Leistungsphase": "Fee against effort per work stage",
  "Verbrauch": "Consumption",
  "Prognose Kosten": "Forecast cost",
  "Restbudget": "Remaining budget",
  "nicht beauftragt": "not commissioned",
  "ohne LPH (Akquise, Bürozeit)": "without work stage (acquisition, office time)",
  "Fortschritt gewichtet = Summe aus Honorar × Leistungsstand je LPH geteilt durch das Honorar — eine LPH mit großem Honorar zählt mehr. Verbrauch = Kosten / Honorar; Ampel rot, wenn der Verbrauch den Fortschritt um mehr als die Schwelle übersteigt oder die Kosten das Honorar.":
    "Weighted progress = sum of fee × progress per work stage divided by the fee — a stage with a large fee counts more. Consumption = cost / fee; the light turns red when consumption exceeds progress by more than the threshold or the cost exceeds the fee.",
  "Honorar, Kosten und erarbeitete Leistung je LPH": "Fee, cost and earned value per work stage",
  "Keine Honorarnachträge zu diesem Vertrag.": "No fee amendments for this contract.",
  "zählt zum Honorar": "counts towards the fee",
  "zählt nicht (nicht beauftragt)": "does not count (not commissioned)",
  "Stunden je Person": "Hours per person",
  "Noch keine Stunden gebucht.": "No hours booked yet.",
  // Month
  "Noch kein Leistungsstand-Verlauf: Er entsteht einmal je Monat beim Speichern des Leistungsstands im Designer-Reiter „Planer“. Bis dahin fehlt die erarbeitete Leistung je Monat.":
    "No progress history yet: it is recorded once a month when the progress is saved in the Designer tab “Planner”. Until then the earned value per month is missing.",
  "Leistungsstand pflegen": "Maintain progress",
  "Noch keine Monatswerte für dieses Projekt.": "No monthly values for this project yet.",
  "Kosten, erarbeitete Leistung und Abrechnung je Monat": "Cost, earned value and invoicing per month",
  "Erarbeitet im Monat": "Earned in the month",
  "Monatswerte": "Monthly values",
  // Cost rates
  "Kostensatz gespeichert": "Cost rate saved",
  "Aus Gehältern abgeleitet — nur mit Personal-Zugang sichtbar.": "Derived from salaries — visible only with HR access.",
  "Kalender-Vorschlag {jahr}: {n} Feiertage an Wochentagen (Bayern); die Kalkulation rechnet mit {regel} Tagen.": "Calendar suggestion {jahr}: {n} public holidays on weekdays (Bavaria); the calculation uses {regel} days.",
  "In den Regelwerken ändern": "Change in the rule books",
  "manuell": "manual",
  "aus Gehalt": "from salary",
  "kein Kostensatz": "no cost rate",
  "Jahresbrutto {brutto} × Faktor {faktor} (AG-Anteil {ag} %) = Jahreskosten {kosten}": "Annual gross {brutto} × factor {faktor} (employer share {ag} %) = annual cost {kosten}",
  "Produktive Stunden {h} h ({wh} h/Woche, {u} Urlaubstage, {f} Feiertage, {k} Krankheitstage, Produktivquote {q} %)": "Productive hours {h} h ({wh} h/week, {u} days of leave, {f} public holidays, {k} sick days, productivity {q} %)",
  "Direkt {direkt}/h, mit Gemeinkosten {gk} % → Satz {satz}/h": "Direct {direkt}/h, with overhead {gk} % → rate {satz}/h",
  "Aus Gehalt berechnen": "Calculate from salary",
  "Inhaber/in ohne Gehalt — Kostensatz von Hand eintragen.": "Owner without salary — enter the cost rate by hand.",
  "Kein aktiver Arbeitsvertrag mit Gehalt — Kostensatz von Hand eintragen oder im Personal ergänzen.": "No active employment contract with salary — enter the cost rate by hand or complete it under HR.",
  "Manueller Satz (Euro/Stunde)": "Manual rate (euro/hour)",
  "Manuell": "Manual",
};
