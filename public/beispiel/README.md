# Musterprojekt der Online-Demo

**Synthetisch erzeugt — enthält keinerlei Projekt- oder Kundendaten.**

Erzeugt von `tools/beispielmodell-erzeugen.mjs`. Neu erzeugen:

```
node tools/beispielmodell-erzeugen.mjs
```

Der Lauf ist deterministisch: feste GlobalIds, fester Zeitstempel im Kopf,
feste Reihenfolge. Ein zweiter Lauf ändert die Dateien nicht.

## Was drin ist

Seit Plan 69-19 (Entscheidung D-HR-03) ein Projekt in glaubwürdiger Größe:
3 Geschosse, 523 Bauteile, 40 Räume.

- **Halle** (Erdgeschoss, die ersten 9 Bauteile, unverändert seit 65-03): 12 × 8 m,
  lichte Höhe 3 m — Bodenplatte, vier Außenwände (eine davon doppelt), zwei Unterzüge,
  ein Lüftungskanal, ein Raum. Ihre GlobalIds sind dieselben wie vorher; das Beispiel-BCF
  zeigt auf sie.
- **Bürobau** 2 m östlich: 36 × 16 m, Erdgeschoss, 1. Obergeschoss, 2. Obergeschoss, Geschosshöhe 3,5 m,
  sechs Achsen à 6 m, je Geschoss zwölf Büros und ein Flur. Bodenplatte bzw. Geschossdecke und
  Dachdecke je Achse, Außen-, Flur- und Trennwände, Türen, Fenster, Unterzüge, Zuluftkanal,
  Heizungsleitungen, Kabeltrasse, Luftauslässe und Schreibtische.
- Bauteile je Klasse: IFCWALL 120 · IFCFURNITURE 109 · IFCWINDOW 73 · IFCPIPESEGMENT 40 · IFCBEAM 39 · IFCAIRTERMINAL 37 · IFCDOOR 36 · IFCSLAB 26 · IFCDUCTSEGMENT 23 · IFCCABLECARRIERSEGMENT 20.

## Räume, Mengen, Material, Klassifikation

- **Räume:** je Büro, Flur und die Halle ein `IfcSpace` mit Nummer in
  `Pset_SpaceCommon.Reference` (Geschoss.laufende Nummer), dem Geschoss per
  `IfcRelAggregates` zugeordnet, ohne Körper — Kollisionsprüfung und „Bauteil-Geometrien“
  bleiben bei 523.
- **Mengen:** je Bauteil und Raum ein `IfcElementQuantity` „BaseQuantities“ mit Länge (m),
  Fläche (m²) und Volumen (m³), aus den Quadermaßen derselben Geometrie berechnet.
- **Material:** Stahlbeton C25/30 · Kalksandstein-Mauerwerk · Verzinktes Stahlblech · Gipskarton-Staenderwand · Isolierglas · Holzwerkstoff · Stahlrohr.
- **Klassifikation:** DIN 276, Kostengruppen 322 Flachgründungen · 331 Tragende Außenwände · 334 Außenwandöffnungen · 341 Tragende Innenwände · 342 Nichttragende Innenwände · 344 Innenwandöffnungen · 351 Deckenkonstruktionen · 361 Dachkonstruktionen · 422 Wärmeverteilnetze · 431 Lüftungsanlagen · 444 Niederspannungsinstallationsanlagen · 610 Allgemeine Ausstattung (Bezeichnungen sinngemäß; die App liest
  beim Import nur 3xx, TGA und Ausstattung fallen dort auf die Vorgabe zurück).
- **Außenwände** tragen `Pset_WallCommon.IsExternal = true`.

### Die vier Köder (je Sorte ein unvollständiges Bauteil, Halle)

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

## Die 24 eingebauten Befunde

Gestuft nach Schwere (Kollision hoch, Doppelung mittel) und über alle Geschosse verteilt —
die IDS-Verstöße meldet `musterprojekt.ids` (jede Wand braucht `Pset_WallCommon.FireRating`).

| Nr. | Geschoss | Art | Wo | Was |
|---|---|---|---|---|
| 1 | Erdgeschoss | Kollision | Lueftungskanal Zuluft × Unterzug Achse B (Halle) | Kanal laeuft auf 2,60–3,00 m durch den Unterzug |
| 2 | Erdgeschoss | Doppelung | Aussenwand Ost (Halle) | zweimal deckungsgleich modelliert — Menge doppelt |
| 3 | Erdgeschoss | IDS-Verstoß | Aussenwand Nord (Halle) | FireRating fehlt |
| 4 | Erdgeschoss | IDS-Verstoß | Flurwand Sued EG Achse 3 | FireRating fehlt |
| 5 | 1. Obergeschoss | IDS-Verstoß | Trennwand Nord 1.OG Achse 2/3 | FireRating fehlt |
| 6 | 1. Obergeschoss | IDS-Verstoß | Trennwand Sued 1.OG Achse 4/5 | FireRating fehlt |
| 7 | 2. Obergeschoss | IDS-Verstoß | Aussenwand Nord 2.OG Achse 5 | FireRating fehlt |
| 8 | 2. Obergeschoss | IDS-Verstoß | Flurwand Nord 2.OG Achse 1 | FireRating fehlt |
| 9 | Erdgeschoss | Kollision | Zuluft-Abzweig Buero 0.03 × Flurwand Sued EG Achse 3 | Kanal ohne Wanddurchbruch |
| 10 | Erdgeschoss | Kollision | Heizungsabzweig Buero 0.08 × Flurwand Nord EG Achse 2 | Rohr ohne Wanddurchbruch |
| 11 | Erdgeschoss | Kollision | Luftauslass Buero 0.05 (zu hoch) × Unterzug EG Achse 5 Sued | Auslass haengt im Unterzug |
| 12 | Erdgeschoss | Kollision | Kabeltrasse Buero 0.10 × Unterzug EG Achse 4 Nord | Trasse quert den Unterzug |
| 13 | 1. Obergeschoss | Kollision | Zuluft-Abzweig Buero 1.09 × Flurwand Nord 1.OG Achse 3 | Kanal ohne Wanddurchbruch |
| 14 | 1. Obergeschoss | Kollision | Steigleitung Buero 1.02 × Geschossdecke 1.OG Feld 2 | Rohr ohne Deckendurchbruch |
| 15 | 1. Obergeschoss | Kollision | Kabeltrasse Buero 1.03 × Unterzug 1.OG Achse 3 Sued | Trasse quert den Unterzug |
| 16 | 1. Obergeschoss | Kollision | Zuluftkanal 1.OG Abschnitt 4 × Unterzug Flur 1.OG Achse 4 | Unterzug im Kanal |
| 17 | 2. Obergeschoss | Kollision | Zuluft-Abzweig Buero 2.05 × Flurwand Sued 2.OG Achse 5 | Kanal ohne Wanddurchbruch |
| 18 | 2. Obergeschoss | Kollision | Heizleitung Buero 2.11 × Unterzug 2.OG Achse 5 Nord | Rohr quert den Unterzug |
| 19 | 2. Obergeschoss | Kollision | Abluft ueber Dach × Dachdecke Feld 2 | Kanal ohne Dachdurchbruch |
| 20 | Erdgeschoss | Doppelung | Bodenplatte Feld 3 | Platte zweimal modelliert — Menge doppelt |
| 21 | 1. Obergeschoss | Doppelung | Fenster 1.04-2 | Fenster zweimal modelliert |
| 22 | 1. Obergeschoss | Doppelung | Schreibtisch 1.10-2 | Moebel zweimal platziert |
| 23 | 2. Obergeschoss | Doppelung | Trennwand Sued 2.OG Achse 3/4 | Wand zweimal modelliert |
| 24 | 2. Obergeschoss | Doppelung | Heizung Vorlauf 2.OG Abschnitt 6 | Leitung zweimal modelliert |

Erwartete Zahlen (auch im Test festgehalten, `tests/unit/beispielmodell.test.js`):
{
  "hart": 12,
  "duplikate": 6,
  "idsFehler": 6,
  "befunde": 24,
  "jeGeschoss": {
    "Erdgeschoss": {
      "hart": 5,
      "duplikate": 2,
      "idsFehler": 2
    },
    "1. Obergeschoss": {
      "hart": 4,
      "duplikate": 2,
      "idsFehler": 2
    },
    "2. Obergeschoss": {
      "hart": 3,
      "duplikate": 2,
      "idsFehler": 2
    }
  },
  "bauteile": 523,
  "geschosse": 3,
  "raeume": 40,
  "koeder": 4
}

Alles andere ist bewusst kollisionsfrei: Bauteile berühren sich höchstens flächig (das zählt
die Prüfung nicht), Leitungen halten Abstand zu Wänden, Decken und Unterzügen. Geprüft mit
denselben Regeln wie die Prüf-Suite (TGA gegen Tragwerk, TGA gegen Architektur, Architektur
gegen Tragwerk) und derselben Paargrenze (500 000).

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
