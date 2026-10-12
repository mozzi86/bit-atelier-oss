// Besitzer: 88-08 — nur diese Datei ändern.
//
// English dictionary part of the cost stages after DIN 276:2018-12 3.4 and the
// construction cost ceiling (KostenstaendeKarte in CostControl, @ava/lib/kostenstaende).
// Existing keys ("Kostenberechnung", "Stufe", "Quelle", "Datum" …) are not repeated
// (duplicate guard in tests/unit/i18nAbdeckung.test.js).
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  "Kostenstände konnten nicht geladen werden": "Cost stages could not be loaded",
  "Obergrenze muss eine positive Zahl sein": "The ceiling must be a positive number",
  "Obergrenze konnte nicht gespeichert werden": "The ceiling could not be saved",
  "Kostenstand konnte nicht gespeichert werden": "The cost stage could not be saved",
  "Kostenstände DIN 276": "Cost stages DIN 276",
  "Alle Stufen auf derselben Basis erfassen (z. B. KG 300 + 400, netto). Die Ampel ist ein Hinweis, keine Feststellung.": "Record all stages on the same basis (e.g. CG 300 + 400, net). The traffic light is a hint, not a finding.",
  "Baukostenobergrenze (€ netto)": "Construction cost ceiling (€ net)",
  "nicht vereinbart": "not agreed",
  "Aktueller Stand": "Current stage",
  "der Obergrenze": "of the ceiling",
  "Betrag (netto)": "Amount (net)",
  "Δ zur Vorstufe": "Δ to previous stage",
  "Anteil Obergrenze": "Share of ceiling",
  "vorläufig": "provisional",
  "erfasst": "recorded",
  "live": "live",
  "Festschreiben": "Freeze",
  "Erfassen": "Record",
  "Betrag (€ netto)": "Amount (€ net)",
  "Ampel: grün unter {g} %, gelb ab {g} %, rot über {r} % der Obergrenze [Annahme Büro].": "Traffic light: green below {g} %, yellow from {g} %, red above {r} % of the ceiling [office assumption].",
  "Kostenrahmen": "Cost framework",
  "Kostenschätzung": "Cost estimate",
  "Kostenvoranschlag": "Pre-tender cost estimate",
  "Kostenanschlag": "Cost quotation",
  "Kostenfeststellung": "Final cost statement",
  "unter der Obergrenze": "below the ceiling",
  "nahe der Obergrenze": "close to the ceiling",
  "über der Obergrenze": "above the ceiling",
  "Projektangabe „Kostenschätzung“": "Project field “cost estimate”",
  "Gebäudemodell (Kosten-Tab)": "Building model (cost tab)",
  "Bepreistes LV (Σ Menge × Schätzpreis)": "Priced BoQ (Σ quantity × estimated price)",
  "Vergabe + offener LV-Anschlag": "Award + open BoQ estimate",
  "Abgerechnet + genehmigte Nachträge": "Billed + approved change orders",
};
