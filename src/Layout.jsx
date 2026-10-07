
import React from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import WeiterMit from "./components/WeiterMit";
import Seitenwechsel from "./components/Seitenwechsel";
// 72-10 (N-05): separate lines on purpose — the import block further down
// (next to Befehlspalette) is edited in parallel (Hermes 69-12), and adding
// names to those lines would turn every merge into a conflict.
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { huellenZustand, istPortfolioRoute, bueroAnzeige } from "./huellenZustand";
import { navFlach } from "./navigation";
// 80-01: own lines as well (see the note above) — personnel gate of the menu and
// the confirmation dialog provider.
import { navSichtbar } from "./navigation";
import { personalZugang } from "./lib/people/zugang";
import { BestaetigungProvider } from "@core/lib/useBestaetigung";
import FeedbackDialog from "@core/components/common/FeedbackDialog";
import { REPO_URL } from "@core/lib/projektInfo";
import { createPageUrl } from "@core/utils";
import {
  Search,
  Building2,
  Zap,
  Settings,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen
} from
"lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  SidebarProvider,
  SidebarTrigger,
  useSidebar } from
"@core/components/ui/sidebar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@core/components/ui/select";
import { Badge } from "@core/components/ui/badge";
import { useProject } from "@core/lib/ProjectContext";
import { statusInfo } from "@core/lib/projectModel";
import ButtonHelp from "@core/components/common/ButtonHelp";
import ThemeToggle from "@core/components/theme/ThemeToggle";
import { I18nProvider, useI18n, LANGS } from "@core/lib/i18n";
import { useBriefkopf } from "@core/lib/useBriefkopf";
import AlhambraAssistantButton from "./components/AlhambraAssistantButton";
import SpeicherStatus from "./demo/SpeicherStatus";
import { navGroups } from "./navigation";
import Befehlspalette from "./components/Befehlspalette";
import KuerzelHilfe from "./components/KuerzelHilfe";
import { aktionenFuer, passtKuerzel, parseKuerzel, abonnieren, aktionenVersion } from "@core/lib/aktionen";
import { SERVERLOS, DATENQUELLE } from "@core/lib/umgebung";
import { useAuth } from "@core/lib/AuthContext";

// Navigationsliste: eine Quelle für Seitenleiste UND Befehlspalette (65-05).
// Siehe src/navigation.js.

/**
 * Cloud-only user badge in the header (57-02 Task 4): shows the signed-in
 * e-mail and a „Abmelden" button. Rendered ONLY when DATENQUELLE==='supabase'
 * — express/serverlos have a single dev user and no real logout, so nothing
 * changes there. Sits beside SpeicherStatus/ThemeToggle on the header's right.
 */
function NutzerKopf() {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      {user?.email && (
        <span
          className="hidden sm:inline max-w-[160px] truncate text-[11px] text-slate-400"
          title={user.email}
        >
          {user.email}
        </span>
      )}
      <button
        type="button"
        onClick={() => logout()}
        title={t("Abmelden")}
        aria-label={t("Abmelden")}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-2 py-1 text-[11px] text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
      >
        <LogOut className="w-3 h-3" />
        <span className="hidden md:inline">{t("Abmelden")}</span>
      </button>
    </div>
  );
}

/**
 * Shell state 'laden' (72-10): the project list is on its way. Same spinner
 * as the route fallback in App.jsx, so a slow store looks like a slow chunk.
 * The page waits for the list, so it never renders on a project that is
 * about to be corrected.
 */
function HuelleLaedt() {
  const { t } = useI18n();
  return (
    <div role="status" className="h-full min-h-[40vh] flex items-center justify-center">
      <div aria-hidden="true" className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
      <span className="sr-only">{t("Projekte werden geladen …")}</span>
    </div>
  );
}

/**
 * Shell state 'fehler' (72-10, STATES-01): the data store did not answer.
 * Says so in plain words, shows the raw message and offers a retry — instead
 * of pretending there were no projects.
 * @param {{ fehler: string, onErneut: () => void }} props fehler = message from ProjectContext
 */
function VerbindungsFehler({ fehler, onErneut }) {
  const { t } = useI18n();
  return (
    <div className="h-full flex items-center justify-center p-6">
      <div role="alert" className="max-w-md w-full rounded-2xl border border-rose-200 dark:border-rose-900/60 bg-white dark:bg-slate-900 p-6 text-center shadow-sm">
        <AlertTriangle aria-hidden="true" className="mx-auto mb-3 w-8 h-8 text-rose-600 dark:text-rose-400" />
        <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-2">
          {t("Keine Verbindung zum Datenspeicher")}
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-300 mb-3">
          {t("Die Projektliste konnte nicht geladen werden.")}
        </p>
        <p className="mb-3 rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-left font-mono text-xs text-slate-700 dark:text-slate-200 break-words">
          {t("Meldung:")} {fehler}
        </p>
        {/* Only the local Express setup has a server the user can start. */}
        {DATENQUELLE === "express" && (
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
            {t("Hinweis: „npm run dev“ startet App und Server gemeinsam.")}
          </p>
        )}
        <button
          type="button"
          onClick={onErneut}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-sm font-medium shadow-lg hover:opacity-90 transition-opacity"
        >
          {t("Erneut versuchen")}
        </button>
      </div>
    </div>
  );
}

/**
 * Shell state 'leer' (72-10): no project yet, on a module that needs one.
 * Main action creates the first project, the side action leads to the
 * project-free check suite with the sample model — a first success without
 * any data of one's own.
 */
function KeinProjekt() {
  const { t } = useI18n();
  return (
    <div className="h-full flex items-center justify-center p-6">
      <div className="text-center max-w-md">
        <div className="mx-auto mb-5 w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500/15 to-teal-500/15 border border-emerald-500/20 flex items-center justify-center">
          <Building2 aria-hidden="true" className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
        </div>
        <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-2">
          {t("Noch kein Projekt vorhanden")}
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
          {t("Legen Sie Ihr erstes Projekt an – alle Module arbeiten auf dem gewählten Projekt.")}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link
            to={`${createPageUrl("Projects")}?neu=1`}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-sm font-medium shadow-lg hover:opacity-90 transition-opacity"
          >
            <Building2 aria-hidden="true" className="w-4 h-4" />
            {t("Neues Projekt anlegen")}
          </Link>
          <Link
            to={`${createPageUrl("ModelCheck")}?beispiel=1`}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <ShieldCheck aria-hidden="true" className="w-4 h-4" />
            {t("Musterprojekt prüfen")}
          </Link>
        </div>
      </div>
    </div>
  );
}

function LayoutInner({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { collapsed, toggle } = useSidebar();
  const { projects, projectId, setProjectId, project, loading, fehler, erneutLaden } = useProject();
  const { lang, setLang, t } = useI18n();
  const { user } = useAuth();
  // 80-01 (DS-12, E-03): the personnel entry only with personnel access; a group
  // left without entries disappears. navFlach stays unfiltered (titles, shell states).
  const zugang = personalZugang({ datenquelle: DATENQUELLE, rolle: user?.role });
  const sichtbareGruppen = React.useMemo(
    () => navGroups
      .map((g) => ({ ...g, items: g.items.filter((i) => navSichtbar(i, { personalZugang: zugang })) }))
      .filter((g) => g.items.length > 0),
    [zugang],
  );

  // 72-10 (N-05): what <main> shows — the page, loading, a store error or
  // "no project yet" — is decided in src/huellenZustand.js. /Projects and the
  // project-free modules (check suite, IFC viewer, …) always get their page.
  const zustand = huellenZustand({
    loading, fehler, projektAnzahl: projects.length, pathname: location.pathname, eintraege: navFlach,
  });
  // Header hint next to the project select, also read out with it: on a
  // portfolio page the chosen project is not what the page shows. (The demo's
  // "Beispiel" chip for its sample projects went with the demo, 83-02.)
  const portfolio = istPortfolioRoute(location.pathname, navFlach);
  const projektHinweise = portfolio ? "projekt-umfang" : undefined;

  // 72-10 (N-06): the Labor drawer opens by itself when the page shown is a
  // Labor module, so the active entry is visible. It never closes by itself:
  // a drawer the user opened stays open.
  const laborAktiv = navGroups.find((g) => g.collapsible)?.items.some((i) => i.url === location.pathname) ?? false;
  // Element of the notice slot between header and main (callback ref → state,
  // so SpeicherStatus re-renders once the slot exists and can portal into it).
  const [hinweisZiel, setHinweisZiel] = React.useState(/** @type {HTMLDivElement|null} */ (null));
  const laborKlappe = React.useRef(/** @type {HTMLDetailsElement|null} */ (null));
  React.useEffect(() => {
    if (laborAktiv && laborKlappe.current) laborKlappe.current.open = true;
  }, [laborAktiv, collapsed]);

  // Sidebar footer office name: a live read of the ONE letterhead setting
  // (@core/lib/useBriefkopf, 80-03) — the sidebar gear only links to
  // /Settings?tab=office now (below), it no longer keeps its own copy of the
  // value or a save path (that lives in BriefkopfFormular.jsx alone, NA-10 d).
  const { briefkopf } = useBriefkopf();
  const buero = bueroAnzeige(briefkopf.office);
  // Footer, second line: who works here. Only the cloud has a real account.
  const nutzerZeile = DATENQUELLE === "supabase" && user?.email ? user.email : t("Lokaler Nutzer");

  // Command palette (Phase 65-05): Ctrl/⌘+K. The shortcut is NOT captured
  // while typing in a text field — users expect their browser default there.
  // 69-12: additionally „?" opens the shortcut help, and registered action
  // chords of the current view (aktionenFuer) run their action. Same rule:
  // never while typing in input/textarea/contenteditable.
  const [paletteOffen, setPaletteOffen] = React.useState(false);
  const [hilfeOffen, setHilfeOffen] = React.useState(false);
  // Re-bind the global handler when the registry or the route changes so the
  // chord lookup below sees the actions of the CURRENT view.
  React.useSyncExternalStore(abonnieren, aktionenVersion);
  React.useEffect(() => {
    const beiTaste = (ev) => {
      const ziel = ev.target;
      const tag = ziel?.tagName?.toLowerCase();
      const tipptGerade = tag === "input" || tag === "textarea" || ziel?.isContentEditable;
      // No global shortcut while a modal dialog (core Radix dialog: FormModal,
      // settings, storage dialogs, alert dialogs) is open. Radix traps the focus
      // and sets pointer-events:none on <body>, so a palette opened on top could
      // be seen but neither typed into nor clicked, and Escape would close the
      // dialog underneath instead (HUELLE-04). The palette and the shortcut help
      // carry no data-state, so they do not block their own toggles. An open
      // Radix popover (also role=dialog) blocks them too — harmless, Escape
      // closes it first.
      if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) return;
      // Ctrl/⌘+K toggles the palette (unchanged from 65-05).
      if (ev.key?.toLowerCase() === "k" && (ev.ctrlKey || ev.metaKey)) {
        if (tipptGerade) return;
        ev.preventDefault();
        // One overlay at a time: the palette replaces an open shortcut help.
        setHilfeOffen(false);
        setPaletteOffen((o) => !o);
        return;
      }
      if (tipptGerade) return; // „?" stays a character inside text fields
      // „?" without modifiers opens the shortcut help. Shift+? produces key
      // "?" on every layout, so a bare key check is enough.
      if (ev.key === "?" && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
        ev.preventDefault();
        setPaletteOffen(false);
        setHilfeOffen((o) => !o);
        return;
      }
      // Registered action chords of the current view — exact modifier match
      // (passtKuerzel), so plain browser chords stay untouched.
      for (const a of aktionenFuer(location.pathname)) {
        if (a.kuerzel && passtKuerzel(ev, parseKuerzel(a.kuerzel))) {
          ev.preventDefault();
          a.ausfuehren();
          return;
        }
      }
    };
    window.addEventListener("keydown", beiTaste);
    return () => window.removeEventListener("keydown", beiTaste);
  }, [location.pathname]);

  return (
    <>
      <a href="#hauptinhalt" className="skip-link">{t("Zum Inhalt springen")}</a>
      <Befehlspalette offen={paletteOffen} onSchliessen={() => setPaletteOffen(false)} />
      <KuerzelHilfe offen={hilfeOffen} onSchliessen={() => setHilfeOffen(false)} />
      <style>{`
        :root {
          --sidebar-bg: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
          --primary-green: #10b981;
          --accent-blue: #3b82f6;
          --warm-earth: #d97706;
        }
      `}</style>

      <div className="app-huelle h-dvh overflow-hidden flex w-full bg-gradient-to-br from-slate-50 via-green-50/30 to-blue-50/20">
        {/* 72-10 (N-06): "dark" because the sidebar is dark in both themes. The
            light-mode contrast fix in index.css turns text-slate-400 into
            #64748b, only 3.1–3.8:1 on this #0f172a→#1e293b gradient; inside
            .dark the existing override keeps #94a3b8 (5.7–7.0:1). */}
        <Sidebar className="dark border-r-0 shadow-2xl" style={{ background: 'var(--sidebar-bg)' }}>
          <SidebarHeader className={`border-b border-slate-700/50 ${collapsed ? 'p-3' : 'p-6'}`}>
            <div className={`flex items-center ${collapsed ? 'flex-col gap-2' : 'justify-between'}`}>
              {/* 72-10 (N-06): logo and name lead to the overview, the usual way home. */}
              <Link to="/Dashboard" aria-label={t("Zur Projektübersicht")} className="flex items-center gap-3 min-w-0 rounded-xl">
                <div className="relative shrink-0">
                  <div className="w-10 h-10 bg-gradient-to-br from-emerald-400 to-teal-500 rounded-xl flex items-center justify-center shadow-lg">
                    <Building2 className="w-6 h-6 text-white" />
                  </div>
                  <div className="absolute -top-1 -right-1 w-4 h-4 bg-gradient-to-br from-blue-400 to-purple-500 rounded-full flex items-center justify-center">
                    <Zap className="w-2.5 h-2.5 text-white" />
                  </div>
                </div>
                {!collapsed && (
                  <div className="min-w-0">
                    <h2 className="text-white text-lg font-bold truncate">BIT-Atelier</h2>
                    <p className="text-xs text-slate-300 truncate">{t("Bauprojekt-Plattform")}</p>
                  </div>
                )}
              </Link>
              {/* Desktop collapse toggle */}
              <button
                onClick={toggle}
                title={collapsed ? t("Sidebar ausklappen") : t("Sidebar einklappen")}
                aria-label={collapsed ? t("Sidebar ausklappen") : t("Sidebar einklappen")}
                className="hidden md:inline-flex shrink-0 p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors"
              >
                {collapsed ? <PanelLeftOpen className="w-5 h-5" /> : <PanelLeftClose className="w-5 h-5" />}
              </button>
            </div>
          </SidebarHeader>

          <SidebarContent className={collapsed ? 'p-2' : 'p-3'}>
            <nav aria-label={t("Hauptnavigation")}>
            {sichtbareGruppen.map((grp) => (
            // 72-01 A-13: Gruppe „Labor" zuklappbar, standardmäßig ZU —
            // Labor-Module (Vision/Dienst nötig) stehen nicht mehr
            // gleichrangig neben den Kernmodulen (Befunde N-08/N-18/N-19).
            grp.collapsible ? (
              <SidebarGroup key={grp.label} className={collapsed ? undefined : "hidden"}>
                {/* Eingeklappte Seitenleiste: Labor bleibt als Icon-Liste sichtbar
                    (Routen erreichbar); ausgeklappt übernimmt die Details-Klappe. */}
                <SidebarGroupContent>
                  <SidebarMenu className="space-y-1">
                    {grp.items.map((item) => (
                      <SidebarMenuItem key={item.title}>
                        <SidebarMenuButton asChild className="group hover:bg-slate-700/50 transition-all duration-300 rounded-xl">
                          <Link to={item.url} title={t(item.title)} aria-label={t(item.title)}
                            aria-current={location.pathname === item.url ? "page" : undefined}
                            className="flex items-center justify-center px-0 py-3">
                            <item.icon className={`w-5 h-5 shrink-0 transition-colors ${location.pathname === item.url ? 'text-emerald-300' : 'text-slate-400 group-hover:text-white'}`} />
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ) : (
            <SidebarGroup key={grp.label}>
              {!collapsed && (
                <SidebarGroupLabel className="text-xs font-medium text-slate-400 uppercase tracking-wider px-3 py-2">
                  {t(grp.label)}
                </SidebarGroupLabel>
              )}
              <SidebarGroupContent>
                <SidebarMenu className="space-y-1">
                  {grp.items.map((item) =>
                  <SidebarMenuItem key={item.title} className="group/menu-item relative">
                      <SidebarMenuButton
                      asChild
                      className={`group hover:bg-slate-700/50 transition-all duration-300 rounded-xl ${
                      location.pathname === item.url ?
                      'bg-gradient-to-r from-emerald-500/20 to-teal-500/20 border border-emerald-500/30' :
                      ''}`
                      }>

                        <Link to={item.url} title={collapsed ? t(item.title) : undefined}
                          aria-current={location.pathname === item.url ? "page" : undefined}
                          aria-label={collapsed ? t(item.title) : undefined}
                          className={`flex items-center ${collapsed ? 'justify-center px-0 py-3' : 'gap-3 px-4 py-2.5'}`}>
                          <item.icon className={`w-5 h-5 shrink-0 transition-colors ${
                        location.pathname === item.url ? 'text-emerald-300' : 'text-slate-400 group-hover:text-white'}`
                        } />
                          {!collapsed && (
                          <span className={`font-medium text-sm transition-colors ${
                        location.pathname === item.url ? 'text-white' : 'text-slate-300 group-hover:text-white'}`
                        }>
                            {t(item.title)}
                          </span>
                          )}
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
            )
            ))}
            {/* 72-01 A-13: Labor-Klappe (ausgeklappte Seitenleiste) — Details-
                Element, Standard zu; die Routen bleiben über die Palette
                (Strg+K) und direkte URLs erreichbar. */}
            {!collapsed && (() => {
              const labor = navGroups.find((g) => g.collapsible);
              if (!labor) return null;
              return (
                <details ref={laborKlappe} className="px-3 py-1">
                  <summary className="cursor-pointer select-none text-xs font-medium text-slate-400 uppercase tracking-wider px-3 py-2 hover:text-slate-200 list-none flex items-center justify-between">
                    {t(labor.label)}
                    <span className="text-slate-500 text-[10px]" aria-hidden="true">▸</span>
                  </summary>
                  <SidebarMenu className="space-y-1 mt-1">
                    {labor.items.map((item) => (
                      <SidebarMenuItem key={item.title}>
                        <SidebarMenuButton asChild className={`group hover:bg-slate-700/50 transition-all duration-300 rounded-xl ${location.pathname === item.url ? 'bg-gradient-to-r from-emerald-500/20 to-teal-500/20 border border-emerald-500/30' : ''}`}>
                          <Link to={item.url} aria-current={location.pathname === item.url ? "page" : undefined} className="flex items-center gap-3 px-4 py-2.5">
                            <item.icon className={`w-5 h-5 shrink-0 transition-colors ${location.pathname === item.url ? 'text-emerald-300' : 'text-slate-400 group-hover:text-white'}`} />
                            <span className={`font-medium text-sm transition-colors ${location.pathname === item.url ? 'text-white' : 'text-slate-300 group-hover:text-white'}`}>{t(item.title)}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                  <p className="px-4 pt-2 pb-1 text-[10px] leading-snug text-slate-500">
                    {t("Experimentelle Module — zeigen Visionen oder brauchen Zusatzdienste. Nicht Teil des Kernprodukts.")}
                  </p>
                </details>
              );
            })()}
            </nav>

          </SidebarContent>

          {/* 72-10 (N-05): office name from the letterhead setting instead of the
              placeholders "NC" / "BIT-Atelier User" / "Project Manager"; the dead
              language button is gone (DE | EN sits in the header). The settings
              gear stays reachable in the collapsed sidebar as well. */}
          <SidebarFooter className="border-t border-slate-700/50 p-4">
            {collapsed ? (
              <div className="flex flex-col items-center gap-2">
                <div role="img" aria-label={buero.name} title={buero.name} data-testid="buero-initialen" className="w-10 h-10 bg-gradient-to-br from-amber-400 to-orange-500 rounded-full flex items-center justify-center text-white font-bold text-sm">
                  <span aria-hidden="true">{buero.initialen}</span>
                </div>
                <Link to="/Settings?tab=office" aria-label={t("Einstellungen")} title={t("Einstellungen")} className="p-2 rounded-lg hover:bg-slate-700/50 text-slate-400 hover:text-white transition-colors">
                  <Settings className="w-5 h-5" />
                </Link>
              </div>
            ) : (
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-3 min-w-0">
                <div aria-hidden="true" data-testid="buero-initialen" className="w-10 h-10 shrink-0 bg-gradient-to-br from-amber-400 to-orange-500 rounded-full flex items-center justify-center text-white font-bold text-sm">
                  {buero.initialen}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-white text-sm truncate" data-testid="buero-name" title={buero.name}>{buero.name}</p>
                  <p className="text-xs text-slate-400 truncate" title={nutzerZeile}>{nutzerZeile}</p>
                </div>
              </div>
              <Link to="/Settings?tab=office" aria-label={t("Einstellungen")} title={t("Einstellungen")} className="shrink-0 p-2 rounded-lg hover:bg-slate-700/50 text-slate-400 hover:text-white transition-colors">
                <Settings className="w-5 h-5" />
              </Link>
            </div>
            )}
          </SidebarFooter>
        </Sidebar>

        <div className="flex-1 flex flex-col relative min-w-0 min-h-0">
          {/* Global, always-visible current-project bar */}
          <header className="relative z-30 bg-white/85 dark:bg-slate-900/85 backdrop-blur-sm border-b border-slate-200/60 dark:border-slate-800 px-4 md:px-6 py-2.5 shadow-sm flex items-center gap-3">
            <SidebarTrigger aria-label={t("Navigation umschalten")} className="md:hidden hover:bg-slate-100 h-11 w-11 shrink-0 rounded-lg transition-colors" />
            {/* Header room (HUELLE-05, re-measured after the merge added the snapshot
                button to the storage group): the visible label only from 2xl — the
                select carries the same text as its accessible name at every width;
                the select narrows step by step instead of being squeezed; badge
                and Strg-K hint never wrap into two lines. Between md and lg the
                expanded sidebar leaves the header ~510 px: status badge and the
                Strg-K hint step aside there (Ctrl+K itself keeps working). */}
            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400 hidden 2xl:inline whitespace-nowrap shrink-0">{t("Aktuelles Projekt")}</span>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger aria-label={t("Aktuelles Projekt")} aria-describedby={projektHinweise} className="h-9 w-[190px] md:w-[180px] lg:w-[240px] xl:w-[260px] 2xl:w-[300px] font-medium">
                <SelectValue placeholder={t("Projekt wählen…")} />
              </SelectTrigger>
              <SelectContent>
                {projects.length === 0 && <div className="px-2 py-1.5 text-sm text-slate-400">{t("Keine Projekte")}</div>}
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* 72-10: a page that spans all projects says so next to the select —
                the select alone suggests every page works on the chosen project.
                Visible only from the width where the header still has room
                (≈120 px chip from 1440 px); below that the right group (Strg K,
                storage status, feedback, theme) is squeezed. Screen readers get
                the hint through aria-describedby at every width. */}
            {portfolio && (
              <span id="projekt-umfang" className="hidden min-[1440px]:inline-flex shrink-0 items-center whitespace-nowrap rounded-full border border-sky-300 bg-sky-50 px-1.5 text-[10px] leading-4 font-medium text-sky-800 dark:border-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
                {t("Portfolio – alle Projekte")}
              </span>
            )}
            {/* Sprachumschalter DE | EN */}
            <div role="group" aria-label={t("Sprache")} className="flex items-center rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden shrink-0">
              {Object.keys(LANGS).map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => setLang(code)}
                  aria-label={LANGS[code]}
                  aria-pressed={lang === code}
                  className={`px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                    lang === code
                      ? 'bg-teal-600 text-white'
                      : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {code.toUpperCase()}
                </button>
              ))}
            </div>
            {project && (
              <Badge className={`${statusInfo(project.status).color} hidden sm:max-md:inline-flex lg:inline-flex shrink-0 whitespace-nowrap`}>
                {statusInfo(project.status).label}
              </Badge>
            )}
            {project?.client && <span className="text-sm text-slate-400 truncate hidden lg:inline">· {project.client}</span>}
            <div className="ml-auto flex items-center gap-1">
              {/* Sichtbarer Hinweis auf das Kürzel — eine Palette, die niemand
                  kennt, hilft niemandem. */}
              <button
                type="button"
                onClick={() => { setHilfeOffen(false); setPaletteOffen(true); }}
                title={t("Suche und Befehle")}
                aria-label={t("Suche und Befehle")}
                className="hidden lg:inline-flex shrink-0 whitespace-nowrap items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-2 py-1 text-[11px] text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <Search className="w-3 h-3" />
                <kbd className="font-sans">Strg K</kbd>
              </button>
              {/* Nur in der lokalen Fassung: dort ist der Browser die einzige
                  Ablage, also muss sichtbar sein, ob gespeichert wurde (65-02). */}
              {SERVERLOS && <SpeicherStatus hinweisZiel={hinweisZiel} />}
              {/* Nur im Cloud-Betrieb (57-02 Task 4): wer angemeldet ist und wie
                  man herauskommt. express/serverlos haben keinen echten Login —
                  dort bleibt die Kopfzeile unverändert. */}
              {DATENQUELLE === "supabase" && <NutzerKopf />}
              {/* 83-02: feedback in every build — mail or GitHub, sent by the user. */}
              <FeedbackDialog seite={location.pathname} />
              <ThemeToggle />
            </div>
          </header>

          {/* Slot for full-width notices under the header (storage warning,
              backup nudge — SpeicherStatus portals them in). A row of its own in
              the column, so <main> gets shorter instead of being covered. */}
          <div ref={setHinweisZiel} className="shrink-0" data-testid="huellen-hinweise" />

          {/* tabIndex -1: focus target of the skip link and of every route
              change (Seitenwechsel), not a tab stop of its own. */}
          <main id="hauptinhalt" role="main" tabIndex={-1} className="flex-1 overflow-auto bg-slate-50 dark:bg-slate-950 focus:outline-none">
            {/* 72-10 (N-06): tab title, focus and announcement on route changes,
                skip-link handling — for every route and every shell state.
                First in <main>: the "Weiter mit" bar stays directly before the
                legal footer (72-09 contract). */}
            <Seitenwechsel />
            {zustand === "inhalt" && children}
            {zustand === "laden" && <HuelleLaedt />}
            {zustand === "fehler" && <VerbindungsFehler fehler={fehler} onErneut={erneutLaden} />}
            {zustand === "leer" && <KeinProjekt />}

            {/* 72-09 (N-03): "Weiter mit …" after the page content, so no module
                ends in a dead end — also the ones whose files belong to Hermes.
                Only under a page: the shell states offer their own way on. */}
            {zustand === "inhalt" && (
              <WeiterMit
                pathname={location.pathname}
                labor={laborAktiv}
              />
            )}

            {/* Mandatory notices, reachable from all 22 protected routes
                (57-06 Task 1f). Inside <main> and NOT in the SidebarFooter:
                that one shrinks to the office initials and the gear when the
                sidebar is collapsed, and a mandatory notice must not disappear
                through an ordinary UI action. Only the link labels follow the
                UI language; the legal texts behind them stay as written. */}
            <footer className="border-t border-slate-200/70 dark:border-slate-800 px-4 py-3 text-center text-xs text-slate-500 dark:text-slate-400">
              <Link to="/impressum" className="underline hover:text-slate-700 dark:hover:text-slate-200">
                {t("Impressum")}
              </Link>
              <span aria-hidden="true"> · </span>
              <Link to="/datenschutz" className="underline hover:text-slate-700 dark:hover:text-slate-200">
                {t("Datenschutz")}
              </Link>
              <span aria-hidden="true"> · </span>
              <Link to="/nutzungsbedingungen" className="underline hover:text-slate-700 dark:hover:text-slate-200">
                {t("Nutzungsbedingungen")}
              </Link>
              <span aria-hidden="true"> · </span>
              <Link to="/cookies" className="underline hover:text-slate-700 dark:hover:text-slate-200">
                {t("Cookies")}
              </Link>
              <span aria-hidden="true"> · </span>
              {/* 83-02: open source under MIT — the source is one click away. */}
              <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="underline hover:text-slate-700 dark:hover:text-slate-200">
                {t("Quellcode (MIT)")}
              </a>
            </footer>
          </main>

          {/* AI assistant button (72-10): opens AI Hub › KI-Chat. Not the "KI Tool"
              module — that one needs a local Python service. Hidden on the AI Hub
              itself, where it would only point at the page already open. */}
          {location.pathname !== "/AIDashboard" && (
            <div className="absolute bottom-6 right-6">
              <AlhambraAssistantButton label={t("KI-Assistent")} onClick={() => navigate("/AIDashboard?tab=chat")} />
            </div>
          )}
        </div>
      </div>
      <ButtonHelp />
    </>
  );
}

export default function Layout({ children }) {
  return (
    <I18nProvider>
      <BestaetigungProvider>
        <SidebarProvider>
          <LayoutInner>{children}</LayoutInner>
        </SidebarProvider>
      </BestaetigungProvider>
    </I18nProvider>
  );
}