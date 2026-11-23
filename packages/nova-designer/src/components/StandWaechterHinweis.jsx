// 115-05b part 2 (A-5): mounts the focus check of the open project (useStandWaechter, @core/lib/abgleich/standWaechter.js) and
// shows its one banner: the BimModel of the project was replaced by another record (import, seed, restore) - every save of the
// project rests until the page is loaded again. Loaded LAZILY by ComplexDesigner (React.lazy; the designer's chunk is at its size
// budget), together with standWaechter.js and the i18n part of this plan.
//
// In:  projectId, the designer's side of the design-record check (KomplexWaechter). Out: the banner or nothing.

import React from "react";
import { useStandWaechter } from "@core/lib/abgleich/standWaechter.js";
import { useI18n, englischErgaenzen } from "@core/lib/i18n";
import { Button } from "@core/components/ui/button";
import { EN } from "@core/lib/i18nTeile/standwaechter-115-05b.js";

englischErgaenzen(EN);

/**
 * @param {{projectId: string, komplex?: import("@core/lib/abgleich/standWaechter.js").KomplexWaechter|null}} props
 * @returns {React.ReactElement|null}
 */
export default function StandWaechterHinweis({ projectId, komplex = null }) {
  const { ersetzt } = useStandWaechter(projectId, { komplex });
  const { t } = useI18n();
  if (!ersetzt) return null;
  return (
    <div data-testid="modell-ersetzt" role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
      <strong>{t("Modell wurde ersetzt — neu laden")}</strong>
      <span className="text-foreground">{t("Das gespeicherte Gebäudemodell dieses Projekts ist ein anderer Datensatz (Import, Wiederherstellung). Bis zum Neuladen wird nichts gespeichert.")}</span>
      <Button size="sm" variant="outline" onClick={() => window.location.reload()}>{t("Neu laden")}</Button>
    </div>
  );
}
