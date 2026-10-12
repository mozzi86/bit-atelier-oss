// 73-10 (BEST-12): finding on an existing element — opening-up, damage, moisture, suspected pollutant —
// hung on the element by its GlobalId and stored ADDITIVELY in the existing befunde_layer (schema of
// @ifc/lib/befundSpur.js, 71-04) as `bestand: [...]` next to the BCF topics; no second findings field.
// A finding never changes the model by itself: raising the element's Erfassungsgrad is a separate click,
// and only upwards (ERFASSUNG_RANG).
//
// In:  finding inputs; current Erfassungsgrad of the element. Out: pure records and decisions.
import { ERFASSUNG_RANG, normalizeErfassung } from "@core/lib/bimClassification";

/** How the finding was made. */
export const BEFUND_METHODEN = Object.freeze({ sicht: "Sichtprüfung", oeffnung: "Bauteilöffnung", messung: "Messung", labor: "Laboranalyse" });
/** What was found. */
export const BEFUND_KATEGORIEN = Object.freeze({ aufbau: "Aufbau / Schichtenfolge", schaden: "Schaden", feuchte: "Feuchte", schadstoff: "Schadstoffverdacht" });

/**
 * Erfassungsgrad a finding of this method supports [ASSUMED]: an opening, a measurement or a lab result
 * make the element "gemessen"; a visual inspection only "abgeleitet" (the inside stays unseen).
 * @param {string} methode key of BEFUND_METHODEN
 * @returns {"gemessen"|"abgeleitet"|null}
 */
export function erfassungAusMethode(methode) {
  if (methode === "oeffnung" || methode === "messung" || methode === "labor") return "gemessen";
  if (methode === "sicht") return "abgeleitet";
  return null;
}

/**
 * May the element's Erfassungsgrad be raised to `neu`? Only strictly upwards; unknown counts as lowest.
 * @param {*} alt current value (raw)
 * @param {*} neu proposed value (raw)
 * @returns {boolean}
 */
export function darfAnheben(alt, neu) {
  const n = normalizeErfassung(neu);
  if (!n) return false;
  const a = normalizeErfassung(alt);
  return (ERFASSUNG_RANG[n] || 0) > (a ? ERFASSUNG_RANG[a] : 0);
}

/**
 * New finding record for befunde_layer.bestand.
 * @param {{guid: string, methode: string, kategorie: string, text?: string, datum?: string, fotoDokumentId?: string|null, jetzt?: Date}} p
 * @returns {{id: string, art: "bestand", guid: string, methode: string, kategorie: string, text: string, datum: string, foto_dokument_id: string|null, erfassung_vorschlag: string|null, angehoben: boolean}}
 */
export function befundAnlegen({ guid, methode, kategorie, text = "", datum, fotoDokumentId = null, jetzt = new Date() }) {
  if (!guid) throw new Error("Ein Bestandsbefund braucht ein Bauteil (GlobalId).");
  if (!Object.prototype.hasOwnProperty.call(BEFUND_METHODEN, methode)) throw new Error("Unbekannte Befund-Methode.");
  if (!Object.prototype.hasOwnProperty.call(BEFUND_KATEGORIEN, kategorie)) throw new Error("Unbekannte Befund-Kategorie.");
  return {
    id: `bb-${jetzt.getTime().toString(36)}`, art: "bestand", guid: String(guid), methode, kategorie,
    text: String(text || ""), datum: datum || jetzt.toISOString().slice(0, 10),
    foto_dokument_id: fotoDokumentId || null, erfassung_vorschlag: erfassungAusMethode(methode), angehoben: false,
  };
}

/**
 * befunde_layer with one more finding — topics/antworten of the BCF part stay untouched.
 * @param {object|null|undefined} layer current befunde_layer
 * @param {ReturnType<typeof befundAnlegen>} befund
 * @returns {object}
 */
export function befundEinfuegen(layer, befund) {
  const l = layer && typeof layer === "object" ? layer : {};
  return { ...l, bestand: [...(Array.isArray(l.bestand) ? l.bestand : []), befund] };
}
