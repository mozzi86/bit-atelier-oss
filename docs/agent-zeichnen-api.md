# Zeichen-API für den Gebäude-Entwurf

Die API legt Wände, Öffnungen, Decken und Räume an, ändert und löscht sie und kopiert ein Geschoss. Sie läuft nur, solange das Gebäudemodell im Komplex-Designer offen ist. Jeder Aufruf geht durch dieselben Setter wie ein Klick und damit durch die Zeichen-Historie (`bimHistorie.js`): Strg+Z nimmt ihn zurück, Strg+Y und Strg+Umschalt+Z holen ihn wieder.

Koordinaten sind Planmeter. x zeigt nach Osten, z nach Süden. Winkel in Grad: 0° entlang +x, 90° entlang +z. Längen, Dicken, Breiten, Höhen und Brüstungen sind Meter. Geschoss 0 ist das Erdgeschoss.

Ein Klick in den Grundriss rastet an vorhandenen Punkten ein. Alt schaltet das Einrasten für diesen Klick aus. Eine eingetippte Zahl wird nicht eingerastet.

## Zwei Zugänge, eine Wirkung

Im offenen Studio liegt die API unter `window.bitApi`. Dieselbe Wirkung hat das Befehlsregister (`window.__bitBefehle`) und damit der lokale Steuerungskanal `POST /api/steuerung` (Kopf `x-bit-steuerung`, Token in der Datendatei `steuerung.token`).

`bitApi`-Schreibaufrufe sind Promises. Sie lösen erst auf, wenn React den neuen Stand committed hat, und antworten `{ ok: true, element }` oder `{ ok: false, error }` mit einem deutschen Satz. `element` ist das neue oder geänderte Bauteil (`art`, `id`, `_idx` und die gespeicherten Felder). Das Feld `modell` kommt nicht mit. `zaehlen()` direkt nach einem `await` sieht die neuen Zahlen. Das Register antwortet weiterhin synchron `{ ok: true, result }` oder `{ ok: false, error }`.

```js
await bitApi.wandRichtung({ start: { x: 0, z: 0 }, laenge_m: 6, winkel_grad: 0, level: 0, thickness_m: 0.24, height_m: 2.8 });
await bitApi.oeffnung({ wandId: 1, kind: "window", versatz_m: 2, breite_m: 1.2, hoehe_m: 1.4, bruestung_m: 0.9 });
await bitApi.geschossKopieren({ von: 0, nach: 1 });
bitApi.zaehlen(0);
```

Register, dieselbe Wand:

```json
{"id":"1","method":"ausfuehren","params":{"befehl":"wand-richtung","params":{"start":{"x":0,"z":0},"laenge_m":6,"winkel_grad":0,"level":0,"thickness_m":0.24}}}
```

## Funktionen

### `abfragen(filter)` / Befehl `zeichnen-lesen`

Liest gezeichnete Bauteile. `filter.art` ist `wall`, `column`, `opening`, `zone`, `slab` oder `roof`. `filter.level` ist die Geschossnummer. `filter.id` ist die Elementnummer `_idx`. Ohne Filter kommen alle.

Klickweg: die Statuszeile „dieses Geschoss“ (`data-testid="bim-zaehler"`) und das Eigenschaftenfeld der Auswahl. Test: `Zähler gelten für das Geschoss, Geschoss kopieren, Öffnung, Decke, Raum, Löschen`.

### `zaehlen(level)` / Befehl `zeichnen-zaehlen`

Zählt Wände, Stützen, Fenster, Türen, Öffnungen, Räume, Decken und Dächer **dieses** Geschosses. Eine Öffnung zählt beim Geschoss ihrer Wand. `level` in Geschossnummern, 0 = Erdgeschoss. Die Antwort trägt `bereich: "geschoss"`.

`fenster`, `tueren` und `oeffnungen` sind getrennt. Eine Tür (`kind: "door"`) zählt nur unter `tueren`, nie unter `oeffnungen`. Eine leere Öffnung (`kind: "oeffnung"`) zählt nur unter `oeffnungen`. Fehlt `kind`, zählt das Bauteil als Fenster.

Klickweg: dieselbe Statuszeile, Attribut `data-waende` und die übrigen `data-*`. Test: derselbe wie oben.

### `wand(spec)` / Befehl `wand-anlegen`

Wand von `a` nach `b`. Beide Punkte `{x, z}` in Metern. `level` Geschossnummer. `thickness_m` Dicke einer einschaligen Wand in Metern (Vorgabe 0,30). `height_m` absolute Höhe in Metern; ohne Angabe folgt die Oberkante dem Geschoss, wie beim Klicken. `refLine` ist `center`, `outside` oder `inside`. `composite` ist die Kennung eines Aufbaus; ist sie gesetzt, gilt die Aufbau-Dicke und nicht `thickness_m` (dieselbe Regel wie im Prüfmodell).

Klickweg: Werkzeug Wand, Punkte im Grundriss klicken, Doppelklick beendet den Zug. Esc bricht nur die angefangene Wand ab, Esc noch einmal legt das Werkzeug ab.

### `wandRichtung(spec)` / Befehl `wand-richtung`

Wie `wand`, aber `start` `{x, z}` in Metern, `laenge_m` in Metern, `winkel_grad` in Grad.

Klickweg: Werkzeug Wand, Zeile „Wand setzen“ (`data-testid="wand-setzen"`), Felder Start, Länge, Winkel, Dicke, Höhe. Test: `Wand per Maß, Rückgängig und Wiederholen von einem Knopf aus, Esc nur die angefangene Wand`.

### `oeffnung(spec)` / Befehl `oeffnung-anlegen`

Tür, Fenster oder leere Öffnung auf einer **gezeichneten** Wand. `wandId` ist die `_idx` der Wand. `kind` ist `window`, `door` oder `oeffnung`. `versatz_m` ist der Abstand der Öffnungsmitte vom Wand Anfang in Metern (wird in die Wand geklemmt, halbe Breite plus 10 cm, wie ein Klick). `breite_m`, `hoehe_m`, `bruestung_m` in Metern; leer lässt das Typmaß (Fenster 1,00 × 1,40 m, Brüstung 0,90 m; Tür 1,00 × 2,10 m, Brüstung 0). `typeId` optional (`single` für das erste Fenster und die erste Tür).

Klickweg: Werkzeug Fenster, Tür oder Öffnung, Wand im Grundriss anklicken, oder die Zeile „Öffnung setzen“ (`oeffnung-setzen`) mit Wand, Abstand, Breite, Höhe, Brüstung. Die Zeile hängt am Werkzeug: Fenster setzt `window`, Tür setzt `door`, Öffnung setzt `oeffnung`. Danach dieselben Zahlen im Eigenschaftenfeld (`oeffnung-u`, `oeffnung-width`, `oeffnung-height`, `oeffnung-sill`). Ein Zahlenfeld schreibt erst bei Verlassen oder Enter, und klemmt auf sein Minimum und Maximum (Wanddicke 0,10 bis 0,60 m). Test: `Zähler gelten für das Geschoss …` und `Wand per Maß …`.

### `decke(spec)` / Befehl `decke-anlegen`

Decke. Entweder `points` mit mindestens drei `{x, z}` in Metern, oder ein Rechteck `x`, `z`, `breite_m` (entlang +x), `tiefe_m` (entlang +z). `level` Geschossnummer. `dicke_m` Dicke in Metern (Vorgabe des Studios 0,22, wenn das Feld fehlt).

Klickweg: Werkzeug Decke, Ecken klicken, Doppelklick schließt, oder „Decke setzen“ (`decke-setzen`). Test: derselbe Zähler-Test.

### `zone(spec)` / Befehl `zone-anlegen`

Raumpolygon, dieselben Lagen wie die Decke, plus `name`. Der Zauberstab (Klick in eine von Wänden umschlossene Fläche) bleibt der bestehende Weg und ist hier nicht erweitert.

Klickweg: Werkzeug Zone und „Raum setzen“ (`zone-setzen`), oder der Klick in eine umschlossene Fläche. Test: derselbe Zähler-Test.

### `aendern(spec)` / Befehl `element-aendern`

`spec` ist `{ art, id, patch }`. `art` wie bei `abfragen` ohne `roof` in der Änderungsliste: `wall`, `column`, `opening`, `zone`, `slab`. `id` ist `_idx`. `patch` darf nur die gespeicherten Felder nennen, in Metern: Wand `thickness`, `height`, `a`, `b`, `level`, `refLine`; Öffnung `u` (Abstand in Metern), `width`, `height`, `sill`; Decke `dicke_m`, `points`, `level`.

Klickweg: Element wählen, Zahl im Eigenschaftenfeld ändern (Wanddicke `wand-dicke-feld`, Öffnung `oeffnung-width`). Die Zahl wird beim Verlassen des Feldes oder mit Enter übernommen, einmal pro fertiger Eingabe, und auf Minimum und Maximum geklemmt. `36` im Feld „Dicke (m)“ wird 0,60 m. Test: die Wanddicke wird im Wand-Test gelesen und zurückgenommen; die Öffnungsbreite im Zähler-Test.

### `loeschen(spec)` / Befehl `element-loeschen`

`{ art, id }`. Eine Wand nimmt ihre Öffnungen mit.

Klickweg: Auswahl und „Auswahl löschen“ (`bim-loeschen`) oder die Entf-Taste. Test: derselbe Zähler-Test.

### `geschossKopieren({ von, nach })` / Befehl `geschoss-kopieren`

Kopiert gezeichnete Wände, ihre Türen und Fenster, Stützen, Räume und Decken von Geschoss `von` auf Geschoss `nach` (beide Geschossnummern). Hüllen-Öffnungen dieses Geschosses gehen auf dieselbe Kante des Ziels. Dächer bleiben. Die Geschosszahl ändert sich nicht; das Zielgeschoss muss schon existieren. Jede Kopie bekommt eine neue Nummer und keine GUID.

Klickweg: „Geschoss kopieren“ (`geschoss-kopieren-ausfuehren`), Listen „von Geschoss“ und „nach Geschoss“. Die Zeile und die Geschoss-Liste (`bim-geschoss`) stehen im Grundriss und in der 3D-Ansicht. Beide schreiben dasselbe `level`, das der Ansichtszustand (`zustandJetzt.level`) schon führt. Test: derselbe Zähler-Test.

### `geschosseSetzen(anzahl)` / Befehl `geschosse-setzen`

Anzahl der Geschosse über Gelände, 1 bis 12. Dasselbe wie die Liste „Geschosse“ (`bim-geschosse`). Gezeichnete Bauteile auf einem damit entfallenden Geschoss bleiben im Datensatz, die Ansicht zeigt sie nicht mehr.

Klickweg: Liste „Geschosse“. Test: derselbe Zähler-Test (drei Geschosse, die Geschossliste hat drei Einträge).

### `geschossHoehe(level, hoehe_m)` / Befehl `geschoss-hoehe`

Höhe eines Geschosses in Metern. `level` Geschossnummer, `hoehe_m` Meter. Dasselbe wie das Zahlenfeld der Geschosshöhen (`geschosshoehe-<level>`).

Klickweg: aufklappen „Geschosshöhen“, Feld des Geschosses.

### `grundriss()`

Ecken des Gebäudegrundrisses in Metern, `{x, z}`. Kein Schreibaufruf.

Klickweg: Griffe am Grundriss. Ein Doppelklick direkt nach dem Wählen einer Hüllwand löscht keine Ecke; erst ein späterer Doppelklick auf den schon sichtbaren Griff, und der Schritt liegt in der Historie. Test: `Doppelklick mit dem Pfeil lässt den Grundriss vollständig`.

### `rueckgaengig()` / `wiederholen()`

Befehle `zeichnen-rueckgaengig` und `zeichnen-wiederholen`. Dieselbe Historie wie die Knöpfe „Rückgängig“ und „Wiederholen“ (`bim-undo`, `bim-redo`). Strg+Z, Strg+Y und Strg+Umschalt+Z gelten, sobald der Fokus im Editor liegt: auf der Zeichenfläche, auf der Seite (`main`) oder auf einem Werkzeugknopf. In einem Textfeld, einer Auswahlliste oder einem Zahlenfeld gelten sie nicht. Esc auf einer angefangenen Wand bricht nur diese ab; Esc noch einmal legt das Werkzeug ab. Im Massing-Studio gilt dasselbe für den Polygon-Umriss und für die Körper des Modellierers (`ms-undo`, `mm-undo`).

Klickweg: die beiden Knöpfe, oder die Tasten, nachdem die Zeichenfläche (`bim-plan`) angeklickt wurde. Test: der Wand-Test und `Massing: Ecke per Zahl, Strg+Z stellt sie zurück`.

## Massing-Ecken

Die Ecken des Baukörpers stehen unter dem Plan als Meterwerte. Der Index ist nullbasiert: die erste Ecke ist `ms-ecke-x-0` und `ms-ecke-y-0`, die zweite `ms-ecke-x-1`. „Ecken übernehmen“ (`ms-ecken-uebernehmen`) schreibt sie und ist ein Schritt der Polygon-Historie. Site-Meter, auf den Zentimeter.

Klickweg: die Felder und der Knopf. Test: `Massing: Ecke per Zahl, Strg+Z stellt sie zurück`.

## Was diese Fassung nicht baut

Bemaßung, Ansicht, Text und Linie bleiben die spätere Welle. Der Schnitt zeigt, er bekommt keine eigene Schnittlinie. Die Adresssuche geokodiert nicht; das bräuchte einen externen Dienst und eine Entscheidung der Eigentümerin. Der Zauberstab der Zone bleibt der bestehende Klick in eine umschlossene Fläche.
