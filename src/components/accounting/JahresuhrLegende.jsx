// Legend of the year clock (79-10, user addendum 27.09.: "don't forget a
// legend for the clock"): one accessible <li> per symbol the dial actually
// draws — same source as the SVG (jahresuhr.legendeEintraege(), which itself
// reads symbolArten()), so legend and drawing can never disagree.
//
// In:  props modell (uhrModell() result), einst (effective settings, for the
//      tax-mark text: the tax kinds the office account pays, the VAT switch,
//      the payment term/buffer of the deadline text and the GmbH/UG outflow
//      text). Out: a <ul aria-label> next to the clock (below it on narrow screens).

import React from "react";
import { useI18n } from "@core/lib/i18n";
import { LEGENDE_TEXTE, legendeEintraege } from "@/lib/accounting/jahresuhr.js";
import { bueroSteuerarten, fristParameter } from "@/lib/accounting/liquiditaet.js";
import { rechtsformWirkung } from "@/lib/accounting/rechtsform.js";
import { formatEuro } from "@/lib/accounting/geld.js";

/** Mini-SVG per symbol kind, same classes as the clock — aria-hidden, text carries the meaning. */
function MiniSvg({ art }) {
  const gemeinsam = "w-4 h-4 shrink-0";
  if (art === "segment") return <svg viewBox="0 0 20 20" className={gemeinsam} aria-hidden="true"><rect x="2" y="2" width="16" height="16" rx="2" className="fill-slate-200 dark:fill-slate-700" /></svg>;
  if (art === "fuellung") return <svg viewBox="0 0 20 20" className={gemeinsam} aria-hidden="true"><rect x="2" y="2" width="16" height="16" rx="2" className="fill-teal-600 dark:fill-teal-500" /></svg>;
  if (art === "abfluss") return <svg viewBox="0 0 20 20" className={gemeinsam} aria-hidden="true"><line x1="2" y1="10" x2="18" y2="10" strokeWidth="2" className="stroke-slate-600 dark:stroke-slate-300" /></svg>;
  if (art === "defizit") return <svg viewBox="0 0 20 20" className={gemeinsam} aria-hidden="true"><line x1="4" y1="16" x2="16" y2="4" strokeWidth="2" className="stroke-amber-600 dark:stroke-amber-400" /></svg>;
  if (art === "steuer") return <svg viewBox="0 0 20 20" className={gemeinsam} aria-hidden="true"><rect x="8" y="2" width="4" height="16" className="fill-slate-900 dark:fill-slate-100" /></svg>;
  if (art === "frist") {
    return (
      <svg viewBox="0 0 20 20" className={gemeinsam} aria-hidden="true">
        <rect x="9" y="8" width="2" height="11" className="fill-red-600 dark:fill-red-400" />
        <circle cx="10" cy="4.5" r="3" fill="none" strokeWidth="1.5" className="stroke-red-600 dark:stroke-red-400" />
      </svg>
    );
  }
  if (art === "deckung-ok") {
    return (
      <svg viewBox="0 0 20 20" className={gemeinsam} aria-hidden="true">
        <path d="M 4 10 L 8 14 L 16 6" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="stroke-slate-500 dark:stroke-slate-400" />
      </svg>
    );
  }
  if (art === "deckung-warn") return <svg viewBox="0 0 20 20" className={gemeinsam} aria-hidden="true"><path d="M10 3 L18 17 L2 17 Z" className="fill-amber-600 dark:fill-amber-400" /></svg>;
  return <svg viewBox="0 0 20 20" className={gemeinsam} aria-hidden="true"><line x1="10" y1="10" x2="10" y2="2" strokeWidth="2" strokeLinecap="round" className="stroke-slate-900 dark:stroke-slate-100" /></svg>;
}

/**
 * The tax-mark line, built from separate literal t() pieces (not one composed
 * key): the prepayment the office account pays (ESt only with
 * `est_ueber_buero`, KSt for GmbH/UG), the VAT scheme text of the active
 * switch (E-09, with the extension suffix), and — only for a commercial legal
 * form — the trade-tax dates.
 * @param {Record<string, any>} einst effective settings
 * @param {(k: string) => string} t
 * @returns {string}
 */
function steuerText(einst, t) {
  const arten = bueroSteuerarten(einst);
  const teile = [];
  if (arten.includes("est")) teile.push(t("ESt 10.3., 10.6., 10.9. und 10.12."));
  if (arten.includes("kst")) teile.push(t("KSt 10.3., 10.6., 10.9. und 10.12."));
  if (arten.includes("ust")) {
    const basis = einst?.ust_zeitraum === "monat" ? t("USt-Termine (monatlich)") : t("USt-Termine (vierteljährlich)");
    teile.push(einst?.dauerfrist ? `${basis} ${t("mit Dauerfristverlängerung")}` : basis);
  } else {
    teile.push(t("keine USt-Voranmeldung (Jahreserklärung)"));
  }
  if (arten.includes("gewst")) teile.push(t("GewSt 15.2., 15.5., 15.8. und 15.11."));
  return `${t("Schwarze Markierung: Steuerzahltag —")} ${teile.join("; ")}`;
}

/**
 * Text of one legend entry through literal t() calls (same German text as
 * jahresuhr.LEGENDE_TEXTE — the unit test holds both together).
 * @param {{symbol: string, textSchluessel: string, werte: Record<string, string|number>}} e
 * @param {Record<string, any>} einst
 * @param {(k: string) => string} t
 * @returns {string}
 */
function eintragText(e, einst, t) {
  /** @type {string} */
  let text;
  switch (e.symbol) {
    case "segment": text = t("Graue Segmente: die 12 Monate — Januar oben, im Uhrzeigersinn"); break;
    case "fuellung": text = t("Füllstand: erwartete Zahlungseingänge des Monats (voller Ring = {skala}); reicht er über die Linie, ist der Monat gedeckt"); break;
    case "abfluss":
      text = e.textSchluessel === LEGENDE_TEXTE.abflussGfGehalt
        ? t("Linie: erwartete Ausgaben einschließlich Geschäftsführergehalt und Steuern des Monats")
        : t("Linie: erwartete Ausgaben, Entnahmen und Steuern des Monats");
      break;
    case "defizit": text = t("Schraffur: ungedeckter Teil — Abflüsse höher als Eingänge"); break;
    case "steuer": return steuerText(einst, t);
    case "frist": text = t("Rote Markierung: spätester Rechnungsversand = Steuertag − {ziel} Tage Zahlungsziel − {puffer} Tage Puffer"); break;
    case "deckung-ok": text = t("Haken: Steuertermin gedeckt"); break;
    case "deckung-warn": text = t("Warndreieck: Deckung des Steuertermins gefährdet"); break;
    default: text = t("Zeiger: heute (aktueller Monat)");
  }
  for (const [k, v] of Object.entries(e.werte || {})) text = text.replace(`{${k}}`, String(v));
  return text;
}

/**
 * @param {{modell: ReturnType<typeof import("@/lib/accounting/jahresuhr.js").uhrModell>,
 *   einst: Record<string, any>}} props
 * @returns {React.ReactElement}
 */
export default function JahresuhrLegende({ modell, einst }) {
  const { t, lang } = useI18n();
  const { ziel, puffer } = fristParameter(einst);
  const eintraege = legendeEintraege(modell, {
    ziel, puffer, skalaText: formatEuro(modell.skala, lang), gfGehalt: rechtsformWirkung(einst).entnahmen === "gf_gehalt",
  });

  return (
    <ul aria-label={t("Legende der Jahresuhr")} className="space-y-2 text-sm text-slate-700 dark:text-slate-200">
      {eintraege.map((e) => (
        <li key={e.symbol} data-symbol={e.symbol} className="flex items-start gap-2">
          <MiniSvg art={e.symbol} />
          <span>{eintragText(e, einst, t)}</span>
        </li>
      ))}
    </ul>
  );
}
