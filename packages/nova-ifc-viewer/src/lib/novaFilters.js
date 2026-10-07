// NOVA-AVA-Bauteilfilter direkt am IFC anwenden (Phase-30-Spike).
//
// Büro A pflegt seine Bauteilfilter in NOVA AVA und exportiert sie als XML
// (…/Vorlagen/FILTER_NOVAAVA/<Projekt>/**.xml). Die Kriterien stecken darin als
// PHP-serialisiertes Array im CDATA von <criteria>. Diese Datei liest sie und
// wendet sie auf die IFC-Elemente an — damit gilt dieselbe Mengenlogik
// („WAS ∩ ZUSTAND") ohne NOVA, direkt am Modell.
//
// Kriterien-Semantik (an 207 Realfiltern verifiziert):
//   field:     ifc_layer | ifc_material | ifc_object_type | ifc_element_type |
//              ifc_predefined_type | ifc_storey | Status | name | QTY.<Name> | CLASS.<System>
//   operator:  e = gleich (case-insensitiv) · c = enthält
//   type:      add = ODER-Menge erweitern · remove_others = Schnittmenge (UND) ·
//              remove = Treffer entfernen
//   element:   "any" oder ein NOVA-Elementtyp-Code (numerisch; hier ignoriert —
//              die Feldkriterien sind trennscharf genug)

const PHP_STR = (s) => s; // Werte kommen schon entschlüsselt aus der Regex

// PHP-serialisiertes Kriterien-Array → [{ element, fieldtype, field, operator, value, type }]
export function parseCriteria(cdata) {
  const out = [];
  // Jedes Kriterium ist ein a:7:{…}-Block mit den immer gleichen sieben Schlüsseln.
  const blocks = String(cdata || "").split(/i:\d+;a:7:\{/).slice(1);
  for (const b of blocks) {
    const get = (key) => {
      const m = b.match(new RegExp(`s:${key.length}:"${key}";s:\\d+:"((?:[^"\\\\]|\\\\.)*)"`));
      return m ? PHP_STR(m[1]) : "";
    };
    const crit = {
      element: get("element"), fieldtype: get("fieldtype"), field: get("field"),
      operator: get("operator"), value: get("value"), type: get("type"),
    };
    if (crit.field && crit.field !== "none") out.push(crit);
  }
  return out;
}

// Filter-XML (ein <buildingfilter>) → { id, title, criteria }
export function parseFilterXml(xml) {
  const out = [];
  const re = /<buildingfilter id="([^"]*)">([\s\S]*?)<\/buildingfilter>/g;
  let m;
  while ((m = re.exec(String(xml || "")))) {
    const body = m[2];
    const mt = body.match(/<title>([\s\S]*?)<\/title>/);
    const mc = body.match(/<criteria><!\[CDATA\[([\s\S]*?)\]\]><\/criteria>/);
    const titel = mt ? mt[1].trim() : "";
    out.push({ id: m[1], title: titel, titel, criteria: parseCriteria(mc ? mc[1] : "") });
  }
  return out;
}

// Feldwert eines IFC-Elements für ein Filterfeld ermitteln.
// el = Element aus parseIfcFile/extractSemantics
// { expressId, ifcType, name, storey, layer, materials[], status, mengen{}, classification }
function fieldValues(el, field) {
  if (field.startsWith("QTY.")) {
    const q = field.slice(4).toLowerCase();
    const map = {
      width: el.mengen?.width, breite: el.mengen?.width,
      height: el.mengen?.height, area: el.mengen?.area,
      volume: el.mengen?.volume, length: el.mengen?.length, count: 1,
    };
    const v = map[q];
    return v == null ? [] : [String(v)];
  }
  if (field.startsWith("CLASS.")) return [el.classification?.code, el.classification?.name].filter(Boolean);
  switch (field) {
    case "ifc_layer": return el.layer ? [el.layer] : [];
    case "ifc_material": return el.materials || [];
    case "ifc_object_type": return [el.typ, el.name].filter(Boolean);
    case "ifc_element_type": return el.ifcType ? [el.ifcType] : [];
    case "ifc_predefined_type": return el.predefinedType ? [el.predefinedType] : [];
    case "ifc_storey": return el.storey ? [el.storey] : [];
    case "name": return el.name ? [el.name] : [];
    case "Status": {
      // Filter arbeiten mit IFC-Werten (NEW/EXISTING/DEMOLISH), unsere Elemente
      // tragen die deutsche Normalform (neubau/bestand/abbruch) → beides anbieten.
      const de = el.status || "";
      const en = { neubau: "NEW", bestand: "EXISTING", abbruch: "DEMOLISH" }[de] || "";
      return [en, de].filter(Boolean);
    }
    default: {
      // Freies Pset-Feld (z. B. FireRating) über alle Psets suchen
      const hits = [];
      for (const props of Object.values(el.psets || {})) {
        for (const [k, v] of Object.entries(props || {})) {
          if (k.toLowerCase() === field.toLowerCase() && v != null) hits.push(String(v));
        }
      }
      return hits;
    }
  }
}

function matchCriterion(el, crit) {
  const vals = fieldValues(el, crit.field);
  if (!vals.length) return false;
  const target = String(crit.value ?? "").trim().toLowerCase();
  if (!target) return false;
  return vals.some((v) => {
    const s = String(v).trim().toLowerCase();
    if (crit.operator === "c") return s.includes(target);
    // "e" — Zahlenvergleich toleriert Rundungsrauschen (0,2399999 == 0,24)
    const a = Number(s.replace(",", ".")), b = Number(target.replace(",", "."));
    if (Number.isFinite(a) && Number.isFinite(b)) return Math.abs(a - b) < 0.0015;
    return s === target;
  });
}

// Filter auf eine Elementliste anwenden → Treffer-Array (Reihenfolge wie Eingabe).
// Auswertung sequenziell wie in NOVA: add sammelt (ODER), remove_others schneidet
// (UND), remove entfernt. Beginnt ein Filter direkt mit remove_others, gilt die
// Gesamtmenge als Startmenge.
export function applyNovaFilter(elements, filter) {
  let set = null;
  for (const crit of filter?.criteria || []) {
    const hits = new Set();
    for (const el of elements) if (matchCriterion(el, crit)) hits.add(el);
    if (crit.type === "remove_others") {
      set = set === null ? hits : new Set([...set].filter((el) => hits.has(el)));
    } else if (crit.type === "remove") {
      if (set) for (const el of hits) set.delete(el);
    } else {
      set = set === null ? hits : new Set([...set, ...hits]);
    }
  }
  if (set === null) return [];
  return elements.filter((el) => set.has(el));
}

// Menge eines Filters nach Büro-Basis (area/volume/length/count).
export function novaFilterQuantity(elements, filter, basis = "area") {
  const hits = applyNovaFilter(elements, filter);
  const sum = hits.reduce((s, el) => s + (basis === "count" ? 1 : (el.mengen?.[basis] || 0)), 0);
  return { treffer: hits.length, menge: Math.round(sum * 1000) / 1000, elemente: hits };
}
