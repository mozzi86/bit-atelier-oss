// Tab "Honorarangebote" of /Fees (phase 81-03, HON-01/02): the offers of the
// active project (or all projects), grouped by number with their versions,
// status as text AND colour ("abgelaufen" only shown, never stored), amount or
// "Tafel fehlt". Actions by status: edit (draft), new version, PDF, mark as sent
// (with confirmation: totals frozen, other open versions replaced, PDF bytes +
// SHA-256 filed under "00_Vertrag & Honorar/Angebote" with bereich 'buero'),
// rejected. No e-mail is sent — the app only records the status (T-81-18).
// Accepting an offer comes with plan 81-04 (`aktionen` slot).
//
// In:  props zh, alleProjekte, onNeu, aktionen (optional extra buttons per
//      offer). Out: the list and its dialogs.

import React from "react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { FileDown, FilePlus2, Mail, Pencil, Send, XCircle } from "lucide-react";
import { buttonVariants } from "@core/components/ui/button";
import { bitApi } from "@core/api/bitApi";
import EmptyState from "@core/components/common/EmptyState";
import { useI18n } from "@core/lib/i18n";
import { useBestaetigung } from "@core/lib/useBestaetigung";
import { useBriefkopf } from "@core/lib/useBriefkopf.js";
import { useZugriff } from "@core/lib/ZugriffContext.jsx";
import { schreibenLink } from "@/lib/schriftverkehr/deepLink.js";
import { dokumentAblegen } from "@core/lib/ablage.js";
import { dateiAnbieten } from "@core/lib/tabellenExport.js";
import { datumText } from "@core/lib/kalender/datum.js";
import { leistungsbildInfo } from "@core/lib/hoai/leistungsbilder.js";
import { formatEuro } from "@/lib/accounting/geld.js";
import { effektiverStatus, neueFassung, versenden } from "@/lib/honorar/angebot.js";
import { aufstellung } from "@/lib/honorar/aufstellung.js";
import { alsDataUrl, angebotPdf, sha256Hex } from "@/lib/honorar/angebotPdf.js";
import { ANGEBOT_STATUS } from "@/lib/honorar/vertragsdaten.js";
import AngebotEditor from "./AngebotEditor.jsx";

/** Colour per (effective) status — always next to the text, never alone. */
const FARBE = {
  entwurf: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100",
  versendet: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-100",
  angenommen: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
  abgelehnt: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-100",
  ersetzt: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
  abgelaufen: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100",
};

/**
 * 32 random hex characters (file id of a sent PDF).
 * @returns {string}
 */
function zufallsId() {
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * @param {{
 *   zh: import("@/components/zeitHonorar/useZeitHonorar.js").ZeitHonorar,
 *   alleProjekte: boolean, onNeu: () => void,
 *   aktionen?: (angebot: Record<string, any>) => React.ReactNode,
 * }} props
 * @returns {React.ReactElement}
 */
export default function AngebotListe({ zh, alleProjekte, onNeu, aktionen }) {
  const { t, lang } = useI18n();
  // 82-05: entry into the correspondence, only with its right (never in a locked cloud build, E-03).
  const schriftverkehr = useZugriff().darf("schriftverkehr", "voll");
  const bestaetige = useBestaetigung();
  const { briefkopf } = useBriefkopf();
  const [bearbeiten, setBearbeiten] = React.useState(/** @type {Record<string, any>|null} */ (null));
  const [busy, setBusy] = React.useState("");
  const projektNamen = React.useMemo(() => new Map(zh.projekte.map((p) => [p.id, p.name])), [zh.projekte]);
  const angebote = (zh.daten.Honorarangebot || []).filter((a) => alleProjekte || !zh.projectId || a.project_id === zh.projectId);
  /** @type {Map<string, any[]>} */
  const gruppen = new Map();
  for (const a of angebote) {
    if (!gruppen.has(a.nummer)) gruppen.set(a.nummer, []);
    gruppen.get(a.nummer)?.push(a);
  }
  const liste = [...gruppen.entries()].sort((x, y) => String(y[0]).localeCompare(String(x[0])));

  const pdfErzeugen = async (/** @type {Record<string, any>} */ a, /** @type {{erstelltAm: string, dateiId: string}|null} */ fixiert = null) => angebotPdf(a, {
    projekt: zh.projekte.find((p) => p.id === a.project_id) || null, briefkopf, heuteIso: zh.heute, fixiert,
  });

  const pdfLaden = async (/** @type {Record<string, any>} */ a) => {
    setBusy(a.id);
    try {
      // A sent offer: the stored bytes are the proof — download exactly those.
      if (a.dokument_id) {
        const dok = await /** @type {any} */ (bitApi).entities.Document.get(a.dokument_id).catch(() => null);
        if (typeof dok?.data === "string" && dok.data.startsWith("data:")) {
          const roh = atob(dok.data.slice(dok.data.indexOf(",") + 1));
          const bytes = Uint8Array.from(roh, (c) => c.charCodeAt(0));
          dateiAnbieten(bytes, `${a.nummer}-F${a.fassung}.pdf`, "application/pdf");
          return;
        }
      }
      const r = await pdfErzeugen(a);
      dateiAnbieten(r.bytes, `${a.nummer}-F${a.fassung}.pdf`, "application/pdf");
      if (r.ersetzt) toast.info(t("{n} Zeichen ersetzt: {z}").replace("{n}", String(r.ersetzt)).replace("{z}", r.zeichen.join(" ")));
    } catch (err) {
      toast.error(`${t("PDF fehlgeschlagen")}: ${/** @type {any} */ (err)?.message || String(err)}`);
    } finally {
      setBusy("");
    }
  };

  const alsVersendet = async (/** @type {Record<string, any>} */ a) => {
    const ok = await bestaetige({
      titel: t("Als versendet markieren?"),
      text: t("Die Fassung wird eingefroren, andere offene Fassungen gelten als ersetzt, das PDF wird in der Projektablage gespeichert. Es wird keine E-Mail versendet."),
      bestaetigen: t("Als versendet markieren"),
    });
    if (!ok) return;
    setBusy(a.id);
    try {
      const jetztIso = new Date().toISOString();
      const r = /** @type {any} */ (versenden(a, zh.daten.Honorarangebot, { heuteIso: zh.heute, jetztIso }));
      if (!r.ok) {
        toast.error(r.fehler === "tafel_fehlt" ? t("Tafel fehlt — nur mit Pauschale versendbar.") : r.fehler === "frei" ? t("frei vereinbar (§ 7 Abs. 2 HOAI)") : t("Dieser Statuswechsel ist nicht erlaubt."));
        return;
      }
      const pdf = await pdfErzeugen(r.angebot, { erstelltAm: jetztIso, dateiId: zufallsId() });
      const sha256 = await sha256Hex(pdf.bytes);
      const ablage = await dokumentAblegen({
        projectId: r.angebot.project_id, name: `${r.angebot.nummer}-F${r.angebot.fassung}.pdf`, typ: "Honorarangebot",
        notiz: `${t("Honorarangebot")} ${r.angebot.nummer}, ${t("Fassung")} ${r.angebot.fassung}`, daten: alsDataUrl(pdf.bytes), bereich: "buero", sha256,
      });
      if (!ablage.ok) toast.error(`${t("Ablage fehlgeschlagen")}: ${ablage.grund}`);
      await zh.schreibeStapel([
        { art: "speichern", entitaet: "Honorarangebot", obj: { ...r.angebot, dokument_id: ablage.ok ? /** @type {any} */ (ablage.dokument)?.id ?? null : null } },
        ...r.ersetzte.map((x) => ({ art: /** @type {const} */ ("speichern"), entitaet: "Honorarangebot", obj: x })),
      ]);
      dateiAnbieten(pdf.bytes, `${r.angebot.nummer}-F${r.angebot.fassung}.pdf`, "application/pdf");
      toast.success(t("Als versendet markiert"));
      if (pdf.ersetzt) toast.info(t("{n} Zeichen ersetzt: {z}").replace("{n}", String(pdf.ersetzt)).replace("{z}", pdf.zeichen.join(" ")));
    } catch (err) {
      toast.error(`${t("Versand fehlgeschlagen")}: ${/** @type {any} */ (err)?.message || String(err)}`);
    } finally {
      setBusy("");
    }
  };

  const fassungAnlegen = async (/** @type {Record<string, any>} */ a) => {
    try {
      const neu = neueFassung(a, zh.daten.Honorarangebot, { heuteIso: zh.heute });
      const gespeichert = await zh.speichere("Honorarangebot", neu);
      setBearbeiten(gespeichert);
    } catch (err) {
      toast.error(`${t("Speichern fehlgeschlagen")}: ${/** @type {any} */ (err)?.message || String(err)}`);
    }
  };

  const ablehnen = async (/** @type {Record<string, any>} */ a) => {
    const ok = await bestaetige({ titel: t("Honorarangebot als abgelehnt markieren?"), text: `${a.nummer} · ${t("Fassung")} ${a.fassung}`, bestaetigen: t("Abgelehnt"), gefahr: true });
    if (!ok) return;
    try {
      await zh.speichere("Honorarangebot", { ...a, status: "abgelehnt" });
    } catch (err) {
      toast.error(`${t("Speichern fehlgeschlagen")}: ${/** @type {any} */ (err)?.message || String(err)}`);
    }
  };

  if (!liste.length) {
    return (
      <EmptyState title={t("Noch kein Honorarangebot")} description={t("Ein Honorarangebot nach HOAI 2021 entsteht in fünf Schritten.")}
        action={<button type="button" className={buttonVariants({ variant: "default" })} onClick={onNeu}><FilePlus2 aria-hidden="true" /> {t("Neues Honorarangebot")}</button>} />
    );
  }

  return (
    <div className="space-y-3" data-testid="angebot-liste">
      <div className="flex justify-end">
        <button type="button" className={buttonVariants({ variant: "default" })} onClick={onNeu}><FilePlus2 aria-hidden="true" /> {t("Neues Honorarangebot")}</button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800/60">
            <tr className="text-left text-slate-600 dark:text-slate-300">
              <th scope="col" className="px-3 py-2">{t("Nummer")}</th>
              {alleProjekte && <th scope="col" className="px-3 py-2">{t("Projekt")}</th>}
              <th scope="col" className="px-3 py-2">{t("Leistungsbild")}</th>
              <th scope="col" className="px-3 py-2">{t("Status")}</th>
              <th scope="col" className="px-3 py-2">{t("Datum")}</th>
              <th scope="col" className="px-3 py-2">{t("Gültig bis")}</th>
              <th scope="col" className="px-3 py-2 text-right">{t("Honorar netto")}</th>
              <th scope="col" className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {liste.flatMap(([, fassungen]) => [...fassungen].sort((x, y) => (Number(y.fassung) || 1) - (Number(x.fassung) || 1)).map((a) => {
              const status = effektiverStatus(a, zh.heute);
              const auf = a.summen?.netto != null && a.status !== "entwurf" ? null : aufstellung(a);
              const netto = a.status !== "entwurf" && a.summen ? a.summen.netto : auf?.summen.netto;
              const info = leistungsbildInfo(a.leistungsbild);
              const label = status === "abgelaufen" ? "abgelaufen" : (/** @type {any} */ (ANGEBOT_STATUS)[status]?.label || status);
              return (
                <tr key={a.id} data-testid="angebot-zeile" data-nummer={a.nummer}>
                  <td className="px-3 py-2 font-medium">{a.nummer} <span className="text-xs text-slate-500">· {t("Fassung")} {a.fassung}</span></td>
                  {alleProjekte && <td className="px-3 py-2">{projektNamen.get(a.project_id) || a.project_id}</td>}
                  <td className="px-3 py-2">{t(info?.label || a.leistungsbild)}</td>
                  <td className="px-3 py-2"><span className={`rounded px-1.5 py-0.5 text-xs ${/** @type {any} */ (FARBE)[status] || ""}`}>{t(label)}</span></td>
                  <td className="px-3 py-2 tabular-nums">{datumText(a.datum, lang)}</td>
                  <td className="px-3 py-2 tabular-nums">{datumText(a.gueltig_bis, lang)}</td>
                  <td className="px-3 py-2 text-right tabular-nums" data-testid="angebot-netto-zeile">
                    {auf?.tafelFehlt ? t("Tafel fehlt") : netto == null ? t("frei vereinbar") : formatEuro(Math.round(netto * 100), lang)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap justify-end gap-1">
                      {a.status === "entwurf" && (
                        <button type="button" className={buttonVariants({ variant: "ghost", size: "sm" })} onClick={() => setBearbeiten(a)} aria-label={t("Bearbeiten")} title={t("Bearbeiten")}><Pencil aria-hidden="true" /></button>
                      )}
                      <button type="button" className={buttonVariants({ variant: "ghost", size: "sm" })} onClick={() => pdfLaden(a)} disabled={busy === a.id || Boolean(auf?.tafelFehlt && a.pauschal_euro == null)} aria-label={t("PDF")} title={t("PDF")}><FileDown aria-hidden="true" /></button>
                      {schriftverkehr && (
                        <Link className={buttonVariants({ variant: "ghost", size: "sm" })} to={schreibenLink({ neu: "anschreiben_honorarangebot", bezug: { typ: "honorarangebot", id: a.id } })}
                          data-testid="angebot-anschreiben" title={t("Anschreiben erstellen")}><Mail aria-hidden="true" /> {t("Anschreiben erstellen")}</Link>
                      )}
                      {a.status === "entwurf" && (
                        <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={() => alsVersendet(a)} disabled={busy === a.id || netto == null}
                          title={netto == null ? t("Ohne Betrag nicht versendbar (Tafel fehlt bzw. frei vereinbar)") : undefined}>
                          <Send aria-hidden="true" /> {t("Als versendet markieren")}
                        </button>
                      )}
                      {(a.status === "versendet" || a.status === "angenommen" || a.status === "abgelehnt") && (
                        <button type="button" className={buttonVariants({ variant: "ghost", size: "sm" })} onClick={() => fassungAnlegen(a)} title={t("Neue Fassung")}><FilePlus2 aria-hidden="true" /> {t("Neue Fassung")}</button>
                      )}
                      {a.status === "versendet" && (
                        <button type="button" className={buttonVariants({ variant: "ghost", size: "sm" })} onClick={() => ablehnen(a)} title={t("Abgelehnt")}><XCircle aria-hidden="true" /> {t("Abgelehnt")}</button>
                      )}
                      {aktionen?.(a)}
                    </div>
                  </td>
                </tr>
              );
            }))}
          </tbody>
        </table>
      </div>
      {bearbeiten && <AngebotEditor zh={zh} angebot={bearbeiten} onClose={() => setBearbeiten(null)} />}
    </div>
  );
}
