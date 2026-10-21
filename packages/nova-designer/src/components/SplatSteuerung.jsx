// Control strip of the drone scan (gaussian splats) in the 3D terrain view (phase 104-16): load a .ply / .splat
// file or the built-in example, then place it — scale, rotation about the vertical, height, "Y down" for scans
// that come upside down (COLMAP convention). Pure UI: the view owns the three.js objects.
//
// In:  info {name, anzahl} | null, lage {massstab, drehung, hoehe, umkehren}, fehler, callbacks.
// Out: calls onDatei(file), onBeispiel(), onEntfernen(), onLage(neueLage).
import React from "react";
import { useI18n } from "@core/lib/i18n";

/** Scale slider: 0…100 ↦ 10^(−1 … 2) = 0,1 … 100 (logarithmic). */
const massstabAusRegler = (/** @type {number} */ v) => Math.round(10 ** (v / 100 * 3 - 1) * 100) / 100;
const reglerAusMassstab = (/** @type {number} */ m) => Math.round(((Math.log10(m) + 1) / 3) * 100);

/**
 * @param {{info: {name: string, anzahl: number}|null, lage: {massstab: number, drehung: number, hoehe: number, umkehren: boolean},
 *   fehler: string, laedt: boolean, onDatei: (f: File) => void, onBeispiel: () => void, onEntfernen: () => void,
 *   onLage: (l: {massstab: number, drehung: number, hoehe: number, umkehren: boolean}) => void}} props
 */
export default function SplatSteuerung({ info, lage, fehler, laedt, onDatei, onBeispiel, onEntfernen, onLage }) {
  const { t } = useI18n();
  const knopf = "rounded-md border border-border px-2 py-1 text-muted-foreground transition-colors hover:bg-muted";
  return (
    <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2 text-xs" data-testid="splat-steuerung">
      <span className="font-semibold text-foreground">{t("Drohnenscan (Gaussian Splats)")}</span>
      <label className={`${knopf} cursor-pointer`} title={t("3D-Gaussian-Splatting-Scan (.ply) oder .splat laden")}>
        {t("Scan laden")}
        <input type="file" accept=".ply,.splat" className="hidden" data-testid="splat-datei"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onDatei(f); }} />
      </label>
      <button type="button" className={knopf} onClick={onBeispiel} data-testid="splat-beispiel">{t("Beispiel")}</button>
      {laedt && <span className="text-muted-foreground">{t("lädt…")}</span>}
      {info && (
        <>
          <span className="text-muted-foreground" data-testid="splat-info">
            {info.name} · {info.anzahl.toLocaleString("de-DE")} {t("Splats")}
          </span>
          <label className="flex items-center gap-1">
            {t("Maßstab")}
            <input type="range" min={0} max={100} value={reglerAusMassstab(lage.massstab)} data-testid="splat-massstab"
              onChange={(e) => onLage({ ...lage, massstab: massstabAusRegler(Number(e.target.value)) })} />
            <span className="w-10 tabular-nums">{lage.massstab.toLocaleString("de-DE")}×</span>
          </label>
          <label className="flex items-center gap-1">
            {t("Drehung")}
            <input type="range" min={0} max={359} value={lage.drehung} onChange={(e) => onLage({ ...lage, drehung: Number(e.target.value) })} />
            <span className="w-8 tabular-nums">{lage.drehung}°</span>
          </label>
          <label className="flex items-center gap-1">
            {t("Höhe")}
            <input type="range" min={-50} max={100} value={lage.hoehe} onChange={(e) => onLage({ ...lage, hoehe: Number(e.target.value) })} />
            <span className="w-10 tabular-nums">{lage.hoehe} m</span>
          </label>
          <label className="flex items-center gap-1" title={t("Viele Scans (COLMAP) zeigen nach unten — umdrehen")}>
            <input type="checkbox" checked={lage.umkehren} onChange={(e) => onLage({ ...lage, umkehren: e.target.checked })} data-testid="splat-umkehren" />
            {t("Y nach unten")}
          </label>
          <button type="button" className={knopf} onClick={onEntfernen} data-testid="splat-entfernen">{t("Entfernen")}</button>
        </>
      )}
      {fehler && <span className="text-fehler" data-testid="splat-fehler">{fehler}</span>}
    </div>
  );
}
