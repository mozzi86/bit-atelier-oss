// Personal — the HR area of the office (80-01, E-01/E-02/E-03): staff, recruiting,
// onboarding/offboarding and contracts as ?tab= keys (src/lib/people/reiter.js),
// project-free, in the menu group "Büro". This plan builds the shell; the tabs
// come from lane B (80-04, 80-06, 80-08, 80-09) and appear once their file says
// BEREIT. With E-17 the app works without a single employee record: until then
// the page shows "Personal wird eingerichtet".
//
// Access gate first (personalZugang): without 'erlaubt' — cloud build or another
// role — the page shows a notice and reads NO personnel data (DS-04, DS-12).
// The document title is the menu title only, never a name (DS-07).
//
// Tabs use the Radix primitives directly, like Accounting.jsx (tsc cost of the
// shadcn wrappers); `activationMode="manual"` (NB-14).
//
// In:  ?tab=<key> (German aliases are normalised). Out: the page.

import React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { useNavigate } from "react-router-dom";
import { IdCard, ShieldAlert, UserPlus, X } from "lucide-react";
import EmptyState from "@core/components/common/EmptyState";
import { ModulFehlergrenze } from "@core/components/ModulFehlergrenze";
import { seitenWurzel } from "@core/lib/utils";
import { useAuth } from "@core/lib/AuthContext";
import { useI18n } from "@core/lib/i18n";
import { useTabParam } from "@core/lib/useTabParam";
import { useAktionen } from "@core/lib/aktionen";
import { DATENQUELLE } from "@core/lib/umgebung";
import { PERSONAL_REITER_ALIAS, PERSONAL_REITER_INFO, STANDARD_PERSONAL_REITER } from "@/lib/people/reiter.js";
import { personalZugang } from "@/lib/people/zugang.js";
import { bauePersonalLink } from "@/lib/people/personalLink.js";
import { REITER_KOMPONENTEN } from "@/components/people/index.js";
import PersonalZugangsHinweis from "@/components/people/PersonalZugangsHinweis.jsx";
import PersonalUebersicht from "@/components/people/PersonalUebersicht.jsx";
import { GehaltSichtbarkeitProvider, GehaelterUmschalten } from "@/components/people/GehaltSichtbarkeit.jsx";
import PersonalSicherung from "@/components/people/PersonalSicherung.jsx";
import LoeschlaufDialog from "@/components/people/LoeschlaufDialog.jsx";

const Tabs = TabsPrimitive.Root;
const TabsList = TabsPrimitive.List;
const TabsTrigger = TabsPrimitive.Trigger;
const TabsContent = TabsPrimitive.Content;

// Class strings of the shadcn tab parts (ui/tabs.jsx), as in Accounting.jsx.
const LISTE = "flex flex-wrap h-auto gap-1 items-center rounded-lg bg-slate-100 p-1 text-muted-foreground dark:bg-slate-800";
const AUSLOESER = "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium text-slate-700 ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow dark:text-slate-200";
const INHALT = "pt-4 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

/** localStorage key of the dismissed data protection notice (per device, level `geraet`). */
export const HINWEIS_SCHLUESSEL = "bit-atelier-personal-hinweis";

/** Tabs whose file says BEREIT, in registry order (module constant for useTabParam). */
const BEREITE_REITER = Object.freeze(PERSONAL_REITER_INFO.filter((r) => REITER_KOMPONENTEN[r.key]?.BEREIT));
const ERLAUBT = Object.freeze(BEREITE_REITER.map((r) => r.key));

/** @returns {boolean} true when the notice was dismissed on this device */
function hinweisGeschlossen() {
  try { return window.localStorage.getItem(HINWEIS_SCHLUESSEL) === "1"; } catch { return false; }
}

/**
 * One-time, dismissible notice: personnel data is special and stays on the device.
 * @param {{onSchliessen: () => void}} props
 * @returns {React.ReactElement}
 */
function Datenschutzhinweis({ onSchliessen }) {
  const { t } = useI18n();
  return (
    <div role="note" data-testid="personal-datenschutzhinweis"
      className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
      <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <p className="flex-1">
        {t("Personaldaten sind besonders schutzbedürftig und bleiben auf diesem Gerät. Keine Gesundheits-, Religions- oder Gewerkschaftsangaben erfassen.")}
      </p>
      <button type="button" onClick={onSchliessen} aria-label={t("Hinweis schließen")} title={t("Hinweis schließen")}
        data-testid="personal-datenschutzhinweis-schliessen"
        className="shrink-0 rounded-md p-1 hover:bg-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 dark:hover:bg-amber-900/60">
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

export default function People() {
  const { t } = useI18n();
  const { user } = useAuth();
  const navigate = useNavigate();
  const zugang = personalZugang({ datenquelle: DATENQUELLE, rolle: user?.role });
  const kontext = React.useMemo(() => ({ datenquelle: DATENQUELLE, personalZugang: zugang }), [zugang]);
  const [tab, setTab] = useTabParam(ERLAUBT, ERLAUBT[0] ?? STANDARD_PERSONAL_REITER, { alias: PERSONAL_REITER_ALIAS });
  const [hinweisZu, setHinweisZu] = React.useState(hinweisGeschlossen);

  const hinweisSchliessen = () => {
    setHinweisZu(true);
    try { window.localStorage.setItem(HINWEIS_SCHLUESSEL, "1"); } catch { /* storage blocked: closed for this visit only */ }
  };

  // 80-04 Task 5: "Neue Person" öffnet den Reiter Mitarbeitende mit ?neu=1 —
  // per Kopfknopf UND als Palettenaktion (useAktionen); der Titel wird
  // übersetzt übergeben, Personen selbst kommen nie in die Palette (DS-07).
  const staffBereit = Boolean(REITER_KOMPONENTEN.staff?.BEREIT);
  // 80-06 Task 5 (DS-09): der Knopf "Gehälter zeigen" erscheint erst, sobald
  // der Reiter Verträge Gehälter überhaupt zeigen kann.
  const vertraegeBereit = Boolean(REITER_KOMPONENTEN.contracts?.BEREIT);
  const neuePersonOeffnen = React.useCallback(() => {
    navigate({ pathname: "/People", search: bauePersonalLink({ tab: "staff", neu: true }) });
  }, [navigate]);
  const aktionen = React.useMemo(
    () => [{
      id: "neue-person",
      titel: t("Neue Person"),
      beschreibung: t("Mitarbeitende anlegen"),
      aktiv: zugang === "erlaubt" && staffBereit,
      ausfuehren: neuePersonOeffnen,
    }],
    [t, zugang, staffBereit, neuePersonOeffnen],
  );
  useAktionen("/People", aktionen);

  return (
    // 80-06 Task 5 (DS-09): EIN Provider für Kopfknopf, Übersicht und Reiter,
    // damit "Gehälter zeigen" oben denselben Zustand steuert, den die
    // Vertragstabelle/der Gehaltsverlauf unten lesen.
    <GehaltSichtbarkeitProvider>
      <div className={seitenWurzel}>
        <div className="max-w-7xl mx-auto space-y-6">
          <div className="min-w-0 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-3xl font-bold bg-gradient-to-r from-slate-800 via-emerald-700 to-teal-600 bg-clip-text text-transparent flex items-center gap-2">
                <IdCard className="w-7 h-7 text-emerald-600" aria-hidden="true" /> {t("Personal")}
              </h1>
              <p className="text-slate-600 mt-1 dark:text-slate-300">{t("Mitarbeitende, Mitarbeitersuche, Einstellung und Verträge")}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {zugang === "erlaubt" && vertraegeBereit && <GehaelterUmschalten />}
              {zugang === "erlaubt" && staffBereit && (
                <button
                  type="button"
                  onClick={neuePersonOeffnen}
                  className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-2 text-sm font-medium text-white shadow-lg hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                >
                  <UserPlus className="h-4 w-4" aria-hidden="true" /> {t("Neue Person")}
                </button>
              )}
            </div>
          </div>

          {zugang !== "erlaubt" ? (
            <PersonalZugangsHinweis zugang={zugang} />
          ) : (
            <>
              {!hinweisZu && <Datenschutzhinweis onSchliessen={hinweisSchliessen} />}
              {/* 80-10 Task 5/6: Löschlauf und die verschlüsselte .bitpers-Sicherung gehören
                  in den Personal-Kopf, neben dem Datenschutzhinweis — nicht in eine Kachel. */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <PersonalSicherung />
                <LoeschlaufDialog />
              </div>
              <PersonalUebersicht />
              {BEREITE_REITER.length === 0 ? (
                <div data-testid="personal-leer">
                  <EmptyState
                    icon={IdCard}
                    title={t("Personal wird eingerichtet")}
                    description={t("Mitarbeitende, Mitarbeitersuche, Einstellung & Austritt und Verträge kommen als eigene Reiter. Die App funktioniert auch ganz ohne Personaldaten.")}
                    action={null}
                  />
                </div>
              ) : (
                <Tabs value={tab} onValueChange={setTab} activationMode="manual">
                  <TabsList aria-label={t("Bereiche des Personals")} className={LISTE}>
                    {BEREITE_REITER.map((r) => (
                      <TabsTrigger key={r.key} value={r.key} className={AUSLOESER} title={t(r.hinweis)}>{t(r.label)}</TabsTrigger>
                    ))}
                  </TabsList>
                  {BEREITE_REITER.map((r) => {
                    const Komponente = REITER_KOMPONENTEN[r.key].Komponente;
                    return (
                      <TabsContent key={r.key} value={r.key} className={INHALT}>
                        <ModulFehlergrenze key={tab} pfad={"/People?tab=" + tab}><Komponente kontext={kontext} /></ModulFehlergrenze>
                      </TabsContent>
                    );
                  })}
                </Tabs>
              )}
            </>
          )}
        </div>
      </div>
    </GehaltSichtbarkeitProvider>
  );
}
