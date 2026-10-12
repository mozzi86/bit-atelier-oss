// auth.ts — shared auth guard for every Edge Function (Phase 57-04, Task 1).
//
// Every function MUST go through nutzerAusRequest() before touching data:
//   1. The user's JWT from `Authorization: Bearer …` is verified with
//      supabase.auth.getUser(jwt) — never trusted unparsed (a decoded payload
//      without signature check is forgeable).
//   2. The org is resolved from org_members via the SERVICE-ROLE client:
//      llm_connections has RLS default-deny for authenticated (57-01/0004),
//      and org_members policies only allow own rows — service_role bypasses
//      RLS so the membership lookup itself works. The service key lives ONLY
//      in Deno.env (set by the user via `supabase secrets set`, never in git).
//   3. If the caller passes an org_id (body/query), it must match the
//      membership — otherwise 403. Stage 1 has one membership per user
//      (D-P57-04); multiple orgs arrive with stage 2.
//
// Deno notes: no `node:` imports, `process.env` does not exist here — always
// Deno.env.get(). Types come from the npm: specifier (resolved from the
// repo's node_modules via deno.json nodeModulesDir:manual — no registry).

import { createClient } from "npm:@supabase/supabase-js@2";
import { rolleNormalisieren, ROLLEN_INTERN } from "./zugriffRegeln.js";

/** The verified caller identity, handed to every action handler. */
export interface Nutzer {
  /** auth.users id (uuid) */
  userId: string;
  /** the org this request operates in (membership checked) */
  orgId: string;
  /** role in that org: 'admin' | 'mitglied' (57-01/0001) */
  role: string;
}

/**
 * Thrown instead of returned so handlers can just `throw` and the caller
 * converts it to a Response once (see antworten/fehlerJson in cors.ts).
 */
export class AuthFehler extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "AuthFehler";
    this.status = status;
  }
}

/**
 * The service-role client — bypasses RLS. TWO users:
 *   - verifying a user's JWT (auth.getUser works with any client, but the
 *     anon client of the CALLING project is not available here; the service
 *     client is the documented way in Edge Functions)
 *   - reading org_members / llm_connections (default-deny for authenticated)
 *
 * Created lazily and cached: module scope runs on every cold start, but the
 * env lookup + client construction should happen once per isolate.
 *
 * @throws {AuthFehler} 500 when SUPABASE_SERVICE_ROLE_KEY is missing —
 *   plain text, because nothing works without it and silence would look like
 *   an auth failure.
 */
let _admin: ReturnType<typeof createClient> | null = null;
export function adminClient(): ReturnType<typeof createClient> {
  if (_admin) return _admin;
  // Supabase Edge Runtime injects SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
  // automatically (documented runtime env); the explicit secret set by the
  // user overrides nothing — same names. No fallbacks, no defaults.
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) {
    throw new AuthFehler(
      "Serverkonfiguration fehlt: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY",
      500,
    );
  }
  _admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _admin;
}

/**
 * 78-12: a client that acts AS THE CALLER — anon key plus the caller's JWT, so every read goes through the
 * records policies (0011): an external party sees only what was released to it, exactly like in the
 * browser. Used for the server-built project context of the `llm` function; the service-role client above
 * would bypass RLS and must never read project records on behalf of a user.
 *
 * Not cached: it carries the token of one request.
 * @param {Request} req incoming request (Authorization: Bearer …)
 * @returns {ReturnType<typeof createClient>}
 * @throws {AuthFehler} 401 without token, 500 when SUPABASE_URL / SUPABASE_ANON_KEY are missing
 */
export function nutzerClient(req: Request): ReturnType<typeof createClient> {
  const token = bearerAus(req);
  if (!token) {
    throw new AuthFehler("Anmeldung fehlt oder ist abgelaufen — bitte neu anmelden.", 401);
  }
  // Both are injected by the Supabase Edge Runtime (documented default secrets).
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anonKey) {
    throw new AuthFehler("Serverkonfiguration fehlt: SUPABASE_URL / SUPABASE_ANON_KEY", 500);
  }
  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Extracts the bearer token from the Authorization header.
 * @param {Request} req incoming fetch Request
 * @returns {string|null} raw JWT or null when absent/malformed
 */
function bearerAus(req: Request): string | null {
  const header = req.headers.get("Authorization") || req.headers.get("authorization");
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  // Case-insensitive scheme compare — RFC 7235 says the scheme is
  // case-insensitive; supabase-js sends "Bearer", curl examples vary.
  if (!token || scheme?.toLowerCase() !== "bearer") return null;
  return token.trim() || null;
}

/**
 * The ONE gate: valid user JWT + org membership.
 *
 * Flow: bearer token → auth.getUser(jwt) (signature check, server-side) →
 * org_members lookup for that user → optional org_id from the caller must
 * match. Stage 1: the FIRST membership wins (D-P57-04, same rule as
 * supabaseDb.aktuelleOrgId on the client).
 *
 * @param {Request} req incoming request
 * @param {{ orgId?: string | null }} [ausBody] org_id claimed by the caller
 *   (body/query) — checked against the membership when present
 * @returns {Promise<Nutzer>} verified identity
 * @throws {AuthFehler} 401 without/with an invalid token, 403 without
 *   membership or on an org mismatch — always plain text (project rule:
 *   errors in plain language, never swallowed).
 */
export async function nutzerAusRequest(
  req: Request,
  ausBody: { orgId?: string | null } = {},
): Promise<Nutzer> {
  const token = bearerAus(req);
  if (!token) {
    throw new AuthFehler("Anmeldung fehlt oder ist abgelaufen — bitte neu anmelden.", 401);
  }

  const admin = adminClient();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) {
    // getUser failed = invalid/expired/forged token. The message mirrors the
    // client-side AUTH_MELDUNG so one wording exists across layers.
    throw new AuthFehler("Anmeldung fehlt oder ist abgelaufen — bitte neu anmelden.", 401);
  }
  const userId = data.user.id;

  // Membership: service_role reads org_members regardless of its select
  // policy (which only shows own rows to the user — same result here, but the
  // service path also works for admins acting on the org).
  // The untyped client narrows maybeSingle() to `never` without a generated
  // Database type — supabase/README.md defers type generation to stage 2, so
  // the row shape is asserted here (it is exactly 0001's org_members).
  // 74-01: with a claimed org, look up exactly that membership (a person can
  // be planner in one office and bidder in another); without one, the first
  // membership by org_id — ordered, so the answer does not depend on heap order.
  let abfrage = admin.from("org_members").select("org_id, role").eq("user_id", userId);
  if (ausBody.orgId) abfrage = abfrage.eq("org_id", ausBody.orgId);
  const { data: mitglied, error: orgFehler } = await abfrage
    .order("org_id")
    .limit(1)
    .maybeSingle() as { data: { org_id: string; role: string } | null; error: { message: string } | null };
  if (orgFehler) {
    throw new AuthFehler(`Mitgliedschaft konnte nicht geprüft werden: ${orgFehler.message}`, 500);
  }
  if (!mitglied?.org_id) {
    throw new AuthFehler(
      "Keinem Büro zugeordnet — bitte den Administrator kontaktieren (Einladung fehlt).",
      403,
    );
  }

  // Caller-claimed org must match the membership — without this check a
  // member of org A could pass org_id B and (if any policy ever keyed on the
  // body instead of the JWT) act on foreign data. Defense in depth.
  if (ausBody.orgId && ausBody.orgId !== mitglied.org_id) {
    throw new AuthFehler("Zugriff auf ein fremdes Büro ist nicht erlaubt.", 403);
  }

  return { userId, orgId: mitglied.org_id, role: mitglied.role ?? "mitglied" };
}

// --- 74-01 Task 9: the gate for the access-separation functions -------------
//
// mitgliedFuerOrg() is the stricter sibling of nutzerAusRequest(): the org is
// MANDATORY (without: 400, no guessing) and the membership is looked up for
// exactly that org — no `limit(1)` over all memberships, which in a person
// that is planner in one office and bidder in another would hand out the
// wrong rights depending on heap order. It returns role and the four flags.
// The functions einladung and freigabe use it. nutzerAusRequest() stays as is
// for llm/geo/preise, whose clients do not send org_id yet (the plan wants it
// mandatory everywhere — that is a client change of its own, see SUMMARY).


/** A verified member of ONE org, with role and rights. */
export interface Mitglied {
  userId: string;
  orgId: string;
  /** 0006 vocabulary (admin/mitglied normalised to owner/planner) */
  rolle: string;
  intern: boolean;
  rechte: {
    can_edit_model: boolean;
    can_export_ifc: boolean;
    can_view_audit_reports: boolean;
    can_submit_bid: boolean;
  };
  /** the caller's JWT, for clients that must run under the caller's RLS */
  token: string;
}

/**
 * Verifies the JWT and the membership in exactly `orgId`.
 * @param {Request} req incoming request
 * @param {string|null|undefined} orgId org claimed by the caller (required)
 * @returns {Promise<Mitglied>}
 * @throws {AuthFehler} 400 without org, 401 without/invalid token, 403 without
 *   membership in that org — the same 403 text for "no such org" and "not
 *   yours" (no existence oracle)
 */
export async function mitgliedFuerOrg(req: Request, orgId: string | null | undefined): Promise<Mitglied> {
  if (!orgId) throw new AuthFehler("org_id fehlt — die Anfrage muss das Büro nennen.", 400);
  const token = bearerAus(req);
  if (!token) throw new AuthFehler("Anmeldung fehlt oder ist abgelaufen — bitte neu anmelden.", 401);
  const admin = adminClient();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) throw new AuthFehler("Anmeldung fehlt oder ist abgelaufen — bitte neu anmelden.", 401);

  const { data: zeile, error: fehler } = await admin
    .from("org_members")
    .select("*")
    .eq("user_id", data.user.id)
    .eq("org_id", orgId)
    .maybeSingle() as { data: Record<string, unknown> | null; error: { message: string } | null };
  if (fehler) throw new AuthFehler(`Mitgliedschaft konnte nicht geprüft werden: ${fehler.message}`, 500);
  if (!zeile) throw new AuthFehler("Kein Zugriff auf dieses Büro.", 403);

  const rolle = rolleNormalisieren(zeile.role);
  const intern = (ROLLEN_INTERN as readonly string[]).includes(rolle);
  // Before migration 0006 the flag columns do not exist; the backfill gives
  // stock members every office right — mirror that, never more.
  const altesSchema = !("can_edit_model" in zeile);
  const flag = (name: string): boolean =>
    altesSchema ? intern && name !== "can_submit_bid" && (name !== "can_view_audit_reports" || rolle === "owner")
                : zeile[name] === true;
  return {
    userId: data.user.id,
    orgId,
    rolle,
    intern,
    rechte: {
      can_edit_model: flag("can_edit_model"),
      can_export_ifc: flag("can_export_ifc"),
      can_view_audit_reports: flag("can_view_audit_reports"),
      can_submit_bid: flag("can_submit_bid"),
    },
    token,
  };
}

/**
 * Writes one access-log entry through the service role (0010
 * protokoll_schreiben, actor passed explicitly — auth.uid() is NULL here).
 * A failed log write is an error, not a warning: an action without its log
 * entry is exactly what the log exists to prevent.
 * @throws {AuthFehler} 500 with the database message
 */
export async function protokollieren(
  eintrag: { orgId: string; projektId?: string | null; aktion: string; entity?: string | null; recordId?: string | null;
             detail?: Record<string, unknown>; akteur: string },
): Promise<void> {
  const { error } = await adminClient().rpc("protokoll_schreiben", {
    p_org: eintrag.orgId,
    p_projekt: eintrag.projektId ?? null,
    p_aktion: eintrag.aktion,
    p_entity: eintrag.entity ?? null,
    p_record: eintrag.recordId ?? null,
    p_detail: eintrag.detail ?? {},
    p_akteur: eintrag.akteur,
  } as never);
  if (error) throw new AuthFehler(`Protokolleintrag fehlgeschlagen: ${error.message}`, 500);
}
