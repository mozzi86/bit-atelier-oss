// ProjektChronik — the project file "what happened" (72-07): loads the existing
// records of one project (AuditLog, PruefLauf, Document, ModelVersion, Schreiben)
// and shows them as one timeline, newest first. Nothing is logged anew; documents
// and letters pass the rights filter of 82-02 (src/lib/projektChronik.js). A source
// that fails to load is named, the others still show.
//
// In:  projectId, kompakt (first 8 lines, "alle anzeigen" opens the rest).
// Out: UI; data-testids chronik, chronik-zeile (data-art), chronik-alle, chronik-fehler.
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { bitApi } from "@core/api/bitApi";
import { useI18n } from "@core/lib/i18n";
import { useZugriff } from "@core/lib/ZugriffContext";
import { isoTag } from "@core/lib/kalender/datum.js";
import { CHRONIK_ARTEN, chronik } from "@/lib/projektChronik";

/** Lines shown before "alle anzeigen". */
const KOMPAKT = 8;

/** Entity per chronicle source (key of chronik()'s input). */
const QUELLEN = Object.freeze([
  ["auditLog", "AuditLog"], ["prueflaeufe", "PruefLauf"], ["dokumente", "Document"], ["modelle", "ModelVersion"], ["schreiben", "Schreiben"],
]);

/** @param {string} iso */
const deDatum = (iso) => { const d = isoTag(iso) || ""; return d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : ""; };

/**
 * @param {{projectId: string, kompakt?: boolean}} props
 */
export default function ProjektChronik({ projectId, kompakt = true }) {
  const { t } = useI18n();
  const zugriff = useZugriff();
  const darfBriefe = zugriff.darf("schriftverkehr");
  const [zeilen, setZeilen] = useState(/** @type {ReturnType<typeof chronik>|null} */ (null));
  const [fehlend, setFehlend] = useState(/** @type {string[]} */ ([]));
  const [alle, setAlle] = useState(!kompakt);

  useEffect(() => {
    let aktiv = true;
    setZeilen(null);
    const quellen = QUELLEN.filter(([key]) => key !== "schreiben" || darfBriefe);
    Promise.allSettled(quellen.map(([, entitaet]) => bitApi.entities[entitaet].filter({ project_id: projectId }))).then((ergebnisse) => {
      if (!aktiv) return;
      /** @type {Record<string, any[]>} */
      const daten = {};
      /** @type {string[]} */
      const fehler = [];
      ergebnisse.forEach((r, i) => {
        if (r.status === "fulfilled") daten[quellen[i][0]] = Array.isArray(r.value) ? r.value : [];
        else fehler.push(quellen[i][1]);
      });
      setFehlend(fehler);
      setZeilen(chronik(daten, { zugriff }));
    });
    return () => { aktiv = false; };
  }, [projectId, darfBriefe, zugriff]);

  if (zeilen === null) return <p className="text-xs text-slate-500" data-testid="chronik">{t("Projektakte wird geladen …")}</p>;
  const sichtbar = alle ? zeilen : zeilen.slice(0, KOMPAKT);
  return (
    <div data-testid="chronik" className="space-y-1">
      {zeilen.length === 0 && <p className="text-xs text-slate-500">{t("Noch keine Ereignisse in diesem Projekt.")}</p>}
      <ol className="space-y-1">
        {sichtbar.map((z) => {
          const inhalt = (
            <>
              <span className="text-slate-400 tabular-nums w-20 shrink-0">{deDatum(z.datum)}</span>
              <span className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 shrink-0">{t(CHRONIK_ARTEN[z.art].label)}</span>
              <span className="truncate">{z.titel || "—"}{z.art === "prueflauf" && z.info ? ` · ${t("{n} Befunde").replace("{n}", z.info)}` : z.info && z.art !== "brief" ? ` · ${z.info}` : ""}</span>
            </>
          );
          return (
            <li key={z.id} data-testid="chronik-zeile" data-art={z.art} className="text-xs">
              {z.ziel
                ? <Link to={z.ziel} className="flex gap-2 items-baseline hover:underline underline-offset-4">{inhalt}</Link>
                : <div className="flex gap-2 items-baseline">{inhalt}</div>}
            </li>
          );
        })}
      </ol>
      {!alle && zeilen.length > KOMPAKT && (
        <button type="button" className="text-xs text-blue-700 hover:underline" data-testid="chronik-alle" onClick={() => setAlle(true)}>
          {t("Alle {n} Ereignisse anzeigen").replace("{n}", String(zeilen.length))}
        </button>
      )}
      {fehlend.length > 0 && <p className="text-xs text-amber-700" role="status" data-testid="chronik-fehler">{t("Nicht geladen")}: {fehlend.join(", ")}</p>}
    </div>
  );
}
