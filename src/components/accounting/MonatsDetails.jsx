// Month details panel of the year clock (79-10, T6): beside the clock (below
// it on narrow screens), no modal — shows the events that make up the
// selected month's segment, so the dial's figures are never a black box.
//
// In:  props monat (1-12), monatsDaten (one entry of liquiditaet.monatsModell,
//      {..., posten}), steuertage (liquiditaet.steuerzahltage(), for the
//      ✓/⚠ marks), ueberfaellige (overdue receivables due in this month —
//      listed, marked, never counted, D-P79-18), monatsname, einst (for the
//      legal-form-dependent drawings heading). Out: the panel.

import React from "react";
import { useI18n } from "@core/lib/i18n";
import { rechtsformWirkung } from "@/lib/accounting/rechtsform.js";
import { steuerartText } from "@/lib/accounting/liquiditaet.js";
import { formatEuro } from "@/lib/accounting/geld.js";

/** @param {string|null} iso 'YYYY-MM-DD' */
function tagText(iso) {
  return iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "—";
}

const ABSCHNITT = "space-y-1";
const ZEILE = "flex items-baseline justify-between gap-2 text-sm";
const UEBERSCHRIFT = "text-xs font-medium text-slate-500 dark:text-slate-400";
const LEER = "text-sm text-slate-500 dark:text-slate-400";

/**
 * @param {{
 *   monat: number, monatsname: string,
 *   monatsDaten: {eingaengeCent: number, ausgabenCent: number, entnahmenCent: number, steuernCent: number,
 *     saldoAnfangCent: number, saldoEndeCent: number, posten: Array<{datum: string, art: string, betragCent: number, quelle: string, id: string, sicher: boolean}>},
 *   steuertage: Array<{nenn: string, gedeckt: boolean|null}>,
 *   ueberfaellige?: Array<{id: string, nummer?: string, faellig: string|null, offenCent: number}>,
 *   einst: Record<string, any>,
 * }} props
 * @returns {React.ReactElement}
 */
export default function MonatsDetails({ monat, monatsname, monatsDaten, steuertage, ueberfaellige = [], einst }) {
  const { t, lang } = useI18n();
  const wirkung = rechtsformWirkung(einst);
  const euro = (cent) => formatEuro(cent, lang);
  const posten = monatsDaten?.posten || [];
  const eingaenge = posten.filter((p) => p.art === "eingang");
  const ausgaben = posten.filter((p) => p.art === "ausgabe");
  const entnahmen = posten.filter((p) => p.art === "entnahme");
  const steuern = posten.filter((p) => p.art === "steuer");

  const nennVonId = (id) => String(id || "").split(":").slice(1).join(":");
  const gedecktFuer = (id) => steuertage.find((s) => s.nenn === nennVonId(id))?.gedeckt ?? null;

  const entnahmenUeberschrift = wirkung.rechtsform === "einzelunternehmen" ? t("Privatentnahmen")
    : wirkung.entnahmen === "gesellschafter" ? t("Entnahmen der Gesellschafter") : null;

  return (
    <section aria-label={`${t("Monatsdetails")} ${monatsname}`} className="rounded-xl border bg-card p-4 space-y-4" data-testid="monatsdetails" data-monat={monat}>
      <h3 className="font-semibold leading-none tracking-tight">{monatsname}</h3>

      <div className={ABSCHNITT}>
        <p className={UEBERSCHRIFT}>{t("Eingänge")}</p>
        {eingaenge.length === 0 && ueberfaellige.length === 0 && <p className={LEER}>{t("Keine")}</p>}
        {eingaenge.map((p) => (
          <div key={`${p.id}-${p.datum}`} className={ZEILE}>
            <span>{tagText(p.datum)} · {p.sicher ? t("erhalten") : t("erwartet")}</span>
            <span className="tabular-nums">{euro(p.betragCent)}</span>
          </div>
        ))}
        {ueberfaellige.map((r) => (
          <div key={`ueberfaellig-${r.id}`} className={`${ZEILE} text-amber-800 dark:text-amber-200`} data-testid="monatsdetails-ueberfaellig">
            <span>{tagText(r.faellig)} · {r.nummer || r.id} · ⚠ {t("überfällig — zählt nicht zur Deckung")}</span>
            <span className="tabular-nums line-through decoration-1">{euro(r.offenCent)}</span>
          </div>
        ))}
        <div className={`${ZEILE} font-medium`}><span>{t("Summe")}</span><span className="tabular-nums">{euro(monatsDaten?.eingaengeCent || 0)}</span></div>
      </div>

      <div className={ABSCHNITT}>
        <p className={UEBERSCHRIFT}>{t("Ausgaben")}</p>
        {ausgaben.length === 0 && <p className={LEER}>{t("Keine")}</p>}
        {ausgaben.map((p) => (
          <div key={`${p.id}-${p.datum}`} className={ZEILE} data-testid={p.quelle === "personal_plan" ? "monatsdetails-personal-plan" : undefined}>
            {/* 80-10 Task 7b: der additive Kontext-Abfluss "Personal (Plan)" trägt
                keinen Namen und keine Konto-Zeile — nur der Hinweis, dass das Ist
                anderswo (im Lohnjournal) gebucht wird, nicht hier verdoppelt. */}
            <span>{tagText(p.datum)}{p.quelle === "personal_plan" ? ` · ${t("Personal (Plan) — Ist aus dem Lohnjournal")}` : ""}</span>
            <span className="tabular-nums">{euro(p.betragCent)}</span>
          </div>
        ))}
        <div className={`${ZEILE} font-medium`}><span>{t("Summe")}</span><span className="tabular-nums">{euro(monatsDaten?.ausgabenCent || 0)}</span></div>
      </div>

      {entnahmenUeberschrift && (
        <div className={ABSCHNITT} data-testid="monatsdetails-entnahmen">
          <p className={UEBERSCHRIFT}>{entnahmenUeberschrift}</p>
          {entnahmen.length === 0 && <p className={LEER}>{t("Keine")}</p>}
          {entnahmen.map((p) => (
            <div key={`${p.id}-${p.datum}`} className={ZEILE}>
              <span>{tagText(p.datum)} · {p.sicher ? t("gebucht") : t("Geplant")}</span>
              <span className="tabular-nums">{euro(p.betragCent)}</span>
            </div>
          ))}
          <div className={`${ZEILE} font-medium`}><span>{t("Summe")}</span><span className="tabular-nums">{euro(monatsDaten?.entnahmenCent || 0)}</span></div>
        </div>
      )}

      <div className={ABSCHNITT}>
        <p className={UEBERSCHRIFT}>{t("Steuern")}</p>
        {steuern.map((p) => {
          const gedeckt = gedecktFuer(p.id);
          return (
            <div key={`${p.id}-${p.datum}`} className={ZEILE}>
              <span>{tagText(p.datum)} · {steuerartText(p.quelle, t)} {gedeckt === true ? "✓" : gedeckt === false ? "⚠" : ""}</span>
              <span className="tabular-nums">{euro(p.betragCent)}</span>
            </div>
          );
        })}
        {steuern.length === 0 && <p className={LEER}>{t("Keine")}</p>}
      </div>

      <div className="border-t pt-2 space-y-1">
        <div className={ZEILE}><span>{t("Saldo Anfang")}</span><span className="tabular-nums">{euro(monatsDaten?.saldoAnfangCent || 0)}</span></div>
        <div className={`${ZEILE} font-semibold`}><span>{t("Saldo Ende")}</span><span className="tabular-nums">{euro(monatsDaten?.saldoEndeCent || 0)}</span></div>
      </div>
    </section>
  );
}
