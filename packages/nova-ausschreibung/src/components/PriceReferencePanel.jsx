import React, { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Badge } from "@core/components/ui/badge";
import { Input } from "@core/components/ui/input";
import { Label } from "@core/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@core/components/ui/select";
import { AlertTriangle, Database, Loader2, CloudDownload, FileUp, FlaskConical } from "lucide-react";
import { korridorText } from "@ava/lib/priceReference";

// Quelle → Badge-Darstellung (Lizenz-Attribution pro Zelle, Pflicht 2011/833/EU).
const SOURCE_BADGE = {
  ted: { label: "TED · © EU", className: "bg-blue-100 text-blue-800" },
  doee: { label: "DÖE · CC0", className: "bg-emerald-100 text-emerald-800" },
  demo: { label: "Demo", className: "bg-slate-100 text-slate-600" },
};

const deDate = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("de-DE");
};
const tEur = (v) => `${Math.round((v || 0) / 1000).toLocaleString("de-DE")} T€`;

// Preisreferenz-Panel: TED-Sync, DÖE-CSV-Import, Demo-Seed + Benchmark-Zellen-Tabelle.
// Los-Summen-Benchmarks — NIE €/Einheit, keine Kalkulationsgrundlage (Phase 28).
export default function PriceReferencePanel({ priceRefs = [], onSyncTed, onImportDoee }) {
  const currentYear = new Date().getFullYear();
  const [tedYear, setTedYear] = useState(String(currentYear - 1));
  const [doeeYear, setDoeeYear] = useState(String(currentYear - 1));
  const [files, setFiles] = useState({ tenderFile: null, classificationFile: null, placeFile: null, submissionsFile: null });
  const [busy, setBusy] = useState(null); // "ted" | "doee" | "demo" | null

  const sorted = useMemo(
    () => [...priceRefs].sort((a, b) =>
      (a.cpv_group || "").localeCompare(b.cpv_group || "")
      || (a.region || "").localeCompare(b.region || "", "de")
      || (b.year || 0) - (a.year || 0)),
    [priceRefs],
  );

  const run = (kind, fn) => async () => {
    setBusy(kind);
    try { await fn(); } finally { setBusy(null); }
  };

  const setFile = (key) => (e) => setFiles((f) => ({ ...f, [key]: e.target.files?.[0] || null }));
  const doeeReady = files.tenderFile && files.classificationFile && files.placeFile;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Database className="w-4 h-4 text-blue-600" /> Preisreferenz — öffentliche Vergabedaten
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Ehrliche Grenze — dauerhaft sichtbar */}
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3 text-sm">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <p>
            Öffentliche Vergabedaten liefern Los-/Gewerke-Summen — strukturell KEINE Einheitspreise
            je LV-Position (eForms kennt kein Preisfeld; § 14a VOB/A sperrt bepreiste LVs). Die
            Werte sind Plausibilitätskorridore, keine Kalkulationsgrundlage und kein Ersatz für
            BKI/sirAdos.
          </p>
        </div>

        {/* Quellen-Steuerung */}
        <div className="grid md:grid-cols-3 gap-3">
          <div className="border rounded-lg p-3 space-y-2">
            <div className="font-medium text-sm flex items-center gap-1.5"><CloudDownload className="w-4 h-4 text-blue-600" /> TED (EU-Oberschwelle)</div>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Label className="text-xs">Jahr</Label>
                <Select value={tedYear} onValueChange={setTedYear}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["2024", "2025", "2026"].map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Button size="sm" disabled={busy !== null} onClick={run("ted", () => onSyncTed(Number(tedYear)))}>
                {busy === "ted" && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />} TED abrufen
              </Button>
            </div>
            <p className="text-xs text-slate-400">EU-Oberschwelle, ca. 250–1.000 Lose je Abruf, kein API-Key.</p>
          </div>

          <div className="border rounded-lg p-3 space-y-2">
            <div className="font-medium text-sm flex items-center gap-1.5"><FileUp className="w-4 h-4 text-emerald-600" /> DÖE-Monatspaket (CSV)</div>
            <div>
              <Label className="text-xs">Jahr</Label>
              <Input type="number" value={doeeYear} onChange={(e) => setDoeeYear(e.target.value)} />
            </div>
            <div className="space-y-1 text-xs">
              <label className="block">tender.csv<input type="file" accept=".csv" onChange={setFile("tenderFile")} className="block w-full text-xs" /></label>
              <label className="block">classification.csv<input type="file" accept=".csv" onChange={setFile("classificationFile")} className="block w-full text-xs" /></label>
              <label className="block">placeOfPerformance.csv<input type="file" accept=".csv" onChange={setFile("placeFile")} className="block w-full text-xs" /></label>
              <label className="block">receivedSubmissions.csv (optional)<input type="file" accept=".csv" onChange={setFile("submissionsFile")} className="block w-full text-xs" /></label>
            </div>
            <Button size="sm" disabled={!doeeReady || busy !== null}
              onClick={run("doee", () => onImportDoee({ ...files, year: Number(doeeYear) }))}>
              {busy === "doee" && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />} CSV importieren
            </Button>
            <p className="text-xs text-slate-400">
              Monatspaket von oeffentlichevergabe.de laden (…/api/notice-exports?pubMonth=JJJJ-MM&amp;format=csv.zip),
              lokal entpacken, CSVs hier wählen — CC0, offline nutzbar.
            </p>
          </div>

          {/* Der frühere Knopf „Demo-Daten laden" ist entfallen (Phase 33 / W3): er
              schrieb erfundene Vergleichswerte in das gerade geöffnete — womöglich
              echte — Projekt. Der Beispiel-Korpus liegt jetzt im isolierten
              Demoprojekt und wird mit `npm run seed` angelegt. */}
          <div className="border rounded-lg p-3 space-y-2">
            <div className="font-medium text-sm flex items-center gap-1.5"><FlaskConical className="w-4 h-4 text-slate-500" /> Beispieldaten</div>
            <p className="text-xs text-slate-400">
              Ein deterministischer Beispiel-Korpus liegt im Projekt
              „Demoprojekt AVA (Beispieldaten)". In echte Projekte wird er nicht geschrieben.
            </p>
          </div>
        </div>

        {/* Zellen-Tabelle */}
        {sorted.length === 0 ? (
          <div className="text-center text-sm text-slate-400 bg-slate-50 border border-slate-100 rounded-lg py-6">
            Kein Referenzpreis vorhanden — Quelle abrufen, CSV importieren oder Demo-Daten laden
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 border-b">
                  <th className="py-2 px-3">CPV-Gruppe</th>
                  <th className="py-2 px-3">Bezeichnung</th>
                  <th className="py-2 px-3">Region</th>
                  <th className="py-2 px-3 text-right">Jahr</th>
                  <th className="py-2 px-3 text-right">n</th>
                  <th className="py-2 px-3 text-right">Los-Median</th>
                  <th className="py-2 px-3 text-right">Q1–Q3</th>
                  <th className="py-2 px-3">Quelle · Stand</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => {
                  const badge = SOURCE_BADGE[r.source] || SOURCE_BADGE.demo;
                  return (
                    <tr key={r.id || `${r.cpv_group}-${r.region}-${r.year}-${r.source}`} className="border-b last:border-0 hover:bg-slate-50">
                      <td className="py-2 px-3"><Badge variant="outline" className="font-mono text-xs">{r.cpv_group}</Badge></td>
                      <td className="py-2 px-3">{r.cpv_label}</td>
                      <td className="py-2 px-3">{r.region}</td>
                      <td className="py-2 px-3 text-right tabular-nums">{r.year}</td>
                      <td className="py-2 px-3 text-right tabular-nums">{(r.n || 0).toLocaleString("de-DE")}</td>
                      <td className="py-2 px-3 text-right tabular-nums">{korridorText(r) ? tEur(r.median) : "—"}</td>
                      <td className="py-2 px-3 text-right tabular-nums">{r.n >= 20 ? `${tEur(r.q1)}–${tEur(r.q3)}` : "—"}</td>
                      <td className="py-2 px-3">
                        <Badge className={`${badge.className} text-[10px] mr-1`}>{badge.label}</Badge>
                        <span className="text-xs text-slate-400">{deDate(r.fetched_at)}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Attribution (Pflicht nach Beschluss 2011/833/EU) */}
        <p className="text-xs text-slate-400">
          Quelle: Tenders Electronic Daily, © Europäische Union, 1998–2026 — Daten aggregiert und
          gefiltert · Datenservice Öffentlicher Einkauf (Beschaffungsamt BMI), CC0. Ohne Gewähr —
          Verantwortung für Inhalte liegt bei den ausschreibenden Stellen.
        </p>
      </CardContent>
    </Card>
  );
}
