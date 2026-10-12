// Projektcontrolling — fee against effort per project and work stage (phase 81,
// CTRL-01…04, ZEIT-05): traffic light, contribution margin, remaining budget,
// forecast, portfolio, month and cost rates; menu group "Zeit & Honorar" (E-02),
// spans all projects (umfang 'portfolio').
//
// The page is the shell: head with the two switches, the cloud lock (E-03), the
// load error, and one error boundary per tab. Data: the 81/79 collections from
// ONE loader (useZeitHonorar, through src/lib/zeitHonorar/speicher.js), persons
// and cost rates only through the personnel adapter (inside useZeitHonorar,
// empty without access), rule values through useRegelWerte(REGELWERKE), the
// project list from useProject (alleProjekte incl. archived ones, 81-06).
//
// Personal rates vs. office rate (T-81-24): without personnel access the page
// always computes with the office rate (rule zeit_honorar.buerosatz) and says so
// — no person's rate appears anywhere; the tab "Kostensätze" is hidden and
// ?tab=rates falls back to the overview. With access the switch "persönliche
// Sätze | Bürosatz" is visible; until roles & rights (phase 82) everybody with
// personnel access sees personal rates.
//
// In:  ?tab=<key> (German aliases normalised), ?projekt=<id> (project tab).
// Out: the page.

import React, { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { CalendarRange, Coins, FolderKanban, Gauge, LayoutGrid } from "lucide-react";
import { ModulFehlergrenze } from "@core/components/ModulFehlergrenze";
import { useI18n } from "@core/lib/i18n";
import { useProject } from "@core/lib/ProjectContext";
import { useRegelWerte } from "@core/lib/useRegelWerte";
import { useTabParam } from "@core/lib/useTabParam";
import { useZugriff } from "@core/lib/ZugriffContext.jsx";
import { seitenWurzel } from "@core/lib/utils";
import { CONTROLLING_REITER, CONTROLLING_REITER_ALIAS, CONTROLLING_REITER_SCHLUESSEL, CONTROLLING_REITER_STANDARD } from "@/lib/controlling/reiter.js";
import { buerosatz, hauptvertrag, monatsreihe, portfolio } from "@/lib/controlling/controlling.js";
import { REGELWERKE } from "@/lib/settings/regelwerke.js";
import { useZeitHonorar } from "@/components/zeitHonorar/useZeitHonorar.js";
import { CloudSperreKarte, LadeFehlerKarte, TAB_AUSLOESER, TAB_INHALT, TAB_LISTE } from "@/components/zeitHonorar/Huelle.jsx";
import PortfolioTabelle from "@/components/controlling/PortfolioTabelle.jsx";
import ProjektControlling from "@/components/controlling/ProjektControlling.jsx";
import MonatsAnsicht from "@/components/controlling/MonatsAnsicht.jsx";
import KostensatzReiter from "@/components/controlling/KostensatzReiter.jsx";
import { euroText } from "@/components/controlling/zahlen.js";

const Tabs = TabsPrimitive.Root;
const TabsList = TabsPrimitive.List;
const TabsTrigger = TabsPrimitive.Trigger;
const TabsContent = TabsPrimitive.Content;

/** lucide icon per registry name (reiter.js stays import-free). */
const ICONS = { LayoutGrid, FolderKanban, CalendarRange, Coins };

/** Tab keys without "rates" (no personnel access) — module constant for useTabParam. */
const SCHLUESSEL_OHNE_SAETZE = Object.freeze(CONTROLLING_REITER_SCHLUESSEL.filter((k) => k !== "rates"));

/** Fills {key} placeholders after translation. */
const fuellen = (/** @type {string} */ text, /** @type {Record<string, any>} */ werte) => text.replace(/\{(\w+)\}/g, (_, k) => String(werte[k] ?? ""));

export default function Controlling() {
  const { t, lang } = useI18n();
  const zh = useZeitHonorar();
  const ctx = /** @type {any} */ (useProject());
  const { wert } = useRegelWerte(REGELWERKE);
  // 82-02: person rates only with the right kostensatz — otherwise (project lead) the
  // existing 81-05 path: office rate, no values per person, no "Kostensätze" tab.
  const zugriff = useZugriff();
  const zugang = zh.personal.zugang === "erlaubt" && zugriff.darf("kostensatz");
  // While loading, access is not known yet: keep every key, otherwise useTabParam would
  // rewrite ?tab=rates to the overview before the personnel data arrived.
  const erlaubt = useMemo(() => (zugang || zh.laedt ? CONTROLLING_REITER_SCHLUESSEL : SCHLUESSEL_OHNE_SAETZE), [zugang, zh.laedt]);
  const [tab, setTab] = useTabParam(erlaubt, CONTROLLING_REITER_STANDARD, { alias: CONTROLLING_REITER_ALIAS });
  const [params, setParams] = useSearchParams();
  const [satzWahl, setSatzWahl] = useState(/** @type {'persoenlich'|'buero'} */ ("persoenlich"));
  const [nurFreigegeben, setNurFreigegeben] = useState(false);

  const satzModus = zugang ? satzWahl : "buero";
  const projekte = /** @type {any[]} */ (ctx.alleProjekte ?? ctx.projects ?? []);
  const projektId = params.get("projekt") || zh.projectId || null;
  const regeln = useMemo(() => ({
    ampel_gelb: Number(wert("zeit_honorar.ampel_gelb") ?? 0),
    ampel_rot: Number(wert("zeit_honorar.ampel_rot") ?? 10),
    buerosatz: typeof wert("zeit_honorar.buerosatz") === "number" ? wert("zeit_honorar.buerosatz") : null,
  }), [wert]);
  // Personal records only with access; the core then never sees a person's rate.
  const kostensaetze = zugang ? zh.personal.kostensaetze : [];
  const mitarbeiter = zugang ? zh.personal.mitarbeiter : [];
  const einstellung = useMemo(() => ({ satzModus, nurFreigegeben, stichtagIso: zh.heute }), [satzModus, nurFreigegeben, zh.heute]);
  const d = zh.daten;

  const reihen = useMemo(() => portfolio(projekte, {
    vertraege: d.Honorarvertrag || [], nachtraege: d.Honorarnachtrag || [], hoaiPlaene: d.HoaiPlan || [], buchungen: d.Zeitbuchung || [],
    kostensaetze, mitarbeiter, angebote: d.Honorarangebot || [], regeln,
  }, einstellung), [projekte, d, kostensaetze, mitarbeiter, regeln, einstellung]);
  const reihe = reihen.find((r) => r.project_id === projektId) || null;
  const buero = buerosatz(kostensaetze, mitarbeiter, zh.heute, regeln.buerosatz);

  const monate = useMemo(() => {
    if (!projektId) return [];
    const vertrag = hauptvertrag((d.Honorarvertrag || []).filter((v) => v.project_id === projektId));
    return monatsreihe({
      hoaiPlan: (d.HoaiPlan || []).find((h) => h.project_id === projektId) || null, vertrag, nachtraege: d.Honorarnachtrag || [],
      buchungen: (d.Zeitbuchung || []).filter((b) => b.project_id === projektId), kostensaetze, mitarbeiter, rechnungen: d.Ausgangsrechnung || [], regeln,
    }, einstellung);
  }, [projektId, d, kostensaetze, mitarbeiter, regeln, einstellung]);
  const hatVerlauf = Array.isArray((d.HoaiPlan || []).find((h) => h.project_id === projektId)?.verlauf) && ((d.HoaiPlan || []).find((h) => h.project_id === projektId)?.verlauf?.length ?? 0) > 0;
  const projektName = projekte.find((p) => p.id === projektId)?.name || reihe?.name || "";
  // The picker lists every project with data plus the selected one.
  const waehlbar = useMemo(() => {
    const ids = new Set([...reihen.map((r) => r.project_id), ...(projektId ? [projektId] : [])]);
    return [...ids].map((id) => ({ id, name: projekte.find((p) => p.id === id)?.name || reihen.find((r) => r.project_id === id)?.name || id }));
  }, [reihen, projektId, projekte]);

  /** @param {string} id */
  const waehleProjekt = (id) => {
    const neu = new URLSearchParams(params);
    if (id) neu.set("projekt", id); else neu.delete("projekt");
    neu.set("tab", tab === "overview" ? "project" : tab);
    setParams(neu);
  };

  return (
    <div className={seitenWurzel}>
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-slate-800 via-emerald-700 to-teal-600 bg-clip-text text-transparent flex items-center gap-2">
            <Gauge className="w-7 h-7 text-emerald-600" aria-hidden="true" /> {t("Projektcontrolling")}
          </h1>
          <p className="text-slate-600 mt-1 dark:text-slate-300">{t("Honorar gegen Aufwand je Projekt und Leistungsphase")}</p>
        </div>

        {!zh.verfuegbar ? (
          <CloudSperreKarte />
        ) : zh.fehler ? (
          <LadeFehlerKarte fehler={zh.fehler} onRetry={() => zh.neuLaden()} />
        ) : (
          <>
            {zh.laedt && <p role="status" className="text-sm text-slate-600 dark:text-slate-300">{t("Controlling wird geladen …")}</p>}
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700" data-testid="controlling-kopf">
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={nurFreigegeben} onChange={(e) => setNurFreigegeben(e.target.checked)} data-testid="nur-freigegeben" />
                {t("nur freigegebene Buchungen")}
              </label>
              {zugang ? (
                <div role="radiogroup" aria-label={t("Kostensätze")} className="inline-flex items-center gap-1 rounded-md bg-slate-100 p-0.5 dark:bg-slate-800">
                  {["persoenlich", "buero"].map((k) => (
                    <button key={k} type="button" role="radio" aria-checked={satzWahl === k} onClick={() => setSatzWahl(/** @type {any} */ (k))} data-testid={`satz-${k}`}
                      className={`rounded px-2 py-0.5 ${satzWahl === k ? "bg-white shadow dark:bg-slate-900" : ""}`}>
                      {k === "persoenlich" ? t("persönliche Sätze") : t("Bürosatz")}
                    </button>
                  ))}
                </div>
              ) : null}
              <p className="text-xs text-slate-600 dark:text-slate-300" data-testid="satz-hinweis">
                {satzModus === "buero"
                  ? (buero ? fuellen(t("kalkuliert mit Bürosatz {satz}/h"), { satz: euroText(buero.satz, lang) }) : t("Kein Bürosatz: in den Regelwerken „Bürosatz“ eintragen."))
                  : t("kalkuliert mit persönlichen Kostensätzen")}
                {" · "}
                {zugang ? t("Bis Rollen & Rechte (Phase 82) für alle mit Personal-Zugang sichtbar") : t("Persönliche Kostensätze nur mit Personal-Zugang")}
              </p>
            </div>
            <Tabs value={tab} onValueChange={setTab} activationMode="manual">
              <TabsList aria-label={t("Bereiche des Projektcontrollings")} className={TAB_LISTE}>
                {CONTROLLING_REITER.filter((r) => erlaubt.includes(r.key)).map((r) => {
                  const Icon = /** @type {Record<string, any>} */ (ICONS)[r.icon];
                  return (
                    <TabsTrigger key={r.key} value={r.key} className={TAB_AUSLOESER}>
                      {Icon && <Icon className="h-4 w-4" aria-hidden="true" />} {t(r.label)}
                    </TabsTrigger>
                  );
                })}
              </TabsList>
              <TabsContent value="overview" className={TAB_INHALT}>
                <ModulFehlergrenze key={tab} pfad={"/Controlling?tab=" + tab}>
                  <PortfolioTabelle reihen={reihen} onWaehle={waehleProjekt} />
                </ModulFehlergrenze>
              </TabsContent>
              <TabsContent value="project" className={TAB_INHALT}>
                <ModulFehlergrenze key={tab} pfad={"/Controlling?tab=" + tab}>
                  <ProjektControlling reihe={reihe} projekte={waehlbar} projektId={projektId} onProjekt={waehleProjekt}
                    nachtraege={d.Honorarnachtrag || []} personen={mitarbeiter} ratesSichtbar={zugang} onRates={() => setTab("rates")} />
                </ModulFehlergrenze>
              </TabsContent>
              <TabsContent value="month" className={TAB_INHALT}>
                <ModulFehlergrenze key={tab} pfad={"/Controlling?tab=" + tab}>
                  {projektId ? <MonatsAnsicht reihe={monate} projektName={projektName} hatVerlauf={hatVerlauf} /> : <p className="text-sm text-slate-600 dark:text-slate-300">{t("Projekt wählen")}</p>}
                </ModulFehlergrenze>
              </TabsContent>
              {zugang && (
                <TabsContent value="rates" className={TAB_INHALT}>
                  <ModulFehlergrenze key={tab} pfad={"/Controlling?tab=" + tab}>
                    <KostensatzReiter zh={zh} wert={wert} />
                  </ModulFehlergrenze>
                </TabsContent>
              )}
            </Tabs>
          </>
        )}
      </div>
    </div>
  );
}
