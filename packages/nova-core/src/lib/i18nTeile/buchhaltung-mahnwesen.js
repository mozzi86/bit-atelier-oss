// Besitzer: 79-03 — nur diese Datei ändern.
//
// English dictionary part of the accounting area "Mahnwesen und Briefkern (Spur A)".
// Decision list § 5: i18n.jsx is touched once per phase (79-01); every area plan
// writes its English texts only into its own part file under i18nTeile/.
//
// Format: one line per entry, "Deutscher Schlüssel": "English text", double
// quotes. The guard (tests/unit/i18nAbdeckung.test.js) reads every part file and
// refuses a key that already exists in i18n.jsx or in another part file.
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  // MahnwesenAbschnitt.jsx: list columns, settings block, staleness hint
  "Tage über Fälligkeit": "Days overdue",
  "Offener Betrag": "Amount outstanding",
  "Mahnstufe": "Dunning level",
  "Zinsen bis heute": "Interest to date",
  "Pauschale": "Flat fee",
  "Letzte Stufe": "Last level",
  "Fällige Stufe ab": "Next level due from",
  "Stufe {n}": "Level {n}",
  "Mahnung Stufe {n} erstellen": "Create level {n} dunning notice",
  "Keine überfälligen Rechnungen": "No overdue invoices",
  "Tage nach Fälligkeit": "Days after due date",
  "Tage nach letzter Stufe": "Days after previous level",
  "Frist (Tage)": "Deadline (days)",
  "vertragliches Zahlungsziel": "contractual payment term",
  "erste Mahnung": "first reminder",
  "30-Tage-Regel": "30-day rule",
  "Basiszinssatz prüfen (Stand {datum})": "Check the base rate (as of {datum})",
  "Zinsen sind eine Berechnung, keine Rechtsauskunft.": "Interest is a calculation, not legal advice.",
  // mahnwesen.js: letter Betreff/Anrede/paragraphs/table rows
  "Zahlungserinnerung": "Payment reminder",
  "Mahnung": "Dunning notice",
  "Letzte Mahnung": "Final notice",
  "Sehr geehrte Damen und Herren,": "Dear Sir or Madam,",
  "Für die Rechnung {nummer} vom {datum} ist noch ein Betrag von {betrag} offen.":
    "Invoice {nummer} of {datum} still shows an outstanding amount of {betrag}.",
  "Möglicherweise haben Sie die Zahlung bereits veranlasst — in diesem Fall betrachten Sie dieses Schreiben bitte als gegenstandslos.":
    "You may already have arranged the payment — in that case, please regard this letter as void.",
  "Wir bitten Sie, den offenen Betrag bis zum {frist} auszugleichen.": "We ask you to settle the outstanding amount by {frist}.",
  "Trotz unserer Zahlungserinnerung ist die Rechnung {nummer} vom {datum} weiterhin nicht ausgeglichen.":
    "Despite our payment reminder, invoice {nummer} of {datum} is still not settled.",
  "Der offene Betrag beträgt inzwischen {summe} (Rechnungsbetrag {offen} zzgl. Verzugszinsen {zinsen}).":
    "The outstanding amount now stands at {summe} (invoice amount {offen} plus default interest {zinsen}).",
  "Der offene Betrag beträgt inzwischen {summe} (Rechnungsbetrag {offen} zzgl. Verzugszinsen {zinsen} und einer Pauschale von {pauschale} nach § 288 Abs. 5 BGB).":
    "The outstanding amount now stands at {summe} (invoice amount {offen} plus default interest {zinsen} and a flat fee of {pauschale} under § 288 (5) BGB).",
  "Wir bitten Sie, den Betrag bis spätestens {frist} zu begleichen.": "We ask you to settle the amount by {frist} at the latest.",
  "Trotz mehrfacher Zahlungsaufforderung ist die Rechnung {nummer} vom {datum} weiterhin nicht beglichen.":
    "Despite repeated requests for payment, invoice {nummer} of {datum} is still not settled.",
  "Wir setzen Ihnen eine letzte Frist bis zum {frist}. Nach fruchtlosem Fristablauf behalten wir uns die Einleitung eines gerichtlichen Mahnverfahrens ohne weitere Ankündigung vor.":
    "We set you a final deadline of {frist}. Should it pass without payment, we reserve the right to initiate judicial dunning proceedings without further notice.",
  "Mit freundlichen Grüßen": "Kind regards",
  "Verzugszinsen bis {datum}": "Default interest to {datum}",
  // MahnDialog.jsx
  "Mahnung Stufe {n}": "Level {n} dunning notice",
  "Vorschau": "Preview",
  "Frist": "Deadline",
  "PDF herunterladen und Mahnung speichern": "Download PDF and save dunning notice",
  "Im Projekt unter Schriftverkehr ablegen": "File under correspondence in the project",
  "Mahnung gespeichert": "Dunning notice saved",
};
