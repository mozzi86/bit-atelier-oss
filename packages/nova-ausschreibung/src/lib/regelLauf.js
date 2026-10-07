// RegelLauf — die Historie der Mengenermittlung (Phase 33 / W6, Plan 33-04).
//
// Was die Python-Pipeline als Konsolenreport ausgab („15 Positionen, 3
// Abweichungen"), ist hier ein DATENSATZ. Der Unterschied ist nicht Kosmetik:
// ein Konsolenreport ist nach dem Scrollen weg, und niemand kann in einem halben
// Jahr sagen, WELCHE Menge sich WANN und um WIE VIEL geändert hat. Deshalb trägt
// jeder Lauf je geänderter Position **die alte UND die neue Menge**.
//
// Zwei Ehrlichkeitsregeln, die hier eingebaut sind statt kommentiert:
//   1. **Kein Lauf ohne Snapshot.** Ohne Bauteilstand gibt es keine Modellmenge;
//      ein Lauf, der das verschweigt, würde 497 Positionen auf 0 setzen und das
//      als Ergebnis ausgeben. `laufErzeugen` liefert dann `{ok:false}` mit Grund
//      und rechnet NICHT.
//   2. **„0 Treffer" und „Menge 0" sind Zustände mit Namen.** Sie landen in
//      `warnungen[]` und in `fehlerzustaende[]` — nie als stille Zahl.
//
// Kein Auto-Recompute-Sturm: diese Datei rechnet nur, wenn sie gerufen wird.
// Der Δ-Guard (`SCHWELLE`) entscheidet, was als Änderung GILT — sonst erzeugt
// jede Fließkomma-Unruhe einen Lauf.
//
// Isomorph: keine Browser-Globalen, kein Browser-XML-Parser, keine App-Aliase
// (die Zusicherung ist absichtlich ohne die verbotenen Zeichenfolgen formuliert —
// die Isomorphie-Gates sind literale greps).

import { buildIndex } from '@core/lib/rules/ruleEngine.js';
import { validiereReferenzen } from '@core/lib/rules/catalogs.js';
import { positionsMenge, sollWaechter, SOLL_TOLERANZ } from './mengenregeln.js';

/** Ab dieser Mengendifferenz gilt eine Position als geändert (2 Nachkommastellen). */
export const SCHWELLE = 0.005;

/** Die benannten Fehlerzustände. Keine leere Tabelle, keine stille 0. */
export const FEHLERZUSTAND = Object.freeze({
  KEINE_TREFFER: 'keine_treffer',
  MENGE_NULL: 'menge_null',
  REFERENZ_UNGUELTIG: 'referenz_ungueltig',
  ABGEBROCHEN: 'zeitbudget_abgebrochen',
});

const r2 = (n) => Math.round(n * 100) / 100;

/**
 * Ein Recompute über viele Positionen → EIN `RegelLauf`-Datensatz.
 *
 * @param {Array<{id?: any, oz?: any, trade?: any, quantity?: any, menge_final?: any,
 *          regeln?: Array<any>, soll?: any, gb?: any, unit_price?: any}>} positionen
 *        Positionen MIT ihren Regeln. `quantity`/`menge_final` ist die ALTE Menge.
 * @param {Array<any>|{alle?: Array<any>, kandidaten?: Function}|null} elemente
 *        Bauteilstand oder buildIndex()-Ergebnis
 * @param {{snapshot_id?: string|null, kataloge?: object|null, anlass?: string,
 *          toleranz?: number, budgetMs?: number, zeitpunkt?: string}} [opts]
 * @returns {{ok: boolean, grund?: string, lauf: object|null}}
 */
export function laufErzeugen(positionen = [], elemente = null, opts = {}) {
  const snapshotId = opts.snapshot_id ?? null;
  const liste = Array.isArray(positionen) ? positionen : [];
  const roh = Array.isArray(elemente) ? elemente : elemente?.alle ?? null;

  // Regel 1: kein Lauf ohne Snapshot. Lieber kein Ergebnis als ein falsches.
  if (!snapshotId || !Array.isArray(roh) || roh.length === 0) {
    return {
      ok: false,
      grund: !snapshotId
        ? 'kein BimSnapshot gewählt — ohne Bauteilstand ist keine Modellmenge belegbar'
        : 'der gewählte Bauteilstand ist leer — es wird nicht gerechnet',
      lauf: null,
    };
  }

  const kandidat = /** @type {any} */ (elemente);
  const index =
    kandidat && typeof kandidat === 'object' && typeof kandidat.kandidaten === 'function'
      ? kandidat
      : buildIndex(roh);

  const t0 = Date.now();
  const toleranz = opts.toleranz ?? SOLL_TOLERANZ;
  const positionenErgebnis = [];
  const abweichungen = [];
  const warnungen = [];
  const fehlerzustaende = [];
  let regelnGesamt = 0;
  let trefferSumme = 0;
  let geaendert = 0;

  for (const p of liste) {
    const regeln = Array.isArray(p?.regeln) ? p.regeln : [];
    regelnGesamt += regeln.length;
    const posId = p?.id ?? p?.oz ?? '(ohne)';

    // Referenzvalidierung VOR dem Rechnen — eine Regel mit unbekannter
    // Mengenbasis liefert 0 und sieht wie ein Ergebnis aus (Pitfall 13).
    const referenzFehler = [];
    if (opts.kataloge) {
      for (const r of regeln) {
        const v = validiereReferenzen(r, opts.kataloge);
        if (!v.ok) referenzFehler.push(...v.fehler.map((x) => `${x.feld}: ${x.text}`));
      }
    }

    const res = positionsMenge(regeln, index, { budgetMs: opts.budgetMs });
    const alt = p?.quantity ?? p?.menge_final ?? null;
    const neu = res.menge;
    const treffer = res.regeln.reduce((a, r) => a + (r.treffer || 0), 0);
    trefferSumme += treffer;

    const zustaende = [];
    if (regeln.length > 0 && treffer === 0) zustaende.push(FEHLERZUSTAND.KEINE_TREFFER);
    if (regeln.length > 0 && r2(neu) === 0) zustaende.push(FEHLERZUSTAND.MENGE_NULL);
    if (referenzFehler.length > 0) zustaende.push(FEHLERZUSTAND.REFERENZ_UNGUELTIG);
    if (res.regeln.some((r) => r.abgebrochen)) zustaende.push(FEHLERZUSTAND.ABGEBROCHEN);

    const waechter = sollWaechter({ soll: p?.soll ?? null }, neu, toleranz);
    const diff = alt == null ? null : r2(neu - alt);
    const veraendert = alt == null ? neu !== 0 : Math.abs(neu - alt) > SCHWELLE;
    if (veraendert) geaendert += 1;

    const eintrag = {
      position_id: posId,
      oz: p?.oz ?? null,
      trade: p?.trade ?? null,
      regeln: regeln.length,
      treffer,
      // ALT und NEU stehen beide da. Genau das ist der Zweck dieser Datei.
      menge_alt: alt == null ? null : r2(alt),
      menge_neu: neu,
      differenz: diff,
      veraendert,
      add: res.add,
      sub: res.sub,
      element_ids: res.element_ids,
      warnungen: [...res.warnungen, ...referenzFehler],
      fehlerzustaende: zustaende,
      soll: waechter.soll,
      soll_ampel: waechter.ampel,
      soll_abweichung: waechter.abweichung,
      // Geldwert der Änderung — die Arbeitsliste sortiert danach, nicht nach OZ.
      geldwert: p?.unit_price != null && diff != null ? r2(Number(p.unit_price) * diff) : null,
    };
    positionenErgebnis.push(eintrag);

    if (veraendert) {
      abweichungen.push({
        position_id: posId,
        oz: eintrag.oz,
        menge_alt: eintrag.menge_alt,
        menge_neu: eintrag.menge_neu,
        differenz: diff,
        geldwert: eintrag.geldwert,
      });
    }
    for (const w of eintrag.warnungen) warnungen.push(`${posId}: ${w}`);
    for (const z of zustaende) fehlerzustaende.push({ position_id: posId, zustand: z });
  }

  return {
    ok: true,
    lauf: {
      snapshot_id: snapshotId,
      zeitpunkt: opts.zeitpunkt ?? new Date().toISOString(),
      anlass: opts.anlass ?? 'manuell',
      positionen: liste.length,
      regeln: regelnGesamt,
      treffer_summe: trefferSumme,
      geaendert,
      dauer_ms: Date.now() - t0,
      // Die drei Listen sind das Gedächtnis des Laufs.
      je_position: positionenErgebnis,
      abweichungen,
      warnungen,
      fehlerzustaende,
    },
  };
}

/**
 * Der Lauf für EINE Position — der Weg, den der Regel-Editor beim Speichern
 * geht. Gibt denselben Datensatz zurück, nur mit einer Zeile.
 */
export function laufFuerPosition(position, elemente, opts = {}) {
  return laufErzeugen([position], elemente, { ...opts, anlass: opts.anlass ?? 'regel_bearbeitet' });
}

/**
 * Arbeitsliste NACH GELDWERT — nicht nach OZ.
 *
 * Warum: eine Liste nach Ordnungszahl arbeitet die Baustelleneinrichtung vor der
 * Rohbaudecke ab. Nach Geldwert sortiert steht oben, wo eine Stunde Prüfung am
 * meisten bewegt. Positionen ohne Preis stehen hinten — mit Vermerk, nicht als 0.
 */
export function arbeitsliste(lauf, { nurGeaendert = true } = {}) {
  const zeilen = (lauf?.je_position || []).filter((z) => (nurGeaendert ? z.veraendert : true));
  return zeilen
    .map((z) => ({
      ...z,
      geldwert_abs: z.geldwert == null ? null : Math.abs(z.geldwert),
      ohne_preis: z.geldwert == null,
    }))
    .sort((a, b) => {
      if (a.ohne_preis !== b.ohne_preis) return a.ohne_preis ? 1 : -1;
      return (b.geldwert_abs ?? 0) - (a.geldwert_abs ?? 0);
    });
}

/**
 * Modellbindungs-Fortschritt — GEWICHTET NACH GB (Pitfall 7).
 *
 * Die nackte Zahl „15 von 497 modellgebunden" ist irreführend: die 15 sind die
 * großen Flächenpositionen und tragen ein Vielfaches ihres Stückanteils. Die
 * ungewichtete Quote sieht nach 3 % aus, der Geldanteil ist deutlich höher.
 * Beide Zahlen werden deshalb ausgewiesen, nie eine allein.
 *
 * `353` (Übernahmen) ist ein ZUSTAND, kein Ziel — und `modell_geprueft_am` sagt,
 * wie alt die letzte Prüfung ist.
 *
 * @param {Array} positionen
 * @param {{snapshots?: Array<{id, stand}>, heute?: string}} [opts]
 */
export function fortschritt(positionen = [], opts = {}) {
  const heute = opts.heute ? new Date(opts.heute) : new Date();
  const snapshots = Array.isArray(opts.snapshots) ? opts.snapshots : [];
  let gesamt = 0;
  let modellgebunden = 0;
  let gbGesamt = 0;
  let gbModell = 0;
  let uebernahmen = 0;
  let ungeprueft = 0;
  const arbeit = [];

  for (const p of positionen || []) {
    gesamt += 1;
    const modus = p?.mengen_modus ?? (p?.regeln?.some?.((r) => r?.art === 'modell') ? 'filter' : null);
    const menge = Number(p?.quantity ?? p?.menge_final ?? 0) || 0;
    const ep = p?.unit_price == null ? null : Number(p.unit_price);
    const gb = ep == null ? null : r2(menge * ep);
    if (gb != null) gbGesamt += gb;
    const istModell = modus === 'filter' || modus === 'modell';
    if (istModell) {
      modellgebunden += 1;
      if (gb != null) gbModell += gb;
    } else if (modus === 'uebernahme') {
      uebernahmen += 1;
    }

    const geprueft = p?.modell_geprueft_am ?? null;
    const alterTage = geprueft
      ? Math.floor((heute.getTime() - new Date(geprueft).getTime()) / 86400000)
      : null;
    // „seit N Modellständen ungeprüft": Snapshots, die NACH der letzten Prüfung
    // entstanden sind. Ohne Prüfdatum gilt die Position als ungeprüft.
    const staendeDanach = geprueft
      ? snapshots.filter((s) => s?.stand && new Date(s.stand) > new Date(geprueft)).length
      : snapshots.length;
    if (modus === 'uebernahme' && staendeDanach >= 2) ungeprueft += 1;

    arbeit.push({
      position_id: p?.id ?? p?.oz ?? null,
      oz: p?.oz ?? null,
      trade: p?.trade ?? null,
      modus: modus ?? 'unbekannt',
      gb,
      ohne_preis: gb == null,
      modell_geprueft_am: geprueft,
      alter_tage: alterTage,
      staende_ungeprueft: staendeDanach,
    });
  }

  const quote = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
  return {
    positionen: gesamt,
    modellgebunden,
    uebernahmen,
    // Die ungewichtete Quote — und daneben die, die zählt.
    anteil_positionen: quote(modellgebunden, gesamt),
    gb_gesamt: r2(gbGesamt),
    gb_modellgebunden: r2(gbModell),
    anteil_gb: quote(gbModell, gbGesamt),
    ungeprueft_seit_2_staenden: ungeprueft,
    warnung:
      ungeprueft > 0
        ? `${ungeprueft} Übernahmen seit 2 Modellständen ungeprüft — der Modellstand ist weitergelaufen, die Menge nicht`
        : null,
    hinweis:
      'Der Stückanteil ist NICHT die Aussage: er zählt Baustelleneinrichtung wie Rohbaudecke. Maßgeblich ist der GB-gewichtete Anteil.',
    arbeitsliste: arbeit
      .filter((z) => z.modus !== 'filter' && z.modus !== 'modell')
      .sort((a, b) => {
        if (a.ohne_preis !== b.ohne_preis) return a.ohne_preis ? 1 : -1;
        return (b.gb ?? 0) - (a.gb ?? 0);
      }),
  };
}
