// Tab "Tagesansicht" of /TimeTracking (phase 81-02): the bookings of one day of
// the person chosen under "Stunden für", with new/edit/delete for drafts, the
// way back for a rejected booking ("Korrigieren" → draft again), the device
// timer and — when the rule zeit_honorar.tagesrahmen is on — the working-day
// frame with its ArbZG hints.
//
// In:  props zh, zz. Out: the tab; writes through the storage layer.

import React from "react";
import { toast } from "sonner";
import { Pencil, Plus, Trash2, Undo2 } from "lucide-react";
import { buttonVariants } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { useBestaetigung } from "@core/lib/useBestaetigung";
import { bearbeitbar, statusWechsel, ZEIT_STATUS_LABELS } from "@/lib/zeit/zeitbuchung.js";
import BuchungDialog from "./BuchungDialog.jsx";
import TimerKarte from "./TimerKarte.jsx";
import TagesrahmenKarte from "./TagesrahmenKarte.jsx";
import { FELD, KARTE, LABEL, stundenText, zielText } from "./zeitGemeinsam.jsx";

/**
 * @param {{zh: import("@/components/zeitHonorar/useZeitHonorar.js").ZeitHonorar, zz: import("./useZeiterfassung.js").Zeiterfassung}} props
 * @returns {React.ReactElement}
 */
export default function TagesAnsicht({ zh, zz }) {
  const { t, lang } = useI18n();
  const bestaetige = useBestaetigung();
  const [datum, setDatum] = React.useState(zh.heute);
  const [dialog, setDialog] = React.useState(/** @type {{buchung: Record<string, any>|null}|null} */ (null));
  const projektNamen = React.useMemo(() => new Map(zh.projekte.map((p) => [p.id, p.name])), [zh.projekte]);
  const buchungen = (zh.daten.Zeitbuchung || []).filter((b) => b.mitarbeiter_id === zz.personId && b.datum === datum);
  const summe = buchungen.filter((b) => b.status !== "abgelehnt").reduce((s, b) => s + (Number(b.minuten) || 0), 0);

  const loeschen = async (/** @type {Record<string, any>} */ b) => {
    const ok = await bestaetige({ titel: t("Buchung löschen?"), text: zielText(b, projektNamen, t), bestaetigen: t("Löschen"), gefahr: true });
    if (!ok) return;
    try {
      await zh.loesche("Zeitbuchung", b.id);
    } catch (err) {
      toast.error(`${t("Löschen fehlgeschlagen")}: ${/** @type {any} */ (err)?.message || String(err)}`);
    }
  };

  const korrigieren = async (/** @type {Record<string, any>} */ b) => {
    const r = statusWechsel(b, "entwurf", { nutzerId: zz.personId });
    if (!r.ok) return;
    try {
      await zz.speichereBuchung(r.buchung);
    } catch (err) {
      toast.error(`${t("Speichern fehlgeschlagen")}: ${/** @type {any} */ (err)?.message || String(err)}`);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]" data-testid="zeit-tag">
      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label htmlFor="zeit-tag-datum" className={LABEL}>{t("Datum")}</label>
            <input id="zeit-tag-datum" type="date" className={FELD} value={datum} onChange={(e) => setDatum(e.target.value || zh.heute)} />
          </div>
          <button type="button" className={buttonVariants({ variant: "default" })} onClick={() => setDialog({ buchung: null })}>
            <Plus aria-hidden="true" /> {t("Neue Buchung")}
          </button>
          <span className="ml-auto text-sm text-slate-700 dark:text-slate-200">{t("Summe")}: {stundenText(summe, lang) || "0"} h</span>
        </div>
        {buchungen.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">{t("Keine Buchungen an diesem Tag.")}</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-700 dark:bg-slate-900">
            {buchungen.map((b) => {
              const entwurf = (b.status || "entwurf") === "entwurf";
              const aenderbar = entwurf && bearbeitbar(b, zh.heute, { bearbeitbarTage: zz.regeln.bearbeitbarTage });
              return (
                <li key={b.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm" data-testid="zeit-tag-buchung">
                  <span className="min-w-0 flex-1 text-slate-800 dark:text-slate-100">{zielText(b, projektNamen, t)}{b.notiz ? ` — ${b.notiz}` : ""}</span>
                  <span className="tabular-nums">{stundenText(b.minuten, lang)} h</span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                    {t(/** @type {any} */ (ZEIT_STATUS_LABELS)[b.status || "entwurf"] || b.status)}{b.quelle === "timer" ? ` · ${t("Timer")}` : ""}
                  </span>
                  {b.status === "abgelehnt" && (
                    <>
                      <span className="w-full text-xs text-red-700 dark:text-red-300">{t("Grund")}: {b.ablehnung_grund}</span>
                      <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={() => korrigieren(b)}>
                        <Undo2 aria-hidden="true" /> {t("Korrigieren")}
                      </button>
                    </>
                  )}
                  {aenderbar && (
                    <>
                      <button type="button" className={buttonVariants({ variant: "ghost", size: "sm" })} onClick={() => setDialog({ buchung: b })} aria-label={t("Bearbeiten")}>
                        <Pencil aria-hidden="true" />
                      </button>
                      <button type="button" className={buttonVariants({ variant: "ghost", size: "sm" })} onClick={() => loeschen(b)} aria-label={t("Löschen")}>
                        <Trash2 aria-hidden="true" />
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="space-y-4">
        <TimerKarte zh={zh} zz={zz} />
        {zz.regeln.tagesrahmen
          ? <TagesrahmenKarte zh={zh} zz={zz} datum={datum} />
          : <div className={`${KARTE} text-xs text-slate-600 dark:text-slate-300`}>{t("Der Tagesrahmen ist in den Regelwerken ausgeschaltet.")}</div>}
      </div>
      {dialog && <BuchungDialog zh={zh} zz={zz} buchung={dialog.buchung} datum={datum} onClose={() => setDialog(null)} />}
    </div>
  );
}
