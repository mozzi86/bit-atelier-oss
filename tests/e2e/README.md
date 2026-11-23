# E2E (Playwright) — wie die Specs das „Review Testhaus“ benutzen

Stand 87-01 (09.10.2026). `npm run test:e2e` startet Vite + Express (`npm run dev`) und
läuft **seriell** (`workers: 1`, `fullyParallel: false`): fast alle Massing-, Werkstatt-
und Form-Specs arbeiten auf demselben Projekt „Review Testhaus“ in `server/db.json`.

## Das Testhaus

- 70 × 16 m, 4 Geschosse à 3 m; gespeichert zentriert (`footprintM` ±35 / ±8), im Studio
  bei Site-Metern (0,17)–(70,33).
- Es gibt **keinen Seed** dafür — `server/db.json` ist gitignored. Fehlt das Haus (frischer Klon, CI, nach `npm run seed`), legt das Global-Setup Projekt + Datensatz aus `fixtures/testhaus-record.json` an (87-03). Die Fixture ist der Datensatz vom 09.10.2026 mit drei Layern.

## Frische Test-DB vor einem vollen Lauf (100-07)

```
BIT_DATA_DIR=<Testordner> PORT=5183 API_PORT=3011 API_ORIGINS=http://localhost:5183 npm run test:e2e:frisch
```

`scripts/e2e-testdaten-reset.mjs` löscht im Testordner genau diese Einträge: `db.json` (+ `.bak`/`.tmp`), `blobs/`,
`personal.json` (+ `.bak`/`.tmp`) und `personal-blobs/` (ein Symlink verliert nur den Link), schreibt den Seed
(`server/seed.js`) hinein und legt das Testhaus aus `fixtures/testhaus-record.json` an; danach startet `playwright test`
den Server auf genau diesem Ordner.

**Schutz (seit dem Datenvorfall vom 19.11.2026, ohne Ausnahme-Schalter):** Das Skript arbeitet nur in einem Ordner mit
der Markierungsdatei `.bit-testdaten`, deren Inhalt der echte, absolute Pfad dieses Ordners ist.

- **Neuer Ordner:** `BIT_DATA_DIR` auf einen noch nicht vorhandenen Ordner im System-Temp-Ordner setzen
  (`node -e "console.log(require('os').tmpdir())"`). Nur dort legt das Skript ihn selbst an und schreibt die Markierung.
- **Vorhandener Ordner:** Markierung von Hand anlegen — nur, wenn er wirklich nur Testdaten enthält:
  `printf '%s' "$(cd <Testordner> && pwd -P)" > <Testordner>/.bit-testdaten`. Ohne gültige Markierung lehnt das Skript ab
  und nennt den Befehl.
- **Immer abgelehnt, auch mit Markierung:** `BIT_DATA_DIR` nicht gesetzt (dann wäre es `server/` mit echten Daten), ein
  symbolischer Link als `BIT_DATA_DIR` oder als Markierung, eine Markierung mit anderem Pfad, das Wurzelverzeichnis,
  das Home-Verzeichnis, das Repo, der Temp-Ordner selbst und jeder Ordner, der eines davon enthält, jeder Ordner in
  einem Quellstand (`package.json` + `server/` oder `.git` darüber), `server/` neben einer `package.json`, und jeder
  Ordner, in dem irgendwo `.js`/`.mjs`/`.cjs`, `package.json`, `.git` oder ein `server/`-Ordner liegt.
- Läuft auf `API_PORT` oder `PORT` schon ein Server, lehnt es ebenfalls ab — er hält die DB im Speicher, und Playwright
  würde ihn wiederverwenden.

Die Ablehnungen prüft `tests/unit/e2eTestdatenReset-10007.test.js` ausschließlich an Wegwerf-Ordnern, die das Layout
nachbilden. Nie mit einem echten Datenordner „ausprobieren, ob er abgelehnt wird“.

## Ablauf eines Laufs

1. `global-setup.js`: zwingt die Geometrie auf das Testhaus (ein abgebrochener Lauf kann sie
   schief hinterlassen) und speichert den **ganzen** Datensatz (alle `*_layer`) als Soll
   nach `test-results/testhaus-soll.json`.
2. Jeder Spec, der `import { test, expect } from "./fixtures/base.js"` benutzt, bekommt
   eine automatische Fixture: **nach jedem Test** wird der Datensatz per API auf das Soll
   zurückgesetzt und zurückgelesen. Abweichung > 1 cm oder ein anderer Layer-Inhalt →
   der Test ist **rot** (`fixtures/testhaus.js`). Kein `.catch(() => {})` mehr.
3. Specs, die das Haus nicht anfassen (smoke, ifc-parity, cloud-smoke, feedback, modelcheck,
   ki-vorlagen), importieren weiter aus `@playwright/test`.

## Regeln für neue Specs

- Testhaus anfassen → `test` aus `./fixtures/base.js`.
- Eine Form, die die UI nicht per Drag erreicht (> ~15 m, Parzellen-Klemme):
  `testhausFootprintSetzen(page.request, footprintM)` in **zentrierten** Metern, dann
  `page.reload()` (Beispiel `massing-75-06.spec.js`, Schritt 4).
- Nichts in `finally` zurücksetzen müssen — die Fixture macht es und meldet Fehler.
- Eigene Datensätze (BuildingComplex, LVPosition …) selbst anlegen **und** im `finally`
  löschen; zusätzlich beim Start Reste früherer Läufe löschen (Beispiel
  `kg-vorschlag-76-03.spec.js`, `alteTestpositionenLoeschen`) — ein Timeout erreicht das
  `finally` nicht.
- Ecken danach prüfen: `node .planning/phases/86-formen-tesselierung/tmp-e2e/ecken-testhaus.mjs`
  → `[{"x":0,"y":17},{"x":70,"y":17},{"x":70,"y":33},{"x":0,"y":33}]`.

## Fallen

- Port 5173 kann der Vite eines anderen Klons sein (`reuseExistingServer`) — Prozess prüfen.
- Das Backend hält die DB im Speicher: Resets immer über die laufende API, nie per
  Datei-Edit; nach `npm run seed` Server neu starten.
- `punkte()` misst gegen die erste Rasterlinie — nach einer Formänderung erst neu laden,
  sonst ist die Ansicht noch auf die alte Form eingepasst (7,5 m Scheinabweichung).
