// RegelwerkTabelle — generic, data-driven editor for ONE visible rule book of
// "Einstellungen › Regelwerke" (80-07, E-16), reused for every group (accounting,
// HR, later phase 81's calculation values). Same pattern as KatalogEditor.jsx
// (packages/nova-core/src/components/catalogs/): the rows are DATA, not fourteen
// hand-built forms, and writing is REFUSED (pruefeOverride, inside onSetzen), not
// merely warned about.
//
// Native <table>/<button>/<input>/<select> throughout (no shadcn Card/Select/Badge
// wrappers): each forwardRef shadcn part costs a tsc error under the current React
// typing (79-01 deviation 3), and this file has no CardTitle to begin with
// (CONSISTENCY-10 is moot, not just satisfied).
//
// In:  `zeilen` = one group's `abschnitte` from @core/lib/regelwerk.js
//      tabellenZeilen() ([{titel, zeilen: [{regel, standard, wirksam, override,
//      status, editierbar, rechenwegAnzeige}]}]); `onSetzen`/`onZuruecksetzen`/
//      `onGruppeZuruecksetzen` are already bound to one RegelGruppe by the caller
//      (RegelwerkBereich.jsx) — this component never imports the write path itself.
// Out: the table; every mutation goes through the three callback props.
//
// Formula/table display (Minijob-Formel, Kündigungsstaffel): this component has no
// `wertVon` reader of its own (only the caller, through useRegelWerte, does), so the
// formula TEXT cannot be recomputed here — `tabellenZeilen()` already attaches it
// per row as `rechenwegAnzeige` (regelwerk.js, 80-07 task 1 addition) and this file
// only renders it.

import React from "react";
import { toast } from "sonner";
import { useI18n } from "@core/lib/i18n";
import { useBestaetigung } from "@core/lib/useBestaetigung";

/** Money/number formatting without a Euro-specific helper (this package may not import the app's own accounting/geld.js). */
const zahlText = (x, lang) => new Intl.NumberFormat(lang === "en" ? "en-GB" : "de-DE", { maximumFractionDigits: 2 }).format(x);
const euroText = (x, lang) => new Intl.NumberFormat(lang === "en" ? "en-GB" : "de-DE", { style: "currency", currency: "EUR" }).format(x);

/** dd.mm.yyyy (or its EN order) from 'YYYY-MM-DD'; empty string for anything else. @param {any} tag */
function datumText(tag, lang) {
  if (typeof tag !== "string" || tag.length < 10) return "";
  const [j, m, t] = [tag.slice(0, 4), tag.slice(5, 7), tag.slice(8, 10)];
  return lang === "en" ? `${t}/${m}/${j}` : `${t}.${m}.${j}`;
}

const STATUS_TEXT = Object.freeze({
  standard: "Standard", geplant: "geplant", abweichend: "abweichend", veraltet: "veraltet – prüfen",
  gesetzlich: "gesetzlich", formel: "berechnet", fest: "fest",
});
const STATUS_KLASSE = Object.freeze({
  standard: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  geplant: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-100",
  abweichend: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100",
  veraltet: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-100",
  gesetzlich: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  formel: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  fest: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
});

const HERKUNFT_TEXT = Object.freeze({ gesetz: "gesetzlich", buero: "Bürostandard", praxis: "Praxiswert" });

/**
 * Unit suffix for a Euro-valued `typ:'zahl'`/`'formel'` rule ("Euro/Stunde" →
 * "/Stunde"), translated as a whole word (each key is its own i18n entry — the
 * slash form reads naturally in both languages, e.g. "13,90 €/hour").
 * @type {Readonly<Record<string, string>>}
 */
const EURO_SUFFIX = Object.freeze({ "Euro/Stunde": "/Stunde", "Euro/Monat": "/Monat", "Euro/km": "/km", Euro: "" });

/**
 * Units of every non-Euro `typ:'zahl'` rule of the accounting and HR rule books
 * that carry an i18n entry (mirrors EinstellungenDialog.jsx's einheitText() for
 * the accounting subset; extended here for HR — 80-01-SUMMARY "Offen": the HR
 * units had no EN yet, entered by this plan in i18nTeile/einstellungen.js).
 * `wertText` calls `t(regel.einheit)` only for a unit listed here; one missing
 * would just show untranslated (there is none left among the rules this editor
 * renders as of 80-07; a future rule book would add its own entry).
 * @type {ReadonlySet<string>}
 */
const EINHEIT_UEBERSETZT = new Set([
  "Tag", "Tage", "Monate", "Jahre", "Prozentpunkte", "Werktage", "Arbeitstage",
  "Tage/Woche", "Stunden/Woche", "Anzahl", "MB", "km", "g/km", "Byte",
]);

const FELD = "h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-slate-600 dark:bg-slate-900";
const BTN = "rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800";
const BTN_PRIMARY = "rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500";

/**
 * Read-only display text of a value (legal/practice/fixed rows, and the "Standard"
 * column for every row). Rule-specific tables (Kündigungsstaffel …) are handled by
 * the caller through `rechenweg` and passed in as `rechenwegAnzeige`.
 * @param {import("@core/lib/regelwerk.js").Regel} regel
 * @param {any} wert
 * @param {string} lang
 * @param {(s: string) => string} t
 * @returns {string}
 */
function wertText(regel, wert, lang, t) {
  if (wert === null || wert === undefined) return "—";
  switch (regel.typ) {
    case "prozent": return `${zahlText(wert, lang)} %`;
    case "betrag": return euroText(wert, lang);
    // `formel` (e.g. personal.minijob_grenze) is a plain computed number and
    // follows the same unit-driven display as `zahl` — there is no separate case.
    case "zahl": case "formel": {
      if (typeof wert !== "number") return String(wert);
      const suffix = Object.prototype.hasOwnProperty.call(EURO_SUFFIX, regel.einheit) ? EURO_SUFFIX[regel.einheit] : null;
      if (suffix !== null) return `${euroText(wert, lang)}${suffix}`;
      const einheit = regel.einheit ? (EINHEIT_UEBERSETZT.has(regel.einheit) ? t(regel.einheit) : regel.einheit) : "";
      return `${zahlText(wert, lang)}${einheit ? ` ${einheit}` : ""}`.trim();
    }
    case "monatstag": return typeof wert === "string" && wert.length === 5 ? datumText(`2000-${wert}`, lang).slice(0, lang === "en" ? 5 : 6) : String(wert);
    case "datum": return datumText(wert, lang);
    case "ja_nein": return wert ? t("Ja") : t("Nein");
    case "auswahl": { const o = (regel.optionen || []).find((x) => x.wert === wert); return o ? o.label : String(wert); }
    case "termine": return (Array.isArray(wert) ? wert : []).map((mmtt) => `${mmtt.slice(3, 5)}.${mmtt.slice(0, 2)}.`).join(", ");
    case "liste": return t("{n} Einträge").replace("{n}", String(Array.isArray(wert) ? wert.length : 0));
    case "tabelle": return t("{n} Zeilen").replace("{n}", String(Array.isArray(wert) ? wert.length : 0));
    case "objekt": return t("{n} Werte").replace("{n}", String(wert && typeof wert === "object" ? Object.keys(wert).length : 0));
    case "text": return String(wert);
    default: return String(wert);
  }
}

/** Whether a rule's own value is entered through a native `<select>` (auswahl, ja_nein). */
const istAuswahl = (typ) => typ === "auswahl" || typ === "ja_nein";
/** Types the inline editor can write; everything else is shown read-only (task 3). */
const EDITIERBARE_TYPEN = new Set(["zahl", "prozent", "monatstag", "auswahl", "ja_nein", "datum", "text"]);

/**
 * Parses the raw input of one editable type into the value `pruefeOverride`
 * expects; unparsable input is passed through so the check rejects it visibly.
 * @param {string} typ @param {string} roh
 */
function parseEingabe(typ, roh) {
  switch (typ) {
    case "zahl": case "prozent": {
      const n = Number(roh.trim().replace(",", "."));
      return roh.trim() === "" || !Number.isFinite(n) ? Number.NaN : n;
    }
    case "ja_nein": return roh === "ja";
    default: return roh;
  }
}

/**
 * Translates a rejection or warning of `setzeRegel` (useRegelwerkBearbeiten.js):
 * `schluessel` is the untranslated REGEL_PRUEFTEXTE template, `werte` its
 * placeholder values — regelwerk.js's own file header describes exactly this
 * split so the editor can show the message in the active language instead of the
 * German text `pruefeOverride` builds for itself. Falls back to that German
 * `text` when a caller (a test double, an older client) supplies neither.
 * @param {{text?: string, schluessel?: string, werte?: Record<string, string>}|null|undefined} befund
 * @param {(k: string) => string} t
 * @returns {string|null}
 */
function befundText(befund, t) {
  if (!befund) return null;
  if (!befund.schluessel) return befund.text ?? null;
  return t(befund.schluessel).replace(/\{(\w+)\}/g, (_, k) => String(befund.werte?.[k] ?? ""));
}

/**
 * @param {{
 *   gruppe: string, zeilen: Array<{titel: string, zeilen: any[]}>, speicherArt: string,
 *   onSetzen: (id: string, eingabe: {wert: any, gueltig_ab?: string, notiz?: string}) => Promise<{ok: boolean, text?: string, schluessel?: string, werte?: Record<string, string>, warnung?: {schwere: string, text: string, schluessel: string, werte: Record<string, string>}}>,
 *   onZuruecksetzen: (id: string) => Promise<void>,
 *   onGruppeZuruecksetzen: () => Promise<void>,
 *   fokusId?: string|null,
 *   abschnittHinweise?: Record<string, string>,
 * }} props abschnittHinweise: an extra line shown under a section header, keyed by
 *   its (untranslated) title — RegelwerkBereich.jsx uses it for the "Erinnerungen"
 *   section's note (behavior 12/E-16); a title without an entry shows nothing extra.
 * @returns {React.ReactElement}
 */
export default function RegelwerkTabelle({ gruppe, zeilen, speicherArt, onSetzen, onZuruecksetzen, onGruppeZuruecksetzen, fokusId, abschnittHinweise }) {
  const { t, lang } = useI18n();
  const bestaetige = useBestaetigung();
  const [bearbeitungId, setBearbeitungId] = React.useState(/** @type {string|null} */ (null));
  const [entwurf, setEntwurf] = React.useState({ wert: "", gueltig_ab: "" });
  const [fehler, setFehler] = React.useState(/** @type {string|null} */ (null));
  const [busy, setBusy] = React.useState(false);
  const zeilenRefs = React.useRef(/** @type {Record<string, HTMLTableRowElement|null>} */ ({}));

  React.useEffect(() => {
    if (!fokusId) return;
    const el = zeilenRefs.current[fokusId];
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    // A read-only row (gesetzlich/formel/fest) has no button/input/select of its
    // own to receive the focus — fall back to the row itself (tabIndex={-1} on
    // the <tr>, below) so "fokussiert genau diese Zeile" holds for every row,
    // not only editable ones.
    (/** @type {HTMLElement|null} */ (el.querySelector("button, input, select")) ?? el).focus();
  }, [fokusId, zeilen]);

  const editierbarerWert = (zeile) => (zeile.override && Object.prototype.hasOwnProperty.call(zeile.override, "wert") ? zeile.override.wert : zeile.wirksam.wert);

  const beginnen = (zeile) => {
    setFehler(null);
    const wert = editierbarerWert(zeile);
    setEntwurf({
      wert: istAuswahl(zeile.regel.typ) ? String(zeile.regel.typ === "ja_nein" ? (wert ? "ja" : "nein") : wert)
        : wert === null || wert === undefined ? "" : String(wert),
      gueltig_ab: zeile.override?.gueltig_ab || "",
    });
    setBearbeitungId(zeile.regel.id);
  };

  const abbrechen = () => { setBearbeitungId(null); setFehler(null); };

  const speichern = async (zeile) => {
    const wert = parseEingabe(zeile.regel.typ, entwurf.wert);
    setBusy(true);
    try {
      const eingabe = { wert };
      if (speicherArt === "zeilen" && entwurf.gueltig_ab) eingabe.gueltig_ab = entwurf.gueltig_ab;
      const ergebnis = await onSetzen(zeile.regel.id, eingabe);
      if (!ergebnis.ok) { setFehler(befundText(ergebnis, t) || t("Wert nicht übernommen")); return; }
      setBearbeitungId(null);
      setFehler(null);
      if (ergebnis.warnung) toast.warning(befundText(ergebnis.warnung, t));
    } finally {
      setBusy(false);
    }
  };

  const zurueckAufStandard = async (zeile) => {
    if (!(await bestaetige({ titel: t("Auf Standard zurücksetzen?"), text: t(zeile.regel.label) }))) return;
    setBusy(true);
    try { await onZuruecksetzen(zeile.regel.id); } finally { setBusy(false); }
  };

  const alleZuruecksetzen = async (anzahl) => {
    if (!(await bestaetige({ titel: t("Alle Regeln dieser Gruppe auf Standard zurücksetzen?"), text: t("{n} Werte betroffen").replace("{n}", String(anzahl)) }))) return;
    setBusy(true);
    try { await onGruppeZuruecksetzen(); } finally { setBusy(false); }
  };

  const editierbareAnzahl = zeilen.reduce((n, a) => n + a.zeilen.filter((z) => z.editierbar).length, 0);

  return (
    <div className="space-y-6" data-testid={`regelwerk-tabelle-${gruppe}`}>
      {editierbareAnzahl > 0 && (
        <div className="flex justify-end">
          <button type="button" className={BTN} onClick={() => alleZuruecksetzen(editierbareAnzahl)} disabled={busy}>
            {t("Alle zurücksetzen")}
          </button>
        </div>
      )}
      {zeilen.map((abschnitt) => (
        <div key={abschnitt.titel} className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t(abschnitt.titel)}</h3>
          {abschnittHinweise?.[abschnitt.titel] && (
            <p className="text-xs text-slate-500 dark:text-slate-400">{t(abschnittHinweise[abschnitt.titel])}</p>
          )}
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800/60">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-300">{t("Bezeichnung")}</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-300">{t("Standard")}</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-300">{t("Ihr Wert")}</th>
                  {speicherArt === "zeilen" && <th scope="col" className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-300">{t("gültig ab")}</th>}
                  <th scope="col" className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-300">{t("Status")}</th>
                  <th scope="col" className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {abschnitt.zeilen.map((zeile) => {
                  const { regel } = zeile;
                  const bearbeitet = bearbeitungId === regel.id;
                  const kannBearbeiten = zeile.editierbar && EDITIERBARE_TYPEN.has(regel.typ);
                  const rw = zeile.rechenwegAnzeige;
                  return (
                    <tr key={regel.id} data-regel={regel.id} tabIndex={-1} ref={(el) => { zeilenRefs.current[regel.id] = el; }}>
                      <td className="px-3 py-2 align-top text-slate-700 dark:text-slate-200">{t(regel.label)}</td>
                      <td className="px-3 py-2 align-top text-slate-700 dark:text-slate-200">
                        <div>
                          {wertText(regel, zeile.standard, lang, t)}
                          {/* wirksam.ab is the standard row's own valid-from date whenever there is
                              no override (every read-only row here) — a formula/table row has none. */}
                          {zeile.wirksam.ab && (
                            <span className="ml-1 text-slate-600 dark:text-slate-300">{t("ab {datum}").replace("{datum}", datumText(zeile.wirksam.ab, lang))}</span>
                          )}
                        </div>
                        <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                          {t(HERKUNFT_TEXT[regel.art] || "")}
                          {regel.assumed && <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-[10px] text-amber-900 dark:bg-amber-950 dark:text-amber-200">{t("Annahme")}</span>}
                          {/* t(regel.quelle) translates plain-word sources like "Bürostandard"
                              and passes a legal citation ("§ 622 Abs. 3 BGB") through unchanged —
                              t() falls back to the key itself when no EN entry exists. */}
                          <span className="ml-1">{t("Quelle")}: {t(regel.quelle)}{regel.stand ? ` (${t("Stand")} ${datumText(regel.stand, lang)})` : ""}</span>
                        </div>
                        {/* The [ASSUMED] REASON (regel.assumed as a string — dozens of German-only
                            prose sentences across the HR and 79 rule books, never translated even
                            in 79's own dialog) stays out of the UI on purpose: only the "Annahme"
                            badge above is shown, exactly like EinstellungenDialog.jsx's precedent. */}
                        {rw?.text && <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400" data-testid="regel-rechenweg">{rw.text}</div>}
                        {rw?.zeilen && (
                          <details className="mt-1">
                            <summary className="cursor-pointer text-xs text-slate-500 dark:text-slate-400">{t("Tabelle anzeigen")}</summary>
                            <ul className="mt-1 space-y-0.5 text-xs text-slate-600 dark:text-slate-300">
                              {rw.zeilen.map((z, i) => <li key={i}>{z}</li>)}
                            </ul>
                          </details>
                        )}
                        {regel.hinweis && <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{t(regel.hinweis)}</div>}
                      </td>
                      <td className="px-3 py-2 align-top">
                        {!kannBearbeiten ? (
                          <span className="text-slate-700 dark:text-slate-200">{wertText(regel, zeile.wirksam.wert, lang, t)}</span>
                        ) : bearbeitet ? (
                          <div className="space-y-1">
                            {istAuswahl(regel.typ) ? (
                              <select className={FELD} value={entwurf.wert}
                                aria-invalid={fehler ? true : undefined} aria-describedby={fehler ? `${regel.id}-fehler` : undefined}
                                onChange={(e) => setEntwurf((d) => ({ ...d, wert: e.target.value }))}>
                                {regel.typ === "ja_nein"
                                  ? [["ja", t("Ja")], ["nein", t("Nein")]].map(([w, l]) => <option key={w} value={w}>{l}</option>)
                                  : (regel.optionen || []).map((o) => <option key={o.wert} value={o.wert}>{o.label}</option>)}
                              </select>
                            ) : (
                              <input className={FELD} type={regel.typ === "datum" ? "date" : "text"}
                                inputMode={regel.typ === "zahl" || regel.typ === "prozent" ? "decimal" : undefined}
                                placeholder={regel.typ === "monatstag" ? "MM-TT" : undefined}
                                value={entwurf.wert} aria-invalid={fehler ? true : undefined}
                                aria-describedby={fehler ? `${regel.id}-fehler` : undefined}
                                onChange={(e) => setEntwurf((d) => ({ ...d, wert: e.target.value }))} />
                            )}
                            <div className="flex gap-1">
                              <button type="button" className={BTN_PRIMARY} onClick={() => speichern(zeile)} disabled={busy}>{t("Speichern")}</button>
                              <button type="button" className={BTN} onClick={abbrechen} disabled={busy}>{t("Abbrechen")}</button>
                            </div>
                            {fehler && <p id={`${regel.id}-fehler`} className="text-xs text-red-700 dark:text-red-300">{fehler}</p>}
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="text-slate-700 dark:text-slate-200">{wertText(regel, zeile.wirksam.wert, lang, t)}</span>
                            <button type="button" className={BTN} onClick={() => beginnen(zeile)}>{t("Ändern")}</button>
                          </div>
                        )}
                      </td>
                      {speicherArt === "zeilen" && (
                        <td className="px-3 py-2 align-top">
                          {bearbeitet ? (
                            <input className={FELD} type="date" value={entwurf.gueltig_ab}
                              onChange={(e) => setEntwurf((d) => ({ ...d, gueltig_ab: e.target.value }))} />
                          ) : (
                            <span className="text-slate-600 dark:text-slate-300">{zeile.override?.gueltig_ab ? datumText(zeile.override.gueltig_ab, lang) : "—"}</span>
                          )}
                        </td>
                      )}
                      <td className="px-3 py-2 align-top">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_KLASSE[zeile.status]}`}>
                          {t(STATUS_TEXT[zeile.status])}
                        </span>
                      </td>
                      <td className="px-3 py-2 align-top">
                        {kannBearbeiten && !bearbeitet && zeile.override && (
                          <button type="button" className={BTN} onClick={() => zurueckAufStandard(zeile)} disabled={busy}>
                            {t("Auf Standard zurücksetzen")}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
