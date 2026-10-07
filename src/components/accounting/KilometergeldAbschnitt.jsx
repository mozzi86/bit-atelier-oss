// Mileage allowance for business trips with a PRIVATE car (phase 79, plan
// 79-08 T5, `Fahrt.fahrzeug_id === null`): trip list, an inline create/edit
// form (no separate file, pattern of WiederkehrendAbschnitt.jsx), and the
// month/project summary from fuhrpark.kilometergeld().
//
// In:  props {bh, jahr}. Out: the section.

import React from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import FormModal from "@core/components/common/FormModal";
import { buttonVariants } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import { kilometergeld } from "@/lib/accounting/fuhrpark.js";
import { formatEuro } from "@/lib/accounting/geld.js";
// 80-10 Task 7b: NUR diese Auswahl — sie kapselt den Personal-Speicherzugriff selbst (s. deren Dateikopf).
import PersonAuswahl from "@/components/people/PersonAuswahl.jsx";

const FELD = "h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-slate-600 dark:bg-slate-900";
const LABEL = "text-sm font-medium text-slate-700 dark:text-slate-200";
const FEHLER = "text-sm text-red-700 dark:text-red-300";

/**
 * Inline create/edit form for one private-car trip (kept in this file, like
 * WiederkehrendAbschnitt.jsx's own inline formular).
 * @param {{bh: import("./useBuchhaltung.js").Buchhaltung, eintrag: Record<string, any>|null, onClose: () => void}} props
 * @returns {React.ReactElement}
 */
function KilometergeldFormular({ bh, eintrag, onClose }) {
  const { t } = useI18n();
  const bearbeiten = Boolean(eintrag?.id);
  const [form, setForm] = React.useState(() => ({
    datum: eintrag?.datum || bh.heute,
    person: eintrag?.person || "",
    // 80-10 Task 7b: opaker Verweis zusätzlich zum freien Feld "person" —
    // person bleibt der Rückfall, kein Name wird aus Personal kopiert.
    mitarbeiter_id: eintrag?.mitarbeiter_id ?? null,
    ziel: eintrag?.ziel || "",
    zweck: eintrag?.zweck || "",
    km: eintrag?.km ?? "",
    project_id: eintrag?.project_id || "",
  }));
  const [fehler, setFehler] = React.useState(/** @type {Record<string, string>} */ ({}));
  const [speichert, setSpeichert] = React.useState(false);

  const setze = (/** @type {string} */ feld, /** @type {any} */ wert) => setForm((f) => ({ ...f, [feld]: wert }));

  const speichern = async (/** @type {React.FormEvent} */ ev) => {
    ev.preventDefault();
    /** @type {Record<string, string>} */
    const f = {};
    if (!form.datum) f.datum = t("Bitte ein Datum eingeben.");
    if (!form.person.trim()) f.person = t("Bitte eine Person eingeben.");
    if (form.km === "" || Number.isNaN(Number(form.km))) f.km = t("Bitte Kilometer eingeben.");
    setFehler(f);
    if (Object.keys(f).length) return;
    setSpeichert(true);
    try {
      await bh.speichere("Fahrt", {
        ...(eintrag?.id ? { id: eintrag.id } : {}),
        fahrzeug_id: null,
        person: form.person.trim(),
        mitarbeiter_id: form.mitarbeiter_id || null,
        datum: form.datum,
        ziel: form.ziel.trim() || undefined,
        zweck: form.zweck.trim() || undefined,
        km: Number(form.km),
        art: "dienstlich",
        project_id: form.project_id || undefined,
      });
      toast.success(bearbeiten ? t("Fahrt gespeichert") : t("Fahrt erfasst"));
      onClose();
    } catch (err) {
      toast.error(`${t("Speichern fehlgeschlagen")}: ${/** @type {any} */ (err)?.message || String(err)}`);
    } finally {
      setSpeichert(false);
    }
  };

  return (
    <FormModal title={bearbeiten ? t("Fahrt bearbeiten") : t("Neue Fahrt mit Privat-Pkw")} onClose={onClose}>
      <form onSubmit={speichern} className="space-y-4" data-testid="kilometergeld-formular">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="kg-datum" className={LABEL}>{t("Datum")}</label>
            <input id="kg-datum" type="date" className={FELD} value={form.datum}
              aria-invalid={fehler.datum ? true : undefined} onChange={(e) => setze("datum", e.target.value)} />
            {fehler.datum && <p className={FEHLER}>{fehler.datum}</p>}
          </div>
          <div className="space-y-1">
            <label htmlFor="kg-person" className={LABEL}>{t("Person")}</label>
            <input id="kg-person" type="text" className={FELD} value={form.person}
              aria-invalid={fehler.person ? true : undefined} onChange={(e) => setze("person", e.target.value)} />
            {fehler.person && <p className={FEHLER}>{fehler.person}</p>}
          </div>
          {/* 80-10 Task 7b: rendert nichts ohne Personal-Zugang — "person" bleibt dann der einzige Weg. */}
          <PersonAuswahl id="kg-mitarbeiter" value={form.mitarbeiter_id} onChange={(id) => setze("mitarbeiter_id", id)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="kg-ziel" className={LABEL}>{t("Ziel")}</label>
            <input id="kg-ziel" type="text" className={FELD} value={form.ziel} onChange={(e) => setze("ziel", e.target.value)} />
          </div>
          <div className="space-y-1">
            <label htmlFor="kg-zweck" className={LABEL}>{t("Zweck")}</label>
            <input id="kg-zweck" type="text" className={FELD} value={form.zweck} onChange={(e) => setze("zweck", e.target.value)} />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="kg-km" className={LABEL}>{t("Kilometer")}</label>
            <input id="kg-km" type="number" min="0" step="1" className={FELD} value={form.km}
              aria-invalid={fehler.km ? true : undefined} onChange={(e) => setze("km", e.target.value)} />
            {fehler.km && <p className={FEHLER}>{fehler.km}</p>}
          </div>
          <div className="space-y-1">
            <label htmlFor="kg-projekt" className={LABEL}>{t("Projekt (optional)")}</label>
            <select id="kg-projekt" className={FELD} value={form.project_id} onChange={(e) => setze("project_id", e.target.value)}>
              <option value="">{t("— kein Projekt —")}</option>
              {bh.projekte.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <button type="button" className={buttonVariants({ variant: "outline" })} onClick={onClose}>{t("Abbrechen")}</button>
          <button type="submit" className={buttonVariants({ variant: "default" })} disabled={speichert}>{t("Speichern")}</button>
        </div>
      </form>
    </FormModal>
  );
}

/**
 * @param {{bh: import("./useBuchhaltung.js").Buchhaltung, jahr: number}} props
 * @returns {React.ReactElement}
 */
export default function KilometergeldAbschnitt({ bh, jahr }) {
  const { t } = useI18n();
  const [formular, setFormular] = React.useState(/** @type {"neu"|Record<string, any>|null} */ (null));

  const alle = (bh.daten.Fahrt || []).filter((f) => f.fahrzeug_id === null || f.fahrzeug_id === undefined);
  const desJahres = alle.filter((f) => String(f.datum || "").slice(0, 4) === String(jahr))
    .slice().sort((a, b) => (a.datum < b.datum ? 1 : a.datum > b.datum ? -1 : 0));
  const ergebnis = kilometergeld(desJahres, bh.saetze);
  const projektName = Object.fromEntries(bh.projekte.map((p) => [p.id, p.name]));

  return (
    <section className="space-y-3" aria-labelledby="kg-titel" data-testid="kilometergeld-abschnitt">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="kg-titel" className="font-semibold text-slate-800 dark:text-slate-100">{t("Kilometergeld")}</h3>
        <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={() => setFormular("neu")}>
          <Plus aria-hidden="true" /> {t("Neue Fahrt mit Privat-Pkw")}
        </button>
      </div>

      {desJahres.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-300">{t("Keine Fahrten mit dem Privat-Pkw erfasst.")}</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                <tr>{[t("Datum"), t("Person"), t("Ziel"), t("Kilometer"), t("Projekt"), ""].map((h) => (
                  <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>
                ))}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {desJahres.map((f) => (
                  <tr key={f.id}>
                    <td className="px-3 py-2 tabular-nums">{f.datum}</td>
                    <td className="px-3 py-2">{f.person || "—"}</td>
                    <td className="px-3 py-2">{f.ziel || "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{f.km} km</td>
                    <td className="px-3 py-2">{f.project_id ? (projektName[f.project_id] || f.project_id) : "—"}</td>
                    <td className="px-3 py-2">
                      <button type="button" className={buttonVariants({ variant: "ghost", size: "sm" })} onClick={() => setFormular(f)}>{t("Bearbeiten")}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700" data-testid="kg-summen">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                <tr>{[t("Monat"), t("Person"), t("Projekt"), t("Kilometer"), t("Betrag")].map((h) => (
                  <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>
                ))}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {ergebnis.zeilen.map((z) => (
                  <tr key={`${z.monat}|${z.person}|${z.project_id}`}>
                    <td className="px-3 py-2 tabular-nums">{z.monat}</td>
                    <td className="px-3 py-2">{z.person || "—"}</td>
                    <td className="px-3 py-2">{z.project_id ? (projektName[z.project_id] || z.project_id) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{z.km} km</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatEuro(z.betragCent)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200 font-medium dark:border-slate-700">
                  <td className="px-3 py-2" colSpan={3}>{t("Summe")}</td>
                  <td className="px-3 py-2 text-right tabular-nums" data-testid="kg-summe-km">{ergebnis.summeKm} km</td>
                  <td className="px-3 py-2 text-right tabular-nums" data-testid="kg-summe-betrag">{formatEuro(ergebnis.summeCent)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}

      {formular && (
        <KilometergeldFormular bh={bh} eintrag={formular === "neu" ? null : formular} onClose={() => setFormular(null)} />
      )}
    </section>
  );
}
