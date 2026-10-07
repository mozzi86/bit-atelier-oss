// Preisschichten — kaufmännische Fachlichkeit über dem Rechenkern.
// Phase 33 / W4 (Plan 33-03, ENGINE-05).
//
// Der Rechenkern (`@core/lib/rules/priceStack.js`) beantwortet EINE Frage:
// welcher Preis gilt? Hier kommt das Kaufmännische dazu:
//
//  * die 9 Arten mit ihrer Semantik (was darf ein Nutzer damit tun),
//  * die Kennzahlen — BERECHNET, nie gespeichert,
//  * die EHRLICHKEITSREGEL: ist die aktive Schicht selbst `index`, dann ist die
//    Ampel „Δ EP vs. Index" bedeutungslos (sie vergleicht den Index mit sich
//    selbst) und liefert `"n/a"` mit Grund — NICHT grün. Grün wäre eine
//    Behauptung („geprüft, unauffällig"), wo nichts geprüft wurde. Das betrifft
//    im Realprojekt 495 von 497 Positionen; ein grünes Feld dort wäre die
//    teuerste Lüge im ganzen Programm.
//  * die DOPPELZÄHLUNGSSPERRE: `im_vertrag_enthalten:true` ⇒ GB 0 an der
//    Position, die Summe trägt der Vertrag. Und zwar je POSITION, niemals
//    pauschal je Gewerk — das Auftrags-LV lebt in einem EIGENEN OZ-Raum, ein
//    OZ-Join erzeugt falsche Nullen.
//  * `neueSchicht`: Bearbeiten erzeugt eine NEUE Schicht mit `ersetzt_id`.
//    Historie ohne Löschen — ein überschriebener Preis ist ein verlorener Beleg.
//
// Marktpreise und Indexwerte sind DATEN (Schicht bzw. Katalog), nicht Code.
// Diese Datei enthält deshalb keine einzige €- oder Faktor-Konstante.
//
// Isomorph: kein window, kein DOMParser, keine App-Aliase.

import {
  aktiveSchicht,
  bewerteSchichten,
  epDerSchichtDetail,
  rangfolge,
  round2,
} from '@core/lib/rules/priceStack.js';

/**
 * Die 9 Arten mit ihrer Bedienungs-Semantik. Rang und Belastbarkeit stehen im
 * Katalog `PreisRangfolge` (büroweit pflegbar) — HIER steht nur, was die UI mit
 * einer Art tun darf. Beides zu mischen wäre der Anfang vom Ende der
 * Pflegbarkeit.
 */
export const ARTEN = Object.freeze({
  schlussrechnung: { label: 'Schlussrechnung', beleg_pflicht: true, editierbar: false, eingefroren: false, berechnet: false, hinweis: 'Geprüfte Schlussrechnung — stärkste Aussage.' },
  nachtrag: { label: 'Nachtrag', beleg_pflicht: true, editierbar: false, eingefroren: false, berechnet: false, hinweis: 'Beauftragter Nachtrag (ChangeOrder.na_nr).' },
  vertrag: { label: 'Vertragspreis', beleg_pflicht: true, editierbar: false, eingefroren: false, berechnet: false, hinweis: 'Aus VertragsPosition — EIGENER OZ-Raum, nur über gepflegte Zuordnung.' },
  angebot: { label: 'Angebot', beleg_pflicht: true, editierbar: true, eingefroren: false, berechnet: false, hinweis: 'Angebotspreis eines Bieters.' },
  markt: { label: 'Marktpreis', beleg_pflicht: true, editierbar: true, eingefroren: false, berechnet: false, hinweis: 'Recherche mit Datum und Beleg. Der einzige Weg, einen Preis von Hand zu setzen.' },
  stlb: { label: 'STLB-Richtwert', beleg_pflicht: false, editierbar: true, eingefroren: false, berechnet: false, hinweis: 'Richtwert aus STLB-Bau/DBD.' },
  referenzprojekt: { label: 'Referenzprojekt', beleg_pflicht: true, editierbar: false, eingefroren: false, berechnet: false, hinweis: 'Eigenes Projekt, mit match{sim,ratio}. review.flag ⇒ sichtbar, aber nicht aktiv.' },
  index: { label: 'Indexfortschreibung', beleg_pflicht: false, editierbar: false, eingefroren: false, berechnet: true, hinweis: 'BERECHNET aus Basis × Indexfaktor. Wird nie gespeichert — ein Datum ändern lässt alle EPs nachrechnen.' },
  kostenanschlag: { label: 'Kostenanschlag (fix)', beleg_pflicht: false, editierbar: false, eingefroren: true, berechnet: false, hinweis: 'Dokumentenstand — wird NIE neu gerechnet. In der UI grau.' },
});

export const ARTEN_LISTE = Object.freeze(Object.keys(ARTEN));

/** Ampel-Kennung für „hier ist nichts zu vergleichen". Kein Grün, kein Leer. */
export const AMPEL_NA = 'n/a';
export const AMPEL_NA_GRUND = 'Index gegen Index';

/** Schwellen aus dem Katalog `AmpelSchwelle` lesen (Kontext `preisabweichung`). */
export function schwellenAus(ampelKatalog = [], kontext = 'preisabweichung') {
  const z = (ampelKatalog || []).find((r) => r?.kontext === kontext) || null;
  if (!z) {
    return { gruen_bis: null, gelb_bis: null, fehlt: true };
  }
  return { gruen_bis: z.gruen_bis, gelb_bis: z.gelb_bis, fehlt: false };
}

/** Ampelfarbe aus einem Betrag und den Katalogschwellen. */
export function ampelVon(wert, schwellen) {
  if (wert == null || !Number.isFinite(wert)) return null;
  if (schwellen?.fehlt || schwellen?.gruen_bis == null || schwellen?.gelb_bis == null) return null;
  const a = Math.abs(wert);
  if (a > schwellen.gelb_bis) return 'rot';
  if (a > schwellen.gruen_bis) return 'gelb';
  return 'gruen';
}

/** Die Index-Schicht einer Position (es gibt höchstens eine sinnvolle). */
export function indexSchichtVon(schichten = []) {
  return (schichten || []).find((s) => s?.art === 'index') || null;
}

/**
 * Die drei Kennzahlen einer Position — BERECHNET, nie gespeichert.
 *
 *  Δ Menge          = menge_final / menge_kostenanschlag − 1, NUR bei
 *                     modellbasierter Quelle (bei einer Pauschalposition wäre
 *                     die Zahl bedeutungslos).
 *  Δ EP vs. Index   = |ep_aktiv / ep_index − 1| — MENGENNEUTRAL. Das IST die
 *                     Ampel. Sie beantwortet: weicht der belegte Preis von der
 *                     bloßen Indexfortschreibung ab?
 *  Δ GB gesamt      = mischt Mengen- UND Preiseffekt — ausdrücklich nur
 *                     informativ, nie Ampel.
 *
 * @returns {{delta_menge: number|null,
 *            delta_ep_index: {wert: number|null, ampel: string|null, grund: string|null},
 *            delta_gb: number|null, ep_aktiv: number|null, ep_index: number|null,
 *            art_aktiv: string|null, schicht_aktiv: object|null, warnungen: string[]}}
 */
export function kennzahlen(position, schichten = [], reihen = null, schwellen = null, rf = null) {
  const rfo = rf && rf.byArt ? rf : rangfolge(Array.isArray(rf) ? rf : []);
  const aktiv = aktiveSchicht(schichten, reihen, rfo);
  const idxS = indexSchichtVon(schichten);
  const epIndex = idxS ? epDerSchichtDetail(idxS, schichten, reihen).ep : null;

  // --- Δ Menge ---------------------------------------------------------
  const mFinal = position?.menge_final ?? position?.quantity ?? null;
  const mKa = position?.menge_kostenanschlag ?? null;
  const modellbasiert = typeof position?.mengen_quelle === 'string'
    ? /^IFC/i.test(position.mengen_quelle)
    : position?.mengen_modus === 'filter';
  const delta_menge =
    modellbasiert && mFinal != null && mKa != null && Number(mKa) !== 0
      ? Number(mFinal) / Number(mKa) - 1
      : null;

  // --- Δ EP vs. Index (DIE Ampel) --------------------------------------
  let delta_ep_index;
  if (aktiv.art === 'index') {
    // EHRLICHKEITSREGEL (Pitfall 8): der Index mit sich selbst verglichen ist
    // immer 0 — das sähe grün aus und behauptete eine Prüfung, die nicht
    // stattgefunden hat. Deshalb ausdrücklich „n/a" mit Grund.
    delta_ep_index = { wert: null, ampel: AMPEL_NA, grund: AMPEL_NA_GRUND };
  } else if (aktiv.ep == null) {
    delta_ep_index = { wert: null, ampel: AMPEL_NA, grund: 'kein aktiver Einheitspreis' };
  } else if (epIndex == null || epIndex === 0) {
    delta_ep_index = { wert: null, ampel: AMPEL_NA, grund: 'kein Indexvergleichswert (keine Basis 2020)' };
  } else {
    const wert = aktiv.ep / epIndex - 1;
    delta_ep_index = { wert, ampel: ampelVon(wert, schwellen), grund: null };
    if (delta_ep_index.ampel == null) {
      delta_ep_index.ampel = AMPEL_NA;
      delta_ep_index.grund = 'Katalog AmpelSchwelle (preisabweichung) fehlt';
    }
  }

  // --- Δ GB gesamt (informativ) ----------------------------------------
  const gb2020 = position?.gb_kostenanschlag ?? null;
  const gbHeute = aktiv.ep != null && mFinal != null ? Number(mFinal) * aktiv.ep : null;
  const delta_gb =
    gbHeute != null && gb2020 != null && Number(gb2020) !== 0 && epIndex != null && position?.ep_kostenanschlag
      ? gbHeute / (Number(gb2020) * (epIndex / Number(position.ep_kostenanschlag))) - 1
      : null;

  return {
    delta_menge,
    delta_ep_index,
    delta_gb,
    ep_aktiv: aktiv.ep,
    ep_index: epIndex,
    art_aktiv: aktiv.art,
    schicht_aktiv: aktiv.schicht,
    warnungen: aktiv.warnungen,
  };
}

/**
 * Fortschrittszähler — KEIN Gütesiegel.
 *
 * `preisquelle_ueber_index` = Positionen, für die überhaupt eine Preisquelle
 * oberhalb des Index VORLIEGT (auch wenn sie gerade nicht aktiv ist, z. B. weil
 * eine Vertragssperre greift oder ein review.flag gesetzt ist).
 * `aktiv_ueber_index` = Positionen, bei denen so eine Quelle auch WIRKT.
 * Beide Zahlen werden getrennt geführt: sie sind verschieden, und der
 * Unterschied ist die Aussage.
 */
export function zaehler(positionen = [], schichtenJePosition = null, reihen = null, schwellen = null, rf = null) {
  const rfo = rf && rf.byArt ? rf : rangfolge(Array.isArray(rf) ? rf : []);
  const idxRang = rfo.byArt.get('index')?.rang ?? null;
  const out = {
    gesamt: 0,
    preisquelle_ueber_index: 0,
    aktiv_ueber_index: 0,
    ohne_preis: 0,
    ampel: { gruen: 0, gelb: 0, rot: 0, [AMPEL_NA]: 0 },
    je_art: {},
  };
  for (const p of positionen || []) {
    out.gesamt += 1;
    const sch = typeof schichtenJePosition === 'function'
      ? schichtenJePosition(p) || []
      : (schichtenJePosition?.[p?.id] || p?.schichten || []);
    const bewertet = bewerteSchichten(sch, { reihen, rangfolge: rfo });
    if (idxRang != null && bewertet.some((s) => s.rang != null && s.rang > idxRang && s.ep_effektiv != null)) {
      out.preisquelle_ueber_index += 1;
    }
    const k = kennzahlen(p, sch, reihen, schwellen, rfo);
    if (k.art_aktiv) out.je_art[k.art_aktiv] = (out.je_art[k.art_aktiv] || 0) + 1;
    if (idxRang != null && k.art_aktiv && (rfo.byArt.get(k.art_aktiv)?.rang ?? -Infinity) > idxRang) {
      out.aktiv_ueber_index += 1;
    }
    if (k.ep_aktiv == null) out.ohne_preis += 1;
    const a = k.delta_ep_index.ampel;
    if (a && out.ampel[a] != null) out.ampel[a] += 1;
    else if (a) out.ampel[a] = 1;
  }
  return out;
}

/**
 * Bearbeiten heißt: NEUE Schicht mit `ersetzt_id`. Nie Werte überschreiben.
 *
 * Warum: ein überschriebener Einheitspreis ist ein verlorener Beleg. Wer in
 * einem halben Jahr fragt „wieso stand da mal 42 €?", bekommt sonst keine
 * Antwort — und die Kostenberechnung verliert genau die Eigenschaft, die sie
 * belastbar macht.
 *
 * Ein Handpreis darf ausschließlich als `art:"markt"` MIT Herkunft entstehen.
 * Fehlt der Beleg, wird geworfen — nicht still eine leere Herkunft gesetzt.
 */
export function neueSchicht(vorher, patch = {}) {
  const art = patch.art ?? vorher?.art ?? null;
  if (!art || !ARTEN[art]) {
    throw new Error(`Unbekannte Preisart "${art}" — erlaubt sind: ${ARTEN_LISTE.join(', ')}`);
  }
  if (art === 'index') {
    throw new Error('Eine Index-Schicht wird gerechnet, nicht gesetzt — ihr ep darf nicht persistiert werden.');
  }
  const herkunft = patch.herkunft ?? vorher?.herkunft ?? null;
  if (ARTEN[art].beleg_pflicht && !(herkunft && (herkunft.beleg || herkunft.typ))) {
    throw new Error(`Preisart "${art}" verlangt eine Herkunft (herkunft.typ/beleg) — ein Preis ohne Beleg ist keine Aussage.`);
  }
  const ep = patch.ep ?? vorher?.ep ?? null;
  return {
    ...(vorher || {}),
    ...patch,
    id: patch.id ?? null, // die DB vergibt sie; NICHT die alte übernehmen
    art,
    ep: ep == null ? null : round2(ep),
    herkunft,
    ersetzt_id: vorher?.id ?? null,
    stand: patch.stand ?? new Date().toISOString().slice(0, 10),
  };
}

/**
 * Gesamtbetrag EINER Position — mit Doppelzählungssperre.
 *
 * `im_vertrag_enthalten:true` ⇒ GB 0. Die Kosten stecken im Vertrag
 * (`ProjectContract.auftrag_netto + Σ ChangeOrder.cost_impact`) und dürfen nicht
 * zusätzlich an der Position hängen — das wäre eine doppelte Million.
 *
 * `deckung: "ungeklaert"` heißt: die Position ist im Auftrags-LV NICHT
 * auffindbar. Sie wird deshalb ausgewiesen („ungeklärt: n") und nicht stumm
 * mitgezählt. Stumm mitzählen hieße: 5 Positionen verschwinden lautlos aus der
 * Verantwortung.
 */
export function gbDerPosition(position, { schichten = [], reihen = null, rangfolge: rf = null, deckung = null } = {}) {
  const aktiv = aktiveSchicht(schichten, reihen, rf);
  const menge = position?.menge_final ?? position?.quantity ?? null;
  const gesperrt = position?.im_vertrag_enthalten === true;
  const ungeklaert = deckung?.deckung === 'ungeklaert';
  const gbRoh = aktiv.ep != null && menge != null ? round2(Number(menge) * aktiv.ep) : null;
  return {
    gb: gesperrt ? 0 : gbRoh,
    gb_ohne_sperre: gbRoh,
    gesperrt,
    ungeklaert,
    ungeklaert_grund: ungeklaert ? deckung?.grund ?? deckung?.hinweis ?? null : null,
    ep: aktiv.ep,
    art: aktiv.art,
    warnungen: aktiv.warnungen,
  };
}

/**
 * Summenbildung über viele Positionen — Σ-INVARIANT.
 *
 * Wird ein Gewerk komplett beauftragt, fallen die Positionsbeträge auf 0 UND
 * der Vertragsbetrag kommt hinzu. Die Gesamtsumme darf sich dadurch nicht
 * verändern (jedenfalls nicht durch den Sperr-Mechanismus selbst) — sonst
 * „spart" eine Vergabe auf dem Papier Geld, das nur umgezogen ist. Genau das
 * prüft Gate G13.
 */
export function summen(positionen = [], {
  schichtenJePosition = null,
  reihen = null,
  rangfolge: rf = null,
  vertraege = [],
  deckungJePosition = null,
} = {}) {
  let gb_positionen = 0;
  let gb_ohne_sperre = 0;
  let gesperrt = 0;
  let ungeklaert = 0;
  let ohne_preis = 0;
  const ungeklaert_liste = [];
  for (const p of positionen || []) {
    const sch = typeof schichtenJePosition === 'function'
      ? schichtenJePosition(p) || []
      : (schichtenJePosition?.[p?.id] || p?.schichten || []);
    const d = typeof deckungJePosition === 'function' ? deckungJePosition(p) : (deckungJePosition?.[p?.id] || null);
    const r = gbDerPosition(p, { schichten: sch, reihen, rangfolge: rf, deckung: d });
    gb_positionen += r.gb || 0;
    gb_ohne_sperre += r.gb_ohne_sperre || 0;
    if (r.gesperrt) gesperrt += 1;
    if (r.ungeklaert) {
      ungeklaert += 1;
      ungeklaert_liste.push({ oz: p?.oz ?? null, trade: p?.trade ?? null, grund: r.ungeklaert_grund });
    }
    if (r.ep == null && !r.gesperrt) ohne_preis += 1;
  }
  const gb_vertraege = (vertraege || []).reduce(
    (a, v) => a + (Number(v?.summe_netto ?? ((Number(v?.auftrag_netto) || 0) + (Number(v?.nachtraege_netto) || 0))) || 0),
    0
  );
  return {
    gb_positionen: round2(gb_positionen),
    gb_vertraege: round2(gb_vertraege),
    gb_gesamt: round2(gb_positionen + gb_vertraege),
    gb_ohne_sperre: round2(gb_ohne_sperre),
    positionen: (positionen || []).length,
    gesperrt,
    ohne_preis,
    ungeklaert,
    ungeklaert_liste,
  };
}

/**
 * Preisschichten aus vorhandenen Datenquellen bauen — reine Projektion, keine
 * erfundenen Werte. Genau die Kaskade des Orakels, aber als DATEN-Rangfolge
 * statt als if/elif: welche Schicht am Ende gilt, entscheidet `priceStack`
 * anhand des Katalogs, nicht diese Funktion.
 *
 * @param {{positionen?: Array<object>, kostenanschlag?: Object<string, object>,
 *          marktpreise?: Array<object>, referenzpreise?: Object<string, object>,
 *          vertragspositionen?: Array<object>,
 *          index?: {reihe_id: string, von: string, bis: string}|null}} [q] Quellen.
 *   `positionen`: LV-Positionen ({gewerk_nr, oz} oder {trade, oz}).
 *   `kostenanschlag`: {"<gewerk>|<oz>": {menge, ep, gb}}.
 *   `marktpreise`: [{gewerk_nr, oz, ep, herkunft}].
 *   `referenzpreise`: {"<gewerk>|<oz>": {ep, sim, ratio, quelle, review?, grund?}}.
 *   `vertragspositionen`: [{gewerk_nr, oz_lv, ep, …}] — EIGENER OZ-Raum, die
 *   Zuordnung muss GEPFLEGT übergeben werden (kein OZ-Join).
 * @returns {Array<object>} Preisschichten
 */
export function baueSchichten({
  positionen = [],
  kostenanschlag = {},
  marktpreise = [],
  referenzpreise = {},
  vertragspositionen = [],
  index = null,
} = {}) {
  const key = (p) => `${p.gewerk_nr ?? p.trade_nr ?? p.trade ?? ''}|${p.oz ?? ''}`;
  const mpIdx = new Map((marktpreise || []).map((m) => [`${m.gewerk_nr}|${m.oz}`, m]));
  const vpIdx = new Map();
  for (const v of vertragspositionen || []) {
    if (v?.oz_lv) vpIdx.set(`${v.gewerk_nr}|${v.oz_lv}`, v);
  }
  const out = [];
  let lauf = 0;
  const neu = (o) => {
    lauf += 1;
    out.push({ id: `s${lauf}`, ...o });
    return out[out.length - 1];
  };
  for (const p of positionen || []) {
    const k = key(p);
    const pid = p.id ?? k;
    // 1. Kostenanschlag 2020 — Literal, eingefroren.
    const ka = kostenanschlag?.[k];
    let kaSchicht = null;
    if (ka && ka.ep != null) {
      kaSchicht = neu({
        position_id: pid,
        art: 'kostenanschlag',
        ep: ka.ep,
        stand: '2020-11',
        eingefroren: true,
        herkunft: { typ: 'kostenanschlag', beleg: 'LV-Kostenanschlag 17.12.2020', menge: ka.menge ?? null, gb: ka.gb ?? null },
      });
    }
    // 2. Index-Schicht — nur wenn es eine Basis GIBT. Ohne Basis keine Schicht,
    //    denn eine Index-Schicht ohne Basis kann nur `null` liefern.
    if (kaSchicht && index?.reihe_id) {
      neu({
        position_id: pid,
        art: 'index',
        // KEIN ep-Feld: der Wert wird gerechnet (T-33-16).
        basis: { schicht_id: kaSchicht.id, reihe_id: index.reihe_id, von: index.von, bis: index.bis },
        herkunft: { typ: 'index', beleg: `Indexfortschreibung ${index.von} → ${index.bis}` },
      });
    }
    // 3. Referenzprojekt — review.flag bleibt SICHTBAR, aber nicht aktiv.
    const rp = referenzpreise?.[k];
    if (rp && rp.ep != null) {
      neu({
        position_id: pid,
        art: 'referenzprojekt',
        ep: rp.ep,
        stand: rp.stand ?? null,
        match: { sim: rp.sim ?? null, ratio: rp.ratio ?? null },
        review: rp.review ? { flag: true, grund: rp.grund ?? null } : { flag: false, grund: null },
        herkunft: { typ: 'referenzprojekt', beleg: rp.quelle ?? null },
      });
    }
    // 4. Marktpreis — Pflicht-Herkunft.
    const mp = mpIdx.get(k);
    if (mp && mp.ep != null) {
      neu({
        position_id: pid,
        art: 'markt',
        ep: mp.ep,
        stand: mp.herkunft?.stand ?? null,
        herkunft: mp.herkunft ?? { typ: 'marktrecherche', beleg: null },
      });
    }
    // 5. Vertragspreis — NUR über gepflegte Zuordnung (kein OZ-Join!).
    const vp = vpIdx.get(k);
    if (vp && vp.ep != null) {
      neu({
        position_id: pid,
        art: 'vertrag',
        ep: vp.ep,
        stand: vp.stand ?? null,
        herkunft: { typ: 'vertrag', beleg: vp.beleg ?? null, oz_vertrag: vp.oz ?? null },
      });
    }
  }
  return out;
}
