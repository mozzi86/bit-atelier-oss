// Referenzpreis-Übernahme aus einem Fremdprojekt (Phase 33 / W7, ENGINE-08).
//
// Aus dem Einmal-Skript `harvest_<referenz>.py` wird hier ein Modul, das jedes Büro auf
// jedes seiner Altprojekte anwenden kann. Der fachliche Kern ist eine KASKADE mit
// sechs Stufen — und alle sechs Schwellen stehen im Katalog `PreisUebernahmeRegel`,
// nicht in dieser Datei. Ein grep-Gate prüft, dass hier keine der Zahlen 0,75 /
// 0,55 / 0,4 / 3,0 / 0,01 im Rechenweg steht.
//
// Die Kaskade, in dieser Reihenfolge:
//   1. **OZ-Match** — ohne Zuordnung gibt es nichts zu übernehmen.
//   2. **Einheit muss gleich sein** (kanonisch, über `EinheitenKatalog.vergleich`:
//      `Stk` == `St`, `m²` == `m2`, `lfm` == `m`). Verschiedene Einheiten sind nie
//      vergleichbar — ein €/m² als €/m übernommen ist ein Faktor-Zufall.
//   3. **1-%-Verwerfung**: liegt der Fremdpreis im Rahmen von ±1 % um die eigene
//      Basis, bringt er nichts. Die Indexfortschreibung ist dann die ehrlichere
//      Aussage, und eine „neue" Schicht würde eine Preisbewegung vortäuschen.
//   4. **ratio-Fenster** `[ratio_min; ratio_max]` auf EP/Basis — außerhalb ist es
//      ein Ausreißer (anderer Leistungsumfang, andere Menge, Tippfehler).
//   5. **`sim ≥ min_similarity`** ⇒ ÜBERNAHME.
//   6. **`review_von ≤ sim < min_similarity`** (oder Ausreißer bei ausreichender
//      Ähnlichkeit) ⇒ **`review.flag`**: sichtbar, dokumentiert, aber **NICHT
//      aktiv**. Ein Review, der stillschweigend mitrechnet, ist kein Review.
//
// Ergebnis sind `PreisSchicht`-Datensätze `art: "referenzprojekt"` (Rang 30 aus dem
// Katalog `PreisRangfolge`: unter Vertrag/Markt, über Index) mit `herkunft` und
// `match{similarity, ratio, verfahren}`. **Es wird nie ein bestehender Preis
// überschrieben** — eine Übernahme ist immer eine zusätzliche Schicht.
//
// `sim` kommt aus GENAU EINER validierten Implementierung: `@core/lib/textMatch.js`
// (difflib-deckungsgleich, Gate G17). Es gibt hier keine zweite Ähnlichkeitsformel.
//
// Isomorph: keine Browser-Globalen, kein Browser-XML-Parser, keine App-Aliase
// (die Zusicherung ist absichtlich ohne die verbotenen Zeichenfolgen formuliert —
// die Isomorphie-Gates sind literale greps).

import { ratio as textRatio, normalisiere, runde } from '@core/lib/textMatch.js';

/** Die Stufen der Kaskade — als Datensatzfeld, nicht als Kommentar. */
export const AUSGANG = Object.freeze({
  UEBERNAHME: 'uebernahme',
  REVIEW: 'review',
  KEIN_MATCH: 'kein_match',
  EINHEIT_UNGLEICH: 'einheit_ungleich',
  NAHE_BASIS: 'nahe_basis',
  OHNE_PREIS: 'ohne_preis',
});

export const VERFAHREN = 'Ratcliff/Obershelp auf normalisierten Kurztexten (difflib-deckungsgleich)';

// Rundung wie Python (halb zur geraden Zahl) — die eingefrorenen sim/ratio-Werte
// sind so geschrieben. Siehe `textMatch.runde`.
const r2 = (n) => runde(n, 2);

/**
 * Die Regelzeile mit den Schwellen aus dem Katalog holen.
 *
 * FEHLT sie, wird NICHT geraten: `fehlt: true` und die Kaskade übernimmt nichts.
 * Ein Default im Code wäre die schlimmste Variante — er sähe aus wie eine
 * gepflegte Schwelle und wäre eine geratene.
 *
 * @param {Array<object>} katalogZeilen Katalog `PreisUebernahmeRegel`
 * @param {string} [von] Quellenart der Regelzeile
 */
export function schwellenAus(katalogZeilen = [], von = 'referenz_projekt') {
  const z = (katalogZeilen || []).find((r) => r?.von === von && r?.min_similarity != null);
  if (!z) {
    return { fehlt: true, grund: `Katalog PreisUebernahmeRegel enthält keine Zeile "von: ${von}" mit Schwellen` };
  }
  return {
    fehlt: false,
    einheit_muss_gleich: z.einheit_muss_gleich !== false,
    min_similarity: z.min_similarity,
    review_von: z.review_von,
    ratio_min: z.ratio_min,
    ratio_max: z.ratio_max,
    verwerfen_wenn_nahe_basis: z.verwerfen_wenn_nahe_basis,
    verfahren: z.verfahren ?? VERFAHREN,
  };
}

/**
 * Kanonischer Einheitencode für den Vergleich — AUS DEM KATALOG.
 * Unbekannter Code ⇒ kleingeschrieben, wie in der Pipeline. Das ist bewusst
 * nachgiebig: ein unbekannter Code soll nicht zu „gleich" führen, aber auch nicht
 * zu einer Ausnahme.
 */
export function vergleichsEinheit(code, einheitenKatalog = []) {
  const c = code == null ? '' : String(code);
  const z = (einheitenKatalog || []).find((r) => r?.code === c);
  return String(z?.vergleich ?? c).toLowerCase();
}

/**
 * EINE Position gegen EINEN Fremdeintrag prüfen.
 *
 * @param {{oz?, kurztext?, title?, einheit?, unit?}} position eigene Position
 * @param {{kurz?, kurztext?, me?, einheit?, ep?}} fremd Eintrag aus dem Fremd-LV
 * @param {number|null} basisEp eigener Basispreis (Kostenanschlag) — Bezug für `ratio`
 * @param {object} schwellen aus `schwellenAus`
 * @param {Array<object>} einheitenKatalog
 * @returns {{ausgang: string, sim: number|null, ratio: number|null, ep: number|null,
 *            grund: string|null}}
 */
export function pruefePaar(position, fremd, basisEp, schwellen, einheitenKatalog = []) {
  if (schwellen?.fehlt) {
    return { ausgang: AUSGANG.KEIN_MATCH, sim: null, ratio: null, ep: null, grund: schwellen.grund };
  }
  const epRoh = fremd?.ep;
  const ep = epRoh == null || epRoh === '' ? null : Number(epRoh);
  if (ep == null || !Number.isFinite(ep) || ep === 0) {
    return { ausgang: AUSGANG.OHNE_PREIS, sim: null, ratio: null, ep: null, grund: 'Fremdeintrag ohne Einheitspreis' };
  }

  // Stufe 2 — Einheit.
  if (schwellen.einheit_muss_gleich) {
    const a = vergleichsEinheit(position?.einheit ?? position?.unit, einheitenKatalog);
    const b = vergleichsEinheit(fremd?.me ?? fremd?.einheit, einheitenKatalog);
    if (a !== b) {
      return {
        ausgang: AUSGANG.EINHEIT_UNGLEICH,
        sim: null,
        ratio: null,
        ep: null,
        grund: `Einheit "${position?.einheit ?? position?.unit}" ≠ "${fremd?.me ?? fremd?.einheit}" (kanonisch ${a} ≠ ${b})`,
      };
    }
  }

  // Stufe 3 — 1-%-Verwerfung gegen die eigene Basis.
  const basis = basisEp == null ? null : Number(basisEp);
  if (basis != null && Number.isFinite(basis) && basis !== 0) {
    if (Math.abs(ep - basis) / basis < schwellen.verwerfen_wenn_nahe_basis) {
      return {
        ausgang: AUSGANG.NAHE_BASIS,
        sim: null,
        ratio: null,
        ep: null,
        grund: `Fremdpreis liegt innerhalb der Verwerfungsschwelle um die Basis — die Indexfortschreibung bleibt die belastbarere Aussage`,
      };
    }
  }

  const sim = textRatio(position?.kurztext ?? position?.title, fremd?.kurz ?? fremd?.kurztext);
  const verhaeltnis = basis != null && Number.isFinite(basis) && basis !== 0 ? ep / basis : null;
  const imFenster = verhaeltnis == null
    || (verhaeltnis >= schwellen.ratio_min && verhaeltnis <= schwellen.ratio_max);

  const uebernehmen = sim >= schwellen.min_similarity && imFenster;
  const zurSichtung =
    (sim >= schwellen.review_von && sim < schwellen.min_similarity)
    || (verhaeltnis != null && !imFenster && sim >= schwellen.review_von);

  if (uebernehmen) {
    return { ausgang: AUSGANG.UEBERNAHME, sim, ratio: verhaeltnis, ep, grund: null };
  }
  if (zurSichtung) {
    return {
      ausgang: AUSGANG.REVIEW,
      sim,
      ratio: verhaeltnis,
      ep,
      grund: `sim=${sim.toFixed(2)}, ratio=${verhaeltnis == null ? 'null' : r2(verhaeltnis)}`,
    };
  }
  return {
    ausgang: AUSGANG.KEIN_MATCH,
    sim,
    ratio: verhaeltnis,
    ep,
    grund: `Ähnlichkeit ${sim.toFixed(2)} unter der Sichtungsschwelle`,
  };
}

/**
 * Die Ernte über ein ganzes Fremd-LV → Preisschichten + Bilanz.
 *
 * @param {{positionen: Array<object>, fremd: Object<string, object>,
 *          basis?: Object<string, {ep?: number}>, uebernahmeKatalog?: Array<object>,
 *          einheitenKatalog?: Array<object>, projekt_nr?: string,
 *          quelle?: string, stand?: string|null,
 *          schluessel?: (p: object) => string}} q
 * @returns {{schichten: Array<object>, bilanz: object, zeilen: Array<object>,
 *            warnungen: Array<string>}}
 */
export function ernte({
  positionen = [],
  fremd = {},
  basis = {},
  uebernahmeKatalog = [],
  einheitenKatalog = [],
  projekt_nr = null,
  quelle = null,
  stand = null,
  schluessel = null,
} = {}) {
  const schwellen = schwellenAus(uebernahmeKatalog);
  const key = schluessel || ((p) => `${p.gewerk_nr ?? p.trade_nr ?? p.trade ?? ''}|${p.oz ?? ''}`);
  const warnungen = [];
  if (schwellen.fehlt) warnungen.push(schwellen.grund);

  const bilanz = {
    positionen: (positionen || []).length,
    uebernommen: 0,
    review: 0,
    kein_match: 0,
    einheit_ungleich: 0,
    nahe_basis: 0,
    ohne_preis: 0,
  };
  const schichten = [];
  const zeilen = [];

  for (const p of positionen || []) {
    const k = key(p);
    const q = fremd?.[k];
    if (!q) {
      bilanz.kein_match += 1;
      continue;
    }
    const basisEp = basis?.[k]?.ep ?? null;
    const res = pruefePaar(p, q, basisEp, schwellen, einheitenKatalog);
    const zaehler = {
      [AUSGANG.UEBERNAHME]: 'uebernommen',
      [AUSGANG.REVIEW]: 'review',
      [AUSGANG.KEIN_MATCH]: 'kein_match',
      [AUSGANG.EINHEIT_UNGLEICH]: 'einheit_ungleich',
      [AUSGANG.NAHE_BASIS]: 'nahe_basis',
      [AUSGANG.OHNE_PREIS]: 'ohne_preis',
    }[res.ausgang];
    if (zaehler) bilanz[zaehler] += 1;

    zeilen.push({
      position_id: p.id ?? k,
      oz: p.oz ?? null,
      kurztext: p.kurztext ?? p.title ?? null,
      fremd_kurztext: q.kurz ?? q.kurztext ?? null,
      ausgang: res.ausgang,
      sim: res.sim == null ? null : r2(res.sim),
      ratio: res.ratio == null ? null : r2(res.ratio),
      ep: res.ep,
      basis_ep: basisEp,
      grund: res.grund,
    });

    if (res.ausgang !== AUSGANG.UEBERNAHME && res.ausgang !== AUSGANG.REVIEW) continue;

    const istReview = res.ausgang === AUSGANG.REVIEW;
    schichten.push({
      position_id: p.id ?? k,
      art: 'referenzprojekt',
      ep: r2(res.ep),
      stand,
      // `review.flag` ⇒ sichtbar, aber die Schicht wird von `priceStack` NICHT
      // aktiv geschaltet. Genau das ist der Unterschied zwischen „gesehen" und
      // „übernommen".
      review: istReview ? { flag: true, grund: res.grund } : { flag: false, grund: null },
      match: {
        similarity: res.sim == null ? null : r2(res.sim),
        ratio: res.ratio == null ? null : r2(res.ratio),
        verfahren: schwellen.verfahren,
        normalisierung_eigen: normalisiere(p.kurztext ?? p.title),
        normalisierung_fremd: normalisiere(q.kurz ?? q.kurztext),
      },
      herkunft: {
        typ: 'referenzprojekt',
        projekt_nr,
        quelle_oz: q.oz ?? p.oz ?? null,
        beleg: istReview
          ? `${quelle ?? projekt_nr ?? 'Fremdprojekt'} — SICHTUNG`
          : quelle ?? `Referenzprojekt ${projekt_nr ?? ''}`.trim(),
      },
    });
  }

  return { schichten, bilanz, zeilen, warnungen };
}
