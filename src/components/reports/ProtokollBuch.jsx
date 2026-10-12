// 90-08: minutes book of the current project (Berichte › Protokolle) — list of stored minutes (entity
// MeetingMinutes, new) with open/overdue counts, "Neues Protokoll" (participants from the project's
// participant list, 90-07), "Fortschreiben" (open tasks of the latest minutes carried over), an editor for
// header, participants and items, save, PDF and CSV. Neutral — no link to any customer system.
//
// In:  nothing (project from useProject, contacts loaded here).
// Out: the panel; data-testids pb-liste (data-anzahl), pb-eintrag (data-nummer, data-offen), pb-neu,
//      pb-fortschreiben, pb-editor (data-nummer), pb-titel, pb-datum, pb-ort, pb-tn-name, pb-tn-hinzu,
//      pb-punkt-hinzu, pb-punkt (data-art), pb-punkt-art, pb-punkt-thema, pb-punkt-text, pb-punkt-zust,
//      pb-punkt-frist, pb-punkt-status, pb-speichern, pb-pdf, pb-csv, pb-fehler.
import React, { useEffect, useState } from "react";
import { bitApi } from "@core/api/bitApi";
import { Button } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { useProject } from "@core/lib/ProjectContext";
import { tabelleAlsCsv, dateiAnbieten } from "@core/lib/tabellenExport";
import { Plus, Copy, FileDown, Save, Trash2 } from "lucide-react";
import { PUNKT_ARTEN, neuerEntwurf, fortschreiben, punktNummern, ueberfaellig, offenePunkte, teilnehmerAusBeteiligten, punkteTabelle } from "@/lib/protokoll/protokoll";
import { protokollPdf } from "@/lib/protokoll/protokollPdf";

const ent = () => /** @type {any} */ (bitApi.entities);

export default function ProtokollBuch() {
  const { t } = useI18n();
  const { project, projectId } = useProject();
  const [liste, setListe] = useState(/** @type {Array<any>} */ ([]));
  const [kontakte, setKontakte] = useState(/** @type {Array<any>} */ ([]));
  const [entwurf, setEntwurf] = useState(/** @type {any} */ (null));
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState(/** @type {string|null} */ (null));

  const laden = async () => {
    if (!projectId) return;
    const l = await ent().MeetingMinutes.filter({ project_id: projectId });
    setListe([...(l || [])].sort((a, b) => String(b.datum).localeCompare(String(a.datum)) || (b.nummer || 0) - (a.nummer || 0)));
  };
  useEffect(() => { laden().catch((e) => setFehler(String(e?.message || e))); ent().Contact.list("name").then((c) => setKontakte(c || [])).catch(() => {}); /* eslint-disable-next-line */ }, [projectId]);

  if (!project) return null;
  const heute = new Date();
  const set = (patch) => setEntwurf((e) => ({ ...e, ...patch }));
  const setPunkt = (i, patch) => setEntwurf((e) => ({ ...e, punkte: e.punkte.map((p, k) => (k === i ? { ...p, ...patch } : p)) }));
  const setTn = (i, patch) => setEntwurf((e) => ({ ...e, teilnehmer: e.teilnehmer.map((p, k) => (k === i ? { ...p, ...patch } : p)) }));

  const neu = () => setEntwurf(neuerEntwurf({ projektId: project.id, protokolle: liste, teilnehmer: teilnehmerAusBeteiligten(project.beteiligte, kontakte) }));
  const weiter = () => liste[0] && setEntwurf(fortschreiben(liste[0], { protokolle: liste }));
  const speichern = async () => {
    setBusy(true); setFehler(null);
    try {
      const { id, ...daten } = entwurf;
      const gespeichert = id ? await ent().MeetingMinutes.update(id, daten) : await ent().MeetingMinutes.create(daten);
      setEntwurf({ ...entwurf, id: id || gespeichert?.id });
      await laden();
    } catch (e) { setFehler(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const pdf = async (p) => { try { const r = await protokollPdf(p, project); dateiAnbieten(r.bytes, r.dateiname, "application/pdf"); } catch (e) { setFehler(String(/** @type {any} */ (e)?.message || e)); } };
  const csv = (p) => dateiAnbieten(tabelleAlsCsv(punkteTabelle(p)), `Protokoll_${p.nummer}_Punkte.csv`, "text/csv;charset=utf-8");

  const feld = "h-8 rounded-md border border-slate-300 bg-white px-2 text-xs";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500">{t("Nummerierte Protokolle dieses Projekts. Offene Aufgaben werden beim Fortschreiben übernommen.")}</p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={weiter} disabled={!liste.length} data-testid="pb-fortschreiben"><Copy className="mr-1.5 h-4 w-4" /> {t("Fortschreiben")}</Button>
          <Button size="sm" onClick={neu} data-testid="pb-neu"><Plus className="mr-1.5 h-4 w-4" /> {t("Neues Protokoll")}</Button>
        </div>
      </div>
      {fehler && <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800" role="alert" data-testid="pb-fehler">{fehler}</div>}

      <div className="rounded-xl border border-slate-200 bg-white" data-testid="pb-liste" data-anzahl={liste.length}>
        {liste.map((p) => {
          const offen = offenePunkte(p);
          const spaet = offen.filter((x) => ueberfaellig(x, heute)).length;
          return (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2 text-xs last:border-0" data-testid="pb-eintrag" data-nummer={p.nummer} data-offen={offen.length}>
              <button type="button" className="text-left hover:underline" onClick={() => setEntwurf(p)}>
                <b>{t("Nr.")} {p.nummer} · {p.titel}</b> <span className="text-slate-500">· {p.datum ? new Date(`${p.datum}T00:00:00Z`).toLocaleDateString("de-DE", { timeZone: "UTC" }) : ""}</span>
              </button>
              <span className="flex items-center gap-3">
                <span className={spaet ? "text-rose-700" : "text-slate-500"}>{offen.length} {t("offen")}{spaet ? ` · ${spaet} ${t("überfällig")}` : ""}</span>
                <button aria-label={t("Protokoll als PDF")} type="button" className="text-slate-500 hover:text-emerald-700" onClick={() => pdf(p)} title="PDF"><FileDown className="h-4 w-4" /></button>
              </span>
            </div>
          );
        })}
        {!liste.length && <div className="px-3 py-4 text-center text-xs text-slate-400">{t("Noch keine Protokolle.")}</div>}
      </div>

      {entwurf && (
        <div className="space-y-3 rounded-xl border border-emerald-200 bg-white p-4" data-testid="pb-editor" data-nummer={entwurf.nummer}>
          <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
            <label className="flex flex-col"><span className="text-slate-500">{t("Titel")}</span><input className={feld} value={entwurf.titel} onChange={(e) => set({ titel: e.target.value })} data-testid="pb-titel" /></label>
            <label className="flex flex-col"><span className="text-slate-500">{t("Nr.")}</span><input className={feld} type="number" value={entwurf.nummer} onChange={(e) => set({ nummer: Number(e.target.value) || 1 })} /></label>
            <label className="flex flex-col"><span className="text-slate-500">{t("Datum")}</span><input className={feld} type="date" value={entwurf.datum} onChange={(e) => set({ datum: e.target.value })} data-testid="pb-datum" /></label>
            <label className="flex flex-col"><span className="text-slate-500">{t("Ort")}</span><input className={feld} value={entwurf.ort} onChange={(e) => set({ ort: e.target.value })} data-testid="pb-ort" /></label>
          </div>

          <div className="text-xs">
            <div className="mb-1 font-medium text-slate-600">{t("Teilnehmer")}</div>
            {entwurf.teilnehmer.map((tn, i) => (
              <div key={i} className="mb-1 flex items-center gap-2">
                <input className={`${feld} flex-1`} value={tn.name} placeholder={t("Name")} onChange={(e) => setTn(i, { name: e.target.value })} data-testid="pb-tn-name" />
                <input className={`${feld} flex-1`} value={tn.firma} placeholder={t("Firma")} onChange={(e) => setTn(i, { firma: e.target.value })} />
                <label className="flex items-center gap-1"><input type="checkbox" checked={tn.anwesend !== false} onChange={(e) => setTn(i, { anwesend: e.target.checked })} /> {t("anwesend")}</label>
                <button aria-label={t("Teilnehmer entfernen")} type="button" className="text-slate-400 hover:text-rose-600" onClick={() => set({ teilnehmer: entwurf.teilnehmer.filter((_, k) => k !== i) })}><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={() => set({ teilnehmer: [...entwurf.teilnehmer, { name: "", firma: "", anwesend: true }] })} data-testid="pb-tn-hinzu"><Plus className="mr-1 h-3.5 w-3.5" /> {t("Teilnehmer")}</Button>
          </div>

          <div className="text-xs">
            <div className="mb-1 font-medium text-slate-600">{t("Punkte")}</div>
            {entwurf.punkte.map((p, i) => (
              <div key={i} className={`mb-1.5 grid grid-cols-12 gap-1.5 rounded border p-1.5 ${ueberfaellig(p, heute) ? "border-rose-200 bg-rose-50/50" : "border-slate-200"}`} data-testid="pb-punkt" data-art={p.art}>
                <div className="col-span-12 text-[10px] text-slate-400 md:col-span-1 md:pt-2">{punktNummern(entwurf)[i]}</div>
                <select className={`${feld} col-span-4 md:col-span-2`} value={p.art} onChange={(e) => setPunkt(i, { art: e.target.value })} data-testid="pb-punkt-art">
                  {PUNKT_ARTEN.map((a) => <option key={a.id} value={a.id}>{t(a.label)}</option>)}
                </select>
                <input className={`${feld} col-span-8 md:col-span-3`} value={p.thema || ""} placeholder={t("Thema")} onChange={(e) => setPunkt(i, { thema: e.target.value })} data-testid="pb-punkt-thema" />
                <textarea className="col-span-12 rounded-md border border-slate-300 px-2 py-1 md:col-span-6" rows={1} value={p.text || ""} placeholder={t("Inhalt")} onChange={(e) => setPunkt(i, { text: e.target.value })} data-testid="pb-punkt-text" />
                {p.art === "aufgabe" && (
                  <>
                    <input className={`${feld} col-span-5 md:col-start-2 md:col-span-4`} value={p.zustaendig || ""} placeholder={t("Zuständig")} onChange={(e) => setPunkt(i, { zustaendig: e.target.value })} data-testid="pb-punkt-zust" />
                    <input className={`${feld} col-span-4 md:col-span-3`} type="date" value={p.frist || ""} onChange={(e) => setPunkt(i, { frist: e.target.value })} data-testid="pb-punkt-frist" />
                    <select className={`${feld} col-span-3 md:col-span-2`} value={p.status || "offen"} onChange={(e) => setPunkt(i, { status: e.target.value })} data-testid="pb-punkt-status">
                      <option value="offen">{t("offen")}</option><option value="erledigt">{t("erledigt")}</option>
                    </select>
                  </>
                )}
                <button aria-label={t("Punkt entfernen")} type="button" className="col-span-12 justify-self-end text-slate-400 hover:text-rose-600 md:col-span-1" onClick={() => set({ punkte: entwurf.punkte.filter((_, k) => k !== i) })}><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={() => set({ punkte: [...entwurf.punkte, { art: "aufgabe", thema: "", text: "", zustaendig: "", frist: "", status: "offen", herkunft: null }] })} data-testid="pb-punkt-hinzu"><Plus className="mr-1 h-3.5 w-3.5" /> {t("Punkt")}</Button>
          </div>

          <div className="grid grid-cols-1 gap-2 text-xs md:grid-cols-2">
            <label className="flex flex-col"><span className="text-slate-500">{t("Nächster Termin")}</span><input className={feld} value={entwurf.naechster_termin} onChange={(e) => set({ naechster_termin: e.target.value })} /></label>
            <label className="flex flex-col"><span className="text-slate-500">{t("Verteiler")}</span><input className={feld} value={entwurf.verteiler} onChange={(e) => set({ verteiler: e.target.value })} /></label>
            <label className="flex flex-col md:col-span-2"><span className="text-slate-500">{t("Hinweis")}</span><input className={feld} value={entwurf.hinweis} onChange={(e) => set({ hinweis: e.target.value })} /></label>
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => csv(entwurf)} data-testid="pb-csv">CSV</Button>
            <Button size="sm" variant="outline" onClick={() => pdf(entwurf)} data-testid="pb-pdf"><FileDown className="mr-1.5 h-4 w-4" /> PDF</Button>
            <Button size="sm" variant="outline" onClick={() => setEntwurf(null)}>{t("Schließen")}</Button>
            <Button size="sm" onClick={speichern} disabled={busy || !entwurf.titel?.trim()} data-testid="pb-speichern" className="bg-gradient-to-r from-emerald-600 to-teal-600"><Save className="mr-1.5 h-4 w-4" /> {busy ? t("Speichern…") : t("Speichern")}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
