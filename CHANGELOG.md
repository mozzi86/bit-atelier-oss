# Änderungsliste

Alle nennenswerten Änderungen an BIT-Atelier stehen in dieser Datei.
Das Format folgt [Keep a Changelog](https://keepachangelog.com/de/1.1.0/), die Versionsnummern
folgen [Semantic Versioning](https://semver.org/lang/de/).

Der Release-Lauf übernimmt den Abschnitt der getaggten Fassung wörtlich als Release-Notiz, und
der Update-Hinweis der installierten App zeigt dieselben Zeilen. Neue Einträge kommen deshalb
zuerst unter **Unveröffentlicht** und wandern beim nächsten Release unter die neue Nummer.

## [Unveröffentlicht]

## [1.9.2] - 2026-10-22

### Behoben

- **Große IFC-Modelle in der Prüf-Suite:** Beim Laden eines großen Modells stockte die Seite kurz (bis ~0,1 s am Stück), weil das Ergebnis in einem Stück übergeben und die ganze Seite bei jeder Fortschrittsmeldung neu aufgebaut wurde. Das Ergebnis kommt jetzt in Paketen, die Fortschrittszeile aktualisiert sich allein, und die Ergebnisansicht baut sich stückweise auf — die Seite bleibt bedienbar.
- **Cloud-Anmeldung:** Die Anmeldeseite der Cloud-Fassung zeigte „Rechte konnten nicht geladen werden: Anmeldung abgelaufen“, weil die Büro-Rechte schon vor der Anmeldung abgefragt wurden. Sie werden jetzt erst nach der Anmeldung geladen; externe Rollen (Bieter, Bauherr …) fragen sie gar nicht mehr ab.

## [1.9.1] - 2026-10-22

### Neu

- **Büro-Katalog-Update:** Kataloge aus älteren Installationen führen Abbruch noch unter LB 040 (das ist Wärmeversorgung) und ohne KG 212 — der Katalog-Editor zeigt das und bringt den Katalog nach Bestätigung auf LB 084 / KG 212; nichts wird still überschrieben.
- **Honorarnachtrag im Entwurf:** Der Vertrag sagt jetzt, wenn ein Nachtrag zur Kostenänderung nur als Entwurf vorliegt und noch nicht beim Bauherrn ist (vorher schwieg der Hinweis zur Kostenänderung dann ganz).

### Geändert

- **Farben für Farbsehschwache:** Die Leitungsfarben der Haustechnik (Heizung, Lüftung, Trinkwasser, Abwasser, Elektro) sind neu gewählt, sodass sie auch bei Rot-Grün- und Blau-Gelb-Schwäche unterscheidbar bleiben; an jeder Leitung und in der Legende steht zusätzlich das Kürzel (HZ, LÜ, TW, AW, EL). Die Ampelfarben der Oberfläche (Warnung, Fehler, Erfolg, Hinweis) sind im hellen und dunklen Modus so angepasst, dass keine zwei verwechselbar sind.

### Behoben

- **Erdmassen und Standard-Planum** in „Gelände 3D“ tasten das Gelände jetzt an der echten Lage des Baufelds ab und nicht mehr Nord-Süd gespiegelt am Projektstandort — am Hang konnten Abtrag und Auftrag vorher vertauscht sein.
- **IFC-Import liest die Projekteinheiten:** Mengen und Schichtdicken aus Modellen in Millimetern (oder anderen Einheiten) werden in m, m² und m³ umgerechnet; vorher waren sie 1000-fach (Längen) bzw. millionenfach (Flächen) zu groß. Eine Meldung nennt die Einheit der Datei.
- Kann ein Modul nicht geladen werden (z. B. direkt nach einem Update), lädt die Seite einmal selbst neu, statt sofort die Fehlerkarte zu zeigen.
- Hilfetexte nennen die heutigen Reiter („Standort & Karte“, „Baufeld-Planung“, „Gebäude & Nutzung“).
- **IFC-Import liest die Georeferenz** (Kartenprojektion oder Grundstückskoordinaten) und rechnet UTM-Werte in Grad um; fehlt sie, sagt der Import das.
- **Haustechnik aus IFC** (Kanäle, Kabel, Heizkörper, Sanitärobjekte, Rohre) zählt jetzt zur Kostengruppe 400 und zum Gewerk TGA statt zu KG 390 / Rohbau.
- **Rückgängig nach Projektwechsel:** Wer oben das Projekt wechselt, bekommt einen leeren Verlauf — vorher holte Strg+Z den Stand des vorigen Projekts zurück und das automatische Speichern legte ihn im neuen ab (Massing-Studio, Umriss, Baufeld-Planung).
- **Plan als PDF/DXF druckt, was zu sehen ist:** ausgeblendete Ebenen werden nicht mehr mitgedruckt, Wände aus der Wohnungs-Werkstatt (mit Status) sind im Plan enthalten.
- **PDF-Studio:** Das Textfeld bleibt nach dem Klick auf die Seite offen (vorher verschwand es sofort).
- **Gelände 3D:** Riegel und Blockränder stehen auf dem Gelände und zählen bei „Was überflutet zuerst“; die Erdmassen-Angaben sind übersetzt; das Exposé-Bild nennt in einer Fußzeile Datenquelle, Überhöhung und Maßstab.
- Der Update-Hinweis verlinkt nur noch auf Release-Seiten bei GitHub; eine Projektdatei, die beim Öffnen ausgetauscht wird, wird abgewiesen.
- **Eingaben ohne Wirkung behoben:** Schneelast und Schneelastzone gehen in die Tragwerks-Vorbemessung ein, Ladepunkte in den Elektro-Anschlusswert, die Feuerwehr-Zufahrt in die Prüfung der Außenanlagen; die Haustechnik zeigt den Schmutzwasserabfluss aus den Sanitärobjekten. Die Windzone ist als „informativ“ gekennzeichnet.
- **Dunkelmodus:** farbige Hinweis- und Statusflächen, Kennzeichen und Diagrammachsen sind im dunklen Modus dunkel und gut lesbar (vorher helle Pastellflächen bzw. zu schwache Achsenschrift).
- Die Erdbeben-Simulation schließt mit Escape und hält den Fokus; der DÖE-Import nimmt nur gültige Jahreszahlen an; 3D-Ansichten geben ihren Grafikspeicher vollständig frei.

## [1.9.0] - 2026-10-21

### Neu

- **PDF-Studio: „Im PDF speichern“:** Pins, Freihand und Texte werden als echte PDF-Anmerkungen in die Datei geschrieben — die Originaldatei bleibt Byte für Byte erhalten, die Änderung wird hinten angehängt (inkrementelle Aktualisierung). Jedes weitere Speichern hängt erneut an; der Knopf zeigt, wie viele Änderungen noch nicht im PDF sind. Daneben „PDF herunterladen“ für die gespeicherte Datei. Festgeschriebene Dokumente (versendete Schreiben, Honorarangebote, Auftragsbestätigungen mit Prüfsumme) bleiben unangetastet: Anmerkungen darauf sind möglich und lassen sich annotiert exportieren, „Im PDF speichern“ ist dort gesperrt und ein Hinweis erklärt warum.
- **PDF-Studio: Wiederherstellen nach Absturz:** ein begonnener Kommentar und Anmerkungen, die der Server nicht angenommen hat, werden im Browser gesichert. Beim nächsten Öffnen derselben Datei bietet das Studio „Wiederherstellen“ oder „Verwerfen“ an.
- **Gelände 3D zeigt das Grundstück von oben:** Die Kamera kreist schräg von Süden über dem Gelände und kommt nie mehr darunter; Grundstücksumriss und Baukörper stehen auf dem Gelände, dazu Nordpfeil, Maßstabsleiste, Höhenkoten (tiefster/höchster Punkt, Grundstücksmitte) und die Datenquelle. Ein Demo-Gelände ohne Höhendaten ist deutlich als „erfundene Höhen“ markiert.
- **Überhöhung als Schieber** 1× (echt) bis 10× mit Anzeige „Überhöhung 3×“; der Startwert richtet sich nach dem Relief, die eigene Einstellung gilt. Ausschnitt 300 m oder 1 km umschaltbar.
- **Wasserpegel-Studie** in „Gelände 3D“: Pegel in m ü. NHN per Schieber oder Zahl, halbtransparente Wasserfläche mit markierten überfluteten Bereichen, überflutete Grundstücksfläche in m² und %, Reihenfolge „Was überflutet zuerst“ (Grundstück, Baukörper, EG-Fußboden) mit Wassertiefe. Badewannen-Modell, kein Hochwassernachweis.
- **Bemessungswasserstände (HQ)** im Reiter „Hochwasser“ eintragen (Bezeichnung, Wasserstand, Quelle) — sie erscheinen als Marken am Pegel-Schieber.
- **Lageplan als DXF:** Knopf „DXF“ in der Baufeld-Planung (auch im Rechtsklick-Menü) speichert Grundstück, Flurstücke, Baufelder, Baukörper und Riegel als DXF R12 in Metern — der Ursprung ist der Projektstandort, jede CAD-Software öffnet die Datei.
- **Grundriss als DXF:** „Aktuellen Plan als DXF“ im BIM-Studio (Mappe › Pläne / Output) — Wände, Stützen, Decken, Dächer und Raumtexte je auf eigener Ebene, geschnittene Wände gefüllt.
- **Flurstücke aus DXF:** der Flurstück-Import liest jetzt auch DXF-Dateien (z. B. ALKIS-Auszug in ETRS89/UTM). Die passende Ebene wird vorgeschlagen und lässt sich umstellen; Flurstücksnummern werden aus den Texten übernommen.
- **Mehrere Flurstücke werden eine Grundstücksgrenze:** benachbarte Flurstücke werden zu einem Grundstück vereinigt, das sofort als gezeichnet gilt und bearbeitbar ist. Liegen Lücken oder Überschneidungen vor, sagt die App das, statt eine Grenze zu erfinden. „Als Grundstück übernehmen“ ersetzt auf Wunsch auch ein bereits gezeichnetes Grundstück.
- **Objektfang wie im CAD** im Massing-Studio und in der Baufeld-Planung (Karte und Plan ohne Karte): Punkte rasten auf Endpunkt, Mitte, Schnittpunkt und Lot ein, auf Wunsch auch auf den nächsten Punkt einer Kante; ein Symbol am Mauszeiger zeigt, was gefangen wird (Quadrat = Endpunkt, Dreieck = Mitte, X = Schnittpunkt, ⊥ = Lot). Polarfang zeigt eine Spurlinie mit Winkel (Standard 90°, z. B. „polar 15“), Ortho zwingt auf die Achsen, das Raster (Standard 0,25 m) lässt sich mit „raster 0,5“ ändern. Alt gedrückt = ohne Fang.
- **Fang schalten:** F3 Objektfang, F8 Ortho, F9 Raster, F10 Polar, die Schalter FANG · ORTHO · POLAR · RASTER rechts in der Befehlszeile, die Gruppe „Fang“ im Rechtsklick-Menü (mit Häkchen) oder getippt: „fang“, „ortho“, „polar 45“, „raster 1m“. Einmal-Fang für den nächsten Klick über das Eingabefeld: „end“, „mit“, „sch“, „lot“, „nae“ (Esc oder ein Werkzeugwechsel heben ihn wieder auf). Die Einstellung gilt für beide Zeichenflächen und bleibt im Browser gespeichert.
- In der Baufeld-Planung fangen auch die Ecken von Grundstück, Baufeldern und Riegeln beim Ziehen.
- **Wohnungen als feste Objekte:** Werkplanung → „Wohnungen & Sonderwünsche“ übernimmt die Wohnungen aus der Wohnungs-Werkstatt oder den Riegeln mit festen Nummern (W-001 …). Bei einem neuen Zuschnitt gleicht „Mit dem Modell abgleichen“ ab statt neu zu nummerieren: geänderte Fläche, Typ oder Zimmerzahl wird gemeldet (Warnung bei verkauften/reservierten Wohnungen oder solchen mit Sonderwünschen), entfallene Wohnungen werden markiert, nie gelöscht. Wird eine Wohnung geteilt, behält die größere Hälfte die Nummer. Je Wohnung Verkaufsstand, Käufer und Bauabschnitt. Ein Doppelklick auf „Abgleich übernehmen“ oder „Speichern“ legt keine Nummer doppelt an.
- **Sonderwünsche je Wohnung mit Freigabekette:** Ausstattungskatalog je Projekt (Standard und Optionen je Gewerk mit Mehr-/Minderpreis). Ein Wunsch läuft angefragt → geprüft → angeboten → freigegeben/abgelehnt → eingearbeitet → abgenommen; welche technische Prüfung nötig ist, richtet sich nach dem Eingriff (Ausstattung: Bauleitung; Grundriss/Installation: + Architektur; Wand, Decke, Durchbruch, Last: + Tragwerksplanung), Stichworte wie „Durchbruch“, „Wand … entfernen“, „Fenster vergrößern“ oder „Steckdose“ heben die Stufe an; ein freier Wunsch ohne Einstufung bekommt mindestens die Architektur. Preise dürfen mit Tausenderpunkt eingegeben werden („1.250“ = 1 250 €). Ein freigegebener Wunsch mit Produkt/Farbe wird als freigegebenes Muster der Wohnung gespeichert; Bemusterungsprotokoll je Wohnung als PDF. Liste und Protokoll im Reiter Bemusterung zeigen weiter nur die Projektmuster – Käufermuster und Käufernamen erscheinen dort nicht.
- **Entscheidungsfrist aus dem Bauablauf:** spätester Freigabetermin je Wohnung und Gewerk = Beginn des Gewerks im Bauabschnitt minus 4 Wochen; Ampel im Wohnungsplan, in der Wunschliste und in einer Übersicht Wohnung × Gewerk. Wird ein Vorgang verschoben, wandert die Frist mit („verschoben um 14 Tage“); eine Freigabe nach Fristablauf wird als Nachtrag mit Rückbau-/Terminrisiko markiert.

### Geändert

- PDF-Studio: Kommt eine neue Anmerkung oder ein Löschen nicht beim Server an, geht es nicht mehr verloren, sondern bleibt im Browser gesichert (Hinweis über der Werkzeugleiste) und wird beim Speichern oder Wiederherstellen nachgetragen.
- **Projektdateien nur noch von lokalen Laufwerken:** Doppelklick auf eine `.bitproj` im Netzwerk (`\\Server\Freigabe`), eine `file:`-Adresse mit Rechnernamen oder ein Gerätepfad wird mit einem Klartext-Grund abgewiesen („bitte die Datei auf ein lokales Laufwerk kopieren“) — Windows schickt sonst schon beim Nachsehen die Anmeldedaten an den fremden Rechner. Gilt auch für „Zurück in die Datei speichern“ und die Desktop-App.
- Sicherungsordner, Datenordner und Ablageort der Desktop-App dürfen weiter auf einer Netzfreigabe (NAS) liegen; Gerätenamen wie `NUL` oder Pfade wie `\\?\…` werden dort abgewiesen.
- Importierte Flurstücke werden auf etwa einen Zentimeter genau übernommen (vorher bis zu 60 cm Rundung) und im Maßstab des aktuellen Lageplans abgelegt.
- Eine beschädigte oder nur teilweise lesbare DXF-Datei wird beim Flurstück-Import mit der Zeile gemeldet, ab der nichts mehr gelesen wurde; die Grundstücksgrenze erscheint dann als Warnung („kann zu klein sein“) statt als Erfolg. Sehr große Dateien mit vielen Eckpunkten brechen nicht mehr mit einem technischen Fehler ab, sondern melden das Flurstück-Limit im Klartext.
- Baufeld-Ecken werden auf 1/100 Planeinheit genau gespeichert statt auf ganze Einheiten gerundet — eine eingerastete Ecke bleibt genau auf ihrem Ziel.

### Behoben

- **Dokumente öffnen sicher:** Berichte › Dokumente, die Beleg-Vorschau der Buchhaltung, der Download im Schriftverkehr und die Befundfotos zeigen nur eingebettete Dateien (PDF, Bild, bei Belegen XML). Ein Eintrag, der stattdessen einen Verweis oder ein Skript enthält, wird nicht ausgeführt; das Fenster nennt den Grund.
- **Andere Dateitypen bleiben erreichbar:** Gespeicherte Dokumente, die der Browser aus Sicherheitsgründen nicht anzeigt (z. B. SVG-Zeichnungen, TIFF-Scans), bietet Berichte › Dokumente zum Herunterladen an, statt nur den Grund zu nennen.
- Die Desktop-App fragt auch beim Lesen einer per Doppelklick geöffneten Datei kein Netzlaufwerk mehr an, bevor der Pfad geprüft ist.
- Gelände 3D war von unten zu sehen und Nord-Süd gespiegelt; die Begehung startet jetzt wirklich am Südrand.
- Die Fußzeile „Höhe 5× überhöht“ stimmte nicht — die automatische Streckung ist entfallen, die angezeigte Überhöhung ist die echte.
- Die Reiter der Werkplanung sind wieder gut lesbar (Kontrast der nicht gewählten Reiter).

## [1.8.0] - 2026-10-19

### Neu

- **Baukörper aufziehen:** In der Baufeld-Planung spannt Ziehen einen Baukörper in eigener Größe auf (Vorschau mit Maßen in m); ein einfacher Klick setzt weiter die Standardgröße. Beschriftung „3 Geschosse / 900 m² BGF“ statt „3G“.
- **Riegel und Blockrand:** neues Werkzeug „Riegel“ — Pfad klicken, Enter oder Doppelklick ergibt einen Wohnriegel, Klick auf den Startpunkt einen Blockrand mit Hof; Wohnungsmix farbig, Eckpunkte nachträglich ziehbar, Geschosse/Erschließung/Mix in der Liste; Grundfläche und BGF zählen in GRZ/GFZ.
- **Grundstück zeichnen:** „Grundstück zeichnen“ und die Ecken entlang der amtlichen Flurstücksgrenze klicken — danach gilt das Grundstück als gezeichnet und lässt sich bearbeiten.
- **CAD-Koordinaten im Massing-Studio:** `#x;y` absolut, `@dx;dy` relativ, `@abstand<winkel` polar (Norden oben), eine Länge allein gilt in Zeigerrichtung.
- **Befehle tippen:** ohne laufenden Befehl gehen Buchstaben in die Befehlszeile — „l“ = Linie, „pp“ = Push/Pull, Anfänge werden ergänzt, Vorschlagsliste; Enter wiederholt den letzten Befehl.
- **Drohnenscans als Gaussian Splats** in „Gelände 3D“: `.ply` (3D Gaussian Splatting) oder `.splat` laden oder das Beispiel ansehen, Maßstab/Drehung/Höhe einstellen; eigener Renderer, keine zusätzliche Bibliothek.
- **KI-Agenten steuern die Zeichenfläche:** ein lokaler Agent (z. B. über den MCP-Server: `zeichenflaeche_befehle`, `zeichenflaeche_ausfuehren`) kann die Befehle des geöffneten Massing-Studios ausführen — nur auf diesem Rechner, mit Token aus dem Datenordner.

### Geändert

- **Karte wie ein CAD-Plan:** Links-Ziehen verschiebt die Karte nicht mehr (es zeichnet, setzt oder wählt); verschoben wird mit gedrücktem Mausrad oder Leertaste + Ziehen.
- Ein nur geschätztes Grundstück wird nicht mehr als grünes Quadrat gezeichnet und begrenzt nichts; seine Fläche bleibt als „geschätzt“ für die Kennzahlen.
- Die Werkzeugleiste des Lageplans bricht um statt Knöpfe abzuschneiden.

### Behoben

- Im Lageplan ohne Karte brach das Verschieben eines Blocks nach einer Rahmenauswahl nach wenigen Pixeln ab.
- Ein früher Rechtsklick auf die Karte zeigte kein Menü, solange die Karte noch lud.
- Speichern übersteht kurze Dateisperren (Cloud-Synchronisierung, Virenscanner) — vorher konnte eine halbe Zwischendatei liegen bleiben.

## [1.7.2] - 2026-10-18

### Neu

- **Amtliche Flurstücke als Kartenebene (Bayern):** In der Baufeld-Planung liegen die Flurstücksgrenzen der Bayerischen Vermessungsverwaltung unter dem Plan (frei nutzbar, CC BY 4.0, Quelle in der Karte); bei einem Standort in Bayern automatisch an, per Schalter abschaltbar.
- **Grundstücksgrenze bearbeiten:** Die Ecken des Grundstücks lassen sich ziehen — auf die amtlichen Grenzen gezogen gilt das Grundstück als gezeichnet, Fläche und GRZ/GFZ rechnen neu.
- **Befehlszeile** unter dem Plan (Massing-Studio, Baufeld-Planung): welcher Befehl läuft, was als Nächstes erwartet wird, Eingabefeld für Maße.
- **Eigenes Rechtsklick-Menü** auf Plänen und Karte: Befehl beenden, letzten Befehl wiederholen, Rückgängig/Wiederholen, Auswahl aufheben, Löschen, Alles einpassen.

### Geändert

- **Zeichenseiten wie ein Programmfenster:** Standort & Karte, Baufeld-Planung, Massing-Studio und Gebäudemodell füllen das Fenster, die Seite scrollt nicht mehr — nur die Spalten in sich (ab 760 px Fensterhöhe).
- **Standort & Karte:** schmales Formular, die Karte nimmt den Rest der Breite und die volle Höhe.

### Behoben

- Die gestrichelte Grundstückslinie im Massing-Studio hieß „Baufeld“; sie heißt jetzt Grundstücksgrenze bzw. trägt die Flurstücksnummern.
- Im Lageplan ohne Karte lag der untere Teil der Zeichenfläche außerhalb des sichtbaren Bereichs.

## [1.7.1] - 2026-10-18

### Geändert

- **Mehr Platz zum Arbeiten:** Seiten nutzen auf breiten Bildschirmen die Breite (bis 1.920 px, Zeichenseiten ganz), die Seitentitel sind kompakter.
- **Komplex-Designer aufgeräumt:** eine schmale Kopfzeile mit Phase 1–5, den Schritten der Phase und „Entwurf speichern“ statt Titelblock und mehrfach geschachtelter Kästen; die Baufeld-Planung zeigt die Karte in Fensterhöhe, Kennzahlen und Prüfung stehen in einer schmalen Spalte, Konflikte sind zusammengefasst.
- **3D wie in CAD-Programmen:** die linke Maustaste gehört den Werkzeugen (Körper anklicken, Push/Pull ziehen); Mausrad gedrückt verschiebt, Umschalt + Mausrad gedrückt dreht.
- Die erzeugten Demo-Höhenpunkte auf der Karte sind ausgeblendet (per Schalter einblendbar); „Erste Schritte“ im Massing-Studio startet eingeklappt.

### Neu

- **Alles einpassen:** zwei- oder dreimal auf das Mausrad klicken zeigt den ganzen Plan bzw. das Grundstück — in allen 2D-Plänen, auf der Karte und in 3D.

### Behoben

- Rechtsklick auf Plänen, Karte und 3D öffnete das Browser-Menü („Bild speichern unter …“).
- Der Hinweis bei den Flurstücken sagte noch „erst mit ‚Entwurf speichern‘ dauerhaft“, obwohl automatisch gespeichert wird.

## [1.7.0] - 2026-10-17

### Neu

- **Massing-Studio als Modellierer (wie SketchUp):** Linie zeichnen schließt zur Fläche (mit Vorschlag im Goldenen Schnitt), Push/Pull, Folge mir, Verschieben, Drehen, Skalieren und Aufstocken. Strg beim Verschieben = Kopie; danach `*3` tippt drei Kopien im selben Abstand, `/3` teilt die Strecke in drei. Maße lassen sich während des Zeichnens eintippen, Ecken rasten mit grüner Markierung ein. Eine Karte „Erste Schritte“ führt durch die Werkzeuge.
- **Gruppen mit Nummern:** Körper lassen sich zu Gruppen zusammenfassen. Alle Körper derselben Gruppennummer ändern sich gemeinsam; „Eindeutig“ löst einen Körper aus seiner Gruppe.
- **Parametrik mit Knoten** (ähnlich Grasshopper): Bausteine wie Zahl, Reihe, Rechteck und Extrusion werden verbunden, das Ergebnis erscheint im Modell.
- **Gelände-Sandbox:** Gelände anheben, absenken und glätten, mit Erdmengen (Abtrag/Auftrag).
- **Wohnriegel entlang eines Pfads:** Pfad zeichnen ergibt einen Mittelflur- oder einhüftigen Riegel mit farbigem Wohnungsmix (1- bis 4-Zimmer, Eckwohnungen), gestapelt nach Geschossen, mit Kennzahlen.
- **Push/Pull direkt im 3D** durch Ziehen am Körper; Massing-Körper und Gruppen gehen in den IFC-Export.
- **Baufeld-Planung mit CAD-Bedienung:** neuer Modus „Auswahl“ — Klick, Umschalt+Klick, Rahmen nach rechts (ganz drin) oder links (berührt); Ziehen verschiebt (Strg = Kopie, Alt = ohne Fang), oranger Griff dreht in 15°-Schritten, Pfeiltasten 0,1 m (Umschalt 1 m), Entf löscht, Strg+A/C/V, Rückgängig/Wiederholen mit Strg+Z/Y. Fang an Grundstücksgrenze, Baufeld, anderen Blöcken und an der Abstandstiefe.
- **Prüfung nach jeder Bewegung:** GRZ und GFZ über alle Blöcke; gemeldet werden Blöcke außerhalb des Grundstücks, Überlappungen, Abstandsflächen über der Grenze und Abstandsflächen, die sich treffen (Studie, kein Nachweis).

### Geändert

- **Komplex-Entwurf speichert automatisch** etwa 1,5 Sekunden nach einer Änderung, sobald Name und Standort gesetzt sind — „Entwurf speichern“ ist nicht mehr nötig.
- **Zoom:** Pläne lassen sich unter 100 % verkleinern; Leertaste + Ziehen verschiebt die Ansicht (wie in den gängigen Zeichenprogrammen).
- Massing-Studio und Baufeld-Planung rechnen die Abstandsflächen mit derselben Funktion.

### Behoben

- **Gezeichnete Parzelle verschwand** beim Wechsel zwischen den Reitern; sie bleibt jetzt erhalten.
- **Geschätzte Parzelle war auf der Karte etwa 18-mal zu groß** dargestellt; sie erscheint jetzt im richtigen Maßstab, ebenso die Geschoss-Beschriftung der Baukörper.
- **3D-Umschalter im Massing-Studio** war bei schmalem Fenster nicht anklickbar.
- Das Massing-Studio schrieb beim bloßen Öffnen das Modell zurück in die Datenbank; es speichert jetzt nur echte Änderungen.

## [1.6.0] - 2026-10-17

### Neu

- **Bauteil-Steckbrief für alle Bauteile:** Jedes Bauteil im Gebäudemodell zeigt IFC-Klasse, Bauteiltyp, Kostengruppe (DIN 276), Gewerk (STLB-Bau-Leistungsbereich mit Stelle im Bauablauf), Material und Schichtaufbau, Menge, Bauabschnitt und eine stabile GUID — auch Haustechnik, Tragwerk, Durchbrüche und Brandschotts. Werte, die nur aus dem Bauteiltyp abgeleitet sind, tragen einen orangen Punkt („bitte bestätigen“).
- **Brillen:** Ein Modell, mehrere Sichten — Eingabe, Bestand, Abbruchplan, Bauantrag (auch schwarz-weiß), Ausführung 1:50 (Materialschraffuren), Ausschreibung, Bauleitung. Bestand grau, Neubau rot, Abbruch gelb nach den Bauvorlagenverordnungen; Bauteile ohne Status werden nie ausgeblendet und nie als Neubau gezählt.
- **Prüfregeln gegen Fehlplanung:** Hinweise im Gebäudemodell und in der AVA, z. B. Fenster in einer Wand, die abgebrochen wird; Abbruch tragender Bauteile ohne Statik-Vermerk; Durchbruch durch eine Brandwand ohne Brandschott oder mit schwächerem Schott; Leitung kreuzt eine Wand ohne geplanten Durchbruch; LV-Position mischt Abbruch mit Neubau.
- **Brandschott** als eigenes Bauteil am Durchbruch (Feuerwiderstand, System, Zulassung abZ/aBG/ETA mit Nummer, Hersteller, Kennzeichnung).
- **Status je Schicht** (z. B. Bestandswand mit neuer Dämmung), Zumauerung als eigenes Bauteil, neue Öffnung in einer Bestandswand als eigene Abbruchmenge.
- **Grundriss als Vektor-PDF im echten Maßstab** mit Plankopf, Brille und Statuslegende (A3 bis A0 nach Größe).

### Geändert

- **IFC-Export:** stabile GUIDs, Eigenschaften, Material-Schichten und DIN-276-Klassifizierung für alle Bauteile; Umbaustatus nach IFC4 in `Pset_*Common.Status` (ohne Status „NOTKNOWN“, nie „NEW“); Abwasserleitungen als Rohr statt Dachrinne.
- **Rückbau:** Kostengruppe 394 (wählbar je Projekt: 394, 212 oder bei den betroffenen Gruppen), Leistungsbereich 084, DIN 18459.

### Behoben

- **Abbruch stand im Gewerke-Katalog unter LB 040** (Wärmeversorgung); jetzt LB 084. Bereits gespeicherte Bauablauf-Vorgänge mit „040“ bitte prüfen.
- **„Plan als PDF“ war nicht maßstäblich:** Der Grundriss wurde als Bild aufs Blatt gestreckt, trug aber „1:100“. Der Grundriss kommt jetzt als Vektor im echten Maßstab; der Schnitt ist bis auf Weiteres als „nicht maßstäblich“ beschriftet.

## [1.5.1] - 2026-10-16

### Neu

- **Desktop-App für Windows (Vorschau):** `BIT-Atelier-Desktop-Setup.exe` startet BIT-Atelier in einem eigenen Fenster, ohne Node.js; die Daten liegen in einem Ordner, den Sie beim ersten Start wählen. Der Installer ist nicht signiert — Windows SmartScreen fragt einmal („Weitere Informationen“ → „Trotzdem ausführen“). Der bisherige Installer und das ZIP bleiben der empfohlene Weg.
- **Problem melden:** Einstellungen › System & Info bereitet eine Meldung für GitHub vor — Version, Seite, Browser und die letzten Protokollzeilen, ohne Projektdaten und bereinigt um Benutzerordner und E-Mail-Adressen. Sie sehen den ganzen Text und schicken ihn selbst ab.

### Geändert

- **Seitenleiste:** Skizze steht jetzt unter Entwurf & Genehmigung, der Baustellen-Leitstand unter Bauüberwachung, PDF & Ablage und das KI Tool unter Büro. Im Labor bleiben Investment und Portfolio.

## [1.5.0] - 2026-10-16

### Wichtig vor dem Update

- **Personaldaten werden verschlüsselt.** Beim ersten Start nach dem Update verschlüsselt die App `personal.json` und `personal-blobs/` (AES-256). Der Schlüssel liegt **außerhalb** des Datenordners — Windows: `%APPDATA%\BIT-Atelier\personal.key`, macOS: `~/Library/Application Support/BIT-Atelier/personal.key`, Linux: `~/.config/bit-atelier/personal.key`. **Diesen Schlüssel einmal getrennt sichern** (USB-Stick, Passwort-Safe). Ohne ihn sind die Personaldaten einer Sicherung nicht lesbar. Einstellungen › Daten & Sicherung zeigt den Pfad; beim Rechnerwechsel gehört die Datei mit an denselben Ort (docs/NOTFALL.md).

### Neu

- **VOB/B § 2 Abs. 3 in der AVA:** Beim Zuschlag wird die Vertragsmenge jeder Position festgehalten. Die Mengenregeln zeigen danach Mehrmengen über 110 % (mit der Spitzenmenge für einen neuen Einheitspreis) und Mindermengen unter 90 % — als Hinweis, keine Sperre.
- **Anrechenbare Kosten eingefroren:** „Aus LV übernehmen“ hält den Kostenstand im Honorarvertrag fest. Ändert sich das LV um mehr als 1 %, erscheint ein Hinweis mit „Als Honorarnachtrag übernehmen“ (§ 10 HOAI); gestellte Rechnungen bleiben unverändert.
- **Leistungsstand im Architektenvertrag pflegen** — ohne den Komplex-Designer; es ist derselbe Stand wie im Designer-Reiter „Planer“.
- **Bauherr aus dem Adressbuch** im Angebots-Assistenten; fehlt das Projekt, lässt es sich direkt im Assistenten anlegen.
- **Steuernummer, USt-IdNr. und IBAN** auch unter Einstellungen › Büro & Briefkopf, die Einstellungs-Suche findet sie.

### Geändert

- **Ein Büroname:** Buchhaltung, XRechnung und DATEV-Export lesen den Namen aus dem Briefkopf; das eigene Feld in den Buchhaltungs-Einstellungen entfällt (ein alter Name lässt sich mit einem Klick übernehmen).
- **Rechnung: „Stand (%)“ rechnet den Betrag** der Leistungsphase mit; eine neue Zeile nimmt die nächste Leistungsphase, Zeilen mit 0,00 € werden markiert.
- **Steuertermine** verschieben sich nach dem Bürokalender (Landesfeiertage, § 108 Abs. 3 AO), wie Fristen und Abwesenheiten.
- Adressbuch: E-Mail ist kein Pflichtfeld mehr. „Termin anlegen“ übernimmt das aktive Projekt.
- **Sicherheit der lokalen App:** Schreibende Anfragen aus dem Browser brauchen ein Sitzungs-Token; eine fremde Webseite kann keine Daten mehr in die lokale App schreiben.

### Behoben

- Ein neu angelegtes Projekt wurde nicht aktiv — die Kopfzeile sprang zurück zum vorherigen Projekt.
- Das Download-Paket enthielt die Vergleichsbilder der Tests (33 statt 17 MB).

## [1.4.0] - 2026-10-13

### Geändert

- **Seitenleiste nach dem Büro-Ablauf:** Die Module stehen jetzt in der Reihenfolge, in der ein Projekt durchs Büro läuft — Übersicht · Akquise & Auftrag · Entwurf & Genehmigung · Ausführungsplanung · Ausschreibung & Vergabe · Bauüberwachung, danach die Querschnitts-Gruppen Zeit & Schriftverkehr, Büro und Labor. Jedes Modul ist einer Leistungsphase (0–10) oder dem Querschnitt zugeordnet.
- **Werkplanung und Baustelle getrennt:** „Werkplanung & Baustelle“ ist in zwei Seiten geteilt — **Werkplanung** (Planliste, Durchbrüche, Bemusterung, SiGe, Genehmigungen) unter Ausführungsplanung und **Baustelle** (Bautagebuch) unter Bauüberwachung. Alte Links mit `?tab=` führen automatisch auf die richtige Seite.

## [1.3.0] - 2026-10-13

### Neu

- **Behinderung an den Bauherrn melden:** zweite Vorlage im Bautagebuch neben der Behinderungsanzeige nach VOB/B — die Bauleitung informiert den Bauherrn mit Zeitraum und Bautagebuch-Auszug (Richtwert, vor Versand prüfen).

### Geändert

- **Technik auf aktuellem Stand:** React 19, Kartenbibliothek MapLibre 6, three.js r186, pdf.js 6.4, web-ifc 0.0.78 und kleinere Bibliotheken aktualisiert. Arabische und hebräische Kartenbeschriftungen kommen ohne Zusatzmodul aus.
- Die erste Ladung der App ist durch React 19 rund 36 KB (gzip) größer.

### Behoben

- PDF-Studio: Beim schnellen Wechsel zwischen zwei Dokumenten konnte „PDF konnte nicht geladen werden“ erscheinen; das Dokument wird jetzt sauber freigegeben.
- Karte: keine Warnungen mehr in der Konsole durch fehlende Straßennummern im Kartenstil.

## [1.2.0] - 2026-10-12

### Neu

- **Eigenes Programmfenster:** BIT-Atelier startet in einem eigenen Fenster mit Logo, ohne Browser-Tab und ohne Konsolenfenster; ein zweiter Start öffnet kein zweites Programm. „Programm beenden“ in Einstellungen › System & Info.
- **Projektdateien `.bitproj`:** Doppelklick öffnet die Import-Vorschau (aktualisieren, als Kopie, abbrechen), „Zurück in die Datei speichern“ mit Konfliktwarnung, „Als Datei sichern / Aus Datei laden“ in den Einstellungen.
- **Lokale KI:** LM Studio und Ollama mit einem Klick, Modellerkennung, Schalter „Nur lokale KI“, Empfehlung des passenden Modells für diesen Rechner, geführte Ollama-Einrichtung, KI-Harness aus den Einstellungen starten.
- **Zeit & Honorar:** Zeiterfassung, HOAI-Angebote, Architektenvertrag, Nachträge, Projektcontrolling; im Bestand Umbauzuschlag und mitzuverarbeitende Bausubstanz aus dem Modell.
- **Büro:** Fristen & Termine (.ics), Schriftverkehr mit Postbuch, Rollen und „Ansicht als“, Abwesenheiten, „Meine Woche“, XRechnung für öffentliche Auftraggeber.
- **Werkplanung & Baustelle:** Planliste, Durchbrüche mit BCF, Bemusterung und Raumbuch, SiGe-Formulare, Bautagebuch, Genehmigungen; Kostenstände nach DIN 276, Nachtrags-Prüfpfad.
- **Modell:** Wände, Türen und Räume der Wohnungs-Werkstatt als Bauteile in IFC und AVA, Bauteilstatus ohne Vorgabe, Zeitstrahl nach Bauabschnitt und Gewerk, IFC-Lesen im Hintergrund, größeres Musterprojekt.
- **Sicherheit & Daten:** automatische tägliche Sicherung des Datenordners, Büro-Modus für einen zweiten Arbeitsplatz oder ein Tablet im LAN nur mit Kopplungscode, Schutz gegen DNS-Rebinding.
- **Barrierefreiheit:** alle Auswahlfelder, Symbolknöpfe und Beschriftungen benannt, sichtbarer Fokus, Erklärung zur Barrierefreiheit unter `/barrierefreiheit`.

- Änderungsliste (diese Datei): Die Release-Notiz entsteht aus dem Abschnitt der jeweiligen
  Fassung, die Installationsanleitung steht als zweiter Absatz darunter.
- Update-Hinweis zeigt die ersten Zeilen der Änderungen und klappt auf Wunsch alle auf.
- Einstellungen › System & Info: installierte Fassung, letzte Update-Prüfung, „Jetzt prüfen“,
  automatische Prüfung abschaltbar und „Fassung festhalten bis …“ (z. B. bis zur Submission).
- Umgebungsvariable `BIT_KEIN_UPDATECHECK=1` schaltet die Update-Prüfung vollständig ab.
- Update mit Gesundheitsprüfung: Vor dem Tausch wird `daten/` gesichert; antwortet die neue Fassung
  nach dem Neustart nicht binnen 60 s, holt die App Programm und Daten aus der Sicherung zurück und
  startet die vorige Fassung. Es bleiben die zwei neuesten Sicherungen.
- Deinstallation: `BIT-Atelier-Installer.cmd /entfernen` (auch als Startmenü-Eintrag „BIT-Atelier
  entfernen“) und `install.sh --entfernen` — beendet die laufende App, fragt, ob die Daten bleiben
  (Vorgabe ja, Sicherungskopie vor dem Löschen), entfernt Programm, `.update/`, `node_modules/` und
  Verknüpfungen.
- Einstellungen › Daten & Sicherung zeigt den tatsächlichen Datenordner mit „Ordner öffnen“.
- Einstellungen › KI-Verbindungen › „Mit einem KI-Assistenten verbinden“: fertiger MCP-Eintrag für
  Claude Code und Claude Desktop mit den echten Pfaden dieser Installation, mit Kopierknopf.
- Büro-Modus (Mehrplatz) unter Einstellungen › System & Info: ein zweiter Arbeitsplatz oder ein Tablet
  im selben Büro-Netz nutzt die App mit — erst nach Kopplung mit einem Code vom Büro-Rechner, nur aus
  privaten Netzen, Geräte einzeln widerrufbar. Kennung in der Kopfzeile („Büro-Modus an“ bzw.
  „Gerät: <Name>“). Ohne Verschlüsselung im LAN: nur in vertrauenswürdigen Netzen. Hinweis nach dem
  Speichern, wenn ein Eintrag inzwischen anderswo geändert wurde.
- Erster Start ohne Netz: Scheitert das Laden der Laufzeitpakete, unterscheiden `start-windows.cmd` und
  `start.sh` den Netzfall (kein Internet, Firmen-Proxy, gesperrte Paketquelle) und erklären auf Deutsch
  und Englisch, was hilft.
- Abhängigkeiten unter Aufsicht: Dependabot schlägt wöchentlich gebündelte Aktualisierungen vor; ein
  Release mit bekannter hoher oder kritischer Lücke in einem Laufzeitpaket bricht vor dem Veröffentlichen ab.
- Modelle von Bestandsgebäuden: Bauart einmal ermitteln, Erfassungsgrad und Herkunft der
  Werte, IFC-Übernahme als Modellstand.
- Nachhaltigkeitskonzept-Blatt (Regenwasser, Gründach, PV, Versiegelung) als Karte und PDF.
- Wie ein eigenes Programm: Die Verknüpfungen starten BIT-Atelier ohne Konsolenfenster in einem eigenen
  App-Fenster (Edge/Chrome im App-Modus, eigenes Taskleistensymbol; sonst Standardbrowser, `BIT_FENSTER=0`
  für den Browser-Tab). Nur der erste Start zeigt die Paketinstallation. Ein zweiter Klick öffnet nur ein
  Fenster. Der Server läuft nach dem Schließen weiter; „Programm beenden“ in Einstellungen › System & Info.
  Ausgabe in `daten/server.log`. Auch der Neustart nach einem Update kommt ohne Konsolenfenster aus.
- Projektdateien per Doppelklick: Der Installer meldet `.bitproj` pro Benutzer an (Windows ohne
  Administratorrechte, Linux über `~/.local/share`); ein Doppelklick startet BIT-Atelier bei Bedarf und
  zeigt die Import-Vorschau. Schon vorhandenes Projekt: „Aktualisieren“, „Als Kopie“ oder „Abbrechen“.
  „Zurück in die Datei speichern“ (Einstellungen › Daten & Sicherung) fragt nach, wenn die Datei inzwischen
  geändert wurde. Vor jedem Import eine Kopie der Datenbank unter `daten/vor-import/`. Die Deinstallation
  meldet den Dateityp wieder ab. Desktop-Client: `.bitproj` im Installationspaket hinterlegt.

### Geändert

- `API_HOST` öffnet die API nicht mehr ohne Anmeldung: Anfragen von anderen Geräten brauchen auch dann
  den Büro-Modus und eine Kopplung.

## [1.1.0] - 2026-10-11

### Neu

- Installer für Windows (`BIT-Atelier-Installer.cmd`, ohne Administratorrechte, mit
  Verknüpfungen) und für macOS/Linux (`install.sh`).
- Update per Klick: Die installierte App erkennt neue Fassungen, lädt sie selbst, prüft die
  SHA-256-Prüfsumme und tauscht die Programmdateien aus; Daten und `.env` bleiben.
- Jedes Release trägt eine Prüfsummendatei `BIT-Atelier.zip.sha256`.
- Regenwassernutzung nach DIN 1989-1: Ertrag, Bedarf, Speicher, Zisterne unter der
  Tiefgarage, eigener Technikraum; Mengen als CSV für die AVA (auch Tiefgarage, Keller,
  TGA-Netz).
- AVA: GAEB-Angebote (X84) in den Preisspiegel einlesen, Angebotsprüfung mit Prüfvermerk,
  Vergabevorschlag und Auftrags-LV als PDF-Entwurf, VHB-Formulare als Entwurf ausfüllen,
  Kostenkontrolle je Kostengruppe nach DIN 276.
- Projektbeteiligtenliste aus dem Adressbuch, Besprechungsprotokolle je Serie mit
  Übernahme offener Punkte, Planner-Import in den Bauzeitenplan mit Großformat-PDF.
- PDF-Studio: Plankopf-Werkzeug und „PDF unveränderbar“ (Formulare festschreiben oder als
  Bild-PDF).
- Komplex-Designer: Türen in allen Typologien, Bäder mit Bewegungsfläche nach DIN 18040-2,
  Laubengang und Spänner mit erreichbaren Räumen, Eingangshalle im Erdgeschoss, Riegel-Netz
  für nicht rechteckige Grundflächen, Vorschläge mit Vergleich von zwei bis vier Varianten.
- Kontakte mit Postanschrift.

### Behoben

- Prüfregeln normalisieren den Status auf beiden Seiten; Zahlenfelder geben ihr Maximum an
  das Eingabefeld weiter.
- IFC-Import zählt übersprungene Bauteile, statt sie still zu verwerfen; die Datenbank
  schreibt beim Beenden zuverlässig.
- Maßketten laufen beim Herauszoomen nicht mehr über ihr Ende hinaus.

## [1.0.1] - 2026-10-07

### Neu

- Breite Zeichenflächen: eine Breitenregel und ein Füllmodus für Pläne.
- Rettungsweg führt durch Zimmertür, Flur und Wohnungstür.

## [1.0.0] - 2026-10-07

### Neu

- Erste öffentliche Fassung unter MIT-Lizenz.
- Start auf einem Port: `start-windows.cmd` bzw. `start.sh` prüfen Node.js 22.9, installieren
  beim ersten Start die Laufzeitpakete und öffnen den Browser; die Daten liegen im Ordner
  `daten/` neben der App.
- KI-Verbindungen mit Vorlagen für beliebige Modelle (Cloud-Anbieter und lokale Server).
- MCP-Server (`tools/mcp-server.mjs`): andere KI-Assistenten lesen Projekte, mit
  `--schreiben` auch schreibend.
- Feedback-Dialog in jeder Fassung.

[Unveröffentlicht]: https://github.com/mozzi86/bit-atelier-oss/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/mozzi86/bit-atelier-oss/releases/tag/v1.1.0
[1.0.1]: https://github.com/mozzi86/bit-atelier-oss/releases/tag/v1.0.1
[1.0.0]: https://github.com/mozzi86/bit-atelier-oss/releases/tag/v1.0.0
