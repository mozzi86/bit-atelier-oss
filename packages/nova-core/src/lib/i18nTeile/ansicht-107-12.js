// 107-12: English texts of the view state (saved views "Ausschnitte", structure display, view options, graphic rules, export
// fallback note). German source text = key.
//
// LAZY part (size budget of the entry chunk): NOT listed in ./index.js. BitBimStudio (outside the start path) imports it and calls
// englischErgaenzen() of ../i18n.jsx once when it loads; the lazy block AnsichtOptionen is only rendered by the studio.
// The guard test (tests/unit/i18nAbdeckung.test.js) reads this file like every other part.
//
// In:  nothing. Out: EN.

/** @type {Record<string, string>} */
export const EN = {
  "Ausschnitte": "Saved views",
  "+ speichern": "+ save",
  "Name des Ausschnitts (optional)": "Name of the view (optional)",
  "Aktuelle Ansicht (Maßstab, Ebenen, Brille, Darstellung) als Ausschnitt sichern — bleibt im Projekt gespeichert.": "Save the current view (scale, layers, lens, display) — it stays stored in the project.",
  "enthielt ungeprüfte KI-Änderungen": "contained unreviewed AI changes",
  "PDF aus diesem Ausschnitt": "PDF from this view",
  "Ausschnitt löschen": "Delete view",
  "Plan wird erstellt …": "Creating the plan …",
  "Ausgabe aus dem Ausschnitt „{{name}}“": "Output from the view \"{{name}}\"",
  "Wände aus Bändern abgeleitet, Solid nicht verfügbar": "Walls derived from the bands, solid not available",
  "Mit Vermerk „Wände aus Bändern abgeleitet“.": "With the note \"walls derived from the bands\".",
  "Aufbau": "Build-up",
  "Gesamter Aufbau": "Whole build-up",
  "Ohne Bekleidung": "Without finishes",
  "Nur Kern": "Core only",
  "Nur Kern der tragenden Bauteile": "Core of load-bearing elements only",
  "Schichten nach ihrer Funktion ausblenden — die Referenzlinie bleibt, IFC und Mengen bleiben vollständig": "Hide layers by their function — the reference line stays, IFC and quantities stay complete",
  "Türaufschlag": "Door swing",
  "Fenstersymbol": "Window symbol",
  "Durchbruchsymbol": "Penetration symbol",
  "Materialschraffur": "Material hatch",
  "Statusschraffur": "Status hatch",
  "Grafische Regeln": "Graphic rules",
  "Feuerwiderstand: Kontur strichpunktiert · tragend: Füllung dunkler; in Umbau-Brillen gewinnt der Status": "Fire resistance: dash-dot outline · load-bearing: darker fill; in renovation lenses the status wins",
  // review 107-12
  "Aktuellen Plan als PDF": "Current plan as PDF",
  "Höchstens {{n}} Ausschnitte – bitte einen löschen.": "At most {{n}} saved views – please delete one.",
  "Ausschnitt konnte nicht angewendet werden – keine Ausgabe erstellt.": "The view could not be applied – no output created.",
  "Ohne gespeicherten Ausschnitt: Blatt wie bisher, ohne Öffnungssymbole.": "Without a saved view: sheet as before, without opening symbols.",
};
