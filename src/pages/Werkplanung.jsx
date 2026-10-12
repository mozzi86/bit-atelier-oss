// Werkplanung — page "Werkplanung & Baustelle" (phase 88): the operational building
// blocks between detailed design (LPH 5) and site supervision (LPH 8) of the active
// project, one tab each. 88-06 plan list; further tabs from 88-01 (openings),
// 88-05 (sampling), 88-07 (health & safety), 88-02 (site diary) and 88-04 (permits)
// hang into REITER below.
//
// In:  the active project (useProject), ?tab=<key> selects the tab.
// Out: the page; each tab component loads and writes its own entities.
import React from "react";
import { useSearchParams } from "react-router-dom";
import { seitenWurzel } from "@core/lib/utils";
import { useProject } from "@core/lib/ProjectContext";
import { useI18n } from "@core/lib/i18n";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@core/components/ui/tabs";
import PlanListe from "../components/werkplanung/PlanListe";
import DurchbruchListe from "../components/werkplanung/DurchbruchListe";
import BemusterungListe from "../components/werkplanung/BemusterungListe";
import SigeKarte from "../components/werkplanung/SigeKarte";
import BautagebuchListe from "../components/werkplanung/BautagebuchListe";
import GenehmigungListe from "../components/werkplanung/GenehmigungListe";

/**
 * Tabs of the page in order. `label` doubles as i18n key.
 * @type {ReadonlyArray<{key: string, label: string}>}
 */
const REITER = Object.freeze([
  { key: "plaene", label: "Planliste" },
  { key: "durchbrueche", label: "Durchbrüche" },
  { key: "bemusterung", label: "Bemusterung" },
  { key: "sige", label: "SiGe" },
  { key: "bautagebuch", label: "Bautagebuch" },
  { key: "genehmigungen", label: "Genehmigungen" },
]);

export default function Werkplanung() {
  const { t } = useI18n();
  const { project } = useProject();
  const [params, setParams] = useSearchParams();
  const tab = REITER.some((r) => r.key === params.get("tab")) ? /** @type {string} */ (params.get("tab")) : REITER[0].key;
  const wechseln = (k) => {
    const neu = new URLSearchParams(params);
    neu.set("tab", k);
    setParams(neu, { replace: true });
  };

  return (
    <div className={seitenWurzel}>
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-800 dark:text-slate-100">{t("Werkplanung & Baustelle")}</h1>
          <p className="text-slate-500 text-sm">
            {project ? project.name : t("Kein aktives Projekt – bitte wählen Sie oben in der Kopfzeile ein Projekt.")}
          </p>
        </div>
        {project && (
          <Tabs value={tab} onValueChange={wechseln}>
            {/* Six tabs: wrap instead of a horizontal scroll on a phone (375 px). */}
            <TabsList className="h-auto flex-wrap justify-start">
              {REITER.map((r) => <TabsTrigger key={r.key} value={r.key}>{t(r.label)}</TabsTrigger>)}
            </TabsList>
            <TabsContent value="plaene" className="mt-4">
              <PlanListe projectId={project.id} projektName={project.name} />
            </TabsContent>
            <TabsContent value="durchbrueche" className="mt-4">
              <DurchbruchListe projectId={project.id} projektName={project.name} />
            </TabsContent>
            <TabsContent value="bemusterung" className="mt-4">
              <BemusterungListe projectId={project.id} projekt={project} />
            </TabsContent>
            <TabsContent value="sige" className="mt-4">
              <SigeKarte projekt={project} />
            </TabsContent>
            <TabsContent value="bautagebuch" className="mt-4">
              <BautagebuchListe projectId={project.id} projekt={project} />
            </TabsContent>
            <TabsContent value="genehmigungen" className="mt-4">
              <GenehmigungListe projectId={project.id} />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  );
}
