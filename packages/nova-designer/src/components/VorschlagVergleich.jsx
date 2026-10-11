// 86-05c: side-by-side comparison of 2–4 building proposals — one column per proposal in
// SELECTION order, the ground-floor miniatures at the same scale (same footprint → same
// viewBox), one row per figure of the KENNZAHLEN register with the best cell per row marked
// by the register direction (besteJeKennzahl — null never wins, ties mark every equal best),
// and a footer that names unit and source of every figure so the exported PDF carries them.
// Export reuses the core helper exportElementToPdf (jsPDF + html2canvas) — no second exporter.
//
// In:  vorschlaege (kartenDaten[] in selection order), footprintM (m), onSchliessen,
//      onEntfernen(id). Out: rendered section; data-testids vs-vergleich / vs-vergleich-zelle
//      (data-best="1" on the best cells) / vs-vergleich-export / vs-vergleich-quellen.
import React, { useMemo, useRef, useState } from "react";
import { useI18n } from "@core/lib/i18n";
import { exportElementToPdf } from "@core/lib/pdf";
import { KENNZAHLEN, besteJeKennzahl } from "@designer/lib/bebauungsvorschlaege";
import { Miniatur, kennzahlText, typologieLabel } from "./VorschlagKarte";

/**
 * @param {{vorschlaege: Array<ReturnType<typeof import("@designer/lib/bebauungsvorschlaege").kartenDaten>>, footprintM: Array<{x:number, z:number}>|null|undefined, onSchliessen: () => void, onEntfernen: (id: string) => void}} props
 */
export default function VorschlagVergleich({ vorschlaege, footprintM, onSchliessen, onEntfernen }) {
  const { t } = useI18n();
  const ref = useRef(/** @type {HTMLDivElement|null} */ (null));
  const [status, setStatus] = useState(/** @type {string|null} */ (null));
  const beste = useMemo(() => besteJeKennzahl(vorschlaege), [vorschlaege]);

  const exportieren = async () => {
    if (!ref.current) return;
    setStatus(t("Export läuft …"));
    try {
      await exportElementToPdf(ref.current, "bebauungsvorschlaege-vergleich.pdf", { orientation: "landscape" });
      setStatus(t("PDF gespeichert"));
    } catch (e) {
      setStatus(`${t("Export fehlgeschlagen")}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm" data-testid="vs-vergleich-abschnitt" data-anzahl={vorschlaege.length}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold text-slate-800">{t("Vergleich")} · {vorschlaege.length} {t("Vorschläge")}</div>
        <div className="flex items-center gap-2 text-xs">
          {status && <span className="text-slate-500" data-testid="vs-vergleich-status">{status}</span>}
          <button type="button" className="inline-flex h-7 items-center rounded-md border border-slate-300 bg-white px-2 font-medium text-slate-800 hover:bg-slate-50" onClick={exportieren} data-testid="vs-vergleich-export">
            {t("Als PDF exportieren")}
          </button>
          <button type="button" className="inline-flex h-7 items-center rounded-md border border-slate-300 bg-white px-2 font-medium text-slate-800 hover:bg-slate-50" onClick={onSchliessen} data-testid="vs-vergleich-schliessen">
            {t("Vergleich schließen")}
          </button>
        </div>
      </div>
      {/* The exported area: table + sources. Horizontal scroll instead of wrapping (4 columns at 1280 px). */}
      <div ref={ref} className="overflow-x-auto bg-white p-1">
        <table className="w-full min-w-[640px] border-collapse text-xs" data-testid="vs-vergleich">
          <thead>
            <tr>
              <th className="w-40 border-b border-slate-200 p-1 text-left font-medium text-slate-500">{t("Kennzahl")}</th>
              {vorschlaege.map((v, i) => (
                <th key={v.id} className="border-b border-slate-200 p-1 text-left align-top" data-testid="vs-vergleich-spalte" data-vorschlag={v.id}>
                  <div className="flex items-start justify-between gap-1">
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-slate-800">{i + 1}. {typologieLabel(v.typologie)}</div>
                      <div className="font-normal text-slate-500">{v.riegel > 1 ? `${v.riegel} ${t("Riegel")}` : t("ein Baukörper")}{v.ursprung ? ` · ${t("ähnlich zu")} ${t("Vorschlag")} ${v.ursprung.slice(-6)}` : ""}</div>
                    </div>
                    <button type="button" className="shrink-0 rounded px-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" onClick={() => onEntfernen(v.id)} aria-label={t("Aus dem Vergleich entfernen")} title={t("Aus dem Vergleich entfernen")} data-testid="vs-vergleich-entfernen">×</button>
                  </div>
                </th>
              ))}
            </tr>
            <tr>
              <th className="border-b border-slate-200 p-1 text-left font-medium text-slate-500">{t("Erdgeschoss")}</th>
              {vorschlaege.map((v) => (
                <td key={v.id} className="border-b border-slate-200 p-1"><Miniatur vorschlag={v} footprintM={footprintM} /></td>
              ))}
            </tr>
          </thead>
          <tbody>
            {KENNZAHLEN.map((k) => (
              <tr key={k.key} data-kennzahl={k.key}>
                <th className="border-b border-slate-100 p-1 text-left font-medium text-slate-600" title={k.quelle}>
                  {t(k.label)} <span className="font-normal text-slate-400">({k.einheit})</span>
                </th>
                {vorschlaege.map((v) => {
                  const best = beste[k.key]?.has(v.id) === true;
                  return (
                    <td key={v.id} className={`border-b border-slate-100 p-1 tabular-nums ${best ? "bg-emerald-50 font-semibold text-emerald-900" : "text-slate-800"}`}
                      data-testid="vs-vergleich-zelle" data-kennzahl={k.key} data-vorschlag={v.id} data-best={best ? "1" : "0"} data-wert={v.kennzahlen?.[k.key]?.wert ?? ""}>
                      {kennzahlText(v.kennzahlen?.[k.key])}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-2 text-[10px] leading-snug text-slate-500" data-testid="vs-vergleich-quellen">
          <div className="font-medium text-slate-600">{t("Kennzahlen: Einheit und Quelle")} · {t("beste Zelle je Zeile hervorgehoben")}</div>
          {KENNZAHLEN.map((k) => (
            <div key={k.key}>{t(k.label)} [{k.einheit}, {k.richtung === "aufsteigend" ? t("kleiner ist besser") : t("größer ist besser")}]: {k.quelle}</div>
          ))}
        </div>
      </div>
    </section>
  );
}
