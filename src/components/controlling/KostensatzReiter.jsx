// Tab "Kostensätze" of /Controlling (phase 81-05, ZEIT-05): the cost rate per
// person with its visible calculation — yearly gross (80's gehaltAm), employer
// factor 1 + zeit_honorar.ag_anteil/100 (the single source, E-16), productive
// hours from the active contract (80's aktiverVertrag) and the rules
// zeit_honorar.*, direct rate, rate with overhead. "Aus Gehalt berechnen" adds a
// new row (older rows stay — the history by gueltig_ab is what the controlling
// reads per booking day, D-P81-11); "Manuell" is the standard way for the owner
// without salary (E-17, also the virtual owner). "gültig ab" defaults to today, for
// a person's FIRST rate to January 1st of the year — otherwise the first rate an
// office enters would value none of the hours already booked [ASSUMED].
//
// Cost rates belong to the personnel storage class: this tab is only rendered
// with personnel access 'erlaubt' (the page hides it otherwise), and it reads and
// writes ONLY through the adapter src/lib/people/zeitHonorarPersonal.js (leak
// guard 80-02). No audit log (80 invariant).
//
// In:  props zh (page loader; persons, contracts, salaries and rates in zh.personal),
//      wert (rule reader of useRegelWerte). Out: the tab; writes cost rates.

import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import { toast } from "sonner";
import { useI18n } from "@core/lib/i18n";
import { datumText } from "@core/lib/kalender/datum.js";
import { feiertagsAbgleich, kalenderEinstellung } from "@/lib/abwesenheit/kalenderRegeln.js";
import { gueltigerSatz, satzAusGehalt } from "@/lib/controlling/kostensatz.js";
import { aktiverVertrag, gehaltAm, personAnzeigeName, personenFuerZeiterfassung } from "@/lib/zeit/personalQuelle.js";
import { speichereKostensatz } from "@/lib/people/zeitHonorarPersonal.js";
import { euroText } from "./zahlen.js";

/** Fills {key} placeholders after translation. */
const fuellen = (/** @type {string} */ text, /** @type {Record<string, any>} */ werte) => text.replace(/\{(\w+)\}/g, (_, k) => String(werte[k] ?? ""));

/**
 * Public holidays of a year that fall on Monday–Friday — the calendar suggestion next to
 * the rule zeit_honorar.feiertage. 82-04: from the office's one holiday setting
 * (kalenderEinstellung of the rule group "Kalender & Abwesenheiten"), not the constant.
 * @param {number} jahr
 * @param {(id: string) => any} wert rule reader
 * @returns {number} days
 */
function feiertageAnWochentagen(jahr, wert) {
  return feiertagsAbgleich(jahr, kalenderEinstellung(wert), Number(wert("zeit_honorar.feiertage")) || 0).anWochentagen;
}

/**
 * @param {{zh: import("@/components/zeitHonorar/useZeitHonorar.js").ZeitHonorar, wert: (id: string) => any}} props
 * @returns {React.ReactElement}
 */
export default function KostensatzReiter({ zh, wert }) {
  const { t, lang } = useI18n();
  const [manuell, setManuell] = useState(/** @type {Record<string, string>} */ ({}));
  const [busy, setBusy] = useState("");
  const [abWahl, setAbWahl] = useState(/** @type {Record<string, string>} */ ({}));
  const heute = zh.heute;
  const jahr = Number(heute.slice(0, 4));
  const werte = {
    ag_anteil: Number(wert("zeit_honorar.ag_anteil") ?? 21),
    gemeinkosten: Number(wert("zeit_honorar.gemeinkosten") ?? 80),
    produktivquote: Number(wert("zeit_honorar.produktivquote") ?? 85),
    feiertage: Number(wert("zeit_honorar.feiertage") ?? 13),
    krankheitstage: Number(wert("zeit_honorar.krankheitstage") ?? 10),
  };
  const faktor = 1 + werte.ag_anteil / 100;
  const zahl = (/** @type {number} */ x, /** @type {number} */ stellen = 2) => x.toLocaleString(lang === "en" ? "en-GB" : "de-DE", { minimumFractionDigits: stellen, maximumFractionDigits: stellen });
  const saetze = zh.personal.kostensaetze;
  const personen = personenFuerZeiterfassung(zh.personal.mitarbeiter, heute);

  /** @param {string} id @returns {string} 'YYYY-MM-DD' the new row is valid from */
  const abFuer = (id) => abWahl[id] || (saetze.some((s) => s.mitarbeiter_id === id) ? heute : `${jahr}-01-01`);

  /** @param {string} id @param {Record<string, any>} satz */
  const speichern = async (id, satz) => {
    setBusy(id);
    const ab = abFuer(id);
    try {
      // One row per person and day: a second save for the same day replaces that row.
      const gleicherTag = saetze.find((s) => s.mitarbeiter_id === id && s.gueltig_ab === ab);
      await speichereKostensatz({ ...(gleicherTag ? { id: gleicherTag.id } : {}), mitarbeiter_id: id, gueltig_ab: ab, ...satz });
      toast.success(t("Kostensatz gespeichert"));
      await zh.neuLaden();
    } catch (fehler) {
      toast.error(/** @type {any} */ (fehler)?.message || String(fehler));
    } finally {
      setBusy("");
    }
  };

  return (
    <section className="space-y-4" data-testid="kostensatz-reiter">
      <p className="text-sm text-slate-700 dark:text-slate-200">{t("Aus Gehältern abgeleitet — nur mit Personal-Zugang sichtbar.")}</p>
      <p className="text-xs text-slate-600 dark:text-slate-300" data-testid="kostensatz-feiertage">
        {fuellen(t("Kalender-Vorschlag {jahr}: {n} Feiertage an Wochentagen (Bayern); die Kalkulation rechnet mit {regel} Tagen."), { jahr, n: feiertageAnWochentagen(jahr, wert), regel: werte.feiertage })}{" "}
        <Link to="/Settings?tab=rules" className="text-emerald-700 underline dark:text-emerald-300" data-testid="kostensatz-regelwerke">{t("In den Regelwerken ändern")}</Link>
      </p>
      <ul className="space-y-3">
        {personen.map((p) => {
          const id = String(p.id);
          const aktuell = gueltigerSatz(saetze, id, heute);
          const vertrag = p.virtuell ? null : aktiverVertrag(zh.personal.vertraege, id, heute);
          const gehalt = p.virtuell ? null : gehaltAm(zh.personal.gehaelter, id, heute);
          const r = vertrag && gehalt ? satzAusGehalt({ gehalt, vertrag, personArt: p.art }, werte) : null;
          const verlauf = saetze.filter((s) => s.mitarbeiter_id === id).sort((a, b) => String(b.gueltig_ab).localeCompare(String(a.gueltig_ab)));
          const eingabe = manuell[id] ?? "";
          const manuellerWert = Number(String(eingabe).replace(",", "."));
          return (
            <li key={id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700" data-testid="kostensatz-person" data-person={id}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-medium text-slate-800 dark:text-slate-100">{personAnzeigeName(p, t)}</h3>
                <span className="text-sm tabular-nums" data-testid="kostensatz-aktuell">
                  {aktuell ? `${euroText(aktuell.satz_eur_h, lang)}/h · ${aktuell.herkunft === "manuell" ? t("manuell") : t("aus Gehalt")} · ${t("gültig ab")} ${datumText(aktuell.gueltig_ab, lang)}` : t("kein Kostensatz")}
                </span>
              </div>
              {r ? (
                <div className="mt-2 space-y-1 text-xs text-slate-600 dark:text-slate-300" data-testid="kostensatz-rechnung">
                  <p>{fuellen(t("Jahresbrutto {brutto} × Faktor {faktor} (AG-Anteil {ag} %) = Jahreskosten {kosten}"), { brutto: euroText(r.basis.jahresbrutto_eur, lang), faktor: zahl(faktor), ag: zahl(werte.ag_anteil, 0), kosten: euroText(r.basis.jahreskosten_eur, lang) })}</p>
                  <p>{fuellen(t("Produktive Stunden {h} h ({wh} h/Woche, {u} Urlaubstage, {f} Feiertage, {k} Krankheitstage, Produktivquote {q} %)"), { h: zahl(r.basis.produktive_stunden_h, 1), wh: zahl(r.basis.wochenstunden, 1), u: r.basis.urlaub_tage, f: r.basis.feiertage_tage, k: r.basis.krankheit_tage, q: zahl(r.basis.produktivquote_prozent, 0) })}</p>
                  <p>{fuellen(t("Direkt {direkt}/h, mit Gemeinkosten {gk} % → Satz {satz}/h"), { direkt: euroText(r.direkt_eur_h, lang), gk: zahl(r.basis.gemeinkosten_prozent, 0), satz: euroText(r.satz_eur_h, lang) })}</p>
                  <Button type="button" size="sm" variant="outline" disabled={busy === id} onClick={() => speichern(id, { satz_eur_h: r.satz_eur_h, direkt_eur_h: r.direkt_eur_h, herkunft: "berechnet", basis: r.basis, notiz: "" })}>
                    {t("Aus Gehalt berechnen")}
                  </Button>
                </div>
              ) : (
                <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                  {p.art === "inhaber" || p.art === "gesellschafter" || p.virtuell
                    ? t("Inhaber/in ohne Gehalt — Kostensatz von Hand eintragen.")
                    : t("Kein aktiver Arbeitsvertrag mit Gehalt — Kostensatz von Hand eintragen oder im Personal ergänzen.")}
                </p>
              )}
              <form className="mt-2 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (manuellerWert > 0) speichern(id, { satz_eur_h: Math.round(manuellerWert * 100) / 100, direkt_eur_h: null, herkunft: "manuell", basis: null, notiz: "" }); }}>
                <label className="text-xs text-slate-600 dark:text-slate-300">
                  <span className="block">{t("gültig ab")}</span>
                  <Input type="date" value={abFuer(id)} onChange={(e) => setAbWahl((a) => ({ ...a, [id]: e.target.value }))} className="h-8 w-40" data-testid="kostensatz-ab" />
                </label>
                <label className="text-xs text-slate-600 dark:text-slate-300">
                  <span className="block">{t("Manueller Satz (Euro/Stunde)")}</span>
                  <Input inputMode="decimal" value={eingabe} onChange={(e) => setManuell((m) => ({ ...m, [id]: e.target.value }))} className="h-8 w-32" data-testid="kostensatz-manuell" />
                </label>
                <Button type="submit" size="sm" disabled={busy === id || !(manuellerWert > 0)}>{t("Manuell")}</Button>
              </form>
              {verlauf.length > 0 && (
                <details className="mt-2 text-xs">
                  <summary className="cursor-pointer text-slate-600 dark:text-slate-300">{fuellen(t("Verlauf ({n})"), { n: verlauf.length })}</summary>
                  <ul className="mt-1 space-y-0.5">
                    {verlauf.map((s) => <li key={s.id || s.gueltig_ab} className="tabular-nums">{datumText(s.gueltig_ab, lang)}: {euroText(s.satz_eur_h, lang)}/h · {s.herkunft === "manuell" ? t("manuell") : t("aus Gehalt")}</li>)}
                  </ul>
                </details>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
