// KgRegel-Verdichtung: aus 497 Einzelzuordnungen werden pflegbare Regeln
// (Phase 33 / W7, ENGINE-08).
//
// ---------------------------------------------------------------------------
// Das Problem, das hier gelöst wird
//
// Die Kostengruppen-Zuordnung des Realprojekts liegt als 497 Einzelzeilen vor —
// eine je Position, von Hand vergeben. Das ist kein Wissen, das ein Büro
// mitnehmen kann: im nächsten Projekt heißen die Positionen anders, und die
// Tabelle ist wertlos. Wissen entsteht erst, wenn daraus REGELN werden
// („Wanddurchbruch im Rohbau ⇒ KG 344").
//
// Verdichtet wird INVERS: pro Gewerk wird die häufigste Kostengruppe zur
// Fallback-Regel, und für jede abweichende Kostengruppe werden die
// unterscheidenden Leitwörter des Kurztexts gesucht (gieriges Überdecken,
// Präzision vor Deckung — ein Leitwort, das auch fremde Positionen trifft, wird
// verworfen).
//
// ---------------------------------------------------------------------------
// GEMESSENER ZIELKONFLIKT (der Plan verlangt zwei Dinge, die nicht zusammengehen)
//
// Der Plan nennt „~70 Regeln" UND „≥ 95 % Reproduktion". Gemessen auf den 497
// Kurztexten (Parameter `max_leitworte` je Kostengruppe):
//
//   max_leitworte = 1 →  65 Regeln → 88,53 %
//   max_leitworte = 2 →  81 Regeln → 92,96 %
//   max_leitworte = 3 →  91 Regeln → 95,17 %
//   max_leitworte = 4 →  99 Regeln → 96,78 %   ← Standard
//   max_leitworte = 6 → 107 Regeln → 98,39 %
//
// Bei ~70 Regeln liegt die Reproduktion bei rund 89 % — die beiden Planziele sind
// auf diesen Daten nicht gleichzeitig erfüllbar. Gewählt ist der Standard
// `max_leitworte = 4`: **99 Regeln, 96,78 %**. Die Zahl der Regeln ist keine
// Konstante im Code, sondern das Ergebnis eines EINSTELLBAREN Parameters — wer
// weniger Regeln pflegen will, sieht sofort, was ihn das kostet.
//
// Der nicht reproduzierte Rest ist eine SICHTBARE OFFENE LISTE (`offen[]`), kein
// stiller Fallback. Zusammen mit den 20 Positionen `confidence: "niedrig"` aus G9
// ist das die Sichtungsliste — 3,2 % statt einer Behauptung von 100 %.
// ---------------------------------------------------------------------------
//
// Isomorph: keine Browser-Globalen, kein Browser-XML-Parser, keine App-Aliase
// (die Zusicherung ist absichtlich ohne die verbotenen Zeichenfolgen formuliert —
// die Isomorphie-Gates sind literale greps). Der LLM-Vorschlag ist eine reine
// Datenaufbereitung — der Netzaufruf liegt beim Aufrufer (Server).

import { normalisiere } from '@core/lib/textMatch.js';

/** Wörter unter dieser Länge sind keine Leitwörter (Artikel, Maßeinheiten). */
export const MIN_WORTLAENGE = 3;
/** Strafgewicht für Fehltreffer bei der Leitwortsuche — Präzision vor Deckung. */
export const FEHLTREFFER_STRAFE = 5;
/** Standard: 4 Leitwörter je Kostengruppe (99 Regeln, 96,78 % — siehe Kopf). */
export const MAX_LEITWORTE = 4;

const worte = (text) => normalisiere(text).split(' ').filter((w) => w.length >= MIN_WORTLAENGE);

/**
 * 497 Zuordnungen → KgRegel-Einträge.
 *
 * @param {Array<{gewerk_nr?, oz?, kurztext?, title?, kg2018?, kg2008?}>} zuordnungen
 * @param {{max_leitworte?: number}} [opts]
 * @returns {{regeln: Array<object>, kennzahlen: object}}
 */
export function verdichte(zuordnungen = [], opts = {}) {
  const maxLeit = opts.max_leitworte ?? MAX_LEITWORTE;
  const zeilen = (zuordnungen || [])
    .map((z) => ({
      gewerk_nr: String(z.gewerk_nr ?? ''),
      oz: z.oz ?? null,
      text: normalisiere(z.kurztext ?? z.title),
      worte: worte(z.kurztext ?? z.title),
      kg2018: z.kg2018 == null ? null : String(z.kg2018),
      kg2008: z.kg2008 == null ? null : String(z.kg2008),
    }))
    .filter((z) => z.kg2018);

  const regeln = [];
  const gewerke = [...new Set(zeilen.map((z) => z.gewerk_nr))].sort();

  for (const g of gewerke) {
    const imGewerk = zeilen.filter((z) => z.gewerk_nr === g);
    const zaehler = {};
    for (const z of imGewerk) zaehler[z.kg2018] = (zaehler[z.kg2018] || 0) + 1;
    // Mehrheits-KG: bei Gleichstand der kleinere Code — deterministisch, damit
    // dieselben Daten immer dieselben Regeln ergeben.
    const mehrheit = Object.entries(zaehler)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];

    for (const kg of Object.keys(zaehler).filter((k) => k !== mehrheit).sort()) {
      let ziel = imGewerk.filter((z) => z.kg2018 === kg);
      const fremd = imGewerk.filter((z) => z.kg2018 !== kg);
      let runde = 0;
      while (ziel.length > 0 && runde < maxLeit) {
        const kandidaten = new Map();
        for (const z of ziel) {
          for (const w of new Set(z.worte)) kandidaten.set(w, (kandidaten.get(w) || 0) + 1);
        }
        let bestes = null;
        for (const [wort, treffer] of kandidaten) {
          const fehl = fremd.filter((z) => z.worte.includes(wort)).length;
          const guete = treffer / (treffer + fehl * FEHLTREFFER_STRAFE);
          if (!bestes || guete > bestes.guete || (guete === bestes.guete && treffer > bestes.treffer)) {
            bestes = { wort, treffer, fehl, guete };
          }
        }
        // Ein Leitwort, das mehr fremde als eigene Positionen trifft, ist keins.
        if (!bestes || (bestes.fehl > 0 && bestes.treffer <= bestes.fehl)) break;
        regeln.push({
          scope: 'buero',
          projekt_override_id: null,
          name: `${g} · ${bestes.wort} ⇒ KG ${kg}`,
          gewerk_nr: g,
          feld: 'kurztext',
          muster: { op: 'glob', value: `*${bestes.wort}*` },
          leitwort: bestes.wort,
          kg2018: kg,
          kg2008: ziel[0].kg2008,
          prio: 10 + bestes.fehl,
          treffer_zaehler: bestes.treffer,
          fehltreffer: bestes.fehl,
          confidence: bestes.fehl === 0 ? 'hoch' : bestes.fehl === 1 ? 'mittel' : 'niedrig',
          herkunft: 'invers verdichtet aus den Einzelzuordnungen des Projekts',
        });
        ziel = ziel.filter((z) => !z.worte.includes(bestes.wort));
        runde += 1;
      }
    }

    regeln.push({
      scope: 'buero',
      projekt_override_id: null,
      name: `${g} · Regelfall ⇒ KG ${mehrheit}`,
      gewerk_nr: g,
      feld: null,
      muster: null,
      leitwort: null,
      kg2018: mehrheit,
      kg2008: imGewerk.find((z) => z.kg2018 === mehrheit)?.kg2008 ?? null,
      prio: 900, // greift zuletzt
      fallback: true,
      treffer_zaehler: zaehler[mehrheit],
      fehltreffer: 0,
      confidence: 'mittel',
      herkunft: 'häufigste Kostengruppe des Gewerks',
    });
  }

  return {
    regeln,
    kennzahlen: {
      zuordnungen: zeilen.length,
      regeln: regeln.length,
      leitwortregeln: regeln.filter((r) => r.leitwort).length,
      fallbackregeln: regeln.filter((r) => r.fallback).length,
      gewerke: gewerke.length,
      max_leitworte: maxLeit,
    },
  };
}

/**
 * Eine Regel auf einen Kurztext anwenden — Reihenfolge: wenigste Fehltreffer
 * zuerst, dann höchste Deckung, Fallback zuletzt.
 * @returns {{kg2018: string|null, kg2008: string|null, regel: object|null, confidence: string}}
 */
export function ordneZu(position, regeln = []) {
  const g = String(position?.gewerk_nr ?? '');
  const w = worte(position?.kurztext ?? position?.title);
  const imGewerk = (regeln || []).filter((r) => String(r.gewerk_nr) === g);
  const leitwort = imGewerk
    .filter((r) => r.leitwort)
    .sort((a, b) => a.fehltreffer - b.fehltreffer || b.treffer_zaehler - a.treffer_zaehler);
  for (const r of leitwort) {
    if (w.includes(r.leitwort)) {
      return { kg2018: r.kg2018, kg2008: r.kg2008, regel: r, confidence: r.confidence };
    }
  }
  const fallback = imGewerk.find((r) => r.fallback);
  if (fallback) {
    return {
      kg2018: fallback.kg2018,
      kg2008: fallback.kg2008,
      regel: fallback,
      // Der Fallback ist ausdrücklich schwächer — er ist die Mehrheit des
      // Gewerks, keine Aussage über DIESE Position.
      confidence: 'niedrig',
    };
  }
  return { kg2018: null, kg2008: null, regel: null, confidence: 'kein Vorschlag' };
}

/**
 * Reproduktionsgrad messen — und die OFFENE LISTE zurückgeben.
 *
 * Der zweite Rückgabewert ist der wichtigere: `offen[]` sind die Positionen, die
 * die verdichteten Regeln NICHT treffen. Sie werden ausgewiesen, nicht geglättet.
 */
export function pruefeReproduktion(zuordnungen = [], regeln = []) {
  const offen = [];
  let getroffen = 0;
  let gesamt = 0;
  for (const z of zuordnungen || []) {
    if (z.kg2018 == null) continue;
    gesamt += 1;
    const r = ordneZu(z, regeln);
    if (String(r.kg2018) === String(z.kg2018)) {
      getroffen += 1;
    } else {
      offen.push({
        gewerk_nr: z.gewerk_nr,
        oz: z.oz ?? null,
        kurztext: z.kurztext ?? z.title ?? null,
        kg_soll: String(z.kg2018),
        kg_regel: r.kg2018,
        regel: r.regel?.name ?? null,
        grund: r.regel?.fallback
          ? 'kein Leitwort getroffen — der Gewerks-Regelfall greift und liegt daneben'
          : 'ein Leitwort einer anderen Kostengruppe greift zuerst',
      });
    }
  }
  return {
    gesamt,
    getroffen,
    quote: gesamt > 0 ? Math.round((getroffen / gesamt) * 10000) / 100 : null,
    offen,
    hinweis:
      'Die offene Liste ist Teil des Ergebnisses. Eine Verdichtung, die 100 % behauptet, '
      + 'hat entweder keine Regeln verdichtet oder die Ausnahmen versteckt.',
  };
}

/**
 * Den LLM-Auftrag für unbelegte Kurztexte aufbereiten.
 *
 * Bewusst KEIN Netzaufruf hier: diese Datei bleibt isomorph und testbar. Der
 * Aufrufer schickt `prompt`/`response_json_schema` an `invokeLLM` (bestehender
 * `llmRouter`) und gibt die Antwort an `vorschlagUebernehmen` weiter.
 *
 * Der Prompt sagt dem Modell ausdrücklich, dass „unbekannt" eine erlaubte Antwort
 * ist. Ohne diesen Satz erfindet ein Sprachmodell IMMER eine Kostengruppe — und
 * eine erfundene Kostengruppe bewegt Geld (T-33-23).
 */
export function llmAuftrag(kurztexte = [], dinKatalog = [], gewerk = null) {
  const codes = [...new Set((dinKatalog || []).filter((r) => r.fassung === '2018').map((r) => `${r.code} ${r.name}`))];
  return {
    prompt:
      'Ordne jedem Kurztext eines deutschen Bau-Leistungsverzeichnisses eine Kostengruppe nach '
      + 'DIN 276 (Fassung 2018, DREISTELLIG) zu.\n\n'
      + 'WICHTIG: Wenn die Zuordnung nicht eindeutig aus dem Kurztext folgt, antworte mit '
      + '"kg2018": null und "confidence": "niedrig". Eine geratene Kostengruppe ist schädlicher '
      + 'als keine — sie wird als Kostenzuordnung weiterverarbeitet.\n\n'
      + (gewerk ? `Gewerk: ${gewerk}\n\n` : '')
      + `Erlaubte Codes:\n${codes.join('\n')}\n\n`
      + `Kurztexte:\n${(kurztexte || []).map((t, i) => `${i + 1}. ${t}`).join('\n')}`,
    response_json_schema: {
      type: 'object',
      properties: {
        vorschlaege: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              nr: { type: 'number' },
              kurztext: { type: 'string' },
              kg2018: { type: ['string', 'null'] },
              begruendung: { type: 'string' },
              confidence: { type: 'string', enum: ['hoch', 'mittel', 'niedrig'] },
            },
            required: ['nr', 'kg2018', 'confidence'],
          },
        },
      },
      required: ['vorschlaege'],
    },
  };
}

/**
 * LLM-Antwort → VORSCHLÄGE. Nie eine Zuordnung.
 *
 * Jeder Vorschlag trägt `herkunft: "LLM-Vorschlag"`, `angenommen: false` und eine
 * `confidence`. Er wirkt **erst durch die Annahme des Nutzers** (A7 / T-33-23).
 * Ein Vorschlag mit einem Code, den der Katalog nicht kennt, wird VERWORFEN —
 * ein Sprachmodell erfindet Codes.
 */
export function vorschlaegeAus(antwort, dinKatalog = [], { modell = null } = {}) {
  const erlaubt = new Set((dinKatalog || []).map((r) => String(r.code)));
  const roh = Array.isArray(antwort?.vorschlaege) ? antwort.vorschlaege : [];
  const vorschlaege = [];
  const verworfen = [];
  for (const v of roh) {
    const kg = v?.kg2018 == null ? null : String(v.kg2018);
    if (kg != null && !erlaubt.has(kg)) {
      verworfen.push({ ...v, grund: `Code "${kg}" steht nicht im Din276Katalog — verworfen` });
      continue;
    }
    vorschlaege.push({
      nr: v?.nr ?? null,
      kurztext: v?.kurztext ?? null,
      kg2018: kg,
      begruendung: v?.begruendung ?? null,
      confidence: ['hoch', 'mittel', 'niedrig'].includes(v?.confidence) ? v.confidence : 'niedrig',
      herkunft: 'LLM-Vorschlag',
      modell,
      // Der entscheidende Wert dieser Datei.
      angenommen: false,
    });
  }
  return {
    vorschlaege,
    verworfen,
    hinweis:
      'Vorschläge sind Vorschläge. Sie werden erst durch die Annahme des Nutzers zur Zuordnung — '
      + 'ein Sprachmodell, das Kostengruppen automatisch setzt, bewegt Geld ohne Verantwortlichen.',
  };
}

// ---------------------------------------------------------------------------
// TypeSafe-Vorschlag (Phase 76-02)
//
// Statt eines Sprachmodells, das „confidence: hoch" behauptet, liefert TypeSafe
// je Kurztext eine WAHRSCHEINLICHKEITSVERTEILUNG über die Kostengruppen. Der Code
// übersetzt sie in Stufen — die Schwellen sind eine Konstante, die 76-04 auf den
// 497 echten Zuordnungen kalibriert. Weiterhin: kein Netzaufruf in dieser Datei,
// der Aufrufer schickt die Blöcke an /integrations/typesafe. Additiv neben
// llmAuftrag/vorschlaegeAus; die Ausgabeform ist dieselbe (A7 / T-33-23).
// ---------------------------------------------------------------------------

/**
 * Konfidenz-Stufen aus p(choice) — GEMESSEN 2026-09-21, jev-1.13.0, 497 Positionen
 * eines Referenzprojekts (anonymisiert, `76-04-MESSUNG.md`): mit dem hier ausgelieferten Auftrag (Gewerk +
 * Kurztext, keine Bürokonventionen) sind ab p ≥ 0,70 nur 71 % der Vorschläge
 * richtig, ab 0,85 64 %, 98 % erreicht kein Bin. Die Stufen „hoch" (≥ 98 %) und
 * „mittel" (≥ 90 %) sind damit NICHT belegbar und bleiben abgeschaltet (Schwelle
 * 1,01 = unerreichbar); jeder Vorschlag erscheint als „niedrig" mit seiner
 * Wahrscheinlichkeit. `mindest` 0,70: darunter lag die Trefferquote bei ≤ 59 % —
 * ein Vorschlag, der öfter falsch als richtig ist, ist keiner.
 * Variante 5 (Konventionen im State) erreichte 91 % ab 0,80 — erst wenn die
 * Konventionen als Produktdaten mitgehen (D-P76-03), darf „mittel" wieder auf.
 */
export const TYPESAFE_SCHWELLEN = { hoch: 1.01, mittel: 1.01, mindest: 0.7 };
/** Kurztexte je Request — 40 halten State + Fragen sicher unter dem 64k-Kontext. */
export const TYPESAFE_BLOCK = 40;
/** Die Option, die dem Modell erlaubt, keine Kostengruppe zu wählen. */
export const TYPESAFE_UNBEKANNT = 'unbekannt';

const UNBEKANNT_TEXT = {
  de: 'Keine der Kostengruppen folgt eindeutig aus dem Kurztext',
  en: 'None of the cost groups follows unambiguously from the short text',
};

/**
 * Choice-Optionen aus dem Din276Katalog: NUR Fassung 2018 (die 2008-Codes tragen
 * teils dieselbe Nummer mit anderer Bedeutung) plus „unbekannt".
 * Ohne Katalog bleibt nur „unbekannt" — der Aufrufer erkennt das an < 2 Schlüsseln.
 * @returns {Record<string, string>}
 */
export function kgOptionen(dinKatalog = []) {
  const zeilen = (dinKatalog || [])
    .filter((r) => String(r?.fassung) === '2018' && r?.code != null)
    .sort((a, b) => String(a.code).localeCompare(String(b.code)));
  const out = {};
  for (const r of zeilen) {
    const code = String(r.code);
    if (!(code in out)) out[code] = r.name || code;
  }
  out[TYPESAFE_UNBEKANNT] = UNBEKANNT_TEXT.de;
  return out;
}

function kgInstructions(i, sprache) {
  if (sprache === 'en') {
    return `Which cost group according to DIN 276 (2018 edition, three digits) applies to the `
      + `bill-of-quantities item \`positionen[${i}].kurztext\`? The trade is given in \`gewerk\`. `
      + `Choose ${TYPESAFE_UNBEKANNT} if the short text does not determine the cost group unambiguously — `
      + `a guessed cost group is more harmful than none. Option names are German DIN 276 titles.`;
  }
  return `Welche Kostengruppe nach DIN 276 (Fassung 2018, dreistellig) trifft auf die Leistungsposition `
    + `\`positionen[${i}].kurztext\` zu? Das Gewerk steht in \`gewerk\`. Wähle ${TYPESAFE_UNBEKANNT}, wenn der `
    + `Kurztext die Zuordnung nicht eindeutig hergibt — eine geratene Kostengruppe ist schädlicher als keine.`;
}

/**
 * Kurztexte → TypeSafe-Aufträge (Blöcke à TYPESAFE_BLOCK). Je Kurztext eine
 * Choice-Frage `kg_<nr>`; `nr` läuft global 1…n, leere Texte lassen eine Lücke.
 * Die Frage-ID geht nicht ans Modell — Pfad und Gewerk stehen in den Instructions.
 * @returns {Array<{ state: object, questions: Record<string, object> }>}
 */
export function typesafeAuftrag(kurztexte = [], dinKatalog = [], gewerk = null, { sprache = 'de' } = {}) {
  const options = kgOptionen(dinKatalog);
  if (sprache === 'en') options[TYPESAFE_UNBEKANNT] = UNBEKANNT_TEXT.en;
  const positionen = (kurztexte || [])
    .map((t, idx) => ({ nr: idx + 1, kurztext: typeof t === 'string' ? t.trim() : '' }))
    .filter((p) => p.kurztext.length > 0);

  const bloecke = [];
  for (let start = 0; start < positionen.length; start += TYPESAFE_BLOCK) {
    const teil = positionen.slice(start, start + TYPESAFE_BLOCK);
    const questions = {};
    teil.forEach((p, i) => {
      // API-Feldname ist `criteria` (nicht `options`) — live geprüft 21.09.2026.
      questions[`kg_${p.nr}`] = { type: 'choice', instructions: kgInstructions(i, sprache), criteria: options };
    });
    bloecke.push({ state: { gewerk: gewerk || null, positionen: teil }, questions });
  }
  return bloecke;
}

const pKomma = (p) => (Math.round(p * 100) / 100).toFixed(2).replace('.', ',');

/**
 * TypeSafe-Antworten (zusammengeführte `answers` aller Blöcke) → VORSCHLÄGE in der
 * Form von `vorschlaegeAus`, plus `wahrscheinlichkeit` und `alternativen`.
 * Nie eine Zuordnung: `angenommen: false`, wirkt erst durch den Nutzer.
 */
export function vorschlaegeAusTypesafe(antworten, kurztexte = [], dinKatalog = [], { modell = null, schwellen = TYPESAFE_SCHWELLEN } = {}) {
  const erlaubt = new Set((dinKatalog || []).map((r) => String(r.code)));
  const vorschlaege = [];
  const verworfen = [];
  const eintraege = Object.entries(antworten || {})
    .filter(([id]) => /^kg_\d+$/.test(id))
    .sort((a, b) => Number(a[0].slice(3)) - Number(b[0].slice(3)));

  for (const [id, a] of eintraege) {
    const nr = Number(id.slice(3));
    const kurztext = kurztexte?.[nr - 1] ?? null;
    const probs = a?.probabilities && typeof a.probabilities === 'object' ? a.probabilities : {};
    const choice = a?.choice == null ? null : String(a.choice);
    const p = Number(probs[choice] ?? 0);
    const unbekannt = choice === null || choice === TYPESAFE_UNBEKANNT;

    if (!unbekannt && !erlaubt.has(choice)) {
      verworfen.push({ nr, kurztext, kg2018: choice, grund: `Code "${choice}" steht nicht im Din276Katalog — verworfen` });
      continue;
    }

    const alternativen = Object.entries(probs)
      .filter(([code]) => code !== TYPESAFE_UNBEKANNT && code !== choice)
      .map(([code, q]) => ({ kg2018: String(code), p: Number(q) || 0 }))
      .sort((x, y) => y.p - x.p)
      .slice(0, 2);

    const kg2018 = unbekannt || p < schwellen.mindest ? null : choice;
    let confidence = 'niedrig';
    if (kg2018 != null) {
      if (p >= schwellen.hoch) confidence = 'hoch';
      else if (p >= schwellen.mittel) confidence = 'mittel';
    }
    let begruendung = unbekannt ? `${TYPESAFE_UNBEKANNT} (p = ${pKomma(p)})` : `p = ${pKomma(p)}`;
    if (!unbekannt && alternativen[0]) {
      begruendung += ` · Alternative ${alternativen[0].kg2018} (${pKomma(alternativen[0].p)})`;
    }

    vorschlaege.push({
      nr,
      kurztext,
      kg2018,
      begruendung,
      confidence,
      wahrscheinlichkeit: p,
      alternativen,
      herkunft: 'TypeSafe-Vorschlag',
      modell,
      // Der entscheidende Wert dieser Datei.
      angenommen: false,
    });
  }

  return {
    vorschlaege,
    verworfen,
    hinweis:
      'Vorschläge sind Vorschläge. Sie werden erst durch die Annahme des Nutzers zur Zuordnung — '
      + 'ein Sprachmodell, das Kostengruppen automatisch setzt, bewegt Geld ohne Verantwortlichen. '
      + 'Wahrscheinlichkeiten sind Modellaussagen, keine Prüfung.',
  };
}
