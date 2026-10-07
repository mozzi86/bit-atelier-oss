// UebernahmeDialog.jsx — Vorschau + Bestätigung "Zusage → Einstellung"
// (Plan 80-09, Task 4): zeigt, was uebernahmeAusBewerbung anlegen wird, bevor
// es passiert, führt sie nach der Bestätigung aus und navigiert danach auf
// die neue Eintritts-Checkliste (?tab=onboarding&vorgang=<id>, opake ID —
// DS-07).
//
// In:  {bewerbung, stelle, regelWert, onClose, onUebernommen}. Out: UI, ein
//      Aufruf von uebernahmeAusBewerbung (Schreibzugriffe über bitApi.personal).

import React from "react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "@core/lib/i18n";
import { bitApi } from "@core/api/bitApi";
import FormModal from "@core/components/common/FormModal";
import { heuteLokal } from "@core/lib/kalender/datum.js";
import { VORLAGE_EINTRITT, anwendbarePunkte } from "@/lib/people/onboarding.js";
import { uebernahmeAusBewerbung } from "@/lib/people/uebernahme.js";
import { bauePersonalLink } from "@/lib/people/personalLink.js";

/** @param {string} text @param {Record<string, string|number>} werte @returns {string} */
function fuellen(text, werte) {
  return text.replace(/\{(\w+)\}/g, (_, k) => String(werte[k] ?? ""));
}

/**
 * @param {{bewerbung: object, stelle: object|null, regelWert: (id: string) => any,
 *   onClose: () => void, onUebernommen: () => void}} props
 * @returns {React.ReactElement}
 */
export default function UebernahmeDialog({ bewerbung, stelle, regelWert, onClose, onUebernommen }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [laeuft, setLaeuft] = React.useState(false);
  const [fehler, setFehler] = React.useState(/** @type {string|null} */ (null));

  // Vorschau-Anzahl: Kammermitgliedschaft ist vor der Einstellung nicht
  // bekannt (die Bewerbung trägt keine Kammerdaten) — die Vorschau rechnet
  // deshalb ohne Kammer, mit der Personenart aus der Stelle.
  const probeMitarbeiter = { art: stelle?.beschaeftigungsart || "angestellt", kammer: {} };
  const anzahlPunkte = anwendbarePunkte(VORLAGE_EINTRITT, probeMitarbeiter).length;

  const bestaetigen = async () => {
    setLaeuft(true);
    setFehler(null);
    try {
      const { vorgang } = await uebernahmeAusBewerbung(bewerbung, /** @type {any} */ (bitApi.personal), regelWert, heuteLokal());
      onUebernommen?.();
      onClose();
      navigate(`/People${bauePersonalLink({ tab: "onboarding", vorgang: vorgang.id })}`);
    } catch (err) {
      setFehler(/** @type {any} */ (err)?.message || String(err));
    } finally {
      setLaeuft(false);
    }
  };

  return (
    <FormModal title={t("Einstellung anlegen")} onClose={onClose} schuetzen={false}>
      <div className="space-y-4" data-testid="uebernahme-dialog">
        <p className="text-sm text-slate-700 dark:text-slate-200">
          {fuellen(t("Legt 1 Person, 1 Vertragsentwurf und 1 Eintritts-Checkliste ({n} Punkte) an."), { n: anzahlPunkte })}
        </p>
        <p className="text-sm text-slate-700 dark:text-slate-200">
          {t("Lebenslauf und Zeugnisse werden übernommen, Gesprächsnotizen und Bewertungen nicht.")}
        </p>
        {fehler && <p role="alert" className="text-sm text-rose-600">{fehler}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={laeuft}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-800">
            {t("Abbrechen")}
          </button>
          <button type="button" onClick={bestaetigen} disabled={laeuft}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
            {t("Einstellung anlegen")}
          </button>
        </div>
      </div>
    </FormModal>
  );
}
