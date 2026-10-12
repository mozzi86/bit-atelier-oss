// ZugriffContext.jsx — the access context of the app (phase 82, RECHT-02).
//
// Rights in the client are order and overview, not access security (see rechte.js).
//
// Without a provider (or before its data are there) every reader gets
// ZUGRIFF_RUECKFALL: the owner with every office module (E-17, the sole-owner
// path), only the cloud lock of E-03 applies (none with the release E-20). So
// nothing disappears from the menu when the app updates.
//
// 82-02: the provider gets its data through an injected loader `lade` (@core
// may not import src/; users, the rights setting and the assignment projection
// come through the app's stores) and computes the value with the pure
// ermittleZugriff. "Ansicht als …" (D-P82-19) switches the active user record
// per device (localStorage, try/catch — without storage the session starts as
// owner); it is no sign-in and protects nothing on this device. The provider
// reloads on 'bueroOrga:geaendert', on EINSTELLUNG_EREIGNIS and when the window
// regains focus (after editing assignments in /People). A load error falls
// back to the owner AND is shown (ladeFehler), never swallowed.
//
// In:  React children; props lade (async loader) or wert (fixed value, tests).
// Out: ZugriffKontext, mitHelfern, ZUGRIFF_RUECKFALL, ZugriffProvider,
//      useZugriff, useErlaubteReiter, BUERO_ORGA_EREIGNIS.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { DATENQUELLE } from "./umgebung.js";
import { baueZugriff, darf, darfProjekt } from "./rechte.js";
import { ANSICHT_ALS_SCHLUESSEL, ermittleZugriff } from "./zugriffErmitteln.js";
import { useAuth } from "./AuthContext";
import { EINSTELLUNG_EREIGNIS } from "./einstellungen.js";

/** Window event after office-organisation data changed (users, sample). */
export const BUERO_ORGA_EREIGNIS = "bueroOrga:geaendert";

/**
 * Access plus bound helpers, what useZugriff() returns.
 * @typedef {import("./rechte.js").Zugriff & {
 *   darf: (modul: string, stufe?: 'lesen'|'voll') => boolean,
 *   darfProjekt: (projectId: string|null|undefined) => boolean,
 *   wechsleNutzer: (nutzerId: string|null) => void,
 *   nutzerListe?: Array<Record<string, any>>,
 *   kannWechseln?: boolean,
 *   ladeFehler?: string|null,
 *   neuLaden?: () => Promise<void>,
 *   zuordnungen?: Array<{mitarbeiter_id: string, alle: boolean, zuordnungen: Array<{project_id: string, funktion: string|null, von: string|null, bis: string|null}>}>,
 * }} ZugriffWert
 */

/** @type {React.Context<ZugriffWert|null>} */
export const ZugriffKontext = createContext(/** @type {ZugriffWert|null} */ (null));

/**
 * @param {import("./rechte.js").Zugriff} z
 * @param {(nutzerId: string|null) => void} [wechsleNutzer]
 * @param {Record<string, any>} [extra] nutzerListe, kannWechseln, ladeFehler, neuLaden
 * @returns {ZugriffWert}
 */
export function mitHelfern(z, wechsleNutzer = () => {}, extra = {}) {
  return { ...z, ...extra, darf: (m, s = "lesen") => darf(z, m, s), darfProjekt: (id) => darfProjekt(z, id), wechsleNutzer };
}

/** Fallback without provider: owner, all modules except the cloud lock. */
export const ZUGRIFF_RUECKFALL = Object.freeze(mitHelfern(baueZugriff({ rolle: "inhaber", datenquelle: DATENQUELLE })));

/** @returns {string|null} the stored "Ansicht als" id of this device */
function gespeicherteId() {
  try { return localStorage.getItem(ANSICHT_ALS_SCHLUESSEL); } catch { return null; }
}

/**
 * Data the loader delivers.
 * @typedef {{nutzer: Array<Record<string, any>>, einstellung: Record<string, any>|null, zuordnungen: Array<any>}} ZugriffDaten
 */

/**
 * Access provider. With `wert` it passes a fixed value (tests); with `lade` it
 * loads users, rights setting and assignments and computes the access.
 * @param {{
 *   children?: React.ReactNode, wert?: ZugriffWert|null,
 *   lade?: ((kontext: {datenquelle: string, rolle: string|null, stichtagIso: string}) => Promise<ZugriffDaten>)|null,
 * }} props
 * @returns {React.ReactElement}
 */
export function ZugriffProvider({ children, wert = null, lade = null }) {
  const { user } = useAuth();
  const [daten, setDaten] = useState(/** @type {ZugriffDaten|null} */ (null));
  const [ladeFehler, setLadeFehler] = useState(/** @type {string|null} */ (null));
  const [nutzerId, setNutzerId] = useState(gespeicherteId);

  const serverRolle = user ? { role: user.role, buero_rolle: user.buero_rolle } : null;
  const neuLaden = useCallback(async () => {
    if (!lade) return;
    try {
      const heute = new Date();
      const stichtagIso = `${heute.getFullYear()}-${String(heute.getMonth() + 1).padStart(2, "0")}-${String(heute.getDate()).padStart(2, "0")}`;
      setDaten(await lade({ datenquelle: DATENQUELLE, rolle: user?.role ?? null, stichtagIso }));
      setLadeFehler(null);
    } catch (fehler) {
      const text = /** @type {any} */ (fehler)?.message || String(fehler);
      console.error(`Rechte konnten nicht geladen werden: ${text}`);
      setLadeFehler(text);
    }
  }, [lade, user?.role]);

  useEffect(() => {
    if (!lade) return undefined;
    neuLaden();
    const neu = () => { neuLaden(); };
    window.addEventListener(BUERO_ORGA_EREIGNIS, neu);
    window.addEventListener(EINSTELLUNG_EREIGNIS, neu);
    window.addEventListener("focus", neu);
    return () => {
      window.removeEventListener(BUERO_ORGA_EREIGNIS, neu);
      window.removeEventListener(EINSTELLUNG_EREIGNIS, neu);
      window.removeEventListener("focus", neu);
    };
  }, [lade, neuLaden]);

  const wechsleNutzer = useCallback((/** @type {string|null} */ id) => {
    if (DATENQUELLE === "supabase") return;
    setNutzerId(id);
    try {
      if (id) localStorage.setItem(ANSICHT_ALS_SCHLUESSEL, id);
      else localStorage.removeItem(ANSICHT_ALS_SCHLUESSEL);
    } catch { /* storage blocked — the choice lasts for this session */ }
  }, []);

  const berechnet = useMemo(() => {
    if (!lade) return null;
    const r = ermittleZugriff({
      user, serverRolle, nutzerListe: daten?.nutzer || [], zuordnungen: daten?.zuordnungen || null,
      einstellung: daten?.einstellung || null, datenquelle: DATENQUELLE, gespeicherteNutzerId: nutzerId,
    });
    return mitHelfern(r.zugriff, wechsleNutzer, { nutzerListe: r.nutzerListe, kannWechseln: r.kannWechseln, ladeFehler, neuLaden, zuordnungen: daten?.zuordnungen || [] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lade, daten, nutzerId, user, ladeFehler, wechsleNutzer, neuLaden]);

  return <ZugriffKontext.Provider value={wert || berechnet}>{children}</ZugriffKontext.Provider>;
}

/** @returns {ZugriffWert} the access of the session, or the owner fallback */
export function useZugriff() {
  return useContext(ZugriffKontext) || ZUGRIFF_RUECKFALL;
}

/**
 * Tab keys of a page the access may read — stable (useMemo) as useTabParam needs.
 * @param {string} modul module of the page
 * @param {ReadonlyArray<string>} reiter all tab keys
 * @param {Readonly<Record<string, string>>} [reiterModule] tab key → own module (sub-rights)
 * @returns {ReadonlyArray<string>}
 */
export function useErlaubteReiter(modul, reiter, reiterModule) {
  const z = useZugriff();
  const schluessel = (reiter || []).filter((k) => z.darf(reiterModule?.[k] ?? modul)).join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => Object.freeze(schluessel ? schluessel.split("|") : []), [schluessel]);
}
