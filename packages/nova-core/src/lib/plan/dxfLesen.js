// Minimal DXF reader (ASCII) — own implementation, no dependency (ROADMAP 101-03: import cadastral
// parcels from DXF). Reads exactly what a parcel import needs and says plainly what it skipped:
//   LWPOLYLINE, POLYLINE (+VERTEX/SEQEND), LINE (chained into rings per layer), TEXT/MTEXT
//   (parcel numbers), HEADER $INSUNITS, 999 comments. Layer filter by name.
// Not read (counted in a warning instead): blocks/INSERT, arcs/circles/splines/hatches, bulges
// (arc segments of polylines are taken as their chord), binary DXF.
//
// In:  file TEXT (untrusted user input), optional layer filter.
// Out: polylines and texts in DRAWING UNITS (x east, y north as in the file), layer list with
//      counts, $INSUNITS, comments, warnings as {text, werte} (German template + values; the
//      caller translates with t() and fills the {placeholders}). Never throws.
// Pure module: no DOM, no React, node-testable. Counterpart of dxfR12.js (writer).

/**
 * Reader limits. [ASSUMED] sizes: a cadastral extract of a few blocks is well below; larger
 * files are rejected loudly instead of freezing the tab.
 * @type {{maxBytes: number, maxEntitaeten: number, maxLinien: number}}
 */
export const DXF_GRENZEN = Object.freeze({
  maxBytes: 20_000_000,  // ~20 MB text [ASSUMED]
  maxEntitaeten: 200_000, // entities in ENTITIES [ASSUMED]
  maxLinien: 20_000,      // LINE segments chained into rings (O(n²) chaining) [ASSUMED]
});

/**
 * German message templates of the reader ({name} = placeholder). The English texts live in
 * i18nTeile/dxf-104.js; callers pass them through t() and fill the values with meldungText().
 * @type {Readonly<Record<string, string>>}
 */
export const DXF_MELDUNGEN = Object.freeze({
  leer: "DXF-Datei ist leer.",
  zuGross: "DXF-Datei zu groß ({kb} kB > {max} kB).",
  binaer: "Binäres DXF wird nicht gelesen — bitte als ASCII-DXF speichern.",
  keinDxf: "Datei ist kein lesbares DXF (Gruppencode/Wert-Paare fehlen).",
  keineEntities: "DXF enthält keinen ENTITIES-Abschnitt.",
  zuVieleEntitaeten: "Mehr als {max} Objekte — Rest ignoriert.",
  zuVieleLinien: "Mehr als {max} Einzellinien — nicht zu Ringen verkettet.",
  boegen: "{n} Bogensegment(e) als gerade Sehne übernommen — die Fläche weicht dort leicht ab.",
  bloecke: "{n} Blockreferenz(en) (INSERT) nicht aufgelöst — Geometrie in Blöcken fehlt.",
  nichtGelesen: "{n} Objekt(e) anderer Art übersprungen ({arten}).",
  netz: "{n} Polygonnetz/Flächennetz-Polylinie(n) übersprungen.",
  offeneLinien: "{n} offene Linienzüge übersprungen (keine geschlossene Fläche).",
  abgebrochen: "DXF ab Zeile {zeile} nicht lesbar (kein Gruppencode) — alles danach fehlt, Flurstücke können unvollständig sein.",
});

/**
 * Fills a message template: replaces {name} by werte.name, after translating the template.
 * @param {{text: string, werte?: Record<string, string|number>}} m message
 * @param {(s: string) => string} [t] translator (i18n t), default identity
 * @returns {string}
 */
export function meldungText(m, t = (s) => s) {
  const werte = m?.werte || {};
  return String(t(m?.text ?? "")).replace(/\{(\w+)\}/g, (_, k) => (werte[k] != null ? String(werte[k]) : `{${k}}`));
}

/**
 * Splits DXF text into group code / value pairs. Codes are integers on their own line, the
 * value is the following line (trimmed; CRLF, LF or CR line ends). Reading stops at the first
 * line that is no group code; the pairs before it are kept and abbruchZeile names that line, so
 * the caller can say the rest is missing instead of silently returning a partial file.
 * @param {string} text DXF file content
 * @returns {{paare: Array<{code: number, wert: string}>, fehler: string|null, abbruchZeile: number|null}}
 *   pairs; fehler = key of DXF_MELDUNGEN; abbruchZeile = 1-based line where reading stopped early (null = read to the end)
 */
export function dxfPaare(text) {
  const s = String(text ?? "").replace(/^\uFEFF/, ""); // byte order mark
  if (!s.trim()) return { paare: [], fehler: "leer", abbruchZeile: null };
  if (s.startsWith("AutoCAD Binary DXF")) return { paare: [], fehler: "binaer", abbruchZeile: null };
  const zeilen = s.split(/\r\n|\r|\n/);
  /** @type {Array<{code: number, wert: string}>} */
  const paare = [];
  for (let i = 0; i + 1 < zeilen.length; i += 2) {
    const roh = zeilen[i].trim();
    if (roh === "" && i + 2 >= zeilen.length) break; // trailing empty line
    if (!/^-?\d+$/.test(roh)) return paare.length ? { paare, fehler: null, abbruchZeile: i + 1 } : { paare, fehler: "keinDxf", abbruchZeile: null };
    paare.push({ code: Number(roh), wert: zeilen[i + 1].trim() });
  }
  if (!paare.length) return { paare, fehler: "keinDxf", abbruchZeile: null };
  return { paare, fehler: null, abbruchZeile: null };
}

/**
 * @typedef {{x: number, y: number}} DxfPkt point in drawing units (y north)
 * @typedef {{ebene: string, punkte: DxfPkt[], geschlossen: boolean, quelle: 'LWPOLYLINE'|'POLYLINE'|'LINE'}} DxfPolylinie
 * @typedef {{ebene: string, x: number, y: number, text: string}} DxfText
 * @typedef {{text: string, werte?: Record<string, string|number>}} DxfMeldung
 */

/** Group pairs of one entity (code 0 starts the next one). */
function entitaeten(paare, start) {
  /** @type {Array<{typ: string, gruppen: Array<{code: number, wert: string}>}>} */
  const liste = [];
  let i = start;
  /** @type {{typ: string, gruppen: Array<{code: number, wert: string}>}|null} */
  let akt = null;
  for (; i < paare.length; i++) {
    const p = paare[i];
    if (p.code === 0) {
      if (akt) liste.push(akt);
      if (p.wert === "ENDSEC" || p.wert === "EOF") { akt = null; break; }
      akt = { typ: p.wert.toUpperCase(), gruppen: [] };
    } else if (akt) akt.gruppen.push(p);
  }
  if (akt) liste.push(akt);
  return liste;
}

const num = (/** @type {string} */ w) => { const n = Number(w); return Number.isFinite(n) ? n : NaN; };
const gleich = (/** @type {DxfPkt} */ a, /** @type {DxfPkt} */ b, /** @type {number} */ tol) => Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol;

/** Closing duplicate (last = first) removed; a polyline that returns to its start counts as closed. */
function ringBereinigen(/** @type {DxfPkt[]} */ pts, /** @type {boolean} */ geschlossen, /** @type {number} */ tol) {
  const p = pts.filter((q) => Number.isFinite(q.x) && Number.isFinite(q.y));
  /** @type {DxfPkt[]} */
  const ohneDoppel = [];
  for (const q of p) if (!ohneDoppel.length || !gleich(ohneDoppel[ohneDoppel.length - 1], q, tol)) ohneDoppel.push(q);
  if (ohneDoppel.length > 2 && gleich(ohneDoppel[0], ohneDoppel[ohneDoppel.length - 1], tol)) {
    ohneDoppel.pop();
    return { punkte: ohneDoppel, geschlossen: true };
  }
  return { punkte: ohneDoppel, geschlossen };
}

/**
 * Chains LINE segments of one layer into polylines (endpoint matching within tol, either
 * direction). Closed chains become rings.
 * @param {Array<[DxfPkt, DxfPkt]>} segmente
 * @param {number} tol drawing units
 * @returns {Array<{punkte: DxfPkt[], geschlossen: boolean}>}
 */
export function linienVerketten(segmente, tol) {
  const frei = segmente.map((s) => s.slice());
  const benutzt = new Array(frei.length).fill(false);
  /** @type {Array<{punkte: DxfPkt[], geschlossen: boolean}>} */
  const ketten = [];
  for (let s = 0; s < frei.length; s++) {
    if (benutzt[s]) continue;
    benutzt[s] = true;
    const kette = [frei[s][0], frei[s][1]];
    let geschlossen = false;
    for (;;) {
      const ende = kette[kette.length - 1];
      if (kette.length > 2 && gleich(ende, kette[0], tol)) { kette.pop(); geschlossen = true; break; }
      let gefunden = -1, umgedreht = false;
      for (let k = 0; k < frei.length; k++) {
        if (benutzt[k]) continue;
        if (gleich(frei[k][0], ende, tol)) { gefunden = k; break; }
        if (gleich(frei[k][1], ende, tol)) { gefunden = k; umgedreht = true; break; }
      }
      if (gefunden < 0) break;
      benutzt[gefunden] = true;
      kette.push(umgedreht ? frei[gefunden][0] : frei[gefunden][1]);
    }
    ketten.push({ punkte: kette, geschlossen });
  }
  return ketten;
}

/** MTEXT formatting codes removed (\P paragraph, \f…; font, braces) — enough for parcel numbers. */
function mtextKlar(/** @type {string} */ s) {
  return s.replace(/\\P/gi, " ").replace(/\\[A-Za-z][^;\\{}]*;/g, "").replace(/[{}]/g, "").replace(/\\(.)/g, "$1").trim();
}

/**
 * Reads the geometry a parcel import needs from an ASCII DXF.
 * @param {string} text DXF file content (untrusted)
 * @param {{ebenen?: string[]|null, toleranz?: number}} [opt] ebenen = only these layers
 *   (names compared case-insensitively; null/empty = all); toleranz = point identity for
 *   closing/chaining, drawing units (default 1e-6)
 * @returns {{polylinien: DxfPolylinie[], texte: DxfText[], ebenen: Array<{name: string, anzahl: number}>,
 *   einheit: number|null, kommentare: string[], warnungen: DxfMeldung[], fehler: DxfMeldung|null}}
 *   ebenen = every layer with readable geometry (before the filter) and its count of
 *   polylines/lines; einheit = $INSUNITS (6 = metres) or null; fehler set when nothing could be read
 */
export function dxfLesen(text, { ebenen = null, toleranz = 1e-6 } = {}) {
  /** @type {DxfPolylinie[]} */
  const polylinien = [];
  /** @type {DxfText[]} */
  const texte = [];
  /** @type {DxfMeldung[]} */
  const warnungen = [];
  /** @type {string[]} */
  const kommentare = [];
  /** @type {Map<string, number>} */
  const ebenenZahl = new Map();
  const ergebnis = (/** @type {DxfMeldung|null} */ fehler) => ({
    polylinien, texte, warnungen, kommentare, einheit,
    ebenen: [...ebenenZahl.entries()].map(([name, anzahl]) => ({ name, anzahl })).sort((a, b) => a.name.localeCompare(b.name)),
    fehler,
  });
  /** @type {number|null} */
  let einheit = null;

  const s = String(text ?? "");
  if (s.length > DXF_GRENZEN.maxBytes) {
    return ergebnis({ text: DXF_MELDUNGEN.zuGross, werte: { kb: Math.round(s.length / 1024).toLocaleString("de-DE"), max: Math.round(DXF_GRENZEN.maxBytes / 1024).toLocaleString("de-DE") } });
  }
  const { paare, fehler, abbruchZeile } = dxfPaare(s);
  if (fehler) return ergebnis({ text: DXF_MELDUNGEN[fehler] });
  // A damaged or shifted file must not pass as complete: a missing parcel shrinks the plot boundary.
  if (abbruchZeile != null) warnungen.push({ text: DXF_MELDUNGEN.abgebrochen, werte: { zeile: abbruchZeile.toLocaleString("de-DE") } });

  const filter = Array.isArray(ebenen) && ebenen.length ? new Set(ebenen.map((e) => String(e).toUpperCase())) : null;
  const zaehle = (/** @type {string} */ eb) => ebenenZahl.set(eb, (ebenenZahl.get(eb) || 0) + 1);
  const imFilter = (/** @type {string} */ eb) => !filter || filter.has(eb.toUpperCase());

  // ---- sections ----
  let entitiesStart = -1;
  for (let i = 0; i < paare.length; i++) {
    const p = paare[i];
    if (p.code === 999) kommentare.push(p.wert);
    if (p.code === 0 && p.wert === "SECTION" && paare[i + 1]?.code === 2) {
      const name = paare[i + 1].wert.toUpperCase();
      if (name === "HEADER") {
        for (let k = i + 2; k < paare.length && !(paare[k].code === 0 && paare[k].wert === "ENDSEC"); k++) {
          if (paare[k].code === 9 && paare[k].wert === "$INSUNITS" && paare[k + 1]?.code === 70) einheit = num(paare[k + 1].wert);
        }
      } else if (name === "ENTITIES") entitiesStart = i + 2;
    }
  }
  if (entitiesStart < 0) return ergebnis({ text: DXF_MELDUNGEN.keineEntities });

  const ents = entitaeten(paare, entitiesStart);
  if (ents.length > DXF_GRENZEN.maxEntitaeten) {
    warnungen.push({ text: DXF_MELDUNGEN.zuVieleEntitaeten, werte: { max: DXF_GRENZEN.maxEntitaeten.toLocaleString("de-DE") } });
    ents.length = DXF_GRENZEN.maxEntitaeten;
  }
  let boegen = 0, bloecke = 0, netze = 0;
  /** @type {Map<string, number>} */
  const andere = new Map();
  /** @type {Map<string, Array<[DxfPkt, DxfPkt]>>} */
  const linienJeEbene = new Map();
  const ebeneVon = (/** @type {Array<{code: number, wert: string}>} */ g) => g.find((x) => x.code === 8)?.wert || "0";

  for (let i = 0; i < ents.length; i++) {
    const e = ents[i];
    const eb = ebeneVon(e.gruppen);
    if (e.typ === "LWPOLYLINE") {
      const flags = num(e.gruppen.find((x) => x.code === 70)?.wert ?? "0") || 0;
      /** @type {DxfPkt[]} */
      const pts = [];
      for (const g of e.gruppen) {
        if (g.code === 10) pts.push({ x: num(g.wert), y: NaN });
        else if (g.code === 20 && pts.length) pts[pts.length - 1].y = num(g.wert);
        else if (g.code === 42 && num(g.wert)) boegen++;
      }
      zaehle(eb);
      if (!imFilter(eb)) continue;
      const r = ringBereinigen(pts, (flags & 1) === 1, toleranz);
      if (r.punkte.length >= 2) polylinien.push({ ebene: eb, ...r, quelle: "LWPOLYLINE" });
    } else if (e.typ === "POLYLINE") {
      const flags = num(e.gruppen.find((x) => x.code === 70)?.wert ?? "0") || 0;
      /** @type {DxfPkt[]} */
      const pts = [];
      // VERTEX entities follow until SEQEND.
      let k = i + 1;
      for (; k < ents.length && ents[k].typ === "VERTEX"; k++) {
        const v = ents[k].gruppen;
        const vflags = num(v.find((x) => x.code === 70)?.wert ?? "0") || 0;
        if (vflags & (16 | 128)) continue; // spline frame point / polyface face record
        if (num(v.find((x) => x.code === 42)?.wert ?? "0")) boegen++;
        pts.push({ x: num(v.find((x) => x.code === 10)?.wert ?? "NaN"), y: num(v.find((x) => x.code === 20)?.wert ?? "NaN") });
      }
      if (ents[k]?.typ === "SEQEND") i = k; else i = k - 1;
      if (flags & (16 | 64)) { netze++; continue; } // polygon mesh / polyface mesh: not an outline
      zaehle(eb);
      if (!imFilter(eb)) continue;
      const r = ringBereinigen(pts, (flags & 1) === 1, toleranz);
      if (r.punkte.length >= 2) polylinien.push({ ebene: eb, ...r, quelle: "POLYLINE" });
    } else if (e.typ === "LINE") {
      const w = (/** @type {number} */ c) => num(e.gruppen.find((x) => x.code === c)?.wert ?? "NaN");
      const a = { x: w(10), y: w(20) }, b = { x: w(11), y: w(21) };
      zaehle(eb);
      if (!imFilter(eb) || ![a.x, a.y, b.x, b.y].every(Number.isFinite) || gleich(a, b, toleranz)) continue;
      if (!linienJeEbene.has(eb)) linienJeEbene.set(eb, []);
      /** @type {Array<[DxfPkt, DxfPkt]>} */ (linienJeEbene.get(eb)).push([a, b]);
    } else if (e.typ === "TEXT" || e.typ === "MTEXT") {
      const g = e.gruppen;
      const w = (/** @type {number} */ c) => num(g.find((x) => x.code === c)?.wert ?? "NaN");
      // TEXT with an alignment (72/73 ≠ 0) is placed by its alignment point 11/21.
      const ausgerichtet = e.typ === "TEXT" && (w(72) || w(73)) && Number.isFinite(w(11));
      const x = ausgerichtet ? w(11) : w(10), y = ausgerichtet ? w(21) : w(20);
      const roh = g.filter((q) => q.code === 3 || q.code === 1).map((q) => q.wert).join("");
      const inhalt = e.typ === "MTEXT" ? mtextKlar(roh) : roh.trim();
      // Texts of EVERY layer: parcel numbers usually sit on a text layer of their own, the
      // layer filter is meant for the outlines.
      if (Number.isFinite(x) && Number.isFinite(y) && inhalt) texte.push({ ebene: eb, x, y, text: inhalt });
    } else if (e.typ === "INSERT") bloecke++;
    else if (e.typ !== "VERTEX" && e.typ !== "SEQEND") andere.set(e.typ, (andere.get(e.typ) || 0) + 1);
  }

  // ---- LINE segments → chains per layer (closed chains = rings) ----
  for (const [eb, seg] of linienJeEbene) {
    if (seg.length > DXF_GRENZEN.maxLinien) {
      warnungen.push({ text: DXF_MELDUNGEN.zuVieleLinien, werte: { max: DXF_GRENZEN.maxLinien.toLocaleString("de-DE") } });
      continue;
    }
    for (const k of linienVerketten(seg, toleranz)) {
      polylinien.push({ ebene: eb, punkte: k.punkte, geschlossen: k.geschlossen && k.punkte.length >= 3, quelle: "LINE" });
    }
  }

  if (boegen) warnungen.push({ text: DXF_MELDUNGEN.boegen, werte: { n: boegen } });
  if (bloecke) warnungen.push({ text: DXF_MELDUNGEN.bloecke, werte: { n: bloecke } });
  if (netze) warnungen.push({ text: DXF_MELDUNGEN.netz, werte: { n: netze } });
  if (andere.size) {
    const n = [...andere.values()].reduce((a, b) => a + b, 0);
    warnungen.push({ text: DXF_MELDUNGEN.nichtGelesen, werte: { n, arten: [...andere.keys()].sort().join(", ") } });
  }
  return ergebnis(null);
}
