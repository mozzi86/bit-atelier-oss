// domParserMini.js — minimal DOMParser for Node IDS parsing (Phase 77).
//
// Why: parseIdsXml (ids.js) needs getElementsByTagNameNS / namespaceURI / localName.
// Node has no DOMParser; adding @xmldom/xmldom would be a new dependency (forbidden
// without ask). This adapter walks XML with a namespace stack and exposes just the
// surface ids.js touches — no full DOM, no DTD (XXE: DOCTYPE rejected).
//
// In:  XML string. Out: { parseFromString(xml, mime) → document-like }.
// Reuses the five-entity unescape from @core/lib/xmlMini.

import { xmlEntschaerfen } from "@core/lib/xmlMini";

const ELEMENT = 1;
const TEXT = 3;

/**
 * Attach DOM NodeList-like `.item(i)` onto a plain array.
 * @param {any[]} arr
 * @returns {any[]}
 */
function mitItem(arr) {
  /** @type {any} */
  const a = arr;
  a.item = (/** @type {number} */ i) => a[i] ?? null;
  return a;
}

/**
 * @param {string} name raw tag or attr name (may include prefix)
 * @returns {{prefix: string, lokal: string}}
 */
function teileName(name) {
  const i = String(name).indexOf(":");
  if (i < 0) return { prefix: "", lokal: String(name) };
  return { prefix: String(name).slice(0, i), lokal: String(name).slice(i + 1) };
}

/**
 * Parse attribute string into {name → value} keeping full names (incl. xmlns:…).
 * @param {string} s
 * @returns {Record<string, string>}
 */
function attrsRoh(s) {
  /** @type {Record<string, string>} */
  const out = {};
  const re = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(s))) {
    out[m[1]] = xmlEntschaerfen(m[3] != null ? m[3] : m[4]);
  }
  return out;
}

/**
 * @param {Record<string, string>} attrs
 * @param {Map<string, string>} geerbt prefix → namespace URI ("" = default)
 * @returns {Map<string, string>}
 */
function nsAusAttrs(attrs, geerbt) {
  const map = new Map(geerbt);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "xmlns") map.set("", v);
    else if (k.startsWith("xmlns:")) map.set(k.slice(6), v);
  }
  return map;
}

/**
 * Build one element node.
 * @param {string} voll raw name with optional prefix
 * @param {Record<string, string>} attrs
 * @param {Map<string, string>} nsMap
 */
function elementKnoten(voll, attrs, nsMap) {
  const { prefix, lokal } = teileName(voll);
  const namespaceURI = nsMap.get(prefix) || null;
  /** @type {any[]} */
  const kinder = [];
  /** @type {Record<string, string>} */
  const attrLokal = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "xmlns" || k.startsWith("xmlns:")) continue;
    attrLokal[teileName(k).lokal] = v;
  }
  const knoten = {
    nodeType: ELEMENT,
    nodeName: voll,
    tagName: voll,
    localName: lokal,
    prefix: prefix || null,
    namespaceURI,
    childNodes: kinder,
    children: kinder,
    attributes: attrLokal,
    textContent: "",
    /**
     * @param {string} name
     * @returns {boolean}
     */
    hasAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attrLokal, name);
    },
    /**
     * @param {string} name
     * @returns {string|null}
     */
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attrLokal, name) ? attrLokal[name] : null;
    },
    /**
     * @param {string} ns
     * @param {string} lokalName
     * @returns {any[]}
     */
    getElementsByTagNameNS(ns, lokalName) {
      /** @type {any[]} */
      const treffer = [];
      const walk = (n) => {
        if (n.nodeType !== ELEMENT) return;
        if ((ns === "*" || n.namespaceURI === ns) && (lokalName === "*" || n.localName === lokalName)) {
          treffer.push(n);
        }
        for (const k of n.childNodes) walk(k);
      };
      for (const k of kinder) walk(k);
      return mitItem(treffer);
    },
    /**
     * @param {string} name
     * @returns {any[]}
     */
    getElementsByTagName(name) {
      /** @type {any[]} */
      const treffer = [];
      const walk = (n) => {
        if (n.nodeType !== ELEMENT) return;
        if (name === "*" || n.localName === name || n.tagName === name) treffer.push(n);
        for (const k of n.childNodes) walk(k);
      };
      for (const k of kinder) walk(k);
      return mitItem(treffer);
    },
  };
  return knoten;
}

/**
 * Refresh textContent from descendant text nodes (ids.js reads simpleValue.textContent).
 * @param {any} knoten
 */
function textAuffuellen(knoten) {
  if (knoten.nodeType !== ELEMENT) return;
  let t = "";
  for (const k of knoten.childNodes) {
    if (k.nodeType === TEXT) t += k.data;
    else if (k.nodeType === ELEMENT) {
      textAuffuellen(k);
      t += k.textContent;
    }
  }
  knoten.textContent = t;
}

/**
 * Parse XML into a document-like object with documentElement + NS helpers.
 * @param {string} xml
 * @returns {{documentElement: any|null, getElementsByTagName: Function, getElementsByTagNameNS: Function}}
 */
export function parseXmlMini(xml) {
  const s = String(xml || "");
  if (/<!DOCTYPE/i.test(s.slice(0, 4096))) {
    throw new Error("DOMParser-Mini: DTD/DOCTYPE wird nicht verarbeitet (XXE-Schutz)");
  }
  /** @type {any[]} */
  const stack = [];
  /** @type {Map<string, string>[]} */
  const nsStack = [new Map()];
  /** @type {any|null} */
  let wurzel = null;
  let i = 0;
  while (i < s.length) {
    const lt = s.indexOf("<", i);
    if (lt < 0) break;
    if (lt > i && stack.length) {
      const text = xmlEntschaerfen(s.slice(i, lt));
      if (text) {
        stack[stack.length - 1].childNodes.push({ nodeType: TEXT, data: text, textContent: text });
      }
    }
    if (s.startsWith("<!--", lt)) {
      const e = s.indexOf("-->", lt);
      i = e < 0 ? s.length : e + 3;
      continue;
    }
    if (s.startsWith("<?", lt)) {
      const e = s.indexOf("?>", lt);
      i = e < 0 ? s.length : e + 2;
      continue;
    }
    const gt = s.indexOf(">", lt);
    if (gt < 0) break;
    const roh = s.slice(lt + 1, gt);
    i = gt + 1;
    if (roh.startsWith("/")) {
      const knoten = stack.pop();
      nsStack.pop();
      if (knoten) textAuffuellen(knoten);
      continue;
    }
    const selbst = roh.endsWith("/");
    const inhalt = selbst ? roh.slice(0, -1) : roh;
    const sp = inhalt.search(/[\s/]/);
    const name = sp < 0 ? inhalt : inhalt.slice(0, sp);
    const attrs = sp < 0 ? {} : attrsRoh(inhalt.slice(sp));
    const nsMap = nsAusAttrs(attrs, nsStack[nsStack.length - 1]);
    const knoten = elementKnoten(name, attrs, nsMap);
    if (stack.length) stack[stack.length - 1].childNodes.push(knoten);
    else if (!wurzel) wurzel = knoten;
    if (!selbst) {
      stack.push(knoten);
      nsStack.push(nsMap);
    } else {
      textAuffuellen(knoten);
    }
  }
  if (wurzel) textAuffuellen(wurzel);

  const doc = {
    documentElement: wurzel,
    /**
     * @param {string} name
     * @returns {any[]}
     */
    getElementsByTagName(name) {
      if (!wurzel) {
        return mitItem([]);
      }
      if (name === "parsererror") {
        return mitItem([]);
      }
      return wurzel.getElementsByTagName(name);
    },
    /**
     * @param {string} ns
     * @param {string} lokal
     * @returns {any[]}
     */
    getElementsByTagNameNS(ns, lokal) {
      if (!wurzel) {
        return mitItem([]);
      }
      /** @type {any[]} */
      const treffer = [];
      const walk = (n) => {
        if (!n || n.nodeType !== ELEMENT) return;
        if ((ns === "*" || n.namespaceURI === ns) && (lokal === "*" || n.localName === lokal)) {
          treffer.push(n);
        }
        for (const k of n.childNodes) walk(k);
      };
      walk(wurzel);
      return mitItem(treffer);
    },
  };
  return doc;
}

/**
 * DOMParser-compatible constructor for injection into parseIdsXml(_, DOMParserMini).
 */
export class DOMParserMini {
  /**
   * @param {string} xml
   * @param {string} [_mime]
   * @returns {ReturnType<typeof parseXmlMini>}
   */
  parseFromString(xml, _mime) {
    try {
      return parseXmlMini(xml);
    } catch (e) {
      const msg = e && /** @type {any} */ (e).message ? /** @type {any} */ (e).message : String(e);
      const errEl = elementKnoten("parsererror", {}, new Map());
      errEl.textContent = msg;
      errEl.childNodes.push({ nodeType: TEXT, data: msg, textContent: msg });
      return {
        documentElement: errEl,
        getElementsByTagName(name) {
          if (name === "parsererror") {
            const a = [errEl];
            return mitItem(a);
          }
          return mitItem([]);
        },
        getElementsByTagNameNS() {
          return mitItem([]);
        },
      };
    }
  }
}
