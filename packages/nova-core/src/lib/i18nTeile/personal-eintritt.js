// Besitzer: 80-09, Spur B — nur diese Datei ändern.
//
// English dictionary part of phase 80: "Personal — Einstellung & Austritt".
// Decision list § 5: i18n.jsx is touched once per phase (80-01); every plan of the
// phase writes its English texts only into its own part file under i18nTeile/.
//
// Format: one line per entry, "Deutscher Schlüssel": "English text", double
// quotes. The guard (tests/unit/i18nAbdeckung.test.js) reads every part file and
// refuses a key that already exists in i18n.jsx or in another part file.
// Before adding a key, grep all dictionary files: an existing key is reused, never
// entered again. A word that both lanes need and that appears only after wave 1 is
// not entered twice; if the guard still finds one after merging a wave, the merge
// fix moves it once into the block "Words several tabs share" of
// buchhaltung-fundament.js (rule of c8858d0) — i18n.jsx stays closed after 80-01.
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  // VorgangsListe.jsx / EinstellungReiter.jsx
  "Keine laufenden Vorgänge.": "No open cases.",
  "Vorgang {name}: {prozent} % erledigt": "Case {name}: {prozent}% done",
  "{n} offene Pflichtpunkte": "{n} open required items",
  "Alle Pflichtpunkte erledigt": "All required items done",
  "Vorgang nicht gefunden.": "Case not found.",

  // VorgangsCheckliste.jsx — VORLAGE_EINTRITT group names (onboarding.js)
  "Vertrag & Nachweise": "Contract & evidence",
  "Lohnbüro & Sozialversicherung": "Payroll office & social insurance",
  "Kammer & Versorgung": "Chamber & pension scheme",
  "Arbeitsschutz": "Occupational safety",
  "Ausstattung & Konten": "Equipment & accounts",
  "Einarbeitung": "Onboarding period",

  // VorgangsCheckliste.jsx — VORLAGE_EINTRITT item titles (onboarding.js, 16)
  "Vertrag unterschrieben": "Contract signed",
  "Nachweis der Arbeitsbedingungen (NachwG)": "Statement of employment terms (NachwG)",
  "Vertraulichkeitserklärung": "Confidentiality agreement",
  "Einwilligung Foto (optional)": "Photo consent (optional)",
  "Personalfragebogen ans Lohnbüro": "Personnel questionnaire sent to the payroll office",
  "SV-Anmeldung durch das Lohnbüro": "Social-insurance registration by the payroll office",
  "ELStAM abgerufen": "ELStAM retrieved",
  "Nachweis der Beschäftigungsart": "Evidence of the employment type",
  "RV-Befreiung beantragt": "Pension-insurance exemption applied for",
  "Berufshaftpflicht über die Kammer geprüft": "Professional liability cover checked via the chamber",
  "Unterweisung Arbeitsschutz": "Occupational-safety briefing",
  "Angebotsvorsorge Bildschirmarbeit": "Offered screen-work medical check-up",
  "Arbeitsmittel übergeben": "Work equipment handed over",
  "Konten & Lizenzen eingerichtet": "Accounts & licences set up",
  "Einarbeitung/Probezeitgespräche": "Induction / probation-period reviews",
  "Projektzuordnung angelegt": "Project assignment recorded",

  // VorgangsCheckliste.jsx — VORLAGE_AUSTRITT item titles (onboarding.js, 7)
  "Kündigung in Schriftform, Zugang dokumentiert": "Termination in writing, receipt documented",
  "Hinweis zur Arbeitsuchendmeldung gegeben": "Notice about registering as job-seeking given",
  "Resturlaub genommen oder abgegolten": "Remaining leave taken or paid out",
  "Arbeitszeugnis erstellt": "Reference letter issued",
  "Arbeitsbescheinigung ausgestellt": "Employment certificate issued",
  "Rückgabe von Arbeitsmitteln, Konten gesperrt": "Work equipment returned, accounts locked",
  "Löschfristen der Personalakte gestartet": "Personnel-file deletion clock started",

  // VorgangsCheckliste.jsx — per point
  "aus Vertrag": "from contract",
  "optional": "optional",
  "Fällig (Tage)": "Due (days)",
  "Erledigt am": "Done on",
  "Ausstattung": "Equipment",
  "Gegenstand": "Item",
  "Inventarnummer": "Asset number",
  "Ausgegeben am": "Issued on",
  "Zurück am": "Returned on",
  "offen": "open",
  "+ Gegenstand hinzufügen": "+ Add item",
  "Eintritt abschließen": "Complete onboarding",
  "Austritt abschließen": "Complete offboarding",
  "Eintritt abschließen?": "Complete onboarding?",
  "Austritt abschließen?": "Complete offboarding?",
  "Der Mitarbeitende wird ab jetzt als aktiv geführt.": "The staff member is now recorded as active.",
  "Der Mitarbeitende wird ab jetzt als ausgeschieden geführt.": "The staff member is now recorded as having left.",
  "Abschließen": "Complete",
  "Stichtag": "Reference date",
  "Keine Person zugeordnet.": "No person assigned.",

  // MitarbeiterDetail.jsx, VorgangSlot (Plan 80-09, Task 4)
  "Eintritt starten": "Start onboarding",
  "Austritt starten": "Start offboarding",
  "Eintritt starten?": "Start onboarding?",
  "Legt eine Eintritts-Checkliste für diese Person an.": "Creates an onboarding checklist for this person.",

  // BewerbungsPipeline.jsx (Plan 80-09, Task 4 — offer to hire)
  "übernommen": "hired",
  "Person ansehen": "View person",
  "Einstellung anlegen": "Set up hire",

  // UebernahmeDialog.jsx
  "Legt 1 Person, 1 Vertragsentwurf und 1 Eintritts-Checkliste ({n} Punkte) an.": "Creates 1 person, 1 draft contract and 1 onboarding checklist ({n} items).",
  "Lebenslauf und Zeugnisse werden übernommen, Gesprächsnotizen und Bewertungen nicht.": "The CV and references carry over; interview notes and ratings do not.",

  // AustrittDialog.jsx
  "Kündigung durch den Arbeitgeber": "Termination by the employer",
  "Kündigung durch den Arbeitnehmer": "Termination by the employee",
  "Aufhebungsvertrag": "Mutual termination agreement",
  "Befristungsende": "End of a fixed term",
  "Zugang am": "Received on",
  "Letzter Tag": "Last day",
  "Letzter Tag konnte nicht ermittelt werden — Vertrag ohne Ende bei Befristungsende?": "Could not determine the last day — a fixed-term contract without an end date?",
  "Keine Rechtsberatung.": "Not legal advice.",
  "einvernehmlich vereinbart": "agreed by mutual consent",

  // PersonalBereich.jsx (Einstellungen › Personal-Vorlagen, Plan 80-09 Task 5)
  "Änderungen gelten für neue Vorgänge; bestehende Checklisten bleiben unverändert.": "Changes apply to new cases; existing checklists stay as they are.",
  "Eigene Punkte": "Custom items",
  "+ Eigenen Punkt hinzufügen": "+ Add a custom item",
  "Pflicht": "Required",
  "nach oben": "move up",
  "nach unten": "move down",
  "Standard wiederherstellen": "Restore the default",
  "Standard wiederherstellen?": "Restore the default?",
  "Alle Anpassungen an den Personal-Vorlagen gehen verloren. Bestehende Checklisten bleiben unverändert.": "All customisations to the HR templates are lost. Existing checklists stay as they are.",
};
