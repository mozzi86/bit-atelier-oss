// Tab "Bank-Abgleich" of /Accounting (79-07, BUCH-11): import a bank export
// (recognised profile or manual column mapping), see new/duplicate/auto-matched
// counts before committing, then work the list — assign, ignore, undo — with a
// consistency warning when the two sides of a match have drifted apart. Fills
// the 79-01 stub.
//
// In:  props bh (contract of the accounting page). Out: the area; import and
//      every action write through bh.speichereViele/bh.speichere/bh.loesche —
//      abgleich.js only ever returns write lists, never touches storage itself.

import React from "react";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { buttonVariants } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { BANK_PROFILE, eigenesProfil, erkenneProfil, findeKopfzeile, neueUmsaetze, umsaetzeAus } from "@/lib/accounting/bankCsv.js";
import { autoZuordnen, bankTabelle, konsistenz, zuordnungLoesen } from "@/lib/accounting/abgleich.js";
import { dekodiere } from "@/lib/accounting/csv.js";
import { formatEuro } from "@/lib/accounting/geld.js";
import DateiKnopf from "./gemeinsam/DateiKnopf.jsx";
import ExportKnopf from "./gemeinsam/ExportKnopf.jsx";
import RichtwertHinweis from "./gemeinsam/RichtwertHinweis.jsx";
import StatusMarke from "./gemeinsam/StatusMarke.jsx";
import SpaltenZuordnung, { LEERE_ZUORDNUNG } from "./SpaltenZuordnung.jsx";
import ZuordnungDialog from "./ZuordnungDialog.jsx";

const KARTE = "rounded-xl border bg-card text-card-foreground shadow";
const KARTE_KOPF = "flex flex-col space-y-1.5 p-6";
const KARTE_TITEL = "font-semibold leading-none tracking-tight";
const KARTE_INHALT = "p-6 pt-0";
const TH = "h-9 px-2 text-left align-middle text-xs font-medium text-slate-500 dark:text-slate-400";
const TD = "px-2 py-1.5 align-middle text-sm";
const TR = "border-b border-slate-100 dark:border-slate-800";
const FELD = "h-9 rounded-md border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-900";

/** @param {string|null|undefined} iso @returns {string} dd.mm.yyyy or "—" */
function tagText(iso) {
  return iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "—";
}

/** @param {{status: "offen"|"zugeordnet"|"ignoriert"}} umsatz */
const statusZu = (umsatz) => (umsatz.status === "zugeordnet" ? "bezahlt" : umsatz.status === "ignoriert" ? "storniert" : "offen");

/**
 * @param {{bh: import("./useBuchhaltung.js").Buchhaltung}} props
 * @returns {React.ReactElement}
 */
export default function BankReiter({ bh }) {
  const { t } = useI18n();
  const [filter, setFilter] = React.useState(/** @type {"alle"|"offen"|"zugeordnet"|"ignoriert"} */ ("alle"));
  const [zuordnenFuer, setZuordnenFuer] = React.useState(/** @type {Record<string, any>|null} */ (null));
  const [importiert, setImportiert] = React.useState(/** @type {{umsaetze: any[], profilName: string|null}|null} */ (null));
  const [manuelleZuordnung, setManuelleZuordnung] = React.useState(/** @type {Record<string, any>|null} */ (null));
  const [importLaeuft, setImportLaeuft] = React.useState(false);

  const alle = bh.daten.Bankumsatz || [];
  const gefiltert = React.useMemo(
    () => (filter === "alle" ? alle : alle.filter((u) => u.status === filter))
      .slice().sort((a, b) => (a.buchungstag < b.buchungstag ? 1 : a.buchungstag > b.buchungstag ? -1 : 0)),
    [alle, filter],
  );
  const befunde = React.useMemo(() => konsistenz(bh.daten), [bh.daten]);
  const gespeicherteProfile = bh.einst.bank_profile || [];

  const datei = async (file) => {
    setManuelleZuordnung(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer()); // never file.text() — csv.js dekodiere is the only decoder
      const text = dekodiere(bytes);
      const rohZeilen = text.split(/\r?\n/);
      const kopfIndex = findeKopfzeile(rohZeilen);
      if (kopfIndex < 0) { toast.error(t("Keine Kopfzeile mit Buchungstag/-datum und Betrag gefunden.")); return; }
      const profilName = erkenneProfil(rohZeilen[kopfIndex]);
      if (profilName) {
        setImportiert({ umsaetze: umsaetzeAus(bytes, profilName), profilName });
        return;
      }
      const eigenesTreffer = gespeicherteProfile.find((p) => {
        try { return umsaetzeAus(bytes, p).length > 0; } catch { return false; }
      });
      if (eigenesTreffer) { setImportiert({ umsaetze: umsaetzeAus(bytes, eigenesTreffer), profilName: eigenesTreffer.name }); return; }
      setManuelleZuordnung({ bytes, zuordnung: LEERE_ZUORDNUNG });
    } catch (fehler) {
      toast.error(/** @type {any} */ (fehler)?.message || String(fehler));
    }
  };

  const zuordnungUebernehmen = () => {
    if (!manuelleZuordnung) return;
    try {
      const profil = eigenesProfil(manuelleZuordnung.zuordnung);
      setImportiert({ umsaetze: umsaetzeAus(manuelleZuordnung.bytes, profil), profilName: null });
      setManuelleZuordnung(null);
    } catch (fehler) {
      toast.error(/** @type {any} */ (fehler)?.message || String(fehler));
    }
  };

  const profilSpeichern = async (name) => {
    try {
      const profil = eigenesProfil({ ...manuelleZuordnung.zuordnung, name });
      await bh.einstellungSpeichern({ bank_profile: [...gespeicherteProfile.filter((p) => p.name !== name), profil] });
      toast.success(t("Bankprofil gespeichert"));
    } catch (fehler) {
      toast.error(/** @type {any} */ (fehler)?.message || String(fehler));
    }
  };

  const importBestaetigen = async () => {
    if (!importiert) return;
    setImportLaeuft(true);
    try {
      const importId = `import-${Date.now().toString(36)}`;
      const { neu, dubletten } = neueUmsaetze(alle, importiert.umsaetze, importId);
      const geschrieben = neu.length ? await bh.speichereViele(neu.map((u) => ({ entitaet: "Bankumsatz", obj: u }))) : [];
      let autoAnzahl = 0;
      if (geschrieben.length) {
        const nachDaten = { ...bh.daten, Bankumsatz: [...alle, ...geschrieben] };
        const autoSchreibliste = autoZuordnen(nachDaten);
        if (autoSchreibliste.length) {
          await bh.speichereViele(autoSchreibliste);
          autoAnzahl = autoSchreibliste.filter((w) => w.entitaet === "Bankumsatz").length;
        }
      }
      toast.success(t("{neu} neu · {dubletten} Dubletten · {auto} automatisch zugeordnet")
        .replace("{neu}", String(neu.length)).replace("{dubletten}", String(dubletten.length)).replace("{auto}", String(autoAnzahl)));
      setImportiert(null);
    } catch (fehler) {
      toast.error(/** @type {any} */ (fehler)?.message || String(fehler));
    } finally {
      setImportLaeuft(false);
    }
  };

  const ignorieren = async (umsatz) => {
    try { await bh.speichere("Bankumsatz", { id: umsatz.id, status: "ignoriert" }); }
    catch (fehler) { toast.error(/** @type {any} */ (fehler)?.message || String(fehler)); }
  };
  const wiederOeffnen = async (umsatz) => {
    try { await bh.speichere("Bankumsatz", { id: umsatz.id, status: "offen" }); }
    catch (fehler) { toast.error(/** @type {any} */ (fehler)?.message || String(fehler)); }
  };
  const loesen = async (umsatz) => {
    try {
      await bh.speichereViele(zuordnungLoesen(umsatz, bh.daten));
      if (umsatz.zuordnung?.typ === "Entnahme") await bh.loesche("Entnahme", umsatz.zuordnung.id);
      toast.success(t("Zuordnung gelöst"));
    } catch (fehler) {
      toast.error(/** @type {any} */ (fehler)?.message || String(fehler));
    }
  };

  return (
    <div className="space-y-6">
      <div className={KARTE}>
        <div className={`${KARTE_KOPF} flex-row flex-wrap items-center justify-between gap-3`}>
          <h3 className={KARTE_TITEL}>{t("Bank-Abgleich")}</h3>
          <div className="flex flex-wrap items-center gap-2">
            <DateiKnopf accept=".csv,text/csv" onDatei={datei}>{t("Kontoauszug importieren (CSV)")}</DateiKnopf>
            <ExportKnopf modell={() => bankTabelle(bh.daten, t, filter)} bereich="bank" jahr={Number(bh.heute.slice(0, 4))} />
          </div>
        </div>
        <div className={KARTE_INHALT}>
          <RichtwertHinweis />

          {befunde.length > 0 && (
            <p role="alert" data-testid="bank-konsistenz-hinweis"
              className="mt-3 flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {t("{n} Unstimmigkeiten im Bank-Abgleich").replace("{n}", String(befunde.length))}
            </p>
          )}

          {manuelleZuordnung && (
            <div className="mt-4 space-y-3">
              <p className="text-sm text-slate-600 dark:text-slate-300">{t("Bank nicht automatisch erkannt — Spalten bitte zuordnen.")}</p>
              <SpaltenZuordnung
                zuordnung={manuelleZuordnung.zuordnung}
                onChange={(naechste) => setManuelleZuordnung((z) => ({ ...z, zuordnung: naechste }))}
                gespeicherteProfile={gespeicherteProfile}
                onProfilSpeichern={profilSpeichern}
              />
              <div className="flex gap-2">
                <button type="button" className={buttonVariants({ size: "sm" })} onClick={zuordnungUebernehmen}>{t("Vorschau übernehmen")}</button>
                <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={() => setManuelleZuordnung(null)}>{t("Abbrechen")}</button>
              </div>
            </div>
          )}

          {importiert && (
            <div className="mt-4 space-y-3 rounded-lg border border-slate-200 p-4 dark:border-slate-700" data-testid="bank-import-vorschau">
              <p className="text-sm font-medium">
                {importiert.profilName ? BANK_PROFILE[importiert.profilName]?.label ? t(BANK_PROFILE[importiert.profilName].label) : importiert.profilName : t("Eigenes Profil")}
                {" · "}{t("{n} Zeilen in der Datei").replace("{n}", String(importiert.umsaetze.length))}
              </p>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse tabular-nums text-sm">
                  <thead>
                    <tr className={TR}>
                      <th className={TH}>{t("Buchungstag")}</th>
                      <th className={TH}>{t("Betrag")}</th>
                      <th className={TH}>{t("Verwendungszweck")}</th>
                      <th className={TH}>{t("Gegenpartei")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importiert.umsaetze.slice(0, 5).map((u, i) => (
                      <tr key={i} className={TR}>
                        <td className={TD}>{tagText(u.buchungstag)}</td>
                        <td className={`${TD} text-right`}>{formatEuro(Math.round(u.betrag * 100))}</td>
                        <td className={TD}>{u.zweck}</td>
                        <td className={TD}>{u.gegenpartei}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex gap-2">
                <button type="button" disabled={importLaeuft} className={buttonVariants({ size: "sm" })} onClick={importBestaetigen}>
                  {t("Importieren")}
                </button>
                <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={() => setImportiert(null)}>
                  {t("Abbrechen")}
                </button>
              </div>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-sm">
              <span className="font-medium">{t("Filter")}</span>
              <select id="bank-filter" className={FELD} value={filter} onChange={(e) => setFilter(/** @type {any} */ (e.target.value))}>
                <option value="alle">{t("alle")}</option>
                <option value="offen">{t("Offen")}</option>
                <option value="zugeordnet">{t("Zugeordnet")}</option>
                <option value="ignoriert">{t("Ignoriert")}</option>
              </select>
            </label>
          </div>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse tabular-nums" data-testid="bank-tabelle">
              <thead>
                <tr className={TR}>
                  <th className={TH}>{t("Buchungstag")}</th>
                  <th className={TH}>{t("Betrag")}</th>
                  <th className={TH}>{t("Verwendungszweck")}</th>
                  <th className={TH}>{t("Gegenpartei")}</th>
                  <th className={TH}>{t("Status")}</th>
                  <th className={TH}>{t("Aktionen")}</th>
                </tr>
              </thead>
              <tbody>
                {gefiltert.map((u) => (
                  <tr key={u.id} className={TR} data-testid="bank-zeile" data-status={u.status}>
                    <td className={TD}>{tagText(u.buchungstag)}</td>
                    <td className={`${TD} text-right`}>{formatEuro(Math.round(u.betrag * 100))}</td>
                    <td className={TD}>{u.zweck || "—"}</td>
                    <td className={TD}>{u.gegenpartei || "—"}</td>
                    <td className={TD}><StatusMarke status={statusZu(u)} text={u.status === "zugeordnet" ? t("Zugeordnet") : u.status === "ignoriert" ? t("Ignoriert") : t("Offen")} /></td>
                    <td className={TD}>
                      <div className="flex flex-wrap gap-1">
                        {u.status === "offen" && (
                          <>
                            <button type="button" className={buttonVariants({ size: "sm" })} onClick={() => setZuordnenFuer(u)}>{t("Zuordnen")}</button>
                            <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={() => ignorieren(u)}>{t("Ignorieren")}</button>
                          </>
                        )}
                        {u.status === "zugeordnet" && (
                          <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={() => loesen(u)}>{t("Zuordnung lösen")}</button>
                        )}
                        {u.status === "ignoriert" && (
                          <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={() => wiederOeffnen(u)}>{t("Wieder öffnen")}</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {gefiltert.length === 0 && (
                  <tr><td className={TD} colSpan={6}>{t("Keine Bankumsätze")}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {zuordnenFuer && <ZuordnungDialog bh={bh} umsatz={zuordnenFuer} onClose={() => setZuordnenFuer(null)} />}
    </div>
  );
}
