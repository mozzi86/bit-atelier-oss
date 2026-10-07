// HR rule book (80-01, 80-RESEARCH § Domain-Regeln): labour-law values, retention
// periods, reminder lead times and office standards as rules in the shape of the
// rule core (@core/lib/regelwerk.js), each with its norm and date.
//
// - `art:'gesetz'`: statutory values, read-only; a change of the law comes with an
//   update (like GESETZ in 79).
// - `art:'praxis'`: established practice values ([ASSUMED], with the reason and the
//   way to a confirmed value), read-only like the practice values of 79.
// - `art:'buero'`:  office standards, editable within their `grenze`.
// Office values without a change in time start at 2000-01-01 (like SEIT_JEHER in 79:
// the exact start date does not matter for these books).
//
// Deliberately NOT here:
// - the legal form: it belongs to 79 (`buchhaltung.rechtsform`, E-04 switch, default
//   Einzelunternehmen); HR reads it from there;
// - the retention of accounting vouchers: 79 GESETZ.AUFBEWAHRUNG;
// - an employer cost factor or employer share: E-16 ("AG-Anteil 21 %") has exactly
//   one source, `zeit_honorar.ag_anteil` of phase 81. A second editable row for the
//   same value would be dead after 81 (80-10 prefers 81).
//
// In:  nothing. Out: HR_STAND, HR_REGELN (deep-frozen). Labels and section names are
//      German i18n keys (EN in i18n.jsx, block 80-01; the guard reads REGELWERKE).

/** Date of the research the values below were checked against ('YYYY-MM-DD'). */
export const HR_STAND = "2026-09-27";

/** Start of office values without a change in time. */
const SEIT_JEHER = "2000-01-01";

const A_BESCHAEFTIGUNG = "Mindestlohn & Beschäftigungsarten";
const A_KUENDIGUNG = "Probezeit & Kündigung";
const A_BEFRISTUNG = "Befristung";
const A_URLAUB = "Urlaub";
const A_ARBEITSZEIT = "Arbeitszeit & Bürostandards";
const A_AUFBEWAHRUNG = "Aufbewahrung & Löschung";
const A_ERINNERUNG = "Erinnerungen";
const A_DATEIEN = "Dateien";

/**
 * Freezes a rule tree; functions (formulas) stay as they are.
 * @template T
 * @param {T} wert
 * @returns {T}
 */
function tiefGefroren(wert) {
  if (wert && typeof wert === "object" && !Object.isFrozen(wert)) {
    for (const k of Object.keys(wert)) tiefGefroren(/** @type {any} */ (wert)[k]);
    Object.freeze(wert);
  }
  return wert;
}

/**
 * One rule with the fields every HR rule shares filled in.
 * @param {Partial<import("@core/lib/regelwerk.js").Regel> & {id: string}} r
 * @returns {import("@core/lib/regelwerk.js").Regel}
 */
function regel(r) {
  return /** @type {any} */ ({ stand: HR_STAND, werte: [], ...r, id: `personal.${r.id}` });
}

/**
 * Reminder lead time as an office value: whole days, 0 … 365.
 * @param {string} id rule name after "personal."
 * @param {string} label German i18n key
 * @param {number} tage default lead time in days
 * @param {string} [quelle] source; default: office standard
 * @returns {import("@core/lib/regelwerk.js").Regel}
 */
function vorlauf(id, label, tage, quelle = "Bürostandard") {
  return regel({
    id, label, einheit: "Tage", typ: "zahl", art: "buero", abschnitt: A_ERINNERUNG,
    werte: [{ ab: SEIT_JEHER, wert: tage }], quelle,
    // [ASSUMED] office default; reminders are shown in the app only.
    assumed: "Bürostandard für die Erinnerung — vom Büro festzulegen",
    grenze: { min: 0, max: 365, modus: "fail", quelle: "Eingabebereich der App (0 bis 365 Tage)" },
  });
}

/**
 * The HR rule book. Ids are stable (links, Setting keys "regel:<id>" and the plans of
 * 80-04 … 80-10 name them) — never rename one.
 * @type {ReadonlyArray<import("@core/lib/regelwerk.js").Regel>}
 */
export const HR_REGELN = tiefGefroren([
  // --- Minimum wage and kinds of employment ---------------------------------------
  regel({
    id: "mindestlohn", label: "Gesetzlicher Mindestlohn", einheit: "Euro/Stunde", typ: "zahl", art: "gesetz",
    abschnitt: A_BESCHAEFTIGUNG, quelle: "§ 1 MiLoG i. V. m. der Mindestlohnanpassungsverordnung",
    werte: [
      { ab: "2025-01-01", wert: 12.82, quelle: "§ 1 MiLoG, Vierte Mindestlohnanpassungsverordnung" },
      { ab: "2026-01-01", wert: 13.9, quelle: "§ 1 MiLoG, Fünfte Mindestlohnanpassungsverordnung" },
      // [ASSUMED] 2027: second step of the minimum wage commission's decision of
      // 27.06.2025 — confirm against the ordinance as promulgated in the BGBl.
      { ab: "2027-01-01", wert: 14.6, quelle: "Beschluss der Mindestlohnkommission vom 27.06.2025 [ASSUMED]" },
    ],
    assumed: "Wert ab 2027 aus dem Beschluss der Mindestlohnkommission (27.06.2025) — vor Verwendung gegen die im BGBl verkündete Verordnung prüfen",
  }),
  regel({
    id: "minijob_grenze", label: "Minijob-Verdienstgrenze", einheit: "Euro/Monat", typ: "formel", art: "gesetz",
    abschnitt: A_BESCHAEFTIGUNG, editierbar: false,
    quelle: "§ 8 Abs. 1a SGB IV (Mindestlohn × 130 / 3, auf volle Euro aufgerundet)",
    // § 8 Abs. 1a SGB IV: minimum wage × 130 hours / 3, rounded up to full euros.
    // Computed in cents so a product like 13,90 × 130 cannot land a hair above an
    // integer and round up one euro too many. No minimum wage on the date → null.
    formel: (_stichtag, wertVon) => {
      const m = wertVon("personal.mindestlohn");
      return typeof m === "number" && Number.isFinite(m) ? Math.ceil((Math.round(m * 100) * 130) / 300) : null;
    },
  }),
  regel({
    id: "midijob_obergrenze", label: "Obergrenze des Übergangsbereichs (Midijob)", einheit: "Euro/Monat", typ: "zahl",
    art: "gesetz", abschnitt: A_BESCHAEFTIGUNG, quelle: "§ 20 Abs. 2 SGB IV",
    werte: [{ ab: "2023-01-01", wert: 2000, quelle: "§ 20 Abs. 2 SGB IV" }],
  }),
  regel({
    id: "werkstudent_max_h", label: "Werkstudierende: Wochenstunden in der Vorlesungszeit höchstens", einheit: "Stunden/Woche",
    typ: "zahl", art: "praxis", abschnitt: A_BESCHAEFTIGUNG, editierbar: false,
    quelle: "§ 6 Abs. 1 Nr. 3 SGB V (20-Stunden-Grenze der Rechtsprechung)",
    werte: [{ ab: SEIT_JEHER, wert: 20 }],
    // [ASSUMED] practice of the social insurance carriers (BSG case law), no fixed statutory limit.
    assumed: "Richtwert der Sozialversicherungspraxis (Rechtsprechung des BSG), keine feste gesetzliche Grenze — im Einzelfall mit dem Lohnbüro klären",
  }),
  regel({
    id: "praktikum_ohne_milo_monate", label: "Freiwilliges Praktikum ohne Mindestlohn bis", einheit: "Monate", typ: "zahl",
    art: "gesetz", abschnitt: A_BESCHAEFTIGUNG, quelle: "§ 22 Abs. 1 S. 2 Nr. 2 und 3 MiLoG",
    werte: [{ ab: "2015-01-01", wert: 3, quelle: "§ 22 Abs. 1 S. 2 Nr. 2 und 3 MiLoG" }],
  }),

  // --- Probation and notice ------------------------------------------------------------
  regel({
    id: "probezeit_max_monate", label: "Probezeit höchstens", einheit: "Monate", typ: "zahl", art: "gesetz",
    abschnitt: A_KUENDIGUNG, quelle: "§ 622 Abs. 3 BGB", werte: [{ ab: SEIT_JEHER, wert: 6 }],
  }),
  regel({
    id: "kuendigung_staffel", label: "Kündigungsfristen des Arbeitgebers nach Betriebszugehörigkeit",
    einheit: "Jahre → Monate zum Monatsende", typ: "tabelle", art: "gesetz", abschnitt: A_KUENDIGUNG, editierbar: false,
    quelle: "§ 622 Abs. 2 BGB",
    // [years of service, months to the end of a calendar month]. The rule "years before
    // the age of 25 do not count" (former second sentence of § 622 Abs. 2 BGB) is
    // deliberately not modelled: the ECJ held it inapplicable (C-555/07 Kücükdeveci, 2010).
    werte: [{ ab: SEIT_JEHER, wert: [[2, 1], [5, 2], [8, 3], [10, 4], [12, 5], [15, 6], [20, 7]] }],
  }),

  // --- Fixed-term contracts ----------------------------------------------------------------
  regel({
    id: "befristung_sachgrundlos_monate", label: "Befristung ohne Sachgrund höchstens", einheit: "Monate", typ: "zahl",
    art: "gesetz", abschnitt: A_BEFRISTUNG, quelle: "§ 14 Abs. 2 S. 1 TzBfG", werte: [{ ab: SEIT_JEHER, wert: 24 }],
  }),
  regel({
    id: "befristung_sachgrundlos_verlaengerungen", label: "Befristung ohne Sachgrund: Verlängerungen höchstens",
    einheit: "Anzahl", typ: "zahl", art: "gesetz", abschnitt: A_BEFRISTUNG, quelle: "§ 14 Abs. 2 S. 1 TzBfG",
    werte: [{ ab: SEIT_JEHER, wert: 3 }],
  }),
  regel({
    id: "befristung_gruendung_monate", label: "Befristung in den ersten vier Jahren nach der Gründung höchstens",
    einheit: "Monate", typ: "zahl", art: "gesetz", abschnitt: A_BEFRISTUNG, quelle: "§ 14 Abs. 2a TzBfG",
    werte: [{ ab: SEIT_JEHER, wert: 48 }],
  }),
  regel({
    id: "befristung_52plus_monate", label: "Befristung ab dem 52. Lebensjahr höchstens", einheit: "Monate", typ: "zahl",
    art: "gesetz", abschnitt: A_BEFRISTUNG, quelle: "§ 14 Abs. 3 TzBfG", werte: [{ ab: SEIT_JEHER, wert: 60 }],
  }),

  // --- Holiday ----------------------------------------------------------------------------
  regel({
    id: "urlaub_mindest_werktage", label: "Gesetzlicher Mindesturlaub", einheit: "Werktage", typ: "zahl", art: "gesetz",
    abschnitt: A_URLAUB, quelle: "§ 3 BUrlG", werte: [{ ab: SEIT_JEHER, wert: 24 }],
  }),
  regel({
    id: "urlaub_buero_standard", label: "Urlaub im Bürostandard", einheit: "Arbeitstage", typ: "zahl", art: "buero",
    abschnitt: A_URLAUB, quelle: "Bürostandard; Untergrenze § 3 BUrlG", werte: [{ ab: SEIT_JEHER, wert: 28 }],
    // [ASSUMED] office standard; below the statutory minimum the clause would be void,
    // hence `fail` (§ 13 Abs. 1 BUrlG).
    assumed: "Bürostandard, üblich sind 25 bis 30 Arbeitstage — vom Büro festzulegen",
    grenze: { min: 20, modus: "fail", quelle: "§ 3 BUrlG (24 Werktage = 20 Arbeitstage bei 5-Tage-Woche)" },
  }),
  regel({
    id: "uebertrag_bis", label: "Übertragener Urlaub verfällt am", einheit: "MM-TT", typ: "monatstag", art: "gesetz",
    abschnitt: A_URLAUB, quelle: "§ 7 Abs. 3 S. 3 BUrlG", werte: [{ ab: SEIT_JEHER, wert: "03-31" }],
  }),
  regel({
    id: "resturlaub_hinweis_bis", label: "Hinweis auf offenen Urlaub spätestens am", einheit: "MM-TT", typ: "monatstag",
    art: "buero", abschnitt: A_URLAUB, quelle: "BAG, Urteil vom 19.02.2019 – 9 AZR 541/15 (Hinweisobliegenheit)",
    werte: [{ ab: SEIT_JEHER, wert: "09-30" }],
    // [ASSUMED] the notice must come early enough for the leave to be taken; the date is an office choice.
    assumed: "Der Hinweis muss so rechtzeitig kommen, dass der Urlaub noch genommen werden kann; der 30.09. ist eine Annahme des Büros",
  }),

  // --- Working time and office standards ---------------------------------------------------
  regel({
    id: "wochenstunden_standard", label: "Wochenarbeitszeit im Bürostandard", einheit: "Stunden/Woche", typ: "zahl",
    art: "buero", abschnitt: A_ARBEITSZEIT, quelle: "Bürostandard; Höchstgrenze § 3 ArbZG", werte: [{ ab: SEIT_JEHER, wert: 40 }],
    // [ASSUMED] office standard. `warn`, not `fail`: § 3 S. 2 ArbZG allows up to ten
    // hours a day when the average stays at eight, so more than 48 is not void in
    // itself — the office decides and sees the norm.
    assumed: "Bürostandard (Vollzeit) — vom Büro festzulegen",
    grenze: { min: 1, max: 48, modus: "warn", quelle: "§ 3 ArbZG (8 Stunden an 6 Werktagen)" },
  }),
  regel({
    id: "arbeitstage_standard", label: "Arbeitstage je Woche im Bürostandard", einheit: "Tage/Woche", typ: "zahl",
    art: "buero", abschnitt: A_ARBEITSZEIT, quelle: "Bürostandard", werte: [{ ab: SEIT_JEHER, wert: 5 }],
    // [ASSUMED] office standard; a seventh working day would break the Sunday rest.
    assumed: "Bürostandard (Montag bis Freitag) — vom Büro festzulegen",
    grenze: { min: 1, max: 6, modus: "fail", quelle: "§ 9 Abs. 1 ArbZG (Sonn- und Feiertagsruhe)" },
  }),
  regel({
    id: "probezeit_standard_monate", label: "Probezeit im Bürostandard", einheit: "Monate", typ: "zahl", art: "buero",
    abschnitt: A_ARBEITSZEIT, quelle: "Bürostandard; Höchstgrenze § 622 Abs. 3 BGB", werte: [{ ab: SEIT_JEHER, wert: 6 }],
    // [ASSUMED] office standard; beyond six months the shortened notice no longer applies.
    assumed: "Bürostandard — vom Büro festzulegen",
    grenze: { min: 0, max: 6, modus: "fail", quelle: "§ 622 Abs. 3 BGB" },
  }),

  // --- Retention and deletion ---------------------------------------------------------------
  regel({
    id: "aufbewahrung_bewerbung_monate", label: "Bewerbungsunterlagen löschen nach der Absage", einheit: "Monate", typ: "zahl",
    art: "praxis", abschnitt: A_AUFBEWAHRUNG, editierbar: false, quelle: "§ 15 Abs. 4 AGG i. V. m. § 61b Abs. 1 ArbGG",
    werte: [{ ab: SEIT_JEHER, wert: 6 }],
    // [ASSUMED] practice: 2 months to claim + 3 months to sue + delivery; recommendation of the data protection authorities.
    assumed: "Praxiswert: 2 Monate Geltendmachung, 3 Monate Klagefrist und Zustellung; Empfehlung der Datenschutzaufsicht — mit anwaltlicher Beratung bestätigen",
  }),
  regel({
    id: "aufbewahrung_talentpool_monate", label: "Talentpool höchstens", einheit: "Monate", typ: "zahl", art: "praxis",
    abschnitt: A_AUFBEWAHRUNG, editierbar: false, quelle: "Art. 6 Abs. 1 lit. a, Art. 7 DSGVO (Einwilligung)",
    werte: [{ ab: SEIT_JEHER, wert: 24 }],
    // [ASSUMED] practice; the consent text names the duration.
    assumed: "Praxiswert; die Einwilligung nennt die Dauer — mit der Datenschutzberatung bestätigen",
  }),
  regel({
    id: "aufbewahrung_personalakte_jahre", label: "Personalakte aufbewahren nach dem Austrittsjahr", einheit: "Jahre", typ: "zahl",
    art: "praxis", abschnitt: A_AUFBEWAHRUNG, editierbar: false, quelle: "§§ 195, 199 BGB (regelmäßige Verjährung)",
    werte: [{ ab: SEIT_JEHER, wert: 3 }],
    // [ASSUMED] practice: regular limitation from the end of the year; single documents keep longer periods.
    assumed: "Praxiswert: regelmäßige Verjährung ab Jahresende; einzelne Unterlagen haben längere Fristen",
  }),
  regel({
    id: "aufbewahrung_lohnkonto_jahre", label: "Lohnkonto aufbewahren nach dem Jahr der letzten Eintragung", einheit: "Jahre",
    typ: "zahl", art: "gesetz", abschnitt: A_AUFBEWAHRUNG, quelle: "§ 41 Abs. 1 S. 9 EStG (bis zum Ablauf des sechsten Kalenderjahres)",
    werte: [{ ab: SEIT_JEHER, wert: 6 }],
  }),
  regel({
    id: "aufbewahrung_arbeitszeit_jahre", label: "Arbeitszeitnachweise aufbewahren", einheit: "Jahre", typ: "zahl",
    art: "gesetz", abschnitt: A_AUFBEWAHRUNG, quelle: "§ 16 Abs. 2 ArbZG", werte: [{ ab: SEIT_JEHER, wert: 2 }],
  }),
  regel({
    id: "aufbewahrung_loeschprotokoll_jahre", label: "Löschprotokoll aufbewahren", einheit: "Jahre", typ: "zahl",
    art: "praxis", abschnitt: A_AUFBEWAHRUNG, editierbar: false, quelle: "Art. 5 Abs. 2 DSGVO (Rechenschaftspflicht)",
    werte: [{ ab: SEIT_JEHER, wert: 3 }],
    // [ASSUMED] practice; the log carries no names.
    assumed: "Praxiswert — das Protokoll enthält keine Namen; Dauer mit der Datenschutzberatung bestätigen",
  }),

  // --- Reminder lead times (reminders appear in the app only) -------------------------------
  vorlauf("vorlauf_probezeit", "Erinnerung vor dem Ende der Probezeit", 28),
  // 97 days = 3 months + 1 week buffer before the job-seeker notice of § 38 Abs. 1 SGB III.
  vorlauf("vorlauf_befristung", "Erinnerung vor dem Ende einer Befristung", 97, "Bürostandard; § 38 Abs. 1 SGB III (3 Monate + 1 Woche Puffer)"),
  vorlauf("vorlauf_befristung_entscheidung", "Erinnerung: über die Verlängerung einer Befristung entscheiden", 42),
  vorlauf("vorlauf_gehaltsgespraech", "Erinnerung vor einem Gehaltsgespräch", 30),
  vorlauf("vorlauf_qualifikation", "Erinnerung vor dem Ablauf einer Qualifikation", 60),
  vorlauf("vorlauf_immatrikulation", "Erinnerung: Immatrikulationsbescheinigung anfordern", 14),
  vorlauf("vorlauf_talentpool", "Erinnerung vor dem Ablauf des Talentpools", 30),
  vorlauf("vorlauf_checkliste", "Erinnerung an offene Punkte der Checklisten", 14),
  vorlauf("vorlauf_bewerbung_loeschen", "Erinnerung vor dem Löschen einer Bewerbung", 14),

  // --- Files ----------------------------------------------------------------------------------
  regel({
    id: "datei_max_mb", label: "Größte Personaldatei", einheit: "MB", typ: "zahl", art: "buero", abschnitt: A_DATEIEN,
    quelle: "Technische Grenze: Express-JSON-Limit 10 MB (Base64 +33 %)", werte: [{ ab: SEIT_JEHER, wert: 7 }],
    // 7 MB as Base64 are 9,3 MB — just below the 10 MB JSON limit of server/index.js.
    grenze: { min: 1, max: 7, modus: "fail", quelle: "Express-JSON-Limit 10 MB (server/index.js)" },
  }),
]);
