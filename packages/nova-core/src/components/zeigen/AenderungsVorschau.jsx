// 106-03: the preview of a proposed change, in words. One card per open proposal: the sentence ("Wand W-12:
// Feuerwiderstand F30 → F90"), the check result line by line, where the proposal comes from, and the two buttons
// Übernehmen / Verwerfen. Under the cards the history of executed steps, each with its origin and a button that
// reverses exactly this step. Nothing here changes a model: the buttons call the handlers the viewer passes in (the
// viewer routes them through its command register, the same path as the commands).
//
// Form, not only colour (guard rail 5): a blocked result is a SOLID border with the sign "✕" and the word "Fehler",
// a warning a DASHED border with "▲" and the word "Warnung", a hint a DOTTED border with "ℹ", a check that did not run
// a dotted border with "○" in italics, and only a real "nothing found" a "✓" without border - so a hint or a missing
// check never looks like a pass. The app's token classes (warnung, fehler) add colour, they never carry the meaning alone.
//
// In:  proposals (vorschlagErzeugen records) and steps (herkunftEintrag records) - or a vorschlagSpeicher() store,
//      handlers, translator t. Out: DOM; data-testids aenderung-feld, aenderung-vorschau (data-stufe, data-vorschlag-id),
//      aenderung-satz, aenderung-pruefzeile (data-stufe), aenderung-herkunft (data-quellen), aenderung-uebernehmen,
//      aenderung-verwerfen, aenderung-verlauf, aenderung-schritt (data-herkunft, data-quellen), aenderung-zurueck.
// D-IM-07: the origin line names every origin of a step ("Spracheingabe + Agent"); an old record without a list shows its one origin.
// 106-07: `darfUebernehmen` false (the role may not change the model, rechte.js) locks Übernehmen and Zurücknehmen and says why in a
// dotted "ℹ" line (data-testid aenderung-recht) - the register refuses the same (KEIN_AENDERUNGSRECHT_TEXT), the lock here only shows
// it before the tap. `grob` (tablet) gives the buttons finger size (at least 44 px high).
import React, { useSyncExternalStore } from "react";
import { herkunftQuellen, herkunftText, satzAusVorlage } from "@core/lib/zeigen/aenderungen.js";
import { KEIN_AENDERUNGSRECHT_TEXT } from "@core/lib/zeigen/aenderungsBefehle.js";

/** Line of a card when the role may only look and propose. */
const NUR_VORSCHLAGEN_TEXT = "Nur ansehen und vorschlagen — Ihre Rolle darf das Modell nicht ändern";
/** Button size classes of the tablet layout (min. 44 px touch target). */
const GROSS = "min-h-11 px-4 text-sm";

/** Most history rows shown at once (the store keeps more) [ASSUMED: the newest five fit beside the model view]. */
const VERLAUF_ZEILEN = 5;

/** Sign, border form and token classes per level of a check line: the form says it as well as the colour. */
const STUFE = {
  fehler: { zeichen: "✕", wort: "Fehler", rand: "border border-solid border-fehler-rand bg-fehler-flaeche text-fehler" },
  warn: { zeichen: "▲", wort: "Warnung", rand: "border border-dashed border-warnung-rand bg-warnung-flaeche text-warnung" },
  hinweis: { zeichen: "ℹ", wort: "", rand: "border border-dotted border-border text-foreground" },
  ungeprueft: { zeichen: "○", wort: "", rand: "border border-dotted border-border italic text-muted-foreground" },
  ok: { zeichen: "✓", wort: "", rand: "text-muted-foreground" },
};

/** @param {string} iso @returns {string} "HH:MM" local time, "" when not readable */
const uhrzeit = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
};

/** @param {any} v  Proposal or step. @param {(s: string) => string} t @returns {string} the sentence in the UI language */
const satzVon = (v, t) => (v.satz_vorlage && v.satz_werte ? satzAusVorlage(t(v.satz_vorlage), v.satz_werte) : v.satz);

/**
 * One open proposal.
 * @param {{vorschlag: any, onUebernehmen?: (v: any) => void, onVerwerfen?: (v: any) => void, t?: (s: string) => string,
 *   darfUebernehmen?: boolean, grob?: boolean}} props
 *   vorschlag: proposal with `pruefung`; onUebernehmen / onVerwerfen get the proposal; t: translator (default German);
 *   darfUebernehmen: the role may change the model (default true); grob: tablet button size.
 */
export default function AenderungsVorschau({ vorschlag, onUebernehmen, onVerwerfen, t = (s) => s, darfUebernehmen = true, grob = false }) {
  const p = vorschlag.pruefung;
  const stufe = p?.stufe ?? "ok";
  const gesperrt = stufe === "fehler" || !darfUebernehmen;
  // lines come with their own form (check result `zeilen`); a result without them (older record) falls back to the findings
  /** @type {Array<{satz: string, stufe: string}>} */
  const zeilen = p?.zeilen ?? (p?.saetze ?? []).map((/** @type {string} */ satz, /** @type {number} */ i) => ({ satz, stufe: p.befunde?.[i]?.stufe ?? "ok" }));
  // D-IM-07: every origin of the proposal, e.g. "Spracheingabe + Agent" (each label translated on its own)
  const herkunft = herkunftText(vorschlag, t);
  return (
    <div data-testid="aenderung-vorschau" data-vorschlag-id={vorschlag.id} data-stufe={stufe}
      className="rounded border border-border bg-card p-2 text-xs text-foreground shadow">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{t("Änderung vorgeschlagen")}</div>
      <div data-testid="aenderung-satz" className="mt-0.5 font-medium">{satzVon(vorschlag, t)}</div>
      <ul className="mt-1 space-y-1">
        {zeilen.map((z, i) => {
          const s = STUFE[/** @type {keyof typeof STUFE} */ (z.stufe)] ?? STUFE.ok;
          return (
            <li key={i} data-testid="aenderung-pruefzeile" data-stufe={z.stufe} className={`flex gap-1 rounded px-1 py-0.5 ${s.rand}`}>
              <span aria-hidden="true" className="shrink-0 font-bold">{s.zeichen}</span>
              {s.wort ? <span className="shrink-0 font-semibold">{t(s.wort)}:</span> : null}
              <span>{z.satz}</span>
            </li>
          );
        })}
      </ul>
      <div data-testid="aenderung-herkunft" data-quellen={herkunftQuellen(vorschlag).join(" ")} className="mt-1 text-[10px] text-muted-foreground">
        {t("Herkunft")}: {herkunft} · {uhrzeit(vorschlag.zeit)}
      </div>
      {!darfUebernehmen ? (
        <div data-testid="aenderung-recht" className="mt-1 flex gap-1 rounded border border-dotted border-border px-1 py-0.5 text-foreground">
          <span aria-hidden="true" className="shrink-0 font-bold">ℹ</span><span>{t(NUR_VORSCHLAGEN_TEXT)}</span>
        </div>
      ) : null}
      <div className={`mt-1.5 flex ${grob ? "gap-3" : "gap-1.5"}`}>
        <button type="button" data-testid="aenderung-uebernehmen" disabled={gesperrt}
          title={!darfUebernehmen ? t(KEIN_AENDERUNGSRECHT_TEXT) : gesperrt ? t("Gesperrt — erst klären") : undefined}
          onClick={() => onUebernehmen?.(vorschlag)}
          className={`rounded bg-primary text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50 ${grob ? GROSS : "px-2 py-1"}`}>
          {t("Übernehmen")}
        </button>
        <button type="button" data-testid="aenderung-verwerfen" onClick={() => onVerwerfen?.(vorschlag)}
          className={`rounded border border-border text-foreground hover:bg-muted ${grob ? GROSS : "px-2 py-1"}`}>
          {t("Verwerfen")}
        </button>
      </div>
    </div>
  );
}

/**
 * The history of executed steps: sentence, origin, time, and a button that reverses exactly this step.
 * @param {{schritte: any[], onZuruecknehmen?: (s: any) => void, t?: (s: string) => string, darfUebernehmen?: boolean, grob?: boolean}} props
 *   schritte: origin records (herkunftEintrag) oldest first; onZuruecknehmen gets the step; darfUebernehmen false locks
 *   Zurücknehmen (106-07); grob: tablet button size.
 */
export function AenderungsVerlauf({ schritte, onZuruecknehmen, t = (s) => s, darfUebernehmen = true, grob = false }) {
  if (!schritte.length) return null;
  const zeilen = [...schritte].reverse().slice(0, VERLAUF_ZEILEN);
  return (
    <div data-testid="aenderung-verlauf" className="rounded border border-border bg-card p-2 text-xs text-foreground shadow">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{t("Änderungsverlauf")}</div>
      <ul className="mt-0.5 space-y-1">
        {zeilen.map((s) => (
          <li key={s.vorschlag_id} data-testid="aenderung-schritt" data-vorschlag-id={s.vorschlag_id}
            data-herkunft={s.herkunft} data-quellen={herkunftQuellen(s).join(" ")} data-zurueckgenommen={s.zurueckgenommen ? "ja" : "nein"} className="flex items-start gap-1">
            <div className="min-w-0 flex-1">
              <div className={s.zurueckgenommen ? "line-through" : ""}>{satzVon(s, t)}</div>
              <div className="text-[10px] text-muted-foreground">
                {herkunftText(s, t)} · {uhrzeit(s.zeit)}
                {s.zurueckgenommen ? ` · ${t("zurückgenommen")}` : ""}
              </div>
            </div>
            {!s.zurueckgenommen && (
              <button type="button" data-testid="aenderung-zurueck" data-vorschlag-id={s.vorschlag_id} onClick={() => onZuruecknehmen?.(s)}
                disabled={!darfUebernehmen} title={darfUebernehmen ? undefined : t(KEIN_AENDERUNGSRECHT_TEXT)}
                className={`shrink-0 rounded border border-border hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 ${grob ? GROSS : "px-1.5 py-0.5"}`}>{t("Zurücknehmen")}</button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The field a viewer places over its model view: all open proposals (as cards) and the history, read from the
 * viewer's store. Renders nothing while both are empty.
 * @param {{speicher: ReturnType<typeof import("@core/lib/zeigen/vorschlagSpeicher.js").vorschlagSpeicher>,
 *   onUebernehmen?: (v: any) => void, onVerwerfen?: (v: any) => void, onZuruecknehmen?: (s: any) => void,
 *   t?: (s: string) => string, className?: string, darfUebernehmen?: boolean, grob?: boolean}} props
 *   className: placement classes of the viewer (position, width); darfUebernehmen / grob: see AenderungsVorschau (106-07).
 */
export function AenderungsFeld({ speicher, onUebernehmen, onVerwerfen, onZuruecknehmen, t = (s) => s, className = "", darfUebernehmen = true, grob = false }) {
  const stand = useSyncExternalStore(speicher.abonnieren, speicher.stand);
  if (!stand.offen.length && !stand.verlauf.length) return null;
  return (
    <div data-testid="aenderung-feld" className={`flex flex-col gap-1.5 ${className}`}>
      {stand.offen.map((v) => (
        <AenderungsVorschau key={v.id} vorschlag={v} onUebernehmen={onUebernehmen} onVerwerfen={onVerwerfen} t={t} darfUebernehmen={darfUebernehmen} grob={grob} />
      ))}
      <AenderungsVerlauf schritte={/** @type {any[]} */ (stand.verlauf)} onZuruecknehmen={onZuruecknehmen} t={t} darfUebernehmen={darfUebernehmen} grob={grob} />
    </div>
  );
}
