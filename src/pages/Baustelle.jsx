// Baustelle — page "Baustelle" (/Baustelle, LP 8): the site diary of the active project,
// split off the former page "Werkplanung & Baustelle" by NAV-PLAN 2026-10-13 so that
// site supervision has its own sidebar entry. Defects and acceptance (today in
// Deadlines / AbnahmeDialog) are candidates for further tabs here. The tabs live in
// components/werkplanung/WerkplanungReiter.jsx, shared with /Werkplanung.
//
// In:  the active project (useProject). Out: the page.
import React from "react";
import { seitenWurzel } from "@core/lib/utils";
import { useProject } from "@core/lib/ProjectContext";
import { useI18n } from "@core/lib/i18n";
import WerkplanungReiter from "../components/werkplanung/WerkplanungReiter";

export default function Baustelle() {
  const { t } = useI18n();
  const { project } = useProject();

  return (
    <div className={seitenWurzel}>
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground">{t("Baustelle")}</h1>
          <p className="text-muted-foreground text-sm">
            {project ? project.name : t("Kein aktives Projekt – bitte wählen Sie oben in der Kopfzeile ein Projekt.")}
          </p>
        </div>
        <WerkplanungReiter bereich="baustelle" />
      </div>
    </div>
  );
}
