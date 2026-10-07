// Regel-Engine: Selektor → Treffer → Menge (Phase 33 / W1).
//
// Fachfrei mit Absicht: sie arbeitet auf BAUTEILEN, nicht auf LV-Positionen.
// Die LV-Fachlichkeit (art-Semantik, Σadd − Σsub, soll-Wächter) liegt in
// @ava/lib/mengenregeln.js. Grund: die ESLint-Boundary erlaubt @ava → @core,
// aber nie @core → @ava, und der IFC-Viewer-Spiegel braucht diese Engine ebenfalls.
//
// Selektor-Schema (Pattern 1, verbindlich):
//   {
//     was:     { kg: [], gewerk: [], schicht: [], ifc_klasse: [] },
//     zustand: { status: [] },                    // bestand|neubau|abbruch|unbekannt|null
//     muster:  { name: {op,value}, typ: …, material: …, geschoss: …, klassifikation: … },
//     bereich: { qty: [{ key, min, max }] },
//   }
// UND über die Achsen, ODER innerhalb einer Achse. `[]` oder `["*"]` = kein Filter.
//
// Mengenrechnung (Pattern 2, verbindlich):
//   art "modell": Σ hits.qty[mengenbasis] × faktor   (Count → hits.length × faktor)
//   Rundung: Math.round(m * 100) / 100
//   **Fehlende BaseQuantity zählt 0, ABER mit WARNUNG** — nie eine stille 0.
//   (Pitfall 13 / T-33-07: Morphs liefern nie BaseQuantities.)
//
// Treue zum Orakel (parity/oracle/anwenden_jb.py):
//   - klasse/status sind EXAKTE Gleichheitsvergleiche, Status via `e.status || '?'`
//   - typ-Muster prüfen gegen `(typ||'') + '|' + (name||'')`
//   - Muster sind unverankert und case-insensitiv (Python re.search + re.I)
//   - `Count` zählt Treffer, sonst wird qty[variable] summiert (fehlend → 0.0)
//
// Isomorph: kein window, kein DOMParser, keine Aliase.

import { matchPattern, patternWarnung, evaluateWithBudget } from './patternMatch.js';
import { buildIndex, statusKey, typNameText } from './elementIndex.js';

/** Achse ohne Einschränkung? Leer, fehlend oder `["*"]`. */
function istWildcardAchse(sel) {
  if (!sel) return true;
  const arr = Array.isArray(sel) ? sel : [sel];
  if (arr.length === 0) return true;
  return arr.length === 1 && arr[0] === '*';
}

/** ODER innerhalb einer Achse; Element-Wert darf Skalar oder Array sein. */
function inAxis(sel, val) {
  if (istWildcardAchse(sel)) return true;
  const auswahl = Array.isArray(sel) ? sel : [sel];
  const werte = Array.isArray(val) ? val : [val];
  return werte.some((v) => auswahl.includes(v));
}

/** Einziger Wert einer Achse, wenn sie genau einen festlegt — sonst null.
 *  Nur dafür da, den Bucket-Vorindex zu nutzen. */
function einzelwert(sel) {
  if (istWildcardAchse(sel)) return null;
  const arr = Array.isArray(sel) ? sel : [sel];
  return arr.length === 1 ? arr[0] : null;
}

function inBereich(el, bereiche) {
  if (!Array.isArray(bereiche) || bereiche.length === 0) return true;
  return bereiche.every((b) => {
    if (!b?.key) return true;
    const v = el?.qty?.[b.key];
    if (typeof v !== 'number' || !Number.isFinite(v)) return false;
    if (b.min != null && v < b.min) return false;
    if (b.max != null && v > b.max) return false;
    return true;
  });
}

/**
 * Baut ein Prädikat aus dem Selektor.
 * @returns {(el) => boolean}
 */
export function matchSelektor(selektor) {
  const was = selektor?.was || {};
  const zustand = selektor?.zustand || {};
  const muster = selektor?.muster || {};
  const bereich = selektor?.bereich || {};

  return function trifft(el) {
    // WAS-Achsen
    if (!inAxis(was.ifc_klasse, el?.klasse)) return false;
    if (!inAxis(was.kg, el?.kg)) return false;
    if (!inAxis(was.gewerk, el?.gewerk)) return false;
    if (!inAxis(was.schicht, el?.schicht)) return false;
    // ZUSTAND
    if (!inAxis(zustand.status, statusKey(el))) return false;
    // MUSTER — typ und name prüfen gegen den ZUSAMMENGESETZTEN String
    if (muster.typ != null && !matchPattern(typNameText(el), muster.typ)) return false;
    if (muster.name != null && !matchPattern(typNameText(el), muster.name)) return false;
    if (muster.material != null && !matchPattern(el?.material || '', muster.material)) return false;
    if (muster.geschoss != null && !matchPattern(el?.geschoss || '', muster.geschoss)) return false;
    if (muster.klassifikation != null) {
      const kl = el?.klassifikation;
      const texte = Array.isArray(kl) ? kl : [kl || ''];
      if (!texte.some((t) => matchPattern(t || '', muster.klassifikation))) return false;
    }
    // BEREICH
    if (!inBereich(el, bereich.qty)) return false;
    return true;
  };
}

/** Warnungen, die schon aus dem Selektor selbst folgen (abgewiesene Muster). */
export function selektorWarnungen(selektor) {
  const muster = selektor?.muster || {};
  const out = [];
  for (const [achse, p] of Object.entries(muster)) {
    if (p == null) continue;
    const w = patternWarnung(p);
    if (w) out.push(`muster.${achse}: ${w}`);
  }
  return out;
}

/**
 * Menge einer Regel.
 * @param {{selektor, mengenbasis, faktor}} regel — `mengenbasis: "Count"` zählt Treffer
 * @param {Array|{alle,kandidaten}} elemente Elementliste ODER ein buildIndex()-Ergebnis
 * @param {{budgetMs?: number}} [opts]
 * @returns {{menge, treffer, element_ids, warnungen, dauer_ms, abgebrochen}}
 */
export function mengeVonRegel(regel, elemente, opts = {}) {
  const selektor = regel?.selektor || {};
  const basis = regel?.mengenbasis ?? null;
  const faktor = Number(regel?.faktor ?? 1) || (regel?.faktor === 0 ? 0 : 1);
  const warnungen = selektorWarnungen(selektor);

  const index =
    elemente && typeof elemente === 'object' && typeof elemente.kandidaten === 'function'
      ? elemente
      : buildIndex(elemente || []);

  // Vorindex nutzen, wenn Klasse und/oder Status genau EINEN Wert festlegen.
  const klasse = einzelwert(selektor?.was?.ifc_klasse);
  const status = einzelwert(selektor?.zustand?.status);
  const kandidaten = index.kandidaten(klasse, status);

  const trifft = matchSelektor(selektor);
  const budget = evaluateWithBudget((abgelaufen) => {
    const hits = [];
    for (let i = 0; i < kandidaten.length; i += 1) {
      // Zeitbudget nur alle 256 Elemente prüfen — Date.now() ist nicht gratis.
      if ((i & 255) === 0 && abgelaufen()) break;
      const el = kandidaten[i];
      if (trifft(el)) hits.push(el);
    }
    return hits;
  }, opts.budgetMs);

  const hits = budget.ergebnis || [];
  warnungen.push(...budget.warnungen);

  let rohMenge;
  if (basis === 'Count' || basis === 'count') {
    rohMenge = hits.length * faktor;
  } else if (!basis) {
    rohMenge = 0;
    if (hits.length > 0) {
      warnungen.push('keine Mengenbasis angegeben — Menge 0 (nicht gerechnet)');
    }
  } else {
    let summe = 0;
    let fehlend = 0;
    for (const el of hits) {
      const v = el?.qty?.[basis];
      if (typeof v === 'number' && Number.isFinite(v)) summe += v;
      else fehlend += 1;
    }
    rohMenge = summe * faktor;
    if (fehlend > 0) {
      // NIE eine stille 0 — Morphs liefern nie BaseQuantities (Pitfall 13).
      warnungen.push(
        `${fehlend} von ${hits.length} Treffern ohne Größe "${basis}" — als 0 gezählt`
      );
    }
  }

  if (hits.length === 0) {
    // T-33-04: ein Status-Casing-Fehler ergibt 0 Treffer OHNE Fehlermeldung.
    // Genau deshalb ist "0 Treffer" hier ein sichtbarer Zustand.
    warnungen.push('0 Treffer — Selektor greift nicht (Status-Schreibweise? Mengenbasis? Muster?)');
  }

  return {
    menge: Math.round(rohMenge * 100) / 100,
    treffer: hits.length,
    element_ids: hits.map((e) => e?.guid).filter(Boolean),
    warnungen,
    dauer_ms: budget.dauer_ms,
    abgebrochen: budget.abgebrochen,
  };
}

export { buildIndex };
