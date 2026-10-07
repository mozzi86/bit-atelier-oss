// Recurring expenses (phase 79, plan 79-04 T5): templates (rent, software
// subscriptions, chamber fees, the managing director's salary, …) with a
// rhythm, the next three due dates and a one-click "book as paid" that is
// idempotent (ausgaben.vorkommenBezahlen — the same period always produces the
// same Eingangsrechnung id, so booking it twice updates, never duplicates).
//
// In:  props {bh, projektId} (null = all projects — most recurring expenses
//      are office-wide, so a template without its own project_id always shows).
// Out: the section (list + inline create/edit form, no separate file: the
//      plan's files_modified list has none for it).

import React from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import FormModal from "@core/components/common/FormModal";
import { buttonVariants } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { plusMonate } from "@core/lib/kalender/datum.js";
import { betraegeAusBrutto, KATEGORIEN, kategorieText, STEUERFAELLE, steuerfallVorschlag, vorkommenBezahlen } from "@/lib/accounting/ausgaben.js";
import { wiederkehrendeVorkommen } from "@/lib/accounting/grundlagen.js";
import { centZuEuro, euroZuCent, formatEuro } from "@/lib/accounting/geld.js";
import BetragFeld from "./gemeinsam/BetragFeld.jsx";

const FELD = "h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900";
const LABEL = "text-sm font-medium text-slate-700 dark:text-slate-200";
const FEHLER = "text-sm text-red-700 dark:text-red-300";

/** @param {string} rhythmus @param {(k: string) => string} t */
function rhythmusText(rhythmus, t) {
  switch (rhythmus) {
    case "quartal": return t("Vierteljährlich");
    case "jahr": return t("Jährlich");
    default: return t("Monatlich");
  }
}

/**
 * The next `anzahl` due occurrences of a template from `heute` on (a two-year
 * window is enough for even a yearly rhythm to show three).
 * @param {Record<string, any>} vorlage
 * @param {string} heute 'YYYY-MM-DD'
 * @param {number} [anzahl]
 * @returns {Array<{schluessel: string, datum: string, periode: string}>}
 */
function naechsteFaelligkeiten(vorlage, heute, anzahl = 3) {
  return wiederkehrendeVorkommen(/** @type {any} */ (vorlage), heute, /** @type {string} */ (plusMonate(heute, 36))).slice(0, anzahl);
}

/**
 * Inline create/edit form for one template (FormModal). Kept in this file —
 * the plan lists no separate component file for it.
 * @param {{bh: import("./useBuchhaltung.js").Buchhaltung, vorlage: Record<string, any>|null, onClose: () => void}} props
 * @returns {React.ReactElement}
 */
function WiederkehrendFormular({ bh, vorlage, onClose }) {
  const { t } = useI18n();
  const bearbeiten = Boolean(vorlage?.id);
  const [form, setForm] = React.useState(() => ({
    lieferant: vorlage?.lieferant || "",
    kategorie: vorlage?.kategorie || "sonstiges",
    steuerfall: vorlage?.steuerfall || steuerfallVorschlag(vorlage?.kategorie || "sonstiges").steuerfall,
    rhythmus: vorlage?.rhythmus || "monat",
    start: vorlage?.start || bh.heute,
    bis: vorlage?.bis || "",
    aktiv: vorlage?.aktiv !== false,
  }));
  const [brutto, setBrutto] = React.useState(() => (vorlage ? euroZuCent(vorlage.brutto) : null));
  const [fehler, setFehler] = React.useState(/** @type {Record<string, string>} */ ({}));
  const [speichert, setSpeichert] = React.useState(false);

  const setze = (/** @type {string} */ feld, /** @type {any} */ wert) => setForm((f) => ({ ...f, [feld]: wert }));

  const speichern = async (/** @type {React.FormEvent} */ ev) => {
    ev.preventDefault();
    /** @type {Record<string, string>} */
    const f = {};
    if (!form.lieferant.trim()) f.lieferant = t("Bitte einen Lieferanten eingeben.");
    if (brutto === null) f.betrag = t("Bitte einen Betrag eingeben.");
    if (!form.start) f.start = t("Bitte ein Startdatum eingeben.");
    setFehler(f);
    if (Object.keys(f).length) return;
    const betraege = betraegeAusBrutto(/** @type {number} */ (brutto), form.steuerfall);
    setSpeichert(true);
    try {
      await bh.speichere("WiederkehrendeAusgabe", {
        ...(vorlage?.id ? { id: vorlage.id } : {}),
        lieferant: form.lieferant.trim(),
        kategorie: form.kategorie,
        steuerfall: form.steuerfall,
        netto: centZuEuro(betraege.netto),
        vorsteuer: centZuEuro(betraege.vorsteuer),
        brutto: centZuEuro(betraege.brutto),
        rhythmus: form.rhythmus,
        start: form.start,
        bis: form.bis || undefined,
        aktiv: form.aktiv,
      });
      toast.success(bearbeiten ? t("Vorlage gespeichert") : t("Vorlage angelegt"));
      onClose();
    } catch (err) {
      toast.error(`${t("Speichern fehlgeschlagen")}: ${/** @type {any} */ (err)?.message || String(err)}`);
    } finally {
      setSpeichert(false);
    }
  };

  return (
    <FormModal title={bearbeiten ? t("Wiederkehrende Ausgabe bearbeiten") : t("Neue wiederkehrende Ausgabe")} onClose={onClose}>
      <form onSubmit={speichern} className="space-y-4" data-testid="wiederkehrend-formular">
        <div className="space-y-1">
          <label htmlFor="wa-lieferant" className={LABEL}>{t("Lieferant")}</label>
          <input id="wa-lieferant" type="text" className={FELD} value={form.lieferant}
            aria-invalid={fehler.lieferant ? true : undefined} onChange={(e) => setze("lieferant", e.target.value)} />
          {fehler.lieferant && <p className={FEHLER}>{fehler.lieferant}</p>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="wa-kategorie" className={LABEL}>{t("Kategorie")}</label>
            <select id="wa-kategorie" className={FELD} value={form.kategorie}
              onChange={(e) => { const v = steuerfallVorschlag(e.target.value); setForm((f) => ({ ...f, kategorie: e.target.value, steuerfall: v.steuerfall })); }}>
              {Object.keys(KATEGORIEN).map((k) => <option key={k} value={k}>{kategorieText(k, t)}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="wa-steuerfall" className={LABEL}>{t("Steuerfall")}</label>
            <select id="wa-steuerfall" className={FELD} value={form.steuerfall} onChange={(e) => setze("steuerfall", e.target.value)}>
              {Object.keys(STEUERFAELLE).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <BetragFeld id="wa-brutto" label={t("Brutto je Fälligkeit")} wert={brutto} onChange={setBrutto} />
          <div className="space-y-1">
            <label htmlFor="wa-rhythmus" className={LABEL}>{t("Rhythmus")}</label>
            <select id="wa-rhythmus" className={FELD} value={form.rhythmus} onChange={(e) => setze("rhythmus", e.target.value)}>
              <option value="monat">{t("Monatlich")}</option>
              <option value="quartal">{t("Vierteljährlich")}</option>
              <option value="jahr">{t("Jährlich")}</option>
            </select>
          </div>
        </div>
        {fehler.betrag && <p className={FEHLER}>{fehler.betrag}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="wa-start" className={LABEL}>{t("Start")}</label>
            <input id="wa-start" type="date" className={FELD} value={form.start}
              aria-invalid={fehler.start ? true : undefined} onChange={(e) => setze("start", e.target.value)} />
            {fehler.start && <p className={FEHLER}>{fehler.start}</p>}
          </div>
          <div className="space-y-1">
            <label htmlFor="wa-bis" className={LABEL}>{t("Ende (optional)")}</label>
            <input id="wa-bis" type="date" className={FELD} value={form.bis} onChange={(e) => setze("bis", e.target.value)} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
          <input type="checkbox" checked={form.aktiv} onChange={(e) => setze("aktiv", e.target.checked)} />
          {t("Aktiv")}
        </label>
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <button type="button" className={buttonVariants({ variant: "outline" })} onClick={onClose}>{t("Abbrechen")}</button>
          <button type="submit" className={buttonVariants({ variant: "default" })} disabled={speichert}>{t("Speichern")}</button>
        </div>
      </form>
    </FormModal>
  );
}

/**
 * @param {{bh: import("./useBuchhaltung.js").Buchhaltung, projektId: string|null}} props
 * @returns {React.ReactElement}
 */
export default function WiederkehrendAbschnitt({ bh, projektId }) {
  const { t } = useI18n();
  const [formular, setFormular] = React.useState(/** @type {"neu"|Record<string, any>|null} */ (null));
  const [buchend, setBuchend] = React.useState(/** @type {string|null} */ (null));
  const [datumJeSchluessel, setDatumJeSchluessel] = React.useState(/** @type {Record<string, string>} */ ({}));

  const alle = bh.daten.WiederkehrendeAusgabe || [];
  const vorlagen = projektId ? alle.filter((v) => !v.project_id || v.project_id === projektId) : alle;
  const erfassteIds = new Set((bh.daten.Eingangsrechnung || []).map((e) => e.wiederkehrend_id).filter(Boolean));

  const alsBezahltBuchen = async (/** @type {Record<string, any>} */ vorlage, /** @type {{periode: string, datum: string}} */ vk) => {
    const schluessel = `${vorlage.id}:${vk.periode}`;
    setBuchend(schluessel);
    try {
      await bh.speichere("Eingangsrechnung", vorkommenBezahlen(vorlage, vk.periode, datumJeSchluessel[schluessel] || vk.datum));
      toast.success(t("Als bezahlt gebucht"));
    } catch (err) {
      toast.error(`${t("Buchen fehlgeschlagen")}: ${/** @type {any} */ (err)?.message || String(err)}`);
    } finally {
      setBuchend(null);
    }
  };

  const loeschen = async (/** @type {Record<string, any>} */ vorlage) => {
    try {
      await bh.loesche("WiederkehrendeAusgabe", vorlage.id);
      toast.success(t("Vorlage gelöscht"));
    } catch (err) {
      toast.error(`${t("Löschen fehlgeschlagen")}: ${/** @type {any} */ (err)?.message || String(err)}`);
    }
  };

  return (
    <section className="space-y-3" aria-labelledby="wa-titel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="wa-titel" className="font-semibold text-slate-800 dark:text-slate-100">{t("Wiederkehrende Ausgaben")}</h3>
        <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={() => setFormular("neu")}>
          <Plus aria-hidden="true" /> {t("Neue Vorlage")}
        </button>
      </div>
      {vorlagen.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-300">{t("Keine wiederkehrenden Ausgaben angelegt.")}</p>
      ) : (
        <ul className="space-y-2">
          {vorlagen.map((vorlage) => {
            const faelligkeiten = naechsteFaelligkeiten(vorlage, bh.heute);
            const hatVorkommen = erfassteIds.has(vorlage.id);
            return (
              <li key={vorlage.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-medium text-slate-800 dark:text-slate-100">{vorlage.lieferant}</span>{" "}
                    <span className="text-sm text-slate-600 dark:text-slate-300">
                      {kategorieText(vorlage.kategorie, t)} · {rhythmusText(vorlage.rhythmus, t)} · {formatEuro(euroZuCent(vorlage.brutto))}
                    </span>
                    {vorlage.aktiv === false && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">{t("Inaktiv")}</span>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={buttonVariants({ variant: "ghost", size: "sm" })} onClick={() => setFormular(vorlage)}>{t("Bearbeiten")}</button>
                    <button type="button" className={buttonVariants({ variant: "ghost", size: "sm" })}
                      onClick={() => bh.speichere("WiederkehrendeAusgabe", { id: vorlage.id, aktiv: !(vorlage.aktiv !== false) })}>
                      {vorlage.aktiv === false ? t("Aktivieren") : t("Deaktivieren")}
                    </button>
                    <button type="button" className={buttonVariants({ variant: "ghost", size: "sm" })} disabled={hatVorkommen}
                      title={hatVorkommen ? t("Es sind bereits Vorkommen erfasst — nur deaktivieren.") : undefined}
                      onClick={() => loeschen(vorlage)}>{t("Löschen")}</button>
                  </div>
                </div>
                {vorlage.aktiv !== false && faelligkeiten.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {faelligkeiten.map((vk) => {
                      const schluessel = `${vorlage.id}:${vk.periode}`;
                      return (
                        <li key={schluessel} className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="tabular-nums text-slate-600 dark:text-slate-300">{vk.datum}</span>
                          <input type="date" className="h-8 rounded-md border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-900"
                            aria-label={t("Bezahlt am")} value={datumJeSchluessel[schluessel] || vk.datum}
                            onChange={(e) => setDatumJeSchluessel((d) => ({ ...d, [schluessel]: e.target.value }))} />
                          <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })}
                            disabled={buchend === schluessel} onClick={() => alsBezahltBuchen(vorlage, vk)}>
                            {t("Als bezahlt buchen")}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {formular && (
        <WiederkehrendFormular bh={bh} vorlage={formular === "neu" ? null : formular} onClose={() => setFormular(null)} />
      )}
    </section>
  );
}
