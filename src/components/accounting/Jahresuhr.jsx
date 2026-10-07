// The year clock itself (79-10): a thin, accessible SVG renderer over the
// pure model of src/lib/accounting/jahresuhr.js (pattern: model, then a thin
// renderer — packages/nova-ifc-viewer/src/lib/befundkarte.js). All geometry
// (paths, points, radii) comes from the model; this file only maps it to SVG
// elements, classes and texts. Every drawn element carries `data-symbol` so
// the legend (JahresuhrLegende.jsx) can be proven to draw exactly the same set
// (symbolArten()).
//
// In:  props modell (uhrModell() result), jahr, heuteMonat, monatMarkiert
//      (1–12), onMonatWahl(monat). Out: a <figure><svg>…</svg><figcaption>
//      with the scale; one roving tab stop over the 12 months (role="button",
//      aria-pressed, aria-current="date" on the current month), Arrow
//      keys/Home/End move the tab stop, Enter/Space selects.

import React from "react";
import { useI18n } from "@core/lib/i18n";
import { naechsterMonat } from "@/lib/accounting/jahresuhr.js";
import { steuerartText } from "@/lib/accounting/liquiditaet.js";
import { formatEuro } from "@/lib/accounting/geld.js";

/** @param {string} iso 'YYYY-MM-DD' @returns {string} 'DD.MM.YYYY' */
function tagText(iso) {
  return iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "—";
}

/**
 * @param {boolean|null} gedeckt
 * @param {(k: string) => string} t
 */
function deckungText(gedeckt, t) {
  if (gedeckt === true) return t("gedeckt");
  if (gedeckt === false) return t("Deckung gefährdet");
  return t("Deckung unbekannt");
}

/**
 * @param {{
 *   modell: ReturnType<typeof import("@/lib/accounting/jahresuhr.js").uhrModell>,
 *   jahr: number, heuteMonat: number|null, monatMarkiert: number, onMonatWahl: (monat: number) => void,
 * }} props
 * @returns {React.ReactElement}
 */
export default function Jahresuhr({ modell, jahr, heuteMonat, monatMarkiert, onMonatWahl }) {
  const { t, lang } = useI18n();
  const rohId = React.useId().replace(/:/g, "");
  const schraffurId = `jahresuhr-defizit-${rohId}`;
  const [fokus, setFokus] = React.useState(monatMarkiert || heuteMonat || 1);
  React.useEffect(() => setFokus(monatMarkiert || fokus), [monatMarkiert]); // eslint-disable-line react-hooks/exhaustive-deps
  const refs = React.useRef(/** @type {Record<number, SVGGElement|null>} */ ({}));

  const waehlen = (monat) => { setFokus(monat); onMonatWahl(monat); };
  const taste = (e) => {
    if (["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      const naechster = naechsterMonat(fokus, /** @type {any} */ (e.key));
      setFokus(naechster);
      refs.current[naechster]?.focus();
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      waehlen(fokus);
    }
  };

  const artenText = (arten) => arten.map((a) => steuerartText(a, t)).join(" + ");
  // Same figures as the monthly table (tabular view), plus the month's tax dates and their coverage.
  const monatText = (s) => {
    const teile = [`${t("Eingänge")} ${formatEuro(s.eingaengeCent, lang)}`, `${t("Abfluss")} ${formatEuro(s.abflussCent, lang)}`];
    if (s.saldoEndeCent !== null) teile.push(`${t("Saldo Ende")} ${formatEuro(s.saldoEndeCent, lang)}`);
    const steuer = s.steuertage.length
      ? `; ${t("Steuertage")}: ${s.steuertage.map((st) => `${tagText(st.nenn)} ${artenText(st.arten)} (${deckungText(st.gedeckt, t)})`).join("; ")}`
      : "";
    return `${s.label}: ${teile.join(", ")}${steuer}`;
  };

  return (
    <figure className="m-0">
      <svg viewBox="0 0 360 360" className="w-full max-w-[420px]" role="group" aria-label={`${t("Jahresuhr")} ${jahr}`}>
        <defs>
          <pattern id={schraffurId} width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
            <line x1="0" y1="0" x2="0" y2="6" className="stroke-amber-600 dark:stroke-amber-400" strokeWidth="2" />
          </pattern>
        </defs>

        {modell.segmente.map((s) => {
          const istFokus = fokus === s.monat;
          const istAktuell = monatMarkiert === s.monat;
          return (
            <g key={s.monat} data-symbol="segment" role="button" tabIndex={istFokus ? 0 : -1}
              aria-pressed={istAktuell} aria-current={heuteMonat === s.monat ? "date" : undefined}
              aria-label={monatText(s)} ref={(el) => { refs.current[s.monat] = el; }}
              onKeyDown={taste} onFocus={() => setFokus(s.monat)}
              onClick={() => waehlen(s.monat)}
              className="cursor-pointer outline-none focus-visible:[&>path]:stroke-2 focus-visible:[&>path]:stroke-emerald-500">
              <path d={s.basis} className={istAktuell ? "fill-slate-300 dark:fill-slate-600" : "fill-slate-200 dark:fill-slate-700"} />
              {s.fuellung && <path data-symbol="fuellung" d={s.fuellung.pfad} className="fill-teal-600 dark:fill-teal-500" />}
              {s.luecke && <path data-symbol="defizit" d={s.luecke.pfad} fill={`url(#${schraffurId})`} />}
            </g>
          );
        })}

        {modell.segmente.map((s) => (s.abflussBogen ? (
          <path key={`abfluss-${s.monat}`} data-symbol="abfluss" pointerEvents="none" d={s.abflussBogen.pfad}
            fill="none" className="stroke-slate-600 dark:stroke-slate-300" strokeWidth="2" />
        ) : null))}

        {/* Month labels — decorative, the accessible name lives on the segment's g. */}
        {modell.segmente.map((s) => (
          <text key={`label-${s.monat}`} x={s.labelPunkt.x} y={s.labelPunkt.y} textAnchor="middle" dominantBaseline="middle" aria-hidden="true"
            className="fill-slate-500 dark:fill-slate-400 text-[9px]">
            {s.label.slice(0, 3)}
          </text>
        ))}

        {modell.marken.filter((m) => m.art === "steuer").map((m) => (
          <path key={`steuer-${m.datum}`} data-symbol="steuer" data-datum={m.datum} data-arten={m.arten.join(",")} d={m.pfad}
            aria-hidden="true" className="fill-slate-900 dark:fill-slate-100">
            <title>{`${t("Steuertag")} ${tagText(m.datum)}: ${artenText(m.arten)}`}</title>
          </path>
        ))}
        {modell.marken.filter((m) => m.art === "frist").map((m) => (
          <g key={`frist-${m.datum}`} data-symbol="frist" data-datum={m.datum} aria-hidden="true">
            <path d={m.pfad} className="fill-red-600 dark:fill-red-400" />
            {m.kreis && <circle cx={m.kreis.cx} cy={m.kreis.cy} r={m.kreis.r} fill="none" strokeWidth="1.5" className="stroke-red-600 dark:stroke-red-400" />}
            <title>{`${t("Spätester Rechnungsversand")} ${tagText(m.datum)}`}</title>
          </g>
        ))}
        {modell.marken.filter((m) => m.art === "deckung-ok").map((m) => (
          <path key={`ok-${m.datum}`} data-symbol="deckung-ok" data-datum={m.datum} d={m.pfad} aria-hidden="true"
            fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="stroke-slate-500 dark:stroke-slate-400" />
        ))}
        {modell.marken.filter((m) => m.art === "deckung-warn").map((m) => (
          <path key={`warn-${m.datum}`} data-symbol="deckung-warn" data-datum={m.datum} d={m.pfad} aria-hidden="true"
            className="fill-amber-600 dark:fill-amber-400" />
        ))}

        {modell.zeigerSpitze && (
          <line data-symbol="zeiger" x1="180" y1="180" x2={modell.zeigerSpitze.x} y2={modell.zeigerSpitze.y} aria-hidden="true"
            className="stroke-slate-900 dark:stroke-slate-100" strokeWidth="2" strokeLinecap="round" />
        )}
        <circle cx="180" cy="180" r="3" aria-hidden="true" className="fill-slate-900 dark:fill-slate-100" />
      </svg>
      <figcaption className="mt-1 text-xs text-slate-600 dark:text-slate-300 tabular-nums" data-testid="jahresuhr-skala">
        {t("Skala: voller Ring = {skala}").replace("{skala}", formatEuro(modell.skala, lang))}
      </figcaption>
    </figure>
  );
}
