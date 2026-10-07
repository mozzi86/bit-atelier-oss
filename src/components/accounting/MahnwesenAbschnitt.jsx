// Section "Mahnwesen" of the outgoing-invoice tab (79-03, BUCH-06): fills the
// 79-01 stub with the list of overdue invoices, each one's current default
// interest and dunning level, a small settings block for the levels
// themselves, and the "Basiszinssatz prüfen" staleness warning. "Mahnung
// Stufe n erstellen" opens MahnDialog.jsx.
//
// In:  props bh, projektId (contract of the accounting page). Out: the area;
//      MahnDialog writes through bh.speichere("Ausgangsrechnung", …) —
//      `mahnungen[]` is one of the fields the GoBD write protection still
//      allows on an issued invoice (grundlagen.schreibschutzVerletzt).

import React from "react";
import { toast } from "sonner";
import { buttonVariants } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { tageZwischen } from "@core/lib/kalender/datum.js";
import {
  basiszinsStandWarnung, faelligeMahnstufe, forderungAm, mahnTabelle, naechsteMahnstufe, ueberfaellige,
} from "@/lib/accounting/mahnwesen.js";
import { faelligAm } from "@/lib/accounting/grundlagen.js";
import { formatEuro } from "@/lib/accounting/geld.js";
import ExportKnopf from "./gemeinsam/ExportKnopf.jsx";
import RichtwertHinweis from "./gemeinsam/RichtwertHinweis.jsx";
import MahnDialog from "./MahnDialog.jsx";

const KARTE = "rounded-xl border bg-card text-card-foreground shadow";
const KARTE_KOPF = "flex flex-col space-y-1.5 p-6";
const KARTE_TITEL = "font-semibold leading-none tracking-tight";
const KARTE_INHALT = "p-6 pt-0";
const TH = "h-9 px-2 text-left align-middle text-xs font-medium text-slate-500 dark:text-slate-400";
const TD = "px-2 py-1.5 align-middle text-sm";
const TR = "border-b border-slate-100 dark:border-slate-800";
const FELD = "h-9 w-20 rounded-md border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-900";

/** @param {string|null|undefined} iso @returns {string} dd.mm.yyyy or "—" */
function tagText(iso) {
  return iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "—";
}

/** @param {string|null} quelle verzugsbeginn().quelle @param {(k: string) => string} t */
function quelleText(quelle, t) {
  if (quelle === "vertrag") return t("vertragliches Zahlungsziel");
  if (quelle === "mahnung") return t("erste Mahnung");
  if (quelle === "30_tage") return t("30-Tage-Regel");
  return "—";
}

/**
 * One dunning row for an overdue invoice — the table and the export
 * (mahnwesen.mahnTabelle) read it; its amounts come from mahnwesen.forderungAm(),
 * the same function the dialog's letter (mahnTextFelder) uses, so screen,
 * export and letter can never disagree.
 * @param {Record<string, any>} rechnung Ausgangsrechnung
 * @param {ReadonlyArray<Record<string, any>>} vertraege Honorarvertrag[]
 * @param {Record<string, any>} einst effective settings
 * @param {string} heute 'YYYY-MM-DD'
 */
function baueZeile(rechnung, vertraege, einst, heute) {
  const vertrag = vertraege.find((v) => v.id === rechnung.honorarvertrag_id) || null;
  const { bauherrArt, verzugsbeginn: verzug, offenCent, zinsen, pauschaleCent } = forderungAm(rechnung, vertrag, heute);
  const mahnungen = Array.isArray(rechnung.mahnungen)
    ? [...rechnung.mahnungen].sort((a, b) => (a?.stufe || 0) - (b?.stufe || 0))
    : [];
  const letzteStufe = mahnungen[mahnungen.length - 1] || null;
  // naechsteStufe (display, "Fällige Stufe ab"): shown even before its date
  // arrives, so the office sees what is coming; faelligeStufe (action button
  // "Mahnung Stufe n erstellen") is the same level, gated on heute >= ab.
  const naechsteStufe = naechsteMahnstufe(rechnung, einst.mahnstufen);
  const faelligeStufe = faelligeMahnstufe(rechnung, heute, einst.mahnstufen);
  const faelligSeit = faelligAm(rechnung);
  return {
    rechnung, vertrag, bauherrArt, verzugsbeginn: verzug,
    tageUeberFaellig: faelligSeit ? tageZwischen(faelligSeit, heute) : null,
    offenCent, zinsenCent: zinsen.cent, pauschaleCent, letzteStufe, naechsteStufe, faelligeStufe,
  };
}

/** Whole days 0–365 for every level's fields — the same range einstellungen.js's own validator enforces. */
function stufenGueltig(stufen) {
  return stufen.every((s) => {
    const tageFeld = s.stufe === 1 ? "tage_nach_faellig" : "tage_nach_vorstufe";
    return [tageFeld, "frist_tage"].every((f) => Number.isInteger(s[f]) && s[f] >= 0 && s[f] <= 365);
  });
}

/**
 * @param {{bh: import("./useBuchhaltung.js").Buchhaltung, projektId: string|null}} props
 * @returns {React.ReactElement}
 */
export default function MahnwesenAbschnitt({ bh, projektId }) {
  const { t } = useI18n();
  const alle = React.useMemo(() => bh.daten.Ausgangsrechnung || [], [bh.daten.Ausgangsrechnung]);
  const vertraege = bh.daten.Honorarvertrag || [];
  const liste = React.useMemo(() => (projektId ? alle.filter((r) => r.project_id === projektId) : alle), [alle, projektId]);
  const zeilen = React.useMemo(
    () => ueberfaellige(liste, bh.heute).map((r) => baueZeile(r, vertraege, bh.einst, bh.heute)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [liste, vertraege, bh.einst, bh.heute],
  );

  const [mahnungFuer, setMahnungFuer] = React.useState(/** @type {{zeile: ReturnType<typeof baueZeile>, stufe: number}|null} */ (null));
  const [stufenBearbeiten, setStufenBearbeiten] = React.useState(false);
  const [stufenEntwurf, setStufenEntwurf] = React.useState(() => bh.einst.mahnstufen.map((s) => ({ ...s })));
  const [speichertStufen, setSpeichertStufen] = React.useState(false);

  React.useEffect(() => {
    if (!stufenBearbeiten) setStufenEntwurf(bh.einst.mahnstufen.map((s) => ({ ...s })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bh.einst.mahnstufen]);

  const basiszinsStand = basiszinsStandWarnung(bh.heute);

  const stufenSpeichern = async () => {
    setSpeichertStufen(true);
    try {
      await bh.einstellungSpeichern({ mahnstufen: stufenEntwurf });
      setStufenBearbeiten(false);
    } catch (fehler) {
      toast.error(/** @type {any} */ (fehler)?.message || String(fehler));
    } finally {
      setSpeichertStufen(false);
    }
  };

  const setzeStufenFeld = (index, feld, wert) => {
    setStufenEntwurf((liste) => liste.map((z, j) => (j === index ? { ...z, [feld]: wert } : z)));
  };

  return (
    <div className={KARTE}>
      <div className={`${KARTE_KOPF} flex-row flex-wrap items-center justify-between gap-3`}>
        <h3 className={KARTE_TITEL}>{t("Mahnwesen")}</h3>
        <div className="flex flex-wrap items-center gap-2">
          <ExportKnopf modell={mahnTabelle(zeilen, t)} bereich="mahnwesen" jahr={new Date(bh.heute).getFullYear()} />
          <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={() => setStufenBearbeiten((v) => !v)}>
            {t("Mahnstufen")}
          </button>
        </div>
      </div>
      <div className={KARTE_INHALT}>
        <RichtwertHinweis />
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{t("Zinsen sind eine Berechnung, keine Rechtsauskunft.")}</p>
        {basiszinsStand && (
          <p role="alert" className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
            {t("Basiszinssatz prüfen (Stand {datum})").replace("{datum}", tagText(basiszinsStand))}
          </p>
        )}

        {stufenBearbeiten && (
          <fieldset className="mt-4 space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <legend className="flex items-center px-1 text-sm font-medium">
              {t("Mahnstufen")}
              <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">{t("Annahme")}</span>
            </legend>
            {stufenEntwurf.map((s, i) => {
              const tageFeld = s.stufe === 1 ? "tage_nach_faellig" : "tage_nach_vorstufe";
              return (
                <div key={s.stufe} className="flex flex-wrap items-end gap-2">
                  <span className="w-16 text-sm font-medium">{t("Stufe {n}").replace("{n}", String(s.stufe))}</span>
                  <label className="flex flex-col gap-1 text-xs">
                    {s.stufe === 1 ? t("Tage nach Fälligkeit") : t("Tage nach letzter Stufe")}
                    <input type="number" min={0} max={365} className={FELD} value={s[tageFeld] ?? 0}
                      onChange={(e) => setzeStufenFeld(i, tageFeld, Number(e.target.value))} />
                  </label>
                  <label className="flex flex-col gap-1 text-xs">
                    {t("Frist (Tage)")}
                    <input type="number" min={0} max={365} className={FELD} value={s.frist_tage ?? 0}
                      onChange={(e) => setzeStufenFeld(i, "frist_tage", Number(e.target.value))} />
                  </label>
                </div>
              );
            })}
            {!stufenGueltig(stufenEntwurf) && (
              <p className="text-xs text-red-600 dark:text-red-400">{t("Bitte ganze Tage von 0 bis 365 eingeben.")}</p>
            )}
            <div className="flex gap-2">
              <button type="button" disabled={speichertStufen || !stufenGueltig(stufenEntwurf)}
                className={buttonVariants({ size: "sm" })} onClick={stufenSpeichern}>{t("Speichern")}</button>
              <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })}
                onClick={() => { setStufenEntwurf(bh.einst.mahnstufen.map((s) => ({ ...s }))); setStufenBearbeiten(false); }}>
                {t("Abbrechen")}
              </button>
            </div>
          </fieldset>
        )}

        {zeilen.length === 0 ? (
          <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">{t("Keine überfälligen Rechnungen")}</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse tabular-nums">
              <thead>
                <tr className={TR}>
                  <th className={TH}>{t("Nummer")}</th>
                  {!projektId && <th className={TH}>{t("Projekt")}</th>}
                  <th className={TH}>{t("Empfänger")}</th>
                  <th className={TH}>{t("Tage über Fälligkeit")}</th>
                  <th className={TH}>{t("Offener Betrag")}</th>
                  <th className={TH}>{t("Letzte Stufe")}</th>
                  <th className={TH}>{t("Fällige Stufe ab")}</th>
                  <th className={TH}>{t("Zinsen bis heute")}</th>
                  <th className={TH}>{t("Pauschale")}</th>
                  <th className={TH}>{t("Aktionen")}</th>
                </tr>
              </thead>
              <tbody>
                {zeilen.map((z) => (
                  <tr key={z.rechnung.id} className={TR}>
                    <td className={TD}>{z.rechnung.nummer}</td>
                    {!projektId && <td className={TD}>{z.rechnung.project_name || "—"}</td>}
                    <td className={TD}>{z.rechnung.empfaenger?.name || "—"}</td>
                    <td className={`${TD} text-right`}>{z.tageUeberFaellig ?? "—"}</td>
                    <td className={`${TD} text-right`}>{formatEuro(z.offenCent)}</td>
                    <td className={TD}>
                      {z.letzteStufe
                        ? `${t("Stufe {n}").replace("{n}", String(z.letzteStufe.stufe))} · ${tagText(z.letzteStufe.datum)}`
                        : "—"}
                    </td>
                    <td className={TD}>
                      {z.naechsteStufe
                        ? `${t("Stufe {n}").replace("{n}", String(z.naechsteStufe.stufe))} · ${tagText(z.naechsteStufe.ab)}`
                        : "—"}
                    </td>
                    <td className={`${TD} text-right`}>
                      {formatEuro(z.zinsenCent)}
                      {z.verzugsbeginn.quelle && (
                        <div className="text-xs font-normal text-slate-500 dark:text-slate-400">
                          {t("Quelle")}: {quelleText(z.verzugsbeginn.quelle, t)}
                        </div>
                      )}
                    </td>
                    <td className={`${TD} text-right`}>{formatEuro(z.pauschaleCent)}</td>
                    <td className={TD}>
                      {z.faelligeStufe && (
                        <button type="button" className={buttonVariants({ size: "sm" })}
                          onClick={() => setMahnungFuer({ zeile: z, stufe: /** @type {number} */ (z.faelligeStufe?.stufe) })}>
                          {t("Mahnung Stufe {n} erstellen").replace("{n}", String(z.faelligeStufe.stufe))}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {mahnungFuer && (
        <MahnDialog bh={bh} zeile={mahnungFuer.zeile} stufe={mahnungFuer.stufe} projektId={projektId}
          onClose={() => setMahnungFuer(null)} />
      )}
    </div>
  );
}
