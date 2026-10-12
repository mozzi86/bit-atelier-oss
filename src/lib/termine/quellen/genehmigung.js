// Term source "genehmigung" (88-04): the statutory deadlines of every permit
// procedure (completeness check, deemed permit, waiting period, validity, requested
// additions) and the deadlines of the conditions. The dates are guide values of
// the building code — every term carries its legal source and `annahme: true`.
//
// In:  api (Genehmigung, Auflage lists). Out: QUELLE for quellenRegistry.js.

import { terminId } from "@core/lib/kalender/termin.js";
import { auflagenFristen, fristenVon, ARTEN } from "@/lib/werkplanung/genehmigungen.js";

const ZIEL = "/Werkplanung?tab=genehmigungen";

/** @param {Record<string, any>} g */
const objekt = (g) => [ARTEN.find((a) => a.key === g.art)?.label, g.aktenzeichen].filter(Boolean).join(" · ") || String(g.id);

/** @type {import("../quellenRegistry.js").TerminQuelle} */
export const QUELLE = Object.freeze({
  key: "genehmigung",
  label: "Genehmigungen und Auflagen",
  modul: "planung",
  standardAn: true,
  laden: async (/** @type {any} */ api) => {
    const [genehmigungen, auflagen] = await Promise.all([api.entities.Genehmigung.list(), api.entities.Auflage.list()]);
    return { genehmigungen: genehmigungen || [], auflagen: auflagen || [] };
  },
  berechnen: (/** @type {{genehmigungen?: any[], auflagen?: any[]}} */ roh) => {
    const genehmigungen = (roh?.genehmigungen || []).filter((g) => g?.id);
    const verfahren = genehmigungen.flatMap((g) => fristenVon(g).map((f) => ({
      id: terminId("genehmigung", g.id, f.schluessel),
      quelle: "genehmigung", art: "genehmigung_frist", klasse: /** @type {"frist"} */ ("frist"), datum: f.datum,
      project_id: g.project_id || null, modul: "planung", objekt: `${objekt(g)}: ${f.label}`, ziel: ZIEL,
      herkunft: f.herkunft, annahme: f.schluessel !== "nachforderung", erledigt: f.erledigt,
    })));
    const auflagen = auflagenFristen((roh?.auflagen || []).filter((a) => a?.id)).map(({ auflage, datum, erledigt }) => ({
      id: terminId("genehmigung", auflage.id, "auflage"),
      quelle: "genehmigung", art: "auflage_frist", klasse: /** @type {"frist"} */ ("frist"), datum,
      project_id: auflage.project_id || null, modul: "planung", objekt: [auflage.nr, auflage.text].filter(Boolean).join(" ").slice(0, 80) || String(auflage.id), ziel: ZIEL,
      erledigt,
    }));
    return [...verfahren, ...auflagen];
  },
});
