// React hook over the letterhead Setting row (80-03): useEinstellung + the
// normalisation of ./briefkopf.js, so every consumer — BriefkopfFormular, the
// sidebar footer (Layout.jsx), the report preview and PDF (Reports.jsx) — reads
// and writes through the same shape and follows EINSTELLUNG_EREIGNIS without a
// reload (useEinstellung already re-reads on that event; nothing extra needed here).
//
// In:  nothing (reads/writes Setting{key:"briefkopf"} through bitApi, via
//      @core/lib/useEinstellung). Out: useBriefkopf().

import { useMemo } from "react";
import { useEinstellung } from "./useEinstellung.js";
import { BRIEFKOPF_SCHLUESSEL, DEFAULT_BRIEFKOPF, normalisiereBriefkopf } from "./briefkopf.js";

/**
 * The letterhead as React state, always normalised (never the raw stored value —
 * a caller never has to remember to call normalisiereBriefkopf itself).
 * @returns {{
 *   briefkopf: {office: string, tagline: string, address: string, contact: string},
 *   laden: boolean,
 *   fehler: string|null,
 *   speichern: (wert: {office?: string, tagline?: string, address?: string, contact?: string}) => Promise<{zeile: any, doppelt: number}>,
 * }} speichern upserts and fires EINSTELLUNG_EREIGNIS (throws on failure — not swallowed)
 */
export function useBriefkopf() {
  const [wert, setzen, { laden, fehler }] = useEinstellung(BRIEFKOPF_SCHLUESSEL, DEFAULT_BRIEFKOPF);
  const briefkopf = useMemo(() => normalisiereBriefkopf(wert), [wert]);
  return { briefkopf, laden, fehler, speichern: setzen };
}
