// 91-02: ONE source for the rainwater figures shown in the drainage planner, the garage overlay and
// the cellar (Werkstatt) — every caller computes regenwasserNutzung() from the same inputs, so the
// cistern volume and the services room never differ between tabs:
//   - nutzung part of entwaesserung_layer (stored settings, default active — user brief 10.10.2026)
//   - footprint area + roof form (usePlanModel), storeys + storey height
//   - units: the APPLIED apartment layout (distinct unit ids of the store zones, weAusZonen); only
//     without a layout the panel cache "haustechnik:we" (drainage planner default NGF / 75). The panel
//     cache alone is not reliable across tabs: usePanelState keeps the value of the first render,
//     when the store may still be empty (NGF 0 → 1 unit) — found by the 91-02 E2E (23 vs 2 m³)
//   - precipitation: useSiteClimate at the project location (offline → fallback, flagged estimated)
//   - garden: green areas of aussenanlagen_layer; garage: werkstatt_layer.tiefgarage (aktiv + the
//     persisted quantities' nutzflaeche_m2); required retention: DIN 1986-100 balance (entwaesserung)
//
// useFachlayer does NOT sync two instances of one layer (each loads once and keeps its own state),
// so the OWNER of a layer passes its live state as an override: the drainage planner passes
// `entwaesserung`, the Werkstatt passes `werkstatt`. A layer given as override is not loaded again
// (useFachlayer with projectId null = no request).
//
// In:  optional location (ComplexDesigner complexData.location beats project.location), optional live
//      layers { entwaesserung, werkstatt, aussenanlagen } of the calling owner.
// Out: { ...regenwasserNutzung(...), eingaben, laedtKlima } — pure figures plus the inputs used.
import { useMemo } from "react";
import { useProject } from "@core/lib/ProjectContext";
import { useBuildingProgram, programMetrics, polygonAreaM } from "@core/lib/useBuildingProgram";
import { usePanelState } from "@core/lib/usePanelState";
import { useFachlayer } from "@designer/lib/useFachlayer";
import { usePlanModel } from "@designer/lib/usePlanModel";
import { useSiteClimate } from "@designer/lib/useSiteClimate";
import { klimaAmStandort, GRUEN_ARTEN } from "@designer/lib/pflanzen";
import { flaechenSummen, LAGEPLAN_DEFAULT } from "@designer/lib/lageplan";
import { ENTW_DEFAULT, layerHardened as entwHardened, abflusswirksam, ueberflutung } from "@designer/lib/entwaesserung";
import { WERKSTATT_DEFAULT } from "@designer/lib/werkstattDefaults";
import { regenwasserNutzung, weAusZonen } from "@designer/lib/regenwassernutzung";

/**
 * Rainwater harvesting figures of the current project (read-only — the drainage planner owns
 * entwaesserung_layer and writes `nutzung` itself).
 * @param {{location?: {lat?: number, lng?: number}|null, entwaesserung?: any, werkstatt?: any, aussenanlagen?: any}} [o]
 *   entwaesserung / werkstatt / aussenanlagen = live layer state of the owner (skips the own load)
 * @returns {ReturnType<typeof regenwasserNutzung> & {klimaStatus: "laedt"|"ok"|"geschaetzt", eingaben: {footArea_m2: number, dachform: string, niederschlag_mm: number|null, we: number, weQuelle: "layout"|"konzept", gruenflaeche_m2: number, tgAktiv: boolean, tgFlaeche_m2: number|null, rueckhalt_m3: number, kellerAktiv: boolean}, laedtKlima: boolean}} klimaStatus: see the return statement
 */
export function useRegenwasser({ location = null, entwaesserung = null, werkstatt = null, aussenanlagen = null } = {}) {
  const { project } = useProject();
  const store = useBuildingProgram();
  const pm = programMetrics(store);
  const plan = usePlanModel(project?.id);
  const [entwGeladen] = useFachlayer(entwaesserung ? null : project?.id, "entwaesserung_layer", ENTW_DEFAULT);
  const [wtGeladen] = useFachlayer(werkstatt ? null : project?.id, "werkstatt_layer", WERKSTATT_DEFAULT);
  const [aussenGeladen] = useFachlayer(aussenanlagen ? null : project?.id, "aussenanlagen_layer", LAGEPLAN_DEFAULT);
  const entwRaw = entwaesserung || entwGeladen, wtLayer = werkstatt || wtGeladen, aussenLayer = aussenanlagen || aussenGeladen;
  const weDefault = Math.max(1, Math.round(pm.ngf / 75)) || 1;
  const [wePanel] = usePanelState("haustechnik:we", weDefault);
  const weLayout = useMemo(() => weAusZonen(store?.zones), [store?.zones]);
  const we = weLayout > 0 ? weLayout : Number(wePanel) || 0;
  const climate = useSiteClimate(location || project?.location || null);

  const footprint = useMemo(() => plan?.model?.footprint || [], [plan?.model]);
  const footArea = useMemo(() => polygonAreaM(footprint), [footprint]);
  const dachform = plan?.dachform || "flach";
  const storeys = Number(plan?.storeys) || Number(store?.storeys) || 1;
  const storeyHeight = Number(plan?.storeyHeight) || 3;
  const entw = useMemo(() => entwHardened(entwRaw), [entwRaw]);
  const tg = wtLayer?.tiefgarage || {};
  const tgAktiv = Boolean(tg.aktiv);
  const tgFlaeche = Number(tg?.mengen?.nutzflaeche_m2) > 0 ? Number(tg.mengen.nutzflaeche_m2) : null;
  const kellerAktiv = Boolean(wtLayer?.keller?.aktiv);
  const flaechen = useMemo(() => {
    let gruen = 0, befestigt = 0;
    for (const [art, m2] of Object.entries(flaechenSummen(aussenLayer))) {
      if (GRUEN_ARTEN.includes(art)) gruen += m2; else befestigt += m2;
    }
    return { gruen, befestigt };
  }, [aussenLayer]);
  const klima = useMemo(() => klimaAmStandort(climate), [climate]);
  const niederschlag = climate?.offline || !(klima.niederschlag_mm > 0) ? null : klima.niederschlag_mm;
  const rueckhalt = useMemo(() => {
    const aRed = abflusswirksam({ footArea, befestigt_m2: flaechen.befestigt, gruen_m2: flaechen.gruen });
    return ueberflutung({ r30_100: entw.regen.r30_100, aRed, qAb_ls: entw.regen.qAb_ls, dauer_min: entw.regen.dauer_min }).vRueck_m3;
  }, [footArea, flaechen, entw.regen]);

  const eingaben = useMemo(() => ({
    footArea_m2: footArea, dachform, niederschlag_mm: niederschlag, we, weQuelle: /** @type {"layout"|"konzept"} */ (weLayout > 0 ? "layout" : "konzept"), gruenflaeche_m2: flaechen.gruen,
    tgAktiv, tgFlaeche_m2: tgFlaeche, rueckhalt_m3: rueckhalt, kellerAktiv,
  }), [footArea, dachform, niederschlag, we, weLayout, flaechen.gruen, tgAktiv, tgFlaeche, rueckhalt, kellerAktiv]);
  const ergebnis = useMemo(() => regenwasserNutzung({
    nutzung: entw.nutzung, ...eingaben, geschosse: storeys, geschosshoehe_m: storeyHeight,
  }), [entw.nutzung, eingaben, storeys, storeyHeight]);
  // "laedt" while the climate request runs (figures are provisional with the fallback), "geschaetzt"
  // when offline / no data (fallback stays), "ok" with the site's real precipitation.
  const klimaStatus = climate?.loading ? "laedt" : niederschlag === null ? "geschaetzt" : "ok";
  return { ...ergebnis, eingaben, laedtKlima: Boolean(climate?.loading), klimaStatus };
}
