# Mitmachen / Contributing

Beiträge sind willkommen — Fehlerberichte, Prüfregeln, Übersetzungen, Code.
Contributions are welcome — bug reports, check rules, translations, code.

## Loslegen / Getting started

```bash
git clone https://github.com/mozzi86/bit-atelier-oss.git
cd bit-atelier-oss
npm install
npm run dev            # API :3001 + Vite :5173
```

Node.js 22.9 oder neuer. Für den KI-Harness zusätzlich Python 3.11 bis 3.13 (`harness/README.md`).

## Bevor Sie einen Pull Request öffnen / Before you open a pull request

```bash
npm run lint
npm run test:unit
npm run build
```

- Ein Thema je Pull Request; Commit-Nachrichten auf Englisch (`feat: …`, `fix: …`).
- Neue Oberflächentexte nie fest im Code, sondern über `@core/lib/i18n` (Deutsch + Englisch).
- Fachliche Werte mit Herkunft kommentieren (Norm, Tabelle, Quelle); Richtwerte als `[ASSUMED]` markieren.
- Paketgrenzen beachten: Module importieren nur `@core` und sich selbst (ESLint prüft das).
- Keine neuen Abhängigkeiten ohne vorherige Abstimmung in einem Issue.
- **Keine echten Projekt-, Kunden- oder Personendaten** in Tests, Fixtures oder Screenshots. Ein Wächter (`tests/unit/projektneutral.test.js`) prüft das.

## Lizenz / License

Mit Ihrem Beitrag stimmen Sie zu, dass er unter der MIT-Lizenz dieses Projekts veröffentlicht wird.
By contributing you agree that your contribution is licensed under the MIT licence of this project.
