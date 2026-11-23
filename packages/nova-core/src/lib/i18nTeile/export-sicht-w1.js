// English texts of the export restriction (wave 1, W1-BUERO-F1; lazy part). Not listed in
// i18nTeile/index.js: src/lib/exportSichtBereiche.js imports this file and calls englischErgaenzen,
// so the entry chunk stays untouched. Keys: the refusal texts of @core/api/exportSicht.js and
// demoDb.SCHNAPPSCHUSS_PFLICHT_TEXT (review follow-up R-BUERO-2/3).
//
// In:  nothing. Out: EN.

/** @type {Record<string, string>} */
export const EN = {
  "Die Rechte sind noch nicht geladen. Der Export ist erst danach möglich.":
    "Permissions are not loaded yet. Exporting is possible only after that.",
  // R-BUERO-2: the rights load failed (EXPORT_LADEFEHLER_TEXT).
  "Die Rechte konnten nicht geladen werden. Bitte die Seite neu laden; der Export ist erst danach möglich.":
    "Permissions could not be loaded. Please reload the page; exporting is possible only after that.",
  // R-BUERO-3: a restricted role's import without the full snapshot (demoDb.SCHNAPPSCHUSS_PFLICHT_TEXT).
  "Der vollständige Schnappschuss vor dem Import konnte nicht angelegt werden. Mit eingeschränkter Ansicht wird ohne ihn nichts ersetzt.":
    "The full snapshot before the import could not be taken. With a restricted view nothing is replaced without it.",
};
