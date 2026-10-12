// 69-20: card "Vergleich mit Lauf vom …" under a finished check run. Saves the run (entity PruefLauf of the
// project, JSON of laufVergleich.laufZusammenfassung — no model, only keys and figures), offers the run as a
// JSON download, and compares the current run with a saved one or with an uploaded run file: new / fixed /
// unchanged in total and per rule, plus the list of new findings.
//
// In:  ergebnis (ModelCheck result), kennzahlen, modell file name, regelsatz name, projectId.
// Out: card; data-testids lv-karte, lv-speichern, lv-json, lv-auswahl, lv-datei, lv-ergebnis (data-neu,
//      data-behoben, data-gleich, data-hart).
import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { GitCompare } from "lucide-react";
import { bitApi } from "@core/api/bitApi";
import { useI18n } from "@core/lib/i18n";
import { laufZusammenfassung, laufVergleich, laufLesen } from "@ifc/lib/laufVergleich";
import { inhaltAblegen, inhaltLaden, blobIdNeu } from "@core/lib/speicherOrt";

const datumText = (iso) => (iso && !Number.isNaN(Date.parse(iso)) ? new Date(iso).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) : "—");

/**
 * @param {{ergebnis: any, kennzahlen: any, modell?: string|null, regelsatz?: string|null, projectId?: string|null}} props
 */
export default function LaufVergleichKarte({ ergebnis, kennzahlen, modell = null, regelsatz = null, projectId = null }) {
  const { t } = useI18n();
  const aktuell = useMemo(() => laufZusammenfassung(ergebnis, { modell, regelsatz, kennzahlen }), [ergebnis, modell, regelsatz, kennzahlen]);
  const [laeufe, setLaeufe] = useState([]);
  const [basis, setBasis] = useState(null);
  const [meldung, setMeldung] = useState({ text: "", fehler: false });

  const laden = async () => {
    if (!projectId) { setLaeufe([]); return; }
    const r = await bitApi.entities.PruefLauf.filter({ project_id: projectId }).catch(() => []);
    setLaeufe([...(r || [])].sort((a, b) => String(b.datum).localeCompare(String(a.datum))));
  };
  useEffect(() => { laden(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [projectId]);

  const vergleich = useMemo(() => (basis ? laufVergleich(basis, aktuell) : null), [basis, aktuell]);

  const speichern = async () => {
    try {
      // Storage rule (speicherOrt.js): the findings list grows with the project — in the record while small,
      // in the object store from 256 KB on; the record always keeps the count for the list.
      const ablage = await inhaltAblegen(aktuell.befunde, { blobId: blobIdNeu("prueflauf"), art: "prueflauf" });
      await bitApi.entities.PruefLauf.create({ project_id: projectId, ...aktuell, befunde: ablage.inline, befunde_blob: ablage.blob, anzahl: aktuell.befunde.length });
      setMeldung({ text: ablage.hinweis ? `${t("Prüflauf gespeichert.")} ${ablage.hinweis}` : t("Prüflauf gespeichert."), fehler: false });
      await laden();
    } catch (e) { setMeldung({ text: `${t("Speichern fehlgeschlagen")}: ${e?.message || e}`, fehler: true }); }
  };
  const alsJson = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(aktuell, null, 1)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url; a.download = `prueflauf-${(modell || "modell").replace(/[^\w.-]+/g, "_")}-${aktuell.datum.slice(0, 10)}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const dateiLesen = async (f) => {
    if (!f) return;
    try { setBasis(laufLesen(await f.text())); setMeldung({ text: "", fehler: false }); } catch (e) { setMeldung({ text: String(e?.message || e), fehler: true }); }
  };

  return (
    <Card data-testid="lv-karte">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><GitCompare className="h-4 w-4" /> {t("Vergleich mit einem früheren Prüflauf")}</CardTitle>
        <p className="text-xs text-slate-500">{t("Neu, behoben, unverändert — je Regel und GlobalId. Gespeichert werden nur Befund-Schlüssel und Kennzahlen, nie das Modell.")}</p>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" data-testid="lv-speichern" disabled={!projectId} onClick={speichern} title={projectId ? undefined : t("Erst ein Projekt wählen.")}>{t("Lauf speichern")}</Button>
          <Button size="sm" variant="outline" data-testid="lv-json" onClick={alsJson}>{t("Lauf als JSON")}</Button>
          <select className="h-8 rounded border border-slate-200 px-2" data-testid="lv-auswahl" value=""
            onChange={async (e) => {
              const l = laeufe.find((x) => x.id === e.target.value);
              if (!l) return;
              try { setBasis(laufLesen({ ...l, befunde: await inhaltLaden(l.befunde, l.befunde_blob) })); setMeldung({ text: "", fehler: false }); } catch (err) { setMeldung({ text: String(err?.message || err), fehler: true }); }
            }}>
            <option value="">{laeufe.length ? t("Vergleich mit Lauf vom …") : t("Noch kein gespeicherter Lauf")}</option>
            {laeufe.map((l) => <option key={l.id} value={l.id}>{`${datumText(l.datum)} · ${l.modell || "—"} · ${l.anzahl ?? (l.befunde || []).length} ${t("Befunde")}`}</option>)}
          </select>
          <label className="cursor-pointer text-sky-700 underline">{t("oder Lauf-Datei wählen")}
            <input type="file" accept=".json,application/json" className="hidden" data-testid="lv-datei" onChange={(e) => dateiLesen(e.target.files?.[0])} />
          </label>
        </div>
        {meldung.text && <p className={meldung.fehler ? "text-rose-600" : "text-emerald-700"}>{meldung.text}</p>}
        {vergleich && (
          <div data-testid="lv-ergebnis" data-neu={vergleich.neu.length} data-behoben={vergleich.behoben.length} data-gleich={vergleich.unveraendert.length} data-hart={vergleich.hartZunahme}>
            <p className="mb-1 text-slate-600">{t("Basis")}: {datumText(basis.datum)} · {basis.modell || "—"}{vergleich.gleicherRegelsatz ? "" : ` · ${t("anderer Regelsatz — Unterschiede können aus den Regeln kommen")}`}</p>
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded border border-rose-200 bg-rose-50 p-2"><div className="text-[11px] text-slate-500">{t("neu")}</div><div className="text-base font-semibold">{vergleich.neu.length}</div></div>
              <div className="rounded border border-emerald-200 bg-emerald-50 p-2"><div className="text-[11px] text-slate-500">{t("behoben")}</div><div className="text-base font-semibold">{vergleich.behoben.length}</div></div>
              <div className="rounded border border-slate-200 bg-slate-50 p-2"><div className="text-[11px] text-slate-500">{t("unverändert")}</div><div className="text-base font-semibold">{vergleich.unveraendert.length}</div></div>
            </div>
            {vergleich.hartZunahme > 0 && <p className="mt-1 text-rose-700">{t("Harte Kollisionen haben zugenommen")}: +{vergleich.hartZunahme}</p>}
            {vergleich.instabil > 0 && <p className="mt-1 text-slate-500">{vergleich.instabil} {t("Befunde ohne GlobalId — Zuordnung zwischen Läufen nicht gesichert.")}</p>}
            <table className="mt-2 w-full text-left">
              <thead><tr className="text-slate-500"><th>{t("Regel")}</th><th>{t("neu")}</th><th>{t("behoben")}</th><th>{t("unverändert")}</th></tr></thead>
              <tbody>{vergleich.jeRegel.map((r) => <tr key={`${r.art}|${r.regel}`} className="border-t"><td>{r.regel}</td><td>{r.neu}</td><td>{r.behoben}</td><td>{r.unveraendert}</td></tr>)}</tbody>
            </table>
            {vergleich.neu.length > 0 && (
              <details className="mt-2"><summary className="cursor-pointer">{t("Neue Befunde")} ({vergleich.neu.length})</summary>
                <ul className="mt-1 space-y-0.5 font-mono text-[11px]">{vergleich.neu.slice(0, 200).map((b) => <li key={b.schluessel}>{b.regel} · {b.guids.join(" ↔ ") || "—"}</li>)}</ul>
              </details>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
