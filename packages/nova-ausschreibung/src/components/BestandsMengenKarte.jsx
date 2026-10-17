// 73-08 (BEST-10/11): card "Mengentöpfe (Bestand)" in AVA › BIM-Mengen — only in an existing-building
// project. Shows the four pots of bestandsMengen.js with their Erfassungsgrad distribution in plain text
// and lists filter positions whose quantity comes mostly from assumed elements, each with "Als
// Bedarfsposition kennzeichnen" (writes LVPosition.kennz, the field the GAEB 90 import already keeps).
// Elements: the latest survey model state of the project (snapshotElemente, 73-03/06) when there is one,
// otherwise the elements the AVA uses anyway — no second quantity model.
//
// In:  elements (AVA quantity source), positions, filters, onKennzeichnen(position) → Promise.
// Out: rendered card; data-testids bm-karte (data-quelle), bm-topf-<key> (data-menge), bm-vorschlag-<oz>.
import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Layers } from "lucide-react";
import { bitApi } from "@core/api/bitApi";
import { useI18n } from "@core/lib/i18n";
import { useProject } from "@core/lib/ProjectContext";
import { istBestand } from "@core/lib/bauart";
import { snapshotElemente } from "@core/lib/snapshotElemente";
import { bestandsToepfe, vermutetAnteil, statusMischung, ABBRUCH_KG, ABBRUCH_KG_STANDARD } from "@ava/lib/bestandsMengen";
import { positionMode } from "@ava/components/avaUtils";

const BASEN = [["area", "Fläche (m²)"], ["volume", "Volumen (m³)"], ["length", "Länge (m)"], ["count", "Anzahl"]];
const FARBE = { rueckbau: "border-rose-200 bg-rose-50", bestand: "border-slate-200 bg-slate-50", neu: "border-emerald-200 bg-emerald-50", unbekannt: "border-amber-200 bg-amber-50" };

/**
 * @param {{elements?: object[], positions?: object[], filters?: object[], onKennzeichnen?: (p: object) => Promise<void>}} props
 */
export default function BestandsMengenKarte({ elements = [], positions = [], filters = [], onKennzeichnen }) {
  const { t } = useI18n();
  const { project } = useProject();
  const bestand = istBestand(project);
  const [aufnahme, setAufnahme] = useState({ elemente: null, name: "", fehler: "" });
  const [basis, setBasis] = useState(/** @type {"area"|"volume"|"length"|"count"} */ ("area"));
  const [laeuft, setLaeuft] = useState(null);

  useEffect(() => {
    if (!bestand || !project?.id) return undefined;
    let weg = false;
    (async () => {
      const snaps = await bitApi.entities.BimSnapshot.filter({ project_id: project.id }).catch(() => []);
      // Newest state first (created/updated date), the survey the user saved last.
      const snap = [...(snaps || [])].sort((a, b) => String(b.updated_date || b.created_date || "").localeCompare(String(a.updated_date || a.created_date || "")))[0];
      if (!snap) { if (!weg) setAufnahme({ elemente: null, name: "", fehler: "" }); return; }
      const r = await snapshotElemente(snap);
      if (!weg) setAufnahme({ elemente: r.elemente.length ? r.elemente : null, name: snap.name || "", fehler: r.fehler || "" });
    })();
    return () => { weg = true; };
  }, [bestand, project?.id]);

  const quelle = aufnahme.elemente ? aufnahme.elemente : elements;
  // 97-07: cost group of demolition per project (DIN 276: 394 / 212 / at the affected groups), default 394.
  const [abbruchKg, setAbbruchKg] = useState(project?.abbruch_kg || ABBRUCH_KG_STANDARD);
  useEffect(() => { setAbbruchKg(project?.abbruch_kg || ABBRUCH_KG_STANDARD); }, [project?.id, project?.abbruch_kg]);
  const abbruchKgSpeichern = async (wert) => {
    setAbbruchKg(wert);
    if (project?.id) await bitApi.entities.Project.update(project.id, { abbruch_kg: wert });
  };
  const toepfe = useMemo(() => bestandsToepfe(quelle, basis, { abbruchKg }), [quelle, basis, abbruchKg]);
  const vorschlaege = useMemo(() => positions
    .filter((p) => positionMode(p) === "filter" && p.filter_ref)
    .map((p) => ({ p, r: vermutetAnteil(filters.find((f) => f.id === p.filter_ref), quelle, p.mengenbasis || "area") }))
    .filter(({ p, r }) => r.vorschlag && p.kennz !== r.vorschlag), [positions, filters, quelle]);

  // 97-06 rule 2: positions whose filter mixes demolition with existing/new (or unknown with known).
  const gemischt = useMemo(() => positions
    .filter((p) => positionMode(p) === "filter" && p.filter_ref)
    .map((p) => ({ p, r: statusMischung(filters.find((f) => f.id === p.filter_ref), quelle, p.mengenbasis || "area") }))
    .filter(({ r }) => r.gemischt), [positions, filters, quelle]);
  const STATUS_TEXT = { abbruch: "Abbruch", bestand: "Bestand", neubau: "Neubau", ohne: "ohne Status" };

  if (!bestand) return null;
  return (
    <Card data-testid="bm-karte" data-quelle={aufnahme.elemente ? "aufnahme" : "ava"}>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base"><Layers className="h-4 w-4" /> {t("Mengentöpfe (Bestand)")}</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <select className="h-8 rounded border border-slate-200 px-2 text-xs" value={abbruchKg} aria-label={t("Kostengruppe Abbruch")} data-testid="bm-abbruch-kg"
              onChange={(e) => abbruchKgSpeichern(e.target.value)}>
              {ABBRUCH_KG.map((k) => <option key={k.wert} value={k.wert}>{t(k.label)}</option>)}
            </select>
            <select className="h-8 rounded border border-slate-200 px-2 text-xs" value={basis} onChange={(e) => setBasis(/** @type {any} */ (e.target.value))} data-testid="bm-basis">
              {BASEN.map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}
            </select>
          </div>
        </div>
        <p className="text-xs text-slate-500">
          {aufnahme.elemente ? `${t("Quelle: Bauaufnahme")} „${aufnahme.name}“` : t("Quelle: Mengenquelle der AVA (keine Bauaufnahme gespeichert)")}
          {" · "}{t("Der Topf „Unbekannt“ wird nicht auf die anderen verteilt.")}
        </p>
        {aufnahme.fehler && <p className="text-xs text-rose-600">{aufnahme.fehler}</p>}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 md:grid-cols-4">
          {toepfe.map((tp) => (
            <div key={tp.key} className={`rounded-lg border p-2 ${FARBE[tp.key]}`} data-testid={`bm-topf-${tp.key}`} data-menge={tp.menge}>
              <div className="text-[11px] text-slate-500">{t(tp.label)} · {t(tp.hinweis)}</div>
              <div className="text-base font-semibold tabular-nums">{tp.menge.toLocaleString("de-DE")} <span className="text-xs font-normal">{tp.einheit}</span></div>
              <div className="text-[11px] text-slate-600">{tp.text}</div>
            </div>
          ))}
        </div>
        {gemischt.length > 0 && (
          <div className="rounded border border-rose-200 bg-rose-50 p-2 text-xs" data-testid="bm-gemischt">
            <div className="mb-1 font-medium text-rose-900">{t("Positionen, die Abbruch mit Bestand/Neubau mischen — nach Status trennen")}</div>
            <ul className="space-y-0.5">
              {gemischt.map(({ p, r }) => (
                <li key={p.id} data-testid={`bm-gemischt-${p.oz}`}>
                  {p.oz} {p.short_text || p.title}: {Object.entries(r.anteile).map(([k, v]) => `${t(STATUS_TEXT[k])} ${v.toLocaleString("de-DE")}`).join(" · ")}
                </li>
              ))}
            </ul>
          </div>
        )}
        {vorschlaege.length > 0 && (
          <div className="rounded border border-amber-200 bg-amber-50 p-2 text-xs">
            <div className="mb-1 font-medium text-amber-900">{t("Positionen mit überwiegend angenommener Menge")}</div>
            <ul className="space-y-1">
              {vorschlaege.map(({ p, r }) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2" data-testid={`bm-vorschlag-${p.oz}`}>
                  <span>{p.oz} {p.short_text || p.title} — {Math.round(r.anteil * 100)} % {t("angenommen")}</span>
                  <Button size="sm" variant="outline" disabled={laeuft === p.id}
                    onClick={async () => { setLaeuft(p.id); try { await onKennzeichnen?.(p); } finally { setLaeuft(null); } }}>
                    {t("Als Bedarfsposition kennzeichnen")}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
