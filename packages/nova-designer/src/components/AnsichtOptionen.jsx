// <AnsichtOptionen> — the three new view parameters of plan 107-12 in the BIM studio's navigator ("Mappe"): structure display, view
// options and the switch for graphic rules. Phase 55-01: when rules are on, the RegelEditor (lazy) creates/edits/reorders them and
// loads project presets — still ONE form from @core/lib/plan/ansichtszustand.js (D-BK-23 / D-UEB-01). Loaded lazily (React.lazy)
// so the studio chunk does not grow.
//
// In:  current values (structure display, effective options, rules, presets), change callbacks, translator.
// Out: a compact block of select + checkboxes + optional RegelEditor (token classes only).
import React from "react";
import { STRUKTURDARSTELLUNGEN, OPTIONEN_FELDER } from "@core/lib/plan/ansichtszustand.js";

const RegelEditor = React.lazy(() => import("@designer/components/RegelEditor.jsx"));

/** German labels (i18n keys) of the structure display values. */
const STRUKTUR_LABEL = /** @type {Record<string, string>} */ ({
  "gesamt": "Gesamter Aufbau",
  "ohne-bekleidung": "Ohne Bekleidung",
  "nur-kern": "Nur Kern",
  "nur-kern-tragend": "Nur Kern der tragenden Bauteile",
});

/** German labels (i18n keys) of the view options. */
const OPTION_LABEL = /** @type {Record<string, string>} */ ({
  tuerAufschlag: "Türaufschlag",
  fensterSymbol: "Fenstersymbol",
  durchbruchSymbol: "Durchbruchsymbol",
  schraffurMaterial: "Materialschraffur",
  schraffurStatus: "Statusschraffur",
});

/**
 * @param {object} p
 * @param {string} p.strukturdarstellung one of STRUKTURDARSTELLUNGEN
 * @param {(v: string) => void} p.onStruktur
 * @param {Record<string, boolean>} p.optionen effective options (optionenFuer)
 * @param {(k: string, v: boolean) => void} p.onOption
 * @param {boolean} p.regelnAn the graphic rules are switched on
 * @param {(v: boolean) => void} p.onRegeln toggle: on → standard rules (caller), off → null
 * @param {any[]|null} [p.regeln] current rule list when on (55-01 editor)
 * @param {(regeln: any[]|null) => void} [p.onRegelnChange] edit/reorder/preset load
 * @param {Array<{id: string, name: string, regeln: any[]}>} [p.vorlagen] project presets
 * @param {(vorlage: {id: string, name: string, regeln: any[]}) => void} [p.onVorlageSpeichern]
 * @param {(s: string) => string} p.t translator (@core/lib/i18n)
 */
export default function AnsichtOptionen({
  strukturdarstellung, onStruktur, optionen, onOption, regelnAn, onRegeln,
  regeln = null, onRegelnChange, vorlagen = [], onVorlageSpeichern, t,
}) {
  return (
    <div className="px-3 py-1 border-t text-[11px] text-muted-foreground" data-testid="ansicht-optionen">
      <label className="flex items-center justify-between gap-2" title={t("Schichten nach ihrer Funktion ausblenden — die Referenzlinie bleibt, IFC und Mengen bleiben vollständig")}>
        {t("Aufbau")}
        <select value={strukturdarstellung} onChange={(e) => onStruktur(e.target.value)} data-testid="ansicht-struktur" aria-label={t("Aufbau")}
          className="max-w-[110px] rounded border border-border bg-card px-1 py-0.5 text-foreground">
          {STRUKTURDARSTELLUNGEN.map((s) => <option key={s} value={s}>{t(STRUKTUR_LABEL[s])}</option>)}
        </select>
      </label>
      <div className="mt-1 grid grid-cols-1 gap-0.5">
        {OPTIONEN_FELDER.map((k) => (
          <label key={k} className="flex items-center justify-between gap-2">
            {t(OPTION_LABEL[k])}
            <input type="checkbox" checked={!!optionen[k]} data-testid={`ansicht-option-${k}`} aria-label={t(OPTION_LABEL[k])}
              onChange={(e) => onOption(k, e.target.checked)} />
          </label>
        ))}
        <label className="flex items-center justify-between gap-2" title={t("Feuerwiderstand: Kontur strichpunktiert · tragend: Füllung dunkler; in Umbau-Brillen gewinnt der Status")}>
          {t("Grafische Regeln")}
          <input type="checkbox" checked={regelnAn} data-testid="ansicht-regeln" aria-label={t("Grafische Regeln")} onChange={(e) => onRegeln(e.target.checked)} />
        </label>
      </div>
      {regelnAn && onRegelnChange && (
        <React.Suspense fallback={null}>
          <RegelEditor t={t} regeln={regeln} onChange={onRegelnChange} vorlagen={vorlagen} onVorlageSpeichern={onVorlageSpeichern} />
        </React.Suspense>
      )}
    </div>
  );
}
