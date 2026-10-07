// BimTaskPanel — open BIM tickets in the site control room, each can be handed to
// an idle robot.
// 72-14 (N-14): the ticket title links to the ticket in the BIM viewer
// (ticketUrl, @ifc/lib/ticketLink) and every ticket offers "Nachtrag anlegen" —
// the Finance form prefilled from it (neuerNachtragUrl, @core/lib/nachtraege).
// Priority shows the German label; the stored value stays the English key.
//
// In (props): issues (Issue records), units (SiteUnit records), onAssign(issue).
// Out: UI only; the robot assignment is written by the page.
import React from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Badge } from "@core/components/ui/badge";
import { buttonVariants } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { neuerNachtragUrl } from "@core/lib/nachtraege";
import { ticketUrl, prioritaetLabel, istOffen } from "@ifc/lib/ticketLink";
import { Bot, AlertTriangle, FilePlus2 } from "lucide-react";

const prio = {
  low: "bg-emerald-100 text-emerald-800",
  medium: "bg-amber-100 text-amber-800",
  high: "bg-red-100 text-red-800",
  critical: "bg-red-200 text-red-900",
};

export default function BimTaskPanel({ issues = [], units = [], onAssign }) {
  const { t } = useI18n();
  const open = issues.filter(istOffen);
  const freeUnit = units.find((u) => u.status === "idle" && u.type === "robot");
  // Native elements with the shadcn classes: <Button> costs a tsc error per use.
  const knopf = buttonVariants({ variant: "outline", size: "sm" });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="w-4 h-4" /> {t("BIM-Tickets → Roboterauftrag")} ({open.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {open.length === 0 && <p className="text-sm text-slate-500">{t("Keine offenen BIM-Tickets.")}</p>}
        {open.map((issue) => {
          const titel = issue.title || t("(ohne Titel)");
          const prioText = prioritaetLabel(issue.priority);
          return (
            <div key={issue.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2.5">
              <div className="min-w-0">
                <Link
                  to={ticketUrl(issue.id)}
                  className="block truncate text-sm font-medium text-slate-800 underline-offset-4 hover:underline"
                >
                  {titel}
                </Link>
                <div className="text-xs text-slate-500 flex items-center gap-2">
                  {prioText && <Badge className={`${prio[issue.priority] || ""} text-[10px]`}>{t(prioText)}</Badge>}
                  {issue.assigned_unit_name ? (
                    <span className="text-blue-600">→ {issue.assigned_unit_name}</span>
                  ) : (
                    <span>{t("offen")}</span>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {/* The aria-label starts with the visible text (label in name). */}
                <Link
                  to={neuerNachtragUrl(issue.id)}
                  className={knopf}
                  aria-label={t("Nachtrag anlegen zu Ticket „{titel}“").replace("{titel}", titel)}
                >
                  <FilePlus2 className="w-4 h-4" aria-hidden="true" />
                  {t("Nachtrag anlegen")}
                </Link>
                <button
                  type="button"
                  className={knopf}
                  disabled={!freeUnit || issue.status === "in_progress"}
                  onClick={() => onAssign(issue)}
                >
                  <Bot className="w-4 h-4" aria-hidden="true" />
                  {issue.status === "in_progress" ? t("zugewiesen") : t("Roboter beauftragen")}
                </button>
              </div>
            </div>
          );
        })}
        {open.length > 0 && !freeUnit && (
          <p className="text-xs text-amber-600">{t("Kein freier Roboter — Einheit stoppen/freigeben, um zu beauftragen.")}</p>
        )}
      </CardContent>
    </Card>
  );
}
