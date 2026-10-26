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
import { zahlText } from "./aenderungen.js";
import { KEINE_AUSWAHL_TEXT } from "./auswahlKontext.js";

/** @typedef {{auswahl?: {anzahl?: number, bauteile?: Array<{guid?: string|null, klasse?: string|null}>}|null,
 *   ansicht?: {rechts: {x: number, z: number}, vorn: {x: number, z: number}}|null, zeigepunkt?: {x: number, z: number}|null,
 *   gesprochen?: boolean}} SprachKontext
 *   gesprochen: the sentence is a transcript of the speech recognition - a confirmation then needs an unambiguous word (JA_GESPROCHEN). */

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
  { satz: "Ja", befehl: "bestaetigen", wirkung: "Übernimmt den offenen Vorschlag (nur ein einzelnes „ja“, „nein“ verwirft)" },
  { satz: "Nein", befehl: "verwerfen", wirkung: "Verwirft den offenen Vorschlag" },
  { satz: "Mach das rückgängig", befehl: "zurueck", wirkung: "Fragt, welchen Schritt es zurücknimmt; erst „ja“ führt es aus" },
  { satz: "Was ist das", befehl: "auswahl-lesen", wirkung: "Liest die Auswahl vor" },
  { satz: "Zeige die Auswahl", befehl: "ansicht-auf-auswahl", wirkung: "Rahmt die Auswahl in der Ansicht" },
  { satz: "Hebe die Auswahl auf", befehl: "auswahl-aufheben", wirkung: "Hebt die Auswahl auf" },
  { satz: "Prüfe den Vorschlag", befehl: "pruefen", wirkung: "Prüft die offenen Vorschläge neu" },
  { satz: "Zeige die Vorschläge", befehl: "vorschlaege", wirkung: "Liest offene Vorschläge und Verlauf" },
]);
