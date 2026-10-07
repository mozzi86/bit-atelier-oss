// Besitzer: 80-06, Spur B — nur diese Datei ändern.
//
// English dictionary part of phase 80: "Personal — Verträge und Fristen".
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
  // VertraegeReiter.jsx / VertragsTabelle.jsx
  "Vertrag anlegen": "Add contract",
  "Neuen Arbeitsvertrag erfassen": "Record a new employment contract",
  "Noch keine Verträge erfasst.": "No contracts recorded yet.",
  "Beginn – Ende": "Start – end",
  "Nächste Frist": "Next deadline",
  "Vertragsart": "Contract type",
  "Wochenstunden": "Weekly hours",
  "Gehalt": "Salary",
  "unbefristet": "open-ended",
  "überfällig": "overdue",
  "Vertrag bearbeiten": "Edit contract",
  "Neuer Vertrag (ersetzt den bisherigen)": "New contract (replaces the previous one)",
  "{n} Verträge": "{n} contracts",
  "{n} h/Woche": "{n} h/week",
  "{n} Tage/Jahr": "{n} days/year",
  // Vertragsstatus — eigene Texte statt VERTRAGS_STATUS[i].label (Wörterbuch-
  // Doppel bei "Entwurf", das i18n.jsx bereits als "Design" führt).
  "Vertragsentwurf": "Contract draft",
  "Unterschrieben": "Signed",
  "Gekündigt": "Terminated",
  "Beendet": "Ended",
  "Ersetzt": "Replaced",
  // VERTRAGSARTEN (vertrag.js, 80-04; hier erstmals in der Oberfläche gezeigt)
  "Unbefristet": "Open-ended",
  "Befristet ohne Sachgrund": "Fixed term without cause",
  "Befristet mit Sachgrund": "Fixed term with cause",
  "Befristet (Neugründung, § 14 Abs. 2a TzBfG)": "Fixed term (new business, § 14 (2a) TzBfG)",
  "Befristet ab 52 Jahren (§ 14 Abs. 3 TzBfG)": "Fixed term from age 52 (§ 14 (3) TzBfG)",
  "Minijob-Vertrag": "Minijob contract",
  "Werkstudierendenvertrag": "Working-student contract",
  "Praktikumsvertrag": "Internship contract",
  "Ausbildungsvertrag": "Apprenticeship contract",
  "Freier Dienstvertrag": "Freelance service contract",

  // VertragsFormular.jsx
  "Person und Vertragsart": "Person and contract type",
  "Sachgrund": "Cause",
  "Grund": "Reason",
  "Konditionen": "Terms",
  "Probezeit (Monate)": "Probation (months)",
  "Arbeitstage/Woche": "Working days/week",
  "Urlaub (Tage/Jahr)": "Leave (days/year)",
  "Zusatzurlaub (Tage/Jahr)": "Additional leave (days/year)",
  "Ohne Grund erfassen (Art. 9 DSGVO).": "Record without a reason (Art. 9 GDPR).",
  "Verlängerungen": "Extensions",
  "Form und Nachweise": "Form and evidence",
  "Unterschrieben am": "Signed on",
  "NachwG-Nachweis ausgehändigt am": "Written-particulars notice (NachwG) handed over on",
  "Schriftform vor Beginn nachgewiesen": "Written form confirmed before the start date",
  "Kündigungsregel": "Notice rule",
  "Gesetzlich (§ 622 BGB)": "Statutory (§ 622 BGB)",
  "Vertraglich abweichend": "Contractually different",
  "Vertragliche Kündigungsregel (Text)": "Contractual notice rule (text)",
  "Gesetzliche Kündigungsfrist bei Zugang heute": "Statutory notice period if received today",
  "Keine Rechtsberatung — im Zweifel Fachanwalt fragen.": "Not legal advice — when in doubt, ask a specialist lawyer.",
  "Vertragsdokument": "Contract document",
  // Sachgründe, § 14 Abs. 1 S. 2 Nr. 1–8 TzBfG
  "Vorübergehender betrieblicher Bedarf (Nr. 1)": "Temporary operational need (No. 1)",
  "Erleichterung des Übergangs nach Ausbildung/Studium (Nr. 2)": "Easing the transition after training/studies (No. 2)",
  "Vertretung einer anderen Arbeitskraft (Nr. 3)": "Covering for another employee (No. 3)",
  "Eigenart der Arbeitsleistung (Nr. 4)": "Nature of the work itself (No. 4)",
  "Erprobung (Nr. 5)": "Trial period (No. 5)",
  "In der Person liegende Gründe (Nr. 6)": "Reasons specific to the person (No. 6)",
  "Haushaltsmittel für befristete Beschäftigung (Nr. 7)": "Budget funds earmarked for fixed-term employment (No. 7)",
  "Gerichtlicher Vergleich (Nr. 8)": "Court settlement (No. 8)",

  // GehaltSichtbarkeit.jsx (DS-09)
  "Gehälter zeigen": "Show salaries",
  "Gehälter verbergen": "Hide salaries",

  // GehaltsVerlauf.jsx
  "Gehaltsverlauf": "Salary history",
  "Gehaltsschritt hinzufügen": "Add salary step",
  "Korrektur": "Correction",
  "Noch kein Gehaltsschritt erfasst.": "No salary step recorded yet.",
  "Nächste Prüfung": "Next review",
  "nächste Prüfung": "next review",
  "Zusatzleistungen (kommagetrennt)": "Additional benefits (comma-separated)",
  // Gehaltsaenderung.art — Anzeige "Anfangsgehalt" statt des bloßen Wortes
  // "Einstellung" (i18n.jsx führt das bereits als "Setting").
  "Anfangsgehalt": "Starting salary",
  "Erhöhung": "Increase",

  // PersonalDokumente.jsx
  "Datei hochladen": "Upload file",
  "Datei zu groß ({groesse}, höchstens {max} MB).": "File too large ({groesse}, at most {max} MB).",
  "Noch keine Anhänge.": "No attachments yet.",
  "Datei nicht gefunden.": "File not found.",
  "Die Datei wird zusammen mit ihren Metadaten endgültig gelöscht.": "The file is permanently deleted together with its metadata.",
  "Aufbewahrung bis": "Retained until",
  "Der Browser-Speicher ist voll — die Datei konnte nicht gespeichert werden.": "Browser storage is full — the file could not be saved.",
  "entfernen": "remove",
  "entfernen?": "remove?",
  // Kategorien der Personaldokumente (Kammer/Sonstiges bereits vorhanden)
  "Vertrag": "Contract",
  "Nachweis": "Evidence",
  "Zeugnis": "Reference",
  "Qualifikation": "Qualification",

  // FristenLeiste.jsx
  "Keine fälligen Fristen.": "No deadlines due.",
  "fällige Fristen": "deadlines due",
  "Quittieren": "Acknowledge",
  "alle anzeigen": "show all",

  // PersonalUebersicht.jsx (vierte Kachel) / MitarbeiterDetail.jsx (Vertrag-Slot, Dokumente)
  "Fällig": "Due",
  "Dokumente": "Documents",
  "Kein aktiver Vertrag.": "No active contract.",
  "Probezeit endet": "Probation ends",
  "Urlaubsanspruch (laufendes Jahr)": "Leave entitlement (current year)",

  // vertrag.js — pruefeVertrag/befristungPruefen/mindestlohnPruefen: dynamische
  // t(item.schluessel)-Aufrufe (Vorlagen mit {platzhalter}, siehe Kopf der Datei
  // und REGEL_PRUEFTEXTE-Muster in @core/lib/regelwerk.js). Der i18n-Wächter
  // erfasst nur literale t() -Aufrufe mit festem Text automatisch — diese hier von Hand
  // abgeglichen (analog "Wie i18n geprüft wurde", 80-04-SUMMARY).
  "Probezeit {monate} Monate überschreitet die Höchstdauer von {max} Monaten.":
    "Probation of {monate} months exceeds the maximum of {max} months.",
  "Urlaub {tage} Tage unterschreitet den gesetzlichen Mindesturlaub von {mindest} Tagen bei {arbeitstage} Arbeitstagen/Woche.":
    "Leave of {tage} days is below the statutory minimum of {mindest} days at {arbeitstage} working days/week.",
  "Wochenstunden {stunden} überschreiten die Höchstgrenze von 48 Stunden.":
    "Weekly hours of {stunden} exceed the maximum of 48 hours.",
  "Sachgrundlose Befristung {monate} Monate überschreitet die Höchstdauer von {max} Monaten.":
    "Fixed term without cause of {monate} months exceeds the maximum of {max} months.",
  "{anzahl} Verlängerungen überschreiten die Höchstzahl von {max}.":
    "{anzahl} extensions exceed the maximum of {max}.",
  "Vorbeschäftigung bei diesem Arbeitgeber gefunden — Einzelfallprüfung nach BVerfG, Beschluss vom 06.06.2018 (1 BvL 7/14).":
    "Prior employment with this employer found — case-by-case review under the Federal Constitutional Court's decision of 06.06.2018 (1 BvL 7/14).",
  "Befristung {monate} Monate überschreitet die Höchstdauer von {max} Monaten für Neugründungen.":
    "Fixed term of {monate} months exceeds the maximum of {max} months for newly founded businesses.",
  "Befristung {monate} Monate überschreitet die Höchstdauer von {max} Monaten ab dem 52. Lebensjahr.":
    "Fixed term of {monate} months exceeds the maximum of {max} months from age 52.",
  "Schriftform nicht vor Beginn nachgewiesen — der Vertrag gilt sonst kraft Gesetzes als unbefristet (§ 16 TzBfG).":
    "Written form not confirmed before the start date — otherwise the contract counts as open-ended by law (§ 16 TzBfG).",
  "Probezeit {probezeit} Monate ist mehr als die Hälfte der Vertragslaufzeit ({laufzeit} Monate) — im Einzelfall prüfen ([ASSUMED] 50 %-Schwelle, BAG 2 AZR 275/23 lehnt feste Prozentsätze ab).":
    "Probation of {probezeit} months is more than half the contract term ({laufzeit} months) — review case by case ([ASSUMED] 50% threshold; the Federal Labour Court, 2 AZR 275/23, rejects fixed percentages).",
  "{betrag} €/Stunde unterschreitet den Mindestlohn von {mindestlohn} €/Stunde (Stand {datum}).":
    "{betrag} €/hour is below the minimum wage of {mindestlohn} €/hour (as of {datum}).",

  // kuendigung.js — kuendigungsfristGesetzlich: die drei festen Warnungen und
  // die § 622 Abs. 6-Warnung, alle statisch (t(w.text), dynamischer Aufruf).
  "Sonderkündigungsschutz prüfen.": "Check special protection against dismissal.",
  "Ist das Kündigungsschutzgesetz anwendbar? Siehe Kopfzahl.": "Does the Dismissal Protection Act apply? See the headcount.",
  "Schriftform erforderlich — eine E-Mail genügt nicht.": "Written form required — an email is not enough.",
  "Die vereinbarte Arbeitnehmerfrist ist länger als die gesetzliche Arbeitgeberfrist — unwirksam, es gilt die kürzere Frist.":
    "The agreed employee notice period is longer than the statutory employer notice period — invalid; the shorter period applies.",

  // fristen.js — FRIST_QUELLEN: dynamische t(eintrag.schluessel)-Aufrufe.
  "Probezeit endet {datum}": "Probation ends {datum}",
  "Befristung endet {datum} — Arbeitsuchendmeldung nicht vergessen (§ 38 Abs. 1 SGB III)":
    "Fixed term ends {datum} — do not forget the job-seeking notification (§ 38 (1) SGB III)",
  "Über eine Verlängerung der Befristung bis {datum} entscheiden": "Decide on extending the fixed term by {datum}",
  "Höchstgrenze der sachgrundlosen Befristung: {datum}": "Maximum for fixed term without cause: {datum}",
  "Gehaltsgespräch vorgesehen {datum}": "Salary review scheduled {datum}",
  "Qualifikation „{bezeichnung}“ läuft ab {datum}": "Qualification “{bezeichnung}” expires {datum}",
  "Immatrikulationsbescheinigung anfordern (nächster Termin {datum})": "Request proof of enrolment (next date {datum})",
  "Hinweis auf offenen Urlaub für {anzahl} Beschäftigte": "Notice of outstanding leave for {anzahl} staff",
  "Übertragener Urlaub verfällt {datum}": "Carried-over leave expires {datum}",

  // urlaub.js — urlaubsanspruch: dynamischer t(anspruch.schluessel)-Aufruf.
  "Wartezeit erfüllt am {datum} (§ 4 BUrlG) — voller Jahresanspruch {tage} Tage (§ 3 Abs. 1 BUrlG).":
    "Waiting period met on {datum} (§ 4 BUrlG) — full annual entitlement {tage} days (§ 3 (1) BUrlG).",
  "{monate}/12 × {voll} Tage = {ergebnis} Tage (§ 5 Abs. 1 BUrlG), aufgerundet (§ 5 Abs. 2 BUrlG).":
    "{monate}/12 × {voll} days = {ergebnis} days (§ 5 (1) BUrlG), rounded up (§ 5 (2) BUrlG).",
  "{monate}/12 × {voll} Tage = {ergebnis} Tage (§ 5 Abs. 1 BUrlG).":
    "{monate}/12 × {voll} days = {ergebnis} days (§ 5 (1) BUrlG).",
};
