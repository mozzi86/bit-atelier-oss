// Client of a fee offer from the address book (94-03, B-ABN-04). The offer
// wizard used to ask for the client's name and address as free text even when
// the client was already in the address book (Contact). These helpers turn a
// Contact into the offer's client fields and order the picker list.
//
// In:  Contact records ({id, name, company, role, address, zip, city}).
// Out: plain data; no I/O.

/**
 * Whether a contact is marked as client ("Bauherr"/"Auftraggeber"/"client"/
 * "owner" in its role, case-insensitive).
 * @param {{role?: string}|null|undefined} kontakt
 * @returns {boolean}
 */
export function istBauherr(kontakt) {
  return /bauherr|auftraggeber|client|owner/i.test(String(kontakt?.role || ""));
}

/**
 * Display text of a contact in the picker: company (person) · role.
 * @param {{name?: string, company?: string, role?: string}} kontakt
 * @returns {string}
 */
export function kontaktText(kontakt) {
  const name = String(kontakt?.name || "").trim();
  const firma = String(kontakt?.company || "").trim();
  const kopf = firma && name && firma !== name ? `${firma} (${name})` : (firma || name);
  const rolle = String(kontakt?.role || "").trim();
  return rolle ? `${kopf} · ${rolle}` : kopf;
}

/**
 * Picker order: clients first, then by display text (German collation).
 * @param {ReadonlyArray<Record<string, any>>} kontakte
 * @returns {Array<Record<string, any>>} new sorted array
 */
export function sortiereKontakte(kontakte) {
  return [...(kontakte || [])].sort((a, b) =>
    Number(istBauherr(b)) - Number(istBauherr(a)) || kontaktText(a).localeCompare(kontaktText(b), "de"));
}

/**
 * The offer's client fields from a contact. The company is the contracting
 * party when there is one, otherwise the person. Address as one line
 * "Street, ZIP City" (the offer stores free text, bauherr_anschrift).
 * @param {{id?: string, name?: string, company?: string, address?: string, zip?: string, city?: string}} kontakt
 * @returns {{bauherr_contact_id: string|null, bauherr_name: string, bauherr_anschrift: string}}
 */
export function bauherrAusKontakt(kontakt) {
  const ort = [kontakt?.zip, kontakt?.city].map((s) => String(s || "").trim()).filter(Boolean).join(" ");
  const anschrift = [String(kontakt?.address || "").trim(), ort].filter(Boolean).join(", ");
  return {
    bauherr_contact_id: kontakt?.id ?? null,
    bauherr_name: String(kontakt?.company || "").trim() || String(kontakt?.name || "").trim(),
    bauherr_anschrift: anschrift,
  };
}
