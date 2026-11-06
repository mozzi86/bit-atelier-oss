// 107-11: English texts of the room plan (room proposals from walls, measuring rule, net area, DIN 277, IFC room boundaries,
// WoFlV sloping areas from the roof geometry). German source text = key.
//
// LAZY part (size budget of the entry chunk): NOT listed in ./index.js. The modules that show these texts (BitBimStudio,
// WohnungsWerkstatt — both outside the start path) import it and call englischErgaenzen() of ../i18n.jsx once when they load.
// The guard test (tests/unit/i18nAbdeckung.test.js) reads this file like every other part.
//
// In:  nothing. Out: EN.

/** @type {Record<string, string>} */
export const EN = {
  // room detection (bauteil/raeume.js meldungText, click of the zone tool)
  "Kein geschlossener Raum erkannt — in eine von Wänden umschlossene Fläche klicken.": "No closed room found — click into an area enclosed by walls.",
  "Kette nicht geschlossen bei ({{x}}; {{z}})": "Chain not closed at ({{x}}; {{z}})",
  "Spalt {{b}} m zwischen ({{x1}}; {{z1}}) und ({{x2}}; {{z2}})": "Gap of {{b}} m between ({{x1}}; {{z1}}) and ({{x2}}; {{z2}})",
  "Geschlossene Fläche bei ({{x}}; {{z}}) zu klein für einen Raum": "Closed area at ({{x}}; {{z}}) too small for a room",
  "Raum um ({{x}}; {{z}}) enthält freistehende Wände — nicht ausgeschnitten": "Room around ({{x}}; {{z}}) contains free-standing walls — not cut out",
  "Geschoss {{level}}: Verkehrs- und Technikflächen größer als die Netto-Raumfläche — Zonen überlappen Wände": "Storey {{level}}: circulation and technical areas exceed the net room area — zones overlap walls",
  // BIM studio: proposals, wall and room inspector, IFC option
  "Räume vorschlagen": "Propose rooms",
  "Raumvorschläge aus den Wänden": "Room proposals from the walls",
  "Messregel": "Measuring rule",
  "Messregel neuer Räume": "Measuring rule of new rooms",
  "Innenkante": "Inner face",
  "Referenzlinie": "Reference line",
  "Alle übernehmen": "Take over all",
  "Keine geschlossenen Räume gefunden": "No closed rooms found",
  "Vorschlag {{n}}": "Proposal {{n}}",
  "{{innen}} m² innen · {{achse}} m² an der Referenzlinie": "{{innen}} m² inside · {{achse}} m² on the reference line",
  "Raumbegrenzend": "Bounds rooms",
  "Netto-Fläche": "Net area",
  "DIN 277": "DIN 277",
  "DIN-277-Gruppe": "DIN 277 group",
  "abgeleitet: {{gruppe}}": "derived: {{gruppe}}",
  "Aufenthalt (NUF 01)": "Living and common rooms (NUF 01)",
  "Büroarbeit (NUF 02)": "Office work (NUF 02)",
  "Produktion / Werkstatt (NUF 03)": "Production / workshop (NUF 03)",
  "Lagern / Verkaufen (NUF 04)": "Storage / sales (NUF 04)",
  "Bildung / Kultur (NUF 05)": "Education / culture (NUF 05)",
  "Heilen / Pflegen (NUF 06)": "Healing / care (NUF 06)",
  "Sonstige Nutzung (NUF 07)": "Other use (NUF 07)",
  "Technikfläche (TF 08)": "Technical area (TF 08)",
  "Verkehrsfläche (VF 09)": "Circulation area (VF 09)",
  "Raumgrenzen": "Room boundaries",
  "Raumgrenzen ins IFC": "Room boundaries into the IFC",
  "IfcRelSpaceBoundary zwischen Räumen und Wänden sowie Brutto- und Netto-Fläche je Raum": "IfcRelSpaceBoundary between rooms and walls plus gross and net area per room",
  // workshop: WoFlV sloping areas from the roof geometry (D-BK-14)
  "Dachschrägen": "Sloping ceilings",
  "Quelle der Dachschrägen": "Source of the sloping ceilings",
  "von Hand": "by hand",
  "aus Dachgeometrie": "from the roof geometry",
  "Kniestock": "Knee wall",
  "Flachdach im BIM-Studio — keine Dachschrägen": "Flat roof in the BIM studio — no sloping ceilings",
  "Aus der Dachform ({{form}}, {{grad}}°): < 1 m {{u1}} m² · 1–2 m {{z12}} m² im obersten Geschoss": "From the roof form ({{form}}, {{grad}}°): < 1 m {{u1}} m² · 1–2 m {{z12}} m² in the top storey",
  "Keine Wohnung dieses Typs im obersten Geschoss": "No unit of this type in the top storey",
  "Berechnungshilfe nach WoFlV § 4, keine Rechtsberatung. Kniestock = Traufe über dem Fußboden des obersten Geschosses [ASSUMED].": "Calculation aid after WoFlV § 4, no legal advice. Knee wall = eaves above the floor of the top storey [ASSUMED].",
  // review fixes 107-11: model without a roof storey, DIN 277 table, "take over all" without island rooms
  "Modell ohne Dachgeschoss: im BIM-Studio sitzt das Dach auf dem obersten Vollgeschoss — der Kniestock gilt nur für diese Rechnung, 3D und IFC zeigen ihn nicht.": "Model without a roof storey: in the BIM studio the roof sits on the top full storey — the knee wall applies to this calculation only, 3D and IFC do not show it.",
  "DIN 277 je Geschoss": "DIN 277 per storey",
  "aus Hüllwänden, gezeichneten Wänden, Stützen und Räumen dieses Studios, m²": "from hull walls, drawn walls, columns and rooms of this studio, m²",
  "ohne Räume": "no rooms",
  "oberirdisch": "above ground",
  "unterirdisch": "below ground",
  "gesamt": "total",
  "Zuordnung der Raumarten zu den DIN-277-Gruppen [ASSUMED]; ohne Räume ist die ganze NGF Nutzungsfläche.": "Mapping of room types to the DIN 277 groups [ASSUMED]; without rooms the whole NGF is usable area.",
  "Ohne Räume mit freistehenden Wänden — diese einzeln übernehmen": "Without rooms containing free-standing walls — take those over one by one",
};
