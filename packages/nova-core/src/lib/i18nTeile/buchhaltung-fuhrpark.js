// Besitzer: 79-08 — nur diese Datei ändern.
//
// English dictionary part of the accounting area "Fuhrpark und Fahrten (Spur B)".
// Decision list § 5: i18n.jsx is touched once per phase (79-01); every area plan
// writes its English texts only into its own part file under i18nTeile/.
//
// Format: one line per entry, "Deutscher Schlüssel": "English text", double
// quotes. The guard (tests/unit/i18nAbdeckung.test.js) reads every part file and
// refuses a key that already exists in i18n.jsx or in another part file.
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  "1 %-Regel": "1 % rule",
  "Anschaffungsdatum": "Acquisition date",
  "Antrieb": "Drivetrain",
  "Arbeitnehmer/in": "Employee",
  "Bitte Kilometer eingeben.": "Please enter kilometres.",
  "Bitte ein Anschaffungsdatum eingeben.": "Please enter an acquisition date.",
  "Bitte ein Kennzeichen eingeben.": "Please enter a licence plate.",
  "Bitte ein Ziel eingeben.": "Please enter a destination.",
  "Bitte eine Person eingeben.": "Please enter a person.",
  "Bitte einen Bruttolistenpreis eingeben.": "Please enter a list price.",
  "Bruttolistenpreis": "List price",
  "CO₂ (g/km)": "CO₂ (g/km)",
  "Dienstlich": "Business",
  "Ein Fahrtenbuch in dieser App ist nicht manipulationssicher — nur Vergleich, kein ordnungsgemäßes Fahrtenbuch.":
    "A logbook in this app is not tamper-proof — comparison only, not a proper logbook.",
  "Elektrische Reichweite (km)": "Electric range (km)",
  "Elektro": "Electric",
  "Entfernung Wohnung–Büro (km)": "Home–office distance (km)",
  "Fahrt bearbeiten": "Edit trip",
  "Fahrt erfasst": "Trip recorded",
  "Fahrt gespeichert": "Trip saved",
  "Fahrtenbuch": "Logbook",
  "Fahrzeug angelegt": "Vehicle created",
  "Fahrzeug bearbeiten": "Edit vehicle",
  "Fahrzeug gespeichert": "Vehicle saved",
  "Faktor": "Factor",
  "Geldwerter Vorteil": "Benefit in kind",
  "Gesamtübersicht": "Overview",
  "Gesellschafter-Geschäftsführer/in": "Managing partner",
  "Grenzen hängen am Anschaffungsdatum; Werte aus der Einstellungsdatei.": "Limits depend on the acquisition date; values come from the settings file.",
  "Günstigere Methode": "Cheaper method",
  "Hybrid": "Hybrid",
  "Jahreswert": "Yearly value",
  "Kauf": "Purchase",
  "Kauf/Leasing": "Purchase/lease",
  "Keine Fahrten erfasst.": "No trips recorded.",
  "Keine Fahrten mit dem Privat-Pkw erfasst.": "No trips with a private car recorded.",
  "Keine Fahrzeuge angelegt.": "No vehicles created.",
  "Kennzeichen": "Licence plate",
  "Kilometer": "Kilometres",
  "Kilometergeld": "Mileage allowance",
  "Kilometerstand bis (optional)": "Odometer end (optional)",
  "Kilometerstand von (optional)": "Odometer start (optional)",
  "Kosten": "Cost",
  "Leasing": "Lease",
  "Lücke im Kilometerstand": "Gap in odometer reading",
  "Methode": "Method",
  "Monat": "Month",
  "Monatswert": "Monthly value",
  "Neue Fahrt": "New trip",
  "Neue Fahrt mit Privat-Pkw": "New trip with a private car",
  "Neues Fahrzeug": "New vehicle",
  "Nur informativ — Lohnabrechnung.": "Informational only — payroll.",
  "Nutzer": "User",
  "Nutzerart": "User type",
  "Nutzungsbeginn": "Start of use",
  "Nutzungsende (optional)": "End of use (optional)",
  "Nutzungsentnahme": "Withdrawal for private use",
  "Pflichtfeld fehlt": "Required field missing",
  "Privat": "Private",
  "Verbrenner": "Combustion",
  "Wohnung–Arbeitsstätte": "Home–workplace",
  "Ziel": "Destination",
  "Zweck": "Purpose",
  "Überlappung im Kilometerstand": "Overlap in odometer reading",
};
