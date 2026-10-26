// 106-03: check BEFORE taking over - what would this change do to the planning? It composes three checks and says
// the result in words (ok / warn / fehler + sentences) so the preview can show it next to the proposal:
//  1. the checks against wrong planning (fehlplanungPruefen, rules 1-11 of phase 97) run on the model BEFORE and AFTER
//     the change; only what the change newly causes counts (a gap that was already there is not this change's fault),
//  2. the attribute check before takeover (pruefeAttributeVorUebernahme of the IFC viewer, handed in as a function:
//     @core must not import @ifc) on the changed element before and after,
//  3. a neighbourhood check for moved walls and columns: boxes within 3 m that newly overlap.
//
// Why a "fehler" exists here although the rules themselves only warn (pruefregeln.js: never a block, liability
// decision of phase 97): the blocking set below is NOT the rules' verdict, it is this module's decision that a change
// must not CREATE a violation the planner would have to sign off - a load-bearing element demolished without a note
// on shoring/structure, a fire stop missing or weaker than its wall, a penetration in a load-bearing element without
// structural approval. The way out is always open (set the note / the approval first, then change); the rules' own
// output stays warn/hinweis for everything that already exists. Geometric impossibilities (cut point outside the
// wall, factor <= 0, element gone) are "fehler" too: there is nothing to confirm.
//
// In:  model record (customWalls ... with `_idx`), a proposal {art, ziel, params} without check, options
//      (projektId, bauart, werkstatt, durchbrueche, attributPruefung, ifcBauteil, t).
// Out: {stufe: "ok"|"warn"|"fehler", saetze: string[], befunde: [...], geprueft: {...}}. "fehler" blocks confirming.
// Pure, no I/O.
import { fehlplanungPruefen } from "../bauteil/pruefregeln.js";
import { steckbrief, typFuerWand } from "../bauteil/steckbrief.js";
import { wandGeometrie } from "../bauteil/referenz.js";
import { unterkante, wandHoehe, stuetzenHoehe } from "../bauteil/hoehen.js";
import { bauteilImModell, modellMitAenderung, elementArt, satzAusVorlage, zahlText, wertText, zielName, gleich, stabil, geometrieVon, ifcWertAktuell } from "./aenderungen.js";

/** Radius of the neighbourhood check in m [ASSUMED: 3 m catches the walls and columns a moved element can run into]. */
export const NACHBARSCHAFT_RADIUS_M = 3;

/** Overlap below this depth in m counts as touching, not as a collision [ASSUMED: 1 cm]. */
export const KOLLISION_TOLERANZ_M = 0.01;

/**
 * Codes of the rules a change must not newly trigger (see the file head: this module's decision, not the rules').
 * regel 5 abbruch_tragend, regel 8 schott_fehlt / schott_schwaecher, regel 9 durchbruch_tragend_ohne_statik.
 */
export const SPERRENDE_CODES = Object.freeze(["abbruch_tragend", "schott_fehlt", "schott_schwaecher", "durchbruch_tragend_ohne_statik"]);

/** Sentence templates of the check (German text is the i18n key; English in i18nTeile/aenderungen-106.js). */
export const PRUEF_VORLAGEN = Object.freeze({
  gesperrt: "Gesperrt: {text} — erst klären, dann ändern",
  neu: "{text} — neu durch diese Änderung",
  hinweis: "Hinweis: {text}",
  kollision: "Überschneidet {name}: {tiefeX} m × {tiefeZ} m im Grundriss (Näherung über umschließende Boxen)",
  mehr: "… und {n} weitere Überschneidungen",
  oeffnungAussen: "{art} {nr} liegt nach der Änderung außerhalb der Wand ({u} m von {laenge} m)",
  durchbruchGuid: "{n} Durchbruch/Durchbrüche verweisen auf die alte GUID der Wand und verlieren ihr Bauteil",
  kgOffen: "Das Bauteil hat keine ausdrückliche Kostengruppe im Modell",
  feuerOffen: "Der Feuerwiderstand (FireRating) ist nicht gesetzt",
  tragendOffen: "Das Merkmal tragend (LoadBearing) ist nicht gesetzt",
  alleOk: "Keine Auffälligkeit gefunden ({geprueft}).",
  geprueftRegeln: "Prüfregeln",
  geprueftAttribute: "Attribute",
  geprueftNachbarn: "Nachbarschaft",
  ungeprueft: "Nicht geprüft: {was}",
  veraltet: "Veraltet: {ziel} hat sich seit dem Vorschlag verändert ({was}) — verwerfen und neu vorschlagen",
  veraltetWert: "{eigenschaft} ist jetzt {jetzt}, der Vorschlag ging von {vorschlag} aus",
  veraltetLage: "Lage oder Maße",
  veraltetTeilen: "Bauteil oder Öffnungen",
});

/** @typedef {{stufe: "ok"|"warn"|"fehler", quelle: "regel"|"attribut"|"kollision"|"geometrie"|"verweis", code: string, satz: string}} PruefBefund */

/**
 * One line of the check as the preview shows it. `stufe` carries the FORM of the line (guard rail 5): "fehler" (solid
 * outline, sign ✕), "warn" (dashed outline, ▲), "hinweis" (a finding that does not raise the level: sign ℹ), "ok" (nothing
 * found, ✓) and "ungeprueft" (a check that did not run: sign ○) - so "not checked" and "hint" never look like "passed".
 * @typedef {{stufe: "fehler"|"warn"|"hinweis"|"ok"|"ungeprueft", satz: string, quelle?: string, code?: string}} PruefZeile
 */

/** Keys of the single ids of a finding, so a finding that only grew by one id is recognised as new for that id. */
const schluessel = (/** @type {any} */ b) => (b.ids || []).map((/** @type {string} */ id) => `${b.regel}:${b.code}:${id}`);

/**
 * Findings with the id of the second part of a split mapped back to the id of the first part: the split gives part B a
 * NEW element number, and a violation the wall already had must not look new just because its id changed.
 * @param {any[]} befunde  Findings of fehlplanungPruefen. @param {any[]|undefined} teile  The two parts of a split (A keeps the old `_idx`, B has a new one).
 * @returns {any[]}
 */
function mitTeileAlias(befunde, teile) {
  if (!teile || teile.length !== 2 || teile[0]?._idx == null || teile[1]?._idx == null) return befunde;
  const suffixB = `-${teile[1]._idx}`, suffixA = `-${teile[0]._idx}`;
  return befunde.map((b) => ({ ...b, ids: (b.ids || []).map((/** @type {string} */ id) => (id.endsWith(suffixB) ? id.slice(0, -suffixB.length) + suffixA : id)) }));
}

/**
 * Has the target changed since the proposal was made? A proposal shows "vorher" in words; confirming it later, after
 * another step changed the same property or geometry, would run a sentence that is no longer true and record a false
 * "vorher" for the undo (guard rail 1). Compares the proposal's `vorher` with the CURRENT state of the target.
 * @param {any} modell  Current model record. @param {any} vorschlag  Proposal. @param {any} opt  Options of pruefeAenderung (projektId, ifcBauteil, eintraege, t).
 * @returns {string|null}  What differs (translated words), or null when the target is as the proposal saw it (or cannot be compared).
 */
function veraltung(modell, vorschlag, opt) {
  const t = opt.t || ((/** @type {string} */ s) => s);
  const fuell = (/** @type {string} */ k, /** @type {Record<string, string|number>} */ w) => satzAusVorlage(t(PRUEF_VORLAGEN[/** @type {keyof typeof PRUEF_VORLAGEN} */ (k)]), w);
  const v = vorschlag.vorher;
  if (!v) return null;
  if (vorschlag.art === "eigenschaft" && vorschlag.ziel?.quelle === "ifc") {
    if (!opt.ifcBauteil || !v.pset) return null;
    const jetzt = ifcWertAktuell(opt.ifcBauteil, v.pset, v.eigenschaft, opt.eintraege).wert;
    return gleich(jetzt, v.wert) ? null : fuell("veraltetWert", { eigenschaft: v.label ?? v.eigenschaft, jetzt: wertText(jetzt, t), vorschlag: wertText(v.wert, t) });
  }
  const fund = bauteilImModell(modell, vorschlag.ziel?.guid, { projektId: opt.projektId ?? null });
  if (!fund) return null; // a vanished target is reported by applying the change
  const el = fund.element;
  if (vorschlag.art === "eigenschaft") {
    const gespeichert = el[v.feld] ?? null;
    // an unset field with a derived "before" is stale as soon as someone stored a value
    const alt = v.quelle === "abgeleitet" ? gespeichert == null : gleich(gespeichert, v.wert);
    return alt ? null : fuell("veraltetWert", { eigenschaft: v.label ?? v.feld, jetzt: wertText(gespeichert, t), vorschlag: wertText(v.wert, t) });
  }
  if (vorschlag.art === "transformieren") return !v.geometrie || stabil(geometrieVon(el)) === stabil(v.geometrie) ? null : t(PRUEF_VORLAGEN.veraltetLage);
  if (vorschlag.art === "teilen" && v.element) {
    if (stabil(el) !== stabil(v.element)) return t(PRUEF_VORLAGEN.veraltetTeilen);
    if (elementArt(el) === "wand" && Array.isArray(v.oeffnungen)) {
      const jetzt = (modell.customWindows || []).filter((/** @type {any} */ o) => o.wallIdx === el._idx);
      const nachIdx = (/** @type {any[]} */ l) => [...l].sort((x, y) => (Number(x._idx) || 0) - (Number(y._idx) || 0));
      if (stabil(nachIdx(jetzt)) !== stabil(nachIdx(v.oeffnungen))) return t(PRUEF_VORLAGEN.veraltetTeilen);
    }
  }
  return null;
}

/**
 * Findings of `nachher` that were not in `vorher` (per rule, code and element id).
 * @param {any[]} vorher @param {any[]} nachher @returns {any[]}
 */
function neueBefunde(vorher, nachher) {
  const alt = new Set(vorher.flatMap(schluessel));
  return nachher.filter((b) => schluessel(b).some((k) => !alt.has(k)));
}

/**
 * Bounding box of a wall or column in m, in the plan and in height.
 * The wall's footprint is its body outline from the reference line, thickness and offset (bauteil/referenz.js, 107-01:
 * the same derivation as plan, 3D and IFC), measured over the four corners so a rotated wall gets its true box; height from `level` * storey height.
 * @param {any} el @param {import("../bauteil/hoehen.js").Geschosse} sh Storey source: one storey height in m or the storey table (107-02: lower edge and height come from bauteil/hoehen.js, like 3D, plan and IFC).
 * @returns {{min: [number, number, number], max: [number, number, number]}|null}  [x, y (up), z] in m; null for other kinds.
 */
function boxVon(el, sh) {
  const art = elementArt(el);
  const y0 = unterkante(el, sh);
  if (art === "wand") {
    const ecken = wandGeometrie(el).polygon;
    const xs = ecken.map((q) => q.x), zs = ecken.map((q) => q.z);
    return { min: [Math.min(...xs), y0, Math.min(...zs)], max: [Math.max(...xs), y0 + wandHoehe(el, sh), Math.max(...zs)] };
  }
  if (art === "stuetze") {
    const h = (Number(el.size) || 0.4) / 2;
    return { min: [el.x - h, y0, el.z - h], max: [el.x + h, y0 + stuetzenHoehe(el, sh), el.z + h] };
  }
  return null;
}

/** Overlap depths of two boxes in m per axis, or null when they do not overlap deeper than the tolerance. */
function ueberlappung(a, b) {
  const o = [0, 1, 2].map((i) => Math.min(a.max[i], b.max[i]) - Math.max(a.min[i], b.min[i]));
  return o.every((v) => v > KOLLISION_TOLERANZ_M) ? { x: o[0], y: o[1], z: o[2] } : null;
}

/** Distance of two boxes in the plan in m (0 when they overlap). */
function abstandPlan(a, b) {
  const dx = Math.max(0, a.min[0] - b.max[0], b.min[0] - a.max[0]);
  const dz = Math.max(0, a.min[2] - b.max[2], b.min[2] - a.max[2]);
  return Math.hypot(dx, dz);
}

/**
 * Walls and columns newly overlapping the moved element: boxes within NACHBARSCHAFT_RADIUS_M that overlap AFTER the
 * change but did not BEFORE. Corner joints and T-joints overlap before and after and are therefore not reported.
 * [ASSUMED] bounding-box overlap instead of the clash library: the clash lib needs triangles, drawn elements have
 * none; to be replaced once the clash lib takes drawn elements. Why `warn` and never `fehler`: a box overlap is an
 * approximation, whether two elements really collide is the planner's call.
 * @param {any} vorher Element before. @param {any} nachher Element after. @param {any} modell
 * @param {import("../bauteil/hoehen.js").Geschosse} sh Storey source (one height in m or the storey table).
 * @returns {Array<{element: any, tiefe: {x: number, y: number, z: number}}>}
 */
function neueKollisionen(vorher, nachher, modell, sh) {
  const boxV = boxVon(vorher, sh), boxN = boxVon(nachher, sh);
  if (!boxV || !boxN) return [];
  const treffer = [];
  for (const arr of [modell.customWalls, modell.customColumns]) {
    for (const andere of Array.isArray(arr) ? arr : []) {
      if (andere._idx === nachher._idx && elementArt(andere) === elementArt(nachher)) continue;
      const b = boxVon(andere, sh);
      if (!b || abstandPlan(boxN, b) > NACHBARSCHAFT_RADIUS_M) continue;
      const jetzt = ueberlappung(boxN, b);
      if (jetzt && !ueberlappung(boxV, b)) treffer.push({ element: andere, tiefe: jetzt });
    }
  }
  return treffer;
}

/** Element in the shape the attribute check reads (IFC element: class, psets, classifications). Drawn elements: fire rating and load-bearing become the properties the check looks for. */
function alsIfcElement(el, art, sheet) {
  const klasse = sheet?.ifc?.klasse ?? ({ wand: "IfcWall", stuetze: "IfcColumn", decke: "IfcSlab", dach: "IfcRoof" })[art];
  if (!klasse) return null;
  return {
    ifcType: klasse,
    psets: { Pset_Gezeichnet: { ...(el.feuerwiderstand != null ? { FireRating: el.feuerwiderstand } : {}), ...(typeof el.tragend === "boolean" ? { LoadBearing: el.tragend } : {}) } },
    classifications: /^\d{3}$/.test(String(el.kg ?? "")) ? [{ code: String(el.kg) }] : [],
  };
}

/** Attribute findings of the check, as sentences (the IFC viewer's check delivers keys only, no texts). */
const ATTRIBUT_SATZ = { kg_abgeleitet: "kgOffen", feuer_fehlt: "feuerOffen", tragend_fehlt: "tragendOffen" };

/**
 * Checks a proposal against the model before anything runs.
 * The change is applied to a COPY (modellMitAenderung); the model itself is never touched. If applying throws (target
 * gone, cut outside the wall, factor <= 0 ...) the result is "fehler" with the reason as sentence.
 * @param {any} modell  Model record: customWalls, customColumns, customZones, customSlabs, customRoofs, customWindows,
 *   envOpenings, bauteil_attribute_layer, netz_layer (what fehlplanungPruefen reads).
 * @param {{art: string, ziel: {guid: string, quelle?: string, modell?: string, name?: string, klasse?: string|null}, params: any, vorher?: any, nachher?: any}} vorschlag  Proposal without check.
 * @param {{projektId?: string|number|null, bauart?: "neubau"|"bestand", werkstatt?: any, durchbrueche?: any[], huelle?: any[], geschosshoehe_m?: number, geschosse?: Array<{level: number, name?: string, hoehe_m: number}>,
 *   attributPruefung?: (elemente: any[], position?: any) => {geprueft: number, befunde: Array<{key: string, status: string, anzahl: number}>},
 *   ifcBauteil?: any, eintraege?: any[], t?: (s: string) => string}} [opt]
 *   werkstatt/durchbrueche/bauart: as the studio hands them to fehlplanungPruefen; huelle: hull walls of the building model (`model.walls`), for check 12; geschosshoehe_m: storey height in m
 *   (default 3); attributPruefung: pruefeAttributeVorUebernahme of the IFC viewer (skipped, and said so, when absent);
 *   ifcBauteil: the parsed IFC element (psets, ifcType) for an IFC property change; t: translator of the sentence templates;
 *   eintraege: stored journal entries (current value of an IFC property, for the staleness check).
 * @returns {{stufe: "ok"|"warn"|"fehler", saetze: string[], zeilen: PruefZeile[], befunde: PruefBefund[],
 *   geprueft: {regeln: boolean, attribute: boolean, kollision: boolean}}}
 *   stufe: the worst finding (fehler blocks confirming); saetze: one German sentence per finding (a single "no finding"
 *   sentence when clean); befunde: the findings with level and source; zeilen: one line per sentence with its FORM (fehler / warn /
 *   hinweis / ok / ungeprueft) so the preview marks each by symbol and outline as well as by colour, and a hint or a check
 *   that did not run never looks like a pass; geprueft: which of the three checks ran. A proposal whose target changed since
 *   it was made is "fehler" (code "veraltet").
 */
export function pruefeAenderung(modell, vorschlag, opt = {}) {
  const t = opt.t || ((s) => s);
  const fuell = (/** @type {string} */ k, /** @type {Record<string, string|number>} */ w) => satzAusVorlage(t(PRUEF_VORLAGEN[/** @type {keyof typeof PRUEF_VORLAGEN} */ (k)]), w);
  const pid = opt.projektId ?? null;
  // 107-02: the storey table (when the project has one) replaces the single height for elevations and wall heights
  const sh = Array.isArray(opt.geschosse) && opt.geschosse.length ? opt.geschosse : (opt.geschosshoehe_m || 3);
  /** @type {PruefBefund[]} */
  const befunde = [];
  const geprueft = { regeln: false, attribute: false, kollision: false };
  const fertig = () => {
    const stufe = befunde.some((b) => b.stufe === "fehler") ? "fehler" : befunde.some((b) => b.stufe === "warn") ? "warn" : "ok";
    // a finding of level "ok" is a hint (it does not raise the level) and gets its own form; "nothing found" is only said
    // when at least one check really ran
    /** @type {PruefZeile[]} */
    const zeilen = befunde.map((b) => ({ stufe: b.stufe === "ok" ? "hinweis" : b.stufe, satz: b.satz, quelle: b.quelle, code: b.code }));
    const lief = geprueft.regeln || geprueft.attribute || geprueft.kollision;
    if (!befunde.length && lief) {
      const was = [geprueft.regeln && fuell("geprueftRegeln", {}), geprueft.attribute && fuell("geprueftAttribute", {}), geprueft.kollision && fuell("geprueftNachbarn", {})].filter(Boolean).join(", ");
      zeilen.push({ stufe: "ok", satz: fuell("alleOk", { geprueft: was }) });
    }
    if (!geprueft.attribute && (opt.ifcBauteil || vorschlag.ziel?.quelle === "ifc")) zeilen.push({ stufe: "ungeprueft", satz: fuell("ungeprueft", { was: fuell("geprueftAttribute", {}) }), code: "attribute_ungeprueft" });
    return { stufe: /** @type {"ok"|"warn"|"fehler"} */ (stufe), saetze: zeilen.map((z) => z.satz), zeilen, befunde, geprueft };
  };

  // --- 0. is the proposal still true? (another step may have changed the target since it was made) --------------
  const veraltetWas = veraltung(modell ?? {}, vorschlag, opt);
  if (veraltetWas) {
    befunde.push({ stufe: "fehler", quelle: "verweis", code: "veraltet", satz: fuell("veraltet", { ziel: zielName(/** @type {any} */ (vorschlag.ziel)), was: veraltetWas }) });
    return fertig();
  }

  // --- apply on a copy; impossible = fehler ------------------------------------------------------------------
  let ergebnis;
  try {
    ergebnis = modellMitAenderung(modell, vorschlag, { projektId: pid, geschosshoehe_m: opt.geschosshoehe_m });
  } catch (e) {
    befunde.push({ stufe: "fehler", quelle: "geometrie", code: "nicht_moeglich", satz: e instanceof Error ? e.message : String(e) });
    return fertig();
  }
  const nach = ergebnis.modell;
  const ifc = vorschlag.ziel?.quelle === "ifc";

  // --- 1. rules against wrong planning: what is NEW after the change ------------------------------------------
  if (!ifc) {
    // 107-04 review: the hull walls (`huelle`) and the storey source reach check 12 when the caller hands the hull (the studio does); without it the
    // rule stays blind for hull walls and does not test the height, as before
    const eingabe = { werkstatt: opt.werkstatt ?? null, durchbrueche: opt.durchbrueche ?? [], projektId: pid, bauart: opt.bauart ?? "neubau",
      ...(Array.isArray(opt.huelle) ? { huelle: opt.huelle, geschosse: sh } : {}) };
    const vorher = fehlplanungPruefen({ modell, ...eingabe });
    const nachher = mitTeileAlias(fehlplanungPruefen({ modell: nach, ...eingabe }), vorschlag.art === "teilen" ? ergebnis.teile : undefined);
    geprueft.regeln = true;
    for (const b of neueBefunde(vorher, nachher)) {
      if (SPERRENDE_CODES.includes(b.code)) befunde.push({ stufe: "fehler", quelle: "regel", code: b.code, satz: fuell("gesperrt", { text: b.text }) });
      else if (b.stufe === "warn") befunde.push({ stufe: "warn", quelle: "regel", code: b.code, satz: fuell("neu", { text: b.text }) });
      else befunde.push({ stufe: "ok", quelle: "regel", code: b.code, satz: fuell("hinweis", { text: b.text }) });
    }
  }

  // --- 2. attribute check on the changed element before and after ---------------------------------------------
  if (typeof opt.attributPruefung === "function") {
    /** @type {any} */ let vorElement = null, nachElement = null;
    if (ifc && opt.ifcBauteil) {
      vorElement = opt.ifcBauteil;
      const n = vorschlag.nachher || {};
      nachElement = { ...opt.ifcBauteil, psets: { ...(opt.ifcBauteil.psets || {}), [n.pset]: { ...(opt.ifcBauteil.psets?.[n.pset] || {}), [n.eigenschaft]: n.wert } } };
    } else if (!ifc) {
      const f = bauteilImModell(modell, vorschlag.ziel.guid, { projektId: pid });
      const g = bauteilImModell(nach, vorschlag.ziel.guid, { projektId: pid }) || (ergebnis.neu[0] ? bauteilImModell(nach, ergebnis.neu[0], { projektId: pid }) : null);
      if (f && g) {
        const sheet = f.art === "wand" ? safeSteckbrief(f.element, pid) : null;
        vorElement = alsIfcElement(f.element, f.art, sheet);
        nachElement = alsIfcElement(g.element, g.art, sheet);
      }
    }
    if (vorElement && nachElement) {
      geprueft.attribute = true;
      const alt = new Map(opt.attributPruefung([vorElement]).befunde.map((b) => [b.key, b]));
      for (const b of opt.attributPruefung([nachElement]).befunde) {
        const war = alt.get(b.key);
        if (war && !(war.status === "offen" && b.status === "warn")) continue; // not caused by this change
        const vorlage = ATTRIBUT_SATZ[/** @type {keyof typeof ATTRIBUT_SATZ} */ (b.key)];
        if (!vorlage) continue; // the *_gemischt and kg_abweichend findings need several elements / a position
        // "offen" (attribute missing) is a hint, only "warn" (contradiction) raises the level
        befunde.push({ stufe: b.status === "warn" ? "warn" : "ok", quelle: "attribut", code: b.key, satz: fuell("hinweis", { text: fuell(vorlage, {}) }) });
      }
    }
  }

  // --- 3. neighbourhood: boxes that newly overlap after a move/rotate/scale -----------------------------------
  if (!ifc && vorschlag.art === "transformieren") {
    const f = bauteilImModell(modell, vorschlag.ziel.guid, { projektId: pid });
    const g = bauteilImModell(nach, vorschlag.ziel.guid, { projektId: pid });
    if (f && g) {
      geprueft.kollision = true;
      const treffer = neueKollisionen(f.element, g.element, nach, sh);
      for (const k of treffer.slice(0, 5)) {
        const art = elementArt(k.element);
        const name = art === "wand" ? `Wand W-${k.element._idx}` : `Stütze S-${k.element._idx}`;
        befunde.push({ stufe: "warn", quelle: "kollision", code: "ueberschneidung", satz: fuell("kollision", { name, tiefeX: zahlText(k.tiefe.x), tiefeZ: zahlText(k.tiefe.z) }) });
      }
      if (treffer.length > 5) befunde.push({ stufe: "warn", quelle: "kollision", code: "ueberschneidung", satz: fuell("mehr", { n: treffer.length - 5 }) });
    }
  }

  // --- 4. knock-on effects of a split / scale on openings and references ---------------------------------------
  for (const w of ergebnis.warnungen) befunde.push({ stufe: "warn", quelle: "geometrie", code: "oeffnung_teilung", satz: w });
  if (!ifc && vorschlag.art === "transformieren") {
    const neuW = bauteilImModell(nach, vorschlag.ziel.guid, { projektId: pid });
    if (neuW?.art === "wand") {
      const len = Math.hypot(neuW.element.b.x - neuW.element.a.x, neuW.element.b.z - neuW.element.a.z);
      for (const o of (nach.customWindows || []).filter((/** @type {any} */ x) => x.wallIdx === neuW.element._idx)) {
        if (Number(o.u) > len) befunde.push({ stufe: "warn", quelle: "geometrie", code: "oeffnung_ausserhalb",
          satz: fuell("oeffnungAussen", { art: o.kind === "door" ? "Tür" : o.kind === "oeffnung" ? "Öffnung" : "Fenster", nr: o._idx ?? "", u: zahlText(o.u), laenge: zahlText(len) }) });
      }
    }
  }
  if (vorschlag.art === "teilen" && ergebnis.entfernt.length) {
    const betroffen = (opt.durchbrueche || []).filter((/** @type {any} */ d) => d && ergebnis.entfernt.includes(String(d.bauteil_guid || ""))).length;
    if (betroffen) befunde.push({ stufe: "warn", quelle: "verweis", code: "durchbruch_guid", satz: fuell("durchbruchGuid", { n: betroffen }) });
  }
  return fertig();
}

/** Data sheet of a drawn wall for its IFC class; null if the type is unknown. */
function safeSteckbrief(wand, projektId) {
  try { return steckbrief(wand, typFuerWand(wand).typ, { projektId, quelle: "customWalls" }); } catch { return null; }
}

