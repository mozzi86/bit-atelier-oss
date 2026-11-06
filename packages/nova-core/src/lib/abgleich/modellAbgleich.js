// 106-09: what a viewer does with a change of the drawn model that another device saved - pure functions, so the
// BIM studio only wires them to its state (and the unit test checks them without React):
//   fremdeElementeAbgleichen   three-way per field (dreiWege.js) against what THIS page holds right now: what to set,
//                              which elements conflict, which elements changed (for the note)
//   aenderungsZeilen           one line per changed element for the note, with its origin when the element carries the
//                              mark of a confirmed step (geaendert_durch: herkunft, bestaetigt_durch, satz)
//   konfliktZeilen             both versions of every conflicting element as short text
//   konfliktAufloesen          the field after the person picked "mine" or "the other device's"
//   neueKollisionenUmnummern   review 106-09: two devices drew a new element at the same time with the same `_idx` -
//                              this page's one gets a free number before the merge, so both stay (no fake conflict)
//   feldName                   the German label of any record field (conflict cards; translated by the card)
//
// Nothing here confirms or writes anything (D-IM-04): the other device's change was confirmed by the person there; it
// is shown here as exactly that, with its origin.
//
// In:  patch / vorher of a FremderStand (useBimModelSync.js), the page's local values. Out: see above.

import { elementSchluessel, feldDreiWege, gleichWert } from "./dreiWege.js";

/** Element lists of the BIM studio (field → German label, translated by the caller). */
export const ELEMENT_FELDER = Object.freeze({
  customWalls: "Wände", customColumns: "Stützen", customWindows: "Fenster und Türen", envOpenings: "Öffnungen der Hülle",
  customZones: "Räume", customSlabs: "Decken", customRoofs: "Dächer",
});

/** Element kind per list in the singular (for a line "Wand #3"). */
const EINZEL = Object.freeze({
  customWalls: "Wand", customColumns: "Stütze", customWindows: "Öffnung", envOpenings: "Öffnung",
  customZones: "Raum", customSlabs: "Decke", customRoofs: "Dach",
});

/** Single values of the BIM studio's envelope (field → German label). */
export const STUDIO_WERTE = Object.freeze({
  envComposite: "Hüllwand-Aufbau", envThickness: "Hüllwand-Dicke", huelle_bezug: "Bezugslinie der Hülle",
  huelle_decke_dicke_m: "Deckendicke der Hülle", huelle_decke_bezug: "Deckenbezug der Hülle", parapet: "Attika",
  dachform: "Dachform", dachneigung: "Dachneigung", entranceCfg: "Eingang", verschneidung: "Wände verschneiden",
  dachform_ifc: "Gebäudedach im IFC", // 107-10 review: switch "Gebäudedach ins IFC" (optional, written once used)
});

/**
 * Switches whose `false` means the same as a missing field (107-09 review): `verschneidung` is written only once it was used, so one page
 * holds `false` (state default) where the record and another device hold nothing. Without this, a device switching it on met a
 * conflict on a page that never touched the switch.
 */
export const FALSCH_WIE_FEHLT = Object.freeze(new Set(["verschneidung", "dachform_ifc"]));

/**
 * Labels of the other record fields - the program fields of useBimModelSync and the layers of the editors (German keys,
 * translated by the card), so a conflict card never shows an internal field name.
 */
export const FELD_NAMEN = Object.freeze({
  footprintM: "Grundriss", footprintQuelle: "Herkunft des Grundrisses", achseM: "Achse", storeys: "Geschosszahl",
  storeyHeight: "Geschosshöhe", geschosse: "Geschosstabelle", untergeschosse: "Untergeschosse", unit: "Einheit",
  bauteil_attribute_layer: "Bauteil-Attribute", sketch_layer: "Skizze", massing_layer: "Massing-Körper",
  netz_layer: "Haustechnik-Netz", statik_layer: "Tragwerk", werkstatt_layer: "Wohnungs-Werkstatt",
  aussenanlagen_layer: "Außenanlagen", entwaesserung_layer: "Entwässerung", brandschutz_layer: "Brandschutz-Plan",
  schallschutz_layer: "Schallschutz-Plan", raumklima_layer: "Raumklima", befunde_layer: "Befunde",
  lieferung_layer: "Modelllieferungen", pruefung_layer: "Eigene Prüfregeln", bauaufnahme_layer: "Bauaufnahme",
  brandschutz_vermerke_layer: "Brandschutz-Vermerke", barrierefreiheit_layer: "Barrierefreiheit-Vermerke",
  schallschutz_vermerke_layer: "Schallschutz-Vermerke", aufbauten_layer: "Aufbauten des Projekts",
  csg_cache_layer: "3D-Zwischenspeicher (CSG)", solidrelationen_layer: "Bauteil-Operationen",
  ansicht_layer: "Ausschnitte und Ebenen",
});

/**
 * German label of a record field (element list, envelope value, program field, layer); the field name itself when unknown.
 * @param {string} feld @returns {string}
 */
export function feldName(feld) {
  const k = /** @type {any} */ (feld);
  return /** @type {any} */ (ELEMENT_FELDER)[k] ?? /** @type {any} */ (STUDIO_WERTE)[k] ?? /** @type {any} */ (FELD_NAMEN)[k] ?? feld;
}

/** Field that carries the origin mark of a confirmed step (aenderungen.js MARKE_FELD; repeated to keep this module small). */
const MARKE = "geaendert_durch";

/**
 * @typedef {{feld: string, schluessel: string, vorher: any, nachher: any}} Geaendert  one element another device changed
 *   (vorher undefined = new, nachher undefined = removed)
 */

/**
 * Three-way comparison of every streamed field against the page's current values.
 * @param {{patch: Record<string, any>, vorher: Record<string, any>, lokal: Record<string, any>, felder: ReadonlyArray<string>}} a
 *   patch = foreign values, vorher = base, lokal = what the page holds now (unsaved edits included)
 * @returns {{setzen: Record<string, any>, konflikte: Record<string, import("./dreiWege.js").Konflikt[]>, geaendert: Geaendert[], einzel: string[]}}
 *   setzen = fields whose local value must change; geaendert = elements of lists the other device changed; einzel = single
 *   values it changed
 */
export function fremdeElementeAbgleichen({ patch, vorher, lokal, felder }) {
  /** @type {Record<string, any>} */ const setzen = {};
  /** @type {Record<string, import("./dreiWege.js").Konflikt[]>} */ const konflikte = {};
  /** @type {Geaendert[]} */ const geaendert = [];
  /** @type {string[]} */ const einzel = [];
  for (const feld of felder) {
    if (!(feld in patch)) continue;
    const n = (/** @type {any} */ v) => (FALSCH_WIE_FEHLT.has(feld) && v === false ? undefined : v);
    const r = feldDreiWege(n(vorher[feld]), n(lokal[feld]), n(patch[feld]));
    if (!gleichWert(r.wert, n(lokal[feld]))) setzen[feld] = r.wert;
    if (r.konflikte.length) konflikte[feld] = r.konflikte;
    if (Array.isArray(patch[feld]) || Array.isArray(vorher[feld])) geaendert.push(...elementDiff(feld, vorher[feld] || [], patch[feld] || []));
    else einzel.push(feld);
  }
  return { setzen, konflikte, geaendert, einzel };
}

/** @param {any} v @returns {number[]} the `_idx` numbers of a list */
const idxVon = (v) => (Array.isArray(v) ? v.map((e) => e?._idx).filter((x) => typeof x === "number") : []);

/**
 * Review 106-09: two devices drew a new element at the same time. Both counters start at "highest _idx + 1", so both new
 * elements carry the same `_idx` and the three-way merge took them for ONE element changed twice - a conflict whose every
 * way out dropped one of the two. Before the merge, THIS page's new element gets a free number above every number of both
 * versions; openings on a renumbered wall follow it (customWindows.wallIdx). The other device never saw this page's
 * number, so nothing breaks there; after the next save it gets both elements.
 * A foreign element is "new" when its number is not in the base of its list; any local element with that number that is
 * not the same element (same list, same content) is renumbered - the counter is shared by all lists.
 * @param {{vorher: Record<string, any>, lokal: Record<string, any>, patch: Record<string, any>}} a
 *   vorher = base of the changed fields, lokal = this page's element lists (all of them), patch = the foreign values
 * @returns {{lokal: Record<string, any>, geaendert: string[], umbenannt: Array<[number, number]>, naechsteIdx: number}}
 *   lokal = the lists after renumbering (unchanged ones as they were); geaendert = lists that changed; umbenannt = [alt, neu];
 *   naechsteIdx = the first free number for the next element drawn here
 */
export function neueKollisionenUmnummern({ vorher, lokal, patch }) {
  const listen = Object.keys(ELEMENT_FELDER);
  /** @type {Map<number, {feld: string, el: any}>} */
  const fremdNeu = new Map();
  let max = 0;
  for (const feld of listen) {
    for (const n of [...idxVon(lokal[feld]), ...idxVon(patch[feld]), ...idxVon(vorher[feld])]) max = Math.max(max, n);
    if (!(feld in patch)) continue;
    const basis = new Set(idxVon(vorher[feld]));
    for (const el of Array.isArray(patch[feld]) ? patch[feld] : []) {
      if (typeof el?._idx === "number" && !basis.has(el._idx)) fremdNeu.set(el._idx, { feld, el });
    }
  }
  /** @type {Record<string, any>} */ const out = { ...lokal };
  /** @type {Set<string>} */ const geaendert = new Set();
  /** @type {Array<[number, number]>} */ const umbenannt = [];
  /** @type {Map<number, number>} */ const waende = new Map();
  if (fremdNeu.size) {
    for (const feld of listen) {
      if (!Array.isArray(out[feld])) continue;
      out[feld] = out[feld].map((/** @type {any} */ el) => {
        const f = typeof el?._idx === "number" ? fremdNeu.get(el._idx) : undefined;
        if (!f || (f.feld === feld && gleichWert(f.el, el))) return el;
        max += 1;
        umbenannt.push([el._idx, max]);
        if (feld === "customWalls") waende.set(el._idx, max);
        geaendert.add(feld);
        return { ...el, _idx: max };
      });
    }
    if (waende.size && Array.isArray(out.customWindows)) {
      out.customWindows = out.customWindows.map((/** @type {any} */ o) => {
        if (!waende.has(o?.wallIdx)) return o;
        geaendert.add("customWindows");
        return { ...o, wallIdx: waende.get(o.wallIdx) };
      });
    }
  }
  return { lokal: out, geaendert: [...geaendert], umbenannt, naechsteIdx: max + 1 };
}

/**
 * Elements of one list that differ between two versions (by key, elements without a key are skipped).
 * @param {string} feld @param {any[]} alt @param {any[]} neu @returns {Geaendert[]}
 */
export function elementDiff(feld, alt, neu) {
  const A = new Map(alt.map((e) => [elementSchluessel(e), e]));
  const N = new Map(neu.map((e) => [elementSchluessel(e), e]));
  /** @type {Geaendert[]} */
  const out = [];
  for (const k of new Set([...N.keys(), ...A.keys()])) {
    if (k == null) continue;
    if (!gleichWert(A.get(k), N.get(k))) out.push({ feld, schluessel: k, vorher: A.get(k), nachher: N.get(k) });
  }
  return out;
}

/** @param {string} feld @param {any} el @param {(s: string) => string} t @returns {string} "Wand #3" */
const elementName = (feld, el, t) => `${t(EINZEL[/** @type {keyof typeof EINZEL} */ (feld)] ?? feld)} #${el?._idx ?? el?.guid ?? el?.id ?? "?"}`;

/** @param {any} a @param {any} b @returns {string[]} names of the properties that differ (the origin mark left out) */
const geaenderteEigenschaften = (a, b) => [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])]
  .filter((k) => k !== MARKE && !gleichWert(a?.[k], b?.[k])).sort();

/**
 * One line per changed element for the note "arrived from another device".
 * @param {Geaendert[]} geaendert @param {string[]} einzel single values that changed
 * @param {(s: string) => string} [t] translator
 * @returns {Array<{text: string, herkunft: string[]|null, bestaetigt_durch: string|null}>}
 */
export function aenderungsZeilen(geaendert, einzel = [], t = (s) => s) {
  const zeilen = geaendert.map((g) => {
    const el = g.nachher ?? g.vorher;
    const marke = g.nachher?.[MARKE];
    // the origin counts only when THIS change set the mark (a new step id), not when an old mark merely stayed
    const neueMarke = marke && marke.vorschlag_id !== g.vorher?.[MARKE]?.vorschlag_id ? marke : null;
    let was;
    if (g.vorher === undefined) was = t("neu");
    else if (g.nachher === undefined) was = t("entfernt");
    else was = geaenderteEigenschaften(g.vorher, g.nachher).join(", ");
    const quellen = neueMarke ? (Array.isArray(neueMarke.herkunft_quellen) && neueMarke.herkunft_quellen.length ? neueMarke.herkunft_quellen : [neueMarke.herkunft]) : null;
    // the confirmed sentence names the element itself ("Wand W-12: Feuerwiderstand F30 → F90")
    const text = neueMarke?.satz && g.vorher !== undefined && g.nachher !== undefined ? String(neueMarke.satz) : `${elementName(g.feld, el, t)}: ${was}`;
    return { text, herkunft: quellen, bestaetigt_durch: neueMarke?.bestaetigt_durch ?? null };
  });
  for (const f of einzel) zeilen.push({ text: `${t(feldName(f))}: ${t("geändert")}`, herkunft: null, bestaetigt_durch: null });
  return zeilen;
}

/**
 * Short text of one version of a conflicting element: the properties that differ from the base with their values.
 * @param {any} el version @param {any} basis base element @param {(s: string) => string} t @returns {string}
 */
function versionText(el, basis, t) {
  if (el === undefined) return t("gelöscht");
  if (basis === undefined) return t("neu angelegt");
  const props = geaenderteEigenschaften(basis, el);
  if (!props.length) return t("unverändert");
  return props.slice(0, 4).map((k) => `${k} ${kurz(el[k])}`).join(", ");
}

/** @param {any} v @returns {string} */
const kurz = (v) => {
  if (v === undefined || v === null || v === "") return "—";
  if (typeof v === "number") return String(Math.round(v * 1000) / 1000).replace(".", ",");
  if (typeof v === "object") return JSON.stringify(v).slice(0, 40);
  return String(v).slice(0, 40);
};

/**
 * Both versions of every conflicting element as short text (for the conflict card).
 * @param {string} feld @param {import("./dreiWege.js").Konflikt[]} konflikte @param {(s: string) => string} [t]
 * @returns {Array<{schluessel: string|null, name: string, mein: string, fremd: string}>}
 */
export function konfliktZeilen(feld, konflikte, t = (s) => s) {
  return konflikte.map((k) => {
    if (k.schluessel == null) {
      const label = STUDIO_WERTE[/** @type {keyof typeof STUDIO_WERTE} */ (feld)] ?? ELEMENT_FELDER[/** @type {keyof typeof ELEMENT_FELDER} */ (feld)] ?? feld;
      return { schluessel: null, name: t(label), mein: kurz(k.mein), fremd: kurz(k.fremd) };
    }
    const el = k.mein ?? k.fremd ?? k.basis;
    return { schluessel: k.schluessel, name: elementName(feld, el, t), mein: versionText(k.mein, k.basis, t), fremd: versionText(k.fremd, k.basis, t) };
  });
}

/**
 * The value of a field after the person's decision. "mein" keeps the local value; "fremd" puts the other device's
 * version of every conflicting element in place (removes it where the other device deleted it, adds it where only it
 * has it). A whole-field conflict (schluessel null) takes the foreign value as a whole.
 * @param {any} lokal current local value of the field
 * @param {import("./dreiWege.js").Konflikt[]} konflikte @param {"mein"|"fremd"} wahl
 * @returns {any}
 */
export function konfliktAufloesen(lokal, konflikte, wahl) {
  if (wahl === "mein") return lokal;
  const ganz = konflikte.find((k) => k.schluessel == null);
  if (ganz) return ganz.fremd;
  const ersatz = new Map(konflikte.map((k) => [k.schluessel, k.fremd]));
  const liste = Array.isArray(lokal) ? lokal : [];
  /** @type {any[]} */
  const out = [];
  const gesehen = new Set();
  for (const el of liste) {
    const k = elementSchluessel(el);
    if (k != null && ersatz.has(k)) {
      gesehen.add(k);
      const f = ersatz.get(k);
      if (f !== undefined) out.push(f);
    } else out.push(el);
  }
  for (const [k, f] of ersatz) if (!gesehen.has(k) && f !== undefined) out.push(f);
  return out;
}

/**
 * Checks the open proposals of a viewer again after a foreign change (command "pruefen" of its register, 106-03): a
 * proposal whose element changed is now "Veraltet: ..." and blocked. Nothing else happens to it.
 * @param {{ausfuehren: (id: string, p?: any) => any}} register the viewer's command register
 * @returns {number} open proposals that are stale now
 */
export function vorschlaegeNeuPruefen(register) {
  const offen = register.ausfuehren("vorschlaege", { nur_offen: "ja" });
  if (!offen?.ok || !offen.result?.offen?.length) return 0;
  const p = register.ausfuehren("pruefen", {});
  if (!p?.ok || !Array.isArray(p.result)) return 0;
  return p.result.filter((/** @type {any} */ v) => v.gesperrt && (v.pruefung?.saetze || []).some((/** @type {any} */ s) => /^Veraltet/.test(String(s)))).length;
}
