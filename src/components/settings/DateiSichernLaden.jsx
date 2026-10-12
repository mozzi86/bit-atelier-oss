// 93-13: "Als Datei sichern" / "Aus Datei laden" for the installed edition (Express data source). Until now a
// .bitproj could only be made by the browser edition and the desktop client; here the server writes the file
// (GET /api/datei/export) and an uploaded file opens the same import preview as a double-click
// (POST /api/datei/hochladen → /?import=<token>).
//
// In:  nothing. Out: a card with two buttons; data-testids datei-sichern, datei-laden, datei-meldung.
import React from "react";
import { Download, Upload } from "lucide-react";
import { useI18n } from "@core/lib/i18n";

export default function DateiSichernLaden() {
  const { t } = useI18n();
  const eingabe = React.useRef(/** @type {HTMLInputElement|null} */ (null));
  const [meldung, setMeldung] = React.useState({ text: "", fehler: false });

  const sichern = async () => {
    setMeldung({ text: t("Datei wird erstellt …"), fehler: false });
    try {
      const r = await fetch("/api/datei/export", { cache: "no-store" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || `HTTP ${r.status}`);
      const name = /filename="([^"]+)"/.exec(r.headers.get("content-disposition") || "")?.[1] || "bit-atelier.bitproj";
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url; a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMeldung({ text: `${t("Gespeichert als")} ${name}`, fehler: false });
    } catch (e) {
      setMeldung({ text: `${t("Sichern fehlgeschlagen")}: ${/** @type {Error} */ (e).message}`, fehler: true });
    }
  };

  /** @param {React.ChangeEvent<HTMLInputElement>} e */
  const laden = async (e) => {
    const datei = e.target.files?.[0];
    e.target.value = "";
    if (!datei) return;
    setMeldung({ text: t("Datei wird geprüft …"), fehler: false });
    try {
      const r = await fetch("/api/datei/hochladen", { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: await datei.arrayBuffer() });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      window.location.assign(j.pfad);
    } catch (err) {
      setMeldung({ text: `${t("Laden fehlgeschlagen")}: ${/** @type {Error} */ (err).message}`, fehler: true });
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <h3 className="mb-1 text-sm font-medium text-slate-700 dark:text-slate-200">{t("Projektdatei (.bitproj)")}</h3>
      <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">{t("Alle Projekte als eine Datei sichern oder eine Datei laden — beim Laden erscheint zuerst die Vorschau.")}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" data-testid="datei-sichern" onClick={sichern} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
          <Download className="h-4 w-4" aria-hidden="true" /> {t("Als Datei sichern")}
        </button>
        <button type="button" data-testid="datei-laden" onClick={() => eingabe.current?.click()} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
          <Upload className="h-4 w-4" aria-hidden="true" /> {t("Aus Datei laden …")}
        </button>
        <input ref={eingabe} type="file" accept=".bitproj" className="hidden" aria-label={t("Projektdatei wählen")} data-testid="datei-laden-eingabe" onChange={laden} />
      </div>
      {meldung.text && <p className={`mt-2 text-xs ${meldung.fehler ? "text-rose-600" : "text-slate-600 dark:text-slate-300"}`} data-testid="datei-meldung" role="status">{meldung.text}</p>}
    </div>
  );
}
