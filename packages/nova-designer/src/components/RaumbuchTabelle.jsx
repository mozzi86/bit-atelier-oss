// RaumbuchTabelle — room book per room type inside the space programme (88-05, RE-12):
// floor / skirting / wall / ceiling finishes, clear height with the minimum-height
// hint, remark; CSV export. Part of SpaceProgram (no second editor): it edits
// items[i].raumbuch through the parent's setter, the parent's "Speichern" writes it.
//
// In:  items (SpaceProgram rows), onChange(index, raumbuch), projektName (file name).
// Out: UI; data-testids rb-tabelle, rb-zeile (data-index, data-hinweis), rb-<feld>-<i>, rb-csv.
import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import { useI18n } from "@core/lib/i18n";
import { dateiAnbieten } from "@core/lib/tabellenExport";
import { usageInfo } from "@designer/lib/spaceProgram";
import { RAUMBUCH_FELDER, raumbuchVon, raumbuchHinweise, raumbuchCsv } from "@designer/lib/raumbuch";
import { BookOpen } from "lucide-react";

/**
 * @param {{items: Array<any>, onChange: (index: number, raumbuch: any) => void, projektName?: string}} props
 */
export default function RaumbuchTabelle({ items, onChange, projektName = "" }) {
  const { t } = useI18n();
  const setze = (i, key, wert) => onChange(i, { ...raumbuchVon(items[i]), [key]: wert });
  const csv = () => {
    const text = "﻿" + raumbuchCsv(items, (u) => t(usageInfo(u).label));
    const name = `Raumbuch_${String(projektName || "Projekt").replace(/[^\p{L}\p{N}_-]+/gu, "_")}.csv`;
    dateiAnbieten(new TextEncoder().encode(text), name, "text/csv;charset=utf-8");
  };
  return (
    <Card data-testid="rb-tabelle">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2"><BookOpen className="w-4 h-4" /> {t("Raumbuch je Raumtyp")}</span>
          <Button size="sm" variant="outline" data-testid="rb-csv" onClick={csv}>CSV</Button>
        </CardTitle>
        <p className="text-xs text-slate-400">{t("Ausbau je Zeile des Raumprogramms; „Speichern“ oben schreibt das Raumbuch mit.")}</p>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-400 border-b">
              <th className="py-1.5 px-1">{t("Raumtyp")}</th>
              {RAUMBUCH_FELDER.map((f) => <th key={f.key} className="py-1.5 px-1">{t(f.label)}</th>)}
              <th className="py-1.5 px-1">{t("Lichte Höhe (m)")}</th>
              <th className="py-1.5 px-1">{t("Bemerkung")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => {
              const r = raumbuchVon(it);
              const hw = raumbuchHinweise(it);
              const hoehe = hw.find((h) => h.code === "lichte_hoehe");
              return (
                <tr key={i} className="border-b last:border-0 align-top" data-testid="rb-zeile" data-index={i} data-hinweis={hw.map((h) => h.code).join(" ")}>
                  <td className="py-1 px-1 text-xs whitespace-nowrap">{t(usageInfo(it.use).label)}<div className="text-slate-400">{it.area} m² × {it.count}</div></td>
                  {RAUMBUCH_FELDER.map((f) => (
                    <td key={f.key} className="py-1 px-1">
                      <Input className="h-8 text-xs min-w-28" data-testid={`rb-${f.key}-${i}`} aria-label={`${t(f.label)} ${t(usageInfo(it.use).label)}`}
                        value={r[/** @type {"boden"|"sockel"|"wand"|"decke"} */ (f.key)]} onChange={(e) => setze(i, f.key, e.target.value)} />
                    </td>
                  ))}
                  <td className="py-1 px-1">
                    <Input className="h-8 text-xs w-20" type="number" step="0.01" data-testid={`rb-lichte_hoehe_m-${i}`} aria-label={t("Lichte Höhe (m)")}
                      value={r.lichte_hoehe_m ?? ""} onChange={(e) => setze(i, "lichte_hoehe_m", e.target.value === "" ? null : Number(e.target.value))} />
                    {hoehe && (
                      <div className="text-[11px] text-amber-700" data-testid={`rb-hinweis-${i}`}>
                        {t("Lichte Höhe unter dem Richtwert")} {String(hoehe.min_m).replace(".", ",")} m ({hoehe.quelle})
                      </div>
                    )}
                  </td>
                  <td className="py-1 px-1">
                    <Input className="h-8 text-xs min-w-28" data-testid={`rb-bemerkung-${i}`} aria-label={t("Bemerkung")}
                      value={r.bemerkung} onChange={(e) => setze(i, "bemerkung", e.target.value)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
