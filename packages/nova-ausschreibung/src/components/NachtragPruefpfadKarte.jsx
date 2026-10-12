// NachtragPruefpfadKarte — cost control card "Nachträge — Prüfpfad" (88-03, RE-16):
// the three amounts demanded → checked → released over the project's change
// orders, the reduction achieved by the review, and the review findings per
// change order (VOB/B § 2 Abs. 5/6).
//
// In:  changeOrders — already scoped to the active project (AVA.jsx: nachtraegeDesProjekts).
// Out: UI only. Sums and findings come from @core/lib/nachtragPruefpfad (pure).
// Hidden when no change order carries a review path (legacy data shows nothing new).
import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Stat } from "@core/components/Field";
import { useI18n } from "@core/lib/i18n";
import { nachtragStatusLabel } from "@core/lib/nachtraege";
import {
  hatPruefpfad, pruefHinweise, pruefpfadSummen, betragOderNull, nachtragArtLabel,
} from "@core/lib/nachtragPruefpfad";

const eur0 = (v) => (v == null ? "—" : new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v));

/**
 * @param {object} props
 * @param {Array<Record<string, any>>} props.changeOrders change orders of the active project
 */
export default function NachtragPruefpfadKarte({ changeOrders }) {
  const { t } = useI18n();
  const liste = (changeOrders || []).filter((o) => hatPruefpfad(o) && o.status !== "rejected");
  if (liste.length === 0) return null;
  const s = pruefpfadSummen(changeOrders);
  return (
    <Card data-testid="cc-nachtrag-pruefpfad">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t("Nachträge — Prüfpfad (VOB/B § 2 Abs. 5/6)")}</CardTitle>
        <p className="text-xs text-slate-400">
          {t("Hinweise statt Urteil: ob ein Anspruch besteht, entscheidet die Bauleitung.")}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div data-testid="cc-np-gefordert"><Stat label={t("Gefordert")} value={eur0(s.gefordert)} accent="text-slate-700" /></div>
          <div data-testid="cc-np-geprueft"><Stat label={t("Geprüft")} value={eur0(s.geprueft)} accent="text-blue-600" /></div>
          <div data-testid="cc-np-freigegeben"><Stat label={t("Freigegeben")} value={eur0(s.freigegeben)} accent="text-emerald-600" /></div>
          <div data-testid="cc-np-kuerzung">
            <Stat
              label={t("Kürzung durch Prüfung")}
              value={`${eur0(s.kuerzung)}${s.quote == null ? "" : ` (${((1 - s.quote) * 100).toFixed(1).replace(".", ",")} %)`}`}
              accent="text-amber-600"
            />
          </div>
        </div>
        {s.ohnePruefpfad > 0 && (
          <p className="text-xs text-slate-500">
            {t("{n} Nachträge ohne Prüfpfad (nur Kostenwirkung) sind nicht enthalten.").replace("{n}", String(s.ohnePruefpfad))}
          </p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400 border-b">
                <th className="py-2 px-2">{t("Nachtrag")}</th>
                <th className="py-2 px-2">{t("Art")}</th>
                <th className="py-2 px-2 text-right">{t("Gefordert")}</th>
                <th className="py-2 px-2 text-right">{t("Geprüft")}</th>
                <th className="py-2 px-2 text-right">{t("Freigegeben")}</th>
                <th className="py-2 px-2">{t("Status")}</th>
                <th className="py-2 px-2">{t("Prüfhinweise")}</th>
              </tr>
            </thead>
            <tbody>
              {liste.map((o) => {
                const hw = pruefHinweise(o);
                return (
                  <tr key={o.id} className="border-b last:border-0 align-top" data-testid="cc-np-zeile" data-nachtrag={o.id}>
                    <td className="py-1.5 px-2 font-medium">{o.title || "—"}</td>
                    <td className="py-1.5 px-2">{o.art ? t(nachtragArtLabel(o.art)) : "—"}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{eur0(betragOderNull(o.betrag_gefordert))}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{eur0(betragOderNull(o.betrag_geprueft))}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{eur0(betragOderNull(o.betrag_freigegeben))}</td>
                    <td className="py-1.5 px-2">{t(nachtragStatusLabel(o.status))}</td>
                    <td className="py-1.5 px-2 text-xs">
                      {hw.length === 0 ? <span className="text-emerald-700">{t("keine")}</span> : (
                        <ul className="space-y-0.5">
                          {hw.map((h) => (
                            <li key={h.code} data-code={h.code} className={h.stufe === "warn" ? "text-amber-700" : "text-slate-600"}>
                              {h.stufe === "warn" ? "⚠ " : "ℹ "}{t(h.text)}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
