// Gewerke-Sortierung nach Ausschreibungsnummer — aus JBs avaUtils (Rückgabe 260821)
// herausgelöst und nach @core verschoben: @ifc (IfcViewer-Seite) und @ava brauchen sie
// beide, dürfen einander aber nicht importieren (ESLint-Boundary).
// Sortierung der Gewerke nach ihrer Ausschreibungsnummer, kleinste zuerst.
// Die Namen tragen die Nummer vorne, teils mit Buchstabenzusatz: „004 Rohbau…",
// „011a Vorgezogene Rohbauarbeiten". Gewerke ohne Nummer (Altbestand aus dem
// Prototyp) kommen dahinter, alphabetisch.
export function tradeSortKey(trade = "") {
  // Der Buchstabenzusatz muss direkt an der Nummer hängen („011a"), sonst würde
  // bei „002 Garten…" das erste Wort als Zusatz gelesen und 002a einsortiert davor.
  const m = String(trade).match(/^\s*(\d+)([a-zA-Z]*)/);
  return m ? { nr: Number(m[1]), suffix: m[2].toLowerCase(), name: String(trade) }
    : { nr: Number.POSITIVE_INFINITY, suffix: "", name: String(trade) };
}
export const byTrade = (a, b) => {
  const x = tradeSortKey(a), y = tradeSortKey(b);
  if (x.nr !== y.nr) return x.nr - y.nr;
  if (x.suffix !== y.suffix) return x.suffix.localeCompare(y.suffix, "de");
  return x.name.localeCompare(y.name, "de", { numeric: true });
};

