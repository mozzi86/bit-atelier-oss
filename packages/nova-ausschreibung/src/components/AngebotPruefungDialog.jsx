// 90-04: offer check (Angebotsprüfung) for one bid of the Preisspiegel. Shows the deterministic result of
// angebotPruefung.angebotPruefen — quantity × unit price recomputed with the LV quantities, missing prices,
// 0,00 €, line totals and quantities the bidder changed, the bidder's own total against the recomputed one,
// plus plausibility hints (outlier unit prices, offer far below the next one) — and lets the checker
//   1. sign the check (Prüfvermerk stored on the bid as `pruefung`),
//   2. export the protocol as CSV,
//   3. stamp the bidder's offer PDF with the Prüfvermerk (`@core/lib/pruefvermerk`).
// Hints never change the verdict: whether a price is speculative or unusually low is the tendering
// party's judgement; the check only names it.
//
// In:  tender, bid, tps (LV positions of the tender), andere (all bids of the tender), onUpdateBid(id, data), onClose.
// Out: the dialog; data-testids ap-zusammenfassung (data-* counts/sum/verdict), ap-zeile (data-codes),
//      ap-alle, ap-pruefer, ap-speichern, ap-csv, ap-pdf, ap-status, ap-fehler.
import React, { useMemo, useState } from "react";
import FormModal from "@core/components/common/FormModal";
import { Button } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { pruefvermerkAufPdf } from "@core/lib/pruefvermerk";
import { angebotPruefen, pruefvermerk, pruefStatus, pruefProtokoll, PRUEF_CODES } from "@ava/lib/angebotPruefung";
import { toCsv, downloadCsv } from "./avaUtils";

const eur = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? "—" : Number(v).toLocaleString("de-DE", { style: "currency", currency: "EUR" }));
const num = (v) => (v === null || v === undefined ? "—" : Number(v).toLocaleString("de-DE", { maximumFractionDigits: 3 }));

/** German label per finding code (translated through t() in the dialog, printed as is in CSV and stamp). */
export const CODE_LABEL = Object.freeze({
  ohne_preis: "kein Preis",
  nullpreis: "Einheitspreis 0,00 €",
  rechenfehler: "GP ≠ Menge × EP",
  menge: "Menge vom Bieter geändert",
  summe: "Angebotssumme des Bieters weicht ab",
  ausreisser: "Einzelpreis auffällig",
  niedrig: "deutlich unter dem nächsten Angebot – Aufklärung prüfen",
});

/**
 * @param {{tender: any, bid: any, tps: Array<any>, andere: Array<any>, onUpdateBid: (id: string, data: any) => Promise<any>, onClose: () => void}} props
 */
export default function AngebotPruefungDialog({ tender, bid, tps, andere, onUpdateBid, onClose }) {
  const { t } = useI18n();
  const erg = useMemo(() => angebotPruefen({ bid, positionen: tps, andere }), [bid, tps, andere]);
  const status = pruefStatus(bid, erg);
  const [alle, setAlle] = useState(false);
  const [pruefer, setPruefer] = useState(String(bid?.pruefung?.pruefer || ""));
  const [bemerkung, setBemerkung] = useState(String(bid?.pruefung?.bemerkung || ""));
  const [seiten, setSeiten] = useState(/** @type {"erste"|"letzte"|"alle"} */ ("erste"));
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState(/** @type {string|null} */ (null));
  const [info, setInfo] = useState(/** @type {string|null} */ (null));

  const label = (c) => t(CODE_LABEL[c] || c);
  const zeilen = alle ? erg.zeilen : erg.zeilen.filter((z) => z.codes.length);
  const ohneBefund = erg.ergebnis === "ohne_befund";

  const speichern = async () => {
    if (!pruefer.trim() || busy) return;
    setBusy(true); setFehler(null);
    try {
      await onUpdateBid(bid.id, { pruefung: pruefvermerk({ ergebnis: erg, pruefer, bemerkung }) });
      setInfo(t("Prüfvermerk gespeichert"));
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const csv = () => {
    const { header, rows } = pruefProtokoll(erg, (c) => CODE_LABEL[c] || c);
    downloadCsv(`pruefprotokoll_${bid.bidder_name || "bieter"}.csv`, toCsv(header, rows));
  };

  const stempeln = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !pruefer.trim()) return;
    setBusy(true); setFehler(null); setInfo(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const zeilenStempel = [
        { label: "Bieter", wert: String(bid.bidder_name || "") },
        { label: "Vergabe", wert: String(tender?.name || "") },
        { label: "Datum", wert: new Date().toLocaleDateString("de-DE") },
        { label: "Geprüft von", wert: pruefer.trim() },
        { label: "Summe nachgerechnet", wert: `${eur(erg.summe)} netto` },
        ...(erg.summe_bieter !== null ? [{ label: "Summe laut Bieter", wert: `${eur(erg.summe_bieter)} netto` }] : []),
        { label: "Befunde / Hinweise", wert: `${erg.befunde} / ${erg.hinweise}` },
      ];
      const { bytes: out, bericht } = await pruefvermerkAufPdf(bytes, {
        titel: ohneBefund ? "Rechnerisch geprüft" : "Geprüft – mit Befund", zeilen: zeilenStempel, seiten, warnung: !ohneBefund,
      });
      const url = URL.createObjectURL(new Blob([/** @type {BlobPart} */ (/** @type {unknown} */ (out))], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name.replace(/\.pdf$/i, "") + "_geprueft.pdf";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setInfo(`${t("Prüfvermerk gestempelt")}: ${bericht.seiten.length} ${t("Seite(n)")}`);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormModal title={`${t("Angebotsprüfung")} — ${bid.bidder_name || ""}`} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-4" data-testid="ap-zusammenfassung"
          data-befunde={erg.befunde} data-hinweise={erg.hinweise} data-summe={erg.summe} data-ergebnis={erg.ergebnis}>
          <div className="rounded border p-2"><div className="text-slate-500">{t("Summe nachgerechnet (LV-Mengen)")}</div><b>{eur(erg.summe)}</b>
            {!erg.vollstaendig && <div className="text-rose-700">{t("unvollständig")}</div>}</div>
          <div className="rounded border p-2"><div className="text-slate-500">{t("Summe laut Bieter")}</div><b>{eur(erg.summe_bieter)}</b>
            {erg.summe_differenz !== null && erg.gesamtCodes.includes("summe") && <div className="text-rose-700">Δ {eur(erg.summe_differenz)}</div>}</div>
          <div className={`rounded border p-2 ${erg.befunde ? "border-rose-200 bg-rose-50" : "border-emerald-200 bg-emerald-50"}`}>
            <div className="text-slate-500">{t("Befunde (rechnerisch)")}</div><b>{erg.befunde}</b></div>
          <div className={`rounded border p-2 ${erg.hinweise ? "border-amber-200 bg-amber-50" : ""}`}>
            <div className="text-slate-500">{t("Hinweise (Plausibilität)")}</div><b>{erg.hinweise}</b></div>
        </div>

        {erg.gesamtCodes.includes("niedrig") && erg.abstand !== null && (
          <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {label("niedrig")}: {Math.round(erg.abstand * 100)} % {t("unter dem nächsten vollständigen Angebot")} ({eur(erg.naechstes)}).
          </div>
        )}

        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-500">{alle ? t("alle Positionen") : t("nur Positionen mit Befund oder Hinweis")}</span>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={alle} onChange={(e) => setAlle(e.target.checked)} data-testid="ap-alle" /> {t("alle zeigen")}
          </label>
        </div>
        <div className="max-h-64 overflow-auto rounded border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
              <tr><th className="px-2 py-1">OZ</th><th className="px-2 py-1">{t("Position")}</th><th className="px-2 py-1 text-right">{t("Menge")}</th>
                <th className="px-2 py-1 text-right">EP</th><th className="px-2 py-1 text-right">{t("GP nachgerechnet")}</th>
                <th className="px-2 py-1 text-right">{t("GP Bieter")}</th><th className="px-2 py-1">{t("Befund / Hinweis")}</th></tr>
            </thead>
            <tbody>
              {zeilen.map((z) => (
                <tr key={z.position_id} className="border-t" data-testid="ap-zeile" data-codes={z.codes.join(",")}>
                  <td className="px-2 py-1 font-mono text-slate-500">{z.oz}</td>
                  <td className="px-2 py-1">{z.title}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{num(z.menge)} {z.unit}{z.menge_bieter !== null && z.codes.includes("menge") && <div className="text-rose-700">{t("Bieter")}: {num(z.menge_bieter)}</div>}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{eur(z.ep)}{z.referenz !== null && z.codes.includes("ausreisser") && <div className="text-amber-800">{t(z.referenz_quelle === "bieter" ? "Median Bieter" : "Kostenanschlag-EP")}: {eur(z.referenz)}</div>}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{eur(z.gp)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{eur(z.gp_bieter)}</td>
                  <td className="px-2 py-1">
                    {z.codes.map((c) => (
                      <span key={c} className={`mr-1 inline-block rounded px-1 ${PRUEF_CODES[c] === "befund" ? "bg-rose-100 text-rose-800" : "bg-amber-100 text-amber-800"}`}>{label(c)}</span>
                    ))}
                  </td>
                </tr>
              ))}
              {!zeilen.length && <tr><td colSpan={7} className="px-2 py-3 text-center text-emerald-700">{t("Keine Auffälligkeiten in den Positionen.")}</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="rounded border border-slate-200 bg-slate-50 p-2 text-xs" data-testid="ap-status" data-status={status}>
          {status === "keine" && t("Noch kein Prüfvermerk.")}
          {status === "aktuell" && `${t("Prüfvermerk vom")} ${new Date(bid.pruefung.datum).toLocaleDateString("de-DE")} (${bid.pruefung.pruefer}) — ${t("aktuell")}`}
          {status === "veraltet" && <span className="text-amber-800">{t("Prüfvermerk veraltet — die Preise haben sich seit der Prüfung geändert. Bitte neu prüfen.")}</span>}
          <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
            <label className="block"><span className="text-slate-500">{t("Geprüft von")}</span>
              <input className="mt-0.5 h-8 w-full rounded-md border border-slate-300 bg-white px-2" value={pruefer} onChange={(e) => setPruefer(e.target.value)} data-testid="ap-pruefer" /></label>
            <label className="block"><span className="text-slate-500">{t("Bemerkung")}</span>
              <input className="mt-0.5 h-8 w-full rounded-md border border-slate-300 bg-white px-2" value={bemerkung} onChange={(e) => setBemerkung(e.target.value)} /></label>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-500">{t("Angebots-PDF stempeln")}:</span>
          <select className="h-8 rounded-md border border-slate-300 bg-white px-2" value={seiten} onChange={(e) => setSeiten(/** @type {any} */ (e.target.value))}>
            <option value="erste">{t("erste Seite")}</option>
            <option value="letzte">{t("letzte Seite")}</option>
            <option value="alle">{t("alle Seiten")}</option>
          </select>
          <input type="file" accept="application/pdf,.pdf" onChange={stempeln} disabled={!pruefer.trim() || busy} className="text-xs" data-testid="ap-pdf" />
          {!pruefer.trim() && <span className="text-amber-800">{t("erst „Geprüft von“ ausfüllen")}</span>}
        </div>

        {fehler && <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800" role="alert" data-testid="ap-fehler">{fehler}</div>}
        {info && <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800" role="status">{info}</div>}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={csv} data-testid="ap-csv">{t("Protokoll als CSV")}</Button>
          <Button type="button" variant="outline" onClick={onClose}>{t("Schließen")}</Button>
          <Button type="button" onClick={speichern} disabled={!pruefer.trim() || busy} data-testid="ap-speichern" className="bg-gradient-to-r from-emerald-600 to-teal-600">
            {busy ? t("Speichern…") : t("Prüfvermerk speichern")}
          </Button>
        </div>
      </div>
    </FormModal>
  );
}
