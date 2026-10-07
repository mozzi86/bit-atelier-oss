// LoeschlaufDialog.jsx — Löschlauf über alle fälligen Fristen (Plan 80-10,
// Task 5): Kopf-Knopf "Löschfristen prüfen (N fällig)" öffnet eine Liste der
// Pläne aus loeschVorschlaege() (nur Personalnummer/Bewerbungskennung und
// Stelle — nie ein voller Name, DS-07); "Alle ausführen" läuft nacheinander,
// jede Zeile nur nach Rückfrage.
//
// In:  nichts von außen (ruft usePersonalDaten/useRegelWerte selbst auf,
//      dasselbe Muster wie DatenschutzAktionen.jsx). Out: UI, fuehrePlanAus()
//      je Zeile über bitApi.personal.

import React from "react";
import { useI18n } from "@core/lib/i18n";
import { useBestaetigung } from "@core/lib/useBestaetigung";
import { useRegelWerte } from "@core/lib/useRegelWerte";
import { bitApi } from "@core/api/bitApi";
import { heuteLokal } from "@core/lib/kalender/datum.js";
import { Dialog, DialogContent, DialogTitle } from "@core/components/ui/dialog";
import { REGELWERKE } from "@/lib/settings/regelwerke.js";
import { loeschVorschlaege, fuehrePlanAus } from "@/lib/people/loeschlauf.js";
import { usePersonalDaten } from "./usePersonalDaten.js";

/**
 * @returns {React.ReactElement}
 */
export default function LoeschlaufDialog() {
  const { t } = useI18n();
  const bestaetige = useBestaetigung();
  const { daten, neuLaden } = usePersonalDaten();
  const { wert: regelWert } = useRegelWerte(REGELWERKE);
  const [offen, setOffen] = React.useState(false);
  const [laeuft, setLaeuft] = React.useState(false);
  const [fehler, setFehler] = React.useState(/** @type {string|null} */ (null));
  const [bericht, setBericht] = React.useState(/** @type {string|null} */ (null));

  const heute = heuteLokal();
  const vorschlaege = loeschVorschlaege(daten, heute, regelWert);
  const stelleVon = (bezug) => {
    if (bezug.tab !== "recruiting") return null;
    const b = daten.Bewerbung.find((x) => x.id === bezug.kennung);
    return b ? daten.Stelle.find((s) => s.id === b.stelle_id)?.titel : null;
  };

  const einenAusfuehren = async (vorschlag) => {
    setFehler(null);
    const ok = await bestaetige({
      titel: t("Diesen Plan ausführen?"),
      text: t("{n} Datensätze werden gelöscht.").replace("{n}", String(vorschlag.plan.loeschen.length)),
      bestaetigen: t("Ausführen"),
      gefahr: true,
    });
    if (!ok) return null;
    return fuehrePlanAus(vorschlag.plan, /** @type {any} */ (bitApi).personal, vorschlag.anlass, heute);
  };

  const alleAusfuehren = async () => {
    const ok = await bestaetige({
      titel: t("Alle fälligen Löschungen ausführen?"),
      text: t("{n} Pläne werden nacheinander ausgeführt.").replace("{n}", String(vorschlaege.length)),
      bestaetigen: t("Alle ausführen"),
      gefahr: true,
    });
    if (!ok) return;
    setLaeuft(true);
    setFehler(null);
    let erledigtN = 0;
    try {
      for (const v of vorschlaege) {
        // eslint-disable-next-line no-await-in-loop -- Löschläufe müssen nacheinander laufen, nicht parallel gegen denselben Speicher
        await fuehrePlanAus(v.plan, /** @type {any} */ (bitApi).personal, v.anlass, heute);
        erledigtN += 1;
      }
      await neuLaden();
      setBericht(t("{n} Pläne ausgeführt.").replace("{n}", String(erledigtN)));
    } catch (err) {
      setFehler(/** @type {any} */ (err)?.message || String(err));
    } finally {
      setLaeuft(false);
    }
  };

  return (
    <>
      <button type="button" onClick={() => setOffen(true)} data-testid="loeschlauf-oeffnen"
        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800">
        {t("Löschfristen prüfen ({n} fällig)").replace("{n}", String(vorschlaege.length))}
      </button>
      {offen && (
        <Dialog open onOpenChange={(o) => { if (!o) setOffen(false); }}>
          <DialogContent className="max-w-lg" data-testid="loeschlauf-dialog">
            <DialogTitle>{t("Löschfristen prüfen")}</DialogTitle>
            {vorschlaege.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">{t("Keine fälligen Löschungen.")}</p>
            ) : (
              <ul className="max-h-80 space-y-2 overflow-y-auto text-sm">
                {vorschlaege.map((v, i) => {
                  const stelle = stelleVon(v.beschriftung);
                  return (
                    <li key={i} className="flex items-center justify-between gap-2 rounded-md border border-slate-200 px-2 py-1.5 dark:border-slate-700">
                      <span>
                        {v.beschriftung.kennung}
                        {stelle ? ` — ${stelle}` : ""}
                        {" · "}
                        {v.plan.loeschen.length} {t("Datensätze")}
                      </span>
                      <button type="button" onClick={() => einenAusfuehren(v).then((r) => r && neuLaden())} disabled={laeuft}
                        className="shrink-0 rounded-md border border-rose-300 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/40">
                        {t("Löschen")}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {fehler && <p role="alert" className="text-sm text-rose-600">{fehler}</p>}
            {bericht && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">{bericht}</p>}
            <p className="text-xs text-slate-500 dark:text-slate-400">{t("Heruntergeladene Dateien kann die App nicht löschen.")}</p>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setOffen(false)} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600">
                {t("Schließen")}
              </button>
              {vorschlaege.length > 0 && (
                <button type="button" onClick={alleAusfuehren} disabled={laeuft} data-testid="loeschlauf-alle-ausfuehren"
                  className="rounded-md border border-rose-300 px-3 py-1.5 text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/40">
                  {t("Alle ausführen")}
                </button>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
