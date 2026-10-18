// Phase 101-06 (command line): English texts of the command prompts (@core/lib/befehlszeile.js).
// Format and guard as in every part file (tests/unit/i18nAbdeckung.test.js).
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  "Bereit": "Ready",
  "Körper anklicken (Umschalt = mehrere)": "Click a body (Shift = several)",
  "Ecken ziehen formt den Körper · Umschalt+Klick ergänzt · Entf löscht": "Drag corners to reshape · Shift+click adds · Del deletes",
  "Ersten Punkt klicken": "Click the first point",
  "Nächsten Punkt klicken oder Länge tippen + Enter": "Click the next point or type a length + Enter",
  "Nächsten Punkt klicken oder Startpunkt klicken = Fläche schließen": "Click the next point or the start point to close the face",
  "Höhe tippen + Enter (Strg+Enter = aufstocken) oder in 3D ziehen": "Type a height + Enter (Ctrl+Enter = stack) or drag in 3D",
  "Körper anklicken": "Click a body",
  "Basispunkt klicken": "Click the base point",
  "Ziel klicken (Strg = Kopie) oder Abstand tippen + Enter": "Click the target (Ctrl = copy) or type a distance + Enter",
  "Winkel in Grad tippen + Enter": "Type an angle in degrees + Enter",
  "Faktor tippen + Enter": "Type a factor + Enter",
  "Ersten Pfadpunkt klicken": "Click the first path point",
  "Weitere Pfadpunkte klicken · Enter = fertig (oder Breite;Höhe tippen)": "Click more path points · Enter = done (or type width;height)",
  "In den Plan klicken": "Click into the plan",
  "Pfadpunkte klicken (mindestens 2)": "Click path points (at least 2)",
  "Weitere Punkte klicken · Enter = Riegel erzeugen": "Click more points · Enter = create the bar",
  "Werkzeug wählen: L Linie · P Push/Pull · M Verschieben · R Riegel · Leertaste Auswahl": "Pick a tool: L line · P push/pull · M move · R bar · Space select",
  "Polygon": "Polygon",
  "Ersten Stützpunkt klicken": "Click the first vertex",
  "Nächsten Stützpunkt klicken": "Click the next vertex",
  "Nächsten Stützpunkt klicken oder Startpunkt = Polygon schließen": "Click the next vertex or the start point to close the polygon",
  "Ziehen verschiebt (Strg = Kopie, Alt = ohne Fang) · oranger Griff dreht · Pfeile 0,1 m · Entf löscht": "Drag moves (Ctrl = copy, Alt = no snapping) · orange handle rotates · arrows 0.1 m · Del deletes",
  "Block anklicken oder Rahmen ziehen (nach rechts = ganz drin, nach links = berührt) · Leertaste + Ziehen verschiebt die Karte": "Click a block or drag a frame (to the right = fully inside, to the left = touching) · Space + drag pans the map",
  "Block anklicken oder Rahmen ziehen (nach rechts = ganz drin, nach links = berührt)": "Click a block or drag a frame (to the right = fully inside, to the left = touching)",
  "In die Parzelle klicken = Baukörper setzen": "Click into the parcel = place a building volume",
  // 101-07 context menu
  "Befehl beenden": "End command",
  "Wiederholen:": "Repeat:",
  "Letzten Befehl wiederholen": "Repeat last command",
  "Alles einpassen": "Zoom extents",
  "2× Mausrad": "2× wheel",
  // 101: plot boundary label in the massing plan
  "Flst.": "Parcel",
  "Grundstück (geschätzt)": "Plot (estimated)",
  "Grundstücksgrenze": "Plot boundary",
  // 101-02 plot boundary
  "Ecke der Grundstücksgrenze ziehen": "Drag a corner of the plot boundary",
  "Flurstücke Bayern (amtlich)": "Parcels Bavaria (official)",
  "Ziehe die grünen Ecken an die Grundstücksgrenze (amtliche Flurstücke als Hintergrund) — dann gilt das Grundstück als gezeichnet.": "Drag the green corners onto the plot boundary (official parcels in the background) — the plot then counts as drawn.",
};
