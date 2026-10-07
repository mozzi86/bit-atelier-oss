import React, { useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Badge } from "@core/components/ui/badge";
import {
  FileUp, Loader2, AlertTriangle, CheckCircle2, Undo2, Building2, Boxes,
} from "lucide-react";
import { parseIfcFile, mapToClassifiedElements } from "@ifc/lib/ifcImport";

const nf = new Intl.NumberFormat("de-DE");

// IFC-Import (web-ifc, WASM lokal) — Phase 26: echte Archicad-/IFC-Exporte als
// Mengenquelle für die filterbasierte AVA-Mengenermittlung (Phase 25).
// Props:
//   onUse(mapped)  — gemappte classifiedElements-Liste als Mengenquelle setzen
//   active         — true, wenn aktuell das IFC-Modell die Mengenquelle ist
//   count          — Anzahl aktiver IFC-Bauteile (für das Badge)
//   onReset()      — zurück zum BIT-BIM-Modell
export default function IfcImportPanel({ onUse, active = false, count = 0, onReset }) {
  const [busy, setBusy] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [error, setError] = useState("");
  const [parsed, setParsed] = useState(null); // parseIfcFile-Ergebnis
  const [fileName, setFileName] = useState("");
  const inputRef = useRef(null);

  // Badges je ifcType (absteigend nach Anzahl).
  const typeStats = useMemo(() => {
    const byType = new Map();
    for (const el of parsed?.elements || []) {
      byType.set(el.ifcType, (byType.get(el.ifcType) || 0) + 1);
    }
    return [...byType.entries()].sort((a, b) => b[1] - a[1]);
  }, [parsed]);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    setParsed(null);
    setFileName(file.name);
    setBusy(true);
    setStatusText("Lese Datei…");
    try {
      const buffer = await file.arrayBuffer();
      // Mikro-Yield, damit der Spinner sicher gerendert ist, bevor WASM rechnet.
      await new Promise((r) => setTimeout(r, 0));
      const result = await parseIfcFile(buffer, setStatusText);
      setParsed(result);
    } catch (err) {
      setError(err?.message || "Die IFC-Datei konnte nicht gelesen werden.");
    } finally {
      setBusy(false);
      // Input zurücksetzen, damit dieselbe Datei erneut gewählt werden kann.
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const useAsSource = () => {
    if (!parsed || busy) return;
    onUse?.(mapToClassifiedElements(parsed));
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <FileUp className="w-4 h-4" /> IFC-Import (web-ifc)
          {active && (
            <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border border-emerald-200">
              <CheckCircle2 className="w-3 h-3 mr-1" />
              IFC-Modell aktiv ({nf.format(count)} {count === 1 ? "Bauteil" : "Bauteile"})
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-slate-500">
          Echten IFC-Export (z.&nbsp;B. aus Archicad) laden — Geschosse, Eigenschaften,
          Klassifizierung, Material und Status werden ohne Geometrie extrahiert und als
          Mengenquelle für die Filter verwendet.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept=".ifc"
            disabled={busy}
            onChange={handleFile}
            className="text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200 disabled:opacity-50"
          />
          {active && (
            <Button size="sm" variant="outline" onClick={() => onReset?.()}>
              <Undo2 className="w-3.5 h-3.5 mr-1.5" /> Zurück zum BIT-BIM-Modell
            </Button>
          )}
        </div>

        {busy && (
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
            <Loader2 className="w-4 h-4 animate-spin shrink-0" />
            <span>{statusText || "Verarbeite IFC-Datei…"}</span>
          </div>
        )}

        {error && !busy && (
          <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              <div className="font-medium">Import fehlgeschlagen{fileName ? ` — ${fileName}` : ""}</div>
              <div>{error}</div>
            </div>
          </div>
        )}

        {parsed && !busy && (
          <div className="space-y-2 rounded-lg border border-slate-200 p-3">
            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
              <Boxes className="w-4 h-4 text-slate-500" />
              <span className="font-medium">
                {nf.format(parsed.elements.length)} {parsed.elements.length === 1 ? "Bauteil" : "Bauteile"} gelesen
              </span>
              {fileName && <span className="text-slate-400">· {fileName}</span>}
              {parsed.schema && <Badge variant="outline">{parsed.schema}</Badge>}
            </div>

            <div className="flex flex-wrap gap-1">
              {typeStats.map(([ifcType, n]) => (
                <Badge key={ifcType} variant="secondary" className="font-normal">
                  {ifcType} · {nf.format(n)}
                </Badge>
              ))}
            </div>

            {/* Status-Kennzahlen (L10). Bauteile ohne belegten Umbau-Status werden als
                „unbekannt" AUSGEWIESEN statt still als Neubau gezählt — im Realprojekt
                sind das 355 von 6.038 Bauteilen. Wer die Zahl nicht sieht, hält sie für 0. */}
            {parsed.kennzahlen && (
              <div className="flex flex-wrap items-center gap-1 text-sm text-slate-600">
                <span className="mr-1">Zustand:</span>
                {[
                  ["bestand", "Bestand", "bg-slate-100 text-slate-700"],
                  ["neubau", "Neubau", "bg-emerald-100 text-emerald-700"],
                  ["abbruch", "Abbruch", "bg-rose-100 text-rose-700"],
                ].map(([key, label, cls]) => (
                  <span
                    key={key}
                    className={`${cls} inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium`}
                  >
                    {label} · {nf.format(parsed.kennzahlen.status?.[key] || 0)}
                  </span>
                ))}
                {parsed.kennzahlen.ohne_status > 0 && (
                  <span className="inline-flex items-center rounded-md border border-amber-200 bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                    <AlertTriangle className="w-3 h-3 mr-1" />
                    ohne Status · {nf.format(parsed.kennzahlen.ohne_status)}
                  </span>
                )}
              </div>
            )}

            {parsed.kennzahlen?.ohne_status > 0 && (
              <p className="text-xs text-amber-700">
                {nf.format(parsed.kennzahlen.ohne_status)} Bauteile führen keinen Umbau-Status.
                Sie bleiben <strong>unbekannt</strong> und werden weder den Neubau- noch den
                Abbruchmengen zugerechnet — bitte im Modell nachtragen.
              </p>
            )}

            {parsed.storeys.length > 0 && (
              <div className="flex flex-wrap items-center gap-1 text-sm text-slate-600">
                <Building2 className="w-3.5 h-3.5 text-slate-500" />
                <span className="mr-1">{parsed.storeys.length} {parsed.storeys.length === 1 ? "Geschoss" : "Geschosse"}:</span>
                {parsed.storeys.map((s, i) => (
                  <Badge key={`${s}-${i}`} variant="outline" className="font-normal">{s}</Badge>
                ))}
              </div>
            )}

            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={useAsSource}>
              <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> Als Mengenquelle verwenden
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
