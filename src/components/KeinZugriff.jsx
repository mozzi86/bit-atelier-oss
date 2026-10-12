// Card for a locked route (phase 82, 82-02): shown by the shell instead of the
// page when the role may not read the module of the route (huellenZustand →
// 'gesperrt'). The page chunk is never mounted, so nothing of it loads.
// One card for every reason — the role, the cloud lock of E-03 (only without
// the release E-20) and later the read mode or lock of 78-04 (prop grund).
//
// In:  props grund ('rolle' | 'cloud'). Out: the card.

import React from "react";
import { Link } from "react-router-dom";
import { Lock } from "lucide-react";
import { buttonVariants } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";

/**
 * @param {{grund?: 'rolle'|'cloud'}} props
 * @returns {React.ReactElement}
 */
export default function KeinZugriff({ grund = "rolle" }) {
  const { t } = useI18n();
  return (
    <section className="mx-auto mt-16 max-w-lg rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm dark:border-slate-700 dark:bg-slate-900" data-testid="kein-zugriff">
      <Lock className="mx-auto h-8 w-8 text-slate-400" aria-hidden="true" />
      <h2 className="mt-3 text-lg font-semibold text-slate-900 dark:text-slate-100">{t("Kein Zugriff")}</h2>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
        {grund === "cloud"
          ? t("Dieser Bereich bleibt lokal – in der Cloud-Fassung erst nach Zugriffstrennung (Phase 74).")
          : t("Dieser Bereich ist für Ihre Rolle nicht freigegeben.")}
      </p>
      <Link to="/Dashboard" className={`${buttonVariants({ variant: "outline", size: "sm" })} mt-4`}>{t("Zur Projektübersicht")}</Link>
    </section>
  );
}
