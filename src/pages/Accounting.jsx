// Accounting — the office books of an architecture firm (phase 79): outgoing and
// incoming invoices, year clock, VAT, drawings, bank reconciliation, fleet,
// fixed assets and the annual summary as nine ?tab= tabs (E-01), in the menu
// group "Büro" (E-02). Portfolio-wide, usable without an active project.
//
// The page is only the shell: head, notices, the cloud lock (E-03), the
// situation bar and export slots, and one error boundary per tab so a broken
// import in one area does not take the others down. The data comes from ONE
// loader (useBuchhaltung) because Radix unmounts inactive tabs.
//
// Tabs use the Radix primitives directly: the shadcn wrappers in
// @core/components/ui/tabs.jsx cost one tsc error per element under the current
// React typing. `activationMode="manual"`: arrow keys move the focus without
// switching (and without a history entry per key press, NB-14).
//
// In:  ?tab=<key> (German aliases are normalised). Out: the page.

import { seitenWurzel } from "@core/lib/utils";
import React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import {
  ArrowLeftRight, Car, Clock, CloudOff, FileInput, FileOutput, HandCoins, Landmark, Package, Percent, Scale, Settings,
} from "lucide-react";
import { buttonVariants } from "@core/components/ui/button";
import { ModulFehlergrenze } from "@core/components/ModulFehlergrenze";
import { useI18n } from "@core/lib/i18n";
import { useTabParam } from "@core/lib/useTabParam";
import { IST_LOKAL } from "@core/lib/umgebung";
import { BUCHHALTUNG_REITER, REITER_ALIAS, REITER_SCHLUESSEL, STANDARD_REITER } from "@/lib/accounting/reiter.js";
import { useBuchhaltung } from "@/components/accounting/useBuchhaltung.js";
import AusgangsrechnungenReiter from "@/components/accounting/AusgangsrechnungenReiter.jsx";
import AusgabenReiter from "@/components/accounting/AusgabenReiter.jsx";
import LiquiditaetReiter from "@/components/accounting/LiquiditaetReiter.jsx";
import UmsatzsteuerReiter from "@/components/accounting/UmsatzsteuerReiter.jsx";
import EntnahmenReiter from "@/components/accounting/EntnahmenReiter.jsx";
import BankReiter from "@/components/accounting/BankReiter.jsx";
import FuhrparkReiter from "@/components/accounting/FuhrparkReiter.jsx";
import AnlagenReiter from "@/components/accounting/AnlagenReiter.jsx";
import JahresuebersichtReiter from "@/components/accounting/JahresuebersichtReiter.jsx";
import LageLeiste from "@/components/accounting/LageLeiste.jsx";
import ExportMenue from "@/components/accounting/ExportMenue.jsx";
import RichtwertHinweis from "@/components/accounting/gemeinsam/RichtwertHinweis.jsx";
import EinstellungenDialog from "@/components/accounting/gemeinsam/EinstellungenDialog.jsx";

const Tabs = TabsPrimitive.Root;
const TabsList = TabsPrimitive.List;
const TabsTrigger = TabsPrimitive.Trigger;
const TabsContent = TabsPrimitive.Content;

// Class strings of the shadcn tab parts (ui/tabs.jsx), applied to the primitives.
const LISTE = "flex flex-wrap h-auto gap-1 items-center rounded-lg bg-slate-100 p-1 text-muted-foreground dark:bg-slate-800";
const AUSLOESER = "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium text-slate-700 ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow dark:text-slate-200";
const INHALT = "pt-4 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

/** lucide icon per registry name (reiter.js stays import-free). */
const ICONS = { FileOutput, FileInput, Clock, Percent, HandCoins, ArrowLeftRight, Car, Package, Scale };

/**
 * Backup nudge of the client build: the books live only in this browser.
 * Same rule as the header status (demoDb.sicherungFaellig, 69-07).
 * @returns {React.ReactElement|null}
 */
function Sicherungshinweis() {
  const { t } = useI18n();
  const [faellig, setFaellig] = React.useState(false);
  React.useEffect(() => {
    let aktiv = true;
    import("@core/api/demoDb").then(async ({ demoDbAuslesen, letzteSicherungLesen, sicherungFaellig }) => {
      const daten = await demoDbAuslesen();
      let anzahl = 0;
      for (const rows of Object.values(daten)) if (Array.isArray(rows)) anzahl += rows.length;
      const ja = sicherungFaellig(await letzteSicherungLesen(), anzahl);
      if (aktiv) setFaellig(ja);
    }).catch(() => { /* no storage, nothing to back up */ });
    return () => { aktiv = false; };
  }, []);
  return (
    <p className={`text-sm ${faellig ? "font-medium text-amber-800 dark:text-amber-200" : "text-slate-600 dark:text-slate-300"}`}>
      {t("Die Bücher liegen nur in diesem Browser — sichern Sie regelmäßig über „Projekt sichern (.bitproj)“.")}
    </p>
  );
}

export default function Accounting() {
  const { t } = useI18n();
  const bh = useBuchhaltung();
  const [tab, setTab] = useTabParam(REITER_SCHLUESSEL, STANDARD_REITER, { alias: REITER_ALIAS });
  const [einstellungenOffen, setEinstellungenOffen] = React.useState(false);

  return (
    <div className={seitenWurzel}>
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div className="min-w-0">
            <h1 className="text-3xl font-bold bg-gradient-to-r from-slate-800 via-emerald-700 to-teal-600 bg-clip-text text-transparent flex items-center gap-2">
              <Landmark className="w-7 h-7 text-emerald-600" aria-hidden="true" /> {t("Buchhaltung")}
            </h1>
            <p className="text-slate-600 mt-1 dark:text-slate-300">{t("Rechnungen · Liquidität · Steuern · Jahresabschluss")}</p>
          </div>
          {bh.verfuegbar && (
            <div className="flex flex-wrap items-center gap-2">
              <ExportMenue bh={bh} />
              <button type="button" className={buttonVariants({ variant: "outline" })} onClick={() => setEinstellungenOffen(true)}>
                <Settings aria-hidden="true" /> {t("Einstellungen")}
              </button>
            </div>
          )}
        </div>

        <div className="space-y-1">
          <RichtwertHinweis />
          {IST_LOKAL && bh.verfuegbar && <Sicherungshinweis />}
        </div>

        {!bh.verfuegbar ? (
          <div role="status" data-testid="buchhaltung-cloud-sperre"
            className="rounded-xl border border-slate-200 bg-white p-6 space-y-2 dark:border-slate-700 dark:bg-slate-900">
            <p className="flex items-center gap-2 font-medium text-slate-800 dark:text-slate-100">
              <CloudOff className="h-5 w-5 text-slate-500" aria-hidden="true" /> {t("Die Buchhaltung ist in der Cloud-Version noch gesperrt.")}
            </p>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {t("Bis die Zugriffsrechte je Organisation fertig sind, sähen alle Mitglieder einer Organisation dieselben Bücher. Nutzen Sie bis dahin die lokale Version oder die Demo.")}
            </p>
          </div>
        ) : bh.fehler ? (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-6 space-y-3 dark:border-red-800 dark:bg-red-950">
            <p className="font-medium text-red-800 dark:text-red-200">{t("Die Buchhaltung konnte nicht geladen werden")}</p>
            <p className="text-sm text-red-700 dark:text-red-300">{bh.fehler}</p>
            <button type="button" className={buttonVariants({ variant: "outline" })} onClick={() => bh.neuLaden()}>
              {t("Erneut versuchen")}
            </button>
          </div>
        ) : (
          <>
            <LageLeiste bh={bh} />
            {bh.laedt && <p role="status" className="text-sm text-slate-600 dark:text-slate-300">{t("Buchhaltung wird geladen …")}</p>}
            <Tabs value={tab} onValueChange={setTab} activationMode="manual">
              <TabsList aria-label={t("Bereiche der Buchhaltung")} className={LISTE}>
                {BUCHHALTUNG_REITER.map((r) => {
                  const Icon = /** @type {Record<string, any>} */ (ICONS)[r.icon];
                  return (
                    <TabsTrigger key={r.key} value={r.key} className={AUSLOESER}>
                      {Icon && <Icon className="h-4 w-4" aria-hidden="true" />} {t(r.label)}
                    </TabsTrigger>
                  );
                })}
              </TabsList>
              <TabsContent value="invoices" className={INHALT}>
                <ModulFehlergrenze key={tab} pfad={"/Accounting?tab=" + tab}><AusgangsrechnungenReiter bh={bh} /></ModulFehlergrenze>
              </TabsContent>
              <TabsContent value="expenses" className={INHALT}>
                <ModulFehlergrenze key={tab} pfad={"/Accounting?tab=" + tab}><AusgabenReiter bh={bh} /></ModulFehlergrenze>
              </TabsContent>
              <TabsContent value="liquidity" className={INHALT}>
                <ModulFehlergrenze key={tab} pfad={"/Accounting?tab=" + tab}><LiquiditaetReiter bh={bh} /></ModulFehlergrenze>
              </TabsContent>
              <TabsContent value="vat" className={INHALT}>
                <ModulFehlergrenze key={tab} pfad={"/Accounting?tab=" + tab}><UmsatzsteuerReiter bh={bh} /></ModulFehlergrenze>
              </TabsContent>
              <TabsContent value="drawings" className={INHALT}>
                <ModulFehlergrenze key={tab} pfad={"/Accounting?tab=" + tab}><EntnahmenReiter bh={bh} /></ModulFehlergrenze>
              </TabsContent>
              <TabsContent value="bank" className={INHALT}>
                <ModulFehlergrenze key={tab} pfad={"/Accounting?tab=" + tab}><BankReiter bh={bh} /></ModulFehlergrenze>
              </TabsContent>
              <TabsContent value="fleet" className={INHALT}>
                <ModulFehlergrenze key={tab} pfad={"/Accounting?tab=" + tab}><FuhrparkReiter bh={bh} /></ModulFehlergrenze>
              </TabsContent>
              <TabsContent value="assets" className={INHALT}>
                <ModulFehlergrenze key={tab} pfad={"/Accounting?tab=" + tab}><AnlagenReiter bh={bh} /></ModulFehlergrenze>
              </TabsContent>
              <TabsContent value="annual" className={INHALT}>
                <ModulFehlergrenze key={tab} pfad={"/Accounting?tab=" + tab}><JahresuebersichtReiter bh={bh} /></ModulFehlergrenze>
              </TabsContent>
            </Tabs>
          </>
        )}

        {einstellungenOffen && <EinstellungenDialog bh={bh} onClose={() => setEinstellungenOffen(false)} />}
      </div>
    </div>
  );
}
