// The ONE HOAI fee calculator of the app (phase 81-03, HON-07, D-P81-16): the
// same fields as the offer (LeistungsbildFelder) on 79's engine — table basis,
// top and chosen rate, the stage table, totals with their legal sources, the
// review line, "Tafel fehlt" and "frei vereinbar" honestly. It is the tab
// "Honorarrechner" of /Fees and, as a thin shell, the lab calculator of
// /InvestmentPlatform (HOAIFeeCalculator.jsx) — so the two can never disagree.
// "Als Honorarangebot übernehmen" opens the offer wizard with these fields.
//
// In:  optional props uebernehmenMoeglich (default true). Out: the calculator;
//      navigation to /Fees?tab=offers&neu=1 with the fields in the router state.

import React from "react";
import { useNavigate } from "react-router-dom";
import { FileSignature } from "lucide-react";
import { buttonVariants } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { lphFuerLeistungsbild } from "@core/lib/hoai/honorar.js";
import { formatEuro } from "@/lib/accounting/geld.js";
import { aufstellung } from "@/lib/honorar/aufstellung.js";
import LeistungsbildFelder from "./LeistungsbildFelder.jsx";
import AufstellungTabelle from "./AufstellungTabelle.jsx";

/** Start values: building, zone III, stages 1–8, base rate, 5 % incidental costs, 19 % VAT. */
const START = Object.freeze({
  leistungsbild: "gebaeude", kg300_euro: null, kg400_euro: null, sonstige_euro: null, bezugswert: null, honorarzone: "III",
  satz_position_prozent: 0, umbauzuschlag_prozent: 0, nebenkosten_prozent: 5, ust_satz: 19, pauschal_euro: null, textform_am: null, anrechenbare_quelle: "manuell",
});

/**
 * @param {{uebernehmenMoeglich?: boolean}} props
 * @returns {React.ReactElement}
 */
export default function HonorarRechner({ uebernehmenMoeglich = true }) {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const [wert, setWert] = React.useState(() => ({ ...START, lph: lphFuerLeistungsbild("gebaeude").map((l, i) => ({ ...l, beauftragt: i < 8 })) }));
  const aendere = (/** @type {Record<string, any>} */ patch) => setWert((w) => ({ ...w, ...patch }));
  const a = aufstellung(wert);
  const euro = (/** @type {number|null|undefined} */ x) => (typeof x === "number" ? formatEuro(Math.round(x * 100), lang) : "—");

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr]" data-testid="honorar-rechner">
      <div className="space-y-4">
        <LeistungsbildFelder wert={wert} onChange={aendere} idPraefix="rechner" />
      </div>
      <div className="space-y-4">
        {a.tafel && (
          <dl className="grid grid-cols-3 gap-2 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700" data-testid="rechner-tafel">
            <div><dt className="text-xs text-slate-500">{t("Basishonorarsatz")}</dt><dd className="tabular-nums font-medium">{euro(a.tafel.basis)}</dd></div>
            <div><dt className="text-xs text-slate-500">{t("Oberer Honorarsatz")}</dt><dd className="tabular-nums font-medium">{euro(a.tafel.oben)}</dd></div>
            <div><dt className="text-xs text-slate-500">{t("Gewählter Satz")}</dt><dd className="tabular-nums font-medium">{euro(a.tafel.gewaehlt)}</dd></div>
          </dl>
        )}
        <AufstellungTabelle a={a} />
        {uebernehmenMoeglich && (
          <button type="button" className={buttonVariants({ variant: "outline" })} disabled={a.summen.netto === null}
            onClick={() => navigate("/Fees?tab=offers&neu=1", { state: { vorschlag: wert } })}>
            <FileSignature aria-hidden="true" /> {t("Als Honorarangebot übernehmen")}
          </button>
        )}
      </div>
    </div>
  );
}
