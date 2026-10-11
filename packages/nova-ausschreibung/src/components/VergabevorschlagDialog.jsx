// 90-05: award proposal (Vergabevorschlag) from the Preisspiegel. Shows the model of
// vergabevorschlag.vergabeModell — ranking of the complete offers, cost comparison with the cost
// calculation (or the LV estimate), the positions that carry the justification, suggested text blocks
// and open items — and produces the two drafts: the proposal PDF and the contract LV PDF of the proposed
// bidder. "Vorschlag speichern" stores the proposal on the tender (`vergabevorschlag`); the award itself
// stays the separate "Zuschlag" button in the Preisspiegel (the app proposes, it does not award).
//
// In:  tender, tps (LV positions of the tender), bids (bids of the tender), projekt, onUpdateTender(id, data), onClose.
// Out: the dialog; data-testids vv-verfahren, vv-mwst, vv-kb, vv-bieter (select), vv-rangliste (data-gewertet),
//      vv-warnungen, vv-baustein (data-id, checkbox), vv-freitext, vv-pdf, vv-lv-pdf, vv-speichern, vv-fehler.
import React, { useState } from "react";
import FormModal from "@core/components/common/FormModal";
import { Button } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { vergabeModell, vorschlagDatensatz, auftragsLv, VERFAHREN, MWST_STANDARD, euro, prozent } from "@ava/lib/vergabevorschlag";
import { vergabevorschlagPdf, auftragsLvPdf, WARNUNG_TEXT } from "@ava/lib/vergabevorschlagPdf";

/** Offer the bytes as a file download. */
function herunterladen({ bytes, dateiname }) {
  const url = URL.createObjectURL(new Blob([/** @type {BlobPart} */ (/** @type {unknown} */ (bytes))], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url; a.download = dateiname; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * @param {{tender: any, tps: Array<any>, bids: Array<any>, projekt: any, onUpdateTender: (id: string, data: any) => Promise<any>, onClose: () => void}} props
 */
export default function VergabevorschlagDialog({ tender, tps, bids, projekt, onUpdateTender, onClose }) {
  const { t } = useI18n();
  const alt = tender?.vergabevorschlag || null;
  const [verfahren, setVerfahren] = useState(String(alt?.verfahren || VERFAHREN[1]));
  const [mwstProzent, setMwstProzent] = useState(String(Math.round((alt?.mwst_satz ?? MWST_STANDARD) * 1000) / 10));
  const [kb, setKb] = useState(alt?.anschlag_quelle === "kostenberechnung" ? String(Math.round(alt.anschlag_netto * (1 + (alt.mwst_satz ?? MWST_STANDARD)) * 100) / 100) : "");
  const [bidId, setBidId] = useState(/** @type {string|null} */ (alt?.bid_id || null));
  const [auswahl, setAuswahl] = useState(/** @type {string[]|null} */ (Array.isArray(alt?.bausteine) && alt.bausteine.length ? alt.bausteine : null));
  const [freitext, setFreitext] = useState(String(alt?.freitext || ""));
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState(/** @type {string|null} */ (null));
  const [info, setInfo] = useState(/** @type {string|null} */ (null));

  const mwst = Number.isFinite(Number(mwstProzent)) && mwstProzent.trim() !== "" ? Number(mwstProzent) / 100 : MWST_STANDARD;
  const eingaben = { verfahren, mwst_satz: mwst, kostenberechnung_brutto: kb.trim() === "" ? null : Number(kb), bid_id: bidId, bausteine: auswahl, freitext };
  // Cheap (a few dozen positions × a handful of bids) — recomputed on every render, no memo needed.
  const m = vergabeModell({ tender, positionen: tps, bids, projekt, eingaben });
  const aktiv = auswahl ?? m.bausteine.filter((b) => b.vorgeschlagen).map((b) => b.id);
  const umschalten = (id) => setAuswahl(aktiv.includes(id) ? aktiv.filter((x) => x !== id) : [...aktiv, id]);

  const lauf = async (fn) => {
    if (busy) return;
    setBusy(true); setFehler(null); setInfo(null);
    try { await fn(); } catch (e) { setFehler(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const pdfVorschlag = () => lauf(async () => herunterladen(await vergabevorschlagPdf(m)));
  const pdfLv = () => lauf(async () => {
    const bid = bids.find((b) => b.id === m.vorschlag?.bid_id);
    herunterladen(await auftragsLvPdf(m, auftragsLv(tps, bid, mwst)));
  });
  const speichern = () => lauf(async () => {
    await onUpdateTender(tender.id, { vergabevorschlag: vorschlagDatensatz(m, { bausteine: aktiv, freitext }) });
    setInfo(t("Vergabevorschlag gespeichert — der Zuschlag bleibt ein eigener Schritt im Preisspiegel."));
  });

  const feld = "mt-0.5 h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-xs";
  return (
    <FormModal title={`${t("Vergabevorschlag")} — ${tender?.name || ""}`} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
          <label className="block"><span className="text-slate-500">{t("Verfahren")}</span>
            <select className={feld} value={verfahren} onChange={(e) => setVerfahren(e.target.value)} data-testid="vv-verfahren">
              {VERFAHREN.map((v) => <option key={v} value={v}>{t(v)}</option>)}
            </select></label>
          <label className="block"><span className="text-slate-500">{t("MwSt. (%)")}</span>
            <input className={feld} type="number" step="any" value={mwstProzent} onChange={(e) => setMwstProzent(e.target.value)} data-testid="vv-mwst" /></label>
          <label className="block"><span className="text-slate-500">{t("Kostenberechnung brutto (optional)")}</span>
            <input className={feld} type="number" step="any" value={kb} onChange={(e) => setKb(e.target.value)} placeholder={euro(m.anschlag.quelle === "lv" ? m.anschlag.brutto : null)} data-testid="vv-kb" /></label>
          <label className="block"><span className="text-slate-500">{t("Vorgeschlagener Bieter")}</span>
            <select className={feld} value={m.vorschlag?.bid_id || ""} onChange={(e) => setBidId(e.target.value || null)} data-testid="vv-bieter">
              {m.bieter.filter((b) => b.rang).map((b) => <option key={b.bid_id} value={b.bid_id}>{b.rang}. {b.name}</option>)}
            </select></label>
        </div>

        <div className="max-h-44 overflow-auto rounded border" data-testid="vv-rangliste" data-gewertet={m.kopf.gewertet} data-vorschlag={m.vorschlag?.name || ""} data-netto={m.vorschlag?.netto ?? ""}>
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
              <tr><th className="px-2 py-1">{t("Rang")}</th><th className="px-2 py-1">{t("Bieter")}</th><th className="px-2 py-1 text-right">{t("netto")}</th>
                <th className="px-2 py-1 text-right">{t("zum Kostenanschlag")}</th><th className="px-2 py-1">{t("Prüfung")}</th></tr>
            </thead>
            <tbody>
              {m.bieter.map((b) => (
                <tr key={b.bid_id} className={`border-t ${b.bid_id === m.vorschlag?.bid_id ? "bg-emerald-50 font-medium" : ""}`}>
                  <td className="px-2 py-1">{b.rang ?? "–"}</td>
                  <td className="px-2 py-1">{b.name}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{euro(b.summe_netto)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{b.zum_anschlag === null ? "" : prozent(b.zum_anschlag)}</td>
                  <td className="px-2 py-1">{b.rang === null ? `${t("nicht gewertet")} (${b.ohne_preis} ${t("ohne Preis")})`
                    : b.pruef_status === "aktuell" ? (b.befunde ? `${b.befunde} ${t("Befund(e)")}` : t("geprüft")) : b.pruef_status === "veraltet" ? t("Prüfung veraltet") : t("offen")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="text-xs text-slate-600">
          {m.anschlag.quelle === "kostenberechnung" ? t("Kostenberechnung") : t("Kostenanschlag LV")}: <b>{euro(m.anschlag.netto)}</b> {t("netto")}
          {m.vorschlag && <> · {t("Vorschlag")}: <b>{euro(m.vorschlag.netto)}</b> ({prozent(m.vorschlag.diff_anschlag_anteil)})</>}
        </div>

        {m.warnungen.length > 0 && (
          <ul className="list-disc rounded border border-amber-200 bg-amber-50 py-2 pl-6 pr-2 text-[11px] text-amber-900" data-testid="vv-warnungen" data-codes={m.warnungen.join(",")}>
            {m.warnungen.map((w) => <li key={w}>{t(WARNUNG_TEXT[w] || w)}</li>)}
          </ul>
        )}

        {m.bausteine.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-slate-600">{t("Begründung (Textbausteine — Lücken ______ im PDF von Hand ergänzen)")}</div>
            {m.bausteine.map((b) => (
              <label key={b.id} className="flex items-start gap-2 rounded border border-slate-200 p-1.5 text-[11px]">
                <input type="checkbox" className="mt-0.5" checked={aktiv.includes(b.id)} onChange={() => umschalten(b.id)} data-testid="vv-baustein" data-id={b.id} />
                <span><b>{t(b.titel)}:</b> {b.text}</span>
              </label>
            ))}
            <textarea className="w-full rounded-md border border-slate-300 p-2 text-xs" rows={2} value={freitext} onChange={(e) => setFreitext(e.target.value)}
              placeholder={t("Eigener Text (optional)")} data-testid="vv-freitext" />
          </div>
        )}

        {fehler && <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800" role="alert" data-testid="vv-fehler">{fehler}</div>}
        {info && <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800" role="status">{info}</div>}

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={pdfVorschlag} disabled={busy || !m.vorschlag} data-testid="vv-pdf">{t("Vergabevorschlag als PDF")}</Button>
          <Button type="button" variant="outline" onClick={pdfLv} disabled={busy || !m.vorschlag} data-testid="vv-lv-pdf">{t("Auftrags-LV als PDF")}</Button>
          <Button type="button" variant="outline" onClick={onClose}>{t("Schließen")}</Button>
          <Button type="button" onClick={speichern} disabled={busy || !m.vorschlag} data-testid="vv-speichern" className="bg-gradient-to-r from-emerald-600 to-teal-600">
            {busy ? t("Speichern…") : t("Vorschlag speichern")}
          </Button>
        </div>
      </div>
    </FormModal>
  );
}
