// clashRegeln.js — Regeldatei der Prüfmatrix laden, validieren und in die
// clashPairsIter-Form übersetzen (Phase 71-02).
//
// In:  JSON einer Regeldatei (z. B. .planning/quellen/rohbau-bim-referenz/erzeugt/bap-referenz-rohbau.json, per Datei-Picker geladen):
//        { name, quelle, modelle: {A, B}, standardToleranzMm?,
//          regeln: [{ id, name, art, a: {quelle, klassen}, b: {quelle, klassen},
//                     toleranzMm?, hinweis? }] }
// Out: ladeRegelsatz(json) -> { regelsatz, regeln (clashPairsIter-Form),
//      koordination } — Validierungsfehler als deutsche Klartext-Exceptions
//      MIT Regel-ID (T-71-06: Regeldatei aus fremder Quelle; Inhalte werden
//      nur gelesen, nie ausgeführt).
//
// REIN, keine Imports (Boundary: Pakete nur @core + sich selbst).
//
// Semantik der Prüfarten (Plan 71-02 <interfaces>):
//   schnitt      = 'hard' von clash.js, Toleranz je Regel
//   enthalten    = AABB(a) ⊆ AABB(b) + Toleranz („a nicht größer als b")
//   gefuellt     = AABB(b) ⊆ AABB(a) + Toleranz („b ist von a gefüllt")
//   deckung      = AABBs gleich bis Toleranz (Öffnungspositionen)
//   koordination = Koordinationskörper-Vergleich — gehört NICHT in den
//                  Clash-Lauf; ladeRegelsatz gibt sie separat zurück
//                  (koordinationskoerper.js wertet sie aus).

/** Die Prüfarten, die clashPairsIter versteht (Stand 71-02). */
export const PRUEFARTEN = new Set(["schnitt", "enthalten", "gefuellt", "deckung"]);

/** Klassenname-Grammatik: Ifc* bzw. IFC* — alles andere ist Tippfehler/Lärm. */
const KLASSEN_RX = /^Ifc[A-Za-z]+$/i;

// 66-07 (register no. 80): where a rule comes from. The data already exists —
// file field `quelle` names the client document, each rule's `hinweis` starts
// with the page ("BAP S. 23: …", "BAP S. 23 Balken: …", "BAP S. 23-24 Decken: …").
// We only parse and pass it on; nothing is invented when the prefix is missing.
const STELLE_RX = /^((?:BAP\s+)?S\.\s*\d+(?:\s*[-–]\s*\d+)?)(?:\s+([^:]{1,40}))?:\s*([\s\S]*)$/;

/**
 * Origin of a rule for findings, reports and BCF (66-07).
 * An optional rule field `grundlage: {dokument?, fassung?, stelle?}` (written by a
 * future BAP/LOI converter) wins field by field over the derivation from `hinweis`.
 * @param {{hinweis?: string|null, grundlage?: object}} regel raw rule from the file
 * @param {{quelle?: string, name?: string}} regelsatz whole rule file
 * @returns {{dokument: string|null, fassung: string|null, stelle: string|null,
 *   abschnitt: string|null, text: string|null}}
 */
export function grundlageAus(regel, regelsatz) {
  const hinweis = regel && regel.hinweis ? String(regel.hinweis).trim() : "";
  const m = hinweis ? STELLE_RX.exec(hinweis) : null;
  const abgeleitet = {
    dokument: regelsatz && (regelsatz.quelle || regelsatz.name) ? String(regelsatz.quelle || regelsatz.name) : null,
    fassung: null,
    stelle: m ? m[1].replace(/\s+/g, " ") : null,
    abschnitt: m && m[2] ? m[2].trim() : null,
    text: m ? (m[3].trim() || null) : (hinweis || null),
  };
  const o = regel && regel.grundlage && typeof regel.grundlage === "object" ? regel.grundlage : {};
  const feld = (k) => (o[k] != null && String(o[k]).trim() ? String(o[k]).trim() : abgeleitet[k]);
  return { dokument: feld("dokument"), fassung: feld("fassung"), stelle: feld("stelle"),
    abschnitt: feld("abschnitt"), text: feld("text") };
}

/**
 * One-line origin for tables, PDF and BCF: "Dokument (Fassung), Stelle Abschnitt — Text".
 * @param {ReturnType<typeof grundlageAus>|null|undefined} g
 * @param {{mitText?: boolean}} [opt] mitText=false omits the quoted requirement
 * @returns {string} empty string when nothing is known
 */
export function grundlageText(g, opt = {}) {
  if (!g) return "";
  const mitText = opt.mitText !== false;
  const dok = g.dokument ? (g.fassung ? `${g.dokument} (${g.fassung})` : g.dokument) : "";
  const ort = [g.stelle, g.abschnitt].filter(Boolean).join(" ");
  const kopf = [dok, ort].filter(Boolean).join(", ");
  if (!mitText || !g.text) return kopf;
  return kopf ? `${kopf} — ${g.text}` : g.text;
}

/** mm → m, damit die clash.js-Welt (Meter) stimmt. */
function mmZuM(mm) {
  return mm / 1000;
}

/**
 * Validiert eine Regeldatei und übersetzt sie.
 *
 * @param {object} json geparste Regeldatei
 * @returns {{regelsatz: object,
 *   regeln: Array<{name, art, a: string[], b: string[], aQuelle: string|null,
 *                  bQuelle: string|null, toleranz: number, id: string, hinweis: string|null}>,
 *   koordination: object|null, warnungen: string[]}}
 * @throws {Error} deutsche Klartext-Meldung MIT Regel-ID bei jedem Validierungsfehler
 */
export function ladeRegelsatz(json) {
  if (!json || typeof json !== "object" || !Array.isArray(json.regeln)) {
    throw new Error("Regeldatei ungültig: Feld 'regeln' (Array) fehlt");
  }
  const standardToleranzMm = Number.isFinite(json.standardToleranzMm) ? json.standardToleranzMm : 1;
  if (standardToleranzMm < 0) throw new Error("Regeldatei ungültig: standardToleranzMm ist negativ");

  /** @type {Array} */
  const regeln = [];
  /** @type {string[]} */
  const warnungen = [];
  let koordination = null;
  const ids = new Set();

  for (const r of json.regeln) {
    const id = r && r.id ? String(r.id) : "(ohne ID)";
    if (!r || typeof r !== "object") throw new Error(`Regel ${id}: kein Objekt`);
    if (!r.name || typeof r.name !== "string") throw new Error(`Regel ${id}: Feld 'name' fehlt`);
    if (ids.has(id)) throw new Error(`Regel ${id}: ID doppelt`);
    ids.add(id);

    const art = String(r.art || "schnitt");
    if (art !== "koordination" && !PRUEFARTEN.has(art)) {
      throw new Error(
        `Regel ${id}: Prüfart '${art}' unbekannt (erlaubt: ${[...PRUEFARTEN].join(", ")}, koordination)`);
    }

    // Seitendefinitionen a/b: quelle + klassen (für 'koordination' ohne Klassen
    // nutzbar — der Koordinationskörper wird über den Namen gesucht).
    const seite = (s, seiteName) => {
      if (!s || typeof s !== "object") {
        if (art === "koordination") return { quelle: null, klassen: [] };
        throw new Error(`Regel ${id}: Seite '${seiteName}' fehlt`);
      }
      const quelle = s.quelle != null ? String(s.quelle) : null;
      const klassen = Array.isArray(s.klassen) ? s.klassen.map((k) => String(k).toUpperCase()) : [];
      for (const k of s.klassen || []) {
        if (!KLASSEN_RX.test(String(k))) {
          throw new Error(`Regel ${id}: Klasse '${k}' sieht nicht nach einer IFC-Klasse aus`);
        }
      }
      if (art !== "koordination" && !klassen.length) {
        throw new Error(`Regel ${id}: Seite '${seiteName}' hat keine Klassen`);
      }
      return { quelle, klassen };
    };
    const a = seite(r.a, "a");
    const b = seite(r.b, "b");

    const toleranzMm = Number.isFinite(r.toleranzMm) ? r.toleranzMm : standardToleranzMm;
    if (toleranzMm < 0) throw new Error(`Regel ${id}: toleranzMm ist negativ (${toleranzMm})`);

    const basis = { id, name: String(r.name), hinweis: r.hinweis ? String(r.hinweis) : null,
      grundlage: grundlageAus(r, json) };
    if (art === "koordination") {
      if (koordination) warnungen.push(`Regel ${id}: zweite Koordinationsregel ignoriert (erste gewinnt)`);
      else koordination = { ...basis, toleranzMm, aQuelle: a.quelle, bQuelle: b.quelle };
      continue;
    }
    regeln.push({
      ...basis,
      art,
      a: a.klassen,
      b: b.klassen,
      aQuelle: a.quelle,
      bQuelle: b.quelle,
      // clash.js rechnet in METERN — die Datei trägt Millimeter (BAP-Einheit).
      toleranz: mmZuM(toleranzMm),
      toleranzMm,
    });
  }

  return { regelsatz: json, regeln, koordination, warnungen };
}

/**
 * Übersetzt die validierten Regeln in die Optionen von clashPairsIter:
 * { rules: [...] } — jedes Regelobjekt trägt art/toleranz/aQuelle/bQuelle,
 * clash.js filtert und rechnet damit direkt (71-02 key_link).
 * @param {Array} regeln Ausgabe von ladeRegelsatz (Feld 'regeln')
 * @param {{tolerance?: number, clearance?: number, duplikate?: boolean, maxPairs?: number}} [optionen]
 * @returns {object} Optionen für clashPairsIter/clashPairs
 */
export function regelnZuOptionen(regeln, optionen = {}) {
  return {
    ...optionen,
    // Nur clash-verstehbare Arten durchreichen; 'koordination' ist schon in
    // ladeRegelsatz aussortiert (koordinationskoerper.js wertet sie aus).
    rules: (Array.isArray(regeln) ? regeln : []).filter((r) => PRUEFARTEN.has(r.art)),
  };
}

/**
 * Menschenlesbare Zeile je Regel für UI/PDF (Prüfart + Toleranz + Quelle).
 * T-71-05: die Näherung steht IMMER im Text, nicht nur im Kleingedruckten.
 * @param {{art: string, toleranzMm: number, name: string}} regel
 * @returns {string}
 */
export function regelBeschreibung(regel) {
  const naeherung = regel.art === "enthalten" || regel.art === "gefuellt" || regel.art === "deckung"
    ? " (AABB-Näherung)" : "";
  return `${regel.name}: ${regel.art}${naeherung}, ± ${regel.toleranzMm} mm`;
}

/**
 * Deutsche Labels der Befund-Arten (UI + PDF) — die Näherungsarten sind
 * beschriftet (T-71-05).
 */
export const ART_LABELS = {
  hard: "Kollision",
  clearance: "Abstand",
  duplicate: "Duplikat",
  enthalten: "nicht größer als (Näherung)",
  gefuellt: "gefüllt (Näherung)",
  deckung: "deckungsgleich (Näherung)",
  ohne_partner: "ohne Gegenstück",
};
