// Werkplanung — page "Werkplanung" (/Werkplanung, LP 5, phase 88): plan list, openings,
// sampling, H&S and permits of the active project. The site diary lives on the page
// "Baustelle" (/Baustelle) since NAV-PLAN 2026-10-13; both pages share
// components/werkplanung/WerkplanungReiter.jsx, which also redirects a ?tab= of the
// other page.
//
// In:  the active project (useProject). Out: the page.
import React from "react";
import { seitenWurzel } from "@core/lib/utils";
import { useProject } from "@core/lib/ProjectContext";
import { useI18n } from "@core/lib/i18n";
import WerkplanungReiter from "../components/werkplanung/WerkplanungReiter";

export default function Werkplanung() {
  const { t } = useI18n();
  const { project } = useProject();

  return (
    <div className={seitenWurzel}>
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground">{t("Werkplanung")}</h1>
          <p className="text-muted-foreground text-sm">
            {project ? project.name : t("Kein aktives Projekt – bitte wählen Sie oben in der Kopfzeile ein Projekt.")}
          </p>
        </div>
        <WerkplanungReiter bereich="werkplanung" />
      </div>
    </div>
  );
}
