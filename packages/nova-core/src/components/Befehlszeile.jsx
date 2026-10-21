// Befehlszeile — the CAD-style command line under a drawing (phase 101-06): which command runs, what the
// next input expects, the typed-input field and the last message. Shared by Massing-Studio and
// Baufeld-Planung; sticks to the bottom of its scrolling column so it stays in view.
//
// In:  befehl / aufforderung (already translated), optional input field, optional message.
// Out: one compact row; no state of its own.
import React from "react";

/**
 * @param {{befehl: string, aufforderung: string, meldung?: string, meldungTestid?: string,
 *   eingabe?: {id: string, value: string, onChange: (v: string) => void, onSubmit: () => void, placeholder?: string,
 *     disabled?: boolean, testid?: string, label: string, vorschlaege?: string[]},
 *   schalter?: Array<{id: string, label: string, an: boolean, titel?: string, onClick: () => void}>, schalterTestid?: string,
 *   testid?: string}} props
 *   schalter (104-05): switch chips at the right end (FANG ORTHO POLAR RASTER, like a CAD status bar), aria-pressed
 */
export default function Befehlszeile({ befehl, aufforderung, meldung = "", meldungTestid, eingabe, schalter = undefined, schalterTestid = "schalter", testid = "befehlszeile" }) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid={testid}
      data-befehl={befehl}
      className="sticky bottom-0 z-10 mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-foreground px-2.5 py-1 font-mono text-xs text-background"
    >
      <span className="font-semibold">{befehl}:</span>
      <span className="min-w-0 flex-1 truncate" title={aufforderung}>{aufforderung}</span>
      {eingabe && (
        <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); eingabe.onSubmit(); }}>
          <label className="opacity-70" htmlFor={eingabe.id}>{eingabe.label}</label>
          <input
            id={eingabe.id}
            disabled={eingabe.disabled}
            value={eingabe.value}
            onChange={(e) => eingabe.onChange(e.target.value)}
            placeholder={eingabe.placeholder}
            list={eingabe.vorschlaege?.length ? `${eingabe.id}-vorschlaege` : undefined}
            data-testid={eingabe.testid}
            className="w-28 rounded border border-background/40 bg-background px-1.5 py-0.5 text-right text-foreground tabular-nums disabled:opacity-50"
          />
          {/* 104-02: autocomplete of command names while no command runs */}
          {eingabe.vorschlaege?.length ? (
            <datalist id={`${eingabe.id}-vorschlaege`}>
              {eingabe.vorschlaege.map((v) => <option key={v} value={v} />)}
            </datalist>
          ) : null}
        </form>
      )}
      <span className="opacity-80" data-testid={meldungTestid}>{meldung}</span>
      {schalter?.length ? (
        <span className="ml-auto flex items-center gap-1">
          {schalter.map((s) => (
            <button key={s.id} type="button" aria-pressed={s.an} title={s.titel} onClick={s.onClick} data-testid={`${schalterTestid}-${s.id}`}
              className={`rounded border px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide ${s.an ? "border-background bg-background text-foreground" : "border-background/40 text-background/70 hover:text-background"}`}>
              {s.label}
            </button>
          ))}
        </span>
      ) : null}
    </div>
  );
}
