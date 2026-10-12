// Shared status vocabulary of the concept checks (72-04, Nachweis-Härtung).
//
// Why this module exists: the early specialist checks (fire, accessibility, acoustics,
// statics, HVAC, landscape) only knew "pass" and "warn". A missing input was either read
// as 0 and silently passed (e.g. "kein Hochhaus" without any height, "0/0 barrier-free
// flats") or turned into a "warn" that looked like a broken rule. Both are wrong: a check
// that cannot be evaluated is OPEN — neither met nor violated. The newer libs (asr,
// tragwerkPlan, brandschutzPlan, entwaesserung …) already used "offen"; this module gives
// the old ones the same word and one evaluation.
//
// Liability rule (unchanged, T-15-03/T-18-04/T-19-04): concept checks never emit "fail".
// They are orientation values, not a Nachweis; "warn" marks a rule the input misses,
// "offen" marks an input that is missing.
//
// In: check items {key, label, status, detail}. Out: OFFEN, konzeptAuswertung, gesamtStatus.
// Isomorphic, no imports — compliance.js and every check lib may import it without cycles.

/** Status of a check whose input is missing — not evaluable, never counted as met. */
export const OFFEN = "offen";

/**
 * Score and verdict of one concept check list.
 * Score = share of "pass" items in percent (0…100); "offen" and "warn" both count as not met.
 * @param {Array<{status: string}>} items
 * @param {{ hinweise?: string, plausibel?: string }} [texte] verdict texts of the area
 * @returns {{ items: Array<any>, score: number, warns: number, offen: number, verdict: string }}
 */
export function konzeptAuswertung(items, { hinweise = "Konzept mit Hinweisen", plausibel = "Konzept plausibel" } = {}) {
  const passes = items.filter((i) => i.status === "pass").length;
  const warns = items.filter((i) => i.status === "warn").length;
  const offen = items.filter((i) => i.status === OFFEN).length;
  const score = Math.round((passes / Math.max(1, items.length)) * 100);
  const verdict = warns > 0 && offen > 0 ? `${hinweise} — Angaben fehlen`
    : warns > 0 ? hinweise
      : offen > 0 ? "Konzept unvollständig — Angaben fehlen"
        : plausibel;
  return { items, score, warns, offen, verdict };
}

/**
 * Overall status of a check result for the header badge: any warn → "warn", else any open
 * input → "offen", else "pass". Before 72-04 the badge was green whenever no warn existed,
 * i.e. green for an empty form.
 * @param {{ warns?: number, offen?: number, items?: Array<{status: string}> } | null | undefined} checks
 * @returns {"warn"|"offen"|"pass"}
 */
export function gesamtStatus(checks) {
  const items = checks?.items || [];
  const warns = checks?.warns ?? items.filter((i) => i.status === "warn").length;
  const offen = checks?.offen ?? items.filter((i) => i.status === OFFEN).length;
  return warns > 0 ? "warn" : offen > 0 ? OFFEN : "pass";
}
