// PersonalZaehlkarte.jsx — In-App-Erinnerung auf der Projektübersicht (Plan
// 80-10, Task 7, D-P80-24): "Personal: N Fristen fällig", Anteil überfällig
// hervorgehoben, Link zu /People. KEINE Namen, KEINE Beträge — nur die Zahl
// aus personalFristen() (dieselbe Quelle wie die Fällig-Kachel auf /People).
// Kein Push, keine Mail (das wäre externe Kommunikation, eigene Freigabe
// nötig — Compliance-Register).
//
// Rendert nichts (null), solange kein Personal-Zugang besteht, solange
// Einstellungen › Personal-Vorlagen "personal.zaehlkarte" abgeschaltet hat,
// oder solange nichts fällig ist — eine leere Karte wäre nur Ballast auf der
// Übersicht.
//
// Dashboard.jsx lädt diese Datei per React.lazy NUR bei
// personalZugang === 'erlaubt' (eigener Chunk, s. Task-Text) — Mitglieder
// ohne Zugang laden nie ein Byte Personal-Code.
//
// In:  {personalZugang}. Out: UI, kein eigener Schreibzugriff.

import React from "react";
import { Link } from "react-router-dom";
import { IdCard, TriangleAlert } from "lucide-react";
import { useI18n } from "@core/lib/i18n";
import { useEinstellung } from "@core/lib/useEinstellung";
import { useRegelWerte } from "@core/lib/useRegelWerte";
import { heuteLokal } from "@core/lib/kalender/datum.js";
import { REGELWERKE } from "@/lib/settings/regelwerke.js";
import { personalFristen } from "@/lib/people/fristen.js";
import { bauePersonalLink } from "@/lib/people/personalLink.js";
import { usePersonalDaten } from "./usePersonalDaten.js";

/**
 * @param {{personalZugang: 'erlaubt'|'nur-lokal'|'keine-berechtigung'}} props
 * @returns {React.ReactElement|null}
 */
export default function PersonalZaehlkarte({ personalZugang }) {
  const { t } = useI18n();
  const [zeigen] = useEinstellung("personal.zaehlkarte", true);
  const { daten, laden } = usePersonalDaten();
  const { wert: regelWert, laden: regelnLaden } = useRegelWerte(REGELWERKE);

  if (personalZugang !== "erlaubt" || zeigen === false || laden || regelnLaden) return null;

  const faellig = personalFristen(daten, heuteLokal(), regelWert);
  if (faellig.length === 0) return null;
  const ueberfaellig = faellig.filter((f) => f.ueberfaellig).length;

  return (
    <Link to={`/People${bauePersonalLink({ tab: "staff" })}`} data-testid="personal-zaehlkarte"
      className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800">
      <IdCard className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
      <span className="text-slate-700 dark:text-slate-200">
        {t("Personal: {n} Fristen fällig").replace("{n}", String(faellig.length))}
      </span>
      {ueberfaellig > 0 && (
        <span className="ml-auto flex items-center gap-1 text-xs font-medium text-rose-700 dark:text-rose-300" data-testid="personal-zaehlkarte-ueberfaellig">
          <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />
          {t("{n} überfällig").replace("{n}", String(ueberfaellig))}
        </span>
      )}
    </Link>
  );
}
