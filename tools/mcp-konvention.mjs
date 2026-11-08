// mcp-konvention.mjs — the one convention of the MCP tools (plan 111-01, findings K-04, K-06, K-18).
//
// Every tool of tools/mcp-server.mjs carries a kind (`art`):
//   lesen                    reads; changes nothing that is stored (visible without --schreiben)
//   vorschlag                makes a PROPOSAL only; a person takes it over in the app (an agent never confirms, D-IM-04 / D-IDEE-03)
//   vorschau-dann-ausfuehren the default for writing: first a preview, the write only with `ausfuehren: true`
//   sofort                   writes at once — only for the tools in SOFORT_AUSNAHMEN, each with its reason
// Write tools (schreibt: true) also take the optional `begruendung` {grund, quelle, aussenwirkung}; it goes into
// the call log only, never to the app.
//
// In:  the tool list of the server (name, art, schreibt, inputSchema, annotations).
// Out: konventionPruefen() → list of violations in words (empty = convention kept); the German sentence for the
//      `instructions` of initialize; the shared schema of `begruendung` and its normaliser.
// Imports nothing (the MCP server ships without packages/). No tool here confirms anything.

/** The kinds a tool may have, from "changes nothing" to "writes at once". */
export const ARTEN = Object.freeze(['lesen', 'vorschlag', 'vorschau-dann-ausfuehren', 'sofort']);

/**
 * Tools allowed to write at once, each with the reason. Everything else that writes goes through a proposal or a preview.
 * @type {Readonly<Record<string, string>>}
 */
export const SOFORT_AUSNAHMEN = Object.freeze({
  zeichenflaeche_ausfuehren: 'Das Massing-Studio führt seine Zeichen- und Bearbeitungsbefehle sofort aus (wie die Befehlszeile der Person); '
    + 'im IFC-Viewer und BIM-Studio liefern dieselben Befehle nur Vorschläge.',
});

/**
 * Tools of kind vorschau-dann-ausfuehren that do not have the `ausfuehren` switch yet. 111-01 listed create_record and
 * update_record here; 111-02 gave both the switch and emptied the list. It stays (empty) so a future transition has its place
 * and the instructions stay honest (konventionsSatz names every entry).
 * @type {readonly string[]}
 */
export const UEBERGANG_111_02 = Object.freeze([]);

/** Values of begruendung.aussenwirkung: does the change reach anyone outside the office? */
export const AUSSENWIRKUNGEN = Object.freeze(['keine', 'intern', 'extern']);

/** Longest begruendung.grund in characters (schema limit; longer text is cut in the log). */
export const MAX_GRUND_ZEICHEN = 500;
/** Longest begruendung.quelle in characters. */
export const MAX_QUELLE_ZEICHEN = 200;

/** Input schema of the optional `begruendung` argument; added to every write tool by the server, not by hand. */
export const BEGRUENDUNG_SCHEMA = Object.freeze({
  type: 'object',
  description: 'Optional: warum dieser Aufruf? Geht nur ins lokale Aufrufprotokoll, nie an die App. / Optional reason; written to the local call log only.',
  properties: {
    grund: { type: 'string', maxLength: MAX_GRUND_ZEICHEN, description: 'Warum, in einem Satz' },
    quelle: { type: 'string', maxLength: MAX_QUELLE_ZEICHEN, description: 'Worauf der Aufruf beruht, z. B. „Bitte der Person im Chat“ oder eine Datensatz-id' },
    aussenwirkung: { type: 'string', enum: [...AUSSENWIRKUNGEN], description: 'Erreicht die Änderung jemanden außerhalb des Büros? keine / intern / extern' },
  },
  additionalProperties: false,
});

/**
 * The reason as it goes into the log: only the three known fields, texts cut to their limits, an unknown
 * aussenwirkung dropped (and marked). Never refuses a call — the reason is optional and only for the log.
 * @param {unknown} roh the `begruendung` argument as sent
 * @returns {{grund?: string, quelle?: string, aussenwirkung?: string, ungueltig?: true}|null} null when none was sent
 */
export function begruendungAus(roh) {
  if (roh == null || roh === '') return null;
  if (typeof roh !== 'object' || Array.isArray(roh)) return { grund: String(roh).slice(0, MAX_GRUND_ZEICHEN), ungueltig: true };
  const r = /** @type {Record<string, unknown>} */ (roh);
  /** @type {{grund?: string, quelle?: string, aussenwirkung?: string, ungueltig?: true}} */
  const aus = {};
  if (r.grund != null && r.grund !== '') aus.grund = String(r.grund).slice(0, MAX_GRUND_ZEICHEN);
  if (r.quelle != null && r.quelle !== '') aus.quelle = String(r.quelle).slice(0, MAX_QUELLE_ZEICHEN);
  if (r.aussenwirkung != null && r.aussenwirkung !== '') {
    if (AUSSENWIRKUNGEN.includes(/** @type {any} */ (r.aussenwirkung))) aus.aussenwirkung = String(r.aussenwirkung);
    else aus.ungueltig = true;
  }
  if (Object.keys(r).some((k) => !['grund', 'quelle', 'aussenwirkung'].includes(k))) aus.ungueltig = true;
  return aus;
}

/**
 * @typedef {object} WerkzeugKurz
 * @property {string} name
 * @property {string} [art] one of ARTEN
 * @property {boolean} [schreibt] needs --schreiben
 * @property {{properties?: Record<string, any>}} [inputSchema] the schema as the client sees it
 * @property {Record<string, any>} [annotations]
 */

/**
 * Checks the convention on a tool list and names every violation in words. Rules:
 * every tool has a kind from ARTEN; a write tool is never `lesen` and a tool without write permission is always `lesen`;
 * `sofort` only for SOFORT_AUSNAHMEN (and every exception is still `sofort`); `vorschau-dann-ausfuehren` has the
 * boolean `ausfuehren` unless listed in the transition list (and every listed tool exists with that kind);
 * a `vorschlag` is not destructive; a write tool offers `begruendung` (only checked when `mitBegruendung`).
 * @param {WerkzeugKurz[]} werkzeuge
 * @param {{sofortAusnahmen?: Readonly<Record<string, string>>, uebergang?: readonly string[], mitBegruendung?: boolean}} [opt]
 *   mitBegruendung: the list is the client's view (tools/list), where begruendung must be in the schema
 * @returns {string[]} violations; empty when the convention is kept
 */
export function konventionPruefen(werkzeuge, { sofortAusnahmen = SOFORT_AUSNAHMEN, uebergang = UEBERGANG_111_02, mitBegruendung = false } = {}) {
  const fehler = [];
  const nachName = new Map(werkzeuge.map((w) => [w.name, w]));
  for (const w of werkzeuge) {
    const art = w.art;
    if (!art || !ARTEN.includes(art)) { fehler.push(`${w.name}: art fehlt oder ist unbekannt (${JSON.stringify(art)}) — erlaubt: ${ARTEN.join(', ')}`); continue; }
    if (w.schreibt && art === 'lesen') fehler.push(`${w.name}: schreibt, aber art "lesen"`);
    if (!w.schreibt && art !== 'lesen') fehler.push(`${w.name}: ohne Schreibrecht sichtbar, aber art "${art}" — nur Lesewerkzeuge brauchen kein --schreiben`);
    if (art === 'sofort' && !String(sofortAusnahmen[w.name] || '').trim()) fehler.push(`${w.name}: art "sofort" ohne Eintrag (mit Grund) in SOFORT_AUSNAHMEN`);
    if (art === 'vorschau-dann-ausfuehren' && !uebergang.includes(w.name) && w.inputSchema?.properties?.ausfuehren?.type !== 'boolean') {
      fehler.push(`${w.name}: art "vorschau-dann-ausfuehren" ohne Schalter ausfuehren (boolean) im Schema`);
    }
    if (art === 'vorschlag' && w.annotations?.destructiveHint !== false) fehler.push(`${w.name}: ein Vorschlag ändert nichts — destructiveHint muss false sein`);
    if (mitBegruendung && w.schreibt && !w.inputSchema?.properties?.begruendung) fehler.push(`${w.name}: Schreibwerkzeug ohne begruendung im Schema`);
  }
  for (const name of Object.keys(sofortAusnahmen)) {
    const w = nachName.get(name);
    if (w && w.art !== 'sofort') fehler.push(`${name}: steht in SOFORT_AUSNAHMEN, hat aber art "${w.art}" — Eintrag entfernen`);
  }
  for (const name of uebergang) {
    const w = nachName.get(name);
    if (w && w.art !== 'vorschau-dann-ausfuehren') fehler.push(`${name}: steht in UEBERGANG_111_02, hat aber art "${w.art}"`);
  }
  return fehler;
}

/**
 * The convention in German for the model (one sentence plus, while the transition list is not empty, the honest
 * note which tools still write at once). Used in the `instructions` of initialize.
 * @param {readonly string[]} [uebergang] tools still without preview
 * @returns {string}
 */
export function konventionsSatz(uebergang = UEBERGANG_111_02) {
  const sofort = Object.keys(SOFORT_AUSNAHMEN).join(', ');
  const satz = 'Konvention: Jedes Werkzeug hat eine Art — lesen (ändert nichts), vorschlag (die Person übernimmt ihn in der App), '
    + `vorschau-dann-ausfuehren (Standard ist die Vorschau, geschrieben wird erst mit ausfuehren: true) oder sofort (nur ${sofort}: das Massing-Studio führt Zeichenbefehle sofort aus).`;
  if (!uebergang.length) return satz;
  return `${satz} Noch ohne Vorschau: ${uebergang.join(' und ')} schreiben sofort — vorher mit get_record lesen und der Person sagen, was sich ändert.`;
}
