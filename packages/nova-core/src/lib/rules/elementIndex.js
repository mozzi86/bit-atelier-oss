// Element-Index und Gruppensicht (Phase 33 / W1).
//
// Warum ein Vorindex: 497 Regeln × 6.038 Elemente ≈ 3 Mio. Prüfungen. Fast jede
// Regel legt `klasse` UND `status` fest — beides sind exakte Gleichheitsvergleiche.
// Ein Bucket-Index auf `ifc_klasse|status` schneidet den Suchraum vor dem teuren
// Muster-Matching drastisch zusammen.
//
// Gruppensicht (Feinaggregat): Schlüssel `ifc_klasse|status|(typ ?? name).slice(0,60)`.
// **material und geschosse sind HISTOGRAMME, nie Einzelwerte** — eine Gruppe enthält
// in der Regel mehrere Materialien und Geschosse; ein Einzelwert wäre schlicht falsch
// und würde jeden Material-Filter auf Gruppenebene verfälschen.
//
// Isomorph: kein window, kein DOMParser, keine Aliase.

/** Status-Schlüssel wie im Orakel: `e.status || '?'` (null/'' → '?'). */
export function statusKey(el) {
  return el?.status || '?';
}

/** Bucket-Schlüssel des Vorindex. */
export function bucketKey(klasse, status) {
  return `${klasse ?? ''}|${status ?? '?'}`;
}

/** Der Text, gegen den `typ`/`name`-Muster prüfen: `(typ||'') + '|' + (name||'')`.
 *  Im Referenzprojekt ist `typ` durchweg null — die Unterscheidung steckt im Namen. */
export function typNameText(el) {
  return `${el?.typ || ''}|${el?.name || ''}`;
}

/** Gruppenschlüssel der Gruppensicht. `typ ?? name`, auf 60 Zeichen gekürzt. */
export const GRUPPEN_KUERZUNG = 60;
export function gruppenKey(el) {
  const t = String(el?.typ ?? el?.name ?? '');
  return `${el?.klasse ?? ''}|${statusKey(el)}|${t.slice(0, GRUPPEN_KUERZUNG)}`;
}

/**
 * Bauteilwahrheit aus dem IFC-Import (`ifc_klasse` + interner Status) → die Elementform,
 * auf der die Engine rechnet (`klasse` + Status in Pipeline-Schreibweise). Phase 33 / W2.
 *
 * Warum ein Adapter statt „einfach dasselbe Feld": die Regeln des Realprojekts sind in
 * Pipeline-Schreibweise formuliert (`status: "Abbruch"`), die Bauteilwahrheit führt den
 * Status intern klein und `null` für „nicht belegt". Die Umrechnung passiert genau HIER
 * und ausschließlich über den Katalog `StatusKonvention` — kein zweiter Mappingpfad
 * (T-33-04). Ein `null`-Status wird zu `'?'`, genau wie im Orakel.
 *
 * @param {Array} elemente Ausgabe von `extractFromModel(...).elements`
 * @param {(intern: string|null) => string} statusNachPipeline Regel aus `kataloge.js`
 */
export function zuEngineElemente(elemente = [], statusNachPipeline = null) {
  const nachPipeline = typeof statusNachPipeline === 'function'
    ? statusNachPipeline
    : (s) => s ?? '?';
  return (elemente || []).map((e) => ({
    guid: e?.guid ?? e?.id ?? null,
    klasse: e?.ifc_klasse ?? e?.klasse ?? '',
    status: e?.status == null ? '?' : nachPipeline(e.status),
    name: e?.name ?? null,
    typ: e?.typ ?? null,
    material: e?.material ?? null,
    geschoss: e?.geschoss ?? null,
    qty: e?.qty || {},
  }));
}

/**
 * Baut den Vorindex.
 * @param {Array} elemente
 * @returns {{alle: Array, buckets: Map<string, Array>, klassen: Set, status: Set,
 *            kandidaten: (klasse?, status?) => Array}}
 */
export function buildIndex(elemente = []) {
  const alle = Array.isArray(elemente) ? elemente : [];
  const buckets = new Map();
  const klassen = new Set();
  const statusSet = new Set();

  for (const el of alle) {
    const k = el?.klasse ?? '';
    const s = statusKey(el);
    klassen.add(k);
    statusSet.add(s);
    const key = bucketKey(k, s);
    let b = buckets.get(key);
    if (!b) {
      b = [];
      buckets.set(key, b);
    }
    b.push(el);
  }

  /**
   * Kandidatenmenge für eine (klasse, status)-Kombination.
   * Fehlt eine Achse (null/undefined), wird über sie NICHT eingeschränkt.
   */
  function kandidaten(klasse, status) {
    if (klasse && status) return buckets.get(bucketKey(klasse, status)) || [];
    if (klasse) {
      const out = [];
      for (const s of statusSet) {
        const b = buckets.get(bucketKey(klasse, s));
        if (b) out.push(...b);
      }
      return out;
    }
    if (status) {
      const out = [];
      for (const k of klassen) {
        const b = buckets.get(bucketKey(k, status));
        if (b) out.push(...b);
      }
      return out;
    }
    return alle;
  }

  return { alle, buckets, klassen, status: statusSet, kandidaten };
}

/** Bucket für „Wert fehlt" in den Histogrammen. Ein fehlender Wert wird GEZÄHLT,
 *  nicht weggelassen — sonst summieren sich die Histogramme nicht auf `count`
 *  und „8 Träger ohne Material" verschwindet spurlos. Entspricht der Konvention
 *  des eingefrorenen Feinaggregats. */
export const OHNE_WERT = '-';

/**
 * Gruppensicht (Feinaggregat).
 * @returns {Object<string, {count, qty, material, geschosse}>}
 *          material/geschosse sind Histogramme: { wert: anzahl }.
 *          Σ der Histogramm-Werte == count (fehlende Werte unter OHNE_WERT).
 */
export function gruppiere(elemente = []) {
  const out = {};
  for (const el of elemente || []) {
    const key = gruppenKey(el);
    let g = out[key];
    if (!g) {
      g = { count: 0, qty: {}, material: {}, geschosse: {} };
      out[key] = g;
    }
    g.count += 1;
    const qty = el?.qty || {};
    for (const [k, v] of Object.entries(qty)) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        g.qty[k] = (g.qty[k] || 0) + v;
      }
    }
    const mat = el?.material || OHNE_WERT;
    g.material[mat] = (g.material[mat] || 0) + 1;
    const ges = el?.geschoss || OHNE_WERT;
    g.geschosse[ges] = (g.geschosse[ges] || 0) + 1;
  }
  // Mengen erst am Ende runden (Zwischensummen bleiben voll genau).
  for (const g of Object.values(out)) {
    for (const k of Object.keys(g.qty)) {
      g.qty[k] = Math.round(g.qty[k] * 100) / 100;
    }
  }
  return out;
}

/**
 * Deckung in BEIDE Richtungen — wird in W5 (Plan 33-03) von `deckung.js` genutzt.
 * @param {Array} elemente
 * @param {Set<string>|Array<string>} gedeckteGuids GUIDs, die eine Position trägt
 * @returns {{gruppen_ohne_position: Array, gruppen_teilweise: Array,
 *            elemente_ohne_position: number, je_status: Object}}
 */
export function deckung(elemente = [], gedeckteGuids = []) {
  const cov = gedeckteGuids instanceof Set ? gedeckteGuids : new Set(gedeckteGuids);
  const gruppen = {};
  const je_status = {};

  for (const el of elemente || []) {
    const key = gruppenKey(el);
    const g = (gruppen[key] ||= { key, elemente: 0, gedeckt: 0 });
    g.elemente += 1;
    const s = statusKey(el);
    const st = (je_status[s] ||= { elemente: 0, gedeckt: 0 });
    st.elemente += 1;
    if (cov.has(el?.guid)) {
      g.gedeckt += 1;
      st.gedeckt += 1;
    }
  }

  for (const st of Object.values(je_status)) {
    st.deckung_prozent = st.elemente ? Math.round((st.gedeckt / st.elemente) * 1000) / 10 : 0;
  }

  const alle = Object.values(gruppen);
  return {
    gruppen_gesamt: alle.length,
    gruppen_ohne_position: alle.filter((g) => g.gedeckt === 0),
    gruppen_teilweise: alle.filter((g) => g.gedeckt > 0 && g.gedeckt < g.elemente),
    gruppen_voll: alle.filter((g) => g.gedeckt === g.elemente).length,
    elemente_ohne_position: (elemente || []).filter((e) => !cov.has(e?.guid)).length,
    je_status,
  };
}
