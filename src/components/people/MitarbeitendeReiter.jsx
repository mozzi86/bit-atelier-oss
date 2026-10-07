// Personnel tab "Mitarbeitende" (key `staff`) — Plan 80-04, Task 6: Tabelle,
// Suche, Formular (?neu=1 bzw. Bearbeiten), Detail (?mitarbeiter=<id>).
//
// URL-Vertrag nur über personalLink.js (DS-07, opake IDs). Der erste Zugriff
// auf die Personal-Daten wartet über usePersonalDaten() auf die geladene
// Projektliste (BEFUNDE-79 H-4).
//
// In:  props {kontext?: {datenquelle?, personalZugang?}} (Vertrag aus
//      80-01, hier ungenutzt — Zugang ist auf /People-Ebene schon geprüft).
// Out: BEREIT = true, die Komponente.

import React from "react";
import { useSearchParams } from "react-router-dom";
import { useI18n } from "@core/lib/i18n";
import { bitApi } from "@core/api/bitApi";
import { useRegelWerte } from "@core/lib/useRegelWerte";
import LoadingState from "@core/components/common/LoadingState";
import { REGELWERKE } from "@/lib/settings/regelwerke.js";
import { lesePersonalLink, entfernePersonalParameter } from "@/lib/people/personalLink.js";
import { usePersonalDaten } from "./usePersonalDaten.js";
import MitarbeiterTabelle from "./MitarbeiterTabelle.jsx";
import MitarbeiterFormular from "./MitarbeiterFormular.jsx";
import MitarbeiterDetail from "./MitarbeiterDetail.jsx";

/** Whether /People offers this tab. */
export const BEREIT = true;

/**
 * @returns {React.ReactElement}
 */
export default function MitarbeitendeReiter() {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const link = lesePersonalLink(searchParams);
  const { daten, gesellschafter79, laden, fehler, neuLaden } = usePersonalDaten();
  const { wert } = useRegelWerte(REGELWERKE);
  const [projekte, setProjekte] = React.useState(/** @type {Array<{id: string, name?: string}>} */ ([]));
  const [formularFuer, setFormularFuer] = React.useState(/** @type {'neu'|object|null} */ (null));

  const einst = { rechtsform: wert("buchhaltung.rechtsform"), gewst_aktiv: wert("buchhaltung.gewst_aktiv") };

  React.useEffect(() => {
    let aktiv = true;
    /** @type {any} */ (bitApi.entities).Project.list()
      .then((rows) => { if (aktiv) setProjekte(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (aktiv) setProjekte([]); });
    return () => { aktiv = false; };
  }, []);

  // ?neu=1 öffnet das Formular einmal je Linkwechsel (Kopfknopf/Palette der Seite).
  React.useEffect(() => {
    if (link.neu) setFormularFuer("neu");
  }, [link.neu]);

  const formularSchliessen = React.useCallback(() => {
    setFormularFuer(null);
    if (link.neu) setSearchParams(entfernePersonalParameter(searchParams, ["neu"]), { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- searchParams ändert sich mit jeder Navigation; nur auf link.neu reagieren
  }, [link.neu]);

  const detailSchliessen = () => setSearchParams(entfernePersonalParameter(searchParams, ["mitarbeiter"]), { replace: true });

  if (fehler) {
    return <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-100">{fehler}</div>;
  }
  if (laden) {
    return <LoadingState variant="cards" rows={3} />;
  }

  if (link.mitarbeiter) {
    const gefunden = daten.Mitarbeiter.find((m) => m.id === link.mitarbeiter) ?? null;
    return (
      <>
        <MitarbeiterDetail mitarbeiter={gefunden} projekte={projekte} onSchliessen={detailSchliessen} onBearbeiten={(m) => setFormularFuer(m)} />
        {formularFuer && (
          <MitarbeiterFormular
            mitarbeiter={formularFuer === "neu" ? null : formularFuer}
            mitarbeiterListe={daten.Mitarbeiter}
            gesellschafter79={gesellschafter79}
            einst={einst}
            onClose={formularSchliessen}
          />
        )}
      </>
    );
  }

  return (
    <div>
      <MitarbeiterTabelle
        mitarbeiterListe={daten.Mitarbeiter}
        vertraege={daten.Arbeitsvertrag}
        gehaltsaenderungen={daten.Gehaltsaenderung}
        vorgaenge={daten.Personalvorgang}
        dokumente={daten.Personaldokument}
        onBearbeiten={(m) => setFormularFuer(m)}
        neuLaden={neuLaden}
      />
      {formularFuer && (
        <MitarbeiterFormular
          mitarbeiter={formularFuer === "neu" ? null : formularFuer}
          mitarbeiterListe={daten.Mitarbeiter}
          gesellschafter79={gesellschafter79}
          einst={einst}
          onClose={formularSchliessen}
          onGespeichert={() => neuLaden()}
        />
      )}
      {daten.Mitarbeiter.length === 0 && (
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">{t("Noch keine Mitarbeitenden angelegt.")}</p>
      )}
    </div>
  );
}
