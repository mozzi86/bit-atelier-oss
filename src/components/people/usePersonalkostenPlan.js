// usePersonalkostenPlan.js — "Personal (Plan)" für die Jahresuhr (Plan 80-10,
// Task 7b, Spur B): die 12 Monatswerte des angezeigten Jahres als
// zusatzAbfluesse-Einträge (liquiditaet.js Kontext-Feld, additiv seit 80-10),
// NUR mit Personal-Zugang — sonst `[]`.
//
// Lädt bitApi.personal per DYNAMISCHEM Import, absichtlich: LiquiditaetReiter.jsx
// und LageLeiste.jsx (79, Spur A) rufen nur diesen Hook auf und erwähnen
// bitApi.personal/PERSONAL_ENTITAETEN/personalDatei selbst nirgends — der
// Leck-Wächter (personalLeck.test.js) bleibt für sie unverändert, und ein
// Mitglied ohne Personal-Zugang zieht keinen Personal-Code in den
// Accounting-Chunk.
//
// In:  jahr (number, das angezeigte Jahr der Jahresuhr), warten (boolean —
//      vom Aufrufer übergeben, s. u.). Out: {zusatzAbfluesse, laden}.

import { useEffect, useState } from "react";
import { useAuth } from "@core/lib/AuthContext";
import { useProject } from "@core/lib/ProjectContext";
import { DATENQUELLE } from "@core/lib/umgebung";
import { useRegelWerte } from "@core/lib/useRegelWerte";
import { REGELWERKE } from "@/lib/settings/regelwerke.js";
import { personalZugang } from "@/lib/people/zugang.js";
import { personalkostenMonat } from "@/lib/people/kosten.js";

/**
 * BEFUNDE-79 H-4, zweiter Fall (über die Projektliste hinaus): `bereit()`
 * dieses Hooks bumpt die IndexedDB-Version über ALLE zehn Personal-Stores in
 * einem Sprung — 79s EIGENE Erstbefüllung (useBuchhaltung.js, "bis zu 14
 * Stores in einem Sprung") tut auf /Accounting GENAU DASSELBE, ausgelöst vom
 * SELBEN Signal (die geladene Projektliste). Zwei Versionssprünge zur selben
 * Zeit lassen den JEWEILS ANDEREN mit "The database connection is closing"
 * scheitern — ein Muster, das die "IndexedDB blockiert"-Wiederholung in
 * personalDb.js/speicher.js NICHT abfängt (andere Fehlermeldung). Deshalb
 * reicht "Projektliste fertig" hier nicht: der Aufrufer (LiquiditaetReiter.jsx/
 * LageLeiste.jsx) übergibt zusätzlich `!bh.laedt` — 79s eigene Erstbefüllung
 * UND ihr erster Ladevorgang sind dann bereits abgeschlossen, kein zweiter
 * Versionssprung mehr in der Schwebe.
 * @param {number} jahr
 * @param {{warten?: boolean}} [optionen] warten: true hält den Hook zurück (Standard false = sofort versuchen, für Aufrufer ohne eigenes Bereit-Signal)
 * @returns {{zusatzAbfluesse: Array<{monat: string, betragCent: number, art: 'personal_plan'}>, laden: boolean}}
 */
export function usePersonalkostenPlan(jahr, { warten = false } = {}) {
  const { user } = useAuth();
  const { loading: projekteLaden } = useProject();
  const zugang = personalZugang({ datenquelle: DATENQUELLE, rolle: user?.role });
  const { wert: regelWert, laden: regelnLaden } = useRegelWerte(REGELWERKE);
  const [daten, setDaten] = useState(/** @type {Record<string, object[]>|null} */ (null));
  const [ladenIntern, setLadenIntern] = useState(true);

  useEffect(() => {
    let aktiv = true;
    if (zugang !== "erlaubt") {
      setDaten(null);
      setLadenIntern(false);
      return undefined;
    }
    if (projekteLaden || warten) return undefined; // s. Dateikopf: zwei gleichzeitige Versionssprünge vermeiden
    // Every personal write refetches (same contract as usePersonalDaten.js).
    // The previous values stay visible until the new ones arrive, and only
    // the latest run may set state — two quick writes can resolve out of order.
    let lauf = 0;
    const laden = async () => {
      const dieserLauf = ++lauf;
      try {
        const { bitApi } = await import("@core/api/bitApi.js");
        const api = /** @type {any} */ (bitApi).personal;
        const [mitarbeiter, vertraege, gehaelter] = await Promise.all([
          api.Mitarbeiter.list(), api.Arbeitsvertrag.list(), api.Gehaltsaenderung.list(),
        ]);
        if (!aktiv || dieserLauf !== lauf) return;
        setDaten({ Mitarbeiter: mitarbeiter, Arbeitsvertrag: vertraege, Gehaltsaenderung: gehaelter });
        setLadenIntern(false);
      } catch {
        if (aktiv && dieserLauf === lauf) { setDaten(null); setLadenIntern(false); }
      }
    };
    setLadenIntern(true);
    laden();
    const beiSpeichern = () => { laden(); };
    window.addEventListener("personal:gespeichert", beiSpeichern);
    return () => { aktiv = false; window.removeEventListener("personal:gespeichert", beiSpeichern); };
  }, [zugang, jahr, projekteLaden, warten]);

  if (zugang !== "erlaubt" || !daten || ladenIntern || regelnLaden || warten) {
    return { zusatzAbfluesse: [], laden: zugang === "erlaubt" && (ladenIntern || regelnLaden || warten) };
  }

  /** @type {Array<{monat: string, betragCent: number, art: 'personal_plan'}>} */
  const zusatzAbfluesse = [];
  for (let m = 1; m <= 12; m++) {
    const jahrMonat = `${jahr}-${String(m).padStart(2, "0")}`;
    const { summe_ag_eur } = personalkostenMonat(jahrMonat, daten, regelWert);
    if (summe_ag_eur > 0) zusatzAbfluesse.push({ monat: jahrMonat, betragCent: Math.round(summe_ag_eur * 100), art: "personal_plan" });
  }
  return { zusatzAbfluesse, laden: false };
}
