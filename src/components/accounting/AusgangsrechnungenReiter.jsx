// Tab "Ausgangsrechnungen" of /Accounting (phase 79): the shell of the three
// sections fee contracts (79-02), invoices (79-02) and dunning (79-03), with one
// project filter for all three — the active project or all projects (pattern of
// the finance page's "Alle Projekte" toggle).
//
// In:  props bh (page loader object). Out: filter + the three sections, each
//      receiving projektId (null = all projects).

import React from "react";
import { buttonVariants } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import HonorarAbschnitt from "./HonorarAbschnitt.jsx";
import MahnwesenAbschnitt from "./MahnwesenAbschnitt.jsx";
import RechnungenAbschnitt from "./RechnungenAbschnitt.jsx";

/**
 * @param {{bh: import("./useBuchhaltung.js").Buchhaltung}} props bh: page loader object
 * @returns {React.ReactElement}
 */
export default function AusgangsrechnungenReiter({ bh }) {
  const { t } = useI18n();
  const [alle, setAlle] = React.useState(false);
  const projekt = bh.projekte.find((p) => p.id === bh.projektId) || null;
  // Without an active project the module is portfolio-wide: all projects, no toggle.
  const zeigeAlle = alle || !projekt;
  const projektId = zeigeAlle ? null : projekt.id;

  return (
    <div className="space-y-6">
      <div role="group" aria-label={t("Projektfilter")} className="flex flex-wrap items-center gap-2">
        {projekt && (
          <button type="button" aria-pressed={!zeigeAlle} onClick={() => setAlle(false)}
            className={buttonVariants({ variant: !zeigeAlle ? "secondary" : "outline", size: "sm" })}>
            {t("Aktives Projekt")}: {projekt.name}
          </button>
        )}
        <button type="button" aria-pressed={zeigeAlle} onClick={() => setAlle(true)}
          className={buttonVariants({ variant: zeigeAlle ? "secondary" : "outline", size: "sm" })}>
          {t("Alle Projekte")}
        </button>
      </div>
      <HonorarAbschnitt bh={bh} projektId={projektId} />
      <RechnungenAbschnitt bh={bh} projektId={projektId} />
      <MahnwesenAbschnitt bh={bh} projektId={projektId} />
    </div>
  );
}
