// useTabParam.js — React hook: the active tab of a page lives in `?tab=` (72-15, N-16).
//
// Why: without it a tab is component state, and no link, reload or Back button can
// reach it (the AVA opened every link on the LV tab). The resolution rule is the
// pure waehleTab() in tabParam.js.
//
// In:  allowed tab keys, default key, optional alias map.
// Out: [tab, setTab].
//   - setTab(key) PUSHES a history entry, so Back returns to the previous tab.
//   - An unknown or non-canonical value in the URL (?tab=CONTROL, ?tab=xyz) is
//     REPLACED by the resolved key — no extra history entry.
//   - A missing parameter stays missing: the default tab needs no URL.
//   - Every other query parameter (?beispiel, ?ticket …) is kept.
//
// Hash routing (demo, /demo/?projekt=proj-1#/AVA?tab=control): this hook reads and
// writes the query BEHIND the hash through react-router; ProjectContext reads
// ?projekt BEFORE the hash from window.location. Neither touches the other's part.
import { useCallback, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { TAB_PARAMETER, mitTabParameter, waehleTab } from "@core/lib/tabParam";

// Stable default, so setTab keeps its identity when no alias map is passed.
const KEIN_ALIAS = Object.freeze({});

/**
 * Active tab from `?tab=`, plus a setter that writes it back to the URL.
 * Must be called inside a react-router Router. Pass `erlaubt` and `alias` as
 * module-level constants — new objects on every render re-create setTab.
 * @param {ReadonlyArray<string>} erlaubt allowed tab keys (the TabsTrigger values)
 * @param {string} standard tab shown without (or with an unknown) parameter
 * @param {{ alias?: Record<string, string> }} [optionen] alternative names → tab key
 * @returns {[string, (neu: string) => void]} active tab key and the setter
 *   (side effect: navigation — push for a user switch)
 */
export function useTabParam(erlaubt, standard, optionen = {}) {
  const alias = optionen.alias || KEIN_ALIAS;
  const [searchParams, setSearchParams] = useSearchParams();
  const roh = searchParams.get(TAB_PARAMETER);
  const tab = waehleTab(roh, erlaubt, standard, alias);

  // Latest requested tab. The router renders a navigation inside startTransition
  // (App.jsx: future.v7_startTransition), so the render lags behind the click:
  // Radix calls onValueChange on mousedown AND again on the focus that follows,
  // before the new URL is rendered. Comparing against the rendered `tab` alone
  // pushed two history entries per real click (measured headless, 72-15), so Back
  // seemed to do nothing.
  const angefordert = useRef(tab);
  useEffect(() => {
    angefordert.current = tab;
  }, [tab]);

  useEffect(() => {
    if (roh === null || roh === tab) return;
    setSearchParams((vorher) => mitTabParameter(vorher, tab), { replace: true });
  }, [roh, tab, setSearchParams]);

  const setTab = useCallback(
    (neu) => {
      const ziel = waehleTab(neu, erlaubt, standard, alias);
      if (ziel === angefordert.current) return;
      angefordert.current = ziel;
      setSearchParams((vorher) => mitTabParameter(vorher, ziel));
    },
    [erlaubt, standard, alias, setSearchParams],
  );

  return [tab, setTab];
}
