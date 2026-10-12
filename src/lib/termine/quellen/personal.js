// Term source "personal" (phase 82, 82-03): the HR deadlines of phase 80
// (personalFristen in src/lib/people/fristen.js — probation end, contract end,
// the leave notice on 30.09. …). 82 shows them, 80 computes and acknowledges
// them: "Erledigt" writes 80's Fristquittung (one truth per deadline,
// D-P82-40), never a Terminquittung; personalFristen then leaves the entry out.
//
// Loaded and acknowledged ONLY through the phase-82 adapter
// src/lib/people/bueroOrgaPersonal.js (the 80-02 leak guard stays unchanged).
// A person is named by the personnel number only, never by name (DS-07): the
// agenda is visible to everyone with the HR right, in a shared office too.
//
// In:  ctx {heute, regelWert, datenquelle, rolle}. Out: QUELLE for quellenRegistry.js.

import { personalFristen, FRIST_QUELLEN } from "@/lib/people/fristen.js";
import { ladePersonalFristDaten, quittierePersonalFrist } from "@/lib/people/bueroOrgaPersonal.js";

/**
 * Personnel number of the person a deadline refers to (via the person or the contract).
 * @param {{bezug: {id: string}}} frist
 * @param {Record<string, any[]>} daten
 * @returns {string}
 */
function personalnummer(frist, daten) {
  const id = frist?.bezug?.id;
  const person = (daten.Mitarbeiter || []).find((m) => m?.id === id)
    || (daten.Mitarbeiter || []).find((m) => m?.id === (daten.Arbeitsvertrag || []).find((v) => v?.id === id)?.mitarbeiter_id);
  return person?.personalnummer || "";
}

/** @type {import("../quellenRegistry.js").TerminQuelle} */
export const QUELLE = Object.freeze({
  key: "personal",
  label: "Personalfristen",
  modul: "personal",
  standardAn: true,
  // `api` is bitApi (or a test fake with the same shape); the adapter reads its `personal` part.
  laden: async (/** @type {any} */ api, /** @type {any} */ ctx) => ladePersonalFristDaten({ datenquelle: ctx.datenquelle, rolle: ctx.rolle }, { api }),
  berechnen: (/** @type {Record<string, any[]>} */ daten, /** @type {any} */ ctx) => {
    if (!daten || !Array.isArray(daten.Mitarbeiter)) return [];
    return personalFristen(daten, ctx.heute, ctx.regelWert || (() => null)).map((f) => {
      const schluessel = `${f.art}:${f.bezug.id}:${f.faellig_am}`;
      const label = FRIST_QUELLEN.find((q) => q.art === f.art)?.label || f.art;
      // Staff: personnel number; applications and other references: their record id (B-1 …).
      const nr = personalnummer(f, daten) || (f.anzahl ? "" : String(f.bezug?.id || ""));
      return {
        id: `personal:${schluessel}`,
        quelle: "personal", art: "personal_frist", klasse: /** @type {"frist"} */ ("frist"), datum: f.faellig_am,
        project_id: null, modul: "personal", objekt: nr ? `${label} · ${nr}` : (f.anzahl ? `${label} · ${f.anzahl}` : label),
        ziel: `/People?tab=${f.bezug.tab || "contracts"}`, herkunft: f.norm, schluessel,
      };
    });
  },
  quittiere: async (/** @type {any} */ api, /** @type {any} */ termin, /** @type {{jetzt: string}} */ { jetzt }) => quittierePersonalFrist(termin.schluessel, { jetzt, api }),
});
