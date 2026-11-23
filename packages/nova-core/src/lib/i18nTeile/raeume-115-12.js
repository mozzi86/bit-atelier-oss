// 115-12 (D-115-47): English texts of the room editing in the apartment planner — selecting a room in the storey plan,
// typed width × depth, handles, step buttons, the hand marker and "reset to rule" (WohnungsWerkstatt.jsx, RaumInfo.jsx,
// and the dropped-inputs note of VorschlaegePanel.jsx). German source text = key.
// W-1118-02 (phase 115 user wish): the "Möbel ohne Raum" panel of the Innenausbau tab (InteriorDesigner.jsx).
//
// LAZY part (size budget of the entry chunk, pattern raeume-107-11.js): NOT listed in ./index.js. WohnungsWerkstatt.jsx and
// InteriorDesigner.jsx — the modules that show these texts, outside the start path — import it and call englischErgaenzen(EN)
// of ../i18n.jsx once when they load (RaumInfo and VorschlaegePanel only render inside the workshop). Keys that already exist in
// another part ("Raum", "Tiefe", "Fläche", "Regel", "Schritt" …) are not repeated here — the guard
// (tests/unit/i18nAbdeckung.test.js) refuses a key defined twice.
//
// In:  nothing. Out: EN.

/** @type {Record<string, string>} */
export const EN = {
  // storey plan of the workshop
  "Klick wählt einen Raum · Doppelklick öffnet die Wohnung": "Click selects a room · double-click opens the unit",
  "Pfeiltasten verschieben, Esc hebt die Auswahl auf": "arrow keys move it, Esc clears the selection",
  "Ziehen ändert die Größe": "Drag to resize",
  "von Hand gesetzter Raum (bleibt beim Neu-Erzeugen stehen)": "room set by hand (stays when the rules regenerate)",
  "Maß angepasst: Mindestmaß 1,20 m (bzw. Türbreite) und Wohnungsumriss begrenzen den Raum.": "Size adjusted: the minimum of 1.20 m (or the door width) and the unit outline limit the room.",
  // proposals panel: dropped layout-bound inputs
  "von Hand gesetzte Räume": "rooms set by hand",
  // room info panel
  "Rauminfo": "Room info",
  "— kein Raum gewählt —": "— no room selected —",
  "Raum im Plan anklicken oder hier wählen. Dann Größe eintippen, an den Griffen ziehen oder den Raum verschieben.": "Click a room in the plan or pick it here. Then type its size, drag the handles or move the room.",
  "Erst „Tesselierung anwenden“ — danach lassen sich die Räume im Plan anklicken.": "Apply the tessellation first — then the rooms can be clicked in the plan.",
  "Dieser Raum ist kein Rechteck (Diele über Eck, Raum an einer Schräge, Balkon) — Größe und Lage folgen der Regel.": "This room is not a rectangle (L-shaped hall, room at a slanted facade, balcony) — size and position follow the rule.",
  "Raum verschieben": "Move room",
  "Raum nach links schieben": "Move room left",
  "Raum nach oben schieben": "Move room up",
  "Raum nach unten schieben": "Move room down",
  "Raum nach rechts schieben": "Move room right",
  "Von Hand gesetzt": "Set by hand",
  "bleibt beim Neu-Erzeugen aus den Regeln stehen.": "stays when the rules regenerate the layout.",
  "Auf Regel zurücksetzen": "Reset to rule",
  "Wohnung öffnen": "Open unit",
  "Im Plan: Griffe ziehen ändert die Größe, der Raum selbst lässt sich schieben. Pfeiltasten schieben schrittweise, Esc hebt die Auswahl auf, Alt zieht ohne Fang.": "In the plan: drag the handles to resize, drag the room to move it. Arrow keys move step by step, Esc clears the selection, Alt drags without snapping.",
  "Breite": "Width",
  "Lage": "Position",
  // W-1118-02: furniture whose room cannot be told safely (InteriorDesigner.jsx)
  "Möbel ohne Raum": "Furniture without a room",
  "Diese Möbel lassen sich keinem Raum sicher zuordnen. Raum wählen und zuweisen oder entfernen.": "This furniture cannot be assigned to a room with certainty. Choose a room and assign it, or remove it.",
  "Alle zuweisen": "Assign all",
  "Die Möbel liegen nicht in {{raum}}, dem Raum, dem sie bisher zugeordnet waren.": "The furniture does not lie in {{raum}}, the room it was assigned to so far.",
  "Lage nicht eindeutig — an dieser Stelle liegen mehrere Räume: {{raeume}}.": "Position not unique — several rooms lie at this spot: {{raeume}}.",
  "{{raum}} hat schon eigene Möbel.": "{{raum}} already has furniture of its own.",
  "Den Raum gibt es nicht mehr.": "The room no longer exists.",
  "Raum wählen …": "Choose a room …",
  "Zuweisen": "Assign",
  "Möbel": "Furniture",
  // W-1118-02 review (R-1, R-2, R-3): rooms the furniture lies in are named, not preselected; removing asks first
  "Nicht alle Möbel liegen in {{raum}}, dem Raum, dem sie bisher zugeordnet waren.": "Not all of the furniture lies in {{raum}}, the room it was assigned to so far.",
  "Sie liegen in {{raeume}}.": "It lies in {{raeume}}.",
  "Möbel liegen hier": "furniture lies here",
  "{{n}} Möbel endgültig entfernen? Das lässt sich nicht rückgängig machen.": "Remove {{n}} pieces of furniture for good? This cannot be undone.",
};
