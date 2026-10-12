// Header marker of the office mode (plan 93-03, lever 158): visible on every page while other devices may use
// this installation.
//   host, office mode on → amber "Büro-Modus an" (link to Settings › System & Info)
//   paired device        → sky "Gerät: <Name>" — whoever holds the tablet sees which pairing it uses
//   otherwise            → nothing
// The icon stays at every width; the text from the `sm` breakpoint (the header is tight on phones).
//
// In:  useBuero() from BueroTor. Out: the marker or null; data-testid buero-kennung (data-art host|geraet).
import React from "react";
import { Link } from "react-router-dom";
import { Network, Tablet } from "lucide-react";
import { useI18n } from "@core/lib/i18n";
import { useBuero } from "./BueroTor.jsx";

const PILLE = "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium";

/**
 * @returns {React.ReactElement|null}
 */
export default function BueroKennung() {
  const { t } = useI18n();
  const { ich } = useBuero();
  if (!ich) return null;

  if (!ich.lokal && ich.geraet) {
    const text = t("Gerät: {name}").replace("{name}", ich.geraet.name);
    return (
      <span data-testid="buero-kennung" data-art="geraet" title={t("Gekoppeltes Gerät im Büro-Modus")} aria-label={text}
        className={`${PILLE} border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-700 dark:bg-sky-950/40 dark:text-sky-300`}>
        <Tablet className="h-3 w-3" aria-hidden="true" /><span className="hidden sm:inline">{text}</span>
      </span>
    );
  }
  if (ich.lokal && ich.aktiv) {
    return (
      <Link to="/Settings?tab=system" data-testid="buero-kennung" data-art="host"
        title={t("Gekoppelte Geräte im Büro-Netz können diese Installation nutzen.")} aria-label={t("Büro-Modus an")}
        className={`${PILLE} border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300`}>
        <Network className="h-3 w-3" aria-hidden="true" /><span className="hidden sm:inline">{t("Büro-Modus an")}</span>
      </Link>
    );
  }
  return null;
}
