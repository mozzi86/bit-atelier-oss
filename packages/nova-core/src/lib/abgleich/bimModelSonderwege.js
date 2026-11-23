// 115-05b (E-1, E-6): the rare paths of the BimModel write, loaded on first use by useBimModelSync (the entry chunk is at its size
// budget): (1) writing the BimModel of a project that is NOT the open one, (2) the card of a field conflict (106-09, moved here
// unchanged).
// (1) useBimModelSync keeps one project in its cache
// (`record`); a save planned for the project just left - queued before the switch, or whose PUT came back with 409 after it - must
// never use that cache: not its record id (the retry went to the new project's record, or to id null), not its base, not its
// holders, and it must not move the cache back. This module writes such a save on the left project's OWN base, all or nothing.
//
// In:  the module state of useBimModelSync (SonderwegKern), a project id, a patch / a refused write / a conflict.
// Out: the stored record (or the base when nothing had to be written); a field another writer set differently refuses the write
//      with the error of a strict save (`code: "nicht_geschrieben"`).
import { bitApi } from "@core/api/bitApi";
import { gleichWert } from "@core/lib/abgleich/dreiWege";
import { LAYER_VERSION, stempelFuerSave } from "@core/lib/fachlayerSchema";
import { abgleichStand } from "@core/lib/abgleich/abgleichStand";
import { feldName } from "@core/lib/abgleich/modellAbgleich";

/** Administration fields of a stored record (never compared as content). */
const VERWALTUNG = new Set(["id", "created_date", "updated_date", "project_id"]);

/**
 * The state of useBimModelSync this module reads and moves (passed in, so there is one copy of it).
 * @typedef {{
 *   record: {projectId: string|null, id: string|null, load: Promise<any>|null},
 *   letzteBasisJeProjekt: Map<string, Promise<any>>,
 *   vorbehalt: Map<string, Map<string, {vorher: any, geraet: any}>>,
 *   feldGesperrt: (projectId: string, feld: string) => boolean,
 *   nichtGeschrieben: (projectId: string, felder: string[]) => Error,
 *   migriere: (m: any) => any,
 *   ladenSetzen: (projectId: string, load: Promise<any>|null) => void,
 *   modellKonflikte: Map<string, true>,
 *   zurueckgehaltenerWert: (projectId: string, feld: string, fallback?: any) => any,
 *   vorbehaltWeg: (projectId: string, feld: string) => void,
 *   feldFreigeben: (projectId: string, feld: string) => void,
 *   saveBimModel: (projectId: string, patch: Record<string, any>) => Promise<any>,
 *   halterBenachrichtigen: (projectId: string, f: any) => Set<string>,
 *   wertKurz: (v: any) => string,
 *   basisStandAnders: (opt: {basisStand?: string|null}|undefined, basis: any) => boolean,
 * }} SonderwegKern
 */

/**
 * A 409 of a project that is not the open one: no holder of it is mounted and its conflict cards were dropped on the switch, so
 * nothing is merged three ways. The fields the other writer changed are compared with this write: the same value leaves the write,
 * a different value refuses the whole write (thrown, nothing of a mix is written, D-115-50). Fields the other writer did not touch
 * stay in the write.
 * Side effects: removes fields from `data`; moves the map entry of the project (letzteBasisJeProjekt) to the stored record while the
 * project is still not open, so a later flush builds on it.
 * @param {SonderwegKern} k @param {string} projectId
 * @param {any} basis the base the refused write built on @param {any} gespeichert the stored record (body of the 409)
 * @param {Record<string, any>} data the write (with project_id), changed in place
 * @returns {any} the new base (the stored record)
 */
export function fremdOhneHalter(k, projectId, basis, gespeichert, data) {
  const fremd = k.migriere(gespeichert);
  const geaendert = Object.keys(fremd).filter((f) => !VERWALTUNG.has(f) && !gleichWert(fremd[f], basis?.[f]));
  const anders = Object.keys(data).filter((f) => f !== "project_id" && geaendert.includes(f) && !gleichWert(data[f], fremd[f]));
  if (anders.length) throw k.nichtGeschrieben(projectId, anders);
  for (const f of geaendert) delete data[f];
  const neu = { ...(basis || {}), ...fremd };
  if (k.record.projectId !== projectId && k.letzteBasisJeProjekt.has(projectId)) k.letzteBasisJeProjekt.set(projectId, Promise.resolve(neu));
  return neu;
}

/**
 * saveBimModel for a project that is not the open one. Built on that project's own base - its map entry (letzteBasisJeProjekt) or,
 * when the page never knew it, a fresh read that does NOT touch the cache - strict (`?stand`); a 409 goes through fremdOhneHalter
 * (at most three attempts). A field held back by an open conflict, or one another device changed that the page never took over,
 * refuses the write (thrown, like a strict save). Without a record the project gets one (as before). The cache of the open project
 * and its readers are never touched; when the project was opened again meanwhile, the write goes into its fresh load.
 * 115-05b (A-7): a strict save naming the copy it built on (`opt.basisStand`) refuses when that project's base is another state.
 * @param {SonderwegKern} k @param {string} projectId @param {Record<string, any>} patch fields to write
 * @param {{streng?: boolean, basisStand?: string|null}} [opt] the options of saveBimModel
 * @returns {Promise<any>} the stored record (or the base when nothing had to be written)
 */
export async function nichtOffenSchreiben(k, projectId, patch, opt = {}) {
  const laden = k.letzteBasisJeProjekt.get(projectId);
  let basis = laden ? await laden.catch(() => null) : null;
  if (!basis) basis = k.migriere(((await bitApi.entities.BimModel.filter({ project_id: projectId })) || [])[0] || null);
  if (opt?.streng === true && k.basisStandAnders(opt, basis)) throw k.nichtGeschrieben(projectId, Object.keys(patch));
  /** @type {Record<string, any>} */
  const data = { project_id: projectId, ...patch };
  for (const feld of Object.keys(data)) if (LAYER_VERSION[feld] !== undefined) data[feld] = stempelFuerSave(feld, data[feld]);
  const vb = k.vorbehalt.get(projectId);
  const offen = Object.keys(data).filter((f) => f !== "project_id" && (k.feldGesperrt(projectId, f) || (basis?.id && vb?.has(f) && !gleichWert(basis[f], data[f]))));
  if (offen.length) throw k.nichtGeschrieben(projectId, offen);
  if (!basis?.id) return bitApi.entities.BimModel.create(data);
  for (const feld of Object.keys(data)) if (feld !== "project_id" && gleichWert(basis[feld], data[feld])) delete data[feld];
  /** @type {any} */
  let ergebnis = null;
  for (let versuch = 1; Object.keys(data).length > 1; versuch += 1) {
    try {
      ergebnis = await bitApi.entities.BimModel.update(basis.id, data, { stand: basis.updated_date ?? null });
      break;
    } catch (err) {
      const e = /** @type {any} */ (err);
      if (e?.status !== 409 || !e?.data?.gespeichert || versuch >= 3) throw err;
      basis = fremdOhneHalter(k, projectId, basis, e.data.gespeichert, data);
    }
  }
  if (!ergebnis) return basis;
  const stand = typeof ergebnis === "object" && ergebnis.updated_date ? { updated_date: ergebnis.updated_date } : {};
  if (k.record.projectId === projectId && k.record.load) {
    // opened again meanwhile: its fresh load is the base, this write goes into it
    const vorher = k.record.load;
    k.ladenSetzen(projectId, (async () => ({ ...((await vorher.catch(() => null)) || {}), ...data, ...stand }))());
  } else if (k.letzteBasisJeProjekt.has(projectId)) k.letzteBasisJeProjekt.set(projectId, Promise.resolve({ ...basis, ...data, ...stand }));
  return ergebnis;
}

/**
 * 115-05a (A-3) body of bimModelNachschreiben for a project that is not the open one (moved here in 115-05b, unchanged): built on
 * ITS last stored base (letzteBasisJeProjekt), strict (`?stand`). A field held back by an open conflict, or one another device
 * changed that the page never took over, refuses the whole flush; fields equal to the base are not sent. A 409 refuses it as well
 * ("veraltet"): nothing is written and nothing merged (the holder of that project is no longer mounted, D-115-50). The cache
 * (`record`) is never touched; only the map entry of the flushed project moves on.
 * @param {SonderwegKern} k @param {string} projectId @param {Record<string, any>} patch fields to write
 * @returns {Promise<{geschrieben: boolean, grund?: "veraltet"|"keine_basis"|"gesperrt"}>}
 */
export async function nachschreibenNichtOffen(k, projectId, patch) {
  const laden = k.letzteBasisJeProjekt.get(projectId);
  const basis = laden ? await laden.catch(() => null) : null;
  if (!basis?.id) return { geschrieben: false, grund: /** @type {const} */ ("keine_basis") };
  /** @type {Record<string, any>} */
  const data = { ...patch };
  for (const feld of Object.keys(data)) if (LAYER_VERSION[feld] !== undefined) data[feld] = stempelFuerSave(feld, data[feld]);
  const vb = k.vorbehalt.get(projectId);
  const offen = Object.keys(data).filter((f) => f !== "project_id" && (k.feldGesperrt(projectId, f) || (vb?.has(f) && !gleichWert(basis[f], data[f]))));
  if (offen.length) return { geschrieben: false, grund: /** @type {const} */ ("gesperrt") };
  for (const feld of Object.keys(data)) if (gleichWert(basis[feld], data[feld])) delete data[feld];
  delete data.project_id;
  if (!Object.keys(data).length) return { geschrieben: true };
  /** @type {any} */
  let ergebnis;
  try {
    ergebnis = await bitApi.entities.BimModel.update(basis.id, { project_id: projectId, ...data }, { stand: basis.updated_date ?? null });
  } catch (err) {
    if (/** @type {any} */ (err)?.status === 409) return { geschrieben: false, grund: /** @type {const} */ ("veraltet") };
    throw err;
  }
  const neu = { ...basis, ...data, ...(ergebnis && typeof ergebnis === "object" && ergebnis.updated_date ? { updated_date: ergebnis.updated_date } : {}) };
  // the project may have been opened again meanwhile: then its load (record) is the base, the map follows it
  if (k.record.projectId !== projectId) k.letzteBasisJeProjekt.set(projectId, Promise.resolve(neu));
  return { geschrieben: true };
}

/**
 * 106-09 card of a field both this page and another device changed, and no holder merges it (save race, or a stale holder saved a
 * field another device changed): both versions go to the person; useBimModelSync already holds the field back (feldSperren) until
 * the decision. Review 106-09: the card names the field in words; "keep mine" writes the newest value the holder tried to save;
 * "take the other device's" keeps the stored version and remembers the holder's stale value as base, so a later save of that
 * unchanged stale value is not written (and a further edit on it is a new conflict, never a silent overwrite).
 * Moved here unchanged from useBimModelSync.feldKonfliktMelden in 115-05b (entry chunk budget).
 * @param {SonderwegKern} k @param {string} projectId @param {string} feld @param {any} mein @param {any} fremd
 * @param {any} geraet who wrote the other version
 * @returns {void}
 */
export function feldKonfliktKarte(k, projectId, feld, mein, fremd, geraet) {
  abgleichStand.konfliktMelden({
    quelle: "modell", projektId: projectId, feld, titel: feldName(feld), geraet,
    zeilen: [{ schluessel: null, name: feldName(feld), mein: k.wertKurz(mein), fremd: k.wertKurz(fremd) }],
    fremdHinweis: "Ein Editor, der diesen Teil gerade offen hat, zeigt die übernommene Fassung nach dem erneuten Öffnen.",
    loesen: {
      mein: async () => {
        const wert = k.zurueckgehaltenerWert(projectId, feld, mein);
        k.modellKonflikte.delete(`${projectId}|${feld}`);
        k.vorbehaltWeg(projectId, feld);
        k.feldFreigeben(projectId, feld);
        await k.saveBimModel(projectId, { [feld]: wert });
      },
      fremd: async () => {
        const alt = k.zurueckgehaltenerWert(projectId, feld, mein);
        k.modellKonflikte.delete(`${projectId}|${feld}`);
        k.feldFreigeben(projectId, feld);
        // the base already holds the foreign version; a holder that still shows the stale value takes it over now
        const genommen = k.halterBenachrichtigen(projectId, { patch: { [feld]: fremd }, vorher: { [feld]: alt }, geraet, zeit: null, entscheidung: true });
        if (genommen.has(feld)) k.vorbehaltWeg(projectId, feld);
        else {
          const vbm = k.vorbehalt.get(projectId) || new Map();
          vbm.set(feld, { vorher: alt, geraet });
          k.vorbehalt.set(projectId, vbm);
        }
      },
    },
  });
}

/**
 * A locked "modell" field got a newer own value: the card shows it (the resolvers read the newest value anyway). Moved here
 * unchanged from useBimModelSync in 115-05b (entry chunk budget).
 * @param {SonderwegKern} k @param {string} projectId @param {string} feld @param {any} wert
 * @returns {void}
 */
export function konfliktTextNachziehen(k, projectId, feld, wert) {
  if (!k.modellKonflikte.has(`${projectId}|${feld}`)) return;
  const offen = abgleichStand.konflikt(`modell:${feld}`);
  if (!offen || offen.projektId !== projectId || offen.zeilen[0]?.mein === k.wertKurz(wert)) return;
  abgleichStand.konfliktMelden({ ...offen, zeilen: [{ ...offen.zeilen[0], mein: k.wertKurz(wert) }] });
}
