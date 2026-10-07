// Situation bar above all tabs of /Accounting (79-10, T7): overdue invoices,
// the next tax date with its coverage, the next "send invoices by" deadline,
// today's balance — always in text, never colour alone. Fills the 79-01 stub.
//
// In:  props bh (page loader object). Out: four tiles, or null while data is
// unavailable or empty (the slot the page already reserves for this). All four
// come from ONE call of liquiditaet.lage(), so the deadline tile's date and its
// invoice count always belong to the same tax date.

import React from "react";
import { Link } from "react-router-dom";
import { useI18n } from "@core/lib/i18n";
import { lage, steuerartText } from "@/lib/accounting/liquiditaet.js";
import { formatEuro } from "@/lib/accounting/geld.js";
// 80-10 Task 7b: NUR dieser Hook — die Personal-Speicherzugriffe bleiben in ihm gekapselt (s. dessen Dateikopf).
import { usePersonalkostenPlan } from "@/components/people/usePersonalkostenPlan.js";

/** @param {string} iso */
function tagText(iso) {
  return iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "—";
}

const KACHEL = "rounded-lg border bg-card p-3 text-sm";

/**
 * @param {{bh: import("./useBuchhaltung.js").Buchhaltung}} props
 * @returns {React.ReactElement|null}
 */
export default function LageLeiste({ bh }) {
  const { t, lang } = useI18n();
  const jahr = Number(bh.heute?.slice(0, 4));
  const irgendetwasGespeichert = Object.values(bh.daten || {}).some((liste) => Array.isArray(liste) && liste.length > 0);
  // 80-10 Task 7b: derselbe additive Kontext-Abfluss wie im Reiter "Jahresuhr" —
  // damit nennt kontostandHeute denselben Stand wie tagesSaldo mit Personal (Plan).
  // warten: bh.laedt — s. usePersonalkostenPlan.js Dateikopf (zwei gleichzeitige
  // IndexedDB-Versionssprünge auf dem ersten /Accounting-Besuch vermeiden).
  const { zusatzAbfluesse } = usePersonalkostenPlan(jahr, { warten: bh.laedt });

  const lageDaten = React.useMemo(
    () => (bh.verfuegbar && irgendetwasGespeichert
      ? lage({ daten: bh.daten, einst: bh.einst, saetze: bh.saetze, jahr, heute: bh.heute, projekte: bh.projekte, zusatzAbfluesse })
      : null),
    [bh.verfuegbar, irgendetwasGespeichert, bh.daten, bh.einst, bh.saetze, jahr, bh.heute, bh.projekte, zusatzAbfluesse],
  );

  if (!bh.verfuegbar || !irgendetwasGespeichert || !lageDaten) return null;
  const st = lageDaten.naechsterSteuertag;
  const frist = lageDaten.naechsteFrist;
  const arten = (liste) => liste.map((a) => steuerartText(a, t)).join(", ");

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="lage-leiste">
      <Link to="/Accounting?tab=invoices&filter=ueberfaellig" className={`${KACHEL} block hover:bg-slate-50 dark:hover:bg-slate-800`} data-testid="lage-ueberfaellig">
        <p className="text-xs text-slate-500 dark:text-slate-400">{t("Überfällig")}</p>
        <p className="font-medium">{lageDaten.ueberfaellig.anzahl} {t("Rechnungen")} · {formatEuro(lageDaten.ueberfaellig.summeCent, lang)}</p>
      </Link>
      <Link
        to={st ? `/Accounting?tab=liquidity&monat=${st.faellig.slice(5, 7)}` : "/Accounting?tab=liquidity"}
        className={`${KACHEL} block hover:bg-slate-50 dark:hover:bg-slate-800`} data-testid="lage-steuertermin">
        <p className="text-xs text-slate-500 dark:text-slate-400">{t("Nächster Steuertermin")}</p>
        <p className="font-medium">
          {st
            ? `${tagText(st.faellig)} · ${arten(st.arten)} · ${st.betragCent === null ? t("Betrag fehlt") : formatEuro(st.betragCent, lang)} · ${st.gedeckt === true ? `✓ ${t("gedeckt")}` : st.gedeckt === false ? `⚠ ${t("Deckung gefährdet")}` : t("Deckung unbekannt")}`
            : t("Keine Steuertermine")}
        </p>
      </Link>
      <Link to="/Accounting?tab=liquidity" className={`${KACHEL} block hover:bg-slate-50 dark:hover:bg-slate-800`} data-testid="lage-frist"
        data-nenn={frist?.nenn || ""}>
        <p className="text-xs text-slate-500 dark:text-slate-400">{t("Rechnungen raus bis")}</p>
        <p className="font-medium">
          {frist
            ? `${tagText(frist.datum)} · ${t("in {n} Tagen").replace("{n}", String(frist.tage))} · ${frist.rechnungen} ${t("Rechnungen")}`
            : t("Keine Fristen")}
        </p>
      </Link>
      <div className={KACHEL} data-testid="lage-kontostand">
        <p className="text-xs text-slate-500 dark:text-slate-400">{t("Kontostand heute")}</p>
        <p className="font-medium tabular-nums">{formatEuro(lageDaten.kontostandHeute, lang)}</p>
      </div>
    </div>
  );
}
