import React from "react";
import { Input } from "@core/components/ui/input";
import { Label } from "@core/components/ui/label";

// Labeled numeric input used across the feasibility calculators.
/**
 * Zahlenfeld mit Label und optionalem Einheiten-Suffix.
 * @param {{ label?: any, value?: number|string, onChange?: (v: number) => void, step?: string|number,
 *   suffix?: string, min?: number, onBlur?: () => void }} props
 *   (typisiert, Phase 43 — vorher las tsc `onBlur` als Pflichtprop bei jedem Aufrufer)
 */
export function NumberField({ label, value, onChange, step = "any", suffix, min, onBlur }) {
  // Label and field were siblings without a link: screen readers announced a bare
  // "Eingabefeld" and a click on the label did not focus the field (A11Y-I18N-03).
  const id = React.useId();
  const einheitId = `${id}-einheit`;
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs text-slate-500">{label}</Label>
      <div className="relative">
        <Input
          id={id}
          aria-describedby={suffix ? einheitId : undefined}
          type="number"
          step={step}
          min={min}
          value={value ?? ""}
          onChange={(e) =>
            onChange(e.target.value === "" ? 0 : Number(e.target.value))
          }
          onBlur={onBlur}
          className={suffix ? "pr-12" : ""}
        />
        {suffix && (
          <span id={einheitId} className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

export function Stat({ label, value, accent = "text-slate-800" }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-lg font-bold ${accent}`}>{value}</div>
    </div>
  );
}
