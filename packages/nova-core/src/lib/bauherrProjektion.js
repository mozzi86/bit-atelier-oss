// bauherrProjektion.js — what the client ("Bauherr") of a project may see, as
// pure data (Phase 110-01/-02).
//
// The database is the boundary (supabase/migrations/0016_bauherr.sql): a client
// reads only PROJECTIONS the office released for their project, and the
// database strips every key that is not on its whitelist. This module is the
// client half of the same contract:
//   - BAUHERR_FELDER / BAUHERR_QUELLEN: whitelist and source entities, key for
//     key identical with public.bauherr_felder() / bauherr_quellen()
//     (tests/unit/bauherr-11001.test.js parses the SQL);
//   - bereinigen(): the same stripping as public.bauherr_bereinigen(), so the
//     office preview shows exactly what the database will keep;
//   - freigebbar() / projektionAus(): which office rows may go out at all, and
//     the mapping from their fields to a projection — the ONE place where field
//     names of the office entities are read (names per 110-RESEARCH § Quellen);
//   - rueckmeldungPruefen(): the checks of the trigger records_bauherr, so the
//     portal refuses early and in plain words.
//
// Never on a whitelist (VERBOTEN): fees, hours, cost rates, unit prices, internal
// notes, [ASSUMED] markers, origin texts. The unit test checks every key.
//
// In:  office rows (Project, Plan, Document, …) and projection rows. Out:
//      projection objects, verdicts, grouped portal data. Pure, no imports.

/**
 * Whitelist per projection kind; a nested list is '<Kind>.<key>'.
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
export const BAUHERR_FELDER = Object.freeze({
  BauherrProjekt: Object.freeze(['project_id', 'name', 'adresse', 'status', 'phase', 'baubeginn', 'fertigstellung', 'hinweis']),
  BauherrTermin: Object.freeze(['project_id', 'titel', 'beginn', 'ende', 'status', 'art']),
  BauherrPlan: Object.freeze(['project_id', 'titel', 'plannummer', 'index', 'massstab', 'status', 'stand', 'datei', 'entscheidung_offen']),
  BauherrModell: Object.freeze(['project_id', 'titel', 'stand', 'datei']),
  BauherrKosten: Object.freeze(['project_id', 'titel', 'stufe', 'stand', 'summe_netto', 'summe_brutto', 'gruppen', 'hinweis']),
  'BauherrKosten.gruppen': Object.freeze(['kg', 'bezeichnung', 'betrag_netto', 'betrag_brutto']),
  BauherrDokument: Object.freeze(['project_id', 'titel', 'kategorie', 'datum', 'datei', 'entscheidung_offen']),
  BauherrBemusterung: Object.freeze(['project_id', 'titel', 'raum', 'gewerk', 'frist', 'status', 'optionen', 'entscheidung_offen']),
  'BauherrBemusterung.optionen': Object.freeze(['schluessel', 'titel', 'beschreibung', 'mehrkosten_brutto']),
  BauherrFoto: Object.freeze(['project_id', 'titel', 'datum', 'datei', 'bemerkung']),
  BauherrRechnung: Object.freeze(['project_id', 'nummer', 'titel', 'datum', 'betrag_netto', 'betrag_brutto', 'faellig_am', 'status', 'datei']),
  BauherrBeteiligter: Object.freeze(['project_id', 'titel', 'personen']),
  'BauherrBeteiligter.personen': Object.freeze(['name', 'rolle', 'firma', 'email', 'telefon']),
  BauherrAntwort: Object.freeze(['project_id', 'bezug_id', 'frage', 'antwort']),
  BauherrRueckmeldung: Object.freeze(['project_id', 'bezug_id', 'bezug_entity', 'art', 'option', 'text', 'zeitpunkt']),
  BauherrUpload: Object.freeze(['project_id', 'titel', 'datei', 'groesse_bytes', 'mime', 'text', 'zeitpunkt']),
});

/**
 * Source entities per projection kind — identical with public.bauherr_quellen().
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
export const BAUHERR_QUELLEN = Object.freeze({
  BauherrProjekt: Object.freeze(['Project']),
  BauherrTermin: Object.freeze(['ScheduleTask', 'Termin']),
  BauherrPlan: Object.freeze(['Plan']),
  BauherrModell: Object.freeze(['BimModel', 'BIMModel']),
  BauherrKosten: Object.freeze(['Project', 'KostenStand']),
  BauherrDokument: Object.freeze(['Document']),
  BauherrBemusterung: Object.freeze(['Bemusterung', 'Sonderwunsch']),
  BauherrFoto: Object.freeze(['Document']),
  BauherrRechnung: Object.freeze(['Ausgangsrechnung']),
  BauherrBeteiligter: Object.freeze(['Project']),
});

/** Projection kinds the office releases (in portal order). @type {ReadonlyArray<string>} */
export const BAUHERR_ARTEN = Object.freeze(Object.keys(BAUHERR_QUELLEN));

/** Kinds the client writes. @type {ReadonlyArray<string>} */
export const BAUHERR_EIGENE = Object.freeze(['BauherrRueckmeldung', 'BauherrUpload']);

/** Every entity the portal reads — and nothing else. @type {ReadonlyArray<string>} */
export const BAUHERR_LESEN = Object.freeze([...BAUHERR_ARTEN, 'BauherrAntwort', ...BAUHERR_EIGENE]);

/** German labels (i18n keys) of the portal sections. */
export const BAUHERR_LABELS = Object.freeze({
  BauherrProjekt: 'Ihr Projekt',
  BauherrTermin: 'Termine',
  BauherrPlan: 'Pläne',
  BauherrModell: 'Gebäudemodell',
  BauherrKosten: 'Kosten',
  BauherrDokument: 'Dokumente',
  BauherrBemusterung: 'Bemusterung',
  BauherrFoto: 'Baustellenfotos',
  BauherrRechnung: 'Rechnungen',
  BauherrBeteiligter: 'Projektbeteiligte',
});

/** Kinds of a client feedback row (trigger records_bauherr). @type {ReadonlyArray<string>} */
export const RUECKMELDUNG_ARTEN = Object.freeze(['freigabe', 'ablehnung', 'auswahl', 'frage', 'kommentar']);

/** Feedback kinds that are a DECISION on a projection that asks for one. */
const ENTSCHEIDUNGEN = Object.freeze(['freigabe', 'ablehnung', 'auswahl']);

/**
 * Words a whitelist key must never contain (fees, hours, internal notes,
 * assumptions, unit prices, origin texts). Checked by the unit test against
 * every key of BAUHERR_FELDER.
 * @type {ReadonlyArray<RegExp>}
 */
export const VERBOTEN = Object.freeze([
  /honorar/i, /stunde/i, /kostensatz/i, /zeit_?erfassung/i, /controlling/i,
  /notiz/i, /notes/i, /intern/i, /assumed/i, /annahme/i, /herkunft/i, /quelle/i, /pruefung/i,
  /unit_?price/i, /einheitspreis/i, /^ep$/i, /kalkulation/i, /marge/i, /zuschlag/i, /long_?text/i, /langtext/i,
  /budget/i, /obergrenze/i, /mahnung/i, /zahlung/i, /iban/i,
]);

/** Maximum text length of a client feedback (trigger records_bauherr), in characters. */
export const TEXT_MAX = 4000;

/** Maximum size of a projection payload (bauherr_freigeben), in characters of JSON. */
export const INHALT_MAX = 65536;

/**
 * VAT rate for gross amounts of cost figures shown to a private client.
 * [ASSUMED] 19 % (§ 12 Abs. 1 UStG, standard rate) — the office's cost figures
 * (KostenStand.betrag, kostenJeKg) are net; a private client compares gross.
 * Decision D-BH-07 (110-RESEARCH): rate per project or always net.
 */
export const UST_SATZ = 0.19;

/** @param {unknown} v @returns {boolean} JSON scalar (string, finite number, boolean, null) */
const istSkalar = (v) => v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));

/**
 * Same stripping as public.bauherr_bereinigen(): only whitelisted keys; on the
 * top level only scalars, except a named list key, which keeps only objects,
 * each stripped to its own whitelist with scalar values.
 * @param {string} art projection kind
 * @param {unknown} inhalt
 * @returns {Record<string, unknown>}
 */
export function bereinigen(art, inhalt) {
  /** @type {Record<string, unknown>} */
  const aus = {};
  if (!inhalt || typeof inhalt !== 'object' || Array.isArray(inhalt)) return aus;
  const quelle = /** @type {Record<string, unknown>} */ (inhalt);
  for (const k of BAUHERR_FELDER[art] || []) {
    if (!Object.prototype.hasOwnProperty.call(quelle, k)) continue;
    const unter = BAUHERR_FELDER[`${art}.${k}`];
    const v = quelle[k];
    if (unter) {
      aus[k] = Array.isArray(v)
        ? v.filter((el) => el && typeof el === 'object' && !Array.isArray(el)).map((el) => {
          /** @type {Record<string, unknown>} */
          const o = {};
          for (const u of unter) if (Object.prototype.hasOwnProperty.call(el, u) && istSkalar(el[u])) o[u] = el[u];
          return o;
        })
        : [];
    } else if (istSkalar(v)) {
      aus[k] = v;
    }
  }
  return aus;
}

/**
 * A file name for the release folder: no folders, no leading dot, at most 200
 * characters, no IFC original (the same rules as bauherr_freigeben / freigabePfad).
 * @param {string} name e.g. 'A-101 Grundriss EG.pdf'
 * @returns {string|null} cleaned name, or null when nothing usable is left
 */
export function bauherrDateiname(name) {
  const roh = String(name || '').split(/[\\/]/).pop() || '';
  const sauber = roh.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+/, '');
  if (!sauber || /\.ifc(zip)?$/i.test(sauber)) return null;
  return sauber.slice(-200);
}

// --- Which rows may go out ---------------------------------------------------------

/**
 * Whether an office row may be released as this kind at all. The database
 * repeats the two hard rules (Document.bereich, issued invoices); the rest is
 * office practice the portal should not surprise anyone with.
 * @param {string} art projection kind
 * @param {string} entity entity name of the source row
 * @param {Record<string, any>} q the source row
 * @param {{ entscheidung?: boolean }} [opt] entscheidung: released to ask for a decision
 * @returns {{ ok: boolean, grund?: string }} grund: plain-text reason when ok is false
 */
export function freigebbar(art, entity, q, opt = {}) {
  if (!BAUHERR_QUELLEN[art]?.includes(entity)) return { ok: false, grund: `${entity} kann nicht als ${art} freigegeben werden.` };
  if (!q || typeof q !== 'object') return { ok: false, grund: 'Kein Datensatz.' };
  if (entity === 'Document' && (q.bereich || 'projekt') !== 'projekt') {
    return { ok: false, grund: 'Büro-, Personal-, Buchhaltungs- und Schriftverkehrsdokumente gehen nie an den Bauherrn.' };
  }
  if (entity === 'Ausgangsrechnung' && q.status !== 'gestellt') return { ok: false, grund: 'Nur gestellte Rechnungen gehen an den Bauherrn.' };
  // A plan goes out when it is released internally — or as a draft on purpose,
  // to ask the client for approval (D-BH-05).
  if (entity === 'Plan' && q.status !== 'freigegeben' && opt.entscheidung !== true) {
    return { ok: false, grund: 'Nur freigegebene Pläne — oder ein Vorabzug ausdrücklich zur Freigabe durch den Bauherrn.' };
  }
  return { ok: true };
}

// --- Mapping office rows → projections ------------------------------------------
// Each branch reads only the fields named here (110-RESEARCH § Quellen, with
// file:line evidence). A field missing in the source stays missing.

/** @param {unknown} v @returns {string|undefined} trimmed text or undefined */
const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
/** @param {unknown} v @returns {number|undefined} finite number (numbers and numeric strings) */
const zahl = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined));
/** @param {number|undefined} v @returns {number|undefined} rounded to cents */
const cent = (v) => (v === undefined ? undefined : Math.round(v * 100) / 100);
/** @param {Record<string, unknown>} o @returns {Record<string, unknown>} without undefined values */
const ohneLeere = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
/** @param {...(string|undefined)} teile @returns {string|undefined} joined non-empty parts */
const verbinden = (...teile) => teile.filter(Boolean).join(' · ') || undefined;

/** Project.status (ProjectForm.jsx) → German label for the client. */
const PROJEKT_STATUS = Object.freeze({
  concept: 'Konzept', design_development: 'Entwurf', technical_design: 'Ausführungsplanung',
  construction: 'Bauausführung', completed: 'Fertiggestellt',
});

/** KostenStand.stufe (kostenstaende.js) → label. */
const KOSTEN_STUFEN = Object.freeze({
  kostenschaetzung: 'Kostenschätzung', kostenberechnung: 'Kostenberechnung', kostenvoranschlag: 'Kostenvoranschlag',
  kostenanschlag: 'Kostenanschlag', kostenfeststellung: 'Kostenfeststellung',
});

/** Ausgangsrechnung.art (accounting/datenmodell.js RECHNUNGS_ARTEN) → label. */
const RECHNUNG_ARTEN = Object.freeze({
  abschlag: 'Abschlagsrechnung', teilschluss: 'Teilschlussrechnung', schluss: 'Schlussrechnung', sonstige: 'Rechnung', storno: 'Stornorechnung',
});

/**
 * Cost groups condensed to a DIN 276 level: level 1 = hundreds (300, 400 …),
 * level 2 = tens (310, 320 …). Input rows are net amounts.
 * @param {ReadonlyArray<{kg?: string|number, bezeichnung?: string, betrag_netto?: number}>} zeilen
 * @param {1|2} [ebene] DIN 276 level, default 1 (D-BH-06)
 * @param {Record<string, string>} [namen] label per condensed KG (e.g. {'300': 'Bauwerk – Baukonstruktionen'})
 * @returns {Array<{kg: string, bezeichnung?: string, betrag_netto: number}>} sorted by KG
 */
export function kgVerdichten(zeilen, ebene = 1, namen = {}) {
  /** @type {Map<string, number>} */
  const summe = new Map();
  for (const z of zeilen || []) {
    const kg = String(z?.kg ?? '').replace(/\D/g, '');
    const b = zahl(z?.betrag_netto);
    if (kg.length < 3 || b === undefined) continue;
    const ziel = ebene === 2 ? `${kg.slice(0, 2)}0` : `${kg.slice(0, 1)}00`;
    summe.set(ziel, (summe.get(ziel) || 0) + b);
  }
  return [...summe.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'de', { numeric: true }))
    .map(([kg, b]) => /** @type {any} */ (ohneLeere({ kg, bezeichnung: text(namen[kg]), betrag_netto: cent(b) })));
}

/** DIN 276:2018-12 cost groups, level 1 — labels a private client understands. */
const KG_NAMEN = Object.freeze({
  '100': 'Grundstück', '200': 'Vorbereitende Maßnahmen', '300': 'Bauwerk – Baukonstruktionen',
  '400': 'Bauwerk – Technische Anlagen', '500': 'Außenanlagen und Freiflächen', '600': 'Ausstattung und Kunstwerke',
  '700': 'Baunebenkosten', '800': 'Finanzierung',
});

/**
 * VAT rate of one LV position as a fraction. LVPosition.ust_satz is optional and
 * comes as number or string, as fraction (0.19) or percent (19); missing → the
 * standard rate. 0 marks tax-free positions (public charges, PV under § 12 Abs. 3 UStG).
 * @param {unknown} v ust_satz of the position
 * @param {number} standard standard rate as fraction
 * @returns {number} fraction, e.g. 0.19
 */
function ustSatz(v, standard) {
  const s = zahl(v);
  if (s === undefined || s < 0) return standard;
  return s > 1 ? s / 100 : s;
}

/**
 * Cost per DIN 276 hundred-group from LV positions, net and gross. Gross is
 * summed per position with the position's own VAT rate, so tax-free positions
 * stay tax-free in the client's figure (finding 08.11.2026: a flat 19 % on the
 * total overstated the gross by the VAT on the tax-free positions).
 * Positions without a three-digit KG or without amount are skipped.
 * @param {ReadonlyArray<Record<string, any>>} positionen LVPosition rows (din276, quantity, unit_price, ust_satz)
 * @param {number} [standard] standard VAT rate as fraction, default UST_SATZ
 * @returns {Array<{kg: string, bezeichnung: string, betrag_netto: number, betrag_brutto: number}>} amounts in euro, sorted by KG
 */
export function kostenAusLv(positionen, standard = UST_SATZ) {
  /** @type {Map<string, {n: number, b: number}>} */
  const summe = new Map();
  for (const p of positionen || []) {
    const kg = String(p?.din276 ?? '').replace(/\D/g, '');
    const menge = zahl(p?.quantity);
    const ep = zahl(p?.unit_price);
    if (kg.length < 3 || menge === undefined || ep === undefined) continue;
    const ziel = `${kg.slice(0, 1)}00`;
    const s = summe.get(ziel) || { n: 0, b: 0 };
    s.n += menge * ep;
    s.b += menge * ep * (1 + ustSatz(p?.ust_satz, standard));
    summe.set(ziel, s);
  }
  return [...summe.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'de', { numeric: true }))
    .map(([kg, s]) => ({
      kg, bezeichnung: KG_NAMEN[/** @type {keyof typeof KG_NAMEN} */ (kg)] || `KG ${kg}`,
      betrag_netto: /** @type {number} */ (cent(s.n)), betrag_brutto: /** @type {number} */ (cent(s.b)),
    }));
}

/**
 * Builds the projection of one office row. Unknown kind or entity → null.
 * @param {string} art projection kind (BAUHERR_ARTEN)
 * @param {string} entity entity name of the source row
 * @param {Record<string, any>} q the source row
 * @param {{ entscheidung?: boolean, hinweis?: string, gruppen?: ReadonlyArray<any>,
 *   kontakte?: ReadonlyArray<Record<string, any>>, rollenLabel?: (id: string) => string, ust?: number }} [opt]
 *   entscheidung: the office asks the client for a decision; hinweis: one
 *   sentence the office writes for the client; gruppen: KG rows for
 *   BauherrKosten (kostenAusLv: net and gross in euro; a row without gross gets
 *   the flat rate); kontakte: Contact rows to resolve Project.beteiligte;
 *   rollenLabel: participant role id → label; ust: VAT rate (default UST_SATZ)
 * @returns {Record<string, unknown>|null} the projection, already stripped by bereinigen()
 */
export function projektionAus(art, entity, q, opt = {}) {
  if (!q || typeof q !== 'object' || !BAUHERR_QUELLEN[art]?.includes(entity)) return null;
  const project_id = entity === 'Project' ? q.id : q.project_id;
  const entscheidung_offen = opt.entscheidung === true ? true : undefined;
  const ust = typeof opt.ust === 'number' ? opt.ust : UST_SATZ;
  const brutto = (/** @type {number|undefined} */ n) => (n === undefined ? undefined : cent(n * (1 + ust)));
  /** @type {Record<string, unknown>} */
  let p;
  switch (art) {
    case 'BauherrProjekt': {
      const ort = q.location && typeof q.location === 'object'
        ? [text(q.location.address), text(q.location.city)].filter(Boolean).join(', ') || undefined
        : text(q.location);
      p = {
        name: text(q.name), adresse: ort,
        status: PROJEKT_STATUS[/** @type {keyof typeof PROJEKT_STATUS} */ (q.status)] || text(q.status),
        phase: zahl(q.hoai_phase) !== undefined ? `Leistungsphase ${zahl(q.hoai_phase)}` : undefined,
        baubeginn: text(q.start_date), fertigstellung: text(q.completion_date), hinweis: text(opt.hinweis),
      };
      break;
    }
    case 'BauherrTermin':
      p = entity === 'ScheduleTask'
        ? { titel: text(q.name) || text(q.title), beginn: text(q.start_date), ende: text(q.end_date), status: text(q.status), art: 'Bauablauf' }
        : { titel: text(q.titel), beginn: text(q.datum), art: q.art === 'frist' ? 'Frist' : 'Termin' };
      break;
    case 'BauherrPlan':
      p = {
        titel: text(q.titel), plannummer: text(q.nr), index: text(q.index), massstab: text(q.massstab),
        status: q.status === 'freigegeben' ? 'freigegeben' : 'zur Freigabe',
        stand: text(q.freigabe?.am) || text(q.created_date), entscheidung_offen,
      };
      break;
    case 'BauherrModell':
      p = { titel: text(q.name) || 'Gebäudemodell', stand: text(q.updated_date) || text(q.created_date) };
      break;
    case 'BauherrKosten': {
      // 08.11.2026 (finding on the live project): the total is ALWAYS the sum of the rows
      // shown — a client reads a mismatch as a calculation error. Gross comes per row
      // from the rows (kostenAusLv: per position with its own VAT rate), not as a flat
      // 19 % on the total.
      /** @type {Array<Record<string, any>>} */
      const zeilen = (opt.gruppen || []).map((g) => {
        const kg = text(String(g?.kg ?? ''));
        const n = cent(zahl(g?.betrag_netto));
        const b = zahl(g?.betrag_brutto) !== undefined ? cent(zahl(g?.betrag_brutto)) : brutto(n);
        return ohneLeere({ kg, bezeichnung: text(g?.bezeichnung) || (kg ? KG_NAMEN[/** @type {keyof typeof KG_NAMEN} */ (kg)] : undefined), betrag_netto: n, betrag_brutto: b });
      });
      /** @param {'betrag_netto'|'betrag_brutto'} k @returns {number} */
      const summe = (k) => zeilen.reduce((s, z) => s + (Number(z[k]) || 0), 0);
      /** @type {string[]} */
      const hinweise = [];
      if (entity === 'KostenStand') {
        const betrag = zahl(q.betrag);
        if (betrag !== undefined && zeilen.length === 0) {
          zeilen.push({ bezeichnung: 'Kostenstand gesamt (ohne Aufteilung nach Kostengruppen)', betrag_netto: cent(betrag), betrag_brutto: brutto(betrag) });
        } else if (betrag !== undefined) {
          // The office's cost status includes a reserve the LV positions do not carry
          // (e.g. 10 % on KG 300+400). Shown as its own row so rows and total agree.
          // [ASSUMED] the reserve is taxable at the standard rate (it covers KG 300/400 work).
          const rest = betrag - summe('betrag_netto');
          if (rest > 0.5) zeilen.push({ bezeichnung: 'Reserve / Unvorhergesehenes', betrag_netto: cent(rest), betrag_brutto: brutto(rest) });
          else if (rest < -0.5) hinweise.push('Die Summe der Positionen liegt über dem angegebenen Kostenstand.');
        }
      }
      // KG 700 (fees, expert reports, permit fees) is not in the LV. Rows only from
      // structured values on the cost status, never parsed from the internal note:
      //  - kg700_zeilen: [{kg, bezeichnung, betrag_netto, betrag_brutto?, ust_satz?}] —
      //    one row per sub-group, so the client sees what each fee is for (decision
      //    08.11.2026: full transparency, the architect's fee as its own row);
      //  - else kg700_netto (+ optional kg700_brutto): one row "Baunebenkosten".
      // Fees like permit charges are VAT-free, hence gross per row (ust_satz 0).
      // A kg700_netto above the sum of kg700_zeilen adds the rest as its own row, so
      // the KG 700 total the office states is never silently dropped.
      const kg700 = zahl(q.kg700_netto);
      const kg700Zeilen = (Array.isArray(q.kg700_zeilen) ? q.kg700_zeilen : [])
        .filter((/** @type {any} */ z) => z && typeof z === 'object' && zahl(z.betrag_netto) !== undefined)
        .map((/** @type {any} */ z) => {
          const n = /** @type {number} */ (zahl(z.betrag_netto));
          const b = zahl(z.betrag_brutto) !== undefined ? zahl(z.betrag_brutto) : cent(n * (1 + ustSatz(z.ust_satz, ust)));
          const kg = text(String(z.kg ?? '')) || '700';
          return ohneLeere({ kg, bezeichnung: text(z.bezeichnung) || KG_NAMEN['700'], betrag_netto: cent(n), betrag_brutto: cent(b) });
        });
      if (kg700Zeilen.length) {
        zeilen.push(...kg700Zeilen);
        const rest = kg700 === undefined ? 0 : kg700 - kg700Zeilen.reduce((sum, z) => sum + (Number(z.betrag_netto) || 0), 0);
        if (rest > 0.5) zeilen.push({ kg: '790', bezeichnung: 'Sonstige Baunebenkosten', betrag_netto: cent(rest), betrag_brutto: brutto(rest) });
      } else if (kg700 !== undefined) {
        const kg700b = zahl(q.kg700_brutto);
        zeilen.push({ kg: '700', bezeichnung: KG_NAMEN['700'], betrag_netto: cent(kg700), betrag_brutto: kg700b !== undefined ? cent(kg700b) : brutto(kg700) });
      } else {
        hinweise.push('Ohne Baunebenkosten (KG 700: Honorare, Gutachten, Gebühren) — die weist das Büro gesondert aus.');
      }
      if (text(opt.hinweis)) hinweise.unshift(/** @type {string} */ (text(opt.hinweis)));
      p = {
        titel: entity === 'KostenStand' ? (KOSTEN_STUFEN[/** @type {keyof typeof KOSTEN_STUFEN} */ (q.stufe)] || 'Kostenstand') : 'Kosten nach Kostengruppen',
        stufe: text(q.stufe), stand: text(q.datum) || text(q.updated_date),
        summe_netto: zeilen.length ? cent(summe('betrag_netto')) : undefined,
        summe_brutto: zeilen.length ? cent(summe('betrag_brutto')) : undefined,
        gruppen: zeilen.length ? zeilen : undefined, hinweis: hinweise.join(' ') || undefined,
      };
      break;
    }
    case 'BauherrDokument':
      p = {
        // Document.type is sometimes a MIME type ("application/pdf") — no category for the client.
        titel: text(q.name), kategorie: /\//.test(String(q.type || '')) ? undefined : text(q.type),
        datum: text(q.uploaded_date) || text(q.created_date), entscheidung_offen,
      };
      break;
    case 'BauherrBemusterung':
      p = entity === 'Bemusterung'
        ? {
          titel: verbinden(text(q.nr), text(q.gegenstand)), raum: text(q.raum_bezug), status: text(q.status),
          optionen: [ohneLeere({
            schluessel: '1', titel: verbinden(text(q.fabrikat), text(q.produkt)),
            beschreibung: verbinden(text(q.farbe_system), text(q.farbe), text(q.oberflaeche)),
          })],
          entscheidung_offen,
        }
        : {
          titel: text(q.beschreibung), raum: text(q.raum), gewerk: text(q.gewerk_lb), status: text(q.status),
          optionen: [ohneLeere({ schluessel: '1', titel: text(q.beschreibung), mehrkosten_brutto: cent(zahl(q.preis_eur)) })],
          entscheidung_offen,
        };
      break;
    case 'BauherrFoto':
      p = { titel: text(q.name), datum: text(q.uploaded_date) || text(q.created_date), bemerkung: text(opt.hinweis) };
      break;
    case 'BauherrRechnung': {
      const bezahlt = (q.zahlungen || []).reduce((/** @type {number} */ s, /** @type {any} */ z) => s + (zahl(z?.betrag) || 0), 0);
      const b = zahl(q.brutto);
      p = {
        nummer: text(q.nummer), titel: RECHNUNG_ARTEN[/** @type {keyof typeof RECHNUNG_ARTEN} */ (q.art)] || 'Rechnung',
        datum: text(q.rechnungsdatum), betrag_netto: cent(zahl(q.netto)), betrag_brutto: cent(b),
        faellig_am: text(q.faellig_am), status: b !== undefined && bezahlt >= b - 0.005 ? 'bezahlt' : 'offen',
      };
      break;
    }
    case 'BauherrBeteiligter': {
      const nachId = new Map((opt.kontakte || []).map((k) => [k?.id, k]));
      const personen = (Array.isArray(q.beteiligte) ? q.beteiligte : []).map((/** @type {any} */ b) => {
        const k = nachId.get(b?.contact_id);
        if (!k) return null;
        return ohneLeere({
          name: text(k.name), rolle: opt.rollenLabel ? opt.rollenLabel(b.rolle) : text(b.rolle),
          firma: text(k.company), email: text(k.email), telefon: text(k.phone),
        });
      }).filter(Boolean);
      p = { titel: 'Projektbeteiligte', personen };
      break;
    }
    default:
      return null;
  }
  return bereinigen(art, ohneLeere({ project_id, ...p }));
}

// --- Local release (express/serverlos, "Ansicht als Bauherr") ---------------------
// The same row the RPC bauherr_freigeben writes, built in JS for the local data
// paths: whitelist via bereinigen(), project from the source, datei only when
// given, quelle_id + freigegeben as the RPC adds them. Visibility is the RLS rule
// of 0016 for projections, as a pure function: released AND on the project.

/**
 * Data of a projection row as bauherr_freigeben writes it.
 * @param {string} art projection kind
 * @param {string} quelleId records.id of the source
 * @param {string} projektId project the source belongs to
 * @param {Record<string, unknown>} inhalt projection (projektionAus)
 * @param {string|null} [datei] file name or null
 * @returns {Record<string, unknown>}
 */
export function freigabeZeile(art, quelleId, projektId, inhalt, datei = null) {
  /** @type {Record<string, unknown>} */
  const d = { ...bereinigen(art, inhalt), project_id: projektId };
  if (datei) d.datei = datei;
  else delete d.datei;
  return { ...d, quelle_id: quelleId, freigegeben: true };
}

/**
 * What the client of a project sees of the projection rows — the rule of
 * records_select for the audience bauherr (0016): released (`freigegeben`,
 * the data mirror of sicht) and on that project; own rows of the client
 * (feedback, uploads) only on that project. Used by the local preview, so it
 * cannot show more than the cloud would.
 * @param {Record<string, ReadonlyArray<Record<string, any>>>} zeilen entity → rows
 * @param {string|null} projektId the client's project
 * @returns {Record<string, Record<string, any>[]>}
 */
export function fuerBauherrSichtbar(zeilen, projektId) {
  /** @type {Record<string, Record<string, any>[]>} */
  const aus = {};
  if (!projektId) return aus;
  for (const e of BAUHERR_LESEN) {
    const eigen = BAUHERR_EIGENE.includes(e);
    aus[e] = (zeilen?.[e] || []).filter((r) => r?.project_id === projektId && (eigen || r.freigegeben === true));
  }
  return aus;
}

// --- Client feedback -------------------------------------------------------------

/**
 * The checks of trigger records_bauherr, in plain words, before the insert.
 * @param {{ art: string, text?: string, option?: string }} eingabe
 * @param {Record<string, any>|null} [bezug] the projection the feedback refers to
 * @returns {{ ok: boolean, grund?: string }} grund: plain-text reason when ok is false
 */
export function rueckmeldungPruefen(eingabe, bezug = null) {
  const art = String(eingabe?.art || '');
  if (!RUECKMELDUNG_ARTEN.includes(art)) return { ok: false, grund: 'Unbekannte Art der Rückmeldung.' };
  const t = String(eingabe?.text || '');
  if (t.length > TEXT_MAX) return { ok: false, grund: `Der Text ist zu lang (höchstens ${TEXT_MAX} Zeichen).` };
  if ((art === 'frage' || art === 'kommentar') && !t.trim()) return { ok: false, grund: 'Bitte einen Text eingeben.' };
  if (ENTSCHEIDUNGEN.includes(art)) {
    if (!bezug || bezug.entscheidung_offen !== true) return { ok: false, grund: 'Zu diesem Eintrag ist keine Entscheidung angefragt.' };
    if (art === 'auswahl' && !(bezug.optionen || []).some((/** @type {any} */ o) => o?.schluessel === eingabe.option)) {
      return { ok: false, grund: 'Bitte eine der angebotenen Optionen wählen.' };
    }
  }
  return { ok: true };
}

/**
 * The latest decision of the client on each projection (freigabe/ablehnung/
 * auswahl), by zeitpunkt.
 * @param {ReadonlyArray<Record<string, any>>} rueckmeldungen BauherrRueckmeldung rows
 * @returns {Map<string, Record<string, any>>} bezug_id → newest decision
 */
export function letzteEntscheidungen(rueckmeldungen) {
  /** @type {Map<string, Record<string, any>>} */
  const m = new Map();
  for (const r of rueckmeldungen || []) {
    if (!r?.bezug_id || !ENTSCHEIDUNGEN.includes(r.art)) continue;
    const alt = m.get(r.bezug_id);
    if (!alt || String(r.zeitpunkt || r.created_date || '') > String(alt.zeitpunkt || alt.created_date || '')) m.set(r.bezug_id, r);
  }
  return m;
}

/**
 * Groups the rows the portal read into its sections, each sorted (plans by
 * number, dates ascending for appointments, newest first otherwise; cost
 * groups by KG). Rows of unknown kinds are dropped.
 * @param {Record<string, ReadonlyArray<Record<string, any>>>} zeilen entity name → rows
 * @returns {{ projekt: Record<string, any>|null, abschnitte: Record<string, Record<string, any>[]>,
 *   antworten: Record<string, any>[], rueckmeldungen: Record<string, any>[], uploads: Record<string, any>[],
 *   entscheidungen: Map<string, Record<string, any>> }}
 */
export function portalAufbereiten(zeilen) {
  /** @type {Record<string, Record<string, any>[]>} */
  const abschnitte = {};
  const datum = (/** @type {any} */ r) => String(r?.datum || r?.beginn || r?.stand || r?.created_date || '');
  for (const art of BAUHERR_ARTEN) {
    if (art === 'BauherrProjekt') continue;
    const liste = (zeilen?.[art] || []).map((r) => ({ ...r }));
    if (art === 'BauherrPlan') liste.sort((a, b) => String(a.plannummer || a.titel || '').localeCompare(String(b.plannummer || b.titel || ''), 'de', { numeric: true }));
    else if (art === 'BauherrTermin') liste.sort((a, b) => datum(a).localeCompare(datum(b)));
    else liste.sort((a, b) => datum(b).localeCompare(datum(a)));
    if (art === 'BauherrKosten') {
      // Rows without KG (reserve, total without breakdown) stay after the KG rows, in their order.
      for (const k of liste) k.gruppen = [...(k.gruppen || [])].sort((a, b) => (!a.kg || !b.kg ? Number(!a.kg) - Number(!b.kg) : String(a.kg).localeCompare(String(b.kg), 'de', { numeric: true })));
    }
    abschnitte[art] = liste;
  }
  const rueckmeldungen = [...(zeilen?.BauherrRueckmeldung || [])]
    .sort((a, b) => String(b.zeitpunkt || b.created_date || '').localeCompare(String(a.zeitpunkt || a.created_date || '')));
  return {
    projekt: (zeilen?.BauherrProjekt || [])[0] || null,
    abschnitte,
    antworten: [...(zeilen?.BauherrAntwort || [])],
    rueckmeldungen,
    uploads: [...(zeilen?.BauherrUpload || [])],
    entscheidungen: letzteEntscheidungen(rueckmeldungen),
  };
}
