// 106-05: the push-to-talk button of the speech field (106-RESEARCH §3: speech at the model). Hold the button (or Leertaste + V) while
// speaking, let go to send. The button only reports pressing and releasing; recording, recognition and what happens with the text are the
// speech field's job (zeigen/SprechFeld.jsx), so the button looks the same wherever it is used.
//
// States, shown by form as well as by colour: "bereit" (microphone), "aufnahme" (filled dot + the word "Aufnahme"), "erkennt" (spinner +
// "Erkennt …"). A disabled-looking button stays clickable on purpose: a click explains in words why speech is not available.
//
// 106-07: `gross` = the tablet form - a round button of 64 px (finger size, above the 44 px minimum of touch targets), icon
// and word stacked, its ring in the foreground token (19.8:1 on the card; the light border token has 1.26:1, too faint to find the
// button with a finger, checked with the bit-farbsehen script); the speech field puts it at the outer right end, where the right
// thumb rests on a tablet held at its sides.
//
// Review 106-07: `className` places the button in its row (the speech field moves it with CSS order, never by re-mounting it: a re-mount
// under a pressed finger loses the pointer capture and the release).
//
// In:  zustand, handlers onStart / onStopp, title, gross, className, t. Out: a button (data-testid sprech-knopf, data-zustand, data-gross).
import React from "react";
import { Mic, Loader2 } from "lucide-react";

/**
 * @param {{zustand: "bereit"|"aufnahme"|"erkennt"|"aus", onStart: () => void, onStopp: () => void, title?: string, gross?: boolean, className?: string, t?: (s: string) => string}} props
 *   zustand: what the field is doing; "aus" = speech is not available (the button explains on click); gross: tablet form (64 px);
 *   className: extra classes for the place in the row (e.g. order-last).
 */
export default function SprechKnopf({ zustand, onStart, onStopp, title, gross = false, className = "", t = (s) => s }) {
  const aufnahme = zustand === "aufnahme";
  const erkennt = zustand === "erkennt";
  return (
    <button type="button" data-testid="sprech-knopf" data-zustand={zustand} data-gross={gross ? "ja" : "nein"} title={title}
      aria-label={t("Zum Sprechen halten")} aria-pressed={aufnahme} aria-disabled={zustand === "aus"}
      // pointer events: press and hold works with mouse, pen and touch; leaving the button with the pointer down also ends the recording
      // pointer capture: starting a recording changes the field's height (the last answer disappears) and the button moves under the
      // pointer; without capture the release would land beside it and the recording would never stop
      onPointerDown={(e) => { e.preventDefault(); try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ } onStart(); }}
      onPointerUp={() => onStopp()} onPointerLeave={() => { if (aufnahme) onStopp(); }} onPointerCancel={() => { if (aufnahme) onStopp(); }}
      onKeyDown={(e) => { if (e.key === "Enter" && !e.repeat) { e.preventDefault(); onStart(); } }}
      onKeyUp={(e) => { if (e.key === "Enter") onStopp(); }}
      className={`flex shrink-0 select-none items-center touch-none border ${gross ? "h-16 w-16 flex-col justify-center gap-0.5 rounded-full border-2 text-[11px] font-semibold" : "gap-1 rounded px-2 py-1 text-xs"} ${aufnahme ? "border-primary bg-primary text-primary-foreground" : `${gross ? "border-foreground" : "border-border"} bg-card text-foreground hover:bg-muted`} ${zustand === "aus" ? "opacity-60" : ""} ${className}`}>
      {erkennt ? <Loader2 aria-hidden="true" className={`${gross ? "h-6 w-6" : "h-3.5 w-3.5"} animate-spin`} /> : <Mic aria-hidden="true" className={gross ? "h-6 w-6" : "h-3.5 w-3.5"} />}
      {aufnahme ? <><span aria-hidden="true">●</span><span>{t("Aufnahme")}</span></> : erkennt ? <span>{t("Erkennt …")}</span> : <span>{t("Sprechen")}</span>}
    </button>
  );
}
