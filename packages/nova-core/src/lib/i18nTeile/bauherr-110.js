// English dictionary part of phase 110 (client portal "Bauherr": portal page,
// office page /Bauherrenzugang, shared view, login link on /anmeldung). Keys
// that already live in other parts ("Termine", "Summe", "Senden", "Abmelden" …)
// are reused, not repeated. Besides the literal t() keys this part carries the
// labels that reach t() as values (section names, statuses, reasons of
// bauherrProjektion.js).
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  "Ihre Entscheidung": "Your decision",
  "Ihre Entscheidung ist angefragt.": "Your decision is requested.",
  "Option wählen": "Choose an option",
  "Bemerkung (optional)": "Remark (optional)",
  "Auswahl senden": "Send choice",
  "Mehrkosten": "Extra cost",
  "fällig": "due",
  "Datei öffnen": "Open file",
  "Ihr Projekt": "Your project",
  "Phase": "Phase",
  "Für Sie ist noch nichts freigegeben.": "Nothing has been released to you yet.",
  "Fragen an das Büro": "Questions to the office",
  "Noch keine Fragen.": "No questions yet.",
  "Eigene Unterlagen": "Your documents",
  "Datei wählen": "Choose file",
  "Hochladen": "Upload",
  "Kein Projekt freigegeben — Rückmeldung nicht möglich.": "No project released — feedback is not possible.",
  "Kein Projekt freigegeben — Hochladen nicht möglich.": "No project released — upload is not possible.",
  "Dieser Dateiname ist nicht zulässig.": "This file name is not allowed.",
  "Bauherrenportal": "Client portal",
  "Einträge für den Bauherrn freigegeben.": "entries released to the client.",
  "Einladung gesendet — der Bauherr meldet sich über den Link in der E-Mail an.":
    "Invitation sent — the client signs in through the link in the e-mail.",
  "Zugang eingerichtet — die Adresse hatte schon ein Konto; Anmeldung über „Anmeldelink per E-Mail“.":
    "Access set up — the address already had an account; sign-in via “login link by e-mail”.",
  "Antwort freigegeben.": "Answer released.",
  "Bauherrenzugang": "Client access",
  "Der Bauherr sieht nur, was hier freigegeben ist — nie Honorar, Zeiten, Kalkulation, interne Notizen oder andere Projekte. Die Datenbank prüft das selbst.":
    "The client sees only what is released here — never fees, hours, cost calculation, internal notes or other projects. The database enforces this itself.",
  "Lokal: Freigaben gelten für die Vorschau „Bauherr (Vorschau)“ unter „Ansicht als …“ oben in der Kopfzeile. Einladen und Dateien gibt es nur im Cloud-Betrieb.":
    "Local: releases apply to the preview “Client (preview)” under “View as …” in the header. Inviting and files are available in the cloud only.",
  "Bauherr (Vorschau)": "Client (preview)",
  "Zurück zur Büro-Ansicht": "Back to the office view",
  "Vorschau: So sieht Ihr Bauherr das aktive Projekt — nur, was unter „Bauherrenzugang“ freigegeben ist. Knöpfe sind gesperrt.":
    "Preview: this is how your client sees the active project — only what is released under “Client access”. Buttons are disabled.",
  "Was der Bauherr sieht": "What the client sees",
  "Hinweis an den Bauherrn (erscheint in der Projektübersicht)": "Note to the client (shown in the project overview)",
  "Entscheidung anfragen": "Ask for a decision",
  "Auswahl für den Bauherrn freigeben": "Release selection to the client",
  "Bauherrn einladen": "Invite the client",
  "Der Bauherr bekommt einen Anmeldelink per E-Mail, kein Passwort. Er sieht nur dieses Projekt.":
    "The client receives a login link by e-mail, no password. They see this project only.",
  "E-Mail des Bauherrn": "Client's e-mail",
  "Rückmeldungen des Bauherrn": "Client feedback",
  "Noch keine Rückmeldungen.": "No feedback yet.",
  "Antwort": "Answer",
  "So sieht es der Bauherr": "As the client sees it",
  "Bitte zuerst die E-Mail-Adresse eintragen.": "Please enter the e-mail address first.",
  "Anmeldelink nicht gesendet": "Login link not sent",
  "Wenn zu dieser Adresse ein Zugang besteht, ist ein Anmeldelink unterwegs. Bitte den Link in der E-Mail auf diesem Gerät öffnen.":
    "If an access exists for this address, a login link is on its way. Please open the link in the e-mail on this device.",
  "Ohne Passwort: Anmeldelink per E-Mail": "Without password: login link by e-mail",
  // 110-06: invitation by link (Bauherrenzugang + public page /einladung).
  "Einladelink erstellt — kopieren oder per WhatsApp senden. Er gilt einmal.": "Invitation link created — copy it or send it via WhatsApp. It works once.",
  "Einladung zu Ihrem Projekt im BIT-Atelier": "Invitation to your project in BIT-Atelier",
  "Einladelink erstellen": "Create invitation link",
  "Ohne E-Mail: Der Eingeladene öffnet den Link, gibt selbst E-Mail und Passwort ein (oder Google) und sieht nur dieses Projekt.":
    "No e-mail needed: the invitee opens the link, enters an own e-mail and password (or Google) and sees this project only.",
  "Gültig": "Valid for",
  "7 Tage": "7 days",
  "14 Tage": "14 days",
  "30 Tage": "30 days",
  "Einladelink": "Invitation link",
  "Link kopieren": "Copy link",
  "Per WhatsApp senden": "Send via WhatsApp",
  "Zugang eingerichtet — die App wird geladen …": "Access set up — loading the app …",
  "Dieser Einladungslink ist ungültig, abgelaufen oder schon benutzt. Bitte beim Büro einen neuen anfordern.":
    "This invitation link is invalid, expired or already used. Please ask the office for a new one.",
  "Bitte eine gültige E-Mail-Adresse eingeben.": "Please enter a valid e-mail address.",
  "Das Passwort braucht mindestens 8 Zeichen.": "The password needs at least 8 characters.",
  "Die beiden Passwörter stimmen nicht überein.": "The two passwords do not match.",
  "Zu dieser E-Mail gibt es schon ein Konto — bitte dessen Passwort eingeben.": "This e-mail already has an account — please enter its password.",
  "Die Registrierung ist im Büro gerade ausgeschaltet. Bitte dem Büro Bescheid geben.": "Registration is switched off at the office right now. Please let the office know.",
  "Registrierung fehlgeschlagen": "Registration failed",
  "Konto angelegt, aber das Büro verlangt eine Bestätigung per E-Mail. Bitte dem Büro Bescheid geben.":
    "Account created, but the office requires an e-mail confirmation. Please let the office know.",
  "Die Anmeldung mit Google ist im Büro noch nicht eingerichtet. Bitte E-Mail und Passwort verwenden.":
    "Sign-in with Google is not set up at the office yet. Please use e-mail and password.",
  "Einladung zu BIT-Atelier": "Invitation to BIT-Atelier",
  "Mit diesem Link bekommen Sie Zugang zu Ihrem Projekt.": "This link gives you access to your project.",
  "Einladungen gibt es nur in der Cloud-App.": "Invitations exist in the cloud app only.",
  "Im Link fehlt der Einladungscode. Bitte den vollständigen Link aus der Nachricht öffnen.": "The link is missing its invitation code. Please open the complete link from the message.",
  "Angemeldet als": "Signed in as",
  "Einladung annehmen": "Accept invitation",
  "Mit Google anmelden": "Sign in with Google",
  "oder mit E-Mail": "or with e-mail",
  "Passwort festlegen (mindestens 8 Zeichen)": "Set a password (at least 8 characters)",
  "Passwort wiederholen": "Repeat password",
  "Wird eingerichtet …": "Setting up …",
  "Zugang einrichten": "Set up access",
  // Values that reach t() (bauherrProjektion.js, BauherrAnsicht.jsx).
  "Baustellenfotos": "Site photos",
  "zur Freigabe": "for approval",
  "bezahlt": "paid",
  "Bauablauf": "Construction schedule",
  "Kosten nach Kostengruppen": "Costs by cost group",
  "Abschlagsrechnung": "Interim invoice",
  "Stornorechnung": "Cancellation invoice",
  "Zu diesem Eintrag ist keine Entscheidung angefragt.": "No decision has been requested for this entry.",
  "Bitte eine der angebotenen Optionen wählen.": "Please choose one of the offered options.",
  "Unbekannte Art der Rückmeldung.": "Unknown kind of feedback.",
  "Büro-, Personal-, Buchhaltungs- und Schriftverkehrsdokumente gehen nie an den Bauherrn.":
    "Office, HR, bookkeeping and correspondence documents never go to the client.",
  "Nur gestellte Rechnungen gehen an den Bauherrn.": "Only issued invoices go to the client.",
  "Nur freigegebene Pläne — oder ein Vorabzug ausdrücklich zur Freigabe durch den Bauherrn.":
    "Only released plans — or a preliminary print explicitly for the client's approval.",
  "freigabe": "approval",
  "ablehnung": "rejection",
  "auswahl": "choice",
  "frage": "question",
  "kommentar": "comment",
  // Cost rows (bauherrProjektion.js KG_NAMEN, reserve and total rows); "Grundstück",
  // "Baunebenkosten", "Finanzierung" live in other parts.
  "Vorbereitende Maßnahmen": "Preparatory measures",
  "Bauwerk – Baukonstruktionen": "Building – structure",
  "Bauwerk – Technische Anlagen": "Building – technical services",
  "Außenanlagen und Freiflächen": "External works and open spaces",
  "Ausstattung und Kunstwerke": "Furnishings and artworks",
  "Reserve / Unvorhergesehenes": "Contingency",
  "Sonstige Baunebenkosten": "Other ancillary costs",
  "Kostenstand gesamt (ohne Aufteilung nach Kostengruppen)": "Total cost status (not split by cost group)",
  // 110-05: 3D view of the released building model
  "3D ansehen": "View in 3D",
  "3D-Ansicht schließen": "Close 3D view",
  "Gebäudemodell in 3D": "Building model in 3D",
  "Gebäudemodell wird geladen …": "Loading building model …",
  "Die 3D-Ansicht konnte nicht geladen werden.": "The 3D view could not be loaded.",
  "Ziehen zum Drehen, Mausrad oder zwei Finger zum Zoomen.": "Drag to rotate, mouse wheel or two fingers to zoom.",
  "3D-Ansicht für den Bauherrn aktualisiert.": "3D view for the client updated.",
  "3D-Ansicht für den Bauherrn nicht aktualisiert": "3D view for the client not updated",
  "Die 3D-Ansicht entsteht im BIM-Studio aus dem Gebäudemodell und erneuert sich nach jeder gespeicherten Änderung. Nach der ersten Freigabe das Modell einmal im BIM-Studio öffnen.":
    "The 3D view is made in the BIM studio from the building model and renews itself after every saved change. After the first release, open the model once in the BIM studio.",
};
