# Musterprojekt der Online-Demo

**Synthetisch erzeugt — enthält keinerlei Projekt- oder Kundendaten.**

Erzeugt von `tools/beispielmodell-erzeugen.mjs`. Neu erzeugen:

```
node tools/beispielmodell-erzeugen.mjs
```

Der Lauf ist deterministisch: feste GlobalIds, fester Zeitstempel im Kopf,
feste Reihenfolge. Ein zweiter Lauf ändert die Dateien nicht.

## Was drin ist

Eine Halle 12 × 8 m, lichte Höhe 3 m, ein Geschoss, 9 Bauteile:
Bodenplatte, vier Außenwände (eine davon doppelt), zwei Unterzüge, ein Lüftungskanal —
dazu 1 Raum (kein Bauteil, ohne Körper).

## Räume, Mengen, Material, Klassifikation

Seit Plan 69-32 ist das Modell mehr als Geometrie:

- **Raum:** `Halle` (Langname `Musterhalle`, Nummer 0.01 in
  `Pset_SpaceCommon.Reference`), dem Geschoss per `IfcRelAggregates` zugeordnet. Der Raum hat
  bewusst keinen Körper: Kollisionsprüfung und „Bauteil-Geometrien“ bleiben bei 9;
  die App zählt ihn unter „Bauteile mit Eigenschaften“.
- **Mengen:** je Bauteil und Raum ein `IfcElementQuantity` „BaseQuantities“ mit Länge (m),
  Fläche (m²) und Volumen (m³), aus den Quadermaßen derselben Geometrie berechnet; Net gleich
  Brutto, weil das Modell keine Öffnungen hat. Raum: Nettogrundfläche aus dem lichten Maß
  zwischen den Wänden.
- **Material:** Stahlbeton C25/30 · Kalksandstein-Mauerwerk · Verzinktes Stahlblech.
- **Klassifikation:** DIN 276, Kostengruppen 322 Flachgründungen · 331 Tragende Außenwände · 351 Deckenkonstruktionen (Bezeichnungen sinngemäß).
- **Außenwände** tragen `Pset_WallCommon.IsExternal = true` — sonst liest der Import sie als
  Innenwand (Gewerk „Ausbau“).

### Die vier Köder (je Sorte ein unvollständiges Bauteil)

| Bauteil | Sorte | Es fehlt |
|---|---|---|
| Bodenplatte | Platte | Material |
| Aussenwand West | Wand | Material |
| Unterzug Achse C | Unterzug | Klassifikation (Kostengruppe) |
| Lueftungskanal Zuluft | Kanal | Klassifikation (Kostengruppe) |

Die Köder ändern keine der Erwartungszahlen unten. Die Prüf-Suite meldet sie heute nicht von
selbst (die mitgelieferte IDS fragt nur den Brandschutz ab); sichtbar werden sie in den Mengen
(Material „–“, Kostengruppe fällt auf die Vorgabe zurück) und mit einer IDS-Regel auf Material
oder Klassifikation.

## Die drei eingebauten Befunde

| Befund | Wo | Was die Prüf-Suite meldet |
|---|---|---|
| **Harte Kollision** | Lüftungskanal Zuluft × Unterzug Achse B | Der Kanal läuft auf 2,60–3,00 m durch den Unterzug. |
| **Doppelte Modellierung** | Aussenwand Ost | Zweimal deckungsgleich modelliert, eigene GlobalId — im 3D unsichtbar, in der Menge doppelt. |
| **IDS-Verstoß** | Aussenwand Nord | Ohne `Pset_WallCommon.FireRating`, das `musterprojekt.ids` verlangt. |

Erwartete Zahlen (auch im Test festgehalten, `tests/unit/beispielmodell.test.js`):
{
  "hart": 1,
  "duplikate": 1,
  "idsFehler": 1,
  "bauteile": 9,
  "geschosse": 1,
  "raeume": 1,
  "koeder": 4
}

Alles andere ist bewusst kollisionsfrei: die Unterzüge beginnen bei x = 0,50 m
und berühren die Wände nicht, der Kanal endet bei x = 7,00 m und erreicht die
Ostwand nicht, die Bodenplatte liegt vollständig unter z = 0.

## Beispiel-BCF (`musterprojekt.bcf`)

Drei synthetische BCF-2.1-Befunde auf echte GlobalIds dieses Modells — für
„Beispiel-BCF laden“ in der Prüf-Suite (Karte „Befunde (BCF)“), damit ein
Demo-Besucher ohne eigene BCF-Datei einen Befund als Ticket übernehmen kann.

| Befund | Bauteil (GlobalId) | Status | Priorität |
|---|---|---|---|
| Aussenwand Süd: Dämmung fehlt im Modell | `nYqxeK5NUBtew1kQBTaHzk` | Open | High |
| Aussenwand Nord: Feuerwiderstand nicht angegeben | `_l18sXIahP4r7EydOgnVAx` | InProgress | Normal |
| Aussenwand West: Durchbruch für die Zuluft fehlt | `ByEL4kVnudH2KRAqbt_jN8` | Open | Normal |

Erzeugt mit `buildBcfZip` (`packages/nova-ifc-viewer/src/lib/bcf.js`), deterministisch
(feste Guids und Zeitstempel). Neu erzeugen bzw. prüfen, ob die Datei aktuell ist:

```
node --import ./tests/alias-register.mjs .planning/phases/72-produktreife/tmp-e2e/n-12-beispiel-bcf-erzeugen.mjs
node --import ./tests/alias-register.mjs .planning/phases/72-produktreife/tmp-e2e/n-12-beispiel-bcf-erzeugen.mjs --pruefen
```
