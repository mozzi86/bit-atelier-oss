// Shared pieces of the time tracking UI (phase 81-02): form class strings, hour
// formatting, the label of a booking target and the fields that choose a target
// (project + work stage + kind of work, or office time + category). The week
// grid, the day view, the booking dialog and the timer all choose the same way.
//
// In:  props per component. Out: React elements and small pure helpers; no data
//      access (the caller passes projects, contracts and fee amendments).

import React from "react";
import { Link } from "react-router-dom";
import { useI18n } from "@core/lib/i18n";
import { normalisiereHoaiPhase } from "@core/lib/labels.js";
import { buchbareLphFuerProjekt, KATEGORIE_INTERN_LABELS, LEISTUNG_LABELS } from "@/lib/zeit/zeitbuchung.js";
import { buchbareZeilen } from "@/lib/zeit/zeitAnsicht.js";

/** Class string of an input/select (same look as the accounting forms). */
export const FELD = "h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900";
/** Class string of a label. */
export const LABEL = "text-sm font-medium text-slate-700 dark:text-slate-200";
/** Class string of an inline error. */
export const FEHLER = "text-sm text-red-700 dark:text-red-300";
/** Class string of a card. */
export const KARTE = "rounded-xl border border-slate-200 bg-white p-4 space-y-3 dark:border-slate-700 dark:bg-slate-900";

/**
 * Minutes as hours with a decimal comma ("1,5"; English "1.5"); 0 → "".
 * @param {number} minuten
 * @param {string} [lang] 'de' | 'en'
 * @returns {string}
 */
export function stundenText(minuten, lang = "de") {
  if (!minuten) return "";
  const h = Math.round((minuten / 60) * 100) / 100;
  return lang === "en" ? String(h) : String(h).replace(".", ",");
}

/**
 * What a booking is booked on, as one line: "Projekt · LPH 5 · Grundleistung"
 * or "Bürozeit · Verwaltung".
 * @param {{project_id?: string|null, lph?: number|null, leistung?: string|null, kategorie_intern?: string|null}} ziel
 * @param {Map<string, string>} projektNamen id → name
 * @param {(s: string) => string} t
 * @returns {string}
 */
export function zielText(ziel, projektNamen, t) {
  if (!ziel.project_id) return `${t("Bürozeit")} · ${t(/** @type {any} */ (KATEGORIE_INTERN_LABELS)[ziel.kategorie_intern || "sonstiges"] || "Sonstiges")}`;
  const teile = [projektNamen.get(ziel.project_id) || ziel.project_id];
  if (ziel.lph) teile.push(`${t("LPH")} ${ziel.lph}`);
  teile.push(t(/** @type {any} */ (LEISTUNG_LABELS)[ziel.leistung || "grund"] || "Grundleistung"));
  return teile.join(" · ");
}

/**
 * The target a booking is booked on.
 * @typedef {{project_id: string|null, lph: number|null, leistung: string|null, kategorie_intern: string|null, honorarnachtrag_id: string|null}} Ziel
 */

/** @type {Ziel} */
export const LEERES_ZIEL = Object.freeze({ project_id: null, lph: null, leistung: null, kategorie_intern: "verwaltung", honorarnachtrag_id: null });

/**
 * A sensible first target for a project: the stage of the project's HOAI phase
 * when it is bookable, else the first bookable stage; kind "Grundleistung".
 * @param {Record<string, any>|null|undefined} projekt
 * @param {ReadonlyArray<Record<string, any>>} vertraege Honorarvertrag records
 * @returns {Ziel}
 */
export function zielFuerProjekt(projekt, vertraege) {
  if (!projekt) return { ...LEERES_ZIEL };
  const lphListe = buchbareLphFuerProjekt(vertraege, projekt.id);
  const phase = normalisiereHoaiPhase(projekt.hoai_phase);
  const lph = phase && lphListe.includes(phase) ? phase : lphListe[0] ?? null;
  return { project_id: projekt.id, lph, leistung: lph ? "grund" : "akquise", kategorie_intern: null, honorarnachtrag_id: null };
}

/**
 * Fields that choose a booking target. Projects are ordered by
 * buchbareZeilen (assigned, recent, others); a project the person is not
 * assigned to is allowed with a hint and a link to the staff tab (80, E-01).
 * Stages are limited to the commissioned stages of the project's contracts
 * (E-13); "Akquise" is always possible.
 * @param {{
 *   wert: Ziel, onChange: (z: Ziel) => void, idPraefix: string,
 *   projekte: ReadonlyArray<Record<string, any>>, vertraege: ReadonlyArray<Record<string, any>>,
 *   nachtraege: ReadonlyArray<Record<string, any>>, mitarbeiter: ReadonlyArray<Record<string, any>>,
 *   buchungen: ReadonlyArray<Record<string, any>>, mitarbeiterId: string, heute: string,
 * }} props
 * @returns {React.ReactElement}
 */
export function ZielFelder({ wert, onChange, idPraefix, projekte, vertraege, nachtraege, mitarbeiter, buchungen, mitarbeiterId, heute }) {
  const { t } = useI18n();
  const zeilen = React.useMemo(
    () => buchbareZeilen(projekte, mitarbeiter, buchungen, { mitarbeiterId, stichtagIso: heute }),
    [projekte, mitarbeiter, buchungen, mitarbeiterId, heute],
  );
  const istBuero = !wert.project_id;
  const gewaehlt = zeilen.find((z) => z.projekt.id === wert.project_id) || null;
  const lphListe = wert.project_id ? buchbareLphFuerProjekt(vertraege, wert.project_id) : [];
  const projektNachtraege = (nachtraege || []).filter((n) => n.project_id === wert.project_id && (n.status === "beauftragt" || n.status === "angeboten"));
  const gruppen = [
    { titel: t("Zugeordnet"), liste: zeilen.filter((z) => z.zugeordnet) },
    { titel: t("Zuletzt gebucht"), liste: zeilen.filter((z) => !z.zugeordnet && z.zuletzt) },
    { titel: t("Weitere Projekte"), liste: zeilen.filter((z) => !z.zugeordnet && !z.zuletzt) },
  ].filter((g) => g.liste.length);

  const projektWaehlen = (/** @type {string} */ id) => {
    if (!id) { onChange({ ...LEERES_ZIEL }); return; }
    onChange(zielFuerProjekt(projekte.find((p) => p.id === id), vertraege));
  };
  const stufeWaehlen = (/** @type {string} */ v) => {
    if (v === "akquise") onChange({ ...wert, lph: null, leistung: "akquise", honorarnachtrag_id: null });
    else onChange({ ...wert, lph: Number(v), leistung: wert.leistung && wert.leistung !== "akquise" ? wert.leistung : "grund" });
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <label htmlFor={`${idPraefix}-projekt`} className={LABEL}>{t("Projekt")}</label>
        <select id={`${idPraefix}-projekt`} className={FELD} value={wert.project_id || ""} onChange={(e) => projektWaehlen(e.target.value)}>
          <option value="">{t("Bürozeit (ohne Projekt)")}</option>
          {gruppen.map((g) => (
            <optgroup key={g.titel} label={g.titel}>
              {g.liste.map((z) => <option key={z.projekt.id} value={z.projekt.id}>{z.projekt.name || z.projekt.id}</option>)}
            </optgroup>
          ))}
        </select>
        {gewaehlt?.nichtZugeordnet && (
          <p className="text-xs text-amber-800 dark:text-amber-200" data-testid="zeit-nicht-zugeordnet">
            {t("Diese Person ist dem Projekt nicht zugeordnet.")}{" "}
            <Link to="/People?tab=staff" className="underline">{t("Mitarbeitende pflegen")}</Link>
          </p>
        )}
      </div>
      {istBuero ? (
        <div className="space-y-1">
          <label htmlFor={`${idPraefix}-kategorie`} className={LABEL}>{t("Kategorie")}</label>
          <select id={`${idPraefix}-kategorie`} className={FELD} value={wert.kategorie_intern || "verwaltung"}
            onChange={(e) => onChange({ ...wert, kategorie_intern: e.target.value })}>
            {Object.entries(KATEGORIE_INTERN_LABELS).map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}
          </select>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor={`${idPraefix}-lph`} className={LABEL}>{t("Leistungsphase")}</label>
            <select id={`${idPraefix}-lph`} className={FELD} value={wert.leistung === "akquise" ? "akquise" : String(wert.lph ?? "")}
              onChange={(e) => stufeWaehlen(e.target.value)}>
              {lphListe.map((nr) => <option key={nr} value={String(nr)}>{`${t("LPH")} ${nr}`}</option>)}
              <option value="akquise">{t("Akquise")}</option>
            </select>
          </div>
          {wert.leistung !== "akquise" && (
            <div className="space-y-1">
              <label htmlFor={`${idPraefix}-leistung`} className={LABEL}>{t("Leistung")}</label>
              <select id={`${idPraefix}-leistung`} className={FELD} value={wert.honorarnachtrag_id ? `n:${wert.honorarnachtrag_id}` : wert.leistung || "grund"}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v.startsWith("n:")) onChange({ ...wert, leistung: "honorarnachtrag", honorarnachtrag_id: v.slice(2) });
                  else onChange({ ...wert, leistung: v, honorarnachtrag_id: null });
                }}>
                <option value="grund">{t("Grundleistung")}</option>
                <option value="besondere">{t("Besondere Leistung")}</option>
                <option value="gewaehrleistung">{t("Gewährleistung")}</option>
                {projektNachtraege.map((n) => <option key={n.id} value={`n:${n.id}`}>{`${t("Honorarnachtrag")} ${n.nr ?? ""} · ${n.titel || ""}`}</option>)}
              </select>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
