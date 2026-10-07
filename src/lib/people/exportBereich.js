// exportBereich.js — die EINE Registry-Zeile "Personal" für den 79-12-
// Exportdialog (Plan 80-10, Task 7b, E-07/E-14). `separat: ".bitpers"` heißt:
// diese Fläche geht NIE in die `.bitproj` (auch nicht in der vollen
// Sicherung), sondern über personalDatei.js in eine eigene, verschlüsselte
// Datei — `src/lib/exportBereiche.js` (79-12) trägt genau diese eine Zeile in
// `EXPORT_BEREICHE` ein, der registry-getriebene Exportdialog (80-05) rendert
// das Häkchen daraus von selbst.
//
// `settingKeys` ist eine EXAKTE Schlüsselliste (nicht nur eine Untermenge):
// 79-12s `exportOptionen`/`ohneSettingKeys` vergleicht exakt, damit eine neue
// HR-Regel automatisch mitgenommen wird, ohne diese Datei erneut anzufassen.
//
// In:  PERSONAL_ENTITAETEN (@core), HR_REGELN. Out: PERSONAL_EXPORT_BEREICH.

import { PERSONAL_ENTITAETEN } from "@core/api/personalEntitaeten.js";
import { HR_REGELN } from "./hrRegeln.js";

/**
 * Die Registry-Zeile "Personal" (79-12 `ExportBereich`-Form): `entitaeten` für
 * die Zählung im Exportdialog, `settingKeys` für die HR-Setting-Zeilen (jede
 * HR-Regel-Override-Zeile "regel:personal.<id>" plus die beiden Setting-
 * Schlüssel, die 80-09 direkt — ohne Regel-Umweg — schreibt), `separat`
 * markiert die eigene verschlüsselte Datei statt eines `.bitproj`-Häkchens.
 * @type {Readonly<{key: 'personal', label: 'Personal', entitaeten: readonly string[], settingKeys: string[], separat: '.bitpers'}>}
 */
export const PERSONAL_EXPORT_BEREICH = Object.freeze({
  key: "personal",
  label: "Personal",
  entitaeten: PERSONAL_ENTITAETEN,
  settingKeys: [...HR_REGELN.map((r) => "regel:" + r.id), "personal.vorlagen", "personal.zaehlkarte"],
  separat: ".bitpers",
});
