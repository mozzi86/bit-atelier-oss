// 91-05: ONE button for every planner quantity list "(AVA-Übergabe)" — downloads the rows as LV CSV
// for the AVA's existing import ("LV importieren", gaeb.js parseLvCsv) through lib/avaUebergabe.js.
// Used by the drainage planner (91-03), garage, cellar and TGA network (91-05). Plain Blob download,
// no dependency; unit prices stay empty, origin + date go into the short text.
//
// In:  zeilen [{ key, label, menge, einheit }], gewerk, quelle (planner name, printed in the short
//      text), datei (file name stem), testid. Out: a small outline button (disabled without rows).
import React from "react";
import { Button } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { useProject } from "@core/lib/ProjectContext";
import { mengenAlsLvCsv } from "@designer/lib/avaUebergabe";

/**
 * @param {{zeilen: Array<{key: string, label: string, menge: number, einheit: string}>, gewerk: string, quelle: string, datei: string, testid: string, ozPrefix?: string}} props
 */
export default function AvaCsvKnopf({ zeilen, gewerk, quelle, datei, testid, ozPrefix = "01" }) {
  const { t } = useI18n();
  const { project } = useProject();
  const mitMenge = (Array.isArray(zeilen) ? zeilen : []).filter((z) => Number(z?.menge) > 0);
  const laden = () => {
    const csv = mengenAlsLvCsv(mitMenge, { gewerk, ozPrefix, quelle, stand: new Date().toLocaleDateString("de-DE") });
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${datei}-${(project?.name || "projekt").replace(/[^A-Za-z0-9ÄÖÜäöüß_-]+/g, "-")}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <Button size="sm" variant="outline" className="ml-auto h-7 text-xs" onClick={laden} disabled={mitMenge.length === 0} data-testid={testid}
      title={t("CSV für „LV importieren“ in der Ausschreibung — Einheitspreise bleiben leer, Kostengruppen sind Vorschläge")}>
      {t("Als CSV für die AVA")}
    </Button>
  );
}
