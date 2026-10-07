// Settings area "System & Info" (key `system`, 80-01): what this installation is,
// read-only — build, data path, API base, user and role, personnel access, and
// Setting keys that exist in more than one row.
//
// Duplicates are only COUNTED here, never deleted: which row holds the value the
// user meant cannot be decided by the app (@core/lib/einstellungen.js). A second
// tab with an outdated demo cache is the known way they appear (BEFUNDE-79 N-17).
//
// In:  props {kontext: {datenquelle, istDemo, personalZugang}}; reads all Setting rows.
// Out: BEREIT = true, the area.

import React from "react";
import { Download, Info } from "lucide-react";
import { bitApi } from "@core/api/bitApi";
import { useAuth } from "@core/lib/AuthContext";
import { useI18n } from "@core/lib/i18n";
import { doppelteSchluessel } from "@core/lib/einstellungen";
import { DATENQUELLE, IST_LOKAL } from "@core/lib/umgebung";
import { APP_VERSION } from "@core/lib/projektInfo";
import { appInstallieren, beiInstallAenderung, browserHinweis, installStatus } from "@/lib/settings/appInstall";

/** Ready since 80-01. */
export const BEREIT = true;

/** Build mode as the build flags know it: 'lokal' | 'standard' (the demo mode went in 83-02). */
const BUILD_MODUS = IST_LOKAL ? "lokal" : "standard";

/**
 * Text of a personnel access value (literal t() calls for the i18n guard).
 * @param {string|undefined} zugang
 * @param {(k: string) => string} t
 * @returns {string}
 */
function zugangText(zugang, t) {
  if (zugang === "erlaubt") return t("erlaubt");
  if (zugang === "nur-lokal") return t("nur lokal (Cloud gesperrt)");
  return t("keine Berechtigung");
}

/**
 * Text of the API base per data path.
 * @param {(k: string) => string} t
 * @returns {string}
 */
function apiText(t) {
  if (DATENQUELLE === "serverlos") return t("keine — Daten im Browser (IndexedDB)");
  if (DATENQUELLE === "supabase") return t("Cloud (Supabase)");
  return import.meta.env?.VITE_API_BASE_URL || "/api";
}

/**
 * Manual install hint per browser (literal t() calls for the i18n guard).
 * @param {'ios'|'safari'|'firefox'|'chromium'} art
 * @param {(k: string) => string} t
 * @returns {string}
 */
function hinweisText(art, t) {
  if (art === "ios") return t("Auf dem iPhone oder iPad: Teilen-Symbol → „Zum Home-Bildschirm“.");
  if (art === "safari") return t("In Safari: Menü „Ablage“ → „Zum Dock hinzufügen“.");
  if (art === "firefox") return t("Firefox bietet keine App-Installation. Bitte Chrome oder Edge verwenden.");
  return t("In Chrome oder Edge: das Installations-Symbol rechts in der Adressleiste anklicken.");
}

/**
 * "Als App installieren" (28.09.2026, user request): installs the PWA from the
 * browser's deferred prompt; without a prompt it shows the manual way. The
 * installed app is the serverless client build, where accounting and HR run
 * locally.
 * @param {{t: (k: string) => string}} props
 * @returns {React.ReactElement}
 */
function AppInstallieren({ t }) {
  const [status, setStatus] = React.useState(() => installStatus());
  const [wahl, setWahl] = React.useState(/** @type {'accepted'|'dismissed'|null} */ (null));
  React.useEffect(() => beiInstallAenderung(() => setStatus(installStatus())), []);
  const art = browserHinweis(typeof navigator !== "undefined" ? navigator.userAgent : "");

  const installieren = async () => {
    const ergebnis = await appInstallieren();
    setWahl(ergebnis);
    setStatus(installStatus());
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-2 dark:border-slate-700 dark:bg-slate-800/60" data-testid="app-installieren">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
        <Download className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" /> {t("Als App installieren")}
      </h3>
      {status === "installiert" ? (
        <p className="text-sm text-slate-700 dark:text-slate-200">{t("Die App ist installiert. Ihre Daten liegen in diesem Browserprofil; sichern Sie sie über Daten & Sicherung.")}</p>
      ) : (
        <>
          <p className="text-sm text-slate-700 dark:text-slate-200">
            {t("Die App läuft danach wie ein Programm mit eigenem Fenster, auch ohne Internet. Buchhaltung, Personal und alle Daten bleiben auf diesem Gerät.")}
          </p>
          {status === "bereit" ? (
            <button type="button" onClick={installieren}
              className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500">
              <Download className="h-4 w-4" aria-hidden="true" /> {t("App installieren")}
            </button>
          ) : (
            <p className="text-sm text-slate-600 dark:text-slate-300" data-testid="app-install-hinweis">{hinweisText(art, t)}</p>
          )}
          {wahl === "dismissed" && <p className="text-xs text-slate-600 dark:text-slate-300" role="status">{t("Installation abgebrochen. Sie können es jederzeit hier erneut starten.")}</p>}
        </>
      )}
      <p className="text-xs text-slate-600 dark:text-slate-300">
        {t("Sicherung nicht vergessen: Daten & Sicherung → Projektdatei exportieren, alle Bereiche angehakt.")}
      </p>
    </div>
  );
}

/**
 * @param {{kontext?: {datenquelle?: string, personalZugang?: string}}} props
 * @returns {React.ReactElement}
 */
export default function SystemBereich({ kontext }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const [doppelt, setDoppelt] = React.useState(/** @type {Array<{key: string, anzahl: number}>|null} */ (null));
  const [fehler, setFehler] = React.useState(/** @type {string|null} */ (null));

  React.useEffect(() => {
    let aktiv = true;
    /** @type {any} */ (bitApi.entities).Setting.list()
      .then((/** @type {any[]} */ rows) => { if (aktiv) setDoppelt(doppelteSchluessel(rows)); })
      .catch((/** @type {any} */ e) => { if (aktiv) setFehler(e?.message || String(e)); });
    return () => { aktiv = false; };
  }, []);

  const zeilen = [
    // 83-02: the version the feedback dialog attaches, visible here too.
    { name: t("Version"), wert: APP_VERSION, code: true },
    { name: t("Build-Modus"), wert: BUILD_MODUS, code: true },
    { name: t("Datenquelle"), wert: DATENQUELLE, code: true },
    { name: t("API-Basis"), wert: apiText(t), code: DATENQUELLE === "express" },
    { name: t("Nutzer"), wert: user?.email || user?.full_name || t("Lokaler Nutzer"), code: false },
    { name: t("Rolle"), wert: user?.role || "—", code: true },
    { name: t("Personal-Zugang"), wert: zugangText(kontext?.personalZugang, t), code: false },
  ];

  return (
    <section aria-labelledby="bereich-system" data-testid="bereich-system"
      className="rounded-xl border border-slate-200 bg-white p-6 space-y-4 dark:border-slate-700 dark:bg-slate-900">
      <h2 id="bereich-system" className="flex items-center gap-2 text-lg font-semibold text-slate-800 dark:text-slate-100">
        <Info className="h-5 w-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" /> {t("System & Info")}
      </h2>
      <AppInstallieren t={t} />
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
        {zeilen.map((z) => (
          <React.Fragment key={z.name}>
            <dt className="font-medium text-slate-600 dark:text-slate-300">{z.name}</dt>
            <dd className="min-w-0 break-words text-slate-800 dark:text-slate-100">
              {z.code ? <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-800">{z.wert}</code> : z.wert}
            </dd>
          </React.Fragment>
        ))}
        <dt className="font-medium text-slate-600 dark:text-slate-300">{t("Doppelte Einstellungen")}</dt>
        <dd className="min-w-0 text-slate-800 dark:text-slate-100" data-testid="system-dubletten">
          {fehler ? <span role="alert">{t("Einstellungen konnten nicht gelesen werden:")} {fehler}</span>
            : doppelt === null ? t("Wird geladen …")
              : doppelt.length === 0 ? t("keine")
                : (
                  <ul className="space-y-0.5">
                    {doppelt.map((d) => (
                      <li key={d.key}><code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-800">{d.key}</code> · {t("{n} Zeilen").replace("{n}", String(d.anzahl))}</li>
                    ))}
                  </ul>
                )}
        </dd>
        <dt className="font-medium text-slate-600 dark:text-slate-300">{t("Tastenkürzel")}</dt>
        <dd className="text-slate-800 dark:text-slate-100">{t("? zeigt alle Tastenkürzel, Strg K öffnet die Suche.")}</dd>
      </dl>
      <p className="text-xs text-slate-600 dark:text-slate-300">
        {t("Doppelte Zeilen löscht die App nicht: welche den gewünschten Wert trägt, entscheiden Sie.")}
      </p>
    </section>
  );
}
