// PersonAuswahl.jsx — opaker Personen-Auswähler für Formulare außerhalb von
// /People (Plan 80-10, Task 7b, Spur B): heute die Fahrt-Erfassung (79-08).
// Gibt dem Aufrufer NUR die opake ID zurück (onChange(id|null)) — nie einen
// Namen — und lädt Namen ausschließlich zur eigenen Anzeige in der Auswahl-
// liste selbst, per dynamischem Import (derselbe Leck-Wächter-Grund wie
// usePersonalkostenPlan.js: eine 79-Datei, die dieses Feld einbindet, zieht so
// keinen Personal-Code statisch mit). Rendert NICHTS ohne Personal-Zugang —
// das aufrufende Formular behält dann nur sein freies Textfeld.
//
// In:  {value, onChange, mitarbeiterId?}. Out: UI, ruft onChange(id|null).

import React from "react";
import { useI18n } from "@core/lib/i18n";
import { useAuth } from "@core/lib/AuthContext";
import { useProject } from "@core/lib/ProjectContext";
import { DATENQUELLE } from "@core/lib/umgebung";
import { personalZugang } from "@/lib/people/zugang.js";
import { anzeigeName } from "@/lib/people/mitarbeiter.js";

const FELD = "h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-slate-600 dark:bg-slate-900";
const LABEL = "text-sm font-medium text-slate-700 dark:text-slate-200";

/**
 * @param {{value: string|null|undefined, onChange: (id: string|null) => void, id?: string}} props
 * @returns {React.ReactElement|null}
 */
export default function PersonAuswahl({ value, onChange, id = "person-auswahl" }) {
  const { t } = useI18n();
  const { user } = useAuth();
  // BEFUNDE-79 H-4 (s. usePersonalkostenPlan.js): denselben Zugriff abwarten,
  // bis die Projektliste fertig geladen hat.
  const { loading: projekteLaden } = useProject();
  const zugang = personalZugang({ datenquelle: DATENQUELLE, rolle: user?.role });
  const [mitarbeiterListe, setMitarbeiterListe] = React.useState(/** @type {object[]} */ ([]));
  const [laden, setLaden] = React.useState(true);

  React.useEffect(() => {
    let aktiv = true;
    if (zugang !== "erlaubt") { setLaden(false); return undefined; }
    if (projekteLaden) return undefined;
    (async () => {
      const { bitApi } = await import("@core/api/bitApi.js");
      const alle = await /** @type {any} */ (bitApi).personal.Mitarbeiter.list();
      if (!aktiv) return;
      setMitarbeiterListe((Array.isArray(alle) ? alle : []).filter((m) => m?.status === "aktiv"));
      setLaden(false);
    })().catch(() => { if (aktiv) setLaden(false); });
    return () => { aktiv = false; };
  }, [zugang, projekteLaden]);

  if (zugang !== "erlaubt") return null;

  return (
    <div className="space-y-1">
      <label htmlFor={id} className={LABEL}>{t("Person (Personal)")}</label>
      <select id={id} disabled={laden} className={FELD} value={value || ""} data-testid="person-auswahl"
        onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{t("— nicht zugeordnet —")}</option>
        {mitarbeiterListe.map((m) => (
          <option key={/** @type {any} */ (m).id} value={/** @type {any} */ (m).id}>{anzeigeName(/** @type {any} */ (m))}</option>
        ))}
      </select>
    </div>
  );
}
