// 69-20 (register Nr. 41): compare two check runs. A run is reduced to a small JSON (date, model, rule set,
// key figures and one stable KEY per finding); two runs are diffed into new / fixed / unchanged per rule
// and in total. This is the base of "Exit ≠ 0 when hard clashes grow" in the command-line check (phase 77)
// and of "what did the last model delivery fix?". 71-02 compares MODELS; this compares RUNS.
//
// Finding keys (stable across runs of the same models, independent of list order and numbering):
//   clash:  "<kind>|<rule id or ''>|<GlobalId A>|<GlobalId B>" with the two GlobalIds sorted, so A/B
//           swapping between runs is not a "new" finding
//   IDS:    "ids|<spec name>|<GlobalId or ''>|<facet>|<expected>"
// Findings without GlobalIds fall back to element ids — marked `stabil: false`, because ids of a re-export
// are not guaranteed to match.
//
// In:  ModelCheck result ({ clash: { clashes }, ids }), key figures, metadata. Out: pure JSON + diff.

/** Schema version of the run JSON. */
export const LAUF_VERSION = 1;

const s = (v) => (v == null ? "" : String(v));

/**
 * One finding → key + short record.
 * @param {object} c clash finding (clash.js) — aGuid/bGuid, aId/bId, kind, regel
 * @returns {{schluessel: string, art: string, regel: string, guids: string[], stabil: boolean}}
 */
export function clashSchluessel(c) {
  const a = s(c?.aGuid || c?.aId), b = s(c?.bGuid || c?.bId);
  const [x, y] = [a, b].sort();
  const regel = s(c?.regel?.id ?? "");
  return { schluessel: `${s(c?.kind)}|${regel}|${x}|${y}`, art: s(c?.kind), regel: regel || s(c?.kind), guids: [x, y].filter(Boolean), stabil: Boolean(c?.aGuid && c?.bGuid) };
}

/**
 * Reduce a run to its JSON.
 * @param {{clash?: {clashes?: object[]}, ids?: Array<{spec?: {name?: string, titel?: string}, verletzungen?: object[]}>}} ergebnis
 * @param {{datum?: string, modell?: string|null, regelsatz?: string|null, kennzahlen?: object|null}} meta
 * @returns {{v: number, datum: string, modell: string|null, regelsatz: string|null, kennzahlen: object|null, befunde: Array<{schluessel: string, art: string, regel: string, guids: string[], stabil: boolean}>}}
 */
export function laufZusammenfassung(ergebnis, { datum = new Date().toISOString(), modell = null, regelsatz = null, kennzahlen = null } = {}) {
  const befunde = [];
  for (const c of ergebnis?.clash?.clashes || []) befunde.push(clashSchluessel(c));
  for (const r of ergebnis?.ids || []) {
    const spec = s(r?.spec?.name || r?.spec?.titel || "IDS");
    for (const v of r?.verletzungen || []) {
      befunde.push({ schluessel: `ids|${spec}|${s(v?.globalId)}|${s(v?.facette)}|${s(v?.erwartet)}`, art: "ids", regel: spec, guids: v?.globalId ? [String(v.globalId)] : [], stabil: Boolean(v?.globalId) });
    }
  }
  // De-duplicate identical keys (same pair found twice by two rules of the same id) — count them once.
  const eindeutig = [...new Map(befunde.map((b) => [b.schluessel, b])).values()];
  return { v: LAUF_VERSION, datum, modell, regelsatz, kennzahlen, befunde: eindeutig };
}

/**
 * Diff two runs.
 * @param {ReturnType<typeof laufZusammenfassung>} alt earlier run
 * @param {ReturnType<typeof laufZusammenfassung>} neu later run
 * @returns {{neu: object[], behoben: object[], unveraendert: object[], jeRegel: Array<{regel: string, art: string, neu: number, behoben: number, unveraendert: number}>, hartZunahme: number, instabil: number, gleicherRegelsatz: boolean}}
 *   hartZunahme = hard clashes new − fixed (> 0 → the CLI exits ≠ 0); instabil = findings without GlobalId
 */
export function laufVergleich(alt, neu) {
  const A = new Map((alt?.befunde || []).map((b) => [b.schluessel, b]));
  const N = new Map((neu?.befunde || []).map((b) => [b.schluessel, b]));
  const neuL = [...N.values()].filter((b) => !A.has(b.schluessel));
  const behoben = [...A.values()].filter((b) => !N.has(b.schluessel));
  const gleich = [...N.values()].filter((b) => A.has(b.schluessel));
  const regeln = new Map();
  const zaehle = (b, feld) => {
    const k = `${b.art}|${b.regel}`;
    if (!regeln.has(k)) regeln.set(k, { regel: b.regel, art: b.art, neu: 0, behoben: 0, unveraendert: 0 });
    regeln.get(k)[feld] += 1;
  };
  neuL.forEach((b) => zaehle(b, "neu")); behoben.forEach((b) => zaehle(b, "behoben")); gleich.forEach((b) => zaehle(b, "unveraendert"));
  const hart = (l) => l.filter((b) => b.art === "hard").length;
  return {
    neu: neuL, behoben, unveraendert: gleich,
    jeRegel: [...regeln.values()].sort((x, y) => (y.neu - x.neu) || x.regel.localeCompare(y.regel)),
    hartZunahme: hart(neuL) - hart(behoben),
    instabil: [...N.values(), ...A.values()].filter((b) => !b.stabil).length,
    gleicherRegelsatz: s(alt?.regelsatz) === s(neu?.regelsatz),
  };
}

/**
 * Read a run JSON a user uploads (or a stored PruefLauf record) — refuses foreign files in plain text.
 * @param {any} json
 * @returns {ReturnType<typeof laufZusammenfassung>}
 */
export function laufLesen(json) {
  const j = typeof json === "string" ? JSON.parse(json) : json;
  if (!j || typeof j !== "object" || !Array.isArray(j.befunde)) throw new Error("Keine Prüflauf-Datei (befunde fehlt).");
  if (Number(j.v) > LAUF_VERSION) throw new Error(`Prüflauf-Datei ist neuer (Version ${j.v}) als diese App.`);
  return { v: Number(j.v) || 1, datum: s(j.datum), modell: j.modell ?? null, regelsatz: j.regelsatz ?? null, kennzahlen: j.kennzahlen ?? null, befunde: j.befunde.filter((b) => b && typeof b.schluessel === "string") };
}
