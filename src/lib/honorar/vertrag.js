// Architect's contract of phase 81-04 (HON-03/04/06): the accepted fee offer
// becomes 79's Honorarvertrag (flat fields 1:1) plus the phase-81 fields
// (number, stages, dates, liability, remuneration snapshot); the contract
// account; and the instalment template with fee-amendment positions for 79's
// invoice form.
//
// Honorarvertrag 81 fields (additive, 81-RESEARCH § Entitäten): nummer
// 'AV-{jahr}-{nr3}', angebot_id, status (VERTRAG_STATUS), vertragsdatum,
// stufen[{nr, lph[], beauftragt_am}], termine[{titel, datum, lph?, art}],
// haftung {versicherer, deckung_personen_eur, deckung_sach_eur,
// haftungsbegrenzung_text}, verguetung_snapshot {summen, tafel_stand},
// bestaetigung_dokument_id.
//
// Instalments follow 79's rule (D-P81-15): stage amount × progress, already
// issued invoices credited stage by stage, incidental costs NOT pro rata (they
// come with the final invoice) — § 15 Abs. 2 HOAI / § 632a BGB. Phase 81 adds one
// position per commissioned fee amendment and hands 79 the invoices WITHOUT
// their amendment share (rechnungenOhneNachtragsanteil): 79's abschlagsVorlage
// sums every issued amount of a contract and credits it to the stages in order —
// a billed amendment would otherwise lower the next stage instalment.
//
// In:  offers, contracts, invoices (79 Ausgangsrechnung), amendments, HoaiPlan,
//      the rule reader. Out: records, Euro amounts (cents inside).

import { honorarVertrag, lpStand } from "@core/lib/hoai/honorar.js";
import { abschlagsVorlage, restBisSchluss } from "@core/lib/hoai/abrechnung.js";
import { leistungsbildInfo } from "@core/lib/hoai/leistungsbilder.js";
import { naechsteNummer } from "@core/lib/nummernkreis.js";
import { bezahltCent } from "@/lib/accounting/grundlagen.js";
import { aufstellung } from "./aufstellung.js";
import { VERTRAGSFELDER } from "./angebot.js";
import { beauftragteNachtraegeCent, nachtragPositionen } from "./honorarNachtrag.js";
import { statusErlaubt, stufeSetztLph, VERTRAG_STATUS } from "./vertragsdaten.js";

/** @param {number} euro @returns {number} */
const cent = (euro) => Math.round((Number(euro) || 0) * 100);

/**
 * The table data a contract was concluded on (D-P81-33: 79's honorarVertrag has
 * no key-date parameter, so the snapshot is the proof).
 * @param {string} leistungsbild
 * @param {{weitere?: ReadonlyArray<any>}} [optionen]
 * @returns {{leistungsbild: string, paragraf: number|null, fassung: string|null, quelle: string|null, abgerufen_am: string|null}}
 */
export function tafelStand(leistungsbild, optionen = {}) {
  const info = leistungsbildInfo(leistungsbild, optionen);
  return {
    leistungsbild,
    paragraf: info?.tafelParagraf ?? null,
    fassung: info?.tafel?.fassung ?? null,
    quelle: info?.quelle ?? null,
    abgerufen_am: info?.abgerufen_am ?? null,
  };
}

/**
 * Accepts a sent offer: the contract carries every flat 79 field of the offer
 * 1:1 (incl. payment term, client fields), number from zeit_honorar.nummer_vertrag,
 * status "beauftragt", one stage with the offered stages commissioned today, the
 * remuneration snapshot (totals + table data). Special services of the offer
 * become commissioned fee amendments (79's Honorarvertrag has no field for them,
 * and 81 bills them as amendment positions). The offer becomes "angenommen".
 * @param {Record<string, any>} angebot a sent offer
 * @param {ReadonlyArray<Record<string, any>>} alleVertraege all contracts (for the number)
 * @param {{heuteIso: string, wert?: (id: string) => any, optionen?: {weitere?: ReadonlyArray<any>}}} kontext
 * @returns {{vertrag: Record<string, any>, angebot: Record<string, any>, nachtraege: Array<Record<string, any>>}}
 *   vertrag without id (the caller stores it, then sets angebot.honorarvertrag_id / nachtrag ids)
 */
export function angebotZuVertrag(angebot, alleVertraege, { heuteIso, wert = () => null, optionen = {} }) {
  /** @type {Record<string, any>} */
  const flach = {};
  for (const f of VERTRAGSFELDER) if (f in angebot) flach[f] = structuredClone(angebot[f]);
  const beauftragt = (Array.isArray(angebot.lph) ? angebot.lph : []).map((l, i) => (l?.beauftragt ? i + 1 : 0)).filter(Boolean);
  const muster = wert("zeit_honorar.nummer_vertrag") || "AV-{jahr}-{nr3}";
  const a = aufstellung({ ...angebot, besondere_leistungen: [] }, optionen);
  const vertrag = {
    project_id: angebot.project_id,
    ...flach,
    nummer: naechsteNummer(muster, (alleVertraege || []).map((v) => v?.nummer).filter(Boolean), heuteIso),
    angebot_id: angebot.id,
    status: "beauftragt",
    vertragsdatum: heuteIso,
    stufen: [{ nr: 1, lph: beauftragt, beauftragt_am: heuteIso }],
    termine: [],
    haftung: null,
    verguetung_snapshot: { summen: a.summen, tafel_stand: tafelStand(angebot.leistungsbild, optionen) },
    bestaetigung_dokument_id: null,
  };
  const nachtraege = (Array.isArray(angebot.besondere_leistungen) ? angebot.besondere_leistungen : []).map((b, i) => ({
    project_id: angebot.project_id, nr: i + 1, titel: b?.titel || "", grund: "besondere_leistung", lph: null,
    berechnung: b?.art === "stunden" ? { art: "stunden", stunden: b.stunden, satz_eur_h: b.satz_eur_h } : { art: "pauschal", betrag_euro: b?.betrag_euro ?? 0 },
    betrag_euro: b?.art === "stunden" ? Math.round((Number(b.stunden) || 0) * cent(b.satz_eur_h)) / 100 : cent(b?.betrag_euro) / 100,
    erbracht_prozent: 0, status: "beauftragt", datum: heuteIso, beauftragt_am: heuteIso, textform_am: angebot.textform_am ?? null,
  }));
  return { vertrag, angebot: { ...angebot, status: "angenommen" }, nachtraege };
}

/**
 * Commissions stage `nr` of a contract (D-P81-32: sets lph[i].beauftragt, so 79's
 * fee calculation and the time tracking see only what is commissioned).
 * @param {Record<string, any>} vertrag
 * @param {number} nr
 * @param {string} datumIso
 * @returns {Record<string, any>}
 */
export function stufeBeauftragen(vertrag, nr, datumIso) {
  return stufeSetztLph(vertrag, nr, datumIso);
}

/**
 * Status change of a contract along VERTRAG_STATUS.
 * @param {Record<string, any>} vertrag
 * @param {string} ziel
 * @returns {{ok: true, vertrag: Record<string, any>} | {ok: false, fehler: 'uebergang'}}
 */
export function vertragsStatusWechsel(vertrag, ziel) {
  if (!statusErlaubt(VERTRAG_STATUS, vertrag?.status || "entwurf", ziel)) return { ok: false, fehler: "uebergang" };
  return { ok: true, vertrag: { ...vertrag, status: ziel } };
}

/**
 * Invoices of a contract with their amendment share taken out of `netto`, so
 * 79's abschlagsVorlage credits only stage billing to the stages.
 * @param {ReadonlyArray<Record<string, any>>} rechnungen
 * @returns {Array<Record<string, any>>}
 */
export function rechnungenOhneNachtragsanteil(rechnungen) {
  return (rechnungen || []).map((r) => {
    const anteil = (r?.lp_pos || []).filter((p) => p?.nachtrag_id).reduce((s, p) => s + cent(p.netto), 0);
    return anteil ? { ...r, netto: (cent(r.netto) - anteil) / 100 } : r;
  });
}

/**
 * Issued, non-cancelled invoices of a contract.
 * @param {Record<string, any>} vertrag
 * @param {ReadonlyArray<Record<string, any>>} rechnungen
 * @returns {Array<Record<string, any>>}
 */
function gestellteRechnungen(vertrag, rechnungen) {
  return (rechnungen || []).filter((r) => r?.honorarvertrag_id === vertrag.id && r.status === "gestellt" && r.art !== "storno");
}

/**
 * The contract account (net Euro):
 * summe = honorarVertrag.netto + commissioned amendments × (1 + NK);
 * erbracht = Σ commissioned stage amount × progress + amendment × done %;
 * abgerechnet = issued invoices; bezahlt = their net share paid (payments are gross);
 * offen = abgerechnet − bezahlt; rest = 79's restBisSchluss + amendments.
 * Incidental costs and VAT stand on the contract (a later rule change does not
 * change it). When the current table data differs from the remuneration
 * snapshot, `hinweise` carries "tafel_geaendert" — the snapshot is binding, the
 * sum is not silently recomputed (D-P81-33).
 * @param {Record<string, any>} vertrag
 * @param {{rechnungen?: ReadonlyArray<Record<string, any>>, nachtraege?: ReadonlyArray<Record<string, any>>, hoaiPlan?: Record<string, any>|null, projekt?: Record<string, any>|null}} daten
 * @param {{weitere?: ReadonlyArray<any>}} [optionen]
 * @returns {{summe: number|null, erbracht: number, abgerechnet: number, bezahlt: number, offen: number, rest: number|null, hinweise: string[], rechnungen: Array<Record<string, any>>}}
 */
export function vertragskonto(vertrag, { rechnungen = [], nachtraege = [], hoaiPlan = null, projekt = null } = {}, optionen = {}) {
  const h = honorarVertrag(vertrag, optionen);
  const eigeneNachtraege = (nachtraege || []).filter((n) => n?.honorarvertrag_id === vertrag.id);
  const nCent = beauftragteNachtraegeCent(vertrag, eigeneNachtraege);
  const gestellt = gestellteRechnungen(vertrag, rechnungen);
  const abgerechnet = gestellt.reduce((s, r) => s + cent(r.netto), 0);
  const bezahlt = gestellt.reduce((s, r) => {
    const brutto = cent(r.brutto);
    const anteil = brutto > 0 ? Math.min(1, bezahltCent(r) / brutto) : 0;
    return s + Math.round(cent(r.netto) * anteil);
  }, 0);
  const st = lpStand(hoaiPlan, projekt, vertrag.leistungsbild);
  let erbracht = 0;
  for (const l of h.lph || []) if (l.beauftragt) erbracht += Math.round(cent(l.betrag) * ((st?.stand?.[l.nr] ?? 0) / 100));
  for (const n of eigeneNachtraege) if (n.status === "beauftragt") erbracht += Math.round(cent(n.betrag_euro) * ((Number(n.erbracht_prozent) || 0) / 100));
  const rest79 = restBisSchluss(vertrag, rechnungen, optionen);
  /** @type {string[]} */
  const hinweise = [];
  if (h.quelle === "tafel_fehlt") hinweise.push("tafel_fehlt");
  const beleg = vertrag.verguetung_snapshot?.tafel_stand;
  if (beleg && h.quelle === "tafel") {
    const jetzt = tafelStand(vertrag.leistungsbild, optionen);
    if (["paragraf", "fassung", "quelle", "abgerufen_am"].some((k) => (beleg[k] ?? null) !== (/** @type {any} */ (jetzt)[k] ?? null))) hinweise.push("tafel_geaendert");
  }
  return {
    summe: typeof h.netto === "number" ? (cent(h.netto) + nCent) / 100 : null,
    erbracht: erbracht / 100,
    abgerechnet: abgerechnet / 100,
    bezahlt: bezahlt / 100,
    offen: (abgerechnet - bezahlt) / 100,
    rest: rest79 === null ? null : (cent(rest79) + nCent) / 100,
    hinweise,
    rechnungen: gestellt,
  };
}

/**
 * Template of the next instalment invoice for 79's RechnungFormular: 79's
 * instalment proposal on the invoices without amendment shares, plus one position
 * per commissioned fee amendment (lp null, nachtrag_id). Null when the contract
 * has no amount (missing table without flat fee — like 79).
 * @param {Record<string, any>} vertrag
 * @param {{rechnungen?: ReadonlyArray<Record<string, any>>, nachtraege?: ReadonlyArray<Record<string, any>>, hoaiPlan?: Record<string, any>|null, projekt?: Record<string, any>|null, heuteIso?: string}} daten
 * @param {{weitere?: ReadonlyArray<any>}} [optionen]
 * @returns {{vorlage: {art: 'abschlag', netto: number, lp_pos: Array<Record<string, any>>, stand_quelle: string, rechnungsdatum?: string}, abschlag_nr: number, titel: string}|null}
 */
export function abschlagMitNachtraegen(vertrag, { rechnungen = [], nachtraege = [], hoaiPlan = null, projekt = null, heuteIso } = {}, optionen = {}) {
  const h = honorarVertrag(vertrag, optionen);
  if (h.quelle === "tafel_fehlt" || h.quelle === "frei") return null;
  const eigene = (rechnungen || []).filter((r) => r?.honorarvertrag_id === vertrag.id);
  const st = lpStand(hoaiPlan, projekt, vertrag.leistungsbild);
  const v = abschlagsVorlage(vertrag, st?.stand || {}, rechnungenOhneNachtragsanteil(eigene), optionen);
  const nPos = nachtragPositionen((nachtraege || []).filter((n) => n?.honorarvertrag_id === vertrag.id), eigene);
  const netto = (cent(v.netto) + nPos.reduce((s, p) => s + cent(p.netto), 0)) / 100;
  const abschlag_nr = gestellteRechnungen(vertrag, eigene).filter((r) => r.art === "abschlag").length + 1;
  return {
    vorlage: { art: "abschlag", netto, lp_pos: [...v.lp_pos, ...nPos], stand_quelle: st?.quelle || "manuell", ...(heuteIso ? { rechnungsdatum: heuteIso } : {}) },
    abschlag_nr,
    titel: `Abschlagsrechnung Nr. ${abschlag_nr} zum Architektenvertrag ${vertrag.nummer || ""}`.trim(),
  };
}

/**
 * Dates of a contract for the dates overview of phase 82 (raw data).
 * @param {Record<string, any>} vertrag
 * @returns {Array<{quelle: 'vertrag', art: string, datum: string, titel: string, objekt: string, project_id: string|null, ziel: string}>}
 */
export function vertragsFristen(vertrag) {
  return (Array.isArray(vertrag?.termine) ? vertrag.termine : [])
    .filter((t) => t?.datum)
    .map((t) => ({ quelle: /** @type {const} */ ("vertrag"), art: t.art || "meilenstein", datum: t.datum, titel: t.titel || "", objekt: vertrag.nummer || "", project_id: vertrag.project_id ?? null, ziel: "/Fees?tab=contracts" }));
}
