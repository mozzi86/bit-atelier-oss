import React from 'react';
import { MotionConfig } from 'framer-motion';
import { Toaster } from "@core/components/ui/toaster"
import UpdateHinweis from './demo/UpdateHinweis.jsx';
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@core/lib/query-client'
import { BrowserRouter, HashRouter, Route, Routes, Navigate, useLocation } from 'react-router-dom';
import { SERVERLOS, DATENQUELLE } from '@core/lib/umgebung';

// Hash routing wherever there is no server to route (the client build lokal,
// served from a sub-path such as /app/ and inside the Tauri shell): a static
// host has no SPA fallback for sub-paths, deep links would otherwise be 404.
const Router = SERVERLOS ? HashRouter : BrowserRouter;
import PageNotFound from '@core/lib/PageNotFound';
import { ModulFehlergrenze } from '@core/components/ModulFehlergrenze';
import { exportProjekt } from '@core/api/projektDatei';
import Layout from '@/Layout';
import { AuthProvider, useAuth } from '@core/lib/AuthContext';
import { ProjectProvider } from '@core/lib/ProjectContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import Seitenwechsel from '@/components/Seitenwechsel';
import { useI18n } from '@core/lib/i18n';

// Route-level code splitting (Phase 65-01). Every page is a lazy chunk so the
// first paint only carries the shell: React, the router, the layout and the
// active page. Before this, one static import graph pulled maplibre (285 KB
// gz), three (131 KB), recharts (115 KB) and the web-ifc schema tables into the
// entry chunk — ~2,1 MB gz before anything was visible.
// Layout and PageNotFound stay static: they are needed on every route, so
// lazy-loading them would only add a second round trip.
const Dashboard = React.lazy(() => import('./pages/Dashboard'));
const Projects = React.lazy(() => import('./pages/Projects'));
const BitAegis = React.lazy(() => import('@pdf/pages/BitAegis'));
const AddressBook = React.lazy(() => import('./pages/AddressBook'));
const Finance = React.lazy(() => import('./pages/Finance'));
const ComplexDesigner = React.lazy(() => import('@designer/pages/ComplexDesigner'));
const BimViewer = React.lazy(() => import('@ifc/pages/BimViewer'));
// 72-01 A-13: EnergyAnalysis (Platzhalterseite) ist nicht mehr routbar —
// /EnergyAnalysis leitet auf /ComplexDesigner?tab=energie um.
const InvestmentPlatform = React.lazy(() => import('./pages/InvestmentPlatform'));
const AIDashboard = React.lazy(() => import('./pages/AIDashboard'));
const KiTool = React.lazy(() => import('./pages/KiTool'));
const RealEstateFeasibility = React.lazy(() => import('./pages/RealEstateFeasibility'));
const AtelierDeveloper = React.lazy(() => import('./pages/AtelierDeveloper'));
const SiteControl = React.lazy(() => import('./pages/SiteControl'));
const AVA = React.lazy(() => import('@ava/pages/AVA'));
const Reports = React.lazy(() => import('./pages/Reports'));
const ModelVersions = React.lazy(() => import('@ifc/pages/ModelVersions'));
const ModelCheck = React.lazy(() => import('@ifc/pages/ModelCheck'));
const IfcViewer = React.lazy(() => import('@ifc/pages/IfcViewer'));
const PlanSketchStudio = React.lazy(() => import('@designer/pages/PlanSketchStudio'));
// Phase 79: office books (menu group "Büro").
const Accounting = React.lazy(() => import('./pages/Accounting'));
// Phase 80: personnel and the one settings page (menu group "Büro").
const People = React.lazy(() => import('./pages/People'));
const Settings = React.lazy(() => import('./pages/Settings'));
// Login + password reset (57-02 Task 4) — @core pages, lazy like every route.
const Anmeldung = React.lazy(() => import('@core/pages/Anmeldung'));
const PasswortZuruecksetzen = React.lazy(() => import('@core/pages/PasswortZuruecksetzen'));
// Access request with manual approval (83-02) — public, like the login.
const Registrieren = React.lazy(() => import('@core/pages/Registrieren'));
// Legal pages (57-06 Task 1). Public, sessionless, in every build mode.
const Impressum = React.lazy(() => import('@core/pages/Impressum'));
const Datenschutz = React.lazy(() => import('@core/pages/Datenschutz'));
const Nutzungsbedingungen = React.lazy(() => import('@core/pages/Nutzungsbedingungen'));
const Rueckerstattung = React.lazy(() => import('@core/pages/Rueckerstattung'));
const Cookies = React.lazy(() => import('@core/pages/Cookies'));

/** Routes that render outside the auth gate. One list, so a page cannot be
 *  routed without also being let through — that mismatch is how /impressum
 *  would end up redirecting to the login. */
const RECHTSWEGE = [
  '/anmeldung',
  '/registrieren',
  '/passwort-zuruecksetzen',
  '/impressum',
  '/datenschutz',
  '/nutzungsbedingungen',
  '/rueckerstattung',
  '/cookies',
];
// Add page imports here

/**
 * Redirect that keeps the query string (E-01: German route aliases such as
 * /Buchhaltung → /Accounting). A plain <Navigate to="/Accounting"> would drop
 * ?tab=… and ?neu=…, so a German deep link would land on the default tab.
 * Phases 80–82 reuse it for their aliases.
 * @param {{ to: string }} props target path without query
 */
function UmleitungMitSuche({ to }) {
  const location = useLocation();
  return <Navigate to={to + location.search} replace />;
}

/**
 * Loading spinner, one visual for a slow login and a slow network.
 * `bereich="seite"` (default) covers the viewport: auth is resolving or a
 * legal page loads, and there is no shell yet. `bereich="inhalt"` is the
 * Suspense fallback inside the Layout (72-12, N-09): it sits in the content
 * area, so sidebar and header stay usable while a route chunk is on the wire.
 * A fixed overlay there used to block them.
 * The spinner avoids border-slate-200: index.css remaps that class to
 * #1e293b under .dark for all four sides, which hid the spinning top edge.
 * @param {{ bereich?: "seite" | "inhalt" }} props
 */
function Ladeanzeige({ bereich = "seite" }) {
  // Outside the Layout there is no I18nProvider yet; useI18n() then falls back
  // to the German key, inside it the text follows the chosen language.
  const { t } = useI18n();
  const lage = bereich === "inhalt" ? "min-h-[50vh]" : "fixed inset-0";
  return (
    <div role="status" aria-live="polite" className={`${lage} flex items-center justify-center`}>
      <div aria-hidden="true" className="w-8 h-8 border-4 border-black/10 border-t-slate-800 dark:border-white/15 dark:border-t-slate-100 rounded-full animate-spin"></div>
      <span className="sr-only">{t("Wird geladen …")}</span>
    </div>
  );
}

/**
 * The protected app (sidebar + routes). Split out of AuthenticatedApp so the
 * supabase gate can render the login routes as SIBLINGS of it — outside the
 * gate — while express/serverlos keep rendering everything unconditionally.
 */
const HauptApp = () => {
  const location = useLocation();
  return (
  <Layout>
    {/* 70-07 (register no. 76): one boundary per route, INSIDE the layout so the
        sidebar survives a crashed page; keyed by path so navigating resets it.
        It also catches a chunk that no longer exists after a deploy (lazy import). */}
    <ModulFehlergrenze key={location.pathname} pfad={location.pathname} sichern={SERVERLOS ? projektSichern : null}>
    <React.Suspense fallback={<Ladeanzeige bereich="inhalt" />}>
    <Routes>
    {/* 72-10 (N-06): the index route redirects instead of rendering the
        overview a second time, so the menu entry is marked current and the
        tab title names the page. Pattern of /EnergyAnalysis below. */}
    <Route path="/" element={<Navigate to="/Dashboard" replace />} />
    <Route path="/Dashboard" element={<Dashboard />} />
    <Route path="/Projects" element={<Projects />} />
    <Route path="/BitAegis" element={<BitAegis />} />
    <Route path="/AddressBook" element={<AddressBook />} />
    <Route path="/Finance" element={<Finance />} />
    <Route path="/ComplexDesigner" element={<ComplexDesigner />} />
    <Route path="/BimViewer" element={<BimViewer />} />
    {/* 72-01 A-13 (Befund N-08): /EnergyAnalysis bleibt erreichbar, leitet
        aber auf den echten Rechner um — den Designer-Reiter „Energie".
        Die Platzhalterseite (rechnet nicht) ist nicht mehr navigierbar. */}
    <Route path="/EnergyAnalysis" element={<Navigate to="/ComplexDesigner?tab=energie" replace />} />
    <Route path="/InvestmentPlatform" element={<InvestmentPlatform />} />
    <Route path="/AIDashboard" element={<AIDashboard />} />
    <Route path="/KiTool" element={<KiTool />} />
    <Route path="/RealEstateFeasibility" element={<RealEstateFeasibility />} />
    <Route path="/AtelierDeveloper" element={<AtelierDeveloper />} />
    <Route path="/SiteControl" element={<SiteControl />} />
    <Route path="/AVA" element={<AVA />} />
    <Route path="/Reports" element={<Reports />} />
    <Route path="/ModelVersions" element={<ModelVersions />} />
    <Route path="/ModelCheck" element={<ModelCheck />} />
    <Route path="/IfcViewer" element={<IfcViewer />} />
    <Route path="/SketchStudio" element={<PlanSketchStudio />} />
    <Route path="/Accounting" element={<Accounting />} />
    <Route path="/Buchhaltung" element={<UmleitungMitSuche to="/Accounting" />} />
    {/* Phase 80 (E-01): English routes, German aliases keep ?tab — /Einstellungen?tab=regeln
        lands on /Settings?tab=regeln and useTabParam normalises it to ?tab=rules. */}
    <Route path="/People" element={<People />} />
    <Route path="/Personal" element={<UmleitungMitSuche to="/People" />} />
    <Route path="/Settings" element={<Settings />} />
    <Route path="/Einstellungen" element={<UmleitungMitSuche to="/Settings" />} />
    {/* Add your page Route elements here */}
    <Route path="*" element={<PageNotFound />} />
    </Routes>
    </React.Suspense>
    </ModulFehlergrenze>
  </Layout>
  );
};

/** 70-07: saves the browser-held project as .bitproj from the error card (serverless builds only). */
const projektSichern = () => exportProjekt();

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin, isAuthenticated } = useAuth();
  const location = useLocation();

  // Login and password reset live OUTSIDE the gate (57-02, review correction
  // #1): the recovery session only exists once /passwort-zuruecksetzen has
  // loaded from the mail link — a gate in front of it would never see it.
  // Rendered for every data path so the routes always resolve; the pages
  // themselves show a plain-text note when they are not on the cloud path.
  // Signed in but still on the login route (live review 18.09.2026, R-2):
  // signInWithPassword succeeded, the session was stored, yet nothing left
  // /anmeldung — the user sat on the login form forever. Send them home.
  if (DATENQUELLE === 'supabase' && isAuthenticated && location.pathname === '/anmeldung') {
    return <Navigate to="/" replace />;
  }
  // Imprint and privacy notice join this branch (57-06 Task 1d). They sit
  // BEFORE the loading check below on purpose: a legal notice that waits for a
  // session to resolve is a legal notice that vanishes exactly when something
  // is wrong. Signed-in users therefore also see them without the <Layout>
  // shell — one code path instead of two, and the page carries its own way
  // back. /zugang does NOT join here; that is Task 3.
  if (RECHTSWEGE.includes(location.pathname)) {
    return (
      <>
      <ModulFehlergrenze key={location.pathname} pfad={location.pathname}>
      <React.Suspense fallback={<Ladeanzeige />}>
        <Routes>
          <Route path="/anmeldung" element={<Anmeldung />} />
          <Route path="/registrieren" element={<Registrieren />} />
          <Route path="/passwort-zuruecksetzen" element={<PasswortZuruecksetzen />} />
          <Route path="/impressum" element={<Impressum />} />
          <Route path="/datenschutz" element={<Datenschutz />} />
          <Route path="/nutzungsbedingungen" element={<Nutzungsbedingungen />} />
          <Route path="/rueckerstattung" element={<Rueckerstattung />} />
          <Route path="/cookies" element={<Cookies />} />
        </Routes>
      </React.Suspense>
      </ModulFehlergrenze>
      {/* 72-10 (N-06): tab title and skip-link handling for these pages, which
          render without the shell. Outside the boundary, whose key changes
          with every route: a remount would reset the change detection. */}
      <Seitenwechsel />
      </>
    );
  }

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return <Ladeanzeige />;
  }

  // Handle authentication errors
  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      // Redirect to login automatically
      navigateToLogin();
      return null;
    }
  }

  // Supabase gate (57-02): not signed in → the login page. The routes above
  // stay reachable; everything else needs a session. On express/serverlos
  // isAuthenticated is set by the me() load and this never blocks.
  if (DATENQUELLE === 'supabase' && !isAuthenticated) {
    return <Navigate to="/anmeldung" replace />;
  }

  return <HauptApp />;
};


function App() {
  // The demo shell (terms gate, demo header strip, usage log, feedback button)
  // wrapped this tree until 83-02. Feedback now lives in the Layout header of
  // every build (FeedbackDialog).
  const inhalt = (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthenticatedApp />
    </Router>
  );
  // 72-12 (N-09): framer-motion animates from JavaScript, so the
  // prefers-reduced-motion rule in index.css cannot stop it. reducedMotion
  // "user" follows the system setting: transform and layout animations (the
  // slide-in of every page header) jump to their end state, fades remain.
  // Static import, deliberately: it puts the "motion" chunk (vite.config.js,
  // about 38 KB gzip) on the first round. Nearly every start route needs it
  // anyway; a lazy wrapper around <Routes> would instead hold every first page
  // chunk back until motion has arrived, one extra round trip.
  return (
    <MotionConfig reducedMotion="user">
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <ProjectProvider>
          {inhalt}
          {/* Registers the service worker and shows the update strip of the
              serverless build; it positions itself fixed, so it needs no layout
              slot (70-01). */}
          {SERVERLOS && <UpdateHinweis />}
        </ProjectProvider>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
    </MotionConfig>
  )
}

export default App
