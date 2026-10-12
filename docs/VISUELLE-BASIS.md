# Visuelle Regressionsbasis (Plan 72-06)

Screenshots der Hauptseiten bei 1440, 768 und 375 px liegen als Baseline im Repo. Die
Spec `tests/e2e/visuell-72-06.spec.js` vergleicht jeden Lauf dagegen und schlägt aus,
wenn sich eine Seite sichtbar verändert hat.

## Was verglichen wird

| Seite | Route |
|---|---|
| Projektübersicht | `/Dashboard` |
| Projekte | `/Projects` |
| Komplex-Designer | `/ComplexDesigner` |
| Prüf-Suite | `/ModelCheck` |
| AVA | `/AVA` |
| Buchhaltung | `/Accounting` |
| KI-Zentrale | `/AIDashboard` |
| Einstellungen | `/Settings` |

Je Seite drei Breiten (1440 × 900, 768 × 1024, 375 × 812), nur der sichtbare Bereich
(kein Ganzseiten-Bild) — 24 Bilder in `tests/e2e/visuell-72-06.spec.js-snapshots/`.

## Warum die Bilder stabil sind

- **Daten:** Die Spec startet einen eigenen API-Server mit frisch geseedeten Daten in
  einem Temp-Ordner (`tests/e2e/visuell/privatServer.js`). Die `/api`-Anfragen des
  Browsers gehen dorthin, nicht in die gemeinsame E2E-Datenbank, in die andere Specs
  schreiben. Die Reihenfolge der Suite spielt damit keine Rolle.
- **Zeit:** Seeder, privater Server (`tests/e2e/visuell/fester-zeitpunkt.mjs`) und
  Browseruhr (`page.clock.setFixedTime`) stehen auf 01.10.2026 09:00 UTC. Fristen,
  Buchhaltungs-Beispiele und „heute" zeigen jeden Tag dasselbe.
- **Bewegung:** `prefers-reduced-motion`, CSS-Animationen und Übergänge aus, Cursor
  versteckt. Playwright wartet, bis zwei Aufnahmen hintereinander gleich sind.
- **Masken:** alle `canvas` (three.js, WebGL), Karten (`.maplibregl-map`) und Toasts
  werden als Fläche überdeckt.
- **Netz:** Nur `localhost` ist erreichbar — keine Kacheln, Schriften oder APIs von außen.

## Schwelle

Ein Pixel gilt als verschieden ab Farbabstand 0,2 (Playwright-Standard); eine Seite fällt
durch, wenn **mehr als 1 %** ihrer Pixel verschieden sind. Das schluckt Kantenglättung,
aber keinen verschobenen Knopf, keine neue Textzeile und keine geänderte Farbe.

## Laufen lassen

```
npm run seed
PORT=5196 API_PORT=3026 API_ORIGINS=http://localhost:5196 npx playwright test tests/e2e/visuell-72-06.spec.js --reporter=line
```

Bei einem Fehlschlag liegen Soll, Ist und Differenzbild unter `test-results/`
(`npx playwright show-report`).

## Baseline bewusst erneuern

Nur wenn die Änderung gewollt ist (neues Layout, neue Komponente) — nie, um einen
roten Lauf grün zu machen, dessen Ursache man nicht kennt.

1. Differenzbilder ansehen und begründen, warum die neue Darstellung richtig ist.
2. Neu aufnehmen:
   ```
   PORT=5196 API_PORT=3026 API_ORIGINS=http://localhost:5196 npx playwright test tests/e2e/visuell-72-06.spec.js --update-snapshots
   ```
   Nur einzelne Seiten: `-g "designer"` anhängen.
3. Verlustfrei verkleinern (Alpha weg, Zeilenfilter, Deflate 9 — Pixel bleiben gleich):
   ```
   node scripts/png-optimieren.mjs tests/e2e/visuell-72-06.spec.js-snapshots
   ```
4. Vergleich ohne `--update-snapshots` zweimal laufen lassen (Stabilität).
5. Bilder im selben Commit wie die Oberflächenänderung, im Commit-Text: welche Seiten,
   warum.

## Plattform

Schriften werden je Betriebssystem anders gerastert, deshalb tragen die Dateien die
Endung `-win32` bzw. `-linux`. Aufgenommen ist bisher **nur Windows** (die
Entwicklungsrechner). Ohne Baseline für die laufende Plattform wird die Spec
**übersprungen**, nicht rot — der nächtliche Lauf auf `ubuntu-latest` überspringt sie
also. Eine Linux-Baseline entsteht mit Schritt 2 auf einem Linux-Rechner (oder im
CI-Container) und wird zusätzlich eingecheckt.

## Größe

24 Bilder, 4,54 MB nach `png-optimieren.mjs` (vorher 5,20 MB).
