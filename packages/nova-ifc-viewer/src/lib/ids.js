// ids.js — buildingSMART IDS 1.0: Parser + Auswertung fuer die Pruef-Suite (Phase 64).
//
// Strikte Trennung in zwei Teile:
//   1) parseIdsXml(xmlString, domParser)  — braucht einen DOMParser (Browser nativ,
//      in Node ueber den zweiten Parameter injizierbar). Liefert reine Spec-Objekte.
//   2) evaluateIds(specs, elements)       — PURE (kein DOM, kein Browser, kein WASM),
//      deterministisch und damit direkt in Node smoke-testbar.
//
// elements-Form (geliefert von ifcImport.js):
//   [{ globalId, ifcType, name, predefinedType?, attributes?: {AttrName: wert},
//      psets: {PsetName: {PropName: wert}}, psetTypes?: {PsetName: {PropName: 'IFCLABEL'}},
//      classification: {system, code} | null, material: [string] }]
//
// WICHTIG (siehe Plan-Fallstricke):
// - Zwei Namespaces in EINEM Dokument: IDS-Elemente unter IDS_NS, aber
//   xs:restriction/xs:pattern/xs:enumeration/... unter XS_NS. Prefixe sind frei
//   waehlbar (oft Default-Namespace ohne Prefix) — deshalb wird hier AUSSCHLIESSLICH
//   mit getElementsByTagNameNS bzw. namespaceURI+localName gearbeitet, niemals mit
//   prefix-abhaengigen tagName-Strings wie 'ids:specification'.
// - PredefinedType-Herleitung (Typ-Objekt ueberschreibt Instanz, USERDEFINED ->
//   ObjectType/ElementType) passiert in ifcImport.js; evaluateIds erwartet
//   element.predefinedType bereits fertig aufgeloest.
// - property@dataType wird nur geprueft, wenn ifcImport den IFC-Typ der Property
//   ueber element.psetTypes liefert; fehlt diese Information, wird dataType
//   dokumentiert ignoriert (keine falschen Verletzungen erfinden).

export const IDS_NS = "http://standards.buildingsmart.org/IDS";
export const XS_NS = "http://www.w3.org/2001/XMLSchema";

// ---------------------------------------------------------------------------
// DOM-Hilfen (nur vom Parser benutzt — evaluateIds bleibt DOM-frei)
// ---------------------------------------------------------------------------

// Attribut lesen: null, wenn nicht vorhanden (xmldom liefert sonst u. U. '').
function attr(el, name) {
  return el.hasAttribute && el.hasAttribute(name) ? el.getAttribute(name) : null;
}

// Erstes DIREKTES Kind-Element mit passendem Namespace + localName.
// Bewusst kein positionsbasierter Zugriff: bei ids:classification steht laut XSD
// value (optional) VOR system (Pflicht) — Kindposition wuerde die Felder vertauschen.
function erstesKindNS(el, ns, localName) {
  const kinder = el.childNodes;
  for (let i = 0; i < kinder.length; i++) {
    const k = kinder[i];
    if (k.nodeType === 1 && k.namespaceURI === ns && k.localName === localName) return k;
  }
  return null;
}

// ---------------------------------------------------------------------------
// IdsWert: xs:choice aus ids:simpleValue | xs:restriction
// ---------------------------------------------------------------------------

/**
 * Translates an XSD pattern into an anchored JS RegExp. XSD patterns match the
 * WHOLE value and know no ^/$, hence '^(?:…)$'. The XSD dialect allows
 * constructs JS does not know (e.g. character-class subtraction [a-z-[aeiou]]):
 * then the facet becomes "not satisfiable" with a reason instead of crashing.
 * Shared by the parser and the IDS editor (69-08), which stores specs JSON-safe
 * without RegExp objects and rebuilds the pattern for each run.
 * @param {string} quelle XSD pattern source text
 * @returns {{pattern: RegExp|null, patternFehler: string|null}}
 */
export function xsdMusterZuRegExp(quelle) {
  try {
    return { pattern: new RegExp("^(?:" + quelle + ")$"), patternFehler: null };
  } catch (e) {
    return {
      pattern: null,
      patternFehler: "XSD-Muster nicht in JS-RegExp uebersetzbar: " + (e && e.message ? e.message : String(e)),
    };
  }
}

// Liefert { art:'simple', wert } oder { art:'restriction', ... } oder null.
function parseIdsWert(containerEl) {
  // ids:simpleValue (IDS-Namespace!)
  const simple = erstesKindNS(containerEl, IDS_NS, "simpleValue");
  if (simple) return { art: "simple", wert: simple.textContent != null ? simple.textContent : "" };

  // xs:restriction (XML-SCHEMA-Namespace! — haeufigster Stolperstein)
  const restr = erstesKindNS(containerEl, XS_NS, "restriction");
  if (!restr) return null;

  const wert = {
    art: "restriction",
    base: attr(restr, "base"),
    pattern: null,        // fertig verankerte JS-RegExp oder null
    patternQuelle: null,  // originaler XSD-Pattern-String (fuer Meldungen)
    patternFehler: null,  // gesetzt, wenn das XSD-Pattern nicht in JS uebersetzbar ist
    enumeration: null,    // string[] | null
    bounds: null,         // {minInclusive,maxInclusive,minExclusive,maxExclusive} | null
    length: null,         // {exakt,min,max} | null
  };
  const bounds = { minInclusive: null, maxInclusive: null, minExclusive: null, maxExclusive: null };
  let boundsGesetzt = false;
  const laenge = { exakt: null, min: null, max: null };
  let laengeGesetzt = false;

  const kinder = restr.childNodes;
  for (let i = 0; i < kinder.length; i++) {
    const k = kinder[i];
    if (k.nodeType !== 1 || k.namespaceURI !== XS_NS) continue;
    const v = attr(k, "value");
    switch (k.localName) {
      case "pattern":
        // XSD-Pattern sind implizit VOLL verankert (matchen den GANZEN Wert) und
        // kennen kein ^/$ — in JS deshalb als '^(?:...)$' nachbauen. Der XSD-Dialekt
        // erlaubt Konstrukte, die JS nicht kennt (z. B. Zeichenklassen-Subtraktion
        // [a-z-[aeiou]]) -> xsdMusterZuRegExp faengt das ab: defektes Pattern macht
        // die Facette "nicht erfuellbar" mit Begruendung statt den Parser zu crashen.
        wert.patternQuelle = v != null ? v : "";
        {
          const muster = xsdMusterZuRegExp(wert.patternQuelle);
          wert.pattern = muster.pattern;
          wert.patternFehler = muster.patternFehler;
        }
        break;
      case "enumeration":
        if (!wert.enumeration) wert.enumeration = [];
        wert.enumeration.push(v != null ? v : "");
        break;
      case "minInclusive": bounds.minInclusive = parseFloat(v); boundsGesetzt = true; break;
      case "maxInclusive": bounds.maxInclusive = parseFloat(v); boundsGesetzt = true; break;
      case "minExclusive": bounds.minExclusive = parseFloat(v); boundsGesetzt = true; break;
      case "maxExclusive": bounds.maxExclusive = parseFloat(v); boundsGesetzt = true; break;
      case "length": laenge.exakt = parseInt(v, 10); laengeGesetzt = true; break;
      case "minLength": laenge.min = parseInt(v, 10); laengeGesetzt = true; break;
      case "maxLength": laenge.max = parseInt(v, 10); laengeGesetzt = true; break;
      default: break; // andere XSD-Facetten (whiteSpace, totalDigits, ...) bewusst ignoriert
    }
  }
  if (boundsGesetzt) wert.bounds = bounds;
  if (laengeGesetzt) wert.length = laenge;
  return wert;
}

// IdsWert aus einem benannten Kind der Facette lesen (z. B. <name>, <value>, <system>).
function parseWertKind(facetteEl, localName) {
  const kind = erstesKindNS(facetteEl, IDS_NS, localName);
  return kind ? parseIdsWert(kind) : null;
}

// ---------------------------------------------------------------------------
// Facetten-Parsing
// ---------------------------------------------------------------------------

const FACETTEN_TYPEN = new Set(["entity", "attribute", "property", "classification", "material", "partOf"]);

// cardinality-Attribut gibt es NUR unter requirements (Default 'required');
// in applicability ist jede Facette implizit 'required'. entity hat laut Schema
// gar KEIN cardinality-Attribut (immer required), partOf nur required|prohibited.
function parseKardinalitaet(el, imRequirements, nurSimple) {
  if (!imRequirements) return "required";
  const c = attr(el, "cardinality");
  if (c === "prohibited") return "prohibited";
  if (c === "optional" && !nurSimple) return "optional";
  return "required";
}

function parseFacette(el, localName, imRequirements) {
  switch (localName) {
    case "entity":
      // KEIN cardinality-Attribut im Schema — entity ist immer 'required'.
      return {
        typ: "entity",
        name: parseWertKind(el, "name"),
        predefinedType: parseWertKind(el, "predefinedType"),
      };
    case "attribute":
      return {
        typ: "attribute",
        name: parseWertKind(el, "name"),
        value: parseWertKind(el, "value"),
        cardinality: parseKardinalitaet(el, imRequirements, false),
      };
    case "property": {
      const dt = attr(el, "dataType");
      return {
        typ: "property",
        propertySet: parseWertKind(el, "propertySet"),
        baseName: parseWertKind(el, "baseName"),
        value: parseWertKind(el, "value"),
        // Laut UserManual UPPERCASE (IFCLABEL, IFCTEXT) — beim Parsen normalisieren.
        dataType: dt ? dt.toUpperCase() : null,
        cardinality: parseKardinalitaet(el, imRequirements, false),
      };
    }
    case "classification":
      // XSD-Sequenz: value (optional) VOR system (Pflicht) -> Zugriff strikt per localName.
      return {
        typ: "classification",
        system: parseWertKind(el, "system"),
        value: parseWertKind(el, "value"),
        cardinality: parseKardinalitaet(el, imRequirements, false),
      };
    case "material":
      return {
        typ: "material",
        value: parseWertKind(el, "value"),
        cardinality: parseKardinalitaet(el, imRequirements, false),
      };
    case "partOf": {
      // partOf wird der Vollstaendigkeit halber geparst, aber von evaluateIds NICHT
      // ausgewertet (raeumliche Struktur ist in der elements-Form nicht enthalten).
      const entityEl = erstesKindNS(el, IDS_NS, "entity");
      return {
        typ: "partOf",
        entity: entityEl
          ? { name: parseWertKind(entityEl, "name"), predefinedType: parseWertKind(entityEl, "predefinedType") }
          : null,
        relation: attr(el, "relation"),
        cardinality: parseKardinalitaet(el, imRequirements, true), // simpleCardinality: nur required|prohibited
      };
    }
    default:
      return null;
  }
}

// Alle Facetten unterhalb von <applicability> bzw. <requirements> einsammeln.
function parseFacetten(parentEl, imRequirements) {
  const facetten = [];
  const kinder = parentEl.childNodes;
  for (let i = 0; i < kinder.length; i++) {
    const k = kinder[i];
    if (k.nodeType !== 1 || k.namespaceURI !== IDS_NS) continue;
    if (!FACETTEN_TYPEN.has(k.localName)) continue;
    const f = parseFacette(k, k.localName, imRequirements);
    if (f) facetten.push(f);
  }
  return facetten;
}

// ---------------------------------------------------------------------------
// parseIdsXml — Einstieg (Browser bzw. Node mit injiziertem DOMParser)
// ---------------------------------------------------------------------------

/**
 * Parst eine IDS-1.0-XML-Datei in reine Spec-Objekte.
 * @param {string} xmlString - Inhalt der .ids-Datei.
 * @param {*} [domParser] - Optional: DOMParser-Instanz ODER -Konstruktor (fuer Node,
 *   z. B. aus @xmldom/xmldom). Im Browser wird der native DOMParser benutzt.
 * @returns {Array} specs
 */
export function parseIdsXml(xmlString, domParser) {
  // Parser beschaffen: injizierte Instanz/Konstruktor vor globalem Browser-DOMParser.
  let parser = domParser || null;
  if (parser && typeof parser === "function") parser = new parser();
  if (!parser && typeof globalThis !== "undefined" && typeof globalThis.DOMParser === "function") {
    parser = new globalThis.DOMParser();
  }
  if (!parser || typeof parser.parseFromString !== "function") {
    throw new Error(
      "Kein DOMParser verfuegbar: parseIdsXml laeuft im Browser mit dem nativen DOMParser; " +
      "in Node muss eine DOMParser-Instanz als zweiter Parameter injiziert werden."
    );
  }

  let doc;
  try {
    doc = parser.parseFromString(xmlString, "application/xml");
  } catch (e) {
    // Manche Node-Implementierungen werfen direkt — einheitlich deutsch melden.
    throw new Error("IDS-XML konnte nicht gelesen werden: " + (e && e.message ? e.message : String(e)));
  }

  // Der Browser-DOMParser wirft bei kaputtem XML KEINE Exception, sondern liefert
  // ein Dokument mit <parsererror> — explizit pruefen, sonst wuerden stillschweigend
  // 0 Spezifikationen ausgewertet.
  const parseFehler = doc && doc.getElementsByTagName ? doc.getElementsByTagName("parsererror") : null;
  if (parseFehler && parseFehler.length > 0) {
    const detail = String(parseFehler[0].textContent || "").trim().split("\n")[0];
    throw new Error("IDS-XML konnte nicht gelesen werden (parsererror): " + detail);
  }
  if (!doc || !doc.documentElement) {
    throw new Error("IDS-XML ist leer oder unlesbar.");
  }

  // Namespace-sicher: getElementsByTagNameNS findet <specification> unabhaengig
  // vom gewaehlten Prefix (Default-Namespace, 'ids:', o. ae.).
  const specEls = doc.getElementsByTagNameNS(IDS_NS, "specification");
  const specs = [];
  for (let i = 0; i < specEls.length; i++) {
    specs.push(parseSpecification(specEls[i], i));
  }
  return specs;
}

function parseSpecification(el, index) {
  const name = attr(el, "name");
  if (name == null || name === "") {
    throw new Error("IDS ungueltig: <specification> Nr. " + (index + 1) + " hat kein name-Attribut (Pflichtfeld).");
  }

  const applicabilityEl = erstesKindNS(el, IDS_NS, "applicability");
  const requirementsEl = erstesKindNS(el, IDS_NS, "requirements");

  // Spec-Kardinalitaet ist ueber minOccurs/maxOccurs-ATTRIBUTE auf <applicability>
  // im INSTANZ-Dokument kodiert (xs:occurs): required=1/unbounded, optional=0/unbounded,
  // prohibited=0/0. Fehlen beide Attribute, gilt 'required' (Default minOccurs=1).
  let kardinalitaet = "required";
  if (applicabilityEl) {
    const minRoh = attr(applicabilityEl, "minOccurs");
    const maxRoh = attr(applicabilityEl, "maxOccurs");
    const min = minRoh == null ? 1 : (parseInt(minRoh, 10) || 0);
    if (maxRoh === "0") kardinalitaet = "prohibited";
    else if (min >= 1) kardinalitaet = "required";
    else kardinalitaet = "optional";
  }

  // ifcVersion ist eine xs:list (whitespace-separiert, z. B. 'IFC2X3 IFC4') —
  // splitten, nie als Einzelstring vergleichen.
  const ifcVersionRoh = attr(el, "ifcVersion");

  return {
    name,
    identifier: attr(el, "identifier"),
    beschreibung: attr(el, "description"),
    hinweise: attr(el, "instructions"),
    ifcVersions: ifcVersionRoh ? ifcVersionRoh.trim().split(/\s+/).filter(Boolean) : [],
    kardinalitaet,
    applicability: applicabilityEl ? parseFacetten(applicabilityEl, false) : [],
    // requirements ist optional (minOccurs=0): fehlt es, ist die Spec eine reine
    // Existenz-/Verbotspruefung — leeres Array, NICHT werfen.
    requirements: requirementsEl ? parseFacetten(requirementsEl, true) : [],
  };
}

// ---------------------------------------------------------------------------
// PURE Auswertung — ab hier kein DOM mehr (node-smoke-testbar)
// ---------------------------------------------------------------------------

// Boolean-Normalisierung: IFC liefert '.T.'/'.F.' bzw. echte Booleans, IDS meist
// 'TRUE'/'FALSE' — alles auf 'TRUE'/'FALSE' abbilden; sonst null (kein Boolean).
function normalisiereBool(v) {
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "string") {
    const t = v.trim();
    if (t === ".T." || /^true$/i.test(t)) return "TRUE";
    if (t === ".F." || /^false$/i.test(t)) return "FALSE";
  }
  return null;
}

// Zahl-Erkennung: nur echte Zahlen bzw. rein numerische Strings zaehlen —
// 'A1' o. ae. darf NICHT als Zahl durchgehen.
function zuZahl(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  if (typeof v === "string") {
    const t = v.trim();
    if (t !== "" && /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(t)) return parseFloat(t);
  }
  return NaN;
}

// Relative Toleranz 1e-6 (buildingSMART-Testfaelle): '10' vs 10.000000001 muss
// gleich sein; absoluter Boden fuer Werte nahe 0.
function zahlenGleich(a, b) {
  if (a === b) return true;
  const diff = Math.abs(a - b);
  return diff <= 1e-6 * Math.max(Math.abs(a), Math.abs(b)) || diff < 1e-12;
}

// Gleichheit fuer simpleValue/enumeration: erst Boolean-, dann Zahl-Normalisierung,
// sonst exakter String-Vergleich (case-sensitiv!).
function simpleGleich(erwartet, ist) {
  const be = normalisiereBool(erwartet);
  const bi = normalisiereBool(ist);
  if (be !== null && bi !== null) return be === bi;
  const ne = zuZahl(erwartet);
  const ni = zuZahl(ist);
  if (!Number.isNaN(ne) && !Number.isNaN(ni)) return zahlenGleich(ne, ni);
  return String(erwartet) === String(ist);
}

/**
 * Prueft einen Ist-Wert gegen einen IdsWert (simple oder restriction).
 * Alle gesetzten Restriction-Constraints gelten KONJUNKTIV (alle muessen passen).
 * @returns {boolean}
 */
export function matchIdsWert(idsWert, istWert) {
  if (istWert === null || istWert === undefined) return false;
  if (!idsWert) return false;

  if (idsWert.art === "simple") return simpleGleich(idsWert.wert, istWert);

  if (idsWert.art === "restriction") {
    // Defektes XSD-Pattern => Facette ist nicht erfuellbar (Begruendung steht in
    // patternFehler und wird ueber beschreibeIdsWert im 'erwartet'-Text gemeldet).
    if (idsWert.patternFehler) return false;

    const s = String(istWert);
    if (idsWert.pattern && !idsWert.pattern.test(s)) return false;
    if (idsWert.enumeration && !idsWert.enumeration.some((e) => simpleGleich(e, istWert))) return false;
    if (idsWert.bounds) {
      const n = zuZahl(istWert);
      if (Number.isNaN(n)) return false;
      const b = idsWert.bounds;
      // Inklusiv-Grenzen mit Zahl-Toleranz, Exklusiv-Grenzen strikt.
      if (b.minInclusive !== null && !(n >= b.minInclusive || zahlenGleich(n, b.minInclusive))) return false;
      if (b.maxInclusive !== null && !(n <= b.maxInclusive || zahlenGleich(n, b.maxInclusive))) return false;
      if (b.minExclusive !== null && !(n > b.minExclusive)) return false;
      if (b.maxExclusive !== null && !(n < b.maxExclusive)) return false;
    }
    if (idsWert.length) {
      const l = s.length;
      const L = idsWert.length;
      if (L.exakt !== null && l !== L.exakt) return false;
      if (L.min !== null && l < L.min) return false;
      if (L.max !== null && l > L.max) return false;
    }
    return true;
  }
  return false;
}

// Namens-Vergleich (Attributname, Pset-Name, Property-Name, Klassifikationssystem):
// EXAKT case-sensitiv ohne Zahl-/Boolean-Normalisierung — '01' darf nicht mit '1'
// matchen. Restriktionen (Pattern etc.) laufen ueber matchIdsWert auf dem Namen.
function matchIdsName(idsWert, name) {
  if (name === null || name === undefined || !idsWert) return false;
  if (idsWert.art === "simple") return String(idsWert.wert) === String(name);
  return matchIdsWert(idsWert, name);
}

// UPPERCASE-Variante NUR fuer entity (IFC-Klasse + PredefinedType): das UserManual
// verlangt UPPERCASE (IFCWALL), web-ifc liefert aber 'IfcWall' — beide Seiten
// vor dem Vergleich normalisieren. NICHT fuer Psets/Properties/Material verwenden!
function matchIdsWertUppercase(idsWert, istWert) {
  if (istWert === null || istWert === undefined || !idsWert) return false;
  const istUpper = String(istWert).toUpperCase();
  if (idsWert.art === "simple") return String(idsWert.wert).toUpperCase() === istUpper;
  return matchIdsWert(idsWert, istUpper);
}

/**
 * Menschenlesbare deutsche Beschreibung eines IdsWert (fuer 'erwartet'-Texte).
 */
export function beschreibeIdsWert(wert) {
  if (!wert) return "(kein Wert definiert)";
  if (wert.art === "simple") return "'" + wert.wert + "'";
  const teile = [];
  if (wert.patternFehler) {
    teile.push("nicht auswertbares Muster \"" + (wert.patternQuelle || "") + "\" (" + wert.patternFehler + ")");
  } else if (wert.patternQuelle != null) {
    teile.push("Muster \"" + wert.patternQuelle + "\"");
  }
  if (wert.enumeration) teile.push("einer von [" + wert.enumeration.join(", ") + "]");
  if (wert.bounds) {
    const b = wert.bounds;
    if (b.minInclusive !== null) teile.push(">= " + b.minInclusive);
    if (b.minExclusive !== null) teile.push("> " + b.minExclusive);
    if (b.maxInclusive !== null) teile.push("<= " + b.maxInclusive);
    if (b.maxExclusive !== null) teile.push("< " + b.maxExclusive);
  }
  if (wert.length) {
    const L = wert.length;
    if (L.exakt !== null) teile.push("Laenge = " + L.exakt);
    if (L.min !== null) teile.push("Laenge >= " + L.min);
    if (L.max !== null) teile.push("Laenge <= " + L.max);
  }
  if (teile.length === 0) teile.push("Einschraenkung auf Basis " + (wert.base || "?"));
  return teile.join(" und ");
}

// ---------------------------------------------------------------------------
// Facetten-Pruefung je Element -> { erfuellt, ist, traeger, nichtAuswertbar? }
//   erfuellt: matcht die Facette?
//   ist:      gefundener Ist-Wert (fuer 'gefunden'-Texte), null = nicht vorhanden
//   traeger:  existiert der Traeger (Attribut/Property/Klassifikation/Material)?
//             — relevant fuer cardinality 'optional' (Abwesenheit ist dann ok).
// ---------------------------------------------------------------------------

function pruefeEntity(f, el) {
  const ifcTyp = el.ifcType != null ? String(el.ifcType) : null;
  let erfuellt = matchIdsWertUppercase(f.name, ifcTyp);
  let ist = ifcTyp != null ? ifcTyp.toUpperCase() : null;
  if (erfuellt && f.predefinedType) {
    // element.predefinedType kommt fertig aufgeloest aus ifcImport.js
    // (Typ-Objekt vor Instanz, USERDEFINED -> ObjectType/ElementType).
    const pt = el.predefinedType != null ? String(el.predefinedType) : null;
    erfuellt = matchIdsWertUppercase(f.predefinedType, pt);
    ist = ist + (pt != null ? "." + pt.toUpperCase() : " (ohne PredefinedType)");
  }
  return { erfuellt, ist, traeger: true };
}

function pruefeAttribut(f, el) {
  // Ist-Wert aus element.attributes[name]; Fallbacks: Name -> element.name,
  // GlobalId -> element.globalId (falls nicht ohnehin in attributes enthalten).
  const kandidaten = Object.assign({}, el.attributes || {});
  if (!("Name" in kandidaten) && el.name !== undefined) kandidaten.Name = el.name;
  if (!("GlobalId" in kandidaten) && el.globalId !== undefined) kandidaten.GlobalId = el.globalId;

  const passendeNamen = Object.keys(kandidaten).filter((n) => matchIdsName(f.name, n));
  let traeger = false;
  let erfuellt = false;
  let ist = null;
  for (const n of passendeNamen) {
    const v = kandidaten[n];
    if (v === null || v === undefined) continue;
    traeger = true;
    ist = v;
    if (f.value) {
      if (matchIdsWert(f.value, v)) { erfuellt = true; break; }
    } else if (String(v) !== "") {
      // Ohne value-Vorgabe: nur Existenz + nicht-leer pruefen.
      erfuellt = true;
      break;
    }
  }
  return { erfuellt, ist, traeger };
}

function pruefeProperty(f, el) {
  const psets = el.psets || {};
  // Optionaler IFC-Typ je Property (z. B. 'IFCLABEL') aus ifcImport; fehlt er,
  // wird f.dataType dokumentiert ignoriert (keine Verletzung auf Verdacht).
  const typen = el.psetTypes || null;
  let traeger = false;
  let erfuellt = false;
  let ist = null;

  // Pset-Match EXAKT case-sensitiv; ist propertySet eine Restriktion (Pattern),
  // wird ueber ALLE Pset-Namen iteriert — nie nur direkter Key-Zugriff.
  for (const psetName of Object.keys(psets)) {
    if (!matchIdsName(f.propertySet, psetName)) continue;
    const props = psets[psetName] || {};
    for (const propName of Object.keys(props)) {
      if (!matchIdsName(f.baseName, propName)) continue;
      const v = props[propName];
      if (v === null || v === undefined) continue;
      traeger = true;
      ist = v;
      if (f.dataType && typen && typen[psetName] && typen[psetName][propName]) {
        // Datentyp nur pruefen, wenn bekannt — konjunktiv zum Wert-Match.
        if (String(typen[psetName][propName]).toUpperCase() !== f.dataType) continue;
      }
      if (f.value) {
        if (matchIdsWert(f.value, v)) { erfuellt = true; break; }
      } else {
        // Ohne value-Vorgabe: reine Existenzpruefung.
        erfuellt = true;
        break;
      }
    }
    if (erfuellt) break;
  }
  return { erfuellt, ist, traeger };
}

function pruefeKlassifikation(f, el) {
  // Phase 71-01 (additive Erweiterung, Entscheidung in 71-01-SUMMARY): der
  // Import liefert `classifications` als Array („<code> <name>"-Strings aus
  // IfcRelAssociatesClassification, ifcImport.js:278-281) UND — rückwärts-
  // kompatibel — `classification` als Einzelobjekt {system, code}. Ein Bauteil
  // kann MEHRERE Klassifikationsreferenzen tragen (mini.ifc #31: code „10"
  // und „tragend"); die Einzelobjekt-Form verlor alle bis auf eine. Neu:
  // mind. EIN Array-Eintrag muss matchen; System-Prüfung nur, wenn die IDS
  // eines nennt UND der Eintrag eines trägt (der Import kennt das System
  // nicht — ifcImport liefert nur „<code> <name>"). Die Objekt-Form bleibt
  // der Fallback für alle bestehenden Aufrufer.
  /** @type {Array<{system: string|null, code: string|null}>} */
  const kandidaten = [];
  if (Array.isArray(el.classifications) && el.classifications.length) {
    for (const eintrag of el.classifications) {
      if (eintrag && typeof eintrag === "object") {
        kandidaten.push({ system: eintrag.system ?? null, code: eintrag.code ?? null });
      } else if (typeof eintrag === "string" && eintrag.trim()) {
        // „<code> <name>" — erster Token ist der Code (ifcImport.js:280).
        kandidaten.push({ system: null, code: eintrag.trim().split(/\s+/)[0] });
      }
    }
  } else if (el.classification) {
    kandidaten.push({
      system: el.classification.system ?? null,
      code: el.classification.code ?? null,
    });
  }
  if (!kandidaten.length) return { erfuellt: false, ist: null, traeger: false };

  let erfuellt = false;
  for (const k of kandidaten) {
    // System-Facette: greift nur, wenn beide Seiten eines haben (s. o.).
    if (f.system && k.system != null && !matchIdsName(f.system, k.system)) continue;
    if (f.value && !matchIdsWert(f.value, k.code)) continue;
    if (!f.system && !f.value) continue; // leere Facette matcht nichts (keine Schein-Erfüllung)
    erfuellt = true;
    break;
  }
  const ist = kandidaten
    .map((k) => (k.system != null ? String(k.system) : "?") + (k.code != null ? ": " + k.code : ""))
    .join(", ");
  return { erfuellt, ist, traeger: true };
}

function pruefeMaterial(f, el) {
  const mats = Array.isArray(el.material) ? el.material : [];
  const traeger = mats.length > 0;
  // Es reicht, wenn mindestens EIN Material-Eintrag matcht.
  const erfuellt = f.value ? mats.some((m) => matchIdsWert(f.value, m)) : traeger;
  return { erfuellt, ist: traeger ? mats.join(", ") : null, traeger };
}

function pruefeFacette(f, el) {
  switch (f.typ) {
    case "entity": return pruefeEntity(f, el);
    case "attribute": return pruefeAttribut(f, el);
    case "property": return pruefeProperty(f, el);
    case "classification": return pruefeKlassifikation(f, el);
    case "material": return pruefeMaterial(f, el);
    default:
      // partOf (und Unbekanntes): wird NICHT ausgewertet — in der applicability
      // neutral behandelt (andere Facetten entscheiden), in den requirements
      // uebersprungen. Dokumentierte Einschraenkung dieser Implementierung.
      return { erfuellt: true, ist: null, traeger: false, nichtAuswertbar: true };
  }
}

// Deutsche 'erwartet'-Beschreibung einer Facette (fuer Verletzungsmeldungen).
function beschreibeFacette(f) {
  switch (f.typ) {
    case "entity": {
      let s = "IFC-Klasse " + beschreibeIdsWert(f.name);
      if (f.predefinedType) s += " mit PredefinedType " + beschreibeIdsWert(f.predefinedType);
      return s;
    }
    case "attribute":
      return "Attribut " + beschreibeIdsWert(f.name) +
        (f.value ? " = " + beschreibeIdsWert(f.value) : " vorhanden und nicht leer");
    case "property": {
      let s = "Merkmal " + beschreibeIdsWert(f.baseName) + " im Pset " + beschreibeIdsWert(f.propertySet);
      s += f.value ? " = " + beschreibeIdsWert(f.value) : " vorhanden";
      if (f.dataType) s += " (Datentyp " + f.dataType + ", geprueft nur bei bekanntem Property-Typ)";
      return s;
    }
    case "classification":
      return "Klassifikation im System " + beschreibeIdsWert(f.system) +
        (f.value ? " mit Referenz " + beschreibeIdsWert(f.value) : "");
    case "material":
      return f.value ? "Material " + beschreibeIdsWert(f.value) : "mindestens ein Material vorhanden";
    default:
      return "Facette '" + f.typ + "' (wird nicht ausgewertet)";
  }
}

function alsText(v) {
  return Array.isArray(v) ? v.join(", ") : String(v);
}

function elementLabel(el) {
  return (el.ifcType ? String(el.ifcType) : "Element") +
    (el.name ? " '" + el.name + "'" : "") +
    (el.globalId ? " [" + el.globalId + "]" : "");
}

function verletzung(el, f, erwartet, ergebnis) {
  return {
    globalId: el.globalId !== undefined ? el.globalId : null,
    elementName: el.name !== undefined && el.name !== null ? el.name : null,
    facette: f.typ,
    erwartet,
    gefunden: ergebnis.ist !== null && ergebnis.ist !== undefined ? alsText(ergebnis.ist) : "nicht vorhanden",
  };
}

// ---------------------------------------------------------------------------
// evaluateIds — PURE Auswertung der Specs gegen die Elementliste
// ---------------------------------------------------------------------------

/**
 * Wertet geparste IDS-Spezifikationen gegen die Elementliste aus.
 * PURE: kein DOM, kein Browser — direkt in Node testbar.
 *
 * @param {Array} specs - Spec-Objekte (aus parseIdsXml oder handgebaut).
 * @param {Array} elements - Elemente in der oben dokumentierten Form.
 * @returns {Array<{spec:{name,identifier,kardinalitaet,beschreibung:string|null,hinweise:string|null}, anwendbar:number,
 *   bestanden:boolean, verletzungen:Array<{globalId,elementName,facette,erwartet,gefunden}>}>}
 */
export function evaluateIds(specs, elements) {
  const alleElemente = Array.isArray(elements) ? elements : [];

  return (specs || []).map((spec) => {
    const applicability = Array.isArray(spec.applicability) ? spec.applicability : [];
    const requirements = Array.isArray(spec.requirements) ? spec.requirements : [];
    const kardinalitaet = spec.kardinalitaet || "required";

    // (1) Anwendbare Elemente: JEDE applicability-Facette muss matchen
    // (implizit 'required'). Leere applicability => 0 anwendbar (gemaess
    // Plan-Smoke) — NICHT "alle Elemente anwendbar".
    const anwendbare = applicability.length === 0
      ? []
      : alleElemente.filter((el) =>
          applicability.every((f) => {
            const r = pruefeFacette(f, el);
            return r.nichtAuswertbar ? true : r.erfuellt;
          })
        );

    const verletzungen = [];
    let bestanden = true;

    if (kardinalitaet === "prohibited") {
      // (2) Verbots-Spezifikation: der FUND anwendbarer Elemente ist die
      // Verletzung; requirements werden laut Doku IGNORIERT.
      bestanden = anwendbare.length === 0;
      for (const el of anwendbare) {
        verletzungen.push({
          globalId: el.globalId !== undefined ? el.globalId : null,
          elementName: el.name !== undefined && el.name !== null ? el.name : null,
          facette: "applicability",
          erwartet: "kein Element entspricht der Anwendbarkeit (verboten)",
          gefunden: elementLabel(el),
        });
      }
    } else if (anwendbare.length === 0) {
      if (kardinalitaet === "required") {
        // 'required' ohne anwendbare Elemente: nicht bestanden.
        bestanden = false;
        verletzungen.push({
          globalId: null,
          elementName: null,
          facette: "applicability",
          erwartet: "mind. 1 anwendbares Element",
          gefunden: "0",
        });
      }
      // 'optional' ohne anwendbare Elemente: bestanden.
    } else {
      // (3) Requirements je anwendbarem Element. Leere requirements = reine
      // Existenzpruefung: die Kardinalitaetsregel der Spec ist erfuellt => bestanden.
      for (const el of anwendbare) {
        for (const f of requirements) {
          const r = pruefeFacette(f, el);
          if (r.nichtAuswertbar) continue; // z. B. partOf — dokumentiert uebersprungen
          // entity hat kein cardinality-Attribut => immer 'required'.
          const kard = f.typ === "entity" ? "required" : (f.cardinality || "required");
          if (kard === "required") {
            if (!r.erfuellt) verletzungen.push(verletzung(el, f, beschreibeFacette(f), r));
          } else if (kard === "prohibited") {
            // Match ist hier die Verletzung.
            if (r.erfuellt) verletzungen.push(verletzung(el, f, "nicht vorhanden/abweichend", r));
          } else {
            // 'optional': nur pruefen, wenn der Traeger existiert
            // (Property/Attribut/Klassifikation vorhanden); Abwesenheit ist ok.
            if (r.traeger && !r.erfuellt) {
              verletzungen.push(verletzung(el, f, beschreibeFacette(f) + " (optional, aber Traeger vorhanden)", r));
            }
          }
        }
      }
      bestanden = verletzungen.length === 0;
    }

    return {
      spec: {
        name: spec.name,
        identifier: spec.identifier !== undefined ? spec.identifier : null,
        kardinalitaet,
        // 66-07: origin of the spec (IDS description/instructions) — the BCF topic
        // names it as "Grundlage", so it must survive the evaluation.
        beschreibung: spec.beschreibung || null,
        hinweise: spec.hinweise || null,
      },
      anwendbar: anwendbare.length,
      bestanden,
      verletzungen,
    };
  });
}
