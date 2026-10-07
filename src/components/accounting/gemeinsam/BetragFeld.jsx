// Amount input of the accounting module (phase 79). A text field with a
// decimal keyboard instead of <input type="number">: German amounts use a
// decimal comma and thousands dots ("1.234,56"), and NumberField would turn an
// empty field into 0 € — here empty means "no amount yet" (null), not 0.
//
// In:  value in cents (or null), label or aria-label from the caller.
// Out: onChange(cents | null) when the field loses focus; the text stays as
//      typed while an entry is not a valid amount (aria-invalid).

import React from "react";
import { parseBetragDe } from "@/lib/accounting/geld.js";

/**
 * Cents → "1.234,56" (no currency sign), empty for null.
 * @param {number|null|undefined} cent
 * @returns {string}
 */
function alsText(cent) {
  if (typeof cent !== "number" || !Number.isFinite(cent)) return "";
  return new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cent / 100);
}

/**
 * @param {{
 *   id?: string,
 *   wert: number|null,
 *   onChange: (cent: number|null) => void,
 *   label?: string,
 *   "aria-label"?: string,
 *   disabled?: boolean,
 *   className?: string,
 * }} props wert/onChange in cents; label renders a visible <label>
 * @returns {React.ReactElement}
 */
export default function BetragFeld({ id, wert, onChange, label, "aria-label": ariaLabel, disabled = false, className = "" }) {
  const eigeneId = React.useId();
  const feldId = id || `betrag-${eigeneId.replace(/:/g, "")}`;
  const [text, setText] = React.useState(() => alsText(wert));
  const [ungueltig, setUngueltig] = React.useState(false);

  // Follow a new value from outside (another record selected, reset after save).
  React.useEffect(() => {
    setText(alsText(wert));
    setUngueltig(false);
  }, [wert]);

  const uebernehmen = () => {
    const roh = text.trim();
    if (roh === "") { setUngueltig(false); onChange(null); return; }
    const cent = parseBetragDe(roh);
    if (cent === null) { setUngueltig(true); return; }
    setUngueltig(false);
    setText(alsText(cent));
    onChange(cent);
  };

  return (
    <span className="inline-flex flex-col gap-1">
      {label && <label htmlFor={feldId} className="text-sm font-medium text-slate-700">{label}</label>}
      <span className="relative inline-flex items-center">
        <input
          id={feldId}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={text}
          disabled={disabled}
          aria-label={label ? undefined : ariaLabel}
          aria-invalid={ungueltig || undefined}
          onChange={(e) => setText(e.target.value)}
          onBlur={uebernehmen}
          className={`h-9 w-36 rounded-md border border-slate-300 bg-white px-3 pr-7 text-right text-sm tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-50 aria-[invalid=true]:border-red-500 dark:border-slate-600 dark:bg-slate-900 ${className}`}
        />
        <span aria-hidden="true" className="pointer-events-none absolute right-2 text-sm text-slate-500">€</span>
      </span>
    </span>
  );
}
