// STLB-Bau-Zuordnung über Kurztext-Ähnlichkeit (Phase 33 / W7, ENGINE-08).
//
// ---------------------------------------------------------------------------
// DIE WICHTIGSTE ZEILE DIESER DATEI: hier entsteht NIE ein Einheitspreis.
//
// Ergebnis ist ein STLB-SCHLÜSSEL mit einer STUFE — nichts weiter. Ohne
// DBD-BIM-Zugang ist eine STLB-Position nicht bepreisbar, und ein aus dem
// Kurztext geschätzter €/m² wäre die teuerste Erfindung des ganzen Moduls: er
// sähe im Kostenanschlag genauso aus wie ein belegter Preis. Der Katalogeintrag
// führt das ausdrücklich als `liefert_ep: false`, und diese Datei kennt kein
// `ep`-Feld.
//
// Die ehrliche Bilanz des Realprojekts ist **2 hoch / 10 mittel / 485 kein**.
// Das sind 2,4 % Trefferquote. Diese Zahl wird ANGEZEIGT und nicht geglättet:
// sie ist der Ist-Zustand ohne DBD-Zugang, kein Portierungsfehler. Wer sie
// verbessern will, braucht mehr geerntete STLB-Schlüssel — nicht eine niedrigere
// Schwelle.
// ---------------------------------------------------------------------------
//
// Score: `gewicht_ratcliff × Ratcliff/Obershelp + gewicht_jaccard × Jaccard`.
// Gewichte und Stufengrenzen kommen aus dem Katalog `PreisUebernahmeRegel`
// (Zeile `von: "stlb_katalog"`), nicht aus dieser Datei — ein grep-Gate prüft,
// dass 0,82 / 0,60 / 0,6 / 0,4 hier nicht im Rechenweg stehen.
//
// Warum zwei Maße statt einem: Ratcliff sieht die Wortfolge („Bauzaun H 2m
// aufstellen räumen"), Jaccard die Wortmenge unabhängig von der Reihenfolge. Die
// STLB-Kurztexte sind Stichwortketten mit anderer Reihenfolge als die eigenen —
// Ratcliff allein würde zu viele echte Treffer verlieren.
//
// Beide Maße kommen aus `@core/lib/textMatch.js`. Es gibt keine zweite
// Ähnlichkeitsfunktion im Repo.
//
// Isomorph: keine Browser-Globalen, kein Browser-XML-Parser, keine App-Aliase
// (die Zusicherung ist absichtlich ohne die verbotenen Zeichenfolgen formuliert —
// die Isomorphie-Gates sind literale greps).

import { ratio as textRatio, jaccard, normalisiere, runde } from '@core/lib/textMatch.js';

export const STUFEN = Object.freeze(['hoch', 'mittel', 'kein']);

export const ABGRENZUNG =
  'Ohne DBD-BIM-Zugang ist eine STLB-Position nicht bepreisbar. Die Zuordnung liefert einen '
  + 'STLB-Schlüssel und eine Stufe — nie einen Einheitspreis.';

/**
 * Gewichte und Stufengrenzen aus dem Katalog.
 * Fehlt die Zeile, wird NICHT geraten: `fehlt: true` und jede Position bleibt
 * „kein". Ein Default im Code wäre eine geratene Schwelle mit dem Aussehen einer
 * gepflegten.
 */
export function schwellenAus(katalogZeilen = [], von = 'stlb_katalog') {
  const z = (katalogZeilen || []).find((r) => r?.von === von && r?.stufe_hoch_ab != null);
  if (!z) {
    return { fehlt: true, grund: `Katalog PreisUebernahmeRegel enthält keine Zeile "von: ${von}" mit Stufengrenzen` };
  }
  return {
    fehlt: false,
    gewicht_ratcliff: z.gewicht_ratcliff,
    gewicht_jaccard: z.gewicht_jaccard,
    stufe_hoch_ab: z.stufe_hoch_ab,
    stufe_mittel_ab: z.stufe_mittel_ab,
    verfahren: z.verfahren ?? '0,6 × Ratcliff + 0,4 × Jaccard',
    liefert_ep: z.liefert_ep === true,
  };
}

/** Der Score eines Paars — beide Anteile bleiben einsehbar. */
export function score(eigen, kandidat, schwellen) {
  const seq = textRatio(eigen, kandidat);
  const jac = jaccard(eigen, kandidat);
  const wR = schwellen?.gewicht_ratcliff;
  const wJ = schwellen?.gewicht_jaccard;
  return { score: wR * seq + wJ * jac, ratcliff: seq, jaccard: jac };
}

/** Stufe aus dem Score — Grenzen aus dem Katalog. */
export function stufeVon(wert, schwellen) {
  if (schwellen?.fehlt || wert == null) return 'kein';
  if (wert >= schwellen.stufe_hoch_ab) return 'hoch';
  if (wert >= schwellen.stufe_mittel_ab) return 'mittel';
  return 'kein';
}

/**
 * EINE Position gegen den Kandidatenkorpus.
 *
 * @param {{kurztext?, title?, einheit?, unit?}} position
 * @param {Array<{kurztext, einheit?, stlb?, lb?, ids?}>} kandidaten geerntete STLB-Positionen
 * @param {object} schwellen aus `schwellenAus`
 * @returns {{score, stufe, ratcliff, jaccard, kandidat, warnungen: Array<string>}}
 */
export function ordneZu(position, kandidaten = [], schwellen = null) {
  const s = schwellen || { fehlt: true, grund: 'keine Schwellen übergeben' };
  const eigen = position?.kurztext ?? position?.title ?? '';
  const warnungen = [];
  if (s.fehlt) warnungen.push(s.grund);

  let bester = null;
  let bestWert = 0;
  let bestR = 0;
  let bestJ = 0;
  if (!s.fehlt) {
    for (const k of kandidaten || []) {
      const kt = k?.kurztext;
      if (!kt) continue;
      const r = score(eigen, kt, s);
      // Strikt „>": bei Gleichstand gewinnt der ERSTE Kandidat — dieselbe
      // Tiebreak-Regel wie in der Pipeline.
      if (r.score > bestWert) {
        bestWert = r.score;
        bester = k;
        bestR = r.ratcliff;
        bestJ = r.jaccard;
      }
    }
  }

  const stufe = stufeVon(bestWert, s);
  if (stufe === 'kein' && (kandidaten || []).length === 0 && !s.fehlt) {
    warnungen.push('leerer STLB-Kandidatenkorpus — es kann keine Zuordnung entstehen');
  }
  return {
    score: runde(bestWert, 3),
    stufe,
    ratcliff: runde(bestR, 3),
    jaccard: runde(bestJ, 3),
    // Bei Stufe „kein" wird der beste Kandidat NICHT ausgegeben — er wäre eine
    // Andeutung ohne Aussage und würde als Zuordnung gelesen.
    kandidat: stufe === 'kein' ? null : bester,
    warnungen,
  };
}

/**
 * Über alle Positionen — Ergebnis je Position plus die ehrliche Bilanz.
 *
 * @returns {{zeilen: Array<object>, bilanz: {hoch, mittel, kein, gesamt},
 *            abgrenzung: string, warnungen: Array<string>}}
 */
export function ordneAlleZu(positionen = [], kandidaten = [], uebernahmeKatalog = []) {
  const s = schwellenAus(uebernahmeKatalog);
  const zeilen = [];
  const bilanz = { hoch: 0, mittel: 0, kein: 0, gesamt: 0 };
  const warnungen = [];
  if (s.fehlt) warnungen.push(s.grund);
  if (s.liefert_ep) {
    // Der Katalog darf das nicht umstellen: eine STLB-Zuordnung IST kein Preis.
    warnungen.push(
      'Katalog behauptet liefert_ep: true — ignoriert. Eine STLB-Zuordnung liefert nie einen Einheitspreis.'
    );
  }

  for (const p of positionen || []) {
    const r = ordneZu(p, kandidaten, s);
    bilanz.gesamt += 1;
    bilanz[r.stufe] += 1;
    zeilen.push({
      position_id: p.id ?? `${p.gewerk_nr ?? ''}|${p.oz ?? ''}`,
      gewerk_nr: p.gewerk_nr ?? null,
      oz: p.oz ?? null,
      kurztext: p.kurztext ?? p.title ?? null,
      normalisiert: normalisiere(p.kurztext ?? p.title),
      score: r.score,
      stufe: r.stufe,
      ratcliff: r.ratcliff,
      jaccard: r.jaccard,
      stlb_kurztext: r.kandidat?.kurztext ?? null,
      stlb_einheit: r.kandidat?.einheit ?? null,
      stlb_ref: r.kandidat?.stlb ?? null,
      stlb_ids: r.kandidat?.ids ?? null,
      // KEIN ep-Feld. Absicht.
      bepreisbar: false,
      hinweis: r.stufe === 'kein' ? 'keine STLB-Position zuordenbar' : ABGRENZUNG,
      warnungen: r.warnungen,
    });
  }

  return { zeilen, bilanz, abgrenzung: ABGRENZUNG, warnungen };
}

/**
 * Das Feld, das an `LVPosition.stlb` geschrieben wird.
 * Bei Stufe „kein" ⇒ `null`: eine leere Zuordnung ist keine Zuordnung.
 */
export function stlbFeld(zeile) {
  if (!zeile || zeile.stufe === 'kein') return null;
  return {
    kurztext: zeile.stlb_kurztext,
    unit: zeile.stlb_einheit,
    score: zeile.score,
    stufe: zeile.stufe,
    katalog_ref: zeile.stlb_ref ?? null,
    ids: zeile.stlb_ids ?? [],
    bepreisbar: false,
    hinweis: ABGRENZUNG,
  };
}
