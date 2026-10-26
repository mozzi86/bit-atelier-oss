// 106-01: English texts of the pointing states (@core/lib/zeigen/zustaende.js). The labels are
// passed to t() by variable (t(ZEIGE_ZUSTAENDE[name].label)), so the coverage guard does not
// see them — they are listed here so the English UI does not fall back to German.
// 106-01 integration: plus the element kinds the BIM studio shows in its hover overlay.
// 106-03: plus the texts of the change preview.
// 106-05: plus the speech field (components/SprechKnopf.jsx, components/zeigen/SprechFeld.jsx) and the help table of the grammar;
// review 106-05: plus the answer templates and fixed answer texts of the flow (sprechAblauf.js, eingabe.js, sprachAgent.js) and the NDA marker.
// 106-06: plus the "mit Bild" button, the consent per project, the office switch and the refusals of the image rules.
// 106-07: plus the rights lock of the preview cards (a role that may look and propose but not change the model).
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  "Unter dem Zeiger": "Under the pointer",
  "Ausgewählt": "Selected",
  "Warnung am Bauteil": "Warning on element",
  "Fehler am Bauteil": "Error on element",
  // Hover overlay of the BIM studio (element kinds; Wand/Stütze/Raum/Decke exist in other parts).
  "Dach": "Roof",
  "Hüllwand": "Envelope wall",
  // 106-03: preview of a proposed change (components/zeigen/AenderungsVorschau.jsx)
  "Änderung vorgeschlagen": "Change proposed",
  "Warnung": "Warning",
  "Herkunft": "Origin",
  "Gesperrt — erst klären": "Blocked — clarify first",
  "Änderungsverlauf": "Change history",
  "Zurücknehmen": "Undo",
  "zurückgenommen": "undone",
  // 106-05: speech field
  "Zum Sprechen halten": "Hold to speak",
  "Aufnahme": "Recording",
  "Erkennt …": "Recognising …",
  "Sprechen": "Speak",
  "Spracheingabe braucht den KI-Harness (Einstellungen › KI)": "Speech input needs the AI harness (Settings › AI)",
  "Das Sprachmodell lädt noch — gleich noch einmal versuchen": "The speech model is still loading — try again in a moment",
  "Aufnahme zu kurz — den Knopf halten, solange Sie sprechen": "Recording too short — hold the button while you speak",
  "Nichts verstanden": "Nothing understood",
  "Spracherkennung fehlgeschlagen": "Speech recognition failed",
  "Übernommen": "Applied",
  "Verworfen": "Discarded",
  "Halten zum Sprechen (Leertaste + V)": "Hold to speak (Space + V)",
  "Befehl sagen oder tippen": "Say or type a command",
  "Welche Sätze werden verstanden?": "Which sentences are understood?",
  "Gehört": "Heard",
  "Sprachmodell arbeitet …": "Language model is working …",
  "Trotzdem senden": "Send anyway",
  "Nicht senden": "Do not send",
  "Diese Sätze versteht die Eingabe ohne Sprachmodell": "The input understands these sentences without a language model",
  "„dieses“, „diese“, „dort“ meinen das gewählte Bauteil. Tasten: Leertaste + V sprechen, Alt+J oder Strg+Enter übernehmen, Alt+N verwerfen.":
    "“dieses”, “diese”, “dort” mean the selected element. Keys: Space + V to speak, Alt+J or Ctrl+Enter to apply, Alt+N to discard.",
  // help table (sprachbefehl.js SATZ_HILFE, passed to t() by variable)
  "Vorschlag: verschieben (Richtung wie im Bild: links, rechts, vor, zurück, hoch, runter; Maße wie 0,5 m, fünfzig Zentimeter, zwei Meter fünfzig)":
    "Proposal: move (direction as seen on screen: left, right, forward, back, up, down; sizes like 0,5 m, fifty centimetres, two metres fifty)",
  "Vorschlag: drehen (links = gegen den Uhrzeigersinn, rechts = im Uhrzeigersinn)": "Proposal: rotate (left = counter-clockwise, right = clockwise)",
  "Vorschlag: skalieren (auch: auf 120 Prozent, verdopple, halb so groß)": "Proposal: scale (also: to 120 percent, double it, half as big)",
  "Vorschlag: Eigenschaft setzen (Brandschutz, Status, Kostengruppe, Leistungsbereich, Bauabschnitt, Material, Tragend, Statik-Vermerk)":
    "Proposal: set a property (fire rating, status, cost group, trade, construction stage, material, load-bearing, structural note)",
  "Vorschlag: tragend ja/nein": "Proposal: load-bearing yes/no",
  "Vorschlag: Status Bestand, Neubau oder Abbruch": "Proposal: status existing, new or demolition",
  "Vorschlag: Bauteil an der zuletzt gezeigten Stelle teilen": "Proposal: split the element at the spot last pointed at",
  "Vorschlag: Wand in der Mitte teilen (auch: teile bei 30 Prozent)": "Proposal: split the wall in the middle (also: split at 30 percent)",
  "Übernimmt den offenen Vorschlag (nur ein einzelnes „ja“, „nein“ verwirft)": "Applies the open proposal (only a lone “ja”; “nein” discards)",
  "Verwirft den offenen Vorschlag": "Discards the open proposal",
  "Fragt, welchen Schritt es zurücknimmt; erst „ja“ führt es aus": "Asks which step it will undo; only “ja” does it",
  "Liest die Auswahl vor": "Reads out the selection",
  "Rahmt die Auswahl in der Ansicht": "Frames the selection in the view",
  "Hebt die Auswahl auf": "Clears the selection",
  "Prüft die offenen Vorschläge neu": "Checks the open proposals again",
  "Liest offene Vorschläge und Verlauf": "Reads open proposals and history",
  // 106-05 review: spoken confirmation shown before it applies, answer templates of sprechAblauf.antwortSatz (ANTWORT_VORLAGEN, by variable),
  // fixed answer texts of the flow and the model fallback (passed through t() by variable), the project's NDA marker (ProjectForm)
  "Wird gleich übernommen": "About to apply",
  "Nicht übernommen — der Vorschlag wartet weiter": "Not applied — the proposal is still waiting",
  "Übernommen: {satz}": "Applied: {satz}",
  "Zurückgenommen: {satz}": "Undone: {satz}",
  "Verworfen: {satz}": "Discarded: {satz}",
  "Auswahl ({anzahl}): {liste}": "Selection ({anzahl}): {liste}",
  "Nichts ausgewählt": "Nothing selected",
  "{offen} offene Vorschläge, {schritte} Schritte im Verlauf": "{offen} open proposals, {schritte} steps in the history",
  "{anzahl} Vorschlag/Vorschläge geprüft": "{anzahl} proposal(s) checked",
  "Verstanden: {satz} — Vorschlag prüfen, dann „ja“ sagen oder Übernehmen wählen": "Understood: {satz} — check the proposal, then say “ja” or choose Apply",
  "Zurücknehmen abgebrochen": "Undo cancelled",
  "Nichts zurückzunehmen": "Nothing to undo",
  "Erst den offenen Vorschlag übernehmen oder verwerfen — dann zurücknehmen": "Apply or discard the open proposal first — then undo",
  "Kein offener Vorschlag — erst eine Änderung vorschlagen": "No open proposal — propose a change first",
  "Freie Sätze brauchen den KI-Harness (Einstellungen › KI) — dieser Satz ist nicht in der Befehlsliste":
    "Free sentences need the AI harness (Settings › AI) — this sentence is not in the command list",
  "Der KI-Harness läuft nicht (Einstellungen › KI) — freie Sätze gehen nur über ihn": "The AI harness is not running (Settings › AI) — free sentences only go through it",
  "Der KI-Harness hat keine Verbindung zu den Modell-Werkzeugen dieser App — er könnte keinen Vorschlag machen":
    "The AI harness has no connection to this app's model tools — it could not make a proposal",
  "Der KI-Harness hat keine Verbindung zu den Modell-Werkzeugen dieser App": "The AI harness has no connection to this app's model tools",
  "(keine Antwort)": "(no answer)",
  "Vertraulich (NDA): nie Bilder der Ansicht an ein Sprachmodell senden, nur Text und Bauteil-Kennungen":
    "Confidential (NDA): never send images of the view to a language model, only text and element IDs",
  // 106-06: the "mit Bild" button of the speech field, the consent per project, the office switch (settings), the refusals of the image
  // rules (bildKontext.BILD_GRUENDE, passed to t() by variable)
  "Ein Bild der aktuellen Ansicht als Kontext mitschicken (nur bei freien Sätzen an das Sprachmodell)":
    "Send an image of the current view as context (only with free sentences to the language model)",
  "Bild: nie (NDA)": "Image: never (NDA)",
  "mit Bild": "with image",
  "mit Bild ✓": "with image ✓",
  "Bild geht": "Image goes",
  "an das Modell des KI-Harness (noch unbekannt)": "to the AI harness's model (not known yet)",
  "verlässt diesen Rechner": "leaves this computer",
  "noch keine Zustimmung für dieses Projekt": "no consent for this project yet",
  "Zustimmung für dieses Projekt erteilt": "consent given for this project",
  "Zustimmung zurücknehmen": "Withdraw consent",
  "Für dieses Projekt zustimmen und senden": "Agree for this project and send",
  "Nicht gesendet — kein Bild, kein Satz": "Not sent — no image, no sentence",
  "mit Bild der Ansicht": "with an image of the view",
  "Zustimmung nicht gespeichert": "Consent not saved",
  "Zustimmung für Bilder dieses Projekts zurückgenommen": "Consent for images of this project withdrawn",
  "Zurücknehmen fehlgeschlagen": "Withdrawing failed",
  "Die Bildprüfung ist in dieser Fassung nicht verfügbar — kein Bild gesendet": "The image check is not available in this version — no image sent",
  "Bilder der Ansicht dürfen an KI außerhalb dieses Rechners gehen": "Images of the view may go to AI outside this computer",
  "Je Projekt wird einmal gefragt, bevor das erste Bild den Rechner verlässt; Projekte mit NDA-Merker senden nie Bilder. Bei „Nur lokale KI“ geht ein Bild nur an ein Modell auf diesem Rechner.":
    "Each project asks once before the first image leaves the computer; projects with the NDA marker never send images. With “local AI only” an image only goes to a model on this computer.",
  "NDA-Projekt: es geht nie ein Bild der Ansicht an ein Sprachmodell — nur Text und Bauteil-Kennungen":
    "NDA project: no image of the view ever goes to a language model — only text and element IDs",
  "Nur lokale KI ist eingeschaltet (Einstellungen › KI): ein Bild geht nur an ein Modell auf diesem Rechner":
    "Local AI only is on (Settings › AI): an image only goes to a model on this computer",
  "Bilder an KI außerhalb dieses Rechners sind in den Einstellungen des Büros ausgeschaltet (Einstellungen › KI)":
    "Images to AI outside this computer are switched off in the office settings (Settings › AI)",
  "Ohne geöffnetes Projekt geht kein Bild an ein Sprachmodell (NDA-Merker und Zustimmung hängen am Projekt)":
    "Without an open project no image goes to a language model (NDA marker and consent belong to the project)",
  "Dieses Modell versteht laut Katalog keine Bilder — nichts wurde gesendet. Ohne Bild senden oder ein Bildmodell wählen (Einstellungen › KI)":
    "According to the catalog this model does not understand images — nothing was sent. Send without the image or choose an image model (Settings › AI)",
  // 106-06 review fix: sentences with values as templates ({…} filled after t(): bildKontext.BILD_ZIEL_VORLAGEN, sprachAgent BILD_VISION_MODELL /
  // BILD_OHNE_ANSICHT)
  "an „{anbieter}“": "to “{anbieter}”",
  "an das Modell": "to the model",
  "{wer} — auf diesem Rechner": "{wer} — on this computer",
  "{wer} — außerhalb dieses Rechners": "{wer} — outside this computer",
  "{wer} — außerhalb dieses Rechners ({host})": "{wer} — outside this computer ({host})",
  "Modell „{modell}“: Dieses Modell versteht laut Katalog keine Bilder — nichts wurde gesendet. Ohne Bild senden oder ein Bildmodell wählen (Einstellungen › KI)":
    "Model “{modell}”: according to the catalog this model does not understand images — nothing was sent. Send without the image or choose an image model (Settings › AI)",
  "Kein Bild der Ansicht: {grund} — nichts gesendet": "No image of the view: {grund} — nothing sent",
  // 106-07: rights lock of the preview (AenderungsVorschau.jsx, aenderungsBefehle.js KEIN_AENDERUNGSRECHT_TEXT)
  "Nur ansehen und vorschlagen — Ihre Rolle darf das Modell nicht ändern": "Look and propose only — your role may not change the model",
  // review 106-07: speech on a paired device (src/lib/harnessClient.js GERAET_OHNE_HARNESS / GERAET_OHNE_HTTPS)
  "Spracheingabe am gekoppelten Gerät nicht verfügbar: der KI-Harness läuft nur am Rechner — den Satz bitte in die Zeile tippen":
    "Speech input not available on the paired device: the AI harness runs on the computer only — please type the sentence into the line",
  "Spracheingabe am gekoppelten Gerät nicht verfügbar: die Seite läuft ohne HTTPS, der Browser gibt das Mikrofon nicht frei — den Satz bitte in die Zeile tippen":
    "Speech input not available on the paired device: the page runs without HTTPS, the browser does not release the microphone — please type the sentence into the line",
  "Ihre Rolle darf das Modell nicht ändern — Übernehmen und Zurücknehmen brauchen „Modell & Prüfung: Bearbeiten“ (Einstellungen › Nutzer & Rechte)":
    "Your role may not change the model — applying and reverting need “Model & checking: edit” (Settings › Users & rights)",
};
