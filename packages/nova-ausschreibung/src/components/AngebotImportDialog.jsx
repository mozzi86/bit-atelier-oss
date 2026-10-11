// 90-03: import a bidder's GAEB offer (X84 / X86 DA XML) into the Preisspiegel of the selected tender.
// Reads the file (gaebXmlRead.readX83 — unit prices, totals, bidder), assigns it to the tender's LV
// positions by Ordnungszahl (angebotImport.angebotZuordnen) and shows BEFORE saving what arrives and
// what does not: matched positions + sum, positions without a price (they stay empty in the bid,
// never 0), positions not in the LV, quantity changes by the bidder, arithmetic deviations, 0,00 €
// prices. The bidder contact is matched by exact company name, otherwise the user picks — a guess
// could award the wrong firm. Saving goes through the same onCreateBid as "Angebot erfassen".
//
// In:  tender, tps (LV positions of the tender), contacts, onCreateBid(bid), onClose.
// Out: the dialog; data-testids ai-datei, ai-bieter, ai-kontakt, ai-zusammenfassung (data-* counts),
//      ai-hinweise, ai-speichern.
import React, { useState } from "react";
import FormModal from "@core/components/common/FormModal";
import { Button } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { readX83, MAX_BYTES } from "@ava/lib/gaebXmlRead";
import { angebotZuordnen, angebotAlsBid, bieterKontakt } from "@ava/lib/angebotImport";

const eur = (v) => (Number.isFinite(Number(v)) ? Number(v).toLocaleString("de-DE", { style: "currency", currency: "EUR" }) : "—");

/**
 * @param {{tender: any, tps: Array<any>, contacts: Array<any>, onCreateBid: (bid: any) => Promise<any>, onClose: () => void}} props
 */
export default function AngebotImportDialog({ tender, tps, contacts, onCreateBid, onClose }) {
  const { t } = useI18n();
  const [stand, setStand] = useState(/** @type {null | {datei: string, lesen: ReturnType<typeof readX83>, zuordnung: ReturnType<typeof angebotZuordnen>}} */ (null));
  const [fehler, setFehler] = useState(/** @type {string|null} */ (null));
  const [kontakt, setKontakt] = useState("");
  const [busy, setBusy] = useState(false);

  const lesen = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    setFehler(null); setStand(null);
    if (!file) return;
    try {
      if (file.size > MAX_BYTES) throw new Error(t("Datei zu groß"));
      const bytes = new Uint8Array(await file.arrayBuffer());
      const text = new TextDecoder("utf-8").decode(bytes);
      if (!/^\s*(<\?xml|<GAEB)/.test(text)) throw new Error(t("Kein GAEB-DA-XML — erwartet wird ein Angebot als .x84 (oder .x86)."));
      const r = readX83(text);
      if (!r.mitPreisen) throw new Error(t("Die Datei enthält keine Einheitspreise — ist es eine Angebotsaufforderung (X83) statt eines Angebots (X84)?"));
      const z = angebotZuordnen(r.positionen, tps);
      setStand({ datei: file.name, lesen: r, zuordnung: z });
      setKontakt(bieterKontakt(r.bieter, contacts) || "");
    } catch (err) {
      setFehler(err instanceof Error ? err.message : String(err));
    }
  };

  const speichern = async () => {
    if (!stand || !kontakt || busy) return;
    setBusy(true);
    try {
      const c = contacts.find((x) => x.id === kontakt);
      await onCreateBid(angebotAlsBid({ tender, zuordnung: stand.zuordnung, contact_id: kontakt, bieterName: c?.company || c?.name || stand.lesen.bieter?.name || "", datei: stand.datei }));
      onClose();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const z = stand?.zuordnung;
  const hinweise = z ? [
    ...z.zeilen.filter((x) => x.hinweise.length).map((x) => `${x.oz} ${x.title}: ${x.hinweise.join("; ")}`),
    ...z.ohnePreis.map((x) => `${x.oz} ${x.title}: ${t("kein Preis im Angebot — bleibt im Preisspiegel leer")}`),
    ...z.unbekannt.map((x) => `${x.oz} ${x.title}: ${t("nicht im LV dieser Vergabe — nicht übernommen")}`),
  ] : [];
  const kandidaten = contacts.filter((c) => ["contractor", "manufacturer", "engineer"].includes(c.category) || tender?.invited_contact_ids?.includes(c.id));

  return (
    <FormModal title={t("GAEB-Angebot importieren")} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <label className="block">
          <span className="text-xs text-slate-500">{t("Angebotsdatei (GAEB DA XML .x84 / .x86)")}</span>
          <input type="file" accept=".x84,.x86,.xml,application/xml,text/xml" onChange={lesen} className="mt-1 block w-full text-xs" data-testid="ai-datei" />
        </label>
        {fehler && <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800" role="alert">{fehler}</div>}
        {stand && z && (
          <>
            <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs" data-testid="ai-bieter">
              <div className="font-medium text-slate-700">{t("Bieter laut Datei")}: {stand.lesen.bieter?.name || t("nicht angegeben")}</div>
              {stand.lesen.bieter && <div className="text-slate-500">{[stand.lesen.bieter.strasse, [stand.lesen.bieter.plz, stand.lesen.bieter.ort].filter(Boolean).join(" ")].filter(Boolean).join(", ")}</div>}
              <label className="mt-1.5 block">
                <span className="text-slate-500">{t("Kontakt im Adressbuch")}</span>
                <select className="mt-0.5 h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-xs" value={kontakt} onChange={(e) => setKontakt(e.target.value)} data-testid="ai-kontakt">
                  <option value="">{t("— bitte wählen —")}</option>
                  {kandidaten.map((c) => <option key={c.id} value={c.id}>{c.company || c.name}</option>)}
                </select>
              </label>
              {!kontakt && <div className="mt-1 text-amber-800">{t("Kein eindeutiger Kontakt gefunden — bitte den Bieter wählen (kein automatisches Raten).")}</div>}
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-4" data-testid="ai-zusammenfassung"
              data-zugeordnet={z.zeilen.length} data-ohne-preis={z.ohnePreis.length} data-unbekannt={z.unbekannt.length} data-summe={z.summe}>
              <div className="rounded border p-2"><div className="text-slate-500">{t("mit Preis übernommen")}</div><b>{z.zeilen.length} / {tps.length}</b></div>
              <div className="rounded border p-2"><div className="text-slate-500">{t("Angebotssumme (LV-Mengen)")}</div><b>{eur(z.summe)}</b></div>
              <div className="rounded border p-2"><div className="text-slate-500">{t("ohne Preis")}</div><b>{z.ohnePreis.length}</b></div>
              <div className="rounded border p-2"><div className="text-slate-500">{t("nicht im LV")}</div><b>{z.unbekannt.length}</b></div>
            </div>
            {hinweise.length > 0 && (
              <ul className="max-h-40 list-disc overflow-y-auto rounded border border-amber-200 bg-amber-50 py-2 pl-6 pr-2 text-[11px] text-amber-900" data-testid="ai-hinweise">
                {hinweise.map((h, i) => <li key={i}>{h}</li>)}
              </ul>
            )}
          </>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={onClose}>{t("Abbrechen")}</Button>
          <Button type="button" onClick={speichern} disabled={!stand || !kontakt || busy || !z?.zeilen.length} data-testid="ai-speichern" className="bg-gradient-to-r from-emerald-600 to-teal-600">
            {busy ? t("Speichern…") : t("Als Angebot übernehmen")}
          </Button>
        </div>
      </div>
    </FormModal>
  );
}
