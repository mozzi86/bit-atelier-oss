// Users of the office (phase 82, 82-02, RECHT-04): name, initials, e-mail,
// role, linked person, active. Read and written only through the office store
// (bueroEntitaet / speichereBuero, E-03). The last active owner can be neither
// demoted nor deactivated (letzterInhaberGeschuetzt). Project assignments are
// shown READ-ONLY from the loader's narrow projection; the one editor stays
// 80-04's ProjektZuordnung on /People (link via bauePersonalLink) — no second editor.
//
// In:  props nutzer, personen (81 personenFuerZeiterfassung), personalZugang,
//      zuordnungen, projektNamen, darfBearbeiten, onSpeichern. Out: the list.

import React, { useState } from "react";
import { Link } from "react-router-dom";
import { UserPlus } from "lucide-react";
import FormModal from "@core/components/common/FormModal";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import { useI18n } from "@core/lib/i18n";
import { useBestaetigung } from "@core/lib/useBestaetigung";
import { letzterInhaberGeschuetzt, ROLLEN, ROLLEN_LABELS } from "@core/lib/rechte.js";
import { bauePersonalLink } from "@/lib/people/personalLink.js";
import { personAnzeigeName } from "@/lib/zeit/personalQuelle.js";

/**
 * @param {{
 *   nutzer: Array<Record<string, any>>, personen: Array<Record<string, any>>, personalZugang: boolean,
 *   zuordnungen: Array<{mitarbeiter_id: string, alle: boolean, zuordnungen: Array<{project_id: string, funktion: string|null}>}>,
 *   projektNamen: Map<string, string>, darfBearbeiten: boolean,
 *   onSpeichern: (n: Record<string, any>) => Promise<boolean>,
 * }} props
 * @returns {React.ReactElement}
 */
export default function NutzerListe({ nutzer, personen, personalZugang, zuordnungen, projektNamen, darfBearbeiten, onSpeichern }) {
  const { t } = useI18n();
  const bestaetige = useBestaetigung();
  const [dialog, setDialog] = useState(/** @type {Record<string, any>|null} */ (null));
  const [meldung, setMeldung] = useState("");
  const personName = (/** @type {string|null} */ id) => (id ? personAnzeigeName(personen.find((p) => p.id === id) || { id }, t) : "—");

  /** Saves, unless the change would leave the office without an active owner. */
  const speichern = async (/** @type {Record<string, any>} */ n) => {
    const alt = nutzer.find((x) => x.id === n.id);
    const verliertInhaber = alt && alt.rolle === "inhaber" && (n.rolle !== "inhaber" || n.aktiv === false);
    if (verliertInhaber && letzterInhaberGeschuetzt(nutzer, n.id)) {
      setMeldung(t("Mindestens ein aktiver Inhaber muss bleiben."));
      return false;
    }
    setMeldung("");
    return onSpeichern(n);
  };
  const deaktivieren = async (/** @type {Record<string, any>} */ n) => {
    if (!(await bestaetige({ titel: t("Nutzer deaktivieren?"), text: n.name || n.kuerzel || "", bestaetigen: t("Deaktivieren"), gefahr: true }))) return;
    await speichern({ ...n, aktiv: false });
  };

  return (
    <section className="space-y-2" data-testid="nutzer-liste">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold text-slate-900 dark:text-slate-100">{t("Nutzer")}</h3>
        {darfBearbeiten && <Button type="button" size="sm" onClick={() => setDialog({ name: "", kuerzel: "", email: "", rolle: "mitarbeiter", mitarbeiter_id: null, aktiv: true })}><UserPlus className="h-4 w-4" aria-hidden="true" /> {t("Nutzer anlegen")}</Button>}
      </div>
      {meldung && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300" data-testid="nutzer-meldung">{meldung}</p>}
      {nutzer.length === 0 ? <p className="text-sm text-slate-600 dark:text-slate-300">{t("Noch keine Nutzer — die App arbeitet als Inhaber/in.")}</p> : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
          {nutzer.map((n) => {
            const z = zuordnungen.find((x) => x.mitarbeiter_id === n.mitarbeiter_id);
            const ohneVerknuepfung = (n.rolle === "projektleitung" || n.rolle === "mitarbeiter") && !n.mitarbeiter_id;
            return (
              <li key={n.id} className="space-y-1 px-3 py-2 text-sm" data-testid="nutzer-zeile" data-nutzer={n.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className={n.aktiv === false ? "text-slate-400 line-through" : ""}>
                    <span className="font-medium">{n.name}</span> <span className="text-slate-500">{n.kuerzel}</span> · {t(/** @type {Record<string, string>} */ (ROLLEN_LABELS)[n.rolle] || n.rolle)}
                    {n.email ? <span className="text-slate-500"> · {n.email}</span> : null}
                  </span>
                  {darfBearbeiten && (
                    <span className="flex gap-1">
                      <Button type="button" size="sm" variant="ghost" onClick={() => setDialog(n)} aria-label={`${t("Bearbeiten")}: ${n.name}`}>{t("Bearbeiten")}</Button>
                      {n.aktiv !== false && <Button type="button" size="sm" variant="ghost" onClick={() => deaktivieren(n)} aria-label={`${t("Deaktivieren")}: ${n.name}`}>{t("Deaktivieren")}</Button>}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300">{t("Person")}: {personName(n.mitarbeiter_id)}</p>
                {ohneVerknuepfung && <p className="text-xs text-amber-800 dark:text-amber-200">{t("Ohne verknüpfte Person sieht diese Rolle keine Projekte.")}</p>}
                {n.mitarbeiter_id && n.mitarbeiter_id !== "inhaber" && (
                  personalZugang ? (
                    <p className="text-xs text-slate-600 dark:text-slate-300" data-testid="nutzer-zuordnung">
                      {t("Projekte")}: {!z || z.alle ? t("alle Projekte (keine Zuordnung)") : z.zuordnungen.map((x) => `${projektNamen.get(x.project_id) || x.project_id}${x.funktion ? ` (${x.funktion})` : ""}`).join(", ") || "—"}
                      {" · "}
                      <Link className="underline" to={`/People${bauePersonalLink({ tab: "staff", mitarbeiter: n.mitarbeiter_id })}`}>{t("Projektzuordnung bearbeiten")}</Link>
                    </p>
                  ) : <p className="text-xs text-slate-500">{t("Projektzuordnungen pflegt, wer Personal verwalten darf.")}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {dialog && <NutzerDialog nutzer={dialog} personen={personen} onClose={() => setDialog(null)} onSpeichern={async (n) => { if (await speichern(n)) setDialog(null); }} />}
    </section>
  );
}

/**
 * @param {{nutzer: Record<string, any>, personen: Array<Record<string, any>>, onClose: () => void, onSpeichern: (n: Record<string, any>) => Promise<void>}} props
 * @returns {React.ReactElement}
 */
function NutzerDialog({ nutzer, personen, onClose, onSpeichern }) {
  const { t } = useI18n();
  const [f, setF] = useState(nutzer);
  const setze = (/** @type {string} */ k, /** @type {any} */ v) => setF((x) => ({ ...x, [k]: v }));
  const feld = "block text-xs text-slate-600 dark:text-slate-300";
  const auswahl = "mt-1 h-9 w-full rounded border border-slate-300 bg-white px-2 dark:border-slate-600 dark:bg-slate-900";
  return (
    <FormModal title={nutzer.id ? t("Nutzer bearbeiten") : t("Nutzer anlegen")} onClose={onClose} schuetzen>
      <div className="space-y-3 text-sm" data-testid="nutzer-dialog">
        <div className="grid gap-2 sm:grid-cols-2">
          <label className={feld}>{t("Name")}<Input value={f.name || ""} onChange={(e) => setze("name", e.target.value)} /></label>
          <label className={feld}>{t("Kürzel")}<Input value={f.kuerzel || ""} onChange={(e) => setze("kuerzel", e.target.value)} /></label>
        </div>
        <label className={feld}>{t("E-Mail")}<Input type="email" value={f.email || ""} onChange={(e) => setze("email", e.target.value)} /></label>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className={feld}>{t("Rolle")}
            <select className={auswahl} value={f.rolle} onChange={(e) => setze("rolle", e.target.value)} data-testid="nutzer-rolle">
              {ROLLEN.map((r) => <option key={r} value={r}>{t(ROLLEN_LABELS[r])}</option>)}
            </select>
          </label>
          <label className={feld}>{t("Person")}
            <select className={auswahl} value={f.mitarbeiter_id || ""} onChange={(e) => setze("mitarbeiter_id", e.target.value || null)}>
              <option value="">—</option>
              {personen.map((p) => <option key={p.id} value={p.id}>{personAnzeigeName(p, t)}</option>)}
            </select>
          </label>
        </div>
        <label className="inline-flex items-center gap-2"><input type="checkbox" checked={f.aktiv !== false} onChange={(e) => setze("aktiv", e.target.checked)} /> {t("aktiv")}</label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>{t("Abbrechen")}</Button>
          <Button type="button" disabled={!String(f.name || "").trim()} onClick={() => onSpeichern(f)} data-testid="nutzer-speichern">{t("Speichern")}</Button>
        </div>
      </div>
    </FormModal>
  );
}
