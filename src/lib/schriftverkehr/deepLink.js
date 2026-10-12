// Deep-link contract of the correspondence (phase 82, 82-05, E-01): the entry
// points of accounting (79), fees (81) and reports open a prefilled letter with
//   /Correspondence?neu=<vorlage_key>&bezug=<typ>:<id>[&stufe=<n>]
// typ ∈ postbuch, rechnung, honorarangebot, honorarvertrag, honorarnachtrag, projekt,
// bautagebuch (88-02: hindrance notice from a site-diary entry).
// An unknown template key opens a free letter with a hint; an unknown reference
// type is dropped with a hint.
//
// Pure. Out: BEZUG_TYPEN, schreibenLink, leseDeepLink.

/** Reference types of the contract. */
export const BEZUG_TYPEN = Object.freeze(["postbuch", "rechnung", "honorarangebot", "honorarvertrag", "honorarnachtrag", "projekt", "bautagebuch"]);

/**
 * Link that opens a prefilled letter.
 * @param {{neu: string, bezug?: {typ: string, id: string}|null, stufe?: number|null}} ziel
 * @returns {string}
 */
export function schreibenLink({ neu, bezug = null, stufe = null }) {
  const p = new URLSearchParams({ neu });
  if (bezug) p.set("bezug", `${bezug.typ}:${bezug.id}`);
  if (stufe) p.set("stufe", String(stufe));
  return `/Correspondence?${p.toString()}`;
}

/**
 * Reads the deep link of the page.
 * @param {URLSearchParams} suche
 * @param {ReadonlyArray<string>} vorlagenKeys known template keys
 * @returns {{vorlageKey: string, bezug: {typ: string, id: string, stufe?: number}|null, hinweise: string[]}|null} null without `neu`
 */
export function leseDeepLink(suche, vorlagenKeys) {
  const neu = suche.get("neu");
  if (!neu) return null;
  /** @type {string[]} */
  const hinweise = [];
  let vorlageKey = neu;
  if (!vorlagenKeys.includes(neu)) {
    vorlageKey = "brief";
    hinweise.push("unbekannte_vorlage");
  }
  /** @type {{typ: string, id: string, stufe?: number}|null} */
  let bezug = null;
  const roh = suche.get("bezug");
  if (roh) {
    const i = roh.indexOf(":");
    const typ = i > 0 ? roh.slice(0, i) : "";
    const id = i > 0 ? roh.slice(i + 1) : "";
    if (BEZUG_TYPEN.includes(typ) && id) {
      bezug = { typ, id };
      const stufe = Number(suche.get("stufe"));
      if (Number.isInteger(stufe) && stufe >= 1 && stufe <= 3) bezug.stufe = stufe;
    } else {
      hinweise.push("unbekannter_bezug");
    }
  }
  return { vorlageKey, bezug, hinweise };
}
