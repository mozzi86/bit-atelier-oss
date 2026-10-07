// English dictionary part of plan 83-02 (open source: feedback for every build,
// registration request with manual approval, project link in the footer) and
// 83-03 (AI connection presets for any model, local or cloud).
// Decision list § 5: new UI texts go here, i18n.jsx stays closed. The guard
// (tests/unit/i18nAbdeckung.test.js) refuses a key that exists elsewhere — grep all
// dictionary files before adding one ("Bauherr", "Sonstiges", "Name", "E-Mail",
// "Rolle", "Zur Startseite" already exist in other parts).
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  // --- Feedback dialog (FeedbackDialog.jsx) and the check suite (ModelCheck.jsx)
  "Feedback": "Feedback",
  "Feedback geben": "Give feedback",
  "Was fehlt, was stört, was gefällt? Es wird nichts automatisch gesendet: Sie schicken die Nachricht selbst aus Ihrem E-Mail-Programm oder auf GitHub ab.":
    "What is missing, what gets in the way, what works well? Nothing is sent automatically: you send the message yourself from your mail program or on GitHub.",
  "Ihre Nachricht": "Your message",
  "Technische Angaben anhängen: Version, Seite, Browser, Betriebssystem": "Attach technical details: version, page, browser, operating system",
  "Per E-Mail senden": "Send by e-mail",
  "Auf GitHub melden": "Report on GitHub",
  "E-Mail an": "E-mail to",
  "Meldungen auf GitHub sind öffentlich sichtbar.": "Reports on GitHub are publicly visible.",
  "Befund besprechen": "Discuss a finding",
  // Pre-filled text of "Befund besprechen" (feedback.js befundText)
  "Ich möchte ein Ergebnis der Prüf-Suite besprechen.": "I would like to discuss a result of the check suite.",
  "Modell": "Model",
  "Musterprojekt": "Sample project",
  "Bauteile mit Geometrie": "Components with geometry",
  "Harte Kollisionen": "Hard clashes",
  "Doppelmodellierungen": "Duplicate models",
  "IDS-Verstöße": "IDS violations",
  "Das Befund-Paket „{datei}“ liegt im Download-Ordner — bitte von Hand an die E-Mail anhängen.":
    "The findings package “{datei}” is in the download folder — please attach it to the e-mail by hand.",
  "Meine Frage": "My question",
  // --- Footer and Settings › System
  "Quellcode (MIT)": "Source code (MIT)",
  "Version": "Version",
  // --- Registration (Registrieren.jsx, Anmeldung.jsx, registrierung.js)
  "Noch kein Konto?": "No account yet?",
  "Registrieren": "Register",
  "Anmelden": "Sign in",
  "Schon ein Konto?": "Already have an account?",
  "Die lokale Fassung braucht kein Konto — einfach loslegen.": "The local edition needs no account — just get started.",
  "Anfrage vorbereitet.": "Request prepared.",
  "Konten werden von Hand freigeschaltet — in der Regel innerhalb von {n} Werktagen. Sie erhalten eine E-Mail mit dem Zugang.":
    "Accounts are approved by hand — usually within {n} working days. You will receive an e-mail with your access.",
  "Ihr E-Mail-Programm hat sich nicht geöffnet?": "Your mail program did not open?",
  "E-Mail erneut öffnen": "Open the e-mail again",
  "Zur Anmeldung": "To sign-in",
  "Konten für den Cloud-Betrieb werden von Hand freigeschaltet. Ihre Anfrage geht als E-Mail aus Ihrem eigenen E-Mail-Programm an uns.":
    "Cloud accounts are approved by hand. Your request reaches us as an e-mail sent from your own mail program.",
  "Büro / Firma": "Office / company",
  "Telefon (optional)": "Phone (optional)",
  "Bitte wählen …": "Please choose …",
  "Nachricht (optional)": "Message (optional)",
  "Ihre Angaben werden nur zur Freischaltung verwendet.": "Your details are used only to approve your account.",
  "Zugang anfragen": "Request access",
  "Architektur": "Architecture",
  "Fachplanung": "Specialist planning",
  "Bitte Ihren Namen angeben.": "Please enter your name.",
  "Bitte Büro oder Firma angeben.": "Please enter your office or company.",
  "Bitte eine gültige E-Mail-Adresse angeben.": "Please enter a valid e-mail address.",
  "Bitte eine Rolle wählen.": "Please choose a role.",
  // --- Plan 83-03: AI connection presets (LlmConnections.jsx, lib/kiVorlagen.js)
  "Vorlage": "Preset",
  "Ohne Vorlage (Werte von Hand)": "No preset (enter values by hand)",
  "Verbindungstyp": "Connection type",
  "Anfragen gehen an:": "Requests go to:",
  "z. B. {modell}": "e.g. {modell}",
  "Für lokale Server nicht erforderlich": "Not required for local servers",
  "Läuft auf Ihrem Rechner — der lokale Server (LM Studio bzw. Ollama) muss gestartet und ein Modell geladen sein.":
    "Runs on your computer — the local server (LM Studio or Ollama) must be running with a model loaded.",
  // Preset and type labels (KI_VORLAGEN / KI_TYPEN reach t() through a variable)
  "Anthropic": "Anthropic",
  "OpenAI": "OpenAI",
  "Google Gemini": "Google Gemini",
  "Mistral": "Mistral",
  "OpenRouter": "OpenRouter",
  "Groq": "Groq",
  "DeepSeek": "DeepSeek",
  "Qwen (DashScope)": "Qwen (DashScope)",
  "LM Studio (lokal)": "LM Studio (local)",
  "Ollama (lokal)": "Ollama (local)",
  "Eigener Endpunkt": "Custom endpoint",
  "OpenAI-kompatibel": "OpenAI-compatible",
};
