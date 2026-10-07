// Settings area "Regelwerke" (key `rules`, E-16, 80-07): the ONE generic editor
// for every visible rule book — accounting rates (79: 60 rules from alsRegeln(),
// 16 of them office values) and HR rules (80: HR_REGELN); phase 81 docks
// "zeit_honorar" in through one more line of REGELWERKE, no change here
// (src/lib/settings/regelwerke.js file header).
//
// RegelwerkTabelle.jsx (@core) renders the data; this file only builds it:
// - loads every Setting row once (own small hook — @core/lib/useRegelWerte.js is
//   not in this plan's files_modified and exposes no raw rows, only the reader;
//   this hook mirrors its load/listen pattern, see 80-07-SUMMARY deviation),
// - turns the rows into the flat override map tabellenZeilen() needs
//   (overridesAus per group, merged — rule ids are globally unique) and the
//   `wertVon` reader (regelWerteAus) formula rules read other rules through,
// - binds the three write callbacks of each group to useRegelwerkBearbeiten.js.
//
// Boundary (MOD-04): only an APP file may import 79's wirksameEinstellungen, so
// it is injected here as `pruefeSetting` for the "buchhaltung" group only — the
// nova-core package itself never imports @/lib/accounting/*.
//
// In:  props {kontext: import("@/lib/settings/bereiche.js").EinstellungsKontext,
//      fokusId?: string|null} (Settings.jsx, the ?einstellung= jump target).
// Out: BEREIT = true, the area.

import React from "react";
import { Scale } from "lucide-react";
import { useI18n } from "@core/lib/i18n";
import { bitApi } from "@core/api/bitApi";
import { EINSTELLUNG_EREIGNIS } from "@core/lib/einstellungen.js";
import { heuteLokal, overridesAus, regelWerteAus, tabellenZeilen } from "@core/lib/regelwerk.js";
import { gruppeZuruecksetzen, setzeRegel, zuruecksetzen } from "@core/lib/useRegelwerkBearbeiten.js";
import RegelwerkTabelle from "@core/components/regelwerk/RegelwerkTabelle.jsx";
import { REGELWERKE, regelNachId, sichtbareRegelwerke } from "@/lib/settings/regelwerke.js";
import { veralteteWerte, wirksameEinstellungen } from "@/lib/accounting/einstellungen.js";

/** Ready since 80-07. */
export const BEREIT = true;

/** Only the "buchhaltung" group stores as `setting` (79's Setting{key:"buchhaltung"}); its
 * writes need 79's own whitelist, injected here (see file header, MOD-04). */
const BUCHHALTUNG_GRUPPE = "buchhaltung";

/** dd.mm.yyyy from 'YYYY-MM-DD', literally EinstellungenDialog.jsx's own helper (not shared —
 * that file is app-local too, but importing across two unrelated components for four lines
 * would cost more than it saves). @param {string} tagIso */
const datumText = (tagIso) => (typeof tagIso === "string" && tagIso.length >= 10 ? `${tagIso.slice(8, 10)}.${tagIso.slice(5, 7)}.${tagIso.slice(0, 4)}` : "");

/**
 * Every Setting row, reloaded on EINSTELLUNG_EREIGNIS — the raw material
 * overridesAus()/regelWerteAus() need (tabellenZeilen() itself takes the
 * already-computed override map, not rows). No-op event guard outside a
 * browser, same as useEinstellung.js's melde().
 * @returns {any[]} empty while loading or on a load error (the editor then shows
 *   standard values only, exactly like useRegelWerte.js's own fallback)
 */
function useAlleSettingZeilen() {
  const [zeilen, setZeilen] = React.useState(/** @type {any[]} */ ([]));
  const aktiv = React.useRef(true);

  const laden = React.useCallback(async () => {
    try {
      const rows = await /** @type {any} */ (bitApi.entities).Setting.list();
      if (aktiv.current) setZeilen(Array.isArray(rows) ? [...rows] : []);
    } catch {
      if (aktiv.current) setZeilen((z) => z);
    }
  }, []);

  React.useEffect(() => {
    aktiv.current = true;
    laden();
    const beiAenderung = () => laden();
    window.addEventListener(EINSTELLUNG_EREIGNIS, beiAenderung);
    return () => {
      aktiv.current = false;
      window.removeEventListener(EINSTELLUNG_EREIGNIS, beiAenderung);
    };
  }, [laden]);

  return zeilen;
}

/** The "Erinnerungen" section (vorlauf_* rules) gets one extra note line (behavior 12, E-16). */
const ABSCHNITT_HINWEISE = Object.freeze({ Erinnerungen: "Erinnerungen erscheinen nur in der App, ohne Mail und ohne Push." });

/**
 * @param {{kontext?: import("@/lib/settings/bereiche.js").EinstellungsKontext, fokusId?: string|null}} props
 * @returns {React.ReactElement}
 */
export default function RegelwerkBereich({ kontext, fokusId }) {
  const { t } = useI18n();
  const zeilen = useAlleSettingZeilen();
  const heute = heuteLokal();

  const sichtbar = React.useMemo(() => sichtbareRegelwerke(kontext), [kontext]);

  // Flat override map across EVERY group (rule ids are globally unique,
  // "personal.x"/"buchhaltung.y" — tabellenZeilen()'s own contract).
  const overridesFlat = React.useMemo(() => {
    /** @type {Record<string, any>} */
    const aus = {};
    for (const gruppe of REGELWERKE) for (const [id, override] of overridesAus(gruppe, zeilen)) aus[id] = override;
    return aus;
  }, [zeilen]);

  // Reader over EVERY group (not just the visible ones): a formula rule of a
  // visible group may read a rule of another (none does today, but the reader
  // itself must not depend on which groups the current context happens to show).
  const leser = React.useMemo(() => regelWerteAus(REGELWERKE, zeilen), [zeilen]);

  const tabellen = React.useMemo(
    () => tabellenZeilen(REGELWERKE, overridesFlat, kontext, heute, leser.wert),
    [overridesFlat, kontext, heute, leser],
  );

  const veraltetVorhanden = tabellen.some((g) => g.abschnitte.some((a) => a.zeilen.some((z) => z.status === "veraltet")));
  const veralteteBuchhaltung = React.useMemo(() => veralteteWerte(heute), [heute]);

  return (
    <div className="space-y-6" data-testid="bereich-rules">
      <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
        {t("Richtwerte, keine Rechts- oder Steuerberatung. Mit [ASSUMED] gekennzeichnete Werte vor der Nutzung prüfen lassen.")}
      </p>
      {veraltetVorhanden && (
        <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          {t("Gesetzlicher Wert hat sich geändert – Abweichung prüfen")}
        </p>
      )}

      {sichtbar.map((gruppeEintrag) => {
        const gruppe = REGELWERKE.find((g) => g.gruppe === gruppeEintrag.gruppe);
        const tabelle = tabellen.find((g) => g.gruppe === gruppeEintrag.gruppe);
        if (!gruppe || !tabelle) return null;
        const pruefeSetting = gruppe.gruppe === BUCHHALTUNG_GRUPPE ? wirksameEinstellungen : undefined;
        const gruppenFokus = fokusId && fokusId.startsWith(`${gruppe.gruppe}.`) ? fokusId : null;
        return (
          <section key={gruppe.gruppe} aria-labelledby={`regelwerk-titel-${gruppe.gruppe}`} data-testid={`regelwerk-gruppe-${gruppe.gruppe}`} className="space-y-3">
            <h2 id={`regelwerk-titel-${gruppe.gruppe}`} className="flex items-center gap-2 text-base font-semibold text-slate-800 dark:text-slate-100">
              <Scale className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" /> {t(gruppe.titel)}
            </h2>
            {gruppe.gruppe === BUCHHALTUNG_GRUPPE && veralteteBuchhaltung.map((v) => {
              const regel = regelNachId(v.regel);
              return (
                <p key={v.pfad} role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
                  {t("„{wert}“ ist seit {datum} möglicherweise veraltet — bitte den neuen Wert nachtragen lassen.")
                    .replace("{wert}", regel ? t(regel.label) : v.pfad).replace("{datum}", datumText(v.am))}
                </p>
              );
            })}
            <RegelwerkTabelle
              gruppe={gruppe.gruppe}
              zeilen={tabelle.abschnitte}
              speicherArt={tabelle.speicherArt}
              fokusId={gruppenFokus}
              abschnittHinweise={ABSCHNITT_HINWEISE}
              onSetzen={(id, eingabe) => setzeRegel(gruppe, id, eingabe, { pruefeSetting })}
              onZuruecksetzen={(id) => zuruecksetzen(gruppe, id, { pruefeSetting })}
              onGruppeZuruecksetzen={() => gruppeZuruecksetzen(gruppe, { pruefeSetting })}
            />
          </section>
        );
      })}
    </div>
  );
}
