// "Was diese Rechte leisten" (phase 82, 82-02, RECHT-06): always visible in
// Settings › Nutzer & Rechte. The roles order what is shown; they are no access
// security — the data lie in this browser or on the Express server, which the
// network reaches without sign-in. Real separation comes server-side (phase 74/78).
//
// In:  nothing. Out: the block.

import React from "react";
import { ShieldAlert } from "lucide-react";
import { useI18n } from "@core/lib/i18n";

/** @returns {React.ReactElement} */
export default function EhrlichkeitsBlock() {
  const { t } = useI18n();
  return (
    <section className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100" data-testid="ehrlichkeit">
      <h3 className="flex items-center gap-2 font-semibold"><ShieldAlert className="h-4 w-4" aria-hidden="true" /> {t("Was diese Rechte leisten")}</h3>
      <p className="mt-1">
        {t("Sie ordnen, wer was sieht. Sie sind keine Zugriffssicherheit — alle Daten liegen in diesem Browser bzw. auf dem Express-Server, der im Netzwerk ohne Anmeldung erreichbar ist. Echte Trennung kommt serverseitig mit Phase 74/78.")}
      </p>
      <p className="mt-1">{t("„Ansicht als …“ ist keine Anmeldung: Wer das Gerät nutzt, kann jede Ansicht wählen.")}</p>
    </section>
  );
}
