// Bürostandard-Startdaten der 14 büroweiten Kataloge (Phase 33 / W0).
//
// Diese Kataloge sind BÜROWEIT: sie tragen KEIN project_id, sondern `scope: "buero"`.
// Ein Projekt kann einen Eintrag überschreiben (`projekt_override_id`), ohne den
// Bürostandard zu verändern. Eine falsche Katalogzeile wirkt sonst über alle
// Projekte hinweg (Trust Boundary „Kataloge → alle Projekte").
//
// Server-Seite braucht KEINEN Code je Katalog: `entitiesRouter` ist generisch
// (`/entities/:entity`). Diese Datei liefert nur Daten.
//
// Die dreistelligen DIN-276-Codes und die Einheiten stammen aus einem
// Referenzprojekt (anonymisiert; kg_zuordnung.json bzw. positionen.json) — keine
// erfundenen Codes.

export const KATALOG_ENTITAETEN = [
  'Din276Katalog',
  'KgRegel',
  'MengenMuster',
  'AusschlussGrund',
  'MengenbasisKatalog',
  'EinheitenKatalog',
  'StatusKonvention',
  'BaustoffKonvention',
  'Preisindexreihe',
  'PreisRangfolge',
  'AmpelSchwelle',
  'StlbKatalog',
  'ReferenzpreisPool',
  'PreisUebernahmeRegel',
];

const buero = (o) => ({ scope: 'buero', projekt_override_id: null, ...o });

// --- 1. DIN 276 — DREISTELLIG, Fassungen 2018 und 2008 ----------------------
// Wichtig: 2018 und 2008 sind bei 352/353/354 NICHT deckungsgleich (die Reihe
// wurde verschoben). Deshalb sind beide Fassungen getrennt geführt, nie gemappt.
const DIN276_2018 = [
  ['311', 'Baugrubenherstellung'], ['321', 'Baugrund'], ['322', 'Flachgründungen'],
  ['332', 'Nichttragende Außenwände'], ['334', 'Außenwandöffnungen'],
  ['338', 'Lichtschutz zur KG 330'], ['341', 'Tragende Innenwände'],
  ['342', 'Nichttragende Innenwände'], ['343', 'Innenstützen'],
  ['344', 'Innenwandöffnungen'], ['345', 'Innenwandbekleidungen'],
  ['351', 'Deckenkonstruktionen'], ['352', 'Deckenöffnungen'], ['353', 'Deckenbeläge'],
  ['354', 'Deckenbekleidungen'], ['361', 'Dachkonstruktionen'], ['363', 'Dachbeläge'],
  ['381', 'Allgemeine Einbauten'], ['391', 'Baustelleneinrichtung'], ['392', 'Gerüste'],
  ['393', 'Sicherungsmaßnahmen'], ['394', 'Abbruchmaßnahmen'], ['396', 'Materialentsorgung'],
  ['397', 'Zusätzliche Maßnahmen'], ['398', 'Provisorische Baukonstruktionen'],
  ['440', 'Elektrische Anlagen'], ['510', 'Erdbau'], ['573', 'Pflanzflächen'],
  ['574', 'Rasen-/Saatflächen'], ['591', 'Baustelleneinrichtung'], ['599', 'Sonstiges zur KG 590'],
];

const DIN276_2008 = [
  ['311', 'Baugrubenherstellung'], ['321', 'Baugrund'], ['322', 'Flachgründungen'],
  ['332', 'Nichttragende Außenwände'], ['334', 'Außentüren und -fenster'],
  ['338', 'Sonnenschutz'], ['341', 'Tragende Innenwände'],
  ['342', 'Nichttragende Innenwände'], ['343', 'Innenstützen'],
  ['344', 'Innentüren und -fenster'], ['345', 'Innenwandbekleidungen'],
  ['351', 'Deckenkonstruktionen'], ['352', 'Deckenbeläge'], ['353', 'Deckenbekleidungen'],
  ['361', 'Dachkonstruktionen'], ['363', 'Dachbeläge'], ['372', 'Besondere Einbauten'],
  ['391', 'Baustelleneinrichtung'], ['392', 'Gerüste'], ['393', 'Sicherungsmaßnahmen'],
  ['394', 'Abbruchmaßnahmen'], ['396', 'Recycling, Zwischendeponierung, Entsorgung'],
  ['397', 'Schlechtwetterbau'], ['398', 'Zusätzliche Maßnahmen'],
  ['440', 'Starkstromanlagen'], ['510', 'Geländeflächen'], ['570', 'Pflanz- und Saatflächen'],
  ['591', 'Baustelleneinrichtung'], ['599', 'Sonstiges'],
];

const din276 = [
  ...DIN276_2018.map(([code, name]) => buero({
    fassung: '2018', code, name,
    ebene: 3, gruppe: `${code[0]}00`, obergruppe: `${code.slice(0, 2)}0`,
  })),
  ...DIN276_2008.map(([code, name]) => buero({
    fassung: '2008', code, name,
    ebene: 3, gruppe: `${code[0]}00`, obergruppe: `${code.slice(0, 2)}0`,
  })),
];

// --- 2. KgRegel — wie kommt ein Bauteil zu seiner Kostengruppe? -------------
const kgRegel = [
  buero({ name: 'Innenwand tragend', ifc_klasse: 'IfcWall', muster: { op: 'glob', value: '*trag*' }, kg2018: '341', prio: 10 }),
  buero({ name: 'Innenwand nichttragend (Trockenbau)', ifc_klasse: 'IfcWall', muster: { op: 'glob', value: '*TB*' }, kg2018: '342', prio: 20 }),
  buero({ name: 'Innenstütze', ifc_klasse: 'IfcColumn', muster: null, kg2018: '343', prio: 30 }),
  buero({ name: 'Innentür / Innenwandöffnung', ifc_klasse: 'IfcDoor', muster: null, kg2018: '344', prio: 30 }),
  buero({ name: 'Innenwandbekleidung', ifc_klasse: 'IfcCovering', muster: null, kg2018: '345', prio: 40 }),
  buero({ name: 'Deckenkonstruktion', ifc_klasse: 'IfcSlab', muster: null, kg2018: '351', prio: 30 }),
  buero({ name: 'Deckenbelag (Bodenbelag Raum)', ifc_klasse: 'IfcSpace', muster: null, kg2018: '353', prio: 50 }),
  buero({ name: 'Fassade / Vorhangwand', ifc_klasse: 'IfcCurtainWall', muster: null, kg2018: '332', prio: 30 }),
  buero({ name: 'Geländer / Absturzsicherung', ifc_klasse: 'IfcRailing', muster: null, kg2018: '381', prio: 30 }),
  buero({ name: 'Abbruchmaßnahme (Status Abbruch)', ifc_klasse: null, status: 'abbruch', muster: null, kg2018: '394', prio: 5 }),
];

// --- 3. MengenMuster — die 15 wiederkehrenden Mengenregel-Vorlagen ----------
const mengenMuster = [
  buero({ nr: 1, name: 'Wandfläche netto einseitig', ifc_klasse: 'IfcWall', mengenbasis: 'NetSideArea', faktor: 1, einheit: 'm2' }),
  buero({ nr: 2, name: 'Wandfläche netto beidseitig (Beschichtung)', ifc_klasse: 'IfcWall', mengenbasis: 'NetSideArea', faktor: 2, einheit: 'm2' }),
  buero({ nr: 3, name: 'Wandfläche brutto einseitig', ifc_klasse: 'IfcWall', mengenbasis: 'GrossSideArea', faktor: 1, einheit: 'm2' }),
  buero({ nr: 4, name: 'Deckenfläche netto', ifc_klasse: 'IfcSlab', mengenbasis: 'NetArea', faktor: 1, einheit: 'm2' }),
  buero({ nr: 5, name: 'Bodenbelag Raum (netto)', ifc_klasse: 'IfcSpace', mengenbasis: 'NetFloorArea', faktor: 1, einheit: 'm2' }),
  buero({ nr: 6, name: 'Fassadenfläche netto', ifc_klasse: 'IfcCurtainWall', mengenbasis: 'NetSideArea', faktor: 1, einheit: 'm2' }),
  buero({ nr: 7, name: 'Betonvolumen netto', ifc_klasse: 'IfcSlab', mengenbasis: 'NetVolume', faktor: 1, einheit: 'm3' }),
  buero({ nr: 8, name: 'Stützenlänge', ifc_klasse: 'IfcColumn', mengenbasis: 'Length', faktor: 1, einheit: 'm' }),
  buero({ nr: 9, name: 'Geländerlänge', ifc_klasse: 'IfcRailing', mengenbasis: 'Length', faktor: 1, einheit: 'm' }),
  buero({ nr: 10, name: 'Unterzugslänge', ifc_klasse: 'IfcBeam', mengenbasis: 'Length', faktor: 1, einheit: 'm' }),
  buero({ nr: 11, name: 'Türen Stück', ifc_klasse: 'IfcDoor', mengenbasis: 'Count', faktor: 1, einheit: 'Stk' }),
  buero({ nr: 12, name: 'Stützen Stück', ifc_klasse: 'IfcColumn', mengenbasis: 'Count', faktor: 1, einheit: 'Stk' }),
  buero({ nr: 13, name: 'Raumumfang (Sockelleiste)', ifc_klasse: 'IfcSpace', mengenbasis: 'Perimeter', faktor: 1, einheit: 'm' }),
  buero({ nr: 14, name: 'Bekleidungsfläche', ifc_klasse: 'IfcCovering', mengenbasis: 'NetArea', faktor: 1, einheit: 'm2' }),
  buero({ nr: 15, name: 'Öffnungsfläche (Abzug)', ifc_klasse: 'IfcOpeningElement', mengenbasis: 'NetArea', faktor: 1, einheit: 'm2' }),
];

// --- 4. AusschlussGrund — warum trägt ein Bauteil KEINE Modellmenge? --------
// Restkategorie `sonstiges` verlangt PFLICHTTEXT — sonst versickern Befunde.
const ausschlussGrund = [
  buero({ code: 'kein_flaechenbauteil', name: 'Kein belastbares Flächenbauteil im Modell', text_pflicht: false }),
  buero({ code: 'proxy_export_bug', name: 'IFC-Übersetzer exportiert als IfcBuildingElementProxy', text_pflicht: false }),
  buero({ code: 'nicht_modelliert', name: 'Leistung ist nicht modelliert', text_pflicht: false }),
  buero({ code: 'sanitaer_estrich_schadstoff', name: 'Sanitär / Estrich / Schadstoff ohne eindeutiges Bauteil', text_pflicht: false }),
  buero({ code: 'fliesen_nassraum_detail', name: 'Fliesen-/Nassraum-Detailleistung', text_pflicht: false }),
  buero({ code: 'durchbruch_bohrung', name: 'Durchbruch / Bohrung (Stückleistung ohne Bauteil)', text_pflicht: false }),
  buero({ code: 'sonstiges', name: 'Sonstiges (Begründung erforderlich)', text_pflicht: true }),
];

// --- 5. MengenbasisKatalog — die 15 IFC-Größen (QTY_KEYS des Orakels) ------
const MB = [
  ['NetVolume', 'm3', 'volumen'], ['GrossVolume', 'm3', 'volumen'],
  ['NetSideArea', 'm2', 'flaeche'], ['GrossSideArea', 'm2', 'flaeche'],
  ['NetArea', 'm2', 'flaeche'], ['GrossArea', 'm2', 'flaeche'],
  ['NetFootprintArea', 'm2', 'flaeche'], ['GrossFootprintArea', 'm2', 'flaeche'],
  ['Length', 'm', 'laenge'], ['Width', 'm', 'laenge'], ['Height', 'm', 'laenge'],
  ['Perimeter', 'm', 'laenge'], ['Depth', 'm', 'laenge'],
  ['NetFloorArea', 'm2', 'flaeche'], ['GrossFloorArea', 'm2', 'flaeche'],
];
const mengenbasisKatalog = [
  ...MB.map(([key, einheit, dimension]) => buero({ key, einheit, dimension, quelle: 'IFC BaseQuantities' })),
  // Count ist keine IFC-Größe, sondern die Trefferzahl — bewusst getrennt geführt.
  buero({ key: 'Count', einheit: 'Stk', dimension: 'anzahl', quelle: 'Trefferzahl (keine IFC-Größe)' }),
];

// --- 6. EinheitenKatalog — die 18 real vorkommenden Einheiten -------------
// Inklusive der Vorhalte-Einheiten m2Mt / mMt / StMt / m2Wo (Menge × Zeit).
// `vergleich` ist der KANONISCHE Code fuer den Einheitenvergleich zwischen zwei
// LVs (Phase 33 / W7). Zwei Positionen sind einheitengleich, wenn ihr `vergleich`
// gleich ist — `Stk` und `St` sind dasselbe, `m²` und `m2` auch, `lfm` ist `m`.
// Das MUSS Katalogdatum sein: als Map im Code wuerde es beim ersten fremden LV
// mit `qm` oder `Stck` still zu „Einheit ungleich" und damit zu einer
// verschwiegenen Preisuebernahme.
const EINHEITEN = [
  ['Psch', 'Pauschal', 'pauschal', false, 'psch'], ['St', 'Stück', 'anzahl', false, 'st'],
  ['Stk', 'Stück', 'anzahl', false, 'st'], ['Std', 'Stunde', 'zeit', false, 'h'],
  ['kg', 'Kilogramm', 'masse', false, 'kg'], ['t', 'Tonne', 'masse', false, 't'],
  ['to', 'Tonne', 'masse', false, 't'], ['m', 'Meter', 'laenge', false, 'm'],
  ['lfm', 'laufender Meter', 'laenge', false, 'm'], ['m2', 'Quadratmeter', 'flaeche', false, 'm2'],
  ['m²', 'Quadratmeter', 'flaeche', false, 'm2'], ['m3', 'Kubikmeter', 'volumen', false, 'm3'],
  ['m2Mt', 'Quadratmeter × Monat', 'flaeche_zeit', true, 'm2mt'],
  ['m2Wo', 'Quadratmeter × Woche', 'flaeche_zeit', true, 'm2wo'],
  ['mMt', 'Meter × Monat', 'laenge_zeit', true, 'mmt'],
  ['mWo', 'Meter × Woche', 'laenge_zeit', true, 'mwo'],
  ['StMt', 'Stück × Monat', 'anzahl_zeit', true, 'stmt'],
  ['StWo', 'Stück × Woche', 'anzahl_zeit', true, 'stwo'],
];
const einheitenKatalog = EINHEITEN.map(([code, name, dimension, vorhaltung, vergleich]) =>
  buero({ code, name, dimension, vorhaltung, vergleich }));

// --- 7. StatusKonvention — die EINE Normalisierungsstelle (T-33-04) -------
// Die Pipeline schreibt "Bestand"/"Neubau"/"Abbruch" und kennt zusätzlich "?".
// bimClassification erwartet klein. IFC nutzt NEW/EXISTING/DEMOLISH.
// Ein Mismatch ergibt 0 Treffer OHNE Fehlermeldung — deshalb GENAU EINE Stelle.
const statusKonvention = [
  buero({ intern: 'bestand', pipeline: 'Bestand', ifc_enum: 'EXISTING', anzeige: 'Bestand', aliase: ['bestand', 'Bestand', 'EXISTING', 'existing'] }),
  buero({ intern: 'neubau', pipeline: 'Neubau', ifc_enum: 'NEW', anzeige: 'Neubau', aliase: ['neubau', 'Neubau', 'NEW', 'new'] }),
  buero({ intern: 'abbruch', pipeline: 'Abbruch', ifc_enum: 'DEMOLISH', anzeige: 'Abbruch', aliase: ['abbruch', 'Abbruch', 'DEMOLISH', 'demolish'] }),
  buero({ intern: null, pipeline: '?', ifc_enum: null, anzeige: 'unbekannt', aliase: ['?', '', 'unbekannt', 'unknown', null] }),
];

// --- 8. BaustoffKonvention -------------------------------------------------
const baustoffKonvention = [
  buero({ intern: 'stahlbeton', anzeige: 'Stahlbeton', muster: { op: 'glob', value: '*Beton*' } }),
  buero({ intern: 'mauerwerk_ks', anzeige: 'KS-Mauerwerk', muster: { op: 'glob', value: '*KS*' } }),
  buero({ intern: 'gipskarton', anzeige: 'Gipskarton', muster: { op: 'glob', value: '*Gipskarton*' } }),
  buero({ intern: 'stahl', anzeige: 'Stahl', muster: { op: 'glob', value: '*Stahl*' } }),
  buero({ intern: 'holz', anzeige: 'Holz', muster: { op: 'glob', value: '*Holz*' } }),
  buero({ intern: 'glas', anzeige: 'Glas', muster: { op: 'glob', value: '*Glas*' } }),
  buero({ intern: 'daemmung', anzeige: 'Dämmung', muster: { op: 'glob', value: '*Dämm*' } }),
  buero({ intern: 'unbekannt', anzeige: 'unbekannt', muster: null }),
];

// --- 9. Preisindexreihe — PUNKTE, keine Konstante -------------------------
// **[ASSUMED]** Die Werte sind in dieser Session NICHT gegen destatis geprüft
// (RESEARCH A6). Sie sind deshalb eine EDITIERBARE REIHE und nie eine Konstante
// im Code: der Faktor wird immer aus zwei Punkten GERECHNET (wert(bis)/wert(von)).
// Die Prognose ab 2026-06 ist ausdrücklich Annahme (+5 % p. a.).
const preisindexreihe = [
  buero({
    reihe: 'destatis Baupreisindex Wohngebäude (Neubau)',
    basis: '2021=100',
    quelle: 'destatis Fachserie 17 Reihe 4 — [ASSUMED], nicht gegen destatis geprüft',
    assumed: true,
    assumed_hinweis:
      '[ASSUMED] Indexwerte in dieser Session NICHT verifiziert. Als Preisstand sichtbar ausweisen, nie still hochrechnen. Punkte ab 2026-06 sind Prognose (+5 % p. a.).',
    punkte: [
      { periode: '2020-11', wert: 95.0, prognose: false },
      { periode: '2021-11', wert: 100.0, prognose: false },
      { periode: '2022-11', wert: 116.0, prognose: false },
      { periode: '2023-11', wert: 125.0, prognose: false },
      { periode: '2024-11', wert: 131.0, prognose: false },
      { periode: '2025-11', wert: 137.0, prognose: false },
      { periode: '2026-05', wert: 141.0, prognose: false },
      { periode: '2027-06', wert: 150.0, prognose: true },
      { periode: '2028-06', wert: 157.5, prognose: true },
    ],
  }),
];

// --- 10. PreisRangfolge — 9 Preisarten mit Default-Rang ------------------
// HÖHERER `rang` = stärkere Aussage (Phase 33 / W4). Die Reihenfolge ist
// fachliche Priorität, nicht Implementierungsbequemlichkeit: was beauftragt oder
// abgerechnet ist, schlägt jede Schätzung; der berechnete Index steht ÜBER dem
// eingefrorenen Kostenanschlag 2020, weil er dessen fortgeschriebene Lesart ist.
// `ep_berechnet: true` gilt genau für `index` — deren ep wird NIE persistiert.
// `eingefroren: true` gilt für `kostenanschlag`: der 2020er-Wert wird nie neu
// gerechnet (fachliche Anforderung: der Kostenanschlag ist ein Dokumentenstand).
const preisRangfolge = [
  buero({ rang: 90, art: 'schlussrechnung', name: 'Schlussrechnung (geprüft)', belastbarkeit: 'hoch', ep_berechnet: false, beleg_pflicht: true, eingefroren: false }),
  buero({ rang: 80, art: 'nachtrag', name: 'Nachtrag (beauftragt)', belastbarkeit: 'hoch', ep_berechnet: false, beleg_pflicht: true, eingefroren: false }),
  buero({ rang: 70, art: 'vertrag', name: 'Vertragspreis (beauftragt)', belastbarkeit: 'hoch', ep_berechnet: false, beleg_pflicht: true, eingefroren: false }),
  buero({ rang: 60, art: 'angebot', name: 'Angebot', belastbarkeit: 'mittel', ep_berechnet: false, beleg_pflicht: true, eingefroren: false }),
  buero({ rang: 50, art: 'markt', name: 'Marktpreis (Recherche, Beleg pflicht)', belastbarkeit: 'mittel', ep_berechnet: false, beleg_pflicht: true, eingefroren: false }),
  buero({ rang: 40, art: 'stlb', name: 'STLB-/DBD-Richtwert', belastbarkeit: 'niedrig', ep_berechnet: false, beleg_pflicht: false, eingefroren: false }),
  buero({ rang: 30, art: 'referenzprojekt', name: 'Referenzpreis eigenes Projekt', belastbarkeit: 'mittel', ep_berechnet: false, beleg_pflicht: true, eingefroren: false }),
  buero({ rang: 20, art: 'index', name: 'Indexfortschreibung (BERECHNET)', belastbarkeit: 'niedrig', ep_berechnet: true, beleg_pflicht: false, eingefroren: false }),
  buero({ rang: 10, art: 'kostenanschlag', name: 'Kostenanschlag (eingefroren)', belastbarkeit: 'mittel', ep_berechnet: false, beleg_pflicht: false, eingefroren: true }),
];

// --- 11. AmpelSchwelle ---------------------------------------------------
const ampelSchwelle = [
  buero({ kontext: 'mengenabweichung', gruen_bis: 0.10, gelb_bis: 0.20, hinweis: 'darüber rot' }),
  buero({ kontext: 'preisabweichung', gruen_bis: 0.10, gelb_bis: 0.20, hinweis: 'darüber rot' }),
  buero({ kontext: 'soll_waechter', gruen_bis: 0.05, gelb_bis: 0.10, hinweis: 'Ampel „Modell hat sich geändert" — KEIN Fehler, kein Blocker' }),
];

// --- 12. StlbKatalog ----------------------------------------------------
const stlbKatalog = [
  buero({ lb: '000', name: 'Sicherheitseinrichtungen, Baustelleneinrichtungen' }),
  buero({ lb: '002', name: 'Erdarbeiten' }),
  buero({ lb: '012', name: 'Mauerarbeiten' }),
  buero({ lb: '013', name: 'Betonarbeiten' }),
  buero({ lb: '016', name: 'Zimmer- und Holzbauarbeiten' }),
  buero({ lb: '018', name: 'Abdichtungsarbeiten' }),
  buero({ lb: '020', name: 'Dachdeckungsarbeiten' }),
  buero({ lb: '023', name: 'Putz- und Stuckarbeiten' }),
  buero({ lb: '024', name: 'Fliesen- und Plattenarbeiten' }),
  buero({ lb: '027', name: 'Tischlerarbeiten' }),
  buero({ lb: '029', name: 'Beschlagarbeiten' }),
  buero({ lb: '031', name: 'Metallbauarbeiten' }),
  buero({ lb: '034', name: 'Maler- und Lackierarbeiten' }),
  buero({ lb: '036', name: 'Bodenbelagarbeiten' }),
  buero({ lb: '039', name: 'Trockenbauarbeiten' }),
  buero({ lb: '040', name: 'Abbruch- und Rückbauarbeiten' }),
];

// --- 13. ReferenzpreisPool ---------------------------------------------
// Startet LEER — ein erfundener Referenzpreis ist schlimmer als kein Referenzpreis.
// Gefüllt wird der Pool aus echten Projekten (Plan 33-03/W5, harvest_<Referenz-ID>).
const referenzpreisPool = [];

// --- 14. PreisUebernahmeRegel -----------------------------------------
const preisUebernahmeRegel = [
  buero({ name: 'Vertragspreis immer übernehmen', von: 'vertrag', bedingung: 'immer', index_anpassen: false, prio: 10 }),
  buero({ name: 'Geprüftes Angebot übernehmen', von: 'angebot_geprueft', bedingung: 'kein_vertragspreis', index_anpassen: false, prio: 20 }),
  buero({ name: 'Referenzpreis indexieren', von: 'referenz_pool', bedingung: 'kein_angebot', index_anpassen: true, prio: 30 }),
  buero({ name: 'STLB-Richtwert nur mit Kennzeichnung', von: 'stlb_richtwert', bedingung: 'kein_referenzpreis', index_anpassen: true, prio: 40, kennzeichnung_pflicht: true }),
  // --- Phase 33 / W7: die SCHWELLEN der Kurztext-Kaskade als DATEN ----------
  // Diese sechs Zahlen entscheiden, ob ein Preis aus einem Fremdprojekt
  // übernommen, zur Sichtung gestellt oder verworfen wird. Als Literale im Code
  // wären sie unauffindbar und unveränderbar — und jede Anpassung wäre ein
  // Programmwechsel statt einer Katalogpflege. `referenzPreise.js` enthält
  // deshalb KEINE dieser Zahlen (grep-Gate).
  buero({
    name: 'Referenzpreis aus Fremdprojekt (Kurztext-Match)',
    von: 'referenz_projekt', bedingung: 'oz_match', prio: 25,
    verfahren: 'Ratcliff/Obershelp (difflib-deckungsgleich) auf normalisierten Kurztexten',
    einheit_muss_gleich: true,      // verschiedene Einheiten sind nie vergleichbar
    min_similarity: 0.75,           // ab hier ÜBERNAHME
    review_von: 0.55,               // 0,55 … 0,75 ⇒ sichtbar, aber NICHT aktiv
    ratio_min: 0.4,                 // EP/Basis darunter ⇒ Ausreißer
    ratio_max: 3.0,                 // EP/Basis darüber ⇒ Ausreißer
    verwerfen_wenn_nahe_basis: 0.01, // ±1 % um die Basis ⇒ kein Gewinn, Index bleibt
    hinweis:
      'Die 1-%-Verwerfung ist kein Detail: ein Referenzpreis auf 2020er-Niveau bringt gegenüber '
      + 'der Indexfortschreibung nichts und würde eine Preisbewegung nur vortäuschen.',
  }),
  buero({
    name: 'STLB-Bau-Zuordnung (Kurztext-Match)',
    von: 'stlb_katalog', bedingung: 'kurztext_match', prio: 45,
    verfahren: '0,6 × Ratcliff/Obershelp + 0,4 × Jaccard über die Tokenmenge',
    gewicht_ratcliff: 0.6,
    gewicht_jaccard: 0.4,
    stufe_hoch_ab: 0.82,
    stufe_mittel_ab: 0.6,
    // Der wichtigste Eintrag dieses Katalogs: die STLB-Zuordnung liefert einen
    // SCHLÜSSEL, nie einen Preis. Ohne DBD-BIM-Zugang gibt es keinen EP — und ein
    // erfundener wäre schlimmer als keiner.
    liefert_ep: false,
    hinweis:
      'Ergebnis ist ein STLB-Schlüssel mit Stufe, KEIN Einheitspreis. Ohne DBD-BIM-Zugang '
      + 'ist eine STLB-Position nicht bepreisbar; das steht so in der UI.',
  }),
];

/** Alle Startdaten je Katalog-Entität. */
export function catalogSeed() {
  return {
    Din276Katalog: din276,
    KgRegel: kgRegel,
    MengenMuster: mengenMuster,
    AusschlussGrund: ausschlussGrund,
    MengenbasisKatalog: mengenbasisKatalog,
    EinheitenKatalog: einheitenKatalog,
    StatusKonvention: statusKonvention,
    BaustoffKonvention: baustoffKonvention,
    Preisindexreihe: preisindexreihe,
    PreisRangfolge: preisRangfolge,
    AmpelSchwelle: ampelSchwelle,
    StlbKatalog: stlbKatalog,
    ReferenzpreisPool: referenzpreisPool,
    PreisUebernahmeRegel: preisUebernahmeRegel,
  };
}

/**
 * Legt fehlende Katalog-Datensätze an (idempotent, EIN persist je Katalog).
 * Vorhandene Kataloge werden NICHT überschrieben — der Bürostandard darf vom
 * Büro editiert werden, ohne beim nächsten Start zurückgesetzt zu werden.
 */
export function seedCatalogs(db) {
  const seed = catalogSeed();
  const report = {};
  for (const [entity, records] of Object.entries(seed)) {
    const vorhanden = db.list(entity)?.length || 0;
    if (vorhanden > 0 || records.length === 0) {
      report[entity] = { angelegt: 0, vorhanden };
      continue;
    }
    const created = db.bulkCreate(entity, records);
    report[entity] = { angelegt: created.length, vorhanden: 0 };
  }
  return report;
}
