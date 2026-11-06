// 106-09: the sync between devices as the person sees it, beside the model view of a viewer (BIM studio, IFC viewer),
// and - review 106-09 - as a page-wide card in the Layout for conflicts no mounted viewer shows (a conflict of an editor
// layer, a studio conflict while the designer shows another tab). Loaded lazily (React.lazy) only when there is
// something to show, so the pages do not carry it.
//
//   Konflikt   two devices changed the same element at the same time: both versions side by side, nothing was
//              overwritten, saving that part waits. Two ways out: keep mine / take the other device's version. Both
//              write (the studio and the editors save the chosen version, the IFC viewer adds a journal entry), so both
//              need a role that may change the model (106-07); the choice is the person's step with origin "hand".
//   Hinweis    a change saved on another device arrived here: what changed, from which device, its origin (hand / text /
//              sprache / agent / bild) and how the person there confirmed it - it is NOT confirmed again here (D-IM-04).
//              When open proposals of this page became stale by it, a dashed line says how many.
//   Getrennt   the change stream is down (review 106-09): a dashed line with "▲" and the reason; it reconnects by itself.
//
// Form, not only colour (guard rail 5): a conflict is a SOLID border with "✕" and the word "Konflikt", a stale proposal or
// a broken stream a DASHED line with "▲", a note a DOTTED border with "ℹ". The token classes (fehler, warnung) add colour,
// never the meaning. Borders use the strong tokens (fehler 7.4:1, warnung 12.8:1 on white, farbsehen.mjs) and
// muted-foreground for the note, not the pale *-rand / border tokens (about 1.3:1), so the FORM stays visible without colour.
//
// In:  abgleichStand (store), translator t, darfAendern (role may change the model), grob (tablet), quellen (sources of
//      the conflicts shown, null = all), nurKonflikte (page-wide card: conflicts only).
// Out: DOM; data-testids abgleich-feld, abgleich-konflikt (data-feld, data-quelle), abgleich-konflikt-zeile, abgleich-mein,
//      abgleich-fremd, abgleich-hinweis, abgleich-hinweis-zeile (data-herkunft), abgleich-veraltet, abgleich-hinweis-weg,
//      abgleich-getrennt.
import React, { useState, useSyncExternalStore } from "react";
import { abgleichStand, sichtbareKonflikte } from "@core/lib/abgleich/abgleichStand.js";
import { herkunftText } from "@core/lib/zeigen/aenderungen.js";

/** Words for the channel that confirmed a step on the other device. */
const BESTAETIGT = Object.freeze({ hand: "per Hand bestätigt", sprache: "per Sprache bestätigt", tastatur: "per Tastatur bestätigt" });
/** Button size of the tablet layout (min. 44 px touch target). */
const GROSS = "min-h-11 px-4 text-sm";

/**
 * @param {{name?: string, unbekannt?: boolean}|null} g @param {(s: string) => string} t
 * @returns {string} the device in words; null = another window on this computer; unbekannt = not known who
 */
const geraetText = (g, t) => (g?.name ? `„${g.name}“` : g?.unbekannt ? t("einem anderen Fenster oder Gerät") : t("einem anderen Fenster an diesem Rechner"));

/**
 * @param {{t?: (s: string) => string, darfAendern?: boolean, grob?: boolean, className?: string,
 *   quellen?: ReadonlyArray<string>|null, nurKonflikte?: boolean}} props
 */
export default function AbgleichHinweise({ t = (s) => s, darfAendern = true, grob = false, className = "", quellen = null, nurKonflikte = false }) {
  const s = useSyncExternalStore(abgleichStand.abonnieren, abgleichStand.stand);
  const [fehler, setFehler] = useState(/** @type {string|null} */ (null));
  const konflikte = sichtbareKonflikte(s, quellen);
  const hinweise = nurKonflikte ? [] : s.hinweise;
  const getrennt = !nurKonflikte && s.verbindung.status === "getrennt";
  if (!hinweise.length && !konflikte.length && !getrennt) return null;
  const knopf = grob ? GROSS : "px-2 py-1";
  const gesperrtText = t("Ihre Rolle darf das Modell nicht ändern — die Entscheidung trifft eine Person mit Änderungsrecht");
  /** @param {string} id @param {"mein"|"fremd"} wahl */
  const loesen = (id, wahl) => {
    if (!darfAendern) return;
    setFehler(null);
    abgleichStand.konfliktLoesen(id, wahl).catch((/** @type {any} */ e) => setFehler(t(String(e?.message || e))));
  };
  return (
    <div data-testid="abgleich-feld" className={`space-y-2 text-xs ${className}`}>
      {getrennt ? (
        <div data-testid="abgleich-getrennt" role="status" className="rounded border border-dashed border-warnung bg-card px-2 py-1 text-foreground shadow">
          <span aria-hidden="true" className="font-bold text-warnung">▲ </span>
          <span className="font-semibold">{t("Abgleich mit anderen Geräten unterbrochen")}</span>
          {s.verbindung.grund ? <span className="text-muted-foreground"> — {t(s.verbindung.grund)}</span> : null}
        </div>
      ) : null}
      {konflikte.map((k) => (
        <div key={k.id} data-testid="abgleich-konflikt" data-feld={k.feld} data-quelle={k.quelle} role="alert"
          className="rounded border-2 border-solid border-fehler bg-card p-2 text-foreground shadow">
          <div className="flex items-center gap-1 font-semibold text-fehler">
            <span aria-hidden="true">✕</span><span>{t("Konflikt")}:</span><span className="text-foreground">{t(k.titel)}</span>
          </div>
          <div className="mt-0.5 text-muted-foreground">
            {t("Gleichzeitig hier und auf {geraet} geändert — nichts wurde überschrieben. Dieser Teil wird erst wieder gespeichert, wenn Sie entscheiden.").replace("{geraet}", geraetText(k.geraet, t))}
          </div>
          <table className="mt-1 w-full border-collapse">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="pr-1 font-semibold">{t("Bauteil")}</th>
                <th className="pr-1 font-semibold">{t("Hier")}</th>
                <th className="font-semibold">{t("Anderes Gerät")}</th>
              </tr>
            </thead>
            <tbody>
              {k.zeilen.map((z, i) => (
                <tr key={`${z.schluessel ?? "feld"}-${i}`} data-testid="abgleich-konflikt-zeile" className="border-t border-border align-top">
                  <td className="pr-1 font-medium">{z.schluessel == null ? t(z.name) : z.name}</td>
                  <td className="pr-1" data-testid="abgleich-konflikt-mein">{z.mein}</td>
                  <td data-testid="abgleich-konflikt-fremd">{z.fremd}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" data-testid="abgleich-mein" disabled={!darfAendern} title={darfAendern ? undefined : gesperrtText}
              onClick={() => loesen(k.id, "mein")}
              className={`rounded bg-primary text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50 ${knopf}`}>{t("Meine Fassung behalten")}</button>
            <button type="button" data-testid="abgleich-fremd" disabled={!darfAendern} title={darfAendern ? undefined : gesperrtText}
              onClick={() => loesen(k.id, "fremd")}
              className={`rounded border border-border text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 ${knopf}`}>{t("Fassung des anderen Geräts übernehmen")}</button>
          </div>
          {!darfAendern ? <div className="mt-1 text-muted-foreground"><span aria-hidden="true">ℹ </span>{gesperrtText}</div> : null}
          {k.fremdHinweis ? <div className="mt-1 text-muted-foreground"><span aria-hidden="true">ℹ </span>{t(k.fremdHinweis)}</div> : null}
        </div>
      ))}
      {fehler ? <div role="alert" className="rounded border border-solid border-fehler-rand bg-fehler-flaeche px-2 py-1 text-fehler">✕ {fehler}</div> : null}
      {hinweise.map((h) => (
        <div key={h.id} data-testid="abgleich-hinweis" className="rounded border border-dotted border-muted-foreground bg-card p-2 text-foreground shadow">
          <div className="flex items-start gap-1">
            <span aria-hidden="true" className="font-bold">ℹ</span>
            <span className="flex-1 font-semibold">{t("Änderung von {geraet} übernommen — dort von der Person bestätigt").replace("{geraet}", geraetText(h.geraet, t))}</span>
            <button type="button" data-testid="abgleich-hinweis-weg" aria-label={t("Hinweis schließen")} onClick={() => abgleichStand.hinweisWeg(h.id)}
              className="shrink-0 rounded px-1 text-muted-foreground hover:bg-muted">✕</button>
          </div>
          <ul className="mt-1 space-y-0.5">
            {h.zeilen.map((z, i) => (
              <li key={i} data-testid="abgleich-hinweis-zeile" data-herkunft={(z.herkunft || []).join("+")}>
                <span>{z.text}</span>
                {z.herkunft?.length ? (
                  <span className="text-muted-foreground"> · {t("Herkunft")}: {herkunftText({ herkunft: z.herkunft[0], herkunft_quellen: z.herkunft }, t)}
                    {z.bestaetigt_durch ? `, ${t(/** @type {any} */ (BESTAETIGT)[z.bestaetigt_durch] ?? z.bestaetigt_durch)}` : ""}</span>
                ) : null}
              </li>
            ))}
          </ul>
          {h.veraltet ? (
            <div data-testid="abgleich-veraltet" className="mt-1 rounded border border-dashed border-warnung bg-warnung-flaeche px-1 py-0.5 text-warnung">
              <span aria-hidden="true" className="font-bold">▲ </span>
              {(h.veraltet === 1 ? t("1 offener Vorschlag hier ist dadurch veraltet und gesperrt") : t("{n} offene Vorschläge hier sind dadurch veraltet und gesperrt").replace("{n}", String(h.veraltet)))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
