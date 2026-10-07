// Tab "Umsatzsteuer" of /Accounting (79-05, BUCH-09/BUCH-18): VAT preview per
// filing period — cash (Ist) or accrual (Soll) basis, monthly/quarterly/none,
// permanent extension with special prepayment, tax payments recorded, and the
// Ist-Versteuerung threshold by legal form (E-04). Fills the 79-01 stub.
//
// In:  props bh (contract of the accounting page). Out: the area; "als bezahlt
//      markieren" writes Steuerzahlung through bh.speichere/einstellungSpeichern
//      writes the three switches — both reload through bh.

import React from "react";
import { toast } from "sonner";
import FormModal from "@core/components/common/FormModal";
import { buttonVariants } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import {
  istVersteuerungPruefen, periodeLabel, periodenHinweis, umsatzsteuerTabelle, vorjahrZahllastCent, voranmeldungen,
} from "@/lib/accounting/umsatzsteuer.js";
import { formatEuro } from "@/lib/accounting/geld.js";
import BetragFeld from "./gemeinsam/BetragFeld.jsx";
import ExportKnopf from "./gemeinsam/ExportKnopf.jsx";
import RichtwertHinweis from "./gemeinsam/RichtwertHinweis.jsx";

const KARTE = "rounded-xl border bg-card text-card-foreground shadow";
const KARTE_KOPF = "flex flex-col space-y-1.5 p-6";
const KARTE_TITEL = "font-semibold leading-none tracking-tight";
const KARTE_INHALT = "p-6 pt-0";
const TH = "h-9 px-2 text-left align-middle text-xs font-medium text-slate-500 dark:text-slate-400";
const TD = "px-2 py-1.5 align-middle text-sm";
const TR = "border-b border-slate-100 dark:border-slate-800";
const FELD = "h-9 rounded-md border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-900";
const LABEL = "text-sm font-medium leading-none";

/** @param {string|null|undefined} iso @returns {string} dd.mm.yyyy or "—" */
function tagText(iso) {
  return iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "—";
}

/**
 * Dialog "als bezahlt markieren": records or updates the Steuerzahlung of one
 * filing period, date and amount prefilled from the row.
 * @param {{bh: import("./useBuchhaltung.js").Buchhaltung, zeile: ReturnType<typeof voranmeldungen>[number], onClose: () => void}} props
 * @returns {React.ReactElement}
 */
function BezahltDialog({ bh, zeile, onClose }) {
  const { t } = useI18n();
  const [datum, setDatum] = React.useState(() => zeile.bezahlt?.bezahlt_am || zeile.faellig || bh.heute);
  const [betragCent, setBetragCent] = React.useState(() => {
    const vorhandenerText = zeile.bezahlt?.betrag;
    if (typeof vorhandenerText === "number") return Math.round(vorhandenerText * 100);
    return Math.abs(zeile.zahllast);
  });
  const [speichert, setSpeichert] = React.useState(false);

  const speichern = async () => {
    if (betragCent === null) return;
    setSpeichert(true);
    try {
      await bh.speichere("Steuerzahlung", {
        ...(zeile.bezahlt || {}),
        art: zeile.art,
        zeitraum: zeile.zeitraum,
        betrag: betragCent / 100,
        faellig_am: zeile.faellig || zeile.bezahlt?.faellig_am || datum,
        bezahlt_am: datum,
      });
      toast.success(t("Steuerzahlung gespeichert"));
      onClose();
    } catch (fehler) {
      toast.error(/** @type {any} */ (fehler)?.message || String(fehler));
    } finally {
      setSpeichert(false);
    }
  };

  return (
    <FormModal title={t("Als bezahlt markieren")} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {periodeLabel(zeile, t)} · {t("Fällig am")} {tagText(zeile.faellig)}
        </p>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>{t("Bezahlt am")}</span>
          <input type="date" value={datum} onChange={(e) => setDatum(e.target.value)} className={FELD} />
        </label>
        <BetragFeld wert={betragCent} onChange={setBetragCent} label={t("Betrag")} />
        <div className="flex gap-2 pt-2">
          <button type="button" disabled={speichert || betragCent === null} className={buttonVariants({ size: "sm" })} onClick={speichern}>
            {t("Speichern")}
          </button>
          <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={onClose}>{t("Abbrechen")}</button>
        </div>
      </div>
    </FormModal>
  );
}

/**
 * Status line under the Ist/Soll switch (E-04): freelancers may always use
 * cash accounting; a corporation may only up to the turnover threshold.
 * @param {ReturnType<typeof istVersteuerungPruefen>} pruefung
 * @param {(k: string) => string} t
 */
function statusZeile(pruefung, t) {
  if (pruefung.grund === "freiberufler") {
    return { warnung: false, text: t("Ist-Versteuerung zulässig als Freiberufler (§ 20 S. 1 Nr. 3 UStG)") };
  }
  const text = t("Ist-Versteuerung nur bis 800.000 € Vorjahresumsatz (§ 20 S. 1 Nr. 1 UStG) — Vorjahr: {betrag}")
    .replace("{betrag}", formatEuro(pruefung.umsatzVorjahrCent));
  return { warnung: !pruefung.zulaessig, text };
}

/**
 * @param {{bh: import("./useBuchhaltung.js").Buchhaltung}} props
 * @returns {React.ReactElement}
 */
export default function UmsatzsteuerReiter({ bh }) {
  const { t } = useI18n();
  const heuteJahr = Number(bh.heute.slice(0, 4));
  const [jahr, setJahr] = React.useState(heuteJahr);
  const [offen, setOffen] = React.useState(/** @type {string|null} */ (null));
  const [bezahlenFuer, setBezahlenFuer] = React.useState(/** @type {ReturnType<typeof voranmeldungen>[number]|null} */ (null));
  const [speichertSchalter, setSpeichertSchalter] = React.useState(false);

  const { einst, saetze, daten } = bh;
  const zeilen = React.useMemo(
    () => voranmeldungen(jahr, daten, einst, saetze, bh.heute),
    [jahr, daten, einst, saetze, bh.heute],
  );
  // The selected year, like the table: the threshold is about THAT year's prior-year turnover.
  const pruefung = React.useMemo(() => istVersteuerungPruefen(einst, daten, jahr, saetze), [einst, daten, jahr, saetze]);
  const hinweis = React.useMemo(
    () => periodenHinweis(einst.ust_zeitraum, vorjahrZahllastCent(jahr - 1, daten, einst), saetze),
    [einst, daten, jahr, saetze],
  );
  const status = statusZeile(pruefung, t);

  const schalterSpeichern = async (patch) => {
    setSpeichertSchalter(true);
    try {
      await bh.einstellungSpeichern(patch);
    } catch (fehler) {
      toast.error(/** @type {any} */ (fehler)?.message || String(fehler));
    } finally {
      setSpeichertSchalter(false);
    }
  };

  const jahre = [heuteJahr - 1, heuteJahr, heuteJahr + 1];

  return (
    <div className="space-y-6">
      <div className={KARTE}>
        <div className={`${KARTE_KOPF} flex-row flex-wrap items-center justify-between gap-3`}>
          <h3 className={KARTE_TITEL}>{t("Umsatzsteuer")}</h3>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-sm">
              <span className={LABEL}>{t("Jahr")}</span>
              <select id="ust-jahr" className={FELD} value={jahr} onChange={(e) => setJahr(Number(e.target.value))}>
                {jahre.map((j) => <option key={j} value={j}>{j}</option>)}
              </select>
            </label>
            <ExportKnopf modell={() => umsatzsteuerTabelle(zeilen, t)} bereich="umsatzsteuer" jahr={jahr} />
          </div>
        </div>
        <div className={KARTE_INHALT}>
          <RichtwertHinweis />
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{t("Vorschau, keine Voranmeldung (ELSTER)")}</p>

          <fieldset className="mt-4 flex flex-wrap items-end gap-4" disabled={speichertSchalter}>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>{t("Versteuerung")}</span>
              <select id="ust-versteuerung" className={FELD} value={einst.versteuerung}
                onChange={(e) => schalterSpeichern({ versteuerung: e.target.value })}>
                <option value="ist">{t("Ist (nach Zahlungseingang)")}</option>
                <option value="soll">{t("Soll (nach Rechnungsdatum)")}</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>{t("Voranmeldung")}</span>
              <select id="ust-zeitraum" className={FELD} value={einst.ust_zeitraum}
                onChange={(e) => schalterSpeichern({ ust_zeitraum: e.target.value })}>
                <option value="monat">{t("monatlich")}</option>
                <option value="quartal">{t("vierteljährlich")}</option>
                <option value="jahr">{t("keine (nur Jahreserklärung)")}</option>
              </select>
            </label>
            <label className="flex items-center gap-2 pb-2">
              <input id="ust-dauerfrist" type="checkbox" checked={einst.dauerfrist} disabled={einst.ust_zeitraum === "jahr"}
                onChange={(e) => schalterSpeichern({ dauerfrist: e.target.checked })} />
              <span className="text-sm">{t("Dauerfristverlängerung")}</span>
              {einst.ust_zeitraum === "jahr" && <span className="text-xs text-slate-500 dark:text-slate-400">{t("entfällt ohne Voranmeldung")}</span>}
            </label>
          </fieldset>

          <p data-testid="ust-versteuerung-status" className={`mt-3 text-sm ${status.warnung ? "text-amber-700 dark:text-amber-300" : "text-slate-700 dark:text-slate-200"}`}>
            {status.warnung && <strong className="mr-1">{t("Soll-Versteuerung Pflicht")}.</strong>}
            {status.text}
          </p>
          {hinweis && (
            <p role="alert" className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
              {hinweis === "monat_pflicht"
                ? t("Monatliche Voranmeldung wahrscheinlich Pflicht (> 9.000 €)")
                : t("Voranmeldung wahrscheinlich Pflicht (> 2.000 €)")}
            </p>
          )}

          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse tabular-nums" data-testid="ust-tabelle">
              <thead>
                <tr className={TR}>
                  <th className={TH}>{t("Zeitraum")}</th>
                  <th className={TH}>{t("Umsatzsteuer")}</th>
                  <th className={TH}>{t("Vorsteuer")}</th>
                  <th className={TH}>{t("Zahllast/Erstattung")}</th>
                  <th className={TH}>{t("Fällig am")}</th>
                  <th className={TH}>{t("Status")}</th>
                  <th className={TH}>{t("Aktionen")}</th>
                </tr>
              </thead>
              <tbody>
                {zeilen.map((z, i) => {
                  const schluessel = `${z.art}-${z.zeitraum?.von || i}`;
                  const erstattung = z.zahllast < 0;
                  return (
                    <React.Fragment key={schluessel}>
                      <tr className={TR} data-testid="ust-zeile" data-svz={z.art === "ust_svz" || undefined} data-jahreserklaerung={z.jahreserklaerung || undefined}>
                        <td className={TD}>
                          <button type="button" className="underline decoration-dotted underline-offset-2"
                            onClick={() => setOffen((v) => (v === schluessel ? null : schluessel))}>
                            {periodeLabel(z, t)}
                          </button>
                        </td>
                        <td className={`${TD} text-right`}>{formatEuro(z.ust)}</td>
                        <td className={`${TD} text-right`}>{formatEuro(z.vst)}</td>
                        <td className={`${TD} text-right`}>{erstattung ? `${t("Erstattung")} ${formatEuro(-z.zahllast)}` : formatEuro(z.zahllast)}</td>
                        <td className={TD} title={z.nenn ? `${t("Nenntermin")}: ${tagText(z.nenn)}` : undefined}>{tagText(z.faellig)}</td>
                        <td className={TD}>
                          <div className="flex flex-wrap gap-1">
                            {z.prognose && (
                              <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-800 dark:bg-sky-950 dark:text-sky-200">{t("Prognose")}</span>
                            )}
                            {z.bezahlt && (
                              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">{t("Bezahlt")}</span>
                            )}
                          </div>
                        </td>
                        <td className={TD}>
                          {!z.jahreserklaerung && (
                            <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={() => setBezahlenFuer(z)}>
                              {t("Als bezahlt markieren")}
                            </button>
                          )}
                        </td>
                      </tr>
                      {offen === schluessel && (
                        <tr className={TR}>
                          <td colSpan={7} className="bg-slate-50 px-2 py-2 text-xs dark:bg-slate-900/40">
                            {(z.ustBelege.length === 0 && z.vstBelege.length === 0 && !z.svzAnrechnung) ? (
                              <span className="text-slate-500 dark:text-slate-400">{t("Keine Belege in diesem Zeitraum")}</span>
                            ) : (
                              <ul className="space-y-0.5">
                                {z.ustBelege.map((b, j) => (
                                  <li key={`u${j}`}>{tagText(b.datum)} · {b.nummer || b.id} · {t("USt")} {formatEuro(b.cent)}</li>
                                ))}
                                {z.vstBelege.map((b, j) => (
                                  <li key={`v${j}`}>{tagText(b.datum)} · {b.lieferant || b.id} · {t("Vorsteuer")} {formatEuro(b.cent)}</li>
                                ))}
                                {z.svzAnrechnung !== 0 && (
                                  <li data-testid="ust-svz-anrechnung">
                                    {t("Anrechnung Sondervorauszahlung {jahr} (§ 48 Abs. 4 UStDV)").replace("{jahr}", z.zeitraum.bis.slice(0, 4))} {formatEuro(-z.svzAnrechnung)}
                                  </li>
                                )}
                              </ul>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">
            {t("Steuertermine erscheinen als schwarze Markierung in der Jahresuhr.")}{" "}
            <a className="underline" href={`#/Accounting?tab=liquidity&monat=${bh.heute.slice(5, 7)}`}>
              {t("Zur Jahresuhr")}
            </a>
          </p>
        </div>
      </div>

      {bezahlenFuer && <BezahltDialog bh={bh} zeile={bezahlenFuer} onClose={() => setBezahlenFuer(null)} />}
    </div>
  );
}
