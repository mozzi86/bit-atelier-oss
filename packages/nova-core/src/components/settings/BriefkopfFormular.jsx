// The ONE letterhead editor (@core, 80-03: KRITIK-05, NA-10 d — "kein zweiter
// Editor neben einem bestehenden"). Everything that used to live twice — the
// Layout.jsx sidebar-gear modal and the Reports.jsx card — now reads and writes
// through this single component and @core/lib/useBriefkopf; BueroBereich
// (src/components/settings/BueroBereich.jsx) embeds it as the "office" settings
// area, the sidebar gear only links there (Layout.jsx, 80-03 task 3).
//
// Boundary: @core-only imports, so @ifc's ModelCheck.jsx can adopt this editor
// later (after Hermes releases the file) without pulling in the app shell.
//
// In:  nothing (reads/writes Setting{key:"briefkopf"} through useBriefkopf).
// Out: the form plus a live preview of the report header, same order as
//      ReportDocument.jsx's own header.

import React from "react";
import { toast } from "sonner";
import { Building2 } from "lucide-react";
import { useI18n } from "@core/lib/i18n";
import { useBriefkopf } from "@core/lib/useBriefkopf";
import { useBestaetigung } from "@core/lib/useBestaetigung";

/** Shared input look — visible focus ring, dark mode (task 2 acceptance). */
const EINGABE = "mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100";

/** Fields in display order; `label`/`platzhalter` are German i18n keys. */
const FELDER = [
  { feld: "office", label: "Büroname", platzhalter: "Architekturbüro" },
  { feld: "tagline", label: "Untertitel", platzhalter: "" },
  { feld: "address", label: "Anschrift", platzhalter: "Straße, PLZ Ort" },
  { feld: "contact", label: "Kontakt", platzhalter: "Telefon · E-Mail" },
];

/**
 * @returns {React.ReactElement}
 */
export default function BriefkopfFormular() {
  const { t } = useI18n();
  const { briefkopf, laden, speichern } = useBriefkopf();
  const bestaetige = useBestaetigung();
  const [form, setForm] = React.useState(briefkopf);
  const [speichert, setSpeichert] = React.useState(false);
  // The stored value only overwrites an UNTOUCHED form, and only once the
  // fetch has actually SETTLED (`laden` false) — not on the first render, which
  // still carries the DEFAULT value while the read is in flight. Syncing on
  // every `briefkopf` change instead of gating on `laden` synced the (still
  // default) first-render value and then never again, so a remounted form
  // (leaving and returning to the tab) kept showing "Architekturbüro" even
  // though the store already held the saved office name.
  const geladen = React.useRef(false);
  React.useEffect(() => {
    if (!laden && !geladen.current) { setForm(briefkopf); geladen.current = true; }
  }, [laden, briefkopf]);

  const geaendert = FELDER.some((f) => (form[f.feld] || "") !== (briefkopf[f.feld] || ""));

  /** @param {string} feld @param {string} wert */
  const feldSetzen = (feld, wert) => setForm((p) => ({ ...p, [feld]: wert }));

  /** @param {React.FormEvent} e */
  const onSpeichern = async (e) => {
    e.preventDefault();
    setSpeichert(true);
    try {
      await speichern({ office: form.office, tagline: form.tagline, address: form.address, contact: form.contact });
      toast.success(t("Einstellungen gespeichert"));
    } catch (fehler) {
      // Errors are shown, never swallowed (CLAUDE.md: Fehlermeldungen im Klartext).
      toast.error(`${t("Speichern fehlgeschlagen")}: ${/** @type {any} */ (fehler)?.message || fehler}`);
    } finally {
      setSpeichert(false);
    }
  };

  const onVerwerfen = async () => {
    if (!geaendert) return;
    const ok = await bestaetige({
      titel: t("Änderungen verwerfen?"),
      text: t("Die Eingaben im Briefkopf gehen verloren."),
    });
    if (ok) setForm(briefkopf);
  };

  return (
    <div className="space-y-6">
      <form onSubmit={onSpeichern} className="space-y-3 rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900">
        {FELDER.map((f) => (
          <label key={f.feld} className="block">
            <span className="text-xs text-slate-500 dark:text-slate-400">{t(f.label)}</span>
            <input
              className={EINGABE}
              value={form[f.feld] || ""}
              placeholder={f.platzhalter}
              onChange={(e) => feldSetzen(f.feld, e.target.value)}
            />
          </label>
        ))}
        <p className="text-xs text-slate-500 dark:text-slate-400">{t("Gilt für Berichte und Prüfberichte dieses Büros.")}</p>
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <button type="button" onClick={onVerwerfen} disabled={speichert || !geaendert}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
            {t("Änderungen verwerfen")}
          </button>
          <button type="submit" disabled={speichert}
            className="rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-60">
            {t("Speichern")}
          </button>
        </div>
      </form>

      {/* Live preview — same order/look as ReportDocument.jsx's header. */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">{t("Vorschau")}</p>
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600">
            <Building2 className="h-5 w-5 text-white" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="max-w-[360px] truncate font-bold leading-tight text-slate-800 dark:text-slate-100">{form.office || t("Architekturbüro")}</div>
            {form.tagline ? <div className="text-[10px] text-slate-400">{form.tagline}</div> : null}
            {(form.address || form.contact) ? (
              <div className="text-[10px] text-slate-500 dark:text-slate-400">{[form.address, form.contact].filter(Boolean).join(" · ")}</div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
