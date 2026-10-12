// Gate of the office mode around the whole app (plan 93-03, lever 158) — local express build only.
// Asks GET /api/buero/ich once at start (and again after BUERO_EREIGNIS):
//   - host (loopback)            → the app as before; the header marker shows "Büro-Modus an" while it is on
//   - paired device              → the app; the header marker names the device
//   - unpaired device in the LAN → the pairing page (code from the host) instead of the app, because every
//                                  other /api request would answer 401
// An old server without the route (404) or a network error counts as host — the gate never locks the
// computer the app runs on out of its own data.
//
// Also shows a plain-text toast when a save replaced a newer version of a record (bitApi event
// ZWISCHENZEITLICH_GEAENDERT — last write still wins, see server routes.js veralteterStand).
//
// In:  children. Out: BueroTor, useBuero() → {ich, neuLaden}; data-testids buero-koppeln, buero-code,
//      buero-koppeln-knopf, buero-koppeln-fehler.
import React from "react";
import { toast } from "sonner";
import { Link2 } from "lucide-react";
import { I18nProvider, useI18n } from "@core/lib/i18n";
import { DATENQUELLE } from "@core/lib/umgebung";
import { ZWISCHENZEITLICH_GEAENDERT } from "@core/api/bitApi";
import { BUERO_EREIGNIS, koppeln, ladeIch, nurZiffern } from "@/lib/bueroModus.js";

/** @typedef {import('@/lib/bueroModus.js').BueroIch} BueroIch */

/** Longest wait for /api/buero/ich before the app starts as host, in milliseconds. */
const WARTEN_MS = 4000;

/** What the host shows when the server gives no answer. */
const HOST_OHNE_ANTWORT = /** @type {BueroIch} */ ({ lokal: true, aktiv: false });

const BueroKontext = React.createContext(/** @type {{ich: BueroIch|null, neuLaden: () => void}} */ ({ ich: null, neuLaden: () => {} }));

/**
 * Office-mode facts of this browser (null outside the express build or while loading).
 * @returns {{ich: BueroIch|null, neuLaden: () => void}}
 */
export function useBuero() {
  return React.useContext(BueroKontext);
}

/**
 * Pairing page of an unpaired device.
 * @returns {React.ReactElement}
 */
function GeraetKoppeln() {
  const { t } = useI18n();
  const [code, setCode] = React.useState("");
  const [fehler, setFehler] = React.useState(/** @type {string|null} */ (null));
  const [laeuft, setLaeuft] = React.useState(false);

  const absenden = async (/** @type {React.FormEvent} */ e) => {
    e.preventDefault();
    setFehler(null); setLaeuft(true);
    try {
      await koppeln(code);
      window.location.reload();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : String(err));
      setLaeuft(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 p-4 dark:bg-slate-950" data-testid="buero-koppeln">
      <form onSubmit={absenden} className="w-full max-w-sm space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-slate-800 dark:text-slate-100">
          <Link2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" /> {t("Dieses Gerät koppeln")}
        </h1>
        <p className="text-sm text-slate-700 dark:text-slate-200">
          {t("Am Büro-Rechner unter Einstellungen › System & Info › Büro-Modus einen Koppel-Code erzeugen und hier eingeben.")}
        </p>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-200" htmlFor="buero-code">{t("Koppel-Code")}</label>
        <input id="buero-code" data-testid="buero-code" inputMode="numeric" autoComplete="one-time-code" maxLength={7}
          value={code} onChange={(e) => setCode(nurZiffern(e.target.value))} placeholder="123456"
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-center font-mono text-2xl tracking-[0.4em] text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
        <button type="submit" data-testid="buero-koppeln-knopf" disabled={code.length !== 6 || laeuft}
          className="w-full rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500">
          {laeuft ? t("Wird gekoppelt …") : t("Koppeln")}
        </button>
        {fehler && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300" data-testid="buero-koppeln-fehler">{fehler}</p>}
        <p className="text-xs text-slate-600 dark:text-slate-300">
          {t("Die Verbindung im Büro-Netz ist nicht verschlüsselt. Nur in einem vertrauenswürdigen Netz verwenden, nie im Gäste-WLAN.")}
        </p>
      </form>
    </main>
  );
}

/**
 * Toast "changed meanwhile". Mounted outside the Layout's I18nProvider, so t() yields the German key — the
 * same as the Toaster itself (see @core/components/ui/toaster.jsx).
 * @returns {null}
 */
function ZwischenzeitlichHinweis() {
  const { t } = useI18n();
  React.useEffect(() => {
    const zeigen = () => toast(t("Dieser Eintrag wurde inzwischen an einem anderen Gerät oder Fenster geändert. Ihre Fassung ist gespeichert und hat die andere ersetzt."));
    window.addEventListener(ZWISCHENZEITLICH_GEAENDERT, zeigen);
    return () => window.removeEventListener(ZWISCHENZEITLICH_GEAENDERT, zeigen);
  }, [t]);
  return null;
}

/**
 * @param {{children: React.ReactNode}} props
 * @returns {React.ReactElement}
 */
export default function BueroTor({ children }) {
  const aktivImBuild = DATENQUELLE === "express";
  const [ich, setIch] = React.useState(/** @type {BueroIch|null} */ (null));

  const neuLaden = React.useCallback(() => {
    if (!aktivImBuild) return;
    // A server that does not answer within WARTEN_MS must not leave the host with a blank page.
    const frist = new Promise((_, nein) => { setTimeout(() => nein(new Error("timeout")), WARTEN_MS); });
    Promise.race([ladeIch(), frist]).then((j) => setIch(/** @type {BueroIch} */ (j))).catch(() => setIch(HOST_OHNE_ANTWORT));
  }, [aktivImBuild]);

  React.useEffect(() => {
    neuLaden();
    window.addEventListener(BUERO_EREIGNIS, neuLaden);
    return () => window.removeEventListener(BUERO_EREIGNIS, neuLaden);
  }, [neuLaden]);

  const wert = React.useMemo(() => ({ ich, neuLaden }), [ich, neuLaden]);
  if (!aktivImBuild) return <>{children}</>;
  // One small request to this computer; nothing is shown before it answered (an unpaired device would
  // otherwise flash the app and a burst of 401 errors).
  if (ich === null) return <></>;
  if (!ich.lokal && !ich.geraet) {
    return <I18nProvider><GeraetKoppeln /></I18nProvider>;
  }
  return (
    <BueroKontext.Provider value={wert}>
      <ZwischenzeitlichHinweis />
      {children}
    </BueroKontext.Provider>
  );
}
