// NurLokalPlakette.jsx — the badge "Nur lokale KI" (plan 93-12). Shown in Settings › KI and on the KI Tool
// page while the switch is on. Without the `aktiv` prop it reads GET /api/llm/einstellungen itself (local
// express build only) and follows EINSTELLUNGEN_EVENT.
//
// In:  { aktiv?: boolean }. Out: the badge or null; data-testid "nur-lokal-plakette".
import React from "react";
import { ShieldCheck } from "lucide-react";
import { useI18n } from "@core/lib/i18n";
import { DATENQUELLE } from "@core/lib/umgebung";
import { kiJson, EINSTELLUNGEN_EVENT } from "@/lib/kiLokalApi";

/**
 * @param {{ aktiv?: boolean }} props
 * @returns {React.ReactElement|null}
 */
export default function NurLokalPlakette({ aktiv }) {
  const { t } = useI18n();
  const [gelesen, setGelesen] = React.useState(false);

  React.useEffect(() => {
    if (aktiv !== undefined || DATENQUELLE !== "express") return undefined;
    let lebt = true;
    const lesen = () => kiJson("/llm/einstellungen").then((e) => { if (lebt) setGelesen(Boolean(e?.nur_lokal)); }).catch(() => {});
    const beiAenderung = (/** @type {any} */ ev) => setGelesen(Boolean(ev?.detail?.nur_lokal));
    lesen();
    window.addEventListener(EINSTELLUNGEN_EVENT, beiAenderung);
    return () => { lebt = false; window.removeEventListener(EINSTELLUNGEN_EVENT, beiAenderung); };
  }, [aktiv]);

  const an = aktiv ?? gelesen;
  if (!an) return null;
  return (
    <span
      data-testid="nur-lokal-plakette"
      title={t("Anfragen an KI-Dienste außerhalb dieses Rechners werden vom Server abgewiesen.")}
      className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200"
    >
      <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> {t("Nur lokale KI")}
    </span>
  );
}
