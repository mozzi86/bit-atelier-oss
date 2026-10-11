// 90-07: participant list of the CURRENT project inside the address book. Contacts come from the address
// book, the role from the catalogue in lib/people/beteiligte.js; the list is stored on the project as
// `beteiligte` (new optional field) right after every change. Suggestions: client contacts and the awarded
// bidders of the project's tenders. "PDF A4 quer" prints the list (lib/people/beteiligtePdf.js).
//
// In:  contacts (address book, already loaded by the page). Project from useProject().
// Out: the panel; data-testids bp-panel (data-anzahl), bp-kontakt, bp-rolle, bp-bemerkung, bp-hinzufuegen,
//      bp-zeile (data-rolle), bp-zeile-rolle, bp-entfernen, bp-vorschlag, bp-uebernehmen, bp-pdf, bp-fehler.
import React, { useEffect, useState } from "react";
import { bitApi } from "@core/api/bitApi";
import { Button } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { useProject } from "@core/lib/ProjectContext";
import { Users, FileDown, Plus, Trash2 } from "lucide-react";
import { ROLLEN, ROLLE_AUS_KATEGORIE, zeilen, vorschlaege, hinzufuegen, entfernen, aendern, normalisieren } from "@/lib/people/beteiligte";
import { beteiligtePdf } from "@/lib/people/beteiligtePdf";

/**
 * @param {{contacts: Array<any>}} props
 */
export default function BeteiligtePanel({ contacts }) {
  const { t } = useI18n();
  const { project, projectId, reloadProjects } = useProject();
  const [liste, setListe] = useState(/** @type {Array<{contact_id: string, rolle: string, bemerkung: string}>} */ ([]));
  const [vergaben, setVergaben] = useState(/** @type {{tenders: any[], bids: any[]}} */ ({ tenders: [], bids: [] }));
  const [kontakt, setKontakt] = useState("");
  const [rolle, setRolle] = useState("bauherr");
  const [bemerkung, setBemerkung] = useState("");
  const [fehler, setFehler] = useState(/** @type {string|null} */ (null));

  useEffect(() => { setListe(normalisieren(project?.beteiligte)); }, [project]);
  useEffect(() => {
    if (!projectId) return;
    let aktiv = true;
    Promise.all([bitApi.entities.Tender.filter({ project_id: projectId }), bitApi.entities.Bid.filter({ project_id: projectId })])
      .then(([tenders, bids]) => { if (aktiv) setVergaben({ tenders: tenders || [], bids: bids || [] }); })
      .catch(() => { /* suggestions are optional — the list works without them */ });
    return () => { aktiv = false; };
  }, [projectId]);

  if (!project) return null;

  const speichern = async (neu) => {
    setFehler(null);
    const vorher = liste;
    setListe(neu);
    try {
      await bitApi.entities.Project.update(project.id, { beteiligte: neu });
      reloadProjects?.();
    } catch (e) {
      setListe(vorher);
      setFehler(e instanceof Error ? e.message : String(e));
    }
  };

  const rows = zeilen(liste, contacts);
  const vor = vorschlaege({ liste, kontakte: contacts, tenders: vergaben.tenders, bids: vergaben.bids, projektId: project.id });
  const kontaktWaehlen = (id) => {
    setKontakt(id);
    const c = contacts.find((x) => x.id === id);
    if (c && ROLLE_AUS_KATEGORIE[c.category]) setRolle(ROLLE_AUS_KATEGORIE[c.category]);
  };
  const pdf = async () => {
    try {
      const { bytes, dateiname } = await beteiligtePdf(rows, project);
      const url = URL.createObjectURL(new Blob([/** @type {BlobPart} */ (/** @type {unknown} */ (bytes))], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url; a.download = dateiname; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e));
    }
  };

  const feld = "h-8 rounded-md border border-slate-300 bg-white px-2 text-xs";
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3" data-testid="bp-panel" data-anzahl={rows.length}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-800"><Users className="h-5 w-5 text-emerald-600" /> {t("Projektbeteiligte")} — {project.name}</h2>
          <p className="text-xs text-slate-500">{t("Wer in welcher Rolle an diesem Projekt beteiligt ist — Kontakte aus dem Adressbuch.")}</p>
        </div>
        <Button variant="outline" onClick={pdf} data-testid="bp-pdf"><FileDown className="mr-2 h-4 w-4" /> {t("PDF A4 quer")}</Button>
      </div>

      <div className="flex flex-wrap items-end gap-2 text-xs">
        <label className="flex flex-col"><span className="text-slate-500">{t("Kontakt")}</span>
          <select className={`${feld} min-w-[14rem]`} value={kontakt} onChange={(e) => kontaktWaehlen(e.target.value)} data-testid="bp-kontakt">
            <option value="">{t("— bitte wählen —")}</option>
            {contacts.map((c) => <option key={c.id} value={c.id}>{c.company ? `${c.company} · ${c.name}` : c.name}</option>)}
          </select></label>
        <label className="flex flex-col"><span className="text-slate-500">{t("Rolle")}</span>
          <select className={feld} value={rolle} onChange={(e) => setRolle(e.target.value)} data-testid="bp-rolle">
            {ROLLEN.map((r) => <option key={r.id} value={r.id}>{t(r.label)}</option>)}
          </select></label>
        <label className="flex flex-col"><span className="text-slate-500">{t("Bemerkung")}</span>
          <input className={feld} value={bemerkung} onChange={(e) => setBemerkung(e.target.value)} placeholder={t("z. B. Gewerk, Zuständigkeit")} data-testid="bp-bemerkung" /></label>
        <Button size="sm" disabled={!kontakt} data-testid="bp-hinzufuegen"
          onClick={() => { speichern(hinzufuegen(liste, { contact_id: kontakt, rolle, bemerkung })); setKontakt(""); setBemerkung(""); }}>
          <Plus className="mr-1 h-3.5 w-3.5" /> {t("Hinzufügen")}
        </Button>
      </div>

      {fehler && <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800" role="alert" data-testid="bp-fehler">{fehler}</div>}

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-left text-slate-400"><tr className="border-b">
            <th className="px-2 py-1">{t("Rolle")}</th><th className="px-2 py-1">{t("Firma / Behörde")}</th><th className="px-2 py-1">{t("Ansprechpartner")}</th>
            <th className="px-2 py-1">{t("Telefon")}</th><th className="px-2 py-1">{t("E-Mail")}</th><th className="px-2 py-1">{t("Bemerkung")}</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.contact_id}-${r.index}`} className="border-b last:border-0" data-testid="bp-zeile" data-rolle={r.rolle}>
                <td className="px-2 py-1">
                  <select className={feld} value={r.rolle} onChange={(e) => speichern(aendern(liste, r.index, { rolle: e.target.value }))} data-testid="bp-zeile-rolle">
                    {ROLLEN.map((x) => <option key={x.id} value={x.id}>{t(x.label)}</option>)}
                    {!ROLLEN.some((x) => x.id === r.rolle) && <option value={r.rolle}>{r.rolle}</option>}
                  </select></td>
                <td className="px-2 py-1">{r.firma}</td>
                <td className={`px-2 py-1 ${r.fehlt ? "text-rose-600" : ""}`}>{r.fehlt ? t("(Kontakt gelöscht)") : r.name}{r.funktion && <div className="text-slate-400">{r.funktion}</div>}</td>
                <td className="px-2 py-1">{r.telefon}</td>
                <td className="px-2 py-1">{r.email}</td>
                <td className="px-2 py-1">{r.bemerkung}</td>
                <td className="px-2 py-1 text-right">
                  <button type="button" className="text-slate-400 hover:text-rose-600" title={t("Entfernen")} onClick={() => speichern(entfernen(liste, r.index))} data-testid="bp-entfernen"><Trash2 className="h-3.5 w-3.5" /></button>
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={7} className="px-2 py-3 text-center text-slate-400">{t("Noch keine Beteiligten eingetragen.")}</td></tr>}
          </tbody>
        </table>
      </div>

      {vor.length > 0 && (
        <div className="rounded border border-emerald-100 bg-emerald-50/50 p-2 text-xs">
          <div className="mb-1 font-medium text-emerald-900">{t("Vorschläge")}</div>
          {vor.map((v) => {
            const c = contacts.find((x) => x.id === v.contact_id);
            return (
              <div key={`${v.contact_id}-${v.rolle}`} className="flex items-center justify-between gap-2 py-0.5" data-testid="bp-vorschlag" data-rolle={v.rolle}>
                <span>{c?.company || c?.name} — {t(ROLLEN.find((r) => r.id === v.rolle)?.label || v.rolle)}{v.bemerkung ? ` (${v.bemerkung})` : ""} <span className="text-slate-400">· {v.grund}</span></span>
                <Button size="sm" variant="outline" onClick={() => speichern(hinzufuegen(liste, v))} data-testid="bp-uebernehmen">{t("Übernehmen")}</Button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
