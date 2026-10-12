// Attribute check before the quantity takeover model → LV position (72-04, Nachweis-Härtung).
//
// The takeover in the IFC viewer sums a base quantity over the marked elements and writes it
// into one LV position. A quantity is only as good as the elements behind it: an element
// without a DIN 276 classification, without fire rating or without the load-bearing flag
// lands in the position as if it were the right quality. This module names what is missing
// or mixed BEFORE the user clicks "übernehmen".
//
// Status vocabulary as in the concept checks (@designer/lib/pruefStatus.js, not imported —
// package boundary): "offen" = attribute missing in the model, "warn" = attributes present
// but inconsistent with each other or with the position. Never "fail" and never a block:
// the IFC model is a deliverable of the authoring planner (D-HR-20), the takeover writes a
// quantity, not a Nachweis, and a blocked takeover only pushes the user to type the quantity
// by hand — without any trace of the gap. The findings are shown and stored with the position.
//
// In:  parsed IFC elements (ifcImport.js shape: ifcType, psets, classifications/classification)
//      and the target LV position (din276, din276_fassung).
// Out: { geprueft, befunde: [{ key, status, anzahl, werte? }] } — texts live in the UI (t()).
// Pure, isomorphic, no imports.

/** IFC classes whose fire resistance is a property of the element (MBO §§ 26–31). */
const FEUER_KLASSEN = /^Ifc(Wall|WallStandardCase|Slab|Column|Beam|Door|Roof|Stair)$/i;
/** IFC classes where load-bearing decides the cost group (DIN 276: 331/332 vs. 341/342). */
const TRAGEND_KLASSEN = /^Ifc(Wall|WallStandardCase|Slab|Column|Beam)$/i;

/**
 * Value of a property over all property sets of an element, case-insensitive.
 * @param {any} el parsed IFC element
 * @param {string} name property name, e.g. "FireRating" (Pset_WallCommon …)
 * @returns {any} first non-empty value, or null
 */
function eigenschaft(el, name) {
  const ziel = name.toLowerCase();
  for (const props of Object.values(el?.psets || {})) {
    for (const [k, v] of Object.entries(props || {})) {
      if (k.toLowerCase() === ziel && v != null && String(v).trim() !== "") return v;
    }
  }
  return null;
}

/**
 * IFC boolean in its common spellings (true, ".T.", "TRUE", "wahr", "ja").
 * @param {any} v
 * @returns {boolean|null} null when not readable
 */
function ifcBool(v) {
  if (v === true || v === false) return v;
  const s = String(v ?? "").trim().toLowerCase().replace(/\./g, "");
  if (["t", "true", "wahr", "ja", "yes", "1"].includes(s)) return true;
  if (["f", "false", "falsch", "nein", "no", "0"].includes(s)) return false;
  return null;
}

/**
 * DIN 276 cost group (3xx) explicitly classified in the model — not derived from the type.
 * @param {any} el
 * @returns {string|null} three-digit code or null
 */
export function kgAusModell(el) {
  const codes = Array.isArray(el?.classifications) && el.classifications.length
    ? el.classifications
    : el?.classification?.code ? [el.classification.code] : [];
  for (const c of codes) {
    const m = String(typeof c === "object" && c ? (c.code ?? c.name ?? "") : c).match(/^\s*([3-7]\d\d)/);
    if (m) return m[1];
  }
  return null;
}

/**
 * Does an element cost group fit the position's cost group? "340" covers "341…349",
 * "300" covers every 3xx (DIN 276-2018 hierarchy: trailing zeros = higher level).
 * @param {string} posKg cost group of the LV position
 * @param {string} elKg cost group of the element
 * @returns {boolean}
 */
export function kgPasst(posKg, elKg) {
  const prefix = String(posKg).trim().replace(/0+$/, "");
  return prefix === "" || String(elKg).startsWith(prefix);
}

/**
 * Check the marked elements before their quantity is written into an LV position.
 * @param {Array<any>} elemente parsed IFC elements of the takeover
 * @param {{ din276?: string, din276_fassung?: string } | null} [position] target LV position
 * @returns {{ geprueft: number, befunde: Array<{ key: string, status: "offen"|"warn", anzahl: number, werte?: string[] }> }}
 */
export function pruefeAttributeVorUebernahme(elemente = [], position = null) {
  const els = (elemente || []).filter(Boolean);
  /** @type {Array<{ key: string, status: "offen"|"warn", anzahl: number, werte?: string[] }>} */
  const befunde = [];

  // DIN 276 — the position's cost group is only checked against 2018 codes (2008 codes
  // partly carry the same number with another meaning).
  const ohneKg = els.filter((el) => !kgAusModell(el));
  if (ohneKg.length) befunde.push({ key: "kg_abgeleitet", status: "offen", anzahl: ohneKg.length });
  const posKg = position?.din276 && position?.din276_fassung !== "2008" ? String(position.din276) : "";
  if (posKg) {
    const fremd = els.filter((el) => { const k = kgAusModell(el); return k && !kgPasst(posKg, k); });
    if (fremd.length) {
      befunde.push({ key: "kg_abweichend", status: "warn", anzahl: fremd.length, werte: [...new Set(fremd.map(kgAusModell))].sort() });
    }
  }

  // Fire resistance (Pset_*Common.FireRating) — required by the building class, so a
  // quantity mixing qualities (REI 30 + REI 90) in one position is a pricing error.
  const feuerEls = els.filter((el) => FEUER_KLASSEN.test(String(el?.ifcType || el?.ifc_klasse || "")));
  const feuerOhne = feuerEls.filter((el) => eigenschaft(el, "FireRating") == null);
  if (feuerOhne.length) befunde.push({ key: "feuer_fehlt", status: "offen", anzahl: feuerOhne.length });
  const feuerWerte = [...new Set(feuerEls.map((el) => eigenschaft(el, "FireRating")).filter((v) => v != null).map((v) => String(v).trim()))].sort();
  if (feuerWerte.length > 1) befunde.push({ key: "feuer_gemischt", status: "warn", anzahl: feuerWerte.length, werte: feuerWerte });

  // Load-bearing (Pset_*Common.LoadBearing) — DIN 276 separates 341 tragend / 342 nichttragend.
  const tragEls = els.filter((el) => TRAGEND_KLASSEN.test(String(el?.ifcType || el?.ifc_klasse || "")));
  const tragWerte = tragEls.map((el) => ifcBool(eigenschaft(el, "LoadBearing")));
  const tragOhne = tragWerte.filter((v) => v == null).length;
  if (tragOhne) befunde.push({ key: "tragend_fehlt", status: "offen", anzahl: tragOhne });
  if (tragWerte.includes(true) && tragWerte.includes(false)) {
    befunde.push({ key: "tragend_gemischt", status: "warn", anzahl: tragWerte.filter((v) => v != null).length });
  }

  return { geprueft: els.length, befunde };
}
