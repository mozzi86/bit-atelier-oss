// Zeiterfassung — project hours per person, project and work stage (phase 81,
// ZEIT-01…06), in the menu group "Zeit & Honorar" (E-02). Usable without an
// active project; a sole proprietor without any personnel record books as the
// virtual owner (E-17).
//
// The page is the shell: head, the cloud lock (E-03), the load error, the
// selector "Stunden für" and one error boundary per tab. The data comes from ONE
// loader (useZeitHonorar) because Radix unmounts inactive tabs; the person, the
// rule values and the booking writer from useZeiterfassung (81-02).
//
// In:  ?tab=<key> (German aliases are normalised, src/lib/zeit/reiter.js). Out: the page.

import React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { CalendarDays, CheckCheck, Download, Sun, Timer } from "lucide-react";
import { ModulFehlergrenze } from "@core/components/ModulFehlergrenze";
import { useI18n } from "@core/lib/i18n";
import { useTabParam } from "@core/lib/useTabParam";
import { useErlaubteReiter, useZugriff } from "@core/lib/ZugriffContext.jsx";
import { seitenWurzel } from "@core/lib/utils";
import { ZEIT_REITER, ZEIT_REITER_ALIAS, ZEIT_REITER_SCHLUESSEL, ZEIT_REITER_STANDARD } from "@/lib/zeit/reiter.js";
import { useZeitHonorar } from "@/components/zeitHonorar/useZeitHonorar.js";
import { CloudSperreKarte, LadeFehlerKarte, TAB_AUSLOESER, TAB_INHALT, TAB_LISTE } from "@/components/zeitHonorar/Huelle.jsx";
import { useZeiterfassung } from "@/components/zeit/useZeiterfassung.js";
import MitarbeiterWahl from "@/components/zeit/MitarbeiterWahl.jsx";
import WochenRaster from "@/components/zeit/WochenRaster.jsx";
import TagesAnsicht from "@/components/zeit/TagesAnsicht.jsx";
import FreigabeListe from "@/components/zeit/FreigabeListe.jsx";
import ExportReiter from "@/components/zeit/ExportReiter.jsx";

const Tabs = TabsPrimitive.Root;
const TabsList = TabsPrimitive.List;
const TabsTrigger = TabsPrimitive.Trigger;
const TabsContent = TabsPrimitive.Content;

/** lucide icon per registry name (reiter.js stays import-free). */
const ICONS = { CalendarDays, Sun, CheckCheck, Download };

/** Tab → own right (82-02). */
const REITER_RECHTE = Object.freeze({ approval: "zeiterfassung:freigabe", export: "zeiterfassung:freigabe" });

export default function TimeTracking() {
  const { t } = useI18n();
  const zh = useZeitHonorar();
  const zz = useZeiterfassung(zh);
  // 82-02: tab rights — approval and export need the sub-right zeiterfassung:freigabe
  // (matrix in rechte.js, 82-RESEARCH); level 'lesen' → read-only frame around the tab contents.
  const zugriff = useZugriff();
  const erlaubt = useErlaubteReiter("zeiterfassung", ZEIT_REITER_SCHLUESSEL, REITER_RECHTE);
  const nurLesen = !zugriff.darf("zeiterfassung", "voll");
  const [tab, setTab] = useTabParam(erlaubt, ZEIT_REITER_STANDARD, { alias: ZEIT_REITER_ALIAS });

  return (
    <div className={seitenWurzel}>
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-slate-800 via-emerald-700 to-teal-600 bg-clip-text text-transparent flex items-center gap-2">
            <Timer className="w-7 h-7 text-emerald-600" aria-hidden="true" /> {t("Zeiterfassung")}
          </h1>
          <p className="text-slate-600 mt-1 dark:text-slate-300">{t("Projektzeiten und Tagesrahmen — Hinweise ersetzen keine Rechtsprüfung")}</p>
        </div>

        {!zh.verfuegbar ? (
          <CloudSperreKarte />
        ) : zh.fehler ? (
          <LadeFehlerKarte fehler={zh.fehler} onRetry={() => zh.neuLaden()} />
        ) : (
          <>
            {zh.laedt && <p role="status" className="text-sm text-slate-600 dark:text-slate-300">{t("Zeiten werden geladen …")}</p>}
            <MitarbeiterWahl zh={zh} zz={zz} />
            <Tabs value={tab} onValueChange={setTab} activationMode="manual">
              <TabsList aria-label={t("Bereiche der Zeiterfassung")} className={TAB_LISTE}>
                {ZEIT_REITER.filter((r) => erlaubt.includes(r.key)).map((r) => {
                  const Icon = /** @type {Record<string, any>} */ (ICONS)[r.icon];
                  return (
                    <TabsTrigger key={r.key} value={r.key} className={TAB_AUSLOESER}>
                      {Icon && <Icon className="h-4 w-4" aria-hidden="true" />} {t(r.label)}
                    </TabsTrigger>
                  );
                })}
              </TabsList>
              {nurLesen && <p role="status" className="text-xs text-amber-800 dark:text-amber-200" data-testid="nur-lesen">{t("Nur lesen — Ihre Rolle darf hier nichts ändern.")}</p>}
              <fieldset disabled={nurLesen} className="contents">
              <TabsContent value="week" className={TAB_INHALT}>
                <ModulFehlergrenze key={tab} pfad={"/TimeTracking?tab=" + tab}><WochenRaster zh={zh} zz={zz} /></ModulFehlergrenze>
              </TabsContent>
              <TabsContent value="day" className={TAB_INHALT}>
                <ModulFehlergrenze key={tab} pfad={"/TimeTracking?tab=" + tab}><TagesAnsicht zh={zh} zz={zz} /></ModulFehlergrenze>
              </TabsContent>
              <TabsContent value="approval" className={TAB_INHALT}>
                <ModulFehlergrenze key={tab} pfad={"/TimeTracking?tab=" + tab}><FreigabeListe zh={zh} zz={zz} /></ModulFehlergrenze>
              </TabsContent>
              <TabsContent value="export" className={TAB_INHALT}>
                <ModulFehlergrenze key={tab} pfad={"/TimeTracking?tab=" + tab}><ExportReiter zh={zh} zz={zz} /></ModulFehlergrenze>
              </TabsContent>
              </fieldset>
            </Tabs>
          </>
        )}
      </div>
    </div>
  );
}
