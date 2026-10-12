// Counter at the menu entry "Fristen & Termine" (phase 82, 82-06, FRIST-05):
// overdue + today, the same number the page shows (one function, zaehleFaellige
// on filterNachZugriff). Loads only the standard sources (never delivery plan or
// schedule — portfolio load), once per session, again on window focus at most
// every 5 minutes, and at once when the role changes ("Ansicht als"). A load
// error shows no badge and is reported in plain text in the console.
//
// In:  nothing (contexts). Out: useFaelligZaehler() → number|null.

import { useEffect, useRef, useState } from "react";
import { bitApi } from "@core/api/bitApi";
import { useAuth } from "@core/lib/AuthContext";
import { heuteLokal, plusTage } from "@core/lib/kalender/datum.js";
import { DATENQUELLE } from "@core/lib/umgebung";
import { useZugriff } from "@core/lib/ZugriffContext.jsx";
import { useRegelWerte } from "@core/lib/useRegelWerte";
import { REGELWERKE } from "@/lib/settings/regelwerke.js";
import { ladeTermine } from "@/lib/termine/quellenRegistry.js";
import { filterNachZugriff, zaehleFaellige } from "@/lib/termine/termineAnsicht.js";

/** Minimum pause between two loads triggered by window focus, ms. */
const PAUSE_MS = 5 * 60 * 1000;

/** @returns {number|null} due count, null while unknown or after an error */
export function useFaelligZaehler() {
  const zugriff = useZugriff();
  const { user } = useAuth();
  // Same rule values as the page (warranty periods, lead times) — otherwise the counts differ.
  const { wert, laden: regelnLaden } = useRegelWerte(REGELWERKE);
  const [anzahl, setAnzahl] = useState(/** @type {number|null} */ (null));
  const zuletzt = useRef(0);
  // The project view is part of the key: the assignments arrive after the server role,
  // so the same user first has no restriction and then one — the count must follow.
  const sicht = zugriff.projektIds ? [...zugriff.projektIds].sort().join(",") : "alle";
  const rollenSchluessel = `${zugriff.rolle}|${zugriff.nutzer?.id || ""}|${zugriff.darf("fristen") ? 1 : 0}|${sicht}`;

  useEffect(() => {
    if (regelnLaden) return undefined;
    let aktiv = true;
    const laden = async () => {
      zuletzt.current = Date.now();
      if (!zugriff.darf("fristen")) { setAnzahl(null); return; }
      try {
        const heute = heuteLokal();
        const { termine } = await ladeTermine(bitApi, { von: /** @type {string} */ (plusTage(heute, -365)), bis: /** @type {string} */ (plusTage(heute, 1)), heute, regelWert: (/** @type {string} */ id) => wert(id), datenquelle: DATENQUELLE, rolle: user?.role ?? null, zugriff });
        if (aktiv) setAnzahl(zaehleFaellige(filterNachZugriff(termine, zugriff), heute));
      } catch (e) {
        console.error(`Fällig-Zähler konnte nicht geladen werden: ${/** @type {any} */ (e)?.message || e}`);
        if (aktiv) setAnzahl(null);
      }
    };
    laden();
    const beiFokus = () => { if (Date.now() - zuletzt.current >= PAUSE_MS) laden(); };
    window.addEventListener("focus", beiFokus);
    return () => { aktiv = false; window.removeEventListener("focus", beiFokus); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rollenSchluessel, user?.role, regelnLaden]);

  return anzahl;
}
