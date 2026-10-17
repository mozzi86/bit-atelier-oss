// STLB-Bau Leistungsbereiche with an order on site (phase 97-02a). Moved from the app's
// src/lib/planung/bauablauf.js so that the element data sheet in @core and the schedule read
// the SAME catalogue; bauablauf re-exports it as GEWERKE_KATALOG.
//
// 97-02a changes:
// - Abbruch- und Rückbauarbeiten is LB 084 (was wrongly 040; 040 is Wärmeversorgungsanlagen —
//   Betriebseinrichtungen). A schedule task saved with "040" before now reads as heating plant;
//   `LB_ALT` lets the UI point at it.
// - Building services (TGA), steel, windows, screed and fire stopping added, so every element of
//   the data sheet — architecture, structure, services, penetrations — has a trade.
//
// `folge` (= position in the list) is the [ASSUMED] usual sequence of a new building (site setup → demolition → earthworks
// → shell → envelope → services rough-in → fit-out → finishes); not a standard — a different
// order only produces a hint.

/** @type {ReadonlyArray<{lb: string, name: string, folge: number}>} */
export const STLB_LB = Object.freeze([
  { lb: "000", name: "Sicherheitseinrichtungen, Baustelleneinrichtungen" },
  { lb: "084", name: "Abbruch- und Rückbauarbeiten" },
  { lb: "002", name: "Erdarbeiten" },
  { lb: "006", name: "Spezialtiefbauarbeiten" },
  { lb: "013", name: "Betonarbeiten" },
  { lb: "012", name: "Mauerarbeiten" },
  { lb: "017", name: "Stahlbauarbeiten" },
  { lb: "016", name: "Zimmer- und Holzbauarbeiten" },
  { lb: "018", name: "Abdichtungsarbeiten" },
  { lb: "020", name: "Dachdeckungsarbeiten" },
  { lb: "021", name: "Dachabdichtungsarbeiten" },
  { lb: "026", name: "Fenster, Außentüren" },
  { lb: "031", name: "Metallbauarbeiten" },
  { lb: "040", name: "Wärmeversorgungsanlagen – Betriebseinrichtungen" },
  { lb: "041", name: "Wärmeversorgungsanlagen – Leitungen, Armaturen, Heizflächen" },
  { lb: "042", name: "Gas- und Wasseranlagen – Leitungen, Armaturen" },
  { lb: "044", name: "Abwasseranlagen – Leitungen, Abläufe, Armaturen" },
  { lb: "075", name: "Raumlufttechnische Anlagen" },
  { lb: "053", name: "Niederspannungsanlagen – Kabel/Leitungen, Verlegesysteme" },
  { lb: "047", name: "Dämm- und Brandschutzarbeiten an technischen Anlagen" },
  { lb: "039", name: "Trockenbauarbeiten" },
  { lb: "023", name: "Putz- und Stuckarbeiten" },
  { lb: "025", name: "Estricharbeiten" },
  { lb: "024", name: "Fliesen- und Plattenarbeiten" },
  { lb: "036", name: "Bodenbelagarbeiten" },
  { lb: "027", name: "Tischlerarbeiten" },
  { lb: "029", name: "Beschlagarbeiten" },
  { lb: "045", name: "Gas-, Wasser- und Entwässerungsanlagen – Ausstattung, Elemente" },
  { lb: "034", name: "Maler- und Lackierarbeiten" },
].map((g, i) => Object.freeze({ ...g, folge: i })));

/** Codes whose meaning changed in 97-02a: old code → what it meant before. */
export const LB_ALT = Object.freeze({ "040": "Abbruch- und Rückbauarbeiten (bis 97-02a, jetzt LB 084)" });

/**
 * @param {string|null|undefined} lb
 * @returns {{lb: string, name: string, folge: number}|null}
 */
export function lbEintrag(lb) {
  return STLB_LB.find((g) => g.lb === String(lb ?? "")) || null;
}
