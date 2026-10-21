// Design flood levels of the site (phase 103-03): a small editable list of HQ values
// (e.g. "HQ100 · 312,40 m ü. NHN · Quelle: Hochwassergefahrenkarte") in the "Hochwasser" tab.
// They are stored ADDITIVELY in complexData.hochwasser = { hq: [{ id, name, pegelNHN, quelle }] }
// and appear as marks on the water level slider of the 3D terrain view (gelaendeStudie.hqMarken).
// The values are typed by the user from the official flood maps — this list computes nothing.
//
// In:  hochwasser (complexData.hochwasser or null), onChange(neu) — absent = read only.
// Out: calls onChange({ ...hochwasser, hq: [...] }) on every edit.
import React from "react";
import { useI18n } from "@core/lib/i18n";

/**
 * @param {{ hochwasser: { hq?: Array<{ id: string, name: string, pegelNHN: number|string, quelle?: string }> }|null|undefined,
 *   onChange?: (neu: { hq: Array<{ id: string, name: string, pegelNHN: number|string, quelle?: string }> }) => void }} props
 *   pegelNHN in m a.s.l. (kept as typed text while editing, a comma is accepted)
 */
export default function HochwasserHqListe({ hochwasser, onChange }) {
  const { t } = useI18n();
  const hq = Array.isArray(hochwasser?.hq) ? hochwasser.hq : [];
  const nurLesen = typeof onChange !== "function";
  const setze = (/** @type {typeof hq} */ liste) => { if (!nurLesen) onChange({ ...(hochwasser || {}), hq: liste }); };
  const feld = "rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground";
  return (
    <div className="space-y-2 rounded-lg border border-border bg-card p-4" data-testid="hq-liste">
      <div className="text-sm font-semibold text-foreground">{t("Bemessungswasserstände (HQ)")}</div>
      <p className="text-xs text-muted-foreground">
        {t("Wasserstände aus der amtlichen Hochwassergefahrenkarte eintragen — sie erscheinen als Marken am Pegel-Schieber in „Gelände 3D“.")}
      </p>
      {hq.length === 0 && <div className="text-xs text-muted-foreground">{t("Noch keine HQ-Werte eingetragen.")}</div>}
      {hq.map((e, k) => (
        <div key={e.id || k} className="flex flex-wrap items-center gap-2">
          <input className={`${feld} w-24`} value={e.name ?? ""} disabled={nurLesen} aria-label={t("Bezeichnung")} placeholder="HQ100"
            data-testid={`hq-name-${k}`} onChange={(ev) => setze(hq.map((x, i) => (i === k ? { ...x, name: ev.target.value } : x)))} />
          <input className={`${feld} w-28 tabular-nums`} value={e.pegelNHN ?? ""} disabled={nurLesen} inputMode="decimal"
            aria-label={t("Wasserstand in m ü. NHN")} placeholder="312,40" data-testid={`hq-pegel-${k}`}
            onChange={(ev) => setze(hq.map((x, i) => (i === k ? { ...x, pegelNHN: ev.target.value } : x)))} />
          <span className="text-xs text-muted-foreground">{t("m ü. NHN")}</span>
          <input className={`${feld} min-w-0 flex-1`} value={e.quelle ?? ""} disabled={nurLesen} aria-label={t("Quelle")}
            placeholder={t("z. B. Hochwassergefahrenkarte, Stand 2024")} data-testid={`hq-quelle-${k}`}
            onChange={(ev) => setze(hq.map((x, i) => (i === k ? { ...x, quelle: ev.target.value } : x)))} />
          {!nurLesen && (
            <button type="button" className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
              data-testid={`hq-entfernen-${k}`} onClick={() => setze(hq.filter((_, i) => i !== k))}>
              {t("Entfernen")}
            </button>
          )}
        </div>
      ))}
      {!nurLesen && (
        <button type="button" className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted" data-testid="hq-hinzufuegen"
          onClick={() => setze([...hq, { id: `hq-${Date.now().toString(36)}`, name: hq.length ? "" : "HQ100", pegelNHN: "", quelle: "" }])}>
          {t("HQ-Wert hinzufügen")}
        </button>
      )}
    </div>
  );
}
