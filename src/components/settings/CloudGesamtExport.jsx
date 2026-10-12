// 78-04 (RC-30): "Gesamtexport (ZIP)" in Settings › Daten & Sicherung for the cloud data source. Reads every
// record and blob of the office (supabaseDb.gesamtExportQuelleSupabase, loaded lazily), builds the ZIP with a
// SHA-256 manifest (@core/lib/gesamtExport) and downloads it. Shows what went in (entities, records, blobs).
//
// In:  nothing. Out: card; data-testids gesamtexport, gesamtexport-start, gesamtexport-status.
import React from "react";
import { Download } from "lucide-react";
import { useI18n } from "@core/lib/i18n";
import { gesamtExportZip } from "@core/lib/gesamtExport";

export default function CloudGesamtExport() {
  const { t } = useI18n();
  const [status, setStatus] = React.useState({ laeuft: false, text: "", fehler: false });

  const starten = async () => {
    setStatus({ laeuft: true, text: t("Daten werden gesammelt …"), fehler: false });
    try {
      const { gesamtExportQuelleSupabase } = await import("@core/api/supabaseDb");
      const quelle = await gesamtExportQuelleSupabase();
      const { zip, manifest, dateiname } = await gesamtExportZip(quelle, { org: quelle.org, quelle: "cloud" });
      const url = URL.createObjectURL(new Blob([/** @type {BlobPart} */ (/** @type {unknown} */ (zip))], { type: "application/zip" }));
      const a = document.createElement("a");
      a.href = url; a.download = dateiname; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      const n = Object.values(manifest.entitaeten).reduce((s, x) => s + x, 0);
      setStatus({ laeuft: false, fehler: false, text: `${dateiname}: ${n} ${t("Datensätze")} · ${Object.keys(manifest.entitaeten).length} ${t("Arten")} · ${manifest.blobs} ${t("Dateien aus dem Objektspeicher")}` });
    } catch (e) {
      setStatus({ laeuft: false, fehler: true, text: `${t("Gesamtexport fehlgeschlagen")}: ${e?.message || e}` });
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900" data-testid="gesamtexport">
      <h3 className="mb-1 text-sm font-medium text-slate-700 dark:text-slate-200">{t("Gesamtexport (ZIP)")}</h3>
      <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
        {t("Alle Daten des Büros aus der Cloud — jede Datenart als JSON, große Dateien aus dem Objektspeicher, dazu ein Manifest mit SHA-256 zum Prüfen.")}
      </p>
      <button type="button" onClick={starten} disabled={status.laeuft} data-testid="gesamtexport-start"
        className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
        <Download className="h-4 w-4" aria-hidden="true" /> {t("Gesamtexport herunterladen")}
      </button>
      {status.text && <p className={`mt-2 text-xs ${status.fehler ? "text-rose-600" : "text-slate-600 dark:text-slate-300"}`} data-testid="gesamtexport-status">{status.text}</p>}
    </div>
  );
}
