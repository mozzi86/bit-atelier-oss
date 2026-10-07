// Centred form dialog used by the create/edit forms (eleven callers).
//
// Built on ui/dialog.jsx (72-11, N-07): role=dialog named by the title, focus
// starts in the first field and stays inside, Escape closes, focus returns to the
// control that opened it. Escape, a click on the backdrop and the X ask first once
// something was typed (rule in lib/dialogSchutz.js) — an inline question in the
// header, no window.confirm. The callers' own "Abbrechen" button calls onClose
// directly and never asks.
//
// In:  title (heading and accessible name), onClose (called when the dialog may
//      close; every caller then unmounts FormModal), children (the form),
//      schuetzen (guard on/off).
// Out: the dialog in a portal on document.body. The props API is unchanged from
//      the former hand-made modal, so no caller had to change.

import React from "react";
import { X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@core/components/ui/dialog";
import { schliessAnfrage } from "@core/lib/dialogSchutz";
import { useI18n } from "@core/lib/i18n";

// Controls that count as "a field" for the initial focus. Radix would otherwise
// focus the first tabbable element, which is the X in the header.
const FELDER = 'input, select, textarea, [role="combobox"]';

/**
 * First visible, enabled, tabbable form field below `wurzel`, or null.
 * Skips the hidden native <select>/<input> Radix renders for form integration.
 * @param {HTMLElement|null} wurzel
 * @returns {HTMLElement|null}
 */
function erstesFeld(wurzel) {
  if (!wurzel) return null;
  const kandidaten = /** @type {HTMLInputElement[]} */ (Array.from(wurzel.querySelectorAll(FELDER)));
  return kandidaten.find((el) =>
    !el.disabled
    && el.type !== "hidden"
    && el.tabIndex >= 0
    && !el.closest('[aria-hidden="true"], [hidden], [inert]')
    && el.getClientRects().length > 0
  ) ?? null;
}

/**
 * Form dialog with focus trap, Escape and a guard against losing typed input.
 * @param {{ title: React.ReactNode, onClose: () => void, children?: React.ReactNode, schuetzen?: boolean }} props
 *   title: heading, also the dialog's accessible name;
 *   onClose: called once the dialog may close (Verwerfen, or a close gesture without changes);
 *   schuetzen: optional, default true — ask before Escape, backdrop click or X discard typed input.
 */
export default function FormModal({ title, onClose, children, schuetzen = true }) {
  const { t } = useI18n();
  // Callers render FormModal conditionally and without a DialogTrigger, so Radix
  // has no trigger to hand the focus back to. Remember what had focus when the
  // dialog mounted (first render, before Radix moves the focus inside).
  const [oeffner] = React.useState(() =>
    typeof document === "undefined" ? null : /** @type {HTMLElement|null} */ (document.activeElement)
  );
  const inhaltRef = React.useRef(null);
  const weiterRef = React.useRef(null);
  const fokusVorFrage = React.useRef(/** @type {HTMLElement|null} */ (null));
  // A ref, not state: marking a change must not re-render the form on every keystroke.
  const geaendert = React.useRef(false);
  const [rueckfrage, setRueckfrage] = React.useState(false);
  const frageId = React.useId();

  React.useEffect(() => {
    if (rueckfrage) weiterRef.current?.focus();
  }, [rueckfrage]);

  const merkeAenderung = () => { geaendert.current = true; };

  const weiterBearbeiten = () => {
    setRueckfrage(false);
    const ziel = fokusVorFrage.current;
    // Back to where the user was typing; if that control is gone, to the first field.
    if (ziel?.isConnected && inhaltRef.current?.contains(ziel)) ziel.focus();
    else erstesFeld(inhaltRef.current)?.focus();
  };

  /**
   * Runs the guard for one gesture and applies everything except the close itself.
   * @param {import("@core/lib/dialogSchutz").SchliessAusloeser} ausloeser
   * @returns {boolean} true when the dialog may close now.
   */
  const pruefeSchliessen = (ausloeser) => {
    const entscheidung = schliessAnfrage({ geaendert: geaendert.current, ausloeser, rueckfrageOffen: rueckfrage, schuetzen });
    if (entscheidung === "schliessen") return true;
    if (entscheidung === "weiter") weiterBearbeiten();
    else if (!rueckfrage) {
      const aktiv = /** @type {HTMLElement|null} */ (document.activeElement);
      fokusVorFrage.current = aktiv;
      setRueckfrage(true);
    } else weiterRef.current?.focus();
    return false;
  };

  return (
    <Dialog open onOpenChange={(offen) => { if (!offen) onClose(); }}>
      <DialogContent
        ref={inhaltRef}
        showCloseButton={false}
        // No description element; undefined drops the attribute and the Radix warning.
        aria-describedby={undefined}
        className="max-w-2xl max-h-[90vh] overflow-y-auto"
        onInputCapture={merkeAenderung}
        onChangeCapture={merkeAenderung}
        onOpenAutoFocus={(e) => {
          const feld = erstesFeld(inhaltRef.current);
          if (feld) { e.preventDefault(); feld.focus(); }
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          if (oeffner?.isConnected) oeffner.focus();
        }}
        onEscapeKeyDown={(e) => {
          if (!pruefeSchliessen("esc")) e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          const original = e.detail.originalEvent;
          const ziel = /** @type {HTMLElement|null} */ (original.target);
          // Only the backdrop counts as "outside", as with the former modal. A
          // non-Radix popup portalled next to the dialog, a right click or a
          // Ctrl+click must neither close nor ask.
          const aufHintergrund = typeof ziel?.closest === "function" && ziel.closest('[data-slot="dialog-overlay"]');
          if (!aufHintergrund || original.button !== 0 || original.ctrlKey) { e.preventDefault(); return; }
          if (!pruefeSchliessen("aussen")) e.preventDefault();
        }}
      >
        <div className="sticky top-0 z-10 rounded-t-2xl border-b border-slate-200 bg-white px-6 py-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-4">
            <DialogTitle>{title}</DialogTitle>
            <button
              type="button"
              aria-label={t("Dialog schließen")}
              onClick={() => { if (pruefeSchliessen("x")) onClose(); }}
              className="shrink-0 rounded-md p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          {rueckfrage && (
            <div
              role="group"
              aria-labelledby={frageId}
              className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
            >
              <p id={frageId} role="alert" className="font-medium">{t("Ungespeicherte Eingaben verwerfen?")}</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  ref={weiterRef}
                  onClick={weiterBearbeiten}
                  className="rounded-md border border-amber-300 bg-white px-3 py-1 text-slate-700 hover:bg-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-amber-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                >
                  {t("Weiter bearbeiten")}
                </button>
                <button
                  type="button"
                  onClick={() => onClose()}
                  className="rounded-md bg-red-600 px-3 py-1 font-medium text-white hover:bg-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                >
                  {t("Verwerfen")}
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="p-6">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
