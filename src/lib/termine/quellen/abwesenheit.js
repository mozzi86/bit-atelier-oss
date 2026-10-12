// Term source "abwesenheit" (phase 82, filled by 82-04): approved absences as
// hints in "Fristen & Termine" — with the person's initials and WITHOUT the
// kind. The agenda shows everybody only "abwesend", never the reason; even the
// owner sees the reason only on the absences page, so a shared list reveals
// nothing (E-14). Requested, rejected and cancelled absences give no term; the
// .ics export leaves this source out (82-01, alsIcs).
//
// Absences and persons come through 82-01's adapter (personnel storage class,
// never named here directly), the users for the initials through the office store.
//
// In:  api, ctx {datenquelle, rolle, heute}. Out: QUELLE for quellenRegistry.js.

import { ladeAbwesenheitsDaten } from "@/lib/people/bueroOrgaPersonal.js";
import { bueroEntitaet, verfuegbar } from "@/lib/bueroOrga/speicher.js";
import { kuerzelVon } from "@/lib/abwesenheit/abwesenheitAnsicht.js";

/** @type {import("../quellenRegistry.js").TerminQuelle} */
export const QUELLE = Object.freeze({
  key: "abwesenheit",
  label: "Abwesenheiten",
  modul: "abwesenheiten",
  standardAn: true,
  laden: async (/** @type {any} */ api, /** @type {any} */ ctx) => {
    const d = await ladeAbwesenheitsDaten({ datenquelle: ctx?.datenquelle, rolle: ctx?.rolle }, { api });
    const nutzer = verfuegbar(ctx?.datenquelle) ? (await bueroEntitaet(api, "Nutzer", { datenquelle: ctx?.datenquelle }).list()) || [] : [];
    return { abwesenheiten: d.abwesenheiten, mitarbeiter: d.mitarbeiter, nutzer };
  },
  berechnen: (/** @type {any} */ daten, /** @type {any} */ ctx) => {
    const heute = String(ctx?.heute || "");
    return (daten?.abwesenheiten || [])
      .filter((a) => a && a.status === "genehmigt" && a.von && (a.bis || a.von) >= heute)
      .map((a) => {
        const person = (daten.mitarbeiter || []).find((m) => m?.id === a.mitarbeiter_id) || { id: a.mitarbeiter_id };
        return {
          id: `abwesenheit:${a.id}`,
          quelle: "abwesenheit",
          art: "abwesenheit",
          klasse: /** @type {'hinweis'} */ ("hinweis"),
          // An absence already running shows on today.
          datum: a.von < heute ? heute : a.von,
          bis: a.bis || a.von,
          zeit: null,
          dauer_min: null,
          project_id: null,
          modul: "abwesenheiten",
          objekt: kuerzelVon(person, daten.nutzer || []),
          ziel: "/Absences?tab=team",
        };
      });
  },
});
