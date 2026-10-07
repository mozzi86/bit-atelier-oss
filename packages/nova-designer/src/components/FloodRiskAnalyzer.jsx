import React, { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Badge } from "@core/components/ui/badge";
import { Progress } from "@core/components/ui/progress";
import { Stat } from "@core/components/Field";
import { Droplets, ShieldCheck, AlertTriangle, WifiOff, Info } from "lucide-react";
import { useProject } from "@core/lib/ProjectContext";
import { useSiteClimate } from "@designer/lib/useSiteClimate";
import { topoProvenance } from "@designer/lib/useElevationGrid";

// Grobe Ersteinschätzung aus Geländehöhe (Open-Meteo Elevation) + Klima-Niederschlag.
// KEIN Ersatz für die amtlichen Hochwassergefahren- und -risikokarten der Länder.
export default function FloodRiskAnalyzer({ selectedProject }) {
  const { project } = useProject();
  const proj = project || selectedProject;
  const loc = proj?.location;
  const { annualPrecip, elevation, offline, loading } = useSiteClimate(loc);
  // Lokale Topografie-Punkte (falls im Projekt erfasst) als Zusatzsignal.
  const elevationPts = useMemo(() => proj?.topography?.elevation_points || [], [proj]);

  // --- Datenherkunft (KD-07) -------------------------------------------------
  // Die Höhenpunkte im Standort-Reiter werden derzeit synthetisch erzeugt; nur
  // ausdrücklich als vermessen/importiert gekennzeichnete Punkte zählen als
  // belegt. Ohne belegte Höhendaten ist die Ampel KEINE Risikoaussage.
  const topo = useMemo(() => topoProvenance(elevationPts), [elevationPts]);
  const elevationReal = !offline && elevation != null;
  const synthetic = !elevationReal || !topo.surveyed;

  const analysis = useMemo(() => {
    const elevs = topo.surveyed ? elevationPts.map((e) => e.elevation) : [];
    const siteElev = elevation != null ? elevation : (elevs.length ? Math.min(...elevs) : null);
    // Höhenspanne nur aus belegten Punkten; sonst unbekannt (nicht „flach"!).
    const range = elevs.length ? Math.max(...elevs) - Math.min(...elevs) : null;
    let score = 0;
    // Tiefe Lage = höheres Risiko (m ü. NN als grobes Proxy für Flussnähe/Küste)
    if (siteElev != null) score += siteElev < 5 ? 40 : siteElev < 50 ? 25 : siteElev < 200 ? 12 : 5;
    else score += 15; // unbekannte Höhe: mittlere Annahme
    // Flaches Gelände entwässert schlecht — nur bei belegter Höhenspanne
    if (range != null) score += range < 3 ? 20 : range < 8 ? 10 : 4;
    else score += 10; // unbekannt: mittlere Annahme
    // Echter Jahresniederschlag aus Klimadaten
    score += annualPrecip > 1200 ? 25 : annualPrecip > 800 ? 15 : annualPrecip > 500 ? 8 : 3;
    score = Math.min(100, Math.round(score));
    const level = score >= 60 ? "Hoch" : score >= 35 ? "Mittel" : "Gering";
    return { siteElev, range, score, level };
  }, [elevationPts, elevation, annualPrecip, topo.surveyed]);

  // Ohne belegte Höhendaten: Ampel visuell entschärfen (grau, keine Aussage).
  const color = synthetic
    ? "bg-slate-200 text-slate-600"
    : analysis.level === "Hoch"
    ? "bg-red-100 text-red-800"
    : analysis.level === "Mittel"
    ? "bg-amber-100 text-amber-800"
    : "bg-emerald-100 text-emerald-800";

  const mitigations =
    analysis.level === "Hoch"
      ? ["Aufständerung / Hochwasserschutzwände", "Rückhaltebecken & Notüberläufe", "Wasserdichte Untergeschosse (weiße Wanne)", "Mulden-Rigolen-System zur Versickerung"]
      : analysis.level === "Mittel"
      ? ["Versickerungsfähige Beläge", "Dachbegrünung zur Retention", "Geländemodellierung Richtung Vorfluter"]
      : ["Standard-Entwässerung ausreichend", "Regenwasserzisterne empfohlen"];

  if (loading && elevation == null) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-8 text-sm text-slate-500 flex items-center gap-2 justify-center">
          <Droplets className="w-4 h-4 animate-pulse" /> Gelände- und Klimadaten werden geladen…
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {!loc && (
        <Card className="border-dashed">
          <CardContent className="py-4 text-sm text-slate-500 flex items-center gap-2">
            <Droplets className="w-4 h-4" /> Kein Projektstandort gewählt — Bewertung mit Default-Annahmen.
          </CardContent>
        </Card>
      )}
      {/* Datengrundlage (KD-07): ohne belegte Höhendaten keine Risikoaussage */}
      {synthetic && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="py-3 flex gap-2 text-[13px] leading-snug text-amber-900">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div>
                <strong>Auf synthetischen Höhendaten — keine Risikoaussage.</strong>{" "}
                {topo.count > 0 && !topo.surveyed
                  ? `Die ${topo.count} Höhenpunkte des Standort-Reiters sind Demo-Werte ohne Vermessungsbezug.`
                  : "Es liegen keine vermessenen oder importierten Höhenpunkte vor."}
                {!elevationReal && " Auch die Standorthöhe konnte nicht aus Open-Meteo bezogen werden (Offline-Schätzwert)."}
              </div>
              <div>
                Maßgeblich sind die <strong>amtlichen Hochwassergefahren- und Hochwasserrisikokarten
                der Länder</strong> (§ 74 WHG) — Länderportale bzw. Übersicht bei den
                Hochwasserzentralen (hochwasserzentralen.de), in Bayern zusätzlich der
                Informationsdienst Überschwemmungsgefährdete Gebiete (IÜG) sowie festgesetzte
                Überschwemmungsgebiete nach § 76 WHG.
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      <div className="flex items-center gap-2 text-xs">
        {synthetic && (
          <Badge variant="outline" className="text-slate-600 border-slate-300">
            auf synthetischen Höhendaten — keine Risikoaussage
          </Badge>
        )}
        {offline ? (
          <Badge variant="outline" className="text-amber-600 border-amber-300 flex items-center gap-1">
            <WifiOff className="w-3 h-3" /> Offline — Schätzwerte
          </Badge>
        ) : (
          <Badge variant="outline" className="text-emerald-600 border-emerald-300">
            Open-Meteo Höhe + Klima {loc?.address ? `· ${loc.address}` : ""}
          </Badge>
        )}
      </div>
      <div className="grid md:grid-cols-4 gap-3">
        <Stat
          label={synthetic ? "Risikostufe (keine Aussage)" : "Risikostufe"}
          value={<Badge className={color}>{synthetic ? `${analysis.level} — nicht belastbar` : analysis.level}</Badge>}
        />
        <Stat label="Geländehöhe" value={analysis.siteElev != null ? `${Math.round(analysis.siteElev)} m ü. NN` : "—"} />
        <Stat label="Niederschlag/Jahr" value={`${annualPrecip} mm`} accent="text-blue-600" />
        <Stat
          label={synthetic ? "Score (ohne Datengrundlage)" : "Risiko-Score"}
          value={`${analysis.score}/100`}
          accent={synthetic ? "text-slate-500" : analysis.score >= 60 ? "text-red-600" : "text-emerald-600"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className={`w-4 h-4 ${synthetic ? "text-slate-400" : "text-amber-500"}`} />
            {synthetic ? "Hochwasser — Ersteinschätzung ohne belastbare Datengrundlage" : "Hochwasser-Risikobewertung"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-slate-500">{synthetic ? "Punktwert (keine Risikoaussage)" : "Gesamtrisiko"}</span>
              <span className={`font-medium ${synthetic ? "text-slate-500" : ""}`}>{analysis.score}%</span>
            </div>
            <Progress value={analysis.score} className={synthetic ? "opacity-40 grayscale" : ""} />
          </div>
          <div>
            <div className="flex items-center gap-2 text-sm font-medium mb-2">
              <ShieldCheck className={`w-4 h-4 ${synthetic ? "text-slate-400" : "text-emerald-600"}`} />
              {synthetic ? "Mögliche Maßnahmen, sobald echte Daten vorliegen" : "Empfohlene Maßnahmen"}
            </div>
            <ul className="space-y-1 text-sm text-slate-600 list-disc list-inside">
              {mitigations.map((m, i) => <li key={i}>{m}</li>)}
            </ul>
            {synthetic && (
              <p className="mt-2 text-xs text-slate-500">
                Auswahl aus einem Katalog, abgeleitet aus dem obigen Punktwert — keine Empfehlung für
                diesen Standort. Grundlage für eine Entscheidung sind die amtlichen
                Hochwassergefahrenkarten und eine örtliche Prüfung.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
