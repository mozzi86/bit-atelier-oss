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
  Cloud,
  Coins,
  Euro,
  FileSpreadsheet,
  FileText,
  FolderKanban,
  History,
  IdCard,
  Landmark,
  LayoutDashboard,
  PencilRuler,
  PenTool,
  Radio,
  Settings,
  ShieldCheck,
  Users,
  Wrench,
} from 'lucide-react';

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
 *
 * @typedef {{
 *   title: string,
 *   url: string,
 *   icon: unknown,
 *   labor?: boolean,
 *   projektfrei?: true,
 *   umfang?: 'portfolio',
 *   zugang?: 'personal',
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
      { title: 'Projektübersicht', url: seite('Dashboard'), icon: LayoutDashboard, umfang: 'portfolio' },
      { title: 'Projekte', url: seite('Projects'), icon: FolderKanban },
      { title: 'Berichte & Dokumente', url: seite('Reports'), icon: FileText },
    ],
  },
  {
    label: 'Planung',
    items: [
      // 72-01 A-13 (Befund N-08): "Energie-Analyse" is gone as an entry of its
      // own; the real calculator is the designer tab "Energie", and the route
      // /EnergyAnalysis redirects there (App.jsx). Feasibility comes first
      // because it precedes the design in the project flow.
      { title: 'Machbarkeit', url: seite('RealEstateFeasibility'), icon: Calculator },
      { title: 'Komplex-Designer', url: seite('ComplexDesigner'), icon: PencilRuler },
    ],
  },
  {
    label: 'Modell & Prüfung',
    items: [
      { title: 'Prüf-Suite', url: seite('ModelCheck'), icon: ShieldCheck, projektfrei: true },
      { title: 'BIM-Viewer & Tickets', url: seite('BimViewer'), icon: Box },
      { title: 'IFC-Viewer (LV-gekoppelt)', url: seite('IfcViewer'), icon: Boxes, projektfrei: true },
      // KRITIK-14: the page stores nine key figures per stage and restores
      // nothing, so it must not promise "versions" or "commits".
      { title: 'Projektstände', url: seite('ModelVersions'), icon: History },
    ],
  },
  {
    label: 'Ausschreibung & Kosten',
    items: [
      { title: 'AVA (Ausschreibung)', url: seite('AVA'), icon: FileSpreadsheet },
      { title: 'Finanzen & Nachträge', url: seite('Finance'), icon: Euro },
    ],
  },
  {
    label: 'KI & Analyse',
    items: [
      { title: 'KI-Zentrale', url: seite('AIDashboard'), icon: Bot, umfang: 'portfolio' },
    ],
  },
  {
    // E-02: "Büro" replaces the former group "Stammdaten". Phase 80 adds Personal
    // and Einstellungen, phase 82 (82-01) adds Abwesenheiten and Schriftverkehr
    // between them, phase 81 puts "Zeit & Honorar" right before this group.
    // 80-01: Personal and Einstellungen inserted, Adressbuch moved behind Personal
    // (order Buchhaltung · Personal · Adressbuch · Einstellungen [ASSUMED], D-P80-02);
    // 82 inserts Abwesenheiten after Personal and Schriftverkehr after Adressbuch.
    label: 'Büro',
    items: [
      // Phase 79: the office books span all projects and work without an active one.
      { title: 'Buchhaltung', url: seite('Accounting'), icon: Landmark, umfang: 'portfolio', projektfrei: true },
      // Phase 80: HR of the office, without a project; hidden without personnel access (E-03, DS-12).
      { title: 'Personal', url: seite('People'), icon: IdCard, projektfrei: true, zugang: 'personal' },
      { title: 'Adressbuch', url: seite('AddressBook'), icon: Users, projektfrei: true },
      // Phase 80: the one place of all app settings (KRITIK-05).
      { title: 'Einstellungen', url: seite('Settings'), icon: Settings, projektfrei: true },
    ],
  },
  {
    // 72-01 A-13 (Befunde N-08, N-18, N-19): modules that show a vision or need
    // an extra service live in "Labor" — at the bottom, collapsed by default
    // (Layout.jsx). Their routes stay reachable.
    label: 'Labor',
    collapsible: true,
    items: [
      // 72-02 (Befund N-16): a constraint sketcher in the FreeCAD mould, not a
      // freehand tool. It calls itself "(Labor)" since 72-02, so it sits here.
      { title: 'Constraint-Zeichner', url: seite('SketchStudio'), icon: PenTool, projektfrei: true },
      { title: 'Baustellen-Leitstand', url: seite('SiteControl'), icon: Radio },
      { title: 'Investment', url: seite('InvestmentPlatform'), icon: Coins, umfang: 'portfolio' },
      { title: 'PDF & Ablage', url: seite('BitAegis'), icon: Cloud, projektfrei: true },
      { title: 'Portfolio (Projektentwicklung)', url: seite('AtelierDeveloper'), icon: Briefcase, umfang: 'portfolio' },
      // Phase 67-06: the Atelier AI Harness (local Python service) inside the app.
      { title: 'KI Tool', url: seite('KiTool'), icon: Wrench },
    ],
  },
];

/**
 * Whether the sidebar and the palette show an entry. Only entries with
 * `zugang: 'personal'` depend on the context; everything else is always shown.
 * navFlach itself stays unfiltered: the page titles and the shell states need
 * every route, visible or not.
 * @param {NavEintrag} eintrag
 * @param {{personalZugang?: string}} kontext personalZugang: result of personalZugang()
 * @returns {boolean}
 */
export function navSichtbar(eintrag, { personalZugang } = {}) {
  if (eintrag?.zugang === 'personal') return personalZugang === 'erlaubt';
  return true;
}

/**
 * All entries flat, each carrying its group — what the palette searches.
 * @type {(NavEintrag & {gruppe: string})[]}
 */
export const navFlach = navGroups.flatMap((g) =>
  g.items.map((i) => ({ ...i, gruppe: g.label })),
);
