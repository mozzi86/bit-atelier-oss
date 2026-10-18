# Änderungsliste

Alle nennenswerten Änderungen an BIT-Atelier stehen in dieser Datei.
Das Format folgt [Keep a Changelog](https://keepachangelog.com/de/1.1.0/), die Versionsnummern
folgen [Semantic Versioning](https://semver.org/lang/de/).

Der Release-Lauf übernimmt den Abschnitt der getaggten Fassung wörtlich als Release-Notiz, und
der Update-Hinweis der installierten App zeigt dieselben Zeilen. Neue Einträge kommen deshalb
zuerst unter **Unveröffentlicht** und wandern beim nächsten Release unter die neue Nummer.

## [Unveröffentlicht]

## [1.7.1] - 2026-10-18

### Geändert

- **Mehr Platz zum Arbeiten:** Seiten nutzen auf breiten Bildschirmen die Breite (bis 1.920 px, Zeichenseiten ganz), die Seitentitel sind kompakter.
- **Komplex-Designer aufgeräumt:** eine schmale Kopfzeile mit Phase 1–5, den Schritten der Phase und „Entwurf speichern“ statt Titelblock und mehrfach geschachtelter Kästen; die Baufeld-Planung zeigt die Karte in Fensterhöhe, Kennzahlen und Prüfung stehen in einer schmalen Spalte, Konflikte sind zusammengefasst.
- **3D wie in CAD-Programmen:** die linke Maustaste gehört den Werkzeugen (Körper anklicken, Push/Pull ziehen); Mausrad gedrückt verschiebt, Umschalt + Mausrad gedrückt dreht.
- Die erzeugten Demo-Höhenpunkte auf der Karte sind ausgeblendet (per Schalter einblendbar); „Erste Schritte“ im Massing-Studio startet eingeklappt.

### Neu

- **Alles einpassen:** zwei- oder dreimal auf das Mausrad klicken zeigt den ganzen Plan bzw. das Grundstück — in allen 2D-Plänen, auf der Karte und in 3D.

### Behoben

- Rechtsklick auf Plänen, Karte und 3D öffnete das Browser-Menü („Bild speichern unter …“).
- Der Hinweis bei den Flurstücken sagte noch „erst mit ‚Entwurf speichern‘ dauerhaft“, obwohl automatisch gespeichert wird.

## [1.7.0] - 2026-10-17

### Neu

- **Massing-Studio als Modellierer (wie SketchUp):** Linie zeichnen schließt zur Fläche (mit Vorschlag im Goldenen Schnitt), Push/Pull, Folge mir, Verschieben, Drehen, Skalieren und Aufstocken. Strg beim Verschieben = Kopie; danach `*3` tippt drei Kopien im selben Abstand, `/3` teilt die Strecke in drei. Maße lassen sich während des Zeichnens eintippen, Ecken rasten mit grüner Markierung ein. Eine Karte „Erste Schritte“ führt durch die Werkzeuge.
- **Gruppen mit Nummern:** Körper lassen sich zu Gruppen zusammenfassen. Alle Körper derselben Gruppennummer ändern sich gemeinsam; „Eindeutig“ löst einen Körper aus seiner Gruppe.
- **Parametrik mit Knoten** (ähnlich Grasshopper): Bausteine wie Zahl, Reihe, Rechteck und Extrusion werden verbunden, das Ergebnis erscheint im Modell.
- **Gelände-Sandbox:** Gelände anheben, absenken und glätten, mit Erdmengen (Abtrag/Auftrag).
- **Wohnriegel entlang eines Pfads:** Pfad zeichnen ergibt einen Mittelflur- oder einhüftigen Riegel mit farbigem Wohnungsmix (1- bis 4-Zimmer, Eckwohnungen), gestapelt nach Geschossen, mit Kennzahlen.
- **Push/Pull direkt im 3D** durch Ziehen am Körper; Massing-Körper und Gruppen gehen in den IFC-Export.
- **Baufeld-Planung mit CAD-Bedienung:** neuer Modus „Auswahl“ — Klick, Umschalt+Klick, Rahmen nach rechts (ganz drin) oder links (berührt); Ziehen verschiebt (Strg = Kopie, Alt = ohne Fang), oranger Griff dreht in 15°-Schritten, Pfeiltasten 0,1 m (Umschalt 1 m), Entf löscht, Strg+A/C/V, Rückgängig/Wiederholen mit Strg+Z/Y. Fang an Grundstücksgrenze, Baufeld, anderen Blöcken und an der Abstandstiefe.
- **Prüfung nach jeder Bewegung:** GRZ und GFZ über alle Blöcke; gemeldet werden Blöcke außerhalb des Grundstücks, Überlappungen, Abstandsflächen über der Grenze und Abstandsflächen, die sich treffen (Studie, kein Nachweis).

### Geändert

- **Komplex-Entwurf speichert automatisch** etwa 1,5 Sekunden nach einer Änderung, sobald Name und Standort gesetzt sind — „Entwurf speichern“ ist nicht mehr nötig.
- **Zoom:** Pläne lassen sich unter 100 % verkleinern; Leertaste + Ziehen verschiebt die Ansicht (wie in den gängigen Zeichenprogrammen).
- Massing-Studio und Baufeld-Planung rechnen die Abstandsflächen mit derselben Funktion.

### Behoben

- **Gezeichnete Parzelle verschwand** beim Wechsel zwischen den Reitern; sie bleibt jetzt erhalten.
- **Geschätzte Parzelle war auf der Karte etwa 18-mal zu groß** dargestellt; sie erscheint jetzt im richtigen Maßstab, ebenso die Geschoss-Beschriftung der Baukörper.
- **3D-Umschalter im Massing-Studio** war bei schmalem Fenster nicht anklickbar.
- Das Massing-Studio schrieb beim bloßen Öffnen das Modell zurück in die Datenbank; es speichert jetzt nur echte Änderungen.

## [1.6.0] - 2026-10-17

### Neu

- **Bauteil-Steckbrief für alle Bauteile:** Jedes Bauteil im Gebäudemodell zeigt IFC-Klasse, Bauteiltyp, Kostengruppe (DIN 276), Gewerk (STLB-Bau-Leistungsbereich mit Stelle im Bauablauf), Material und Schichtaufbau, Menge, Bauabschnitt und eine stabile GUID — auch Haustechnik, Tragwerk, Durchbrüche und Brandschotts. Werte, die nur aus dem Bauteiltyp abgeleitet sind, tragen einen orangen Punkt („bitte bestätigen“).
- **Brillen:** Ein Modell, mehrere Sichten — Eingabe, Bestand, Abbruchplan, Bauantrag (auch schwarz-weiß), Ausführung 1:50 (Materialschraffuren), Ausschreibung, Bauleitung. Bestand grau, Neubau rot, Abbruch gelb nach den Bauvorlagenverordnungen; Bauteile ohne Status werden nie ausgeblendet und nie als Neubau gezählt.
- **Prüfregeln gegen Fehlplanung:** Hinweise im Gebäudemodell und in der AVA, z. B. Fenster in einer Wand, die abgebrochen wird; Abbruch tragender Bauteile ohne Statik-Vermerk; Durchbruch durch eine Brandwand ohne Brandschott oder mit schwächerem Schott; Leitung kreuzt eine Wand ohne geplanten Durchbruch; LV-Position mischt Abbruch mit Neubau.
- **Brandschott** als eigenes Bauteil am Durchbruch (Feuerwiderstand, System, Zulassung abZ/aBG/ETA mit Nummer, Hersteller, Kennzeichnung).
- **Status je Schicht** (z. B. Bestandswand mit neuer Dämmung), Zumauerung als eigenes Bauteil, neue Öffnung in einer Bestandswand als eigene Abbruchmenge.
- **Grundriss als Vektor-PDF im echten Maßstab** mit Plankopf, Brille und Statuslegende (A3 bis A0 nach Größe).

### Geändert

- **IFC-Export:** stabile GUIDs, Eigenschaften, Material-Schichten und DIN-276-Klassifizierung für alle Bauteile; Umbaustatus nach IFC4 in `Pset_*Common.Status` (ohne Status „NOTKNOWN“, nie „NEW“); Abwasserleitungen als Rohr statt Dachrinne.
- **Rückbau:** Kostengruppe 394 (wählbar je Projekt: 394, 212 oder bei den betroffenen Gruppen), Leistungsbereich 084, DIN 18459.

### Behoben

- **Abbruch stand im Gewerke-Katalog unter LB 040** (Wärmeversorgung); jetzt LB 084. Bereits gespeicherte Bauablauf-Vorgänge mit „040“ bitte prüfen.
- **„Plan als PDF“ war nicht maßstäblich:** Der Grundriss wurde als Bild aufs Blatt gestreckt, trug aber „1:100“. Der Grundriss kommt jetzt als Vektor im echten Maßstab; der Schnitt ist bis auf Weiteres als „nicht maßstäblich“ beschriftet.

## [1.5.1] - 2026-10-16

### Neu

- **Desktop-App für Windows (Vorschau):** `BIT-Atelier-Desktop-Setup.exe` startet BIT-Atelier in einem eigenen Fenster, ohne Node.js; die Daten liegen in einem Ordner, den Sie beim ersten Start wählen. Der Installer ist nicht signiert — Windows SmartScreen fragt einmal („Weitere Informationen“ → „Trotzdem ausführen“). Der bisherige Installer und das ZIP bleiben der empfohlene Weg.
- **Problem melden:** Einstellungen › System & Info bereitet eine Meldung für GitHub vor — Version, Seite, Browser und die letzten Protokollzeilen, ohne Projektdaten und bereinigt um Benutzerordner und E-Mail-Adressen. Sie sehen den ganzen Text und schicken ihn selbst ab.

### Geändert

- **Seitenleiste:** Skizze steht jetzt unter Entwurf & Genehmigung, der Baustellen-Leitstand unter Bauüberwachung, PDF & Ablage und das KI Tool unter Büro. Im Labor bleiben Investment und Portfolio.

## [1.5.0] - 2026-10-16

### Wichtig vor dem Update

- **Personaldaten werden verschlüsselt.** Beim ersten Start nach dem Update verschlüsselt die App `personal.json` und `personal-blobs/` (AES-256). Der Schlüssel liegt **außerhalb** des Datenordners — Windows: `%APPDATA%\BIT-Atelier\personal.key`, macOS: `~/Library/Application Support/BIT-Atelier/personal.key`, Linux: `~/.config/bit-atelier/personal.key`. **Diesen Schlüssel einmal getrennt sichern** (USB-Stick, Passwort-Safe). Ohne ihn sind die Personaldaten einer Sicherung nicht lesbar. Einstellungen › Daten & Sicherung zeigt den Pfad; beim Rechnerwechsel gehört die Datei mit an denselben Ort (docs/NOTFALL.md).

### Neu

- **VOB/B § 2 Abs. 3 in der AVA:** Beim Zuschlag wird die Vertragsmenge jeder Position festgehalten. Die Mengenregeln zeigen danach Mehrmengen über 110 % (mit der Spitzenmenge für einen neuen Einheitspreis) und Mindermengen unter 90 % — als Hinweis, keine Sperre.
- **Anrechenbare Kosten eingefroren:** „Aus LV übernehmen“ hält den Kostenstand im Honorarvertrag fest. Ändert sich das LV um mehr als 1 %, erscheint ein Hinweis mit „Als Honorarnachtrag übernehmen“ (§ 10 HOAI); gestellte Rechnungen bleiben unverändert.
- **Leistungsstand im Architektenvertrag pflegen** — ohne den Komplex-Designer; es ist derselbe Stand wie im Designer-Reiter „Planer“.
- **Bauherr aus dem Adressbuch** im Angebots-Assistenten; fehlt das Projekt, lässt es sich direkt im Assistenten anlegen.
- **Steuernummer, USt-IdNr. und IBAN** auch unter Einstellungen › Büro & Briefkopf, die Einstellungs-Suche findet sie.

### Geändert

- **Ein Büroname:** Buchhaltung, XRechnung und DATEV-Export lesen den Namen aus dem Briefkopf; das eigene Feld in den Buchhaltungs-Einstellungen entfällt (ein alter Name lässt sich mit einem Klick übernehmen).
- **Rechnung: „Stand (%)“ rechnet den Betrag** der Leistungsphase mit; eine neue Zeile nimmt die nächste Leistungsphase, Zeilen mit 0,00 € werden markiert.
- **Steuertermine** verschieben sich nach dem Bürokalender (Landesfeiertage, § 108 Abs. 3 AO), wie Fristen und Abwesenheiten.
- Adressbuch: E-Mail ist kein Pflichtfeld mehr. „Termin anlegen“ übernimmt das aktive Projekt.
- **Sicherheit der lokalen App:** Schreibende Anfragen aus dem Browser brauchen ein Sitzungs-Token; eine fremde Webseite kann keine Daten mehr in die lokale App schreiben.

### Behoben

- Ein neu angelegtes Projekt wurde nicht aktiv — die Kopfzeile sprang zurück zum vorherigen Projekt.
- Das Download-Paket enthielt die Vergleichsbilder der Tests (33 statt 17 MB).

## [1.4.0] - 2026-10-13

### Geändert

- **Seitenleiste nach dem Büro-Ablauf:** Die Module stehen jetzt in der Reihenfolge, in der ein Projekt durchs Büro läuft — Übersicht · Akquise & Auftrag · Entwurf & Genehmigung · Ausführungsplanung · Ausschreibung & Vergabe · Bauüberwachung, danach die Querschnitts-Gruppen Zeit & Schriftverkehr, Büro und Labor. Jedes Modul ist einer Leistungsphase (0–10) oder dem Querschnitt zugeordnet.
- **Werkplanung und Baustelle getrennt:** „Werkplanung & Baustelle“ ist in zwei Seiten geteilt — **Werkplanung** (Planliste, Durchbrüche, Bemusterung, SiGe, Genehmigungen) unter Ausführungsplanung und **Baustelle** (Bautagebuch) unter Bauüberwachung. Alte Links mit `?tab=` führen automatisch auf die richtige Seite.

## [1.3.0] - 2026-10-13

### Neu

- **Behinderung an den Bauherrn melden:** zweite Vorlage im Bautagebuch neben der Behinderungsanzeige nach VOB/B — die Bauleitung informiert den Bauherrn mit Zeitraum und Bautagebuch-Auszug (Richtwert, vor Versand prüfen).

### Geändert

- **Technik auf aktuellem Stand:** React 19, Kartenbibliothek MapLibre 6, three.js r186, pdf.js 6.4, web-ifc 0.0.78 und kleinere Bibliotheken aktualisiert. Arabische und hebräische Kartenbeschriftungen kommen ohne Zusatzmodul aus.
- Die erste Ladung der App ist durch React 19 rund 36 KB (gzip) größer.

### Behoben

- PDF-Studio: Beim schnellen Wechsel zwischen zwei Dokumenten konnte „PDF konnte nicht geladen werden“ erscheinen; das Dokument wird jetzt sauber freigegeben.
- Karte: keine Warnungen mehr in der Konsole durch fehlende Straßennummern im Kartenstil.

## [1.2.0] - 2026-10-12

### Neu

- **Eigenes Programmfenster:** BIT-Atelier startet in einem eigenen Fenster mit Logo, ohne Browser-Tab und ohne Konsolenfenster; ein zweiter Start öffnet kein zweites Programm. „Programm beenden“ in Einstellungen › System & Info.
- **Projektdateien `.bitproj`:** Doppelklick öffnet die Import-Vorschau (aktualisieren, als Kopie, abbrechen), „Zurück in die Datei speichern“ mit Konfliktwarnung, „Als Datei sichern / Aus Datei laden“ in den Einstellungen.
- **Lokale KI:** LM Studio und Ollama mit einem Klick, Modellerkennung, Schalter „Nur lokale KI“, Empfehlung des passenden Modells für diesen Rechner, geführte Ollama-Einrichtung, KI-Harness aus den Einstellungen starten.
- **Zeit & Honorar:** Zeiterfassung, HOAI-Angebote, Architektenvertrag, Nachträge, Projektcontrolling; im Bestand Umbauzuschlag und mitzuverarbeitende Bausubstanz aus dem Modell.
- **Büro:** Fristen & Termine (.ics), Schriftverkehr mit Postbuch, Rollen und „Ansicht als“, Abwesenheiten, „Meine Woche“, XRechnung für öffentliche Auftraggeber.
- **Werkplanung & Baustelle:** Planliste, Durchbrüche mit BCF, Bemusterung und Raumbuch, SiGe-Formulare, Bautagebuch, Genehmigungen; Kostenstände nach DIN 276, Nachtrags-Prüfpfad.
- **Modell:** Wände, Türen und Räume der Wohnungs-Werkstatt als Bauteile in IFC und AVA, Bauteilstatus ohne Vorgabe, Zeitstrahl nach Bauabschnitt und Gewerk, IFC-Lesen im Hintergrund, größeres Musterprojekt.
- **Sicherheit & Daten:** automatische tägliche Sicherung des Datenordners, Büro-Modus für einen zweiten Arbeitsplatz oder ein Tablet im LAN nur mit Kopplungscode, Schutz gegen DNS-Rebinding.
- **Barrierefreiheit:** alle Auswahlfelder, Symbolknöpfe und Beschriftungen benannt, sichtbarer Fokus, Erklärung zur Barrierefreiheit unter `/barrierefreiheit`.

- Änderungsliste (diese Datei): Die Release-Notiz entsteht aus dem Abschnitt der jeweiligen
  Fassung, die Installationsanleitung steht als zweiter Absatz darunter.
- Update-Hinweis zeigt die ersten Zeilen der Änderungen und klappt auf Wunsch alle auf.
- Einstellungen › System & Info: installierte Fassung, letzte Update-Prüfung, „Jetzt prüfen“,
  automatische Prüfung abschaltbar und „Fassung festhalten bis …“ (z. B. bis zur Submission).
- Umgebungsvariable `BIT_KEIN_UPDATECHECK=1` schaltet die Update-Prüfung vollständig ab.
- Update mit Gesundheitsprüfung: Vor dem Tausch wird `daten/` gesichert; antwortet die neue Fassung
  nach dem Neustart nicht binnen 60 s, holt die App Programm und Daten aus der Sicherung zurück und
  startet die vorige Fassung. Es bleiben die zwei neuesten Sicherungen.
- Deinstallation: `BIT-Atelier-Installer.cmd /entfernen` (auch als Startmenü-Eintrag „BIT-Atelier
  entfernen“) und `install.sh --entfernen` — beendet die laufende App, fragt, ob die Daten bleiben
  (Vorgabe ja, Sicherungskopie vor dem Löschen), entfernt Programm, `.update/`, `node_modules/` und
  Verknüpfungen.
- Einstellungen › Daten & Sicherung zeigt den tatsächlichen Datenordner mit „Ordner öffnen“.
- Einstellungen › KI-Verbindungen › „Mit einem KI-Assistenten verbinden“: fertiger MCP-Eintrag für
  Claude Code und Claude Desktop mit den echten Pfaden dieser Installation, mit Kopierknopf.
- Büro-Modus (Mehrplatz) unter Einstellungen › System & Info: ein zweiter Arbeitsplatz oder ein Tablet
  im selben Büro-Netz nutzt die App mit — erst nach Kopplung mit einem Code vom Büro-Rechner, nur aus
  privaten Netzen, Geräte einzeln widerrufbar. Kennung in der Kopfzeile („Büro-Modus an“ bzw.
  „Gerät: <Name>“). Ohne Verschlüsselung im LAN: nur in vertrauenswürdigen Netzen. Hinweis nach dem
  Speichern, wenn ein Eintrag inzwischen anderswo geändert wurde.
- Erster Start ohne Netz: Scheitert das Laden der Laufzeitpakete, unterscheiden `start-windows.cmd` und
  `start.sh` den Netzfall (kein Internet, Firmen-Proxy, gesperrte Paketquelle) und erklären auf Deutsch
  und Englisch, was hilft.
- Abhängigkeiten unter Aufsicht: Dependabot schlägt wöchentlich gebündelte Aktualisierungen vor; ein
  Release mit bekannter hoher oder kritischer Lücke in einem Laufzeitpaket bricht vor dem Veröffentlichen ab.
- Modelle von Bestandsgebäuden: Bauart einmal ermitteln, Erfassungsgrad und Herkunft der
  Werte, IFC-Übernahme als Modellstand.
- Nachhaltigkeitskonzept-Blatt (Regenwasser, Gründach, PV, Versiegelung) als Karte und PDF.
- Wie ein eigenes Programm: Die Verknüpfungen starten BIT-Atelier ohne Konsolenfenster in einem eigenen
  App-Fenster (Edge/Chrome im App-Modus, eigenes Taskleistensymbol; sonst Standardbrowser, `BIT_FENSTER=0`
  für den Browser-Tab). Nur der erste Start zeigt die Paketinstallation. Ein zweiter Klick öffnet nur ein
  Fenster. Der Server läuft nach dem Schließen weiter; „Programm beenden“ in Einstellungen › System & Info.
  Ausgabe in `daten/server.log`. Auch der Neustart nach einem Update kommt ohne Konsolenfenster aus.
- Projektdateien per Doppelklick: Der Installer meldet `.bitproj` pro Benutzer an (Windows ohne
  Administratorrechte, Linux über `~/.local/share`); ein Doppelklick startet BIT-Atelier bei Bedarf und
  zeigt die Import-Vorschau. Schon vorhandenes Projekt: „Aktualisieren“, „Als Kopie“ oder „Abbrechen“.
  „Zurück in die Datei speichern“ (Einstellungen › Daten & Sicherung) fragt nach, wenn die Datei inzwischen
  geändert wurde. Vor jedem Import eine Kopie der Datenbank unter `daten/vor-import/`. Die Deinstallation
  meldet den Dateityp wieder ab. Desktop-Client: `.bitproj` im Installationspaket hinterlegt.

### Geändert

- `API_HOST` öffnet die API nicht mehr ohne Anmeldung: Anfragen von anderen Geräten brauchen auch dann
  den Büro-Modus und eine Kopplung.

## [1.1.0] - 2026-10-11

### Neu

- Installer für Windows (`BIT-Atelier-Installer.cmd`, ohne Administratorrechte, mit
  Verknüpfungen) und für macOS/Linux (`install.sh`).
- Update per Klick: Die installierte App erkennt neue Fassungen, lädt sie selbst, prüft die
  SHA-256-Prüfsumme und tauscht die Programmdateien aus; Daten und `.env` bleiben.
- Jedes Release trägt eine Prüfsummendatei `BIT-Atelier.zip.sha256`.
- Regenwassernutzung nach DIN 1989-1: Ertrag, Bedarf, Speicher, Zisterne unter der
  Tiefgarage, eigener Technikraum; Mengen als CSV für die AVA (auch Tiefgarage, Keller,
  TGA-Netz).
- AVA: GAEB-Angebote (X84) in den Preisspiegel einlesen, Angebotsprüfung mit Prüfvermerk,
  Vergabevorschlag und Auftrags-LV als PDF-Entwurf, VHB-Formulare als Entwurf ausfüllen,
  Kostenkontrolle je Kostengruppe nach DIN 276.
- Projektbeteiligtenliste aus dem Adressbuch, Besprechungsprotokolle je Serie mit
  Übernahme offener Punkte, Planner-Import in den Bauzeitenplan mit Großformat-PDF.
- PDF-Studio: Plankopf-Werkzeug und „PDF unveränderbar“ (Formulare festschreiben oder als
  Bild-PDF).
- Komplex-Designer: Türen in allen Typologien, Bäder mit Bewegungsfläche nach DIN 18040-2,
  Laubengang und Spänner mit erreichbaren Räumen, Eingangshalle im Erdgeschoss, Riegel-Netz
  für nicht rechteckige Grundflächen, Vorschläge mit Vergleich von zwei bis vier Varianten.
- Kontakte mit Postanschrift.

### Behoben

- Prüfregeln normalisieren den Status auf beiden Seiten; Zahlenfelder geben ihr Maximum an
  das Eingabefeld weiter.
- IFC-Import zählt übersprungene Bauteile, statt sie still zu verwerfen; die Datenbank
  schreibt beim Beenden zuverlässig.
- Maßketten laufen beim Herauszoomen nicht mehr über ihr Ende hinaus.

## [1.0.1] - 2026-10-07

### Neu

- Breite Zeichenflächen: eine Breitenregel und ein Füllmodus für Pläne.
- Rettungsweg führt durch Zimmertür, Flur und Wohnungstür.

## [1.0.0] - 2026-10-07

### Neu

- Erste öffentliche Fassung unter MIT-Lizenz.
- Start auf einem Port: `start-windows.cmd` bzw. `start.sh` prüfen Node.js 22.9, installieren
  beim ersten Start die Laufzeitpakete und öffnen den Browser; die Daten liegen im Ordner
  `daten/` neben der App.
- KI-Verbindungen mit Vorlagen für beliebige Modelle (Cloud-Anbieter und lokale Server).
- MCP-Server (`tools/mcp-server.mjs`): andere KI-Assistenten lesen Projekte, mit
  `--schreiben` auch schreibend.
- Feedback-Dialog in jeder Fassung.

[Unveröffentlicht]: https://github.com/mozzi86/bit-atelier-oss/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/mozzi86/bit-atelier-oss/releases/tag/v1.1.0
[1.0.1]: https://github.com/mozzi86/bit-atelier-oss/releases/tag/v1.0.1
[1.0.0]: https://github.com/mozzi86/bit-atelier-oss/releases/tag/v1.0.0
