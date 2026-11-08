// bauherrModellAbgleich.js — keeps the client's 3D file in step with the BIM
// model (Phase 110-05, 08.11.2026).
//
// Rule (user, 08.11.: "es gibt nur eine Wahrheit"): while the building model is
// released to the client (projection BauherrModell, freigegeben), the client's
// file is the CURRENT studio scene. The BIM studio calls bauherrModellNachziehen
// when it opens and after every saved model change; this module decides whether
// the file is behind the model (no file yet, or its `stand` older than the
// record's updated_date), writes the GLB and refreshes the release with the new
// date. Nothing happens without an active release.
//
// Where the file lives: cloud — bucket `freigaben` (<org>/<project>/_bauherr/<name>,
// read by the client through the edge function `freigabe`); local data paths —
// the blob store (bitApi.blobs, id from lokaleModellBlobId), read by the office
// preview "Ansicht als … Bauherr".
//
// In:  project id, the studio scene groups. Out: a status word.
// Side effects: entity reads, one storage/blob write, one release (RPC or local row).

import { bitApi } from "@core/api/bitApi";
import { bauherrDateiAblegen, bauherrFreigeben } from "@core/api/zugriff";
import { bauherrDateiname, projektionAus } from "@core/lib/bauherrProjektion";
import { DATENQUELLE } from "@core/lib/umgebung";
import { szeneAlsGlb } from "./bauherrModell3d.js";

/**
 * Blob id of the local copy of a client model file (blob store alphabet: letters, digits, dash, underscore).
 * @param {string} name file name of the release (`datei`)
 * @returns {string}
 */
export function lokaleModellBlobId(name) {
  return `bauherr-${String(name || "").replace(/[^A-Za-z0-9_-]/g, "-")}`;
}

/**
 * Whether the released file is behind the model.
 * @param {{datei?: string|null, stand?: string|null}|null|undefined} freigabe projection row BauherrModell
 * @param {{updated_date?: string|null}|null|undefined} modell BimModel record
 * @returns {boolean} true: no file yet, or the model was saved after the file was written
 */
export function modellDateiVeraltet(freigabe, modell) {
  if (!freigabe?.datei) return true;
  const geaendert = Date.parse(String(modell?.updated_date || ""));
  const stand = Date.parse(String(freigabe.stand || ""));
  // A record without a change date (old data): the existing file stands.
  if (!Number.isFinite(geaendert)) return false;
  return !Number.isFinite(stand) || geaendert > stand;
}

/** @param {Blob} blob @returns {Promise<string>} data URL */
const alsDataUrl = (blob) => new Promise((ok, fehler) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result));
  r.onerror = () => fehler(r.error || new Error("Datei nicht lesbar."));
  r.readAsDataURL(blob);
});

/** One run per project at a time: a save during an export queues exactly one more run. @type {Map<string, Promise<string>>} */
const laeuft = new Map();

/**
 * Brings the client's 3D file up to the current studio scene when the model is released and the file is behind.
 * @param {{ projektId: string|null, gruppen: Array<import("three").Object3D|null|undefined> }} p
 *   gruppen: the studio's buildingGroup and customGroup as they are NOW
 * @returns {Promise<"kein-projekt"|"kein-modell"|"keine-freigabe"|"aktuell"|"erneuert">}
 * @throws {Error} plain text when writing the file or the release fails
 */
export async function bauherrModellNachziehen({ projektId, gruppen }) {
  if (!projektId) return "kein-projekt";
  const vorher = laeuft.get(projektId);
  const lauf = (async () => {
    if (vorher) await vorher.catch(() => {});
    const [modelle, freigaben] = await Promise.all([
      bitApi.entities.BimModel.filter({ project_id: projektId }),
      bitApi.entities.BauherrModell.filter({ project_id: projektId }),
    ]);
    const modell = (modelle || [])[0] || null; // one record per project, as loadBimModel reads it
    if (!modell) return "kein-modell";
    const freigabe = (freigaben || []).find((/** @type {any} */ f) => f.freigegeben === true && f.quelle_id === modell.id) || null;
    if (!freigabe) return "keine-freigabe";
    if (!modellDateiVeraltet(freigabe, modell)) return "aktuell";

    const glb = await szeneAlsGlb(gruppen);
    const name = bauherrDateiname(`${modell.id}-modell.glb`);
    if (!name) throw new Error("Kein zulässiger Dateiname für das Gebäudemodell.");
    if (DATENQUELLE === "supabase") await bauherrDateiAblegen(projektId, name, glb);
    else await bitApi.blobs.put(lokaleModellBlobId(name), { inhalt: await alsDataUrl(glb) });

    // `stand` = the later of now and the model's change date, so a clock behind the server cannot leave the file "behind" forever.
    const geaendert = Date.parse(String(modell.updated_date || ""));
    const stand = new Date(Math.max(Date.now(), Number.isFinite(geaendert) ? geaendert : 0)).toISOString();
    const inhalt = { ...(projektionAus("BauherrModell", "BimModel", modell) || {}), stand };
    await bauherrFreigeben("BauherrModell", modell.id, inhalt, name, projektId);
    return "erneuert";
  })();
  laeuft.set(projektId, lauf);
  try {
    return /** @type {any} */ (await lauf);
  } finally {
    if (laeuft.get(projektId) === lauf) laeuft.delete(projektId);
  }
}
