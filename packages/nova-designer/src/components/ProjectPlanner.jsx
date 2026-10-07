import React, { useEffect, useMemo, useState } from "react";
import { bitApi } from "@core/api/bitApi";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Badge } from "@core/components/ui/badge";
import { Input } from "@core/components/ui/input";
import { Progress } from "@core/components/ui/progress";
import { toast } from "sonner";
import { useProject } from "@core/lib/ProjectContext";
import { CalendarClock, Minus, Plus, Save, RotateCcw, Eraser } from "lucide-react";

// HOAI-Leistungsphasen 1–9. Der Fortschritt je LP wird eingegeben und
// projektbezogen persistiert (Entität HoaiPlan, Muster wie SpaceProgram /
// FoerderAntrag) — vorbelegt aus der HOAI-Phase der Project-Entität.
const HOAI_PHASES = [
  { lp: "LP 1", name: "Grundlagenermittlung" },
  { lp: "LP 2", name: "Vorplanung" },
  { lp: "LP 3", name: "Entwurfsplanung" },
  { lp: "LP 4", name: "Genehmigungsplanung" },
  { lp: "LP 5", name: "Ausführungsplanung" },
  { lp: "LP 6", name: "Vorbereitung der Vergabe" },
  { lp: "LP 7", name: "Mitwirkung bei der Vergabe" },
  { lp: "LP 8", name: "Objektüberwachung" },
  { lp: "LP 9", name: "Objektbetreuung" },
];

const clamp = (v) => Math.max(0, Math.min(100, Math.round(v)));

// Wert aus der DB normalisieren: nur 0..100 oder null („nicht erfasst").
const normWert = (v) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : clamp(Number(v)));

// Aktuelle HOAI-Phase der Project-Entität lesen. Im Bestand kommen beide
// Formate vor: Zahl 1..9 (ProjectForm) und String „LP 5 - …" (Seed-Daten).
export function aktuelleLp(project) {
  const raw = project?.hoai_phase;
  if (typeof raw === "number") return raw >= 1 && raw <= 9 ? raw : null;
  const m = String(raw ?? "").match(/LP\s*([1-9])/i);
  return m ? Number(m[1]) : null;
}

// Vorbelegung aus der Projektphase: Leistungsphasen VOR der aktuellen Phase
// gelten als abgeschlossen (100 %), die aktuelle und alle folgenden bleiben
// „nicht erfasst" (null) — deren Stand kennt nur die Projektleitung und wird
// hier nicht geraten.
function vorbelegung(lp) {
  return Array.from({ length: 9 }, (_, i) => (lp && i + 1 < lp ? 100 : null));
}

const deDateTime = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString("de-DE");
};

export default function ProjectPlanner({ selectedProject }) {
  // Persistenz hängt am globalen aktuellen Projekt (wie FoerderPlanner /
  // SpaceProgram). `selectedProject` ist der Komplex-Datensatz und liefert
  // nur den Titel-Zusatz.
  const { projectId, project } = useProject();
  const lp = aktuelleLp(project);

  const [progress, setProgress] = useState(() => vorbelegung(null));
  const [recId, setRecId] = useState(null);
  const [gespeichertAm, setGespeichertAm] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [laden, setLaden] = useState(false);

  // Gespeicherten Stand des aktuellen Projekts laden; ohne Datensatz die
  // Vorbelegung aus der Projektphase zeigen (sichtbar als „Vorbelegung").
  useEffect(() => {
    let abgebrochen = false;
    const reset = () => {
      setRecId(null);
      setProgress(vorbelegung(lp));
      setGespeichertAm(null);
      setDirty(false);
    };
    if (!projectId) { reset(); return undefined; }
    setLaden(true);
    bitApi.entities.HoaiPlan.filter({ project_id: projectId })
      .then((rows) => {
        if (abgebrochen) return;
        const r = Array.isArray(rows) ? rows[0] : null;
        if (r && Array.isArray(r.progress)) {
          const werte = Array.from({ length: 9 }, (_, i) => normWert(r.progress[i]));
          setRecId(r.id);
          setProgress(werte);
          setGespeichertAm(r.updated_date || r.created_date || null);
          setDirty(false);
        } else {
          reset();
        }
      })
      .catch(() => { if (!abgebrochen) reset(); })
      .finally(() => { if (!abgebrochen) setLaden(false); });
    return () => { abgebrochen = true; };
  }, [projectId, lp]);

  const setWert = (i, wert) => {
    setProgress((p) => p.map((v, idx) => (idx === i ? wert : v)));
    setDirty(true);
  };
  const adjust = (i, delta) => setWert(i, clamp((progress[i] ?? 0) + delta));
  const eingabe = (i, raw) => setWert(i, raw === "" ? null : clamp(Number(raw) || 0));

  const erfasst = useMemo(() => progress.filter((v) => v != null), [progress]);
  // Mittelwert NUR über erfasste Leistungsphasen — mit sichtbarem Nenner,
  // damit „Gesamt" nicht als Projektfortschritt über alle 9 LP gelesen wird.
  const mittel = erfasst.length
    ? Math.round(erfasst.reduce((a, b) => a + b, 0) / erfasst.length)
    : null;

  const statusOf = (v) => {
    if (v == null) return ["nicht erfasst", "bg-slate-100 text-slate-500"];
    if (v === 100) return ["Abgeschlossen", "bg-emerald-100 text-emerald-800"];
    if (v > 0) return ["Laufend", "bg-blue-100 text-blue-800"];
    return ["Offen", "bg-slate-100 text-slate-600"];
  };

  const speichern = async () => {
    if (!projectId) { toast.error("Kein Projekt gewählt — Fortschritt kann nicht gespeichert werden"); return; }
    setBusy(true);
    try {
      const payload = { project_id: projectId, progress };
      const r = recId
        ? await bitApi.entities.HoaiPlan.update(recId, payload)
        : await bitApi.entities.HoaiPlan.create(payload);
      if (r?.id) setRecId(r.id);
      setGespeichertAm(r?.updated_date || r?.created_date || new Date().toISOString());
      setDirty(false);
      toast.success("HOAI-Fortschritt gespeichert");
    } catch {
      toast.error("Speichern fehlgeschlagen");
    }
    setBusy(false);
  };

  const zuruecksetzen = () => {
    setProgress(vorbelegung(lp));
    setDirty(true);
  };

  const gespeichertText = deDateTime(gespeichertAm);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarClock className="w-4 h-4" /> HOAI-Projektplaner
            {selectedProject?.name ? ` — ${selectedProject.name}` : ""}
          </CardTitle>
          <div className="flex items-center gap-2">
            {mittel == null ? (
              <Badge className="bg-slate-100 text-slate-600">Kein Fortschritt erfasst</Badge>
            ) : (
              <Badge className="bg-emerald-100 text-emerald-800">
                Ø {mittel}% · {erfasst.length} von 9 LP erfasst
              </Badge>
            )}
            <Button size="sm" variant="outline" onClick={zuruecksetzen} title="Alle Werte auf die Vorbelegung aus der HOAI-Phase zurücksetzen">
              <RotateCcw className="w-3.5 h-3.5 mr-1" /> Vorbelegung
            </Button>
            <Button
              size="sm"
              onClick={speichern}
              disabled={busy || laden || !projectId}
              className="bg-gradient-to-r from-emerald-600 to-teal-600"
            >
              <Save className="w-3.5 h-3.5 mr-1" /> Speichern
            </Button>
          </div>
        </div>
        <p className="text-xs text-slate-500">
          {project?.name ? `Projekt: ${project.name}` : "Kein Projekt gewählt"}
          {lp ? ` · HOAI-Phase laut Projektakte: LP ${lp}` : " · keine HOAI-Phase in der Projektakte"}
          {" · "}
          {!projectId
            ? "ohne Projekt keine Speicherung"
            : gespeichertText
              ? `gespeichert am ${gespeichertText}${dirty ? " · nicht gespeicherte Änderungen" : ""}`
              : "noch nicht gespeichert — Werte sind eine Vorbelegung aus der Projektphase"}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {HOAI_PHASES.map((ph, i) => {
          const v = progress[i];
          const [label, color] = statusOf(v);
          const aktuell = lp === i + 1;
          return (
            <div key={ph.lp} className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
              <div className="w-40">
                <div className="text-sm font-medium">
                  {ph.lp}
                  {aktuell && <span className="ml-1.5 text-[10px] font-normal text-blue-600">aktuelle Phase</span>}
                </div>
                <div className="text-xs text-slate-500">{ph.name}</div>
              </div>
              <div className="flex items-center gap-3">
                <Progress value={v ?? 0} className={`flex-1 ${v == null ? "opacity-40" : ""}`} />
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step={5}
                  value={v ?? ""}
                  placeholder="—"
                  aria-label={`Fortschritt ${ph.lp} in Prozent`}
                  onChange={(e) => eingabe(i, e.target.value)}
                  className="h-7 w-16 text-right text-xs"
                />
                <Badge className={color}>{label}</Badge>
              </div>
              <div className="flex gap-1">
                <Button variant="outline" size="icon" className="h-7 w-7" title="−10 %" onClick={() => adjust(i, -10)}>
                  <Minus className="w-3.5 h-3.5" />
                </Button>
                <Button variant="outline" size="icon" className="h-7 w-7" title="+10 %" onClick={() => adjust(i, 10)}>
                  <Plus className="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7 text-slate-400"
                  title="Auf „nicht erfasst“ setzen"
                  onClick={() => setWert(i, null)}
                >
                  <Eraser className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          );
        })}
        <p className="text-[11px] text-slate-400">
          „Ø" ist der Mittelwert über die erfassten Leistungsphasen, kein
          gewichteter Projektfortschritt (HOAI-Honoraranteile sind hier nicht
          hinterlegt). Leere Felder bleiben „nicht erfasst" und gehen nicht in
          den Mittelwert ein.
        </p>
      </CardContent>
    </Card>
  );
}
