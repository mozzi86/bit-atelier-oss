// nova-core Seed-Daten: Demo-Projekte + Kontakte (extrahiert aus server/seed.js,
// Phase 31 — Daten byte-identisch). Monorepo-Seed UND Shell-Seeds importieren von hier.

const iso = (d) => new Date(d).toISOString();

export const projects = [
  {
    id: 'proj-1',
    build_kind: 'neubau',
    name: 'Stadtquartier Nordhang',
    client: 'Stadtwerke Musterstadt',
    location: { city: 'Frankfurt', country: 'DE', address: 'Am Nordhang 12', lat: 50.17, lng: 8.63 },
    status: 'construction',
    currency: 'EUR',
    standards: ['GEG', 'DIN_18599', 'HOAI'],
    building_area: 18500,
    climate_zone: 'Cfb',
    energy_target: 'KfW-40',
    hoai_phase: 'LP 5 - Ausführungsplanung',
    sustainability_rating: 'DGNB Gold',
    completion_date: iso('2026-09-30'),
    created_date: iso('2025-01-15'),
    updated_date: iso('2026-05-20'),
  },
  {
    id: 'proj-2',
    build_kind: 'neubau',
    name: 'Bürocampus Parkseite',
    client: 'Beispiel Immobilien GmbH',
    location: { city: 'Frankfurt', country: 'DE', address: 'Parkstraße 40', lat: 50.11, lng: 8.66 },
    status: 'design',
    currency: 'EUR',
    standards: ['GEG', 'DIN_276', 'HOAI', 'VOB'],
    building_area: 32000,
    climate_zone: 'Cfb',
    energy_target: 'KfW-55',
    hoai_phase: 'LP 3 - Entwurfsplanung',
    sustainability_rating: 'LEED Platinum',
    completion_date: iso('2027-06-15'),
    created_date: iso('2025-03-02'),
    updated_date: iso('2026-05-28'),
  },
  {
    id: 'proj-3',
    build_kind: 'neubau',
    name: 'Wohnpark am See',
    client: 'Wohnbau Süd eG',
    location: { city: 'München', country: 'DE', address: 'Uferweg 8', lat: 48.14, lng: 11.58 },
    status: 'feasibility',
    currency: 'EUR',
    standards: ['GEG', 'DIN_4108'],
    building_area: 9400,
    climate_zone: 'Cfb',
    energy_target: 'KfW-40 Plus',
    hoai_phase: 'LP 1 - Grundlagenermittlung',
    sustainability_rating: 'DGNB Silber',
    completion_date: iso('2028-03-01'),
    created_date: iso('2026-02-10'),
    updated_date: iso('2026-06-01'),
  },
  {
    id: 'proj-4',
    build_kind: 'sanierung',
    name: 'Sanierung Altstadthof',
    client: 'Privat - Bauherrschaft A',
    location: { city: 'Nürnberg', country: 'DE', address: 'Altstadtgasse 22', lat: 49.45, lng: 11.07 },
    status: 'completed',
    currency: 'EUR',
    standards: ['GEG', 'DIN_18599', 'HOAI'],
    building_area: 1250,
    climate_zone: 'Cfb',
    energy_target: 'Effizienzhaus Denkmal',
    hoai_phase: 'LP 9 - Objektbetreuung',
    sustainability_rating: 'KfW Denkmal',
    completion_date: iso('2025-11-30'),
    created_date: iso('2024-05-01'),
    updated_date: iso('2025-12-05'),
  },
];

export const contacts = [
  { id: 'c-1', name: 'Dr. Anna Weber', role: 'Tragwerksplanerin', company: 'Weber + Partner Ingenieure', email: 'a.weber@weber-partner.example', phone: '+49 000 0000001', category: 'engineer', notes: 'Statik aller Hochbauprojekte' },
  { id: 'c-2', name: 'Markus Klein', role: 'TGA-Fachplaner', company: 'Klein Energietechnik', email: 'm.klein@klein-energie.example', phone: '+49 000 0000002', category: 'engineer', notes: 'GEG-Nachweise, Wärmepumpen' },
  { id: 'c-3', name: 'Sandra Hoffmann', role: 'Projektleiterin', company: 'Stadtwerke Musterstadt', email: 's.hoffmann@stadtwerke-musterstadt.example', phone: '+49 000 0000003', category: 'client', notes: 'Ansprechpartnerin Nordhang' },
  { id: 'c-4', name: 'BetonBau GmbH', role: 'Rohbau', company: 'BetonBau GmbH', email: 'kontakt@betonbau.example', phone: '+49 000 0000004', category: 'contractor', notes: 'Rahmenvertrag Rohbau' },
  { id: 'c-5', name: 'Glasfassaden Süd', role: 'Fassadenbauer', company: 'Glasfassaden Süd AG', email: 'info@glasfassaden-sued.example', phone: '+49 000 0000005', category: 'manufacturer', notes: 'Pfosten-Riegel-Fassaden' },
];

// Setting "briefkopf": Büroname für Berichte, Prüfbericht-PDF und BCF-<CreationAuthor>.
// Neutraler Platzhalter — im Kundenrepo hier den eigenen Büronamen eintragen
// (in der Haupt-App zusätzlich überschreibbar via Zahnrad „Einstellungen — Büro / Briefkopf").
export const settings = [
  {
    id: 'set-1',
    key: 'briefkopf',
    value: {
      office: 'Musterbüro Architekten',
      tagline: 'INTEGRATED PROJECT PLATFORM',
      address: 'Musterstraße 1, 12345 Musterstadt',
      contact: 'post@musterbuero-architekten.example',
    },
    created_date: iso('2026-08-23T09:00:00'),
    updated_date: iso('2026-08-23T09:00:00'),
  },
];

// 73-06 (BEST-16): survey model state of the refurbishment showcase (proj-4) so the existing-building
// path can be shown without an own IFC file: rooms (IfcSpace with DIN 277 group) for "Raumprogramm aus
// Bestand", walls with status AND Erfassungsgrad (73-04) for the quantity pots (73-08). Elements inline —
// snapshotElemente (73-03) reads inline before blob; the shape of each element is mapToClassifiedElements'.
// All names and figures are invented placeholders.
const raum = (guid, name, din, area, geschoss) => ({ id: guid, guid, kind: 'space', ifc_klasse: 'IfcSpace', name, klassifikation: din, geschoss, status: 'bestand', erfassung: 'gemessen', mengen: { area, volume: 0, length: 0, count: 1 } });
const wand = (guid, geschoss, status, erfassung, area, kg = 'KG 330', schicht = 'Klinker') => ({ id: guid, guid, kind: 'wall', ifc_klasse: 'IfcWall', geschoss, status, erfassung, kg, gewerk: 'Rohbau', schicht, mengen: { area, volume: 0, length: 0, count: 1 } });
export const bimSnapshots = [
  {
    id: 'snap-4', project_id: 'proj-4', name: 'Aufmaß Altstadthof (Beispiel)', quelle: 'IFC-Import', datei: 'aufmass-beispiel.ifc',
    schema: 'IFC4', geschosse: ['KG', 'EG', '1.OG', 'DG'], anzahl: 14, ohne_status: 1, ohne_geschoss: 0,
    erzeugt_am: '2025-06-02T09:00:00.000Z', created_date: '2025-06-02T09:00:00.000Z', updated_date: '2025-06-02T09:00:00.000Z',
    elemente_blob: null,
    elemente: [
      raum('sp-01', 'Wohnen EG', 'DIN 277: 1 Wohnen und Aufenthalt', 42.5, 'EG'),
      raum('sp-02', 'Küche EG', 'DIN 277: 1 Wohnen und Aufenthalt', 14.2, 'EG'),
      raum('sp-03', 'Büro 1.OG', 'DIN 277: 2 Büroarbeit', 38.0, '1.OG'),
      raum('sp-04', 'Besprechung 1.OG', 'DIN 277: 2 Büroarbeit', 21.4, '1.OG'),
      raum('sp-05', 'Lager KG', 'DIN 277: 4 Lagern, Verteilen und Verkaufen', 30.1, 'KG'),
      raum('sp-06', 'Atelier DG', 'DIN 277: 1 Wohnen und Aufenthalt', 55.0, 'DG'),
      wand('w-01', 'EG', 'bestand', 'gemessen', 120),
      wand('w-02', 'EG', 'abbruch', 'gemessen', 36),
      wand('w-03', '1.OG', 'bestand', 'altplan', 110),
      wand('w-04', '1.OG', 'abbruch', 'angenommen', 300),
      wand('w-05', 'DG', 'neubau', 'gemessen', 48, 'KG 340', 'Gipskarton'),
      wand('w-06', 'KG', 'bestand', 'angenommen', 90),
      wand('w-07', 'KG', 'bestand', 'abgeleitet', 64),
      { id: 'w-08', guid: 'w-08', kind: 'wall', ifc_klasse: 'IfcWall', geschoss: 'DG', status: null, erfassung: null, kg: 'KG 330', gewerk: 'Rohbau', schicht: null, mengen: { area: 22, volume: 0, length: 0, count: 1 } },
    ],
  },
];
