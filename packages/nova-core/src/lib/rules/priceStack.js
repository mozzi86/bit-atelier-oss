// Preisstapel — Rangfolge, aktive Schicht und die BERECHNETE Index-Schicht.
// Phase 33 / W4 (Plan 33-03, ENGINE-05).
//
// Warum ein Stapel und kein Feld: ein Einheitspreis hat eine HERKUNFT. „18.000 €"
// aus dem Kostenanschlag 2020, „3.800 €" aus einer Marktrecherche 07/2026 und
// „25 €" aus einem eigenen Referenzprojekt sind drei verschiedene Aussagen mit
// drei verschiedenen Belastbarkeiten. Ein einzelnes `unit_price`-Feld kann das
// nicht tragen — es kann nur die letzte Überschreibung behalten und vergisst,
// woher sie kam. Deshalb: je Position n Schichten, jede mit `art`, `stand`,
// `herkunft`; der angezeigte Preis ist die AKTIVE Schicht = höchster Rang mit
// `ep != null` und `review.flag !== true`.
//
// Die Index-Schicht ist der Kern: ihr `ep` wird bei JEDEM Zugriff aus der
// Basis-Schicht und zwei Punkten der Preisindexreihe GERECHNET und NIEMALS
// persistiert. Nur so gilt die eine Excel-Eigenschaft, auf die es fachlich
// ankommt: ein Datum ändern ⇒ alle indexbasierten Einheitspreise rechnen nach.
// Würde der Wert gespeichert, wäre der Preisstand-Regler eine Attrappe.
//
// Rangfolge kommt aus dem Katalog `PreisRangfolge` (büroweit pflegbar), NICHT
// aus einer if/elif-Kaskade im Code. Ein Büro, das Referenzpreise über
// STLB-Richtwerte stellen will, ändert eine Katalogzeile, keinen Quelltext.
//
// Isomorph: kein window, kein DOMParser, keine Aliase.

import { indexFaktor as indexFaktorDetail } from '../kataloge.js';

/** Kaufmännische Rundung auf Cent. Bewusst `Math.round` (Repo-Konvention aus W1). */
export function round2(n) {
  if (n == null || !Number.isFinite(Number(n))) return null;
  return Math.round(Number(n) * 100) / 100;
}

/**
 * Rangfolge-Nachschlagewerk aus den Katalogzeilen `PreisRangfolge`.
 * Höherer `rang` = stärkere Aussage.
 * @param {Array<{art:string, rang:number, name?:string, beleg_pflicht?:boolean,
 *                ep_berechnet?:boolean, eingefroren?:boolean}>} rows
 * @returns {{byArt: Map<string, object>, arten: string[], leer: boolean}}
 */
export function rangfolge(rows = []) {
  const byArt = new Map();
  for (const r of rows || []) {
    if (!r || typeof r.art !== 'string') continue;
    if (typeof r.rang !== 'number') continue;
    byArt.set(r.art, r);
  }
  const arten = [...byArt.keys()].sort((a, b) => byArt.get(b).rang - byArt.get(a).rang);
  return { byArt, arten, leer: byArt.size === 0 };
}

/**
 * Rang einer Art. Fehlt die Art im Katalog, gibt es KEINEN stillen Default —
 * `null` + Warnung, sonst rutscht eine unbekannte Art unsichtbar an das Ende
 * oder (schlimmer) an die Spitze der Rangfolge.
 */
export function rangVon(art, rf) {
  const eintrag = rf?.byArt?.get(art);
  return eintrag && typeof eintrag.rang === 'number' ? eintrag.rang : null;
}

/**
 * Preisindex-Faktor als ZAHL: `wert(bis) / wert(von)`, aus den Punkten der Reihe
 * gerechnet. Für Warnungen/Prognose-Flags `indexFaktorDetail` nutzen.
 * @returns {number|null}
 */
export function indexFaktor(reihe, von, bis) {
  const d = indexFaktorDetail(reihe, von, bis);
  return d?.faktor == null ? null : d.faktor;
}

export { indexFaktorDetail };

/** Reihe zu einer `reihe_id` finden — akzeptiert Map, Objekt oder Array. */
function reiheAus(reihen, id) {
  if (!reihen) return null;
  if (reihen instanceof Map) return reihen.get(id) || null;
  if (Array.isArray(reihen)) {
    return reihen.find((r) => r?.id === id || r?.reihe === id || r?.key === id) || null;
  }
  if (typeof reihen === 'object') return reihen[id] || null;
  return null;
}

/**
 * Der Einheitspreis EINER Schicht — mit Begründung, warum er ggf. `null` ist.
 *
 * Literalschichten liefern ihr `ep`. Die Index-Schicht rechnet:
 * `round2(basis.ep × indexFaktor(reihe, von, bis))`. Fehlt die Basis-Schicht
 * oder die Reihe, ist das Ergebnis `null` MIT Warnung — nie eine stille 0.
 * Eine 0 wäre hier fatal: sie sieht im Kostenanschlag wie ein belegter
 * Nullpreis aus und senkt die Summe, statt eine Lücke zu zeigen.
 *
 * @param {object} s Schicht
 * @param {Array<object>} schichten alle Schichten der Position (für die Basis)
 * @param {object|Map|Array} reihen Preisindexreihen, nach `reihe_id` auffindbar
 * @returns {{ep: number|null, berechnet: boolean, faktor: number|null,
 *            prognose: boolean, assumed: boolean, warnungen: string[],
 *            formel: string|null}}
 */
export function epDerSchichtDetail(s, schichten = [], reihen = null) {
  const warnungen = [];
  if (!s || typeof s !== 'object') {
    return { ep: null, berechnet: false, faktor: null, prognose: false, assumed: false, warnungen: ['Schicht fehlt'], formel: null };
  }
  if (s.art !== 'index') {
    const ep = s.ep == null ? null : Number(s.ep);
    return {
      ep: ep == null || !Number.isFinite(ep) ? null : ep,
      berechnet: false,
      faktor: null,
      prognose: false,
      assumed: false,
      warnungen,
      formel: null,
    };
  }
  // --- Index-Schicht: GERECHNET, nie gespeichert -------------------------
  if (s.ep != null) {
    // Defensive: ein persistierter Index-`ep` würde den Preisstand-Regler
    // wirkungslos machen (T-33-16). Er wird IGNORIERT und gemeldet.
    warnungen.push(
      'Index-Schicht trägt ein persistiertes `ep` — es wird ignoriert und neu gerechnet. ' +
        'Der ep einer Index-Schicht darf nicht gespeichert werden (T-33-16).'
    );
  }
  const basisId = s.basis?.schicht_id ?? null;
  const basis = (schichten || []).find((x) => x?.id === basisId) || null;
  if (!basis) {
    warnungen.push(`Index-Schicht ohne auffindbare Basis-Schicht (basis.schicht_id = ${JSON.stringify(basisId)})`);
    return { ep: null, berechnet: true, faktor: null, prognose: false, assumed: false, warnungen, formel: null };
  }
  if (basis.ep == null) {
    warnungen.push('Basis-Schicht der Index-Schicht hat keinen ep — Indexpreis nicht ermittelbar');
    return { ep: null, berechnet: true, faktor: null, prognose: false, assumed: false, warnungen, formel: null };
  }
  const reihe = reiheAus(reihen, s.basis?.reihe_id);
  if (!reihe) {
    warnungen.push(`Preisindexreihe "${s.basis?.reihe_id}" nicht gefunden — Indexpreis nicht ermittelbar`);
    return { ep: null, berechnet: true, faktor: null, prognose: false, assumed: false, warnungen, formel: null };
  }
  const d = indexFaktorDetail(reihe, s.basis?.von, s.basis?.bis);
  warnungen.push(...(d.warnungen || []));
  if (d.faktor == null) {
    return { ep: null, berechnet: true, faktor: null, prognose: Boolean(d.prognose), assumed: Boolean(d.assumed), warnungen, formel: null };
  }
  return {
    ep: round2(Number(basis.ep) * d.faktor),
    berechnet: true,
    faktor: d.faktor,
    prognose: Boolean(d.prognose),
    assumed: Boolean(d.assumed),
    warnungen,
    // Statt einer nackten Zahl zeigt die UI die Rechnung — sonst ist nicht
    // erkennbar, dass hier nichts belegt, sondern hochgerechnet ist.
    formel: `${round2(Number(basis.ep))} € × ${d.faktor.toFixed(4)} (${s.basis?.von} → ${s.basis?.bis})`,
  };
}

/** Kurzform (Plan-Signatur): nur der Preis. */
export function epDerSchicht(s, schichten = [], reihen = null) {
  return epDerSchichtDetail(s, schichten, reihen).ep;
}

/**
 * Alle Schichten einer Position bewerten: Rang, effektiver ep, Blockadegrund.
 * Reihenfolge der Rückgabe = absteigender Rang (stärkste Aussage zuerst).
 */
export function bewerteSchichten(schichten = [], { reihen = null, rangfolge: rf = null } = {}) {
  const rfo = rf && rf.byArt ? rf : rangfolge(Array.isArray(rf) ? rf : []);
  const out = (schichten || []).map((s) => {
    const d = epDerSchichtDetail(s, schichten, reihen);
    const rang = rangVon(s?.art, rfo);
    const gesperrt = s?.review?.flag === true;
    let grund = null;
    if (rang == null) grund = `Art "${s?.art}" ist im Katalog PreisRangfolge nicht geführt`;
    else if (gesperrt) grund = s?.review?.grund ? `Review: ${s.review.grund}` : 'Review-Markierung gesetzt';
    else if (d.ep == null) grund = 'kein ep';
    return {
      ...s,
      rang,
      ep_effektiv: d.ep,
      ep_berechnet: d.berechnet,
      index_faktor: d.faktor,
      index_formel: d.formel,
      prognose: d.prognose,
      assumed: d.assumed,
      warnungen: d.warnungen,
      review_sperre: gesperrt,
      nicht_aktiv_grund: grund,
      waehlbar: rang != null && !gesperrt && d.ep != null,
    };
  });
  out.sort((a, b) => (b.rang ?? -Infinity) - (a.rang ?? -Infinity));
  return out;
}

/**
 * Aktive Schicht = höchster Rang mit `ep != null` UND `review.flag !== true`.
 *
 * `review.flag` ist kein Löschen: die Schicht bleibt sichtbar (Historie, Sichtung),
 * sie trägt nur nicht den Preis. Ein „schlechter" Referenzpreis, der still
 * verschwindet, kommt beim nächsten Import unbemerkt zurück.
 *
 * @returns {{schicht: object|null, ep: number|null, rang: number|null,
 *            art: string|null, alle: Array<object>, warnungen: string[]}}
 */
export function aktiveSchicht(schichten = [], reihen = null, rf = null) {
  const bewertet = bewerteSchichten(schichten, { reihen, rangfolge: rf });
  const treffer = bewertet.find((s) => s.waehlbar) || null;
  const warnungen = [];
  for (const s of bewertet) {
    if (s.rang == null) warnungen.push(s.nicht_aktiv_grund);
  }
  if (bewertet.length > 0 && !treffer) {
    warnungen.push('Keine wählbare Preisschicht — Position bleibt ohne Einheitspreis (unit_price null, NICHT 0)');
  }
  if (treffer) warnungen.push(...(treffer.warnungen || []));
  return {
    schicht: treffer,
    ep: treffer ? treffer.ep_effektiv : null,
    rang: treffer ? treffer.rang : null,
    art: treffer ? treffer.art : null,
    alle: bewertet,
    warnungen: [...new Set(warnungen.filter(Boolean))],
  };
}

/**
 * Wächter für den Schreibpfad: an einer `art:"index"`-Schicht darf kein `ep`
 * persistiert werden. Liefert die Verstöße, damit der Aufrufer sie MELDEN
 * statt still zu reparieren.
 */
export function pruefeKeinIndexEp(schichten = []) {
  return (schichten || [])
    .filter((s) => s?.art === 'index' && s?.ep != null)
    .map((s) => ({ id: s.id ?? null, position_id: s.position_id ?? null, ep: s.ep }));
}

/** Schicht ohne den berechneten `ep` — genau die Form, die persistiert wird. */
export function zumSpeichern(s) {
  if (!s || typeof s !== 'object') return s;
  const kopie = { ...s };
  if (kopie.art === 'index') delete kopie.ep;
  delete kopie.rang;
  delete kopie.ep_effektiv;
  delete kopie.ep_berechnet;
  delete kopie.index_faktor;
  delete kopie.index_formel;
  delete kopie.nicht_aktiv_grund;
  delete kopie.review_sperre;
  delete kopie.waehlbar;
  delete kopie.warnungen;
  delete kopie.prognose;
  delete kopie.assumed;
  return kopie;
}
