// Settings area "Datenschutz & Browserdaten" (key `privacy`, Plan 80-05:
// EINST-04). The one place that shows every browser-storage key this device
// actually holds (browserSpeicher.js) and the only supported way to
// bulk-remove the deletable ones. The demo block (usage-log consent, tour
// reset, header strip) went with the online demo in 83-02.
//
// In:  props {kontext} (unused, part of the area contract of
//      src/components/settings/index.js). Out: BEREIT = true, the area.

import React from "react";
import { Link } from "react-router-dom";
import { ShieldCheck, Eye, Trash2 } from "lucide-react";
import { useI18n } from "@core/lib/i18n";
import { useBestaetigung } from "@core/lib/useBestaetigung";
import { BROWSER_SCHLUESSEL, vorhandeneSchluessel, loeschbareSchluessel } from "@core/lib/browserSpeicher.js";

/** Ready since 80-05. */
export const BEREIT = true;

/**
 * @returns {React.ReactElement}
 */
export default function DatenschutzBereich() {
  const { t } = useI18n();
  const bestaetige = useBestaetigung();

  const [vorhanden, setVorhanden] = React.useState(/** @type {Set<string>} */ (new Set()));

  const vorhandeneNeuLesen = React.useCallback(() => {
    let gefunden = [];
    try {
      gefunden = [...vorhandeneSchluessel(window.localStorage), ...vorhandeneSchluessel(window.sessionStorage)];
    } catch {
      gefunden = [];
    }
    setVorhanden(new Set(gefunden));
  }, []);

  React.useEffect(() => {
    vorhandeneNeuLesen();
  }, [vorhandeneNeuLesen]);

  // --- Browser-storage table + bulk delete -------------------------------------
  const einstellungenLoeschen = async () => {
    const schluessel = loeschbareSchluessel();
    const ok = await bestaetige({
      titel: t("Lokale Einstellungen löschen?"),
      text: schluessel.join(", "),
      bestaetigen: t("Löschen"),
      abbrechen: t("Abbrechen"),
      gefahr: true,
    });
    if (!ok) return;
    for (const k of schluessel) {
      try {
        window.localStorage.removeItem(k);
      } catch {
        /* blocked storage — nothing to remove there anyway */
      }
    }
    // No reload: several of these keys (nc-theme, lang, sidebar:collapsed,
    // currentProjectId) are written back unconditionally by their own
    // provider's mount effect — reloading THIS page would re-trigger every
    // one of them and undo the delete before it could ever be observed. The
    // already-mounted providers keep their in-memory state either way; only a
    // LATER, unrelated reload sees the defaults.
    vorhandeneNeuLesen();
  };

  return (
    <section aria-labelledby="bereich-datenschutz" data-testid="bereich-privacy" className="space-y-5">
      <h2 id="bereich-datenschutz" className="flex items-center gap-2 text-lg font-semibold text-slate-800 dark:text-slate-100">
        <ShieldCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" /> {t("Datenschutz & Browserdaten")}
      </h2>

      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
          <Eye className="h-4 w-4" aria-hidden="true" /> {t("Was dieser Browser speichert")}
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs" data-testid="browserdaten-tabelle">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300">
                <th scope="col" className="py-1.5 pr-2 font-semibold">{t("Schlüssel")}</th>
                <th scope="col" className="py-1.5 pr-2 font-semibold">{t("Ort")}</th>
                <th scope="col" className="py-1.5 font-semibold">{t("Gespeichert")}</th>
              </tr>
            </thead>
            <tbody>
              {BROWSER_SCHLUESSEL.map((eintrag) => (
                <tr key={eintrag.schluessel ?? eintrag.speicher} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-1.5 pr-2 font-mono text-[11px] text-slate-700 dark:text-slate-200">{eintrag.schluessel ?? `(${eintrag.speicher})`}</td>
                  <td className="py-1.5 pr-2 text-slate-600 dark:text-slate-300">{eintrag.speicher}</td>
                  <td className="py-1.5 text-slate-600 dark:text-slate-300">
                    {eintrag.schluessel ? (vorhanden.has(eintrag.schluessel) ? t("Ja") : t("Nein")) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <button type="button" onClick={einstellungenLoeschen} data-testid="einstellungen-loeschen"
          className="inline-flex items-center gap-2 rounded-lg border border-red-300 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40">
          <Trash2 className="h-4 w-4" aria-hidden="true" /> {t("Lokale Einstellungen löschen")}
        </button>
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        <Link to="/datenschutz" className="font-medium text-emerald-700 hover:underline dark:text-emerald-400">{t("Datenschutzerklärung")}</Link>
        {" · "}
        <Link to="/cookies" className="font-medium text-emerald-700 hover:underline dark:text-emerald-400">{t("Cookies")}</Link>
      </p>
    </section>
  );
}
