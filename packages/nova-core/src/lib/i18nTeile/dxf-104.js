// Plan 104-06 (DXF R12 export of site plan and floor plan) and ROADMAP 101-03 (parcel import from
// DXF/GeoJSON, several parcels united into one plot boundary): English texts of SiteDesigner,
// BitBimStudio and the message templates of dxfLesen.js (DXF_MELDUNGEN) and flurstueckImport.js
// (IMPORT_MELDUNGEN). The templates carry {placeholders} that meldungText() fills after t().
// Format and guard as in every part file (tests/unit/i18nAbdeckung.test.js).
//
// In:  nothing. Out: EN, merged into DICT.en through ./index.js.

/** @type {Record<string, string>} */
export const EN = {
  // SiteDesigner — export
  "Lageplan als DXF exportieren": "Export site plan as DXF",
  "Nichts zu exportieren — weder gezeichnetes Grundstück noch Flächen oder Baukörper.": "Nothing to export — no drawn plot, areas or building volumes.",
  "Lageplan als DXF exportiert — {n} Objekt(e) ohne gültige Koordinaten ausgelassen.": "Site plan exported as DXF — {n} object(s) without valid coordinates left out.",
  "Lageplan als DXF exportiert (R12, Meter, Ursprung = Projektstandort).": "Site plan exported as DXF (R12, metres, origin = project location).",
  "DXF-Export fehlgeschlagen": "DXF export failed",
  // SiteDesigner — parcel import
  "Flurstücke (GeoJSON/DXF)": "Cadastral parcels (GeoJSON/DXF)",
  "DXF-Ebenen": "DXF layers",
  "Mit gewählten Ebenen neu einlesen": "Re-read with the selected layers",
  "Als Grundstück übernehmen": "Use as plot",
  "Alle Flurstücke zu einer Grenze vereinigen und als gezeichnetes Grundstück setzen": "Unite all parcels into one boundary and set it as the drawn plot",
  "Das gezeichnete Grundstück bleibt — „Als Grundstück übernehmen“ ersetzt es.": "The drawn plot stays — “Use as plot” replaces it.",
  // BitBimStudio — floor plan
  "Aktuellen Plan als DXF": "Current plan as DXF",
  "DXF nur aus dem Grundriss — bitte Ansicht Grundriss wählen.": "DXF only from the floor plan — please choose the floor plan view.",
  "Keine Zeichnung auf diesem Geschoss.": "No drawing on this storey.",
  "Grundriss als DXF erstellt (R12, Meter, Ebenen je Bauteil).": "Floor plan created as DXF (R12, metres, one layer per element type).",
  "Objekt(e) ohne gültige Koordinaten ausgelassen.": "object(s) without valid coordinates left out.",
  // dxfLesen.js — DXF_MELDUNGEN
  "DXF-Datei ist leer.": "The DXF file is empty.",
  "DXF-Datei zu groß ({kb} kB > {max} kB).": "DXF file too large ({kb} kB > {max} kB).",
  "Binäres DXF wird nicht gelesen — bitte als ASCII-DXF speichern.": "Binary DXF is not read — please save as ASCII DXF.",
  "Datei ist kein lesbares DXF (Gruppencode/Wert-Paare fehlen).": "The file is no readable DXF (group code / value pairs missing).",
  "DXF enthält keinen ENTITIES-Abschnitt.": "The DXF has no ENTITIES section.",
  "Mehr als {max} Objekte — Rest ignoriert.": "More than {max} objects — the rest is ignored.",
  "Mehr als {max} Einzellinien — nicht zu Ringen verkettet.": "More than {max} single lines — not chained into rings.",
  "{n} Bogensegment(e) als gerade Sehne übernommen — die Fläche weicht dort leicht ab.": "{n} arc segment(s) taken as a straight chord — the area differs slightly there.",
  "{n} Blockreferenz(en) (INSERT) nicht aufgelöst — Geometrie in Blöcken fehlt.": "{n} block reference(s) (INSERT) not resolved — geometry inside blocks is missing.",
  "{n} Objekt(e) anderer Art übersprungen ({arten}).": "{n} object(s) of other types skipped ({arten}).",
  "{n} Polygonnetz/Flächennetz-Polylinie(n) übersprungen.": "{n} polygon mesh / polyface polyline(s) skipped.",
  "{n} offene Linienzüge übersprungen (keine geschlossene Fläche).": "{n} open polylines skipped (no closed area).",
  "DXF ab Zeile {zeile} nicht lesbar (kein Gruppencode) — alles danach fehlt, Flurstücke können unvollständig sein.": "DXF not readable from line {zeile} on (no group code) — everything after it is missing, parcels may be incomplete.",
  "Datei nur teilweise übernommen — die Grenze kann zu klein sein, bitte prüfen.": "File only partly imported — the boundary may be too small, please check.",
  // flurstueckImport.js — IMPORT_MELDUNGEN
  "DXF enthält auf den gewählten Ebenen keine geschlossene Fläche.": "The DXF has no closed area on the selected layers.",
  "Ebene(n) automatisch gewählt: {ebenen} — andere Ebenen unten wählbar.": "Layer(s) chosen automatically: {ebenen} — other layers can be selected below.",
  "Gauß-Krüger-Koordinaten (DHDN) werden nicht umgerechnet — bitte als ETRS89/UTM (EPSG:25832/25833) ausgeben. Nichts übernommen.": "Gauss-Krüger coordinates (DHDN) are not converted — please export as ETRS89/UTM (EPSG:25832/25833). Nothing imported.",
  "DXF ohne Georeferenz (weder UTM noch BIT-Atelier-Bezug) — Flurstücke um den Projektstandort zentriert; Lage bitte prüfen.": "DXF without georeference (neither UTM nor a BIT-Atelier reference) — parcels centred on the project location; please check the position.",
  "Flurstücke liegen {km} km vom Projektstandort entfernt — Standort oder Koordinatensystem prüfen. Nichts übernommen.": "The parcels lie {km} km from the project location — check the location or the coordinate system. Nothing imported.",
  "Zeichnungseinheit {code} unbekannt — als Meter gelesen.": "Drawing unit {code} unknown — read as metres.",
  "Mehr als {max} Flurstücke — Rest ignoriert.": "More than {max} parcels — the rest is ignored.",
  "Fläche {n}: {punkte} Punkte > Limit {max} — übersprungen.": "Area {n}: {punkte} points > limit {max} — skipped.",
  "{n} Flurstücke zu einer Grundstücksgrenze vereinigt ({flaeche} m²).": "{n} parcels united into one plot boundary ({flaeche} m²).",
  "Grundstücksgrenze aus 1 Flurstück übernommen ({flaeche} m²).": "Plot boundary taken from 1 parcel ({flaeche} m²).",
  "Flurstücke hängen nicht zusammen ({teile} Teile, kleinster Abstand {abstand} m) — keine gemeinsame Grenze gebildet.": "The parcels are not connected ({teile} parts, smallest gap {abstand} m) — no common boundary formed.",
  "Flurstücke überlappen sich oder sind doppelt enthalten — keine gemeinsame Grenze gebildet.": "The parcels overlap or are contained twice — no common boundary formed.",
  "Flurstücke berühren sich nur an einer Ecke — keine zusammenhängende Grenze gebildet.": "The parcels touch only at a corner — no connected boundary formed.",
  "Flurstücke umschließen eine Lücke (fremdes Flurstück oder Hof) — eine Grenze mit Loch wird nicht unterstützt.": "The parcels enclose a gap (another parcel or a courtyard) — a boundary with a hole is not supported.",
  "Flurstück {nr} ist keine gültige Fläche — keine Grenze gebildet.": "Parcel {nr} is no valid area — no boundary formed.",
  "Keine Flurstücke zum Vereinigen.": "No parcels to unite.",
};
