// 91-04: card "Nachhaltigkeitskonzept" in the energy tab of the ComplexDesigner. Reads — never writes —
// the figures the planners already own (rainwater via useRegenwasser, site-plan surfaces of
// aussenanlagen_layer, energy systems of complexData, plot area) and shows the four sections of
// nachhaltigkeitsModell with status, notes and gaps; one button exports the same model as PDF.
//
// In:  complexData ({ location, site_area, energy_systems }).
// Out: rendered card; data-testids nk-karte, nk-abschnitt-<key> (data-status), nk-wert-<key>-<i>
//      (data-wert = raw number), nk-luecken, nk-pdf, nk-pdf-status.
import React, { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Leaf, FileDown } from "lucide-react";
import { useI18n } from "@core/lib/i18n";
import { useProject } from "@core/lib/ProjectContext";
import { useFachlayer } from "@designer/lib/useFachlayer";
import { useRegenwasser } from "@designer/lib/useRegenwasser";
import { flaechenSummen, LAGEPLAN_DEFAULT } from "@designer/lib/lageplan";
import { nachhaltigkeitsModell, wertText, STATUS_TEXT } from "@designer/lib/nachhaltigkeitskonzept";

const STATUS_KLASSE = {
  umgesetzt: "bg-emerald-50 text-emerald-700 border-emerald-200",
  teilweise: "bg-amber-50 text-amber-800 border-amber-200",
  offen: "bg-slate-50 text-slate-500 border-slate-200",
};

/** Browser download of PDF bytes. */
function herunterladen(bytes, dateiname) {
  const url = URL.createObjectURL(new Blob([/** @type {BlobPart} */ (/** @type {unknown} */ (bytes))], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url; a.download = dateiname; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * @param {{complexData?: {location?: any, site_area?: number|string, energy_systems?: Array<{type?: string, capacity_kw?: number}>}}} props
 */
export default function NachhaltigkeitKarte({ complexData }) {
  const { t } = useI18n();
  const { project } = useProject();
  const rw = useRegenwasser({ location: complexData?.location || null });
  const [aussen] = useFachlayer(project?.id, "aussenanlagen_layer", LAGEPLAN_DEFAULT);
  const [status, setStatus] = useState("");
  const plot = Number(complexData?.site_area) > 0 ? Number(complexData.site_area) : Number(project?.site_area) > 0 ? Number(project.site_area) : null;

  const modell = useMemo(() => nachhaltigkeitsModell({
    regenwasser: rw, footArea_m2: rw.eingaben.footArea_m2, dachform: rw.eingaben.dachform, plot_m2: plot,
    flaechenSummen: flaechenSummen(aussen), energySystems: complexData?.energy_systems || [],
  }), [rw, plot, aussen, complexData?.energy_systems]);

  const pdfErzeugen = async () => {
    setStatus(t("PDF wird erzeugt …"));
    try {
      const { nachhaltigkeitPdf } = await import("@designer/lib/nachhaltigkeitPdf");
      const r = await nachhaltigkeitPdf(modell, project);
      herunterladen(r.bytes, r.dateiname);
      setStatus(`${t("PDF erzeugt")}: ${r.dateiname}`);
    } catch (e) {
      setStatus(`${t("PDF fehlgeschlagen")}: ${e?.message || e}`);
    }
  };

  return (
    <Card data-testid="nk-karte">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base"><Leaf className="h-4 w-4 text-emerald-600" /> {t("Nachhaltigkeitskonzept")}</CardTitle>
          <Button size="sm" variant="outline" onClick={pdfErzeugen} data-testid="nk-pdf"><FileDown className="mr-1 h-4 w-4" />{t("Konzeptblatt als PDF")}</Button>
        </div>
        <p className="text-xs text-slate-500">{t("Kennzahlen aus Entwässerungs-, Außenanlagen- und Energieplanung — Entwurf, keine Zertifizierung.")}</p>
        {rw.klimaStatus === "laedt" && <p className="text-[11px] text-slate-400">{t("Klima wird geladen …")}</p>}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          {modell.abschnitte.map((a) => (
            <div key={a.key} className="rounded-lg border p-3" data-testid={`nk-abschnitt-${a.key}`} data-status={a.status}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-slate-800">{t(a.titel)}</span>
                <span className={`rounded border px-1.5 py-0.5 text-[10px] ${STATUS_KLASSE[a.status]}`}>{t(STATUS_TEXT[a.status])}</span>
              </div>
              <dl className="space-y-0.5 text-xs">
                {a.zeilen.map((z, i) => (
                  <div key={z.label} className="flex justify-between gap-2" data-testid={`nk-wert-${a.key}-${i}`} data-wert={z.wert ?? ""}>
                    <dt className="text-slate-500">{t(z.label)}</dt>
                    <dd className="tabular-nums text-slate-800">{z.geschaetzt ? "ca. " : ""}{wertText(z)}</dd>
                  </div>
                ))}
              </dl>
              {a.hinweise.length > 0 && (
                <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[11px] text-slate-500">
                  {a.hinweise.map((h) => <li key={h}>{t(h)}</li>)}
                </ul>
              )}
            </div>
          ))}
        </div>
        {modell.luecken.length > 0 && (
          <ul className="rounded border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-900" data-testid="nk-luecken">
            {modell.luecken.map((l) => <li key={l}>{t(l)}</li>)}
          </ul>
        )}
        {status && <p className="text-xs text-slate-500" data-testid="nk-pdf-status">{status}</p>}
      </CardContent>
    </Card>
  );
}
