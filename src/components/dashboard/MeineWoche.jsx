// Dashboard card "Meine Woche" (phase 82, 82-06, FRIST-05): Monday morning on
// one card — due items, this week's deadlines (at most five), own hours against
// the target, how many in the team are absent, open requests, incoming mail with
// a deadline. Every block leads with one click into its module; a block the role
// may not read (or a cloud-locked module, E-03) is left out. No names, no kinds
// of absence (80 DS-07, E-14) — the model (meineWoche.js) only counts.
// Data: terms through the registry (standard sources, the same window as the page —
// a year back, so overdue deadlines count the same), absences/persons/contracts
// through 82-01's adapter, bookings through 81's store — never the personnel API
// directly. Loads once on mount; a load error is plain text. Reminders exist only
// here in the app (no mail, no push).
//
// In:  nothing (contexts). Out: the card.

import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarClock } from "lucide-react";
import { bitApi } from "@core/api/bitApi";
import { useAuth } from "@core/lib/AuthContext";
import { useI18n } from "@core/lib/i18n";
import { heuteLokal, plusTage } from "@core/lib/kalender/datum.js";
import { feiertage } from "@core/lib/kalender/feiertage.js";
import { DATENQUELLE } from "@core/lib/umgebung";
import { useRegelWerte } from "@core/lib/useRegelWerte";
import { useZugriff } from "@core/lib/ZugriffContext.jsx";
import { ladeTermine } from "@/lib/termine/quellenRegistry.js";
import { meineWoche, stundenDerWoche } from "@/lib/termine/meineWoche.js";
import { kalenderEinstellung } from "@/lib/abwesenheit/kalenderRegeln.js";
import { ladeAbwesenheitsDaten } from "@/lib/people/bueroOrgaPersonal.js";
import { aktiverVertrag } from "@/lib/people/vertrag.js";
import { INHABER_ID, personIdFuer } from "@/lib/zeit/personalQuelle.js";
import { ladeZeitHonorar } from "@/lib/zeitHonorar/speicher.js";
import { REGELWERKE } from "@/lib/settings/regelwerke.js";
import { terminTitel } from "@/components/termine/TerminZeile.jsx";

/** @param {number} min @returns {string} hours with two decimals */
const h = (min) => (min / 60).toFixed(2).replace(".", ",");

/** @returns {React.ReactElement} */
export default function MeineWoche() {
  const { t } = useI18n();
  const zugriff = useZugriff();
  const { user } = useAuth();
  const { wert, laden: regelnLaden } = useRegelWerte(REGELWERKE);
  const heute = heuteLokal();
  const [karte, setKarte] = useState(/** @type {ReturnType<typeof meineWoche>|null} */ (null));
  const [fehler, setFehler] = useState("");

  useEffect(() => {
    if (regelnLaden) return undefined;
    let aktiv = true;
    (async () => {
      try {
        const regelWert = (/** @type {string} */ id) => wert(id);
        const [{ termine }, abw] = await Promise.all([
          ladeTermine(bitApi, { von: /** @type {string} */ (plusTage(heute, -365)), bis: /** @type {string} */ (plusTage(heute, 13)), heute, regelWert, datenquelle: DATENQUELLE, rolle: user?.role ?? null, zugriff }),
          ladeAbwesenheitsDaten({ datenquelle: DATENQUELLE, rolle: user?.role ?? null }),
        ]);
        const solo = !(zugriff.nutzerListe || []).length && !(abw.mitarbeiter || []).length;
        // Own hours: the linked person, or the (virtual) owner without user records; none for an unlinked user.
        const personId = zugriff.mitarbeiterId ? zugriff.mitarbeiterId : !zugriff.nutzer ? personIdFuer(INHABER_ID, abw.mitarbeiter) : null;
        let stunden = null;
        if (personId && zugriff.darf("zeiterfassung")) {
          const zh = await ladeZeitHonorar(bitApi, { entitaeten: ["Zeitbuchung"] }).catch(() => ({ Zeitbuchung: [] }));
          const einst = kalenderEinstellung(wert);
          const jahr = Number(heute.slice(0, 4));
          stunden = stundenDerWoche({
            personId, buchungen: zh.Zeitbuchung || [], vertrag: personId === INHABER_ID ? null : aktiverVertrag(abw.vertraege, personId, heute),
            feiertage: [...feiertage(jahr - 1, einst), ...feiertage(jahr, einst), ...feiertage(jahr + 1, einst)],
            tagessollMinuten: Number(wert("zeit_honorar.tagessoll")) || 480, abwesenheiten: abw.abwesenheiten, heute,
          });
        }
        const k = meineWoche({ termine, zugriff, heute, stunden, abwesenheiten: abw.abwesenheiten, zuordnungen: zugriff.zuordnungen || [], solo });
        if (aktiv) { setKarte(k); setFehler(""); }
      } catch (e) {
        if (aktiv) setFehler(/** @type {any} */ (e)?.message || String(e));
      }
    })();
    return () => { aktiv = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regelnLaden, zugriff, user?.role]);

  const block = "rounded-lg border border-slate-200 p-3 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/60";
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900" data-testid="meine-woche" aria-labelledby="meine-woche-titel">
      <h2 id="meine-woche-titel" className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100"><CalendarClock className="h-5 w-5 text-emerald-600" aria-hidden="true" /> {t("Meine Woche")}</h2>
      {fehler && <p role="alert" className="mt-2 text-sm text-rose-700 dark:text-rose-300">{t("Meine Woche konnte nicht geladen werden")}: {fehler}</p>}
      {!karte && !fehler && <p role="status" className="mt-2 text-sm text-slate-500">{t("Wird geladen …")}</p>}
      {karte && (
        <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          <Link to="/Deadlines" className={block} data-testid="mw-faellig">
            <p className="text-xs text-slate-500">{t("Fällig")}</p>
            <p className="text-2xl font-semibold tabular-nums">{karte.faellig}</p>
            <p className="text-xs text-slate-500">{t("überfällig und heute")}</p>
          </Link>
          <div className={`${block} md:col-span-2 lg:col-span-1`} data-testid="mw-woche">
            <Link to="/Deadlines?tab=agenda" className="text-xs text-slate-500 underline-offset-2 hover:underline">{t("Diese Woche")}</Link>
            {karte.dieseWoche.length === 0 ? <p className="mt-1 text-slate-600 dark:text-slate-300">{t("Keine Einträge.")}</p> : (
              <ul className="mt-1 space-y-0.5">
                {karte.dieseWoche.map((x) => <li key={x.id} className="truncate" data-termin={x.id}><span className="tabular-nums text-slate-500">{x.datum.slice(8, 10)}.{x.datum.slice(5, 7)}.</span> {x.zeit ? `${x.zeit} ` : ""}{terminTitel(t, x)}</li>)}
              </ul>
            )}
          </div>
          {karte.stunden && (
            <Link to="/TimeTracking" className={block} data-testid="mw-stunden">
              <p className="text-xs text-slate-500">{t("Meine Stunden")}</p>
              <p className="text-2xl font-semibold tabular-nums">{h(karte.stunden.istMinuten)} h</p>
              <p className="text-xs text-slate-500">{t("Soll diese Woche {n} h").replace("{n}", h(karte.stunden.sollMinuten))}</p>
            </Link>
          )}
          {karte.abwesendDieseWoche !== null && (
            <Link to="/Absences" className={block} data-testid="mw-abwesend">
              <p className="text-xs text-slate-500">{t("Abwesend im Team")}</p>
              {karte.abwesendDieseWoche === 0 ? <p className="mt-1">{t("Diese Woche ist niemand abwesend.")}</p> : <p className="text-2xl font-semibold tabular-nums">{karte.abwesendDieseWoche}</p>}
            </Link>
          )}
          {karte.offeneAntraege !== null && (
            <Link to="/Absences?tab=requests" className={block} data-testid="mw-antraege">
              <p className="text-xs text-slate-500">{t("Offene Anträge")}</p>
              <p className="text-2xl font-semibold tabular-nums">{karte.offeneAntraege}</p>
            </Link>
          )}
          {karte.posteingangFrist !== null && (
            <Link to="/Correspondence?tab=register" className={block} data-testid="mw-post">
              <p className="text-xs text-slate-500">{t("Posteingang mit Frist")}</p>
              <p className="text-2xl font-semibold tabular-nums">{karte.posteingangFrist}</p>
            </Link>
          )}
        </div>
      )}
      <p className="mt-3 text-xs text-slate-500">{t("Erinnerungen erscheinen nur hier in der App — keine Mail, kein Push.")}</p>
    </section>
  );
}
