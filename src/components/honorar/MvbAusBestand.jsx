// 73-12: value of the existing building fabric to be reworked (mitzuverarbeitende Bausubstanz, mvb)
// fed from the model instead of guessed. Reads the project's latest survey model state
// (BimSnapshot → snapshotElemente, 73-03/06) and its pot "Bestand mitverarbeitet" (bestandsToepfe,
// 73-08: building elements with status "bestand", area in m²; rooms excluded). The value per m² is entered by the user — there
// is no reliable default (it depends on the fabric's condition and reuse share), so nothing is
// pre-filled. "Übernehmen" writes mvb_euro = area × value and the basis (mvb_grundlage) to the fee
// contract, so the figure stays traceable in the contract file.
//
// In:  projekt (Project), onChange(patch), idPraefix. Out: a small card; data-testids mvb-bestand,
//      mvb-satz, mvb-uebernehmen.
import React from "react";
import { bitApi } from "@core/api/bitApi";
import { useI18n } from "@core/lib/i18n";
import { snapshotElemente } from "@core/lib/snapshotElemente";
import { bestandsToepfe } from "@ava/lib/bestandsMengen";

const FELD = "h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-slate-600 dark:bg-slate-900";

/**
 * @param {{projekt: Record<string, any>|null|undefined, onChange: (patch: Record<string, any>) => void, idPraefix: string}} props
 */
export default function MvbAusBestand({ projekt, onChange, idPraefix }) {
  const { t, lang } = useI18n();
  const [topf, setTopf] = React.useState(/** @type {{menge: number, anzahl: number, modell: string}|null|"leer"} */ (null));
  const [satz, setSatz] = React.useState("");

  React.useEffect(() => {
    if (!projekt?.id) return undefined;
    let weg = false;
    (async () => {
      const snaps = await bitApi.entities.BimSnapshot.filter({ project_id: projekt.id }).catch(() => []);
      const snap = [...(snaps || [])].sort((a, b) => String(b.updated_date || b.created_date || "").localeCompare(String(a.updated_date || a.created_date || "")))[0];
      if (!snap) { if (!weg) setTopf("leer"); return; }
      const r = await snapshotElemente(snap);
      // Rooms (IfcSpace) are not building fabric — their floor area would inflate the pot.
      const bauteile = (r.elemente || []).filter((e) => e?.kind !== "space" && e?.ifc_klasse !== "IfcSpace");
      const b = bestandsToepfe(bauteile, "area").find((x) => x.key === "bestand");
      if (!weg) setTopf(b && b.anzahl ? { menge: b.menge, anzahl: b.anzahl, modell: snap.name || "" } : "leer");
    })();
    return () => { weg = true; };
  }, [projekt?.id]);

  if (!projekt?.id || topf === null) return null;
  if (topf === "leer") {
    return <p className="text-xs text-slate-500 dark:text-slate-400" data-testid="mvb-bestand" data-stand="leer">{t("Kein Modellstand mit Bauteilen „Bestand“ — den Wert der mitzuverarbeitenden Bausubstanz von Hand eintragen.")}</p>;
  }
  const zahl = (n, d = 0) => n.toLocaleString(lang === "en" ? "en-GB" : "de-DE", { maximumFractionDigits: d });
  const satzZahl = Number(String(satz).replace(",", "."));
  const ok = Number.isFinite(satzZahl) && satzZahl > 0;
  const betrag = ok ? Math.round(topf.menge * satzZahl) : null;
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700" data-testid="mvb-bestand" data-stand="modell">
      <p className="text-slate-700 dark:text-slate-200">
        {t("Modell")}{topf.modell ? ` „${topf.modell}“` : ""}: <strong>{zahl(topf.menge, 1)} m²</strong> {t("Bestand mitverarbeitet")} ({topf.anzahl} {t("Bauteile")})
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <label htmlFor={`${idPraefix}-mvb-satz`} className="text-xs font-medium text-slate-700 dark:text-slate-200">{t("Wert je m² (€)")}</label>
          <input id={`${idPraefix}-mvb-satz`} data-testid="mvb-satz" inputMode="decimal" className={`${FELD} w-32`} value={satz} onChange={(e) => setSatz(e.target.value)} />
        </div>
        <button type="button" data-testid="mvb-uebernehmen" disabled={!ok}
          className="h-9 rounded-md border border-slate-300 px-3 text-sm font-medium hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-800"
          onClick={() => onChange({ mvb_euro: betrag, mvb_grundlage: { quelle: "bestandstopf", menge_m2: Math.round(topf.menge * 10) / 10, anzahl: topf.anzahl, satz_euro_m2: satzZahl, modell: topf.modell } })}>
          {ok ? `${t("Übernehmen")}: ${zahl(/** @type {number} */ (betrag))} €` : t("Übernehmen")}
        </button>
      </div>
    </div>
  );
}
