// Echter IFC-Import mit web-ifc (WASM, lokal, kein CDN) — Phase 26, ausgebaut in Phase 33/W2
// zur vollwertigen Ersatzimplementierung der Python-IFC-Bibliothek der Pipeline
// (Elementwahrheit L1–L10). Der Bibliotheksname steht in der Entwicklerdokumentation;
// im Kundenpaket wird er nicht genannt (Guard-Regel, T-33-26).
//
// parseIfcFile(arrayBuffer)         → semantische Extraktion (Browser: WASM via ifcWasm.js)
// extractFromModel(api, modelID)    → dieselbe Extraktion auf einem SCHON offenen Modell
//                                     (Node-Pfad für Gate G5 — kein Vite, kein `?url`)
// mapToClassifiedElements(parsed)   → die classifiedElements-Form aus Phase 25
//                                     ({id,kind,kg,gewerk,schicht,status,mengen})
// extractGeometry(arrayBuffer)      → Phase 64: Welt-Dreiecke + AABB je Bauteil
//                                     für die Prüf-Suite (Clash/BCF) via StreamAllMeshes — siehe unten.
//
// WICHTIG (L1): `id` ist die IFC **GlobalId**, nicht die expressId. Die expressId wird bei
// jedem Re-Export neu vergeben — eine Position↔Bauteil-Bindung darauf überlebt keinen
// Modellstand. Die GlobalId ist stabil.
//
// WICHTIG (L8): der Status wird NIE gedefaultet. Ein Bauteil ohne belegten Umbau-Status
// kommt als `status: null` + Eintrag in `warnungen[]` (im Referenzprojekt, anonymisiert: 355 von
// 6.038 Bauteilen = 5,9 %). In einem Umbauprojekt wäre ein stilles „neubau" eine
// Falschaussage mit Geldwert — 5,9 % der Bauteile würden lautlos in den Neubau-Mengen
// landen. Die einzige Normalisierungsstelle ist `normalizeStatus` (@core, Katalog
// `StatusKonvention`); hier steht bewusst KEINE zweite Tabelle (T-33-04).
//
// L4 / BEKANNTE ABWEICHUNG (bewusst NICHT korrigiert): trägt ein Bauteil zwei
// IfcElementQuantity-Sets, die denselben BaseQuantity-Namen mit verschiedenen Werten
// führen, gewinnt — wie im Python-Upstream — das ZULETZT gelesene Set. Die Reihenfolge ist
// hier deterministisch (aufsteigende expressId der Definition), damit das Ergebnis
// reproduzierbar ist. Diese Konvention ist Prüfgegenstand der Golden-Files: würde sie hier
// „richtiger" gemacht, gäbe es kein Gate mehr, das die Portierung absichert.

import * as WebIFC from "web-ifc";
import {
  kgFromKind,
  gewerkFromKind,
  SCHICHTEN,
  normalizeStatus,
} from "@core/lib/bimClassification";
import { IFC_QUANTITY_KEYS, mengenAusQty } from "@core/lib/bimElements";

// --- Helfer ------------------------------------------------------------------------------

// IFC-Werte kommen als { type, value } — defensiv entpacken.
const val = (x) => (x && typeof x === "object" && "value" in x ? x.value : x);

const num = (x) => {
  const n = Number(val(x));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

// BaseQuantities: 0 und negative Werte sind gültige Messwerte, nur NaN ist keiner.
//
// Rundung auf 4 Stellen wie im Orakel (`round(v, 4)`). Bewusst über `toFixed(4)` und NICHT
// über `Math.round(n * 1e4) / 1e4`: das Skalieren verschiebt den Wert (3,80475 × 1e4 =
// 38047.500000000004 ⇒ Math.round hebt auf 3,8048, Python rundet den echten Double auf
// 3,8047). Ein einziges Bauteil im Referenzprojekt hängt daran — und genau solche Einzelabweichungen
// machen einen Paritätsnachweis unbrauchbar. `toFixed` rundet den Double korrekt.
const qtyNum = (x) => {
  const n = Number(val(x));
  return Number.isFinite(n) ? Number(n.toFixed(4)) : null;
};

const str = (x) => {
  const v = val(x);
  return v == null ? null : String(v);
};

const vecToArray = (vec) => {
  const out = [];
  if (!vec) return out;
  for (let i = 0; i < vec.size(); i++) out.push(vec.get(i));
  return out;
};

// Boolesche Pset-Werte (IsExternal): web-ifc liefert je nach Schema true/"T"/".T.".
const isTrue = (x) => {
  const v = val(x);
  return v === true || v === "T" || v === ".T." || v === "TRUE" || v === 1;
};

// L2: statt einer Handvoll namentlich gepflegter Klassen ALLE IfcElement-Subtypen
// (includeInherited) plus IfcSpace. Die alte Liste kannte 12 Typen und erfasste damit nur
// 57,7 % der 6.038 Bauteile — `IfcCurtainWall` (303, Pfosten-Riegel-Fassade UND
// Wandfliesen), `IfcRailing` (30) und `IfcBuildingElementProxy` (1.794) fehlten komplett,
// weshalb drei der 15 Modellregeln 0 lieferten. `IfcSpace` ist KEIN IfcElement
// (IfcSpatialStructureElement) und muss separat geholt werden — an ihm hängt
// `NetFloorArea`, die größte Einzelmenge des Projekts.
const ROOT_TYPES = [
  ["IfcElement", WebIFC.IFCELEMENT, true],
  ["IfcSpace", WebIFC.IFCSPACE, false],
];

// Die 14 im Realprojekt vorkommenden IFC-Klassen — nur Dokumentation/Prüfung, die
// Extraktion ist NICHT auf sie beschränkt (sonst wäre der nächste Export wieder
// unvollständig).
export const ERWARTETE_IFC_KLASSEN = [
  "IfcWall", "IfcWallStandardCase", "IfcSlab", "IfcColumn", "IfcBeam", "IfcDoor",
  "IfcWindow", "IfcRoof", "IfcStair", "IfcSpace", "IfcCovering", "IfcRailing",
  "IfcCurtainWall", "IfcBuildingElementProxy",
];

// L8: die Property-Keys, unter denen Archicad/JB den Umbau-Status ablegt — exakt die des
// Orakels (ifc_mengen_jb.py#find_status). Kein Rateverfahren: ein zusätzlicher
// „irgendwas mit status"-Treffer würde Bauteile still in eine Menge schieben.
export const STATUS_PROP_KEYS = ["Renovation Status", "Umbau-Status", "Status"];

// --- Relations-Indizes (einmal je Modell aufbauen — O(Relationen), nicht O(n²)) ----------

// Geschoss je Element: IFCRELCONTAINEDINSPATIALSTRUCTURE → RelatingStructure.Name.
function buildStoreyIndex(api, modelID) {
  const byElement = new Map(); // expressId → Geschossname
  const structNameCache = new Map();
  const nameOf = (structId) => {
    let name = structNameCache.get(structId);
    if (name === undefined) {
      try {
        const struct = api.GetLine(modelID, structId);
        name = str(struct?.Name) ?? str(struct?.LongName) ?? null;
      } catch {
        name = null;
      }
      structNameCache.set(structId, name);
    }
    return name;
  };

  for (const relId of vecToArray(
    api.GetLineIDsWithType(modelID, WebIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE),
  )) {
    try {
      const rel = api.GetLine(modelID, relId);
      const structId = rel?.RelatingStructure?.value;
      if (!structId) continue;
      const name = nameOf(structId);
      for (const h of rel?.RelatedElements || []) {
        if (h?.value != null && !byElement.has(h.value)) byElement.set(h.value, name);
      }
    } catch { /* defekte Relation überspringen */ }
  }
  return { byElement, nameOf };
}

// L7: IFCRELAGGREGATES — Aggregat-Zuordnung (Eltern-Element) UND der Weg, auf dem
// IfcSpace an sein Geschoss kommt (Räume sind AGGREGIERT, nicht "contained"). Ohne das
// bleiben im Referenzprojekt 156 Räume ohne Geschoss und jeder Geschoss-Filter auf Raumflächen ist
// leer — genau die 4.034,50 m² Bodenbelag.
function buildAggregateIndex(api, modelID) {
  const parentByChild = new Map(); // expressId → expressId des Ganzen
  for (const relId of vecToArray(api.GetLineIDsWithType(modelID, WebIFC.IFCRELAGGREGATES))) {
    try {
      const rel = api.GetLine(modelID, relId);
      const whole = rel?.RelatingObject?.value;
      if (!whole) continue;
      for (const h of rel?.RelatedObjects || []) {
        if (h?.value != null && !parentByChild.has(h.value)) parentByChild.set(h.value, whole);
      }
    } catch { /* defekte Relation überspringen */ }
  }

  // IFCRELVOIDSELEMENT: eine Öffnung (IfcOpeningElement) hängt nicht in der
  // Gebäudestruktur, sondern in ihrem Wirtsbauteil. Ohne diese Kante haben im Referenzprojekt
  // 366 Öffnungen kein Geschoss (das Orakel führt sie über das Wirtsbauteil).
  for (const relId of vecToArray(api.GetLineIDsWithType(modelID, WebIFC.IFCRELVOIDSELEMENT))) {
    try {
      const rel = api.GetLine(modelID, relId);
      const host = rel?.RelatingBuildingElement?.value;
      const opening = rel?.RelatedOpeningElement?.value;
      if (host != null && opening != null && !parentByChild.has(opening)) {
        parentByChild.set(opening, host);
      }
    } catch { /* defekte Relation überspringen */ }
  }
  return parentByChild;
}

// Psets + BaseQuantities je Element: IFCRELDEFINESBYPROPERTIES → IfcPropertySet /
// IfcElementQuantity. Definitionen werden gecacht (Type-Psets sind geteilt).
//
// L3: `qty` trägt die 15 BENANNTEN BaseQuantities. Die drei Kübel area/volume/length
// gab es nur, weil niemand die Namen brauchte — `NetFloorArea` matchte keinen der drei
// Regexe und wurde ersatzlos verworfen.
function buildPsetIndex(api, modelID) {
  const psetsByElement = new Map(); // expressId → { psetName: { prop: value } }
  const qtyByElement = new Map(); // expressId → { NetVolume: 1.4, … }
  const defCache = new Map(); // defId → { psets, qty }

  const parseDefinition = (defId) => {
    if (defCache.has(defId)) return defCache.get(defId);
    const out = { psets: null, qty: null };
    try {
      const def = api.GetLine(modelID, defId);
      if (Array.isArray(def?.HasProperties)) {
        // IfcPropertySet → { name: { prop: NominalValue } }
        const props = {};
        for (const h of def.HasProperties) {
          try {
            const p = api.GetLine(modelID, h.value);
            const pName = val(p?.Name);
            if (pName != null) props[String(pName)] = val(p?.NominalValue);
          } catch { /* einzelne Property überspringen */ }
        }
        out.psets = { [String(val(def?.Name) ?? "Pset")]: props };
      } else if (Array.isArray(def?.Quantities)) {
        // IfcElementQuantity → die 15 benannten Basen
        const q = {};
        for (const h of def.Quantities) {
          try {
            const line = api.GetLine(modelID, h.value);
            const qName = str(line?.Name);
            if (!qName || !IFC_QUANTITY_KEYS.includes(qName)) continue;
            const v = qtyNum(
              line?.AreaValue ?? line?.VolumeValue ?? line?.LengthValue ??
              line?.CountValue ?? line?.WeightValue ?? line?.TimeValue,
            );
            if (v != null) q[qName] = v;
          } catch { /* einzelne Quantity überspringen */ }
        }
        if (Object.keys(q).length) out.qty = q;
      }
    } catch { /* defekte Definition überspringen */ }
    defCache.set(defId, out);
    return out;
  };

  // L4: deterministische Reihenfolge = DATEIREIHENFOLGE der Relationen (das ist, was
  // web-ifc `GetLineIDsWithType` liefert und was die Python-Referenz `by_type` liefert — beide
  // NICHT nach expressId sortiert). Bei Namenskollision gewinnt das zuletzt gelesene Set,
  // identisch zum Python-Upstream. Ein Sortieren nach expressId wäre „auch deterministisch",
  // würde aber andere Werte ergeben als das Orakel — gemessen an 123 Bauteilen.
  for (const relId of vecToArray(
    api.GetLineIDsWithType(modelID, WebIFC.IFCRELDEFINESBYPROPERTIES),
  )) {
    try {
      const rel = api.GetLine(modelID, relId);
      const defId = rel?.RelatingPropertyDefinition?.value;
      if (!defId) continue;
      const parsed = parseDefinition(defId);
      if (!parsed.psets && !parsed.qty) continue;
      for (const h of rel?.RelatedObjects || []) {
        const eid = h?.value;
        if (eid == null) continue;
        if (parsed.psets) {
          const cur = psetsByElement.get(eid) || {};
          Object.assign(cur, parsed.psets);
          psetsByElement.set(eid, cur);
        }
        if (parsed.qty) {
          const cur = qtyByElement.get(eid) || {};
          Object.assign(cur, parsed.qty); // „letztes Set gewinnt" (L4)
          qtyByElement.set(eid, cur);
        }
      }
    } catch { /* defekte Relation überspringen */ }
  }
  return { psetsByElement, qtyByElement };
}

// L6: Klassifizierung je Element als ARRAY. IFCRELASSOCIATESCLASSIFICATION →
// IfcClassificationReference (ItemReference in IFC2x3, Identification in IFC4).
// Der alte Code behielt NUR den ersten Treffer (`!byElement.has(...)`) — im Referenzprojekt tragen
// 1.745 Bauteile ≥ 2 Klassifikationen (z. B. „Wand innen" UND „tragend"), und genau die
// zweite ist oft die fachlich entscheidende.
function buildClassificationIndex(api, modelID) {
  const byElement = new Map(); // expressId → string[]
  const refCache = new Map();
  // Dateireihenfolge, NICHT nach expressId sortiert (s. buildPsetIndex): die Reihenfolge
  // der Klassifikationen ist Teil des Vergleichs mit dem Orakel.
  for (const relId of vecToArray(
    api.GetLineIDsWithType(modelID, WebIFC.IFCRELASSOCIATESCLASSIFICATION),
  )) {
    try {
      const rel = api.GetLine(modelID, relId);
      const refId = rel?.RelatingClassification?.value;
      if (!refId) continue;
      let label = refCache.get(refId);
      if (label === undefined) {
        const ref = api.GetLine(modelID, refId);
        const code = str(ref?.Identification) ?? str(ref?.ItemReference) ?? "";
        const name = str(ref?.Name) ?? "";
        label = `${code} ${name}`.trim();
        refCache.set(refId, label);
      }
      if (!label) continue;
      for (const h of rel?.RelatedObjects || []) {
        if (h?.value == null) continue;
        const cur = byElement.get(h.value);
        if (cur) cur.push(label);
        else byElement.set(h.value, [label]);
      }
    } catch { /* defekte Relation überspringen */ }
  }
  return byElement;
}

// L5: Material — `LayerSetName` ist der Wert, den die Pipeline führt (z. B.
// „Bestand_Wände_und_Decken_670"); die Einzel-Layer kommen zusätzlich als
// `material_layers[]` mit Dicke. Der alte Code lieferte nur die Layer-Materialnamen und
// verlor den Aufbau-Namen, auf den die Material-Filter des LV zeigen.
//
// `name` ist zusätzlich der ORAKEL-EXAKTE Wert, damit die Parität nachweisbar bleibt:
//   LayerSetUsage → ForLayerSet.LayerSetName, sonst das Attribut `Name` der
//   Material-Entität, falls vorhanden (auch der Leerstring "" wird übernommen — bei 366
//   Bauteilen des Referenzprojekt, meist IfcCurtainWall, führt der Export einen namenlosen
//   IfcMaterialConstituentSet; „" und `null` zu verschmelzen wäre eine stille Umdeutung).
function resolveMaterial(api, modelID, matId, depth = 0) {
  const leer = { name: null, layerset: null, layers: [], names: [] };
  if (!matId || depth > 4) return leer;
  try {
    const line = api.GetLine(modelID, matId);
    if (!line) return leer;

    // Orakel-exakter Name dieser Entität (vor dem Absteigen ermittelt).
    const eigenerName = "Name" in line ? str(line.Name) : null;

    if (line.ForLayerSet?.value) {
      // IfcMaterialLayerSetUsage → das LayerSet trägt den Namen (Orakel-Sonderfall)
      const innen = resolveMaterial(api, modelID, line.ForLayerSet.value, depth + 1);
      return { ...innen, name: innen.layerset };
    }
    if (Array.isArray(line.MaterialLayers)) {
      // IfcMaterialLayerSet
      const layers = [];
      const names = [];
      for (const h of line.MaterialLayers) {
        try {
          const layer = api.GetLine(modelID, h.value);
          let name = null;
          if (layer?.Material?.value) {
            const mat = api.GetLine(modelID, layer.Material.value);
            name = str(mat?.Name);
          }
          layers.push({ name, dicke: qtyNum(layer?.LayerThickness) });
          if (name) names.push(name);
        } catch { /* Layer überspringen */ }
      }
      // IfcMaterialLayerSet hat KEIN Attribut `Name` — das Orakel liefert hier None,
      // der Aufbau-Name steckt in `LayerSetName` (L5-Zusatzwissen, nicht der Orakelwert).
      return { name: eigenerName, layerset: str(line.LayerSetName), layers, names };
    }
    if (Array.isArray(line.MaterialConstituents)) {
      // IfcMaterialConstituentSet (im Referenzprojekt: 302 IfcCurtainWall, Name = "")
      const layers = [];
      const names = [];
      for (const h of line.MaterialConstituents) {
        try {
          const c = api.GetLine(modelID, h.value);
          const r = resolveMaterial(api, modelID, c?.Material?.value, depth + 1);
          const n = r.names[0] ?? str(c?.Name);
          layers.push({ name: n, dicke: null });
          if (n) names.push(n);
        } catch { /* Constituent überspringen */ }
      }
      return { name: eigenerName, layerset: null, layers, names };
    }
    if (Array.isArray(line.Materials)) {
      // IfcMaterialList — kein Attribut `Name`
      const names = [];
      for (const h of line.Materials) {
        const r = resolveMaterial(api, modelID, h?.value, depth + 1);
        names.push(...r.names);
      }
      return { name: eigenerName, layerset: null, layers: names.map((n) => ({ name: n, dicke: null })), names };
    }
    if (line.Material?.value) {
      // IfcMaterialProfile / IfcMaterialConstituent o. ä.
      const innen = resolveMaterial(api, modelID, line.Material.value, depth + 1);
      return { ...innen, name: eigenerName ?? innen.name };
    }
    // IfcMaterial (oder eine Entität, die nur einen Namen trägt)
    return {
      name: eigenerName,
      layerset: null,
      layers: eigenerName ? [{ name: eigenerName, dicke: null }] : [],
      names: eigenerName ? [eigenerName] : [],
    };
  } catch {
    return leer;
  }
}

function buildMaterialIndex(api, modelID) {
  const byElement = new Map(); // expressId → { layerset, layers, names }
  const cache = new Map();
  for (const relId of vecToArray(
    api.GetLineIDsWithType(modelID, WebIFC.IFCRELASSOCIATESMATERIAL),
  )) {
    try {
      const rel = api.GetLine(modelID, relId);
      const matId = rel?.RelatingMaterial?.value;
      if (!matId) continue;
      let info = cache.get(matId);
      if (!info) {
        info = resolveMaterial(api, modelID, matId);
        cache.set(matId, info);
      }
      for (const h of rel?.RelatedObjects || []) {
        if (h?.value != null && !byElement.has(h.value)) byElement.set(h.value, info);
      }
    } catch { /* defekte Relation überspringen */ }
  }
  return byElement;
}

// Typ-Zuordnung (IFCRELDEFINESBYTYPE) — für geerbte Psets/Material/Quantities.
function buildTypeIndex(api, modelID) {
  const typeByElement = new Map(); // expressId → expressId des IfcTypeObject
  for (const relId of vecToArray(api.GetLineIDsWithType(modelID, WebIFC.IFCRELDEFINESBYTYPE))) {
    try {
      const rel = api.GetLine(modelID, relId);
      const typeId = rel?.RelatingType?.value;
      if (!typeId) continue;
      for (const h of rel?.RelatedObjects || []) {
        if (h?.value != null && !typeByElement.has(h.value)) typeByElement.set(h.value, typeId);
      }
    } catch { /* defekte Relation überspringen */ }
  }
  return typeByElement;
}

// --- Status ------------------------------------------------------------------------------

// L8: Rohwert aus den Psets holen (KEIN Default). Normalisiert wird ausschließlich über
// `normalizeStatus` (@core / Katalog StatusKonvention) — die eine Stelle im Repo.
export function statusRohFromPsets(psets) {
  for (const props of Object.values(psets || {})) {
    for (const key of STATUS_PROP_KEYS) {
      if (!(key in (props || {}))) continue;
      const v = val(props[key]);
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return null;
}

/**
 * Status eines Bauteils aus seinen Psets — `null`, wenn nicht belegt.
 * Bewusst OHNE Default: siehe Kopfkommentar L8.
 * @returns {"bestand"|"neubau"|"abbruch"|null}
 */
export function statusFromPsets(psets, katalogSnapshot = null) {
  const roh = statusRohFromPsets(psets);
  if (roh == null) return null;
  return normalizeStatus(roh, katalogSnapshot);
}

// --- Extraktion auf einem offenen Modell -------------------------------------------------

/**
 * L1–L10 auf einem SCHON geöffneten Modell. Kein WASM-Bootstrap, kein Vite —
 * damit in Node (Gate G5) und im Browser derselbe Code läuft.
 *
 * @param {object} api initialisierte web-ifc IfcAPI
 * @param {number} modelID offenes Modell
 * @param {{onProgress?: (text: string) => void, katalogSnapshot?: object|null}} [opt]
 * @returns {{schema: string, storeys: string[], elements: object[],
 *            warnungen: string[], kennzahlen: object}}
 */
export function extractFromModel(api, modelID, opt = {}) {
  const { onProgress, katalogSnapshot = null } = opt;
  const progress = typeof onProgress === "function" ? onProgress : () => {};

  let schema = "";
  try { schema = api.GetModelSchema(modelID) || ""; } catch { /* optional */ }

  progress("Lese Gebäudestruktur (Geschosse)…");
  const { byElement: storeyByElement, nameOf: structName } = buildStoreyIndex(api, modelID);
  const aggregateParent = buildAggregateIndex(api, modelID);

  const storeyIds = new Set(vecToArray(api.GetLineIDsWithType(modelID, WebIFC.IFCBUILDINGSTOREY)));
  const storeys = [...storeyIds].map((id) => structName(id) || `Geschoss #${id}`);

  progress("Lese Eigenschaften, Klassifizierung und Material…");
  const { psetsByElement, qtyByElement } = buildPsetIndex(api, modelID);
  const classificationByElement = buildClassificationIndex(api, modelID);
  const materialByElement = buildMaterialIndex(api, modelID);
  const typeByElement = buildTypeIndex(api, modelID);

  // L7: Geschoss über die Aggregat-Kette (Raum → Geschoss, Bauteil → Aggregat → Geschoss).
  const geschossOf = (expressId) => {
    const direkt = storeyByElement.get(expressId);
    if (direkt != null) return direkt;
    let cur = aggregateParent.get(expressId);
    for (let i = 0; i < 6 && cur != null; i++) {
      if (storeyIds.has(cur)) return structName(cur);
      const viaContained = storeyByElement.get(cur);
      if (viaContained != null) return viaContained;
      cur = aggregateParent.get(cur);
    }
    return null;
  };

  // Klassenname aus dem Typcode ("IfcBuildingElementProxy") — web-ifc liefert ihn bereits
  // in kanonischer Schreibweise, exakt wie die Python-Referenz `el.is_a()`. Gecacht, weil der
  // Aufruf pro Bauteil kommt.
  const klassenCache = new Map();
  const klassenName = (typeCode) => {
    if (typeCode == null) return "Ifc?";
    let n = klassenCache.get(typeCode);
    if (n === undefined) {
      try { n = api.GetNameFromTypeCode(typeCode) || `Typ#${typeCode}`; }
      catch { n = `Typ#${typeCode}`; }
      klassenCache.set(typeCode, n);
    }
    return n;
  };

  progress("Lese Bauteile…");
  const elements = [];
  const warnungen = [];
  const seen = new Set();
  const klassen = {};
  const statusZaehler = { bestand: 0, neubau: 0, abbruch: 0, unbekannt: 0 };
  let ohneStatus = 0;
  let ohneGeschoss = 0;

  for (const [rootName, typeCode, inherited] of ROOT_TYPES) {
    let ids = [];
    try {
      ids = vecToArray(api.GetLineIDsWithType(modelID, typeCode, inherited));
    } catch {
      warnungen.push(`Typ ${rootName} im Schema nicht abfragbar — übersprungen.`);
      continue;
    }
    for (const expressId of ids) {
      if (seen.has(expressId)) continue;
      seen.add(expressId);
      try {
        const line = api.GetLine(modelID, expressId);
        const ifcType = klassenName(line?.type);

        const psets = psetsByElement.get(expressId) || {};
        // Geerbte Psets/Quantities/Material des IfcTypeObject (die Python-Referenz erbt sie
        // ebenfalls); Element-eigene Werte gewinnen.
        const typeId = typeByElement.get(expressId);
        const typePsets = typeId != null ? psetsByElement.get(typeId) : null;
        const psetsEff = typePsets ? { ...typePsets, ...psets } : psets;

        const qtyOwn = qtyByElement.get(expressId);
        const qtyType = typeId != null ? qtyByElement.get(typeId) : null;
        const qty = { ...(qtyType || {}), ...(qtyOwn || {}) };

        const mat = materialByElement.get(expressId)
          || (typeId != null ? materialByElement.get(typeId) : null)
          || { name: null, layerset: null, layers: [], names: [] };

        const roh = statusRohFromPsets(psetsEff);
        const status = roh == null ? null : normalizeStatus(roh, katalogSnapshot);
        const guid = str(line?.GlobalId);
        const name = str(line?.Name);
        const geschoss = geschossOf(expressId);

        if (status == null) {
          ohneStatus += 1;
          statusZaehler.unbekannt += 1;
          if (warnungen.length < 500) {
            warnungen.push(
              `Bauteil ${guid ?? expressId} (${ifcType}${name ? `, ${name}` : ""}): Umbau-Status nicht belegt${roh ? ` (Rohwert „${roh}" unbekannt)` : ""} — bleibt null.`,
            );
          }
        } else {
          statusZaehler[status] += 1;
        }
        if (geschoss == null) ohneGeschoss += 1;
        if (!guid && warnungen.length < 500) {
          warnungen.push(`Bauteil #${expressId} (${ifcType}) hat keine GlobalId — Bindung an LV-Positionen nicht möglich.`);
        }

        klassen[ifcType] = (klassen[ifcType] || 0) + 1;

        elements.push({
          // L1: GlobalId ist die Identität. expressId bleibt nur als Debug-Hilfe dabei.
          id: guid ?? `expr-${expressId}`,
          guid,
          expressId,
          ifc_klasse: ifcType,
          ifcType, // Altname, Bestandscode liest ihn
          name,
          typ: str(line?.ObjectType),
          // NOVA-Filterkriterium `ifc_predefined_type` (JB-Rückgabe 260821) — additiv.
          predefinedType: str(line?.PredefinedType) ?? "",
          geschoss,
          storey: geschoss ?? "",
          material: mat.name, // orakel-exakt (LayerSetName bzw. Material.Name, auch "")
          material_layerset: mat.layerset,
          material_layers: mat.layers,
          materials: mat.names,
          psets: psetsEff,
          klassifikation: classificationByElement.get(expressId) ?? null,
          classifications: classificationByElement.get(expressId) ?? [],
          status,
          status_roh: roh,
          qty,
          // L9: Alias-Projektion — Viewer und Bestandsfilter rechnen unverändert weiter.
          mengen: mengenAusQty(qty),
        });
      } catch { /* kaputtes Element bricht nicht den Import */ }
    }
  }

  if (elements.length === 0) {
    throw new Error("Keine Bauteile im IFC-Modell gefunden — enthält die Datei ein Gebäudemodell?");
  }

  progress(`${elements.length} Bauteile gelesen.`);

  // L10: Kennzahlen für BimSnapshot — der Import ist erst dann geprüft, wenn jemand die
  // Zahlen sieht (6.038 Bauteile, 355 ohne Status …).
  const kennzahlen = {
    anzahl: elements.length,
    klassen,
    status: statusZaehler,
    ohne_status: ohneStatus,
    ohne_geschoss: ohneGeschoss,
    mit_qty: elements.filter((e) => Object.keys(e.qty).length > 0).length,
    mehrfach_klassifiziert: elements.filter((e) => (e.classifications || []).length >= 2).length,
    warnungen_anzahl: warnungen.length,
    bekannte_abweichung: [
      {
        ort: "qty (L4)",
        grund: "Zwei IfcElementQuantity-Sets mit gleichem BaseQuantity-Namen: das zuletzt gelesene Set gewinnt (Reihenfolge = aufsteigende Relations-expressId).",
        entscheidung: "Identisch zum Python-Upstream übernommen, NICHT korrigiert — sonst gibt es kein Gate mehr, das die Portierung absichert.",
      },
      {
        ort: "status (L8)",
        grund: "Der erste in den Psets gefundene Status-Key gewinnt (Reihenfolge der Pset-Namen).",
        entscheidung: "Identisch zum Upstream; ein unbelegter Status ist null + Warnung, nie ein Default.",
      },
    ],
  };

  return { schema, storeys, elements, warnungen, kennzahlen };
}

// --- Parser (Browser-Pfad) ---------------------------------------------------------------

/**
 * parseIfcFile(arrayBuffer, onProgress?) → `extractFromModel`-Ergebnis.
 * Lädt den WASM-Bootstrap DYNAMISCH (ifcWasm.js, Vite-`?url`) — dadurch bleibt dieses
 * Modul in Node importierbar. Wirft Error mit deutscher Meldung bei nicht lesbaren
 * Dateien; CloseModel im finally.
 */
export async function parseIfcFile(arrayBuffer, onProgress) {
  const progress = typeof onProgress === "function" ? onProgress : () => {};
  progress("Initialisiere web-ifc (WASM)…");
  const { loadIfcApi } = await import("./ifcWasm.js");
  const api = await loadIfcApi();

  progress("Öffne IFC-Modell…");
  let modelID = -1;
  try {
    modelID = api.OpenModel(new Uint8Array(arrayBuffer));
  } catch {
    throw new Error("Die Datei konnte nicht als IFC-Modell geöffnet werden.");
  }
  if (typeof modelID !== "number" || modelID < 0) {
    throw new Error("Die Datei konnte nicht als IFC-Modell geöffnet werden.");
  }

  try {
    return extractFromModel(api, modelID, { onProgress: progress });
  } finally {
    try { if (modelID >= 0) api.CloseModel(modelID); } catch { /* bereits geschlossen */ }
  }
}

// --- Geometrie-Extraktion (Phase 64 — Prüf-Suite: Clash/BCF) -------------------------------

// Mehrere Float32Arrays (je PlacedGeometry eines Elements) zu EINEM Dreiecks-Puffer
// zusammenführen — ein FlatMesh kann bei Multi-Material mehrere PlacedGeometries haben.
function concatFloat32(chunks) {
  if (chunks.length === 1) return chunks[0];
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

// Achsenparallele Bounding-Box über Welt-Dreiecke (9 Floats je Dreieck) —
// erst NACH der Transformation bilden (Vertices sind lokal, Offsets stecken in der Matrix).
function aabbOf(tris) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < tris.length; i += 3) {
    const x = tris[i], y = tris[i + 1], z = tris[i + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

// Mittelpunkt einer AABB als {x,y,z} (z. B. für BCF-Kamera-Ziel).
function centerOf(aabb) {
  return {
    x: (aabb.min[0] + aabb.max[0]) / 2,
    y: (aabb.min[1] + aabb.max[1]) / 2,
    z: (aabb.min[2] + aabb.max[2]) / 2,
  };
}

// extractGeometry(arrayBuffer, onProgress?) → { elemente, uebersprungen }
//
//   elemente: [{ expressId, globalId, ifcType, name, storey,
//                tris: Float32Array (9 Floats je Dreieck, WELT-Koordinaten),
//                aabb: { min:[x,y,z], max:[x,y,z] }, center: {x,y,z} }]
//   uebersprungen: gestreamte Meshes ohne verwertbare Geometrie.
//
// Wichtige Eigenschaften (empirisch gegen web-ifc 0.0.77 verifiziert):
// - Eigenes OpenModel je Aufruf — parseIfcFile schließt sein Modell im finally,
//   dessen modelID ist NICHT wiederverwendbar. Der getApi()-Singleton bleibt offen.
// - Koordinaten sind Y-up: flatTransformation backt die Z-up→Y-up-Konvertierung
//   EIN (ifcZ = worldY). Für Clash egal (konsistent für alle Elemente); für
//   Geschoss-Höhenvergleiche/BCF-Kamera ggf. zurückdrehen.
// - StreamAllMeshes überspringt IfcSpace und IfcOpeningElement — gut für Clash
//   (keine Fehlalarme gegen Räume); Merge mit parseIfcFile-Elementen muss
//   Elemente ohne Geometrie tolerieren.
// - StreamAllMeshes ist synchron/blockierend — Fortschritt gibt es nur zwischen
//   Meshes, kein Yield möglich (UI-Hinweis vorher anzeigen).
// - 71-02 Option { coordinateToOrigin }: für ZWEI gleichzeitig geladene Modelle
//   MUSS sie false sein (D-P71-05) — sonst zentriert web-ifc jedes Modell auf
//   seinen eigenen Schwerpunkt und der Lagevergleich (Koordinationskörper,
//   Containment) misst nur noch Versatz zwischen zwei Schwerpunkten. Die
//   Referenzmodelle sind Vermesserpunkt-exportiert (Koordinaten ±120 m,
//   z ≈ 280 m — Float32-Auflösung dort ~3·10⁻⁵ m = 0,03 mm, messbar genug).
//   Default bleibt true: Ein-Modell-Läufe mit UTM-Millionenkoordinaten
//   (Archicad-Exporte) brauchen die Zentrierung wie bisher.
export async function extractGeometry(arrayBuffer, onProgress, { coordinateToOrigin = true } = {}) {
  const progress = typeof onProgress === "function" ? onProgress : () => {};
  progress("Initialisiere web-ifc (WASM)…");
  // Merge 2026-08-26: derselbe Bootstrap wie in `parseIfcFile`. Der frühere
  // getApi()-Singleton entfiel in Phase 33 (W2), damit dieses Modul in Node
  // importierbar bleibt — das WASM lädt nur der Browser-Pfad, dynamisch.
  const { loadIfcApi } = await import("./ifcWasm.js");
  const api = await loadIfcApi();

  progress("Öffne IFC-Modell (Geometrie)…");
  let modelID = -1;
  try {
    // Denselben ArrayBuffer erneut zu öffnen ist ok — OpenModel kopiert in den WASM-Heap.
    // COORDINATE_TO_ORIGIN (2026-08-26, aus JBs ifcGeometry.js übernommen): georeferenzierte
    // Archicad-Exporte tragen UTM-Millionenkoordinaten. Float32 rastert dort auf 500 mm
    // (nachgerechnet: nextafter(5.5e6) − 5.5e6 = 0,5 m), lokal dagegen auf 0,03 mm. Ohne
    // diese Verschiebung an den Ursprung ist jede Clash-Auswertung wertlos — und zwar
    // unauffällig, weil die Zahlen plausibel bleiben.
    // 71-02: über die Option abschaltbar — Zwei-Modell-Läufe brauchen das
    // gemeinsame Koordinatensystem (D-P71-05, Referenzprojekt: Vermesserpunkt-Export,
    // kleine Koordinaten, Zentrierung wäre dort der Fehler).
    modelID = api.OpenModel(new Uint8Array(arrayBuffer), { COORDINATE_TO_ORIGIN: coordinateToOrigin });
  } catch {
    throw new Error("Die Datei konnte nicht als IFC-Modell geöffnet werden.");
  }
  if (typeof modelID !== "number" || modelID < 0) {
    throw new Error("Die Datei konnte nicht als IFC-Modell geöffnet werden.");
  }

  try {
    // Im Stream-Callback NUR expressId + Welt-Dreiecke sammeln — GetLine im
    // Callback wäre ein Re-Entry in WASM während des Streamings; robuster ist
    // die Zweitlese der Metadaten NACH dem Stream (nur für gestreamte IDs).
    const roh = []; // [{ expressId, tris }]
    let uebersprungen = 0;

    // StreamAllMeshes(modelID, (mesh: FlatMesh, index, total) => void)
    api.StreamAllMeshes(modelID, (mesh, index, total) => {
      if (index % 25 === 0) progress(`Geometrie ${index + 1}/${total}…`);
      const expressId = mesh.expressID;
      // mesh.geometries (Vector) gehört dem C++-Streaming-Scope — NICHT delete()n;
      // FlatMesh.delete ist im Stream-Callback zur Laufzeit undefined — nicht aufrufen.
      const placed = mesh.geometries;
      const chunks = [];
      for (let i = 0; i < placed.size(); i++) {
        // PlacedGeometry { color, geometryExpressID, flatTransformation: number[16] }
        const pg = placed.get(i);
        let geom;
        try {
          geom = api.GetGeometry(modelID, pg.geometryExpressID);
        } catch {
          continue; // Geometrie nicht auflösbar — diese PlacedGeometry überspringen
        }
        // GetVertexArray/GetIndexArray liefern KOPIEN; Size = ELEMENT-Anzahl
        // (Floats bzw. Indizes), NICHT Bytes.
        const verts = api.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize());
        const idx = api.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize());
        // PFLICHT: IfcGeometry sofort freigeben — sonst leakt WASM-Speicher je
        // Geometrie. Die Arrays bleiben gültig (Kopien).
        if (typeof geom.delete === "function") geom.delete();

        // Vertices sind LOKAL — flatTransformation (column-major 4x4, world = M·v)
        // MUSS angewendet werden; web-ifc verschiebt zudem Offsets in die Matrix.
        // Niemals Vertices einer Geometrie mit der Matrix einer anderen mischen.
        const m = pg.flatTransformation;
        const out = new Float32Array(idx.length * 3);
        for (let k = 0; k < idx.length; k++) {
          // Vertex-Stride 6: [px,py,pz,nx,ny,nz] — Normalen (v+3..v+5) für Clash ignorieren.
          const v = idx[k] * 6;
          const x = verts[v], y = verts[v + 1], z = verts[v + 2];
          // Matrix in double (JS-Number) anwenden, erst am Ende nach Float32 —
          // Präzision bei georeferenzierten Modellen (UTM/Gauß-Krüger).
          out[k * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
          out[k * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
          out[k * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
        }
        if (out.length) chunks.push(out);
      }
      if (!chunks.length) {
        uebersprungen++; // Mesh ohne verwertbare Geometrie
        return;
      }
      roh.push({ expressId, tris: concatFloat32(chunks) });
    });

    // Zweitlese NUR für gestreamte expressIDs: GlobalId/ifcType/name/storey.
    progress("Löse Bauteil-Metadaten auf…");
    // buildStoreyIndex liefert { byElement, nameOf } — NICHT die Map selbst.
    // Ohne die Destrukturierung warf die Zweitlese unten
    // "storeyByElement.get is not a function", und zwar für JEDES Modell: die
    // Prüf-Suite konnte gar kein IFC laden. Gefunden am 04.09.2026 beim Bauen des
    // Musterprojekts (Phase 65-03) — kein Unit-Test ruft extractGeometry auf, weil
    // die Funktion das WASM über einen Vite-`?url`-Import zieht und unter Node
    // nicht läuft. Der Headless-Lauf tmp-verify-beispiel.mjs deckt sie jetzt ab.
    const { byElement: storeyByElement } = buildStoreyIndex(api, modelID);
    const elemente = [];
    for (const { expressId, tris } of roh) {
      let globalId = "";
      let name = "";
      let ifcType = "";
      try {
        const line = api.GetLine(modelID, expressId);
        globalId = String(val(line?.GlobalId) ?? "");
        name = String(val(line?.Name) ?? val(line?.ObjectType) ?? "");
      } catch { /* Element ohne Zeile: Geometrie trotzdem behalten */ }
      try {
        // GetNameFromTypeCode liefert PascalCase ("IfcWall", "IfcFlowSegment", …) —
        // exakt kompatibel zu den PRODUCT_TYPES-Strings; deckt auch TGA-Typen ab,
        // die in PRODUCT_TYPES fehlen, aber gestreamt werden.
        ifcType = api.GetNameFromTypeCode(api.GetLineType(modelID, expressId)) || "";
      } catch { /* Typ nicht auflösbar — leer lassen */ }
      const aabb = aabbOf(tris);
      elemente.push({
        expressId,
        globalId,
        ifcType,
        name: name || `${ifcType || "Element"} #${expressId}`,
        storey: storeyByElement.get(expressId) || "",
        tris,
        aabb,
        center: centerOf(aabb),
      });
    }

    progress(`${elemente.length} Bauteil-Geometrien extrahiert.`);
    return { elemente, uebersprungen };
  } finally {
    try { if (modelID >= 0) api.CloseModel(modelID); } catch { /* bereits geschlossen */ }
  }
}

// --- Mapping auf die Phase-25-Form ---------------------------------------------------------

// IsExternal (Pset_WallCommon o. ä.) entscheidet wall-hull vs. wall-inner.
function wallKind(psets) {
  for (const props of Object.values(psets || {})) {
    for (const [key, value] of Object.entries(props || {})) {
      if (/^IsExternal$/i.test(key)) return isTrue(value) ? "wall-hull" : "wall-inner";
    }
  }
  return "wall-inner"; // [ASSUMED] ohne IsExternal-Angabe: Innenwand
}

function kindOf(el) {
  const t = el.ifc_klasse || el.ifcType || "";
  switch (t) {
    case "IfcWall":
    case "IfcWallStandardCase":
      return wallKind(el.psets);
    case "IfcCurtainWall": return "wall-hull";
    case "IfcSlab": return "slab";
    case "IfcRoof": return "roof";
    case "IfcColumn": return "column";
    case "IfcWindow": return "window";
    case "IfcDoor": return "door";
    case "IfcSpace": return "zone";
    default:
      return t.replace(/^Ifc/, "").toLowerCase(); // z. B. "beam", "stair", "railing"
  }
}

// KG: führende 3 Ziffern einer Klassifizierung, wenn DIN-276-artig (3xx).
function kgOf(el, kind) {
  const codes = Array.isArray(el?.classifications) && el.classifications.length
    ? el.classifications
    : el?.classification?.code
      ? [String(el.classification.code)]
      : [];
  for (const c of codes) {
    const m = String(c).match(/^\s*(3\d\d)/);
    if (m) return m[1];
  }
  return kgFromKind(kind);
}

// Material-Layer-Namen → SCHICHTEN-Vokabular (contains-Match), sonst Originalname.
function schichtOf(materials) {
  const out = [];
  for (const name of materials || []) {
    const lower = String(name).toLowerCase();
    const hit = SCHICHTEN.find((s) => lower.includes(s.toLowerCase()));
    const mapped = hit || String(name);
    if (mapped && !out.includes(mapped)) out.push(mapped);
  }
  return out;
}

/**
 * mapToClassifiedElements(parsed) → die classifiedElements-Form aus Phase 25.
 * `status` bleibt `null`, wenn das Modell ihn nicht belegt (L8) — der Viewer zeigt
 * „unbekannt" und filtert das Bauteil NICHT weg.
 */
export function mapToClassifiedElements(parsed) {
  const list = Array.isArray(parsed) ? parsed : parsed?.elements || [];
  return list.map((el) => {
    const kind = kindOf(el);
    return {
      id: el.id ?? el.guid ?? `ifc-${el.expressId}`,
      guid: el.guid ?? null,
      kind,
      ifc_klasse: el.ifc_klasse || el.ifcType || "",
      kg: kgOf(el, kind),
      gewerk: gewerkFromKind(kind),
      schicht: schichtOf(el.materials || el.material_layers?.map((l) => l.name) || []),
      material: el.material ?? null,
      geschoss: el.geschoss ?? null,
      status: el.status ?? null,
      klassifikation: el.klassifikation ?? null,
      qty: el.qty || {},
      mengen: {
        area: num(el?.mengen?.area),
        volume: num(el?.mengen?.volume),
        length: num(el?.mengen?.length),
        count: 1,
      },
    };
  });
}
