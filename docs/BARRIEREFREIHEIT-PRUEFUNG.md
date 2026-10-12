# Barrierefreiheit prüfen (Plan 72-03, 93-02)

Drei Prüfungen, von schnell nach umfassend:

| Prüfung | Datei | Läuft | Stand |
|---|---|---|---|
| Wächter im Quelltext (Felder/Knöpfe ohne Namen, Labels, Fokus) | `tests/unit/a11y-schulden.test.js` | `npm run test:unit`, jeder Push | aktiv, alle Zahlen 0 |
| Tastaturlauf Kernpfad + Dialog | `tests/e2e/a11y-tastatur-72-03.spec.js` | E2E, nachts | aktiv |
| axe (WCAG 2.1 A/AA) über alle Modulseiten | `tests/e2e/axe-93-02.spec.js` | E2E, nachts | **aktiv seit 12.10.2026** — `@axe-core/playwright` 4.13.0, Basis `tests/e2e/axe-basis.json` (24 Seiten) |

## Wächter im Quelltext

`node scripts/a11y-schulden.mjs --liste` zeigt jede Stelle. Neue Auswahl- oder
Eingabefelder unter einem Label benennt `node scripts/a11y-codemod.mjs --schreiben`
(Trockenlauf ohne `--schreiben`), Einzelstellen `--hand <datei>:<zeile> "Name"`.
Die Obergrenzen im Test stehen auf 0 und dürfen nicht steigen.

## axe-Gate einschalten

Voraussetzung: das ausdrückliche Ja des Nutzers zur neuen devDependency.

1. `npm install -D --save-exact @axe-core/playwright` (Lockfile mit committen).
2. Basis einmal aufnehmen — bekannte Verstöße je Seite:
   ```
   AXE_BASIS_SCHREIBEN=1 PORT=5196 API_PORT=3026 API_ORIGINS=http://localhost:5196 npx playwright test tests/e2e/axe-93-02.spec.js
   ```
   Ergebnis: `tests/e2e/axe-basis.json`, Form `{ "seiten": { "/Route": { "regel-id": Knotenzahl } } }`.
3. Ab dann ist der normale Lauf das Gate: rot nur bei **neuen** Verstößen (Regel nicht
   in der Basis der Seite, oder mehr Knoten als dort verzeichnet). Läuft nachts über
   `npm run test:e2e` (`.github/workflows/e2e.yml`).

Die Daten sind fest: derselbe private, frisch geseedete API-Server mit fester Uhr wie
bei der visuellen Basis (`tests/e2e/visuell/privatServer.js`).

## Basis schrumpfen lassen

- Meldet der Lauf `[axe] /Route: weniger als in der Basis — Basis senken: …`, ist ein
  Verstoß behoben. Dann im selben Commit wie die Behebung die Zahl in
  `axe-basis.json` senken oder die Regel bei der Seite löschen.
- Bequemer Weg: `AXE_BASIS_SCHREIBEN=1 …` erneut laufen lassen und **den Diff prüfen**:
  Er darf nur Zahlen senken oder Einträge entfernen. Eine gestiegene Zahl in diesem
  Diff ist eine neue Barriere, keine Basispflege — beheben statt einchecken.
- Ziel ist eine leere Basis je Seite.

## Erklärung zur Barrierefreiheit

Route `/barrierefreiheit` (öffentlich, Link in der Fußzeile und unter jeder
Rechtsseite), Text in `packages/nova-core/src/lib/rechtstexte.jsx`
(`BarrierefreiheitText`, Datum `BARRIEREFREIHEIT_STAND`). Ansprechpartner trägt der
Betreiber in `packages/nova-core/src/lib/anbieter.js` → `barrierefreiheitKontakt` ein;
leer erscheint „— fehlt —". Bei jeder Änderung der Messung (axe in Betrieb, Lücke
geschlossen) Text und Datum mitziehen.
