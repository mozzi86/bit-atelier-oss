import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@core/components/ui/card';
import { Button } from '@core/components/ui/button';
import { Input } from '@core/components/ui/input';
import { Badge } from '@core/components/ui/badge';
import { bitApi } from '@core/api/bitApi';
import { toast } from 'sonner';
import {
  Cloud, FileText, Folder, FolderOpen, FolderPlus, ChevronRight, Home, Trash2, Loader2,
  Boxes, ExternalLink,
} from 'lucide-react';
import {
  ORDNER_VORLAGE, kinderVon, dateienIn, pfadZu, nachfahren, pruefeName, zielPfadFuer,
} from "@core/lib/ordnerBaum";
import { dokumentAblegen, pfadText } from "@core/lib/ablage";

// Cloud-Daten = Projektablage.
//
// Bis 26.08.2026 zeigte dieser Reiter fünf hartkodierte Fantasie-Dateien
// (Site_Plan_v3.dwg …) und hatte keinerlei Ordner; jeder Knopf war tot. Jetzt:
// echte Ordner (Entität `ProjectFolder`) und echte Dateien (`Document.folder_id`),
// anklickbar, mit Unterordnern und Brotkrumen.
//
// Ehrlichkeitsregel: Was (noch) nicht geht — Dateien hochladen — ist als
// deaktivierter Knopf MIT Begründung sichtbar, nicht als Attrappe, die nichts tut.

export default function CloudDataManager({ selectedProject }) {
  const navigate = useNavigate();
  const projectId = selectedProject?.id || null;
  const [ordner, setOrdner] = useState([]);
  const [dokumente, setDokumente] = useState([]);
  const [aktuell, setAktuell] = useState(null); // null = Wurzel
  const [laedt, setLaedt] = useState(false);
  const [neuerName, setNeuerName] = useState('');
  const [anlegen, setAnlegen] = useState(false);

  const laden = useCallback(async () => {
    if (!projectId) return;
    setLaedt(true);
    try {
      const [o, d] = await Promise.all([
        bitApi.entities.ProjectFolder.filter({ project_id: projectId }).catch(() => []),
        bitApi.entities.Document.filter({ project_id: projectId }).catch(() => []),
      ]);
      setOrdner(Array.isArray(o) ? o : []);
      setDokumente(Array.isArray(d) ? d : []);
    } finally {
      setLaedt(false);
    }
  }, [projectId]);

  useEffect(() => { setAktuell(null); laden(); }, [laden]);

  const unterordner = useMemo(() => kinderVon(ordner, aktuell), [ordner, aktuell]);
  const dateien = useMemo(() => dateienIn(dokumente, aktuell), [dokumente, aktuell]);
  const brotkrumen = useMemo(() => (aktuell ? pfadZu(ordner, aktuell) : []), [ordner, aktuell]);

  // Wie viel steckt in einem Ordner (inkl. aller Unterordner)? — damit man sieht,
  // wo etwas liegt, ohne hineinzuklicken.
  const inhaltVon = useCallback((id) => {
    const alle = [id, ...nachfahren(ordner, id)];
    return {
      ordner: nachfahren(ordner, id).length,
      dateien: dokumente.filter((d) => alle.includes(d.folder_id)).length,
    };
  }, [ordner, dokumente]);

  const ordnerAnlegen = async () => {
    const fehler = pruefeName(neuerName, unterordner);
    if (fehler) { toast.error(fehler); return; }
    setAnlegen(true);
    try {
      await bitApi.entities.ProjectFolder.create({
        project_id: projectId,
        parent_id: aktuell,
        name: neuerName.trim(),
        created_date: new Date().toISOString(),
      });
      setNeuerName('');
      await laden();
      toast.success(`Ordner „${neuerName.trim()}" angelegt`);
    } catch {
      toast.error('Anlegen fehlgeschlagen — läuft der lokale Server?');
    } finally {
      setAnlegen(false);
    }
  };

  const vorlageAnlegen = async () => {
    setAnlegen(true);
    try {
      for (const haupt of ORDNER_VORLAGE) {
        const angelegt = await bitApi.entities.ProjectFolder.create({
          project_id: projectId, parent_id: null, name: haupt.name,
          created_date: new Date().toISOString(),
        });
        for (const kind of haupt.kinder) {
          await bitApi.entities.ProjectFolder.create({
            project_id: projectId, parent_id: angelegt.id, name: kind,
            created_date: new Date().toISOString(),
          });
        }
      }
      await laden();
      toast.success('Büro-Ablagestruktur angelegt');
    } catch {
      toast.error('Anlegen fehlgeschlagen — läuft der lokale Server?');
    } finally {
      setAnlegen(false);
    }
  };

  // IFC-Modelle im Ordner registrieren.
  //
  // Die Dateien selbst werden NICHT kopiert: das Referenzmodell hat 247 MB und liegt im
  // OneDrive-Projektordner (Pfad aus IFC_DIR, derselbe, aus dem der IFC-Viewer lädt).
  // Hier entsteht ein Verweis — Name, Größe, Stand, Pfad — damit die Ablage zeigt,
  // welche Modelle es gibt, und ein Klick sie im Viewer öffnet. Eine Kopie wäre eine
  // zweite Wahrheit, die sofort veraltet.
  const [ifcLaeuft, setIfcLaeuft] = useState(false);
  const ifcRegistrieren = async () => {
    setIfcLaeuft(true);
    try {
      const res = await fetch('/api/ifc-files');
      if (!res.ok) {
        toast.error('Kein IFC-Ordner konfiguriert — IFC_DIR in der .env setzen.');
        return;
      }
      const { dir, files } = await res.json();
      const vorhanden = new Set(dateienIn(dokumente, aktuell).map((d) => d.name));
      const neu = (files || []).filter((f) => !vorhanden.has(f.name));
      if (!neu.length) {
        toast.info(`Alle ${(files || []).length} IFC-Modelle sind hier bereits registriert.`);
        return;
      }
      for (const f of neu) {
        await bitApi.entities.Document.create({
          project_id: projectId,
          folder_id: aktuell,
          name: f.name,
          type: 'IFC-Modell',
          quelle_pfad: `${dir}/${f.name}`,
          bytes: f.size,
          notes: `${(f.size / 1024 / 1024).toFixed(1)} MB · liegt unter ${dir}`,
          created_date: new Date(f.mtime).toISOString(),
        });
      }
      await laden();
      toast.success(`${neu.length} IFC-Modell(e) registriert`);
    } catch {
      toast.error('Registrieren fehlgeschlagen — läuft der lokale Server?');
    } finally {
      setIfcLaeuft(false);
    }
  };

  // Ein registriertes Modell im IFC-Viewer öffnen: derselbe Merker, den der Viewer
  // beim Start liest (Autoload, JB-Stand 260826).
  // 72-16 (N-18): through the router, not window.location.href = '/IfcViewer' -
  // that bypassed the HashRouter (demo/lokal left the app for the domain root)
  // and reloaded the whole app in the other builds. The viewer mounts fresh on
  // the route change and reads the marker in its autoload effect as before.
  const imViewerOeffnen = (d) => {
    try { localStorage.setItem('bit-atelier.ifc.autoload.v1', d.name); } catch { /* Storage gesperrt */ }
    navigate('/IfcViewer');
  };

  // Altbestand nach derselben Regel einsortieren.
  //
  // Dokumente, die vor der Ablage-Regel entstanden sind (oder deren Typ erst später
  // in die Regel kam), liegen in der Wurzel. Sie werden NICHT geraten einsortiert:
  // nur was einen Typ hat, den die Regel kennt, wird bewegt — der Rest bleibt liegen
  // und sichtbar, damit niemand denkt, es sei erledigt.
  const [sortiert, setSortiert] = useState(false);
  const einsortieren = async () => {
    const lose = dateienIn(dokumente, null).filter((d) => zielPfadFuer(d.type).length > 0);
    if (!lose.length) {
      toast.info('Kein loses Dokument hat einen Typ, den die Ablage-Regel kennt.');
      return;
    }
    setSortiert(true);
    try {
      let n = 0;
      const orte = new Set();
      for (const d of lose) {
        // Denselben Weg nehmen wie ein frischer Export — eine Regel, ein Pfad.
        const r = await dokumentAblegen({ projectId, name: d.name, typ: d.type, notiz: d.notes });
        if (!r.ok) continue;
        await bitApi.entities.Document.delete(d.id); // der neue Datensatz ersetzt den losen
        orte.add(pfadText(r.pfad));
        n += 1;
      }
      await laden();
      toast.success(`${n} Dokument(e) einsortiert: ${[...orte].join(', ')}`);
    } catch {
      toast.error('Einsortieren fehlgeschlagen');
    } finally {
      setSortiert(false);
    }
  };

  const ordnerLoeschen = async (o) => {
    const { ordner: nO, dateien: nD } = inhaltVon(o.id);
    if (nO || nD) {
      toast.error(`„${o.name}" ist nicht leer (${nO} Unterordner, ${nD} Dateien) — erst leeren.`);
      return;
    }
    try {
      await bitApi.entities.ProjectFolder.delete(o.id);
      await laden();
      toast.success(`Ordner „${o.name}" gelöscht`);
    } catch {
      toast.error('Löschen fehlgeschlagen');
    }
  };

  if (!selectedProject) {
    return (
      <Card className="border-0 shadow-xl bg-white/80 backdrop-blur-sm">
        <CardContent className="p-12 text-center">
          <Cloud className="w-16 h-16 text-slate-300 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-slate-600 mb-2">Projekt wählen</h3>
          <p className="text-slate-500">Oben ein Projekt anklicken, um seine Ablage zu öffnen.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="border-0 shadow-xl bg-white/80 backdrop-blur-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between gap-3 text-base">
            <span className="flex items-center gap-2">
              <FolderOpen className="w-5 h-5 text-emerald-600" /> Projektablage
              <span className="text-sm font-normal text-slate-400">{selectedProject.name}</span>
            </span>
            {laedt && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
          </CardTitle>

          {/* Brotkrumen — jede Stufe ist anklickbar */}
          <div className="flex items-center flex-wrap gap-1 text-sm pt-1">
            <button type="button" onClick={() => setAktuell(null)}
              className={`flex items-center gap-1 px-2 py-0.5 rounded hover:bg-slate-100 ${aktuell === null ? 'font-semibold text-slate-800' : 'text-slate-500'}`}>
              <Home className="w-3.5 h-3.5" /> Projektwurzel
            </button>
            {brotkrumen.map((k, i) => (
              <React.Fragment key={k.id}>
                <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
                <button type="button" onClick={() => setAktuell(k.id)}
                  className={`px-2 py-0.5 rounded hover:bg-slate-100 ${i === brotkrumen.length - 1 ? 'font-semibold text-slate-800' : 'text-slate-500'}`}>
                  {k.name}
                </button>
              </React.Fragment>
            ))}
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Neuen Unterordner anlegen — immer auf der aktuellen Ebene */}
          <div className="flex flex-wrap items-center gap-2">
            <Input className="h-9 max-w-xs" value={neuerName} placeholder={aktuell ? 'Name des Unterordners' : 'Name des Ordners'}
              onChange={(e) => setNeuerName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); ordnerAnlegen(); } }} />
            <Button size="sm" onClick={ordnerAnlegen} disabled={anlegen || !neuerName.trim()}
              className="bg-gradient-to-r from-emerald-600 to-teal-600">
              <FolderPlus className="w-4 h-4 mr-1.5" />
              {aktuell ? 'Unterordner anlegen' : 'Ordner anlegen'}
            </Button>
            {ordner.length === 0 && (
              <Button size="sm" variant="outline" onClick={vorlageAnlegen} disabled={anlegen}>
                Büro-Ablagestruktur anlegen ({ORDNER_VORLAGE.length} Hauptordner)
              </Button>
            )}
            {aktuell && (
              <Button size="sm" variant="outline" onClick={ifcRegistrieren} disabled={ifcLaeuft}>
                {ifcLaeuft ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Boxes className="w-4 h-4 mr-1.5" />}
                IFC-Modelle hier registrieren
              </Button>
            )}
          </div>

          {/* Ordner der aktuellen Ebene */}
          {unterordner.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {unterordner.map((o) => {
                const inhalt = inhaltVon(o.id);
                return (
                  <div key={o.id}
                    className="group flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 hover:border-emerald-300 hover:bg-emerald-50/40 transition-colors">
                    <button type="button" onClick={() => setAktuell(o.id)}
                      className="flex flex-1 items-center gap-2 text-left min-w-0">
                      <Folder className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span className="truncate text-sm text-slate-800">{o.name}</span>
                      {(inhalt.ordner > 0 || inhalt.dateien > 0) && (
                        <Badge variant="outline" className="ml-auto text-[10px] shrink-0">
                          {inhalt.ordner > 0 && `${inhalt.ordner} Ordner`}
                          {inhalt.ordner > 0 && inhalt.dateien > 0 && ' · '}
                          {inhalt.dateien > 0 && `${inhalt.dateien} Dateien`}
                        </Badge>
                      )}
                    </button>
                    <button type="button" onClick={() => ordnerLoeschen(o)} title="Ordner löschen (nur wenn leer)"
                      className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-rose-600 transition-opacity">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Dateien der aktuellen Ebene */}
          {dateien.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-slate-400 text-xs">
                  <th className="text-left font-medium p-2">Name</th>
                  <th className="text-left font-medium p-2">Art</th>
                  <th className="text-left font-medium p-2">Angelegt</th>
                </tr>
              </thead>
              <tbody>
                {dateien.map((d) => (
                  <tr key={d.id} className="border-b hover:bg-slate-50">
                    <td className="p-2 flex items-center gap-2">
                      {d.type === 'IFC-Modell' ? (
                        <>
                          <Boxes className="w-4 h-4 text-emerald-600 shrink-0" />
                          <button type="button" onClick={() => imViewerOeffnen(d)}
                            title={`Im IFC-Viewer öffnen — ${d.quelle_pfad || d.notes || ''}`}
                            className="truncate text-left text-emerald-800 hover:underline flex items-center gap-1">
                            {d.name} <ExternalLink className="w-3 h-3 shrink-0 opacity-60" />
                          </button>
                        </>
                      ) : (
                        <>
                          <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                          <span className="truncate" title={d.notes || ''}>{d.name}</span>
                        </>
                      )}
                    </td>
                    <td className="p-2 text-slate-600">{d.type || '—'}</td>
                    <td className="p-2 text-slate-500">{(d.created_date || '').slice(0, 10) || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            unterordner.length === 0 && (
              <p className="text-sm text-slate-400 py-6 text-center">
                {ordner.length === 0
                  ? 'Für dieses Projekt ist noch keine Ablage angelegt.'
                  : 'Dieser Ordner ist leer.'}
              </p>
            )
          )}

          {/* Ungeordnete Dateien nur auf der Wurzelebene erwähnen */}
          {aktuell === null && dateienIn(dokumente, null).length > 0 && ordner.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-amber-700">
              <span>{dateienIn(dokumente, null).length} Dokumente liegen noch keinem Ordner zu.</span>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={einsortieren} disabled={sortiert}>
                {sortiert && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
                nach Ablage-Regel einsortieren
              </Button>
            </div>
          )}

          <p className="text-[11px] text-slate-400 border-t pt-2">
            Ordner, Zuordnung und Verweise sind echt und werden gespeichert. IFC-Modelle
            werden <strong>verwiesen, nicht kopiert</strong> — sie liegen im Projektordner
            (<code className="mx-1">IFC_DIR</code>), eine Kopie wäre eine zweite Wahrheit.
            Beliebige Dateien vom Rechner hochladen ist noch nicht angebunden.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
