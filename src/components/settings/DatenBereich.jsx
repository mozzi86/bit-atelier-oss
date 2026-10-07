// Settings area "Daten & Sicherung" (key `data`, Plan 80-05: EINST-04,
// D-P80-20). Until now the backup/import/reset/snapshot tools only lived in
// the header (SpeicherStatus.jsx, 65-02/69-07/69-13/79-12) — and only in
// SERVERLOS builds, so an Express office never had any pointer to its own
// backup script at all. This area gives the same tools a permanent home in
// Settings, via the SAME dialogs (src/demo/speicherDialoge.jsx) — no second
// import/reset/snapshot path, just a second set of trigger buttons.
//
// In:  props {kontext?: {datenquelle}} (falls back to the build-time DATENQUELLE
//      when absent, same pattern KiBereich.jsx already uses). Out: BEREIT = true,
//      the area.

import React from "react";
import { Link } from "react-router-dom";
import { Database, Download, Upload, History, RotateCcw, Eraser } from "lucide-react";
import { useI18n } from "@core/lib/i18n";
import { useBestaetigung } from "@core/lib/useBestaetigung";
import { DATENQUELLE } from "@core/lib/umgebung";
import { speicherStand, speicherDauerhaft } from "@core/api/demoIdb";
import { demoDbAuslesen, letzteSicherungLesen } from "@core/api/demoDb";
import { exportProjekt } from "@core/api/projektDatei";
import { tageZwischen, heuteLokal } from "@core/lib/kalender/datum.js";
import { geraetespeicherSchluessel } from "@core/lib/browserSpeicher.js";
import { EXPORT_BEREICHE } from "@/lib/exportBereiche";
import {
  ImportVorschauDialog, ZuruecksetzenDialog, SchnappschussDialog, ExportDialog,
  useSpeicherAktionen, fokusZurueck,
} from "@/demo/speicherDialoge.jsx";

/** Ready since 80-05. */
export const BEREIT = true;

/** Human-readable byte count — same rule as the header's status line. */
function mb(n) {
  if (n >= 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
  return `${Math.round(n / 1024 / 1024)} MB`;
}

/**
 * @param {{kontext?: {datenquelle?: string}}} props
 * @returns {React.ReactElement}
 */
export default function DatenBereich({ kontext }) {
  const { t } = useI18n();
  const bestaetige = useBestaetigung();
  const datenquelle = kontext?.datenquelle ?? DATENQUELLE;

  // --- Status readout (serverlos) --------------------------------------------
  const [letzteSicherung, setLetzteSicherung] = React.useState(/** @type {{zeit: string, datensaetze: number}|null|undefined} */ (undefined));
  const [stand, setStand] = React.useState(/** @type {{benutzt: number, gesamt: number}|null} */ (null));
  const [dauerhaft, setDauerhaft] = React.useState(/** @type {boolean|null} */ (null));
  const [fehler, setFehler] = React.useState(/** @type {Error|null} */ (null));

  React.useEffect(() => {
    if (datenquelle !== "serverlos") return;
    letzteSicherungLesen().then(setLetzteSicherung).catch(() => setLetzteSicherung(null));
    speicherStand().then(setStand).catch(() => setStand(null));
    speicherDauerhaft().then(setDauerhaft).catch(() => setDauerhaft(null));
  }, [datenquelle]);

  // --- Shared dialogs (speicherDialoge.jsx) -----------------------------------
  const aktionen = useSpeicherAktionen();
  const [exportAnzahlen, setExportAnzahlen] = React.useState(/** @type {Record<string, number>|null} */ (null));
  const [resetDialog, setResetDialog] = React.useState(false);
  const [snapshots, setSnapshots] = React.useState(null);
  const [snapFehler, setSnapFehler] = React.useState("");
  const dateiRef = React.useRef(/** @type {HTMLInputElement|null} */ (null));
  const exportKnopfRef = React.useRef(/** @type {HTMLButtonElement|null} */ (null));
  const ladenKnopfRef = React.useRef(/** @type {HTMLButtonElement|null} */ (null));
  const snapKnopfRef = React.useRef(/** @type {HTMLButtonElement|null} */ (null));
  const resetKnopfRef = React.useRef(/** @type {HTMLButtonElement|null} */ (null));

  const exportOeffnen = async () => {
    try {
      const daten = await demoDbAuslesen();
      /** @type {Record<string, number>} */
      const anzahlen = {};
      for (const bereich of EXPORT_BEREICHE) {
        if (bereich.separat) continue; // no local count for a separate-file area (80-05)
        anzahlen[bereich.key] = bereich.entitaeten.reduce((n, e) => n + (Array.isArray(daten[e]) ? daten[e].length : 0), 0);
      }
      setExportAnzahlen(anzahlen);
    } catch {
      setExportAnzahlen({});
    }
  };

  const exportAusfuehren = async (optionen) => {
    try {
      await exportProjekt(undefined, optionen);
    } catch (e) {
      setFehler(e);
      throw e;
    }
  };

  const dateiGewaehlt = async (ev) => {
    const datei = ev.target.files?.[0];
    ev.target.value = "";
    if (!datei) return;
    try {
      await aktionen.dateiGewaehlt(datei);
    } catch (e) {
      setFehler(e);
    }
  };

  const importBestaetigen = async (vorherSichern) => {
    try {
      const r = await aktionen.importBestaetigen(vorherSichern);
      if (r?.schnappschussFehler) setSnapFehler(r.schnappschussFehler);
    } catch (e) {
      setFehler(e);
    }
  };

  const zuruecksetzen = async (vorherSichern) => {
    setResetDialog(false);
    try {
      const r = await aktionen.zuruecksetzen(vorherSichern);
      if (r?.schnappschussFehler) setSnapFehler(r.schnappschussFehler);
    } catch (e) {
      setFehler(e);
    }
  };

  const snapshotsOeffnen = async () => {
    setSnapFehler("");
    try {
      const { schnappschuesseListe } = await import("@core/api/schnappschuesse");
      setSnapshots(await schnappschuesseListe());
    } catch (e) {
      setSnapshots([]);
      setSnapFehler(t(String(e?.message || e)));
    }
  };

  const snapshotWiederherstellen = async (id) => {
    try {
      await aktionen.snapshotWiederherstellen(id);
    } catch (e) {
      const { schnappschuesseListe } = await import("@core/api/schnappschuesse");
      setSnapFehler(t(String(e?.message || e)));
      setSnapshots(await schnappschuesseListe().catch(() => []));
    }
  };

  // --- "Gerätespeicher leeren" (IFC autoload + BIM favourites) ----------------
  const [geraetespeicherGeleert, setGeraetespeicherGeleert] = React.useState(false);
  const geraetespeicherLeeren = async () => {
    setGeraetespeicherGeleert(false);
    const schluessel = geraetespeicherSchluessel();
    const ok = await bestaetige({
      titel: t("Gerätespeicher leeren?"),
      text: t("Entfernt die IFC-Automatik und die Favoriten im Gebäudemodell auf diesem Gerät. Projektdaten bleiben unverändert."),
      bestaetigen: t("Leeren"),
      abbrechen: t("Abbrechen"),
    });
    if (!ok) return;
    for (const k of schluessel) {
      try {
        window.localStorage.removeItem(k);
      } catch {
        /* blocked storage — nothing to remove there anyway */
      }
    }
    // No reload: only IfcViewer.jsx/BitBimStudio.jsx read these two keys, and
    // neither is mounted on /Settings — the next visit there starts empty.
    // The status line is the visible confirmation a reload used to stand in for.
    setGeraetespeicherGeleert(true);
  };

  const tageSeitSicherung = letzteSicherung ? tageZwischen(letzteSicherung.zeit.slice(0, 10), heuteLokal()) : null;

  return (
    <section aria-labelledby="bereich-daten" data-testid="bereich-data" className="space-y-5">
      <h2 id="bereich-daten" className="flex items-center gap-2 text-lg font-semibold text-slate-800 dark:text-slate-100">
        <Database className="h-5 w-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" /> {t("Daten & Sicherung")}
      </h2>

      {fehler && (
        <p role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
          {String(fehler.message || fehler)}
        </p>
      )}

      {datenquelle === "serverlos" && (
        <>
          <dl className="rounded-xl border border-slate-200 bg-white p-4 text-sm dark:border-slate-700 dark:bg-slate-900 grid gap-2 sm:grid-cols-3">
            <div>
              <dt className="text-slate-500 dark:text-slate-400">{t("Letzte Sicherung")}</dt>
              <dd className="font-medium text-slate-800 dark:text-slate-100">
                {letzteSicherung === undefined
                  ? "…"
                  : letzteSicherung && typeof tageSeitSicherung === "number"
                    ? (tageSeitSicherung <= 0 ? t("heute") : t("vor {n} Tagen").replace("{n}", String(tageSeitSicherung)))
                    : t("noch nie")}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500 dark:text-slate-400">{t("Füllstand")}</dt>
              <dd className="font-medium text-slate-800 dark:text-slate-100">{stand ? `${mb(stand.benutzt)} / ${mb(stand.gesamt)}` : "…"}</dd>
            </div>
            <div>
              <dt className="text-slate-500 dark:text-slate-400">{t("Dauerhafter Speicher")}</dt>
              <dd className="font-medium text-slate-800 dark:text-slate-100">{dauerhaft === null ? t("unbekannt") : dauerhaft ? t("Ja") : t("Nein")}</dd>
            </div>
          </dl>

          <div className="flex flex-wrap gap-2">
            <button type="button" ref={exportKnopfRef} onClick={exportOeffnen} data-testid="daten-export-oeffnen"
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
              <Download className="h-4 w-4" aria-hidden="true" /> {t("Als Datei sichern")}
            </button>
            <button type="button" ref={ladenKnopfRef} onClick={() => dateiRef.current?.click()} data-testid="daten-import-oeffnen"
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
              <Upload className="h-4 w-4" aria-hidden="true" /> {t("Projekt aus Datei laden")}
            </button>
            <button type="button" ref={snapKnopfRef} onClick={snapshotsOeffnen} data-testid="daten-snapshots-oeffnen"
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
              <History className="h-4 w-4" aria-hidden="true" /> {t("Schnappschüsse")}
            </button>
            <button type="button" ref={resetKnopfRef} onClick={() => setResetDialog(true)} data-testid="daten-reset-oeffnen"
              className="inline-flex items-center gap-2 rounded-lg border border-red-300 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40">
              <RotateCcw className="h-4 w-4" aria-hidden="true" /> {t("Alle Daten zurücksetzen")}
            </button>
            <input ref={dateiRef} type="file" accept=".bitproj,.json" onChange={dateiGewaehlt} className="hidden" aria-hidden="true" />
          </div>

          {/* D-P80-20: what the .bitproj carries — and what it never does. */}
          <p className="text-xs text-slate-500 dark:text-slate-400" data-testid="daten-bitproj-hinweis">
            {t("Übergabedatei an Fachplaner und Bauherr — enthält Projektdaten und Büro-Einstellungen wie den Briefkopf, Büro-Bereiche nur per Häkchen, keine Personaldaten.")}{" "}
            <Link to="/People" className="font-medium text-emerald-700 hover:underline dark:text-emerald-400">{t("Personaldaten sichern")}</Link>
          </p>

          <ImportVorschauDialog vorschau={aktionen.importVorschau} onAbbrechen={aktionen.importAbbrechen} onUebernehmen={importBestaetigen} rueckfokus={fokusZurueck(ladenKnopfRef)} />
          <ExportDialog anzahlen={exportAnzahlen} onAbbrechen={() => setExportAnzahlen(null)} onExport={exportAusfuehren} rueckfokus={fokusZurueck(exportKnopfRef)} />
          <ZuruecksetzenDialog
            offen={resetDialog}
            onOpenChange={setResetDialog}
            titel={t("Alle Daten zurücksetzen?")}
            text={t("Alle Eingaben auf diesem Gerät gehen verloren.")}
            knopf={t("Alle Daten zurücksetzen")}
            onZuruecksetzen={zuruecksetzen}
            rueckfokus={fokusZurueck(resetKnopfRef)}
          />
          <SchnappschussDialog liste={snapshots} fehler={snapFehler} onSchliessen={() => setSnapshots(null)} onWiederherstellen={snapshotWiederherstellen} rueckfokus={fokusZurueck(snapKnopfRef)} />
        </>
      )}

      {datenquelle === "express" && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200 space-y-2">
          <p>
            {t("Projektdaten liegen in")} <code className="rounded bg-slate-100 px-1 py-0.5 dark:bg-slate-900">server/db.json</code>
            {" "}({t("Sicherungskopie")} <code className="rounded bg-slate-100 px-1 py-0.5 dark:bg-slate-900">db.json.bak</code>).
          </p>
          <p>
            {t("Personaldaten liegen getrennt in")} <code className="rounded bg-slate-100 px-1 py-0.5 dark:bg-slate-900">server/personal.json</code>.
          </p>
          <p>
            {t("Sicherungsskript")}: <code className="rounded bg-slate-100 px-1 py-0.5 dark:bg-slate-900">backup-export.ps1</code>.{" "}
            {t("Liegt das Verzeichnis in OneDrive, synchronisiert das automatisch — ohne Verschlüsselung dieser Dateien selbst.")}
          </p>
        </div>
      )}

      {datenquelle === "supabase" && (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white/70 p-6 text-center text-sm text-slate-600 dark:border-slate-600 dark:bg-slate-900/60 dark:text-slate-300">
          {t("Cloud-Gesamtexport folgt (78-04).")}
        </p>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <h3 className="mb-1 text-sm font-medium text-slate-700 dark:text-slate-200">{t("Gerätespeicher")}</h3>
        <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
          {t("Entfernt nur gerätebezogene Anzeige-Einstellungen (IFC-Automatik, Favoriten im Gebäudemodell) — keine Projektdaten.")}
        </p>
        <button type="button" onClick={geraetespeicherLeeren} data-testid="geraetespeicher-leeren"
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
          <Eraser className="h-4 w-4" aria-hidden="true" /> {t("Gerätespeicher leeren")}
        </button>
        <p role="status" data-testid="geraetespeicher-status" className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">
          {geraetespeicherGeleert ? t("Gerätespeicher geleert.") : ""}
        </p>
      </div>
    </section>
  );
}
