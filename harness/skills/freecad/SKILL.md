---
name: freecad
description: FreeCAD-BIM aus Beschreibung erzeugen, als IFC exportieren.
version: 0.1.0
mode: both
tools: [freecad_run, freecad_status, freecad_step, freecad_undo, freecad_reload]
platforms: []
---

# /freecad <unterbefehl> — Modell bauen mit FreeCAD

Baut aus Text ein BIM-Modell in FreeCAD und exportiert es als IFC4. Das IFC
läuft danach durch `/ifc` (Liste, Mengen, Prüfung) — FreeCAD ist der
Bauarbeiter, `/ifc` der Prüfer.

**Werkzeug:** `freecad_run(unterbefehl, eingabe?, datei?, name?)`.
FreeCAD läuft als eigener Prozess mit seinem eigenen Python (`freecadcmd`,
Timeout 120 s). Jedes Ergebnis ist eine **neue** Datei
`model/<name>_v<n>.ifc` (+ `.FCStd` zum Weiterarbeiten in der FreeCAD-GUI) —
nichts wird überschrieben.

**Voraussetzung:** FreeCAD 1.1. Gesucht wird in dieser Reihenfolge:
Umgebungsvariable `BIT_FREECAD` (Programm oder Installationsordner),
`freecad.cmd` in `config.yaml`, Standardpfad
`C:\Program Files\FreeCAD 1.1\bin\freecadcmd.exe`. Fehlt FreeCAD, antwortet
das Werkzeug mit genau diesem Hinweis; `/freecad plan` geht trotzdem.

## Unterbefehle

| Befehl | Was er tut | Eingabe |
|---|---|---|
| `/freecad plan` | Massenmodell **nur rechnen**: Baufeld (größtes achsparalleles Rechteck mit Grenzabstand), Geschosse, Satteldach, BGF, Bruttorauminhalt, GRZ/GFZ — ohne FreeCAD | `grundstueck`, `raumprogramm`, optional `geschosshoehe_m`, `abstand_m`, `dach` |
| `/freecad massing` | wie `plan`, dann Baukörper je Geschoss + Dachkörper in FreeCAD → IFC (`IfcBuildingStorey` + `IfcBuildingElementProxy` mit `NetVolume`) | wie `plan` |
| `/freecad bauteile` | Wände, Decken, Fenster, Türen, Dach aus einer Beschreibung → IFC (`IfcWall`/`IfcSlab`/`IfcWindow`/`IfcDoor`/`IfcRoof` mit Qto-Mengen) | Beschreibung, Format: `references/beispiel-efh.json` |
| `/freecad export` | gespeichertes FreeCAD-Modell (`.FCStd`) → IFC | `datei=model/x.FCStd` |

`--headless` ist der Normalfall dieser vier Befehle (kein offenes
FreeCAD-Fenster nötig).

## Eingaben

**plan / massing** — Längen in m, Flächen in m²:

```json
{"grundstueck": [[0,0],[20,0],[20,15],[0,15]],
 "raumprogramm": [{"name": "Wohnen", "flaeche_m2": 60}, {"name": "Bad", "flaeche_m2": 8, "geschoss": 1}],
 "geschosshoehe_m": 3.0, "abstand_m": 3.0, "dach": {"form": "satteldach", "neigung_grad": 40}}
```

Fehlende Werte werden mit **[ASSUMED]**-Vorgaben gefüllt (3,0 m Geschoss,
3,0 m Grenzabstand, 40° Dach, 15 % Verkehrsfläche) und in `annahmen`
genannt — diese Annahmen dem Nutzer immer sagen.

**bauteile** — Wandzüge sind **Achsen** (Mittellinien), je Segment entsteht
eine Wand `Wand <Geschoss> <nn>`; Öffnungen verweisen auf diesen Namen
(oder die laufende Nummer) und messen `abstand_m` vom Segmentanfang.
`decke` liegt unter dem Geschoss (EG = Bodenplatte), das Dach sitzt auf dem
obersten Geschoss. Satteldach und Decken brauchen einen geschlossenen,
achsparallelen rechteckigen Außenwandzug.

## Hybrid: am offenen FreeCAD-Dokument arbeiten (Bridge)

Hat der Nutzer in FreeCAD das Makro `macros/harness_bridge.FCMacro` gestartet,
arbeitet der Harness am **selben** Dokument wie er:

| Befehl / Werkzeug | Was er tut |
|---|---|
| `/freecad bridge status` → `freecad_status` | erreichbar? FreeCAD-Version, aktives Dokument |
| `freecad_step(name, beschreibung)` | ein **benannter** Schritt = eine FreeCAD-Transaktion; Bauteile im Format von `bauteile` |
| `freecad_step(name, code)` | nur **developer**-Modus: freies Python, `doc` = aktives Dokument |
| `freecad_undo` | letzten Schritt zurück (wie Strg+Z in FreeCAD) |
| `freecad_reload(export?)` | aktuellen Stand lesen — auch Handkorrekturen; `export: true` → neues IFC |

Schrittnamen kurz und fachlich („Wand Nord", „Fenster Küche"): sie stehen in
FreeCAD unter Bearbeiten → Rückgängig. Nach einer Handkorrektur des Nutzers
immer erst `freecad_reload`, dann weiterbauen. Ist die Bridge nicht
erreichbar, sagt das Werkzeug, wie man das Makro startet — dann den
Headless-Weg (`massing`/`bauteile`) anbieten.

## Regeln für das Modell (Antwort)

1. Kennzahlen nur aus dem Ergebnis zitieren (`kennzahlen`, `zaehlung`,
   Gegenprobe `/ifc liste`), nie schätzen.
2. Den neuen Dateinamen nennen (`model/<name>_v<n>.ifc`) und auf
   `/ifc mengen` bzw. `/ifc check` als nächsten Schritt hinweisen.
3. Kein freies Python an FreeCAD schicken — Bauteile entstehen aus der
   Beschreibung (T-67-12). Ausnahmen nur im developer-Modus über die
   GUI-Bridge.
4. Iteratives Verfeinern per Sprache mit Rückfragen („mach das Bad größer")
   ist **nicht** Teil dieses Skills — das ist Forschung für Phase 68.
