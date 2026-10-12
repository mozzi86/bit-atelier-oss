// Angebot & Auftrag — the fee chain of the office (phase 81, HON-01…07): fee
// offers after HOAI 2021, architect's contracts with stages and confirmation,
// fee amendments and the one HOAI calculator; menu group "Zeit & Honorar" (E-02).
// Works on the active project with an "Alle Projekte" switch (Finance pattern).
//
// The page is the shell: head, the cloud lock (E-03), the load error, and one
// error boundary per tab; the data comes from ONE loader (useZeitHonorar).
// 81-01 builds the shell; 81-03 fills offers and calculator, 81-04 contracts,
// amendments and "Annehmen" of a sent offer (AngebotAnnehmen in the offer list).
//
// In:  ?tab=<key> (German aliases are normalised, src/lib/honorar/reiter.js);
//      ?neu=1 (optional &projekt=<id>) opens the offer wizard — the fee
//      calculator hands its fields over in the router state (`vorschlag`).
// Out: the page.

import React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { useLocation, useSearchParams } from "react-router-dom";
import { Calculator, FileCheck2, FilePlus2, FileSignature, Handshake } from "lucide-react";
import { ModulFehlergrenze } from "@core/components/ModulFehlergrenze";
import { buttonVariants } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { useTabParam } from "@core/lib/useTabParam";
import { useErlaubteReiter, useZugriff } from "@core/lib/ZugriffContext.jsx";
import { useRegelWerte } from "@core/lib/useRegelWerte";
import { REGELWERKE } from "@/lib/settings/regelwerke.js";
import { seitenWurzel } from "@core/lib/utils";
import { HONORAR_REITER, HONORAR_REITER_ALIAS, HONORAR_REITER_SCHLUESSEL, HONORAR_REITER_STANDARD } from "@/lib/honorar/reiter.js";
import { useZeitHonorar } from "@/components/zeitHonorar/useZeitHonorar.js";
import { CloudSperreKarte, LadeFehlerKarte, TAB_AUSLOESER, TAB_INHALT, TAB_LISTE } from "@/components/zeitHonorar/Huelle.jsx";
import AngebotListe from "@/components/honorar/AngebotListe.jsx";
import AngebotAssistent from "@/components/honorar/AngebotAssistent.jsx";
import HonorarRechner from "@/components/honorar/HonorarRechner.jsx";
import AngebotAnnehmen from "@/components/honorar/AngebotAnnehmen.jsx";
import VertragReiter from "@/components/honorar/VertragReiter.jsx";
import NachtragReiter from "@/components/honorar/NachtragReiter.jsx";

const Tabs = TabsPrimitive.Root;
const TabsList = TabsPrimitive.List;
const TabsTrigger = TabsPrimitive.Trigger;
const TabsContent = TabsPrimitive.Content;

/** lucide icon per registry name (reiter.js stays import-free). */
const ICONS = { FileSignature, FileCheck2, FilePlus2, Calculator };

export default function Fees() {
  const { t } = useI18n();
  const zh = useZeitHonorar();
  // 82-02: module auftrag; level 'lesen' (e.g. Buchhaltung) → native read-only frame, no change in the tab files.
  const zugriff = useZugriff();
  const nurLesen = !zugriff.darf("auftrag", "voll");
  const erlaubt = useErlaubteReiter("auftrag", HONORAR_REITER_SCHLUESSEL);
  const [tab, setTab] = useTabParam(erlaubt, HONORAR_REITER_STANDARD, { alias: HONORAR_REITER_ALIAS });
  const [alleProjekte, setAlleProjekte] = React.useState(false);
  const { wert } = useRegelWerte(REGELWERKE);
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const [assistent, setAssistent] = React.useState(/** @type {{projekt: string|null, vorschlag: any}|null} */ (null));

  // ?neu=1 opens the wizard once and is then removed from the URL (a reload must not reopen it).
  React.useEffect(() => {
    if (params.get("neu") !== "1" || !zh.verfuegbar || zh.laedt) return;
    setAssistent({ projekt: params.get("projekt"), vorschlag: /** @type {any} */ (location.state)?.vorschlag ?? null });
    setParams((p) => { const n = new URLSearchParams(p); n.delete("neu"); n.delete("projekt"); return n; }, { replace: true });
  }, [params, setParams, location.state, zh.verfuegbar, zh.laedt]);

  return (
    <div className={seitenWurzel}>
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div className="min-w-0">
            <h1 className="text-3xl font-bold bg-gradient-to-r from-slate-800 via-emerald-700 to-teal-600 bg-clip-text text-transparent flex items-center gap-2">
              <Handshake className="w-7 h-7 text-emerald-600" aria-hidden="true" /> {t("Angebot & Auftrag")}
            </h1>
            <p className="text-slate-600 mt-1 dark:text-slate-300">{t("Honorarangebot · Architektenvertrag · Honorarnachtrag — nach HOAI 2021")}</p>
          </div>
          {zh.verfuegbar && !nurLesen && (
            <button
              type="button"
              aria-pressed={alleProjekte}
              onClick={() => setAlleProjekte((v) => !v)}
              className={buttonVariants({ variant: alleProjekte ? "secondary" : "outline" })}
            >
              {t("Alle Projekte")}
            </button>
          )}
        </div>

        {!zh.verfuegbar ? (
          <CloudSperreKarte />
        ) : zh.fehler ? (
          <LadeFehlerKarte fehler={zh.fehler} onRetry={() => zh.neuLaden()} />
        ) : (
          <>
            {zh.laedt && <p role="status" className="text-sm text-slate-600 dark:text-slate-300">{t("Honorardaten werden geladen …")}</p>}
            <Tabs value={tab} onValueChange={setTab} activationMode="manual">
              <TabsList aria-label={t("Bereiche von Angebot & Auftrag")} className={TAB_LISTE}>
                {HONORAR_REITER.map((r) => {
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
              <TabsContent value="offers" className={TAB_INHALT}>
                <ModulFehlergrenze key={tab} pfad={"/Fees?tab=" + tab}>
                  <AngebotListe zh={zh} alleProjekte={alleProjekte} onNeu={() => setAssistent({ projekt: zh.projectId, vorschlag: null })}
                    aktionen={(a) => <AngebotAnnehmen zh={zh} wert={wert} angebot={a} />} />
                </ModulFehlergrenze>
              </TabsContent>
              <TabsContent value="contracts" className={TAB_INHALT}>
                <ModulFehlergrenze key={tab} pfad={"/Fees?tab=" + tab}><VertragReiter zh={zh} wert={wert} alleProjekte={alleProjekte} /></ModulFehlergrenze>
              </TabsContent>
              <TabsContent value="amendments" className={TAB_INHALT}>
                <ModulFehlergrenze key={tab} pfad={"/Fees?tab=" + tab}><NachtragReiter zh={zh} wert={wert} alleProjekte={alleProjekte} /></ModulFehlergrenze>
              </TabsContent>
              <TabsContent value="calculator" className={TAB_INHALT}>
                <ModulFehlergrenze key={tab} pfad={"/Fees?tab=" + tab}><HonorarRechner /></ModulFehlergrenze>
              </TabsContent>
              </fieldset>
            </Tabs>
            {assistent && <AngebotAssistent zh={zh} wert={wert} projektVorwahl={assistent.projekt} vorschlag={assistent.vorschlag} onClose={() => setAssistent(null)} />}
          </>
        )}
      </div>
    </div>
  );
}
