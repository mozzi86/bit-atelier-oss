// Shared shell pieces of the three phase-81 pages (/TimeTracking, /Fees,
// /Controlling): the tab class strings of the shadcn tab parts (applied to the
// Radix primitives, like /Accounting — the shadcn wrappers cost a tsc error per
// element), the cloud-lock card (E-03), the load-error card and the placeholder
// of a tab that a later plan fills. Each page keeps its own h1 and its literal
// <TabsContent value> blocks (the guards read them per page file).
//
// In:  props per component. Out: React elements; no data access.

import React from "react";
import { CloudOff, Hammer } from "lucide-react";
import EmptyState from "@core/components/common/EmptyState";
import { buttonVariants } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";

/** Class string of the tab list (shadcn TabsList). */
export const TAB_LISTE = "flex flex-wrap h-auto gap-1 items-center rounded-lg bg-slate-100 p-1 text-muted-foreground dark:bg-slate-800";
/** Class string of a tab trigger (shadcn TabsTrigger). */
export const TAB_AUSLOESER = "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium text-slate-700 ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow dark:text-slate-200";
/** Class string of a tab panel (shadcn TabsContent). */
export const TAB_INHALT = "pt-4 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

/**
 * Notice instead of the tabs when the storage layer is locked (cloud build
 * without the release E-20). No data is read behind it.
 * @returns {React.ReactElement}
 */
export function CloudSperreKarte() {
  const { t } = useI18n();
  return (
    <div role="status" data-testid="zeithonorar-cloud-sperre"
      className="rounded-xl border border-slate-200 bg-white p-6 space-y-2 dark:border-slate-700 dark:bg-slate-900">
      <p className="flex items-center gap-2 font-medium text-slate-800 dark:text-slate-100">
        <CloudOff className="h-5 w-5 text-slate-500" aria-hidden="true" /> {t("Erst nach Zugriffstrennung (Phase 74) verfügbar")}
      </p>
      <p className="text-sm text-slate-600 dark:text-slate-300">
        {t("Zeiten, Honorare und Kostensätze sähen sonst alle Mitglieder einer Organisation. Nutzen Sie bis dahin die lokale Version.")}
      </p>
    </div>
  );
}

/**
 * Load error with the plain-text message and a retry.
 * @param {{fehler: string, onRetry: () => void}} props
 * @returns {React.ReactElement}
 */
export function LadeFehlerKarte({ fehler, onRetry }) {
  const { t } = useI18n();
  return (
    <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-6 space-y-3 dark:border-red-800 dark:bg-red-950">
      <p className="font-medium text-red-800 dark:text-red-200">{t("Zeiten und Honorare konnten nicht geladen werden")}</p>
      <p className="text-sm text-red-700 dark:text-red-300">{fehler}</p>
      <button type="button" className={buttonVariants({ variant: "outline" })} onClick={onRetry}>
        {t("Erneut versuchen")}
      </button>
    </div>
  );
}

/**
 * Empty state of a tab that a later plan of phase 81 fills.
 * @param {{plan: string}} props plan number, e.g. "81-04"
 * @returns {React.ReactElement}
 */
export function ReiterPlatzhalter({ plan }) {
  const { t } = useI18n();
  return (
    <EmptyState
      icon={Hammer}
      title={t("Dieser Reiter ist noch im Aufbau")}
      description={t("Er kommt mit Plan {plan} der Phase 81.").replace("{plan}", plan)}
    />
  );
}
