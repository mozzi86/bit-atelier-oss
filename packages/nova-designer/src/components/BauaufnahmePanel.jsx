// 73-09: tab "Bauaufnahme" of the Komplex-Designer — deliveries of the survey, georeference with the UTM
// warning, and two provenance tiles that make the existing data paths visible (outline from the model,
// room programme from the survey state). The tiles show figures and provenance and take over NOTHING by
// themselves: the takeover stays in the IFC viewer ("Grundriss → Gebäudemodell") and in the room
// programme ("Bestand übernehmen"). project.scan_3d_url is shown, not copied. No point-cloud rendering
// (reason in bauaufnahme.js).
//
// In:  nothing (active project). Writes ONLY bauaufnahme_layer (useFachlayer, KD-17); the findings card
//      (73-10) writes befunde_layer.bestand.
// Out: rendered panel; data-testids ba-panel, ba-lieferung-<id>, ba-neu, ba-georef-*, ba-check-<key>,
//      ba-kachel-umriss, ba-kachel-raeume (data-raeume).
import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { ScanLine, Plus, Trash2, Ruler, ClipboardList } from "lucide-react";
import { bitApi } from "@core/api/bitApi";
import { useI18n } from "@core/lib/i18n";
import { useProject } from "@core/lib/ProjectContext";
import { useBuildingProgram, programMetrics } from "@core/lib/useBuildingProgram";
import { footprintQuelleText } from "@core/lib/footprintQuelle";
import { snapshotElemente } from "@core/lib/snapshotElemente";
import { herkunftZeile } from "@core/lib/bauart";
import { useFachlayer } from "@designer/lib/useFachlayer";
import BestandsBefundKarte from "@designer/components/BestandsBefundKarte";
import { programmAusBestand } from "@designer/lib/bestandsProgramm";
import { VERFAHREN, GENAUIGKEIT, BAUAUFNAHME_DEFAULT, bauaufnahmeHardened, lieferungHinzu, bauaufnahmeChecks } from "@designer/lib/bauaufnahme";

const inCls = "h-8 w-full rounded border border-slate-200 bg-white px-2 text-xs";

export default function BauaufnahmePanel() {
  const { t } = useI18n();
  const { project } = useProject();
  const [roh, setRoh] = useFachlayer(project?.id, "bauaufnahme_layer", BAUAUFNAHME_DEFAULT);
  const layer = useMemo(() => bauaufnahmeHardened(roh), [roh]);
  const checks = useMemo(() => bauaufnahmeChecks(layer), [layer]);
  const store = /** @type {any} */ (useBuildingProgram());
  const pm = programMetrics(store);
  const fq = store.footprintQuelle;
  const [bestand, setBestand] = useState({ snap: null, programm: null, elemente: [], fehler: "" });
  const [neuLaden, setNeuLaden] = useState(0); // 73-10: reload after an Erfassungsgrad raise

  useEffect(() => {
    if (!project?.id) return undefined;
    let weg = false;
    (async () => {
      const snaps = await bitApi.entities.BimSnapshot.filter({ project_id: project.id }).catch(() => []);
      const snap = [...(snaps || [])].sort((a, b) => String(b.updated_date || b.created_date || "").localeCompare(String(a.updated_date || a.created_date || "")))[0] || null;
      if (!snap) { if (!weg) setBestand({ snap: null, programm: null, elemente: [], fehler: "" }); return; }
      const r = await snapshotElemente(snap);
      if (!weg) setBestand({ snap, programm: programmAusBestand({ ...snap, elemente: r.elemente }), elemente: r.elemente, fehler: r.fehler || "" });
    })();
    return () => { weg = true; };
  }, [project?.id, neuLaden]);

  const setze = (patch) => setRoh({ ...layer, ...patch });
  const setLief = (id, patch) => setze({ lieferungen: layer.lieferungen.map((l) => (l.id === id ? { ...l, ...patch } : l)) });
  const setGeo = (patch) => setze({ georeferenz: { ...layer.georeferenz, ...patch } });
  const zahlFeld = (key, label, einheit) => (
    <label className="space-y-1 text-xs text-slate-500">
      <span>{t(label)}{einheit ? ` (${einheit})` : ""}</span>
      <input type="number" step="any" className={inCls} data-testid={`ba-georef-${key}`} value={layer.georeferenz[key] ?? ""}
        onChange={(e) => setGeo({ [key]: e.target.value === "" ? null : Number(e.target.value) })} />
    </label>
  );

  return (
    <div className="space-y-4" data-testid="ba-panel">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base"><ScanLine className="h-4 w-4 text-violet-600" /> {t("Lieferungen der Bauaufnahme")}</CardTitle>
            <Button size="sm" variant="outline" data-testid="ba-neu" onClick={() => setRoh(lieferungHinzu(layer))}><Plus className="mr-1 h-4 w-4" />{t("Lieferung")}</Button>
          </div>
          <p className="text-xs text-slate-500">{t("Was geliefert wurde und wie genau — die Punktwolke selbst bleibt beim Dienstleister bzw. im Harness, der Browser zeigt sie nicht.")}</p>
          {project?.scan_3d_url && <p className="text-xs text-slate-500">{t("Verweis im Projekt")}: <span className="font-mono">{project.scan_3d_url}</span></p>}
        </CardHeader>
        <CardContent className="space-y-2">
          {layer.lieferungen.length === 0 && <p className="text-xs text-slate-400">{t("Noch keine Lieferung eingetragen.")}</p>}
          {layer.lieferungen.map((l) => (
            <div key={l.id} className="grid gap-2 rounded border p-2 md:grid-cols-6" data-testid={`ba-lieferung-${l.id}`}>
              <select className={inCls} value={l.verfahren} onChange={(e) => setLief(l.id, { verfahren: e.target.value })} aria-label={t("Verfahren")}>
                <option value="">{t("Verfahren …")}</option>
                {Object.entries(VERFAHREN).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
              </select>
              <select className={inCls} value={l.genauigkeit} onChange={(e) => setLief(l.id, { genauigkeit: e.target.value })} aria-label={t("Genauigkeitsklasse")}>
                <option value="">{t("Genauigkeit …")}</option>
                {Object.entries(GENAUIGKEIT).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
              <input className={inCls} placeholder={t("Dienstleister")} value={l.dienstleister} onChange={(e) => setLief(l.id, { dienstleister: e.target.value })} />
              <input className={inCls} placeholder={t("Registrierbericht (Datei/Ablage)")} value={l.bericht} onChange={(e) => setLief(l.id, { bericht: e.target.value })} />
              <input type="date" className={inCls} value={l.datum} onChange={(e) => setLief(l.id, { datum: e.target.value })} aria-label={t("Datum")} />
              <Button size="sm" variant="ghost" className="justify-self-end text-rose-600" onClick={() => setze({ lieferungen: layer.lieferungen.filter((x) => x.id !== l.id) })} aria-label={t("Lieferung entfernen")}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">{t("Georeferenz")}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 md:grid-cols-5">
            <label className="space-y-1 text-xs text-slate-500"><span>{t("Koordinatensystem")}</span>
              <input className={inCls} data-testid="ba-georef-crs" placeholder="z. B. lokal / EPSG:25832" value={layer.georeferenz.crs} onChange={(e) => setGeo({ crs: e.target.value })} /></label>
            {zahlFeld("nullpunkt_e", "Projektnullpunkt Ost", "m")}
            {zahlFeld("nullpunkt_n", "Projektnullpunkt Nord", "m")}
            {zahlFeld("okff_eg_nhn", "OKFF EG", "m ü. NHN")}
            {zahlFeld("drehung_grad", "Drehung", "°")}
          </div>
          {checks.length > 0 && (
            <ul className="space-y-1">
              {checks.map((c) => (
                <li key={c.key} data-testid={`ba-check-${c.key}`} className={`rounded border px-2 py-1 text-xs ${c.status === "warn" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-slate-200 bg-slate-50 text-slate-600"}`}>{c.text}</li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <BestandsBefundKarte snapshot={bestand.snap} elemente={bestand.elemente} onAngehoben={() => setNeuLaden((n) => n + 1)} />

      <div className="grid gap-3 md:grid-cols-2">
        <Card data-testid="ba-kachel-umriss">
          <CardHeader className="pb-1"><CardTitle className="flex items-center gap-2 text-sm"><Ruler className="h-4 w-4" /> {t("Umriss aus dem Modell")}</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-xs text-slate-600">
            <div>{t("Grundfläche")}: <b className="tabular-nums">{Math.round(pm.footArea).toLocaleString("de-DE")} m²</b></div>
            <div>{footprintQuelleText(fq) || t("Herkunft des Umrisses unbekannt (älterer Stand).")}</div>
            <div className="text-slate-400">{t("Übernahme im IFC-Viewer: „Grundriss → Gebäudemodell“.")}</div>
          </CardContent>
        </Card>
        <Card data-testid="ba-kachel-raeume" data-raeume={bestand.programm?.kennzahlen.raeume ?? 0}>
          <CardHeader className="pb-1"><CardTitle className="flex items-center gap-2 text-sm"><ClipboardList className="h-4 w-4" /> {t("Raumprogramm aus Bestand")}</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-xs text-slate-600">
            {bestand.programm ? (
              <>
                <div><b className="tabular-nums">{bestand.programm.kennzahlen.raeume}</b> {t("Räume")} · <b className="tabular-nums">{Math.round(bestand.programm.kennzahlen.flaeche).toLocaleString("de-DE")} m²</b> NUF</div>
                <div>{herkunftZeile(bestand.snap)}</div>
              </>
            ) : <div>{t("Kein Modellstand gespeichert — IFC laden und „Als Modellstand speichern“.")}</div>}
            {bestand.fehler && <div className="text-rose-600">{bestand.fehler}</div>}
            <div className="text-slate-400">{t("Übernahme im Reiter Raumprogramm: „Bestand übernehmen“.")}</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
