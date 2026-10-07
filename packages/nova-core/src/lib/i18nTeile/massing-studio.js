// English dictionary part of phase 75 (massing studio, apartment focus).
// Decision list § 5: new UI texts go here, i18n.jsx stays closed. The guard
// (tests/unit/i18nAbdeckung.test.js) refuses a key that exists elsewhere —
// grep all dictionary files before adding one.
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  // --- 75-15: architectural dimension chains (WohnungsFokus.jsx) — the unit is
  // written once next to the scale chip, never on the numbers of a chain.
  "Maße in m": "Dimensions in m",
  // --- 75-14: hall, doors, access graph, room quality (WohnungsFokus/-Werkstatt).
  "Wohnungsgrundriss: Diele, Türen, ≥ 10 m², ≤ 1 : 1,8, Schrankwand 3 m": "Apartment layout: hall, doors, ≥ 10 m², ≤ 1 : 1.8, wardrobe wall 3 m",
  "Raumqualität je WE": "Room quality per unit",
  "Raumqualität": "Room quality",
  "Büro-Vorgabe": "office standard",
  "Fokus": "Focus",
  "Keine Befunde.": "No findings.",
  "Türen": "Doors",
  "Tür": "Door",
  "Schrank": "wardrobe",
  "Klick auf eine Tür dreht den Aufschlag": "click a door to flip its swing",
  "Klick dreht den Aufschlag": "click flips the swing",
  "Wiederholen": "Redo",
  "Rückgängig (Strg+Z)": "Undo (Ctrl+Z)",
  "Wiederholen (Strg+Y)": "Redo (Ctrl+Y)",
  // --- 75-13: window cap, balcony switch, stair enclosure + lift, escape route.
  "Notwendiger Treppenraum + Aufzug (MBO §35/§39)": "Necessary stair enclosure + lift (MBO §35/§39)",
  "Fenster je Raum": "Windows per room",
  "Eckraum 2": "corner room 2",
  "Deckel je Raum: 1 Fenster mittig auf der längsten Fassade (Eckraum 2, eins je Fassade); Belichtung 1/8 verbreitert zuerst bis 2,4 m, erst dann ein zweites Fenster": "Cap per room: 1 window centred on the longest facade (corner room 2, one per facade); daylight 1/8 widens up to 2.4 m first, only then a second window",
  "Aufzug": "Lift",
  "Kern": "Core",
  "Treppenraum": "Stair enclosure",
  "Vorgabe": "default",
  "keine Pflicht": "not required",
  "Büro-Vorgabe: Aufzug ab mehr als": "Office rule: lift above",
  "Geschossen": "storeys",
  "Gebäudehöhe": "building height",
  "Geschosse": "storeys",
  "Treppenraum-Erweiterung": "Stair-enclosure extension",
  "Treppenraum-Erweiterung je Seite (m)": "Stair-enclosure extension per side (m)",
  "je Seite": "per side",
  "Treppenraum wächst entlang des Flurs; Grenze = Brandwand mit T30-RS-Tür, Messung endet dort (MBO §35 Abs. 4–6)": "The enclosure grows along the corridor; boundary = fire wall with T30-RS door, the measurement ends there (MBO §35 Abs. 4–6)",
  "Außenliegende Räume": "Outer rooms",
  "Balkon 1,5 m tief vor der Raumfassade, 0,5 m Rand [ASSUMED]": "Balcony 1.5 m deep in front of the room facade, 0.5 m margin [ASSUMED]",
  "Fenster je Raum (leer = Regel)": "Windows per room (empty = rule)",
  "Fenster": "Windows",
  "Regel": "rule",
  "1,5 m tief, 0,5 m Rand": "1.5 m deep, 0.5 m margin",
  "Rettungsweg zeigen": "Show escape route",
  "Werkstatt-Regel „Rettungsweg“ ist aus": "workshop rule “escape route” is off",
  "Lauflinie vom tiefsten Punkt jeder WE durch Zimmertür und Diele bis zur Treppenraum-Tür (MBO §35 Abs. 2); Ringe = Türen; rot gestrichelt = Näherung": "Walked line from the deepest point of every unit through the room door and the hall to the stair door (MBO §35 Abs. 2); rings = doors; dashed red = approximation",
  "Näherung innen": "Approximation inside the unit",
  "ohne Türdaten (Regel „Wohnungsgrundriss“ aus) — Tür je Raum in der Mitte der gemeinsamen Wand ≥ 1,185 m zum Flur angenommen": "no door data (rule “Apartment layout” off) — one door per room assumed in the middle of its shared wall ≥ 1.185 m to the hall",
  "ein Raum hat keine Tür zum Flur — Weg durch den Nachbarraum gerechnet (Durchgangszimmer sind ausgeschlossen, D-P75-14-C)": "a room has no door to the hall — route counted through the neighbouring room (walk-through rooms are excluded, D-P75-14-C)",
  "kein Weg über Türen gefunden — Luftlinie im offenen Grundriss": "no route through doors found — straight line through the open plan",
};
