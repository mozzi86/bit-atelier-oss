// Contract data of phase 81 on 79's Honorarvertrag (phase 81-04, HON-03/04):
// number, status, commissioning stages, dates, liability and the order
// confirmation. The fee basis itself (costs, zone, stages' percentages) stays in
// 79's form — one editor per value. Fields 79's form does not show
// (zahlungsziel_vertraglich, textform_am, mvb_euro) appear here read-only, with
// the payment term and its source (E-12).
//
// Writes only the phase-81 fields through speichereZH (patch case of 81-01: an
// existing contract gets the 81 fields and the beauftragt flags). A contract of
// 79 without a number gets one from zeit_honorar.nummer_vertrag on saving.
// Liability is prefilled from 79's professional indemnity insurance
// (Versicherung typ 'berufshaftpflicht') and then kept as a proof on the contract.
//
// In:  props zh, wert (rule reader), vertrag, versicherungen (79), briefkopf,
//      onClose. Out: a FormModal; the order confirmation is filed under
//      "00_Vertrag & Honorar/Vertrag" (bytes + SHA-256, bereich 'buero').

import React from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { FileCheck2, Plus, Trash2 } from "lucide-react";
import FormModal from "@core/components/common/FormModal";
import { buttonVariants } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { useBestaetigung } from "@core/lib/useBestaetigung";
import { dokumentAblegen } from "@core/lib/ablage.js";
import { dateiAnbieten } from "@core/lib/tabellenExport.js";
import { datumText } from "@core/lib/kalender/datum.js";
import { leistungsbildInfo } from "@core/lib/hoai/leistungsbilder.js";
import { naechsteNummer } from "@core/lib/nummernkreis.js";
import { stufeBeauftragen } from "@/lib/honorar/vertrag.js";
import { auftragsbestaetigungPdf, zahlungszielMitQuelle } from "@/lib/honorar/vertragPdf.js";
import { alsDataUrl, sha256Hex } from "@/lib/honorar/angebotPdf.js";
import { VERTRAG_STATUS } from "@/lib/honorar/vertragsdaten.js";
import BetragFeld from "@/components/accounting/gemeinsam/BetragFeld.jsx";

const FELD = "h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-slate-600 dark:bg-slate-900";
const LABEL = "text-sm font-medium text-slate-700 dark:text-slate-200";

/**
 * @param {{
 *   zh: import("@/components/zeitHonorar/useZeitHonorar.js").ZeitHonorar, wert: (id: string) => any,
 *   vertrag: Record<string, any>, versicherungen?: ReadonlyArray<Record<string, any>>, briefkopf?: any, onClose: () => void,
 * }} props
 * @returns {React.ReactElement}
 */
export default function VertragZusatz({ zh, wert, vertrag, versicherungen = [], briefkopf = null, onClose }) {
  const { t, lang } = useI18n();
  const bestaetige = useBestaetigung();
  const info = leistungsbildInfo(vertrag.leistungsbild);
  const lphAnzahl = info?.lph?.length || (vertrag.lph || []).length || 9;
  const bh = versicherungen.find((v) => v?.typ === "berufshaftpflicht") || null;
  const [form, setForm] = React.useState(() => ({
    status: vertrag.status || ((vertrag.lph || []).some((l) => l?.beauftragt) ? "beauftragt" : "entwurf"),
    vertragsdatum: vertrag.vertragsdatum || zh.heute,
    stufen: Array.isArray(vertrag.stufen) && vertrag.stufen.length
      ? vertrag.stufen
      : [{ nr: 1, lph: (vertrag.lph || []).map((l, i) => (l?.beauftragt ? i + 1 : 0)).filter(Boolean), beauftragt_am: vertrag.textform_am || null }],
    termine: Array.isArray(vertrag.termine) ? vertrag.termine : [],
    haftung: vertrag.haftung || { versicherer: bh?.versicherer || "", deckung_personen_eur: bh?.deckung ?? null, deckung_sach_eur: bh?.deckung ?? null, haftungsbegrenzung_text: "" },
    lph: vertrag.lph || [],
  }));
  const [speichert, setSpeichert] = React.useState(false);
  const aendere = (/** @type {Record<string, any>} */ patch) => setForm((f) => ({ ...f, ...patch }));
  const ziel = zahlungszielMitQuelle(vertrag, { einst: zh.einstBuchhaltung, projekt: zh.projekte.find((p) => p.id === vertrag.project_id) || null });
  const naechste = [form.status, ...(/** @type {any} */ (VERTRAG_STATUS)[vertrag.status || "entwurf"]?.naechste || [])];

  const datensatz = () => ({
    ...vertrag,
    nummer: vertrag.nummer || naechsteNummer(wert("zeit_honorar.nummer_vertrag") || "AV-{jahr}-{nr3}", zh.daten.Honorarvertrag.map((v) => v?.nummer).filter(Boolean), zh.heute),
    status: form.status, vertragsdatum: form.vertragsdatum, stufen: form.stufen, termine: form.termine, haftung: form.haftung, lph: form.lph,
  });

  const speichern = async (/** @type {React.FormEvent|null} */ e) => {
    e?.preventDefault();
    if (form.status !== vertrag.status && (form.status === "gekuendigt" || form.status === "abgeschlossen")) {
      const ok = await bestaetige({ titel: t("Status ändern?"), text: t(/** @type {any} */ (VERTRAG_STATUS)[form.status]?.label || form.status), bestaetigen: t("Ändern"), gefahr: form.status === "gekuendigt" });
      if (!ok) return null;
    }
    setSpeichert(true);
    try {
      const gespeichert = await zh.speichere("Honorarvertrag", datensatz());
      toast.success(t("Vertragsdaten gespeichert"));
      return gespeichert;
    } catch (err) {
      toast.error(`${t("Speichern fehlgeschlagen")}: ${/** @type {any} */ (err)?.message || String(err)}`);
      return null;
    } finally {
      setSpeichert(false);
    }
  };

  const beauftragen = (/** @type {number} */ nr) => {
    const neu = stufeBeauftragen({ ...vertrag, stufen: form.stufen, lph: form.lph }, nr, zh.heute);
    aendere({ stufen: neu.stufen, lph: neu.lph });
  };

  const bestaetigung = async () => {
    const gespeichert = await speichern(null);
    if (!gespeichert) return;
    try {
      const jetztIso = new Date().toISOString();
      const id = [...globalThis.crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, "0")).join("");
      const projekt = zh.projekte.find((p) => p.id === vertrag.project_id) || null;
      const angebot = zh.daten.Honorarangebot.find((a) => a.id === vertrag.angebot_id) || null;
      const pdf = await auftragsbestaetigungPdf({ ...vertrag, ...datensatz() }, { angebot, projekt, briefkopf, einst: zh.einstBuchhaltung, heuteIso: zh.heute, fixiert: { erstelltAm: jetztIso, dateiId: id } });
      const nummer = datensatz().nummer;
      const ablage = await dokumentAblegen({
        projectId: vertrag.project_id, name: `Auftragsbestaetigung-${nummer}.pdf`, typ: "Auftragsbestätigung",
        notiz: `${t("Auftragsbestätigung")} ${nummer}`, daten: alsDataUrl(pdf.bytes), bereich: "buero", sha256: await sha256Hex(pdf.bytes),
      });
      if (!ablage.ok) toast.error(`${t("Ablage fehlgeschlagen")}: ${ablage.grund}`);
      else await zh.speichere("Honorarvertrag", { id: vertrag.id, bestaetigung_dokument_id: /** @type {any} */ (ablage.dokument)?.id ?? null });
      dateiAnbieten(pdf.bytes, `Auftragsbestaetigung-${nummer}.pdf`, "application/pdf");
    } catch (err) {
      toast.error(`${t("PDF fehlgeschlagen")}: ${/** @type {any} */ (err)?.message || String(err)}`);
    }
  };

  return (
    <FormModal title={`${t("Architektenvertrag")} ${vertrag.nummer || t("ohne Nummer")}`} onClose={onClose}>
      <form className="space-y-5" onSubmit={speichern} data-testid="vertrag-zusatz">
        <section className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <span className={LABEL}>{t("Nummer")}</span>
            <p className="text-sm">{vertrag.nummer || t("wird beim Speichern vergeben")}</p>
          </div>
          <div className="space-y-1">
            <label htmlFor="vz-status" className={LABEL}>{t("Status")}</label>
            <select id="vz-status" className={FELD} value={form.status} onChange={(e) => aendere({ status: e.target.value })}>
              {[...new Set(naechste)].map((s) => <option key={s} value={s}>{t(/** @type {any} */ (VERTRAG_STATUS)[s]?.label || s)}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="vz-datum" className={LABEL}>{t("Vertragsdatum")}</label>
            <input id="vz-datum" type="date" className={FELD} value={form.vertragsdatum || ""} onChange={(e) => aendere({ vertragsdatum: e.target.value })} />
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">{t("Stufen der Beauftragung")}</h3>
          {form.stufen.map((s, i) => (
            <div key={s.nr} className="rounded-lg border border-slate-200 p-2 dark:border-slate-700" data-testid="vertrag-stufe">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <strong>{t("Stufe")} {s.nr}</strong>
                {Array.from({ length: lphAnzahl }, (_, k) => k + 1).map((nr) => (
                  <label key={nr} className="flex items-center gap-1">
                    <input type="checkbox" checked={(s.lph || []).includes(nr)} disabled={Boolean(s.beauftragt_am)}
                      onChange={(e) => aendere({ stufen: form.stufen.map((x, j) => (j === i ? { ...x, lph: e.target.checked ? [...(x.lph || []), nr].sort((a, b) => a - b) : (x.lph || []).filter((y) => y !== nr) } : x)) })} />
                    {t("LPH")} {nr}
                  </label>
                ))}
                {s.beauftragt_am
                  ? <span className="ml-auto text-xs text-emerald-800 dark:text-emerald-200">{t("beauftragt am")} {datumText(s.beauftragt_am, lang)}</span>
                  : <button type="button" className={`${buttonVariants({ variant: "outline", size: "sm" })} ml-auto`} onClick={() => beauftragen(s.nr)} disabled={!(s.lph || []).length}>{t("Stufe beauftragen")}</button>}
              </div>
            </div>
          ))}
          <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })}
            onClick={() => aendere({ stufen: [...form.stufen, { nr: form.stufen.reduce((m, s) => Math.max(m, s.nr), 0) + 1, lph: [], beauftragt_am: null }] })}>
            <Plus aria-hidden="true" /> {t("Stufe hinzufügen")}
          </button>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">{t("Termine")}</h3>
          {form.termine.map((tm, i) => (
            <div key={i} className="grid items-end gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
              <div className="space-y-1">
                <label htmlFor={`vz-termin-${i}`} className={LABEL}>{t("Titel")}</label>
                <input id={`vz-termin-${i}`} className={FELD} value={tm.titel || ""} onChange={(e) => aendere({ termine: form.termine.map((x, j) => (j === i ? { ...x, titel: e.target.value } : x)) })} />
              </div>
              <div className="space-y-1">
                <label htmlFor={`vz-termin-datum-${i}`} className={LABEL}>{t("Datum")}</label>
                <input id={`vz-termin-datum-${i}`} type="date" className={FELD} value={tm.datum || ""} onChange={(e) => aendere({ termine: form.termine.map((x, j) => (j === i ? { ...x, datum: e.target.value } : x)) })} />
              </div>
              <div className="space-y-1">
                <label htmlFor={`vz-termin-art-${i}`} className={LABEL}>{t("Art")}</label>
                <select id={`vz-termin-art-${i}`} className={FELD} value={tm.art || "meilenstein"} onChange={(e) => aendere({ termine: form.termine.map((x, j) => (j === i ? { ...x, art: e.target.value } : x)) })}>
                  <option value="meilenstein">{t("Meilenstein")}</option>
                  <option value="frist">{t("Frist")}</option>
                </select>
              </div>
              <button type="button" className={buttonVariants({ variant: "ghost", size: "sm" })} aria-label={t("Entfernen")} onClick={() => aendere({ termine: form.termine.filter((_, j) => j !== i) })}><Trash2 aria-hidden="true" /></button>
            </div>
          ))}
          <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={() => aendere({ termine: [...form.termine, { titel: "", datum: zh.heute, art: "meilenstein" }] })}>
            <Plus aria-hidden="true" /> {t("Termin hinzufügen")}
          </button>
        </section>

        <section className="grid gap-3 sm:grid-cols-2">
          <h3 className="text-sm font-semibold sm:col-span-2">{t("Haftung")}</h3>
          <div className="space-y-1">
            <label htmlFor="vz-versicherer" className={LABEL}>{t("Berufshaftpflicht bei")}</label>
            <input id="vz-versicherer" className={FELD} value={form.haftung?.versicherer || ""} onChange={(e) => aendere({ haftung: { ...form.haftung, versicherer: e.target.value } })} />
          </div>
          <div className="space-y-1">
            <label htmlFor="vz-begrenzung" className={LABEL}>{t("Haftungsbegrenzung")}</label>
            <input id="vz-begrenzung" className={FELD} value={form.haftung?.haftungsbegrenzung_text || ""} onChange={(e) => aendere({ haftung: { ...form.haftung, haftungsbegrenzung_text: e.target.value } })} />
          </div>
          <BetragFeld id="vz-personen" label={t("Deckung Personenschäden (€)")} wert={typeof form.haftung?.deckung_personen_eur === "number" ? Math.round(form.haftung.deckung_personen_eur * 100) : null}
            onChange={(c) => aendere({ haftung: { ...form.haftung, deckung_personen_eur: c === null ? null : c / 100 } })} />
          <BetragFeld id="vz-sach" label={t("Deckung Sach- und Vermögensschäden (€)")} wert={typeof form.haftung?.deckung_sach_eur === "number" ? Math.round(form.haftung.deckung_sach_eur * 100) : null}
            onChange={(c) => aendere({ haftung: { ...form.haftung, deckung_sach_eur: c === null ? null : c / 100 } })} />
        </section>

        <section className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700 space-y-1">
          <p>{t("Zahlungsziel")}: {ziel.tage} {t("Tage")} ({ziel.quelle === "laut Architektenvertrag" ? t("laut Architektenvertrag") : ziel.quelle === "vereinbart je Bauherr" ? t("vereinbart je Bauherr") : t("Bürostandard")}){vertrag.zahlungsziel_vertraglich ? ` · ${t("vertraglich vereinbart")}` : ""}</p>
          <p>{t("in Textform vereinbart am")}: {vertrag.textform_am ? datumText(vertrag.textform_am, lang) : "—"}{typeof vertrag.mvb_euro === "number" ? ` · ${t("Mitzuverarbeitende Bausubstanz (€)")}: ${vertrag.mvb_euro}` : ""}</p>
          <p className="text-xs text-slate-600 dark:text-slate-300">
            {t("Die Projektleitung pflegt das Personal.")} <Link to="/People?tab=staff" className="underline">{t("Projektzuordnung pflegen")}</Link>
          </p>
        </section>

        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={buttonVariants({ variant: "outline" })} onClick={onClose}>{t("Abbrechen")}</button>
          <button type="button" className={buttonVariants({ variant: "outline" })} disabled={speichert} onClick={bestaetigung}><FileCheck2 aria-hidden="true" /> {t("Auftragsbestätigung erzeugen")}</button>
          <button type="submit" className={buttonVariants({ variant: "default" })} disabled={speichert}>{t("Speichern")}</button>
        </div>
      </form>
    </FormModal>
  );
}
