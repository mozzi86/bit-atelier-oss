// Shared building-element geometry so the 3D viewer and the AVA quantity-takeoff
// ("Mengenermittlung") agree on what each model element is and how big it is.
// The abstract IFC model renders one slab per storey; we treat every storey as a
// BIM element with deterministic geometric quantities (area / volume / count).

export function modelDims(building) {
  const floors = Math.max(1, Math.round(building?.floors || 5));
  const footprint = Math.sqrt(Math.max(building?.area_net || 600, 200)) / 3;
  const w = footprint;
  const d = footprint * 0.8;
  const floorH = 3;
  return { floors, w, d, floorH };
}

// One element per storey, matching the slabs the viewer renders.
export function floorElements(building) {
  const { floors, w, d, floorH } = modelDims(building);
  const area = +(w * d).toFixed(1); // gross floor area per storey (m²)
  const volume = +(w * d * floorH * 0.9).toFixed(1); // slab/storey volume (m³)
  return Array.from({ length: floors }, (_, i) => ({
    id: `floor-${i}`,
    name: `Geschoss ${i + 1}`,
    level: i,
    area,
    volume,
    height: floorH,
    count: 1,
  }));
}

// Aggregate a chosen quantity basis over a set of element ids.
export function quantityFromElements(building, elementIds = [], basis = "area") {
  const els = floorElements(building).filter((e) => elementIds.includes(e.id));
  if (els.length === 0) return 0;
  if (basis === "area") return +els.reduce((s, e) => s + e.area, 0).toFixed(2);
  if (basis === "volume") return +els.reduce((s, e) => s + e.volume, 0).toFixed(2);
  if (basis === "count") return els.length;
  if (basis === "length") return +els.reduce((s, e) => s + (e.length || 0), 0).toFixed(2);
  return 0;
}

// --- Mengenbasen: 15 benannte IFC-BaseQuantities + 4 Altwerte als Alias ------------------
//
// Phase 33 / L3: „area/volume/length" waren drei Kübel — `NetSideArea` (Wandfläche) und
// `NetFloorArea` (Raumfläche) fielen beide auf `area`, und `NetFloorArea` wurde beim Import
// sogar ersatzlos verworfen. Genau das ist die größte Einzelmenge des Realprojekts
// (Bodenbelag 4.034,50 m² über 101 IfcSpace). Net vs. Gross ist keine Kosmetik:
// 258 Bauteile haben NetSideArea ≠ GrossSideArea, 613 NetVolume ≠ GrossVolume.
//
// Die vier Altwerte bleiben als `alias: true` erhalten (Alias-Projektion `mengen{}` über
// `qty{}`, L9) — bestehende Filter/Positionen mit `mengenbasis: "area"` brechen NICHT.
// `dimension` erlaubt Plausibilitätsprüfungen (Fläche-Regel auf Längen-Basis = Fehler).

/** Die 15 benannten IFC-BaseQuantities in der Reihenfolge des Orakels. */
export const IFC_QUANTITY_KEYS = [
  "NetVolume", "GrossVolume", "NetSideArea", "GrossSideArea", "NetArea",
  "GrossArea", "NetFootprintArea", "GrossFootprintArea", "Length", "Width",
  "Height", "Perimeter", "Depth", "NetFloorArea", "GrossFloorArea",
];

export const QUANTITY_BASES = [
  // 15 IFC-BaseQuantities
  { value: "NetVolume", label: "Netto-Volumen (m³)", unit: "m³", dimension: "volume" },
  { value: "GrossVolume", label: "Brutto-Volumen (m³)", unit: "m³", dimension: "volume" },
  { value: "NetSideArea", label: "Netto-Seitenfläche (m²)", unit: "m²", dimension: "area" },
  { value: "GrossSideArea", label: "Brutto-Seitenfläche (m²)", unit: "m²", dimension: "area" },
  { value: "NetArea", label: "Netto-Fläche (m²)", unit: "m²", dimension: "area" },
  { value: "GrossArea", label: "Brutto-Fläche (m²)", unit: "m²", dimension: "area" },
  { value: "NetFootprintArea", label: "Netto-Grundfläche (m²)", unit: "m²", dimension: "area" },
  { value: "GrossFootprintArea", label: "Brutto-Grundfläche (m²)", unit: "m²", dimension: "area" },
  { value: "Length", label: "Länge (m)", unit: "m", dimension: "length" },
  { value: "Width", label: "Breite (m)", unit: "m", dimension: "length" },
  { value: "Height", label: "Höhe (m)", unit: "m", dimension: "length" },
  { value: "Perimeter", label: "Umfang (m)", unit: "m", dimension: "length" },
  { value: "Depth", label: "Tiefe (m)", unit: "m", dimension: "length" },
  { value: "NetFloorArea", label: "Netto-Raumfläche (m²)", unit: "m²", dimension: "area" },
  { value: "GrossFloorArea", label: "Brutto-Raumfläche (m²)", unit: "m²", dimension: "area" },
  // 4 Altwerte — Alias-Projektion, bewusst erhalten (Rückwärtskompatibilität)
  { value: "area", label: "Fläche (m²)", unit: "m²", dimension: "area", alias: true },
  { value: "volume", label: "Volumen (m³)", unit: "m³", dimension: "volume", alias: true },
  { value: "count", label: "Stück (Stk)", unit: "Stk", dimension: "count", alias: true },
  { value: "length", label: "Länge (lfm)", unit: "m", dimension: "length", alias: true },
];

/** Zuordnung Altwert → bevorzugte IFC-Basen (erste belegte gewinnt) für die Projektion. */
export const ALIAS_QUELLEN = {
  area: ["NetSideArea", "GrossSideArea", "NetArea", "GrossArea", "NetFootprintArea", "GrossFootprintArea", "NetFloorArea", "GrossFloorArea"],
  volume: ["NetVolume", "GrossVolume"],
  length: ["Length", "Perimeter", "Height", "Width", "Depth"],
};

/**
 * Alias-Projektion `qty{}` → `mengen{area,volume,length,count}` (L9).
 * Bestandscode (Viewer, QuantityTakeoff, alte Filter) rechnet unverändert weiter.
 */
export function mengenAusQty(qty) {
  const q = qty || {};
  const erste = (keys) => {
    for (const k of keys) {
      const n = Number(q[k]);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return 0;
  };
  return {
    area: erste(ALIAS_QUELLEN.area),
    volume: erste(ALIAS_QUELLEN.volume),
    length: erste(ALIAS_QUELLEN.length),
    count: 1,
  };
}

/** Einheit einer Mengenbasis ("NetSideArea" → "m²"), "" wenn unbekannt. */
export function basisEinheit(basis) {
  return QUANTITY_BASES.find((b) => b.value === basis)?.unit || "";
}
