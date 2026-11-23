// 115-05a (A-4, K6 of the 115-05 review): the design record of a project (BuildingComplex, written by ComplexDesigner) is
// saved as a PATCH of the changed fields on its strict base (`?stand`, 106-09) instead of the whole record. A refused write
// (409) is merged per field three ways - base / mine / the stored one - with two special rules:
//   - the site and location fields hang together geometrically (handleLocationUpdate sets them in one go: a new parcel moves
//     or drops buildings, areas and bars): they are compared as ONE unit, so a new location is never mixed with old buildings
//   - derived values (site area, cost estimate) never make a conflict; when both sides changed them, the stored value counts
//     and the deriving component computes it again when it needs to
// In @core so the later draft core (115-05c) can call it; the designer only wires it to its state.
//
// All three states go in NORMALISED by the caller ({...komplexStart(), ...record} without administration fields), so start
// values never count as a change.
//
// In:  basis / mein / fremd field objects, the fields held back by an open card. Out: komplexPatch(), komplexAbgleichen().

import { feldDreiWege, gleichWert } from "./dreiWege.js";

/** Administration fields of a record: never part of a patch (the server sets them). @type {ReadonlyArray<string>} */
export const KOMPLEX_VERWALTUNG = Object.freeze(["id", "created_date", "updated_date", "project_id"]);

/**
 * Site and location fields of the design record, compared as ONE unit (K6c): handleLocationUpdate (ComplexDesigner.jsx) sets them
 * together - a parcel moved on one device and buildings or the north angle changed on another must never be mixed.
 * @type {ReadonlyArray<string>}
 */
export const KOMPLEX_LAGE_GRUPPE = Object.freeze([
  "location", "map_context", "site_parcel", "site_area", "topography", "context_buildings", "context_buildings_source", "grundstueck",
  "designated_areas", "riegel", "buildings", "nordwinkel",
]);

/**
 * Derived fields: echoes of other values (site area from the parcel, SiteDesigner; cost estimate, CostCalculator). They never make a
 * conflict; when both sides changed them, the stored value counts [ASSUMED: the deriving component recomputes on its next render].
 * @type {ReadonlyArray<string>}
 */
export const KOMPLEX_ABGELEITET = Object.freeze(["site_area", "cost_estimate"]);

/** Key of the site/location unit in a conflict (einheit) and in KOMPLEX_FELDNAMEN. */
export const LAGE = "lage";

/**
 * German labels of the conflict cards (keys = field or unit; translated by the card). A field without a label shows its name.
 * @type {Readonly<Record<string, string>>}
 */
export const KOMPLEX_FELDNAMEN = Object.freeze({
  [LAGE]: "Grundstück und Lage", name: "Name", moeblierung: "Möblierung", interior_designs: "Innenausbau", moebel_eigene: "Eigene Möbel",
  unit_types: "Wohnungstypen", parking: "Stellplätze", energy_systems: "Energiesysteme", hochwasser: "Hochwasser",
  kennzahlen_hand: "Kennzahlen von Hand", cost_estimate: "Kostenschätzung",
});

/** The group without the derived site area: what decides whether the unit was changed. */
const GRUPPE_KERN = Object.freeze(KOMPLEX_LAGE_GRUPPE.filter((k) => !KOMPLEX_ABGELEITET.includes(k)));

/** @param {Record<string, any>|null|undefined} o @param {ReadonlyArray<string>} felder @returns {Record<string, any>} */
const auswahl = (o, felder) => Object.fromEntries(felder.map((k) => [k, o?.[k]]));

/** @param {Iterable<string>|null|undefined} g @returns {Set<string>} */
const alsMenge = (g) => new Set(g ? [...g] : []);

/**
 * The fields of `jetzt` that differ from the base (stable JSON comparison, undefined = null), without administration fields and
 * without fields held back by an open conflict card (K6a).
 * @param {Record<string, any>|null|undefined} basisFelder the stored state (normalised fields)
 * @param {Record<string, any>} jetzt the state of the page now (same normal form)
 * @param {Iterable<string>|null} [gesperrt] held-back field names
 * @returns {Record<string, any>} patch (may be empty)
 */
export function komplexPatch(basisFelder, jetzt, gesperrt = null) {
  const sperre = alsMenge(gesperrt);
  /** @type {Record<string, any>} */
  const patch = {};
  for (const [k, v] of Object.entries(jetzt || {})) {
    if (KOMPLEX_VERWALTUNG.includes(k) || sperre.has(k)) continue;
    if (!gleichWert(v, basisFelder?.[k])) patch[k] = v;
  }
  return patch;
}

/**
 * @typedef {{einheit: string, felder: string[], basis: any, mein: any, fremd: any}} KomplexKonflikt
 *   einheit = "lage" (the site/location unit, values are objects of its fields) or the field name (values are the field's values)
 */

/**
 * Three-way merge of a design record after a refused write (409) or a migration answer.
 * @param {{basis: Record<string, any>, mein: Record<string, any>, fremd: Record<string, any>, gesperrt?: Iterable<string>|null}} a
 *   basis = the stored state this page built on; mein = the page's state now; fremd = the stored state now (all normalised);
 *   gesperrt = fields held back by an open card (never written; their conflict is reported again with the newer versions)
 * @returns {{setzen: Record<string, any>, schreiben: Record<string, any>, konflikte: KomplexKonflikt[], neueBasis: Record<string, any>}}
 *   setzen = values the page takes over now (only the other side changed them, K6b); schreiben = own changes to write on the new
 *   base; konflikte = one per field, ONE for the whole site/location unit; neueBasis = the stored state (fremd)
 */
export function komplexAbgleichen({ basis, mein, fremd, gesperrt = null }) {
  const sperre = alsMenge(gesperrt);
  /** @type {Record<string, any>} */ const setzen = {};
  /** @type {Record<string, any>} */ const schreiben = {};
  /** @type {KomplexKonflikt[]} */ const konflikte = [];
  /** takes the foreign value of field k where it differs from mine @param {string} k */
  const nehmen = (k) => { if (!gleichWert(mein?.[k], fremd?.[k])) setzen[k] = fremd?.[k]; };
  /** keeps my value of field k to be written where it differs from the stored one @param {string} k */
  const behalten = (k) => { if (!sperre.has(k) && !gleichWert(mein?.[k], fremd?.[k])) schreiben[k] = mein?.[k]; };
  /** a derived field: mine where only I changed it, else the stored value (never a conflict) @param {string} k */
  const abgeleitet = (k) => { if (gleichWert(fremd?.[k], basis?.[k])) behalten(k); else nehmen(k); };

  // the site/location unit (decided by its core fields, the derived site area rides along)
  const b = auswahl(basis, GRUPPE_KERN), m = auswahl(mein, GRUPPE_KERN), f = auswahl(fremd, GRUPPE_KERN);
  if (gleichWert(m, f)) {
    abgeleitet("site_area");
  } else if (gleichWert(m, b)) {
    for (const k of KOMPLEX_LAGE_GRUPPE) nehmen(k);
  } else if (gleichWert(f, b)) {
    for (const k of GRUPPE_KERN) behalten(k);
    abgeleitet("site_area");
  } else {
    konflikte.push({ einheit: LAGE, felder: [...KOMPLEX_LAGE_GRUPPE], basis: auswahl(basis, KOMPLEX_LAGE_GRUPPE),
      mein: auswahl(mein, KOMPLEX_LAGE_GRUPPE), fremd: auswahl(fremd, KOMPLEX_LAGE_GRUPPE) });
  }

  const alle = new Set([...Object.keys(basis || {}), ...Object.keys(mein || {}), ...Object.keys(fremd || {})]);
  for (const k of alle) {
    if (KOMPLEX_VERWALTUNG.includes(k) || KOMPLEX_LAGE_GRUPPE.includes(k)) continue;
    if (KOMPLEX_ABGELEITET.includes(k)) { abgeleitet(k); continue; }
    const r = feldDreiWege(basis?.[k], mein?.[k], fremd?.[k]);
    if (r.art === "gleich") continue;
    if (r.art === "fremd") nehmen(k);
    else if (r.art === "mein") behalten(k);
    else if (r.art === "zusammen") {
      // both changed different elements of a keyed list: the merged list on screen and in the write
      if (!gleichWert(r.wert, mein?.[k])) setzen[k] = r.wert;
      if (!sperre.has(k) && !gleichWert(r.wert, fremd?.[k])) schreiben[k] = r.wert;
    } else {
      konflikte.push({ einheit: k, felder: [k], basis: basis?.[k], mein: mein?.[k], fremd: fremd?.[k] });
    }
  }
  return { setzen, schreiben, konflikte, neueBasis: fremd };
}

/**
 * 115-05b (E-3): the design record of a project when the store holds more than one (two tabs created one each before the server
 * refused a second create). The newest one (largest updated_date) is the one the designer works on; none is deleted - the caller
 * reports the count so the person can clean up.
 * @param {any[]|null|undefined} rows the BuildingComplex records of one project
 * @returns {{datensatz: any|null, anzahl: number}} datensatz = the newest record or null; anzahl = how many there are
 */
export function komplexDatensatzWaehlen(rows) {
  const liste = Array.isArray(rows) ? rows.filter(Boolean) : [];
  let datensatz = null;
  for (const r of liste) if (!datensatz || String(r.updated_date ?? "") > String(datensatz.updated_date ?? "")) datensatz = r;
  return { datensatz, anzahl: liste.length };
}

/**
 * 115-05b part 2: another stored state of the design record goes into the page - a 409 of its write, the answer of the furniture
 * migration (E-4) or the focus check (standWaechter.js). Three ways against the base the page knows (komplexAbgleichen); the base
 * moves to the stored state TOGETHER with this merge, so nothing of the other writer's change is lost and nothing both changed is
 * dropped (it becomes a conflict, the caller shows the card and locks its fields).
 * @param {{basis: {id: string|null, updated_date: string|null, felder: Record<string, any>}|null|undefined, mein: Record<string, any>,
 *   gespeichert: any, gesperrt?: Iterable<string>|null, normal: (rec: any) => Record<string, any>}} a
 *   basis = the stored base of the page (undefined: none, compared against the start values); mein = the page's state now
 *   (normalised); gespeichert = the stored record (with id / updated_date); gesperrt = fields of open cards; normal = the page's
 *   normal form (start values + record without administration fields)
 * @returns {{setzen: Record<string, any>, schreiben: Record<string, any>, konflikte: KomplexKonflikt[],
 *   basis: {id: string|null, updated_date: string|null, felder: Record<string, any>}}} the merge and the new base
 */
export function komplexFremdUebernehmen({ basis, mein, gespeichert, gesperrt = null, normal }) {
  const fremd = normal(gespeichert);
  const r = komplexAbgleichen({ basis: basis?.felder ?? normal({}), mein, fremd, gesperrt });
  return { setzen: r.setzen, schreiben: r.schreiben, konflikte: r.konflikte,
    basis: { id: gespeichert?.id ?? basis?.id ?? null, updated_date: gespeichert?.updated_date ?? null, felder: fremd } };
}
