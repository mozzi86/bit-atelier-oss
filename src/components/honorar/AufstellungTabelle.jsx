// Display of a fee breakdown (phase 81-03): the lines of aufstellung() with
// amount and legal source, translated through their German key, plus the review
// line "Richtwerte nach HOAI 2021 — vor Versand gegenlesen" (a wrong figure is a
// contract risk). "Tafel fehlt" and "frei vereinbar" show as a notice, never 0 €.
//
// In:  props a (aufstellung() result), optional kompakt. Out: the table.

import React from "react";
import { useI18n } from "@core/lib/i18n";
import { formatEuro } from "@/lib/accounting/geld.js";
import { fuelle } from "@/lib/honorar/aufstellung.js";

const BETONT = new Set(["summe", "netto", "brutto"]);

/**
 * @param {{a: ReturnType<typeof import("@/lib/honorar/aufstellung.js").aufstellung>, kompakt?: boolean}} props
 * @returns {React.ReactElement}
 */
export default function AufstellungTabelle({ a, kompakt = false }) {
  const { t, lang } = useI18n();
  const betrag = (/** @type {number|null} */ x) => (x === null ? "—" : formatEuro(Math.round(x * 100), lang));
  return (
    <div className="space-y-2" data-testid="honorar-aufstellung">
      <table className="w-full text-sm">
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {a.zeilen.filter((z) => !kompakt || z.art !== "lph").map((z, i) => (
            <tr key={`${z.art}-${i}`} className={BETONT.has(z.art) ? "font-semibold" : ""}>
              <td className="py-1 pr-2 text-slate-800 dark:text-slate-100">{fuelle(t(z.schluessel), Object.fromEntries(Object.entries(z.werte).map(([k, v]) => [k, typeof v === "string" ? t(v) : v])))}</td>
              <td className="py-1 pr-2 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">{z.quelle}</td>
              <td className="py-1 text-right tabular-nums whitespace-nowrap">
                {z.art === "hinweis" ? "" : z.schluessel === "Fläche (ha)" && z.betrag_eur !== null
                  ? `${new Intl.NumberFormat(lang === "en" ? "en-GB" : "de-DE", { maximumFractionDigits: 2 }).format(z.betrag_eur)} ha`
                  : betrag(z.betrag_eur)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!a.tafelFehlt && !a.ausserhalb && (
        <p className="text-xs text-amber-800 dark:text-amber-200">{t("Richtwerte nach HOAI 2021 — vor Versand gegenlesen.")}</p>
      )}
    </div>
  );
}
