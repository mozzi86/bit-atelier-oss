// Einstellungen — the one place of all app settings (80-01, KRITIK-05, E-01/E-02):
// nine areas as ?tab= keys (src/lib/settings/bereiche.js), project-free, in the
// menu group "Büro". This plan builds the shell; the areas come from the lane-A
// plans (80-03, 80-05, 80-07) and 80-09/80-10 (templates). An area is a tab only
// when it is visible in this context AND its file says BEREIT — until then only
// "Kataloge" and "System" exist.
//
// Tabs use the Radix primitives directly, like Accounting.jsx: the shadcn wrappers
// in @core/components/ui/tabs.jsx cost one tsc error per element under the current
// React typing (79-01 deviation 3). `activationMode="manual"`: arrow keys move the
// focus without switching and without a history entry per key press (NB-14).
// Vertical from `lg`, horizontal and wrapping below.
//
// In:  ?tab=<key> (German aliases are normalised). Out: the page.

import React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { Settings as Zahnrad } from "lucide-react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { seitenWurzel } from "@core/lib/utils";
import { ModulFehlergrenze } from "@core/components/ModulFehlergrenze";
import { useAuth } from "@core/lib/AuthContext";
import { useI18n } from "@core/lib/i18n";
import { useTabParam } from "@core/lib/useTabParam";
import { BUERO_CLOUD_FREIGABE, DATENQUELLE } from "@core/lib/umgebung";
import { EINSTELLUNGS_ALIAS, EINSTELLUNGS_REITER, sichtbareBereiche } from "@/lib/settings/bereiche.js";
import { personalZugang } from "@/lib/people/zugang.js";
import { BEREICH_KOMPONENTEN } from "@/components/settings/index.js";
import EinstellungsSuche from "@/components/settings/EinstellungsSuche.jsx";

const Tabs = TabsPrimitive.Root;
const TabsList = TabsPrimitive.List;
const TabsTrigger = TabsPrimitive.Trigger;
const TabsContent = TabsPrimitive.Content;

// Class strings of the shadcn tab parts (ui/tabs.jsx), as in Accounting.jsx, plus the vertical list from lg.
const LISTE = "flex flex-wrap h-auto gap-1 items-center rounded-lg bg-slate-100 p-1 text-muted-foreground dark:bg-slate-800 lg:w-60 lg:shrink-0 lg:flex-col lg:flex-nowrap lg:items-stretch";
const AUSLOESER = "inline-flex items-center justify-start gap-2 whitespace-normal rounded-md px-3 py-1.5 text-left text-sm font-medium text-slate-700 ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow dark:text-slate-200";
const INHALT = "min-w-0 flex-1 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

/** Breakpoint of the vertical tab list (Tailwind `lg`). */
const BREIT = "(min-width: 1024px)";

/**
 * True from the `lg` breakpoint on; follows window resizes. Radix needs the
 * orientation as a prop (arrow keys up/down vs. left/right), CSS alone cannot say it.
 * @returns {boolean}
 */
function useBreit() {
  const [breit, setBreit] = React.useState(() => {
    try { return window.matchMedia(BREIT).matches; } catch { return false; }
  });
  React.useEffect(() => {
    /** @type {MediaQueryList|null} */
    let abfrage = null;
    try { abfrage = window.matchMedia(BREIT); } catch { return undefined; }
    const beiWechsel = () => setBreit(Boolean(abfrage?.matches));
    abfrage.addEventListener("change", beiWechsel);
    return () => abfrage?.removeEventListener("change", beiWechsel);
  }, []);
  return breit;
}

export default function Settings() {
  const { t } = useI18n();
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [suchParams] = useSearchParams();
  // 80-03 task 6: a rule-book jump ("?tab=rules&einstellung=<id>") — RegelwerkBereich
  // (80-07) reads this prop, every other area ignores it.
  const fokusId = suchParams.get("einstellung");
  const zugang = personalZugang({ datenquelle: DATENQUELLE, rolle: user?.role });
  const kontext = React.useMemo(() => ({ datenquelle: DATENQUELLE, personalZugang: zugang, buchhaltungCloud: BUERO_CLOUD_FREIGABE }), [zugang]);
  // visible ∩ ready, in registry order.
  const bereiche = React.useMemo(() => sichtbareBereiche(kontext).filter((b) => BEREICH_KOMPONENTEN[b.key]?.BEREIT), [kontext]);
  const erlaubt = React.useMemo(() => bereiche.map((b) => b.key), [bereiche]);
  const [tab, setTab] = useTabParam(erlaubt, erlaubt[0] ?? EINSTELLUNGS_REITER[0], { alias: EINSTELLUNGS_ALIAS });
  const breit = useBreit();

  // 80-03 task 6, behavior 16: after a jump from EinstellungsSuche (marked by
  // location.state.sprung) the first focusable control of the now-active tab
  // panel gets the focus — a plain click on a TabsTrigger needs none of this,
  // Radix's roving tab-list focus already handles that case. The marker is
  // cleared right away (replace, no state) so Back/Forward do not refire it.
  React.useEffect(() => {
    if (!location.state?.sprung) return;
    const ziel = /** @type {HTMLElement|null} */ (document.querySelector(
      '[role="tabpanel"]:not([hidden]) input, [role="tabpanel"]:not([hidden]) textarea, '
      + '[role="tabpanel"]:not([hidden]) select, [role="tabpanel"]:not([hidden]) button, '
      + '[role="tabpanel"]:not([hidden]) a[href]',
    ));
    ziel?.focus();
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per jump+render, not per navigate identity
  }, [location, tab]);

  return (
    <div className={seitenWurzel}>
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-slate-800 via-emerald-700 to-teal-600 bg-clip-text text-transparent flex items-center gap-2">
            <Zahnrad className="w-7 h-7 text-emerald-600" aria-hidden="true" /> {t("Einstellungen")}
          </h1>
          <p className="text-slate-600 mt-1 dark:text-slate-300">{t("Alle Einstellungen der App an einem Ort")}</p>
        </div>

        <EinstellungsSuche kontext={kontext} />

        <Tabs value={tab} onValueChange={setTab} activationMode="manual" orientation={breit ? "vertical" : "horizontal"}
          className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <TabsList aria-label={t("Bereiche der Einstellungen")} className={LISTE}>
            {bereiche.map((b) => (
              <TabsTrigger key={b.key} value={b.key} className={AUSLOESER}>{t(b.titel)}</TabsTrigger>
            ))}
          </TabsList>
          {bereiche.map((b) => {
            // BEREICH_KOMPONENTEN types every area as {kontext?: any} only (80-01,
            // src/components/settings/index.js — not touched by this plan); fokusId
            // is a NEW, optional prop only RegelwerkBereich (80-07) reads, so the cast
            // is local to this call instead of widening that shared registry type.
            const Komponente = /** @type {(props: {kontext?: any, fokusId?: string|null}) => any} */ (BEREICH_KOMPONENTEN[b.key].Komponente);
            return (
              <TabsContent key={b.key} value={b.key} className={INHALT}>
                <ModulFehlergrenze key={tab} pfad={"/Settings?tab=" + tab}><Komponente kontext={kontext} fokusId={fokusId} /></ModulFehlergrenze>
              </TabsContent>
            );
          })}
        </Tabs>
      </div>
    </div>
  );
}
