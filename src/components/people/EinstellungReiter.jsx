// EinstellungReiter.jsx — Reiter "Einstellung & Austritt" (key `onboarding`,
// Plan 80-09, Task 3): Vorgangsliste und bei `?vorgang=<id>` DER EINE
// Checklisten-Editor (VorgangsCheckliste.jsx) für Eintritt und Austritt.
//
// Das Anlegen eines Vorgangs geschieht anderswo — aus einer Zusage
// (UebernahmeDialog in BewerbungsPipeline.jsx) oder ohne Bewerbung
// ("Eintritt starten"/"Austritt starten" im MitarbeiterDetail-Slot). Beide
// navigieren danach auf `?tab=onboarding&vorgang=<id>`, dieser Reiter zeigt
// dann sofort die neue Checkliste.
//
// In:  props {kontext?: {datenquelle?: string, personalZugang?: string}} (Zugang auf /People-Ebene bereits geprüft).
// Out: BEREIT = true, die Komponente.

import React from "react";
import { useSearchParams } from "react-router-dom";
import { useI18n } from "@core/lib/i18n";
import { useRegelWerte } from "@core/lib/useRegelWerte";
import LoadingState from "@core/components/common/LoadingState";
import { REGELWERKE } from "@/lib/settings/regelwerke.js";
import { lesePersonalLink, entfernePersonalParameter } from "@/lib/people/personalLink.js";
import { usePersonalDaten } from "./usePersonalDaten.js";
import VorgangsListe from "./VorgangsListe.jsx";
import VorgangsCheckliste from "./VorgangsCheckliste.jsx";

/** Whether /People offers this tab. */
export const BEREIT = true;

/**
 * @returns {React.ReactElement}
 */
export default function EinstellungReiter() {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const link = lesePersonalLink(searchParams);
  const { daten, laden, fehler, neuLaden } = usePersonalDaten();
  const { wert } = useRegelWerte(REGELWERKE);

  const oeffnen = React.useCallback((vorgang) => {
    const kopie = new URLSearchParams(searchParams);
    kopie.set("vorgang", vorgang.id);
    setSearchParams(kopie);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- searchParams ändert sich mit jeder Navigation; nur ein neues vorgang setzen
  }, [setSearchParams]);
  const zurueck = React.useCallback(() => {
    setSearchParams(entfernePersonalParameter(searchParams, ["vorgang"]), { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setSearchParams]);

  if (fehler) {
    return <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-100">{fehler}</div>;
  }
  if (laden) {
    return <LoadingState variant="cards" rows={3} />;
  }

  if (link.vorgang) {
    const vorgang = daten.Personalvorgang.find((v) => v.id === link.vorgang) ?? null;
    const mitarbeiter = vorgang ? daten.Mitarbeiter.find((m) => m.id === vorgang.mitarbeiter_id) ?? null : null;
    return (
      <VorgangsCheckliste
        vorgang={vorgang}
        mitarbeiter={mitarbeiter}
        vertraege={daten.Arbeitsvertrag}
        dokumente={daten.Personaldokument}
        regelWert={wert}
        onZurueck={zurueck}
        onGeaendert={neuLaden}
      />
    );
  }

  return (
    <div data-testid="einstellung-reiter">
      <h2 className="sr-only">{t("Einstellung & Austritt")}</h2>
      <VorgangsListe vorgaenge={daten.Personalvorgang} mitarbeiterListe={daten.Mitarbeiter} vertraege={daten.Arbeitsvertrag} onOeffnen={oeffnen} />
    </div>
  );
}
