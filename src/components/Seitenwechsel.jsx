// Route change handling for every page of the app shell (72-10, N-06).
//
// Why: after a click in the menu the focus stayed in the menu, nothing told a
// screen reader that a new page had opened, every browser tab carried the same
// title, and the skip link "Zum Inhalt springen" opened the 404 page. One
// component in the shell fixes this for all routes, including the check suite
// and the designer, whose files stay untouched.
//
// In:  the router location (pathname only, see below) and the menu (navFlach).
// Out: document.title; from the second route change on, focus and scroll reset
//      of <main id="hauptinhalt"> plus the page title in a polite live region;
//      a document-level click handler for skip links.
//
// Mounted first inside <main> in Layout.jsx (so it also runs in the empty and
// error states of the shell) and once more in App.jsx for the legal pages, which
// render without the shell. The two places never render at the same time.

import React from "react";
import { useLocation, useNavigationType } from "react-router-dom";
import { useI18n } from "@core/lib/i18n";
import { navFlach } from "../navigation";
import { seitenTitelFuer, dokumentTitel, PRODUKTNAME } from "../seitenTitel";

/** id of the focus target: <main> in Layout.jsx, the target of every skip link. */
export const INHALT_ID = "hauptinhalt";

/**
 * Element a route change or a skip link moves focus to: <main id="hauptinhalt">
 * in the shell. Outside it (legal pages) the page's own <main>, which carries
 * no tabindex there, so it gets tabindex="-1" here to be focusable by script.
 * @returns {HTMLElement|null}
 */
function inhaltsZiel() {
  const ziel = document.getElementById(INHALT_ID) ?? document.querySelector("main");
  if (ziel && !ziel.hasAttribute("tabindex")) ziel.setAttribute("tabindex", "-1");
  return ziel;
}

/**
 * Click handler for a skip link (href="#hauptinhalt"): focuses the content and
 * cancels the browser default. Needed because the HashRouter (App.jsx) reads a
 * changed hash as a route, so "#hauptinhalt" rendered the 404 page. Skips an
 * event that another handler already took care of.
 * Side effects: preventDefault on the event, focus change.
 * @param {{ defaultPrevented: boolean, preventDefault: () => void }} ereignis click event
 * @returns {void}
 */
export function springeZumInhalt(ereignis) {
  if (ereignis.defaultPrevented) return;
  ereignis.preventDefault();
  inhaltsZiel()?.focus();
}

/**
 * Title, focus, announcement and skip-link handling on route changes.
 * Renders only the (visually hidden) live region.
 * @returns {JSX.Element}
 */
export default function Seitenwechsel() {
  // pathname, not search: a ?tab switch inside a page is not a page change and
  // must not throw the focus out of the tab list.
  const { pathname } = useLocation();
  const navigationsTyp = useNavigationType();
  const { t } = useI18n();
  const [ansage, setAnsage] = React.useState("");
  const bisherigerPfad = React.useRef(/** @type {string|null} */ (null));
  const nurStart = React.useRef(true);

  const titel = seitenTitelFuer(pathname, navFlach);
  const titelText = titel ? t(titel) : "";

  React.useEffect(() => {
    document.title = dokumentTitel(titelText);
  }, [titelText]);

  React.useEffect(() => {
    const vorher = bisherigerPfad.current;
    // Same path: only the language or the navigation type changed.
    if (vorher === pathname) return;
    bisherigerPfad.current = pathname;
    // First render and the redirect chain of the initial load ("/" replaced by
    // "/Dashboard"): the user has not changed pages yet, and moving the focus
    // here would make the first Tab skip the skip link.
    if (vorher === null) return;
    if (nurStart.current && navigationsTyp === "REPLACE") return;
    nurStart.current = false;
    const ziel = inhaltsZiel();
    if (ziel) {
      // A form field the new page focused itself (autoFocus, e.g. the e-mail
      // field of the sign-in page) keeps the focus; anything else — the menu
      // link just clicked, a "Weiter mit" link — hands it to the content.
      const fokus = document.activeElement;
      const eigenesFeld = fokus && fokus !== ziel && ziel.contains(fokus) && fokus.matches("input, textarea, select");
      if (!eigenesFeld) ziel.focus({ preventScroll: true });
      ziel.scrollTop = 0;
    }
    const neuerTitel = seitenTitelFuer(pathname, navFlach);
    setAnsage(neuerTitel ? t(neuerTitel) : PRODUKTNAME);
  }, [pathname, navigationsTyp, t]);

  // Delegated on document in the capture phase, so it runs before the browser
  // follows the link and before React's own handlers. The skip link itself
  // stays untouched in Layout.jsx: its lines belong to the block Hermes 69-12
  // edits in parallel. One listener, removed on unmount.
  React.useEffect(() => {
    const beiKlick = (ereignis) => {
      if (!ereignis.target?.closest?.(`a[href="#${INHALT_ID}"]`)) return;
      springeZumInhalt(ereignis);
    };
    document.addEventListener("click", beiKlick, true);
    return () => document.removeEventListener("click", beiKlick, true);
  }, []);

  return (
    <div id="seitenansage" role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {ansage}
    </div>
  );
}
