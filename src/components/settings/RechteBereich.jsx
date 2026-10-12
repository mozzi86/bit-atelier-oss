// Settings area "Nutzer & Rechte" (key `access`, phase 82, 82-02): the honesty
// block (always first), the users with their role, linked person and read-only
// project assignments, and the rights matrix (only deviations stored in the
// Setting `rechte`). Users go through the office store (E-03), the persons for
// the link through 81's adapter ladePersonalFuerZeit — without personnel access
// the list stays empty with a hint. After a change the access provider reloads.
//
// In:  props kontext (Settings page). Out: BEREIT, the area.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { bitApi } from "@core/api/bitApi";
import { useI18n } from "@core/lib/i18n";
import { mitRueckmeldung } from "@core/lib/mitRueckmeldung.js";
import { useProject } from "@core/lib/ProjectContext";
import { RECHTE_STANDARD } from "@core/lib/rechte.js";
import { DATENQUELLE } from "@core/lib/umgebung";
import { useEinstellung } from "@core/lib/useEinstellung.js";
import { BUERO_ORGA_EREIGNIS, useZugriff } from "@core/lib/ZugriffContext.jsx";
import { useAuth } from "@core/lib/AuthContext";
import { bueroEntitaet, speichereBuero, verfuegbar } from "@/lib/bueroOrga/speicher.js";
import { RECHTE_SETTING_KEY } from "@/lib/bueroOrga/entitaeten.js";
import { ladePersonalFuerZeit } from "@/lib/people/zeitHonorarPersonal.js";
import { personenFuerZeiterfassung } from "@/lib/zeit/personalQuelle.js";
import EhrlichkeitsBlock from "@/components/rechte/EhrlichkeitsBlock.jsx";
import NutzerListe from "@/components/rechte/NutzerListe.jsx";
import RechteMatrix from "@/components/rechte/RechteMatrix.jsx";

/** Ready since 82-02. */
export const BEREIT = true;

/** @returns {React.ReactElement} */
export default function RechteBereich() {
  const { t } = useI18n();
  const zugriff = useZugriff();
  const { user } = useAuth();
  const ctx = /** @type {any} */ (useProject());
  const [rechte, setRechte] = useEinstellung(RECHTE_SETTING_KEY, RECHTE_STANDARD);
  const [nutzer, setNutzer] = useState(/** @type {Array<Record<string, any>>} */ ([]));
  const [personen, setPersonen] = useState(/** @type {Array<Record<string, any>>} */ ([]));
  const [personalZugang, setPersonalZugang] = useState(false);
  const [fehler, setFehler] = useState("");
  const darfBearbeiten = zugriff.darf("rechte", "voll");
  const heute = new Date().toISOString().slice(0, 10);

  const laden = useCallback(async () => {
    try {
      const liste = verfuegbar(DATENQUELLE) ? await bueroEntitaet(bitApi, "Nutzer", { datenquelle: DATENQUELLE }).list() : [];
      setNutzer(Array.isArray(liste) ? liste : []);
      const pz = await ladePersonalFuerZeit({ datenquelle: DATENQUELLE, rolle: user?.role ?? null });
      setPersonalZugang(pz.zugang === "erlaubt");
      setPersonen(personenFuerZeiterfassung(pz.mitarbeiter || [], heute));
      setFehler("");
    } catch (e) {
      setFehler(/** @type {any} */ (e)?.message || String(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role]);
  useEffect(() => { laden(); }, [laden]);

  const projektNamen = useMemo(() => new Map((ctx.alleProjekte ?? ctx.projects ?? []).map((/** @type {any} */ p) => [p.id, p.name || p.id])), [ctx.alleProjekte, ctx.projects]);
  const nutzerSpeichern = async (/** @type {Record<string, any>} */ n) => {
    const r = await mitRueckmeldung(() => speichereBuero(bitApi, "Nutzer", n, { datenquelle: DATENQUELLE }), { erfolg: t("Nutzer gespeichert"), fehler: t("Speichern fehlgeschlagen") });
    if (!r.ok) return false;
    await laden();
    window.dispatchEvent(new CustomEvent(BUERO_ORGA_EREIGNIS));
    return true;
  };
  const rechteSpeichern = async (/** @type {Record<string, any>} */ wert) => {
    const r = await mitRueckmeldung(() => setRechte(wert), { erfolg: t("Rechte gespeichert"), fehler: t("Speichern fehlgeschlagen") });
    return r.ok;
  };

  return (
    <div className="space-y-4" data-testid="rechte-bereich">
      <EhrlichkeitsBlock />
      {fehler && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{fehler}</p>}
      <NutzerListe nutzer={nutzer} personen={personen} personalZugang={personalZugang} zuordnungen={zugriff.zuordnungen || []}
        projektNamen={projektNamen} darfBearbeiten={darfBearbeiten} onSpeichern={nutzerSpeichern} />
      <RechteMatrix einstellung={rechte} darfBearbeiten={darfBearbeiten} onSpeichern={rechteSpeichern} />
    </div>
  );
}
