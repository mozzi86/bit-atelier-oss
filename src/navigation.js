// The app's navigation, in one place (Phase 65-05).
//
// It used to live inline in Layout.jsx. The command palette needs the same list,
// and a second copy would drift: a module renamed in one place and not the other
// is exactly the kind of divergence that nobody notices until a user asks why
// the search cannot find something that is in the sidebar.
//
// In:  nothing. Out: the grouped list, plus a flat one for search.
//
// Labels are German source strings and go through `t()` at the point of use —
// the dictionary is keyed by the German text (@core/lib/i18n).
//
// 72-08 (N-02): this list is the binding name table. Each title is also the h1
// of its page, so menu, heading, palette and tab title say the same thing; no
// title carries the "BIT" prefix. tests/unit/navigation.test.js checks the list
// against the routes in App.jsx and the English dictionary.

import {
  Bot,
  Box,
  Boxes,
  Briefcase,
  Calculator,
  CalendarClock,
  ClipboardList,
  HardHat,
  Cloud,
  Coins,
  Euro,
  FileSpreadsheet,
  FileText,
  FolderKanban,
  Gauge,
  Handshake,
  History,
  IdCard,
  Landmark,
  LayoutDashboard,
  Mail,
  PencilRuler,
  PenTool,
  Radio,
  Settings,
  ShieldCheck,
  Timer,
  TreePalm,
  Users,
  Wrench,
} from 'lucide-react';
import { darf } from '@core/lib/rechte.js';

// Local stand-in for createPageUrl from '@core/utils'. That module is a
// TypeScript index file, which the node alias hook of the unit tests cannot
// load, so importing it made this list untestable. Same result: createPageUrl
// only replaces spaces, and no route name here contains one.
const seite = (name) => '/' + name;

/**
 * One sidebar entry.
 *
 * `projektfrei`: the module is usable without an active project (e.g. it works
 * on a file the user opens). `umfang: 'portfolio'`: the module spans all
 * projects instead of the active one. Both are read by the shell (N-05); an
 * entry without them is a module of the active project.
 * `zugang: 'personal'` (80-01): the entry is shown only with personnel access
 * (src/lib/people/zugang.js) — see navSichtbar().
 * `breite: 'voll'` (75-16): a drawing page — the shell lifts the 1280 px
 * page cap (max-w-7xl) for it with ONE css rule, see seitenBreite().
 *
 * `modul` (82-01): the rights module of the entry (@core/lib/rechte.js MODULE) — the
 * shell's gate (huellenZustand rule 0) and navSichtbar read it.
 * `netz` (70-06, register Nr. 50): what a module needs the internet for — absent = works fully offline
 * (local app: own server on this computer); 'teilweise' = some parts need the internet (map tiles, climate,
 * flood data, price search), 'noetig' = the module's purpose needs it (external AI provider). The sidebar
 * marks these entries while the device is offline.
 * `phase` (decision 2026-10-13, NAV-PLAN): the FIRST station of the office workflow
 * where the module is used — 0 office setup, 1 offer, 2 contract, 3 LP 1–2, 4 LP 3–4,
 * 5 LP 5, 6 LP 6–7 tendering, 7 award/change orders, 8 LP 8 site, 9 LP 9 warranty,
 * 10 office year cycle. `querschnitt: true` instead for modules used in every phase
 * (time, controlling, correspondence, overview). Labor entries carry neither. The
 * sidebar order, WeiterMit and the palette read this one field; a later phase bar in
 * the project will too.
 *
 * @typedef {{
 *   title: string,
 *   url: string,
 *   icon: import('react').ComponentType<any>,
 *   labor?: boolean,
 *   projektfrei?: true,
 *   umfang?: 'portfolio',
 *   zugang?: 'personal',
 *   breite?: 'voll',
 *   netz?: 'teilweise'|'noetig',
 *   modul: string,
 *   phase?: number,
 *   querschnitt?: true,
 * }} NavEintrag
 * @typedef {{label: string, items: NavEintrag[], collapsible?: boolean}} NavGruppe
 */

/** @type {NavGruppe[]} */
export const navGroups = [
  {
    label: 'Übersicht',
    items: [
      // The h1 stays "Projektübersicht" (tests/e2e/cloud-smoke.spec.js:62),
      // so the menu follows the page, not the other way round.
      { title: 'Projektübersicht', url: seite('Dashboard'), modul: 'projekte', icon: LayoutDashboard, umfang: 'portfolio', querschnitt: true },
      { title: 'Projekte', url: seite('Projects'), modul: 'projekte', icon: FolderKanban, querschnitt: true },
      // Phase 82 (82-01, E-02): deadlines and appointments of all modules, without a project.
      { title: 'Fristen & Termine', url: seite('Deadlines'), modul: 'fristen', icon: CalendarClock, projektfrei: true, umfang: 'portfolio', querschnitt: true },
    ],
  },
  // NAV-PLAN 2026-10-13: from here the groups follow the office workflow (stations 0–10)
  // instead of the tool families (Planung, Modell & Prüfung, Ausschreibung & Kosten,
  // KI & Analyse, Zeit & Honorar). A group's station is the highest `phase` of its
  // entries; navigation.test.js guards the ascending order. URLs stay as they were.
  {
    label: 'Akquise & Auftrag',
    items: [
      // 72-01 A-13 (Befund N-08): "Energie-Analyse" is gone as an entry of its own; the
      // real calculator is the designer tab "Energie" (/EnergyAnalysis redirects, App.jsx).
      { title: 'Machbarkeit', url: seite('RealEstateFeasibility'), modul: 'planung', icon: Calculator, netz: 'teilweise', phase: 1 },
      // Phase 81 (81-01): offer, contract and change orders of the fee — stations 1–2.
      { title: 'Angebot & Auftrag', url: seite('Fees'), modul: 'auftrag', icon: Handshake, phase: 1 },
    ],
  },
  {
    label: 'Entwurf & Genehmigung',
    items: [
      { title: 'Komplex-Designer', url: seite('ComplexDesigner'), modul: 'planung', icon: PencilRuler, breite: 'voll', netz: 'teilweise', phase: 3 },
      // 94-07: the sketch tool (72-05: freehand with pen pressure, FreeCAD constraint mode) is a design tool.
      { title: 'Skizze', url: seite('SketchStudio'), modul: 'planung', icon: PenTool, projektfrei: true, phase: 3 },
      { title: 'Prüf-Suite', url: seite('ModelCheck'), modul: 'modell', icon: ShieldCheck, projektfrei: true, breite: 'voll', phase: 3 },
      { title: 'BIM-Viewer & Tickets', url: seite('BimViewer'), modul: 'modell', icon: Box, breite: 'voll', phase: 4 },
      { title: 'IFC-Viewer (LV-gekoppelt)', url: seite('IfcViewer'), modul: 'modell', icon: Boxes, projektfrei: true, phase: 4 },
      // KRITIK-14: the page stores nine key figures per stage and restores
      // nothing, so it must not promise "versions" or "commits".
      { title: 'Projektstände', url: seite('ModelVersions'), modul: 'modell', icon: History, phase: 4 },
    ],
  },
  {
    label: 'Ausführungsplanung',
    items: [
      // Phase 88: plan list, openings, sampling, H&S, permits. NAV-PLAN 2026-10-13 variant A:
      // the site diary of the former "Werkplanung & Baustelle" is the page "Baustelle" below.
      { title: 'Werkplanung', url: seite('Werkplanung'), modul: 'planung', icon: ClipboardList, phase: 5 },
    ],
  },
  {
    label: 'Ausschreibung & Vergabe',
    items: [
      { title: 'AVA (Ausschreibung)', url: seite('AVA'), modul: 'ava', icon: FileSpreadsheet, netz: 'teilweise', phase: 6 },
      { title: 'Finanzen & Nachträge', url: seite('Finance'), modul: 'finanzen', icon: Euro, phase: 7 },
    ],
  },
  {
    label: 'Bauüberwachung',
    items: [
      // NAV-PLAN 2026-10-13: site diary (88-02) on its own route, same tab components.
      { title: 'Baustelle', url: seite('Baustelle'), modul: 'planung', icon: HardHat, phase: 8 },
      // 94-07: the site control room sits next to the site diary.
      { title: 'Baustellen-Leitstand', url: seite('SiteControl'), modul: 'planung', icon: Radio, breite: 'voll', netz: 'teilweise', phase: 8 },
      // phase 8 [ASSUMED]: minutes and documents peak on site; planning minutes exist too.
      { title: 'Berichte & Dokumente', url: seite('Reports'), modul: 'berichte', icon: FileText, phase: 8 },
    ],
  },
  {
    // Cross-cutting modules, used in every station: time (also without a project,
    // office time E-17), controlling, post register and the AI hub span all projects.
    label: 'Zeit & Schriftverkehr',
    items: [
      { title: 'Zeiterfassung', url: seite('TimeTracking'), modul: 'zeiterfassung', icon: Timer, projektfrei: true, umfang: 'portfolio', querschnitt: true },
      { title: 'Projektcontrolling', url: seite('Controlling'), modul: 'controlling', icon: Gauge, umfang: 'portfolio', querschnitt: true },
      { title: 'Schriftverkehr', url: seite('Correspondence'), modul: 'schriftverkehr', icon: Mail, projektfrei: true, umfang: 'portfolio', querschnitt: true },
      { title: 'KI-Zentrale', url: seite('AIDashboard'), modul: 'ki', icon: Bot, umfang: 'portfolio', netz: 'noetig', querschnitt: true },
    ],
  },
  {
    // Station 0 (office setup) and 10 (office year cycle). E-02: "Büro" replaced the
    // former group "Stammdaten"; 80-01 added Personal and Einstellungen, 82-01
    // Abwesenheiten (Schriftverkehr moved to the cross-cutting group above).
    label: 'Büro',
    items: [
      // Phase 79: the office books span all projects and work without an active one.
      { title: 'Buchhaltung', url: seite('Accounting'), modul: 'buchhaltung', icon: Landmark, umfang: 'portfolio', projektfrei: true, phase: 10 },
      // Phase 80: HR of the office, without a project; hidden without personnel access (E-03, DS-12).
      { title: 'Personal', url: seite('People'), modul: 'personal', icon: IdCard, projektfrei: true, zugang: 'personal', phase: 0 },
      { title: 'Abwesenheiten', url: seite('Absences'), modul: 'abwesenheiten', icon: TreePalm, projektfrei: true, umfang: 'portfolio', phase: 0 },
      { title: 'Adressbuch', url: seite('AddressBook'), modul: 'adressbuch', icon: Users, projektfrei: true, phase: 0 },
      // Phase 80: the one place of all app settings (KRITIK-05).
      // 94-07: office tools out of the lab — PDF tools/filing (module berichte) and the
      // local AI harness (module ki, Phase 67-06).
      { title: 'PDF & Ablage', url: seite('BitAegis'), modul: 'berichte', icon: Cloud, projektfrei: true, phase: 0 },
      { title: 'KI Tool', url: seite('KiTool'), modul: 'ki', icon: Wrench, phase: 0 },
      { title: 'Einstellungen', url: seite('Settings'), modul: 'einstellungen', icon: Settings, projektfrei: true, phase: 0 },
    ],
  },
  {
    // 72-01 A-13 (Befunde N-08, N-18, N-19): modules that show a vision or need
    // an extra service live in "Labor" — at the bottom, collapsed by default
    // (Layout.jsx). Their routes stay reachable. 94-07 (user decision 16.10.2026):
    // Skizze, Baustellen-Leitstand, PDF & Ablage and KI Tool left the lab.
    label: 'Labor',
    collapsible: true,
    items: [
      { title: 'Investment', url: seite('InvestmentPlatform'), modul: 'labor', icon: Coins, umfang: 'portfolio' },
      { title: 'Portfolio (Projektentwicklung)', url: seite('AtelierDeveloper'), modul: 'labor', icon: Briefcase, umfang: 'portfolio' },
    ],
  },
];

/**
 * Whether the sidebar and the palette show an entry. Entries with
 * `zugang: 'personal'` depend on personnel access (80); with an access object
 * (82-01) an entry whose module the role may not read is hidden too. Without
 * `zugriff` exactly as in 80. navFlach itself stays unfiltered: the page titles
 * and the shell states need every route, visible or not.
 * @param {NavEintrag} eintrag
 * @param {{personalZugang?: string, zugriff?: import('@core/lib/rechte.js').Zugriff|null}} kontext
 *   personalZugang: result of personalZugang(); zugriff: access of the session (82)
 * @returns {boolean}
 */
export function navSichtbar(eintrag, { personalZugang, zugriff } = {}) {
  if (eintrag?.zugang === 'personal' && personalZugang !== 'erlaubt') return false;
  if (zugriff && eintrag?.modul && !darf(zugriff, eintrag.modul, 'lesen')) return false;
  return true;
}

/**
 * All entries flat, each carrying its group — what the palette searches.
 * @type {(NavEintrag & {gruppe: string})[]}
 */
export const navFlach = navGroups.flatMap((g) =>
  g.items.map((i) => ({ ...i, gruppe: g.label })),
);

/**
 * Page width class of a route (75-16): 'voll' for drawing pages, else
 * undefined. The shell writes it to <main data-breite>; index.css lifts the
 * max-w-7xl cap there — one rule instead of a fix per page.
 * @param {string} pathname location.pathname
 * @returns {'voll'|undefined}
 */
export function seitenBreite(pathname) {
  return navFlach.find((i) => i.url === pathname)?.breite;
}
