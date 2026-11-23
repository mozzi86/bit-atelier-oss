// Zentraler Projekt-Sync der gemeinsamen Quelle (useBuildingProgram) mit der
// persistierten BimModel-Entität: Beim Projektwechsel wird das Bauprogramm
// (Footprint/Geschosse/Höhe/Einheit) + die Räume in den Store geladen —
// unabhängig davon, welcher Tab gerade offen ist.
//
// EIN Schreibpfad (KD-17): Vorher schrieben zwei unabhängige Debounce-Effekte
// denselben Datensatz — dieser Hook (1.500 ms) und BitBimStudio (1.200 ms).
// Der letzte Schreiber gewann (nicht deterministisch), und ohne vorhandenen
// Datensatz konnte jeder Schreiber einen eigenen anlegen. Jetzt ist dieses Modul
// die Autorität für den Datensatz: loadBimModel() löst ihn genau einmal je
// Projekt auf, saveBimModel() ist der einzige Schreibpfad und serialisiert alle
// Aufrufe. Der Hook schreibt ausschließlich die Programmfelder, BitBimStudio
// ausschließlich seine Elementfelder — die Feldmengen sind disjunkt, der Server
// merged flach, also überschreibt keiner die Arbeit des anderen.
// Verschoben nach @core am 26.08.2026: `saveBimModel` ist der EINZIGE Schreibpfad
// für BimModel (KD-17). Seit der IFC-Viewer (@ifc) den Grundriss aus der Geometrie
// ableitet, braucht auch er diesen Pfad — und @ifc darf @designer nicht importieren.
// Ihn dort zu umgehen und direkt über bitApi zu schreiben, hätte eine zweite
// Schreibstelle geschaffen: genau die zweite Wahrheit, die das Prinzip der einzigen
// Quelle verhindern soll.
import { useEffect, useRef, useState } from "react";
import { bitApi } from "@core/api/bitApi";
import { buildingProgram, useBuildingProgram } from "@core/lib/useBuildingProgram";
import { zonenNachLoad } from "@core/lib/zonenNachLoad";
import { untergeschosseAnzahl } from "@core/lib/bauteil/ebenen.js";
// 87-07: layer schema versions live at the ONE read/write path, so every hook
// (useFachlayer, useSketchLayer, BcfIssues, IdsEditor, LieferpaketKarte) gets
// migrated blobs on load and stamped blobs (v, updatedAt) on save without edits.
import { LAYER_VERSION, migrateLayer, stempelFuerSave } from "@core/lib/fachlayerSchema";
// 106-09: changes of other devices arrive through the change stream; a strict save refuses to overwrite them (105-20 part).
import { feldDreiWege, gleichWert } from "@core/lib/abgleich/dreiWege";
import { abgleichStand, abgleichTesthaken } from "@core/lib/abgleich/abgleichStand";
import { stromAbonnieren } from "@core/lib/abgleich/stromClient";
import { feldName } from "@core/lib/abgleich/modellAbgleich";

/**
 * 87-07: migrate every registered layer field of a loaded record to its current
 * schema version (see fachlayerSchema.js). Returns the same object when nothing changed.
 * @param {any} m BimModel record or null
 * @returns {any}
 */
export function migriereLayerDesDatensatzes(m) {
  if (!m || typeof m !== "object") return m;
  let out = m;
  for (const feld of Object.keys(LAYER_VERSION)) {
    if (m[feld] == null) continue;
    const r = migrateLayer(feld, m[feld]);
    if (r.migriert) out = out === m ? { ...m, [feld]: r.wert } : { ...out, [feld]: r.wert };
  }
  return out;
}

// Datensatz-Autorität je Projekt: { projectId, id, load } (load = laufendes/
// erledigtes Laden als Promise, damit mehrere Leser EINEN Request teilen).
const record = { projectId: null, id: null, load: null };
// Project of the last load THIS hook completed — tells a re-mount in the same
// project (keep session zones, I-02) from a project switch (drop them). Module
// level on purpose: the hook's refs die with the Komplex-Designer route, and
// record.projectId is no substitute — child hooks (usePlanModel, useFachlayer)
// call loadBimModel first and have already moved it to the new project.
let letztesSyncProjekt = null;
// Serialisierung aller Schreibvorgänge — nie zwei Requests gleichzeitig.
let chain = Promise.resolve();

// 115-05a (A-3): the last stored base per project the page knew, for a flush of a project that is no longer open
// (bimModelNachschreiben). The cache above holds ONE project; a flush of the project just left must not move it back (the
// change stream of the new project would then be ignored, record.projectId check of fremdenStandUebernehmen). At most two
// entries: the open project and the one just left.
/** @type {Map<string, Promise<any>>} */
const letzteBasisJeProjekt = new Map();

/**
 * Sets the cached record of the open project and mirrors it into letzteBasisJeProjekt (every assignment of record.load goes
 * through here). A project switch (loadBimModel) keeps only the new project and the one just left.
 * @param {string} projectId project the record belongs to
 * @param {Promise<any>|null} load the record (as a shared promise) or null (read it again next time)
 * @param {string|null} [verlassen] the project that was open before (only on a project switch)
 */
function ladenSetzen(projectId, load, verlassen = null) {
  record.load = load;
  if (load) letzteBasisJeProjekt.set(projectId, load);
  else letzteBasisJeProjekt.delete(projectId);
  if (verlassen !== null) {
    for (const pid of [...letzteBasisJeProjekt.keys()]) if (pid !== projectId && pid !== verlassen) letzteBasisJeProjekt.delete(pid);
  }
}

// 89-07 (BW-09): listeners of saved patches. Readers that hold a copy of the record
// (usePlanModel) did not see element changes of BitBimStudio in the same session — the
// cache was patched, but nobody re-read it. Now every successful save notifies them.
/** @type {Set<(projectId: string, patch: Record<string, any>, meta?: {fremd?: true, entwurf?: true, vorher?: Record<string, any>, geraet?: any}) => void>} */
const aenderungsHoerer = new Set();

/**
 * Subscribe to saved BimModel patches (after the write succeeded, in save order).
 * 106-09: also called for a change ANOTHER device saved (third argument `{fremd: true, vorher, geraet}`), so readers that
 * hold a copy (usePlanModel, the workshop zones) follow it live; old listeners simply ignore the third argument.
 * 115-05c: also called for a DRAFT value of the page (meta `{entwurf: true}`): readers inside the designer show the draft (the
 *   reader overlay of 115-05-PLAN §6.8); a listener that acts on stored changes only ignores it.
 * @param {(projectId: string, patch: Record<string, any>, meta?: {fremd?: true, entwurf?: true, vorher?: Record<string, any>, geraet?: any}) => void} fn
 *   called with the project and the written fields
 * @returns {() => void} unsubscribe
 */
export function aufBimModelAenderung(fn) {
  aenderungsHoerer.add(fn);
  return () => { aenderungsHoerer.delete(fn); };
}

/**
 * 115-05c (§6.8 reader overlay): tells the readers of the designer a draft value of the page (they merge it like a saved patch).
 * Called by the draft module on every report of the building model's draft.
 * @param {string} projectId @param {Record<string, any>} werte the reported fields (draft value, or the stored one again)
 */
export function entwurfAnLeser(projectId, werte) {
  for (const fn of aenderungsHoerer) {
    try { fn(projectId, werte, { entwurf: true }); } catch { /* a reader's error must not stop the others */ }
  }
}

/**
 * 115-05c (§6.8 reader overlay): the stored record with the page's unsaved draft fields on top - what the readers inside the designer
 * show (plan, roof, workshop zones). Readers on other routes use loadBimModel (the stored state only).
 * @param {string} projectId @returns {Promise<any>}
 */
export async function bimModelLesen(projectId) {
  const m = await loadBimModel(projectId);
  if (designerOffenFuer !== projectId) return m; // other routes read the stored state only (the draft belongs to the designer)
  const e = entwurfMod?.entwurfVon(projectId);
  const auf = e?.aenderungen?.bim || {};
  return Object.keys(auf).length ? { ...(m || {}), ...auf } : m;
}

// ---- 106-09: sync between devices -----------------------------------------------------------------------------
// The cache above is the BASE: the last stored version this page knows (its updated_date goes with every strict save).
// A change of another device replaces the base (fremdenStandUebernehmen); the holders of local state - the program
// fields in the hook below, the element fields in the BIM studio - compare it three ways (base / mine / foreign) and
// either take it over or report a conflict. A field with an open conflict is held back from every save until the
// person decides (feldSperren), so nothing is overwritten silently in either direction.
//
// Review 106-09:
// - A lock lives exactly as long as its conflict card: this module listens to abgleichStand and releases every lock
//   whose conflict is gone (decided, cleared with a viewer, dropped on a project switch). No field is held back unseen.
// - The newest value a holder tried to save while its field was locked is kept (zurueckgehalten): "keep mine" writes
//   THAT, not the value at the moment of the conflict, and the studio shows "waiting for a decision" instead of "saved".
// - A field no holder claims (layers of editors without live merge, the studio's attribute layer while it differs) keeps
//   its OLD base (vorbehalt) when another device changes it: the next save of that field is compared three ways
//   against it - unchanged stale value: not written (the other device's change stays); both changed: a conflict card.
//   Before, the base moved on silently and the stale holder overwrote the other device without any 409.

/**
 * @typedef {{patch: Record<string, any>, vorher: Record<string, any>, geraet: {id?: string, name: string, unbekannt?: boolean}|null,
 *   zeit: string|null, entscheidung?: boolean, basis?: Record<string, any>|null, stand?: {id: any, updated_date: any}|null}} FremderStand
 *   patch = the fields another device changed (new values); vorher = the same fields in the base before; entscheidung =
 *   true when the person took the other device's version in a conflict card (no note "arrived", the holder just follows);
 *   115-05a (additive): basis = the FULL stored record this page knew before (null when it had none; absent for a decision
 *   of a card) - only an element missing there is a real local new one (neueKollisionenUmnummern); stand = id and
 *   updated_date of the foreign record (standEntscheiden compares them with the base)
 */

/** @type {Set<(projectId: string, f: FremderStand) => (string[]|void)>} */
const abgleicher = new Set();

/**
 * 106-09: registers a holder of local state that merges foreign changes itself (three ways, conflicts to abgleichStand).
 * It returns the fields it took care of; a field nobody claims and that this page changed as well becomes a field
 * conflict of this module (only possible in the save race, see saveBimModel).
 * @param {(projectId: string, f: FremderStand) => (string[]|void)} fn
 * @returns {() => void} unregister
 */
export function aufFremdenStand(fn) {
  abgleicher.add(fn);
  return () => { abgleicher.delete(fn); };
}

/** Fields held back from saving per project while a conflict is open. @type {Map<string, Set<string>>} */
const gesperrt = new Map();

/** Newest value a holder tried to save per locked field (project → field → value). @type {Map<string, Map<string, any>>} */
const zurueckgehaltenWerte = new Map();

/**
 * Old base per field another device changed and no holder took over (project → field → {vorher, geraet}).
 * @type {Map<string, Map<string, {vorher: any, geraet: any}>>}
 */
const vorbehalt = new Map();

/** @param {string} projectId @param {string} feld */
const vorbehaltWeg = (projectId, feld) => { vorbehalt.get(projectId)?.delete(feld); };

// a lock lives as long as its conflict card (see the review note above)
abgleichStand.abonnieren(() => {
  if (!gesperrt.size) return;
  const offen = abgleichStand.stand().konflikte;
  for (const [pid, felder] of [...gesperrt]) {
    for (const feld of [...felder]) {
      if (!offen.some((k) => k.projektId === pid && k.feld === feld)) feldFreigeben(pid, feld);
    }
  }
});

/**
 * 106-09: holds a field back from every save of the project until feldFreigeben (open conflict).
 * @param {string} projectId @param {string} feld
 */
export function feldSperren(projectId, feld) {
  const m = gesperrt.get(projectId) || new Set();
  m.add(feld);
  gesperrt.set(projectId, m);
}

/** 106-09: releases a field held back by feldSperren (and forgets the value held back). @param {string} projectId @param {string} feld */
export function feldFreigeben(projectId, feld) {
  gesperrt.get(projectId)?.delete(feld);
  if (!gesperrt.get(projectId)?.size) gesperrt.delete(projectId);
  zurueckgehaltenWerte.get(projectId)?.delete(feld);
}

/**
 * Review 106-09: the newest value a holder tried to save while the field was locked, or `fallback` when none.
 * @param {string} projectId @param {string} feld @param {any} [fallback] @returns {any}
 */
export function zurueckgehaltenerWert(projectId, feld, fallback = undefined) {
  const m = zurueckgehaltenWerte.get(projectId);
  return m && m.has(feld) ? m.get(feld) : fallback;
}

/**
 * Review 106-09: which of these fields are held back right now (the studio shows "waiting for a decision" then).
 * @param {string|null|undefined} projectId @param {ReadonlyArray<string>} felder @returns {string[]}
 */
export function felderZurueckgehalten(projectId, felder) {
  if (!projectId) return [];
  return felder.filter((f) => feldGesperrt(projectId, f));
}

/** 106-09: whether a field is held back. @param {string} projectId @param {string} feld @returns {boolean} */
export function feldGesperrt(projectId, feld) {
  return gesperrt.get(projectId)?.has(feld) === true;
}

const VERWALTUNG = new Set(["id", "created_date", "updated_date", "project_id"]);

/**
 * Takes a foreign version into the base and tells the holders. Runs inside the save chain (never beside a write).
 * @param {string} projectId @param {any} roh the stored record as another device left it
 * @param {{geraet?: any, zeit?: string|null}} meta
 * @returns {Promise<{felder: string[], beansprucht: Set<string>, basis: any}>} changed fields, the ones a holder merged, the old base
 */
async function fremdEinarbeiten(projectId, roh, meta) {
  if (record.projectId !== projectId || !record.load || !roh) return { felder: [], beansprucht: new Set(), basis: null };
  const basis = await record.load.catch(() => null);
  const fremd = migriereLayerDesDatensatzes(roh);
  const felder = Object.keys(fremd).filter((k) => !VERWALTUNG.has(k) && !gleichWert(fremd[k], basis?.[k]));
  ladenSetzen(projectId, Promise.resolve({ ...(basis || {}), ...fremd }));
  if (!record.id && fremd.id) record.id = fremd.id;
  if (!felder.length) return { felder, beansprucht: new Set(), basis };
  /** @type {FremderStand} */
  const f = {
    patch: Object.fromEntries(felder.map((k) => [k, fremd[k]])),
    vorher: Object.fromEntries(felder.map((k) => [k, basis?.[k]])),
    geraet: meta.geraet ?? null, zeit: meta.zeit ?? null,
    basis: basis ?? null, stand: { id: fremd.id ?? basis?.id ?? null, updated_date: fremd.updated_date ?? null },
  };
  const beansprucht = halterBenachrichtigen(projectId, f);
  // a field no holder took over keeps its old base until a save of it is compared against it (review note above)
  const vb = vorbehalt.get(projectId) || new Map();
  for (const k of felder) {
    if (beansprucht.has(k)) vb.delete(k);
    else if (!vb.has(k)) vb.set(k, { vorher: basis?.[k], geraet: f.geraet });
  }
  if (vb.size) vorbehalt.set(projectId, vb);
  return { felder, beansprucht, basis };
}

/**
 * Tells the holders (aufFremdenStand) and the readers (aufBimModelAenderung) about foreign values.
 * @param {string} projectId @param {FremderStand} f @returns {Set<string>} the fields a holder took care of
 */
function halterBenachrichtigen(projectId, f) {
  /** @type {Set<string>} */
  const beansprucht = new Set();
  for (const fn of abgleicher) {
    try { for (const k of fn(projectId, f) || []) beansprucht.add(k); } catch (err) { console.error(`[abgleich] holder failed: ${/** @type {any} */ (err)?.message || err}`); }
  }
  for (const fn of aenderungsHoerer) {
    try { fn(projectId, f.patch, { fremd: true, vorher: f.vorher, geraet: f.geraet }); } catch { /* a reader's error must not stop the others */ }
  }
  return beansprucht;
}

/**
 * 106-09: a change another device saved (stream event) is taken into this page. Serialised with the saves. An event not
 * newer than the base (e.g. already merged through a refused save) changes nothing.
 * 115-05b (A-5): `meta.auchAelter` (the focus check) takes every OTHER state of the same record - an equal id and updated_date is
 * the only one left out: a bulk write and the file import are not streamed, and an import keeps an older updated_date.
 * Nothing is taken while the model of the project is replaced (bimModelErsetzt).
 * @param {string} projectId
 * @param {any} datensatz stored record (as GET /entities/BimModel/:id returns it)
 * @param {{geraet?: any, zeit?: string|null, auchAelter?: boolean}} [meta] who wrote it (null = another window on this computer)
 * @returns {Promise<string[]>} the fields that changed
 */
export function fremdenStandUebernehmen(projectId, datensatz, meta = {}) {
  const run = () => fremdenStandLauf(projectId, datensatz, meta);
  const result = chain.then(run, run);
  chain = result.then(() => undefined, () => undefined);
  return result;
}

/**
 * The body of fremdenStandUebernehmen, run inside the save chain (also by bimModelStandPruefen).
 * @param {string} projectId @param {any} datensatz @param {{geraet?: any, zeit?: string|null, auchAelter?: boolean}} meta
 * @returns {Promise<string[]>}
 */
async function fremdenStandLauf(projectId, datensatz, meta) {
  if (record.projectId !== projectId || !record.load || !datensatz || ersetzt.has(projectId)) return [];
  const basis = await record.load.catch(() => null);
  if (meta.auchAelter) {
    if (basis && String(basis.id ?? "") === String(datensatz.id ?? "") && String(basis.updated_date ?? "") === String(datensatz.updated_date ?? "")) return [];
  } else if (basis?.updated_date && datensatz.updated_date && String(datensatz.updated_date) <= String(basis.updated_date)) return [];
  return (await fremdEinarbeiten(projectId, datensatz, meta)).felder;
}

// 115-05b (A-5): projects whose BimModel was replaced by another record (other id: import, seed, restore) while this page held the
// old one. Nothing is merged and every save of such a project refuses (MODELL_ERSETZT_TEXT) until the page loads the project again.
/** @type {Set<string>} */
const ersetzt = new Set();

/** 115-05b (A-5): refusal of a save while the model of the project is replaced (banner of the focus check: reload). */
export const MODELL_ERSETZT_TEXT = "Modell wurde ersetzt — neu laden";

/** @param {string} projectId @returns {Error & {code: string}} the refusal of a save of a replaced model */
function ersetztFehler(projectId) {
  void projectId;
  const e = /** @type {Error & {code: string}} */ (new Error(MODELL_ERSETZT_TEXT));
  e.code = "modell_ersetzt";
  return e;
}

/**
 * 115-05b (A-5): whether the focus check found the BimModel of this project replaced by another record (saves rest until reload).
 * @param {string|null|undefined} projectId @returns {boolean}
 */
export function bimModelErsetzt(projectId) {
  return Boolean(projectId) && ersetzt.has(/** @type {string} */ (projectId));
}

/**
 * 115-05b (A-5): the focus check of the BimModel (standWaechter.js). Inside the save chain - a save on its way is answered first, so
 * its own new updated_date is never mistaken for another state - the stored record is read once and compared with the base on
 * INEQUALITY of id or updated_date:
 *   - equal → "aktuell";
 *   - the same record (or none known before) in another state → taken in through the holders like a stream event, older ones
 *     included (fremdenStandLauf {auchAelter}) → "uebernommen";
 *   - another record id, or the known record is gone → "ersetzt": nothing merged, saves of the project refuse until a new load.
 * Review 115-05b part 2 (finding 1): `aktiv` is read after the GET - a check whose page was left (unmount, project switch) while it
 * read merges nothing and moves no base ("ohne"): a flush of the page left, queued behind it, must build on the base it was planned
 * on (the server's 409 and the three-way path decide), never on a stand nobody merged. "ersetzt" is still marked (it moves no base,
 * it only refuses saves).
 * @param {string} projectId the open project
 * @param {{aktiv?: () => boolean}} [o] aktiv = whether the check still belongs to an active page
 * @returns {Promise<"aktuell"|"uebernommen"|"ersetzt"|"ohne">} ohne = the project is not the open one / not loaded / page left
 */
export function bimModelStandPruefen(projectId, { aktiv = () => true } = {}) {
  const run = async () => {
    if (!projectId || record.projectId !== projectId || !record.load) return /** @type {const} */ ("ohne");
    if (ersetzt.has(projectId)) return /** @type {const} */ ("ersetzt");
    const basis = await record.load.catch(() => null);
    const server = migriereLayerDesDatensatzes(((await bitApi.entities.BimModel.filter({ project_id: projectId })) || [])[0] || null);
    if (record.projectId !== projectId) return /** @type {const} */ ("ohne");
    if (!server) {
      if (!basis?.id) return /** @type {const} */ ("aktuell");
      ersetzt.add(projectId);
      return /** @type {const} */ ("ersetzt");
    }
    if (basis?.id && String(basis.id) !== String(server.id)) {
      ersetzt.add(projectId);
      return /** @type {const} */ ("ersetzt");
    }
    if (basis && String(basis.updated_date ?? "") === String(server.updated_date ?? "")) return /** @type {const} */ ("aktuell");
    if (!aktiv()) return /** @type {const} */ ("ohne");
    await fremdenStandLauf(projectId, server, { geraet: UNBEKANNT, zeit: server.updated_date ?? null, auchAelter: true });
    return /** @type {const} */ ("uebernommen");
  };
  const result = chain.then(run, run);
  chain = result.then(() => undefined, () => undefined);
  return result;
}

/**
 * 106-09: short text of a value for a conflict line (numbers with decimal comma, lists as count, text cut at 80 characters).
 * @param {any} v @returns {string}
 */
export function wertKurz(v) {
  if (v === undefined || v === null || v === "") return "—";
  if (typeof v === "number") return String(Math.round(v * 1000) / 1000).replace(".", ",");
  if (Array.isArray(v)) return `${v.length} ×`;
  if (typeof v === "object") return JSON.stringify(v).slice(0, 80);
  return String(v).slice(0, 80);
}

/**
 * 106-10: drops the cached record of a project, so the next loadBimModel reads the stored one again. For a page without a holder
 * of the model (the review workplace) that is about to write: it must build on the stored version, not on one cached before another
 * tab or device saved. Serialised with the saves (never beside a write). A page that holds the model (the studio) never needs it.
 * @param {string} projectId @returns {Promise<void>}
 */
export function bimModelNeuLesen(projectId) {
  const run = async () => {
    if (record.projectId !== projectId) return;
    ladenSetzen(projectId, null);
    record.id = null;
    vorbehalt.delete(projectId);
  };
  const result = chain.then(run, run);
  chain = result.then(() => undefined, () => undefined);
  return result;
}

/** Datensatz des Projekts laden (geteilter Request; Ergebnis wird gecacht). */
export function loadBimModel(projectId) {
  if (!projectId) return Promise.resolve(null);
  if (record.projectId !== projectId || !record.load) {
    const verlassen = record.projectId !== projectId ? record.projectId : null;
    record.projectId = projectId;
    record.id = null;
    vorbehalt.delete(projectId); // a fresh load: every holder reads the stored version again
    ersetzt.delete(projectId); // 115-05b (A-5): the fresh load is the new record - saves may go out again
    ladenSetzen(projectId, bitApi.entities.BimModel.filter({ project_id: projectId })
      .then((rows) => {
        const m = migriereLayerDesDatensatzes((rows || [])[0] || null);
        if (record.projectId === projectId) record.id = m?.id || null;
        return m;
      })
      .catch((err) => {
        // Fehlgeschlagenes Laden nicht cachen (offline -> später erneut versuchen).
        if (record.projectId === projectId) ladenSetzen(projectId, null);
        else letzteBasisJeProjekt.delete(projectId);
        throw err;
      }), verlassen);
  }
  return record.load;
}

/** Review 106-10: refusal of a strict save (`{streng: true}`) - placeholder {felder} = the fields in words. */
export const NICHT_GESCHRIEBEN_TEXT = "Modell nicht geschrieben — {felder} gleichzeitig an anderer Stelle geändert oder mit offenem Konflikt; bitte neu laden";

/**
 * Error of a strict save that wrote nothing (review 106-10).
 * @param {string} projectId @param {string[]} felder fields that could not be written @returns {Error & {code: string, felder: string[]}}
 */
function nichtGeschrieben(projectId, felder) {
  void projectId;
  const e = /** @type {Error & {code: string, felder: string[]}} */ (new Error(NICHT_GESCHRIEBEN_TEXT.replace("{felder}", felder.map(feldName).join(", "))));
  e.code = "nicht_geschrieben";
  e.felder = felder;
  return e;
}

/**
 * Einziger Schreibpfad auf BimModel: partielles Update (der Server merged flach),
 * serialisiert. Ohne bekannten Datensatz wird erst geladen — sonst würden zwei
 * Aufrufe zwei Datensätze anlegen. Schlägt das Laden fehl, wird NICHT blind
 * angelegt, sondern der Fehler weitergegeben.
 *
 * Review 106-10: `opt.streng` = all or nothing, for a caller without a holder of the model (the review workplace's reversal):
 * a field held back by an open conflict, a field another device changed that this page has not taken over, or a 409 on a field
 * the other device set differently is NOT silently dropped (no conflict card either) - the save rejects with
 * NICHT_GESCHRIEBEN_TEXT (`code: "nicht_geschrieben"`, `felder`) before anything of this patch is written.
 * 115-05b (A-7): `opt.basisStand` = the updated_date of the copy a caller without a holder built its patch on (AVA's
 * classification). A strict save refuses (`nicht_geschrieben`, every field of the patch) when the stored base this page knows is
 * another state (inequality, not "newer") - the copy is stale and its lists would put old elements back. Only strict saves check it.
 * 115-05b (A-5): while the model of the project is replaced (bimModelErsetzt) every save refuses (`code: "modell_ersetzt"`).
 * @param {string} projectId @param {Record<string, any>} patch fields to write
 * @param {{streng?: boolean, basisStand?: string|null}} [opt]
 * @returns {Promise<any>} the stored record (or the base when nothing had to be written)
 */
export function saveBimModel(projectId, patch, opt = {}) {
  const run = () => speichernLauf(projectId, patch, opt);
  const result = chain.then(run, run);
  chain = result.catch(() => { /* Kette läuft weiter, Fehler geht an den Aufrufer */ });
  return result;
}


/**
 * 115-05b (E-1, E-6): the module state the rare paths of the write need (abgleich/bimModelSonderwege.js: a project that is not the
 * open one, a field conflict card) - loaded on first use, the entry chunk is at its size budget.
 * @returns {import("./abgleich/bimModelSonderwege.js").SonderwegKern}
 */
const nichtOffenKern = () => ({ record, letzteBasisJeProjekt, vorbehalt, feldGesperrt, nichtGeschrieben, migriere: migriereLayerDesDatensatzes, ladenSetzen,
  modellKonflikte, zurueckgehaltenerWert, vorbehaltWeg, feldFreigeben, saveBimModel, halterBenachrichtigen, wertKurz, basisStandAnders });
/**
 * Loader of the lazily loaded module (an object, so a unit test can make it slow or fail: konfliktLuecke-11505b.test.js).
 * @type {{laden: () => Promise<typeof import("./abgleich/bimModelSonderwege.js")>}}
 */
export const sonderwegeLader = { laden: () => import("./abgleich/bimModelSonderwege.js") };
/** @returns {Promise<typeof import("./abgleich/bimModelSonderwege.js")>} */
const nichtOffenLaden = () => sonderwegeLader.laden();

/**
 * The body of saveBimModel, run inside the save chain (also by bimModelNachschreiben for the open project).
 * @param {string} projectId @param {Record<string, any>} patch @param {{streng?: boolean, basisStand?: string|null}} opt
 * @returns {Promise<any>} the stored record (or the base when nothing had to be written)
 */
async function speichernLauf(projectId, patch, opt) {
  const streng = opt?.streng === true;
  if (!projectId) return null;
  if (ersetzt.has(projectId)) throw ersetztFehler(projectId);
  // 115-05b (E-6): a save of a project that is no longer the open one never moves the one-project cache back to it (before:
  // loadBimModel(projectId) here - the cache jumped to the left project and the open project's change stream was ignored)
  // (also when the person opened another project while this project was loading)
  if (record.projectId === null || record.projectId === projectId) {
    if (record.projectId !== projectId || (!record.id && !record.load)) await loadBimModel(projectId);
    else if (record.load) await record.load;
  }
  if (record.projectId !== projectId) return (await nichtOffenLaden()).nichtOffenSchreiben(nichtOffenKern(), projectId, patch, opt);
  // 115-05b (E-1): the run is bound to the record it was planned for - id and base fixed here, never read from the cache again (a
  // switch to another project while the PUT is on its way must not redirect the retry to that project's record, or to id null)
  const zielId = record.id;
  const ladenBeimStart = record.load;
  // 87-07: registered layer fields leave with their schema version and a time stamp.
  const data = { project_id: projectId, ...patch };
  for (const feld of Object.keys(data)) if (LAYER_VERSION[feld] !== undefined) data[feld] = stempelFuerSave(feld, data[feld]);
  // 106-09: the base this write builds on. Fields equal to it are not sent (no echo of a change that just arrived from
  // another device, no new updated_date for nothing); fields with an open conflict wait for the person's decision.
  let basis = ladenBeimStart ? await ladenBeimStart.catch(() => null) : null;
  const vb = vorbehalt.get(projectId);
  // 115-05b (A-7): the caller's copy is another state than the base → its whole patch is stale
  if (streng && basisStandAnders(opt, basis)) throw nichtGeschrieben(projectId, Object.keys(patch));
  if (streng) {
    const offen = Object.keys(data).filter((f) => f !== "project_id"
      && (feldGesperrt(projectId, f) || (zielId && basis && vb?.has(f) && !gleichWert(basis[f], data[f]))));
    if (offen.length) throw nichtGeschrieben(projectId, offen);
  }
  for (const feld of Object.keys(data)) {
    if (feld === "project_id") continue;
    if (feldGesperrt(projectId, feld)) {
      // held back until the decision; the newest attempt is what "keep mine" writes
      const m = zurueckgehaltenWerte.get(projectId) || new Map();
      m.set(feld, data[feld]);
      zurueckgehaltenWerte.set(projectId, m);
      // a card of this module shows the newer own value (115-05b: built in the lazily loaded module, loaded with the card)
      if (modellKonflikte.has(`${projectId}|${feld}`)) (await nichtOffenLaden()).konfliktTextNachziehen(nichtOffenKern(), projectId, feld, data[feld]);
      delete data[feld];
    } else if (zielId && basis && gleichWert(basis[feld], data[feld])) {
      delete data[feld];
      vb?.delete(feld); // the holder caught up with the other device
    } else if (zielId && basis && vb?.has(feld)) {
      // another device changed this field and its holder did not take it over: three ways against the old base
      const v = /** @type {{vorher: any, geraet: any}} */ (vb.get(feld));
      const mein = data[feld];
      delete data[feld];
      if (gleichWert(mein, v.vorher)) continue; // the stale value again: the other device's change stays
      await feldKonfliktMelden(projectId, feld, v.vorher, mein, basis[feld], v.geraet);
    }
  }
  if (zielId && Object.keys(data).length <= 1) return basis;
  let ergebnis;
  if (zielId) {
    // 106-09 (105-20): strict write - an outdated base answers 409 with the stored record instead of overwriting it.
    // Then: what only the other device changed comes in, what only this page changed is written again on the new
    // base, and a field both changed goes to its holder (three-way per element) or becomes a conflict of this module.
    // 115-05b (E-1): every attempt goes to zielId on the base of THIS project (the stored record of the 409), never to the
    // record or the base of the project open now.
    for (let versuch = 1; ; versuch += 1) {
      try {
        ergebnis = await bitApi.entities.BimModel.update(zielId, data, { stand: basis?.updated_date ?? null });
        break;
      } catch (err) {
        const e = /** @type {any} */ (err);
        if (e?.status !== 409 || !e?.data?.gespeichert || versuch >= 3) throw err;
        const fremd = e.data.gespeichert;
        // still the open project with the record this run was planned for? (a switch moves the one-project cache)
        if (record.projectId !== projectId || !record.load || (record.id != null && record.id !== zielId)) {
          // the person opened another project meanwhile: no holder of this project is mounted any more and its conflicts were
          // dropped - completed on its own record when the other writer changed nothing of this write, else refused (thrown)
          basis = (await nichtOffenLaden()).fremdOhneHalter(nichtOffenKern(), projectId, basis, fremd, data);
          if (Object.keys(data).length <= 1) return basis;
          continue;
        }
        // the refusal does not say who was faster: another tab or a paired device (never "a window on this computer")
        const r = await fremdEinarbeiten(projectId, fremd, { geraet: UNBEKANNT, zeit: fremd.updated_date ?? null });
        const alt = r.basis;
        // the new base is the stored record of THIS 409 (what fremdEinarbeiten put into the cache), not a read of the cache
        basis = { ...(alt || {}), ...migriereLayerDesDatensatzes(fremd) };
        if (streng) {
          // all or nothing: a field the other device set differently stops the whole write (nothing of the patch went out yet)
          const anders = Object.keys(data).filter((f) => f !== "project_id" && r.felder.includes(f) && !gleichWert(data[f], fremd[f]));
          if (anders.length) throw nichtGeschrieben(projectId, anders);
        }
        for (const feld of Object.keys(data)) {
          if (feld === "project_id" || !r.felder.includes(feld)) continue; // untouched by the other device: stays in the write
          const mein = data[feld];
          delete data[feld];
          if (gleichWert(mein, fremd[feld]) || r.beansprucht.has(feld)) continue; // same result, or its holder merges and saves
          vorbehaltWeg(projectId, feld); // decided by the card below, not by a later save
          await feldKonfliktMelden(projectId, feld, alt?.[feld], mein, fremd[feld], UNBEKANNT);
        }
        if (Object.keys(data).length <= 1) return basis;
      }
    }
  } else {
    ergebnis = await bitApi.entities.BimModel.create(data);
    if (record.projectId === projectId && !record.id) record.id = ergebnis?.id || null;
  }
  // Cache kohärent halten (Phase 34): loadBimModel cached EINEN Datensatz je
  // Projekt — ohne Patch sähen spätere Leser (usePlanModel, useFachlayer,
  // Sketch-Overlay im Grundriss) bis zum Reload den alten Stand.
  // 106-09: plus the new updated_date - the base of the next strict write.
  const neuerStand = ergebnis && typeof ergebnis === "object" && ergebnis.updated_date ? { updated_date: ergebnis.updated_date } : {};
  if (record.projectId === projectId && record.load) {
    const vorher = record.load;
    ladenSetzen(projectId, (async () => ({ ...((await vorher.catch(() => null)) || {}), ...data, ...neuerStand }))());
  } else if (letzteBasisJeProjekt.has(projectId)) {
    // review 115-05a (K02): the person switched away while this write was on its way - the base of a flush of this project
    // (bimModelNachschreiben) follows it too, else the flush goes out on the stand from before this write (409, change lost)
    const vorher = /** @type {Promise<any>} */ (letzteBasisJeProjekt.get(projectId));
    const id = ergebnis?.id ? { id: ergebnis.id } : {};
    letzteBasisJeProjekt.set(projectId, (async () => ({ ...((await vorher.catch(() => null)) || {}), ...id, ...data, ...neuerStand }))());
  }
  for (const fn of aenderungsHoerer) {
    try { fn(projectId, data); } catch { /* a reader's error must not fail the write */ }
  }
  return ergebnis;
}

/**
 * 115-05a (A-3): writes what a page still had pending for a project - the flush on a project switch or when an editor unmounts
 * inside its autosave window (BIM studio, sketch, useFachlayer). Serialised with the saves.
 * - The project is the open one (in the cache): the same as saveBimModel (a 409 goes to the holders or a conflict card).
 * - Another project (the one just left): built on ITS last stored base (letzteBasisJeProjekt), strict (`?stand`). A field held
 *   back by an open conflict, or one another device changed that the page never took over, refuses the whole flush; fields equal
 *   to the base are not sent. A 409 refuses it as well ("veraltet"): nothing is written and nothing merged - the holder of that
 *   project is no longer mounted, and a mix of old and new is never written (D-115-50). The cache (`record`) is never touched,
 *   so it and the change stream stay on the project open now; only the map entry of the flushed project moves on (also when an
 *   own save of that project lands after the switch, see speichernLauf - review K02).
 * [ASSUMED] a refused flush loses at most the change of the last autosave window (≤ 1.2 s); the caller tells the person. From
 * 115-05c on the local draft keeps that rest.
 * @param {string} projectId project the pending change belongs to
 * @param {Record<string, any>} patch fields to write
 * @returns {Promise<{geschrieben: boolean, grund?: "veraltet"|"keine_basis"|"gesperrt"|"ersetzt"}>} geschrieben = true also when
 *   nothing differed from the base; ersetzt (115-05b) = the model of the project was replaced, nothing is written until reload
 */
export function bimModelNachschreiben(projectId, patch) {
  const run = async () => {
    if (!projectId) return { geschrieben: false, grund: /** @type {const} */ ("keine_basis") };
    if (ersetzt.has(projectId)) return { geschrieben: false, grund: /** @type {const} */ ("ersetzt") };
    if (record.projectId === projectId) {
      await speichernLauf(projectId, patch, {});
      return { geschrieben: true };
    }
    // 115-05b: the body lives in the lazily loaded module of writes for a project that is not open (entry chunk budget)
    return (await nichtOffenLaden()).nachschreibenNichtOffen(nichtOffenKern(), projectId, patch);
  };
  const result = chain.then(run, run);
  chain = result.then(() => undefined, () => undefined);
  return result;
}

/** A writer whose name is not known (a refused save tells only that someone was faster). */
const UNBEKANNT = Object.freeze({ name: "", unbekannt: true });

/**
 * 115-05b (A-7): whether a caller's copy (opt.basisStand, an updated_date) is another state than the stored base (inequality).
 * @param {{basisStand?: string|null}|undefined} opt @param {any} basis the stored base this page knows (null = none)
 * @returns {boolean} false when the caller named no copy
 */
export function basisStandAnders(opt, basis) {
  if (!opt || opt.basisStand === undefined) return false;
  return String(opt.basisStand ?? "") !== String(basis?.updated_date ?? "");
}

/**
 * 107-09 (107-14 review): fields whose content is a discardable CACHE. A field conflict between two devices on them is not shown as a
 * card: the stored version (the other device's) stays and this page's version is dropped — there is nothing to decide, both versions
 * can be computed again from the base geometry (D-BK-08a: the mesh cache is never a source; csg/cache.js only uses an entry whose hash
 * matches today's inputs).
 */
export const VERWERFBARE_FELDER = Object.freeze(["csg_cache_layer"]);

/** Open "modell" conflicts per "project|field" (to show the card again with a newer own value). @type {Map<string, true>} */
const modellKonflikte = new Map();

/**
 * 106-09: a field both this page and another device changed, and no holder merges it (save race, or a stale holder
 * saved a field another device changed): both versions go to the person, the field is held back until the decision.
 * Review 106-09: the card names the field in words; "keep mine" writes the newest value the holder tried to save; "take
 * the other device's" keeps the stored version and remembers the holder's stale value as base, so a later save of that
 * unchanged stale value is not written (and a further edit on it is a new conflict, never a silent overwrite).
 * @param {string} projectId @param {string} feld @param {any} basis @param {any} mein @param {any} fremd
 * @param {any} [geraet] who wrote the other version (UNBEKANNT when not known)
 * @returns {Promise<void>} once the card is shown
 */
async function feldKonfliktMelden(projectId, feld, basis, mein, fremd, geraet = UNBEKANNT) {
  void basis; // the base is not shown: the card compares "here" and "other device"
  // 107-09: a cache is discarded, never decided (the stored version stays, this page's write is already out of the patch)
  if (VERWERFBARE_FELDER.includes(feld)) { vorbehaltWeg(projectId, feld); return; }
  feldSperren(projectId, feld); // held back at once, before the card module is loaded
  modellKonflikte.set(`${projectId}|${feld}`, true);
  const loesen = () => { modellKonflikte.delete(`${projectId}|${feld}`); feldFreigeben(projectId, feld); };
  // 115-05b: the card itself is built in the lazily loaded module (entry chunk budget), unchanged
  /** @type {typeof import("./abgleich/bimModelSonderwege.js")} */ let modul;
  try {
    modul = await nichtOffenLaden();
  } catch (err) {
    // 115-05b part 2: no card → no lock (the field would be held back unseen); the save reports the error, the next one compares again
    loesen();
    throw err;
  }
  // 115-05b part 2: the person opened another project while the module loaded - that switch dropped this project's cards and
  // locks; a card of the project left must not appear now (nor its lock stay)
  if (record.projectId !== projectId) { loesen(); return; }
  modul.feldKonfliktKarte(nichtOffenKern(), projectId, feld, mein, fremd, geraet);
}


/**
 * 106-09: the page subscribes to the change stream of the project; a BimModel event of another device is read and taken
 * into the base (fremdenStandUebernehmen). Mounted by useBimModelSync (the designer) - one stream per browser and project.
 * After a gap in the stream (reconnect, server restart, leader change) the record is read again (review 106-09).
 * Also publishes the read-only test hook window.__bitAbgleich.
 * Conflicts of THIS project stay open when the designer closes (the page-wide card shows them, their resolvers work
 * without a mounted holder); opening another project drops the old project's conflicts and releases their locks.
 * @param {string|null|undefined} projectId
 */
export function useModellAbgleich(projectId) {
  useEffect(() => {
    if (!projectId) return undefined;
    abgleichStand.leeren(projectId, { ausser: true });
    /** @param {Promise<any>} lesen @param {{geraet?: any, zeit?: string|null}} meta */
    const uebernehmen = (lesen, meta) => lesen
      .then((rec) => fremdenStandUebernehmen(projectId, rec, meta))
      .catch((err) => console.error(`[abgleich] change of another device not read: ${err?.message || err}`));
    const abmelden = stromAbonnieren(projectId, (e) => {
      if (e.entitaet !== "BimModel" || e.art === "geloescht") return;
      uebernehmen(e.datensatz ? Promise.resolve(e.datensatz) : bitApi.entities.BimModel.get(e.id), { geraet: e.geraet, zeit: e.zeit });
    }, {
      // something may have been missed: the stored record as it is now (taken in only when newer than the base)
      neuAbgleichen: () => {
        uebernehmen(bitApi.entities.BimModel.filter({ project_id: projectId }).then((rows) => (rows || [])[0] || null), { geraet: UNBEKANNT, zeit: null });
      },
    });
    abgleichTesthaken();
    return () => { abmelden(); abgleichStand.leeren(projectId, { quellen: [] }); };
  }, [projectId]);
}

/**
 * 115-05c (D-115-12): the draft module, loaded on first use (the entry chunk carries none of it); kept once loaded, so a cleanup can
 * use it synchronously.
 * @type {typeof import("./entwurf/entwurfStand.js")|null}
 */
let entwurfMod = null;
/** 115-05c: the project whose designer (useBimModelSync) is mounted - only there readers see the draft (bimModelLesen). @type {string|null} */
let designerOffenFuer = null;
/** @returns {Promise<typeof import("./entwurf/entwurfStand.js")>} */
const entwurfLaden = () => import("./entwurf/entwurfStand.js").then((m) => { entwurfMod = m; return m; });

/** 106-09: the program fields the hook owns (the BIM studio owns the element fields). */
export const PROGRAMM_FELDER = ["footprintM", "footprintQuelle", "achseM", "storeys", "storeyHeight", "geschosse", "untergeschosse", "unit", "footprintLageM"];

/**
 * 108-08: the stored position of the massing body (footprintLageM, m {x, z}) in the normal form, or null (no position stored).
 * @param {any} v @returns {{x: number, z: number}|null}
 */
export function lageNormal(v) {
  return v && Number.isFinite(Number(v.x)) && Number.isFinite(Number(v.z)) ? { x: Number(v.x), z: Number(v.z) } : null;
}

/**
 * Loads the project's BimModel into the shared store on mount / project switch
 * and writes the programme fields back (debounced).
 * @param {string|null|undefined} projectId current project
 * @param {{ zonenBehalten?: (zone: object) => boolean }} [opts]
 *   zonenBehalten — predicate for session-only store zones (Wohnungsplaner " ·W",
 *   Wohnungs-Werkstatt " ·WT") that must survive a re-mount in the SAME project
 *   (I-02, external review Phase 61). The caller owns the markers: @core does
 *   not import @designer. Without it the load replaces the zones wholesale
 *   (behaviour before I-02).
 */
/**
 * @typedef {{achseM: boolean, geschosse: boolean, untergeschosse: boolean, footprintLageM?: boolean}} OptionaleFelder
 *   which optional programme fields the stored record carries (true = the field is there with a value, so clearing it
 *   locally must write the cleared value - null / 0 - instead of leaving the field out); footprintLageM (108-08) is optional in
 *   the flags as well - absent = false
 */

/**
 * The optional programme fields a stored state carries, from its normal form (load / foreign state of useBimModelSync).
 * @param {{achseM?: any, geschosse?: any, untergeschosse?: any}} n  programme values in the normal form (axis or null, table or
 *   null, basement count 0 … 3)
 * @returns {OptionaleFelder}
 */
export function optionaleFelderVon(n) {
  return { achseM: n?.achseM != null, geschosse: n?.geschosse != null, untergeschosse: untergeschosseAnzahl(n?.untergeschosse) !== 0 };
}

/**
 * After a foreign state was taken over (another device saved): the server record now carries every optional field that state
 * has, so a later local clearing must be written (107-13 review: a basement that arrived from another device and was removed
 * here again was silently left on the server). A flag never goes back to false here - writing a cleared value twice is harmless,
 * leaving it out loses the change.
 * @param {OptionaleFelder} hatte  flags before
 * @param {{achseM?: any, geschosse?: any, untergeschosse?: any}} fremd  the foreign state in the normal form
 * @returns {OptionaleFelder}
 */
export function optionaleFelderNachFremd(hatte, fremd) {
  const f = optionaleFelderVon(fremd);
  return { achseM: hatte.achseM || f.achseM, geschosse: hatte.geschosse || f.geschosse, untergeschosse: hatte.untergeschosse || f.untergeschosse };
}

/**
 * The patch the debounced write-back of useBimModelSync sends for the programme fields. The optional fields (axis 86-07, storey
 * table 107-02, basement count 107-13, position of the massing body 108-08) are written only when they have a value or the stored
 * record had one (clearing) - records of projects that never used them stay as they were.
 * @param {{footprintM?: any, footprintQuelle?: any, storeys?: number, storeyHeight?: number, unit?: string, achseM?: any,
 *   geschosse?: any, untergeschosse?: any, footprintLageM?: any}} bp  programme store values (storeyHeight in m, footprintLageM m)
 * @param {OptionaleFelder} hatte  which optional fields the stored record carries
 * @returns {Record<string, any>} patch for saveBimModel
 */
export function programmSchreibPatch(bp, hatte) {
  const achse = Array.isArray(bp.achseM) && bp.achseM.length >= 2 ? bp.achseM : null;
  const geschosse = Array.isArray(bp.geschosse) && bp.geschosse.length ? bp.geschosse : null;
  const ug = untergeschosseAnzahl(bp.untergeschosse);
  const lage = lageNormal(bp.footprintLageM);
  return {
    footprintM: bp.footprintM, footprintQuelle: bp.footprintQuelle ?? null, storeys: bp.storeys, storeyHeight: bp.storeyHeight, unit: bp.unit,
    ...(achse || hatte.achseM ? { achseM: achse } : {}),
    ...(geschosse || hatte.geschosse ? { geschosse } : {}),
    ...(ug || hatte.untergeschosse ? { untergeschosse: ug } : {}),
    ...(lage || hatte.footprintLageM ? { footprintLageM: lage } : {}),
  };
}

/**
 * 108-08 (finding 12): only the programme fields that changed against the stored state this page knows (the load, the last own
 * save, a taken-over change of another device) leave the page. Before, every write-back sent ALL programme fields - a value this
 * page never touched (a stale storey count, the fallback `storeys 4` of a record without the field, `untergeschosse 0`) went along
 * with any footprint change and could overwrite the record. footprintQuelle travels with footprintM (provenance of that outline).
 * @param {Record<string, any>} patch the full patch (programmSchreibPatch)
 * @param {Record<string, any>} gespeichert the stored programme values in the same normal form (gespeicherteProgrammWerte)
 * @returns {Record<string, any>} the changed fields only (may be empty)
 */
export function programmAenderungen(patch, gespeichert) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const [k, v] of Object.entries(patch)) {
    if (JSON.stringify(v ?? null) !== JSON.stringify(gespeichert?.[k] ?? null)) out[k] = v;
  }
  if ("footprintM" in out && !("footprintQuelle" in out) && "footprintQuelle" in patch) out.footprintQuelle = patch.footprintQuelle;
  return out;
}

/** Order of the programme values in the write-back signature (useBimModelSync). */
const SIGNATUR_FELDER = ["footprintM", "storeys", "storeyHeight", "unit", "footprintQuelle", "achseM", "geschosse", "untergeschosse", "footprintLageM"];

/**
 * Signature of the programme values the write-back compares (normal form: axis/table null when empty, basements 0 ... 3, position
 * null when none).
 * @param {Record<string, any>} n programme values in the normal form
 * @returns {string}
 */
export function programmSignatur(n) {
  return JSON.stringify(SIGNATUR_FELDER.map((k) => n?.[k] ?? null));
}

/**
 * The stored programme values as the write-back knows them, parsed from its signature ({} when there is none yet).
 * @param {string} sig signature (programmSignatur)
 * @returns {Record<string, any>}
 */
export function gespeicherteProgrammWerte(sig) {
  try {
    const werte = JSON.parse(sig || "[]");
    return Array.isArray(werte) && werte.length ? Object.fromEntries(SIGNATUR_FELDER.map((k, i) => [k, werte[i] ?? null])) : {};
  } catch { return {}; }
}

/**
 * Central sync of the shared programme store with the persisted BimModel of a project (load on mount/switch, debounced write-back).
 * @param {string|null|undefined} projectId
 * @param {{zonenBehalten?: (z: any) => boolean}} [opts]
 * @returns {boolean} 108-01: true once the BimModel record of THIS project is loaded into the store (reactive) — callers that
 *   derive store values from other records (ComplexDesigner: footprint from the site planning) wait for it, else the load order
 *   decides by chance which value wins (108-RESEARCH §5)
 */
export function useBimModelSync(projectId, opts = {}) {
  const bp = useBuildingProgram();
  // 108-01: the project whose record is loaded, as state (geladenRef below is the non-reactive twin for the write-back)
  const [geladenFuer, setGeladenFuer] = useState(/** @type {string|null} */ (null));
  const loadingRef = useRef(false);
  const lastLoaded = useRef("");
  // 86-07: did the loaded/last saved record carry a drawn axis (so clearing it writes null)?
  const hatteAchse = useRef(false);
  // 107-02: same for the optional storey table (written only when there is one or there was one)
  const hatteGeschosse = useRef(false);
  // 107-13: same for the number of basements (written only when it is not 0 or was not 0)
  const hatteUg = useRef(false);
  // 108-08: same for the position of the massing body (footprintLageM)
  const hatteLage = useRef(false);
  // 87-02: the project whose record was LOADED successfully. Until then the store only
  // holds defaults — and the write-back below must never push those to the server
  // (a transient load failure used to be followed, 1,5 s later, by a save of 4 storeys
  // and a null footprint over the real geometry).
  const geladenRef = useRef(null);
  // Predicate lives in a ref: callers pass an inline arrow, and a new identity
  // per render must not re-trigger the load effect.
  const behaltenRef = useRef(opts.zonenBehalten);
  behaltenRef.current = opts.zonenBehalten;
  // 115-05c (D-115-12): the program fields are a draft until "Speichern". entwurfBereit = the project whose draft was put into the
  // store after the load (before that nothing is reported - the stored values must not clear a draft that is still being read);
  // entwurfTick asks for a new report (a foreign state moved the base)
  const entwurfBereitRef = useRef(/** @type {string|null} */ (null));
  const [entwurfTick, setEntwurfTick] = useState(0);

  // 106-09: the change stream of the project (one per page) and the program fields another device changed.
  useModellAbgleich(projectId);
  useEffect(() => {
    if (!projectId) return undefined;
    /** Store values in the same normal form as the load above. @param {Record<string, any>} q @returns {Record<string, any>} */
    const normal = (q) => ({
      footprintM: q.footprintM || null, footprintQuelle: q.footprintQuelle || null,
      achseM: Array.isArray(q.achseM) && q.achseM.length >= 2 ? q.achseM : null,
      storeys: q.storeys || 4, storeyHeight: q.storeyHeight || 3,
      geschosse: Array.isArray(q.geschosse) && q.geschosse.length ? q.geschosse : null, unit: q.unit || "m",
      untergeschosse: untergeschosseAnzahl(q.untergeschosse),
      footprintLageM: lageNormal(q.footprintLageM),
    });
    /** The stored program values as the write-back knows them (parsed from its signature). @returns {Record<string, any>} */
    const gespeichert = () => gespeicherteProgrammWerte(lastLoaded.current);
    return aufFremdenStand((pid, f) => {
      if (pid !== projectId || geladenRef.current !== projectId) return [];
      // rooms drawn in the studio (customZones) feed the shared store as well - merged like at load, not claimed
      if ("customZones" in f.patch) {
        buildingProgram.set({ zones: zonenNachLoad({
          geladen: (f.patch.customZones || []).map((/** @type {any} */ z) => ({ points: z.points, level: z.level, name: z.name, id: z._idx, guid: z.guid })),
          vorhanden: buildingProgram.get().zones, gleichesProjekt: true, behalten: behaltenRef.current,
        }) });
      }
      const felder = PROGRAMM_FELDER.filter((k) => k in f.patch);
      if (!felder.length) return [];
      const lokal = normal(buildingProgram.get());
      const fremd = normal({ ...gespeichert(), ...f.patch });
      const basisWerte = normal({ ...gespeichert(), ...f.vorher });
      /** @type {Record<string, any>} */
      const uebernehmen = {};
      for (const k of felder) {
        const r = feldDreiWege(basisWerte[k], lokal[k], fremd[k]);
        if (!r.konflikte.length) { uebernehmen[k] = r.wert; continue; }
        // both changed the same program value: keep mine on screen, hold the field back, let the person decide
        feldSperren(projectId, k);
        abgleichStand.konfliktMelden({
          quelle: "programm", projektId: projectId, feld: k, titel: feldName(k), geraet: f.geraet,
          zeilen: [{ schluessel: null, name: feldName(k), mein: wertKurz(lokal[k]), fremd: wertKurz(fremd[k]) }],
          loesen: {
            // the shared store holds this project as long as no other project was opened (conflicts of an old project are dropped then)
            mein: async () => {
              const wert = storeGehoertZu(projectId) ? normal(buildingProgram.get())[k] : zurueckgehaltenerWert(projectId, k, lokal[k]);
              feldFreigeben(projectId, k);
              // 115-05c: with the designer of this project open the decision stays in the draft ("Speichern" writes it); without it
              // the kept value is written as before (an explicit choice of the person on the page-wide card)
              if (!storeGehoertZu(projectId) || geladenRef.current !== projectId) await saveBimModel(projectId, { [k]: wert });
            },
            fremd: async () => {
              feldFreigeben(projectId, k);
              if (!storeGehoertZu(projectId)) return;
              buildingProgram.set({ [k]: fremd[k] });
              // 108-08: the readers learn that the other device's value applies now (the BIM studio takes it into its history)
              for (const fn of aenderungsHoerer) {
                try { fn(projectId, { [k]: fremd[k] }, { fremd: true, vorher: { [k]: lokal[k] }, geraet: f.geraet }); } catch { /* a reader's error must not stop the others */ }
              }
            },
          },
        });
      }
      // the stored state moves on: a value that only arrived must not be written back as if it were a local change
      lastLoaded.current = programmSignatur(fremd);
      // 107-13 review: the record now carries the optional fields of the foreign state - clearing one here must be written
      const hatte = optionaleFelderNachFremd({ achseM: hatteAchse.current, geschosse: hatteGeschosse.current, untergeschosse: hatteUg.current }, fremd);
      hatteAchse.current = hatte.achseM;
      hatteGeschosse.current = hatte.geschosse;
      hatteUg.current = hatte.untergeschosse;
      if (fremd.footprintLageM) hatteLage.current = true; // 108-08: same rule for the position of the massing body
      if (Object.keys(uebernehmen).length) buildingProgram.set(uebernehmen);
      setEntwurfTick((n) => n + 1); // 115-05c: the draft's base of the program fields moved
      return felder;
    });
  }, [projectId]);

  // Laden bei Projektwechsel UND bei jedem Re-Mount der Route — Programm +
  // Räume in die gemeinsame Quelle. The zones are merged, not replaced: see
  // zonenNachLoad (I-02).
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    loadingRef.current = true;
    entwurfBereitRef.current = null;
    // Decided BEFORE the await: a re-mount in the same project keeps the
    // session zones; a switch drops the old project's store entirely.
    const gleichesProjekt = letztesSyncProjekt === projectId;
    (async () => {
      try {
        const m = await loadBimModel(projectId);
        if (cancelled) return;
        const patch = {
          footprintM: m?.footprintM || null,
          footprintQuelle: m?.footprintQuelle || null,
          // 86-07: drawn centre line (polyline in footprint-centred metres) or null.
          achseM: Array.isArray(m?.achseM) && m.achseM.length >= 2 ? m.achseM : null,
          storeys: m?.storeys || 4,
          storeyHeight: m?.storeyHeight || 3,
          // 107-02 (D-BK-05): optional storey table; absent in every old record → null = one height for all storeys
          geschosse: Array.isArray(m?.geschosse) && m.geschosse.length ? m.geschosse : null,
          // 107-13 (D-BK-20): number of basements; absent in every old record → 0 = no basement
          untergeschosse: untergeschosseAnzahl(m?.untergeschosse),
          // 108-08 (D-EFH-09): position of the massing body on the site (m, relative to the parcel centre); absent in old records -> null
          footprintLageM: lageNormal(m?.footprintLageM),
          unit: m?.unit || "m",
          zones: zonenNachLoad({
            // id = the record's _idx (phase 43); guid = its stored GUID (W-1118-02: the furniture key, @designer/lib/moebel zoneKey)
            geladen: (m?.customZones || []).map((z) => ({ points: z.points, level: z.level, name: z.name, id: z._idx, guid: z.guid })),
            vorhanden: buildingProgram.get().zones,
            gleichesProjekt,
            behalten: behaltenRef.current,
          }),
        };
        lastLoaded.current = programmSignatur(patch);
        hatteLage.current = patch.footprintLageM !== null;
        hatteAchse.current = patch.achseM !== null;
        hatteGeschosse.current = patch.geschosse !== null;
        hatteUg.current = patch.untergeschosse !== 0;
        geladenRef.current = projectId;
        buildingProgram.set({ ...patch, syncFehler: null });
        letztesSyncProjekt = projectId;
        setGeladenFuer(projectId);
        // 115-05c: the program fields of an unsaved draft go on top (own base as they are, a newer stored state three ways per field,
        // a field both changed with its card) - only then the write-back reports to the draft
        entwurfLaden().then(async (E) => {
          const st = await E.starten(projectId);
          if (cancelled) return;
          E.felderEinspielen({ pid: projectId, entwurf: st.entwurf, gespeichert: m, felder: PROGRAMM_FELDER, quelle: "programm",
            setzen: (w) => buildingProgram.set(w) });
          entwurfBereitRef.current = projectId;
          setEntwurfTick((n) => n + 1);
        }).catch((err) => console.error(`[entwurf] Programmfelder nicht eingespielt: ${err?.message || err}`));
      } catch (err) {
        // 87-02: offline / server away — the store keeps its defaults, the write-back
        // stays locked (geladenRef) and the user gets to see why nothing is there.
        geladenRef.current = null;
        console.warn(`[bimModel] Laden fehlgeschlagen für Projekt ${projectId}: ${err?.message || err} — Geometrie wird nicht zurückgeschrieben`);
        if (!cancelled) buildingProgram.set({ syncFehler: "laden" });
      } finally { setTimeout(() => { loadingRef.current = false; }, 50); }
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  // 115-05c (D-115-12): the program fields are a DRAFT - each change is reported to the draft (local copy after 800 ms), the write
  // happens with "Speichern" (the source "programm" below). Before: written 1.5 s after each change.
  useEffect(() => {
    // 87-02: never before a successful load of THIS project (see geladenRef); 115-05c: nor before its draft was put back
    if (!projectId || loadingRef.current || geladenRef.current !== projectId || entwurfBereitRef.current !== projectId) return;
    const pid = projectId;
    const voll = programmSchreibPatch(bp, { achseM: hatteAchse.current, geschosse: hatteGeschosse.current, untergeschosse: hatteUg.current, footprintLageM: hatteLage.current });
    const gespeichert = gespeicherteProgrammWerte(lastLoaded.current);
    const werte = { ...gespeichert, ...programmAenderungen(voll, gespeichert) };
    void Promise.all([entwurfLaden(), loadBimModel(pid).catch(() => null)]).then(([E, rec]) => {
      if (geladenRef.current === pid) E.melden(pid, "bim", { stand: rec ? { id: rec.id ?? null, updated_date: rec.updated_date ?? null } : null, basis: gespeichert, werte, felder: PROGRAMM_FELDER });
    });
  }, [projectId, entwurfTick, bp.footprintM, bp.footprintQuelle, bp.storeys, bp.storeyHeight, bp.unit, bp.achseM, bp.geschosse, bp.untergeschosse, bp.footprintLageM]);

  // 115-05c: the hook's part of "Speichern" and "Verwerfen"; leaving the designer with unsaved program fields puts the stored values
  // back into the shared store (readers on other routes see the stored state; the draft comes back on the next open)
  useEffect(() => {
    if (!projectId) return undefined;
    const pid = projectId;
    /** @type {Array<() => void>} */ let ab = [];
    let weg = false;
    const gespeichertInDenStore = () => { if (storeGehoertZu(pid)) buildingProgram.set(gespeicherteProgrammWerte(lastLoaded.current)); };
    designerOffenFuer = pid;
    entwurfLaden().then((E) => {
      if (weg) return;
      ab = [
        E.speichererSetzen(pid, "programm", async () => {
          if (geladenRef.current !== pid) return "leer";
          const voll = programmSchreibPatch(buildingProgram.get(), { achseM: hatteAchse.current, geschosse: hatteGeschosse.current, untergeschosse: hatteUg.current, footprintLageM: hatteLage.current });
          const gespeichert = gespeicherteProgrammWerte(lastLoaded.current);
          const geaendert = programmAenderungen(voll, gespeichert);
          const frei = Object.fromEntries(Object.entries(geaendert).filter(([k]) => !feldGesperrt(pid, k)));
          if (Object.keys(frei).length) {
            await saveBimModel(pid, frei);
            const neu = { ...gespeichert, ...frei };
            lastLoaded.current = programmSignatur(neu);
            hatteAchse.current ||= neu.achseM != null;
            hatteGeschosse.current ||= neu.geschosse != null;
            hatteUg.current ||= untergeschosseAnzahl(neu.untergeschosse) !== 0;
            hatteLage.current ||= neu.footprintLageM != null;
            if (buildingProgram.get().syncFehler === "speichern") buildingProgram.set({ syncFehler: null });
          }
          const basis = gespeicherteProgrammWerte(lastLoaded.current);
          const rec = await loadBimModel(pid).catch(() => null);
          E.melden(pid, "bim", { stand: rec ? { id: rec.id ?? null, updated_date: rec.updated_date ?? null } : null, basis,
            werte: { ...basis, ...programmAenderungen(voll, basis) }, felder: PROGRAMM_FELDER });
          if (Object.keys(geaendert).length > Object.keys(frei).length) return "konflikt";
          return Object.keys(frei).length ? "ok" : "leer";
        }),
        E.zuruecksetzerSetzen(pid, "programm", gespeichertInDenStore),
      ];
    }).catch((err) => console.error(`[entwurf] Programmfelder nicht angemeldet: ${err?.message || err}`));
    return () => {
      weg = true;
      ab.forEach((f) => f());
      if (designerOffenFuer === pid) designerOffenFuer = null;
      const e = entwurfMod?.entwurfVon(pid);
      if (e && Object.keys(e.aenderungen.bim || {}).some((k) => PROGRAMM_FELDER.includes(k))) gespeichertInDenStore();
    };
  }, [projectId]);
  return Boolean(projectId) && geladenFuer === projectId;
}

/**
 * 73-05: does the shared program store currently hold this project? Writers outside the designer (IFC
 * viewer) update the store only then — otherwise the next designer load reads the record anyway.
 * @param {string|null|undefined} projectId
 * @returns {boolean}
 */
export function storeGehoertZu(projectId) {
  return Boolean(projectId) && letztesSyncProjekt === projectId;
}
