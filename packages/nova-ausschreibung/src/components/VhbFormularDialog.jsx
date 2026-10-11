// 90-06: fill a VHB form as a draft from the Preisspiegel. The user uploads the blank, fillable VHB form
// from their own folder; the dialog detects form number/title from the file name, lists the shared
// standard fields it can fill from project, tender, bidder and office profile (editable), names the gaps
// ("[BITTE ERGÄNZEN]") and the form-specific fields it leaves alone. The download is only offered after the
// mandatory check step (checker + form edition + "keine Rechtsprüfung"); every fill is logged on the tender.
//
// In:  tender, bids (of the tender), contacts, projekt, onUpdateTender(id, data), onClose.
// Out: the dialog; data-testids vf-bieter, vf-vergabenr, vf-datei, vf-formular (data-nummer), vf-stand,
//      vf-belegung (data-belegt/-luecken/-offen), vf-feld (data-name, input), vf-pruefer, vf-bestaetigt,
//      vf-herunterladen, vf-protokoll, vf-fehler.
import React, { useState } from "react";
import FormModal from "@core/components/common/FormModal";
import { Button } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { useBriefkopf } from "@core/lib/useBriefkopf";
import { formularAusDateiname, felderLesen, standardWerte, belegung, formularFuellen, protokollEintrag, VHB_TEILE, LUECKE } from "@ava/lib/vhbFormular";

/**
 * @param {{tender: any, bids: Array<any>, contacts: Array<any>, projekt: any, onUpdateTender: (id: string, data: any) => Promise<any>, onClose: () => void}} props
 */
export default function VhbFormularDialog({ tender, bids, contacts, projekt, onUpdateTender, onClose }) {
  const { t } = useI18n();
  const { briefkopf } = useBriefkopf();
  const vorwahl = tender?.awarded_bid_id || tender?.vergabevorschlag?.bid_id || bids[0]?.id || "";
  const [bidId, setBidId] = useState(vorwahl);
  const [vergabeNr, setVergabeNr] = useState(String(tender?.vergabe_nr || ""));
  const [datei, setDatei] = useState(/** @type {null | {name: string, bytes: Uint8Array, felder: Awaited<ReturnType<typeof felderLesen>>}} */ (null));
  const [stand, setStand] = useState("");
  const [eingaben, setEingaben] = useState(/** @type {Record<string, string>} */ ({}));
  const [pruefer, setPruefer] = useState("");
  const [bestaetigt, setBestaetigt] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState(/** @type {string|null} */ (null));
  const [info, setInfo] = useState(/** @type {string|null} */ (null));

  const bid = bids.find((b) => b.id === bidId) || null;
  const kontakt = contacts.find((c) => c.id === bid?.contact_id) || null;
  const formular = datei ? formularAusDateiname(datei.name) : null;
  const standard = standardWerte({ projekt, tender, bid, kontakt, buero: briefkopf, vergabe_nr: vergabeNr });
  const bel = datei ? belegung(datei.felder, standard, eingaben) : null;
  const protokoll = Array.isArray(tender?.vhb_formulare) ? tender.vhb_formulare : [];

  const lesen = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    setFehler(null); setInfo(null); setDatei(null); setEingaben({}); setBestaetigt(false);
    if (!file) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const felder = await felderLesen(bytes);
      setDatei({ name: file.name, bytes, felder });
      setStand(formularAusDateiname(file.name).stand);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : String(err));
    }
  };

  const herunterladen = async () => {
    if (!datei || !bel || !formular || busy) return;
    setBusy(true); setFehler(null);
    try {
      const { bytes, gefuellt } = await formularFuellen(datei.bytes, bel.belegt);
      const name = `${[formular.nummer, formular.titel].filter(Boolean).join("_").replace(/[^\p{L}\p{N}._-]+/gu, "_")}_Entwurf.pdf`;
      const url = URL.createObjectURL(new Blob([/** @type {BlobPart} */ (/** @type {unknown} */ (bytes))], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url; a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      const eintrag = protokollEintrag({ formular, stand, datei: datei.name, pruefer, gefuellt, luecken: bel.luecken, bid_id: bid?.id || null });
      await onUpdateTender(tender.id, { vhb_formulare: [...protokoll, eintrag], ...(vergabeNr.trim() ? { vergabe_nr: vergabeNr.trim() } : {}) });
      setInfo(`${gefuellt} ${t("Felder ausgefüllt")} · ${bel.luecken.length} ${t("Lücken")} · ${t("im Protokoll der Vergabe vermerkt")}`);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const feld = "mt-0.5 h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-xs";
  const bereit = !!datei && bestaetigt && !!pruefer.trim() && !!stand.trim();
  return (
    <FormModal title={t("VHB-Formular ausfüllen (Entwurf)")} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
          {t("Die App liefert keine Formblätter. Bitte das leere, ausfüllbare VHB-Formular aus dem eigenen Formularordner wählen. Gefüllt werden nur die gemeinsamen Standardfelder; formularspezifische Felder und Kreuze bleiben für die Bearbeitung im PDF-Programm offen.")}
        </p>
        <div className="grid grid-cols-1 gap-2 text-xs md:grid-cols-3">
          <label className="block"><span className="text-slate-500">{t("Bieter / Auftragnehmer")}</span>
            <select className={feld} value={bidId} onChange={(e) => setBidId(e.target.value)} data-testid="vf-bieter">
              <option value="">{t("— ohne —")}</option>
              {bids.map((b) => <option key={b.id} value={b.id}>{b.bidder_name}{b.id === tender?.awarded_bid_id ? ` (${t("Zuschlag")})` : ""}</option>)}
            </select></label>
          <label className="block"><span className="text-slate-500">{t("Vergabe-Nr.")}</span>
            <input className={feld} value={vergabeNr} onChange={(e) => setVergabeNr(e.target.value)} data-testid="vf-vergabenr" /></label>
          <label className="block"><span className="text-slate-500">{t("Leeres VHB-Formular (PDF)")}</span>
            <input type="file" accept="application/pdf,.pdf" onChange={lesen} className="mt-1 block w-full text-xs" data-testid="vf-datei" /></label>
        </div>

        {fehler && <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800" role="alert" data-testid="vf-fehler">{fehler}</div>}

        {datei && formular && bel && (
          <>
            <div className="grid grid-cols-1 gap-2 text-xs md:grid-cols-2" data-testid="vf-formular" data-nummer={formular.nummer}>
              <div className="rounded border bg-slate-50 p-2">
                <div className="font-medium text-slate-700">{formular.nummer ? `${formular.nummer} · ` : ""}{formular.titel}</div>
                <div className="text-slate-500">{formular.teil ? t(VHB_TEILE[formular.teil]) : t("Formularnummer nicht erkannt")} · {datei.felder.length} {t("Felder")}</div>
              </div>
              <label className="block"><span className="text-slate-500">{t("Formularfassung / Stand (Pflicht, z. B. VHB Bund 2017, Stand 2024)")}</span>
                <input className={feld} value={stand} onChange={(e) => setStand(e.target.value)} data-testid="vf-stand" /></label>
            </div>

            <div className="text-xs text-slate-600" data-testid="vf-belegung" data-belegt={bel.belegt.length} data-luecken={bel.luecken.length} data-offen={bel.offen.length}>
              {bel.belegt.length - bel.luecken.length} {t("Standardfelder gefüllt")} · <span className={bel.luecken.length ? "text-rose-700" : ""}>{bel.luecken.length} {t("Lücken")}</span> · {bel.offen.length} {t("formularspezifische Felder bleiben offen")}
            </div>
            <div className="max-h-56 overflow-auto rounded border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-50 text-left text-slate-500"><tr><th className="px-2 py-1">{t("Feld")}</th><th className="px-2 py-1">{t("Wert")}</th></tr></thead>
                <tbody>
                  {bel.belegt.map((b) => (
                    <tr key={b.name} className="border-t" data-testid="vf-feld" data-name={b.name}>
                      <td className="px-2 py-1 font-mono text-[10px] text-slate-500">{b.name}</td>
                      <td className="px-2 py-1">
                        <input className={`h-7 w-full rounded border px-1.5 ${b.quelle === "luecke" ? "border-rose-300 bg-rose-50" : "border-slate-200"}`}
                          value={eingaben[b.name] ?? (b.wert === LUECKE ? "" : b.wert)} placeholder={b.wert === LUECKE ? LUECKE : ""}
                          onChange={(e) => setEingaben((x) => ({ ...x, [b.name]: e.target.value }))} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="space-y-2 rounded border border-slate-300 bg-slate-50 p-2 text-xs">
              <div className="font-medium text-slate-700">{t("Prüfschritt (Pflicht)")}</div>
              <label className="block"><span className="text-slate-500">{t("Geprüft von")}</span>
                <input className={feld} value={pruefer} onChange={(e) => setPruefer(e.target.value)} data-testid="vf-pruefer" /></label>
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-0.5" checked={bestaetigt} onChange={(e) => setBestaetigt(e.target.checked)} data-testid="vf-bestaetigt" />
                <span>{t("Ich habe alle Einträge geprüft. Die App nimmt keine Rechtsprüfung vor; das Formular ist ein Entwurf und wird außerhalb der App vervollständigt und unterschrieben.")}</span>
              </label>
            </div>
          </>
        )}

        {info && <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800" role="status">{info}</div>}

        {protokoll.length > 0 && (
          <div className="text-[11px] text-slate-500" data-testid="vf-protokoll" data-anzahl={protokoll.length}>
            <div className="font-medium text-slate-600">{t("Bisher ausgefüllt")}</div>
            {protokoll.slice(-5).reverse().map((p, i) => (
              <div key={i}>{new Date(p.datum).toLocaleDateString("de-DE")} · {p.nummer} {p.titel} · {p.stand} · {p.pruefer} · {p.luecken?.length || 0} {t("Lücken")}</div>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={onClose}>{t("Schließen")}</Button>
          <Button type="button" onClick={herunterladen} disabled={!bereit || busy} data-testid="vf-herunterladen" className="bg-gradient-to-r from-emerald-600 to-teal-600">
            {t("Entwurf herunterladen")}
          </Button>
        </div>
      </div>
    </FormModal>
  );
}
