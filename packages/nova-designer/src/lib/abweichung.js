// 73-13 (BEST-15): third check exit for existing buildings — "Abweichung / Bestandsschutz". An old building
// breaks practically every current rule (stair pitch, clear heights, escape route lengths, U-values); a
// binary check produces hundreds of red rows nobody reads, while the actual planning work — negotiating the
// deviation — is documented nowhere. A note { art, begruendung, kompensation, antrag_status } per check
// key is stored in the Fachlayer of the CHECKING tab (`<feld>.abweichungen[key]`, no new top-level field)
// and turns a fail/warn row into the fourth state "abweichung". No second rule engine: the checks stay as
// they are, this only overlays the documented decision. UNCHECKED ("nicht_geprueft", compliance.js) keeps
// its meaning "rule not available" and is never reinterpreted.
//
// Legal frame only as text, Bavarian and [ASSUMED]: deviations Art. 63 BayBO, subsequent requirements on
// existing buildings Art. 54 Abs. 4 BayBO. No check claims to know the protection of existing use.
//
// In:  check items ({ key, status, detail }), stored notes. Out: overlaid items + counts.
import { ABWEICHUNG_SCHEMA } from "@core/lib/bimClassification";

/** Status key of the fourth state (STATUS_STYLE entry in compliance.js). */
export const ABWEICHUNG = "abweichung";
/** Legal frame shown in the UI (Bavaria, [ASSUMED] — other states differ). */
export const RECHTSRAHMEN_TEXT = "Rechtsrahmen (Bayern, ohne Gewähr): Abweichung nach Art. 63 BayBO, nachträgliche Anforderungen an bestehende Anlagen nach Art. 54 Abs. 4 BayBO. Bestandsschutz entscheidet die Behörde im Einzelfall — die App dokumentiert nur.";

/**
 * Normalise a stored note; null when nothing usable is in it.
 * @param {any} raw
 * @returns {{art: string, begruendung: string, kompensation: string, antrag_status: string, datum: string}|null}
 */
export function vermerkHardened(raw) {
  if (!raw || typeof raw !== "object") return null;
  const art = Object.prototype.hasOwnProperty.call(ABWEICHUNG_SCHEMA.arten, raw.art) ? raw.art : "abweichung";
  const antrag = Object.prototype.hasOwnProperty.call(ABWEICHUNG_SCHEMA.antragStatus, raw.antrag_status) ? raw.antrag_status : "offen";
  const begruendung = String(raw.begruendung || "").trim();
  if (!begruendung) return null; // a deviation without a reason is not documented
  return { art, begruendung, kompensation: String(raw.kompensation || "").trim(), antrag_status: antrag, datum: String(raw.datum || "").slice(0, 10) };
}

/**
 * Overlay documented deviations on check items: fail/warn rows with a note become "abweichung"; pass and
 * UNCHECKED rows are left alone (a note on them is ignored — nothing to deviate from / nothing checked).
 * @param {Array<{key: string, status: string, detail?: string}>} items
 * @param {Record<string, any>|null|undefined} abweichungen stored notes by check key
 * @returns {{items: Array<object>, anzahl: number, offen: number}} anzahl = rows turned, offen = of those not yet approved
 */
export function mitAbweichungen(items = [], abweichungen = {}) {
  let anzahl = 0, offen = 0;
  const out = (items || []).map((it) => {
    const v = vermerkHardened(abweichungen?.[it.key]);
    if (!v || (it.status !== "fail" && it.status !== "warn")) return it;
    anzahl += 1;
    if (v.antrag_status !== "genehmigt") offen += 1;
    return { ...it, status: ABWEICHUNG, statusVorher: it.status, vermerk: v };
  });
  return { items: out, anzahl, offen };
}
