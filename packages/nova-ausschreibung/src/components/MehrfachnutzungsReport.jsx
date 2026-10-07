import React, { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Badge } from "@core/components/ui/badge";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { mehrfachnutzung } from "@ava/lib/mengenregeln";

// MehrfachnutzungsReport — welches Bauteil ist in MEHR ALS EINER Position
// mengenwirksam?
//
// Die Frage klingt technisch, ist aber die teuerste im ganzen Modul: dasselbe
// Bauteil zweimal abgerechnet ist eine Doppelzählung, und über 6.038 Bauteile
// summiert sich das.
//
// Zwei Fälle sind LEGITIM und dürfen nicht als Befund erscheinen:
//   * **Zulage / Folgeleistung** (`zulage_zu` gepflegt): die Erstbeschichtung einer
//     Trockenbauwand nutzt dieselbe Fläche wie die Wandposition — zwei Gewerke,
//     eine Fläche. Im Referenzprojekt sind das 336 Bauteile.
//   * **`op: "sub"`**: ein Abzug ist keine zweite Verrechnung.
//
// Ein Report, der die 336 legitimen Fälle als Befund meldet, wird nach zwei Tagen
// nicht mehr geöffnet — und damit ist auch der echte 337. Fall unsichtbar. Deshalb
// ist die Trennung „legitim / Befund" hier keine Kosmetik, sondern die Bedingung
// dafür, dass der Report überhaupt benutzt wird.
export default function MehrfachnutzungsReport({
  positionen = [],
  regelnJePosition = null,
  elemente = [],
  maxZeilen = 200,
}) {
  const [zeige, setZeige] = useState("befunde");

  const eingabe = useMemo(() => {
    const regelnVon =
      typeof regelnJePosition === "function"
        ? regelnJePosition
        : regelnJePosition
          ? (p) => regelnJePosition[p?.id] || []
          : (p) => p?.regeln || [];
    return (positionen || [])
      .map((p) => ({ position: p.id ?? p.oz, oz: p.oz, trade: p.trade, regeln: regelnVon(p) || [] }))
      .filter((p) => p.regeln.length > 0);
  }, [positionen, regelnJePosition]);

  const report = useMemo(() => mehrfachnutzung(eingabe, elemente), [eingabe, elemente]);

  // Befunde zu GUID-Gruppen zusammenfassen — 257 Einzelzeilen für denselben
  // Sachverhalt sind keine Information, sondern Lärm.
  const gruppiert = useMemo(() => {
    const map = new Map();
    for (const e of report.befunde) {
      const key = `${[...e.positionen].sort().join(" + ")}|${e.mengenbasis}`;
      if (!map.has(key)) {
        map.set(key, { positionen: e.positionen, mengenbasis: e.mengenbasis, guids: [], anzahl: 0 });
      }
      const g = map.get(key);
      g.guids.push(e.guid);
      g.anzahl += 1;
    }
    return [...map.values()].sort((a, b) => b.anzahl - a.anzahl);
  }, [report.befunde]);

  const erklaertGruppiert = useMemo(() => {
    const map = new Map();
    for (const e of report.erklaert) {
      const key = `${[...e.positionen].sort().join(" + ")}|${e.mengenbasis}`;
      if (!map.has(key)) {
        map.set(key, { positionen: e.positionen, mengenbasis: e.mengenbasis, anzahl: 0 });
      }
      map.get(key).anzahl += 1;
    }
    return [...map.values()].sort((a, b) => b.anzahl - a.anzahl);
  }, [report.erklaert]);

  const liste = zeige === "befunde" ? gruppiert : erklaertGruppiert;

  return (
    <Card className="border-slate-200">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex flex-wrap items-center justify-between gap-2">
          <span>Mehrfachnutzung — Doppelzählung finden</span>
          <div className="flex items-center gap-2">
            {report.befunde.length === 0 ? (
              <Badge className="text-xs bg-emerald-100 text-emerald-800 border border-emerald-300">
                <CheckCircle2 className="w-3 h-3 mr-1" /> 0 Befunde
              </Badge>
            ) : (
              <Badge className="text-xs bg-red-100 text-red-700 border border-red-300">
                <AlertTriangle className="w-3 h-3 mr-1" /> {report.befunde.length} Bauteile ohne
                gepflegten Bezug
              </Badge>
            )}
            <Badge variant="outline" className="text-xs border-slate-300 text-slate-600">
              {report.erklaert.length} legitim (Zulage / Folgeleistung)
            </Badge>
          </div>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-3">
        <p className="text-xs text-slate-600 flex items-start gap-1">
          <Info className="w-3 h-3 mt-0.5 shrink-0" />
          <span>
            Gezählt wird je <strong>Bauteil und Mengenbasis</strong>: derselbe Körper darf in
            zwei Positionen stehen, wenn die zweite eine <strong>Zulage oder Folgeleistung</strong>
            {" "}ist (Feld <code>zulage_zu</code> im Regel-Editor) — z. B. Wandfläche und ihre
            Erstbeschichtung. Ein <code>op: „sub"</code>-Abzug zählt nie mit. Alles andere ist
            ein Befund und sollte entweder erklärt oder abgestellt werden.
          </span>
        </p>

        <div className="flex gap-2 text-xs">
          <button
            type="button"
            onClick={() => setZeige("befunde")}
            className={`rounded border px-2 py-0.5 ${zeige === "befunde" ? "border-red-300 bg-red-50 text-red-700" : "border-slate-200 text-slate-600"}`}
          >
            Befunde ({gruppiert.length} Gruppen)
          </button>
          <button
            type="button"
            onClick={() => setZeige("erklaert")}
            className={`rounded border px-2 py-0.5 ${zeige === "erklaert" ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-600"}`}
          >
            legitim ({erklaertGruppiert.length} Gruppen)
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-300 text-left text-slate-500">
                <th className="px-2 py-1">beteiligte Positionen (OZ)</th>
                <th className="px-2 py-1">Mengenbasis</th>
                <th className="px-2 py-1 text-right">Bauteile</th>
                <th className="px-2 py-1">Einschätzung</th>
              </tr>
            </thead>
            <tbody>
              {liste.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-2 py-3 text-slate-400">
                    {zeige === "befunde"
                      ? "Keine Doppelzählung ohne gepflegten Bezug — das ist das erwünschte Ergebnis, nicht ein leerer Report."
                      : "Keine als Zulage/Folgeleistung gepflegten Mehrfachnutzungen."}
                  </td>
                </tr>
              )}
              {liste.slice(0, maxZeilen).map((g, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="px-2 py-1">{g.positionen.join("  +  ")}</td>
                  <td className="px-2 py-1">{g.mengenbasis}</td>
                  <td className="px-2 py-1 text-right">{g.anzahl}</td>
                  <td className={`px-2 py-1 ${zeige === "befunde" ? "text-red-700" : "text-emerald-700"}`}>
                    {zeige === "befunde"
                      ? "BEFUND — kein Bezug gepflegt: entweder zulage_zu setzen oder eine der Regeln korrigieren"
                      : "legitim — Zulage / Folgeleistung zur Basisposition"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {zeige === "befunde" && gruppiert.length > 0 && (
          <p className="text-[10px] text-slate-400">
            Beispiel-GUIDs der größten Gruppe: {gruppiert[0].guids.slice(0, 3).join(", ")}
            {gruppiert[0].guids.length > 3 ? " …" : ""}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
