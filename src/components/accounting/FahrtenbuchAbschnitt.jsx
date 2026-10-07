// Logbook comparison, one subsection per car (phase 79, plan 79-08 T5): trips
// against that car, data-quality warnings from the evaluation, and a card
// that compares the flat rate (1 % rule) against the logbook value and marks
// the cheaper one. A standing disclaimer names what this app's logbook is
// NOT — a liability choice (CLAUDE.md "Checks kommentieren, warum warn"):
// nothing here stops a manipulable logbook from being kept, it only compares
// numbers for the office's own decision.
//
// In:  props {bh, jahr}. Out: the section (no separate form file — the
//      plan's files_modified list has none for it, pattern of
//      WiederkehrendAbschnitt.jsx).

import React from "react";
import { toast } from "sonner";
import { Plus, TriangleAlert } from "lucide-react";
import FormModal from "@core/components/common/FormModal";
import { buttonVariants } from "@core/components/ui/button";
import { useI18n } from "@core/lib/i18n";
import {
  fahrtenbuchAuswertung, fahrtenbuchWert, fahrzeugKosten, pauschalJahr, vergleich, warnungText,
} from "@/lib/accounting/fuhrpark.js";
import { formatEuro } from "@/lib/accounting/geld.js";
// 80-10 Task 7b: NUR diese Auswahl — sie kapselt den Personal-Speicherzugriff selbst (s. deren Dateikopf).
import PersonAuswahl from "@/components/people/PersonAuswahl.jsx";

const FELD = "h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-slate-600 dark:bg-slate-900";
const LABEL = "text-sm font-medium text-slate-700 dark:text-slate-200";
const FEHLER = "text-sm text-red-700 dark:text-red-300";

/** @param {string} art @param {(k: string) => string} t */
function artText(art, t) {
  switch (art) {
    case "privat": return t("Privat");
    case "wohnung_arbeit": return t("Wohnung–Arbeitsstätte");
    default: return t("Dienstlich");
  }
}

/**
 * Inline create/edit form for one trip against a fixed car (kept in this
 * file, like WiederkehrendAbschnitt.jsx's own inline formular).
 * @param {{bh: import("./useBuchhaltung.js").Buchhaltung, fahrzeugId: string, eintrag: Record<string, any>|null, onClose: () => void}} props
 * @returns {React.ReactElement}
 */
function FahrtFormular({ bh, fahrzeugId, eintrag, onClose }) {
  const { t } = useI18n();
  const bearbeiten = Boolean(eintrag?.id);
  const [form, setForm] = React.useState(() => ({
    datum: eintrag?.datum || bh.heute,
    ziel: eintrag?.ziel || "",
    zweck: eintrag?.zweck || "",
    km: eintrag?.km ?? "",
    km_start: eintrag?.km_start ?? "",
    km_ende: eintrag?.km_ende ?? "",
    art: eintrag?.art || "dienstlich",
    project_id: eintrag?.project_id || "",
    // 80-10 Task 7b: opaker Verweis zusätzlich zum freien Feld "person" —
    // person bleibt der Rückfall (t("Inhaber/in")), kein Name wird kopiert.
    mitarbeiter_id: eintrag?.mitarbeiter_id ?? null,
  }));
  const [fehler, setFehler] = React.useState(/** @type {Record<string, string>} */ ({}));
  const [speichert, setSpeichert] = React.useState(false);

  const setze = (/** @type {string} */ feld, /** @type {any} */ wert) => setForm((f) => ({ ...f, [feld]: wert }));

  const speichern = async (/** @type {React.FormEvent} */ ev) => {
    ev.preventDefault();
    /** @type {Record<string, string>} */
    const f = {};
    if (!form.datum) f.datum = t("Bitte ein Datum eingeben.");
    if (!form.ziel.trim()) f.ziel = t("Bitte ein Ziel eingeben.");
    if (form.km === "" || Number.isNaN(Number(form.km))) f.km = t("Bitte Kilometer eingeben.");
    setFehler(f);
    if (Object.keys(f).length) return;
    setSpeichert(true);
    try {
      await bh.speichere("Fahrt", {
        ...(eintrag?.id ? { id: eintrag.id } : {}),
        fahrzeug_id: fahrzeugId,
        person: eintrag?.person || t("Inhaber/in"),
        mitarbeiter_id: form.mitarbeiter_id || null,
        datum: form.datum,
        ziel: form.ziel.trim(),
        zweck: form.zweck.trim() || undefined,
        km: Number(form.km),
        km_start: form.km_start === "" ? undefined : Number(form.km_start),
        km_ende: form.km_ende === "" ? undefined : Number(form.km_ende),
        art: form.art,
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
    <FormModal title={bearbeiten ? t("Fahrt bearbeiten") : t("Neue Fahrt")} onClose={onClose}>
      <form onSubmit={speichern} className="space-y-4" data-testid="fahrt-formular">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="ft-datum" className={LABEL}>{t("Datum")}</label>
            <input id="ft-datum" type="date" className={FELD} value={form.datum}
              aria-invalid={fehler.datum ? true : undefined} onChange={(e) => setze("datum", e.target.value)} />
            {fehler.datum && <p className={FEHLER}>{fehler.datum}</p>}
          </div>
          <div className="space-y-1">
            <label htmlFor="ft-art" className={LABEL}>{t("Art")}</label>
            <select id="ft-art" className={FELD} value={form.art} onChange={(e) => setze("art", e.target.value)}>
              <option value="dienstlich">{artText("dienstlich", t)}</option>
              <option value="privat">{artText("privat", t)}</option>
              <option value="wohnung_arbeit">{artText("wohnung_arbeit", t)}</option>
            </select>
          </div>
        </div>
        {/* 80-10 Task 7b: rendert nichts ohne Personal-Zugang. */}
        <PersonAuswahl id="ft-mitarbeiter" value={form.mitarbeiter_id} onChange={(id) => setze("mitarbeiter_id", id)} />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="ft-ziel" className={LABEL}>{t("Ziel")}</label>
            <input id="ft-ziel" type="text" className={FELD} value={form.ziel}
              aria-invalid={fehler.ziel ? true : undefined} onChange={(e) => setze("ziel", e.target.value)} />
            {fehler.ziel && <p className={FEHLER}>{fehler.ziel}</p>}
          </div>
          <div className="space-y-1">
            <label htmlFor="ft-zweck" className={LABEL}>{t("Zweck")}</label>
            <input id="ft-zweck" type="text" className={FELD} value={form.zweck} onChange={(e) => setze("zweck", e.target.value)} />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <label htmlFor="ft-km" className={LABEL}>{t("Kilometer")}</label>
            <input id="ft-km" type="number" min="0" step="1" className={FELD} value={form.km}
              aria-invalid={fehler.km ? true : undefined} onChange={(e) => setze("km", e.target.value)} />
            {fehler.km && <p className={FEHLER}>{fehler.km}</p>}
          </div>
          <div className="space-y-1">
            <label htmlFor="ft-km-start" className={LABEL}>{t("Kilometerstand von (optional)")}</label>
            <input id="ft-km-start" type="number" min="0" step="1" className={FELD} value={form.km_start} onChange={(e) => setze("km_start", e.target.value)} />
          </div>
          <div className="space-y-1">
            <label htmlFor="ft-km-ende" className={LABEL}>{t("Kilometerstand bis (optional)")}</label>
            <input id="ft-km-ende" type="number" min="0" step="1" className={FELD} value={form.km_ende} onChange={(e) => setze("km_ende", e.target.value)} />
          </div>
        </div>
        <div className="space-y-1">
          <label htmlFor="ft-projekt" className={LABEL}>{t("Projekt (optional)")}</label>
          <select id="ft-projekt" className={FELD} value={form.project_id} onChange={(e) => setze("project_id", e.target.value)}>
            <option value="">{t("— kein Projekt —")}</option>
            {bh.projekte.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
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
export default function FahrtenbuchAbschnitt({ bh, jahr }) {
  const { t } = useI18n();
  const [formular, setFormular] = React.useState(/** @type {{fahrzeugId: string, eintrag: Record<string, any>|null}|null} */ (null));

  const fahrzeuge = bh.daten.Fahrzeug || [];
  const alleFahrten = bh.daten.Fahrt || [];
  const projektName = Object.fromEntries(bh.projekte.map((p) => [p.id, p.name]));

  return (
    <section className="space-y-4" aria-labelledby="fb-titel" data-testid="fahrtenbuch-abschnitt">
      <h3 id="fb-titel" className="font-semibold text-slate-800 dark:text-slate-100">{t("Fahrtenbuch")}</h3>
      <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
        {t("Ein Fahrtenbuch in dieser App ist nicht manipulationssicher — nur Vergleich, kein ordnungsgemäßes Fahrtenbuch.")}
      </p>

      {fahrzeuge.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-300">{t("Keine Fahrzeuge angelegt.")}</p>
      ) : (
        fahrzeuge.map((f) => {
          const fahrten = alleFahrten.filter((ft) => ft.fahrzeug_id === f.id)
            .slice().sort((a, b) => (a.datum < b.datum ? 1 : a.datum > b.datum ? -1 : 0));
          const auswertung = fahrtenbuchAuswertung(alleFahrten, f);
          const pauschalCent = pauschalJahr(f, bh.saetze, jahr).summe;
          const fahrtenbuchCent = fahrtenbuchWert(bh.daten, f, jahr);
          const kostenCent = fahrzeugKosten(bh.daten, f, jahr);
          const cmp = vergleich(pauschalCent, fahrtenbuchCent);

          return (
            <div key={f.id} className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700" data-testid={`fb-fahrzeug-${f.id}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="font-medium text-slate-800 dark:text-slate-100">{f.kennzeichen}{f.nutzer ? ` — ${f.nutzer}` : ""}</h4>
                <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })}
                  onClick={() => setFormular({ fahrzeugId: f.id, eintrag: null })}>
                  <Plus aria-hidden="true" /> {t("Neue Fahrt")}
                </button>
              </div>

              {auswertung.warnungen.length > 0 && (
                <ul className="space-y-1">
                  {auswertung.warnungen.map((w, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-amber-800 dark:text-amber-200">
                      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> <span>{warnungText(w, t)}</span>
                    </li>
                  ))}
                </ul>
              )}

              {fahrten.length === 0 ? (
                <p className="text-sm text-slate-600 dark:text-slate-300">{t("Keine Fahrten erfasst.")}</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                      <tr>{[t("Datum"), t("Ziel"), t("Zweck"), t("Kilometer"), t("Art"), t("Projekt"), ""].map((h) => (
                        <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>
                      ))}</tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {fahrten.map((ft) => (
                        <tr key={ft.id}>
                          <td className="px-3 py-2 tabular-nums">{ft.datum}</td>
                          <td className="px-3 py-2">{ft.ziel || "—"}</td>
                          <td className="px-3 py-2">{ft.zweck || "—"}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{ft.km} km</td>
                          <td className="px-3 py-2">{artText(ft.art, t)}</td>
                          <td className="px-3 py-2">{ft.project_id ? (projektName[ft.project_id] || ft.project_id) : "—"}</td>
                          <td className="px-3 py-2">
                            <button type="button" className={buttonVariants({ variant: "ghost", size: "sm" })}
                              onClick={() => setFormular({ fahrzeugId: f.id, eintrag: ft })}>{t("Bearbeiten")}</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-900 sm:grid-cols-3" data-testid={`fb-vergleich-${f.id}`}>
                <p><span className="text-slate-500 dark:text-slate-400">{t("1 %-Regel")} ({jahr}):</span> {formatEuro(pauschalCent)}</p>
                <p><span className="text-slate-500 dark:text-slate-400">{t("Fahrtenbuch")} ({jahr}, {t("Kosten")} {formatEuro(kostenCent)}):</span> {formatEuro(fahrtenbuchCent)}</p>
                <p className="font-medium text-slate-800 dark:text-slate-100">
                  {t("Günstigere Methode")}: {cmp.guenstiger === "fahrtenbuch" ? t("Fahrtenbuch") : t("1 %-Regel")}
                </p>
              </div>
            </div>
          );
        })
      )}

      {formular && (
        <FahrtFormular bh={bh} fahrzeugId={formular.fahrzeugId} eintrag={formular.eintrag} onClose={() => setFormular(null)} />
      )}
    </section>
  );
}
