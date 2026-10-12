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
      { title: 'Projektübersicht', url: seite('Dashboard'), modul: 'projekte', icon: LayoutDashboard, umfang: 'portfolio' },
      { title: 'Projekte', url: seite('Projects'), modul: 'projekte', icon: FolderKanban },
      { title: 'Berichte & Dokumente', url: seite('Reports'), modul: 'berichte', icon: FileText },
      // Phase 82 (82-01, E-02): deadlines and appointments of all modules, without a project.
      { title: 'Fristen & Termine', url: seite('Deadlines'), modul: 'fristen', icon: CalendarClock, projektfrei: true, umfang: 'portfolio' },
    ],
  },
  {
    label: 'Planung',
    items: [
      // 72-01 A-13 (Befund N-08): "Energie-Analyse" is gone as an entry of its
      // own; the real calculator is the designer tab "Energie", and the route
      // /EnergyAnalysis redirects there (App.jsx). Feasibility comes first
      // because it precedes the design in the project flow.
      { title: 'Machbarkeit', url: seite('RealEstateFeasibility'), modul: 'planung', icon: Calculator, netz: 'teilweise' },
      { title: 'Komplex-Designer', url: seite('ComplexDesigner'), modul: 'planung', icon: PencilRuler, breite: 'voll', netz: 'teilweise' },
      // Phase 88: plan list, openings, sampling, H&S — between detailed design and site.
      { title: 'Werkplanung & Baustelle', url: seite('Werkplanung'), modul: 'planung', icon: ClipboardList },
    ],
  },
  {
    label: 'Modell & Prüfung',
    items: [
      { title: 'Prüf-Suite', url: seite('ModelCheck'), modul: 'modell', icon: ShieldCheck, projektfrei: true, breite: 'voll' },
      { title: 'BIM-Viewer & Tickets', url: seite('BimViewer'), modul: 'modell', icon: Box, breite: 'voll' },
      { title: 'IFC-Viewer (LV-gekoppelt)', url: seite('IfcViewer'), modul: 'modell', icon: Boxes, projektfrei: true },
      // KRITIK-14: the page stores nine key figures per stage and restores
      // nothing, so it must not promise "versions" or "commits".
      { title: 'Projektstände', url: seite('ModelVersions'), modul: 'modell', icon: History },
    ],
  },
  {
    label: 'Ausschreibung & Kosten',
    items: [
      { title: 'AVA (Ausschreibung)', url: seite('AVA'), modul: 'ava', icon: FileSpreadsheet, netz: 'teilweise' },
      { title: 'Finanzen & Nachträge', url: seite('Finance'), modul: 'finanzen', icon: Euro },
    ],
  },
  {
    label: 'KI & Analyse',
    items: [
      { title: 'KI-Zentrale', url: seite('AIDashboard'), modul: 'ki', icon: Bot, umfang: 'portfolio', netz: 'noetig' },
    ],
  },
  {
    // Phase 81 (81-01, E-02): time, fees and controlling of the office, right before
    // "Büro". Time tracking and controlling span all projects; time tracking also
    // works without an active project (office time, E-17).
    label: 'Zeit & Honorar',
    items: [
      { title: 'Zeiterfassung', url: seite('TimeTracking'), modul: 'zeiterfassung', icon: Timer, projektfrei: true, umfang: 'portfolio' },
      { title: 'Angebot & Auftrag', url: seite('Fees'), modul: 'auftrag', icon: Handshake },
      { title: 'Projektcontrolling', url: seite('Controlling'), modul: 'controlling', icon: Gauge, umfang: 'portfolio' },
    ],
  },
  {
    // E-02: "Büro" replaces the former group "Stammdaten". Phase 80 adds Personal
    // and Einstellungen, phase 82 (82-01) adds Abwesenheiten and Schriftverkehr
    // between them, phase 81 puts "Zeit & Honorar" right before this group.
    // 81-01: „Zeit & Honorar“ direkt davor angelegt.
    // 80-01: Personal and Einstellungen inserted, Adressbuch moved behind Personal
    // (order Buchhaltung · Personal · Adressbuch · Einstellungen [ASSUMED], D-P80-02);
    // 82 inserts Abwesenheiten after Personal and Schriftverkehr after Adressbuch.
    label: 'Büro',
    items: [
      // Phase 79: the office books span all projects and work without an active one.
      { title: 'Buchhaltung', url: seite('Accounting'), modul: 'buchhaltung', icon: Landmark, umfang: 'portfolio', projektfrei: true },
      // Phase 80: HR of the office, without a project; hidden without personnel access (E-03, DS-12).
      { title: 'Personal', url: seite('People'), modul: 'personal', icon: IdCard, projektfrei: true, zugang: 'personal' },
      // Phase 82 (82-01): inserted after Personal (E-02, 80-01 "82 inserts").
      { title: 'Abwesenheiten', url: seite('Absences'), modul: 'abwesenheiten', icon: TreePalm, projektfrei: true, umfang: 'portfolio' },
      { title: 'Adressbuch', url: seite('AddressBook'), modul: 'adressbuch', icon: Users, projektfrei: true },
      // Phase 82 (82-01): inserted after Adressbuch (E-02).
      { title: 'Schriftverkehr', url: seite('Correspondence'), modul: 'schriftverkehr', icon: Mail, projektfrei: true, umfang: 'portfolio' },
      // Phase 80: the one place of all app settings (KRITIK-05).
      { title: 'Einstellungen', url: seite('Settings'), modul: 'einstellungen', icon: Settings, projektfrei: true },
    ],
  },
  {
    // 72-01 A-13 (Befunde N-08, N-18, N-19): modules that show a vision or need
    // an extra service live in "Labor" — at the bottom, collapsed by default
    // (Layout.jsx). Their routes stay reachable.
    label: 'Labor',
    collapsible: true,
    items: [
      // 72-05 (decision 12.10.2026, variant a): a real sketch tool — freehand with pen
      // pressure, widths, eraser — with the FreeCAD constraint drawing as a mode. Still in
      // "Labor" until the overlay over site plan / IFC section is done.
      { title: 'Skizze', url: seite('SketchStudio'), modul: 'labor', icon: PenTool, projektfrei: true },
      { title: 'Baustellen-Leitstand', url: seite('SiteControl'), modul: 'labor', icon: Radio, breite: 'voll', netz: 'teilweise' },
      { title: 'Investment', url: seite('InvestmentPlatform'), modul: 'labor', icon: Coins, umfang: 'portfolio' },
      { title: 'PDF & Ablage', url: seite('BitAegis'), modul: 'labor', icon: Cloud, projektfrei: true },
      { title: 'Portfolio (Projektentwicklung)', url: seite('AtelierDeveloper'), modul: 'labor', icon: Briefcase, umfang: 'portfolio' },
      // Phase 67-06: the Atelier AI Harness (local Python service) inside the app.
      { title: 'KI Tool', url: seite('KiTool'), modul: 'labor', icon: Wrench },
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
