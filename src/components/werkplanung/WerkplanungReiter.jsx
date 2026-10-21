// WerkplanungReiter — the tab strip shared by the pages "Werkplanung" (/Werkplanung,
// LP 5: plan list, openings, sampling, apartments & special requests (99), H&S, permits) and "Baustelle" (/Baustelle, LP 8:
// site diary). NAV-PLAN 2026-10-13, variant A: the former page "Werkplanung & Baustelle"
// is split into two routes so that station 5 and station 8 of the office workflow each
// have their own sidebar entry. The phase-88 tab components and their entities are
// untouched, and every ?tab=<key> deep link keeps working: a tab requested on the other
// page redirects there with the query intact (?projekt=…, ?tab=… survive).
//
// In:  bereich ("werkplanung" | "baustelle"), the active project (useProject),
//      ?tab=<key> in the URL. Out: the tabs of that page and the active tab's component;
//      nothing without an active project (the page shows the hint).
import React from "react";
import { Navigate, useLocation, useSearchParams } from "react-router-dom";
import { useProject } from "@core/lib/ProjectContext";
import { useI18n } from "@core/lib/i18n";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@core/components/ui/tabs";
import PlanListe from "./PlanListe";
import DurchbruchListe from "./DurchbruchListe";
import BemusterungListe from "./BemusterungListe";
import SigeKarte from "./SigeKarte";
import BautagebuchListe from "./BautagebuchListe";
import GenehmigungListe from "./GenehmigungListe";
import { REITER, ROUTE } from "@/lib/werkplanung/reiter.js";

// 99-01…03: lazy — the apartment match pulls in the workshop solver (tesselierung), which
// the other tabs of this page do not need.
const SonderwunschReiter = React.lazy(() => import("./SonderwunschReiter"));

/**
 * @param {{ bereich: import("@/lib/werkplanung/reiter.js").Bereich }} props
 * @returns {import("react").JSX.Element|null}
 */
export default function WerkplanungReiter({ bereich }) {
  const { t } = useI18n();
  const { project } = useProject();
  const [params, setParams] = useSearchParams();
  const location = useLocation();

  const eigene = REITER.filter((r) => r.bereich === bereich);
  const gewuenscht = params.get("tab");
  const fremd = REITER.find((r) => r.key === gewuenscht && r.bereich !== bereich);
  if (fremd) return <Navigate to={{ pathname: ROUTE[fremd.bereich], search: location.search }} replace />;
  if (!project) return null;

  const tab = eigene.some((r) => r.key === gewuenscht) ? /** @type {string} */ (gewuenscht) : eigene[0].key;
  const wechseln = (/** @type {string} */ k) => {
    const neu = new URLSearchParams(params);
    neu.set("tab", k);
    setParams(neu, { replace: true });
  };

  /** @type {Record<string, import("react").JSX.Element>} */
  const inhalt = {
    plaene: <PlanListe projectId={project.id} projektName={project.name} />,
    durchbrueche: <DurchbruchListe projectId={project.id} projektName={project.name} />,
    bemusterung: <BemusterungListe projectId={project.id} projekt={project} />,
    sonderwuensche: (
      <React.Suspense fallback={<p className="text-sm text-muted-foreground">{t("Wird geladen …")}</p>}>
        <SonderwunschReiter projectId={project.id} projekt={project} />
      </React.Suspense>
    ),
    sige: <SigeKarte projekt={project} />,
    genehmigungen: <GenehmigungListe projectId={project.id} />,
    bautagebuch: <BautagebuchListe projectId={project.id} projekt={project} />,
  };

  return (
    <Tabs value={tab} onValueChange={wechseln}>
      {/* Up to six tabs: wrap instead of a horizontal scroll on a phone (375 px). */}
      {/* text-foreground: the muted default text on bg-muted fails WCAG AA contrast (axe 93-02), now six tabs */}
      <TabsList className="h-auto flex-wrap justify-start text-foreground">
        {eigene.map((r) => <TabsTrigger key={r.key} value={r.key}>{t(r.label)}</TabsTrigger>)}
      </TabsList>
      {eigene.map((r) => (
        <TabsContent key={r.key} value={r.key} className="mt-4">
          {inhalt[r.key]}
        </TabsContent>
      ))}
    </Tabs>
  );
}
