// 73-13 (BEST-15): one check row with the third exit "Abweichung / Bestandsschutz". Renders the row as the
// planners always did (dot, label, detail, badge); in an existing-building project a fail/warn row gets
// "Abweichung vermerken" with an inline form (art, reason, compensation, application state). The caller owns
// the Fachlayer and stores the note under `abweichungen[key]` — this component never writes data itself.
//
// In:  it (check item, possibly overlaid by mitAbweichungen), styles (status → {dot,color,label}), bauart,
//      onVermerk(key, note|null). Out: one row; data-testids pz-<key> (data-status), pz-vermerken-<key>,
//      pz-form-<key>.
import React, { useState } from "react";
import { Badge } from "@core/components/ui/badge";
import { Button } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { ABWEICHUNG_SCHEMA } from "@core/lib/bimClassification";
import { ABWEICHUNG, RECHTSRAHMEN_TEXT } from "@designer/lib/abweichung";

const inCls = "h-8 w-full rounded border border-slate-200 bg-white px-2 text-xs";

/**
 * @param {{it: any, styles: Record<string, {dot: string, color: string, label: string}>, bauart: "neubau"|"bestand", onVermerk?: (key: string, v: object|null) => void}} props
 */
export default function PruefZeile({ it, styles, bauart, onVermerk }) {
  const { t } = useI18n();
  const [offen, setOffen] = useState(false);
  const [form, setForm] = useState(() => it.vermerk || { art: "bestandsschutz", begruendung: "", kompensation: "", antrag_status: "offen" });
  const s = styles[it.status] || styles.offen || styles.warn;
  const kannVermerken = bauart === "bestand" && onVermerk && (it.status === "fail" || it.status === "warn" || it.status === ABWEICHUNG);

  return (
    <div className="rounded-lg border p-2" data-testid={`pz-${it.key}`} data-status={it.status}>
      <div className="flex items-center gap-3">
        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${s.dot}`} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-slate-800">{it.label}</div>
          <div className="text-[11px] text-slate-500">{it.detail}</div>
          {it.vermerk && (
            <div className="mt-1 text-[11px] text-violet-800">
              {t(ABWEICHUNG_SCHEMA.arten[it.vermerk.art])} · {t("Antrag")}: {t(ABWEICHUNG_SCHEMA.antragStatus[it.vermerk.antrag_status])} — {it.vermerk.begruendung}
              {it.vermerk.kompensation ? ` · ${t("Kompensation")}: ${it.vermerk.kompensation}` : ""}
              {it.statusVorher ? ` (${t("Regel")}: ${t(styles[it.statusVorher]?.label || it.statusVorher)})` : ""}
            </div>
          )}
        </div>
        <Badge className={`${s.color} shrink-0`}>{t(s.label)}</Badge>
        {kannVermerken && (
          <Button size="sm" variant="ghost" className="h-7 text-[11px]" data-testid={`pz-vermerken-${it.key}`} onClick={() => setOffen((o) => !o)}>
            {it.vermerk ? t("Vermerk ändern") : t("Abweichung vermerken")}
          </Button>
        )}
      </div>
      {offen && (
        <div className="mt-2 grid gap-2 border-t pt-2 md:grid-cols-4" data-testid={`pz-form-${it.key}`}>
          <select className={inCls} value={form.art} onChange={(e) => setForm({ ...form, art: e.target.value })} aria-label={t("Art")}>
            {Object.entries(ABWEICHUNG_SCHEMA.arten).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
          </select>
          <select className={inCls} value={form.antrag_status} onChange={(e) => setForm({ ...form, antrag_status: e.target.value })} aria-label={t("Antragsstatus")}>
            {Object.entries(ABWEICHUNG_SCHEMA.antragStatus).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
          </select>
          <input className={`${inCls} md:col-span-2`} placeholder={t("Begründung (Pflicht)")} value={form.begruendung} onChange={(e) => setForm({ ...form, begruendung: e.target.value })} />
          <input className={`${inCls} md:col-span-3`} placeholder={t("Kompensation (z. B. Rauchmelder, zweiter Rettungsweg über Leiter)")} value={form.kompensation} onChange={(e) => setForm({ ...form, kompensation: e.target.value })} />
          <div className="flex gap-1">
            <Button size="sm" disabled={!form.begruendung.trim()} onClick={() => { onVermerk(it.key, { ...form, datum: new Date().toISOString().slice(0, 10) }); setOffen(false); }}>{t("Speichern")}</Button>
            {it.vermerk && <Button size="sm" variant="outline" onClick={() => { onVermerk(it.key, null); setOffen(false); }}>{t("Entfernen")}</Button>}
          </div>
          <p className="text-[10px] text-slate-500 md:col-span-4">{t(RECHTSRAHMEN_TEXT)}</p>
        </div>
      )}
    </div>
  );
}
