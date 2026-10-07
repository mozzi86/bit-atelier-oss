// Personnel tab "Mitarbeitersuche" (key `recruiting`) — Plan 80-08: Stellen
// und Bewerbungen. Segment "Stellen" | "Bewerbungen" (aria-pressed), Kopf-
// aktionen "Neue Stelle"/"Bewerbung erfassen" (useAktionen), Auswahl über
// ?stelle=/?bewerbung= (DS-07, opake IDs, personalLink.js).
//
// In:  props {kontext?: {datenquelle?, personalZugang?}} (Zugang ist
//      auf /People-Ebene bereits geprüft).
// Out: BEREIT = true, die Komponente.

import React from "react";
import { useSearchParams } from "react-router-dom";
import { useI18n } from "@core/lib/i18n";
import { bitApi } from "@core/api/bitApi";
import { useRegelWerte } from "@core/lib/useRegelWerte";
import { heuteLokal } from "@core/lib/kalender/datum.js";
import LoadingState from "@core/components/common/LoadingState";
import { useAktionen } from "@core/lib/aktionen";
import { REGELWERKE } from "@/lib/settings/regelwerke.js";
import { lesePersonalLink, entfernePersonalParameter } from "@/lib/people/personalLink.js";
import { usePersonalDaten } from "./usePersonalDaten.js";
import StellenListe from "./StellenListe.jsx";
import StellenFormular, { AnzeigentextDialog } from "./StellenFormular.jsx";
import BewerbungsPipeline from "./BewerbungsPipeline.jsx";
import BewerbungFormular from "./BewerbungFormular.jsx";

/** Whether /People offers this tab. */
export const BEREIT = true;

// "Stellen" allein kollidiert mit buchhaltung-rechnungen.js ("Stellen" im
// Sinn von "Rechnung stellen" = "Issue") — eigene, nicht kollidierende
// Beschriftung für dieses Segment (derselbe Kniff wie "Vertragsentwurf" statt
// "Entwurf" in personal-vertraege.js).
const SEGMENTE = Object.freeze([
  { key: "stellen", label: "Stellenangebote" },
  { key: "bewerbungen", label: "Bewerbungen" },
]);

/**
 * @returns {React.ReactElement}
 */
export default function SucheReiter() {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const link = lesePersonalLink(searchParams);
  const { daten, laden, fehler, neuLaden } = usePersonalDaten();
  const { wert } = useRegelWerte(REGELWERKE);
  const heute = heuteLokal();

  const [segment, setSegment] = React.useState(/** @type {string} */ ("stellen"));
  const [stelleFormularFuer, setStelleFormularFuer] = React.useState(/** @type {'neu'|object|null} */ (null));
  const [anzeigentextFuer, setAnzeigentextFuer] = React.useState(/** @type {object|null} */ (null));
  const [bewerbungFormularFuer, setBewerbungFormularFuer] = React.useState(/** @type {'neu'|object|null} */ (null));
  const [briefkopf, setBriefkopf] = React.useState(/** @type {object|null} */ (null));

  React.useEffect(() => {
    let aktiv = true;
    // Gleiche Quelle wie src/Layout.jsx/src/pages/Reports.jsx: Setting{key:"briefkopf"}.
    /** @type {any} */ (bitApi).entities.Setting.filter({ key: "briefkopf" })
      .then((zeilen) => { if (aktiv && zeilen[0]) setBriefkopf(zeilen[0].value || null); })
      .catch(() => { if (aktiv) setBriefkopf(null); });
    return () => { aktiv = false; };
  }, []);

  // ?bewerbung=<id> (z. B. aus der Fristenleiste) öffnet die Bewerbung direkt
  // und springt ins Segment "Bewerbungen". Hängt auch an `laden`/`daten.Bewerbung`,
  // nicht nur an `link.bewerbung` — bei einem frischen Seitenaufruf (direkter
  // Link, kein SPA-Wechsel) ist usePersonalDaten beim ersten Render noch am
  // Laden; ohne diese zweite Abhängigkeit bliebe der Effekt einmalig leer.
  React.useEffect(() => {
    if (!link.bewerbung || laden) return;
    const gefunden = daten.Bewerbung.find((b) => b.id === link.bewerbung);
    if (gefunden) { setSegment("bewerbungen"); setBewerbungFormularFuer(gefunden); }
  }, [link.bewerbung, laden, daten.Bewerbung]);

  // ?stelle=<id> springt ins Segment "Stellen" und hebt die Zeile hervor
  // (StellenListe übernimmt das Scrollen/Hervorheben selbst).
  React.useEffect(() => {
    if (link.stelle) setSegment("stellen");
  }, [link.stelle]);

  const neueStelleOeffnen = React.useCallback(() => { setSegment("stellen"); setStelleFormularFuer("neu"); }, []);
  const neueBewerbungOeffnen = React.useCallback(() => { setSegment("bewerbungen"); setBewerbungFormularFuer("neu"); }, []);
  const aktionen = React.useMemo(() => [
    { id: "stelle-anlegen", titel: t("Neue Stelle"), beschreibung: t("Neue Stelle erfassen"), aktiv: true, ausfuehren: neueStelleOeffnen },
    { id: "bewerbung-erfassen", titel: t("Bewerbung erfassen"), beschreibung: t("Neue Bewerbung erfassen"), aktiv: true, ausfuehren: neueBewerbungOeffnen },
  ], [t, neueStelleOeffnen, neueBewerbungOeffnen]);
  useAktionen("/People", aktionen);

  const bewerbungFormularSchliessen = React.useCallback(() => {
    setBewerbungFormularFuer(null);
    if (link.bewerbung) setSearchParams(entfernePersonalParameter(searchParams, ["bewerbung"]), { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- searchParams ändert sich mit jeder Navigation; nur auf link.bewerbung reagieren
  }, [link.bewerbung]);
  const stelleSchliessen = React.useCallback(() => {
    setStelleFormularFuer(null);
    if (link.stelle) setSearchParams(entfernePersonalParameter(searchParams, ["stelle"]), { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- searchParams ändert sich mit jeder Navigation; nur auf link.stelle reagieren
  }, [link.stelle]);

  if (fehler) {
    return <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-100">{fehler}</div>;
  }
  if (laden) {
    return <LoadingState variant="cards" rows={3} />;
  }

  return (
    <div data-testid="suche-reiter">
      <div className="mb-3 flex gap-1.5" role="group" aria-label={t("Bereich")}>
        {SEGMENTE.map((s) => (
          <button key={s.key} type="button" aria-pressed={segment === s.key} onClick={() => setSegment(s.key)}
            className={`rounded-md px-3 py-1.5 text-sm ${segment === s.key ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200"}`}>
            {t(s.label)}
          </button>
        ))}
      </div>

      {segment === "stellen" ? (
        <StellenListe
          stellen={daten.Stelle}
          bewerbungen={daten.Bewerbung}
          hervorhebenId={link.stelle}
          onBearbeiten={(s) => setStelleFormularFuer(s)}
          onAnzeigentext={(s) => setAnzeigentextFuer(s)}
          onNeueBewerbung={(s) => setBewerbungFormularFuer({ stelle_id: s.id })}
        />
      ) : (
        <BewerbungsPipeline
          bewerbungen={daten.Bewerbung}
          stellen={daten.Stelle}
          regelWert={wert}
          heute={heute}
          onOeffnen={(b) => setBewerbungFormularFuer(b)}
          onGeaendert={neuLaden}
        />
      )}

      {stelleFormularFuer && (
        <StellenFormular stelle={stelleFormularFuer === "neu" ? null : stelleFormularFuer} onClose={stelleSchliessen} onGespeichert={neuLaden} />
      )}
      {anzeigentextFuer && (
        <AnzeigentextDialog stelle={anzeigentextFuer} briefkopf={briefkopf} onClose={() => setAnzeigentextFuer(null)} />
      )}
      {bewerbungFormularFuer && (
        <BewerbungFormular
          bewerbung={bewerbungFormularFuer === "neu" ? null : bewerbungFormularFuer}
          stellen={daten.Stelle}
          mitarbeiterListe={daten.Mitarbeiter}
          dokumente={daten.Personaldokument}
          regelWert={wert}
          heute={heute}
          briefkopf={briefkopf}
          onDokumenteGespeichert={neuLaden}
          onClose={bewerbungFormularSchliessen}
          onGespeichert={() => neuLaden()}
        />
      )}
    </div>
  );
}
