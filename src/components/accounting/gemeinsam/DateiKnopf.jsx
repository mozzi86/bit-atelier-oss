// File picker button of the accounting module (phase 79): a visible button plus
// a hidden <input type="file">. A <label> around the input is not reachable
// with Tab (IfcViewer.jsx pattern); the button is.
//
// In:  accept (file types), onDatei(file), button text from the caller.
// Out: calls onDatei with the chosen File; the input is reset so the same file
//      can be chosen twice (a corrected re-import).

import React from "react";
import { buttonVariants } from "@core/components/ui/button";

/**
 * @param {{
 *   accept?: string,
 *   onDatei: (datei: File) => void,
 *   children: React.ReactNode,
 *   disabled?: boolean,
 *   variant?: "default"|"outline"|"secondary"|"ghost",
 * }} props accept: e.g. ".csv,text/csv"; children: button text
 * @returns {React.ReactElement}
 */
export default function DateiKnopf({ accept, onDatei, children, disabled = false, variant = "outline" }) {
  const eingabe = React.useRef(/** @type {HTMLInputElement|null} */ (null));
  return (
    <>
      <input
        ref={eingabe}
        type="file"
        accept={accept}
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        disabled={disabled}
        onChange={(e) => {
          const datei = e.target.files?.[0];
          e.target.value = "";
          if (datei) onDatei(datei);
        }}
      />
      <button type="button" disabled={disabled} className={buttonVariants({ variant })} onClick={() => eingabe.current?.click()}>
        {children}
      </button>
    </>
  );
}
