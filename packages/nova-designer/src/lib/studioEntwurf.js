// 115-05c (§6.3): the BIM studio as a source of the draft - loaded lazily (the designer chunk is at its size budget), the studio
// keeps only the wiring.
//   studioMelden        reports the studio's values against its stored image (abbild) with the stand and the `_idx` numbers of the
//                       cached base record (renumbering on a rebase needs the full base, 115-05a A-1)
//   studioEinspielen    puts a draft into the freshly loaded studio: the draft fits the stored record → its values on top;
//                       another state of the same record → the draft's values on its OLD base, then the stored state goes through
//                       the studio's own holder of foreign changes (renumbering of local new elements, three ways per element,
//                       conflict cards, undo snapshots - the tested path of 115-05a/b); another record / record gone → nothing is
//                       continued automatically, the draft waits for the person (offen)
//
// In:  the draft module (entwurfStand.js), the studio's load and holder functions. Out: see above.

import { gleichWert } from "@core/lib/abgleich/dreiWege.js";
import { IDX_LISTEN } from "@core/lib/abgleich/idxListen.js";
import { entwurfEntscheiden } from "@core/lib/entwurf/modellEntwurf.js";
import { STUDIO_ENTWURF_FELDER } from "@core/lib/entwurf/entwurfStand.js";

/** @param {any} v @returns {number[]} */
const idxVon = (v) => (Array.isArray(v) ? v.map((e) => e?._idx).filter((x) => typeof x === "number") : []);
/** @param {Record<string, any>|null|undefined} o @param {ReadonlyArray<string>} felder @returns {Record<string, any>} */
const auswahl = (o, felder) => Object.fromEntries(felder.filter((k) => o && k in o).map((k) => [k, o?.[k]]));

/**
 * Reports the studio's values to the draft.
 * @param {typeof import("@core/lib/entwurf/entwurfStand.js")} E the draft module
 * @param {string} pid project
 * @param {Record<string, any>} werte the studio's values (studioWerteAusDatensatz representation)
 * @param {Record<string, any>|null} abbild the stored state in the same representation
 * @param {any} rec the cached stored record (id, updated_date, lists)
 */
export function studioMelden(E, pid, werte, abbild, rec) {
  if (!abbild) return;
  E.melden(pid, "bim", {
    stand: rec ? { id: rec.id ?? null, updated_date: rec.updated_date ?? null } : { id: null, updated_date: null },
    basis: abbild, werte, felder: STUDIO_ENTWURF_FELDER,
    idx: Object.fromEntries(IDX_LISTEN.map((l) => [l, idxVon(rec?.[l] ?? abbild?.[l])])),
  });
}

/**
 * Puts the draft of the project into the freshly loaded studio.
 * @param {{E: typeof import("@core/lib/entwurf/entwurfStand.js"), pid: string, entwurf: import("@core/lib/entwurf/modellEntwurf.js").ModellEntwurf,
 *   gespeichert: any, modellLaden: (m: any, o?: any) => Record<string, any>, abbildSetzen: (w: Record<string, any>) => void,
 *   bild: (m: any) => Record<string, any>, halter: ((pid: string, f: any) => any)|null}} a
 *   gespeichert = the stored record just loaded (null = none); modellLaden / abbildSetzen / bild = the studio's load, its image ref
 *   and studioWerteAusDatensatz; halter = the studio's holder of foreign changes
 * @returns {"leer"|"gleich"|"rebase"|"offen"} what happened
 */
export function studioEinspielen({ E, pid, entwurf, gespeichert, modellLaden, abbildSetzen, bild, halter }) {
  const mein = auswahl(entwurf.aenderungen.bim, STUDIO_ENTWURF_FELDER);
  if (!Object.keys(mein).length) return "leer";
  const basis = entwurf.basis.bim;
  const wahl = entwurfEntscheiden(basis, gespeichert);
  if (wahl === "ersetzt" || wahl === "geloescht") { E.offenSetzen(pid, wahl); return "offen"; }
  const server = gespeichert || {};
  if (wahl === "gleich") { modellLaden({ ...server, ...mein }, { nurStudioFelder: true }); return "gleich"; }
  // another state of the same record: mine on the OLD base, the image = that old base; the stored state comes in as foreign
  const alteBasis = { ...server, ...auswahl(basis?.felder, Object.keys(mein)) };
  modellLaden({ ...alteBasis, ...mein }, { nurStudioFelder: true });
  abbildSetzen(bild(alteBasis));
  const anders = Object.keys(mein).filter((k) => !gleichWert(basis?.felder?.[k], server[k]));
  if (anders.length && halter) {
    halter(pid, { patch: auswahl(server, anders), vorher: Object.fromEntries(anders.map((k) => [k, basis?.felder?.[k]])),
      basis: alteBasis, stand: { id: server.id ?? null, updated_date: server.updated_date ?? null }, geraet: { name: "", unbekannt: true }, zeit: null });
  }
  return "rebase";
}
