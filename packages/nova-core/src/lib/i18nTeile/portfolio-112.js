// Phase 112 (foreign review 08.11.2026): English texts of the page "Portfolio (Projektentwicklung)" after its invented
// key figures were replaced by figures from real records (112-01). German source text = key.
//
// LAZY part (size budget of the entry chunk, pattern ansicht-107-12.js): NOT listed in ./index.js. The only consumer,
// src/pages/AtelierDeveloper.jsx, imports this file and calls englischErgaenzen(EN) of ../i18n.jsx once at module level.
//
// In:  nothing. Out: EN.

/** @type {Record<string, string>} */
export const EN = {
  "Fläche lt. Projektangaben (m²)": "Area as entered per project (m²)",
  "{{n}} von {{gesamt}} Projekten mit Flächenangabe": "{{n}} of {{gesamt}} projects with an area",
  "Keine Flächenangabe in den Projekten": "No area entered in the projects",
  "Letzte Aktivitäten": "Latest activity",
  "Projektdaten geändert": "Project data changed",
  "(ohne Namen)": "(no name)",
  "Zuletzt geänderte Projekte": "Recently changed projects",
  "Energie-Screening gespeichert": "Energy screening saved",
  "Noch keine Aktivitäten": "No activity yet",
  "Aus den Anlage- und Änderungsdaten der Projekte und den gespeicherten Energie-Screenings.": "From the creation and change dates of the projects and the stored energy screenings.",
};
