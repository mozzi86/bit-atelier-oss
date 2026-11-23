# Gestaltung BIT-Atelier

| Datei | Zweck |
|---|---|
| `bit-atelier-tokens.json` | Quelle: Farben (hell/dunkel), Weißmodell, Abstände, Radien, Trefferflächen, Schriftstufen |
| `bit-atelier-design.figcraft` | Designdatei für FigCraft — **erzeugt**, nicht von Hand pflegen |
| `vorschau/*.png` | ein Bild je Seite der Designdatei |

Aktualisieren: Werte in `bit-atelier-tokens.json` ändern (oder das Layout in `scripts/figcraft-design.mjs`), dann

```
node scripts/figcraft-design.mjs
```

und Designdatei samt Vorschau committen. Braucht FigCraft (`figcraft-cli`; anderer Ort über die Umgebungsvariable `FIGCRAFT_CLI`).

Regeln und Entscheidungen dahinter: `.planning/phases/115-bedienung-gebaeudemodell/115-DESIGN.md` und `115-CONTEXT.md`.
Die Seite „10 · Zeichenfläche (Entwurf)“ zeigt die am 15.11.2026 beschlossene Ordnung der Zeichenflächen (drei Zonen im Kopf,
Ansicht-Umschalter links, Geschoss-Leiste, Werkzeugkasten in vier Gruppen, rechts Info und Ebenen, Statuszeile).

Handänderungen in FigCraft gehen beim nächsten Erzeugen verloren — Änderungswünsche in die Token-Datei oder den Generator.
