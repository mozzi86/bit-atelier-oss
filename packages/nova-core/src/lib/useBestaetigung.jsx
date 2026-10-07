// Confirmation dialog as a promise (80-01, D-P80-14; building block of NA-13).
//
// `const bestaetige = useBestaetigung(); if (await bestaetige({titel, text})) …`
// opens ONE accessible alert dialog (@core/components/ui/alert-dialog.jsx): focus
// trapped inside, Escape and "Abbrechen" answer false, the focus returns to the
// element that had it before. The sweep of NA-13 replaces the two-step inline
// questions and the window.confirm spots (79-RESEARCH Ist-Inventar) with this one
// instead of building a second; the native browser dialog is never used here.
//
// In:  BestaetigungProvider once near the root (Layout.jsx, inside I18nProvider);
//      texts come translated from the caller, only the default buttons
//      t("Abbrechen") / t("Bestätigen") are produced here.
// Out: BestaetigungProvider, useBestaetigung.

import React from "react";
import { useI18n } from "@core/lib/i18n";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogTitle,
} from "@core/components/ui/alert-dialog";

/**
 * One confirmation request. All texts already translated by the caller.
 * @typedef {{titel: string, text?: string, bestaetigen?: string, abbrechen?: string, gefahr?: boolean}} Bestaetigungsanfrage
 *   gefahr: the confirming button turns red (deleting, discarding)
 */

/** @type {React.Context<((anfrage: Bestaetigungsanfrage) => Promise<boolean>)|null>} */
const BestaetigungKontext = React.createContext(/** @type {((anfrage: Bestaetigungsanfrage) => Promise<boolean>)|null} */ (null));

/** Look of a dangerous confirmation (red instead of emerald). */
const GEFAHR = "bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500";

/**
 * Holds at most ONE open request; a second one answers the first with false.
 * @param {{children?: React.ReactNode}} props
 * @returns {React.ReactElement}
 */
export function BestaetigungProvider({ children }) {
  const { t } = useI18n();
  const [anfrage, setAnfrage] = React.useState(/** @type {Bestaetigungsanfrage|null} */ (null));
  const antwort = React.useRef(/** @type {((ja: boolean) => void)|null} */ (null));
  const vorherFokus = React.useRef(/** @type {HTMLElement|null} */ (null));

  const bestaetige = React.useCallback(
    /** @param {Bestaetigungsanfrage} neu @returns {Promise<boolean>} */
    (neu) => new Promise((ok) => {
      if (antwort.current) antwort.current(false);
      else vorherFokus.current = /** @type {HTMLElement|null} */ (document.activeElement);
      antwort.current = ok;
      setAnfrage({ ...neu });
    }),
    [],
  );

  /** @param {boolean} ja */
  const beenden = React.useCallback((ja) => {
    const ok = antwort.current;
    antwort.current = null;
    setAnfrage(null);
    if (ok) ok(ja);
  }, []);

  // A provider that unmounts with an open request answers it (no promise left hanging).
  React.useEffect(() => () => { if (antwort.current) antwort.current(false); }, []);

  /** @param {Event} e */
  const fokusZurueck = (e) => {
    e.preventDefault();
    const ziel = vorherFokus.current;
    vorherFokus.current = null;
    if (ziel && typeof ziel.focus === "function" && document.contains(ziel)) ziel.focus();
  };

  return (
    <BestaetigungKontext.Provider value={bestaetige}>
      {children}
      <AlertDialog open={anfrage !== null} onOpenChange={(offen) => { if (!offen) beenden(false); }}>
        <AlertDialogContent data-testid="bestaetigung-dialog" onCloseAutoFocus={fokusZurueck}>
          <AlertDialogTitle>{anfrage?.titel ?? ""}</AlertDialogTitle>
          {anfrage?.text ? <AlertDialogDescription>{anfrage.text}</AlertDialogDescription> : null}
          <div className="flex flex-wrap justify-end gap-2">
            <AlertDialogCancel data-testid="bestaetigung-abbrechen">{anfrage?.abbrechen || t("Abbrechen")}</AlertDialogCancel>
            <AlertDialogAction data-testid="bestaetigung-ok" className={anfrage?.gefahr ? GEFAHR : undefined} onClick={() => beenden(true)}>
              {anfrage?.bestaetigen || t("Bestätigen")}
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </BestaetigungKontext.Provider>
  );
}

/**
 * The confirm function of the nearest BestaetigungProvider.
 * @returns {(anfrage: Bestaetigungsanfrage) => Promise<boolean>} resolves true on
 *   "Bestätigen", false on "Abbrechen", Escape or a newer request
 * @throws {Error} "BestaetigungProvider fehlt" outside the provider
 */
export function useBestaetigung() {
  const bestaetige = React.useContext(BestaetigungKontext);
  if (!bestaetige) throw new Error("BestaetigungProvider fehlt");
  return bestaetige;
}
