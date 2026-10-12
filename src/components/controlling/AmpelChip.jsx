// Controlling traffic light as a chip (phase 81-05, CTRL-02): colour AND text
// ("Controlling: kritisch" …), never colour alone, with an aria-label. Two parts:
//  - AmpelChip / AmpelMarke: presentational, used by the controlling page;
//  - ProjektAmpelChip: the self-loading chip in "Aktives Projekt". It asks the
//    storage layer only when the office modules are available on this data path
//    (E-03: the project overview is not a locked page — without the check it
//    would read locked data in the Supabase build); without a contract it renders
//    nothing. Cost rates only through the personnel adapter (inside ampelChip.js).
//
// In:  ampel key ('rot'|'gelb'|'gruen'|'ohne_zeiten'|'grau'), tafelFehlt; or the
//      project id for the loader. Out: the chip; a link to /Controlling?tab=project.

import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Gauge } from "lucide-react";
import { bitApi } from "@core/api/bitApi";
import { useAuth } from "@core/lib/AuthContext";
import { useI18n } from "@core/lib/i18n";
import { heuteLokal } from "@core/lib/kalender/datum.js";
import { useRegelWerte } from "@core/lib/useRegelWerte";
import { BUERO_CLOUD_FREIGABE, DATENQUELLE } from "@core/lib/umgebung";
import { REGELWERKE } from "@/lib/settings/regelwerke.js";
import { ampelChipZustand, ladeAmpelChipDaten } from "@/lib/controlling/ampelChip.js";

/** Tailwind classes per light (light and dark theme). */
const FARBE = {
  rot: "bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-900/40 dark:text-rose-200 dark:border-rose-800",
  gelb: "bg-amber-100 text-amber-900 border-amber-200 dark:bg-amber-900/40 dark:text-amber-100 dark:border-amber-800",
  gruen: "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-200 dark:border-emerald-800",
  grau: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700",
};
const PUNKT = { rot: "bg-rose-600", gelb: "bg-amber-500", gruen: "bg-emerald-600", grau: "bg-slate-400" };

/**
 * Short text of a light (LPH rows) — literal t() calls so the EN guard sees them.
 * @param {(k: string) => string} t
 * @param {string} ampel
 * @param {boolean} [tafelFehlt]
 * @returns {string}
 */
export function ampelText(t, ampel, tafelFehlt = false) {
  if (tafelFehlt) return t("Tafel fehlt");
  if (ampel === "rot") return t("kritisch");
  if (ampel === "gelb") return t("Achtung");
  if (ampel === "gruen") return t("im Plan");
  if (ampel === "ohne_zeiten") return t("ohne Zeiten");
  return t("ohne Daten");
}

/**
 * Chip text with the "Controlling:" prefix.
 * @param {(k: string) => string} t
 * @param {string} ampel
 * @param {boolean} [tafelFehlt]
 * @returns {string}
 */
function chipText(t, ampel, tafelFehlt = false) {
  if (tafelFehlt) return t("Controlling: Tafel fehlt");
  if (ampel === "rot") return t("Controlling: kritisch");
  if (ampel === "gelb") return t("Controlling: Achtung");
  if (ampel === "gruen") return t("Controlling: im Plan");
  if (ampel === "ohne_zeiten") return t("Controlling: ohne Zeiten");
  return t("Controlling: ohne Daten");
}

/** @param {string} ampel @returns {'rot'|'gelb'|'gruen'|'grau'} */
const farbeVon = (ampel) => (ampel === "rot" || ampel === "gelb" || ampel === "gruen" ? ampel : "grau");

/**
 * Small marker for one LPH or portfolio row: dot + text.
 * @param {{ampel: string, tafelFehlt?: boolean}} props
 * @returns {React.ReactElement}
 */
export function AmpelMarke({ ampel, tafelFehlt = false }) {
  const { t } = useI18n();
  const f = farbeVon(tafelFehlt ? "grau" : ampel);
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${FARBE[f]}`} data-ampel={tafelFehlt ? "tafel_fehlt" : ampel}>
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${PUNKT[f]}`} />
      {ampelText(t, ampel, tafelFehlt)}
    </span>
  );
}

/**
 * Chip "Controlling: …" with a link to the project tab of the controlling.
 * @param {{ampel: string, tafelFehlt?: boolean, ziel?: string}} props
 * @returns {React.ReactElement}
 */
export function AmpelChip({ ampel, tafelFehlt = false, ziel = "/Controlling?tab=project" }) {
  const { t } = useI18n();
  const f = farbeVon(tafelFehlt ? "grau" : ampel);
  const text = chipText(t, ampel, tafelFehlt);
  return (
    <Link to={ziel} aria-label={text} data-testid="controlling-chip" data-ampel={tafelFehlt ? "tafel_fehlt" : ampel}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium hover:underline ${FARBE[f]}`}>
      <Gauge aria-hidden="true" className="h-3.5 w-3.5" />
      {text}
    </Link>
  );
}

/**
 * Self-loading chip of the active project; renders nothing on a locked data path,
 * without a contract, while loading or after a load failure (the overview must not
 * break because of the controlling — the failure is logged in plain text).
 * @param {{projectId: string|null|undefined}} props
 * @returns {React.ReactElement|null}
 */
export default function ProjektAmpelChip({ projectId }) {
  const { user } = useAuth();
  const rolle = user?.role ?? null;
  const { wert } = useRegelWerte(REGELWERKE);
  const [geladen, setGeladen] = useState(/** @type {any} */ (null));

  useEffect(() => {
    let aktiv = true;
    setGeladen(null);
    ladeAmpelChipDaten({ api: bitApi, datenquelle: DATENQUELLE, cloudFreigabe: BUERO_CLOUD_FREIGABE, rolle, projectId })
      .then((r) => { if (aktiv) setGeladen(r); })
      .catch((fehler) => { console.error("[Controlling-Chip] Laden fehlgeschlagen:", fehler?.message || fehler); });
    return () => { aktiv = false; };
  }, [projectId, rolle]);

  const regeln = { ampel_gelb: Number(wert("zeit_honorar.ampel_gelb")) || 0, ampel_rot: Number(wert("zeit_honorar.ampel_rot") ?? 10), buerosatz: wert("zeit_honorar.buerosatz") ?? null };
  const zustand = ampelChipZustand(geladen, { regeln, heute: heuteLokal() });
  if (!zustand) return null;
  return <AmpelChip ampel={zustand.ampel} tafelFehlt={zustand.tafelFehlt} />;
}
