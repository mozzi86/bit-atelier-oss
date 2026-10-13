# Änderungsliste

Alle nennenswerten Änderungen an BIT-Atelier stehen in dieser Datei.
Das Format folgt [Keep a Changelog](https://keepachangelog.com/de/1.1.0/), die Versionsnummern
folgen [Semantic Versioning](https://semver.org/lang/de/).

Der Release-Lauf übernimmt den Abschnitt der getaggten Fassung wörtlich als Release-Notiz, und
der Update-Hinweis der installierten App zeigt dieselben Zeilen. Neue Einträge kommen deshalb
zuerst unter **Unveröffentlicht** und wandern beim nächsten Release unter die neue Nummer.

## [Unveröffentlicht]

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
