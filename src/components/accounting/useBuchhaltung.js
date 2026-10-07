// Page loader of /Accounting (phase 79): loads all 13 accounting collections and
// the office Setting ONCE and hands one object `bh` to every tab. One loader,
// because Radix unmounts inactive tabs and the year clock, VAT and annual
// summary compute across areas; state that must survive a tab switch lives in
// the Setting (e.g. bank profiles), not in a tab.
//
// In:  optional `heute` ('YYYY-MM-DD', injectable for tests; default: the device day).
// Out: the Buchhaltung object (typedef below). Side effects: loads once the
//      project list has loaded, reloads after every write. (The demo's sample
//      books were seeded here until 83-02.)

import { useCallback, useEffect, useMemo, useState } from "react";
import { bitApi } from "@core/api/bitApi";
import { heuteLokal } from "@core/lib/kalender/datum.js";
import { useProject } from "@core/lib/ProjectContext";
import { DATENQUELLE } from "@core/lib/umgebung";
import { BUCHHALTUNG_ENTITAETEN } from "@/lib/accounting/datenmodell.js";
import { saetzeZum, wirksameEinstellungen } from "@/lib/accounting/einstellungen.js";
import * as speicher from "@/lib/accounting/speicher.js";

/**
 * Everything a tab of /Accounting receives as prop `bh`.
 * `daten`: records per entity name (all 13, arrays, possibly empty);
 * `einst`: effective office settings (wirksameEinstellungen);
 * `saetze`: legal rates on `heute` (saetzeZum); `heute`: 'YYYY-MM-DD';
 * write functions reload afterwards and throw plain-text errors.
 * @typedef {{
 *   verfuegbar: boolean,
 *   laedt: boolean,
 *   fehler: string,
 *   daten: Record<string, any[]>,
 *   einst: Record<string, any>,
 *   saetze: Record<string, any>,
 *   heute: string,
 *   projekte: any[],
 *   projektId: string|null,
 *   speichere: (entitaet: string, obj: Record<string, any>) => Promise<Record<string, any>>,
 *   speichereViele: (liste: Array<{entitaet: string, obj: Record<string, any>}>) => Promise<Array<Record<string, any>>>,
 *   loesche: (entitaet: string, id: string) => Promise<void>,
 *   einstellungSpeichern: (patch: Record<string, any>) => Promise<Record<string, any>>,
 *   neuLaden: () => Promise<void>,
 * }} Buchhaltung
 */

/** @returns {Record<string, any[]>} one empty list per accounting entity */
const leereDaten = () => Object.fromEntries(BUCHHALTUNG_ENTITAETEN.map((e) => [e, []]));

/** @param {unknown} fehler @returns {string} plain text, never "[object Object]" */
const text = (fehler) => /** @type {any} */ (fehler)?.message || String(fehler);

/**
 * Loads and writes the books of the office.
 * @param {{heute?: string}} [optionen] heute: reference day 'YYYY-MM-DD' (default heuteLokal())
 * @returns {Buchhaltung}
 */
export function useBuchhaltung(optionen = {}) {
  const heute = optionen.heute || heuteLokal();
  const { projects, projectId, loading: projekteLaden } = useProject();
  const verfuegbar = speicher.verfuegbar(DATENQUELLE);
  const api = /** @type {any} */ (bitApi);
  const [zustand, setZustand] = useState(() => ({
    laedt: verfuegbar,
    fehler: "",
    daten: leereDaten(),
    settingWert: /** @type {Record<string, any>|null} */ (null),
  }));

  const neuLaden = useCallback(async () => {
    if (!verfuegbar) return;
    try {
      const { daten, setting } = await speicher.ladeAlles(api);
      setZustand({ laedt: false, fehler: "", daten, settingWert: setting?.value ?? null });
    } catch (fehler) {
      console.error("[Buchhaltung] Laden fehlgeschlagen:", fehler);
      setZustand((z) => ({ ...z, laedt: false, fehler: text(fehler) }));
    }
  }, [verfuegbar, api]);

  useEffect(() => {
    let aktiv = true;
    (async () => {
      if (!verfuegbar) return;
      // Reading the 13 collections can create IndexedDB stores on demand, each
      // a version change that closes every open connection. A project list
      // still loading on such a connection failed ("The database connection is
      // closing", 79-13 finding) — so loading waits for the project list.
      if (projekteLaden) return;
      if (!aktiv) return;
      await neuLaden();
    })();
    return () => { aktiv = false; };
  }, [heute, verfuegbar, api, neuLaden, projekteLaden]);

  const einst = useMemo(() => wirksameEinstellungen(zustand.settingWert), [zustand.settingWert]);
  const saetze = useMemo(() => saetzeZum(heute), [heute]);

  const speichere = useCallback(async (entitaet, obj) => {
    const ergebnis = await speicher.speichere(api, entitaet, obj);
    await neuLaden();
    return ergebnis;
  }, [api, neuLaden]);
  const speichereViele = useCallback(async (liste) => {
    const ergebnis = await speicher.speichereViele(api, liste);
    await neuLaden();
    return ergebnis;
  }, [api, neuLaden]);
  const loesche = useCallback(async (entitaet, id) => {
    await speicher.loesche(api, entitaet, id);
    await neuLaden();
  }, [api, neuLaden]);
  const einstellungSpeichern = useCallback(async (patch) => {
    const ergebnis = await speicher.einstellungSpeichern(api, patch);
    await neuLaden();
    return ergebnis;
  }, [api, neuLaden]);

  return {
    verfuegbar,
    laedt: zustand.laedt,
    fehler: zustand.fehler,
    daten: zustand.daten,
    einst,
    saetze,
    heute,
    projekte: Array.isArray(projects) ? projects : [],
    projektId: projectId ?? null,
    speichere,
    speichereViele,
    loesche,
    einstellungSpeichern,
    neuLaden,
  };
}
