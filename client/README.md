# BIT-Atelier Desktop-Client (Tauri v2)

Ein Fenster um den serverlosen `lokal`-Build der App (Phase 70-02), mit eigenem
Ablageort auf dem Gerät (Phase 70-03, Abschnitt „Ablageort" unten). Die Hülle enthält **keine Fachlogik**: Alles, was
man sieht, ist dieselbe Web-App wie die installierbare PWA. Die Hülle liefert nur das
Fenster, die Einzelinstanz, das lokale Profil und (ab 70-03) den Dateizugriff auf den
gewählten Ablageort.

## Was ein Bau-Rechner braucht

Stand des Bau-Rechners (12.10.2026, gemessen):

| Werkzeug | Fassung | Pfad / Hinweis |
|---|---|---|
| rustup | 1.29.1 | `%USERPROFILE%\.cargo\bin` |
| rustc / cargo | 1.98.1 / 1.98.1 | Toolchain `stable-x86_64-pc-windows-msvc` (Standard) |
| MSVC | Visual Studio Build Tools 2022 (17.14), MSVC 14.44 | `C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools` |
| Windows SDK | 10.0.22621.0 | `C:\Program Files (x86)\Windows Kits\10` |
| WebView2 | 154.0.4258.62 | Teil von Windows 11 |
| Node / npm | 24.18 / 12.0 | für den Web-Teil |
| Tauri CLI / API | 2.12.2 / 2.12.3 | npm-devDependencies (`@tauri-apps/cli`, `@tauri-apps/api`) |

Mindestfassung Rust laut Crates: 1.90 (`rust-version` in `Cargo.toml`).

Prüfen: `npx tauri info` (alles mit Haken = baufähig).

Installation auf einem neuen Rechner (PowerShell):

```powershell
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
winget install --id Rustlang.Rustup -e
rustup default stable-msvc
```

Entfernen: `rustup self uninstall`; Build Tools über den Visual Studio Installer.

### Stolperstein: zwei Visual-Studio-Installationen

Liegt neben den Build Tools eine Visual-Studio-Installation **ohne** C++-Workload (hier:
„VS 2022 Community"), nimmt rustc deren `link.exe` und scheitert mit
`LNK1104: cannot open file 'msvcrt.lib'`. Abhilfe ohne Eingriff ins System: den Bau über
`client\mit-msvc.cmd` starten. Das Skript sucht per `vswhere -requires …VC.Tools…` die
Installation **mit** C++-Werkzeugen und setzt deren Umgebung (`vcvars64.bat`).

## Bauen

Aus dem Repo-Wurzelordner:

```powershell
client\mit-msvc.cmd npm run client:build   # Release-Bau + NSIS-Installer (erster Lauf ~5–15 min)
client\mit-msvc.cmd npm run client:check   # nur cargo check
client\mit-msvc.cmd npm run client:dev     # Fenster gegen den frischen Build (ohne Vite-Server)
```

Ohne den Stolperstein oben reichen `npm run client:build` usw. direkt.

`client:build` baut zuerst das Frontend (`npm run build:client` = `vite build --mode lokal
--base / --outDir dist-lokal-client`) und bettet es in die EXE ein.

**Ergebnis:**

- Programm: `client\src-tauri\target\release\BIT-Atelier.exe`
- Installer: `client\src-tauri\target\release\bundle\nsis\BIT-Atelier_<Version>_x64-setup.exe`

Der Installer installiert **pro Benutzer ohne Adminrechte** (`installMode: currentUser`), auf
Deutsch oder Englisch nach Systemsprache. Fehlt WebView2 (nur ältere Windows-10-Stände),
lädt der Installer den Bootstrapper von Microsoft nach (Tauri-Standard
`webviewInstallMode: downloadBootstrapper`).

`target/` (mehrere GB) liegt im Worktree und ist per `.gitignore` ausgenommen. Liegt das
Repo in einem synchronisierten Ordner (Google Drive, OneDrive), `CARGO_TARGET_DIR` auf einen
Ordner außerhalb setzen, z. B. `C:\bit-build\target`.

## Warum ein eigener Frontend-Build (`dist-lokal-client`)

Die PWA (`build:lokal`) baut mit Basis `/app/` und bringt einen Service Worker mit. Die Hülle
liefert ihre Dateien von `/` aus (`http://tauri.localhost/`); mit Basis `/app/` liefen alle
Assets auf 404. `build:client` ist **derselbe Modus `lokal`** (gleicher Code, gleiche
Datenschicht), nur mit Basis `/`, ohne Service Worker und ohne PWA-Manifest.

## Was die Hülle festlegt (`client/src-tauri/tauri.conf.json`)

- `identifier` **`de.bit-atelier.app` — nie ändern.** Am Bezeichner hängen der WebView-Speicher
  (`%LOCALAPPDATA%\de.bit-atelier.app\EBWebView`) und der Konfigurationsordner
  (`%APPDATA%\de.bit-atelier.app`, dort `profil.json`). Ein neuer Bezeichner = leerer Client.
- Einzelinstanz: Plugin `tauri-plugin-single-instance`, in `src/lib.rs` als erstes Plugin; ein
  zweiter Start holt das vorhandene Fenster nach vorn.
- Dateizuordnung `.bitproj` (93-10): `bundle.fileAssociations` — das NSIS-Paket meldet den Typ pro
  Benutzer an. Der Pfad kommt als Startargument (`src/datei.rs`, im `setup` vorgemerkt) bzw. beim
  zweiten Start über die Einzelinstanz (Ereignis `datei-oeffnen` an die Seite). Befehle
  `datei_ausstehend`/`datei_lesen` (nur Dateien, die so geöffnet wurden) und `datei_stand`/
  `datei_schreiben` (nur absolute `.bitproj`-Pfade, `.tmp` + Umbenennen). Die Seite
  (`src/client/dateiHuelle.js`) zeigt dieselbe Import-Vorschau wie die lokale Fassung; der Quellpfad
  liegt nur im `localStorage` der Hülle. Änderungsprüfung beim Zurückspeichern: Größe +
  Änderungszeit (kein Hash-Crate). **Nur `cargo test` geprüft, nicht im gebauten Paket** — siehe
  `93-10-SUMMARY.md`.
- `dragDropEnabled: false`: sonst fängt WebView2 jedes Drag-and-drop ab und die Ablagefelder der
  App (IFC, PDF, Fotos) bekommen keine Dateien.
- CSP: nur eigene Skripte (+ `wasm-unsafe-eval` für web-ifc), Verbindungen zu `https:` (Karten,
  Wetter, KI-Anbieter) und zu `127.0.0.1`/`localhost` (lokale KI: Harness, Ollama, LM Studio).
  `style-src` bleibt `'unsafe-inline'` (React-`style`-Attribute) — deshalb
  `dangerousDisableAssetCspModification: ["style-src"]`, sonst setzt Tauri Nonces und der
  Browser ignoriert `'unsafe-inline'`.
- Eigene Befehle der Hülle sind über `build.rs` (`AppManifest`) einzeln freizugeben
  (`capabilities/default.json`, `allow-<befehl>`). Ein neuer Befehl ist erst erreichbar, wenn er
  dort eingetragen ist.

## Ablageort (Phase 70-03)

Im Client liegen alle Daten als Dateien in einem Ordner nach Wahl des Nutzers — nicht im
WebView-Speicher. Vorschlag beim ersten Start: `%LOCALAPPDATA%\BIT-Atelier-Ablage` (bewusst
**nicht** unter `%LOCALAPPDATA%\de.bit-atelier.app`, denn die Deinstallation bietet „App-Daten
löschen" an und darf die Projekte nie mitnehmen).

```
<Ablageort>/
  daten/<Entity>.json         eine Datei je Projekt-Sammlung
  personal/<Entity>.json      Personaldaten (getrennt)
  personal/dateien/<id>.json  Personal-Dokumente, eine Datei je Datensatz
  schnappschuesse/<id>.json   Schnappschuss-Ring (5), eine Datei je Schnappschuss
  blobs/<id>.json             große Nutzlasten (bitApi.blobs)
  uebernahme/                 Sicherungskopie der einmaligen Übernahme
  meta.json                   Schema, Übernahme-Vermerk, letzte Sicherung
  logs/
```

- Schreiben ist atomar: `<datei>.tmp` schreiben, auf die Platte bringen, umbenennen.
- Eine beschädigte Datei wird mit Namen gemeldet, nie als leer gelesen.
- Die Befehle der Hülle (`src/ablage.rs`) nehmen nur **relative** Pfade innerhalb des Ablageorts
  aus dem Profil an; `..`, Laufwerksbuchstaben, UNC und `:` werden abgelehnt. `tauri-plugin-fs`
  ist nicht registriert (kommt nur als Abhängigkeit des Dialog-Plugins mit), keine JS-Befehle von
  `fs`/`dialog` sind freigegeben.
- Zwei Fenster auf demselben Ablageort sind durch die Einzelinstanz ausgeschlossen.
- Ablageort ändern (Einstellungen › Daten & Sicherung): leerer Ordner → alles wird kopiert, dann
  gewechselt; Ordner mit BIT-Atelier-Daten → dorthin gewechselt. Der alte Ordner bleibt immer stehen.
- Einmalige Übernahme beim ersten Start in einen leeren Ablageort: aus der Node-Fassung
  (`%LOCALAPPDATA%\BIT-Atelier\daten\db.json` bzw. `~\BIT-Atelier\daten\db.json`, nur lesend) oder
  aus dem WebView-Speicher der Vorstufe 70-02 — nach Rückfrage, mit Sicherungskopie vorher.
  Test-Umleitung: Umgebungsvariable `BIT_ALTBESTAND_DATEI`.

## Was die Hülle bewusst NICHT tut

- Kein Service Worker, kein PWA-Update-Hinweis (Registrierung scheitert unter dem
  Tauri-Protokoll, tauri#12214/#13031; der Ausweg `tauri-plugin-localhost` ist laut Doku ein
  Sicherheitsrisiko). Die Dateien liegen in der EXE, offline läuft die Hülle ohnehin.
- Kein Selbst-Update (kein `tauri-plugin-updater`, kein Signaturschlüssel). Neue Fassung =
  neuer Installer. Das Update per Klick (Phase 92) gilt für die Node-Fassung.
- Keine Signatur: Der Installer ist unsigniert → SmartScreen „Weitere Informationen →
  Trotzdem ausführen". Für Käufer braucht es ein Code-Signing-Zertifikat (extern, Kosten).
  Vorbereitet: `bundle.windows.certificateThumbprint`/`signCommand` bleiben leer, bis ein
  Zertifikat da ist.
- Keine zweite Navigation, keine eigene Geschäftsregel.

## Signieren / Verteilen (vorbereitet, nicht ausgeführt)

1. Code-Signing-Zertifikat beschaffen (OV/EV, z. B. über einen Cloud-Signaturdienst).
2. In `tauri.conf.json` unter `bundle.windows` `certificateThumbprint` + `timestampUrl` oder
   `signCommand` eintragen.
3. Bauen, Signatur prüfen: `Get-AuthenticodeSignature .\BIT-Atelier_*_x64-setup.exe`.
4. Veröffentlichen nur nach ausdrücklicher Freigabe (Release-Regel des Projekts).
