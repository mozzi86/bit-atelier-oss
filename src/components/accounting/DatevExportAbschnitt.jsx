// DATEV export section of the "Jahresübersicht" tab (phase 79, plan 79-11,
// E-11): consultant/client number, chart-of-accounts switch (SKR03/SKR04 —
// same setting as the Einstellungen dialog), fiscal-year start, filing
// period (month/quarter/year), a preview, and the download itself — blocked
// with a plain-text reason while pruefe() finds one.
//
// In:  props {bh, von, bis} — von/bis: the WHOLE calendar year the parent tab
//      is showing (this section may narrow that to one month/quarter of it).
// Out: the section; a successful export also persists any newly assigned
//      client/supplier accounts into Setting.datev.personenkonten (this
//      section is the only writer of those, datevExtf.js stays pure).

import React from "react";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { tag, tageImMonat } from "@core/lib/kalender/datum.js";
import { useI18n } from "@core/lib/i18n";
import { buchungszeilen, exportiere, KONTENRAHMEN, pruefe, sperrgrundText } from "@/lib/accounting/datevExtf.js";
import { dateiAnbieten } from "@/lib/accounting/tabellenExport.js";

const FELD = "h-9 rounded-md border border-slate-300 bg-white px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900";
const LABEL = "text-sm font-medium text-slate-700 dark:text-slate-200";

/** @param {number} n @returns {string} zero-padded to 2 digits */
const zwei = (n) => String(n).padStart(2, "0");

/** Current moment as DATEV's 'JJJJMMTTHHMMSSmmm' (17 digits, local time). @returns {string} */
function zeitstempelJetzt() {
  const d = new Date();
  return `${d.getFullYear()}${zwei(d.getMonth() + 1)}${zwei(d.getDate())}${zwei(d.getHours())}${zwei(d.getMinutes())}${zwei(d.getSeconds())}${String(d.getMilliseconds()).padStart(3, "0")}`;
}

/**
 * The actual export range from the section's own period choice, narrowed
 * from the parent tab's whole-year `von`/`bis`.
 * @param {string} von 'YYYY-01-01' (the parent's year start)
 * @param {"jahr"|"quartal"|"monat"} modus
 * @param {number} teilNr 1–4 (quarter) or 1–12 (month), ignored for "jahr"
 * @returns {{von: string, bis: string}}
 */
function zeitraumEffektiv(von, bis, modus, teilNr) {
  const jahrZahl = Number(von.slice(0, 4));
  if (modus === "monat") {
    return { von: tag(jahrZahl, teilNr, 1), bis: tag(jahrZahl, teilNr, tageImMonat(jahrZahl, teilNr)) };
  }
  if (modus === "quartal") {
    const startMonat = (teilNr - 1) * 3 + 1;
    const endMonat = startMonat + 2;
    return { von: tag(jahrZahl, startMonat, 1), bis: tag(jahrZahl, endMonat, tageImMonat(jahrZahl, endMonat)) };
  }
  return { von, bis };
}

/**
 * @param {{bh: import("./useBuchhaltung.js").Buchhaltung, von: string, bis: string}} props
 * @returns {React.ReactElement}
 */
export default function DatevExportAbschnitt({ bh, von, bis }) {
  const { t } = useI18n();
  const [modus, setModus] = React.useState(/** @type {"jahr"|"quartal"|"monat"} */ ("jahr"));
  const [teilNr, setTeilNr] = React.useState(1);
  const [berater, setBerater] = React.useState(bh.einst.datev?.berater || "");
  const [mandant, setMandant] = React.useState(bh.einst.datev?.mandant || "");
  const [wjBeginn, setWjBeginn] = React.useState(bh.einst.datev?.wj_beginn || "01-01");
  const [kontenrahmen, setKontenrahmen] = React.useState(bh.einst.kontenrahmen || "SKR03");
  const [speichert, setSpeichert] = React.useState(false);

  const { von: vonEff, bis: bisEff } = zeitraumEffektiv(von, bis, modus, teilNr);
  const einstAktuell = { ...bh.einst, kontenrahmen, datev: { ...bh.einst.datev, berater, mandant, wj_beginn: wjBeginn } };
  const gesperrt = pruefe({ berater, mandant, wjBeginn }, vonEff, bisEff);

  const vorschau = React.useMemo(
    () => buchungszeilen(bh.daten, { von: vonEff, bis: bisEff, einst: einstAktuell, kontenrahmen: bh.saetze.kontenrahmen[kontenrahmen] }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- einstAktuell is a fresh object every render on purpose (form state), comparing its scalar parts instead avoids an infinite recompute loop
    [bh.daten, bh.saetze, vonEff, bisEff, kontenrahmen, berater, mandant, wjBeginn],
  );

  const einstellungenUebernehmen = async () => {
    const patch = {};
    if (berater !== (bh.einst.datev?.berater || "")) patch.datev = { ...bh.einst.datev, berater };
    if (mandant !== (bh.einst.datev?.mandant || "")) patch.datev = { ...(patch.datev || bh.einst.datev), mandant };
    if (wjBeginn !== (bh.einst.datev?.wj_beginn || "01-01")) patch.datev = { ...(patch.datev || bh.einst.datev), wj_beginn: wjBeginn };
    if (kontenrahmen !== bh.einst.kontenrahmen) patch.kontenrahmen = kontenrahmen;
    if (Object.keys(patch).length) await bh.einstellungSpeichern(patch);
  };

  const herunterladen = async () => {
    setSpeichert(true);
    try {
      await einstellungenUebernehmen();
      const { bytes, dateiname, warnungen, personenkontenNeu } = exportiere({
        daten: bh.daten, einst: einstAktuell, saetze: bh.saetze, von: vonEff, bis: bisEff,
        exportiertVon: bh.einst.buero?.name || "", zeitstempel: zeitstempelJetzt(),
      });
      if (Object.keys(personenkontenNeu).length) {
        await bh.einstellungSpeichern({ datev: { ...einstAktuell.datev, personenkonten: { ...(bh.einst.datev?.personenkonten || {}), ...personenkontenNeu } } });
      }
      dateiAnbieten(bytes, dateiname, "text/csv;charset=windows-1252");
      if (warnungen.ersetzt > 0 || warnungen.lohnbuchungen > 0) {
        toast.warning(`${warnungen.ersetzt} ${t("ersetzte Zeichen")}, ${warnungen.lohnbuchungen} ${t("Lohnbuchungen nicht im Stapel")}`);
      } else {
        toast.success(t("DATEV-Export erstellt"));
      }
    } catch (err) {
      toast.error(`${t("Export fehlgeschlagen")}: ${/** @type {any} */ (err)?.message || String(err)}`);
    } finally {
      setSpeichert(false);
    }
  };

  return (
    <section className="space-y-3 rounded-lg border border-slate-200 p-4 dark:border-slate-700" data-testid="datev-export" aria-labelledby="datev-titel">
      <h3 id="datev-titel" className="font-semibold text-slate-800 dark:text-slate-100">{t("DATEV-Export für den Steuerberater")}</h3>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <label htmlFor="datev-berater" className={LABEL}>{t("Beraternummer")}</label>
          <input id="datev-berater" type="text" inputMode="numeric" className={FELD} value={berater}
            onChange={(e) => setBerater(e.target.value.replace(/\D/g, ""))} />
        </div>
        <div className="space-y-1">
          <label htmlFor="datev-mandant" className={LABEL}>{t("Mandantennummer")}</label>
          <input id="datev-mandant" type="text" inputMode="numeric" className={FELD} value={mandant}
            onChange={(e) => setMandant(e.target.value.replace(/\D/g, ""))} />
        </div>
        <div className="space-y-1">
          <label htmlFor="datev-wj" className={LABEL}>{t("Wirtschaftsjahr-Beginn (MM-TT)")}</label>
          <input id="datev-wj" type="text" placeholder="01-01" className={FELD} value={wjBeginn}
            onChange={(e) => setWjBeginn(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label htmlFor="datev-kontenrahmen" className={LABEL}>{t("Kontenrahmen")}</label>
          <select id="datev-kontenrahmen" className={FELD} value={kontenrahmen} onChange={(e) => setKontenrahmen(e.target.value)}>
            <option value="SKR03">SKR03</option>
            <option value="SKR04">SKR04</option>
          </select>
          {KONTENRAHMEN[kontenrahmen]?.[0]?.annahme && (
            <span data-testid="datev-kontenrahmen-annahme" className="inline-block rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              {t("Annahme")}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="datev-zeitraum" className={LABEL}>{t("Zeitraum")}</label>
        <select id="datev-zeitraum" className={FELD} value={modus} onChange={(e) => { setModus(/** @type {any} */ (e.target.value)); setTeilNr(1); }}>
          <option value="jahr">{t("Ganzes Jahr")}</option>
          <option value="quartal">{t("Quartal")}</option>
          <option value="monat">{t("Monat")}</option>
        </select>
        {modus !== "jahr" && (
          <select className={FELD} value={teilNr} onChange={(e) => setTeilNr(Number(e.target.value))} aria-label={t("Zeitraum")}>
            {Array.from({ length: modus === "quartal" ? 4 : 12 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>{modus === "quartal" ? `Q${n}` : n}</option>
            ))}
          </select>
        )}
      </div>

      <p data-testid="datev-vorschau" className="text-sm text-slate-700 dark:text-slate-200">
        {t("{n} Buchungen, {m} Warnungen").replace("{n}", String(vorschau.zeilen.length)).replace("{m}", String(vorschau.warnungLohnbuchungen))}
      </p>

      {gesperrt.length > 0 && (
        <ul className="space-y-1 text-sm text-amber-800 dark:text-amber-200">
          {gesperrt.map((g) => <li key={g}>{sperrgrundText(g, t)}</li>)}
        </ul>
      )}

      <button type="button" disabled={gesperrt.length > 0 || speichert} onClick={herunterladen}
        className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-emerald-500 dark:hover:bg-emerald-600">
        <Download className="h-4 w-4" aria-hidden="true" /> {t("DATEV-Buchungsstapel herunterladen")}
      </button>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        {t("Vor produktiver Nutzung Probeimport beim Steuerberater; keine Bankbuchungen im Stapel.")}
      </p>
    </section>
  );
}
