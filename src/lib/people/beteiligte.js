// 90-07: project participant list (Projektbeteiligtenliste) per project from the address book. Council
// 10.10.2026 (HANDOFF-SKILLS-INTEGRATION §3): the office skill "…-projektbeteiligtenliste" builds the list
// by hand in Excel; the app had an address book but no notion of "who is on THIS project in which role".
//
// In:  the project's stored list (`project.beteiligte`, new optional field: [{ contact_id, rolle, bemerkung? }]),
//      the address book contacts, tenders and bids (for suggestions from awarded contracts).
// Out: pure functions — the role catalogue in a fixed order (client → planners → authorities → firms), the
//      resolved and sorted rows for the table and the PDF, suggestions (client contacts, awarded bidders with
//      their trade), add/remove/change helpers that return a NEW list (the caller saves it on the project).
//
// Isomorph: kein window.

/**
 * Roles in print order. `gruppe` heads the block in the list; the order follows the usual German
 * participant list (Bauherr, Planung nach HOAI-Leistungsbildern, Sachverständige/Behörden, Ausführung)
 * [ASSUMED — office lists differ in detail; unknown roles are kept and sorted to the end].
 * @type {ReadonlyArray<{id: string, label: string, gruppe: string}>}
 */
export const ROLLEN = Object.freeze([
  { id: "bauherr", label: "Bauherr", gruppe: "Bauherr" },
  { id: "bauherrenvertretung", label: "Bauherrenvertretung", gruppe: "Bauherr" },
  { id: "projektsteuerung", label: "Projektsteuerung", gruppe: "Bauherr" },
  { id: "nutzer", label: "Nutzer", gruppe: "Bauherr" },
  { id: "objektplanung", label: "Objektplanung (Architektur)", gruppe: "Planung" },
  { id: "freianlagen", label: "Freianlagenplanung", gruppe: "Planung" },
  { id: "tragwerk", label: "Tragwerksplanung", gruppe: "Planung" },
  { id: "tga_hls", label: "TGA Heizung, Lüftung, Sanitär", gruppe: "Planung" },
  { id: "tga_elt", label: "TGA Elektro", gruppe: "Planung" },
  { id: "bauphysik", label: "Bauphysik", gruppe: "Planung" },
  { id: "brandschutz", label: "Brandschutz", gruppe: "Planung" },
  { id: "vermessung", label: "Vermessung", gruppe: "Planung" },
  { id: "bodengutachten", label: "Baugrundgutachten", gruppe: "Sachverständige und Behörden" },
  { id: "pruefstatik", label: "Prüfingenieur / Prüfstatik", gruppe: "Sachverständige und Behörden" },
  { id: "sigeko", label: "SiGeKo", gruppe: "Sachverständige und Behörden" },
  { id: "behoerde", label: "Bauaufsicht / Behörde", gruppe: "Sachverständige und Behörden" },
  { id: "versorger", label: "Versorger", gruppe: "Sachverständige und Behörden" },
  { id: "ausfuehrung", label: "Ausführende Firma", gruppe: "Ausführung" },
  { id: "sonstige", label: "Sonstige", gruppe: "Sonstige" },
]);

const ROLLE_JE_ID = new Map(ROLLEN.map((r, i) => [r.id, { ...r, rang: i }]));

/** Role of an address-book category as a default when a contact is added [ASSUMED mapping]. */
export const ROLLE_AUS_KATEGORIE = Object.freeze({ client: "bauherr", engineer: "tragwerk", consultant: "sonstige", manufacturer: "ausfuehrung", contractor: "ausfuehrung", internal: "objektplanung" });

/**
 * Normalised list stored on the project: only entries with a contact, duplicates (same contact + role +
 * note) dropped. An unknown role id is kept as is (free text from an older list must not be lost).
 * @param {any} liste
 * @returns {Array<{contact_id: string, rolle: string, bemerkung: string}>}
 */
export function normalisieren(liste) {
  const out = [];
  const gesehen = new Set();
  for (const e of Array.isArray(liste) ? liste : []) {
    if (!e || !e.contact_id) continue;
    const eintrag = { contact_id: String(e.contact_id), rolle: String(e.rolle || "sonstige"), bemerkung: String(e.bemerkung || "").trim() };
    const k = `${eintrag.contact_id}|${eintrag.rolle}|${eintrag.bemerkung}`;
    if (gesehen.has(k)) continue;
    gesehen.add(k); out.push(eintrag);
  }
  return out;
}

/**
 * Rows for table and PDF: contact data resolved, sorted by role order, then company/name.
 * A contact that was deleted from the address book stays visible as "(Kontakt gelöscht)" — silently
 * dropping it would hide a gap in the list.
 * @param {any} liste project.beteiligte
 * @param {Array<any>} kontakte address book
 * @returns {Array<{index: number, contact_id: string, rolle: string, rolleLabel: string, gruppe: string, firma: string, name: string,
 *   funktion: string, adresse: string, telefon: string, email: string, bemerkung: string, fehlt: boolean}>}
 *   index = position in the normalised stored list (for remove/change)
 */
export function zeilen(liste, kontakte) {
  const jeId = new Map((Array.isArray(kontakte) ? kontakte : []).map((c) => [c.id, c]));
  return normalisieren(liste).map((e, index) => {
    const c = jeId.get(e.contact_id);
    const r = ROLLE_JE_ID.get(e.rolle);
    return {
      index, contact_id: e.contact_id, rolle: e.rolle,
      rolleLabel: r ? r.label : e.rolle, gruppe: r ? r.gruppe : "Sonstige",
      firma: String(c?.company || ""), name: c ? String(c.name || "") : "(Kontakt gelöscht)",
      funktion: String(c?.role || ""),
      adresse: [c?.address, [c?.zip, c?.city].filter(Boolean).join(" ")].filter(Boolean).join(", "),
      telefon: String(c?.phone || ""), email: String(c?.email || ""), bemerkung: e.bemerkung, fehlt: !c,
      _rang: r ? r.rang : 999,
    };
  }).sort((a, b) => a._rang - b._rang || (a.firma || a.name).localeCompare(b.firma || b.name, "de"))
    .map(({ _rang, ...z }) => z); // eslint-disable-line no-unused-vars
}

/**
 * Suggestions not yet in the list: client contacts as "Bauherr" and the awarded bidder of every awarded
 * tender of the project as "Ausführende Firma" with the trade as note.
 * @param {{liste: any, kontakte: Array<any>, tenders?: Array<any>, bids?: Array<any>, projektId: string}} p
 * @returns {Array<{contact_id: string, rolle: string, bemerkung: string, grund: string}>}
 */
export function vorschlaege({ liste, kontakte, tenders = [], bids = [], projektId }) {
  const vorhanden = new Set(normalisieren(liste).map((e) => `${e.contact_id}|${e.rolle}`));
  const out = [];
  const add = (v) => { const k = `${v.contact_id}|${v.rolle}`; if (!vorhanden.has(k)) { vorhanden.add(k); out.push(v); } };
  for (const t of tenders) {
    if (t.project_id !== projektId || !t.awarded_bid_id) continue;
    const b = bids.find((x) => x.id === t.awarded_bid_id);
    if (b?.contact_id && kontakte.some((c) => c.id === b.contact_id)) add({ contact_id: b.contact_id, rolle: "ausfuehrung", bemerkung: String(t.trade || t.name || ""), grund: `Zuschlag ${t.name || ""}`.trim() });
  }
  for (const c of kontakte) if (c.category === "client") add({ contact_id: c.id, rolle: "bauherr", bemerkung: "", grund: "Kategorie Bauherr im Adressbuch" });
  return out;
}

/** Append an entry (normalised). @returns {Array<{contact_id: string, rolle: string, bemerkung: string}>} */
export function hinzufuegen(liste, eintrag) {
  return normalisieren([...normalisieren(liste), eintrag]);
}

/** Remove the entry at `index` of the normalised list. */
export function entfernen(liste, index) {
  return normalisieren(liste).filter((_, i) => i !== index);
}

/** Change role/note of the entry at `index`. */
export function aendern(liste, index, aenderung) {
  return normalisieren(normalisieren(liste).map((e, i) => (i === index ? { ...e, ...aenderung } : e)));
}
