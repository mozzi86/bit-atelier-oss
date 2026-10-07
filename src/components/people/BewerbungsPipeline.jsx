// BewerbungsPipeline.jsx — die Pipeline der Bewerbungen (Plan 80-08, Task 4):
// je offene Stufe eine Sektion, die drei Endstufen zusammen in einer
// eingeklappten Sektion "Abgeschlossen". Bedienung per Knopf und Auswahl
// (Tastatur, testbar) — kein Drag&Drop (Lehre aus NB-22, im Objective fixiert).
//
// Die Palette indexiert Bewerbende NICHT (kein Personenname landet in einer
// URL, einem Titel oder der Befehlspalette — DS-07 gilt auch hier).
//
// In:  {bewerbungen, stellen, regelWert, heute, onOeffnen(id), onGeaendert}.
// Out: UI, ein update über bitApi.personal.Bewerbung (Stufenwechsel).

import React from "react";
import { Link } from "react-router-dom";
import { useI18n } from "@core/lib/i18n";
import { bitApi } from "@core/api/bitApi";
import { STUFEN, UEBERGAENGE, darfWechseln, naechsteStufe, vorigeStufe, effektiveStufe } from "@/lib/people/bewerbung.js";
import { bauePersonalLink } from "@/lib/people/personalLink.js";
import LoeschfristHinweis from "./LoeschfristHinweis.jsx";
import UebernahmeDialog from "./UebernahmeDialog.jsx";

const OFFENE_STUFEN = STUFEN.filter((s) => !["zusage", "absage", "zurueckgezogen"].includes(s.key));
const ENDSTUFEN = STUFEN.filter((s) => ["zusage", "absage", "zurueckgezogen"].includes(s.key));

/** @param {string|null|undefined} iso @returns {string} */
const fmtDatum = (iso) => (iso ? new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" }) : "—");

/**
 * Patch für einen Stufenwechsel: bei den drei Endstufen zieht die
 * Entscheidung (entscheidung.art/am) nach, damit bewerbungenAktiv/loeschenAb
 * denselben Wechsel sehen wie die Pipeline selbst.
 * @param {object} bewerbung
 * @param {string} zielStufe
 * @param {string} heute
 * @returns {object}
 */
function wechselPatch(bewerbung, zielStufe, heute) {
  const patch = {
    stufe: zielStufe,
    stufen_verlauf: [...(Array.isArray(bewerbung.stufen_verlauf) ? bewerbung.stufen_verlauf : []), { stufe: zielStufe, am: heute }],
  };
  if (["zusage", "absage", "zurueckgezogen"].includes(zielStufe)) {
    patch.entscheidung = { ...(bewerbung.entscheidung || {}), art: zielStufe, am: bewerbung.entscheidung?.am || heute };
  }
  return patch;
}

/**
 * @param {{bewerbungen: object[], stellen: object[], regelWert: (id: string) => any, heute: string,
 *   onOeffnen: (b: object) => void, onGeaendert: () => void}} props
 * @returns {React.ReactElement}
 */
export default function BewerbungsPipeline({ bewerbungen, stellen, regelWert, heute, onOeffnen, onGeaendert }) {
  const { t } = useI18n();
  const [abgeschlossenOffen, setAbgeschlossenOffen] = React.useState(false);
  const [wechselndId, setWechselndId] = React.useState(/** @type {string|null} */ (null));
  const [fokusZielId, setFokusZielId] = React.useState(/** @type {string|null} */ (null));
  // Plan 80-09: Vorschau + Bestätigung "Zusage → Einstellung".
  const [uebernahmeFuer, setUebernahmeFuer] = React.useState(/** @type {object|null} */ (null));
  const containerRef = React.useRef(/** @type {HTMLDivElement|null} */ (null));

  React.useEffect(() => {
    if (!fokusZielId) return;
    const el = containerRef.current?.querySelector(`[data-bewerbung="${fokusZielId}"]`);
    if (el) { /** @type {HTMLElement} */ (el).focus(); setFokusZielId(null); }
  }, [bewerbungen, fokusZielId]);

  const stelleTitel = (id) => stellen.find((s) => s.id === id)?.titel || "";

  const wechseln = async (bewerbung, zielStufe) => {
    setWechselndId(bewerbung.id);
    try {
      await /** @type {any} */ (bitApi.personal).Bewerbung.update(bewerbung.id, wechselPatch(bewerbung, zielStufe, heute));
      if (["zusage", "absage", "zurueckgezogen"].includes(zielStufe)) setAbgeschlossenOffen(true);
      // Erst NACH dem Neuladen den Fokus-Wunsch setzen — sonst greift der
      // Fokus-Effekt auf die noch alte Sektion zu (die Karte wandert in eine
      // andere <section>, React hängt dabei einen neuen DOM-Knoten ein, der
      // alte verliert seinen Fokus unwiederbringlich).
      await onGeaendert();
      setFokusZielId(bewerbung.id);
    } finally {
      setWechselndId(null);
    }
  };

  /** @param {object} bewerbung @returns {React.ReactElement} */
  const karte = (bewerbung) => {
    const stufe = effektiveStufe(bewerbung);
    const naechste = naechsteStufe(stufe);
    const vorige = vorigeStufe(stufe);
    const ziele = (UEBERGAENGE[stufe] || []).filter((z) => z !== naechste && z !== vorige);
    return (
      <li key={bewerbung.id} data-bewerbung={bewerbung.id} tabIndex={-1}
        className="rounded-lg border border-slate-200 p-2.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-slate-700">
        <button type="button" onClick={() => onOeffnen(bewerbung)} className="text-left font-medium text-emerald-700 underline-offset-4 hover:underline dark:text-emerald-400">
          {[bewerbung.vorname, bewerbung.nachname].filter(Boolean).join(" ")}
        </button>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {stelleTitel(bewerbung.stelle_id) || t("Initiativ")} · {fmtDatum(bewerbung.eingang_am)}
        </p>
        <div className="mt-1.5"><LoeschfristHinweis bewerbung={bewerbung} regelWert={regelWert} heute={heute} /></div>
        {/* Plan 80-09: eine Zusage ohne Übernahme bietet "Einstellung anlegen"
            an; eine bereits übernommene Karte verlinkt auf die neue Person
            (Behavior 9). */}
        {stufe === "zusage" && (
          bewerbung.uebernommen_mitarbeiter_id ? (
            <p className="mt-1.5 text-xs text-emerald-700 dark:text-emerald-400">
              {t("übernommen")} — <Link to={`/People${bauePersonalLink({ tab: "staff", mitarbeiter: bewerbung.uebernommen_mitarbeiter_id })}`} className="underline-offset-4 hover:underline">{t("Person ansehen")}</Link>
            </p>
          ) : (
            <button type="button" onClick={() => setUebernahmeFuer(bewerbung)}
              className="mt-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs text-emerald-800 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-100">
              {t("Einstellung anlegen")}
            </button>
          )
        )}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {naechste && darfWechseln(stufe, naechste) && (
            <button type="button" disabled={wechselndId === bewerbung.id} onClick={() => wechseln(bewerbung, naechste)}
              className="rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs text-emerald-800 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-100">
              {t("Nächste Stufe")}
            </button>
          )}
          {vorige && darfWechseln(stufe, vorige) && (
            <button type="button" disabled={wechselndId === bewerbung.id} onClick={() => wechseln(bewerbung, vorige)}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800">
              {t("Zurück")}
            </button>
          )}
          {ziele.length > 0 && (
            <>
              <label htmlFor={`bp-stufe-${bewerbung.id}`} className="sr-only">{t("Stufe wechseln")}</label>
              <select id={`bp-stufe-${bewerbung.id}`} disabled={wechselndId === bewerbung.id} value=""
                onChange={(e) => { if (e.target.value) wechseln(bewerbung, e.target.value); }}
                className="h-7 rounded-md border border-slate-300 px-1.5 text-xs dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100">
                <option value="">{t("Stufe wechseln…")}</option>
                {ziele.map((z) => <option key={z} value={z}>{t(STUFEN.find((s) => s.key === z)?.label || z)}</option>)}
              </select>
            </>
          )}
        </div>
      </li>
    );
  };

  return (
    <div ref={containerRef} data-testid="bewerbungs-pipeline">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {OFFENE_STUFEN.map((s) => {
          const eintraege = bewerbungen.filter((b) => effektiveStufe(b) === s.key);
          return (
            <section key={s.key} aria-labelledby={`bp-h-${s.key}`}>
              <h3 id={`bp-h-${s.key}`} className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {t(s.label)} ({eintraege.length})
              </h3>
              <ul className="space-y-2">{eintraege.map(karte)}</ul>
            </section>
          );
        })}
      </div>

      {(() => {
        const abgeschlossen = bewerbungen.filter((b) => ENDSTUFEN.some((s) => s.key === effektiveStufe(b)));
        return (
          <section aria-labelledby="bp-h-abgeschlossen" className="mt-4 border-t border-slate-200 pt-3 dark:border-slate-700">
            <button type="button" onClick={() => setAbgeschlossenOffen((v) => !v)} aria-expanded={abgeschlossenOffen}
              id="bp-h-abgeschlossen" className="text-sm font-semibold text-slate-700 hover:underline dark:text-slate-200">
              {t("Abgeschlossen")} ({abgeschlossen.length})
            </button>
            {abgeschlossenOffen && <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">{abgeschlossen.map(karte)}</ul>}
          </section>
        );
      })()}

      {bewerbungen.length === 0 && (
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">{t("Noch keine Bewerbungen erfasst.")}</p>
      )}

      {uebernahmeFuer && (
        <UebernahmeDialog
          bewerbung={uebernahmeFuer}
          stelle={stellen.find((s) => s.id === uebernahmeFuer.stelle_id) || null}
          regelWert={regelWert}
          onClose={() => setUebernahmeFuer(null)}
          onUebernommen={onGeaendert}
        />
      )}
    </div>
  );
}
