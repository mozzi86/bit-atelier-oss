// Besitzer: 88-06 — nur diese Datei ändern.
//
// English dictionary part of the page "Werkplanung & Baustelle" and its plan list
// (src/pages/Werkplanung.jsx, src/components/werkplanung/PlanListe.jsx,
// src/lib/werkplanung/plaene.js). Existing keys ("Index", "Format", "Maßstab",
// "Freigeben" …) are not repeated (duplicate guard in tests/unit/i18nAbdeckung.test.js).
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  "Planliste": "Drawing list",
  "In Arbeit": "In progress",
  "Vorabzug": "Preliminary issue",
  "Plannummer fehlt": "Drawing number missing",
  "Plannummer im Projekt doppelt": "Drawing number used twice in the project",
  "Maßstab nicht im Format 1:n": "Scale not in the format 1:n",
  "Planinhalt fehlt": "Drawing title missing",
  "Freigegeben ohne hinterlegte Plandatei": "Released without a stored drawing file",
  "Pläne konnten nicht geladen werden": "Drawings could not be loaded",
  "Plan konnte nicht gespeichert werden": "The drawing could not be saved",
  "Freigabe nur aus „Geprüft“ und mit Namen": "Release only from “Checked” and with a name",
  "Freigabe konnte nicht gespeichert werden": "The release could not be saved",
  "Änderung beschreiben, dann neuen Index anlegen": "Describe the change, then create the new revision",
  "Index konnte nicht gespeichert werden": "The revision could not be saved",
  "Plandatei konnte nicht abgelegt werden": "The drawing file could not be filed",
  "Neuer Plan": "New drawing",
  "Noch keine Pläne in diesem Projekt.": "No drawings in this project yet.",
  "Hinweise": "Notes",
  "Neuer Index": "New revision",
  "PDF ersetzen": "Replace PDF",
  "PDF ablegen": "File PDF",
  "Plannummer nach dem Schema des Plankopfs: Projekt-LPH-Gewerk-Nr-Index. Freigabe und Indexwechsel stehen im Audit-Log.": "Drawing number after the title block scheme: project-stage-discipline-no-revision. Releases and revisions are recorded in the audit log.",
  "Plan bearbeiten": "Edit drawing",
  "Plan freigeben": "Release drawing",
  "Freigegeben von": "Released by",
  "Die Freigabe wird mit Name und Zeit im Audit-Log festgehalten und nicht mehr geändert.": "The release is recorded with name and time in the audit log and never changed.",
  "Änderung": "Change",
  "Ein neuer Index setzt den Status auf „In Arbeit“ zurück; die alte Freigabe bleibt im Audit-Log.": "A new revision resets the status to “In progress”; the old release stays in the audit log.",
  "Index anlegen": "Create revision",
  "Projektkürzel": "Project code",
  "Fachsicht / Gewerk": "Discipline / trade",
  "Laufende Nr.": "Serial no.",
};
