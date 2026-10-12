// State of the /TimeTracking page shared by its tabs (phase 81-02): the persons
// that can book (80 records through the adapter, plus the virtual owner when 80
// has none, E-17), the device's choice "Stunden für", the rule values of the
// group zeit_honorar (E-16) and a booking writer that derives month and week.
//
// In:  the page loader object of useZeitHonorar. Out: the object described by
//      the typedef below. Side effects: remembers the chosen person in
//      localStorage (try/catch, src/lib/zeit/timer.js).

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRegelWerte } from "@core/lib/useRegelWerte";
import { feiertage as feiertageLand } from "@core/lib/kalender/feiertage.js";
import { DATENQUELLE } from "@core/lib/umgebung";
import { useAuth } from "@core/lib/AuthContext";
import { kalenderEinstellung } from "@/lib/abwesenheit/kalenderRegeln.js";
import { ladeAbwesenheitsDaten } from "@/lib/people/bueroOrgaPersonal.js";
import { REGELWERKE } from "@/lib/settings/regelwerke.js";
import { ableiten } from "@/lib/zeit/zeitbuchung.js";
import { aktiverVertrag, INHABER_ID, personenFuerZeiterfassung } from "@/lib/zeit/personalQuelle.js";
import { geraeteSpeicher, lesePersonWahl, merkePersonWahl } from "@/lib/zeit/timer.js";

/**
 * Everything a tab of /TimeTracking receives as prop `zz` (next to `zh`).
 * @typedef {{
 *   personen: Array<Record<string, any>>,
 *   personId: string,
 *   setPersonId: (id: string) => void,
 *   person: Record<string, any>|null,
 *   regeln: {raster: number, tagessoll: number, bearbeitbarTage: number, freigabePflicht: boolean, tagesrahmen: boolean, aufbewahrungJahre: number|null},
 *   feiertage: Array<{datum: string, name: string}>,
 *   abwesenheiten: Array<Record<string, any>>,
 *   vertragAm: (mitarbeiterId: string, tagIso: string) => Record<string, any>|null,
 *   speichereBuchung: (obj: Record<string, any>) => Promise<Record<string, any>>,
 * }} Zeiterfassung
 */

/**
 * @param {import("@/components/zeitHonorar/useZeitHonorar.js").ZeitHonorar} zh
 * @returns {Zeiterfassung}
 */
export function useZeiterfassung(zh) {
  const { wert } = useRegelWerte(REGELWERKE);
  const personen = useMemo(() => personenFuerZeiterfassung(zh.personal.mitarbeiter, zh.heute), [zh.personal.mitarbeiter, zh.heute]);
  const [gewaehlt, setGewaehlt] = useState(() => lesePersonWahl(geraeteSpeicher()));
  const personId = personen.some((p) => p.id === gewaehlt) ? /** @type {string} */ (gewaehlt) : (personen[0]?.id ?? INHABER_ID);
  const person = personen.find((p) => p.id === personId) || null;

  const setPersonId = useCallback((/** @type {string} */ id) => {
    setGewaehlt(id);
    merkePersonWahl(geraeteSpeicher(), id);
  }, []);

  // Keep the stored choice valid once the person list is known (a removed person falls back).
  useEffect(() => {
    if (gewaehlt && personen.length && !personen.some((p) => p.id === gewaehlt) && !zh.laedt) merkePersonWahl(geraeteSpeicher(), personId);
  }, [gewaehlt, personen, personId, zh.laedt]);

  const jahr = Number(zh.heute.slice(0, 4));
  // 82-04 (E-16): one holiday setting for absences, month grid and time tracking — the rule
  // group "Kalender & Abwesenheiten"; KALENDER_STANDARD is only its default value.
  const einst = kalenderEinstellung(wert);
  const einstSchluessel = JSON.stringify(einst);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const feiertage = useMemo(() => [jahr - 1, jahr, jahr + 1].flatMap((j) => feiertageLand(j, einst)), [jahr, einstSchluessel]);

  // 82-04: approved absences lower the target (sollIst) — read through 82-01's adapter only.
  const { user } = useAuth();
  const [abwesenheiten, setAbwesenheiten] = useState(/** @type {any[]} */ ([]));
  useEffect(() => {
    let aktiv = true;
    ladeAbwesenheitsDaten({ datenquelle: DATENQUELLE, rolle: user?.role ?? null })
      .then((d) => { if (aktiv) setAbwesenheiten((d.abwesenheiten || []).filter((a) => a?.status === "genehmigt")); })
      .catch(() => { /* the adapter reports itself; without data the target stays as in 81 */ });
    return () => { aktiv = false; };
  }, [user?.role]);

  const regeln = {
    raster: Number(wert("zeit_honorar.raster")) || 15,
    tagessoll: Number(wert("zeit_honorar.tagessoll")) || 0,
    bearbeitbarTage: Number(wert("zeit_honorar.bearbeitbar_tage") ?? 14),
    freigabePflicht: wert("zeit_honorar.freigabe_pflicht") !== false,
    tagesrahmen: wert("zeit_honorar.tagesrahmen") !== false,
    aufbewahrungJahre: typeof wert("buchhaltung.aufbewahrung_belege") === "number" ? wert("buchhaltung.aufbewahrung_belege") : null,
  };

  const vertragAm = useCallback(
    (/** @type {string} */ mitarbeiterId, /** @type {string} */ tagIso) => (mitarbeiterId === INHABER_ID ? null : aktiverVertrag(zh.personal.vertraege, mitarbeiterId, tagIso)),
    [zh.personal.vertraege],
  );

  const { speichere } = zh;
  const speichereBuchung = useCallback((/** @type {Record<string, any>} */ obj) => speichere("Zeitbuchung", ableiten(obj)), [speichere]);

  return { personen, personId, setPersonId, person, regeln, feiertage, vertragAm, speichereBuchung, abwesenheiten };
}
