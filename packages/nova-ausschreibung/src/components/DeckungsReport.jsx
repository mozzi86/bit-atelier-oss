import React, { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Badge } from "@core/components/ui/badge";
import { Button } from "@core/components/ui/button";
import { Download, Info, Search } from "lucide-react";
import { deckungsReport } from "@ava/lib/deckung";
import { buildDeckungWorkbook } from "@ava/lib/kbWorkbook";
import { downloadXlsx } from "@ava/lib/novaXlsx";
import { num } from "./avaUtils";

// Deckungsreport — in BEIDE Richtungen.
//
// Richtung 1: welches Bauteil trägt keine LV-Position? (die Arbeitsliste)
// Richtung 2: welche Position trägt keine Bauteile? (die Gegenprobe)
//
// Der Kopf zeigt den Deckungsgrad auf ZWEI Ebenen — Gruppen und Elemente — und
// nie eine einzelne Prozentzahl. Grund: Pauschal- und Übernahmepositionen decken
// fachlich Bauteile ab, tragen aber keine GUID. Eine Zahl allein würde entweder
// sie unterschlagen oder eine Verknüpfung behaupten, die es nicht gibt. Die
// Definition steht sichtbar darüber, nicht im Quelltext.
export default function DeckungsReport({ elemente = [], positionen = [], kataloge = {} }) {
  const [filterText, setFilterText] = useState("");
  const [nurUngedeckt, setNurUngedeckt] = useState(true);

  const report = useMemo(
    () => deckungsReport(elemente, positionen, { kgRegeln: kataloge.KgRegel || [] }),
    [elemente, positionen, kataloge.KgRegel],
  );

  const zeilen = useMemo(() => {
    const t = filterText.trim().toLowerCase();
    return report.gruppen
      .filter((g) => (nurUngedeckt ? g.ungedeckt > 0 : true))
      .filter((g) => !t || `${g.status} ${g.klasse_de} ${g.typ} ${g.zielgewerk || ""}`.toLowerCase().includes(t))
      .slice(0, 500);
  }, [report, filterText, nurUngedeckt]);

  const exportieren = () => {
    downloadXlsx("bauteile-ohne-lv-position.xlsx", buildDeckungWorkbook(report));
  };

  const stati = Object.values(report.je_status).sort((a, b) => b.elemente - a.elemente);

  return (
    <Card className="border-slate-200">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between">
          <span>Deckung — Bauteile ohne LV-Position</span>
          <Button size="sm" variant="outline" onClick={exportieren}>
            <Download className="w-3 h-3 mr-1" /> XLSX
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-slate-600 flex items-start gap-1">
          <Info className="w-3 h-3 mt-0.5 shrink-0" />
          <span>
            <strong>Deckungsdefinition:</strong> {report.definition} — Diese Zahl ist ein
            <strong> Deckungsgrad der Verknüpfung</strong>, keine Aussage über die fachliche
            Vollständigkeit des Leistungsverzeichnisses. Von {report.positionen_gesamt} Positionen
            tragen {report.positionen_gesamt - report.positionen_ohne_bauteile.length} überhaupt
            GUIDs; die übrigen sind Pauschal- oder Übernahmepositionen ohne Modellbezug.
          </span>
        </p>

        {/* Deckungsgrad je Zustand, BEIDE Ebenen */}
        <div className="overflow-x-auto">
          <table className="text-xs w-full">
            <thead>
              <tr className="text-left border-b border-slate-300">
                <th className="px-2 py-1">Zustand</th>
                <th className="px-2 py-1">Bauteile</th>
                <th className="px-2 py-1">direkt verknüpft</th>
                <th className="px-2 py-1">Deckung (Elemente)</th>
                <th className="px-2 py-1">Gruppen</th>
                <th className="px-2 py-1">Gruppen mit Position</th>
                <th className="px-2 py-1">Deckung (Gruppen)</th>
              </tr>
            </thead>
            <tbody>
              {stati.map((s) => (
                <tr key={s.status} className="border-b border-slate-100">
                  <td className="px-2 py-1 font-medium">{s.status === "?" ? "unbekannt" : s.status}</td>
                  <td className="px-2 py-1 tabular-nums">{s.elemente}</td>
                  <td className="px-2 py-1 tabular-nums">{s.elemente_direkt}</td>
                  <td className="px-2 py-1 tabular-nums">{num(s.deckung_elemente_prozent, 1)} %</td>
                  <td className="px-2 py-1 tabular-nums">{s.gruppen}</td>
                  <td className="px-2 py-1 tabular-nums">{s.gruppen_gedeckt}</td>
                  <td className="px-2 py-1 tabular-nums">{num(s.deckung_gruppen_prozent, 1)} %</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap gap-2 items-center text-xs">
          <Badge variant="outline">{report.gruppen_gesamt} Gruppen</Badge>
          <Badge variant="outline">{report.gruppen_ohne_position} ohne Position</Badge>
          <Badge variant="outline">{report.guids_distinct} verknüpfte Bauteile</Badge>
          <Badge variant="outline">
            {report.guids_summe_ueber_positionen} Verknüpfungen (Mehrfachnutzung möglich)
          </Badge>
          <div className="ml-auto flex items-center gap-2">
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={nurUngedeckt} onChange={(e) => setNurUngedeckt(e.target.checked)} />
              nur ungedeckte
            </label>
            <span className="relative">
              <Search className="w-3 h-3 absolute left-2 top-2 text-slate-400" />
              <input
                className="pl-6 pr-2 py-1 border border-slate-200 rounded text-xs"
                placeholder="Zustand / Klasse / Typ / Gewerk"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
              />
            </span>
          </div>
        </div>

        <div className="overflow-x-auto max-h-[32rem]">
          <table className="text-xs w-full">
            <thead className="sticky top-0 bg-white">
              <tr className="text-left border-b border-slate-300">
                <th className="px-2 py-1">Zustand</th>
                <th className="px-2 py-1">IFC-Klasse</th>
                <th className="px-2 py-1">Bauteiltyp</th>
                <th className="px-2 py-1">Geschoss(e)</th>
                <th className="px-2 py-1">Anzahl</th>
                <th className="px-2 py-1">ungedeckt</th>
                <th className="px-2 py-1">Fläche</th>
                <th className="px-2 py-1">Volumen</th>
                <th className="px-2 py-1">Länge</th>
                <th className="px-2 py-1">Zielgewerk (Vorschlag)</th>
                <th className="px-2 py-1">Einschätzung</th>
                <th className="px-2 py-1">Beispiel-GlobalId</th>
              </tr>
            </thead>
            <tbody>
              {zeilen.map((g) => (
                <tr key={g.key} className="border-b border-slate-100">
                  <td className="px-2 py-1">{g.status === "?" ? "unbekannt" : g.status}</td>
                  <td className="px-2 py-1">{g.klasse_de}</td>
                  <td className="px-2 py-1 max-w-[18rem] truncate" title={g.typ}>{g.typ}</td>
                  <td className="px-2 py-1 max-w-[10rem] truncate" title={g.geschosse}>{g.geschosse}</td>
                  <td className="px-2 py-1 tabular-nums">{g.anzahl}</td>
                  <td className="px-2 py-1 tabular-nums">{g.ungedeckt}</td>
                  <td className="px-2 py-1 tabular-nums">{g.flaeche == null ? "—" : num(g.flaeche)}</td>
                  <td className="px-2 py-1 tabular-nums">{g.volumen == null ? "—" : num(g.volumen)}</td>
                  <td className="px-2 py-1 tabular-nums">{g.laenge == null ? "—" : num(g.laenge)}</td>
                  <td className="px-2 py-1" title={g.zielgewerk_sicherheit || ""}>
                    {g.zielgewerk || <span className="text-slate-400">kein Vorschlag</span>}
                    {g.zielgewerk_kg ? <span className="text-slate-400"> · KG {g.zielgewerk_kg}</span> : null}
                  </td>
                  <td className="px-2 py-1">{g.einschaetzung}</td>
                  <td className="px-2 py-1 font-mono text-[10px]">{g.beispiel_guid}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {report.gruppen.length > zeilen.length && (
            <p className="mt-1 text-[11px] text-slate-500">
              {zeilen.length} von {report.gruppen.length} Gruppen angezeigt — Filter nutzen oder XLSX exportieren.
            </p>
          )}
        </div>

        {/* Richtung 2: die Gegenprobe */}
        <details className="text-xs">
          <summary className="cursor-pointer font-medium">
            Gegenprobe: {report.positionen_ohne_bauteile.filter((p) => p.befund.startsWith("Modellbindung")).length}{" "}
            Position(en) erwarten eine Modellbindung, tragen aber keine Bauteile
          </summary>
          <ul className="mt-1 list-disc pl-5">
            {report.positionen_ohne_bauteile
              .filter((p) => p.befund.startsWith("Modellbindung"))
              .map((p, i) => (
                <li key={i}>
                  {p.trade} · OZ {p.oz} — {p.title} <span className="text-amber-700">({p.befund})</span>
                </li>
              ))}
            {report.positionen_ohne_bauteile.filter((p) => p.befund.startsWith("Modellbindung")).length === 0 && (
              <li className="text-slate-500 list-none">
                Keine. Die {report.positionen_ohne_bauteile.length} übrigen Positionen ohne GUIDs sind
                Pauschal- oder Übernahmepositionen — dort ist „keine Bauteile" der Normalfall,
                kein Befund.
              </li>
            )}
          </ul>
        </details>
      </CardContent>
    </Card>
  );
}
