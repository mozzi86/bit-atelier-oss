// Textähnlichkeit — GENAU EINE Implementierung im ganzen Repo (Phase 33 / W7).
//
// Warum das eine eigene Datei in @core ist und keine Hilfsfunktion neben dem
// Aufrufer: `referenzPreise` (Preisübernahme) und `stlbMatch` (STLB-Zuordnung)
// brauchen dieselbe Ähnlichkeit. Zwei Implementierungen wären zwei Zahlen für
// denselben Sachverhalt — und die zweite wäre irgendwann die falsche. Ein
// grep-Gate prüft, dass es keine zweite gibt.
//
// ---------------------------------------------------------------------------
// PARITÄT ZU PYTHONS `difflib.SequenceMatcher.ratio()`
//
// Die eingefrorenen Zielzahlen der Pipeline (130 Übernahmen, 5 Reviews, 2/10/485
// STLB-Stufen) sind mit `difflib` gerechnet. Diese Datei rechnet deshalb NICHT
// „irgendeine Ähnlichkeit", sondern denselben Algorithmus:
//
//   ratio = 2 · M / T      M = Σ Länge der Matching Blocks, T = len(a) + len(b)
//
// `find_longest_match` ist bitgenau nachgebaut, inklusive der Tiebreak-Regel
// („frühestes i, dann frühestes j, dann längster Block") — sie entscheidet bei
// gleich langen Alternativen und damit über die Zahl.
//
// **AUTOJUNK IST AUS.** Python schaltet die Heuristik (Elemente, die in mehr als
// 1 % von `b` vorkommen, gelten als Junk) erst bei `len(b) >= 200` ein. Der
// längste normalisierte Kurztext dieses Projekts hat **159** Zeichen — die
// Heuristik greift nie. Das ist kein Zufall, sondern eine Bedingung: sobald
// jemand LANGTEXTE matcht, wird Autojunk relevant und die Parität ist gebrochen.
// Gate G17 prüft die Grenze 159 < 200 deshalb AKTIV mit.
// ---------------------------------------------------------------------------
//
// ---------------------------------------------------------------------------
// NORMALISIERUNG — und ein benannter Mangel (Pitfall 17)
//
// Die Pipeline normalisiert so:
//   Tags entfernen → HTML-Entities auflösen → NFKD → ASCII (verlustbehaftet!)
//   → Kleinschreibung → alles außer [a-z0-9 ] zu Leerzeichen → Leerzeichen
//   zusammenfassen → trimmen
//
// `ä/ö/ü` überleben das korrekt (NFKD spaltet sie in Grundbuchstabe + Akzent, der
// Akzent fällt beim ASCII-Schritt weg): „Wände" → „wande".
//
// **`ß` überlebt es NICHT.** NFKD zerlegt `ß` nicht, und der ASCII-Schritt löscht
// es ersatzlos: „Straße" → „strae", „Fußboden" → „fuboden". Fachlich richtig wäre
// `ß` → `ss`. Das ist ein Mangel der Pipeline, KEIN Fehler dieser Datei — er wird
// hier bewusst REPRODUZIERT, weil sonst alle eingefrorenen `sim`-Werte
// abweichen und die Parität nicht mehr prüfbar wäre. Der Mangel ist:
//   * in `NORMALISIERUNG` als Text mitgeliefert,
//   * in `parity/golden/textmatch-3000.json` als `bekannte_abweichung` geführt,
//   * durch einen eigenen Unit-Test festgenagelt,
//   * und über `zeichenverluste()` für jeden Text ABFRAGBAR — wer ihn korrigieren
//     will, sieht zuerst, wie viele Texte betroffen sind.
// Eine zweite „korrekte" Normalisierung wäre die zweite Semantik, die diese Datei
// gerade verhindern soll. Die Korrektur ist ein eigener, datierter Schritt.
// ---------------------------------------------------------------------------
//
// Isomorph: keine Browser-Globalen, kein Browser-XML-Parser, keine Aliase.

export const NORMALISIERUNG =
  'Tags entfernen · HTML-Entities auflösen · NFKD → ASCII (verlustbehaftet) · Kleinschreibung · ' +
  'alles außer [a-z0-9 ] zu Leerzeichen · Mehrfach-Leerzeichen zusammenfassen · trimmen. ' +
  'BEKANNTER MANGEL DER PIPELINE, hier reproduziert: „ß" wird ersatzlos gelöscht (Straße → strae), ' +
  'fachlich richtig wäre „ss". ä/ö/ü werden korrekt zu a/o/u.';

/** Die Grenze, ab der Pythons Autojunk-Heuristik greift — und die Parität bricht. */
export const AUTOJUNK_GRENZE = 200;

/**
 * Rundung wie Pythons `round()` — HALB ZUR GERADEN ZAHL, nicht kaufmännisch.
 *
 * Das gehört hierher, weil es Teil desselben Paritätsvertrags ist: alle
 * eingefrorenen Vergleichswerte (`sim`, `ratio`, STLB-`score`) sind mit Pythons
 * `round()` geschrieben. `Math.round(x * 100) / 100` rundet 1,125 auf 1,13,
 * Python auf **1,12**. Im Realdatensatz betrifft das genau zwei der 130
 * Übernahmen (ratio 18/16 = 1,125 und 150/1200 = 0,125) — und ohne diese
 * Funktion wären es zwei „Abweichungen", die keine sind.
 *
 * @param {number} x
 * @param {number} [stellen]
 */
export function runde(x, stellen = 2) {
  if (x == null || !Number.isFinite(x)) return x;
  // NICHT `Math.round(x * 10**n) / 10**n`: die Multiplikation verfälscht die
  // Entscheidung. Beispiel `runde(0.7775, 3)` — der nächste Double zu 0,7775 ist
  // KLEINER als 0,7775, Python liefert deshalb 0,777. `0.7775 * 1000` ergibt aber
  // exakt 777.5 und damit die falsche Grundlage. Gerundet wird deshalb auf der
  // DEZIMALDARSTELLUNG des Doubles.
  const vorzeichen = x < 0 ? -1 : 1;
  const exakt = Math.abs(x).toFixed(60); // Doubles dieser Größenordnung sind hier exakt
  const [ganzteil, bruch = ''] = exakt.split('.');
  const behalten = bruch.slice(0, stellen).padEnd(stellen, '0');
  const rest = bruch.slice(stellen);
  let auf = false;
  if (rest[0] > '5') {
    auf = true;
  } else if (rest[0] === '5') {
    if (/[1-9]/.test(rest.slice(1))) {
      auf = true; // echt größer als die Hälfte
    } else {
      // EXAKT die Hälfte ⇒ zur geraden Zahl (Pythons Verhalten).
      const letzte = stellen > 0 ? behalten[stellen - 1] : ganzteil[ganzteil.length - 1];
      auf = Number(letzte) % 2 === 1;
    }
  }
  const basis = Number(stellen > 0 ? `${ganzteil}.${behalten}` : ganzteil);
  const wert = auf ? basis + 10 ** -stellen : basis;
  return vorzeichen * Number(wert.toFixed(stellen));
}

// Die fünf Standard-Entities plus die im GAEB-Umfeld üblichen Zahlenformen.
const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
};

/** Alles außerhalb von ASCII wegwerfen (`encode("ascii","ignore")`). */
function nurAscii(text) {
  let out = '';
  for (const zeichen of String(text)) {
    if (zeichen.codePointAt(0) < 128) out += zeichen;
  }
  return out;
}

/** `html.unescape` in der hier gebrauchten Reichweite. */
function entities(s) {
  return String(s).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (ganz, name) => {
    if (name[0] === '#') {
      const num = name[1] === 'x' || name[1] === 'X'
        ? parseInt(name.slice(2), 16)
        : parseInt(name.slice(1), 10);
      return Number.isFinite(num) && num >= 0 && num <= 0x10ffff ? String.fromCodePoint(num) : ganz;
    }
    const k = name.toLowerCase();
    return Object.prototype.hasOwnProperty.call(ENTITIES, k) ? ENTITIES[k] : ganz;
  });
}

/**
 * Normalisierung — identisch zur Pipeline (siehe Kopfkommentar).
 * @param {string|null|undefined} s
 * @returns {string}
 */
export function normalisiere(s) {
  let t = String(s ?? '').replace(/<[^>]+>/g, ' ');
  t = entities(t);
  // NFKD und dann ALLES Nicht-ASCII wegwerfen — genau wie
  // `.encode("ascii","ignore").decode()` in Python. Geprüft wird über den
  // Codepoint statt über eine Zeichenklasse mit Steuerzeichen (die ESLint mit
  // Recht beanstandet: `[^\x00-\x7F]` enthält Steuerzeichen im Muster).
  t = nurAscii(t.normalize('NFKD'));
  t = t.toLowerCase();
  t = t.replace(/[^a-z0-9 ]/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

/**
 * Welche Zeichen die Normalisierung ERSATZLOS verliert (nicht: umschreibt).
 * Damit ist der ß-Mangel messbar statt behauptet.
 * @returns {Array<string>} die verlorenen Zeichen in Reihenfolge des Auftretens
 */
export function zeichenverluste(s) {
  const out = [];
  for (const zeichen of String(s ?? '')) {
    // Ein Zeichen ist verloren, wenn es allein normalisiert nichts ergibt,
    // obwohl es selbst kein Trenner ist.
    if (/[\s<>&]/.test(zeichen)) continue;
    if (normalisiere(zeichen) === '' && nurAscii(zeichen.normalize('NFKD')) === '') {
      out.push(zeichen);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Ratcliff/Obershelp — Pythons `difflib.SequenceMatcher`, autojunk AUS
// ---------------------------------------------------------------------------

/** b2j: Element → aufsteigende Liste seiner Positionen in b. */
function b2jVon(b) {
  const map = new Map();
  for (let i = 0; i < b.length; i += 1) {
    const c = b[i];
    let liste = map.get(c);
    if (!liste) {
      liste = [];
      map.set(c, liste);
    }
    liste.push(i);
  }
  return map;
}

/**
 * `find_longest_match` — bitgenau wie CPython.
 *
 * Die Tiebreak-Regel ist Teil des Ergebnisses: bei gleicher Länge gewinnt das
 * frühste `i`, dann das frühste `j`. Wer hier „>=" statt „>" schreibt, bekommt
 * andere Blöcke und andere Zahlen.
 */
function longestMatch(a, b, b2j, alo, ahi, blo, bhi) {
  let besti = alo;
  let bestj = blo;
  let bestsize = 0;
  let j2len = new Map();

  for (let i = alo; i < ahi; i += 1) {
    const neu = new Map();
    const stellen = b2j.get(a[i]);
    if (stellen) {
      for (const j of stellen) {
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (j2len.get(j - 1) || 0) + 1;
        neu.set(j, k);
        if (k > bestsize) {
          besti = i - k + 1;
          bestj = j - k + 1;
          bestsize = k;
        }
      }
    }
    j2len = neu;
  }

  // CPython dehnt den Block anschließend über „popular"/Junk-Elemente aus.
  // Ohne Junk (autojunk aus, isjunk=None) sind diese beiden Schleifen No-ops —
  // sie stehen hier trotzdem, weil das Weglassen bei einer späteren
  // Junk-Einführung ein stiller Paritätsbruch wäre.
  while (besti > alo && bestj > blo && a[besti - 1] === b[bestj - 1]) {
    besti -= 1;
    bestj -= 1;
    bestsize += 1;
  }
  while (
    besti + bestsize < ahi &&
    bestj + bestsize < bhi &&
    a[besti + bestsize] === b[bestj + bestsize]
  ) {
    bestsize += 1;
  }

  return [besti, bestj, bestsize];
}

/**
 * Die Matching Blocks wie `SequenceMatcher.get_matching_blocks()` —
 * inklusive des abschließenden Sentinels `[len(a), len(b), 0]`.
 * @returns {Array<[number, number, number]>}
 */
export function matchingBlocks(a, b) {
  const b2j = b2jVon(b);
  const queue = [[0, a.length, 0, b.length]];
  const blocks = [];
  while (queue.length) {
    const [alo, ahi, blo, bhi] = queue.pop();
    const [i, j, k] = longestMatch(a, b, b2j, alo, ahi, blo, bhi);
    if (k === 0) continue;
    blocks.push([i, j, k]);
    if (alo < i && blo < j) queue.push([alo, i, blo, j]);
    if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
  }
  blocks.sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]);

  // Aneinandergrenzende Blöcke verschmelzen (wie CPython).
  let i1 = 0;
  let j1 = 0;
  let k1 = 0;
  const out = [];
  for (const [i2, j2, k2] of blocks) {
    if (i1 + k1 === i2 && j1 + k1 === j2) {
      k1 += k2;
    } else {
      if (k1) out.push([i1, j1, k1]);
      i1 = i2;
      j1 = j2;
      k1 = k2;
    }
  }
  if (k1) out.push([i1, j1, k1]);
  out.push([a.length, b.length, 0]);
  return /** @type {Array<[number, number, number]>} */ (out);
}

/**
 * `SequenceMatcher(None, a, b).ratio()` auf den ROHEN Zeichenketten
 * (ohne Normalisierung — die macht `ratio`).
 * @returns {number} 0 … 1
 */
export function ratioRoh(a, b) {
  const sa = String(a ?? '');
  const sb = String(b ?? '');
  const gesamt = sa.length + sb.length;
  if (gesamt === 0) return 1; // wie Python: zwei leere Folgen sind gleich
  let treffer = 0;
  for (const [, , k] of matchingBlocks(sa, sb)) treffer += k;
  return (2 * treffer) / gesamt;
}

/**
 * DIE Ähnlichkeit: normalisieren, dann Ratcliff/Obershelp. 0 … 1.
 * Das ist die Zahl, die als `sim` in den Preisschichten und als Sequenzanteil im
 * STLB-Score steht.
 *
 * **NICHT symmetrisch** — und das ist kein Fehler, sondern difflib.
 * `SequenceMatcher` zerlegt rekursiv um den LÄNGSTEN gemeinsamen Block; bei
 * gleich langen Alternativen entscheidet die Tiebreak-Regel, und die hängt an der
 * Reihenfolge der Argumente. Auf den 3.000 echten Kurztextpaaren weichen etwa
 * 1 % der Paare ab (Beispiel: „Erstellen Ausschnitt …" gegen „Voranstrich …"
 * ergibt 0,308 bzw. 0,385).
 *
 * Konsequenz, die eingehalten werden MUSS: die Reihenfolge ist festgelegt —
 * **(eigener Text, fremder Text)**, genau wie in der Pipeline
 * (`SequenceMatcher(None, norm(eigen), norm(fremd))`). Wer sie vertauscht,
 * bekommt andere Zahlen und verliert die Parität. Gate G17 hält beides fest:
 * die Asymmetrie als Eigenschaft und die Reihenfolge als Vertrag.
 */
export function ratio(a, b) {
  return ratioRoh(normalisiere(a), normalisiere(b));
}

/**
 * Jaccard über die TOKENMENGE des normalisierten Texts.
 * Zweiter Bestandteil des STLB-Scores (Gewicht kommt aus dem Katalog, nicht hierher).
 */
export function jaccard(a, b) {
  const ta = new Set(normalisiere(a).split(' ').filter(Boolean));
  const tb = new Set(normalisiere(b).split(' ').filter(Boolean));
  if (ta.size === 0 && tb.size === 0) return 0;
  let schnitt = 0;
  for (const t of ta) if (tb.has(t)) schnitt += 1;
  const vereinigung = ta.size + tb.size - schnitt;
  return vereinigung === 0 ? 0 : schnitt / vereinigung;
}

/**
 * Warnt, wenn ein Text die Autojunk-Grenze reißt — dann ist die difflib-Parität
 * NICHT mehr gegeben, und zwar lautlos.
 * @returns {string|null}
 */
export function autojunkWarnung(text) {
  const n = normalisiere(text);
  return n.length >= AUTOJUNK_GRENZE
    ? `normalisierter Text ist ${n.length} Zeichen lang (Grenze ${AUTOJUNK_GRENZE}) — ` +
      'Pythons Autojunk-Heuristik würde hier greifen, die eingefrorenen Vergleichswerte gelten nicht mehr'
    : null;
}

/**
 * Bester Treffer aus einer Kandidatenliste — EIN Weg, nicht drei.
 * @param {string} text
 * @param {Array<object>} kandidaten
 * @param {(k: object) => string} textVon
 * @param {(seq: number, jac: number) => number} [score] Standard: reines `ratio`
 * @returns {{kandidat: object|null, score: number, ratio: number, jaccard: number}}
 */
export function bestesMatch(text, kandidaten = [], textVon = (k) => k?.kurztext, score = null) {
  let beste = null;
  let bester = -1;
  let besterRatio = 0;
  let besterJac = 0;
  for (const k of kandidaten || []) {
    const kt = textVon(k);
    if (!kt) continue;
    const seq = ratio(text, kt);
    const jac = jaccard(text, kt);
    const s = score ? score(seq, jac) : seq;
    if (s > bester) {
      bester = s;
      beste = k;
      besterRatio = seq;
      besterJac = jac;
    }
  }
  return { kandidat: beste, score: bester < 0 ? 0 : bester, ratio: besterRatio, jaccard: besterJac };
}
