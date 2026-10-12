// Term source "postbuch" (phase 82, filled by 82-05): reply deadlines of open
// incoming mail (Postbucheintrag.frist) through the pure rule
// @core/lib/brief/postbuch.js fristenAusPostbuch. The entries are read through
// the office store only (bueroEntitaet, E-03): in a cloud build without the
// release, the registry's availability check stops the source before `laden`
// runs (module schriftverkehr in CLOUD_GESPERRT), and the store would refuse anyway.
//
// In:  api, ctx.datenquelle/freigabe. Out: QUELLE for quellenRegistry.js.

import { fristenAusPostbuch } from "@core/lib/brief/postbuch.js";
import { bueroEntitaet } from "@/lib/bueroOrga/speicher.js";

/** @type {import("../quellenRegistry.js").TerminQuelle} */
export const QUELLE = Object.freeze({
  key: "postbuch",
  label: "Postbuch",
  modul: "schriftverkehr",
  standardAn: true,
  laden: async (/** @type {any} */ api, /** @type {any} */ ctx) => {
    const speicher = bueroEntitaet(api, "Postbucheintrag", { datenquelle: ctx?.datenquelle, ...(ctx?.freigabe !== undefined ? { freigabe: ctx.freigabe } : {}) });
    return (await speicher.list()) || [];
  },
  berechnen: (/** @type {any[]} */ eintraege) => fristenAusPostbuch(eintraege),
});
