# Notfall-Handbuch — BIT-Atelier (lokale Fassung)

Für die heruntergeladene App (Installer oder ZIP). Kurz, in der Reihenfolge, in der man es braucht.

## 1. Wo liegen meine Daten?

- **Einstellungen › Daten & Sicherung** zeigt den Datenordner und öffnet ihn („Ordner öffnen“).
- Standard nach Installer: `%LOCALAPPDATA%\BIT-Atelier\daten` (Windows) bzw. `~/BIT-Atelier/daten` (macOS/Linux).
- Darin: `db.json` (Projektdaten), `db.json.bak` (vorheriger Stand), `personal.json` (Personaldaten, getrennt), `blobs/` (große Inhalte aus dem Objektspeicher: Bauteillisten, Dokumente über 1 MB).
- Mit der Umgebungsvariable `BIT_DATA_DIR` (in `.env` im App-Ordner) liegt der Ordner woanders — z. B. auf einem gesicherten Laufwerk.

**Wichtig:** `%LOCALAPPDATA%` wird von vielen Büro-Sicherungen nicht erfasst. Datenordner verlegen oder regelmäßig sichern (Punkt 2).

## 2. Sichern

**Die App sichert sich selbst.** Beim Start (wenn die letzte Sicherung älter als 24 Stunden ist) und danach
einmal am Tag legt sie ein ZIP der Daten an — `db.json`, `personal.json`, `blobs/`, `personal-blobs/` mit
einer Datei `sicherung.json` (Zeit, Fassung, Prüfsummen):

- Ort: `sicherungen/` im Datenordner, Name `bit-atelier-<Zeit>.zip`. **Einstellungen › Daten & Sicherung**
  zeigt die letzte automatische Sicherung, den Ordner und „Jetzt sichern“.
- Aufbewahrt werden die jüngste Sicherung der letzten **7 Tage** und je eine der letzten **4 Wochen**;
  ältere löscht die App selbst. Andere Dateien im Ordner fasst sie nicht an.
- Einstellbar in `.env` im App-Ordner: `BIT_SICHERUNG_STUNDEN=12` (Abstand), `BIT_SICHERUNG_ORDNER=D:\Sicherung\BIT`
  (anderer Ordner, z. B. ein zweites Laufwerk), `BIT_SICHERUNG_TAEGLICH` / `BIT_SICHERUNG_WOECHENTLICH`
  (Anzahl), `BIT_SICHERUNG_AUS=1` (aus).
- Die Sicherungen liegen **auf demselben Rechner**. Gegen Diebstahl, Brand oder einen defekten Datenträger
  hilft nur eine Kopie woanders: den Ordner `sicherungen/` (oder den ganzen Datenordner) in die
  Büro-Sicherung aufnehmen.
- Von Hand: App beenden, dann den **ganzen** Datenordner kopieren (nicht nur `db.json` — `blobs/` gehört dazu).
- Cloud-Fassung: Einstellungen › Daten & Sicherung › „Gesamtexport herunterladen“ (ZIP mit Prüfsummen).

## 3. Die App startet nicht mehr

Seit 93-11 startet die Verknüpfung BIT-Atelier **ohne Konsolenfenster**; Fehler erscheinen als Meldungsfenster, die Ausgabe des Servers steht in `daten/server.log` (über 5 MB wird sie zu `server.log.1`). Beenden: Einstellungen › System & Info › „Programm beenden“ — das Fenster zu schließen beendet den Server absichtlich nicht.

1. Fenster der App schließen, `start-windows.cmd` bzw. `./start.sh` im App-Ordner von Hand starten — die Meldung im Fenster sagt, was fehlt (Node.js-Fassung, Paketinstallation, Port belegt).
2. **Port 3001 belegt:** ein anderes Programm oder eine zweite BIT-Atelier-Instanz läuft. Erst „Programm beenden“ versuchen, sonst neu anmelden oder den Rechner neu starten.
2a. **Kein eigenes Fenster, sondern ein Browser-Tab:** weder Edge noch Chrome gefunden, oder `BIT_FENSTER=0` steht in `.env`. Das App-Fenster hat ein eigenes Profil in `daten/fenster-profil` (Fenstergröße, keine Projektdaten) — löschen setzt es zurück.
3. **Paketinstallation scheitert** (Firmen-Proxy, keine Verbindung): Die Startskripte erklären Proxy und Firmen-Registry; alternativ einen bereits installierten App-Ordner (mit `node_modules`) kopieren.

## 4. Ein Update ist schiefgegangen

- Der Updater sichert vor dem Tausch Programm **und** Daten nach `.update/sicherung-<Zeit>` und springt automatisch zurück, wenn die neue Fassung nach dem Neustart nicht antwortet. Protokoll: `daten/update.log`.
- Von diesen Update-Kopien bleiben die **zwei jüngsten**; ältere (auch aus einem abgebrochenen Update) entfernt die App bei jedem Start.
- Von Hand zurück: App beenden, Inhalt der jüngsten `.update/sicherung-*` über den App-Ordner kopieren (die Daten liegen dort unter `daten/`).
- Updates vorübergehend stoppen: Einstellungen › System & Info › „Fassung festhalten bis …“ oder `BIT_KEIN_UPDATECHECK=1` in `.env`.

## 5. Daten sind kaputt oder versehentlich gelöscht

1. App beenden.
2. `db.json.bak` liegt neben `db.json` (vorheriger Schreibstand) — `db.json` umbenennen, `db.json.bak` in `db.json` umbenennen, App starten.
3. Sonst eine automatische Sicherung zurückholen: App beenden, die gewünschte `sicherungen/bit-atelier-<Zeit>.zip`
   **in den Datenordner entpacken** (überschreibt `db.json`, `personal.json`, `blobs/`; die Datei
   `sicherung.json` darf liegen bleiben), App starten. Vorher den aktuellen Stand beiseitelegen, falls man
   doch zurück will.
4. Oder die letzte eigene Sicherung (Punkt 2) zurückkopieren.

## 6. Rechnerwechsel

App auf dem neuen Rechner installieren, App beenden, den alten Datenordner über den neuen kopieren, starten.

## 7. Deinstallieren

`BIT-Atelier-Installer.cmd /entfernen` (Windows) bzw. `install.sh --entfernen` — fragt, ob die Daten bleiben sollen (Vorgabe: ja). Die Dateizuordnung `.bitproj` wird dabei abgemeldet, solange sie noch auf diese Installation zeigt.

## 7a. Projektdatei per Doppelklick (`.bitproj`)

- **Doppelklick tut nichts / öffnet ein anderes Programm:** Rechtsklick › „Öffnen mit“ › BIT-Atelier wählen — eine dort getroffene Wahl hat Vorrang vor der Anmeldung durch den Installer. Installer erneut ausführen meldet den Typ wieder an.
- **Falsches Symbol:** Explorer zeigt es nach F5 oder der nächsten Anmeldung.
- **„Port belegt“ / „Schlüssel passt nicht“:** eine andere BIT-Atelier-Installation läuft auf Port 3001 — beenden und die Datei erneut öffnen.
- **Import falsch übernommen:** Vor jedem Übernehmen legt die App eine Kopie von `db.json` unter `daten/vor-import/` an (die drei neuesten bleiben). App beenden, die gewünschte Kopie als `db.json` in den Datenordner kopieren, starten.
- **Zurückspeichern meldet „Datei geändert“:** jemand (oder ein Sync-Programm) hat die Datei seit dem Öffnen verändert — „Als Kopie speichern“ verliert nichts. Die Verknüpfung liegt in `daten/dateiquelle.json`; löschen hebt sie auf.

## 8. Sicherheit

Die lokale API (Port 3001), der KI-Harness (8765) und der MCP-Server haben keine Anmeldung und lauschen nur auf `127.0.0.1`. **Diese Ports nie im Netzwerk oder Internet freigeben.** Sicherheitsmeldungen: siehe `SECURITY.md`.

### Mehrplatz: Büro-Modus

- **Was es ist:** Ein zweiter Rechner oder ein Tablet im selben Büro-Netz nutzt die App dieses Rechners mit. Einschalten unter Einstellungen › System & Info › „Büro-Modus (Mehrplatz)“; die Kopfzeile zeigt dann „Büro-Modus an“. Auf dem anderen Gerät die angezeigte Adresse öffnen (z. B. `http://192.168.0.20:3001/`) und den Koppel-Code eingeben, der am Büro-Rechner erzeugt wird. Das Gerät zeigt oben „Gerät: <Name>“.
- **Nur im vertrauenswürdigen Büro-Netz.** Die Verbindung ist nicht verschlüsselt. Nie im Gäste-WLAN, nie über Portweiterleitung.
- **Firewall (Windows):** Beim ersten Einschalten fragt Windows, ob Node.js im Netz erreichbar sein darf — nur „Private Netzwerke“ erlauben.
- **Gleichzeitig bearbeiten:** Es gilt „wer zuletzt speichert, gewinnt“. Hat jemand denselben Eintrag inzwischen geändert, meldet die App das nach dem Speichern; die frühere Änderung ist dann überschrieben. Am selben Eintrag also nicht gleichzeitig arbeiten.
- **Gerät verloren oder Mitarbeiter ausgeschieden:** am Büro-Rechner unter „Gekoppelte Geräte“ → „Widerrufen“. Wirkt sofort. Geräte-Zugänge laufen nach 30 Tagen ohnehin ab.
- **Andere Geräte kommen nicht mehr hinein:** Hat sich die Adresse des Büro-Rechners geändert (WLAN/Router-Neustart), den Büro-Modus aus- und wieder einschalten und die neue Adresse verwenden.
- **Alles sofort zumachen:** Büro-Modus ausschalten. Notfalls App beenden und `buero.json` im Datenordner löschen — dann ist der Büro-Modus aus und alle Kopplungen sind weg.
- **Personaldaten** bleiben auf dem Büro-Rechner, außer das Büro setzt bewusst `PERSONAL_LAN=1`.
