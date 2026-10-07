import React, { useEffect, useMemo, useState } from "react";
import { Badge } from "@core/components/ui/badge";
import { AlertTriangle, CheckCircle2, Layers, Loader2 } from "lucide-react";
import { mengeVonRegel } from "@core/lib/rules/ruleEngine";
import { gruppiere, statusKey } from "@core/lib/rules/elementIndex";

// TrefferListe — Live-Rückmeldung zum Selektor.
//
// Der wichtigste Teil dieser Datei ist NICHT die Tabelle, sondern die Kopfzeile:
//
//   **„0 Treffer" ist ein sichtbarer Fehlerzustand mit eigener Badge**, keine
//   leere Tabelle. Und **„Menge 0 bei Treffern > 0"** ebenso.
//
// Grund (Pitfall 13 / T-33-19): eine leere Tabelle liest sich wie „noch nichts
// eingestellt". Ein Status-Casing-Fehler („neubau" statt „Neubau") oder ein
// Tippfehler in der Mengenbasis erzeugt aber genau dieses Bild — und die Menge
// 0,00 wandert unbemerkt ins Leistungsverzeichnis. Deshalb wird hier
// AUSGESPROCHEN, was der Zustand bedeutet, samt der drei üblichen Ursachen.
//
// Debounce statt Worker: der Vorindex (`buildIndex`) macht den Lauf über 6.038
// Bauteile schnell genug (< 30 ms), ein Worker wäre hier zusätzliche Mechanik
// ohne Gewinn. Der Recompute über ALLE 497 Positionen läuft dagegen im Worker
// (siehe `regelLauf`) — dort geht es um 497 × 6.038.
export default function TrefferListe({
  selektor,
  mengenbasis = null,
  faktor = 1,
  elemente = [],
  index = null,
  maxZeilen = 200,
  debounceMs = 250,
}) {
  const [angewandt, setAngewandt] = useState(null);
  const [rechnet, setRechnet] = useState(false);

  // Debounce: bei jedem Tastendruck neu zu rechnen macht die Eingabe zäh.
  useEffect(() => {
    setRechnet(true);
    const t = setTimeout(() => {
      setAngewandt({ selektor, mengenbasis, faktor });
      setRechnet(false);
    }, debounceMs);
    return () => clearTimeout(t);
  }, [selektor, mengenbasis, faktor, debounceMs]);

  const ergebnis = useMemo(() => {
    if (!angewandt) return null;
    const regel = {
      art: "modell",
      op: "add",
      selektor: angewandt.selektor,
      mengenbasis: angewandt.mengenbasis,
      faktor: angewandt.faktor,
    };
    return mengeVonRegel(regel, index || elemente || []);
  }, [angewandt, index, elemente]);

  const treffer = useMemo(() => {
    if (!ergebnis) return [];
    const ids = new Set(ergebnis.element_ids);
    const alle = Array.isArray(elemente) ? elemente : index?.alle || [];
    return alle.filter((e) => ids.has(e?.guid));
  }, [ergebnis, elemente, index]);

  const gruppen = useMemo(() => {
    const g = gruppiere(treffer);
    return Object.entries(g)
      .map(([key, v]) => {
        const [klasse, status, typ] = key.split("|");
        return { key, klasse, status, typ, ...v };
      })
      .sort((a, b) => b.count - a.count);
  }, [treffer]);

  const keineTreffer = !!ergebnis && ergebnis.treffer === 0;
  const mengeNull = !!ergebnis && ergebnis.treffer > 0 && ergebnis.menge === 0;
  const ohneBasis = !angewandt?.mengenbasis;

  return (
    <div className="space-y-3">
      {/* --- Kopf: Trefferzahl, Summe der Mengenbasis, Fehlerzustände -------- */}
      <div className="flex flex-wrap items-center gap-2">
        {rechnet ? (
          <Badge variant="outline" className="text-xs border-slate-300 text-slate-500">
            <Loader2 className="w-3 h-3 mr-1 animate-spin" /> rechnet …
          </Badge>
        ) : keineTreffer ? (
          // DER Fehlerzustand. Rot, benannt, mit den drei üblichen Ursachen.
          <Badge className="text-xs bg-red-100 text-red-700 border border-red-300">
            <AlertTriangle className="w-3 h-3 mr-1" /> 0 Treffer — der Selektor greift nicht
          </Badge>
        ) : (
          <Badge className="text-xs bg-emerald-100 text-emerald-800 border border-emerald-300">
            <CheckCircle2 className="w-3 h-3 mr-1" /> {ergebnis.treffer} Treffer
          </Badge>
        )}

        <Badge variant="outline" className="text-xs border-slate-300 text-slate-600">
          <Layers className="w-3 h-3 mr-1" /> {gruppen.length} Gruppen
        </Badge>

        {ergebnis && !ohneBasis && (
          <Badge
            variant="outline"
            className={`text-xs ${mengeNull ? "border-amber-400 text-amber-700" : "border-slate-300 text-slate-700"}`}
          >
            Σ {angewandt.mengenbasis}
            {angewandt.faktor !== 1 ? ` × ${angewandt.faktor}` : ""} = {ergebnis.menge}
          </Badge>
        )}
        {ohneBasis && (
          <Badge className="text-xs bg-amber-100 text-amber-800 border border-amber-300">
            keine Mengenbasis gewählt — es wird NICHTS gerechnet
          </Badge>
        )}
        {mengeNull && (
          // Der heimtückischste Fall: es gibt Treffer, aber die Größe ist überall 0
          // oder fehlt. Ohne diese Badge sähe die Position nach „0,00 m²" aus.
          <Badge className="text-xs bg-amber-100 text-amber-800 border border-amber-300">
            <AlertTriangle className="w-3 h-3 mr-1" /> Menge 0 trotz Treffer — Größe fehlt oder ist 0
          </Badge>
        )}
      </div>

      {keineTreffer && (
        <div className="rounded-md border border-red-200 bg-red-50 p-2 text-[11px] text-red-800">
          <strong>Kein Ergebnis ist kein Ergebnis.</strong> Die drei üblichen Ursachen:
          <ol className="mt-1 ml-4 list-decimal space-y-0.5">
            <li>Status-Schreibweise („Neubau“ ≠ „neubau“ — der Katalog StatusKonvention entscheidet)</li>
            <li>Muster zu eng oder abgewiesen (ein abgewiesenes Regex-Muster trifft absichtlich nichts)</li>
            <li>IFC-Klasse im aktiven Bauteilstand nicht vorhanden</li>
          </ol>
        </div>
      )}

      {ergebnis?.warnungen?.length > 0 && (
        <ul className="space-y-0.5 text-[11px] text-amber-700">
          {ergebnis.warnungen.map((w, i) => (
            <li key={i} className="flex items-start gap-1">
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" /> {w}
            </li>
          ))}
        </ul>
      )}

      {/* --- Gruppierte Trefferliste ---------------------------------------- */}
      {gruppen.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-300 text-left text-slate-500">
                <th className="px-2 py-1">Klasse</th>
                <th className="px-2 py-1">Status</th>
                <th className="px-2 py-1">Typ / Name</th>
                <th className="px-2 py-1 text-right">Anzahl</th>
                <th className="px-2 py-1 text-right">
                  Σ {angewandt?.mengenbasis || "—"}
                </th>
                <th className="px-2 py-1">Geschosse</th>
              </tr>
            </thead>
            <tbody>
              {gruppen.slice(0, maxZeilen).map((g) => (
                <tr key={g.key} className="border-b border-slate-100">
                  <td className="px-2 py-1">{g.klasse}</td>
                  <td className="px-2 py-1">{g.status}</td>
                  <td className="px-2 py-1 max-w-xs truncate" title={g.typ}>{g.typ}</td>
                  <td className="px-2 py-1 text-right">{g.count}</td>
                  <td className="px-2 py-1 text-right">
                    {angewandt?.mengenbasis === "Count"
                      ? g.count
                      : g.qty?.[angewandt?.mengenbasis] ?? (
                          <span className="text-amber-600">— fehlt</span>
                        )}
                  </td>
                  <td className="px-2 py-1 text-slate-500">
                    {Object.keys(g.geschosse || {}).slice(0, 3).join(", ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {gruppen.length > maxZeilen && (
            <p className="mt-1 text-[10px] text-slate-400">
              {gruppen.length - maxZeilen} weitere Gruppen nicht angezeigt (Summe oben ist vollständig)
            </p>
          )}
        </div>
      )}

      {/* Zustandsverteilung — der schnellste Weg, einen Casing-Fehler zu sehen. */}
      {treffer.length > 0 && (
        <p className="text-[10px] text-slate-400">
          Zustände der Treffer:{" "}
          {Object.entries(
            treffer.reduce((a, e) => {
              const s = statusKey(e);
              a[s] = (a[s] || 0) + 1;
              return a;
            }, {}),
          )
            .map(([s, n]) => `${s} ${n}`)
            .join(" · ")}
        </p>
      )}
    </div>
  );
}
