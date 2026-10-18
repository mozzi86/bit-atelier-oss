// Command line prompts (phase 101-06, user 18.10.2026: "eine kleine Kommandozeile, damit wir wissen,
// welcher Befehl gerade ausgeführt wird und was die nächste Eingabe erwartet").
//
// In:  the active tool of the Massing-Studio modeller and its step state (clicked points, selection,
//      base point). Out: {befehl, aufforderung} as German UI strings (translated by the caller via t()).
// Pure, no DOM — node-testable; the Befehlszeile component only renders what comes out of here.

/** Tool id → command name shown in the command line. */
export const BEFEHLE = Object.freeze({
  auswahl: "Auswahl", linie: "Linie", pushpull: "Push/Pull", verschieben: "Verschieben", drehen: "Drehen",
  skalieren: "Skalieren", folgemir: "Folge mir", gelaende: "Gelände", riegel: "Riegel",
});

/**
 * What the modeller expects next.
 * @param {string|null} werkzeug active tool id (null = none)
 * @param {{punkte?: Array<any>, auswahl?: Array<any>, start?: any}} [zustand] step state of the modeller
 * @returns {{befehl: string, aufforderung: string}}
 */
export function befehlsAufforderung(werkzeug, zustand = {}) {
  const n = zustand.punkte?.length || 0;
  const gewaehlt = (zustand.auswahl?.length || 0) > 0;
  const befehl = (werkzeug && BEFEHLE[werkzeug]) || "Bereit";
  /** @type {string} */
  let a;
  switch (werkzeug) {
    case "auswahl":
      a = gewaehlt ? "Ecken ziehen formt den Körper · Umschalt+Klick ergänzt · Entf löscht" : "Körper anklicken (Umschalt = mehrere)";
      break;
    case "linie":
      a = n === 0 ? "Ersten Punkt klicken"
        : n < 3 ? "Nächsten Punkt klicken oder Länge tippen + Enter"
          : "Nächsten Punkt klicken oder Startpunkt klicken = Fläche schließen";
      break;
    case "pushpull":
      a = gewaehlt ? "Höhe tippen + Enter (Strg+Enter = aufstocken) oder in 3D ziehen" : "Körper anklicken";
      break;
    case "verschieben":
      a = !gewaehlt && !zustand.start ? "Körper anklicken"
        : !zustand.start ? "Basispunkt klicken"
          : "Ziel klicken (Strg = Kopie) oder Abstand tippen + Enter";
      break;
    case "drehen":
      a = gewaehlt ? "Winkel in Grad tippen + Enter" : "Körper anklicken";
      break;
    case "skalieren":
      a = gewaehlt ? "Faktor tippen + Enter" : "Körper anklicken";
      break;
    case "folgemir":
      a = n === 0 ? "Ersten Pfadpunkt klicken" : "Weitere Pfadpunkte klicken · Enter = fertig (oder Breite;Höhe tippen)";
      break;
    case "gelaende":
      a = "In den Plan klicken";
      break;
    case "riegel":
      a = n < 2 ? "Pfadpunkte klicken (mindestens 2)" : "Weitere Punkte klicken · Enter = Riegel erzeugen";
      break;
    default:
      a = "Werkzeug wählen: L Linie · P Push/Pull · M Verschieben · R Riegel · Leertaste Auswahl";
  }
  return { befehl, aufforderung: a };
}

/**
 * 101-06: command line of the site plan (Baufeld-Planung).
 * @param {'building'|'polygon'|'auswahl'} modus tool of the site plan
 * @param {{entwurf?: number, gewaehlt?: number, karte?: boolean}} [zustand] points of the polygon draft,
 *   number of selected blocks, whether the map (not the SVG fallback) is shown
 * @returns {{befehl: string, aufforderung: string}}
 */
export function baufeldAufforderung(modus, zustand = {}) {
  const n = zustand.entwurf || 0;
  if (modus === "polygon") {
    return { befehl: "Polygon", aufforderung: n === 0 ? "Ersten Stützpunkt klicken"
      : n < 3 ? "Nächsten Stützpunkt klicken" : "Nächsten Stützpunkt klicken oder Startpunkt = Polygon schließen" };
  }
  if (modus === "auswahl") {
    return { befehl: "Auswahl", aufforderung: zustand.gewaehlt
      ? "Ziehen verschiebt (Strg = Kopie, Alt = ohne Fang) · oranger Griff dreht · Pfeile 0,1 m · Entf löscht"
      : zustand.karte ? "Block anklicken oder Rahmen ziehen (nach rechts = ganz drin, nach links = berührt) · Leertaste + Ziehen verschiebt die Karte"
        : "Block anklicken oder Rahmen ziehen (nach rechts = ganz drin, nach links = berührt)" };
  }
  return { befehl: "Baukörper", aufforderung: "In die Parzelle klicken = Baukörper setzen" };
}
