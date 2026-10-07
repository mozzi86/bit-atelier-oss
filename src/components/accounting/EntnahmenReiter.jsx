// Tab "Entnahmen" of /Accounting (phase 79, plan 79-06, E-04/BUCH-10/BUCH-18):
// owner's drawings for a sole proprietor, drawings per partner with a yearly
// profit-sharing key for GbR/PartG, and the managing-director-salary hint for
// GmbH/UG — the ONE legal-form switch (rechtsformWirkung) decides which view
// renders, and the switch never drops recorded data (a GmbH's own earlier
// drawings, from before a legal-form change, still show as "frühere
// Entnahmen").
//
// In:  props {bh, gewinnCent?} — gewinnCent: the year's profit in CENTS, an
//      explicit override for a caller that already has it. Nobody passes it
//      today (src/pages/Accounting.jsx renders `<EntnahmenReiter bh={bh} />`)
//      so this tab computes it itself via euer.euerJahr() (79-11) once that
//      year has any booking, else falls back to einst.gewinn_plan[jahr]
//      (Euro) with a visible "Plan-Gewinn" hint. GmbH/UG never reach this
//      (euerJahr's bilanz-hint shape has no `.gewinn` and this tab's own
//      gf_gehalt branch returns before the value is even used).
// Out: the tab (person list, drawings list, profit-sharing key editor for
//      GbR/PartG, overview table + a small accessible bar chart, CSV/XLSX
//      export). The table stays the accessible data view (dataviz-Skill); the
//      SVG only repeats it visually, with its full content in one aria-label.

import React from "react";
import { toast } from "sonner";
import { Plus, TriangleAlert } from "lucide-react";
import { buttonVariants } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import {
  artText, entnahmenTabelle, personTitel, schluesselPruefen, ueberschriftText, uebersicht,
  wirksamerSchluessel, zeileAlsSatz,
} from "@/lib/accounting/entnahmen.js";
import { euerJahr } from "@/lib/accounting/euer.js";
import { personenPruefen, rechtsformWirkung } from "@/lib/accounting/rechtsform.js";
import { euroZuCent, formatEuro } from "@/lib/accounting/geld.js";
import EntnahmeFormular from "./EntnahmeFormular.jsx";
import GesellschafterFormular from "./GesellschafterFormular.jsx";
import ExportKnopf from "./gemeinsam/ExportKnopf.jsx";

const FELD = "h-9 rounded-md border border-slate-300 bg-white px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-slate-600 dark:bg-slate-900";
const PROZENT_FELD = "h-8 w-20 rounded-md border border-slate-300 bg-white px-2 text-right text-sm tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-slate-600 dark:bg-slate-900";

/**
 * Warning text of personenPruefen() keys (literal t() calls for the i18n guard).
 * @param {string} schluessel "einzel_mehrere_personen" | "schluessel_fehlt"
 * @param {(k: string) => string} t
 * @returns {string}
 */
function warnungText(schluessel, t) {
  switch (schluessel) {
    case "einzel_mehrere_personen":
      return t("Ein Einzelunternehmen hat genau eine Inhaberin/einen Inhaber — Rechtsform prüfen.");
    case "schluessel_fehlt":
      return t("Gewinnschlüssel fehlt");
    default:
      return schluessel;
  }
}

/**
 * Years present among the drawings, newest first, plus the current year so a
 * fresh office with no drawings yet still offers one option.
 * @param {any[]} entnahmen
 * @param {string} heute 'YYYY-MM-DD'
 * @returns {number[]}
 */
function jahresListe(entnahmen, heute) {
  const menge = new Set(entnahmen.map((e) => Number(String(e?.datum || "").slice(0, 4))).filter(Boolean));
  menge.add(Number(heute.slice(0, 4)));
  return [...menge].sort((a, b) => b - a);
}

/**
 * Small horizontal bar chart: drawings (actual + planned rest) vs. profit
 * share, one row per person. Decorative alongside the table (which stays the
 * data view, dataviz-Skill) — the whole graphic is one aria-label so a screen
 * reader gets the same numbers the table already shows, once, not per bar.
 * @param {{zeilen: import("@/lib/accounting/entnahmen.js").EntnahmeUebersichtZeile[], t: (k: string) => string}} props
 * @returns {React.ReactElement|null}
 */
function EntnahmenBalken({ zeilen, t }) {
  if (zeilen.length === 0) return null;
  const REIHE_H = 44;
  const BAR_H = 14;
  const BREITE = 560;
  const LABEL_BREITE = 128;
  const PLOT_BREITE = BREITE - LABEL_BREITE - 90;
  const hoehe = zeilen.length * REIHE_H + 28;
  const maxWert = Math.max(1, ...zeilen.flatMap((z) => [z.ist + z.planRest, z.gewinnanteil]));
  const balkenBreite = (/** @type {number} */ wert) => Math.max(wert > 0 ? 2 : 0, (wert / maxWert) * PLOT_BREITE);
  const aria = zeilen.map((z) => zeileAlsSatz(z, t)).join("; ");

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600 dark:text-slate-300">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-sm bg-[#2a78d6] dark:bg-[#3987e5]" />
          {t("Entnahmen (Ist + Plan)")}
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-sm bg-[#eb6834] dark:bg-[#d95926]" />
          {t("Gewinnanteil")}
        </span>
      </div>
      <svg viewBox={`0 0 ${BREITE} ${hoehe}`} role="img" aria-label={aria} className="w-full max-w-xl">
        {zeilen.map((z, i) => {
          const y = 14 + i * REIHE_H;
          const entnahmeWert = z.ist + z.planRest;
          return (
            <g key={z.id}>
              <text x={0} y={y + BAR_H + 1} className="fill-slate-700 text-[11px] dark:fill-slate-200">{z.name}</text>
              <rect x={LABEL_BREITE} y={y} width={balkenBreite(entnahmeWert)} height={BAR_H} rx={3} className="fill-[#2a78d6] dark:fill-[#3987e5]" />
              <text x={LABEL_BREITE + balkenBreite(entnahmeWert) + 6} y={y + BAR_H - 2} className="fill-slate-700 text-[11px] tabular-nums dark:fill-slate-200">
                {formatEuro(entnahmeWert)}
              </text>
              <rect x={LABEL_BREITE} y={y + BAR_H + 3} width={balkenBreite(z.gewinnanteil)} height={BAR_H} rx={3} className="fill-[#eb6834] dark:fill-[#d95926]" />
              <text x={LABEL_BREITE + balkenBreite(z.gewinnanteil) + 6} y={y + 2 * BAR_H + 1} className="fill-slate-700 text-[11px] tabular-nums dark:fill-slate-200">
                {formatEuro(z.gewinnanteil)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/**
 * @param {{bh: import("./useBuchhaltung.js").Buchhaltung, gewinnCent?: number}} props
 *   bh: page loader object; gewinnCent: the year's profit in cents (79-11 sets
 *   this from the EÜR — until then the tab falls back to einst.gewinn_plan).
 * @returns {React.ReactElement}
 */
export default function EntnahmenReiter({ bh, gewinnCent }) {
  const { t } = useI18n();
  const wirkung = rechtsformWirkung(bh.einst);
  const gesellschafter = bh.daten.Gesellschafter || [];
  const entnahmen = bh.daten.Entnahme || [];
  const wiederkehrend = bh.daten.WiederkehrendeAusgabe || [];

  const [jahr, setJahr] = React.useState(() => Number(bh.heute.slice(0, 4)));
  const [formular, setFormular] = React.useState(/** @type {{typ: "person"|"entnahme", eintrag: Record<string, any>|null}|null} */ (null));
  const [schluesselEntwurf, setSchluesselEntwurf] = React.useState(/** @type {Record<string, number>|null} */ (null));
  const [speichertSchluessel, setSpeichertSchluessel] = React.useState(false);

  // gewinnCent prop wins when a caller supplies it; otherwise this year's EÜR (euer.js,
  // 79-11) when it has any booked line for `jahr`, else the plan-gewinn fallback. GmbH/UG's
  // euerJahr() returns only the bilanz-hint shape ({hinweis, ug}, no `.zeilen`/`.gewinn`) — the
  // `wirkung.entnahmen === "gf_gehalt"` branch below returns before this value is ever read,
  // so it is never mistaken for a real profit; this call itself stays safe either way (a
  // missing `.zeilen` just makes `euerHatBuchungen` false, falling back to the plan value).
  const euerErgebnis = /** @type {any} */ (euerJahr({ daten: bh.daten, einst: bh.einst, saetze: bh.saetze, jahr }));
  const euerHatBuchungen = Array.isArray(euerErgebnis?.zeilen) && euerErgebnis.zeilen.length > 0;
  const gewinnAusPlan = gewinnCent === undefined && !euerHatBuchungen;
  const gewinnCentEffektiv = gewinnCent !== undefined ? gewinnCent : euerHatBuchungen ? euerErgebnis.gewinn : euroZuCent(bh.einst.gewinn_plan?.[jahr]);

  const daten = { Gesellschafter: gesellschafter, Entnahme: entnahmen, WiederkehrendeAusgabe: wiederkehrend };
  const aktive = gesellschafter.filter((g) => g && g.aktiv !== false);
  const schluesselWirksam = wirksamerSchluessel(daten, bh.einst, jahr);
  const warnungen = personenPruefen(gesellschafter, bh.einst, jahr);

  // --- GmbH/UG: no drawings at all — only the managing-director-salary hint --------------
  if (wirkung.entnahmen === "gf_gehalt") {
    const info = /** @type {{gfGehalt: Array<{vorlage_id: string, bezeichnung: string, betragMonatCent: number}>, summeMonatCent: number}} */ (
      uebersicht(daten, jahr, 0, bh.heute, bh.einst)
    );
    const frueher = entnahmen.slice().sort((a, b) => (a.datum < b.datum ? 1 : a.datum > b.datum ? -1 : 0));
    return (
      <div className="space-y-6" data-besitzer="79-06">
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">{t("Entnahmen")}</h2>
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          {t("Bei einer GmbH/UG gibt es keine Privatentnahmen: das Geschäftsführergehalt läuft über die Lohnabrechnung (wiederkehrende Ausgabe, Kategorie „Personal“), Gewinnausschüttungen nur per Gesellschafterbeschluss.")}
        </p>
        {wirkung.rechtsform === "ug" && (
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {t("Zusätzlich: 25 % des Jahresüberschusses in die gesetzliche Rücklage (§ 5a Abs. 3 GmbHG).")}
          </p>
        )}

        <section className="space-y-2">
          <h3 className="text-base font-medium text-slate-800 dark:text-slate-100">{t("Geschäftsführergehalt")}</h3>
          {info.gfGehalt.length === 0 ? (
            <p className="text-sm text-slate-600 dark:text-slate-300">{t("Keine wiederkehrende Ausgabe der Kategorie „Personal“ erfasst.")}</p>
          ) : (
            <ul className="space-y-1 text-sm text-slate-700 dark:text-slate-200">
              {info.gfGehalt.map((g) => (
                <li key={g.vorlage_id}>{g.bezeichnung}: {formatEuro(g.betragMonatCent)} {t("je Monat")}</li>
              ))}
            </ul>
          )}
          <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{t("Summe")}: {formatEuro(info.summeMonatCent)} {t("je Monat")}</p>
          <a href="?tab=expenses" className="text-sm text-emerald-700 underline hover:no-underline dark:text-emerald-400">{t("Zu den wiederkehrenden Ausgaben")}</a>
        </section>

        {frueher.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-base font-medium text-slate-800 dark:text-slate-100">{t("Frühere Entnahmen")}</h3>
            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                  <tr>{[t("Datum"), t("Betrag"), t("Art")].map((h) => <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {frueher.map((e) => (
                    <tr key={e.id}>
                      <td className="px-3 py-2 tabular-nums">{e.datum}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatEuro(euroZuCent(e.betrag))}</td>
                      <td className="px-3 py-2">{artText(e.art, t)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    );
  }

  // --- Einzelunternehmen / GbR / PartG ----------------------------------------------------
  const zeilen = /** @type {import("@/lib/accounting/entnahmen.js").EntnahmeUebersichtZeile[]} */ (
    uebersicht(daten, jahr, gewinnCentEffektiv, bh.heute, bh.einst)
  );
  const jahre = jahresListe(entnahmen, bh.heute);
  const schluesselNoetig = wirkung.schluesselNoetig;

  const entwurfFuerJahr = () => {
    /** @type {Record<string, number>} */
    const basis = {};
    for (const g of aktive) basis[/** @type {string} */ (g.id)] = 0;
    const gespeichert = bh.einst.schluessel?.[jahr];
    if (gespeichert && typeof gespeichert === "object") for (const [id, wert] of Object.entries(gespeichert)) if (id in basis) basis[id] = wert;
    return basis;
  };

  const schluesselOeffnen = () => setSchluesselEntwurf(entwurfFuerJahr());
  const schluesselAendern = (/** @type {string} */ id, /** @type {string} */ text) => {
    const zahl = Number(text.replace(",", "."));
    setSchluesselEntwurf((s) => ({ ...(s || entwurfFuerJahr()), [id]: Number.isFinite(zahl) ? zahl : 0 }));
  };
  const schluesselSpeichern = async () => {
    if (!schluesselEntwurf) return;
    const pruefung = schluesselPruefen(schluesselEntwurf);
    if (!pruefung.ok) return;
    setSpeichertSchluessel(true);
    try {
      await bh.einstellungSpeichern({ schluessel: { ...(bh.einst.schluessel || {}), [jahr]: schluesselEntwurf } });
      toast.success(t("Schlüssel gespeichert"));
      setSchluesselEntwurf(null);
    } catch (err) {
      toast.error(`${t("Speichern fehlgeschlagen")}: ${/** @type {any} */ (err)?.message || String(err)}`);
    } finally {
      setSpeichertSchluessel(false);
    }
  };

  const entwurf = schluesselEntwurf || entwurfFuerJahr();
  const entwurfPruefung = schluesselPruefen(entwurf);
  const entnahmenDesJahres = entnahmen.filter((e) => String(e?.datum || "").slice(0, 4) === String(jahr))
    .slice().sort((a, b) => (a.datum < b.datum ? 1 : a.datum > b.datum ? -1 : 0));
  const namen = Object.fromEntries(gesellschafter.map((g) => [g.id, g.name]));

  return (
    <div className="space-y-6" data-besitzer="79-06">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">{ueberschriftText(wirkung.rechtsform, t)}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="en-jahr">{t("Jahr")}</label>
          <select id="en-jahr" className={FELD} value={String(jahr)} onChange={(e) => setJahr(Number(e.target.value))}>
            {jahre.map((j) => <option key={j} value={j}>{j}</option>)}
          </select>
          <ExportKnopf modell={() => entnahmenTabelle(daten, jahr, t, bh.einst)} bereich="entnahmen" jahr={jahr} />
        </div>
      </div>

      {warnungen.map((w) => (
        <p key={w} className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> <span>{warnungText(w, t)}</span>
        </p>
      ))}

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-medium text-slate-800 dark:text-slate-100">{personTitel(wirkung.rechtsform, t)}</h3>
          <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={() => setFormular({ typ: "person", eintrag: null })}>
            <Plus aria-hidden="true" /> {t("Person hinzufügen")}
          </button>
        </div>
        <ul className="grid gap-2 sm:grid-cols-2">
          {gesellschafter.map((g) => (
            <li key={g.id} className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${g.aktiv === false ? "border-slate-200 text-slate-400 dark:border-slate-800 dark:text-slate-500" : "border-slate-200 text-slate-700 dark:border-slate-700 dark:text-slate-200"}`}>
              <span>{g.name}{g.aktiv === false ? ` (${t("inaktiv")})` : ""} — {formatEuro(euroZuCent(g.entnahme_plan_monat))} {t("je Monat")}</span>
              <button type="button" className={buttonVariants({ variant: "ghost", size: "sm" })} onClick={() => setFormular({ typ: "person", eintrag: g })}>{t("Bearbeiten")}</button>
            </li>
          ))}
        </ul>
      </section>

      {schluesselNoetig && (
        <section className="space-y-2" data-testid="schluessel-editor">
          <h3 className="text-base font-medium text-slate-800 dark:text-slate-100">{t("Gewinnschlüssel")} {jahr}</h3>
          {!schluesselWirksam && <p className="text-sm text-amber-800 dark:text-amber-200">{t("Gewinnschlüssel fehlt")}</p>}
          <div className="flex flex-wrap items-center gap-3">
            {aktive.map((g) => (
              <label key={g.id} className="flex items-center gap-1.5 text-sm text-slate-700 dark:text-slate-200">
                {g.name}
                <input type="text" inputMode="decimal" className={PROZENT_FELD} value={String(entwurf[/** @type {string} */ (g.id)] ?? 0)}
                  onChange={(e) => schluesselAendern(/** @type {string} */ (g.id), e.target.value)} />
                %
              </label>
            ))}
            <span className="text-sm tabular-nums text-slate-600 dark:text-slate-300">
              {t("Summe")}: {entwurfPruefung.summe.toLocaleString("de-DE", { maximumFractionDigits: 2 })} %
            </span>
            <button type="button" className={buttonVariants({ variant: "default", size: "sm" })} disabled={!entwurfPruefung.ok || speichertSchluessel} onClick={schluesselSpeichern}>
              {t("Schlüssel speichern")}
            </button>
          </div>
          {!entwurfPruefung.ok && (
            <p className="text-sm text-red-700 dark:text-red-300">
              {t("Summe")} {entwurfPruefung.summe.toLocaleString("de-DE", { maximumFractionDigits: 2 })} % {t("statt 100 %")}
            </p>
          )}
        </section>
      )}

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-medium text-slate-800 dark:text-slate-100">{t("Entnahmen")}</h3>
          <button type="button" className={buttonVariants({ variant: "default", size: "sm" })} disabled={aktive.length === 0}
            onClick={() => setFormular({ typ: "entnahme", eintrag: null })}>
            <Plus aria-hidden="true" /> {t("Neue Entnahme")}
          </button>
        </div>
        {entnahmenDesJahres.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-300">{t("Keine Entnahmen für dieses Jahr.")}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                <tr>{[t("Person"), t("Datum"), t("Betrag"), t("Art"), ""].map((h) => <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {entnahmenDesJahres.map((e) => (
                  <tr key={e.id}>
                    <td className="px-3 py-2">{namen[e.gesellschafter_id] || e.gesellschafter_id}</td>
                    <td className="px-3 py-2 tabular-nums">{e.datum}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatEuro(euroZuCent(e.betrag))}</td>
                    <td className="px-3 py-2">{artText(e.art, t)}</td>
                    <td className="px-3 py-2">
                      <button type="button" className={buttonVariants({ variant: "ghost", size: "sm" })} onClick={() => setFormular({ typ: "entnahme", eintrag: e })}>{t("Bearbeiten")}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3" data-testid="entnahmen-uebersicht">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-base font-medium text-slate-800 dark:text-slate-100">{t("Übersicht")}</h3>
          {gewinnAusPlan && <span className="text-xs text-slate-500 dark:text-slate-400">({t("Plan-Gewinn")})</span>}
        </div>
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600 dark:bg-slate-900 dark:text-slate-300">
              <tr>
                {[t("Person"), schluesselNoetig ? t("Anteil (%)") : null, t("Gewinnanteil"), t("Ist"), t("Plan-Rest"), t("Differenz")]
                  .filter(Boolean).map((h) => <th key={/** @type {string} */ (h)} scope="col" className="px-3 py-2 font-medium">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {zeilen.map((z) => (
                <tr key={z.id} data-testid={`en-zeile-${z.id}`}>
                  <td className="px-3 py-2">{z.name}</td>
                  {schluesselNoetig && <td className="px-3 py-2 text-right tabular-nums">{z.prozent ?? "—"}</td>}
                  <td className="px-3 py-2 text-right tabular-nums" data-testid="en-gewinnanteil">{formatEuro(z.gewinnanteil)}</td>
                  <td className="px-3 py-2 text-right tabular-nums" data-testid="en-ist">{formatEuro(z.ist)}</td>
                  <td className="px-3 py-2 text-right tabular-nums" data-testid="en-plan-rest">{formatEuro(z.planRest)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${z.ueberentnahme ? "text-red-700 dark:text-red-300" : ""}`}>
                    {formatEuro(z.differenz)}{z.ueberentnahme && <span className="ml-1 align-middle" title={t("Überentnahme")}><TriangleAlert className="inline h-3.5 w-3.5" aria-label={t("Überentnahme")} /></span>}
                  </td>
                </tr>
              ))}
            </tbody>
            {zeilen.length > 1 && (
              <tfoot>
                <tr className="border-t border-slate-200 font-medium dark:border-slate-700" data-testid="en-summe">
                  <td className="px-3 py-2">{t("Summe")}</td>
                  {schluesselNoetig && <td className="px-3 py-2" />}
                  <td className="px-3 py-2 text-right tabular-nums">{formatEuro(zeilen.reduce((n, z) => n + z.gewinnanteil, 0))}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatEuro(zeilen.reduce((n, z) => n + z.ist, 0))}</td>
                  <td className="px-3 py-2 text-right tabular-nums" data-testid="en-summe-plan-rest">{formatEuro(zeilen.reduce((n, z) => n + z.planRest, 0))}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatEuro(zeilen.reduce((n, z) => n + z.differenz, 0))}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <EntnahmenBalken zeilen={zeilen} t={t} />
      </section>

      {formular?.typ === "person" && (
        <GesellschafterFormular bh={bh} eintrag={formular.eintrag} onClose={() => setFormular(null)} />
      )}
      {formular?.typ === "entnahme" && (
        <EntnahmeFormular bh={bh} gesellschafter={aktive} eintrag={formular.eintrag} onClose={() => setFormular(null)} />
      )}
    </div>
  );
}
