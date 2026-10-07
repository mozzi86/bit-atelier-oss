// Katalog-Resolver (Phase 33 / W0) — eingebaute Defaults + DB-Override.
//
// Isomorph: keine Aliase, kein window, kein fetch beim Import. Wer DB-Werte will,
// übergibt sie als Snapshot (`{ Din276Katalog: [...], ... }`) — dieses Modul holt
// nichts selbst. So ist es in `node --test` genauso lauffähig wie im Browser.
//
// Der PREISINDEX wird immer GERECHNET, nie gespeichert:
//   indexFaktor(reihe, "2020-11", "2026-05") = wert(bis) / wert(von)
// Eine magische Konstante 1,48 im Code wäre ein Fehler — sie würde beim Editieren
// der Reihe still falsch bleiben.

const DEFAULT_STATUS = [
  { intern: 'bestand', pipeline: 'Bestand', ifc_enum: 'EXISTING', aliase: ['bestand', 'Bestand', 'EXISTING', 'existing'] },
  { intern: 'neubau', pipeline: 'Neubau', ifc_enum: 'NEW', aliase: ['neubau', 'Neubau', 'NEW', 'new'] },
  { intern: 'abbruch', pipeline: 'Abbruch', ifc_enum: 'DEMOLISH', aliase: ['abbruch', 'Abbruch', 'DEMOLISH', 'demolish'] },
  { intern: null, pipeline: '?', ifc_enum: null, aliase: ['?', '', 'unbekannt', 'unknown'] },
];

/**
 * Ein Katalog aus dem Snapshot, sonst die eingebauten Defaults.
 * Projekt-Overrides (`projekt_override_id === projektId`) verdrängen den
 * büroweiten Eintrag mit gleichem Schlüssel.
 */
export function katalog(snapshot, entity, { projektId = null, key = null } = {}) {
  const rows = Array.isArray(snapshot?.[entity]) ? snapshot[entity] : [];
  if (rows.length === 0) return [];
  if (!projektId || !key) return rows;

  const overrides = new Map();
  for (const r of rows) {
    if (r?.projekt_override_id && r.projekt_override_id === projektId) {
      overrides.set(r[key], r);
    }
  }
  if (overrides.size === 0) return rows.filter((r) => !r?.projekt_override_id);
  return rows
    .filter((r) => !r?.projekt_override_id)
    .map((r) => overrides.get(r[key]) || r)
    .concat([...overrides.values()].filter((o) => !rows.some((r) => !r?.projekt_override_id && r[key] === o[key])));
}

/** Status auf die interne Schreibweise normalisieren — die EINE Stelle (T-33-04). */
export function normalisiereStatus(wert, snapshot = null) {
  const tabelle = Array.isArray(snapshot?.StatusKonvention) && snapshot.StatusKonvention.length
    ? snapshot.StatusKonvention
    : DEFAULT_STATUS;
  const v = wert == null ? '' : String(wert).trim();
  for (const row of tabelle) {
    const aliase = (row.aliase || []).map((a) => (a == null ? '' : String(a)));
    if (aliase.includes(v)) return row.intern;
    if (String(row.intern) === v || String(row.pipeline) === v) return row.intern;
  }
  return null;
}

/** Interne Schreibweise → Schreibweise der Pipeline ("Bestand"/"Neubau"/"Abbruch"/"?"). */
export function statusFuerPipeline(intern, snapshot = null) {
  const tabelle = Array.isArray(snapshot?.StatusKonvention) && snapshot.StatusKonvention.length
    ? snapshot.StatusKonvention
    : DEFAULT_STATUS;
  const row = tabelle.find((r) => r.intern === intern);
  return row ? row.pipeline : '?';
}

// --- Preisindex ------------------------------------------------------------

/** Periode "YYYY-MM" → vergleichbare Zahl. */
function periodeZahl(p) {
  const m = /^(\d{4})-(\d{1,2})$/.exec(String(p || '').trim());
  if (!m) return null;
  return Number(m[1]) * 12 + (Number(m[2]) - 1);
}

/**
 * Indexwert zu einer Periode. Zwischen zwei Punkten wird LINEAR interpoliert,
 * außerhalb der Reihe wird auf den Rand geklemmt (und das gemeldet).
 * @returns {{wert: number|null, exakt: boolean, warnung: string|null, prognose: boolean}}
 */
export function indexWert(reihe, periode) {
  const punkte = (reihe?.punkte || [])
    .map((p) => ({ ...p, z: periodeZahl(p.periode) }))
    .filter((p) => p.z != null && typeof p.wert === 'number')
    .sort((a, b) => a.z - b.z);
  const z = periodeZahl(periode);
  if (punkte.length === 0) return { wert: null, exakt: false, warnung: 'Preisindexreihe hat keine Punkte', prognose: false };
  if (z == null) return { wert: null, exakt: false, warnung: `Periode "${periode}" nicht lesbar (erwartet YYYY-MM)`, prognose: false };

  const exakt = punkte.find((p) => p.z === z);
  if (exakt) return { wert: exakt.wert, exakt: true, warnung: null, prognose: Boolean(exakt.prognose) };

  if (z < punkte[0].z) {
    return { wert: punkte[0].wert, exakt: false, prognose: Boolean(punkte[0].prognose), warnung: `Periode ${periode} liegt vor dem ersten Punkt (${punkte[0].periode}) — geklemmt` };
  }
  const letzter = punkte[punkte.length - 1];
  if (z > letzter.z) {
    return { wert: letzter.wert, exakt: false, prognose: true, warnung: `Periode ${periode} liegt nach dem letzten Punkt (${letzter.periode}) — geklemmt, Prognose` };
  }
  let lo = punkte[0];
  let hi = letzter;
  for (let i = 0; i < punkte.length - 1; i += 1) {
    if (punkte[i].z <= z && z <= punkte[i + 1].z) {
      lo = punkte[i];
      hi = punkte[i + 1];
      break;
    }
  }
  const t = (z - lo.z) / (hi.z - lo.z);
  return {
    wert: lo.wert + t * (hi.wert - lo.wert),
    exakt: false,
    prognose: Boolean(lo.prognose || hi.prognose),
    warnung: `Periode ${periode} zwischen ${lo.periode} und ${hi.periode} — linear interpoliert`,
  };
}

/**
 * Preisindex-Faktor = wert(bis) / wert(von). GERECHNET, nie gespeichert.
 * @returns {{faktor: number|null, von: *, bis: *, von_wert: number|null,
 *            bis_wert: number|null, prognose: boolean, assumed: boolean,
 *            warnungen: string[]}}
 */
export function indexFaktor(reihe, von, bis) {
  const a = indexWert(reihe, von);
  const b = indexWert(reihe, bis);
  const warnungen = [a.warnung, b.warnung].filter(Boolean);
  if (reihe?.assumed) {
    warnungen.push(
      reihe.assumed_hinweis ||
        '[ASSUMED] Indexreihe nicht gegen destatis geprüft — als Preisstand sichtbar ausweisen.'
    );
  }
  if (a.wert == null || b.wert == null || a.wert === 0) {
    return {
      faktor: null,
      von,
      bis,
      von_wert: a.wert,
      bis_wert: b.wert,
      prognose: false,
      assumed: Boolean(reihe?.assumed),
      warnungen: [...warnungen, 'Faktor nicht berechenbar'],
    };
  }
  return {
    faktor: b.wert / a.wert,
    von,
    bis,
    von_wert: a.wert,
    bis_wert: b.wert,
    prognose: a.prognose || b.prognose,
    assumed: Boolean(reihe?.assumed),
    warnungen,
  };
}
