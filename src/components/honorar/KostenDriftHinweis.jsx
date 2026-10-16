// Yellow drift notice of frozen anrechenbare Kosten (plan 96-03): loads the LV
// positions of the record's project, compares them with the snapshot through
// @core/lib/hoai/kostenDrift.js and — only when the drift is over the
// threshold — shows "LV hat sich seit dem Einfrieren um x % geändert (Stand …)"
// with the KG 300/400 values. Never writes anything: the contract keeps its
// frozen costs (issued instalment invoices must not change, GoBD); the caller
// decides what the action does (fee amendment, or a hint to re-take the LV).
//
// In:  props vertrag (Honorarvertrag or offer with kosten_eingefroren), projektId,
//      optional aktionText + onAktion(drift), optional hinweis (replaces the
//      default "frozen costs stay the contract basis" line, e.g. for offers).
// Out: the notice or nothing; one read of LVPosition per project/snapshot.

import React from "react";
import { bitApi } from "@core/api/bitApi";
import { buttonVariants } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { datumText } from "@core/lib/kalender/datum.js";
import { kostenDrift } from "@core/lib/hoai/kostenDrift.js";
import { formatEuro } from "@/lib/accounting/geld.js";

/** @typedef {NonNullable<ReturnType<typeof kostenDrift>>} KostenDrift */

/**
 * @param {{
 *   vertrag: Record<string, any>, projektId?: string|null,
 *   aktionText?: string, onAktion?: (drift: KostenDrift) => void, hinweis?: string,
 * }} props
 * @returns {React.ReactElement|null}
 */
export default function KostenDriftHinweis({ vertrag, projektId = null, aktionText, onAktion, hinweis }) {
  const { t, lang } = useI18n();
  const [positionen, setPositionen] = React.useState(/** @type {any[]|null} */ (null));
  const [fehler, setFehler] = React.useState(/** @type {string|null} */ (null));
  const hatSnapshot = Boolean(vertrag?.kosten_eingefroren);

  React.useEffect(() => {
    if (!hatSnapshot || !projektId) { setPositionen(null); return undefined; }
    let aktiv = true;
    /** @type {any} */ (bitApi).entities.LVPosition.filter({ project_id: projektId })
      .then((/** @type {any} */ rows) => { if (aktiv) { setPositionen(Array.isArray(rows) ? rows : []); setFehler(null); } })
      .catch((/** @type {any} */ err) => { if (aktiv) setFehler(err?.message || String(err)); });
    return () => { aktiv = false; };
  }, [hatSnapshot, projektId]);

  if (fehler) {
    return <p className="text-xs text-red-700 dark:text-red-300" role="alert">{t("LV konnte für den Kostenvergleich nicht geladen werden")}: {fehler}</p>;
  }
  if (!positionen) return null;
  const drift = kostenDrift(vertrag, positionen);
  if (!drift || !drift.ueberSchwelle) return null;

  const stand = drift.eingefrorenAm ? datumText(drift.eingefrorenAm, lang === "en" ? "en" : "de") : "—";
  const prozent = drift.abweichungProzent === null ? null
    : new Intl.NumberFormat(lang === "en" ? "en-GB" : "de-DE", { maximumFractionDigits: 1, signDisplay: "exceptZero" }).format(drift.abweichungProzent);
  const text = prozent === null
    ? t("LV hat sich seit dem Einfrieren geändert (Stand {datum})").replace("{datum}", stand)
    : t("LV hat sich seit dem Einfrieren um {x} % geändert (Stand {datum})").replace("{x}", prozent).replace("{datum}", stand);
  const euro = (/** @type {number} */ c) => formatEuro(c, lang);

  return (
    <div className="space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100" role="status" data-testid="kosten-drift-hinweis">
      <p className="font-medium">{text}</p>
      <p className="text-xs tabular-nums">
        {`KG 300: ${euro(drift.jeKg.kg300.eingefrorenCent)} → ${euro(drift.jeKg.kg300.aktuellCent)} · KG 400: ${euro(drift.jeKg.kg400.eingefrorenCent)} → ${euro(drift.jeKg.kg400.aktuellCent)}`}
      </p>
      <p className="text-xs">{hinweis || t("Die eingefrorenen Kosten bleiben Grundlage des Vertrags; gestellte Abschlagsrechnungen ändern sich nicht.")}</p>
      {onAktion && aktionText && (
        <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={() => onAktion(drift)} data-testid="kosten-drift-nachtrag">
          {aktionText}
        </button>
      )}
    </div>
  );
}
