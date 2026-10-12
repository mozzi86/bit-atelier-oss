// 78-12 (part 2): project context for a model call is assembled on the SERVER from exactly one project.
//
// Why: before, every AI caller gathered records in the browser and pasted them into the prompt as JSON. The
// server could not tell which project the text came from, and nothing stopped a caller from mixing two
// projects. Now a caller sends { projekt_id, kontext: "<recipe>" }; the server (local invokeLLM route or the
// cloud Edge Function `llm`) reads that one project's records through an injected source and builds the
// context itself. Every list row is checked again against the project id (defence in depth: a sloppy source
// that returns a row of another project does not leak it). Free text inside the records that may come from
// outside the office (ticket titles from BCF imports, …) travels as `daten` blocks (llmSchutz.js), not as
// prompt text.
//
// Byte copy: supabase/functions/_shared/llmKontext.js (Edge Function, Deno) — the unit test
// llmKontext-7812 watches the drift. Therefore: pure, no imports, no Node APIs.
//
// In:  request params { prompt, daten?, projekt_id?, kontext? } + a KontextQuelle (how to read records).
// Out: params with the context appended to the prompt and external text merged into `daten`;
//      projekt_id/kontext removed. Without projekt_id and kontext the params come back unchanged.

/** Heading placed between the caller's prompt and the server-built context. */
export const KONTEXT_KOPF = "Projektdaten (serverseitig aus genau einem Projekt zusammengestellt):";

/** Upper bound of rows read per entity (keeps the prompt small; the recipes use counts and a few titles). */
export const MAX_ZEILEN_JE_ENTITAET = 500;

/** Wording for the energy part — the app runs a screening with guide values, never a GEG proof. */
export const ENERGIE_HINWEIS = "Energie-Screening mit Richtwerten — kein GEG-Nachweis";

/** Error with an HTTP status (400 bad request, 404 project not visible, 503 no data access). */
export class KontextFehler extends Error {
  /**
   * @param {string} message plain-text message (German, shown to the user)
   * @param {number} status HTTP status
   */
  constructor(message, status) {
    super(message);
    this.name = "KontextFehler";
    this.status = status;
  }
}

/** @typedef {Record<string, any>} Datensatz */
/**
 * How the server reads records. Local: the JSON db. Cloud: the `records` table through a client bound to the
 * caller's JWT (RLS applies) and filtered by the caller's org.
 * @typedef {{
 *   projekt: (id: string) => Promise<Datensatz|null>,
 *   liste: (entity: string, projektId: string) => Promise<Datensatz[]>,
 * }} KontextQuelle
 */
/** @typedef {{ quelle: string, text: string }} DatenTeil */
/**
 * @typedef {{
 *   entitaeten: string[],
 *   bauen: (projekt: Datensatz, zeilen: Record<string, Datensatz[]>, jetzt: number) =>
 *     { fakten: Record<string, any>, daten: DatenTeil[] },
 * }} KontextRezept
 */

const zahl = (v) => Number(v) || 0;
const flaeche = (p) => p?.building_area || p?.area_net || 0;
const istOffen = (i) => i?.status !== "resolved" && i?.status !== "closed";

/**
 * Master data of the project — internal fields only (typed in the office, not imported).
 * @param {Datensatz} p
 * @returns {Record<string, any>}
 */
function stammdaten(p) {
  return {
    projekt: p?.name ?? null,
    auftraggeber: p?.client ?? null,
    status: p?.status ?? null,
    hoai_phase: p?.hoai_phase ?? null,
    ort: p?.location?.city ?? null,
    flaeche_m2: flaeche(p),
    energieziel: p?.energy_target ?? null,
    nachhaltigkeit: p?.sustainability_rating ?? null,
    fertigstellung: p?.completion_date ?? null,
  };
}

/** The recipes a caller may name. Fixed on the server — a caller cannot add entities. */
export const KONTEXT_REZEPTE = Object.freeze({
  /** @type {KontextRezept} master data (GenerativeLayout and other light callers) */
  projektStamm: {
    entitaeten: [],
    bauen: (projekt) => ({ fakten: stammdaten(projekt), daten: [] }),
  },
  /** @type {KontextRezept} holistic project audit (ProjectAudit) */
  projektAudit: {
    entitaeten: ["EnergyScenario", "Issue", "LVPosition", "Tender", "Bid", "ScheduleTask"],
    bauen: (projekt, z, jetzt) => {
      const offen = z.Issue.filter(istOffen);
      const kritisch = offen.filter((i) => i.priority === "critical" || i.priority === "high");
      const ueberfaellig = z.ScheduleTask.filter(
        (t) => t.end_date && new Date(t.end_date).getTime() < jetzt && zahl(t.progress) < 100,
      );
      const es = z.EnergyScenario[0];
      const geg = es?.geg_compliance;
      const fakten = {
        ...stammdaten(projekt),
        kostenanschlag_eur: Math.round(z.LVPosition.reduce((s, p) => s + zahl(p.quantity) * zahl(p.unit_price), 0)),
        lv_positionen: z.LVPosition.length,
        ausschreibungen: z.Tender.length,
        angebote: z.Bid.length,
        offene_tickets: offen.length,
        kritische_tickets: kritisch.length,
        vorgaenge: z.ScheduleTask.length,
        ueberfaellige_vorgaenge: ueberfaellig.length,
        energie_screening: geg
          ? { richtwert_eingehalten: Boolean(geg.passes_geg), faktor: geg.compliance_factor ?? null, hinweis: ENERGIE_HINWEIS }
          : null,
      };
      // Ticket titles may come from BCF files of other parties — data, not instructions.
      const tickets = offen.slice(0, 8).map((i) => `${i.priority || "?"}: ${String(i.title ?? "")}`);
      return { fakten, daten: tickets.length ? [{ quelle: "Tickets (offen)", text: tickets.join("\n") }] : [] };
    },
  },
});

/**
 * Build the context of one project with one recipe.
 * @param {{ projekt_id?: unknown, kontext?: unknown }} anfrage
 * @param {KontextQuelle|null|undefined} quelle
 * @param {{ jetzt?: number }} [optionen]
 * @returns {Promise<{ projekt_id: string, text: string, daten: DatenTeil[] }>}
 * @throws {KontextFehler}
 */
export async function projektKontext(anfrage, quelle, optionen = {}) {
  const name = String(anfrage?.kontext ?? "").trim();
  const projektId = String(anfrage?.projekt_id ?? "").trim();
  if (!name) throw new KontextFehler("Kontext-Rezept fehlt (kontext)", 400);
  if (!Object.prototype.hasOwnProperty.call(KONTEXT_REZEPTE, name)) {
    throw new KontextFehler(`Unbekanntes Kontext-Rezept: ${name.slice(0, 60)}`, 400);
  }
  if (!projektId) throw new KontextFehler("projekt_id fehlt", 400);
  if (!quelle) throw new KontextFehler("Projektkontext ist ohne Datenzugriff nicht verfügbar", 503);

  const projekt = await quelle.projekt(projektId);
  if (!projekt || String(projekt.id) !== projektId) throw new KontextFehler("Projekt nicht gefunden", 404);

  /** @type {KontextRezept} */
  const rezept = KONTEXT_REZEPTE[name];
  /** @type {Record<string, Datensatz[]>} */
  const zeilen = {};
  for (const entity of rezept.entitaeten) {
    const roh = await quelle.liste(entity, projektId);
    zeilen[entity] = (Array.isArray(roh) ? roh : [])
      .filter((r) => r && String(r.project_id) === projektId)
      .slice(0, MAX_ZEILEN_JE_ENTITAET);
  }
  const { fakten, daten } = rezept.bauen(projekt, zeilen, optionen.jetzt ?? Date.now());
  return { projekt_id: projektId, text: JSON.stringify(fakten, null, 2), daten };
}

/**
 * Apply a requested project context to invokeLLM params. Without projekt_id and kontext the very same object
 * comes back (prompt byte-identical to the calls before).
 * @param {Record<string, any>} params request body of invoke-llm / aktion "invoke"
 * @param {KontextQuelle|null|undefined} quelle
 * @param {{ jetzt?: number }} [optionen]
 * @returns {Promise<Record<string, any>>}
 * @throws {KontextFehler}
 */
export async function mitProjektKontext(params, quelle, optionen = {}) {
  const p = params && typeof params === "object" ? params : {};
  if (p.kontext == null && p.projekt_id == null) return p;
  const k = await projektKontext(p, quelle, optionen);
  const { kontext: _kontext, projekt_id: _projektId, ...rest } = p;
  const vorher = Array.isArray(p.daten) ? p.daten : [];
  return {
    ...rest,
    prompt: `${String(p.prompt ?? "")}\n\n${KONTEXT_KOPF}\n${k.text}`,
    daten: [...vorher, ...k.daten],
  };
}
