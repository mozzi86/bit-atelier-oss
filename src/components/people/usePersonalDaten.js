// usePersonalDaten.js — lädt alle neun Personal-Sammlungen über bitApi.personal
// (80-02) parallel, dazu — nur lesend, für Mitarbeiter.gesellschafter_id — die
// 79-Entität Gesellschafter. (Plan 80-04, Task 5)
//
// Der ERSTE Zugriff wartet, bis useProject().loading === false ist (Abgleich
// 28.09., BEFUNDE-79 H-4: der Versionssprung der zehn Personal-Stores in einem
// Sprung schließt jede offene IndexedDB-Verbindung; eine gleichzeitig ladende
// Projektliste scheiterte sonst mit „The database connection is closing“ —
// dasselbe Muster wie src/components/accounting/useBuchhaltung.js:55-95). Hört
// danach auf "personal:gespeichert" (personalDb.js) und lädt neu.
//
// In:  nichts (liest @core/api/bitApi, @core/api/personalEntitaeten,
//      @core/lib/ProjectContext). Out: usePersonalDaten() →
//      {daten, gesellschafter79, laden, fehler, neuLaden}.

import { useCallback, useEffect, useRef, useState } from "react";
import { bitApi } from "@core/api/bitApi";
import { useProject } from "@core/lib/ProjectContext";
import { PERSONAL_ENTITAETEN } from "@core/api/personalEntitaeten.js";

/** @param {unknown} fehler @returns {string} */
const text = (fehler) => /** @type {any} */ (fehler)?.message || String(fehler);

/** @returns {Record<string, object[]>} alle neun Sammlungen leer */
function leereDaten() {
  /** @type {Record<string, object[]>} */
  const aus = {};
  for (const e of PERSONAL_ENTITAETEN) aus[e] = [];
  return aus;
}

/**
 * @typedef {{
 *   daten: Record<string, object[]>,
 *   gesellschafter79: object[],
 *   laden: boolean,
 *   fehler: string|null,
 *   neuLaden: () => Promise<void>,
 * }} PersonalDatenZustand
 */

/**
 * Lädt Mitarbeiter, Arbeitsvertrag, Gehaltsaenderung, Stelle, Bewerbung,
 * Personalvorgang, Personaldokument, Fristquittung, Loeschprotokoll sowie
 * (nur lesend) die 79-Gesellschafter. Ein Fehler wird sichtbar gezeigt, nicht
 * verschluckt; SpeicherVollError bekommt einen eigenen Text.
 * @returns {PersonalDatenZustand}
 */
export function usePersonalDaten() {
  const { loading: projekteLaden } = useProject();
  const [zustand, setZustand] = useState(
    /** @type {{laden: boolean, fehler: string|null, daten: Record<string, object[]>, gesellschafter79: object[]}} */
    ({ laden: true, fehler: null, daten: leereDaten(), gesellschafter79: [] }),
  );
  const aktiv = useRef(true);

  const neuLaden = useCallback(async () => {
    try {
      const [listen, gesellschafter79] = await Promise.all([
        Promise.all(PERSONAL_ENTITAETEN.map((e) => /** @type {any} */ (bitApi.personal)[e].list())),
        // 79 sät Gesellschafter erst beim ersten Besuch von /Accounting (Abgleich
        // 28.09.) — fehlt der Store noch, gilt das hier als "keine Datensätze",
        // nicht als Fehler (das Formular von 80-04 zeigt dafür einen eigenen Hinweis).
        /** @type {any} */ (bitApi.entities).Gesellschafter.list().catch(() => []),
      ]);
      if (!aktiv.current) return;
      /** @type {Record<string, object[]>} */
      const daten = {};
      PERSONAL_ENTITAETEN.forEach((e, i) => { daten[e] = Array.isArray(listen[i]) ? listen[i] : []; });
      setZustand({ laden: false, fehler: null, daten, gesellschafter79: Array.isArray(gesellschafter79) ? gesellschafter79 : [] });
    } catch (fehler) {
      if (!aktiv.current) return;
      const nachricht = /** @type {any} */ (fehler)?.name === "SpeicherVollError"
        ? "Der Browser-Speicher ist voll — Personaldaten konnten nicht geladen werden."
        : `Personal konnte nicht geladen werden: ${text(fehler)}`;
      setZustand((z) => ({ ...z, laden: false, fehler: nachricht }));
    }
  }, []);

  useEffect(() => {
    aktiv.current = true;
    if (projekteLaden) return undefined; // erster Zugriff wartet auf die geladene Projektliste (BEFUNDE-79 H-4)
    neuLaden();
    const beiSpeichern = () => { neuLaden(); };
    window.addEventListener("personal:gespeichert", beiSpeichern);
    return () => {
      aktiv.current = false;
      window.removeEventListener("personal:gespeichert", beiSpeichern);
    };
  }, [projekteLaden, neuLaden]);

  return { ...zustand, neuLaden };
}
