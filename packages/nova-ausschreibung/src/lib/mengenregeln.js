// LV-Fachlichkeit der Mengenermittlung (Phase 33 / W1).
//
// Arbeitsteilung (ESLint-Boundary: @ava darf @core, nie umgekehrt):
//   @core/lib/rules/*  — fachfreie Engine auf BAUTEILEN (Selektor, Muster, Index)
//   hier              — LV-Semantik: art, Σadd − Σsub, soll-Wächter, Mehrfachnutzung
//
// Mengenrechnung (Pattern 2, verbindlich):
//   menge_position = Σ regeln(op="add") − Σ regeln(op="sub")
//   art "modell":     Σ hits.qty[mengenbasis] × faktor   (Count → hits.length × faktor)
//   art "uebernahme": r.uebernahme.menge
//   art "pauschal":   r.pauschal.menge
//   art "einzel":     Σ über r.einzel.element_ids   (Legacy, nur lesen)
//   Rundung: Math.round(m * 100) / 100; fehlende Größe = 0 + WARNUNG (nie stille 0)
//
// Isomorph: kein window, kein DOMParser, keine @/-Aliase.

import { mengeVonRegel, buildIndex } from '@core/lib/rules/ruleEngine.js';

export const ARTEN = ['modell', 'uebernahme', 'pauschal', 'einzel'];
export const SOLL_TOLERANZ = 0.05;

const r2 = (n) => Math.round(n * 100) / 100;

/**
 * Menge EINER Regel nach ihrer `art`.
 * @returns {{menge, treffer, element_ids, warnungen, art, op}}
 */
export function mengeNachArt(regel, elemente, opts = {}) {
  const art = regel?.art || 'modell';
  const op = regel?.op === 'sub' ? 'sub' : 'add';
  const leer = { treffer: 0, element_ids: [], warnungen: [], art, op };

  if (art === 'modell') {
    const res = mengeVonRegel(regel, elemente, opts);
    return { ...res, art, op };
  }

  if (art === 'uebernahme') {
    const m = Number(regel?.uebernahme?.menge);
    if (!Number.isFinite(m)) {
      return { ...leer, menge: 0, warnungen: ['art "uebernahme" ohne uebernahme.menge — 0 gezählt'] };
    }
    return { ...leer, menge: r2(m), warnungen: [] };
  }

  if (art === 'pauschal') {
    const m = Number(regel?.pauschal?.menge);
    if (!Number.isFinite(m)) {
      return { ...leer, menge: 0, warnungen: ['art "pauschal" ohne pauschal.menge — 0 gezählt'] };
    }
    return { ...leer, menge: r2(m), warnungen: [] };
  }

  if (art === 'einzel') {
    // Legacy: eine feste GUID-Liste. Nur LESEN — hier entsteht nichts Neues.
    const ids = Array.isArray(regel?.einzel?.element_ids) ? regel.einzel.element_ids : [];
    const basis = regel?.mengenbasis;
    const alle = Array.isArray(elemente) ? elemente : elemente?.alle || [];
    const gesuchte = new Set(ids);
    const hits = alle.filter((e) => gesuchte.has(e?.guid));
    const warnungen = [];
    if (hits.length !== ids.length) {
      warnungen.push(`${ids.length - hits.length} von ${ids.length} Einzel-GUIDs nicht im Modell gefunden`);
    }
    let summe = 0;
    let fehlend = 0;
    if (basis === 'Count') {
      summe = hits.length;
    } else if (basis) {
      for (const e of hits) {
        const v = e?.qty?.[basis];
        if (typeof v === 'number' && Number.isFinite(v)) summe += v;
        else fehlend += 1;
      }
      if (fehlend > 0) warnungen.push(`${fehlend} Einzel-Treffer ohne Größe "${basis}" — als 0 gezählt`);
    } else {
      warnungen.push('art "einzel" ohne mengenbasis — 0 gezählt');
    }
    const faktor = Number(regel?.faktor ?? 1);
    return { menge: r2(summe * (Number.isFinite(faktor) ? faktor : 1)), treffer: hits.length, element_ids: hits.map((e) => e.guid), warnungen, art, op };
  }

  return { ...leer, menge: 0, warnungen: [`unbekannte art "${art}" — 0 gezählt`] };
}

/**
 * Menge einer POSITION: Σ add − Σ sub über alle ihre Regeln.
 * @returns {{menge, regeln: Array, element_ids, warnungen, add, sub}}
 */
export function positionsMenge(regeln, elemente, opts = {}) {
  const liste = Array.isArray(regeln) ? regeln : [];
  // Index EINMAL bauen und über alle Regeln wiederverwenden.
  const index =
    elemente && typeof elemente === 'object' && typeof elemente.kandidaten === 'function'
      ? elemente
      : buildIndex(Array.isArray(elemente) ? elemente : []);

  const ergebnisse = liste.map((r) => mengeNachArt(r, index, opts));
  let add = 0;
  let sub = 0;
  const warnungen = [];
  const element_ids = [];

  for (const e of ergebnisse) {
    if (e.op === 'sub') sub += e.menge;
    else add += e.menge;
    element_ids.push(...(e.element_ids || []));
    warnungen.push(...(e.warnungen || []));
  }

  return {
    menge: r2(add - sub),
    add: r2(add),
    sub: r2(sub),
    regeln: ergebnisse,
    // Nachweis-GUIDs: nur die ADD-Treffer, ohne Duplikate.
    element_ids: [...new Set(ergebnisse.filter((e) => e.op !== 'sub').flatMap((e) => e.element_ids || []))],
    warnungen,
  };
}

/**
 * soll-Wächter: „Modell hat sich geändert" als AMPEL — KEIN Fehler, kein Blocker.
 * @param {{soll?: number}} regel
 * @param {number} menge
 * @returns {{abweichung: number|null, ueberToleranz: boolean, ampel: string,
 *            soll: number|null, menge: number, toleranz: number, hinweis: string|null}}
 */
export function sollWaechter(regel, menge, toleranz = SOLL_TOLERANZ) {
  const soll = Number(regel?.soll);
  if (!Number.isFinite(soll) || soll <= 0) {
    return { abweichung: null, ueberToleranz: false, ampel: 'grau', soll: null, menge, toleranz, hinweis: 'kein soll-Wert — nicht geprüft' };
  }
  const abweichung = menge / soll - 1;
  const abs = Math.abs(abweichung);
  return {
    abweichung,
    ueberToleranz: abs > toleranz,
    ampel: abs <= toleranz ? 'gruen' : abs <= toleranz * 2 ? 'gelb' : 'rot',
    soll,
    menge,
    toleranz,
    hinweis: abs > toleranz
      ? 'Modell hat sich gegenüber dem soll-Wert geändert — prüfen, kein Fehler'
      : null,
  };
}

/**
 * Mehrfachnutzung: in wie vielen Positionen kommt ein Element mit DERSELBEN
 * Mengenbasis als add-Treffer vor? Legitime Zulage-Paare erklären sich über
 * `zulage_zu`; alles andere ist ein BEFUND (Doppelzählung).
 *
 * @param {Array<{position?: any, id?: any, oz?: any, regeln?: Array<any>}>} positionen
 * @param {Array} elemente
 * @returns {{befunde: Array, erklaert: Array, je_element: Object}}
 */
export function mehrfachnutzung(positionen, elemente) {
  const index = buildIndex(Array.isArray(elemente) ? elemente : []);
  // Schlüssel: guid|mengenbasis → Liste der Positionen
  const treffer = new Map();
  const zulageZu = new Map();

  for (const p of positionen || []) {
    const posId = p?.position ?? p?.id ?? p?.oz ?? '(ohne)';
    for (const regel of p?.regeln || []) {
      if ((regel?.op === 'sub')) continue;
      // `zulage_zu` darf EINE oder MEHRERE Basispositionen benennen (Phase 33/W6).
      // Grund: eine Folgeleistung wie „Erstbeschichtung GK-Wand" bezieht sich auf
      // ALLE drei Trockenbau-Positionen desselben Bauteilbestands. Mit nur einem
      // Ziel wären 79 von 336 Mehrfachnutzungen erklärt und 257 falsch als
      // Doppelzählung gemeldet — der Report würde unbenutzbar.
      if (regel?.zulage_zu) {
        const ziele = Array.isArray(regel.zulage_zu) ? regel.zulage_zu : [regel.zulage_zu];
        zulageZu.set(posId, new Set(ziele.map(String)));
      }
      const basis = regel?.mengenbasis ?? '(ohne)';
      const res = mengeNachArt(regel, index);
      for (const guid of res.element_ids || []) {
        const key = `${guid}|${basis}`;
        if (!treffer.has(key)) treffer.set(key, new Set());
        treffer.get(key).add(posId);
      }
    }
  }

  const befunde = [];
  const erklaert = [];
  const je_element = {};

  for (const [key, posSet] of treffer) {
    const [guid, basis] = key.split('|');
    je_element[guid] = Math.max(je_element[guid] || 0, posSet.size);
    if (posSet.size < 2) continue;
    const pos = [...posSet];
    // Erklärt, wenn jede beteiligte Position entweder selbst eine Zulage/Folge-
    // leistung zu einer anderen Position der Gruppe ist ODER von einer solchen
    // referenziert wird.
    const alleErklaert = pos.every((p) => {
      const ziele = zulageZu.get(p);
      if (ziele) return pos.some((q) => q !== p && ziele.has(String(q)));
      return pos.some((q) => q !== p && zulageZu.get(q)?.has(String(p)));
    });
    const eintrag = {
      guid,
      mengenbasis: basis,
      positionen: pos,
      anzahl: posSet.size,
      einschaetzung: alleErklaert
        ? 'legitim — Zulage/Folgeleistung zur Basisposition (zulage_zu gepflegt)'
        : 'BEFUND — dasselbe Bauteil ist in mehreren Positionen mengenwirksam, ohne dass ein Bezug gepflegt ist',
    };
    if (alleErklaert) erklaert.push(eintrag);
    else befunde.push(eintrag);
  }

  return { befunde, erklaert, je_element };
}

// ---------------------------------------------------------------------------
// MengenMuster (Phase 33 / W6, Plan 33-04) — der eigentliche Verkaufswert.
//
// Ein `MengenMuster` ist eine büroweite Regelvorlage OHNE `project_id`. Es wird
// aus einer bewährten Regel ABGELEITET und im nächsten Projekt ANGEWANDT. Das
// nächste Projekt startet damit vorbelegt statt bei null.
//
// Wichtig und bewusst: das Muster trägt den VOLLSTÄNDIGEN Selektor, nicht nur
// Klasse und Mengenbasis. Ein Muster „IfcWall + NetSideArea" wäre wertlos — die
// Unterscheidung zwischen Trennwand 150 mm und Vorsatzschale 125 mm steckt genau
// im Typmuster. Wer die Muster auf Klasse+Basis verkürzt, verkauft eine leere
// Hülle.
//
// Der Bürostandard-Katalog (`catalog-seed.MengenMuster`) führt die 15 Vorlagen in
// der KURZEN Form (Klasse + Basis + Faktor). Ein abgeleitetes Muster ist die
// LANGE Form derselben Entität — beides sind Daten derselben Tabelle, deshalb
// ist `selektor` optional.
// ---------------------------------------------------------------------------

/**
 * Regel → MengenMuster („als Muster speichern").
 * @param {object} regel
 * @param {{nr?: number, name?: string, einheit?: string|null, herkunft?: object|null}} [meta]
 */
export function musterAusRegel(regel, meta = {}) {
  return {
    scope: 'buero',
    project_id: null, // büroweit — genau das macht es wiederverwendbar
    projekt_override_id: null,
    nr: meta.nr ?? null,
    name: meta.name ?? regel?.name ?? '(ohne Namen)',
    ifc_klasse: (regel?.selektor?.was?.ifc_klasse || [])[0] ?? null,
    mengenbasis: regel?.mengenbasis ?? null,
    faktor: regel?.faktor ?? 1,
    faktor_grund: regel?.faktor_grund ?? null,
    einheit: meta.einheit ?? regel?.einheit ?? null,
    art: regel?.art ?? 'modell',
    op: regel?.op ?? 'add',
    // Der VOLLSTÄNDIGE Selektor — sonst ist das Muster keine Vorlage, sondern eine Andeutung.
    selektor: regel?.selektor ?? null,
    herkunft: meta.herkunft ?? null,
  };
}

/**
 * MengenMuster → Regel („Muster anwenden"). Setzt `muster_ref`, damit später
 * nachvollziehbar ist, WORAUS eine Regel entstanden ist.
 *
 * Hat das Muster keinen Selektor (Bürostandard-Kurzform), wird einer aus
 * `ifc_klasse` gebaut — der offensichtliche Minimalselektor, nichts Geratenes.
 */
export function regelAusMuster(muster, { muster_ref = null, position_id = null } = {}) {
  const selektor =
    muster?.selektor ?? {
      was: { kg: [], gewerk: [], schicht: [], ifc_klasse: muster?.ifc_klasse ? [muster.ifc_klasse] : [] },
      zustand: { status: [] },
      muster: {},
      bereich: { qty: [] },
    };
  return {
    art: muster?.art ?? 'modell',
    op: muster?.op ?? 'add',
    selektor,
    mengenbasis: muster?.mengenbasis ?? null,
    faktor: muster?.faktor ?? 1,
    faktor_grund: muster?.faktor_grund ?? null,
    einheit: muster?.einheit ?? null,
    muster_ref: muster_ref ?? muster?.id ?? muster?.nr ?? null,
    position_id,
  };
}
