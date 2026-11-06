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

// 89-07 (BW-09): listeners of saved patches. Readers that hold a copy of the record
// (usePlanModel) did not see element changes of BitBimStudio in the same session — the
// cache was patched, but nobody re-read it. Now every successful save notifies them.
/** @type {Set<(projectId: string, patch: Record<string, any>, meta?: {fremd: true, vorher: Record<string, any>, geraet: any}) => void>} */
const aenderungsHoerer = new Set();

/**
 * Subscribe to saved BimModel patches (after the write succeeded, in save order).
 * 106-09: also called for a change ANOTHER device saved (third argument `{fremd: true, vorher, geraet}`), so readers that
 * hold a copy (usePlanModel, the workshop zones) follow it live; old listeners simply ignore the third argument.
 * @param {(projectId: string, patch: Record<string, any>, meta?: {fremd: true, vorher: Record<string, any>, geraet: any}) => void} fn
 *   called with the project and the written fields
 * @returns {() => void} unsubscribe
 */
export function aufBimModelAenderung(fn) {
  aenderungsHoerer.add(fn);
  return () => { aenderungsHoerer.delete(fn); };
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
 *   zeit: string|null, entscheidung?: boolean}} FremderStand
 *   patch = the fields another device changed (new values); vorher = the same fields in the base before; entscheidung =
 *   true when the person took the other device's version in a conflict card (no note "arrived", the holder just follows)
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
  record.load = Promise.resolve({ ...(basis || {}), ...fremd });
  if (!record.id && fremd.id) record.id = fremd.id;
  if (!felder.length) return { felder, beansprucht: new Set(), basis };
  /** @type {FremderStand} */
  const f = {
    patch: Object.fromEntries(felder.map((k) => [k, fremd[k]])),
    vorher: Object.fromEntries(felder.map((k) => [k, basis?.[k]])),
    geraet: meta.geraet ?? null, zeit: meta.zeit ?? null,
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
 * @param {string} projectId
 * @param {any} datensatz stored record (as GET /entities/BimModel/:id returns it)
 * @param {{geraet?: any, zeit?: string|null}} [meta] who wrote it (null = another window on this computer)
 * @returns {Promise<string[]>} the fields that changed
 */
export function fremdenStandUebernehmen(projectId, datensatz, meta = {}) {
  const run = async () => {
    if (record.projectId !== projectId || !record.load || !datensatz) return [];
    const basis = await record.load.catch(() => null);
    if (basis?.updated_date && datensatz.updated_date && String(datensatz.updated_date) <= String(basis.updated_date)) return [];
    return (await fremdEinarbeiten(projectId, datensatz, meta)).felder;
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
    record.load = null;
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
    record.projectId = projectId;
    record.id = null;
    vorbehalt.delete(projectId); // a fresh load: every holder reads the stored version again
    record.load = bitApi.entities.BimModel.filter({ project_id: projectId })
      .then((rows) => {
        const m = migriereLayerDesDatensatzes((rows || [])[0] || null);
        if (record.projectId === projectId) record.id = m?.id || null;
        return m;
      })
      .catch((err) => {
        // Fehlgeschlagenes Laden nicht cachen (offline -> später erneut versuchen).
        if (record.projectId === projectId) record.load = null;
        throw err;
      });
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
 * @param {string} projectId @param {Record<string, any>} patch fields to write
 * @param {{streng?: boolean}} [opt]
 * @returns {Promise<any>} the stored record (or the base when nothing had to be written)
 */
export function saveBimModel(projectId, patch, opt = {}) {
  const streng = opt?.streng === true;
  const run = async () => {
    if (!projectId) return null;
    if (record.projectId !== projectId || (!record.id && !record.load)) await loadBimModel(projectId);
    else if (record.load) await record.load;
    // 87-07: registered layer fields leave with their schema version and a time stamp.
    const data = { project_id: projectId, ...patch };
    for (const feld of Object.keys(data)) if (LAYER_VERSION[feld] !== undefined) data[feld] = stempelFuerSave(feld, data[feld]);
    // 106-09: the base this write builds on. Fields equal to it are not sent (no echo of a change that just arrived from
    // another device, no new updated_date for nothing); fields with an open conflict wait for the person's decision.
    let basis = record.load ? await record.load.catch(() => null) : null;
    const vb = vorbehalt.get(projectId);
    if (streng) {
      const offen = Object.keys(data).filter((f) => f !== "project_id"
        && (feldGesperrt(projectId, f) || (record.id && basis && vb?.has(f) && !gleichWert(basis[f], data[f]))));
      if (offen.length) throw nichtGeschrieben(projectId, offen);
    }
    for (const feld of Object.keys(data)) {
      if (feld === "project_id") continue;
      if (feldGesperrt(projectId, feld)) {
        // held back until the decision; the newest attempt is what "keep mine" writes
        const m = zurueckgehaltenWerte.get(projectId) || new Map();
        m.set(feld, data[feld]);
        zurueckgehaltenWerte.set(projectId, m);
        konfliktTextNachziehen(projectId, feld, data[feld]);
        delete data[feld];
      } else if (record.id && basis && gleichWert(basis[feld], data[feld])) {
        delete data[feld];
        vb?.delete(feld); // the holder caught up with the other device
      } else if (record.id && basis && vb?.has(feld)) {
        // another device changed this field and its holder did not take it over: three ways against the old base
        const v = /** @type {{vorher: any, geraet: any}} */ (vb.get(feld));
        const mein = data[feld];
        delete data[feld];
        if (gleichWert(mein, v.vorher)) continue; // the stale value again: the other device's change stays
        feldKonfliktMelden(projectId, feld, v.vorher, mein, basis[feld], v.geraet);
      }
    }
    if (record.id && Object.keys(data).length <= 1) return basis;
    let ergebnis;
    if (record.id) {
      // 106-09 (105-20): strict write - an outdated base answers 409 with the stored record instead of overwriting it.
      // Then: what only the other device changed comes in, what only this page changed is written again on the new
      // base, and a field both changed goes to its holder (three-way per element) or becomes a conflict of this module.
      for (let versuch = 1; ; versuch += 1) {
        try {
          ergebnis = await bitApi.entities.BimModel.update(record.id, data, { stand: basis?.updated_date ?? null });
          break;
        } catch (err) {
          const e = /** @type {any} */ (err);
          if (e?.status !== 409 || !e?.data?.gespeichert || versuch >= 3) throw err;
          const fremd = e.data.gespeichert;
          // the refusal does not say who was faster: another tab or a paired device (never "a window on this computer")
          const r = await fremdEinarbeiten(projectId, fremd, { geraet: UNBEKANNT, zeit: fremd.updated_date ?? null });
          const alt = r.basis;
          basis = record.load ? await record.load.catch(() => null) : null;
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
            feldKonfliktMelden(projectId, feld, alt?.[feld], mein, fremd[feld], UNBEKANNT);
          }
          if (Object.keys(data).length <= 1) return basis;
        }
      }
    } else {
      ergebnis = await bitApi.entities.BimModel.create(data);
      if (record.projectId === projectId) record.id = ergebnis?.id || null;
    }
    // Cache kohärent halten (Phase 34): loadBimModel cached EINEN Datensatz je
    // Projekt — ohne Patch sähen spätere Leser (usePlanModel, useFachlayer,
    // Sketch-Overlay im Grundriss) bis zum Reload den alten Stand.
    // 106-09: plus the new updated_date - the base of the next strict write.
    const neuerStand = ergebnis && typeof ergebnis === "object" && ergebnis.updated_date ? { updated_date: ergebnis.updated_date } : {};
    if (record.projectId === projectId && record.load) {
      const vorher = record.load;
      record.load = (async () => ({ ...((await vorher.catch(() => null)) || {}), ...data, ...neuerStand }))();
    }
    for (const fn of aenderungsHoerer) {
      try { fn(projectId, data); } catch { /* a reader's error must not fail the write */ }
    }
    return ergebnis;
  };
  const result = chain.then(run, run);
  chain = result.catch(() => { /* Kette läuft weiter, Fehler geht an den Aufrufer */ });
  return result;
}

/** A writer whose name is not known (a refused save tells only that someone was faster). */
const UNBEKANNT = Object.freeze({ name: "", unbekannt: true });

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
 */
function feldKonfliktMelden(projectId, feld, basis, mein, fremd, geraet = UNBEKANNT) {
  void basis; // the base is not shown: the card compares "here" and "other device"
  // 107-09: a cache is discarded, never decided (the stored version stays, this page's write is already out of the patch)
  if (VERWERFBARE_FELDER.includes(feld)) { vorbehaltWeg(projectId, feld); return; }
  feldSperren(projectId, feld);
  modellKonflikte.set(`${projectId}|${feld}`, true);
  abgleichStand.konfliktMelden({
    quelle: "modell", projektId: projectId, feld, titel: feldName(feld), geraet,
    zeilen: [{ schluessel: null, name: feldName(feld), mein: wertKurz(mein), fremd: wertKurz(fremd) }],
    fremdHinweis: "Ein Editor, der diesen Teil gerade offen hat, zeigt die übernommene Fassung nach dem erneuten Öffnen.",
    loesen: {
      mein: async () => {
        const wert = zurueckgehaltenerWert(projectId, feld, mein);
        modellKonflikte.delete(`${projectId}|${feld}`);
        vorbehaltWeg(projectId, feld);
        feldFreigeben(projectId, feld);
        await saveBimModel(projectId, { [feld]: wert });
      },
      fremd: async () => {
        const alt = zurueckgehaltenerWert(projectId, feld, mein);
        modellKonflikte.delete(`${projectId}|${feld}`);
        feldFreigeben(projectId, feld);
        // the base already holds the foreign version; a holder that still shows the stale value takes it over now
        const genommen = halterBenachrichtigen(projectId, { patch: { [feld]: fremd }, vorher: { [feld]: alt }, geraet, zeit: null, entscheidung: true });
        if (genommen.has(feld)) vorbehaltWeg(projectId, feld);
        else {
          const vbm = vorbehalt.get(projectId) || new Map();
          vbm.set(feld, { vorher: alt, geraet });
          vorbehalt.set(projectId, vbm);
        }
      },
    },
  });
}

/**
 * A locked "modell" field got a newer own value: the card shows it (the resolvers read the newest value anyway).
 * @param {string} projectId @param {string} feld @param {any} wert
 */
function konfliktTextNachziehen(projectId, feld, wert) {
  if (!modellKonflikte.has(`${projectId}|${feld}`)) return;
  const offen = abgleichStand.konflikt(`modell:${feld}`);
  if (!offen || offen.projektId !== projectId || offen.zeilen[0]?.mein === wertKurz(wert)) return;
  abgleichStand.konfliktMelden({ ...offen, zeilen: [{ ...offen.zeilen[0], mein: wertKurz(wert) }] });
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

/** 106-09: the program fields the hook owns (the BIM studio owns the element fields). */
const PROGRAMM_FELDER = ["footprintM", "footprintQuelle", "achseM", "storeys", "storeyHeight", "geschosse", "untergeschosse", "unit", "footprintLageM"];

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
          geladen: (f.patch.customZones || []).map((/** @type {any} */ z) => ({ points: z.points, level: z.level, name: z.name, id: z._idx })),
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
              await saveBimModel(projectId, { [k]: wert });
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
            // id = persistentes _idx der BIM-Studio-Zone (Phase 43: stabiler Raumschlüssel der Möblierung)
            geladen: (m?.customZones || []).map((z) => ({ points: z.points, level: z.level, name: z.name, id: z._idx })),
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

  // Programm-Felder debounced zurückschreiben (nur wenn wirklich geändert).
  // Elementfelder schreibt BitBimStudio über denselben saveBimModel-Pfad.
  useEffect(() => {
    // 87-02: never before a successful load of THIS project (see geladenRef).
    if (!projectId || loadingRef.current || geladenRef.current !== projectId) return;
    const achse = Array.isArray(bp.achseM) && bp.achseM.length >= 2 ? bp.achseM : null;
    const geschosse = Array.isArray(bp.geschosse) && bp.geschosse.length ? bp.geschosse : null;
    const ug = untergeschosseAnzahl(bp.untergeschosse);
    const lage = lageNormal(bp.footprintLageM);
    const sig = programmSignatur({ ...bp, achseM: achse, geschosse, untergeschosse: ug, footprintLageM: lage });
    if (sig === lastLoaded.current) return;
    let abgebrochen = false;
    const t = setTimeout(async () => {
      // 87-02: three attempts with backoff (0,5 / 1 / 1,5 s), then say so instead of
      // waiting silently for the next change.
      for (let versuch = 1; versuch <= 3 && !abgebrochen; versuch += 1) {
        try {
          // 86-07: the axis is written only when there is one or there was one (clearing it) —
          // records of projects that never drew an axis stay as they were.
          // 107-02: the storey table the same way; 107-13: the number of basements the same way — a project without basements
          // never gets the field (programmSchreibPatch)
          // 108-08 (finding 12): only what changed against the stored state leaves the page - never a fallback or a stale value
          const voll = programmSchreibPatch(bp, { achseM: hatteAchse.current, geschosse: hatteGeschosse.current, untergeschosse: hatteUg.current, footprintLageM: hatteLage.current });
          const geaendert = programmAenderungen(voll, gespeicherteProgrammWerte(lastLoaded.current));
          if (Object.keys(geaendert).length) await saveBimModel(projectId, geaendert);
          hatteAchse.current = achse !== null;
          hatteGeschosse.current = geschosse !== null;
          hatteUg.current = ug !== 0;
          hatteLage.current = lage !== null;
          lastLoaded.current = sig;
          if (buildingProgram.get().syncFehler === "speichern") buildingProgram.set({ syncFehler: null });
          return;
        } catch (err) {
          if (versuch === 3) {
            console.warn(`[bimModel] Speichern fehlgeschlagen für Projekt ${projectId} (3 Versuche): ${err?.message || err}`);
            if (!abgebrochen) buildingProgram.set({ syncFehler: "speichern" });
          } else {
            await new Promise((r) => setTimeout(r, 500 * versuch));
          }
        }
      }
    }, 1500);
    return () => { abgebrochen = true; clearTimeout(t); };
  }, [projectId, bp.footprintM, bp.footprintQuelle, bp.storeys, bp.storeyHeight, bp.unit, bp.achseM, bp.geschosse, bp.untergeschosse, bp.footprintLageM]);
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
