// BauablaufKette — card under the construction schedule (89-05, BW-07/08): predecessor and
// trade-order findings, award units (Vergabeeinheiten) with the latest award date, and the
// coverage report "every element has a trade, a BoQ item and a task" with CSV export.
//
// In:  tasks (ScheduleTask rows), projectId, projektName; loads LVPosition and the newest
//      BimSnapshot's elements (snapshotElemente). Rules: src/lib/planung/bauablauf.js.
// Out: UI; data-testids bk-karte, bk-pruefung (data-anzahl), bk-befund (data-code, data-task),
//      bk-ve (data-ve), bk-deckung (data-gesamt, data-voll, data-gewerk, data-position, data-vorgang),
//      bk-luecke (data-guid), bk-csv.
import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { bitApi } from "@core/api/bitApi";
import { useI18n } from "@core/lib/i18n";
import { snapshotElemente } from "@core/lib/snapshotElemente";
import { dateiAnbieten } from "@core/lib/tabellenExport";
import { Link2 } from "lucide-react";
import { vorgaengerPruefung, vergabeeinheiten, deckungsreport, deckungCsv, VERGABE_VORLAUF_TAGE } from "@/lib/planung/bauablauf";

const datum = (iso) => (iso ? new Date(iso).toLocaleDateString("de-DE") : "—");

/**
 * @param {{tasks: Array<any>, projectId: string, projektName?: string}} props
 */
export default function BauablaufKette({ tasks, projectId, projektName = "" }) {
  const { t } = useI18n();
  const [positionen, setPositionen] = useState(/** @type {Array<any>} */ ([]));
  const [elemente, setElemente] = useState(/** @type {Array<any>} */ ([]));
  const [fehler, setFehler] = useState(/** @type {string|null} */ (null));

  useEffect(() => {
    if (!projectId) return;
    let weg = false;
    Promise.all([
      bitApi.entities.LVPosition.filter({ project_id: projectId }).catch(() => []),
      bitApi.entities.BimSnapshot.filter({ project_id: projectId }, "-created_date").catch(() => []),
    ]).then(async ([pos, snaps]) => {
      if (weg) return;
      setPositionen(Array.isArray(pos) ? pos : []);
      const snap = Array.isArray(snaps) ? snaps[0] : null;
      if (!snap) { setElemente([]); return; }
      const r = await snapshotElemente(snap);
      if (weg) return;
      if (r.fehler) setFehler(r.fehler);
      setElemente(r.elemente);
    });
    return () => { weg = true; };
  }, [projectId, tasks]);

  const befunde = vorgaengerPruefung(tasks);
  const name = (id) => tasks.find((x) => String(x.id) === id)?.name || id;
  const liste = [...befunde.entries()].flatMap(([id, hs]) => hs.map((h) => ({ ...h, task: name(id) })));
  const ves = vergabeeinheiten(tasks);
  const deckung = deckungsreport({ elemente, tasks, positionen });
  const luecken = deckung.zeilen.filter((z) => !z.gewerk || !z.positionen.length || !z.vorgaenge.length);

  const csv = () => {
    const text = "﻿" + deckungCsv(deckung);
    dateiAnbieten(new TextEncoder().encode(text), `Deckungsreport_${String(projektName || "Projekt").replace(/[^\p{L}\p{N}_-]+/gu, "_")}.csv`, "text/csv;charset=utf-8");
  };

  return (
    <Card data-testid="bk-karte" className="mt-6">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><Link2 className="w-4 h-4" /> {t("Bauablauf-Kette")}</CardTitle>
        <p className="text-xs text-slate-500">{t("Bauteil → Gewerk → LV-Position → Vorgang. Hinweise, keine Sperren: Überlappungen können gewollt sein.")}</p>
      </CardHeader>
      <CardContent className="space-y-5">
        <section data-testid="bk-pruefung" data-anzahl={liste.length}>
          <p className="text-sm font-medium mb-1">{t("Vorgänger und Reihenfolge")}</p>
          {liste.length === 0 ? <p className="text-xs text-emerald-700">{t("Keine Auffälligkeiten.")}</p> : (
            <ul className="space-y-0.5 text-xs">
              {liste.map((h, i) => (
                <li key={i} data-testid="bk-befund" data-code={h.code} data-task={h.task} className={h.stufe === "warn" ? "text-amber-800" : "text-slate-600"}>
                  {h.stufe === "warn" ? "⚠ " : "ℹ "}<span className="font-medium">{h.task}</span>: {t(h.text)}{h.vorgaenger ? ` (${h.vorgaenger})` : ""}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <p className="text-sm font-medium mb-1">{t("Vergabeeinheiten")}</p>
          {ves.length === 0 ? <p className="text-xs text-slate-500">{t("Noch keine Vorgänge mit Vergabeeinheit.")}</p> : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-slate-400 border-b">
                <th className="py-1 px-2">{t("Vergabeeinheit")}</th><th className="py-1 px-2">{t("Gewerke")}</th>
                <th className="py-1 px-2 text-right">{t("Vorgänge")}</th><th className="py-1 px-2 text-right">{t("LV-Positionen")}</th>
                <th className="py-1 px-2">{t("Baubeginn")}</th><th className="py-1 px-2">{t("Vergabe spätestens")}</th>
              </tr></thead>
              <tbody>
                {ves.map((v) => (
                  <tr key={v.ve} className="border-b last:border-0" data-testid="bk-ve" data-ve={v.ve} data-vergabe={v.vergabeSpaetestens || ""}>
                    <td className="py-1 px-2 font-medium">{v.ve}</td><td className="py-1 px-2 text-xs">{v.gewerke.join(", ")}</td>
                    <td className="py-1 px-2 text-right">{v.vorgaenge}</td><td className="py-1 px-2 text-right">{v.positionen}</td>
                    <td className="py-1 px-2">{datum(v.start)}</td><td className="py-1 px-2">{datum(v.vergabeSpaetestens)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-[11px] text-slate-400 mt-1">{t("Vergabe spätestens = Baubeginn − {n} Tage [Annahme].").replace("{n}", String(VERGABE_VORLAUF_TAGE))}</p>
        </section>

        <section data-testid="bk-deckung" data-gesamt={deckung.gesamt} data-voll={deckung.vollstaendig}
          data-gewerk={deckung.mitGewerk} data-position={deckung.mitPosition} data-vorgang={deckung.mitVorgang}>
          <div className="flex items-center justify-between mb-1">
            <p className="text-sm font-medium">{t("Deckungsreport: jedes Bauteil hat Gewerk, Position, Vorgang")}</p>
            {deckung.gesamt > 0 && <Button size="sm" variant="outline" data-testid="bk-csv" onClick={csv}>CSV</Button>}
          </div>
          {deckung.gesamt === 0 ? (
            <p className="text-xs text-slate-500">{t("Kein Modellstand mit Bauteilen — Werkstatt-Bauteile folgen mit 89-03.")}</p>
          ) : (<>
            <p className="text-sm">
              {t("{v} von {g} Bauteilen vollständig").replace("{v}", String(deckung.vollstaendig)).replace("{g}", String(deckung.gesamt))}
              <span className="text-xs text-slate-500"> · {t("Gewerk")} {deckung.mitGewerk} · {t("Position")} {deckung.mitPosition} · {t("Vorgang")} {deckung.mitVorgang}</span>
            </p>
            <ul className="mt-1 max-h-48 overflow-auto text-xs space-y-0.5">
              {luecken.slice(0, 200).map((z) => (
                <li key={z.guid} data-testid="bk-luecke" data-guid={z.guid} className="text-slate-600">
                  <span className="font-mono">{z.guid}</span> {z.name}: {[!z.gewerk && t("ohne Gewerk"), !z.positionen.length && t("ohne Position"), !z.vorgaenge.length && t("ohne Vorgang")].filter(Boolean).join(", ")}
                </li>
              ))}
            </ul>
          </>)}
        </section>
        {fehler && <p className="text-sm text-rose-700" role="alert">{fehler}</p>}
      </CardContent>
    </Card>
  );
}
