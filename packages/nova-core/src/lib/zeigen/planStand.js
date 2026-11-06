// 106-11: the MODEL STATE a plan was derived from, and the note "enthält ungeprüfte KI-Änderungen" (guard rail 3 of phase 106:
// inconspicuous errors in derived plans must be visible). A plan (vector PDF floor plan / section, DXF floor plan, the plan view
// of the BIM studio) carries
//  - the model state in its title block: time of the stored model, number of confirmed changes, a short fingerprint of the
//    drawn content ("Kennung"),
//  - while the model holds AI changes nobody released yet (106-10 ungepruefteKiAenderungen: origin agent / speech / image),
//    a visible note with the combined origin wording of D-IM-07 ("Spracheingabe + Agent") and a mark on every affected element
//    (outline + "?", not colour alone - guard rail 5).
// The plan list (Werkplanung › Pläne) compares the state a plan carries with the current one and flags an outdated plan.
//
// Why an agent cannot remove the note (D-IM-04): the note is derived here from the stored step records only. It disappears when
// every AI step is released or reversed - both are human actions (the server refuses a program's write on AenderungsSchritt with
// 403, 106-10). No caller option switches it off, and a state that could not be determined prints a note too ("nicht ermittelt"):
// on the vector PDF (vektorPlanPdf) and the fire-brigade sheet a missing state yields the note. Exception, by design: the DXF
// builder grundrissDxfDaten called WITHOUT the option `modellstand` (undefined) stays the plain 104-06 translation (its comment
// says "nicht ermittelt", no visible note) - every caller of the app passes a state (null = not determined -> note).
// Not tamper-proof: the plan list compares the state a filed PDF carries (its keywords, Plan.modellstand); a hand-edited PDF or
// a program writing Plan.modellstand can show "aktuell" there. The sheet itself and the studio's note stay right.
//
// Pure: no React, no I/O (loading lives in planStandLaden.js). Reused by 107-12 (the view state object carries the note field).
//
// In:  model record (BimModel: element arrays, layers, program fields), step records (AenderungsSchritt), translator.
// Out: state object, title block text, note lines, metadata line (PDF keywords / DXF comment) and its parser, comparison for
//      the plan list, outlines of the marked elements.
import { herkunftText, zielName, bauteilImModell } from "./aenderungen.js";
import { ungepruefteKiAenderungen } from "./aenderungsProtokoll.js";
import { schrittAktiv } from "../verlauf/schrittVerlauf.js";
import { umrissVon } from "./planVorschau.js";
import { bauteilGuid } from "../bauteil/steckbrief.js";
import { LAYER_VERSION, migrateLayer } from "../fachlayerSchema.js";
import { untergeschosseAnzahl } from "../bauteil/ebenen.js";

/** Marker of the machine-readable model state line (PDF keywords, DXF comment). Version 1 of the format. */
export const MODELLSTAND_KENNUNG = "BIT-ATELIER-MODELLSTAND";

/**
 * Fields of the model record whose content a plan draws - the fingerprint covers exactly these: element arrays, hull and roof
 * settings, the program fields of useBimModelSync that shape the drawn model (footprint, centre line, storey count and height, the
 * storey table `geschosse` of 107-02 - createBuildingModel and the workshop walls read them, the number of basements
 * `untergeschosse` of 107-13 - it adds storeys, hull walls and slabs below ±0.00 to the section and the storey list), the attribute layer (statuses of hull
 * and workshop walls), the project build-ups (aufbauten_layer, 107-03: hull and slab thicknesses) and the workshop layer (the
 * workshop walls on the sheet are derived from it).
 * Not covered: sketch, network, statics and massing layers (not drawn on the sheet) [ASSUMED: a change there does not outdate a
 * plan], and the site's drawn area the studio falls back to when the record has no footprint (it lives in the site data, not in
 * the model record - a change there is not detected).
 */
export const KENNUNG_FELDER = Object.freeze([
  "customWalls", "customColumns", "customZones", "customSlabs", "customRoofs", "customWindows", "envOpenings",
  "envComposite", "envThickness", "huelle_bezug", "huelle_decke_dicke_m", "huelle_decke_bezug", "parapet", "dachform", "dachneigung",
  "entranceCfg", "footprintM", "achseM", "storeys", "storeyHeight", "geschosse", "untergeschosse", "bauteil_attribute_layer", "aufbauten_layer",
  "werkstatt_layer", "verschneidung",
]);

/** Program fields with the default useBimModelSync loads for a record without them (the drawn model uses the default). */
const PROGRAMM_STANDARD = Object.freeze({ storeys: 4, storeyHeight: 3 });

/**
 * Empty in the sense of "draws nothing": null/undefined, an empty array, an object whose values are all empty.
 * @param {any} v @returns {boolean}
 */
function leer(v) {
  if (v === undefined || v === null) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.values(v).every(leer);
  return false;
}

/**
 * The value of one fingerprint field in a normal form, so the stored record, a fresh read and the studio's live state give the same
 * result for the same drawing: layers migrated to their schema version and WITHOUT the save stamp (v, updatedAt - a re-save of the
 * same content is no change), program fields with the defaults the hook loads, a centre line of fewer than two points as none,
 * and every empty value as null.
 * @param {string} k  Field name (KENNUNG_FELDER). @param {any} v  Value. @returns {any}  null = draws nothing.
 */
export function kennungWert(k, v) {
  let w = v;
  if (k in PROGRAMM_STANDARD && !(Number(w) > 0)) w = /** @type {Record<string, number>} */ (PROGRAMM_STANDARD)[k];
  if (k === "achseM" && !(Array.isArray(w) && w.length >= 2)) w = null;
  // 107-13: 0 basements draws the same as an absent field (every record before 107-13) - both give no entry, so the
  // fingerprint of an old sheet stays the same; the value is normalised like useBimModelSync loads it (integer 0 … 3)
  if (k === "untergeschosse") w = untergeschosseAnzahl(w) || null;
  // 107-09: the switch "Wände verschneiden" changes the drawn walls; off draws the same as an absent field (every record before 107-09)
  if (k === "verschneidung") w = w === true ? true : null;
  if (k in LAYER_VERSION && w && typeof w === "object" && !Array.isArray(w)) {
    const { v: _v, updatedAt: _u, ...rest } = migrateLayer(k, w).wert;
    w = rest;
  }
  return leer(w) ? null : w;
}

/**
 * Print colours of the note and the marks: the LIGHT values of the app tokens --warnung (23 83% 18%) and --warnung-flaeche
 * (48 100% 96%) - paper is white, so the light theme applies. Checked with bit-farbsehen: #542508 on white 12.8:1; against the
 * poché #3f3f46 "knapp" (deutan ΔE 0.084, not confusable) - the mark is therefore drawn OUTSIDE the element, dashed, with "?".
 * `strich`: dash pattern in mm on paper (dashed = "ungeprüft" in STATUS_DARSTELLUNG of the change log).
 */
export const VERMERK_DRUCK = Object.freeze({ linie: "#542508", flaeche: "#fffbeb", strich: "2 1", zeichen: "?" });

/** Note headline (i18n key, also printed on the sheet). */
export const VERMERK_TITEL = "Enthält ungeprüfte KI-Änderungen";
/** Note headline when the state could not be determined (i18n key). */
export const VERMERK_UNBEKANNT_TITEL = "Prüfstand der KI-Änderungen nicht ermittelt";

/**
 * Stable JSON: object keys sorted, undefined dropped (like JSON.stringify) - a record that went through the server keeps its
 * content but not necessarily the key order.
 * @param {any} v @returns {string}
 */
function stabil(v) {
  if (v === undefined) return "null";
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? "null" : stabil(x))).join(",")}]`;
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stabil(v[k])}`).join(",")}}`;
}

/**
 * FNV-1a 32 bit of a string, as 8 hex digits.
 * @param {string} s @param {number} seed  Offset basis. @returns {string}
 */
function fnv(s, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * Fingerprint of the drawn content of a model record (KENNUNG_FELDER): the same content gives the same 16 hex digits on every
 * device; a change of any drawn field gives another one. Not a security hash - it only tells "the model changed".
 * @param {any} modell  BimModel record (or the studio's state with the same field names); null = no stored model.
 * @returns {string}  16 hex digits, "" without a model.
 */
export function modellKennung(modell) {
  if (!modell || typeof modell !== "object") return "";
  const teil = {};
  // normal form (kennungWert): the studio's cached record is migrated on load (useBimModelSync), a fresh read of the entity is
  // not; a record without storeys draws the default - both must give the same fingerprint
  for (const k of KENNUNG_FELDER) {
    const w = kennungWert(k, modell[k]);
    if (w !== null) teil[k] = w;
  }
  return kurzHash(stabil(teil));
}

/** 16 hex digits of a string (two FNV-1a passes). @param {string} s @returns {string} */
function kurzHash(s) {
  return fnv(s, 0x811c9dc5) + fnv(s, 0x01000193 ^ 0x5bd1e995);
}

/**
 * Short binding of a state to its project (8 hex digits of the project id): a sheet of another project with the same content
 * (two empty models give the same Kennung) must not read "aktuell" in this project's plan list.
 * @param {string|number|null|undefined} projektId @returns {string}  "" without a project.
 */
export function projektKennung(projektId) {
  return projektId == null || projektId === "" ? "" : kurzHash(`projekt|${projektId}`).slice(0, 8);
}

/**
 * Fingerprint fields whose live value (what the studio draws now) differs from the stored record - the sheet would carry a state
 * that does not match its drawing (a debounced save still pending, a save that failed, a field held back by a conflict).
 * Only the fields present in `live` are compared (the caller hands what it holds).
 * @param {any} gespeichert  Stored record (null = none). @param {Record<string, any>} live  Live values by field name.
 * @returns {string[]}  Differing field names; empty = the drawing matches the stored record.
 */
export function ungespeicherteFelder(gespeichert, live) {
  return Object.keys(live || {}).filter((k) => KENNUNG_FELDER.includes(k)
    && stabil(kennungWert(k, live[k])) !== stabil(kennungWert(k, gespeichert ? gespeichert[k] : undefined)));
}

/**
 * @typedef {{ermittelt: boolean, grund: string|null, detail?: string|null, projekt?: string, zeit: string|null, kennung: string,
 *   aenderungen: number, ungeprueft: number, guids: string[], herkunft_quellen: string[], betroffen: string[]}} ModellStand
 *   ermittelt: false = could not be read (then the note says so); grund: German reason when not determined (i18n key);
 *   detail: untranslated addition to the reason (an error text); projekt: projektKennung of the project ("" = unknown);
 *   zeit: ISO time of the stored model (updated_date), null = no stored model; kennung: modellKennung; aenderungen: confirmed,
 *   active steps of this source; ungeprueft: active AI steps nobody released; guids: elements they touched; herkunft_quellen: the
 *   origins of those steps in order of first appearance (D-IM-07); betroffen: their element names ("Wand W-3").
 */

/**
 * The state of the model a plan is derived from.
 * @param {{modell: any, schritte: ReadonlyArray<any>, quelle?: "bim"|"ifc"|"alle", projektId?: string|number|null}} e
 *   modell: stored BimModel record (null = none); schritte: step records of the project; quelle: which steps belong to this plan
 *   (default "bim" - the plans of the BIM studio are drawn from the drawn elements, IFC journal steps do not reach them);
 *   projektId: the project (default: the record's project_id) - bound into the state line.
 * @returns {ModellStand}
 */
export function modellStand({ modell, schritte, quelle = "bim", projektId }) {
  const eigene = (schritte || []).filter((s) => quelle === "alle" || (s?.quelle ?? "bim") === quelle);
  const offen = ungepruefteKiAenderungen(eigene);
  /** @type {string[]} */
  const quellen = [];
  for (const s of offen.schritte) {
    const liste = Array.isArray(s.herkunft_quellen) && s.herkunft_quellen.length ? s.herkunft_quellen : [s.herkunft];
    for (const q of liste) if (q && !quellen.includes(String(q))) quellen.push(String(q));
  }
  return {
    ermittelt: true,
    grund: null,
    projekt: projektKennung(projektId ?? modell?.project_id ?? null),
    zeit: modell?.updated_date ? String(modell.updated_date) : null,
    kennung: modellKennung(modell),
    aenderungen: eigene.filter(schrittAktiv).length,
    ungeprueft: offen.anzahl,
    guids: offen.guids,
    herkunft_quellen: quellen,
    betroffen: [...new Set(offen.schritte.map((s) => zielName(s.ziel || {})))],
  };
}

/**
 * A state that could not be determined (steps or model not readable, model not saved). The plan then still carries a note.
 * @param {string} grund  German reason (i18n key). @param {string|null} [detail]  Untranslated addition (an error text).
 * @returns {ModellStand}
 */
export function modellStandUnbekannt(grund, detail = null) {
  return { ermittelt: false, grund: String(grund || "unbekannt"), detail: detail ? String(detail) : null, projekt: "", zeit: null, kennung: "",
    aenderungen: 0, ungeprueft: 0, guids: [], herkunft_quellen: [], betroffen: [] };
}

/**
 * Reason of a state in words: the translated key plus the untranslated detail.
 * @param {ModellStand} stand @param {(s: string) => string} t @returns {string}
 */
function grundText(stand, t) {
  return `${t(String(stand.grund))}${stand.detail ? `: ${stand.detail}` : ""}`;
}

/**
 * The plan must carry the note: unreleased AI changes exist, or the state is unknown (fail-safe: no clean sheet without proof).
 * @param {ModellStand|null|undefined} stand  null/undefined counts as unknown. @returns {boolean}
 */
export function vermerkNoetig(stand) {
  return !stand || !stand.ermittelt || stand.ungeprueft > 0;
}

/**
 * Local date and time "26.10.2026 14:03" (the sheet is read by people; the ISO time stays in the metadata).
 * @param {string|null|undefined} iso @returns {string}  "" for a missing or invalid time.
 */
export function zeitText(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const z = (/** @type {number} */ n) => String(n).padStart(2, "0");
  return `${z(d.getDate())}.${z(d.getMonth() + 1)}.${d.getFullYear()} ${z(d.getHours())}:${z(d.getMinutes())}`;
}

/**
 * Value of the title block field "Modellstand": "26.10.2026 14:03 · 7 erfasste Änderungsschritte · Kennung 3f2a9c01".
 * The number counts the steps of the change tools only (106-03/106-10), not ordinary drawing by hand in the studio - hence
 * "erfasste Änderungsschritte"; the Kennung is the real change indicator.
 * @param {ModellStand|null|undefined} stand @param {(s: string) => string} [t]  Translator (default German).
 * @returns {string}
 */
export function modellstandText(stand, t = (s) => s) {
  if (!stand || !stand.ermittelt) return `${t("nicht ermittelt")}${stand?.grund ? ` (${grundText(stand, t)})` : ""}`;
  const zeit = stand.zeit ? zeitText(stand.zeit) : t("kein gespeichertes Modell");
  const n = stand.aenderungen === 1 ? t("1 erfasster Änderungsschritt") : t("{n} erfasste Änderungsschritte").replace("{n}", String(stand.aenderungen));
  return `${zeit} · ${n} · ${t("Kennung")} ${stand.kennung.slice(0, 8) || "—"}`;
}

/**
 * The lines of the note on the sheet / in the view, or null when no note is needed.
 * @param {ModellStand|null|undefined} stand
 * @param {(s: string) => string} [t]  Translator (default German).
 * @param {{markiert?: number}} [opt]  markiert: how many affected elements are marked on THIS sheet (the rest is hull, another storey,
 *   or hidden by the lens) - said in words so a missing mark is not read as "not affected".
 * @returns {{titel: string, zeilen: string[], zeichen: string, form: "gestrichelt"}|null}
 */
export function vermerkZeilen(stand, t = (s) => s, opt = {}) {
  if (!vermerkNoetig(stand)) return null;
  if (!stand || !stand.ermittelt) {
    return { titel: t(VERMERK_UNBEKANNT_TITEL), zeichen: VERMERK_DRUCK.zeichen, form: "gestrichelt", zeilen: [
      t("Ungeprüfte KI-Änderungen sind nicht ausgeschlossen."),
      ...(stand?.grund ? [`${t("Grund")}: ${grundText(stand, t)}`] : []),
      t("Erst nach Prüfung in der Modellfreigabe ohne Vermerk ausgeben."),
    ] };
  }
  const herkunft = herkunftText({ herkunft: stand.herkunft_quellen[0] || "", herkunft_quellen: stand.herkunft_quellen }, t);
  const zeilen = [
    `${stand.ungeprueft === 1 ? t("1 Schritt") : t("{n} Schritte").replace("{n}", String(stand.ungeprueft))} · ${t("Herkunft")}: ${herkunft || "—"}`,
    `${t("Betroffen")}: ${stand.betroffen.join(", ") || "—"}`,
  ];
  if (opt.markiert != null) {
    zeilen.push(t("Markiert: gestrichelter Rahmen mit „?“ ({m} von {n} Bauteilen auf diesem Blatt)")
      .replace("{m}", String(opt.markiert)).replace("{n}", String(stand.guids.length)));
  }
  zeilen.push(t("Der Vermerk entfällt erst nach Freigabe in der Modellfreigabe."));
  return { titel: t(VERMERK_TITEL), zeichen: VERMERK_DRUCK.zeichen, form: "gestrichelt", zeilen };
}

/**
 * Machine-readable line of the state (PDF keywords, DXF comment): ASCII only, no names, no GUIDs.
 * "BIT-ATELIER-MODELLSTAND v1 ermittelt=1 kennung=… zeit=… aenderungen=7 ungeprueft=2 projekt=…" (projekt: projektKennung,
 * added in the 106-11 review; a line without it is still read).
 * @param {ModellStand|null|undefined} stand @returns {string}
 */
export function modellstandMetadaten(stand) {
  const s = stand || modellStandUnbekannt("");
  return [MODELLSTAND_KENNUNG, "v1", `ermittelt=${s.ermittelt ? 1 : 0}`, `kennung=${s.kennung || "-"}`, `zeit=${s.zeit || "-"}`,
    `aenderungen=${Number(s.aenderungen) || 0}`, `ungeprueft=${Number(s.ungeprueft) || 0}`, `projekt=${s.projekt || "-"}`].join(" ");
}

/**
 * @typedef {{ermittelt: boolean, kennung: string, zeit: string|null, aenderungen: number, ungeprueft: number, projekt?: string}} PlanModellstand
 *   What a plan record keeps (Plan.modellstand, additive field): the state the sheet was printed with; projekt "" = not bound
 *   (a sheet printed before the binding).
 */

/**
 * Reads the state line back (from PDF keywords, a DXF comment or any text that contains it).
 * @param {string|ReadonlyArray<string>|null|undefined} text @returns {PlanModellstand|null}  null when there is no state line.
 */
export function modellstandLesen(text) {
  const s = Array.isArray(text) ? text.join(" ") : String(text ?? "");
  const i = s.indexOf(MODELLSTAND_KENNUNG);
  if (i < 0) return null;
  const teil = s.slice(i + MODELLSTAND_KENNUNG.length).trim().split(/\s+/);
  if (teil[0] !== "v1") return null;
  /** @type {Record<string, string>} */
  const w = {};
  for (const p of teil.slice(1)) {
    const m = /^([a-z]+)=(.*)$/.exec(p);
    if (!m) break;
    w[m[1]] = m[2];
  }
  const zahl = (/** @type {string|undefined} */ v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return {
    ermittelt: w.ermittelt === "1",
    kennung: w.kennung && w.kennung !== "-" ? w.kennung : "",
    zeit: w.zeit && w.zeit !== "-" ? w.zeit : null,
    aenderungen: zahl(w.aenderungen),
    ungeprueft: zahl(w.ungeprueft),
    projekt: w.projekt && w.projekt !== "-" ? w.projekt : "",
  };
}

/** The part of a state a plan record keeps. @param {ModellStand} stand @returns {PlanModellstand} */
export function planModellstand(stand) {
  return { ermittelt: !!stand.ermittelt, kennung: stand.kennung, zeit: stand.zeit, aenderungen: stand.aenderungen, ungeprueft: stand.ungeprueft,
    projekt: stand.projekt || "" };
}

/**
 * @typedef {{status: "ohne"|"unbekannt"|"aktuell"|"veraltet", vermerk: "keiner"|"offen"|"ueberholt"|"unbekannt",
 *   hinweise: Array<{code: string, stufe: "warn"|"info", text: string}>}} PlanVergleich
 */

/**
 * Compares the state a plan was printed with against the current state (plan list, Werkplanung › Pläne).
 *  - status "veraltet": the drawn content changed since the sheet was printed (fingerprint differs) - print again,
 *  - vermerk "offen": the sheet says "enthält ungeprüfte KI-Änderungen" and they are still unreleased,
 *  - vermerk "ueberholt": the sheet carries the note but the changes were released meanwhile - print again without it.
 * Warn, not fail: the list cannot stop anybody from using a paper; it says what is wrong, the person decides.
 * @param {PlanModellstand|null|undefined} plan  Plan.modellstand (null = the plan has none, e.g. a PDF from elsewhere).
 * @param {ModellStand|null|undefined} aktuell  Current state (modellStand / modellStandUnbekannt).
 * @returns {PlanVergleich}  hinweise: i18n keys (German).
 */
export function planStandVergleich(plan, aktuell) {
  /** @type {PlanVergleich["hinweise"]} */
  const h = [];
  if (!plan) return { status: "ohne", vermerk: "keiner", hinweise: [{ code: "ohne_modellstand", stufe: "info", text: "Kein Modellstand am Plan — PDF aus dem BIM-Studio ablegen" }] };
  if (!plan.ermittelt) {
    h.push({ code: "beim_ausgeben_unbekannt", stufe: "warn", text: "Modellstand beim Ausgeben nicht ermittelt — Plan neu ausgeben" });
    return { status: "unbekannt", vermerk: "unbekannt", hinweise: h };
  }
  if (!aktuell || !aktuell.ermittelt) {
    h.push({ code: "aktuell_unbekannt", stufe: "warn", text: "Aktueller Modellstand nicht ermittelt — Vergleich nicht möglich" });
    return { status: "unbekannt", vermerk: plan.ungeprueft > 0 ? "offen" : "keiner", hinweise: h };
  }
  if (plan.projekt && aktuell.projekt && plan.projekt !== aktuell.projekt) {
    h.push({ code: "anderes_projekt", stufe: "warn", text: "Blatt aus einem anderen Projekt — Modellstand nicht vergleichbar" });
    return { status: "unbekannt", vermerk: plan.ungeprueft > 0 ? "offen" : "keiner", hinweise: h };
  }
  const veraltet = plan.kennung !== aktuell.kennung;
  if (veraltet) h.push({ code: "veraltet", stufe: "warn", text: "Modell seit der Ausgabe geändert — Plan veraltet, neu ausgeben" });
  /** @type {PlanVergleich["vermerk"]} */
  let vermerk = "keiner";
  if (plan.ungeprueft > 0) {
    vermerk = aktuell.ungeprueft > 0 ? "offen" : "ueberholt";
    h.push(vermerk === "offen"
      ? { code: "vermerk_offen", stufe: "warn", text: "Blatt trägt den Vermerk „enthält ungeprüfte KI-Änderungen“ — erst nach Freigabe gültig" }
      : { code: "vermerk_ueberholt", stufe: "info", text: "KI-Änderungen inzwischen freigegeben — Plan ohne Vermerk neu ausgeben" });
  } else if (aktuell.ungeprueft > 0) {
    h.push({ code: "neu_ungeprueft", stufe: "warn", text: "Im Modell stehen jetzt ungeprüfte KI-Änderungen" });
  }
  return { status: veraltet ? "veraltet" : "aktuell", vermerk, hinweise: h };
}

/**
 * Outlines of the marked elements in a model (for the plan view on screen; the PDF/DXF marks come from planGrafik of the
 * designer, which marks only what it draws). An opening (window, door, opening) is marked by the outline of its host wall (the
 * plan draws the opening in that wall); a hull wall by its own outline when the generated hull walls are handed in
 * (`huellWaende`, GUID like huellwandGuid: source "huelle", id "<level>:<edge>"). Workshop components and IFC elements have no
 * drawn element and are not returned - the note names them and says "m von n markiert".
 * @param {any} modell  Model record / studio state (customWalls …). @param {ReadonlyArray<string>} guids
 * @param {{projektId?: string|number|null, huellWaende?: ReadonlyArray<any>|null}} [opt]  Project of the derived GUIDs; the
 *   generated hull walls of the shown model (createBuildingModel walls: a, b, thickness, level, edge).
 * @returns {Array<{guid: string, kurzname: string, level: number, punkte: Array<{x: number, z: number}>}>}  Points in m (plan x, z).
 */
export function kiMarkierungen(modell, guids, opt = {}) {
  /** @type {Array<{guid: string, kurzname: string, level: number, punkte: Array<{x: number, z: number}>}>} */
  const aus = [];
  const pid = opt.projektId ?? null;
  const huelle = Array.isArray(opt.huellWaende) ? opt.huellWaende : [];
  for (const g of guids || []) {
    const fund = bauteilImModell(modell, g, { projektId: pid });
    if (fund?.art === "oeffnung") {
      const o = fund.element;
      const wirt = fund.arrayName === "envOpenings"
        ? huelle.find((w) => w.level === o.level && w.edge === o.edge)
        : (Array.isArray(modell?.customWalls) ? modell.customWalls : []).find((w) => w._idx === o.wallIdx);
      const punkte = wirt ? umrissVon(wirt) : [];
      if (punkte.length) aus.push({ guid: g, kurzname: fund.kurzname, level: Number(wirt.level) || 0, punkte });
      continue;
    }
    if (fund) {
      const punkte = umrissVon(fund.element);
      if (punkte.length) aus.push({ guid: g, kurzname: fund.kurzname, level: Number(fund.element.level) || 0, punkte });
      continue;
    }
    const hw = huelle.find((w) => bauteilGuid(pid, "huelle", { id: `${w.level}:${w.edge}` }) === g);
    if (hw) aus.push({ guid: g, kurzname: `Außenwand ${hw.level}:${hw.edge}`, level: Number(hw.level) || 0, punkte: umrissVon(hw) });
  }
  return aus;
}

/**
 * Axis-aligned rectangle around points, grown by a margin - the form of a mark (drawn OUTSIDE the element so it never sits on
 * the poché).
 * @param {ReadonlyArray<{x: number, z: number}>} punkte  m. @param {number} rand_m  Margin in m.
 * @returns {Array<{x: number, z: number}>}  Four corners in m; empty for no points.
 */
export function markenRahmen(punkte, rand_m) {
  if (!punkte?.length) return [];
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of punkte) {
    x0 = Math.min(x0, p.x); z0 = Math.min(z0, p.z); x1 = Math.max(x1, p.x); z1 = Math.max(z1, p.z);
  }
  return [{ x: x0 - rand_m, z: z0 - rand_m }, { x: x1 + rand_m, z: z0 - rand_m }, { x: x1 + rand_m, z: z1 + rand_m }, { x: x0 - rand_m, z: z1 + rand_m }];
}
