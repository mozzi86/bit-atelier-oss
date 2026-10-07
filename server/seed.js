// Seeds db.json with sample data. Run with `npm run seed` (overwrites existing data).
// Phase 31: projects/contacts kommen aus nova-core seed-data; DB via createDb-Factory.
// 72-01 A-7: Seed-Projekte werden beim SCHREIBEN auf Keys normalisiert
// (status/climate_zone/hoai_phase) — dieselbe Abbildung, die die UI beim Lesen
// anwendet (@core/lib/labels.js). Bestehende db.json wird NICHT editiert; alte
// Label-Werte bleiben lesbar (normalisiereProjekt mappt sie beim Laden).
import { datenPfad } from './datenPfad.js';
import { createDb } from '../packages/nova-core/server/db.js';
import { projects, contacts } from '../packages/nova-core/server/seed-data.js';
import { normalisiereProjekt } from '../packages/nova-core/src/lib/labels.js';
import { demoDatensaetze } from './demo-data.js';
// Phase 79: accounting sample data relative to today (import-free, no alias hook needed).
import { beispielDatensaetze } from '../src/lib/accounting/beispielDaten.js';

// 83-03: same data folder as the server (BIT_DATA_DIR, default server/).
const db = createDb(datenPfad('db.json'));

const iso = (d) => new Date(d).toISOString();

const changeOrders = [
  { id: 'co-1', project_name: 'Stadtquartier Nordhang', title: 'Zusätzliche Tiefgaragenstellplätze', cost_impact: 145000, status: 'approved', submission_date: iso('2026-04-10') },
  { id: 'co-2', project_name: 'Stadtquartier Nordhang', title: 'Upgrade Wärmepumpenanlage', cost_impact: 68000, status: 'pending', submission_date: iso('2026-05-12') },
  { id: 'co-3', project_name: 'Bürocampus Parkseite', title: 'Änderung Fassadenraster', cost_impact: -23000, status: 'approved', submission_date: iso('2026-05-22') },
  { id: 'co-4', project_name: 'Bürocampus Parkseite', title: 'Mehrleistung Brandschutz', cost_impact: 91500, status: 'rejected', submission_date: iso('2026-05-30') },
];

const landListings = [
  { id: 'll-1', title: 'Gewerbegrundstück A66', location: { address: 'Gewerbering 5', city: 'Musterstadt' }, land_area: 7200, asking_price: 4200000, minimum_investment: 250000, profit_share_percentage: 12, status: 'active', owner_id: 'local-user-1' },
  { id: 'll-2', title: 'Wohnbaugrundstück Isarvorstadt', location: { address: 'Werkstraße 30', city: 'München' }, land_area: 3100, asking_price: 8900000, minimum_investment: 500000, profit_share_percentage: 9, status: 'in_negotiation', owner_id: 'local-user-1' },
  { id: 'll-3', title: 'Mischgebiet Hafencity-Nord', location: { address: 'Kaistraße 1', city: 'Hamburg' }, land_area: 11500, asking_price: 15500000, minimum_investment: 1000000, profit_share_percentage: 15, status: 'active', owner_id: 'local-user-1' },
];

const buildings = [
  { id: 'bld-1', project_id: 'proj-1', name: 'Bauteil A', usage_type: 'Wohnen', area_net: 1800, floors: 6 },
  { id: 'bld-2', project_id: 'proj-2', name: 'Hauptgebäude', usage_type: 'Büro', area_net: 4200, floors: 8 },
];

const issues = [
  { id: 'iss-1', project_id: 'proj-1', building_id: 'bld-1', title: 'Kollision Lüftungskanal / Unterzug', description: 'TGA-Trasse kreuzt Unterzug in der Tiefgaragendecke.', priority: 'high', status: 'open', assignee: 'Klein Energietechnik', element_id: 'guid-4', location: { x: 5, y: 7.5, z: 4 } },
  { id: 'iss-2', project_id: 'proj-1', building_id: 'bld-1', title: 'Fenster-U-Wert prüfen', description: 'GEG-Nachweis: Verglasung im 4. OG überschreitet U-Wert.', priority: 'medium', status: 'in_progress', assignee: 'Dr. Anna Weber', element_id: 'guid-2', location: { x: -4, y: 13.5, z: -3 } },
  { id: 'iss-3', project_id: 'proj-1', building_id: 'bld-1', title: 'Brandschutztür fehlt', description: 'Im Treppenraum EG fehlt die T30-Tür laut Brandschutzkonzept.', priority: 'critical', status: 'open', assignee: 'Bauleitung', element_id: 'guid-3', location: { x: 0, y: 2.5, z: 5 } },
  { id: 'iss-4', project_id: 'proj-1', building_id: 'bld-1', title: 'Bewehrungsüberdeckung Stütze', description: 'Betondeckung an Stütze C3 dokumentieren.', priority: 'low', status: 'resolved', assignee: 'BetonBau GmbH', element_id: 'guid-1', location: { x: -6, y: 10, z: 4 } },
];

const energyScenarios = [
  {
    id: 'es-1', project_id: 'proj-1', name: 'Basisvariante GEG',
    inputs: { setpoints: { heating: 20, cooling: 26 }, try_dataset: 'TRY2015_Zone7' },
    results: { qh_annual: 412000, qc_annual: 88000, pe_annual: 690000, co2_annual: 142000, monthly_results: [] },
    geg_compliance: { reference_demand: 750000, calculated_demand: 690000, compliance_factor: 0.92, passes_geg: true },
    calculation_date: iso('2026-05-18'),
  },
];

// Autonomous site units for the live control center (x,y in 0-100 plan coords).
const siteUnits = [
  { id: 'u-r1', project_id: 'proj-1', type: 'robot', name: 'Bagger-Bot A1', status: 'working', battery: 82, x: 30, y: 35, target: null, task: 'Aushub Baugrube', area: 'Rohbau Nord' },
  { id: 'u-r2', project_id: 'proj-1', type: 'robot', name: 'Maurer-Bot M3', status: 'loading', battery: 64, x: 18, y: 70, target: null, task: 'Material aufnehmen', area: 'Logistik' },
  { id: 'u-r3', project_id: 'proj-1', type: 'robot', name: 'Transport-Bot T7', status: 'enroute', battery: 51, x: 50, y: 55, target: { x: 72, y: 30 }, task: 'Transport zu Rohbau Süd', area: 'Logistik' },
  { id: 'u-r4', project_id: 'proj-1', type: 'robot', name: 'Schweiß-Bot S2', status: 'charging', battery: 19, x: 88, y: 82, target: null, task: 'Laden', area: 'Ladezone' },
  { id: 'u-d1', project_id: 'proj-1', type: 'drone', name: 'Inspektions-Drohne D1', status: 'working', battery: 73, x: 60, y: 20, target: { x: 40, y: 25 }, task: 'Fortschritts-Scan', area: 'Rohbau Nord' },
  { id: 'u-d2', project_id: 'proj-1', type: 'drone', name: 'Vermessungs-Drohne D2', status: 'idle', battery: 95, x: 85, y: 15, target: null, task: 'Bereit', area: 'Basis' },
  { id: 'u-t1', project_id: 'proj-1', type: 'truck', name: 'Auto-LKW Beton L4', status: 'enroute', battery: 67, x: 8, y: 50, target: { x: 45, y: 78 }, task: 'Anlieferung Beton', area: 'Zufahrt' },
  { id: 'u-t2', project_id: 'proj-1', type: 'truck', name: 'Auto-LKW Stahl L9', status: 'loading', battery: 88, x: 12, y: 88, target: null, task: 'Entladen Bewehrung', area: 'Abladezone' },
  { id: 'u-p1', project_id: 'proj-1', type: 'printer', name: 'Beton-3D-Drucker P1', status: 'working', battery: 100, x: 72, y: 62, target: null, task: 'Druck Wandsegment W12', area: 'Rohbau Süd' },
];

const iso2 = (d) => new Date(d).toISOString();
// Bauzeitenplan tasks. Dates spread around 2026-06-03 so notification
// thresholds (1 week / 3 days / 10 hours) demonstrate clearly.
const scheduleTasks = [
  { id: 'st-1', project_id: 'proj-1', name: 'Bodenplatte betonieren', trade: 'Rohbau', area: 'Rohbau Nord', company_contact_id: 'c-4', company_name: 'BetonBau GmbH', assignee_name: 'Polier Schmidt', start_date: iso2('2026-05-28T07:00:00'), end_date: iso2('2026-06-05T17:00:00'), progress: 60, status: 'in_progress', budget: 320000 },
  { id: 'st-2', project_id: 'proj-1', name: 'Bewehrung Kellerdecke', trade: 'Rohbau', area: 'Rohbau Nord', company_contact_id: 'c-4', company_name: 'BetonBau GmbH', assignee_name: 'Polier Schmidt', start_date: iso2('2026-06-04T07:00:00'), end_date: iso2('2026-06-09T17:00:00'), progress: 0, status: 'planned', budget: 185000 },
  { id: 'st-3', project_id: 'proj-1', name: 'TGA Grobinstallation', trade: 'TGA', area: 'TGA', company_contact_id: 'c-2', company_name: 'Klein Energietechnik', assignee_name: 'Markus Klein', start_date: iso2('2026-06-06T07:00:00'), end_date: iso2('2026-06-14T17:00:00'), progress: 0, status: 'planned', budget: 410000 },
  { id: 'st-4', project_id: 'proj-1', name: 'Fassade Pfosten-Riegel', trade: 'Fassade', area: 'Fassade', company_contact_id: 'c-5', company_name: 'Glasfassaden Süd AG', assignee_name: 'Glasfassaden Süd', start_date: iso2('2026-06-10T07:00:00'), end_date: iso2('2026-06-24T17:00:00'), progress: 0, status: 'planned', budget: 690000 },
  { id: 'st-5', project_id: 'proj-1', name: 'Statische Prüfung Decke', trade: 'Tragwerk', area: 'Rohbau Nord', company_contact_id: 'c-1', company_name: 'Weber + Partner Ingenieure', assignee_name: 'Dr. Anna Weber', start_date: iso2('2026-06-03T13:00:00'), end_date: iso2('2026-06-03T18:00:00'), progress: 20, status: 'in_progress', budget: 25000 },
  { id: 'st-6', project_id: 'proj-1', name: 'Außenanlagen Erschließung', trade: 'Tiefbau', area: 'Außenanlagen', company_contact_id: 'c-4', company_name: 'BetonBau GmbH', assignee_name: 'Polier Schmidt', start_date: iso2('2026-06-20T07:00:00'), end_date: iso2('2026-07-04T17:00:00'), progress: 0, status: 'planned', budget: 240000 },
];

// --- AVA: KEINE Beispiel-Positionen im Hauptprojekt (Phase 33 / W3) --------
// Die 7 Beispiel-LV-Positionen samt Ausschreibungen, Angeboten und Aufmaßen lagen
// bisher an `proj-1`, also im „echten" Projekt: der AVA-Reiter startete mit sieben
// erfundenen Positionen zu erfundenen Preisen, die im Kostenanschlag genauso
// aussahen wie belegte. Sie liegen jetzt vollständig im ISOLIERTEN Demoprojekt
// (`server/demo-data.js`, Projekt „Demoprojekt AVA (Beispieldaten)") — dort mit
// allem, was dazugehört, und an jedem Satz als `demo: true` erkennbar.
// Die echten Projekte starten mit einem LEEREN Leistungsverzeichnis; gefüllt wird
// es durch Import (GAEB 90 / Bundle) oder durch Mengenregeln auf dem Modell.

// BIM-2.0 space program (Raumprogramm) for the Komplex-Designer.
const spacePrograms = [
  {
    id: 'sp-1', project_id: 'proj-1', footprint: 900, site_area: 3500, efficiency: 0.8,
    items: [
      { use: 'parken', area: 25, count: 60 },
      { use: 'handel', area: 150, count: 5 },
      { use: 'buero', area: 25, count: 80 },
      { use: 'wohnen', area: 70, count: 64 },
    ],
  },
];

// BIM-2.0 collaboration comments (pins in the 3D model).
const comments = [
  { id: 'cm-1', project_id: 'proj-1', building_id: 'bld-1', location: { x: 3, y: 7.5, z: 3 }, author: 'A. Weber', text: 'Sollte die Stütze hier nicht 40cm sein?', resolved: false, created_date: iso('2026-06-02T09:15:00') },
  { id: 'cm-2', project_id: 'proj-1', building_id: 'bld-1', location: { x: -4, y: 13, z: -2 }, author: 'M. Klein', text: 'Lüftungstrasse mit TGA abstimmen.', resolved: true, created_date: iso('2026-06-01T14:30:00') },
];

// BIM-2.0 model versions (commits) for proj-1.
const modelVersions = [
  { id: 'mv-1', project_id: 'proj-1', version: 1, message: 'Entwurf Grundlagen', author: 'Du', created_date: iso('2026-04-18T10:00:00'), snapshot: { gebaeude: 1, offene_tickets: 4, kommentare: 1, lv_positionen: 5, kostenanschlag_eur: 980000, ausschreibungen: 1, vergeben: 0, vorgaenge: 6, bgf_m2: 7200 } },
  { id: 'mv-2', project_id: 'proj-1', version: 2, message: 'Nach Bauherren-Termin', author: 'Du', created_date: iso('2026-05-20T16:30:00'), snapshot: { gebaeude: 1, offene_tickets: 3, kommentare: 2, lv_positionen: 7, kostenanschlag_eur: 1372300, ausschreibungen: 3, vergeben: 1, vorgaenge: 6, bgf_m2: 8075 } },
];

// Das isolierte Demoprojekt kommt als EIGENES Projekt dazu — nicht in proj-1.
const demoDaten = demoDatensaetze();

// 72-01 A-7: Seed-Projekte (nova-core + Demo) auf Keys normalisieren — EINE
// Wertegeneration für neue Datensätze; die Anzeige läuft über @core/lib/labels.
const seedProjekte = [...projects, ...demoDaten.Project].map(normalisiereProjekt);

// Phase 79 (79-01): the books of the sample office, relative to the day of
// seeding (local calendar day, as the app computes "today"). Adds Setting
// {key:"buchhaltung"}, the 13 accounting collections and two HoaiPlans.
const jetzt = new Date();
const heuteIso = `${jetzt.getFullYear()}-${String(jetzt.getMonth() + 1).padStart(2, '0')}-${String(jetzt.getDate()).padStart(2, '0')}`;
const buchhaltung = beispielDatensaetze(heuteIso);

db._reset({
  SiteUnit: siteUnits,
  ScheduleTask: scheduleTasks,
  SpaceProgram: spacePrograms,
  Comment: comments,
  ModelVersion: modelVersions,
  LVPosition: demoDaten.LVPosition,
  Tender: demoDaten.Tender,
  Bid: demoDaten.Bid,
  Measurement: demoDaten.Measurement,
  PriceReference: demoDaten.PriceReference,
  Document: [],
  Project: seedProjekte,
  Contact: contacts,
  ChangeOrder: changeOrders,
  LandListing: landListings,
  EnergyScenario: energyScenarios,
  Building: buildings,
  Issue: issues,
  BuildingComplex: [],
  BIMModel: [],
  InvestmentBid: [],
  ProjectContract: [],
  ...buchhaltung,
});

const echteProjekte = projects.map((p) => p.id);
console.log('Seeded db.json with sample BIT-Atelier data.');
console.log(
  `[ava] ${echteProjekte.length} Projekte ohne LV-Positionen (leeres Leistungsverzeichnis), `
  + `${demoDaten.LVPosition.length} Demo-Positionen im isolierten Projekt "${demoDaten.Project[0].name}".`
);
