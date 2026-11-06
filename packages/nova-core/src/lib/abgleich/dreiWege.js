// 106-09: three-way comparison of one field of a record - the base both devices started from, MY version (this
// device), the FOREIGN version (written by another device). It decides what a device may take over silently and what
// is a conflict a person has to decide (Task 3: two changes of the same element are reported, never overwritten).
//
// Rules per field:
//   mine == foreign            → nothing to decide (foreign)
//   mine == base               → only the other device changed it → foreign
//   foreign == base            → only this device changed it → mine
//   both changed, element list → per element (key `_idx`, else `guid`, else `id`): the same rules again; an element
//                                both changed differently (or one changed and the other deleted) is a CONFLICT, and
//                                MY element stays in the result until the person decides
//   both changed, anything else→ one conflict for the whole field, mine stays
//
// Pure: no I/O, no React. Values are compared by their stable JSON (object keys sorted, undefined left out); the time
// stamp `updatedAt` of a layer field (fachlayerSchema.stempelFuerSave) is ignored, it changes on every save.
//
// In:  basis, mein, fremd of one field. Out: {wert, konflikte, art}; gleichWert(), elementSchluessel().

/**
 * Deterministic JSON of a value (object keys sorted, undefined dropped, `updatedAt` of an object dropped).
 * @param {any} v @returns {string}
 */
export function stabilerText(v) {
  const norm = (/** @type {any} */ x) => {
    if (Array.isArray(x)) return x.map(norm);
    if (x && typeof x === "object") {
      return Object.fromEntries(Object.keys(x).sort().filter((k) => x[k] !== undefined && k !== "updatedAt").map((k) => [k, norm(x[k])]));
    }
    return x === undefined ? null : x;
  };
  return JSON.stringify(norm(v)) ?? "null";
}

/**
 * Whether two values are the same for the comparison (stable JSON; undefined and null are the same "nothing").
 * @param {any} a @param {any} b @returns {boolean}
 */
export function gleichWert(a, b) {
  return stabilerText(a) === stabilerText(b);
}

/**
 * The key of an element of a list: `_idx` (drawn elements of the BIM studio), else `guid`, else `id`; null without one.
 * @param {any} el @returns {string|null}
 */
export function elementSchluessel(el) {
  if (!el || typeof el !== "object") return null;
  if (el._idx != null) return `_idx:${el._idx}`;
  if (el.guid != null && el.guid !== "") return `guid:${el.guid}`;
  if (el.id != null && el.id !== "") return `id:${el.id}`;
  return null;
}

/** @param {any} v @returns {boolean} a list whose every element has a key (and no key twice) */
const schluesselListe = (v) => {
  if (!Array.isArray(v)) return false;
  const gesehen = new Set();
  for (const el of v) {
    const k = elementSchluessel(el);
    if (k == null || gesehen.has(k)) return false;
    gesehen.add(k);
  }
  return true;
};

/**
 * @typedef {{schluessel: string|null, basis: any, mein: any, fremd: any}} Konflikt
 *   schluessel = element key (null = the whole field); a missing element is `undefined` (deleted / not yet there).
 */

/**
 * Three-way comparison of one field.
 * @param {any} basis value both sides started from (the last stored version this device knew)
 * @param {any} mein this device's value
 * @param {any} fremd the value another device stored
 * @returns {{wert: any, konflikte: Konflikt[], art: "gleich"|"fremd"|"mein"|"zusammen"|"konflikt"}}
 *   wert = what this device should hold now (mine for every conflicting element); art = how it came about
 */
export function feldDreiWege(basis, mein, fremd) {
  if (gleichWert(mein, fremd)) return { wert: fremd, konflikte: [], art: "gleich" };
  if (gleichWert(mein, basis)) return { wert: fremd, konflikte: [], art: "fremd" };
  if (gleichWert(fremd, basis)) return { wert: mein, konflikte: [], art: "mein" };
  const basisListe = basis == null ? [] : basis;
  if (!schluesselListe(mein) || !schluesselListe(fremd) || !schluesselListe(basisListe)) {
    return { wert: mein, konflikte: [{ schluessel: null, basis, mein, fremd }], art: "konflikt" };
  }
  const B = new Map(basisListe.map((/** @type {any} */ e) => [elementSchluessel(e), e]));
  const M = new Map(mein.map((/** @type {any} */ e) => [elementSchluessel(e), e]));
  const F = new Map(fremd.map((/** @type {any} */ e) => [elementSchluessel(e), e]));
  /** @type {Konflikt[]} */
  const konflikte = [];
  /** @type {any[]} */
  const wert = [];
  /** @param {string} k */
  const entscheiden = (k) => {
    const b = B.get(k), m = M.get(k), f = F.get(k);
    if (gleichWert(m, f)) return f;
    if (gleichWert(m, b)) return f; // only the other device touched it (f undefined = it deleted the element)
    if (gleichWert(f, b)) return m; // only this device touched it
    konflikte.push({ schluessel: k, basis: b, mein: m, fremd: f });
    return m;
  };
  // my order first (the person's view stays as it is), then elements only the other device has, in its order
  const reihenfolge = [...M.keys(), ...[...F.keys()].filter((k) => !M.has(k)), ...[...B.keys()].filter((k) => !M.has(k) && !F.has(k))];
  for (const k of reihenfolge) {
    const e = entscheiden(/** @type {string} */ (k));
    if (e !== undefined) wert.push(e);
  }
  return { wert, konflikte, art: konflikte.length ? "konflikt" : "zusammen" };
}

/**
 * Three-way comparison of several fields at once.
 * @param {Record<string, any>} basis @param {Record<string, any>} mein @param {Record<string, any>} fremd
 * @param {ReadonlyArray<string>} felder the fields to compare
 * @returns {{werte: Record<string, any>, konflikte: Record<string, Konflikt[]>, arten: Record<string, string>}}
 *   konflikte holds only the fields with at least one conflict
 */
export function felderDreiWege(basis, mein, fremd, felder) {
  /** @type {Record<string, any>} */ const werte = {};
  /** @type {Record<string, Konflikt[]>} */ const konflikte = {};
  /** @type {Record<string, string>} */ const arten = {};
  for (const f of felder) {
    const r = feldDreiWege(basis?.[f], mein?.[f], fremd?.[f]);
    werte[f] = r.wert;
    arten[f] = r.art;
    if (r.konflikte.length) konflikte[f] = r.konflikte;
  }
  return { werte, konflikte, arten };
}
