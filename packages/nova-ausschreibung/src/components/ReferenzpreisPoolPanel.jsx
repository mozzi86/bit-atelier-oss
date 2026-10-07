import React, { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import { Badge } from "@core/components/ui/badge";
import { AlertTriangle, Download, Eye, Info, Search } from "lucide-react";
import { ratio as textRatio } from "@core/lib/textMatch";
import { ABGRENZUNG } from "@ava/lib/stlbMatch";
import { eur, num } from "./avaUtils";

// ReferenzpreisPoolPanel — der Büro-Preisspiegel.
//
// Aus dem Einmal-Skript `harvest_<referenz>.py` (ein Projekt, ein Lauf, eine JSON) wird
// hier ein Asset: die Preise, die das Büro schon einmal bezahlt hat, mit Herkunft,
// Stand und Einheit. Beim nächsten Projekt ist das der belastbarste Startpunkt,
// den es ohne Angebot gibt.
//
// Drei Grenzen, die diese Oberfläche einhält:
//
//  1. **Übernehmen erzeugt eine NEUE Schicht (Rang 30), nie ein Update.** Ein
//     überschriebener Preis ist ein verlorener Beleg. Vertrag, Nachtrag und
//     Marktpreis bleiben höherrangig — eine Übernahme kann sie nicht verdrängen.
//  2. **Sichtungsfälle sind sichtbar und NICHT aktiv.** Sie stehen in einer
//     eigenen Liste mit Grund. Ein Review, der stillschweigend mitrechnet, ist
//     kein Review.
//  3. **STLB-Zeilen tragen keinen Preis.** Dort steht ausdrücklich „ohne
//     DBD-BIM-Zugang nicht bepreisbar" — die Bilanz 2 hoch / 10 mittel / 485 kein
//     wird angezeigt und nicht geglättet. Und `priceReference.js` (TED/DÖE) bleibt
//     unangetastet: Los-Summen werden nie zu €/Einheit (Ehrlichkeitsgrenze aus
//     Phase 28).
export default function ReferenzpreisPoolPanel({
  pool = [],
  position = null,
  reviewSchichten = [],
  stlbBilanz = null,
  onUebernehmen,
}) {
  const [suche, setSuche] = useState("");
  const [nurPassende, setNurPassende] = useState(true);

  const zeilen = useMemo(() => {
    const t = suche.trim().toLowerCase();
    const eigen = position?.title ?? position?.kurztext ?? "";
    return (pool || [])
      .map((p) => ({
        ...p,
        // Die Ähnlichkeit zur aktuell gewählten Position — aus derselben
        // validierten Implementierung wie die Ernte, nicht aus einer zweiten.
        sim: eigen ? textRatio(eigen, p.kurztext) : null,
        einheit_passt: position?.unit == null || p.einheit == null
          ? null
          : String(p.einheit).toLowerCase() === String(position.unit).toLowerCase(),
      }))
      .filter((p) => !t || `${p.kurztext} ${p.gewerk ?? ""} ${p.projekt_nr ?? ""}`.toLowerCase().includes(t))
      .filter((p) => (nurPassende && position ? p.einheit_passt !== false : true))
      .sort((a, b) => (b.sim ?? 0) - (a.sim ?? 0))
      .slice(0, 300);
  }, [pool, suche, nurPassende, position]);

  const exportCsv = () => {
    const kopf = "kurztext;einheit;ep;stand;projekt_nr;gewerk;kg";
    const leib = (pool || [])
      .map((p) => [p.kurztext, p.einheit, p.ep, p.stand, p.projekt_nr, p.gewerk, p.kg]
        .map((v) => String(v ?? "").replace(/;/g, ",")).join(";"))
      .join("\n");
    const blob = new Blob([`${kopf}\n${leib}\n`], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "referenzpreis-pool.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Card className="border-slate-200">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex flex-wrap items-center justify-between gap-2">
          <span>Referenzpreis-Pool — Büro-Preisspiegel ({pool.length} Zeilen)</span>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-2 h-3 w-3 text-slate-400" />
              <Input
                className="h-8 w-52 pl-7 text-xs"
                placeholder="Kurztext, Gewerk, Projekt"
                value={suche}
                onChange={(e) => setSuche(e.target.value)}
              />
            </div>
            <Button size="sm" variant="outline" onClick={exportCsv} disabled={pool.length === 0}>
              <Download className="w-3 h-3 mr-1" /> CSV
            </Button>
          </div>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        <p className="text-xs text-slate-600 flex items-start gap-1">
          <Info className="w-3 h-3 mt-0.5 shrink-0" />
          <span>
            Preise aus eigenen Projekten, mit Herkunft und Stand. Eine Übernahme legt eine{" "}
            <strong>neue Preisschicht (Rang 30)</strong> an und überschreibt nichts — Vertrag,
            Nachtrag und Marktpreis bleiben stärker. Der Pool ist büroweit und wächst mit jedem
            Projekt.
          </span>
        </p>

        {pool.length === 0 && (
          <p className="rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
            Der Pool ist leer. Das ist Absicht: ein erfundener Referenzpreis wäre schlimmer als
            kein Referenzpreis. Gefüllt wird er über die Ernte aus einem eigenen Altprojekt
            (Reiter Preisspiegel → Ernte) oder von Hand.
          </p>
        )}

        {position && (
          <p className="text-xs text-emerald-800">
            Zielposition: <strong>{position.oz}</strong> {position.title}
            {position.unit ? ` · ${position.unit}` : ""}
            {nurPassende && " · es werden nur Zeilen mit passender Einheit gezeigt"}
          </p>
        )}
        {position && (
          <label className="flex items-center gap-1 text-[11px] text-slate-600">
            <input type="checkbox" checked={nurPassende} onChange={(e) => setNurPassende(e.target.checked)} />
            nur passende Einheit (verschiedene Einheiten sind nie vergleichbar)
          </label>
        )}

        {zeilen.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-300 text-left text-slate-500">
                  <th className="px-2 py-1">Kurztext (normalisiert)</th>
                  <th className="px-2 py-1">Einheit</th>
                  <th className="px-2 py-1 text-right">EP</th>
                  <th className="px-2 py-1">Stand</th>
                  <th className="px-2 py-1">Herkunft</th>
                  <th className="px-2 py-1">KG</th>
                  {position && <th className="px-2 py-1 text-right">Ähnlichkeit</th>}
                  <th className="px-2 py-1" />
                </tr>
              </thead>
              <tbody>
                {zeilen.map((p, i) => (
                  <tr key={p.id ?? i} className="border-b border-slate-100">
                    <td className="px-2 py-1 max-w-sm truncate" title={p.kurztext}>{p.kurztext}</td>
                    <td className="px-2 py-1">
                      {p.einheit ?? "—"}
                      {p.einheit_passt === false && (
                        <span className="ml-1 text-red-600" title="Einheit weicht ab — nicht vergleichbar">≠</span>
                      )}
                    </td>
                    <td className="px-2 py-1 text-right">{p.ep == null ? "—" : eur(p.ep)}</td>
                    <td className="px-2 py-1">{p.stand ?? "—"}</td>
                    <td className="px-2 py-1 text-slate-500">
                      {p.projekt_nr ? `Projekt ${p.projekt_nr}` : "—"}
                      {p.gewerk ? ` · ${p.gewerk}` : ""}
                    </td>
                    <td className="px-2 py-1">{p.kg ?? "—"}</td>
                    {position && (
                      <td className="px-2 py-1 text-right">{p.sim == null ? "—" : num(p.sim * 100, 0) + " %"}</td>
                    )}
                    <td className="px-2 py-1 whitespace-nowrap">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-[11px]"
                        disabled={!position || p.einheit_passt === false || p.ep == null}
                        onClick={() => onUebernehmen?.(p, position)}
                      >
                        auf Position übernehmen
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* --- Sichtungsliste: vorhanden, sichtbar, NICHT aktiv --------------- */}
        <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-2 space-y-1">
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-900">
            <Eye className="w-3 h-3" /> Sichtung ({reviewSchichten.length}) — vorhanden, aber
            NICHT aktiv
          </div>
          {reviewSchichten.length === 0 ? (
            <p className="text-[11px] text-slate-600">Keine Sichtungsfälle.</p>
          ) : (
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-left text-amber-900">
                  <th className="px-1 py-0.5">Position</th>
                  <th className="px-1 py-0.5 text-right">EP</th>
                  <th className="px-1 py-0.5 text-right">Ähnlichkeit</th>
                  <th className="px-1 py-0.5 text-right">Verhältnis zur Basis</th>
                  <th className="px-1 py-0.5">Grund</th>
                </tr>
              </thead>
              <tbody>
                {reviewSchichten.map((s, i) => (
                  <tr key={s.id ?? i} className="border-t border-amber-200/60">
                    <td className="px-1 py-0.5">{s.position_id}</td>
                    <td className="px-1 py-0.5 text-right">{s.ep == null ? "—" : eur(s.ep)}</td>
                    <td className="px-1 py-0.5 text-right">{s.match?.similarity ?? "—"}</td>
                    <td className="px-1 py-0.5 text-right">{s.match?.ratio ?? "—"}</td>
                    <td className="px-1 py-0.5">{s.review?.grund ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-[10px] text-amber-800">
            Diese Schichten sind angelegt und einsehbar, werden von der Rangfolge aber
            <strong> nicht aktiv geschaltet</strong>. Sie zählen deshalb in keiner Summe mit.
          </p>
        </div>

        {/* --- STLB: Schlüssel ja, Preis nein -------------------------------- */}
        {stlbBilanz && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-semibold text-slate-700">STLB-Bau-Zuordnung:</span>
              <Badge className="text-[10px] bg-emerald-100 text-emerald-800 border border-emerald-300">
                {stlbBilanz.hoch} hoch
              </Badge>
              <Badge className="text-[10px] bg-amber-100 text-amber-800 border border-amber-300">
                {stlbBilanz.mittel} mittel
              </Badge>
              <Badge variant="outline" className="text-[10px] border-slate-300 text-slate-600">
                {stlbBilanz.kein} kein
              </Badge>
            </div>
            <p className="text-[11px] text-slate-700 flex items-start gap-1">
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0 text-amber-600" />
              <span>
                <strong>{ABGRENZUNG}</strong> Die Trefferquote von{" "}
                {stlbBilanz.gesamt
                  ? num(((stlbBilanz.hoch + stlbBilanz.mittel) / stlbBilanz.gesamt) * 100, 1)
                  : "—"}{" "}
                % ist der ehrliche Ist-Zustand ohne DBD-Zugang, kein Fehler. Sie wird nicht
                durch eine niedrigere Schwelle verbessert — dafür braucht es mehr geerntete
                STLB-Schlüssel.
              </span>
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
