// "Rechnungen raus bis" list of the year clock (79-10, T6): every tax date
// with its coverage and its own "send invoices by" deadline, and which
// planned/draft invoices are assigned to it (liquiditaet.rechnungenRausBis()).
// Includes tax dates whose deadline lies in the PRIOR year (a January date's
// deadline can fall in December) and next year's dates whose deadline
// already falls in the shown year.
//
// In:  props eintraege (rechnungenRausBis() result). Out: the list; the
// action "Rechnung stellen" only links to the invoices tab — it does not
// write anything itself (stelleRechnung() is 79-02's own dialog).

import React from "react";
import { Link } from "react-router-dom";
import { useI18n } from "@core/lib/i18n";
import { steuerartText } from "@/lib/accounting/liquiditaet.js";
import { formatEuro } from "@/lib/accounting/geld.js";

/** @param {string} iso */
function tagText(iso) {
  return iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "—";
}

const BADGE_KNAPP = "ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-100";
const BADGE_UEBER = "ml-1 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800 dark:bg-red-950 dark:text-red-200";

/**
 * @param {{eintraege: ReturnType<typeof import("@/lib/accounting/liquiditaet.js").rechnungenRausBis>}} props
 * @returns {React.ReactElement}
 */
export default function RechnungenRausListe({ eintraege }) {
  const { t, lang } = useI18n();
  if (!eintraege || eintraege.length === 0) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">{t("Keine Steuertermine")}</p>;
  }
  const arten = (liste) => liste.map((a) => steuerartText(a, t)).join(", ");
  const betragText = (e) => {
    if (e.betragCent === null) return t("Betrag fehlt");
    const fehlt = e.fehlendeArten?.length ? ` · ${t("Betrag fehlt")}: ${arten(e.fehlendeArten)}` : "";
    return `${formatEuro(e.betragCent, lang)}${fehlt}`;
  };
  return (
    <ul className="space-y-3" data-testid="rechnungen-raus-liste">
      {eintraege.map((e) => (
        <li key={e.datum} className="rounded-lg border p-3 space-y-1" data-testid="rechnungen-raus-eintrag" data-datum={e.datum}
          data-warnung={e.warnung || ""} data-rechnungen={e.rechnungen.length}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium">{tagText(e.datum)} · {arten(e.arten)}</span>
            <span className="tabular-nums text-sm">{betragText(e)}</span>
          </div>
          <p className={`text-sm ${e.gedeckt === false ? "text-amber-700 dark:text-amber-300" : "text-slate-600 dark:text-slate-300"}`}>
            {e.gedeckt === true ? `✓ ${t("gedeckt")}` : e.gedeckt === false ? `⚠ ${t("Deckung gefährdet")}` : t("Deckung unbekannt")}
          </p>
          <p className="text-sm text-red-700 dark:text-red-300">
            {t("Spätester Rechnungsversand")}: {tagText(e.spaetesterVersand)}
            {e.restTage !== null && (e.restTage >= 0 ? ` · ${t("noch {n} Tage").replace("{n}", String(e.restTage))}` : ` · ${t("überschritten")}`)}
            {e.warnung === "knapp" && <span className={BADGE_KNAPP}>{t("knapp")}</span>}
            {e.warnung === "ueberschritten" && <span className={BADGE_UEBER}>{t("überschritten ohne Deckung")}</span>}
          </p>
          {e.rechnungen.length > 0 && (
            <ul className="space-y-1 pt-1">
              {e.rechnungen.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-sm" data-testid="rechnungen-raus-rechnung" data-warnung={r.warnung || ""}>
                  <span>
                    {r.nummer || r.id} · {t("eigene Frist")} {tagText(r.frist)} ({t("Zahlungsziel")} {r.zielTage})
                    {r.warnung === "knapp" && <span className={BADGE_KNAPP}>{t("knapp")}</span>}
                    {r.warnung === "ueberschritten" && <span className={BADGE_UEBER}>{t("überschritten ohne Deckung")}</span>}
                  </span>
                  <Link to={`/Accounting?tab=invoices&rechnung=${r.id}`} className="underline decoration-dotted underline-offset-2">
                    {t("Rechnung stellen")}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}
