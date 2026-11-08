// Phase 108 ("Einfamilienhaus mit Satteldach"): English texts of all 108 plans — the ONE part file of the phase (108-01 starts it,
// 108-02 … 108-10 add their keys here). German source text = key.
//
// LAZY part (size budget of the entry chunk, pattern ansicht-107-12.js): NOT listed in ./index.js. Every module that shows these texts
// imports this file and calls englischErgaenzen(EN) of ../i18n.jsx once at module level (existing keys win). Today: BitBimStudio.jsx, WohnungsWerkstatt.jsx (108-02),
// BimPlan2D.jsx, MapLibreMap.jsx, ComplexDesigner.jsx, MassingStudio.jsx (108-08, 108-11). Keys that already exist in a global part ("First", "Baufeld", "Abschalten",
// "Übernehmen") are not repeated here — the guard (tests/unit/i18nAbdeckung.test.js) refuses a key defined twice.
//
// In:  nothing. Out: EN.

/** @type {Record<string, string>} */
export const EN = {
  // 108-01 (9c): section with the roof
  "Traufe": "Eaves",
  "Schnitt": "Section",
  "Schnittachse": "Section axis",
  "Schnitt A-A: entlang x durch die Gebäudemitte": "Section A-A: along x through the middle of the building",
  "Schnitt B-B: entlang z durch die Gebäudemitte": "Section B-B: along z through the middle of the building",
  "Schnitt B-B zeigt die Wände als Rechtecke — die verschnittenen Schichten gibt es nur im Schnitt A-A.": "Section B-B shows the walls as rectangles — the intersected layers exist in section A-A only.",
  // 108-01 (5): footprint from the site planning
  "Umriss der Baufeld-Planung weicht ab": "The outline of the site planning differs",
  "Das Gebäudemodell hat einen eigenen Umriss ({{quelle}}). Die Fläche der Baufeld-Planung wird erst nach „Übernehmen“ verwendet.": "The building model has its own outline ({{quelle}}). The area of the site planning is used only after \"Übernehmen\" (take over).",
  "Projekt gewechselt — der Umriss wurde nicht übernommen.": "Project switched — the outline was not taken over.", // review
  "Baufeld (mittig, ohne Lagebezug)": "Building envelope (centred, no position reference)", // review
  // 108-01 (4): entrance
  "Eigene Eingangstür vorhanden — automatischen Eingang abschalten?": "Own entrance door present — switch off the automatic entrance?",
  // 108-01 (9b): map offline
  "Karte offline — Kacheln nicht erreichbar": "Map offline — tiles not reachable",
  // 108-02 (D-EFH-01): knee wall, collar-beam floor, full-storey rule ("Kniestock" itself lives in raeume-107-11.js)
  "Kniestock {{wert}}": "Knee wall {{wert}}",
  "Kniestock gilt nur für das oberste Geschoss — neu setzen": "The knee wall applies to the top storey only — set it again",
  "Kehlbalkenlage liegt über dem First — entfällt": "The collar-beam floor lies above the ridge — it is dropped",
  "Kniestock gespeichert, wirkt nur bei geneigtem Dach": "Knee wall saved, it only applies under a pitched roof",
  "Der Kniestock bleibt erhalten, die einzelnen Geschosshöhen gehen verloren. Alle Geschosse gleich setzen?": "The knee wall is kept, the individual storey heights are lost. Set all storeys equal?",
  "Vollgeschoss: {{jaNein}} ({{p}} % ≥ 2,30 m)": "Full storey: {{jaNein}} ({{p}} % ≥ 2.30 m)",
  "Fläche mit mindestens 2,30 m lichter Höhe bis zu den Dachebenen (ohne Dachaufbau, ab Oberkante Rohdecke), bezogen auf den Umriss. 2/3-Regel nach Landesbauordnung, Werte je Land verschieden (Annahme); die 1,40-m-Regel über Gelände ist nicht geprüft. Hinweis, keine Rechtsauskunft.": "Area with at least 2.30 m clear height up to the roof planes (without roof build-up, from the top of the structural slab), related to the outline. 2/3 rule of the state building code, values differ by state (assumption); the 1.40 m rule above ground is not checked. A hint, no legal advice.",
  "aus dem Gebäudemodell": "from the building model",
  // 108-08 (D-EFH-09): key figure "outside" of the massing studio, against the envelope or (without one) the parcel
  "außerhalb des Baufelds": "outside the building envelope",
  "außerhalb der Parzelle": "outside the parcel",
  "Baukörper ragt über die Parzelle": "The building extends beyond the parcel",
  "innerhalb der Parzelle": "inside the parcel",
  "Parzelle nicht konvex — Fläche nicht berechenbar [ASSUMED]": "Parcel not convex — area cannot be computed [ASSUMED]",
  // 108-11: massing main body with the roof of the building model (height to the ridge, gross volume, setbacks per side)
  "First · Traufe {{traufe}} m": "Ridge · eaves {{traufe}} m",
  "BRI (Studie)": "Gross volume (study)",
  "davon Dach {{dach}} m³, ab Unterkante Untergeschoss": "of which roof {{dach}} m³, from the bottom of the basement",
  "davon Dach {{dach}} m³, ab ±0,00": "of which roof {{dach}} m³, from ±0.00",
  "Giebel": "Gable",
  "Hochseite": "High side",
  "Giebel: Wandhöhe + {{anteil}} des Giebeldreiecks [ASSUMED], Regel nach Landesrecht": "Gable: wall height + {{anteil}} of the gable triangle [ASSUMED], rule of the state building code",
  // 108-11 review fixes: roof surcharge above 45°/70°, frame approximation, load error, no parcel
  "Dach über 45°: 1/3 des Anstiegs zur Wandhöhe [ASSUMED]": "Roof above 45°: 1/3 of the rise added to the wall height [ASSUMED]",
  "Dach über 70°: ganzer Anstieg zur Wandhöhe [ASSUMED]": "Roof above 70°: the whole rise added to the wall height [ASSUMED]",
  "Näherung (Dach über Rahmen)": "Approximation (roof over the bounding frame)",
  "Dach des Gebäudemodells nicht geladen": "Roof of the building model not loaded",
  "kein Grundstück gezeichnet": "no plot drawn",
  // 108-12: massing key figures of the single-family house (dwellings/parking from the use, heights per storey, BGF vs. GFZ area)
  "von Hand eingegeben": "typed in by hand",
  "Wohnungsmix der Baufeld-Planung": "unit mix of the site planning",
  "Einfamilienhaus (Werkstatt-Typ)": "single-family house (workshop type)",
  "Schlüssel {{s}} je Einfamilienhaus [ASSUMED]": "ratio {{s}} per single-family house [ASSUMED]",
  "Schlüssel {{s}} je WE (Baufeld-Planung)": "ratio {{s}} per dwelling (site planning)",
  "geplant {{n}}": "planned {{n}}",
  "Wohneinheiten von Hand": "Dwellings by hand",
  "Stellplätze von Hand": "Parking spaces by hand",
  "automatisch": "automatic",
  "Geschosshöhen je Geschoss": "Storey heights per storey",
  "je Geschoss": "per storey",
  "Der Regler setzt alle Geschosse auf einen Wert (auch das Untergeschoss); der Kniestock bleibt.": "The slider sets all storeys to one value (the basement too); the knee wall stays.",
  "Einzelne Geschosshöhen ändern im Gebäudemodell (Geschosstabelle).": "Change single storey heights in the building model (storey table).",
  "Alle Geschosse gleich setzen": "Set all storeys equal",
  "GF {{gf}} m² (Vollgeschosse, BauNVO § 20) [ASSUMED]": "FA {{gf}} m² (full storeys, BauNVO § 20) [ASSUMED]",
  "DIN 277, alle Geschosse · davon Untergeschoss {{ug}} m²": "DIN 277, all storeys · of which basement {{ug}} m²",
  // 108-12 review: full-storey check of the attic for the GF, hand inputs keep a draft
  "GF {{gf}} m² (Vollgeschosse, BauNVO § 20; oberstes Geschoss kein Vollgeschoss nach Dachgeometrie) [ASSUMED]": "FA {{gf}} m² (full storeys, BauNVO § 20; top storey no full storey by the roof geometry) [ASSUMED]",
  "GF {{gf}} m² (Vollgeschosse, BauNVO § 20; oberstes Geschoss Vollgeschoss nach Dachgeometrie) [ASSUMED]": "FA {{gf}} m² (full storeys, BauNVO § 20; top storey a full storey by the roof geometry) [ASSUMED]",
  "Nur ganze Zahlen ab 0 — nicht gespeichert": "Whole numbers from 0 only — not saved",
};
