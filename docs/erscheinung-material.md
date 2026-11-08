# Erscheinung im Gebäudemodell

Die Farben und Beläge kommen aus dem Bauteilkatalog des Harness
(`harness/harness/bauteilkatalog/daten/`). Die App liest diese Dateien.
Sie führt keine zweite Liste. `MATERIAL_KATALOG` in
`packages/nova-core/src/lib/bauteil/materialien.js` bleibt die Quelle für
Bauphysik und Schichtaufbau.

## Felder

Fehlt ein Feld, bleibt das bisherige Bild: petrolfarbene Wand, dunkler Rahmen,
helles Glas, blaue Raummarkierung, beim Render das Fassaden-Preset.

- Wand, gezeichnet: `erscheinung` ist ein Baustoff-Schlüssel. Er liegt auf dem
  Wanddatensatz und ist ein Schritt der Zeichen-Historie.
- Hülle: `huelle_erscheinung` auf dem Gebäudemodell. Eine gesetzte Oberfläche
  ersetzt das Render-Preset und, bei einem Aufbau, die äußere Schicht (Band 0).
  Die übrigen Schichten behalten den Aufbau. Ohne sie gilt das Preset weiter.
- Öffnung: `rahmen` und `glas`, je ein Baustoff-Schlüssel, unabhängig voneinander.
- Zone: `belag` ist ein Fußboden-Typ (`estrich-parkett-15-cm`,
  `estrich-fliesen-15-cm` und die weiteren Beläge im Typenkatalog).

Eine Statusfarbe (Bestand, Neubau, Abbruch) färbt nur Bauteile ohne gesetzte
Oberfläche. Die blaue Füllung im Grundriss ist die Raummarkierung, kein Belag.

## Struktur von Parkett und Fliese

`parkett-350` verweist im Katalog auf `ambientcg:Wood051`, die Fliesen auf
`ambientcg:Tiles074`. Die beiden Farbkarten liegen unter
`public/erscheinung/` mit Herkunft und Lizenz in `public/erscheinung/HERKUNFT.md`
(CC0, an der Quelle geprüft). Der Pfad hängt an Vites `BASE_URL` (`/` im
Wurzel-Build, `/app/` bei `build:lokal`). Der Zonenboden trägt die Karte in
Metern: eine Wiederholung ist 0,80 m (Holz) bzw. 2,10 m (Fliese). Andere
Textur-Verweise im Katalog haben hier keine Datei und bleiben eine flache
Katalogfarbe.
