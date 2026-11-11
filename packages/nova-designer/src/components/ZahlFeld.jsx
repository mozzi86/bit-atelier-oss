// Number field that keeps the typed text locally and commits once, on blur or
// Enter, clamped to min/max. A commit per keystroke would be one undo step per
// digit (the studio records history in the setters).
//
// In:  value (number or empty), min/max in the field's unit, onCommit(number).
// Out: one onCommit call per finished edit, or none when the text is not a number.

import React, { useState } from "react";
import { zahlKlemmen } from "@designer/lib/zeichnenModell.js";

/**
 * @param {{ value: number|string|null|undefined, min?: number, max?: number, step?: string|number,
 *   onCommit: (wert: number) => void, onLeer?: () => void, className?: string, testid?: string,
 *   ariaLabel?: string, placeholder?: string, title?: string }} props
 *   onLeer: optional, when a field that already holds a number is cleared
 *   (opening sizes: empty means "use the type size").
 */
export default function ZahlFeld({ value, min, max, step = "0.01", onCommit, onLeer, className, testid, ariaLabel, placeholder, title }) {
  const [text, setText] = useState(/** @type {string|null} */ (null));
  const gezeigt = text ?? (value == null || value === "" ? "" : String(value));
  const fest = () => {
    const roh = text ?? gezeigt;
    const r = zahlKlemmen(roh, min, max);
    setText(null);
    if (!r) return;
    if (r.leer) {
      if (onLeer && !(value == null || value === "")) onLeer();
      return;
    }
    const wert = /** @type {{ leer: false, wert: number }} */ (r).wert;
    if (wert !== Number(value)) onCommit(wert);
  };
  return (
    <input
      type="number"
      inputMode="decimal"
      step={step}
      min={min}
      max={max}
      className={className}
      value={gezeigt}
      placeholder={placeholder}
      title={title}
      aria-label={ariaLabel}
      data-testid={testid}
      onFocus={() => setText(gezeigt)}
      onChange={(e) => setText(e.target.value)}
      onBlur={fest}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
      }}
    />
  );
}
