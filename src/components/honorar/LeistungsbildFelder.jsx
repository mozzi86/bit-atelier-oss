// The fee input fields shared by the offer wizard, the offer editor and the fee
// calculator (phase 81-03, HON-01/07, E-13): service profile (all 14 of 79's
// registry), the cost basis (§ 33 KG 300/400/other for buildings and interiors,
// otherwise the reference value of the table in € or ha), fee zone, stages,
// position between base and top rate, conversion surcharge and flat fee.
//
// Changing the profile rebuilds the stages from 79's lphFuerLeistungsbild (H-2
// lesson: never keep the old profile's percentages positionally) and resets the
// zone to the first valid one when the old zone does not exist (with a hint).
// Without an official table ("Tafel fehlt", E-13) the cost fields stay and are
// saved — the offer computes once the table exists — and only a flat fee gives
// an amount.
//
// In:  props wert (flat 79 fields), onChange(patch), idPraefix, optional projekt
//      (enables "aus LV übernehmen"), optional teile (which groups to show — the
//      wizard shows them step by step). Out: the fields; reads LV positions of the
//      project on request. Since 96-03 "aus LV übernehmen" freezes the costs
//      (kosten_eingefroren_am + cents snapshot) and a yellow notice reports a
//      later LV drift over 1 % (KostenDriftHinweis) — no live link.

import React from "react";
import { toast } from "sonner";
import { bitApi } from "@core/api/bitApi";
import { useI18n } from "@core/lib/i18n";
import { buttonVariants } from "@core/components/ui/button";
import { alleLeistungsbilder, leistungsbildInfo, tafelStatus } from "@core/lib/hoai/leistungsbilder.js";
import { kostenAusLv, lphFuerLeistungsbild } from "@core/lib/hoai/honorar.js";
import { KOSTEN_SNAPSHOT_LEER, kostenEinfrieren } from "@core/lib/hoai/kostenDrift.js";
import { datumText, heuteLokal } from "@core/lib/kalender/datum.js";
import BetragFeld from "@/components/accounting/gemeinsam/BetragFeld.jsx";
import KostenDriftHinweis from "./KostenDriftHinweis.jsx";
import LphTabelle from "./LphTabelle.jsx";
import MvbAusBestand from "./MvbAusBestand.jsx";

const FELD = "h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900";
const LABEL = "text-sm font-medium text-slate-700 dark:text-slate-200";

/** @param {number|null|undefined} euro @returns {number|null} cents */
const zuCent = (euro) => (typeof euro === "number" && Number.isFinite(euro) ? Math.round(euro * 100) : null);
/** @param {number|null} c @returns {number|null} Euro */
const zuEuro = (c) => (typeof c === "number" ? c / 100 : null);

/**
 * Profile change with the H-2 rule: new stages, valid zone.
 * @param {Record<string, any>} wert
 * @param {string} neu registry key
 * @returns {{patch: Record<string, any>, zoneZurueck: string|null}}
 */
export function leistungsbildWechsel(wert, neu) {
  const info = leistungsbildInfo(neu);
  const zonen = info?.zonen?.length ? info.zonen : ["I", "II", "III", "IV", "V"];
  const zoneOk = zonen.includes(wert.honorarzone);
  /** @type {Record<string, any>} */
  const patch = { leistungsbild: neu, lph: lphFuerLeistungsbild(neu) };
  if (!zoneOk) patch.honorarzone = zonen[0];
  if (info?.kostenregel === "p33") { patch.bezugswert = null; patch.kg300_euro = wert.kg300_euro ?? wert.bezugswert ?? null; }
  else { patch.bezugswert = wert.bezugswert ?? wert.kg300_euro ?? null; }
  if (typeof info?.umbau_max_prozent !== "number") patch.umbauzuschlag_prozent = 0;
  return { patch, zoneZurueck: zoneOk ? null : zonen[0] };
}

/** All field groups, in display order. */
export const ALLE_TEILE = Object.freeze(["leistungsbild", "kosten", "zone", "position", "lph", "umbau", "pauschal"]);

/**
 * @param {{
 *   wert: Record<string, any>, onChange: (patch: Record<string, any>) => void, idPraefix: string,
 *   projekt?: Record<string, any>|null, teile?: ReadonlyArray<string>,
 * }} props teile: subset of ALLE_TEILE (default all)
 * @returns {React.ReactElement}
 */
export default function LeistungsbildFelder({ wert, onChange, idPraefix, projekt = null, teile = ALLE_TEILE }) {
  const zeige = (/** @type {string} */ teil) => teile.includes(teil);
  const { t, lang } = useI18n();
  const alle = React.useMemo(() => alleLeistungsbilder(), []);
  const info = leistungsbildInfo(wert.leistungsbild);
  const fehlt = tafelStatus(wert.leistungsbild) !== "amtlich";
  const p33 = info?.kostenregel === "p33";
  const zonen = info?.zonen?.length ? info.zonen : ["I", "II", "III", "IV", "V"];

  const waehle = (/** @type {string} */ neu) => {
    const { patch, zoneZurueck } = leistungsbildWechsel(wert, neu);
    onChange(patch);
    if (zoneZurueck) toast(t("Honorarzone auf {zone} zurückgesetzt, weil sie für dieses Leistungsbild nicht gilt.").replace("{zone}", zoneZurueck));
  };

  const ausLv = async () => {
    if (!projekt) return;
    try {
      const positionen = await /** @type {any} */ (bitApi).entities.LVPosition.filter({ project_id: projekt.id });
      const { kg300_euro, kg400_euro } = kostenAusLv(Array.isArray(positionen) ? positionen : []);
      if (Array.isArray(positionen) && positionen.length) {
        // 96-03: taking over = freezing (snapshot in cents + day); the LV drift is reported, never copied live.
        onChange(kostenEinfrieren({ kg300_euro, kg400_euro, sonstige_euro: 0 }, heuteLokal()));
      } else {
        onChange({ kg300_euro, kg400_euro, sonstige_euro: 0, anrechenbare_quelle: "manuell", ...KOSTEN_SNAPSHOT_LEER });
        toast(t("Dieses Projekt hat noch keine LV-Positionen — 0 € übernommen."));
      }
    } catch (fehler) {
      toast.error(/** @type {any} */ (fehler)?.message || String(fehler));
    }
  };

  return (
    <div className="space-y-4">
      {zeige("leistungsbild") && <div className="space-y-1">
        <label htmlFor={`${idPraefix}-leistungsbild`} className={LABEL}>{t("Leistungsbild")}</label>
        <select id={`${idPraefix}-leistungsbild`} className={FELD} value={wert.leistungsbild || "gebaeude"} onChange={(e) => waehle(e.target.value)} data-testid="leistungsbild-wahl">
          {alle.map((lb) => (
            <option key={lb.key} value={lb.key}>
              {`${t(lb.label)} · § ${lb.tafelParagraf}${lb.status !== "amtlich" ? ` · ${t("Tafel fehlt")}` : ""}`}
            </option>
          ))}
        </select>
      </div>}
      {(
        <>
          {fehlt && zeige("kosten") && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100" data-testid="tafel-fehlt">
              {t("Tafel fehlt — HOAI § {nr} noch nicht amtlich übertragen").replace("{nr}", String(info?.tafelParagraf ?? ""))}. {t("Einen Betrag liefert nur eine Pauschale.")}
            </p>
          )}
          {!zeige("kosten") ? null : p33 ? (
            <div className="space-y-2">
              <div className="grid gap-3 sm:grid-cols-3">
                {/* 96-03: a value typed in by hand no longer describes an LV stand — the snapshot goes. */}
                <BetragFeld id={`${idPraefix}-kg300`} label={t("KG 300 (€)")} wert={zuCent(wert.kg300_euro)} onChange={(c) => onChange({ kg300_euro: zuEuro(c), anrechenbare_quelle: "manuell", ...KOSTEN_SNAPSHOT_LEER })} />
                <BetragFeld id={`${idPraefix}-kg400`} label={t("KG 400 (€)")} wert={zuCent(wert.kg400_euro)} onChange={(c) => onChange({ kg400_euro: zuEuro(c), anrechenbare_quelle: "manuell", ...KOSTEN_SNAPSHOT_LEER })} />
                <BetragFeld id={`${idPraefix}-sonstige`} label={t("Sonstige anrechenbare Kosten (€)")} wert={zuCent(wert.sonstige_euro)} onChange={(c) => onChange({ sonstige_euro: zuEuro(c) })} />
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                <span>{t("Anrechenbare Kosten nach § 33 HOAI: KG 400 voll bis 25 % der übrigen, darüber zur Hälfte.")}</span>
                {wert.anrechenbare_quelle === "lv" && <span className="rounded bg-emerald-100 px-1.5 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100">{t("aus dem LV")}</span>}
                {wert.kosten_eingefroren_am && <span data-testid="kosten-eingefroren-am">{t("eingefroren am {datum}").replace("{datum}", datumText(wert.kosten_eingefroren_am, lang === "en" ? "en" : "de"))}</span>}
                {projekt && <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={ausLv}>{t("aus LV übernehmen")}</button>}
              </div>
              {projekt && <KostenDriftHinweis vertrag={wert} projektId={projekt.id} hinweis={t("Mit „aus LV übernehmen“ den neuen Stand einfrieren.")} />}
            </div>
          ) : (
            <BetragFeld id={`${idPraefix}-bezugswert`} label={info?.einheit === "ha" ? t("Fläche (ha)") : t("Anrechenbare Kosten (€)")}
              wert={zuCent(wert.bezugswert)} onChange={(c) => onChange({ bezugswert: zuEuro(c) })} />
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {zeige("zone") && <div className="space-y-1">
              <label htmlFor={`${idPraefix}-zone`} className={LABEL}>{t("Honorarzone")}</label>
              <select id={`${idPraefix}-zone`} className={FELD} value={wert.honorarzone || zonen[0]} onChange={(e) => onChange({ honorarzone: e.target.value })}>
                {zonen.map((z) => <option key={z} value={z}>{z}</option>)}
              </select>
            </div>}
            {zeige("position") && (
              <div className="space-y-1">
                <label htmlFor={`${idPraefix}-position`} className={LABEL}>{t("Satz zwischen Basis- und oberem Honorarsatz (%)")}</label>
                <input id={`${idPraefix}-position`} type="number" min="0" max="100" step="5" className={FELD} value={wert.satz_position_prozent ?? 0}
                  onChange={(e) => onChange({ satz_position_prozent: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })} />
              </div>
            )}
          </div>
          {zeige("lph") && <LphTabelle wert={wert} onChange={onChange} idPraefix={idPraefix} />}
          {zeige("umbau") && typeof info?.umbau_max_prozent === "number" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label htmlFor={`${idPraefix}-umbau`} className={LABEL}>{t("Umbauzuschlag (%)")}</label>
                <input id={`${idPraefix}-umbau`} type="number" min="0" max={info.umbau_max_prozent} step="1" className={FELD} value={wert.umbauzuschlag_prozent ?? 0}
                  onChange={(e) => onChange({ umbauzuschlag_prozent: Math.max(0, Number(e.target.value) || 0) })} />
                <p className="text-xs text-slate-500 dark:text-slate-400">{t("Höchstens {n} % (§ 6 Abs. 2 HOAI); ohne Vereinbarung in Textform ab Honorarzone III 20 %.").replace("{n}", String(info.umbau_max_prozent))}</p>
              </div>
              <div className="space-y-1">
                <label htmlFor={`${idPraefix}-textform`} className={LABEL}>{t("in Textform vereinbart am")}</label>
                <input id={`${idPraefix}-textform`} type="date" className={FELD} value={wert.textform_am || ""} onChange={(e) => onChange({ textform_am: e.target.value || null })} />
              </div>
              {/* 73-12: mitzuverarbeitende Bausubstanz (§ 4 Abs. 3, § 2 Abs. 7 HOAI) — counts towards the
                  chargeable costs in the shared engine (mvbAnrechenbar); fed from the model pot. */}
              <div className="space-y-1 sm:col-span-2">
                <BetragFeld id={`${idPraefix}-mvb`} label={t("Mitzuverarbeitende Bausubstanz (€)")} wert={zuCent(wert.mvb_euro)}
                  onChange={(c) => onChange({ mvb_euro: zuEuro(c), mvb_grundlage: c == null ? null : (wert.mvb_grundlage?.quelle === "bestandstopf" && zuCent(wert.mvb_euro) === c ? wert.mvb_grundlage : { quelle: "manuell" }) })} />
                <p className="text-xs text-slate-500 dark:text-slate-400">{t("Zählt zu den anrechenbaren Kosten (§ 4 Abs. 3 HOAI); Umfang und Wert in Textform vereinbaren.")}</p>
                {projekt && <MvbAusBestand projekt={projekt} onChange={onChange} idPraefix={idPraefix} />}
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 sm:col-span-2 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200" data-testid="hoai-bestand-hinweis" role="note">
                <p>{t("Bestandsaufnahme und Substanzerkundung sind Besondere Leistungen (Anlage 10 HOAI) und nicht im Grundhonorar enthalten — gesondert anbieten.")}</p>
                <p className="mt-1">{t("Stand HOAI 2021, Werte und Paragrafen ohne Gewähr: vor Vertragsabschluss gegenlesen — ein falscher Wert im Honorar ist ein Vertragsrisiko.")}</p>
              </div>
            </div>
          )}
          {(zeige("pauschal") || (fehlt && zeige("kosten"))) && (
            <BetragFeld id={`${idPraefix}-pauschal`} label={t("Pauschale (€)")} wert={zuCent(wert.pauschal_euro)} onChange={(c) => onChange({ pauschal_euro: zuEuro(c) })} />
          )}
        </>
      )}
    </div>
  );
}
