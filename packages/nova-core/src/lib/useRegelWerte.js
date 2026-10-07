// Read side of the rule books (80-01): effective rule values for components, before
// the editor of 80-07 exists (lane B needs them for contracts, deadlines and the
// minimum wage). Loads all Setting rows once, reloads on EINSTELLUNG_EREIGNIS and
// answers wert(id, stichtag) / details(id, stichtag) through regelWerteAus().
//
// In:  the rule groups (pass a module constant such as REGELWERKE — a new array on
//      every render would recompute the reader each time).
// Out: {wert, details, laden, fehler}. No writes.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bitApi } from "@core/api/bitApi";
import { EINSTELLUNG_EREIGNIS } from "./einstellungen.js";
import { regelWerteAus } from "./regelwerk.js";

/**
 * Effective values of the given rule groups.
 * @param {ReadonlyArray<import("./regelwerk.js").RegelGruppe>} gruppen module constant
 * @returns {{
 *   wert: (id: string, stichtag?: string) => any,
 *   details: (id: string, stichtag?: string) => any,
 *   laden: boolean,
 *   fehler: string|null,
 * }} `stichtag` defaults to today on this device ('YYYY-MM-DD'); unknown ids give null.
 *   While loading (and after a load error) the standard values apply.
 */
export function useRegelWerte(gruppen) {
  const [zeilen, setZeilen] = useState(/** @type {any[]|null} */ (null));
  const [fehler, setFehler] = useState(/** @type {string|null} */ (null));
  const aktiv = useRef(true);

  const laden = useCallback(async () => {
    try {
      const rows = await /** @type {any} */ (bitApi.entities).Setting.list();
      if (!aktiv.current) return;
      setZeilen(Array.isArray(rows) ? [...rows] : []);
      setFehler(null);
    } catch (e) {
      if (!aktiv.current) return;
      setZeilen((z) => z ?? []);
      setFehler(/** @type {any} */ (e)?.message || String(e));
    }
  }, []);

  useEffect(() => {
    aktiv.current = true;
    laden();
    const beiAenderung = () => { laden(); };
    window.addEventListener(EINSTELLUNG_EREIGNIS, beiAenderung);
    return () => {
      aktiv.current = false;
      window.removeEventListener(EINSTELLUNG_EREIGNIS, beiAenderung);
    };
  }, [laden]);

  const leser = useMemo(() => regelWerteAus(gruppen, zeilen || []), [gruppen, zeilen]);
  return { wert: leser.wert, details: leser.details, laden: zeilen === null, fehler };
}
