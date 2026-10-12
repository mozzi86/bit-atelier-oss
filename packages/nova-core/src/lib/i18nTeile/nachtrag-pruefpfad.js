// Besitzer: 88-03 — nur diese Datei ändern.
//
// English dictionary part of the change order review path (VOB/B § 2 Abs. 5/6):
// ChangeOrderForm section, ChangeOrderTable amount cell, NachtragPruefpfadKarte in
// the cost control, findings of @core/lib/nachtragPruefpfad. Existing keys
// ("Status", "Art", "Geprüft", "Leistungsänderung" …) are not repeated
// (duplicate guard in tests/unit/i18nAbdeckung.test.js).
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  "Folgt dem Prüfpfad (freigegeben, sonst geprüft, sonst gefordert).": "Follows the review path (released, else checked, else demanded).",
  "Prüfpfad (VOB/B § 2)": "Review path (VOB/B § 2)",
  "Art des Nachtrags": "Kind of change order",
  "Bezug Urkalkulation / Vertragsposition": "Reference to original calculation / contract item",
  "z. B. Urkalkulation Pos. 02.0010": "e.g. original calculation item 02.0010",
  "Angekündigt am": "Announced on",
  "Ankündigung vor Ausführung?": "Announced before execution?",
  "ja": "yes",
  "nein": "no",
  "Gefordert (€ netto)": "Demanded (€ net)",
  "Geprüft (€ netto)": "Checked (€ net)",
  "Freigegeben (€ netto)": "Released (€ net)",
  "{n} Prüfhinweise": "{n} review findings",
  "Nachträge — Prüfpfad (VOB/B § 2 Abs. 5/6)": "Change orders — review path (VOB/B § 2 (5)/(6))",
  "Hinweise statt Urteil: ob ein Anspruch besteht, entscheidet die Bauleitung.": "Hints, not a verdict: whether a claim exists is decided by the site management.",
  "Gefordert": "Demanded",
  "gefordert": "demanded",
  "freigegeben": "released",
  "Kürzung durch Prüfung": "Reduction by review",
  "{n} Nachträge ohne Prüfpfad (nur Kostenwirkung) sind nicht enthalten.": "{n} change orders without review path (cost impact only) are not included.",
  "Nachtrag": "Change order",
  "Prüfhinweise": "Review findings",
  "Zusätzliche Leistung": "Additional work",
  "Sonstige / nicht zugeordnet": "Other / not assigned",
  "Art nicht zugeordnet (VOB/B § 2 Abs. 5 oder Abs. 6)": "Kind not assigned (VOB/B § 2 (5) or (6))",
  "Geforderter Betrag fehlt — Prüfung ohne Forderung nicht nachvollziehbar": "Demanded amount missing — a review without a demand cannot be traced",
  "Zusätzliche Leistung ohne Ankündigung vor Ausführung — Vergütungsanspruch kann entfallen (VOB/B § 2 Abs. 6 Nr. 1 S. 2)": "Additional work without announcement before execution — the claim for payment may lapse (VOB/B § 2 (6) no. 1 sentence 2)",
  "Preisgrundlage fehlt — Bezug zur Urkalkulation oder Vertragsposition angeben (VOB/B § 2 Abs. 5 / Abs. 6 Nr. 2)": "Price basis missing — state the reference to the original calculation or contract item (VOB/B § 2 (5) / (6) no. 2)",
  "Geprüfter Betrag liegt über der Forderung": "Checked amount exceeds the demand",
  "Freigegebener Betrag liegt über dem geprüften Betrag": "Released amount exceeds the checked amount",
  "Ankündigung erfasst, aber nicht bestätigt, dass sie vor Ausführung lag": "Announcement recorded, but not confirmed that it was before execution",
  "Genehmigt ohne geprüften Betrag": "Approved without a checked amount",
};
