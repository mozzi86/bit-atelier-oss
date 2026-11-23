// W-1118-22 (the client moves furniture in the portal, the office takes the proposal over): English texts of
// MoeblierungAnsicht, Bauherrenzugang and the reasons of bauherrMoeblierung.js / bauherrProjektion.js.
// Format and guard as in every part file (tests/unit/i18nAbdeckung.test.js).
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  // portal
  "Möbel antippen und ziehen. Sie bleiben im Raum und rasten an der Wand ein. Gespeichert wird nichts — erst „Vorschlag senden“ schickt Ihre Fassung ans Büro.": "Tap a piece of furniture and drag it. It stays inside its room and snaps to the wall. Nothing is saved — only “Send proposal” sends your version to the office.",
  "Gedreht passt das Möbel hier nicht in den Raum — erst verschieben.": "Turned, the piece does not fit into the room here — move it first.",
  "Ihr Vorschlag ist beim Büro angekommen. Das Büro prüft ihn und meldet sich.": "Your proposal has reached the office. The office checks it and gets back to you.",
  "Alles wie freigegeben": "Everything as released",
  "Möbel geändert": "pieces changed",
  "Einige Möbel überlappen sich. Sie können den Vorschlag trotzdem senden — das Büro sieht den Hinweis.": "Some pieces overlap. You can still send the proposal — the office sees the note.",
  "Vorschau: hier wird nichts gesendet.": "Preview: nothing is sent here.",
  "Wird gesendet …": "Sending …",
  "Vorschlag senden": "Send proposal",
  "Zum Ansehen freigegeben — das Büro hat keinen Vorschlag angefragt.": "Released for viewing — the office has not asked for a proposal.",
  // office
  "Möbel aus dem Vorschlag übernommen.": "pieces taken over from the proposal.",
  "gibt es im Modell nicht mehr.": "no longer exist in the model.",
  "Die Freigabe der Möblierung jetzt erneuern, damit der Bauherr den neuen Stand sieht.": "Renew the release of the furnishing now so the client sees the new state.",
  "Vorschlag anfragen (Bauherr darf Möbel rücken)": "Ask for a proposal (the client may move furniture)",
  "Möbel verschoben oder gedreht": "pieces moved or turned",
  "nicht zulässig": "not permitted",
  "Überlappung(en)": "overlap(s)",
  "Ins Modell übernehmen": "Take over into the model",
  "moeblierung": "furniture proposal",
  // reasons (bauherrMoeblierung.js, bauherrProjektion.js)
  "Zu dieser Möblierung ist kein Vorschlag angefragt.": "No proposal has been asked for on this furnishing.",
  "Zu diesem Eintrag ist kein Möblierungsvorschlag angefragt.": "No furniture proposal has been asked for on this entry.",
  "Der Vorschlag ist nicht lesbar.": "The proposal cannot be read.",
  "Der Vorschlag ändert nichts.": "The proposal changes nothing.",
  "Der Vorschlag ist zu groß.": "The proposal is too large.",
  "Kein Eintrag des Vorschlags ist zulässig.": "No entry of the proposal is permitted.",
  "Dieses Möbel gibt es in der freigegebenen Möblierung nicht.": "This piece does not exist in the released furnishing.",
  "Das Möbel stünde außerhalb seines Raums.": "The piece would stand outside its room.",
  "Für dieses Projekt ist kein Entwurf gespeichert.": "No design is stored for this project.",
};
