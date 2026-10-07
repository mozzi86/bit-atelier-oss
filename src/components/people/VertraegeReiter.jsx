// Personnel tab "Verträge" (key `contracts`) — Plan 80-06: Tabelle aller
// Arbeitsverträge, "Vertrag anlegen" (Kopf-Palette über useAktionen),
// "Neuer Vertrag (ersetzt den bisherigen)" statt Überschreiben. Auswahl über
// `?vertrag=<id>` (die Zeile wird hervorgehoben und fokussiert, Behavior 16).
//
// In:  props {kontext?: {datenquelle?, personalZugang?}} (Zugang ist
//      auf /People-Ebene bereits geprüft).
// Out: BEREIT = true, die Komponente.

import React from "react";
import { useSearchParams } from "react-router-dom";
import { useI18n } from "@core/lib/i18n";
import { useRegelWerte } from "@core/lib/useRegelWerte";
import { heuteLokal } from "@core/lib/kalender/datum.js";
import LoadingState from "@core/components/common/LoadingState";
import { useAktionen } from "@core/lib/aktionen";
import { REGELWERKE } from "@/lib/settings/regelwerke.js";
import { lesePersonalLink, entfernePersonalParameter } from "@/lib/people/personalLink.js";
import { personalFristen } from "@/lib/people/fristen.js";
import { usePersonalDaten } from "./usePersonalDaten.js";
import VertragsTabelle from "./VertragsTabelle.jsx";
import VertragsFormular from "./VertragsFormular.jsx";

/** Whether /People offers this tab. */
export const BEREIT = true;

/**
 * Entwurf zum Ersetzen eines vorhandenen (unterschriebenen/gekündigten)
 * Vertrags: eine Kopie OHNE `id`, mit `ersetzt_vertrag_id` und ohne
 * Unterschrift/Nachweis-Daten (die gehören zum NEUEN Vertrag, nicht zum alten).
 * @param {object} alter der zu ersetzende Vertrag
 * @returns {object}
 */
function ersatzEntwurf(alter) {
  const kopie = structuredClone(alter);
  delete kopie.id;
  delete kopie.created_date;
  delete kopie.updated_date;
  kopie.status = "entwurf";
  kopie.ersetzt_vertrag_id = alter.id;
  kopie.unterschrieben_am = "";
  kopie.nachweis_ausgehaendigt_am = "";
  return kopie;
}

/**
 * @returns {React.ReactElement}
 */
export default function VertraegeReiter() {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const link = lesePersonalLink(searchParams);
  const { daten, laden, fehler, neuLaden } = usePersonalDaten();
  const { wert } = useRegelWerte(REGELWERKE);
  const [formularFuer, setFormularFuer] = React.useState(/** @type {'neu'|object|null} */ (null));

  React.useEffect(() => {
    if (link.neu) setFormularFuer("neu");
  }, [link.neu]);

  const formularSchliessen = React.useCallback(() => {
    setFormularFuer(null);
    if (link.neu) setSearchParams(entfernePersonalParameter(searchParams, ["neu"]), { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- searchParams ändert sich mit jeder Navigation; nur auf link.neu reagieren
  }, [link.neu]);

  const neuenVertragOeffnen = React.useCallback(() => setFormularFuer("neu"), []);
  const aktionen = React.useMemo(
    () => [{ id: "vertrag-anlegen", titel: t("Vertrag anlegen"), beschreibung: t("Neuen Arbeitsvertrag erfassen"), aktiv: true, ausfuehren: neuenVertragOeffnen }],
    [t, neuenVertragOeffnen],
  );
  useAktionen("/People", aktionen);

  if (fehler) {
    return <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-100">{fehler}</div>;
  }
  if (laden) {
    return <LoadingState variant="cards" rows={3} />;
  }

  const heute = heuteLokal();
  const faellig = personalFristen(daten, heute, wert);

  return (
    <div>
      <VertragsTabelle
        vertraege={daten.Arbeitsvertrag}
        mitarbeiterListe={daten.Mitarbeiter}
        gehaelter={daten.Gehaltsaenderung}
        faellig={faellig}
        hervorhebenId={link.vertrag}
        onBearbeiten={(v) => setFormularFuer(v)}
        onErsetzen={(v) => setFormularFuer(ersatzEntwurf(v))}
      />
      {formularFuer && (
        <VertragsFormular
          vertrag={formularFuer === "neu" ? null : formularFuer}
          mitarbeiterListe={daten.Mitarbeiter}
          vertraege={daten.Arbeitsvertrag}
          gehaelter={daten.Gehaltsaenderung}
          dokumente={daten.Personaldokument}
          onDokumenteGespeichert={neuLaden}
          regelWert={wert}
          onClose={formularSchliessen}
          onGespeichert={() => neuLaden()}
        />
      )}
      {daten.Arbeitsvertrag.length === 0 && (
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">{t("Noch keine Verträge erfasst.")}</p>
      )}
    </div>
  );
}
