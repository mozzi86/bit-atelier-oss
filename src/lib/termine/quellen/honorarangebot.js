// Term source "honorarangebot" (phase 82, 82-03): the validity end of every sent
// fee offer as phase 81 lists it (angebotsFristen in src/lib/honorar/angebot.js).
// Read through the 81 storage layer. Dates are calendar days.
//
// In:  api, ctx.heute. Out: QUELLE for quellenRegistry.js.

import { terminId } from "@core/lib/kalender/termin.js";
import { ladeZeitHonorar } from "@/lib/zeitHonorar/speicher.js";
import { angebotsFristen } from "@/lib/honorar/angebot.js";

/** @type {import("../quellenRegistry.js").TerminQuelle} */
export const QUELLE = Object.freeze({
  key: "honorarangebot",
  label: "Honorarangebote",
  modul: "auftrag",
  standardAn: true,
  laden: async (/** @type {any} */ api) => (await ladeZeitHonorar(api, { entitaeten: ["Honorarangebot"] })).Honorarangebot || [],
  berechnen: (/** @type {any[]} */ angebote, /** @type {any} */ ctx) => {
    const nachNummer = new Map((angebote || []).map((a) => [a.nummer, a]));
    return angebotsFristen(angebote, ctx.heute).map((f) => ({
      id: terminId("honorarangebot", nachNummer.get(f.objekt)?.id || f.objekt, "ablauf"),
      quelle: "honorarangebot", art: "honorarangebot_ablauf", klasse: /** @type {"frist"} */ ("frist"),
      datum: f.datum, project_id: f.project_id, modul: "auftrag", objekt: String(f.objekt || ""), ziel: f.ziel,
    }));
  },
});
