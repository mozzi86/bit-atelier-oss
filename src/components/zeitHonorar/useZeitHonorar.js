// Page loader of the three phase-81 pages (/TimeTracking, /Fees, /Controlling):
// loads the 81 collections plus the read-only 79 ones (Honorarvertrag,
// Ausgangsrechnung, HoaiPlan) ONCE and hands one object to every tab — Radix
// unmounts inactive tabs, so state that must survive a tab switch lives here or
// in the database. Personnel data (persons, contracts, salaries, cost rates)
// comes only through the adapter src/lib/people/zeitHonorarPersonal.js and only
// with personnel access; without it the lists stay empty and `personal.zugang`
// says why (pitfall 4: show that case honestly, never as an error).
//
// Loading waits for the project list (79-13 B-2): the first read of the four new
// collections creates IndexedDB stores, a version change that closes every open
// connection — a project list still loading on such a connection failed
// ("The database connection is closing", BEFUNDE-79 H-4).
//
// The office settings of 79 (Setting{key:"buchhaltung"}, read-only, through 79's
// einstellungLesen + wirksameEinstellungen) come along: the fee offer needs the
// payment term per client and the incidental-cost/VAT defaults (E-12/E-16).
//
// In:  optional {heute} ('YYYY-MM-DD', injectable for tests). Out: the object
//      described by the typedef below. Side effects: reads on mount, reloads
//      after every write.

import { useCallback, useEffect, useState } from "react";
import { bitApi } from "@core/api/bitApi";
import { useAuth } from "@core/lib/AuthContext";
import { heuteLokal } from "@core/lib/kalender/datum.js";
import { useProject } from "@core/lib/ProjectContext";
import { DATENQUELLE } from "@core/lib/umgebung";
import { ZEIT_HONORAR_ENTITAETEN, ZEIT_HONORAR_LESEND } from "@/lib/zeitHonorar/entitaeten.js";
import * as speicher from "@/lib/zeitHonorar/speicher.js";
import { einstellungLesen } from "@/lib/accounting/speicher.js";
import { wirksameEinstellungen } from "@/lib/accounting/einstellungen.js";
import { ladePersonalFuerZeit } from "@/lib/people/zeitHonorarPersonal.js";

/**
 * Everything a tab of the three pages receives as prop `zh`.
 * @typedef {{
 *   verfuegbar: boolean,
 *   laedt: boolean,
 *   fehler: string,
 *   heute: string,
 *   daten: Record<string, any[]>,
 *   personal: import("@/lib/people/zeitHonorarPersonal.js").PersonalFuerZeit,
 *   einstBuchhaltung: Record<string, any>,
 *   projekte: any[],
 *   projectId: string|null,
 *   project: any,
 *   speichere: (entitaet: string, obj: Record<string, any>) => Promise<Record<string, any>>,
 *   loesche: (entitaet: string, id: string) => Promise<void>,
 *   schreibeStapel: (aufgaben: ReadonlyArray<Schreibaufgabe>) => Promise<void>,
 *   neuLaden: () => Promise<void>,
 * }} ZeitHonorar
 */

/**
 * One write of a batch: save a record or delete one.
 * @typedef {{art: 'speichern', entitaet: string, obj: Record<string, any>} | {art: 'loeschen', entitaet: string, id: string}} Schreibaufgabe
 */

const ALLE = [...ZEIT_HONORAR_ENTITAETEN, ...ZEIT_HONORAR_LESEND];

/** @returns {Record<string, any[]>} one empty list per collection */
const leereDaten = () => Object.fromEntries(ALLE.map((e) => [e, []]));

/** @type {import("@/lib/people/zeitHonorarPersonal.js").PersonalFuerZeit} */
const KEIN_PERSONAL = { zugang: "keine-berechtigung", mitarbeiter: [], vertraege: [], gehaelter: [], kostensaetze: [], fehler: null };

/** @param {unknown} fehler @returns {string} plain text, never "[object Object]" */
const text = (fehler) => /** @type {any} */ (fehler)?.message || String(fehler);

/**
 * Loads and writes the time and fee data of the office.
 * @param {{heute?: string}} [optionen] heute: reference day 'YYYY-MM-DD' (default heuteLokal())
 * @returns {ZeitHonorar}
 */
export function useZeitHonorar(optionen = {}) {
  const heute = optionen.heute || heuteLokal();
  const { projects, projectId, project, loading: projekteLaden } = useProject();
  const { user } = useAuth();
  const rolle = user?.role ?? null;
  const verfuegbar = speicher.verfuegbar(DATENQUELLE);
  const api = /** @type {any} */ (bitApi);
  const [zustand, setZustand] = useState(() => ({ laedt: verfuegbar, fehler: "", daten: leereDaten(), personal: KEIN_PERSONAL, einstBuchhaltung: wirksameEinstellungen(null) }));

  const neuLaden = useCallback(async () => {
    if (!verfuegbar) return;
    try {
      const [daten, personal, buchhaltung] = await Promise.all([
        speicher.ladeZeitHonorar(api),
        ladePersonalFuerZeit({ datenquelle: DATENQUELLE, rolle }),
        einstellungLesen(api),
      ]);
      setZustand({ laedt: false, fehler: "", daten, personal, einstBuchhaltung: wirksameEinstellungen(buchhaltung?.value ?? null) });
    } catch (fehler) {
      console.error("[Zeit & Honorar] Laden fehlgeschlagen:", fehler);
      setZustand((z) => ({ ...z, laedt: false, fehler: text(fehler) }));
    }
  }, [verfuegbar, api, rolle]);

  useEffect(() => {
    if (!verfuegbar || projekteLaden) return;
    neuLaden();
  }, [verfuegbar, projekteLaden, neuLaden]);

  const speichere = useCallback(async (entitaet, obj) => {
    const ergebnis = await speicher.speichereZH(api, entitaet, obj);
    await neuLaden();
    return ergebnis;
  }, [api, neuLaden]);
  const loesche = useCallback(async (entitaet, id) => {
    await speicher.loescheZH(api, entitaet, id);
    await neuLaden();
  }, [api, neuLaden]);
  // Several writes in a row with ONE reload at the end (a week submitted is
  // dozens of bookings); the first failure stops the batch and is thrown, the
  // reload still runs so the page shows what did land.
  const schreibeStapel = useCallback(async (/** @type {ReadonlyArray<Schreibaufgabe>} */ aufgaben) => {
    try {
      for (const a of aufgaben) {
        if (a.art === "loeschen") await speicher.loescheZH(api, a.entitaet, a.id);
        else await speicher.speichereZH(api, a.entitaet, a.obj);
      }
    } finally {
      await neuLaden();
    }
  }, [api, neuLaden]);

  return {
    verfuegbar,
    laedt: zustand.laedt,
    fehler: zustand.fehler,
    heute,
    daten: zustand.daten,
    personal: zustand.personal,
    einstBuchhaltung: zustand.einstBuchhaltung,
    projekte: Array.isArray(projects) ? projects : [],
    projectId: projectId ?? null,
    project: project ?? null,
    speichere,
    loesche,
    schreibeStapel,
    neuLaden,
  };
}
