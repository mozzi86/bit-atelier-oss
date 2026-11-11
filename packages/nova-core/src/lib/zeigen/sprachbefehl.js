// 106-05: the command grammar for spoken (and typed) German sentences - "deterministic first, model later"
// (guard rail 4 of phase 106). A sentence the grammar understands needs no language model: it becomes a command of the
// viewer's register (106-02 selection commands, 106-03 change commands) with its parameters. A sentence it does NOT
// understand returns null, and only then may a language model be asked (sprechAblauf.js).
//
// What the grammar never does:
//  - it never changes anything: a change sentence only becomes a command that makes a PROPOSAL (106-03); the change runs in
//    "bestaetigen", after a person said yes (decision D-IM-04),
//  - it never guesses a target: "dieses", "diese", "dort", "hier" and a bare noun ("die Wand") all mean THE CURRENT SELECTION;
//    without a selection the sentence is refused with the text of the core (KEINE_AUSWAHL_TEXT), and a noun that does not fit the
//    selected element's class ("die Wand" while a column is selected) is refused too (guard rail 3: ground truth is the GUID),
//  - it never fills a gap: a missing unit ("50 nach links"), direction, factor or angle is refused with a sentence that says what
//    is missing.
//
// Numbers and units: digits ("50 cm", "0,5 m", "2,5"), number words ("fünfzig Zentimeter", "einundzwanzig", "zweihundert"), halves
// ("einen halben Meter", "zweieinhalb Meter", "anderthalb"), "komma" ("zwei Komma fünf"), and "zwei Meter fünfzig" (= 2,50 m).
// Lengths come out in m, angles in degrees, factors unitless.
//
// Directions are relative to the VIEW: the viewer hands in `kontext.ansicht = {rechts: {x, z}, vorn: {x, z}}` - unit vectors in
// the plan (m; x east, z plan "down") for "screen right" and "into the screen". "links/rechts" are screen left/right, "zurück/hinten"
// is away from the viewer, "vor/vorne" is towards the viewer [ASSUMED: like a front view; the preview shows the ghost before anything runs],
// "hoch/runter" is y (up). Without a view a horizontal direction is refused.
//
// In:  the sentence (a transcript or typed text) and the context {auswahl, ansicht?, zeigepunkt?} the viewer reads at that moment.
// Out: null (not understood) or one of
//        {art: "befehl", befehl, params, verstanden}  a register command to run (verstanden: the sentence in words),
//        {art: "zurueck"}                             "rückgängig" - the voice path asks "ja/nein" first (sprechAblauf.js),
//        {art: "abgelehnt", grund}                    understood, but refused with a German reason.
// Pure: no DOM, no React, no register - node-testable.
import { eigenschaftFeld, gleich, zahlText } from "./aenderungen.js";
import { KEINE_AUSWAHL_TEXT } from "./auswahlKontext.js";
import { erlaubteWerte } from "./befehlsBibliothek.js";
import { punktePruefen } from "./anlegen.js";

/** @typedef {{auswahl?: {anzahl?: number, bauteile?: Array<{guid?: string|null, klasse?: string|null}>}|null,
 *   ansicht?: {rechts: {x: number, z: number}, vorn: {x: number, z: number}}|null, zeigepunkt?: {x: number, z: number}|null,
 *   gesprochen?: boolean, bibliothek?: ReadonlyArray<{satz: string, eigenschaft: string, label: string, werte: any[]}>,
 *   punkte?: ReadonlyArray<{x: number, z: number, level?: number}>|null}} SprachKontext
 *   punkte (261111-zs1): the numbered pointing points of the plan (m). Given as a list, a creating sentence with the wrong number of points is
 *   refused here; not given (undefined), the command checks them.
 *   gesprochen: the sentence is a transcript of the speech recognition - a confirmation then needs an unambiguous word (JA_GESPROCHEN).
 *   bibliothek (106-10): the office's templates (befehlsBibliothek.js bibliothekNormen) - a fitting sentence becomes the property command,
 *   and a property they restrict takes only their values (also in the free "setze ... auf ..." form). */

/** @param {object} o @param {string} k @returns {boolean} own key (a word like "constructor" is not in the table) */
const hatKey = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** Word → digit value of the single number words 0-9 (umlaut-free spelling, see normalisieren). */
const EINER = { null: 0, ein: 1, eins: 1, eine: 1, einen: 1, einem: 1, einer: 1, zwei: 2, zwo: 2, drei: 3, vier: 4, fuenf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9 };
/** 10-19. */
const SONDER = { zehn: 10, elf: 11, zwoelf: 12, dreizehn: 13, vierzehn: 14, fuenfzehn: 15, sechzehn: 16, siebzehn: 17, achtzehn: 18, neunzehn: 19 };
/** Tens. */
const ZEHNER = { zwanzig: 20, dreissig: 30, vierzig: 40, fuenfzig: 50, sechzig: 60, siebzig: 70, achtzig: 80, neunzig: 90 };

/** Unit word → metres per unit. */
const EINHEIT_M = { mm: 0.001, millimeter: 0.001, millimetern: 0.001, cm: 0.01, zentimeter: 0.01, centimeter: 0.01, zentimetern: 0.01, m: 1, meter: 1, metern: 1 };

/** First word of a command sentence: the verbs the grammar knows (stems). */
const VERB_ANFANG = /^(verschieb|schieb|versetz|beweg|verrueck|zieh|rueck(e|en|t)?$|dreh|rotier|verdreh|skalier|vergroesser|verkleiner|streck|stauch|verdopp|verdreifach|teil|halbier|trenn|zerleg|zerteil|spalte|zerschneid|schneid|setz|aender|stell|trag|mach|markier|kennzeichn|stuf|weis|zeig|zoom|spring|fokussier|zentrier|rahm|pruef|kontrollier|check|lies|lese|nenn|beschreib|sag|heb|was|welche)/;
/** Last word of a sentence with the verb at the end (infinitive): "… verschieben", "… drehen", "… teilen", "… setzen". */
const VERB_ENDE = /^(verschieben|schieben|versetzen|bewegen|drehen|rotieren|skalieren|vergroessern|verkleinern|teilen|halbieren|trennen|setzen|aendern|stellen|markieren|pruefen)$/;

/** Words that carry no meaning for the grammar (politeness, fillers) and are dropped everywhere. */
const FUELLWORTE = new Set(["bitte", "mal", "doch", "danke", "gern", "gerne", "einfach", "jetzt", "dann", "also", "eben", "bisschen", "kurz", "noch"]);

/**
 * Words that mean "the current selection" ("dieses" etc.) or name a kind of element. A noun with a known class is checked against the selection.
 * Class patterns match the IFC class the viewers report (IfcWall, IfcWallStandardCase, IfcColumn, ...).
 * @type {Record<string, RegExp|null>}
 */
const NOMEN = {
  wand: /^ifcwall/i, waende: /^ifcwall/i, mauer: /^ifcwall/i, huellwand: /^ifcwall/i,
  stuetze: /^ifccolumn/i, saeule: /^ifccolumn/i,
  fenster: /^ifcwindow/i, tuer: /^ifcdoor/i,
  decke: /^ifc(slab|covering)/i, geschossdecke: /^ifc(slab|covering)/i, platte: /^ifcslab/i,
  dach: /^ifcroof/i, raum: /^ifcspace/i,
  bauteil: null, element: null, objekt: null,
};
/** Noun → word for the refusal sentence ("Ausgewählt ist …, nicht …"). */
const NOMEN_WORT = { wand: "eine Wand", waende: "eine Wand", mauer: "eine Wand", huellwand: "eine Wand", stuetze: "eine Stütze", saeule: "eine Stütze", fenster: "ein Fenster", tuer: "eine Tür", decke: "eine Decke", geschossdecke: "eine Decke", platte: "eine Decke", dach: "ein Dach", raum: "ein Raum" };
/**
 * IFC class → German word for the refusal sentence.
 * @type {Array<[RegExp, string]>}
 */
const KLASSE_WORT = [[/^ifcwall/i, "eine Wand"], [/^ifccolumn/i, "eine Stütze"], [/^ifcwindow/i, "ein Fenster"], [/^ifcdoor/i, "eine Tür"], [/^ifcslab/i, "eine Decke"], [/^ifccovering/i, "eine Decke"], [/^ifcroof/i, "ein Dach"], [/^ifcspace/i, "ein Raum"]];

/** Spoken property name → the name the change command accepts (eigenschaftFeld in aenderungen.js resolves it). */
const EIGENSCHAFT_NAME = {
  brandschutz: "feuerwiderstand", brandschutzklasse: "feuerwiderstand", feuerwiderstand: "feuerwiderstand", feuerwiderstandsklasse: "feuerwiderstand", feuerwiderstandsdauer: "feuerwiderstand", feuerschutz: "feuerwiderstand",
  status: "status", umbaustatus: "status",
  kostengruppe: "kg", kg: "kg",
  leistungsbereich: "lb", lb: "lb",
  bauabschnitt: "bauabschnitt",
  bauteiltyp: "bauteiltyp", typ: "bauteiltyp",
  material: "material", baustoff: "material",
  tragend: "tragend",
  statikvermerk: "statik_vermerk", vermerk: "statik_vermerk",
};

/** Direction word → [axis, sign]: axis "rechts" (screen right), "vorn" (into the screen) or "y" (up). */
const RICHTUNG = {
  links: ["rechts", -1], linke: ["rechts", -1], linken: ["rechts", -1], rechts: ["rechts", 1], rechte: ["rechts", 1], rechten: ["rechts", 1],
  zurueck: ["vorn", 1], hinten: ["vorn", 1], rueckwaerts: ["vorn", 1],
  vor: ["vorn", -1], vorn: ["vorn", -1], vorne: ["vorn", -1], vorwaerts: ["vorn", -1],
  hoch: ["y", 1], hinauf: ["y", 1], oben: ["y", 1], hoeher: ["y", 1], rauf: ["y", 1], aufwaerts: ["y", 1],
  runter: ["y", -1], herunter: ["y", -1], hinunter: ["y", -1], unten: ["y", -1], tiefer: ["y", -1], abwaerts: ["y", -1],
};
/** Display word of a direction for the sentence in words. */
const RICHTUNG_WORT = { rechts: ["nach links", "nach rechts"], vorn: ["nach vorn (zum Betrachter hin)", "nach hinten (vom Betrachter weg)"], y: ["nach unten", "nach oben"] };

// ---------------------------------------------------------------------------------------------------------------
// Text → tokens

/**
 * Splits a sentence into words. Returns the words as spoken/typed (`roh`, case kept) and in the comparison form (`norm`: lower case,
 * umlauts written out, no punctuation). Both lists have the same length; a decimal comma/dot between digits is kept in the number
 * ("0,5" → "0.5"), a unit glued to a number ("50cm", "90°", "20%") is split off.
 * @param {string} text  A sentence (a transcript or typed).
 * @returns {{roh: string[], norm: string[]}}
 */
export function zerlege(text) {
  let s = String(text ?? "").replace(/(\d)[,](\d)/g, "$1.$2").replace(/°/g, " grad ").replace(/%/g, " prozent ");
  s = s.replace(/(\d)\s*(mm|cm|m|grad|prozent)\b/gi, "$1 $2").replace(/[^A-Za-z0-9ÄÖÜäöüß._$-]+/g, " ");
  // a dot that is not inside a number ("fertig.") is punctuation; a dash only counts inside a word ("F90-AB", "Pset_X")
  s = s.replace(/\.(?!\d)/g, " ").replace(/(^|\s)-+(?=\s|$)/g, " ");
  const roh = s.split(/\s+/).filter(Boolean);
  const norm = roh.map((w) => w.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss"));
  return { roh, norm };
}

/**
 * The comparison form of a sentence (lower case, umlauts written out, no punctuation, single blanks).
 * @param {string} text @returns {string}
 */
export function normalisieren(text) {
  return zerlege(text).norm.join(" ");
}

// ---------------------------------------------------------------------------------------------------------------
// Numbers

/** @param {string} w @returns {number|null} 0-99 from a number word ("fuenf", "zwoelf", "einundzwanzig"), else null */
function unterHundert(w) {
  if (hatKey(EINER, w)) return EINER[/** @type {keyof typeof EINER} */ (w)];
  if (hatKey(SONDER, w)) return SONDER[/** @type {keyof typeof SONDER} */ (w)];
  if (hatKey(ZEHNER, w)) return ZEHNER[/** @type {keyof typeof ZEHNER} */ (w)];
  const m = /^(.+)und(.+)$/.exec(w);
  if (m && hatKey(EINER, m[1]) && m[1] !== "null" && hatKey(ZEHNER, m[2])) return EINER[/** @type {keyof typeof EINER} */ (m[1])] + ZEHNER[/** @type {keyof typeof ZEHNER} */ (m[2])];
  return null;
}

/**
 * Value of a single (compound) German number word, 0-9999: "fuenfzig", "einundzwanzig", "hundertfuenfzig", "zweihundert", "dreitausend".
 * @param {string} w  Comparison form (norm). @returns {number|null} null when it is not a number word
 */
export function wortZahl(w) {
  const t = /^(.*?)tausend(.*)$/.exec(w);
  if (t) {
    const vor = t[1] ? wortZahl(t[1]) : 1;
    const rest = t[2] ? wortZahl(t[2]) : 0;
    return vor == null || rest == null || vor >= 10 ? null : vor * 1000 + rest;
  }
  const h = /^(.*?)hundert(.*)$/.exec(w);
  if (h) {
    const vor = h[1] ? unterHundert(h[1]) : 1;
    const rest = h[2] ? unterHundert(h[2]) : 0;
    return vor == null || rest == null || vor >= 10 || vor < 1 ? null : vor * 100 + rest;
  }
  return unterHundert(w);
}

/**
 * Reads one number at token `i`: digits ("50", "0.5"), a number word, "halb(en)", "anderthalb", "zweieinhalb", "einen halben", and the
 * "komma" form ("zwei komma fünf", "null komma zwei fünf").
 * @param {string[]} norm  Comparison tokens. @param {number} i  Start index.
 * @returns {{wert: number, laenge: number}|null}  Value and number of tokens used, null when no number starts here.
 */
export function zahlLesen(norm, i) {
  const t = norm[i];
  if (t == null) return null;
  /** @type {number|null} */ let wert = null;
  let laenge = 1;
  if (/^\d+(\.\d+)?$/.test(t)) wert = parseFloat(t);
  else if (t === "anderthalb" || t === "eineinhalb") wert = 1.5;
  else if (/^(.+)einhalb$/.test(t)) { const v = unterHundert(/** @type {RegExpExecArray} */ (/^(.+)einhalb$/.exec(t))[1]); wert = v == null ? null : v + 0.5; }
  else if (/^halb(e|en|er|es)?$/.test(t)) wert = 0.5;
  else wert = wortZahl(t);
  if (wert == null) return null;
  // "einen halben Meter": one + half = half
  if (wert === 1 && /^halb(e|en|er|es)?$/.test(norm[i + 1] ?? "") && /^ein/.test(t)) return { wert: 0.5, laenge: 2 };
  // "zwei komma fünf": digits after the comma, one token each (or one digit string)
  if (norm[i + laenge] === "komma" && Number.isInteger(wert)) {
    let nach = "";
    let k = i + laenge + 1;
    while (k < norm.length) {
      const d = norm[k];
      if (/^\d+$/.test(d)) nach += d;
      else if (hatKey(EINER, d) && d !== "eins" && !/^ein/.test(d)) nach += String(EINER[/** @type {keyof typeof EINER} */ (d)]);
      else break;
      k++;
      if (/^\d{2,}$/.test(d)) break;
    }
    if (nach) return { wert: parseFloat(`${wert}.${nach}`), laenge: k - i };
  }
  return { wert, laenge };
}

/**
 * Reads a length at token `i`: number + unit ("fünfzig Zentimeter", "0.5 m"), plus "zwei Meter fünfzig" (= 2,50 m).
 * @param {string[]} norm @param {number} i
 * @returns {{meter: number|null, laenge: number, roh: number}|null}  `meter` null when the number has no unit (the caller refuses: unit missing);
 *   null when no number starts here.
 */
export function laengeLesen(norm, i) {
  const z = zahlLesen(norm, i);
  if (!z) return null;
  const einheit = norm[i + z.laenge];
  if (!einheit || !hatKey(EINHEIT_M, einheit)) return { meter: null, laenge: z.laenge, roh: z.wert };
  const faktor = EINHEIT_M[/** @type {keyof typeof EINHEIT_M} */ (einheit)];
  let meter = z.wert * faktor;
  let laenge = z.laenge + 1;
  // "zwei Meter fünfzig": the second number without a unit is centimetres (below 100)
  if (faktor === 1) {
    const rest = zahlLesen(norm, i + laenge);
    const dahinter = rest ? norm[i + laenge + rest.laenge] : null;
    if (rest && rest.wert < 100 && Number.isInteger(rest.wert) && !(dahinter && hatKey(EINHEIT_M, dahinter))) {
      meter += rest.wert / 100;
      laenge += rest.laenge;
    }
  }
  return { meter: Math.round(meter * 1e6) / 1e6, laenge, roh: z.wert };
}

// ---------------------------------------------------------------------------------------------------------------
// Helpers

/** @param {string} grund @returns {{art: "abgelehnt", grund: string}} */
const ablehnen = (grund) => ({ art: "abgelehnt", grund });

/** @param {number} v @returns {number} rounded to 1e-6 (m, degrees) so sums such as 0.1 + 0.2 stay readable */
const rund = (v) => Math.round(v * 1e6) / 1e6;

/**
 * Which kind of element the sentence names (first known noun), checked against the selection.
 * @param {string[]} norm @param {SprachKontext} kontext
 * @returns {string|null}  A refusal text, or null when it fits (or no class-bearing noun was named).
 */
function nomenPruefen(norm, kontext) {
  const nomen = norm.find((w) => hatKey(NOMEN, w) && NOMEN[w] != null);
  if (!nomen) return null;
  const klasse = kontext.auswahl?.bauteile?.[0]?.klasse;
  if (!klasse || (kontext.auswahl?.anzahl ?? 0) !== 1) return null; // no class to compare, or a multi selection (the command refuses that)
  if (/** @type {RegExp} */ (NOMEN[nomen]).test(klasse)) return null;
  const ist = KLASSE_WORT.find(([re]) => re.test(klasse))?.[1] ?? `ein Bauteil der Klasse ${klasse}`;
  const soll = NOMEN_WORT[/** @type {keyof typeof NOMEN_WORT} */ (nomen)] ?? nomen;
  return `Ausgewählt ist ${ist}, nicht ${soll} — erst das richtige Bauteil zeigen`;
}

/**
 * A sentence that changes something needs a selection; refused here with the same text as the core.
 * @param {SprachKontext} kontext @returns {string|null}
 */
function auswahlFehlt(kontext) {
  return (kontext.auswahl?.anzahl ?? 0) > 0 ? null : KEINE_AUSWAHL_TEXT;
}

/** @param {string[]} norm @param {string[]} woerter @returns {boolean} whether one of the words occurs */
const hat = (norm, woerter) => norm.some((w) => woerter.includes(w));

// ---------------------------------------------------------------------------------------------------------------
// Sentence rules

/** Whole sentences that confirm the open proposal when TYPED (keyboard: what is on the screen is what was meant). */
const JA = new Set(["ja", "jawohl", "jep", "jup", "ok", "okay", "uebernehmen", "uebernimm", "uebernimm das", "uebernimm es", "bestaetigen", "bestaetige", "bestaetige das", "ausfuehren", "fuehre aus", "fuehr aus", "mach das", "mach es", "ja uebernehmen", "ja mach das", "ja bitte", "ja ausfuehren", "ja bestaetigen", "ja uebernimm", "ja passt"]);
/**
 * Whole sentences that confirm when SPOKEN: only unambiguous words. "ok", "okay", "mach das", "ausführen" are left out - a recognition error
 * on noise or a cut-off "mach das rückgängig" must not apply a change (review 106-05); typed they still work.
 */
export const JA_GESPROCHEN = new Set(["ja", "jawohl", "ja bitte", "uebernehmen", "uebernimm", "uebernimm das", "uebernimm es", "ja uebernehmen", "ja uebernimm",
  "bestaetigen", "bestaetige", "bestaetige das", "ja bestaetigen"]);
const NEIN = new Set(["nein", "nee", "nope", "abbrechen", "abbruch", "verwerfen", "verwirf", "verwirf das", "verwirf es", "stopp", "stop", "lass das", "lass es", "vergiss das", "vergiss es", "nein danke", "nicht uebernehmen", "nein verwerfen", "nein abbrechen", "doch nicht"]);
const ZURUECK = new Set(["rueckgaengig", "zurueck", "zurueck nehmen", "zuruecknehmen", "nimm das zurueck", "nimm es zurueck", "mach das rueckgaengig", "mach es rueckgaengig", "letzten schritt zurueck", "letzten schritt zuruecknehmen", "letzten schritt rueckgaengig", "letzten schritt zurueck nehmen", "das rueckgaengig", "rueckgaengig machen", "undo"]);

/**
 * Reads the movement of a "verschiebe" sentence: pairs of length and direction in any order, summed to one vector.
 * @param {string[]} norm @param {SprachKontext} kontext
 * @returns {{verschiebung_m: [number, number, number], text: string}|{art: "abgelehnt", grund: string}}
 */
function verschiebungLesen(norm, kontext) {
  /** @type {Array<{art: "mass", meter: number|null, roh: number, i: number}|{art: "richtung", achse: string, vorzeichen: number, wort: string}>} */
  const ereignisse = [];
  for (let i = 0; i < norm.length; i++) {
    const l = laengeLesen(norm, i);
    if (l) { ereignisse.push({ art: "mass", meter: l.meter, roh: l.roh, i }); i += l.laenge - 1; continue; }
    const r = hatKey(RICHTUNG, norm[i]) ? /** @type {[string, number]} */ (RICHTUNG[/** @type {keyof typeof RICHTUNG} */ (norm[i])]) : null;
    if (r) ereignisse.push({ art: "richtung", achse: r[0], vorzeichen: r[1], wort: norm[i] });
  }
  const masse = ereignisse.filter((e) => e.art === "mass");
  const richtungen = ereignisse.filter((e) => e.art === "richtung");
  if (!masse.length) return ablehnen("Das Maß fehlt — z. B. „verschiebe dieses 50 Zentimeter nach links“");
  if (masse.some((m) => m.art === "mass" && m.meter == null)) return ablehnen("Die Einheit fehlt — Millimeter, Zentimeter oder Meter sagen (z. B. „50 Zentimeter“)");
  if (!richtungen.length) return ablehnen("Die Richtung fehlt — links, rechts, vor, zurück, hoch oder runter");
  // pair a length with the direction right behind it ("50 cm nach links") or right in front of it ("nach links 50 cm"); every one must be paired
  /** @type {Array<{meter: number, achse: string, vorzeichen: number}>} */
  const paare = [];
  const benutzt = new Set();
  for (let k = 0; k < ereignisse.length; k++) {
    if (benutzt.has(k)) continue;
    const e = ereignisse[k], n = ereignisse[k + 1];
    if (e.art === "mass" && n?.art === "richtung" && !benutzt.has(k + 1)) { paare.push({ meter: /** @type {number} */ (e.meter), achse: n.achse, vorzeichen: n.vorzeichen }); benutzt.add(k); benutzt.add(k + 1); }
    else if (e.art === "richtung" && n?.art === "mass" && !benutzt.has(k + 1)) { paare.push({ meter: /** @type {number} */ (n.meter), achse: e.achse, vorzeichen: e.vorzeichen }); benutzt.add(k); benutzt.add(k + 1); }
  }
  if (benutzt.size !== ereignisse.length) return ablehnen("Maß und Richtung gehören nicht eindeutig zusammen — je Richtung ein Maß sagen (z. B. „50 Zentimeter nach links und 20 Zentimeter nach oben“)");
  let dx = 0, dy = 0, dz = 0;
  /** @type {string[]} */
  const teile = [];
  for (const p of paare) {
    if (p.achse === "y") dy += p.vorzeichen * p.meter;
    else {
      const a = kontext.ansicht;
      if (!a) return ablehnen("Die Ansicht ist nicht bekannt — links, rechts, vor und zurück brauchen die 3D-Ansicht oder den Grundriss");
      const v = p.achse === "rechts" ? a.rechts : a.vorn;
      dx += p.vorzeichen * p.meter * v.x; dz += p.vorzeichen * p.meter * v.z;
    }
    teile.push(`${zahlText(p.meter)} m ${RICHTUNG_WORT[/** @type {keyof typeof RICHTUNG_WORT} */ (p.achse)][p.vorzeichen > 0 ? 1 : 0]}`);
  }
  return { verschiebung_m: [rund(dx), rund(dy), rund(dz)], text: teile.join(" und ") };
}

/**
 * The value of "setze … auf <Wert>" for a property, in the spelling the core's parser takes.
 * @param {string} name  Canonical property name. @param {string[]} roh  Raw value words. @param {string[]} norm  Comparison form of the same words.
 * @returns {string|null}  The value text, null when there is none.
 */
function wertAus(name, roh, norm) {
  if (!roh.length) return null;
  if (name === "feuerwiderstand") {
    // "F neunzig", "f 90", "EI 90", "ohne": letters + number joined; a number word becomes digits
    if (["ohne", "keine", "kein"].includes(norm[0])) return "ohne";
    return roh.map((w, i) => { const z = wortZahl(norm[i]); return z != null && !/^\d+$/.test(norm[i]) ? String(z) : w; }).join("").toUpperCase();
  }
  if (name === "kg" || name === "lb") {
    const z = wortZahl(norm.join(""));
    return /^\d+$/.test(roh.join("")) ? roh.join("") : z != null ? String(z) : roh.join(" ");
  }
  if (name === "tragend") {
    const s = norm.join(" ");
    if (["ja", "tragend", "wahr"].includes(s)) return "ja";
    if (["nein", "nicht tragend", "nichttragend", "falsch"].includes(s)) return "nein";
    return roh.join(" ");
  }
  return roh.join(" ");
}

/**
 * "setze/ändere/stelle <Eigenschaft> auf <Wert>", "<Eigenschaft> auf <Wert> setzen", "mach dieses (nicht) tragend", "markiere als Abbruch".
 * @param {string[]} norm @param {string[]} roh @returns {{name: string, wert: string, text: string}|{art: "abgelehnt", grund: string}|null} null when the sentence has no "auf <Wert>" form
 */
function eigenschaftLesen(norm, roh) {
  // "mach dieses tragend / nicht tragend"
  const tragIdx = norm.findIndex((w) => w === "tragend" || w === "nichttragend");
  if (["mach", "mache", "machen"].includes(norm[0]) && tragIdx >= 0 && !norm.includes("auf")) {
    const nicht = norm[tragIdx] === "nichttragend" || norm[tragIdx - 1] === "nicht";
    return { name: "tragend", wert: nicht ? "nein" : "ja", text: `Tragend: ${nicht ? "nein" : "ja"}` };
  }
  // "markiere dieses als Abbruch"
  const als = norm.indexOf("als");
  if (/^(markier|kennzeichn|stuf)/.test(norm[0]) && als >= 0 && als < norm.length - 1) {
    const wert = roh.slice(als + 1).join(" ");
    return { name: "status", wert, text: `Status: ${wert}` };
  }
  // "<name> auf <wert>": the property name is a known word BEFORE "auf", the value is everything after it
  const auf = norm.indexOf("auf");
  if (auf < 0) return null;
  let nameIdx = -1;
  for (let i = 0; i < auf; i++) if (hatKey(EIGENSCHAFT_NAME, norm[i])) nameIdx = i;
  // "statik vermerk" is spoken as two words
  if (nameIdx < 0 && norm.slice(0, auf).join("").includes("statikvermerk")) nameIdx = auf - 1;
  const name = nameIdx >= 0 ? EIGENSCHAFT_NAME[/** @type {keyof typeof EIGENSCHAFT_NAME} */ (norm[nameIdx])] ?? "statik_vermerk" : null;
  if (!name) return null;
  let wr = roh.slice(auf + 1), wn = norm.slice(auf + 1);
  while (wn.length && ["setzen", "aendern", "stellen", "ein", "zu"].includes(wn[wn.length - 1])) { wr = wr.slice(0, -1); wn = wn.slice(0, -1); }
  const wert = wertAus(name, wr, wn);
  if (wert == null || wert === "") return ablehnen(`Der Wert fehlt — „${roh[nameIdx]} auf …“ und dann den Wert sagen`);
  return { name, wert, text: `${roh[nameIdx]}: ${wert}` };
}

/** Words a template match skips in the sentence and in the template: references to the selection, articles, nouns of element kinds. */
const VORLAGE_SKIP = new Set(["dies", "diese", "dieses", "dieser", "diesen", "diesem", "das", "die", "der", "den", "dem", "des", "hier", "dort", "bei", "fuer", "von", "vom",
  ...Object.keys(NOMEN)]);

/** @param {string} w @returns {string} the word without a German verb ending (setze / setzen / setzt -> setz), for comparing a template word */
const stamm = (w) => (w.length > 4 ? w.replace(/(en|st|e|t)$/, "") : w);

/** Field name of the change tools -> the grammar's name for wertAus (feuerwiderstand, kg, lb, tragend, ...). @param {string} feld @returns {string} */
const grammatikName = (feld) => (feld === "gewerk_lb" ? "lb" : feld === "bauteil_typ" ? "bauteiltyp" : feld);

/**
 * 106-10: the sentence against the office's templates ("Setze {eigenschaft} auf {wert}", "Markiere als {wert}"). Fixed words must come in the
 * template's order (verb endings and words like "dieses", "die Wand" do not count); {eigenschaft} must name the template's property; {wert} is
 * the rest of the sentence and must be one of the template's values.
 * @param {string[]} norm @param {string[]} roh @param {SprachKontext["bibliothek"]} bibliothek
 * @returns {{name: string, wert: any, text: string}|{art: "abgelehnt", grund: string}|null}  null = no template fits.
 */
function vorlageLesen(norm, roh, bibliothek) {
  if (!bibliothek?.length) return null;
  const idx = norm.map((_, i) => i).filter((i) => !VORLAGE_SKIP.has(norm[i]));
  const sn = idx.map((i) => norm[i]), sr = idx.map((i) => roh[i]);
  for (const v of bibliothek) {
    const tz = zerlege(v.satz.replace("{eigenschaft}", " __eig__ ").replace("{wert}", " __wert__ ")).norm.filter((w) => !VORLAGE_SKIP.has(w) && !FUELLWORTE.has(w));
    let i = 0, passt = true;
    for (const w of tz.slice(0, -1)) {
      if (i >= sn.length) { passt = false; break; }
      if (w === "__eig__") {
        const name = hatKey(EIGENSCHAFT_NAME, sn[i]) ? EIGENSCHAFT_NAME[/** @type {keyof typeof EIGENSCHAFT_NAME} */ (sn[i])] : sn[i];
        if (eigenschaftFeld(name)?.feld !== v.eigenschaft) { passt = false; break; }
      } else if (w !== sn[i] && stamm(w) !== stamm(sn[i])) { passt = false; break; }
      i += 1;
    }
    if (!passt) continue;
    let wr = sr.slice(i), wn = sn.slice(i);
    while (wn.length && ["setzen", "aendern", "stellen", "ein", "zu"].includes(wn[wn.length - 1])) { wr = wr.slice(0, -1); wn = wn.slice(0, -1); }
    const liste = v.werte.join(", ");
    if (!wn.length) return ablehnen(`Der Wert fehlt — ${v.label}: ${liste}`);
    const def = eigenschaftFeld(v.eigenschaft);
    const roherWert = wertAus(grammatikName(v.eigenschaft), wr, wn) ?? "";
    /** @type {any} */
    let wert;
    try { wert = def ? def.parse(roherWert) : roherWert; } catch { return ablehnen(`„${roherWert}“ ist für ${v.label} nicht in der Befehlsbibliothek des Büros — erlaubt: ${liste}`); }
    if (!v.werte.some((x) => gleich(x, wert))) return ablehnen(`„${wert}“ ist für ${v.label} nicht in der Befehlsbibliothek des Büros — erlaubt: ${liste}`);
    return { name: v.eigenschaft, wert, text: `${v.label}: ${wert}` };
  }
  return null;
}

/**
 * 106-10: a value of the free "setze ... auf ..." form against the office's allowed values of that property.
 * @param {{name: string, wert: string}} e @param {SprachKontext["bibliothek"]} bibliothek
 * @returns {{art: "abgelehnt", grund: string}|null}  null = allowed, or the library does not restrict the property.
 */
function bibliothekVerbietet(e, bibliothek) {
  const erlaubt = erlaubteWerte(bibliothek || [], e.name);
  if (!erlaubt) return null;
  const def = eigenschaftFeld(e.name);
  /** @type {any} */
  let wert;
  try { wert = def ? def.parse(e.wert) : e.wert; } catch { wert = e.wert; }
  if (erlaubt.some((x) => gleich(x, wert))) return null;
  return ablehnen(`„${wert}“ ist für ${def?.label ?? e.name} nicht in der Befehlsbibliothek des Büros — erlaubt: ${erlaubt.join(", ")}`);
}

/**
 * Factor of a "skaliere" sentence.
 * @param {string[]} norm @returns {{faktor: number, text: string}|{art: "abgelehnt", grund: string}}
 */
function faktorLesen(norm) {
  const verb = norm[0] ?? "";
  if (/^verdopp/.test(verb)) return { faktor: 2, text: "Faktor 2" };
  if (/^verdreifach/.test(verb)) return { faktor: 3, text: "Faktor 3" };
  const so = norm.indexOf("so");
  if (so > 0 && /^gross|^gro/.test(norm[so + 1] ?? "")) {
    if (norm[so - 1] === "doppelt") return { faktor: 2, text: "doppelt so groß" };
    if (/^halb/.test(norm[so - 1])) return { faktor: 0.5, text: "halb so groß" };
    const z = zahlLesen(norm, so - 2);
    if (norm[so - 1] === "mal" && z) return { faktor: z.wert, text: `${zahlText(z.wert)}-mal so groß` };
  }
  const kleiner = /^verkleiner|^stauch/.test(verb) || hat(norm, ["kleiner", "weniger", "kleinere"]);
  for (let i = 0; i < norm.length; i++) {
    const z = zahlLesen(norm, i);
    if (!z) continue;
    const nach = norm[i + z.laenge];
    if (nach === "prozent") {
      if (!(z.wert > 0)) return ablehnen("Der Faktor muss größer als 0 sein");
      const auf = norm.slice(0, i).includes("auf");
      const f = auf ? z.wert / 100 : kleiner ? 1 - z.wert / 100 : 1 + z.wert / 100;
      if (!(f > 0)) return ablehnen("Der Faktor muss größer als 0 sein — nicht um 100 Prozent oder mehr verkleinern");
      return { faktor: rund(f), text: `${zahlText(z.wert)} Prozent` };
    }
    if (norm[i - 1] === "faktor" || (norm[i - 1] === "den" && norm[i - 2] === "faktor")) {
      if (!(z.wert > 0)) return ablehnen("Der Faktor muss größer als 0 sein");
      const um = norm.slice(0, i).includes("um");
      const f = kleiner && um ? 1 / z.wert : z.wert;
      return { faktor: rund(f), text: `Faktor ${zahlText(rund(f))}` };
    }
  }
  return ablehnen("Der Faktor fehlt — z. B. „skaliere dieses um Faktor 2“ oder „auf 120 Prozent“");
}

// ---------------------------------------------------------------------------------------------------------------
// 261111-zs1: creating elements, renaming rooms, demolishing

/** Words in front of the kind of a new element ("neue Wand", "eine Tür"). */
const NEU_WORTE = new Set(["neue", "neuer", "neues", "neu", "eine", "einen", "ein"]);
/** Verbs (at the end) that make a demolition: the element gets the status "abbruch" through the existing property change. */
const ABBRUCH_VERB = /^(abbrechen|abreissen|ausbauen|rueckbauen|zurueckbauen)$/;
/** Words that may stand in front of the demolition verb ("diese Wand abbrechen", "die Tür ausbauen"). */
const ABBRUCH_ERLAUBT = new Set(["dies", "diese", "dieses", "dieser", "diesen", "das", "die", "der", "den", "hier", "dort", "wand", "mauer", "tuer", "fenster", "stuetze", "bauteil", "element", "objekt"]);
/** Spoken wall word(s) -> kind of wall (anlegen.js WANDARTEN). */
const WAND_WORT = { wand: "wand", trockenbauwand: "trockenbau", mauerwerkswand: "mauerwerk", mauerwand: "mauerwerk" };
/** Words a new-wall sentence may carry beside kind and thickness ("neue Wand 24 cm dick"). */
const WAND_FUELL = new Set(["dick", "stark", "dicke", "staerke", "mit", "von"]);
/** Words a door sentence may carry beside width, fire rating and hinge side ("Tür 1,01 breit mit Anschlag DIN links"). */
const TUER_FUELL = new Set(["breit", "mit", "anschlag", "von", "und"]);
/** Plausible ranges [ASSUMED]: wall thickness 1-100 cm (a membrane is not a wall, more than 1 m is a block), door width 0.5-3.0 m. */
const WAND_DICKE_M = { min: 0.01, max: 1 };
const TUER_BREITE_M = { min: 0.5, max: 3 };

/** @param {string} s @returns {string} the text without quotes around it */
const ohneAnfuehrung = (s) => String(s ?? "").trim().replace(/^[„“"'‚‘»«]+|[„“"'‚‘»«]+$/g, "").trim();

/**
 * Number of points a creating sentence needs - refused here only when the viewer handed the points in.
 * @param {SprachKontext} kontext @param {number} anzahl @param {string} wofuer @returns {{art: "abgelehnt", grund: string}|null}
 */
function punkteFehlen(kontext, anzahl, wofuer) {
  if (!Array.isArray(kontext.punkte)) return null;
  const r = punktePruefen(kontext.punkte, anzahl, wofuer);
  return r.ok ? null : ablehnen(/** @type {any} */ (r).grund);
}

/**
 * Reads a number with an optional unit at token `i`.
 * @param {string[]} norm @param {number} i
 * @returns {{wert: number, faktor: number|null, laenge: number}|null}  faktor: metres per unit, null without a unit.
 */
function zahlEinheit(norm, i) {
  const z = zahlLesen(norm, i);
  if (!z) return null;
  const e = norm[i + z.laenge];
  if (e && hatKey(EINHEIT_M, e)) return { wert: z.wert, faktor: EINHEIT_M[/** @type {keyof typeof EINHEIT_M} */ (e)], laenge: z.laenge + 1 };
  return { wert: z.wert, faktor: null, laenge: z.laenge };
}

/**
 * The sentences of 261111-zs1: "neue Trockenbauwand 12,5", "Tür 1,01 T30-RS DIN links", "Notiz: Brüstung prüfen", "Raum 1.05 heißt jetzt Lager",
 * "dieser Raum heißt Lager", "Wand abbrechen", "Wand zwischen Raum 1.05 und 1.06 abbrechen". Never a guess: an unknown word in a creating
 * sentence, a missing size, a missing name is refused with what is missing. This function reads the note.
 * @param {string} text  The sentence as given (the note keeps its spelling). @param {SprachKontext} kontext
 * @returns {({art: "befehl", befehl: string, params: Record<string, any>, verstanden: string}|{art: "abgelehnt", grund: string})|null}
 */
function notizLesen(text, kontext) {
  const satz = String(text ?? "").trim();
  // "Notiz: Brüstung prüfen", "Text Brüstung prüfen": read on the RAW sentence before any word is moved (the note's last word may be a verb
  // such as "prüfen"), the text keeps its spelling
  const notiz = /^(?:neue\s+)?(notiz|text)(?![A-Za-zÄÖÜäöüß])\s*[:,–-]?\s*([\s\S]*)$/i.exec(satz);
  if (!notiz) return null;
  const inhalt = ohneAnfuehrung(notiz[2].replace(/[.!]+$/, ""));
  if (!inhalt) return ablehnen("Der Text der Notiz fehlt — z. B. „Notiz: Brüstung prüfen“");
  const fehlt = punkteFehlen(kontext, 1, "eine Notiz");
  if (fehlt) return fehlt;
  return { art: "befehl", befehl: "anlegen", params: { objekt: "notiz", text: inhalt }, verstanden: `Notiz anlegen: „${inhalt}“` };
}

/**
 * The other sentences of 261111-zs1 (see notizLesen for the note).
 * @param {string} text  The sentence as given (names keep their spelling). @param {string[]} norm  Comparison tokens (fillers gone).
 * @param {string[]} roh  Raw tokens (same length). @param {SprachKontext} kontext
 * @param {() => ({art: "abgelehnt", grund: string}|null)} aendert  The selection check of the grammar (selection present, noun fits).
 * @returns {({art: "befehl", befehl: string, params: Record<string, any>, verstanden: string}|{art: "abgelehnt", grund: string})|null}
 */
function anlegenLesen(text, norm, roh, kontext, aendert) {
  const satz = String(text ?? "").trim();

  // --- rename a room by number: "Raum 1.05 heißt jetzt Lager" ---
  const nachNummer = /^(?:der\s+)?raum\s+(.+?)\s+hei(?:ß|ss)t\b\s*(?:(?:jetzt|nun|ab\s+jetzt|ab\s+sofort)\s+)?([\s\S]*)$/i.exec(satz);
  const nachAuswahl = /^(?:dieser|der)\s+raum\s+hei(?:ß|ss)t\b\s*(?:(?:jetzt|nun|ab\s+jetzt|ab\s+sofort)\s+)?([\s\S]*)$/i.exec(satz);
  if (nachAuswahl) {
    const name = ohneAnfuehrung(nachAuswahl[1].replace(/[.!]+$/, ""));
    if (!name || /^(jetzt|nun)$/i.test(name)) return ablehnen("Der neue Name fehlt — z. B. „dieser Raum heißt Lager“");
    const verweigert = aendert();
    if (verweigert) return verweigert;
    return { art: "befehl", befehl: "raum-umbenennen", params: { name }, verstanden: `Raum umbenennen: ${name}` };
  }
  if (nachNummer) {
    const nr = nachNummer[1].trim().replace(",", ".");
    if (!/^\d+(\.\d+)*[a-z]?$/i.test(nr)) return ablehnen(`„${nachNummer[1].trim()}“ ist keine Raumnummer — die Nummer als Zahl sagen oder tippen (z. B. „Raum 1.05 heißt Lager“)`);
    const name = ohneAnfuehrung(nachNummer[2].replace(/[.!]+$/, ""));
    if (!name || /^(jetzt|nun)$/i.test(name)) return ablehnen(`Der neue Name fehlt — z. B. „Raum ${nr} heißt Lager“`);
    return { art: "befehl", befehl: "raum-umbenennen", params: { nummer: nr, name }, verstanden: `Raum ${nr} umbenennen: ${name}` };
  }

  const letztes = norm[norm.length - 1] ?? "";

  // --- the wall between two rooms: "Wand zwischen Raum 1.05 und 1.06 abbrechen" ---
  if (norm.includes("zwischen") && hat(norm, ["wand", "mauer"]) && ABBRUCH_VERB.test(letztes)) {
    const s = norm.join(" ");
    const m = /^(?:die )?(?:wand|mauer) zwischen (?:den )?(?:raum |raeumen )?(\S+) und (?:raum )?(\S+) (?:abbrechen|abreissen|ausbauen|rueckbauen|zurueckbauen)$/.exec(s);
    if (!m || !/^\d+(\.\d+)*[a-z]?$/.test(m[1]) || !/^\d+(\.\d+)*[a-z]?$/.test(m[2])) {
      return ablehnen("Zwischen welchen Räumen? — z. B. „Wand zwischen Raum 1.05 und 1.06 abbrechen“ (Raumnummern als Zahl)");
    }
    return { art: "befehl", befehl: "wand-zwischen-raeumen", params: { raum_a: m[1], raum_b: m[2] }, verstanden: `Wand zwischen Raum ${m[1]} und Raum ${m[2]} abbrechen` };
  }

  // --- demolish the selection: "Wand abbrechen", "diese Tür ausbauen" -> the existing property change status = abbruch ---
  if (norm.length >= 2 && ABBRUCH_VERB.test(letztes) && norm.slice(0, -1).every((w) => ABBRUCH_ERLAUBT.has(w))) {
    const verweigert = aendert();
    if (verweigert) return verweigert;
    return { art: "befehl", befehl: "eigenschaft-setzen", params: { name: "status", wert: "abbruch" }, verstanden: "Eigenschaft setzen — Status: Abbruch" };
  }

  let k = 0;
  while (k < norm.length && NEU_WORTE.has(norm[k])) k++;
  const neu = k > 0;

  // --- new wall: "neue Trockenbauwand 12,5", "neue Wand 24", "neue Mauerwerkswand 17,5 cm" ---
  let wandart = /** @type {string|null} */ (null);
  if (hatKey(WAND_WORT, norm[k])) { wandart = WAND_WORT[/** @type {keyof typeof WAND_WORT} */ (norm[k])]; k += 1; }
  else if ((norm[k] === "trockenbau" || norm[k] === "mauerwerk") && norm[k + 1] === "wand") { wandart = norm[k] === "trockenbau" ? "trockenbau" : "mauerwerk"; k += 2; }
  if (wandart && neu) {
    const z = zahlEinheit(norm, k);
    if (!z) return ablehnen("Die Wanddicke fehlt — z. B. „neue Wand 24“ (Zentimeter) oder „neue Trockenbauwand 12,5“");
    // a thickness without unit is centimetres (decision D8: "24" for a wall means 24 cm, the way it is written on a plan)
    const dicke = rund(z.faktor == null ? z.wert / 100 : z.wert * z.faktor);
    if (!(dicke >= WAND_DICKE_M.min && dicke <= WAND_DICKE_M.max)) return ablehnen(`Eine Wanddicke von ${zahlText(dicke * 100)} cm ist nicht plausibel — 1 bis 100 Zentimeter`);
    const rest = norm.slice(k + z.laenge).filter((w) => !WAND_FUELL.has(w));
    if (rest.length) return ablehnen(`„${roh[norm.indexOf(rest[0], k + z.laenge)] ?? rest[0]}“ verstehe ich bei einer neuen Wand nicht — Art und Dicke sagen, z. B. „neue Trockenbauwand 12,5“`);
    const fehlt = punkteFehlen(kontext, 2, "eine Wand");
    if (fehlt) return fehlt;
    const label = { wand: "Wand", trockenbau: "Trockenbauwand", mauerwerk: "Mauerwerkswand" }[wandart];
    return { art: "befehl", befehl: "anlegen", params: { objekt: "wand", wandart, dicke_m: dicke }, verstanden: `Neue ${label} ${zahlText(dicke * 100)} cm anlegen` };
  }

  // --- new door: "Tür 1,01", "Tür 1,01 T30-RS DIN links", "neue Tür 0,885 rechts" ---
  if (norm[k] === "tuer" || norm[k] === "tuere") {
    k += 1;
    const z = zahlEinheit(norm, k);
    if (!z) return ablehnen("Die Türbreite fehlt — z. B. „Tür 1,01“ (Meter)");
    // a width without unit is metres (decision D8: door widths are said as "1,01"); a bare 101 is refused instead of read as cm
    if (z.faktor == null && z.wert > TUER_BREITE_M.max) return ablehnen("Die Türbreite in Metern sagen (z. B. „Tür 1,01“) oder die Einheit nennen („101 Zentimeter“)");
    const breite = rund(z.faktor == null ? z.wert : z.wert * z.faktor);
    if (!(breite >= TUER_BREITE_M.min && breite <= TUER_BREITE_M.max)) return ablehnen(`Eine Türbreite von ${zahlText(breite)} m ist nicht plausibel — 0,5 bis 3 Meter`);
    /** @type {string|null} */ let feuer = null;
    /** @type {string|null} */ let din = null;
    const feuerDef = eigenschaftFeld("feuerwiderstand");
    for (let i = k + z.laenge; i < norm.length; i++) {
      const w = norm[i];
      if (TUER_FUELL.has(w)) continue;
      if (/^(t|f|ei|rei|e|r)\d{2,3}(-[a-z]{1,3})?$/.test(w)) {
        if (feuer) return ablehnen("Zwei Feuerwiderstände in einem Satz — einen sagen (z. B. T30-RS)");
        // "T30 RS" typed with a blank: the suffix joins the class
        const mitZusatz = !w.includes("-") && /^(rs|cs)$/.test(norm[i + 1] ?? "") ? `${roh[i]}-${roh[i + 1]}` : roh[i];
        if (mitZusatz !== roh[i]) i += 1;
        try { feuer = /** @type {any} */ (feuerDef).parse(mitZusatz); } catch (e) { return ablehnen(e instanceof Error ? e.message : String(e)); }
        continue;
      }
      const seite = w === "din" ? norm[i + 1] : /^din-(links|rechts)$/.test(w) ? w.slice(4) : w;
      if (seite === "links" || seite === "rechts") {
        if (din && din !== seite) return ablehnen("DIN links und DIN rechts zugleich — eine Seite sagen");
        din = seite;
        if (w === "din") i += 1;
        continue;
      }
      if (w === "din") return ablehnen("Nach „DIN“ fehlt die Seite — DIN links oder DIN rechts");
      return ablehnen(`„${roh[i]}“ verstehe ich bei einer Tür nicht — möglich: Breite in Metern, Feuerwiderstand (T30, T30-RS), DIN links oder rechts`);
    }
    const fehlt = punkteFehlen(kontext, 1, "eine Tür");
    if (fehlt) return fehlt;
    const zusatz = [feuer, din ? `DIN ${din}` : null].filter(Boolean).join(", ");
    return { art: "befehl", befehl: "anlegen", params: { objekt: "tuer", breite_m: breite, ...(feuer ? { feuerwiderstand: feuer } : {}), ...(din ? { din_anschlag: din } : {}) },
      verstanden: `Neue Tür ${zahlText(breite)} m anlegen${zusatz ? ` (${zusatz})` : ""}` };
  }
  // "Wand 24" without "neue" is not a creating sentence (a bare noun means the selection) - left to the other rules
  return null;
}

/**
 * Turns one sentence into a command of the viewer's register - or nothing.
 * @param {string} text  The sentence (transcript or typed).
 * @param {SprachKontext} [kontext]  What the viewer knows right now: `auswahl` (the 106-02 selection record), `ansicht` (screen right and
 *   "into the screen" as unit vectors in the plan), `zeigepunkt` ({x, z} in m, the spot last pointed at on the element - for "teile hier").
 * @returns {({art: "befehl", befehl: string, params: Record<string, any>, verstanden: string}
 *   | {art: "zurueck"} | {art: "abgelehnt", grund: string}) | null}  null when the grammar does not know the sentence.
 */
export function sprachbefehl(text, kontext = {}) {
  const z = zerlege(text);
  // the typed GUID command works on the raw text (a GUID has capitals): "wähle <guid>"
  // the end of the GUID is "no further GUID character", not \b: a GUID may end in "$", and after "$" there is no word boundary
  const guid = /\bw(?:ä|ae)hle\s+(?:das\s+)?(?:bauteil\s+)?(?:mit\s+(?:der\s+)?guid\s+)?([0-9A-Za-z_$]{22})(?![0-9A-Za-z_$])/i.exec(String(text ?? ""));
  if (guid) return { art: "befehl", befehl: "auswahl-guid", params: { guid: guid[1] }, verstanden: `Bauteil ${guid[1]} wählen` };
  // 261111-zs1: a note is free text - read before fillers go and before a verb at the end is moved to the front
  const notiz = notizLesen(text, kontext);
  if (notiz) return notiz;

  // filler words go; leading "kannst du" / "ich möchte" go as well
  let norm = z.norm.filter((w) => !FUELLWORTE.has(w));
  let roh = z.roh.filter((w, i) => !FUELLWORTE.has(z.norm[i]));
  const hoeflich = /^(kannst|koenntest|koennten|koennt|wuerdest|wuerden|wuerdet) (du|sie|ihr)\b/.exec(norm.join(" ")) || /^ich (moechte|will|brauche|haette gern)\b/.exec(norm.join(" ")) || /^wir (wollen|moechten)\b/.exec(norm.join(" "));
  if (hoeflich) { const n = hoeflich[0].split(" ").length; norm = norm.slice(n); roh = roh.slice(n); }
  if (!norm.length) return null;
  // verb at the end ("dieses 20 cm nach unten verschieben", "brandschutz auf F90 setzen"): the verb goes to the front
  if (!VERB_ANFANG.test(norm[0]) && norm.length > 1 && VERB_ENDE.test(norm[norm.length - 1])) { norm = [norm[norm.length - 1], ...norm.slice(0, -1)]; roh = [roh[roh.length - 1], ...roh.slice(0, -1)]; }
  const satz = norm.join(" ");

  // --- answers: only the WHOLE sentence counts (a "ja" inside a longer sentence never confirms) ---
  if (JA.has(satz) || JA_GESPROCHEN.has(satz)) {
    if (kontext.gesprochen && !JA_GESPROCHEN.has(satz)) return ablehnen(`Zum Übernehmen deutlich „ja“ oder „übernehmen“ sagen — „${roh.join(" ")}“ gilt nur getippt`);
    return { art: "befehl", befehl: "bestaetigen", params: {}, verstanden: "Vorschlag übernehmen" };
  }
  if (NEIN.has(satz)) return { art: "befehl", befehl: "verwerfen", params: {}, verstanden: "Vorschlag verwerfen" };
  if (ZURUECK.has(satz)) return { art: "zurueck" };

  const verb = norm[0];

  // --- reading the model ---
  if (/^(was ist (das|dieses|hier|dort|ausgewaehlt|gewaehlt|markiert)|welches bauteil|wasist)/.test(satz) || /^(lies|lese|nenn|nenne|beschreib|beschreibe|sag|sage) (mir )?(die |meine )?(auswahl|ausgewaehlte|eigenschaften)/.test(satz) || satz === "auswahl lesen" || /^was habe ich (ausgewaehlt|gewaehlt)/.test(satz)) {
    return { art: "befehl", befehl: "auswahl-lesen", params: {}, verstanden: "Auswahl lesen" };
  }
  if (/^(zeig|zeige|zeigen|zoom|zoome|spring|springe|fokussier|fokussiere|zentrier|zentriere|rahme|rahm)\b/.test(satz) && /\b(vorschlaege|aenderungen|offen|offenen|verlauf)\b/.test(satz)) {
    return { art: "befehl", befehl: "vorschlaege", params: {}, verstanden: "Vorschläge und Verlauf lesen" };
  }
  if (/^(zeig|zeige|zeigen|zoom|zoome|spring|springe|fokussier|fokussiere|zentrier|zentriere|rahme|rahm)\b/.test(satz) && hat(norm, ["auswahl", "dieses", "diese", "dieser", "das", "bauteil", "element", "dort", "hier", "ran", "heran"])) {
    return { art: "befehl", befehl: "ansicht-auf-auswahl", params: {}, verstanden: "Ansicht auf die Auswahl" };
  }
  if ((hat(norm, ["auswahl", "markierung"]) && hat(norm, ["aufheben", "loeschen", "entfernen", "aufloesen", "zuruecksetzen", "weg", "aufhebe"])) || /^(abwaehlen|waehle ab|nichts mehr ausgewaehlt|nichts auswaehlen|auswahl weg)/.test(satz) || /^heb(e)? .*auf$/.test(satz) && hat(norm, ["auswahl", "markierung"])) {
    return { art: "befehl", befehl: "auswahl-aufheben", params: {}, verstanden: "Auswahl aufheben" };
  }
  if (/^(pruef|pruefe|pruefen|kontrollier|kontrolliere|check|checke)\b/.test(satz) && (norm.length <= 4 || hat(norm, ["vorschlag", "aenderung", "das", "dieses"]))) {
    return { art: "befehl", befehl: "pruefen", params: {}, verstanden: "Offene Vorschläge prüfen" };
  }
  if (/^(was ist offen|was steht an|welche (vorschlaege|aenderungen))/.test(satz)) return { art: "befehl", befehl: "vorschlaege", params: {}, verstanden: "Vorschläge und Verlauf lesen" };

  // --- changes (every one only makes a proposal) ---
  const aendert = () => {
    const kein = auswahlFehlt(kontext);
    if (kein) return ablehnen(kein);
    const falsch = nomenPruefen(norm, kontext);
    return falsch ? ablehnen(falsch) : null;
  };

  // 106-10: the office's templates first - a fitting sentence becomes the property command, a value outside the list is refused with it
  const vorlage = vorlageLesen(norm, roh, kontext.bibliothek);
  if (vorlage) {
    const verweigert = aendert();
    if (verweigert) return verweigert;
    if ("art" in vorlage) return vorlage;
    return { art: "befehl", befehl: "eigenschaft-setzen", params: { name: vorlage.name, wert: vorlage.wert }, verstanden: `Eigenschaft setzen — ${vorlage.text} (Büro-Vorlage)` };
  }

  // --- 261111-zs1: creating, renaming, demolishing (every one only makes a proposal) ---
  const anlegen = anlegenLesen(text, norm, roh, kontext, aendert);
  if (anlegen) return anlegen;

  if (/^(verschieb|schieb|versetz|beweg|verrueck|zieh)/.test(verb) || /^rueck(e|en|t)?$/.test(verb)) {
    const verweigert = aendert();
    if (verweigert) return verweigert;
    const v = verschiebungLesen(norm, kontext);
    if ("art" in v) return v;
    return { art: "befehl", befehl: "transformieren", params: { verschiebung_m: v.verschiebung_m }, verstanden: `Verschieben: ${v.text}` };
  }

  if (/^(dreh|rotier|verdreh)/.test(verb)) {
    const verweigert = aendert();
    if (verweigert) return verweigert;
    let grad = null;
    for (let i = 0; i < norm.length; i++) {
      const n = zahlLesen(norm, i);
      if (n && norm[i + n.laenge] === "grad") { grad = n.wert; break; }
      if (n) i += n.laenge - 1;
    }
    if (grad == null) return ablehnen("Der Winkel fehlt — z. B. „drehe dieses um 90 Grad nach links“");
    // counter-clockwise AS SEEN in the plan is positive (aenderungen.js transformieren); "rechts" and "im Uhrzeigersinn" turn the other way
    const gegen = norm.includes("gegen");
    const rechts = !gegen && (norm.includes("rechts") || norm.includes("uhrzeigersinn"));
    const winkel = rechts ? -grad : grad;
    return { art: "befehl", befehl: "transformieren", params: { drehung_grad: winkel }, verstanden: `Drehen: ${zahlText(grad)}° ${rechts ? "nach rechts (im Uhrzeigersinn)" : "nach links (gegen den Uhrzeigersinn)"}` };
  }

  if (/^(skalier|vergroesser|verkleiner|streck|stauch|verdopp|verdreifach)/.test(verb) || ((verb === "mach" || verb === "mache") && norm.includes("so") && hat(norm, ["gross", "grosser"]))) {
    const verweigert = aendert();
    if (verweigert) return verweigert;
    const f = faktorLesen(norm);
    if ("art" in f) return f;
    return { art: "befehl", befehl: "transformieren", params: { faktor: f.faktor }, verstanden: `Skalieren: ${f.text}` };
  }

  if (/^(teil|halbier|trenn|zerleg|zerteil|spalte|zerschneid|schneid)/.test(verb)) {
    const verweigert = aendert();
    if (verweigert) return verweigert;
    if (hat(norm, ["hier", "dort", "da"]) && !hat(norm, ["mitte", "mittig", "haelfte"])) {
      const p = kontext.zeigepunkt;
      if (!p) return ablehnen("„Hier“ braucht eine Stelle — erst auf die Stelle des Bauteils zeigen, dann „teile hier“; oder „teile in der Mitte“");
      return { art: "befehl", befehl: "teilen", params: { punkt: { x: p.x, z: p.z } }, verstanden: `Teilen an der gezeigten Stelle (${zahlText(p.x)} / ${zahlText(p.z)} m)` };
    }
    if (hat(norm, ["mitte", "mittig", "haelfte", "halb"]) || /^halbier/.test(verb) || norm.join(" ").includes("in zwei")) {
      return { art: "befehl", befehl: "teilen", params: { anteil: 0.5 }, verstanden: "Teilen in der Mitte" };
    }
    for (let i = 0; i < norm.length; i++) {
      const n = zahlLesen(norm, i);
      if (n && norm[i + n.laenge] === "prozent") {
        if (!(n.wert > 0 && n.wert < 100)) return ablehnen("Die Stelle muss zwischen 0 und 100 Prozent der Wandlänge liegen");
        return { art: "befehl", befehl: "teilen", params: { anteil: rund(n.wert / 100) }, verstanden: `Teilen bei ${zahlText(n.wert)} Prozent der Länge` };
      }
    }
    return ablehnen("Wohin teilen? „Teile hier“ (auf die Stelle zeigen), „teile in der Mitte“ oder „teile bei 30 Prozent“");
  }

  if (/^(setz|aender|stell|trag|mach|markier|kennzeichn|stuf|weis)/.test(verb) || norm.includes("auf")) {
    const e = eigenschaftLesen(norm, roh);
    if (e) {
      if ("art" in e) return e;
      const verweigert = aendert();
      if (verweigert) return verweigert;
      const verboten = bibliothekVerbietet(e, kontext.bibliothek); // 106-10: the office's allowed values hold in the free form too
      if (verboten) return verboten;
      return { art: "befehl", befehl: "eigenschaft-setzen", params: { name: e.name, wert: e.wert }, verstanden: `Eigenschaft setzen — ${e.text}` };
    }
  }
  return null;
}

/**
 * The sentences the grammar knows, for the help of the speech field. Each `satz` is an example the grammar understands (a unit test
 * checks every one against sprachbefehl and the command named in `befehl`), `wirkung` says in words what happens.
 * @type {ReadonlyArray<{satz: string, befehl: string, wirkung: string}>}
 */
export const SATZ_HILFE = Object.freeze([
  { satz: "Verschiebe dieses 50 Zentimeter nach links", befehl: "transformieren", wirkung: "Vorschlag: verschieben (Richtung wie im Bild: links, rechts, vor, zurück, hoch, runter; Maße wie 0,5 m, fünfzig Zentimeter, zwei Meter fünfzig)" },
  { satz: "Drehe diese Wand um 90 Grad nach rechts", befehl: "transformieren", wirkung: "Vorschlag: drehen (links = gegen den Uhrzeigersinn, rechts = im Uhrzeigersinn)" },
  { satz: "Skaliere dieses um Faktor 2", befehl: "transformieren", wirkung: "Vorschlag: skalieren (auch: auf 120 Prozent, verdopple, halb so groß)" },
  { satz: "Setze Brandschutz auf F90", befehl: "eigenschaft-setzen", wirkung: "Vorschlag: Eigenschaft setzen (Brandschutz, Status, Kostengruppe, Leistungsbereich, Bauabschnitt, Material, Tragend, Statik-Vermerk)" },
  { satz: "Mach dieses nicht tragend", befehl: "eigenschaft-setzen", wirkung: "Vorschlag: tragend ja/nein" },
  { satz: "Markiere dieses als Abbruch", befehl: "eigenschaft-setzen", wirkung: "Vorschlag: Status Bestand, Neubau oder Abbruch" },
  { satz: "Teile hier", befehl: "teilen", wirkung: "Vorschlag: Bauteil an der zuletzt gezeigten Stelle teilen" },
  { satz: "Teile in der Mitte", befehl: "teilen", wirkung: "Vorschlag: Wand in der Mitte teilen (auch: teile bei 30 Prozent)" },
  // 261111-zs1: creating by pointing and speaking (the points come from the plan tool „Punkte“)
  { satz: "Neue Trockenbauwand 12,5", befehl: "anlegen", wirkung: "Vorschlag: neue Wand zwischen den Punkten 1 und 2 (Dicke in cm; auch „neue Wand 24“, „neue Mauerwerkswand 17,5“)" },
  { satz: "Tür 1,01 T30-RS DIN links", befehl: "anlegen", wirkung: "Vorschlag: neue Tür am Punkt auf der Wand (Breite in m; Feuerwiderstand und DIN links/rechts nach Wunsch)" },
  { satz: "Notiz: Brüstung prüfen", befehl: "anlegen", wirkung: "Vorschlag: Textnotiz am Punkt im Grundriss" },
  { satz: "Raum 1.05 heißt jetzt Lager", befehl: "raum-umbenennen", wirkung: "Vorschlag: Raum umbenennen (auch „dieser Raum heißt Lager“ mit gewähltem Raum)" },
  { satz: "Wand abbrechen", befehl: "eigenschaft-setzen", wirkung: "Vorschlag: Status Abbruch für die gewählte Wand (auch „Tür ausbauen“)" },
  { satz: "Wand zwischen Raum 1.05 und 1.06 abbrechen", befehl: "wand-zwischen-raeumen", wirkung: "Vorschlag: die Wand zwischen den beiden Raumstempeln bekommt Status Abbruch" },
  { satz: "Ja", befehl: "bestaetigen", wirkung: "Übernimmt den offenen Vorschlag (nur ein einzelnes „ja“, „nein“ verwirft)" },
  { satz: "Nein", befehl: "verwerfen", wirkung: "Verwirft den offenen Vorschlag" },
  { satz: "Mach das rückgängig", befehl: "zurueck", wirkung: "Fragt, welchen Schritt es zurücknimmt; erst „ja“ führt es aus" },
  { satz: "Was ist das", befehl: "auswahl-lesen", wirkung: "Liest die Auswahl vor" },
  { satz: "Zeige die Auswahl", befehl: "ansicht-auf-auswahl", wirkung: "Rahmt die Auswahl in der Ansicht" },
  { satz: "Hebe die Auswahl auf", befehl: "auswahl-aufheben", wirkung: "Hebt die Auswahl auf" },
  { satz: "Prüfe den Vorschlag", befehl: "pruefen", wirkung: "Prüft die offenen Vorschläge neu" },
  { satz: "Zeige die Vorschläge", befehl: "vorschlaege", wirkung: "Liest offene Vorschläge und Verlauf" },
]);
