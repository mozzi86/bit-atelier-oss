// GehaltSichtbarkeit.jsx — Sitzungsweite Sichtbarkeit von Gehältern (Plan
// 80-06, Task 5, DS-09/D-P80-22): Gehälter werden überall als "•••• €"
// gezeigt. "Gehälter zeigen" deckt sie NUR für die Sitzung auf — der Zustand
// lebt ausschließlich im React-Zustand, es gibt KEINEN Storage-Schlüssel
// (weder localStorage noch sessionStorage): ein Reload maskiert wieder.
//
// In:  GehaltSichtbarkeitProvider umschließt den Reiterbereich von /People
//      (src/pages/People.jsx). Out: useGehaltSichtbarkeit, GehaelterUmschalten
//      (Kopfknopf), Betrag (Anzeige-Baustein für Tabellen/Verlauf).

import React from "react";
import { Eye, EyeOff } from "lucide-react";
import { useI18n } from "@core/lib/i18n";

/** @type {React.Context<{sichtbar: boolean, umschalten: () => void}>} */
const GehaltSichtbarkeitKontext = React.createContext({ sichtbar: false, umschalten: () => {} });

/**
 * Hält den Sichtbarkeits-Zustand NUR im Speicher (kein Storage-Schlüssel,
 * DS-09) — ein Reload der Seite maskiert die Gehälter automatisch wieder.
 * @param {{children?: React.ReactNode}} props
 * @returns {React.ReactElement}
 */
export function GehaltSichtbarkeitProvider({ children }) {
  const [sichtbar, setSichtbar] = React.useState(false);
  const wert = React.useMemo(() => ({ sichtbar, umschalten: () => setSichtbar((s) => !s) }), [sichtbar]);
  return <GehaltSichtbarkeitKontext.Provider value={wert}>{children}</GehaltSichtbarkeitKontext.Provider>;
}

/**
 * @returns {{sichtbar: boolean, umschalten: () => void}} ohne Provider: immer maskiert, `umschalten` ist ein No-op
 */
export function useGehaltSichtbarkeit() {
  return React.useContext(GehaltSichtbarkeitKontext);
}

/**
 * Kopfknopf "Gehälter zeigen" / "Gehälter verbergen" (`aria-pressed`).
 * @returns {React.ReactElement}
 */
export function GehaelterUmschalten() {
  const { t } = useI18n();
  const { sichtbar, umschalten } = useGehaltSichtbarkeit();
  return (
    <button
      type="button"
      onClick={umschalten}
      aria-pressed={sichtbar}
      data-testid="gehaelter-umschalten"
      className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
    >
      {sichtbar ? <EyeOff className="h-3.5 w-3.5" aria-hidden="true" /> : <Eye className="h-3.5 w-3.5" aria-hidden="true" />}
      {sichtbar ? t("Gehälter verbergen") : t("Gehälter zeigen")}
    </button>
  );
}

/**
 * Ein Geldbetrag, der der Sichtbarkeits-Einstellung folgt: maskiert "•••• €"
 * oder formatiert (de-DE, zwei Nachkommastellen) mit der Einheit.
 * @param {{wert: number|null|undefined, einheit?: 'monat'|'stunde'}} props
 * @returns {React.ReactElement}
 */
export function Betrag({ wert, einheit = "monat" }) {
  const { sichtbar } = useGehaltSichtbarkeit();
  const suffix = einheit === "stunde" ? " €/h" : " €";
  if (!sichtbar || typeof wert !== "number" || !Number.isFinite(wert)) {
    return <span data-testid="betrag-maskiert">{"••••" + suffix}</span>;
  }
  return <span data-testid="betrag-sichtbar">{wert.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + suffix}</span>;
}
