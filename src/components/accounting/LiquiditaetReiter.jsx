// Tab "Jahresuhr" of /Accounting (79-10, BUCH-08/BUCH-18): the liquidity plan
// as a year clock with legend and month details, the "Planwerte" card
// (starting balance, prepayments by legal form), the "invoices due by" list
// and the monthly table. Fills the 79-01 stub.
//
// In:  props bh (contract of the accounting page). Out: the area; the
// starting-balance and prepayment fields write through bh.einstellungSpeichern.

import React from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { useI18n } from "@core/lib/i18n";
import {
  bueroSteuerarten, liquiditaetTabelle, monatsModell, rechnungenRausBis, startSaldo, steuerzahltage, ueberfaelligeForderungen,
} from "@/lib/accounting/liquiditaet.js";
import { uhrModell } from "@/lib/accounting/jahresuhr.js";
import { rechtsformWirkung } from "@/lib/accounting/rechtsform.js";
import { euroZuCent, formatEuro } from "@/lib/accounting/geld.js";
import BetragFeld from "./gemeinsam/BetragFeld.jsx";
import ExportKnopf from "./gemeinsam/ExportKnopf.jsx";
import RichtwertHinweis from "./gemeinsam/RichtwertHinweis.jsx";
import Jahresuhr from "./Jahresuhr.jsx";
import JahresuhrLegende from "./JahresuhrLegende.jsx";
import MonatsDetails from "./MonatsDetails.jsx";
import RechnungenRausListe from "./RechnungenRausListe.jsx";
// 80-10 Task 7b: NUR dieser Hook — die Personal-Speicherzugriffe bleiben in ihm gekapselt (s. dessen Dateikopf).
import { usePersonalkostenPlan } from "@/components/people/usePersonalkostenPlan.js";

const KARTE = "rounded-xl border bg-card text-card-foreground shadow";
const KARTE_KOPF = "flex flex-col space-y-1.5 p-6";
const KARTE_TITEL = "font-semibold leading-none tracking-tight";
const KARTE_INHALT = "p-6 pt-0";
const TH = "h-9 px-2 text-left align-middle text-xs font-medium text-slate-500 dark:text-slate-400";
const TD = "px-2 py-1.5 align-middle text-sm";
const TR = "border-b border-slate-100 dark:border-slate-800";
const JAHR_KNOPF = "rounded-md border px-2 py-1 text-sm disabled:opacity-50";

/**
 * @param {Record<string, any>} einst effective settings
 * @param {number} jahr
 * @param {"est"|"kst"|"gewst"} art
 * @param {number} q quarter index 0–3
 * @returns {number|undefined} Euro
 */
function quartalsWert(einst, jahr, art, q) {
  return einst?.vorauszahlungen?.[jahr]?.[art]?.[q];
}

/**
 * @param {{bh: import("./useBuchhaltung.js").Buchhaltung}} props
 * @returns {React.ReactElement}
 */
export default function LiquiditaetReiter({ bh }) {
  const { t, lang } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const heuteJahr = Number(bh.heute.slice(0, 4));
  const [jahr, setJahr] = React.useState(heuteJahr);
  const [speichertPlanwerte, setSpeichertPlanwerte] = React.useState(false);

  const monatUrl = Number(searchParams.get("monat"));
  const standardMonat = jahr === heuteJahr ? Number(bh.heute.slice(5, 7)) : 1;
  const monatGewaehlt = Number.isInteger(monatUrl) && monatUrl >= 1 && monatUrl <= 12 ? monatUrl : standardMonat;

  const monatWaehlen = (monat) => {
    const naechste = new URLSearchParams(searchParams);
    naechste.set("monat", String(monat));
    setSearchParams(naechste, { replace: false });
  };

  // 80-10 Task 7b: "Personal (Plan)" fließt additiv über den EINEN Kontext dieses
  // Reiters ein — ohne Personal-Zugang liefert der Hook [] und nichts ändert sich.
  // warten: bh.laedt — s. usePersonalkostenPlan.js Dateikopf (zwei gleichzeitige
  // IndexedDB-Versionssprünge auf dem ersten /Accounting-Besuch vermeiden).
  const { zusatzAbfluesse } = usePersonalkostenPlan(jahr, { warten: bh.laedt });
  const kontext = { daten: bh.daten, einst: bh.einst, saetze: bh.saetze, jahr, heute: bh.heute, projekte: bh.projekte, zusatzAbfluesse };
  const abh = [bh.daten, bh.einst, bh.saetze, jahr, bh.heute, bh.projekte, zusatzAbfluesse];
  const monate = React.useMemo(() => monatsModell(kontext), abh); // eslint-disable-line react-hooks/exhaustive-deps
  const tage = React.useMemo(() => steuerzahltage(kontext), abh); // eslint-disable-line react-hooks/exhaustive-deps
  const rechnungenRaus = React.useMemo(() => rechnungenRausBis(kontext), abh); // eslint-disable-line react-hooks/exhaustive-deps
  const start = React.useMemo(() => startSaldo(kontext), abh); // eslint-disable-line react-hooks/exhaustive-deps
  const ueberfaellige = React.useMemo(() => ueberfaelligeForderungen(kontext), [bh.daten, bh.heute]); // eslint-disable-line react-hooks/exhaustive-deps

  // Month names from Intl (de-DE / en-GB), in UTC so no time zone shifts the month.
  const monatsFormat = React.useMemo(
    () => new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "de-DE", { month: "long", timeZone: "UTC" }), [lang],
  );
  const monatsnamen = React.useCallback((m) => monatsFormat.format(new Date(Date.UTC(2000, m - 1, 1))), [monatsFormat]);
  const modell = React.useMemo(() => uhrModell({
    jahr, heute: bh.heute,
    monate: monate.map((m) => ({ eingaengeCent: m.eingaengeCent, abflussCent: m.abflussCent, saldoEndeCent: m.saldoEndeCent })),
    steuertage: tage, fristen: tage.map((st) => ({ datum: st.spaetesterVersand })), monatsnamen,
  }), [jahr, bh.heute, monate, tage, monatsnamen]);

  const wirkung = rechtsformWirkung(bh.einst);
  const vorauszahlungArt = wirkung.vorauszahlung; // "est" | "kst"
  const vorauszahlungUeberBuero = bueroSteuerarten(bh.einst).includes(vorauszahlungArt);

  const planwertSpeichern = async (patch) => {
    setSpeichertPlanwerte(true);
    try {
      await bh.einstellungSpeichern(patch);
    } catch (fehler) {
      toast.error(/** @type {any} */ (fehler)?.message || String(fehler));
    } finally {
      setSpeichertPlanwerte(false);
    }
  };

  const kontostandStart = bh.einst.kontostand_start?.[jahr]?.betrag ?? null;
  const setzeKontostand = (cent) => planwertSpeichern({
    kontostand_start: { ...bh.einst.kontostand_start, [jahr]: cent === null ? undefined : { betrag: cent / 100, datum: `${jahr}-01-01` } },
  });
  const setzeVorauszahlung = (art, q, cent) => {
    const bisher = bh.einst.vorauszahlungen?.[jahr]?.[art] || [null, null, null, null];
    const neu = bisher.slice();
    neu[q] = cent === null ? null : cent / 100;
    planwertSpeichern({ vorauszahlungen: { ...bh.einst.vorauszahlungen, [jahr]: { ...bh.einst.vorauszahlungen?.[jahr], [art]: neu } } });
  };

  const monatsIndex = monatGewaehlt - 1;
  const monatPraefix = `${jahr}-${String(monatGewaehlt).padStart(2, "0")}`;
  const ueberfaelligImMonat = ueberfaellige.filter((r) => typeof r.faellig === "string" && r.faellig.startsWith(monatPraefix));

  return (
    <div className="space-y-6" data-testid="liquiditaet-reiter">
      <div className={KARTE}>
        <div className={`${KARTE_KOPF} flex-row flex-wrap items-center justify-between gap-3`}>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" aria-label={t("Vorjahr")} className={JAHR_KNOPF} onClick={() => setJahr((j) => j - 1)}>‹</button>
            <h3 className={KARTE_TITEL}>{t("Jahresuhr")} {jahr}</h3>
            <button type="button" aria-label={t("Folgejahr")} className={JAHR_KNOPF} onClick={() => setJahr((j) => j + 1)}>›</button>
            <button type="button" className={JAHR_KNOPF} disabled={jahr === heuteJahr} onClick={() => setJahr(heuteJahr)}>{t("Laufendes Jahr")}</button>
          </div>
          <ExportKnopf modell={() => liquiditaetTabelle(monate, t)} bereich="liquiditaet" jahr={jahr} />
        </div>
        <div className={KARTE_INHALT}>
          <RichtwertHinweis />
          {start.quelle === "hinweis" && (
            <p className="mt-3 text-sm text-amber-800 dark:text-amber-200" data-testid="lp-kontostand-hinweis">
              {t("Für {jahr} ist kein Kontostand-Startwert hinterlegt — die Uhr rechnet ab {betrag}. Tragen Sie ihn unter „Planwerte“ ein.")
                .replace("{jahr}", String(jahr)).replace("{betrag}", formatEuro(0, lang))}
            </p>
          )}
          <div className="mt-4 grid gap-6 md:grid-cols-[420px_1fr]">
            <div className="space-y-4">
              <Jahresuhr modell={modell} jahr={jahr} heuteMonat={jahr === heuteJahr ? Number(bh.heute.slice(5, 7)) : null}
                monatMarkiert={monatGewaehlt} onMonatWahl={monatWaehlen} />
              <JahresuhrLegende modell={modell} einst={bh.einst} />
            </div>
            <MonatsDetails monat={monatGewaehlt} monatsname={monatsnamen(monatGewaehlt)} monatsDaten={monate[monatsIndex]}
              steuertage={tage} ueberfaellige={ueberfaelligImMonat} einst={bh.einst} />
          </div>
        </div>
      </div>

      <div className={KARTE}>
        <div className={KARTE_KOPF}><h3 className={KARTE_TITEL}>{t("Planwerte")}</h3></div>
        <div className={KARTE_INHALT}>
          <fieldset disabled={speichertPlanwerte} className="space-y-4">
            <BetragFeld id="lp-kontostand" wert={kontostandStart === null ? null : euroZuCent(kontostandStart)}
              onChange={setzeKontostand} label={`${t("Kontostand-Startwert")} ${jahr}`} />
            {vorauszahlungUeberBuero ? (
              <div>
                <p className="text-sm font-medium">{vorauszahlungArt === "kst" ? t("KSt-Vorauszahlungen") : t("ESt-Vorauszahlungen")}</p>
                <div className="mt-1 flex flex-wrap gap-3">
                  {[0, 1, 2, 3].map((q) => (
                    <BetragFeld key={q} id={`lp-${vorauszahlungArt}-${q}`}
                      wert={(() => { const w = quartalsWert(bh.einst, jahr, vorauszahlungArt, q); return typeof w === "number" ? euroZuCent(w) : null; })()}
                      onChange={(cent) => setzeVorauszahlung(vorauszahlungArt, q, cent)} label={`Q${q + 1}`} />
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-600 dark:text-slate-300" data-testid="lp-est-privat">
                {t("ESt-Vorauszahlungen laufen nicht über das Bürokonto — sie erscheinen weder als Abfluss noch als Steuertermin.")}
              </p>
            )}
            {wirkung.gewst && (
              <div>
                <p className="text-sm font-medium">{t("GewSt-Vorauszahlungen")}</p>
                <div className="mt-1 flex flex-wrap gap-3">
                  {[0, 1, 2, 3].map((q) => (
                    <BetragFeld key={q} id={`lp-gewst-${q}`}
                      wert={(() => { const w = quartalsWert(bh.einst, jahr, "gewst", q); return typeof w === "number" ? euroZuCent(w) : null; })()}
                      onChange={(cent) => setzeVorauszahlung("gewst", q, cent)} label={`Q${q + 1}`} />
                  ))}
                </div>
              </div>
            )}
          </fieldset>
          <p className="mt-3 text-sm text-slate-600 dark:text-slate-300" data-testid="lp-rechtsform-hinweis">
            {t("Rechtsform")}: {t(RECHTSFORM_LABEL[wirkung.rechtsform] || wirkung.rechtsform)} ·{" "}
            <a className="underline" href="#/Accounting?tab=vat">{t("USt-Zeitraum")}: {ustZeitraumText(bh.einst, t)}</a>
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {t("Rechtsform, Zahlungsziel und Puffer ändern Sie über „Einstellungen“ oben auf der Seite.")}
          </p>
        </div>
      </div>

      <div className={KARTE}>
        <div className={KARTE_KOPF}><h3 className={KARTE_TITEL}>{t("Rechnungen raus bis")}</h3></div>
        <div className={KARTE_INHALT}><RechnungenRausListe eintraege={rechnungenRaus} /></div>
      </div>

      <div className={KARTE}>
        <div className={KARTE_KOPF}><h3 className={KARTE_TITEL}>{t("Monatstabelle")}</h3></div>
        <div className={`${KARTE_INHALT} overflow-x-auto`}>
          <table className="w-full border-collapse tabular-nums" data-testid="liquiditaet-tabelle">
            <thead>
              <tr className={TR}>
                <th className={TH}>{t("Monat")}</th>
                <th className={TH}>{t("Eingänge")}</th>
                <th className={TH}>{t("Abfluss")}</th>
                <th className={TH}>{t("Saldo Ende")}</th>
              </tr>
            </thead>
            <tbody>
              {monate.map((m, i) => (
                <tr key={i} className={TR} data-monat={i + 1}>
                  <td className={TD}>{monatsnamen(i + 1)}</td>
                  <td className={`${TD} text-right`}>{formatEuro(m.eingaengeCent, lang)}</td>
                  <td className={`${TD} text-right`}>{formatEuro(m.abflussCent, lang)}</td>
                  <td className={`${TD} text-right`}>{formatEuro(m.saldoEndeCent, lang)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const RECHTSFORM_LABEL = Object.freeze({
  einzelunternehmen: "Einzelunternehmen (Freiberufler)", gbr: "GbR", partg: "PartG", gmbh: "GmbH", ug: "UG (haftungsbeschränkt)",
});

/** @param {Record<string, any>} einst @param {(k: string) => string} t */
function ustZeitraumText(einst, t) {
  if (einst?.ust_zeitraum === "monat") return `${t("monatlich")}${einst.dauerfrist ? ` (${t("mit Dauerfristverlängerung")})` : ""}`;
  if (einst?.ust_zeitraum === "quartal") return `${t("vierteljährlich")}${einst.dauerfrist ? ` (${t("mit Dauerfristverlängerung")})` : ""}`;
  return t("keine (nur Jahreserklärung)");
}
