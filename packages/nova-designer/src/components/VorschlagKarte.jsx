// 86-05b: one proposal card — ground-floor miniature (zones + bar outlines + rest, drawn from
// the card data of @designer/lib/bebauungsvorschlaege kartenDaten), the figures of the
// KENNZAHLEN register with unit ("—" for null — nothing is invented), a red mark when the
// proposal has fails, and the "Übernehmen" button. Pure presentation: no store, no solver.
//
// In:  vorschlag (kartenDaten), footprintM (m, for the outline), sortKey (highlighted figure),
//      gewaehlt (this proposal is the stored one), veraltet (… and it is stale), onUebernehmen.
// Out: rendered card; data-testids vs-karte / vs-uebernehmen with data-* for the specs.
import React from "react";
import { useI18n } from "@core/lib/i18n";
import { ERSCHLIESSUNG, FORM_RIEGEL } from "@designer/lib/tesselierung";
import { KENNZAHLEN } from "@designer/lib/bebauungsvorschlaege";

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

/** Fill per zone kind (ground floor only): units blue, corridors amber, cores grey. */
function zonenFarbe(z) {
  if (z.we) return { fill: "#dbeafe", stroke: "#93c5fd" };
  if (/^(Kern|Treppenraum|Aufzug) /.test(z.name)) return { fill: "#e2e8f0", stroke: "#94a3b8" };
  if (z.raumart === "flur") return { fill: "#fef3c7", stroke: "#fcd34d" };
  return { fill: "#f1f5f9", stroke: "#cbd5e1" };
}

/**
 * Figure text for the card: de-DE, ratios as percent, counts without decimals, "—" for null.
 * @param {{wert: number|null, einheit: string}} k
 * @returns {string}
 */
export function kennzahlText(k) {
  if (!k || k.wert === null || k.wert === undefined || !Number.isFinite(Number(k.wert))) return "—";
  const w = Number(k.wert);
  if (k.einheit === "–") return `${(w * 100).toLocaleString("de-DE", { maximumFractionDigits: 0 })} %`;
  if (k.einheit === "WE" || k.einheit === "Stk") return w.toLocaleString("de-DE", { maximumFractionDigits: 0 });
  return `${w.toLocaleString("de-DE", { maximumFractionDigits: 1 })} ${k.einheit}`;
}

/**
 * Human label of a proposal's typology: access type, plus the bar minimum when it is not the default.
 * @param {{erschliessung?: string, zerlegung?: {minFlaeche_m2?: number}}|undefined} typologie
 * @returns {string}
 */
export function typologieLabel(typologie) {
  const e = String(typologie?.erschliessung ?? "");
  const m = num(typologie?.zerlegung?.minFlaeche_m2, FORM_RIEGEL.minFlaeche_m2);
  const name = ERSCHLIESSUNG[e]?.label || e;
  return m !== FORM_RIEGEL.minFlaeche_m2 ? `${name} · ≥ ${m} m²` : name;
}

/**
 * Ground-floor miniature as inline SVG (world metres → viewBox, y = z like the plan).
 * 86-05c: exported for the comparison table — same footprint → same viewBox → same scale.
 * @param {{vorschlag: ReturnType<typeof import("@designer/lib/bebauungsvorschlaege").kartenDaten>, footprintM: Array<{x:number, z:number}>|null|undefined}} p
 */
export function Miniatur({ vorschlag, footprintM }) {
  const fp = Array.isArray(footprintM) ? footprintM.filter((p) => Number.isFinite(Number(p?.x)) && Number.isFinite(Number(p?.z))) : [];
  const alle = [...fp, ...vorschlag.zonenEG.flatMap((z) => z.points)];
  if (alle.length < 3) return <div className="h-28 rounded bg-slate-50" />;
  const xs = alle.map((p) => num(p.x)), zs = alle.map((p) => num(p.z));
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
  const rand = Math.max(1, (x1 - x0) * 0.03);
  const pts = (poly) => poly.map((p) => `${num(p.x).toFixed(2)},${num(p.z).toFixed(2)}`).join(" ");
  const strich = Math.max(0.08, (x1 - x0) / 400);
  return (
    <svg viewBox={`${x0 - rand} ${z0 - rand} ${x1 - x0 + 2 * rand} ${z1 - z0 + 2 * rand}`} preserveAspectRatio="xMidYMid meet"
      className="h-28 w-full rounded bg-slate-50" role="img" aria-label={typologieLabel(vorschlag.typologie)} data-testid="vs-miniatur">
      {vorschlag.rest.map((poly, i) => (
        <polygon key={`rest-${i}`} points={pts(poly)} fill="#e2e8f0" stroke="#94a3b8" strokeWidth={strich} strokeDasharray={`${strich * 4} ${strich * 3}`} />
      ))}
      {vorschlag.zonenEG.filter((z) => z.art !== "balkon" && z.raumart !== "balkon").map((z, i) => {
        const f = zonenFarbe(z);
        return <polygon key={`z-${i}`} points={pts(z.points)} fill={f.fill} stroke={f.stroke} strokeWidth={strich} />;
      })}
      {vorschlag.riegelUmrisse.map((poly, i) => (
        <polygon key={`r-${i}`} points={pts(poly)} fill="none" stroke="#334155" strokeWidth={strich * 1.5} strokeDasharray={`${strich * 6} ${strich * 3}`} />
      ))}
      {fp.length >= 3 && <polygon points={pts(fp)} fill="none" stroke="#0f172a" strokeWidth={strich * 2} />}
    </svg>
  );
}

/**
 * @param {{vorschlag: ReturnType<typeof import("@designer/lib/bebauungsvorschlaege").kartenDaten>, footprintM: Array<{x:number, z:number}>|null|undefined, sortKey: string, gewaehlt: boolean, veraltet: boolean, onUebernehmen: (v: any) => void,
 *   ausgewaehlt?: boolean, auswahlGesperrt?: boolean, onAuswahl?: (v: any, an: boolean) => void, onAehnliche?: (v: any) => void, aehnlichLaedt?: boolean,
 *   bewertung?: {rang: number|null, score: number|null, ko: string[]}|null}} props
 *   86-05c: ausgewaehlt/onAuswahl = comparison selection (auswahlGesperrt = four already chosen), onAehnliche = "ähnliche erzeugen"
 *   75-10: bewertung = rank/score of the weighted evaluation or knock-out reasons
 */
export default function VorschlagKarte({ vorschlag, footprintM, sortKey, gewaehlt, veraltet, onUebernehmen, ausgewaehlt = false, auswahlGesperrt = false, onAuswahl, onAehnliche, aehnlichLaedt = false, bewertung = null }) {
  const { t } = useI18n();
  const kz = vorschlag.kennzahlen || {};
  const typ = String(vorschlag.typologie?.erschliessung ?? "");
  return (
    <div
      className={`flex flex-col gap-2 rounded-xl border bg-white p-3 shadow-sm ${gewaehlt ? "border-emerald-400 ring-1 ring-emerald-200" : ausgewaehlt ? "border-sky-400 ring-1 ring-sky-200" : "border-slate-200"}`}
      data-testid="vs-karte" data-vorschlag={vorschlag.id} data-typ={typ} data-riegel={vorschlag.riegel}
      data-we={kz.we?.wert ?? ""} data-fails={kz.fails?.wert ?? ""} data-erschliessung={kz.erschliessung_m?.wert ?? ""}
      data-gewaehlt={gewaehlt ? "1" : "0"} data-veraltet={veraltet ? "1" : "0"} data-ausgewaehlt={ausgewaehlt ? "1" : "0"} data-ursprung={vorschlag.ursprung ?? ""}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-800">{typologieLabel(vorschlag.typologie)}</div>
          <div className="text-[11px] text-slate-500">
            {vorschlag.riegel > 1 ? `${vorschlag.riegel} ${t("Riegel")}` : t("ein Baukörper")} · {kennzahlText(kz.we)} {t("WE")}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {/* 75-10: rank of the weighted evaluation or the knock-out reason (hard rules only). */}
          {bewertung && (bewertung.ko?.length ? (
            <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700" title={bewertung.ko.join(" · ")} data-testid="vs-ko">{t("K.-o.")}</span>
          ) : bewertung.rang ? (
            <span className="rounded bg-teal-50 px-1.5 py-0.5 text-[10px] font-semibold text-teal-800" data-testid="vs-rang" data-rang={bewertung.rang} data-score={bewertung.score ?? ""}>
              {t("Rang")} {bewertung.rang} · {(Number(bewertung.score) || 0).toLocaleString("de-DE", { maximumFractionDigits: 2 })}
            </span>
          ) : null)}
          {typeof onAuswahl === "function" && (
            <label className={`inline-flex items-center gap-1 text-[10px] ${auswahlGesperrt && !ausgewaehlt ? "text-slate-400" : "text-slate-600"}`} title={auswahlGesperrt && !ausgewaehlt ? t("höchstens 4 Vorschläge im Vergleich") : undefined}>
              <input type="checkbox" className="h-3 w-3" checked={ausgewaehlt} disabled={auswahlGesperrt && !ausgewaehlt}
                onChange={(e) => onAuswahl(vorschlag, e.target.checked)} data-testid="vs-auswahl" />
              {t("Vergleichen")}
            </label>
          )}
          {vorschlag.ursprung && (
            <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-800" data-testid="vs-ursprung" title={vorschlag.ursprung}>
              {t("ähnlich zu")} {t("Vorschlag")} {vorschlag.ursprung.slice(-6)}
            </span>
          )}
          {vorschlag.hatFails && (
            <span className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-700" data-testid="vs-fails">
              {kennzahlText(kz.fails)} {t("Fails")}
            </span>
          )}
          {gewaehlt && (
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${veraltet ? "border-amber-200 bg-amber-50 text-amber-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
              {veraltet ? t("Vorschlag veraltet") : t("gewählt")}
            </span>
          )}
        </div>
      </div>
      <Miniatur vorschlag={vorschlag} footprintM={footprintM} />
      <dl className="grid grid-cols-3 gap-x-2 gap-y-1 text-[11px]">
        {KENNZAHLEN.map((k) => (
          <div key={k.key} className={`rounded px-1 ${k.key === sortKey ? "bg-sky-50 ring-1 ring-sky-200" : ""}`} title={k.quelle} data-kennzahl={k.key}>
            <dt className="truncate text-slate-500">{t(k.label)}</dt>
            <dd className="tabular-nums font-medium text-slate-800">{kennzahlText(kz[k.key])}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-1 flex gap-2">
        <button
          type="button"
          className="inline-flex h-8 flex-1 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
          onClick={() => onUebernehmen(vorschlag)}
          data-testid="vs-uebernehmen"
        >
          {t("Übernehmen")}
        </button>
        {typeof onAehnliche === "function" && (
          <button
            type="button"
            className="inline-flex h-8 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
            onClick={() => onAehnliche(vorschlag)}
            disabled={aehnlichLaedt}
            title={t("Nachbarn ohne Zufall: Erschließung ±1, Riegel-Mindestfläche bis zur nächsten anderen Zerlegung")}
            data-testid="vs-aehnliche"
          >
            {t("Ähnliche erzeugen")}
          </button>
        )}
      </div>
    </div>
  );
}
