// idsWriter.js — buildingSMART IDS 1.0 WRITER fuer die Pruef-Suite (Phase 71-01).
//
// Gegenstueck zu ids.js:parseIdsXml — dieselbe Objektform, andere Richtung:
//   schreibeIds(specs, info) -> IDS-1.0-XML-String
//
// REIN und DOM-FREI (T-Entscheidung D-P71-01): kein DOMParser, kein Browser,
// unter Node testbar. XML-Escaping ueber eine eigene kleine Funktion.
//
// Spec-Form = exakt die Ausgabe von parseIdsXml (ids.js:297-308), damit
// evaluateIds(specs, elemente) DIREKT mit den Writer-Specs laeuft — der Test
// ist nicht "Writer -> Parser" (kein DOMParser in Node), sondern
// "Writer-Specs -> evaluateIds" plus String-Assertions auf dem XML.
//
// Facetten-Werte akzeptiert der Writer in zwei Formen:
//   Parse-Form  { art: 'simple', wert } bzw. { art: 'restriction', enumeration?, pattern?, base? }
//   Kurzform    { simple: 'IFCWALL' } / { enumeration: [...] } / { pattern: '...' }
//
// T-71-01 (XML-Injection aus fremder LOI-Quelle): ALLE Texte werden escapet;
// Namen ausserhalb des erlaubten Zeichensatzes landen in `warnungen` (der
// Writer wirft nicht — eine merkwuerdige LOI darf die Erzeugung nicht stoppen,
// aber der Befund muss sichtbar bleiben).

/**
 * Zeichen, die ein IDS-Name enthalten darf. Bewusst weiter als der Plan-
 * Vorschlag [A-Za-z0-9_.:\- ]: die echten LOI-Blaetter tragen Umlaute
 * („Stützen"), Klammern („Typ (IfcPlate)") und Schraegstriche. Alles andere
 * (Steuerzeichen, spitze Klammern, Anfuehrungszeichen) ist verdächtig.
 */
const NAME_ERLAUBT = /^[\p{L}\p{N}_.:\- /()[\],+°%²³]*$/u;

/**
 * Fixed lead text of the name warning; the name follows in „…“. Exported so a
 * UI can translate the lead text (idsEditorKern.writerWarnungTeilen, 69-08).
 * The warning text itself is unchanged, so the output stays byte-identical.
 */
export const WARNUNG_NAME_ZEICHEN = "Name enthält auffällige Zeichen und wurde nur escapet geschrieben: ";

/**
 * XML-Escaping fuer Textknoten UND Attributwerte (doppelte Quotes).
 * @param {unknown} text
 * @returns {string}
 */
export function xmlEscape(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Normalisiert einen Facetten-Wert in die Parse-Form { art, … }.
 * @param {*} wert Kurzform {simple}|{enumeration}|{pattern} oder Parse-Form
 * @returns {{art:string}|null}
 */
function normalisiereWert(wert) {
  if (wert == null) return null;
  if (wert.art === "simple" || wert.art === "restriction") return wert;
  if ("simple" in wert) return { art: "simple", wert: wert.simple };
  if ("enumeration" in wert) {
    return { art: "restriction", base: wert.base || "xs:string", enumeration: wert.enumeration,
      pattern: null, patternQuelle: null, patternFehler: null, bounds: null, length: null };
  }
  if ("pattern" in wert) {
    return { art: "restriction", base: wert.base || "xs:string", enumeration: null,
      pattern: null, patternQuelle: wert.pattern, patternFehler: null, bounds: null, length: null };
  }
  return null;
}

/**
 * Schreibt einen IdsWert als XML-Kinder von <name>/<value>/<propertySet>/…
 * simple -> <ids:simpleValue>, restriction -> <xs:restriction> (XS-Namespace!).
 * @param {string} tag Container-Elementname ohne Praefix (z. B. 'name')
 * @param {*} wert
 * @param {string} e Einrueckung
 * @returns {string[]} XML-Zeilen
 */
function wertZeilen(tag, wert, e) {
  const w = normalisiereWert(wert);
  if (!w) return [];
  if (w.art === "simple") {
    return [`${e}<${tag}><simpleValue>${xmlEscape(w.wert)}</simpleValue></${tag}>`];
  }
  // restriction: xs:restriction + xs:pattern / xs:enumeration (ids.js liest sie
  // unter XS_NS, also MIT Praefix schreiben).
  const zeilen = [`${e}<${tag}>`, `${e}  <xs:restriction base="${xmlEscape(w.base || "xs:string")}">`];
  if (w.patternQuelle != null) {
    zeilen.push(`${e}    <xs:pattern value="${xmlEscape(w.patternQuelle)}" />`);
  }
  for (const enumWert of w.enumeration || []) {
    zeilen.push(`${e}    <xs:enumeration value="${xmlEscape(enumWert)}" />`);
  }
  if (w.bounds) {
    const b = w.bounds;
    if (b.minInclusive !== null && b.minInclusive !== undefined) zeilen.push(`${e}    <xs:minInclusive value="${xmlEscape(b.minInclusive)}" />`);
    if (b.maxInclusive !== null && b.maxInclusive !== undefined) zeilen.push(`${e}    <xs:maxInclusive value="${xmlEscape(b.maxInclusive)}" />`);
    if (b.minExclusive !== null && b.minExclusive !== undefined) zeilen.push(`${e}    <xs:minExclusive value="${xmlEscape(b.minExclusive)}" />`);
    if (b.maxExclusive !== null && b.maxExclusive !== undefined) zeilen.push(`${e}    <xs:maxExclusive value="${xmlEscape(b.maxExclusive)}" />`);
  }
  zeilen.push(`${e}  </xs:restriction>`, `${e}</${tag}>`);
  return zeilen;
}

/**
 * Eine Facette als XML-Block. `imRequirements` steuert das cardinality-Attribut
 * (in applicability gibt es laut Schema keines — ids.js:131-140).
 * @param {object} f Facette in Parse-Form
 * @param {boolean} imRequirements
 * @param {string} e Einrueckung
 * @returns {string[]}
 */
function facettenZeilen(f, imRequirements, e) {
  const kard = imRequirements && f.cardinality && f.cardinality !== "required"
    ? ` cardinality="${xmlEscape(f.cardinality)}"`
    : "";
  switch (f.typ) {
    case "entity": {
      // entity hat laut Schema NIE ein cardinality-Attribut (immer required).
      const zeilen = [`${e}<entity>`];
      zeilen.push(...wertZeilen("name", f.name, `${e}  `));
      zeilen.push(...wertZeilen("predefinedType", f.predefinedType, `${e}  `));
      zeilen.push(`${e}</entity>`);
      return zeilen;
    }
    case "attribute": {
      const zeilen = [`${e}<attribute${kard}>`];
      zeilen.push(...wertZeilen("name", f.name, `${e}  `));
      zeilen.push(...wertZeilen("value", f.value, `${e}  `));
      zeilen.push(`${e}</attribute>`);
      return zeilen;
    }
    case "property": {
      const dt = f.dataType ? ` dataType="${xmlEscape(f.dataType)}"` : "";
      const zeilen = [`${e}<property${dt}${kard}>`];
      zeilen.push(...wertZeilen("propertySet", f.propertySet, `${e}  `));
      zeilen.push(...wertZeilen("baseName", f.baseName, `${e}  `));
      zeilen.push(...wertZeilen("value", f.value, `${e}  `));
      zeilen.push(`${e}</property>`);
      return zeilen;
    }
    case "classification": {
      // XSD-Sequenz: value (optional) VOR system (ids.js:171 liest per localName,
      // aber die Reihenfolge soll dem Schema folgen).
      const zeilen = [`${e}<classification${kard}>`];
      zeilen.push(...wertZeilen("value", f.value, `${e}  `));
      zeilen.push(...wertZeilen("system", f.system, `${e}  `));
      zeilen.push(`${e}</classification>`);
      return zeilen;
    }
    case "material": {
      const zeilen = [`${e}<material${kard}>`];
      zeilen.push(...wertZeilen("value", f.value, `${e}  `));
      zeilen.push(`${e}</material>`);
      return zeilen;
    }
    default:
      throw new Error(`schreibeIds: Facettentyp '${f.typ}' kann nicht geschrieben werden (partOf ist Lese-only)`);
  }
}

/**
 * Prueft einen Namen auf den erlaubten Zeichensatz (T-71-01) und sammelt
 * Auffaelligkeiten als Warnung.
 * @param {string} name
 * @param {string[]} warnungen
 */
function pruefeName(name, warnungen) {
  if (name && !NAME_ERLAUBT.test(String(name))) {
    warnungen.push(`${WARNUNG_NAME_ZEICHEN}„${name}“`);
  }
}

/**
 * Schreibt Spezifikationen als IDS-1.0-XML (Default-Namespace wie
 * musterprojekt.ids, xs: praefix fuer Restrictions).
 *
 * Deterministisch: keine Zeitstempel, feste Attribut- und Elementreihenfolge —
 * gleiche Eingabe ergibt byte-gleiche Ausgabe (Drift-Schutz T-71-03).
 *
 * @param {Array<object>} specs - Spezifikationen in parseIdsXml-Form:
 *   { name, identifier?, beschreibung?, hinweise?, ifcVersions: string[],
 *     kardinalitaet?: 'required'|'optional'|'prohibited',
 *     applicability: Facette[], requirements: Facette[] }
 * @param {{title?: string, description?: string, author?: string, version?: string}} [info]
 * @returns {{xml: string, warnungen: string[]}} XML-String + Auffaelligkeiten
 */
export function schreibeIds(specs, info = {}) {
  const warnungen = [];
  const liste = Array.isArray(specs) ? specs : [];
  if (!liste.length) throw new Error("schreibeIds: keine Spezifikationen übergeben");

  const zeilen = [];
  zeilen.push('<?xml version="1.0" encoding="UTF-8"?>');
  zeilen.push('<ids xmlns="http://standards.buildingsmart.org/IDS" xmlns:xs="http://www.w3.org/2001/XMLSchema">');
  zeilen.push("  <info>");
  zeilen.push(`    <title>${xmlEscape(info.title || "IDS")}</title>`);
  if (info.description) zeilen.push(`    <description>${xmlEscape(info.description)}</description>`);
  if (info.author) zeilen.push(`    <author>${xmlEscape(info.author)}</author>`);
  zeilen.push(`    <version>${xmlEscape(info.version || "1.0")}</version>`);
  zeilen.push("  </info>");
  zeilen.push("  <specifications>");

  for (const spec of liste) {
    if (!spec || !spec.name) throw new Error("schreibeIds: Spezifikation ohne name (Pflichtfeld)");
    pruefeName(spec.name, warnungen);

    // Spec-Kardinalitaet als minOccurs/maxOccurs auf <applicability> kodieren —
    // genau der Weg, den ids.js:283-291 zurueckliest (required=1/unbounded,
    // optional=0/unbounded, prohibited=0/0).
    const kard = spec.kardinalitaet || "required";
    const occurs = kard === "prohibited" ? ' minOccurs="0" maxOccurs="0"'
      : kard === "optional" ? ' minOccurs="0" maxOccurs="unbounded"'
      : ' minOccurs="1" maxOccurs="unbounded"';

    const attr = [`name="${xmlEscape(spec.name)}"`];
    if (spec.identifier != null) attr.push(`identifier="${xmlEscape(spec.identifier)}"`);
    if (spec.beschreibung != null) attr.push(`description="${xmlEscape(spec.beschreibung)}"`);
    if (spec.hinweise != null) attr.push(`instructions="${xmlEscape(spec.hinweise)}"`);
    const versionen = Array.isArray(spec.ifcVersions) && spec.ifcVersions.length
      ? spec.ifcVersions : ["IFC2X3", "IFC4"];
    // ifcVersion ist eine xs:list (ids.js:293-295) — whitespace-separiert.
    attr.push(`ifcVersion="${versionen.map((v) => xmlEscape(v)).join(" ")}"`);

    zeilen.push(`    <specification ${attr.join(" ")}>`);
    zeilen.push(`      <applicability${occurs}>`);
    for (const f of spec.applicability || []) zeilen.push(...facettenZeilen(f, false, "        "));
    zeilen.push("      </applicability>");
    if ((spec.requirements || []).length) {
      zeilen.push("      <requirements>");
      for (const f of spec.requirements) zeilen.push(...facettenZeilen(f, true, "        "));
      zeilen.push("      </requirements>");
    }
    zeilen.push("    </specification>");
  }

  zeilen.push("  </specifications>");
  zeilen.push("</ids>");
  return { xml: zeilen.join("\n") + "\n", warnungen };
}
