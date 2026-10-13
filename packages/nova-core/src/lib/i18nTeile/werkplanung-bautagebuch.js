// Besitzer: 88-02 — nur diese Datei ändern.
//
// English dictionary part of 88-02 "Bautagebuch" (construction diary tab of
// "Werkplanung & Baustelle", bad-weather hints, hindrance notice letter).
//
// Format: one line per entry, "Deutscher Schlüssel": "English text", double
// quotes. The guard (tests/unit/i18nAbdeckung.test.js) refuses a key that
// already exists in i18n.jsx or in another part file.
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

export const EN = {
  // Tab and list
  "Bautagebuch": "Site diary",
  "Bautagebuch konnte nicht geladen werden": "Site diary could not be loaded",
  "Neuer Tag": "New day",
  "Schlechtwetter-Hinweise sind Richtwerte – Schutzmaßnahmen und Behinderung entscheidet die Bauleitung.": "Bad-weather hints are guide values – protective measures and hindrance are decided by site management.",
  "Wetter": "Weather",
  "Firmen": "Companies",
  "Vorkommnisse": "Incidents",
  "Schlechtwettertag": "Bad-weather day",
  "Messwert Open-Meteo": "Open-Meteo reading",
  "{n} Personen": "{n} persons",
  "Mängel": "Defects",
  "Behinderung": "Hindrance",
  "Behinderungsanzeige schreiben": "Write hindrance notice",
  // Form
  "Wetter übernehmen": "Take over weather",
  "Kein Standort am Projekt – Wetter bitte von Hand eintragen.": "No location on the project – please enter the weather by hand.",
  "Keine Live-Wetterdaten (offline) – bitte von Hand eintragen.": "No live weather data (offline) – please enter by hand.",
  "Aktueller Messwert übernommen (Tiefst- und Höchstwert bitte am Abend prüfen).": "Current reading taken over (please check low and high in the evening).",
  "Wetter nicht abrufbar": "Weather not available",
  "Für diesen Tag gibt es schon einen Eintrag – bitte diesen bearbeiten.": "There is already an entry for this day – please edit it.",
  "Eintrag konnte nicht gespeichert werden": "Entry could not be saved",
  "Tiefstwert (°C)": "Low (°C)",
  "Höchstwert (°C)": "High (°C)",
  "Niederschlag (mm)": "Precipitation (mm)",
  "Wind (km/h)": "Wind (km/h)",
  "Wetter (Beschreibung)": "Weather (description)",
  "Firmen auf der Baustelle": "Companies on site",
  "Mannstärke": "Crew size",
  "Pers.": "Pers.",
  "Arbeiten": "Works",
  "Firma hinzufügen": "Add company",
  "Behinderung der Ausführung": "Hindrance of the works",
  "Behinderung (Beschreibung)": "Hindrance (description)",
  "Was hat die Ausführung behindert?": "What hindered the works?",
  // Bad-weather hints
  "Beton/Estrich/Mörtel bei {temp} °C (unter +{grenze} °C): Schutzmaßnahmen dokumentieren": "Concrete/screed/mortar at {temp} °C (below +{grenze} °C): document protective measures",
  "Mauerwerk bei Frost ({temp} °C): nicht auf gefrorenem Untergrund mauern": "Masonry in frost ({temp} °C): do not lay on frozen ground",
  "Anstrich/Putz/Abdichtung bei Niederschlag ({mm} mm)": "Coating/plaster/waterproofing in precipitation ({mm} mm)",
  "Wind {kmh} km/h an Kran/Gerüst/Dach: Betrieb prüfen": "Wind {kmh} km/h at crane/scaffold/roof: check operation",
  // Letter type and placeholders (correspondence, 82-05)
  "Behinderungsanzeige": "Hindrance notice",
  "Behinderung an Bauherrn melden": "Report hindrance to client",
  "Zeitraum der Behinderung": "Period of the hindrance",
  "Anzahl der Behinderungstage": "Number of hindrance days",
  "Behinderung laut Bautagebuch": "Hindrance according to the site diary",
};
