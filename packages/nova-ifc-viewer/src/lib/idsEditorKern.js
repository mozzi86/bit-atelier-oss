// idsEditorKern.js — pure core of the IDS editor (Phase 69-08).
//
// Extracted from IdsEditor.jsx so the unit tests run under bare node (the
// runner cannot parse JSX). Nothing here touches React, the DOM or storage.
//
// In:  the editor form, the parsed model elements (suggestions), the stored
//      value of the BimModel field pruefung_layer, uploaded specs.
// Out: spec objects in the parse form of ids.js — evaluateIds (run) and
//      idsWriter.schreibeIds (download) take them unchanged —, validation
//      messages (German i18n keys, the component translates them), suggestion
//      lists, the JSON-safe storage form of pruefung_layer, and the download
//      helpers (IDS-conformant entity names, writer warnings split into
//      i18n key + rest).
//
// Cardinality as the editor offers it (IDS 1.0 semantics, see evaluateIds):
//   - rule WITH property: the choice is the cardinality of the PROPERTY facet —
//     required = every element of the class must satisfy it, optional = check
//     only where the property exists, prohibited = the property must not be
//     there (or must not carry the value). The specification itself stays
//     "required", so a rule for a class the model does not contain fails with
//     "mind. 1 anwendbares Element": a typo in the class name becomes visible
//     instead of passing silently.
//   - rule WITHOUT property (class only): the choice is the cardinality of the
//     SPECIFICATION — required = the class must occur, prohibited = it must not.
//   - "optional" without a value to check (class only, or a mere existence
//     check) can never fail and is rejected by pruefeEingabe.
// The 25.09. WIP put the choice on the specification in both cases; with a
// property that turned "prohibited" into "no wall may exist at all".

import { xsdMusterZuRegExp } from "./ids.js";
import { WARNUNG_NAME_ZEICHEN } from "./idsWriter.js";

/**
 * @typedef {"required"|"optional"|"prohibited"} Kardinalitaet
 * @typedef {"pflicht"|"wert"|"aufzaehlung"} WertArt
 *   pflicht = the property must exist, wert = it must carry one value,
 *   aufzaehlung = its value must be one of a list
 * @typedef {{name: string, klasse: string, pset: string, property: string,
 *   kardinalitaet: Kardinalitaet, wertArt: WertArt, wert: string,
 *   aufzaehlung: string}} Eingabe
 *   form state of one rule — every text as typed, trimmed by the functions here
 * @typedef {"name"|"klasse"|"pset"|"property"|"kardinalitaet"|"wertArt"|"wert"|"aufzaehlung"} EingabeFeld
 * @typedef {{feld: EingabeFeld, text: string}} EingabeFehler
 *   one validation message; `text` is a German i18n key
 */

/** Key inside pruefung_layer that holds the own specs. */
export const SPECS_KEY = "eigene_specs";

/**
 * Input check for the class field: "Ifc" plus letters/digits, typed in ANY case
 * (web-ifc suggests IfcWall, the IDS UserManual writes IFCWALL). The spec itself
 * always carries the UPPERCASE form (idsKlassenName): IDS 1.0 requires entity
 * names as uppercase strings (UserManual; IDS test case "entities must be
 * specified as uppercase strings"; project decision D-P71-02), and a conformant
 * checker such as IfcTester does not match "IfcWall" at all. ids.js is lenient
 * and upper-cases both sides (ids.js matchIdsWertUppercase) — that is why round
 * trips inside the suite never showed the difference.
 */
const IFC_KLASSE = /^ifc[a-z0-9]+$/i;

/**
 * IFC class as the IDS entity facet must carry it: trimmed and UPPERCASE.
 * Only for the entity name — property set and property names are
 * case-sensitive in IDS and stay exactly as typed.
 * @param {string|null|undefined} klasse class as typed or suggested, e.g. "IfcWall"
 * @returns {string} e.g. "IFCWALL"
 */
export function idsKlassenName(klasse) {
  return String(klasse ?? "").trim().toUpperCase();
}

/**
 * Comparison key of a rule name: rule names are unique in the list without
 * regard to case or surrounding blanks (result rows, BCF titles and the PDF
 * report name the rule).
 * @param {unknown} name
 * @returns {string}
 */
export function namensSchluessel(name) {
  return String(name ?? "").trim().toLowerCase();
}

/**
 * Fresh form state for one rule.
 * @returns {Eingabe}
 */
export function leereEingabe() {
  return {
    name: "",
    klasse: "",
    pset: "",
    property: "",
    kardinalitaet: "required",
    wertArt: "pflicht",
    wert: "",
    aufzaehlung: "",
  };
}

/**
 * Empty pruefung_layer — the default before anything is stored.
 * @returns {{eigene_specs: object[]}}
 */
export function leeresLayer() {
  return { [SPECS_KEY]: [] };
}

/**
 * A simple IDS value (null → existence check).
 * @param {string|null} [wert]
 * @returns {{art: 'simple', wert: string}|null}
 */
export function simpleWert(wert) {
  if (wert == null || wert === "") return null;
  return { art: "simple", wert: String(wert) };
}

/**
 * An enumeration restriction value (xs:restriction with xs:enumeration).
 * @param {string[]} werte non-empty list of allowed values
 * @returns {object} restriction value in parse form
 */
export function enumerationsWert(werte) {
  return {
    art: "restriction",
    base: "xs:string",
    enumeration: werte.map(String),
    pattern: null,
    patternQuelle: null,
    patternFehler: null,
    bounds: null,
    length: null,
  };
}

/**
 * Split the enumeration input into trimmed, distinct, non-empty values.
 * Semicolon wins: as soon as the text contains one, only semicolons separate —
 * German decimals ("0,24; 0,30") stay whole. Without a semicolon the comma
 * separates ("REI30, REI60"), because visitors type both.
 * @param {string|null|undefined} text
 * @returns {string[]}
 */
export function parseAufzaehlung(text) {
  const roh = String(text || "");
  const trenner = roh.includes(";") ? ";" : ",";
  const werte = roh.split(trenner).map((s) => s.trim()).filter(Boolean);
  return [...new Set(werte)];
}

/**
 * Build one spec object. Low-level: no validation (see specAusEingabe).
 * The class may come in any case; the entity facet gets it UPPERCASE
 * (idsKlassenName, see IFC_KLASSE). predefinedType is passed through untouched:
 * the editor never sets it, and user-defined types are case-sensitive.
 * @param {{name:string, klasse:string, pset?:string, property?:string,
 *   kardinalitaet?:Kardinalitaet, wertArt?:WertArt, wert?:string,
 *   aufzaehlung?:string[], predefinedType?:string|null}} e
 * @returns {object} spec in parse form with `eigen: true` (result badge;
 *   evaluateIds and schreibeIds ignore unknown fields)
 */
export function baueSpec(e) {
  const kardinalitaet = e.kardinalitaet || "required";
  const mitEigenschaft = !!(e.pset && e.property);
  const wert =
    e.wertArt === "wert" ? simpleWert(e.wert)
    : e.wertArt === "aufzaehlung" && (e.aufzaehlung || []).length ? enumerationsWert(e.aufzaehlung)
    : null; // 'pflicht' → existence check (value null)

  const requirements = mitEigenschaft
    ? [{
        typ: "property",
        propertySet: simpleWert(e.pset),
        baseName: simpleWert(e.property),
        value: wert,
        // dataType stays null: ids.js only checks it when the model supplies
        // psetTypes, and a wrong guess would invent violations (ids.js header).
        dataType: null,
        cardinality: kardinalitaet,
      }]
    : [];

  return {
    name: e.name,
    identifier: null,
    beschreibung: null,
    hinweise: null,
    ifcVersions: ["IFC2X3", "IFC4"],
    // See the file header: with a property the spec stays required.
    kardinalitaet: mitEigenschaft ? "required" : kardinalitaet,
    eigen: true,
    applicability: [{ typ: "entity", name: simpleWert(idsKlassenName(e.klasse)), predefinedType: e.predefinedType || null }],
    requirements,
  };
}

/**
 * Name for a rule the visitor left unnamed — built from the facets, in IDS
 * terms (language-neutral, it lands in the .ids file). Only characters the
 * writer's name check accepts (idsWriter NAME_ERLAUBT): no "=" or "·".
 * The class appears as typed, because the name is a label for people; the
 * entity facet itself is UPPERCASE (baueSpec).
 * @param {Eingabe} e
 * @returns {string} e.g. "IfcWall Pset_WallCommon.FireRating (REI30)"
 */
export function automatischerName(e) {
  const klasse = e.klasse.trim();
  const pset = e.pset.trim();
  const property = e.property.trim();
  if (!pset || !property) return `${klasse} (${e.kardinalitaet})`.trim();
  let name = `${klasse} ${pset}.${property}`;
  if (e.wertArt === "wert" && e.wert.trim()) name += ` (${e.wert.trim()})`;
  if (e.wertArt === "aufzaehlung") {
    const werte = parseAufzaehlung(e.aufzaehlung);
    if (werte.length) name += ` (${werte.join("/")})`;
  }
  if (e.kardinalitaet !== "required") name += ` [${e.kardinalitaet}]`;
  return name;
}

/**
 * Validate the form. Returns every problem at once, in field order, so the
 * component can mark all invalid fields and focus the first.
 * @param {Eingabe} e
 * @param {string[]} [vorhandeneNamen] names of the rules already in the list
 * @returns {EingabeFehler[]} empty = valid
 */
export function pruefeEingabe(e, vorhandeneNamen = []) {
  /** @type {EingabeFehler[]} */
  const fehler = [];
  const klasse = e.klasse.trim();
  const pset = e.pset.trim();
  const property = e.property.trim();

  if (!klasse) fehler.push({ feld: "klasse", text: "Bitte wählen Sie eine IFC-Klasse, z. B. IfcWall." });
  else if (!IFC_KLASSE.test(klasse)) fehler.push({ feld: "klasse", text: "Die Klasse muss ein IFC-Typ sein, z. B. IfcWall." });

  if (pset && !property) fehler.push({ feld: "property", text: "Zum Property-Set gehört eine Eigenschaft." });
  if (property && !pset) fehler.push({ feld: "pset", text: "Zur Eigenschaft gehört ein Property-Set." });

  if (e.wertArt !== "pflicht" && !pset && !property) {
    fehler.push({ feld: "pset", text: "Ein Wert braucht ein Property-Set und eine Eigenschaft." });
  }
  if (e.wertArt === "wert" && !e.wert.trim()) {
    fehler.push({ feld: "wert", text: "Bitte geben Sie den erwarteten Wert an." });
  }
  if (e.wertArt === "aufzaehlung" && parseAufzaehlung(e.aufzaehlung).length < 2) {
    fehler.push({ feld: "aufzaehlung", text: "Eine Aufzählung braucht mindestens zwei Werte, getrennt durch Semikolon." });
  }
  // "optional" only checks a VALUE where the property exists (evaluateIds:
  // violation = carrier present AND value wrong). With a mere existence check
  // (pflicht), or class-only, the rule can never fail — worse than none.
  if (e.kardinalitaet === "optional" && e.wertArt === "pflicht") {
    fehler.push({ feld: "kardinalitaet", text: "„optional“ prüft nur einen Wert, wo die Eigenschaft vorhanden ist — bitte wählen Sie einen Wert oder eine Liste, oder „required“ bzw. „prohibited“." });
  }

  // Duplicate names would make two result rows indistinguishable (the table,
  // the BCF topic title and the PDF report all name the rule). Only checked
  // once the facets are complete, else the automatic name is not final yet.
  if (!fehler.length) {
    const name = namensSchluessel(e.name.trim() || automatischerName(e));
    if (vorhandeneNamen.some((n) => namensSchluessel(n) === name)) {
      fehler.push({ feld: "name", text: "Eine Regel mit diesem Namen gibt es schon — bitte vergeben Sie einen anderen Namen." });
    }
  }
  return fehler;
}

/**
 * Form → spec, with validation. The one entry point the component uses.
 * @param {Eingabe} e
 * @param {string[]} [vorhandeneNamen]
 * @returns {{spec: object|null, fehler: EingabeFehler[]}}
 */
export function specAusEingabe(e, vorhandeneNamen = []) {
  const fehler = pruefeEingabe(e, vorhandeneNamen);
  if (fehler.length) return { spec: null, fehler };
  const pset = e.pset.trim();
  const property = e.property.trim();
  const spec = baueSpec({
    name: e.name.trim() || automatischerName(e),
    klasse: e.klasse, // baueSpec trims and upper-cases it for the entity facet
    pset: pset || undefined,
    property: property || undefined,
    kardinalitaet: e.kardinalitaet,
    wertArt: e.wertArt,
    wert: e.wert.trim(),
    aufzaehlung: e.wertArt === "aufzaehlung" ? parseAufzaehlung(e.aufzaehlung) : [],
  });
  return { spec, fehler: [] };
}

/**
 * Suggestion lists from the loaded model's parsed elements. Keys of the maps
 * are UPPER-CASE class names ("IFCWALL", "IFCWALL|Pset_WallCommon") because the
 * visitor may type either spelling; read them via psetVorschlaege and
 * propertyVorschlaege.
 * @param {Array<{ifcType?:string, psets?:Record<string, Record<string, unknown>>}>|null} elemente
 * @returns {{klassen: string[], psetsJeKlasse: Map<string,string[]>,
 *   propsJeKlassePset: Map<string,string[]>, allePsets: string[]}} all sorted
 */
export function vorschlaegeAusModell(elemente) {
  const liste = Array.isArray(elemente) ? elemente : [];
  const klassen = new Set();
  const allePsets = new Set();
  /** @type {Map<string, Set<string>>} */
  const psetsJeKlasse = new Map();
  /** @type {Map<string, Set<string>>} */
  const propsJeKlassePset = new Map();
  for (const el of liste) {
    const k = el?.ifcType;
    if (!k) continue;
    klassen.add(k);
    const ku = String(k).toUpperCase();
    if (!psetsJeKlasse.has(ku)) psetsJeKlasse.set(ku, new Set());
    for (const [pset, props] of Object.entries(el.psets || {})) {
      psetsJeKlasse.get(ku).add(pset);
      allePsets.add(pset);
      const pk = `${ku}|${pset}`;
      if (!propsJeKlassePset.has(pk)) propsJeKlassePset.set(pk, new Set());
      for (const prop of Object.keys(props || {})) propsJeKlassePset.get(pk).add(prop);
    }
  }
  const sortiert = (m) => new Map([...m].map(([k, s]) => [k, [...s].sort()]));
  return {
    klassen: [...klassen].sort(),
    psetsJeKlasse: sortiert(psetsJeKlasse),
    propsJeKlassePset: sortiert(propsJeKlassePset),
    allePsets: [...allePsets].sort(),
  };
}

/**
 * Property-set suggestions for the typed class (any case); an unknown or empty
 * class offers every property set of the model.
 * @param {ReturnType<typeof vorschlaegeAusModell>} vor
 * @param {string} klasse
 * @returns {string[]}
 */
export function psetVorschlaege(vor, klasse) {
  return vor.psetsJeKlasse.get(String(klasse || "").trim().toUpperCase()) || vor.allePsets;
}

/**
 * Property suggestions for class + property set (class in any case).
 * @param {ReturnType<typeof vorschlaegeAusModell>} vor
 * @param {string} klasse
 * @param {string} pset
 * @returns {string[]}
 */
export function propertyVorschlaege(vor, klasse, pset) {
  return vor.propsJeKlassePset.get(`${String(klasse || "").trim().toUpperCase()}|${String(pset || "").trim()}`) || [];
}

/**
 * Text of an IDS value for the rule list: simple → the value, enumeration →
 * its values, pattern → the XSD source.
 * @param {any} w IDS value in parse form (or null)
 * @returns {string[]}
 */
function wertTexte(w) {
  if (!w) return [];
  if (w.art === "simple") return [String(w.wert)];
  if (Array.isArray(w.enumeration) && w.enumeration.length) return w.enumeration.map(String);
  if (w.patternQuelle != null) return [String(w.patternQuelle)];
  return [];
}

/**
 * Structured one-line summary of a spec for the rule list (the component
 * translates the words). Uploaded specs may carry more facets than the editor
 * writes; `weitere` counts the requirement facets not shown.
 * @param {any} spec spec in parse form
 * @returns {{klasse: string, pset: string|null, property: string|null,
 *   erwartung: "vorhanden"|"wert"|"liste"|"muster"|"einschraenkung",
 *   werte: string[], kardinalitaet: Kardinalitaet, weitere: number}}
 */
export function regelZusammenfassung(spec) {
  const ent = (spec?.applicability || []).find((f) => f.typ === "entity");
  const anforderungen = spec?.requirements || [];
  const prop = anforderungen.find((f) => f.typ === "property");
  const klasse = wertTexte(ent?.name).join("/") || "?";
  if (!prop) {
    return {
      klasse, pset: null, property: null, erwartung: "vorhanden", werte: [],
      kardinalitaet: spec?.kardinalitaet || "required", weitere: anforderungen.length,
    };
  }
  const v = prop.value;
  const erwartung = !v ? "vorhanden"
    : v.art === "simple" ? "wert"
    : Array.isArray(v.enumeration) && v.enumeration.length ? "liste"
    : v.patternQuelle != null ? "muster"
    : "einschraenkung";
  return {
    klasse,
    pset: wertTexte(prop.propertySet).join("/") || "?",
    property: wertTexte(prop.baseName).join("/") || "?",
    erwartung,
    werte: wertTexte(v),
    kardinalitaet: prop.cardinality || "required",
    weitere: anforderungen.length - 1,
  };
}

/**
 * Apply fn to every restriction value inside a facet tree (partOf nests an
 * entity one level deeper, hence the recursion).
 * @param {any} obj
 * @param {(w: any) => any} fn
 * @returns {any} transformed copy
 */
function wandleRestriktionen(obj, fn) {
  if (Array.isArray(obj)) return obj.map((x) => wandleRestriktionen(x, fn));
  if (!obj || typeof obj !== "object" || obj instanceof RegExp) return obj;
  if (obj.art === "restriction") return fn(obj);
  /** @type {Record<string, any>} */
  const kopie = {};
  for (const [k, v] of Object.entries(obj)) kopie[k] = wandleRestriktionen(v, fn);
  return kopie;
}

/**
 * JSON-safe storage form of a spec: parseIdsXml puts compiled RegExp objects
 * into pattern restrictions, and JSON turns a RegExp into {} — after a reload
 * evaluateIds would then call {}.test() and crash. The pattern source
 * (patternQuelle) is kept; specsFuerLauf rebuilds the RegExp.
 * @param {any} spec
 * @returns {object} deep copy without RegExp objects, `eigen: true`
 */
export function specFuerSpeicher(spec) {
  return {
    ...spec,
    eigen: true,
    applicability: wandleRestriktionen(spec.applicability || [], (w) => ({ ...w, pattern: null })),
    requirements: wandleRestriktionen(spec.requirements || [], (w) => ({ ...w, pattern: null })),
  };
}

/**
 * Specs as the run needs them: every pattern restriction gets its RegExp back
 * (same translation as the parser, xsdMusterZuRegExp).
 * @param {any[]} specs storage form
 * @returns {object[]}
 */
export function specsFuerLauf(specs) {
  const baue = (w) => (w.patternQuelle == null
    ? { ...w, pattern: null }
    : { ...w, ...xsdMusterZuRegExp(String(w.patternQuelle)) });
  return (specs || []).map((s) => ({
    ...s,
    applicability: wandleRestriktionen(s.applicability || [], baue),
    requirements: wandleRestriktionen(s.requirements || [], baue),
  }));
}

/**
 * Normalise a stored (or hand-edited, or legacy) pruefung_layer: entries
 * without a name are dropped, arrays default to [], every spec is marked own.
 * Other keys of the layer are kept (additive schema, Fachlayer rule 1).
 * @param {any} roh value of BimModel.pruefung_layer (may be null)
 * @returns {{eigene_specs: object[]}}
 */
export function layerAusSpeicher(roh) {
  const liste = roh && Array.isArray(roh[SPECS_KEY]) ? roh[SPECS_KEY] : [];
  const specs = liste
    .filter((s) => s && typeof s === "object" && typeof s.name === "string" && s.name.trim())
    .map((s) => specFuerSpeicher({
      ...s,
      kardinalitaet: s.kardinalitaet || "required",
      ifcVersions: Array.isArray(s.ifcVersions) ? s.ifcVersions : [],
      applicability: Array.isArray(s.applicability) ? s.applicability : [],
      requirements: Array.isArray(s.requirements) ? s.requirements : [],
    }));
  return { ...(roh && typeof roh === "object" ? roh : {}), [SPECS_KEY]: specs };
}

/**
 * Merge uploaded specs into the list. A spec with the name of an EXISTING rule
 * replaces it in place, the rest is appended — nothing typed by hand is lost
 * silently (the 25.09. WIP replaced the whole list on every upload).
 * Names repeated WITHIN the uploaded file are not merged into each other: IDS
 * does not require unique specification names, but the list does (see
 * namensSchluessel). The second and later ones get the suffix " (2)", " (3)" …
 * (the next one no other spec of the file carries) and are reported in
 * `umbenannt`. The suffix is stable, so uploading the same file again replaces
 * every one of them instead of adding copies.
 * @param {any[]} vorhanden current own specs
 * @param {any[]} neu uploaded specs, in file order
 * @returns {{specs: object[], ersetzt: number, hinzu: number, umbenannt: string[]}}
 *   ersetzt = existing rules replaced, hinzu = rules appended, umbenannt = new
 *   names of the renamed duplicates of the file
 */
export function fuegeSpecsZusammen(vorhanden, neu) {
  const liste = neu || [];
  // 1. Unique names within the upload. `belegt` starts with every name of the
  //    file, so a suffix never collides with a spec the file names itself.
  const belegt = new Set(liste.map((s) => namensSchluessel(s.name)));
  const gesehen = new Set();
  /** @type {string[]} */
  const umbenannt = [];
  const eindeutig = liste.map((s) => {
    const schluessel = namensSchluessel(s.name);
    if (!gesehen.has(schluessel)) {
      gesehen.add(schluessel);
      return s;
    }
    const basis = String(s.name ?? "").trim();
    let n = 2;
    while (belegt.has(namensSchluessel(`${basis} (${n})`))) n += 1;
    const name = `${basis} (${n})`;
    belegt.add(namensSchluessel(name));
    gesehen.add(namensSchluessel(name));
    umbenannt.push(name);
    return { ...s, name };
  });

  // 2. Merge against the existing list only — each existing rule is replaced
  //    at most once, because the upload names are unique now.
  const specs = [...(vorhanden || [])];
  const vorhandeneSchluessel = specs.map((x) => namensSchluessel(x.name));
  let ersetzt = 0;
  let hinzu = 0;
  for (const s of eindeutig) {
    const i = vorhandeneSchluessel.indexOf(namensSchluessel(s.name));
    if (i >= 0) {
      specs[i] = s;
      ersetzt += 1;
    } else {
      specs.push(s);
      hinzu += 1;
    }
  }
  return { specs, ersetzt, hinzu, umbenannt };
}

/**
 * Entity facet with its name UPPERCASE (simple value or enumeration), see
 * IFC_KLASSE. Pattern restrictions stay as they are: upper-casing a regular
 * expression can change its meaning (\d → \D). Other facets pass unchanged.
 * @param {any} f facet in parse form
 * @returns {any}
 */
function entityNameGross(f) {
  if (!f || f.typ !== "entity" || !f.name) return f;
  const n = f.name;
  if (n.art === "simple") return { ...f, name: { ...n, wert: String(n.wert).toUpperCase() } };
  if (Array.isArray(n.enumeration) && n.enumeration.length) {
    return { ...f, name: { ...n, enumeration: n.enumeration.map((v) => String(v).toUpperCase()) } };
  }
  return f;
}

/**
 * Specs as the download writes them:
 * - partOf facets are left out: schreibeIds throws on them ("Lese-only",
 *   71-01) and an uploaded file may carry them. The rules are named, so the
 *   loss is visible, not silent; evaluateIds skips partOf anyway, so the check
 *   result is the same.
 * - every entity name is written UPPERCASE (IFC_KLASSE) — also for rules stored
 *   before the 69-08 review follow-up and for uploads from a file that wrote
 *   "IfcWall". Inside the suite nothing changes (ids.js compares upper-cased).
 * @param {any[]} specs
 * @returns {{specs: object[], ohnePartOf: string[]}}
 */
export function schreibbareSpecs(specs) {
  /** @type {string[]} */
  const ohnePartOf = [];
  const aus = (specs || []).map((s) => {
    const app = (s.applicability || []).filter((f) => f.typ !== "partOf");
    const req = (s.requirements || []).filter((f) => f.typ !== "partOf");
    if (app.length !== (s.applicability || []).length || req.length !== (s.requirements || []).length) {
      ohnePartOf.push(s.name);
    }
    return { ...s, applicability: app.map(entityNameGross), requirements: req.map(entityNameGross) };
  });
  return { specs: aus, ohnePartOf };
}

/** Fixed German lead texts of the writer warnings — i18n keys (EN in DICT.en). */
export const WRITER_WARNUNGEN = [WARNUNG_NAME_ZEICHEN];

/**
 * Split a writer warning into its fixed German lead text (an i18n key the
 * component translates) and the variable rest (the quoted name), so
 * the warning toast is not German in the English UI. An unknown warning comes
 * back whole as `rest` with `schluessel` null.
 * @param {string} warnung one entry of schreibeIds(...).warnungen
 * @returns {{schluessel: string|null, rest: string}}
 */
export function writerWarnungTeilen(warnung) {
  const w = String(warnung ?? "");
  const schluessel = WRITER_WARNUNGEN.find((k) => w.startsWith(k)) || null;
  return { schluessel, rest: schluessel ? w.slice(schluessel.length) : w };
}
