// 73-04 (BEST-09): choice of the basis of the build-up in an existing-building project — opening, archive
// plan or assumed standard build-up. Stored on the project (`aufbau_herkunft`, additive field) so the four
// build-up based tabs (acoustics, thermal bridges, building physics, energy) name the same basis in their
// header. Renders nothing in a new build (the planned build-up is the truth there).
//
// In:  nothing (reads the active project). Out: a select; writes Project.aufbau_herkunft and reloads the
//      project list. data-testid aufbau-herkunft.
import React, { useState } from "react";
import { bitApi } from "@core/api/bitApi";
import { useProject } from "@core/lib/ProjectContext";
import { useI18n } from "@core/lib/i18n";
import { bauartVon } from "@core/lib/bauart";
import { AUFBAU_HERKUNFT } from "@core/lib/bimClassification";

export default function AufbauHerkunftWahl() {
  const { t } = useI18n();
  const { project, reloadProjects } = useProject();
  const [fehler, setFehler] = useState("");
  if (!project?.id || bauartVon(project).bauart !== "bestand") return null;
  const wert = project.aufbau_herkunft || "";
  const setzen = async (v) => {
    setFehler("");
    try {
      await bitApi.entities.Project.update(project.id, { aufbau_herkunft: v || null });
      await reloadProjects?.();
    } catch (e) {
      setFehler(`${t("Speichern fehlgeschlagen")}: ${e?.message || e}`);
    }
  };
  return (
    <div className="space-y-1">
      <label className="text-xs text-slate-500" htmlFor="aufbau-herkunft">{t("Grundlage des Aufbaus (Bestand)")}</label>
      <select id="aufbau-herkunft" data-testid="aufbau-herkunft" value={wert} onChange={(e) => setzen(e.target.value)}
        className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm">
        <option value="">{t("nicht angegeben")}</option>
        {Object.entries(AUFBAU_HERKUNFT).map(([k, label]) => <option key={k} value={k}>{t(label)}</option>)}
      </select>
      {fehler && <p className="text-xs text-red-600">{fehler}</p>}
    </div>
  );
}
