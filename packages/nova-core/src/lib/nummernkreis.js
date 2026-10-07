// Number ranges for documents ("RE-2026-014"): invoices in phase 79, offers,
// contracts and the post book in phases 81/82 (contract of D-P79-27). The next
// number is derived from the numbers that exist — no counter is stored, so a
// deleted draft or an import can never leave the counter out of step
// (§ 14 Abs. 4 Nr. 4 UStG asks for a unique, sequential number).
//
// In:  a format with the placeholders {jahr}, {nr3}, {nr4}; the existing numbers;
//      the document date. Out: the next free number. Import-free.

/**
 * Next number of a range: highest existing number of the SAME year + 1
 * (other years do not count), zero-padded to 3 ({nr3}) or 4 ({nr4}) digits.
 * Existing numbers that do not match the format are ignored.
 * @param {string} format e.g. "RE-{jahr}-{nr3}"
 * @param {ReadonlyArray<string|null|undefined>} vorhandene existing numbers
 * @param {string} datumIso document date 'YYYY-MM-DD' (the year is taken from it)
 * @returns {string} e.g. "RE-2026-014"
 * @throws {Error} when the format has no {nr3}/{nr4} or the date is not 'YYYY-…'
 */
export function naechsteNummer(format, vorhandene, datumIso) {
  const fmt = String(format ?? "");
  const nr = fmt.match(/\{nr([34])\}/);
  if (!nr) throw new Error(`Nummernmuster „${fmt}“ braucht {nr3} oder {nr4}.`);
  const stellen = Number(nr[1]);
  const jahr = String(datumIso ?? "").slice(0, 4);
  if (fmt.includes("{jahr}") && !/^\d{4}$/.test(jahr)) throw new Error(`Kein gültiges Datum für die Nummer: „${datumIso}“.`);

  const teile = fmt.split(/(\{jahr\}|\{nr[34]\})/).filter((t) => t !== "");
  const muster = new RegExp("^" + teile.map((t) => {
    if (t === "{jahr}") return "(?<jahr>\\d{4})";
    if (t === "{nr3}" || t === "{nr4}") return "(?<nr>\\d+)";
    return t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }).join("") + "$");

  let hoechste = 0;
  for (const n of vorhandene || []) {
    const m = typeof n === "string" ? n.match(muster) : null;
    if (!m?.groups) continue;
    if (m.groups.jahr !== undefined && m.groups.jahr !== jahr) continue;
    hoechste = Math.max(hoechste, Number(m.groups.nr));
  }
  const naechste = String(hoechste + 1).padStart(stellen, "0");
  return teile.map((t) => (t === "{jahr}" ? jahr : t === "{nr3}" || t === "{nr4}" ? naechste : t)).join("");
}
