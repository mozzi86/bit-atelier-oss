// PersonalUebersicht.jsx — der Überblick über dem Reiterbereich von /People
// (Plan 80-04, Task 5): drei Kacheln Team/Recruiting/Eintritte aus echten
// Seed-Daten, dazu die Rechtsform-Hinweise (D-P80-07, keine eigene Abbildung
// der Rechtsform-Schlüssel — nur rechtsformWirkung()/personenPruefen() aus 79).
//
// Native Elemente statt shadcn-Card (CONSISTENCY-15-Kachelstil aus
// Dashboard.jsx:180-260, tsc-Kosten der Wrapper vermieden).
//
// In:  nichts (lädt selbst über usePersonalDaten/useRegelWerte).
// Out: die drei Kacheln; DS-07 gilt hier NICHT für die Eintritts-Kachel selbst
//      (Namen im UI-Inhalt der Personalseite sind erlaubt) — nur URL,
//      document.title und Palette dürfen nie einen Personennamen tragen.

import React from "react";
import { Link } from "react-router-dom";
import { Building2, CalendarClock, PiggyBank, Search, ShieldCheck, TriangleAlert, Users } from "lucide-react";
import { useI18n } from "@core/lib/i18n";
import { useRegelWerte } from "@core/lib/useRegelWerte";
import { heuteLokal } from "@core/lib/kalender/datum.js";
import { personalMeta } from "@core/api/personalDb.js";
import { rechtsformWirkung } from "@/lib/accounting/rechtsform.js";
import { REGELWERKE, RECHTSFORM_LABEL } from "@/lib/settings/regelwerke.js";
import { personalUebersicht } from "@/lib/people/uebersicht.js";
import { gesellschafterHinweise, anzeigeName } from "@/lib/people/mitarbeiter.js";
import { bauePersonalLink } from "@/lib/people/personalLink.js";
import { usePersonalDaten } from "./usePersonalDaten.js";
import { REITER_KOMPONENTEN } from "./index.js";
// Nur lesend — gesetzt von 80-07 (Spur A); dieser Plan ändert die Datei nicht.
import { BEREICH_KOMPONENTEN } from "@/components/settings/index.js";
import FristenLeiste from "./FristenLeiste.jsx";
import { Betrag } from "./GehaltSichtbarkeit.jsx";

/** @param {string} text @param {Record<string, string|number>} werte @returns {string} */
function fuellen(text, werte) {
  return text.replace(/\{(\w+)\}/g, (_, k) => String(werte[k] ?? ""));
}

/** @param {number} n @returns {string} */
const fmtGanz = (n) => Math.round(n).toLocaleString("de-DE");
/** @param {number} n @returns {string} */
const fmtDezimal = (n) => n.toLocaleString("de-DE", { maximumFractionDigits: 1 });
/** @param {string|null|undefined} iso @returns {string} */
const fmtDatum = (iso) => (iso ? new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" }) : "—");

const KACHEL = "rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900";
const KACHEL_TITEL = "text-sm font-semibold text-slate-500 dark:text-slate-400";

/**
 * @returns {React.ReactElement}
 */
export default function PersonalUebersicht() {
  const { t } = useI18n();
  const { daten, gesellschafter79, laden: datenLaden, fehler, neuLaden } = usePersonalDaten();
  const { wert, laden: regelnLaden } = useRegelWerte(REGELWERKE);
  const heute = heuteLokal();
  // 80-10 Task 4/6: personalUebersicht bleibt rein/synchron — den Stand der
  // letzten .bitpers-Sicherung liest diese Komponente selbst (async) und
  // reicht ihn als bereits gelesenen Wert durch (uebersicht.js Dateikopf).
  const [letzteSicherung, setLetzteSicherung] = React.useState(/** @type {string|null|undefined} */ (undefined));
  React.useEffect(() => {
    let aktiv = true;
    personalMeta("letzte_sicherung").then((v) => { if (aktiv) setLetzteSicherung(typeof v === "string" ? v : null); }).catch(() => { if (aktiv) setLetzteSicherung(null); });
    return () => { aktiv = false; };
  }, [daten]); // nach jedem neuLaden (z. B. nach einer frischen Sicherung) erneut lesen

  const einst = { rechtsform: wert("buchhaltung.rechtsform"), gewst_aktiv: wert("buchhaltung.gewst_aktiv") };
  const wirkung = rechtsformWirkung(einst);
  const uebersicht = personalUebersicht(daten, heute, wert, { letzteSicherung: letzteSicherung ?? null });
  const hinweise = gesellschafterHinweise(einst, daten.Mitarbeiter, gesellschafter79);
  const { team, recruiting, eintritte } = uebersicht;

  const inhaberWort = wirkung.entnahmen === "inhaber" ? t("Inhaber:in") : t("Gesellschafter:innen");
  const teamZeile = [
    fuellen(t("{n} aktiv"), { n: fmtGanz(team.aktiv) }),
    fuellen(t("{n} im Eintritt"), { n: fmtGanz(team.im_eintritt) }),
    fuellen(t("{n} {wort}"), { n: fmtGanz(team.inhaber_gesellschafter), wort: inhaberWort }),
    fuellen(t("{n} VZÄ"), { n: fmtDezimal(team.vzae) }),
  ].join(" · ");

  const rechtsformText = t(RECHTSFORM_LABEL[wirkung.rechtsform] ?? wirkung.rechtsform);
  const regelwerkeBereit = REGELWERKE.some((g) => g.gruppe === "buchhaltung") && BEREICH_KOMPONENTEN.rules?.BEREIT;
  const kleinbetriebText = team.kleinbetrieb
    ? t("Kleinbetrieb (§ 23 KSchG) — das Kündigungsschutzgesetz gilt nicht, kein Rechtsrat.")
    : t("Das Kündigungsschutzgesetz gilt (§ 23 KSchG), kein Rechtsrat.");

  const staffBereit = Boolean(REITER_KOMPONENTEN.staff?.BEREIT);
  const recruitingBereit = Boolean(REITER_KOMPONENTEN.recruiting?.BEREIT);
  const mitarbeiterVon = (id) => daten.Mitarbeiter.find((m) => m.id === id) ?? null;

  if (fehler) {
    return (
      <div role="alert" data-testid="personal-uebersicht-fehler" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-100">
        {fehler}
      </div>
    );
  }

  return (
    <div data-testid="personal-uebersicht" className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4" aria-busy={datenLaden || regelnLaden}>
      <section aria-labelledby="pue-team-h" className={KACHEL}>
        <h2 id="pue-team-h" className={KACHEL_TITEL}>{t("Team")}</h2>
        <p className="mt-2 text-lg font-semibold text-slate-800 dark:text-slate-100">{teamZeile}</p>
        {/* The legal form stays plain text; the link says what it does ("Rechtsform
            ändern", 80-04 task 5, 80-07/80-10 behavior 13/16) instead of carrying the
            current value as its only name, and only once the rule books exist. */}
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          {rechtsformText}
          {regelwerkeBereit && (
            <>
              {" · "}
              <Link to="/Settings?tab=rules&einstellung=buchhaltung.rechtsform" className="text-emerald-700 underline-offset-4 hover:underline dark:text-emerald-400">
                {t("Rechtsform ändern")}
              </Link>
            </>
          )}
        </p>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{kleinbetriebText}</p>
        {hinweise.length > 0 && (
          <ul className="mt-3 space-y-1" data-testid="personal-rechtsform-hinweise">
            {hinweise.map((h) => (
              <li key={h.schluessel} className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{t(h.text)}{h.link ? ` — ${t(h.link)}` : ""}</span>
              </li>
            ))}
          </ul>
        )}
        {staffBereit && (
          <Link to={`/People${bauePersonalLink({ tab: "staff" })}`} className="mt-3 inline-flex items-center gap-1 text-sm text-emerald-700 hover:underline dark:text-emerald-400">
            <Users className="h-3.5 w-3.5" aria-hidden="true" /> {t("Mitarbeitende ansehen")}
          </Link>
        )}
      </section>

      <section aria-labelledby="pue-recruiting-h" className={KACHEL}>
        <h2 id="pue-recruiting-h" className={KACHEL_TITEL}>{t("Recruiting")}</h2>
        <p className="mt-2 text-lg font-semibold text-slate-800 dark:text-slate-100">
          {fuellen(t("{n} Stellen offen"), { n: fmtGanz(recruiting.stellen_offen) })} · {fuellen(t("{n} Bewerbungen aktiv"), { n: fmtGanz(recruiting.bewerbungen_aktiv) })}
        </p>
        {recruiting.loeschung_ueberfaellig > 0 && (
          // Kontrast ≥ 4,5:1 — dieselben Klassen wie der "überfällig"-Chip der
          // Fristenleiste (80-06-SUMMARY: 15,57:1 gegen den echten Seitenhintergrund).
          <p className="mt-1 flex items-center gap-1.5 text-sm text-rose-700 dark:text-rose-300" data-testid="recruiting-loeschung-ueberfaellig">
            <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {fuellen(t("{n} Löschung überfällig"), { n: fmtGanz(recruiting.loeschung_ueberfaellig) })}
          </p>
        )}
        {recruitingBereit && (
          <Link to={`/People${bauePersonalLink({ tab: "recruiting" })}`} className="mt-3 inline-flex items-center gap-1 text-sm text-emerald-700 hover:underline dark:text-emerald-400">
            <Search className="h-3.5 w-3.5" aria-hidden="true" /> {t("Mitarbeitersuche ansehen")}
          </Link>
        )}
      </section>

      <section aria-labelledby="pue-eintritte-h" className={KACHEL}>
        <h2 id="pue-eintritte-h" className={KACHEL_TITEL}>
          <Building2 className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />{t("Eintritte")}
        </h2>
        {eintritte.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{t("Keine laufenden Eintritte.")}</p>
        ) : (
          <ul className="mt-2 space-y-3">
            {eintritte.map((v) => {
              const m = mitarbeiterVon(v.mitarbeiter_id);
              const prozent = v.gesamt > 0 ? Math.round((v.erledigt / v.gesamt) * 100) : 0;
              return (
                <li key={v.vorgang_id} className="text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-slate-800 dark:text-slate-100">{anzeigeName(m) || t("Unbekannt")}</span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">{fmtDatum(v.stichtag)}</span>
                  </div>
                  <progress
                    value={v.erledigt}
                    max={v.gesamt}
                    aria-valuenow={prozent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={fuellen(t("Eintritt {name}: {erledigt} von {gesamt} erledigt"), { name: anzeigeName(m), erledigt: v.erledigt, gesamt: v.gesamt })}
                    className="mt-1 h-1.5 w-full accent-emerald-600"
                  >
                    {prozent}%
                  </progress>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {fuellen(t("{erledigt} von {gesamt} erledigt"), { erledigt: v.erledigt, gesamt: v.gesamt })}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="pue-faellig-h" className={KACHEL}>
        <h2 id="pue-faellig-h" className={KACHEL_TITEL}>
          <CalendarClock className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />{t("Fällig")}
        </h2>
        <div className="mt-2">
          <FristenLeiste faellig={uebersicht.faellig} onQuittiert={neuLaden} />
        </div>
      </section>

      {/* 80-10 Task 6: Sicherungsalter und Personalkosten-Soll additiv. */}
      <section aria-labelledby="pue-sicherung-h" className={KACHEL} data-testid="personal-kachel-sicherung">
        <h2 id="pue-sicherung-h" className={KACHEL_TITEL}>
          <ShieldCheck className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />{t("Sicherung")}
        </h2>
        {uebersicht.sicherung_tage === null ? (
          <p className="mt-2 text-sm font-semibold text-amber-700 dark:text-amber-300">{t("noch nie gesichert")}</p>
        ) : (
          <p className={`mt-2 text-sm font-semibold ${uebersicht.sicherung_tage >= 30 ? "text-amber-700 dark:text-amber-300" : "text-slate-800 dark:text-slate-100"}`}>
            {uebersicht.sicherung_tage === 0 ? t("heute") : fuellen(t("vor {n} Tagen"), { n: fmtGanz(uebersicht.sicherung_tage) })}
          </p>
        )}
      </section>

      <section aria-labelledby="pue-kosten-h" className={KACHEL} data-testid="personal-kachel-kosten">
        <h2 id="pue-kosten-h" className={KACHEL_TITEL}>
          <PiggyBank className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />{t("Personalkosten (Plan)")}
        </h2>
        <p className="mt-2 text-lg font-semibold text-slate-800 dark:text-slate-100">
          <Betrag wert={uebersicht.personalkosten.summe_brutto_eur} /> {t("brutto")} · <Betrag wert={uebersicht.personalkosten.summe_ag_eur} /> {t("AG-Kosten")}
        </p>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t("Plan — das Ist kommt aus dem Lohnjournal")}</p>
      </section>
    </div>
  );
}
