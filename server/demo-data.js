// ISOLIERTES DEMOPROJEKT (Phase 33 / W3).
//
// Hier liegt die gesamte AVA-Demo-Substanz, die vorher im Produktivpfad stand:
//
//   1. die 7 Beispiel-LV-Positionen (bisher direkt in `server/seed.js` unter `proj-1`,
//      also im „echten" Projekt),
//   2. die 9 Positionen der Kubatur-Schätzung mit ihren HART KODIERTEN Einheitspreisen
//      (28/95/210/120/180/145/850/620/175 €) aus `@ava/lib/bimQuantities.js#computeBimQuantities`,
//   3. der Referenzpreis-Demokorpus `DEMO_BENCHMARKS` (bisher Konstante in
//      `@ava/lib/priceReference.js`, per Knopf in das gerade geöffnete Projekt geschrieben).
//
// WARUM DAS UMZIEHT: alle drei sahen im Kostenanschlag genauso aus wie belegte Zahlen.
// Eine Demoposition zu 850 €/St ist im Reiter nicht von einem geprüften Angebotspreis zu
// unterscheiden — und in einem Werkzeug, das Kostenberechnungen liefert, ist das der
// gefährlichste Fehler, den man bauen kann. Als eigenes Projekt bleibt die Demo für
// Vorführungen vollständig erhalten, kann aber nie mit einem echten Projekt verwechselt
// werden: Name, `demo: true` und `preis_herkunft: "demo"` sagen es an jedem Datensatz.
//
// Diese Datei liegt in `server/` (App-Wurzel) und damit AUSSERHALB jeder Paket-Allowlist
// von `scripts/assemble.mjs` — sie wandert in keinen Kundenspiegel.

export const DEMO_PROJEKT_ID = 'proj-demo-ava';

export const demoProject = {
  id: DEMO_PROJEKT_ID,
  name: 'Demoprojekt AVA (Beispieldaten)',
  demo: true,
  status: 'concept',
  location: { city: 'Musterstadt', address: 'Beispielweg 1' },
  description:
    'Reines Anschauungsprojekt: alle Mengen und Preise sind erfunden. Dient dazu, '
    + 'Ausschreibung, Preisspiegel und Abrechnung ohne echte Projektdaten zu zeigen.',
  climate_zone: 'zone_7',
  energy_target: 'geg',
};

const demo = (o) => ({ ...o, project_id: DEMO_PROJEKT_ID, demo: true, preis_herkunft: 'demo' });

// --- 1. Die bisherigen 7 Seed-Positionen (unverändert bis auf die Isolierung) ----------
// `status: 'estimated'` ist ENTFALLEN: der Wert wurde nirgends gelesen und suggerierte
// eine Preisqualität, die es nicht gab.
export const demoLvPositionen = [
  demo({ id: 'lv-1', oz: '1.1.10', trade: 'Rohbau', title: 'Beton Bodenplatte C25/30', short_text: 'Stahlbeton Bodenplatte, d=40cm', long_text: 'Liefern und Einbau von Ortbeton C25/30 für die Bodenplatte, Dicke 40 cm, inkl. Verdichten und Nachbehandlung gemäß DIN EN 206/DIN 1045.', unit: 'm³', quantity: 320, unit_price: 165, din276: '320', mengen_modus: 'handeingabe', handeingabe_grund: 'Demo-Wert', nachweis_element_ids: [] }),
  demo({ id: 'lv-2', oz: '1.1.20', trade: 'Rohbau', title: 'Stahlbetonwände C30/37', short_text: 'Tragende Innenwände, d=24cm', long_text: 'Herstellen tragender Stahlbetonwände C30/37, Wanddicke 24 cm, inkl. Schalung beidseitig und Bewehrung nach Statik.', unit: 'm²', quantity: 1450, unit_price: 92, din276: '341', mengen_modus: 'handeingabe', handeingabe_grund: 'Demo-Wert', nachweis_element_ids: [] }),
  demo({ id: 'lv-3', oz: '1.1.30', trade: 'Rohbau', title: 'Bewehrungsstahl B500B', short_text: 'Betonstahl liefern/verlegen', long_text: 'Liefern, schneiden, biegen und verlegen von Betonstahl B500B nach Bewehrungsplan, inkl. Abstandhalter.', unit: 't', quantity: 78, unit_price: 1450, din276: '320', mengen_modus: 'handeingabe', handeingabe_grund: 'Demo-Wert', nachweis_element_ids: [] }),
  demo({ id: 'lv-4', oz: '2.1.10', trade: 'Fassade', title: 'Pfosten-Riegel-Fassade', short_text: 'Alu-Glas-Fassade, 3-fach Verglasung', long_text: 'Liefern und Montieren einer Pfosten-Riegel-Fassade aus Aluminium mit 3-fach-Wärmeschutzverglasung, Ug ≤ 0,6 W/m²K, inkl. Sonnenschutz.', unit: 'm²', quantity: 980, unit_price: 720, din276: '334', mengen_modus: 'handeingabe', handeingabe_grund: 'Demo-Wert', nachweis_element_ids: [] }),
  demo({ id: 'lv-5', oz: '2.2.10', trade: 'Fassade', title: 'WDVS Putzfassade', short_text: 'Wärmedämmverbundsystem 16cm', long_text: 'Wärmedämmverbundsystem mit Mineralwolle 160 mm, armiert, Oberputz mineralisch, inkl. Sockelabschluss.', unit: 'm²', quantity: 640, unit_price: 135, din276: '332', mengen_modus: 'handeingabe', handeingabe_grund: 'Demo-Wert', nachweis_element_ids: [] }),
  demo({ id: 'lv-6', oz: '3.1.10', trade: 'TGA', title: 'Wärmepumpe Sole/Wasser', short_text: 'WP 120 kW inkl. Erdsonden', long_text: 'Liefern und Inbetriebnahme einer Sole/Wasser-Wärmepumpe 120 kW inkl. Erdsondenfeld, Pufferspeicher und Hydraulik nach GEG.', unit: 'Stk', quantity: 2, unit_price: 68000, din276: '421', mengen_modus: 'handeingabe', handeingabe_grund: 'Demo-Wert', nachweis_element_ids: [] }),
  demo({ id: 'lv-7', oz: '3.2.10', trade: 'TGA', title: 'Lüftungsgerät mit WRG', short_text: 'RLT-Gerät, 12.000 m³/h', long_text: 'Zentrales Lüftungsgerät mit Wärmerückgewinnung (η ≥ 80 %), Volumenstrom 12.000 m³/h, inkl. Kanalnetz Hauptverteilung.', unit: 'Stk', quantity: 1, unit_price: 145000, din276: '430', mengen_modus: 'handeingabe', handeingabe_grund: 'Demo-Wert', nachweis_element_ids: [] }),
];

// --- 2. Die 9 Positionen der entfallenen Kubatur-Schätzung -----------------------------
// Mengen für ein 20 × 14 m großes Beispielgebäude mit 4 Geschossen, damit die Zeilen
// plausibel aussehen. Preise: exakt die früher im Quelltext verdrahteten Werte.
export const demoKubaturPositionen = [
  demo({ id: 'lv-demo-01', oz: '01.01.0010', trade: 'Erdarbeiten', title: 'Baugrube / Erdaushub (3,0 m Tiefe)', unit: 'm³', quantity: 840, unit_price: 28, din276: '311', mengen_modus: 'handeingabe', handeingabe_grund: 'Kubatur-Schätzung (Demo)' }),
  demo({ id: 'lv-demo-02', oz: '01.02.0010', trade: 'Rohbau', title: 'Bodenplatte Stahlbeton', unit: 'm²', quantity: 280, unit_price: 95, din276: '322', mengen_modus: 'handeingabe', handeingabe_grund: 'Kubatur-Schätzung (Demo)' }),
  demo({ id: 'lv-demo-03', oz: '02.01.0010', trade: 'Rohbau', title: 'Außenwände Gebäudehülle (abzgl. Öffnungen)', unit: 'm²', quantity: 748, unit_price: 210, din276: '332', mengen_modus: 'handeingabe', handeingabe_grund: 'Kubatur-Schätzung (Demo)' }),
  demo({ id: 'lv-demo-04', oz: '02.02.0010', trade: 'Ausbau', title: 'Innenwände (abzgl. Öffnungen)', unit: 'm²', quantity: 412, unit_price: 120, din276: '342', mengen_modus: 'handeingabe', handeingabe_grund: 'Kubatur-Schätzung (Demo)' }),
  demo({ id: 'lv-demo-05', oz: '02.03.0010', trade: 'Rohbau', title: 'Stützen Stahlbeton', unit: 'm', quantity: 36, unit_price: 180, din276: '343', mengen_modus: 'handeingabe', handeingabe_grund: 'Kubatur-Schätzung (Demo)' }),
  demo({ id: 'lv-demo-06', oz: '03.01.0010', trade: 'Rohbau', title: 'Geschossdecken Stahlbeton', unit: 'm²', quantity: 1120, unit_price: 145, din276: '351', mengen_modus: 'handeingabe', handeingabe_grund: 'Kubatur-Schätzung (Demo)' }),
  demo({ id: 'lv-demo-07', oz: '04.01.0010', trade: 'Fassade', title: 'Fenster liefern und einbauen', unit: 'St', quantity: 48, unit_price: 850, din276: '334', mengen_modus: 'handeingabe', handeingabe_grund: 'Kubatur-Schätzung (Demo)' }),
  demo({ id: 'lv-demo-08', oz: '04.02.0010', trade: 'Ausbau', title: 'Türen liefern und einbauen', unit: 'St', quantity: 62, unit_price: 620, din276: '344', mengen_modus: 'handeingabe', handeingabe_grund: 'Kubatur-Schätzung (Demo)' }),
  demo({ id: 'lv-demo-09', oz: '05.01.0010', trade: 'Dach', title: 'Dachfläche Flachdach', unit: 'm²', quantity: 280, unit_price: 175, din276: '363', mengen_modus: 'handeingabe', handeingabe_grund: 'Kubatur-Schätzung (Demo)' }),
];

// --- Ausschreibungen / Angebote / Aufmaße des Demoprojekts ------------------------------
const iso = (d) => new Date(d).toISOString();

export const demoTenders = [
  { id: 'td-1', project_id: DEMO_PROJEKT_ID, demo: true, name: 'Ausschreibung Rohbau', trade: 'Rohbau', status: 'awarded', deadline: iso('2026-05-15'), position_ids: ['lv-1', 'lv-2', 'lv-3'], invited_contact_ids: ['c-4'], awarded_bid_id: 'bid-1', created_date: iso('2026-04-20') },
  { id: 'td-2', project_id: DEMO_PROJEKT_ID, demo: true, name: 'Ausschreibung Fassade', trade: 'Fassade', status: 'published', deadline: iso('2026-06-20'), position_ids: ['lv-4', 'lv-5'], invited_contact_ids: ['c-5'], awarded_bid_id: null, created_date: iso('2026-05-25') },
  { id: 'td-3', project_id: DEMO_PROJEKT_ID, demo: true, name: 'Ausschreibung TGA', trade: 'TGA', status: 'draft', deadline: iso('2026-07-01'), position_ids: ['lv-6', 'lv-7'], invited_contact_ids: ['c-2'], awarded_bid_id: null, created_date: iso('2026-06-01') },
];

export const demoBids = [
  { id: 'bid-1', tender_id: 'td-1', project_id: DEMO_PROJEKT_ID, demo: true, contact_id: 'c-4', bidder_name: 'BetonBau GmbH', submitted_date: iso('2026-05-10'), status: 'awarded', note: 'Inkl. Nachlass 3 %', line_items: [{ position_id: 'lv-1', unit_price: 158 }, { position_id: 'lv-2', unit_price: 88 }, { position_id: 'lv-3', unit_price: 1420 }] },
  { id: 'bid-2', tender_id: 'td-1', project_id: DEMO_PROJEKT_ID, demo: true, contact_id: 'c-3', bidder_name: 'Muster Bau Regional', submitted_date: iso('2026-05-12'), status: 'rejected', note: '', line_items: [{ position_id: 'lv-1', unit_price: 172 }, { position_id: 'lv-2', unit_price: 95 }, { position_id: 'lv-3', unit_price: 1480 }] },
  { id: 'bid-3', tender_id: 'td-2', project_id: DEMO_PROJEKT_ID, demo: true, contact_id: 'c-5', bidder_name: 'Glasfassaden Süd AG', submitted_date: iso('2026-06-08'), status: 'submitted', note: 'Lieferzeit 10 Wochen', line_items: [{ position_id: 'lv-4', unit_price: 705 }, { position_id: 'lv-5', unit_price: 142 }] },
];

export const demoMeasurements = [
  { id: 'am-1', project_id: DEMO_PROJEKT_ID, demo: true, position_id: 'lv-1', tender_id: 'td-1', quantity: 318, date: iso('2026-05-28'), note: 'Aufmaß Bodenplatte geprüft' },
  { id: 'am-2', project_id: DEMO_PROJEKT_ID, demo: true, position_id: 'lv-2', tender_id: 'td-1', quantity: 640, date: iso('2026-06-02'), note: 'Teilaufmaß Wände EG/1.OG' },
];

// --- 3. Referenzpreis-Demokorpus (aus @ava/lib/priceReference.js herausgelöst) ----------
// [ASSUMED] Werte aus 28-RESEARCH-Messungen: Median deutscher Bau-Lose ≈ 213.916 €
// (DÖE-Vollauswertung); Streuung/Quartile redaktionell plausibilisiert.
// Das sind LOS-SUMMEN, keine €/Einheit — genau diese Ehrlichkeitsgrenze bleibt bestehen.
const DEMO_META = {
  ebene: 'los', currency: 'EUR', source: 'demo', license: 'Demo',
  fetched_at: '2026-07-25', query_info: 'Demo-Korpus (deterministisch, offline)',
  demo: true,
};

export const demoPriceReferences = [
  { ...DEMO_META, id: 'pr-demo-1', cpv_group: '4533', cpv_label: 'Installationsarbeiten', region: 'Bayern', year: 2025, n: 118, median: 214000, q1: 96000, q3: 487000, min: 12500, max: 3900000, avg_bidders: 3.4 },
  { ...DEMO_META, id: 'pr-demo-2', cpv_group: '4521', cpv_label: 'Hoch- und Tiefbauarbeiten', region: 'DE', year: 2025, n: 342, median: 213916, q1: 88000, q3: 620000, min: 8100, max: 12400000, avg_bidders: 4.1 },
  { ...DEMO_META, id: 'pr-demo-3', cpv_group: '4526', cpv_label: 'Dacharbeiten', region: 'DE', year: 2025, n: 87, median: 168000, q1: 71000, q3: 355000, min: 9800, max: 2100000, avg_bidders: 3.8 },
  { ...DEMO_META, id: 'pr-demo-4', cpv_group: '4540', cpv_label: 'Bauinstallation', region: 'Nordrhein-Westfalen', year: 2025, n: 64, median: 142000, q1: 58000, q3: 298000, min: 7400, max: 1750000, avg_bidders: 4.6 },
  { ...DEMO_META, id: 'pr-demo-5', cpv_group: '4511', cpv_label: 'Abbruch- und Erdarbeiten', region: 'DE', year: 2024, n: 53, median: 121000, q1: 47000, q3: 262000, min: 6200, max: 1420000, avg_bidders: 3.1 },
  { ...DEMO_META, id: 'pr-demo-6', cpv_group: '4500', cpv_label: 'Bauarbeiten', region: 'DE', year: 2025, n: 210, median: 205000, q1: 82000, q3: 540000, min: 5900, max: 9800000, avg_bidders: 3.9 },
];

/** Alle Demo-Datensätze in einem Rutsch — für `npm run seed`. */
export function demoDatensaetze() {
  return {
    Project: [demoProject],
    LVPosition: [...demoLvPositionen, ...demoKubaturPositionen],
    Tender: demoTenders,
    Bid: demoBids,
    Measurement: demoMeasurements,
    PriceReference: demoPriceReferences,
  };
}
