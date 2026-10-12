// 73-11 (BEST-13): card "Antrag vor Vorhabenbeginn" in the funding planner. The project start is the earlier
// of the date entered on the project (`vorhabenbeginn`, additive field) and the first award in the AVA
// (Tender.awarded_date, written on award since 73-11). Each application gets its own "submitted on" date;
// antragReihenfolge() says per application whether the order holds. Reminder only, no eligibility statement.
//
// In:  antraege (FoerderAntrag rows), onAntragDatum(antrag, isoDate) → caller saves. Reads/writes
//      Project.vorhabenbeginn, reads Tender of the project.
// Out: card; data-testids fr-karte, fr-beginn, fr-zuschlag, fr-zeile-<id> (data-status), fr-datum-<id>.
import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { CalendarClock } from "lucide-react";
import { bitApi } from "@core/api/bitApi";
import { useI18n } from "@core/lib/i18n";
import { useProject } from "@core/lib/ProjectContext";
import { antragReihenfolge } from "@designer/lib/funding";

const FARBE = { pass: "border-emerald-200 bg-emerald-50", warn: "border-rose-200 bg-rose-50", offen: "border-amber-200 bg-amber-50" };

/**
 * @param {{antraege: Array<object>, onAntragDatum: (antrag: object, datum: string) => void, heute: string}} props
 */
export default function FoerderReihenfolge({ antraege, onAntragDatum, heute }) {
  const { t } = useI18n();
  const { project, reloadProjects } = useProject();
  const [zuschlag, setZuschlag] = useState(null);

  useEffect(() => {
    if (!project?.id) return undefined;
    let weg = false;
    bitApi.entities.Tender.filter({ project_id: project.id }).then((ts) => {
      const daten = (ts || []).filter((x) => x.status === "awarded" && x.awarded_date).map((x) => String(x.awarded_date).slice(0, 10)).sort();
      if (!weg) setZuschlag(daten[0] || null);
    }).catch(() => { if (!weg) setZuschlag(null); });
    return () => { weg = true; };
  }, [project?.id]);

  const zeilen = useMemo(() => antragReihenfolge(antraege, { vorhabenbeginn: project?.vorhabenbeginn || null, ersterZuschlag: zuschlag }, heute),
    [antraege, project?.vorhabenbeginn, zuschlag, heute]);

  const beginnSetzen = async (v) => {
    if (!project?.id) return;
    await bitApi.entities.Project.update(project.id, { vorhabenbeginn: v || null });
    await reloadProjects?.();
  };

  return (
    <Card data-testid="fr-karte">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><CalendarClock className="h-4 w-4" /> {t("Antrag vor Vorhabenbeginn")}</CardTitle>
        <p className="text-xs text-slate-500">{t("Als Vorhabenbeginn gilt meist schon der erste Liefer- oder Bauvertrag (Planung ausgenommen). Ein zu später Antrag kostet die ganze Förderung — Programmbedingungen prüfen.")}</p>
      </CardHeader>
      <CardContent className="space-y-2 text-xs">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2">{t("Vorhabenbeginn")}
            <input type="date" className="h-8 rounded border border-slate-200 px-2" data-testid="fr-beginn" defaultValue={project?.vorhabenbeginn || ""}
              key={`${project?.id}-${project?.vorhabenbeginn || ""}`} onBlur={(e) => { if ((e.target.value || null) !== (project?.vorhabenbeginn || null)) beginnSetzen(e.target.value); }} />
          </label>
          <span className="text-slate-500" data-testid="fr-zuschlag">{t("Erster Zuschlag in der AVA")}: {zuschlag ? new Date(`${zuschlag}T12:00:00`).toLocaleDateString("de-DE") : "—"}</span>
        </div>
        {zeilen.length === 0 && <p className="text-slate-400">{t("Noch keine Förderanträge.")}</p>}
        {zeilen.map((z) => {
          const a = antraege.find((x) => String(x.id) === z.id);
          return (
            <div key={z.id} className={`flex flex-wrap items-center gap-2 rounded border p-2 ${FARBE[z.status]}`} data-testid={`fr-zeile-${z.id}`} data-status={z.status}>
              <span className="font-medium">{z.titel}</span>
              <label className="flex items-center gap-1 text-slate-600">{t("gestellt am")}
                <input type="date" className="h-7 rounded border border-slate-200 bg-white px-1" data-testid={`fr-datum-${z.id}`}
                  key={`${z.id}-${a?.eingereicht_am || ""}`} defaultValue={a?.eingereicht_am || ""}
                  onBlur={(e) => { if (a && (e.target.value || "") !== (a.eingereicht_am || "")) onAntragDatum(a, e.target.value); }} />
              </label>
              <span className="text-slate-700">{z.detail}</span>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
