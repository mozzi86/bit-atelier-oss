// xmlMini.js — DOM-freier Mini-XML-Leser (Phase 71-04, aus xlsxRead.js in
// @ava 1:1 nach @core gehoben — Boundary-Regel: @ifc darf @ava nicht
// importieren, braucht denselben Leser aber für BCF).
//
// In:  XML-String. Out: xmlDurchlaufen (SAX-artiger Stream), xmlEntschaerfen
//      (Entity-Auflösung), xmlBaum (verschachtelte Objekte für kleine
//      Dokumente wie markup.bcf).
//
// Grenzen (bewusst, wie in xlsxRead): KEINE Entity-Auflösung über die fünf
// XML-Standardentitäten hinaus, KEIN DTD (XXE-Schutz: DOCTYPE im Kopf wird
// abgelehnt), Tiefen- und Längengrenzen gegen Zip-Bomb-Folgeangriffe.
// Node hat keinen DOMParser (beispielmodell.test.js:7-9) — genau darum
// dieser Leser, damit BCF-Import/Export unter Node testbar sind.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/**
 * Löst XML-Entities auf: die fünf Standardentitäten + numerische
 * (&#228; / &#xE4;). Unbekannte bleiben literal stehen.
 * @param {unknown} s
 * @returns {string}
 */
export function xmlEntschaerfen(s) {
  return String(s == null ? '' : s).replace(/&(#x?[0-9A-Fa-f]+|[a-zA-Z]+);/g, (all, ent) => {
    if (ent[0] === '#') {
      const code = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      // Nur druckbare/erlaubte Codepoints; alles andere bleibt literal stehen.
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, ent) ? ENTITIES[ent] : all;
  });
}

/** Namespace-Präfix abschneiden: „ids:specification" -> „specification". */
function lokal(name) {
  const k = name.indexOf(':');
  return k < 0 ? name : name.slice(k + 1);
}

function attrsLesen(s) {
  const out = {};
  const re = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(s))) {
    out[lokal(m[1])] = xmlEntschaerfen(m[3] != null ? m[3] : m[4]);
  }
  return out;
}

/**
 * Streamt Tags eines XML-Strings. `cb(tag)` mit
 * `{name, voll, attrs, selbstschliessend, ende, text}` — `text` nur bei
 * Endtags, gesammelt seit dem zugehörigen Starttag (entschärft).
 *
 * @param {string} xml
 * @param {(tag: object) => void} cb
 * @param {{maxTiefe?: number, maxLaenge?: number}} [opt]
 * @throws {Error} bei DOCTYPE (XXE), Überlänge oder zu tiefer Verschachtelung
 */
export function xmlDurchlaufen(xml, cb, { maxTiefe = 128, maxLaenge = 64 * 1024 * 1024 } = {}) {
  const s = String(xml || '');
  if (s.length > maxLaenge) throw new Error(`xmlDurchlaufen: XML zu groß (${s.length} > ${maxLaenge})`);
  if (/<!DOCTYPE/i.test(s.slice(0, 4096))) {
    throw new Error('xmlDurchlaufen: DTD/DOCTYPE wird nicht verarbeitet (XXE-Schutz)');
  }
  let i = 0;
  let tiefe = 0;
  const textStack = [];
  while (i < s.length) {
    const lt = s.indexOf('<', i);
    if (lt < 0) break;
    if (lt > i && textStack.length) textStack[textStack.length - 1] += s.slice(i, lt);
    if (s.startsWith('<!--', lt)) {
      const e = s.indexOf('-->', lt);
      i = e < 0 ? s.length : e + 3;
      continue;
    }
    if (s.startsWith('<?', lt)) {
      const e = s.indexOf('?>', lt);
      i = e < 0 ? s.length : e + 2;
      continue;
    }
    const gt = s.indexOf('>', lt);
    if (gt < 0) break;
    const roh = s.slice(lt + 1, gt);
    i = gt + 1;
    if (roh.startsWith('/')) {
      const name = roh.slice(1).trim();
      const text = textStack.pop() ?? '';
      tiefe -= 1;
      cb({ name: lokal(name), voll: name, attrs: null, selbstschliessend: false, ende: true, text: xmlEntschaerfen(text) });
      continue;
    }
    const selbst = roh.endsWith('/');
    const inhalt = selbst ? roh.slice(0, -1) : roh;
    const sp = inhalt.search(/[\s]/);
    const name = sp < 0 ? inhalt : inhalt.slice(0, sp);
    const attrs = sp < 0 ? {} : attrsLesen(inhalt.slice(sp));
    if (!selbst) {
      tiefe += 1;
      if (tiefe > maxTiefe) throw new Error(`xmlDurchlaufen: Verschachtelung zu tief (> ${maxTiefe})`);
      textStack.push('');
    }
    cb({ name: lokal(name), voll: name, attrs, selbstschliessend: selbst, ende: false, text: null });
  }
}

/**
 * Baut aus einem XML-String einen Objektbaum — für KLEINE Dokumente
 * (markup.bcf, bcf.version); für große Mengen bleibt xmlDurchlaufen der Weg.
 *
 * Knotenform: { name (lokal), voll (mit Präfix), attrs: {name: wert} | null,
 * kinder: Knoten[], text: string (eigener Text, entschärft) }.
 * Self-closing-Tags werden zu kinderlosen Knoten; der Wurzelknoten ist das
 * erste Top-Level-Element (XML-Deklaration/Kommentare werden übersprungen).
 *
 * @param {string} xml
 * @returns {object|null} Wurzelknoten oder null (leeres Dokument)
 */
export function xmlBaum(xml) {
  const stack = [];
  let wurzel = null;
  xmlDurchlaufen(xml, (t) => {
    if (t.selbstschliessend) {
      const knoten = { name: t.name, voll: t.voll, attrs: t.attrs, kinder: [], text: '' };
      if (stack.length) stack[stack.length - 1].kinder.push(knoten);
      else if (!wurzel) wurzel = knoten;
      return;
    }
    if (!t.ende) {
      const knoten = { name: t.name, voll: t.voll, attrs: t.attrs, kinder: [], text: '' };
      if (stack.length) stack[stack.length - 1].kinder.push(knoten);
      else if (!wurzel) wurzel = knoten;
      stack.push(knoten);
      return;
    }
    const knoten = stack.pop();
    if (knoten && t.text) knoten.text += t.text;
  });
  return wurzel;
}

/**
 * Erstes Kind mit lokalem Namen (oder null) — Convenience für xmlBaum.
 * @param {object|null} knoten
 * @param {string} name lokaler Elementname
 * @returns {object|null}
 */
export function kind(knoten, name) {
  return knoten?.kinder?.find((k) => k.name === name) ?? null;
}

/**
 * Alle Kinder mit lokalem Namen — Convenience für xmlBaum.
 * @param {object|null} knoten
 * @param {string} name
 * @returns {object[]}
 */
export function kinder(knoten, name) {
  return (knoten?.kinder || []).filter((k) => k.name === name);
}

/**
 * Text des ersten Kindes mit lokalem Namen (entschärft, getrimmt) oder ''.
 * @param {object|null} knoten
 * @param {string} name
 * @returns {string}
 */
export function kindText(knoten, name) {
  return (kind(knoten, name)?.text || '').trim();
}
