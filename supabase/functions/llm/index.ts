// supabase/functions/llm/index.ts — the LLM proxy as an Edge Function
// (Phase 57-04, Task 2). Port of packages/nova-core/server/routes.js llmRouter
// (:129-249) + server/llm.js — ONE function, actions via the body field
// `aktion` (fewer cold starts than seven functions).
//
// Actions (body JSON):
//   { aktion: 'invoke', prompt, response_json_schema? }        → llm answer
//   { aktion: 'connections.list' }                             → masked list
//   { aktion: 'connections.create', name?, provider, base_url?, model?, api_key?, active? }
//   { aktion: 'connections.update', id, …same fields… }        (empty api_key = keep)
//   { aktion: 'connections.delete', id }                       → { success: true }
//   { aktion: 'test', id? | provider…, api_key? }              → { ok, … }
//   { aktion: 'defaults' }                                     → PROVIDER_DEFAULTS
//
// Security (D-P57-07, must-have): foreign API keys live ONLY in
// llm_connections (RLS default-deny, 57-01/0004); this function reads them
// with the service-role client and returns NOTHING but masked values
// (sk-…abcd). Fallback secrets ANTHROPIC_API_KEY / OPENAI_API_KEY are env-only.
// Every action requires a valid user JWT + org membership (auth.ts); anonymous
// calls answer 401.
//
// Mock parity (key_link): mockResponse/buildMockFromSchema are copied 1:1 from
// server/llm.js — the offline answer must be identical (verification compares
// the first line). NO node: imports anywhere in this file.

import { nutzerAusRequest, adminClient, type Nutzer } from "../_shared/auth.ts";
import { corsHeaders, optionsAntwort, jsonAntwort, fehlerAntwort } from "../_shared/cors.ts";

// ---------------------------------------------------------------------------
// Port of server/llm.js (mock, provider calls) — unchanged semantics
// ---------------------------------------------------------------------------

/** Deterministic offline answer when no key/connection exists (llm.js:7-17). */
function mockResponse({ prompt = "", response_json_schema }: InvokeParams): unknown {
  if (response_json_schema) {
    return buildMockFromSchema(response_json_schema);
  }
  return (
    `🔧 [Offline-Modus] Es ist kein LLM-API-Schlüssel konfiguriert.\n\n` +
    `Setze ANTHROPIC_API_KEY oder OPENAI_API_KEY in der .env, um echte ` +
    `KI-Antworten zu erhalten.\n\n` +
    `Deine Anfrage war:\n"${String(prompt).slice(0, 400)}"`
  );
}

/** Recursively fills a JSON schema with type defaults (llm.js:19-34). */
// deno-lint-ignore no-explicit-any
function buildMockFromSchema(schema: any): any {
  if (!schema || typeof schema !== "object") return {};
  if (schema.type === "object" && schema.properties) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(schema.properties)) {
      out[k] = buildMockFromSchema(v);
    }
    return out;
  }
  if (schema.type === "array") return [];
  if (schema.type === "number" || schema.type === "integer") return 0;
  if (schema.type === "boolean") return false;
  return schema.enum?.[0] ?? "";
}

/** The invoke/test parameter shape shared by all provider calls (llm.js). */
interface InvokeParams {
  prompt?: string;
  // deno-lint-ignore no-explicit-any
  response_json_schema?: any;
}

/** A connection row — same fields as llm_connections (57-01/0004). */
interface Verbindung {
  id?: string;
  name?: string;
  provider: string;
  base_url?: string;
  model?: string;
  api_key?: string;
  active?: boolean;
}

/** Standard base URLs per provider (llm.js:114-119). */
const PROVIDER_DEFAULTS: Record<string, string> = {
  anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com",
  ollama: "http://127.0.0.1:11434",
  custom: "",
};

/**
 * True when the request would point a stored connection at another endpoint:
 * provider or base_url present in the body and different from the stored row.
 * Trailing slashes are ignored so "…/v1" and "…/v1/" do not count as a change.
 */
function zielGeaendert(gespeichert: Verbindung, body: Record<string, unknown>): boolean {
  const norm = (v: unknown) => String(v ?? "").trim().replace(/\/+$/, "");
  const providerNeu = body.provider !== undefined && String(body.provider) !== String(gespeichert.provider ?? "");
  const urlNeu = body.base_url !== undefined && norm(body.base_url) !== norm(gespeichert.base_url);
  return providerNeu || urlNeu;
}

/** Base URL with trailing slashes stripped (llm.js:121-124). */
function baseUrlFor(conn: Verbindung): string {
  const raw = (conn.base_url || PROVIDER_DEFAULTS[conn.provider] || "").trim();
  return raw.replace(/\/+$/, "");
}

// 83-03: endpoint URL rule — a MIRROR of endpunktUrl() in
// packages/nova-core/src/lib/kiVorlagen.js (tested there in
// tests/unit/kiVorlagen.test.js). This function is bundled on its own and
// cannot import the app package; change both places together.
const VERSIONS_SEGMENT = /^v\d+[a-z0-9]*$/i;
// [CITED] DeepSeek documents POST https://api.deepseek.com/chat/completions (no /v1).
const HOSTS_OHNE_V1 = ["api.deepseek.com"];

/** Full endpoint URL per connection type (mirror of kiVorlagen.js endpunktUrl). */
function endpunktUrl(provider: string, basisUrl: string): string {
  const basis = String(basisUrl ?? "").trim().replace(/\/+$/, "");
  if (!basis) return "";
  if (provider === "anthropic") {
    if (/\/v1\/messages$/i.test(basis)) return basis;
    return /\/v1$/i.test(basis) ? `${basis}/messages` : `${basis}/v1/messages`;
  }
  if (provider === "ollama") return `${basis.replace(/\/(v1|api)$/i, "")}/api/chat`;
  if (/\/chat\/completions$/i.test(basis)) return basis;
  let host = "";
  let segmente: string[] = [];
  try {
    const url = new URL(basis);
    host = url.hostname.toLowerCase();
    segmente = url.pathname.split("/").filter(Boolean);
  } catch {
    segmente = basis.split("/").filter(Boolean);
  }
  const letztes = (segmente[segmente.length - 1] || "").toLowerCase();
  const ohneV1 = segmente.some((s) => VERSIONS_SEGMENT.test(s)) || letztes === "openai" || HOSTS_OHNE_V1.includes(host);
  return ohneV1 ? `${basis}/chat/completions` : `${basis}/v1/chat/completions`;
}

/** Default models (mirror of llm.js STANDARD_*_MODELL). */
const STANDARD_ANTHROPIC_MODELL = "claude-sonnet-5-5";
const STANDARD_OPENAI_MODELL = "gpt-4o-mini";

/** System + full prompt, schema-aware (llm.js:126-134). */
function buildPrompts({ prompt, response_json_schema }: InvokeParams) {
  const sys = response_json_schema
    ? "You are a helpful assistant. Respond ONLY with valid JSON matching the schema the user describes. No prose, no code fences."
    : "You are a helpful assistant specialized in construction, architecture, and project management.";
  const fullPrompt = response_json_schema
    ? `${prompt}\n\nReturn JSON conforming to this JSON schema:\n${JSON.stringify(response_json_schema)}`
    : prompt;
  return { sys, fullPrompt };
}

/** JSON.parse with code-fence/prose stripping fallback (llm.js:95-110). */
function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        /* fall through */
      }
    }
    return { raw: text };
  }
}

/**
 * Calls the model behind an LlmConnection (Anthropic Messages, Ollama
 * /api/chat, or an OpenAI-compatible /v1/chat/completions). The connection's
 * api_key is used HERE and nowhere else — it never leaves this function
 * (port of llm.js:139-206 callConnection).
 */
async function callConnection(
  conn: Verbindung,
  params: InvokeParams,
  { signal }: { signal?: AbortSignal } = {},
): Promise<unknown> {
  const { sys, fullPrompt } = buildPrompts(params);
  const base = baseUrlFor(conn);
  if (!base) throw new Error("Keine Basis-URL konfiguriert");
  const { response_json_schema } = params;
  const url = endpunktUrl(conn.provider, base);

  if (conn.provider === "anthropic") {
    const resp = await fetch(url, {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": conn.api_key || "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: conn.model || STANDARD_ANTHROPIC_MODELL,
        max_tokens: 2048,
        system: sys,
        messages: [{ role: "user", content: fullPrompt }],
      }),
    });
    if (!resp.ok) throw new Error(`Anthropic ${resp.status}: ${await resp.text()}`);
    // deno-lint-ignore no-explicit-any
    const data = await resp.json() as any;
    const text = data.content?.map((c: { text?: string }) => c.text).join("") ?? "";
    return response_json_schema ? safeParse(text) : text;
  }

  if (conn.provider === "ollama") {
    const resp = await fetch(url, {
      method: "POST",
      signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: conn.model || "llama3",
        stream: false,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: fullPrompt },
        ],
      }),
    });
    if (!resp.ok) throw new Error(`Ollama ${resp.status}: ${await resp.text()}`);
    // deno-lint-ignore no-explicit-any
    const data = await resp.json() as any;
    const text = data.message?.content ?? "";
    return response_json_schema ? safeParse(text) : text;
  }

  // 'openai' and 'custom' → OpenAI-compatible Chat Completions.
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (conn.api_key) headers.authorization = `Bearer ${conn.api_key}`;
  const resp = await fetch(url, {
    method: "POST",
    signal,
    headers,
    body: JSON.stringify({
      model: conn.model || STANDARD_OPENAI_MODELL,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: fullPrompt },
      ],
      ...(response_json_schema ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!resp.ok) throw new Error(`Endpoint ${resp.status}: ${await resp.text()}`);
  // deno-lint-ignore no-explicit-any
  const data = await resp.json() as any;
  const text = data.choices?.[0]?.message?.content ?? "";
  return response_json_schema ? safeParse(text) : text;
}

/** Env-key providers (llm.js:36-93) — secrets stay in Deno.env. */
async function callAnthropic(params: InvokeParams): Promise<unknown> {
  return callConnection(
    { provider: "anthropic", api_key: Deno.env.get("ANTHROPIC_API_KEY"), model: Deno.env.get("ANTHROPIC_MODEL") || Deno.env.get("LLM_MODEL") || "" },
    params,
  );
}
async function callOpenAI(params: InvokeParams): Promise<unknown> {
  return callConnection(
    { provider: "openai", api_key: Deno.env.get("OPENAI_API_KEY"), model: Deno.env.get("OPENAI_MODEL") || Deno.env.get("LLM_MODEL") || "" },
    params,
  );
}

/**
 * The invoke pipeline (llm.js:208-214): an active org connection wins, then
 * the env fallbacks, then the mock. The mock keeps the app usable with no key
 * at all (must-have #4).
 */
async function invokeLLM(params: InvokeParams, connection: Verbindung | null): Promise<unknown> {
  if (connection) return callConnection(connection, params);
  if (Deno.env.get("ANTHROPIC_API_KEY")) return callAnthropic(params);
  if (Deno.env.get("OPENAI_API_KEY")) return callOpenAI(params);
  return mockResponse(params);
}

// ---------------------------------------------------------------------------
// Port of routes.js llmRouter — masking + llm_connections CRUD (service role)
// ---------------------------------------------------------------------------

/** Never return a key in clear text — masked only (routes.js:104-109). */
function maskKey(key: string | null | undefined): string {
  if (!key) return "";
  const s = String(key);
  if (s.length <= 8) return "••••";
  return `${s.slice(0, 3)}…${s.slice(-4)}`;
}

/** Strips api_key, adds api_key_masked/has_api_key (routes.js:111-115). */
// deno-lint-ignore no-explicit-any
function publicConnection(conn: any): any {
  if (!conn) return conn;
  const { api_key, ...rest } = conn;
  return { ...rest, api_key_masked: maskKey(api_key), has_api_key: Boolean(api_key) };
}

/** Compact unique id — same algorithm as db.js:81/abfrage.js neueId(). */
function neueId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * The org's active connection (routes.js:117-123). Reads with the service
 * client (RLS default-deny) and filters by org — a connection of another org
 * must never be picked up even if its row existed.
 */
async function aktiveVerbindung(orgId: string): Promise<Verbindung | null> {
  const { data, error } = await adminClient()
    .from("llm_connections")
    .select("*")
    .eq("org_id", orgId)
    .eq("active", true)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Verbindungen laden fehlgeschlagen: ${error.message}`);
  return (data as Verbindung | null) ?? null;
}

/** connections.list — masked, newest first (routes.js:141-143). */
async function connectionsList(orgId: string): Promise<unknown> {
  const { data, error } = await adminClient()
    .from("llm_connections")
    .select("*")
    .eq("org_id", orgId)
    .order("updated_date", { ascending: false });
  if (error) throw new Error(`Verbindungen laden fehlgeschlagen: ${error.message}`);
  return (data || []).map(publicConnection);
}

/** Only one connection active at a time (routes.js:148-153). */
async function andereDeaktivieren(orgId: string, ausserId?: string): Promise<void> {
  // `as never`: the untyped client narrows write payloads to never (see the
  // Database-type note in _shared/auth.ts) — the cast is the documented
  // workaround until type generation lands (stage 2).
  let q = adminClient()
    .from("llm_connections")
    .update({ active: false } as never)
    .eq("org_id", orgId)
    .eq("active", true);
  if (ausserId) q = q.neq("id", ausserId);
  const { error } = await q;
  if (error) throw new Error(`Aktiv-Flag zurücksetzen fehlgeschlagen: ${error.message}`);
}

/** connections.create — 201 shape via { …record } (routes.js:145-163). */
async function connectionsCreate(orgId: string, body: Record<string, unknown>): Promise<unknown> {
  const { name, provider, base_url, model, api_key, active } = body as {
    name?: string; provider?: string; base_url?: string; model?: string;
    api_key?: string; active?: boolean;
  };
  if (!provider) {
    const err = new Error("Anbieter fehlt") as Error & { status: number };
    err.status = 400;
    throw err;
  }
  if (active) await andereDeaktivieren(orgId);
  const zeile = {
    id: neueId(),
    org_id: orgId,
    name: name || "",
    provider,
    base_url: base_url || "",
    model: model || "",
    api_key: api_key || "",
    active: Boolean(active),
  };
  const { data, error } = await adminClient()
    .from("llm_connections")
    .insert(zeile as never) // untyped client — see andereDeaktivieren note
    .select("*")
    .single();
  if (error) throw new Error(`Verbindung anlegen fehlgeschlagen: ${error.message}`);
  return publicConnection(data);
}

/**
 * connections.update — org-scoped (a foreign id simply updates 0 rows → 404).
 * Empty api_key field = keep the stored key, write-only (routes.js:165-185).
 */
async function connectionsUpdate(
  orgId: string,
  id: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const { name, provider, base_url, model, api_key, active } = body as {
    name?: string; provider?: string; base_url?: string; model?: string;
    api_key?: string; active?: boolean;
  };
  const vorhanden = await adminClient()
    .from("llm_connections")
    .select("id, provider, base_url")
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (!vorhanden.data) {
    const err = new Error("Not found") as Error & { status: number };
    err.status = 404;
    throw err;
  }
  if (active) await andereDeaktivieren(orgId, id);
  // RC-04: a new target without a new key drops the stored key. Keeping it
  // would let the next invoke send the org key to the new base_url.
  const zielNeu = !api_key && zielGeaendert(vorhanden.data as Verbindung, body);
  const patch: Record<string, unknown> = {
    ...(name !== undefined ? { name } : {}),
    ...(provider !== undefined ? { provider } : {}),
    ...(base_url !== undefined ? { base_url } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(active !== undefined ? { active: Boolean(active) } : {}),
    // Empty api_key = keep the stored key (write-only field) — unless the
    // target changed, then the key is cleared and has to be re-entered.
    ...(api_key ? { api_key } : zielNeu ? { api_key: "" } : {}),
  };
  const { data, error } = await adminClient()
    .from("llm_connections")
    .update(patch as never) // untyped client — see andereDeaktivieren note
    .eq("org_id", orgId)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(`Verbindung ändern fehlgeschlagen: ${error.message}`);
  return publicConnection(data);
}

/** connections.delete (routes.js:187-191). */
async function connectionsDelete(orgId: string, id: string): Promise<unknown> {
  const { data, error } = await adminClient()
    .from("llm_connections")
    .delete()
    .eq("org_id", orgId)
    .eq("id", id)
    .select("id");
  if (error) throw new Error(`Verbindung löschen fehlgeschlagen: ${error.message}`);
  if (!data || data.length === 0) {
    const err = new Error("Not found") as Error & { status: number };
    err.status = 404;
    throw err;
  }
  return { success: true };
}

/**
 * test — mini prompt, 15 s timeout, ALWAYS 200 with { ok:false, fehler } on
 * unreachable endpoints (offline convention, routes.js:193-232). A stored
 * connection is loaded by id (org-scoped); form values override stored ones,
 * an empty api_key means "use the stored key" — the key is never sent to the
 * browser, so the form legitimately cannot re-send it.
 */
async function connectionTest(orgId: string, body: Record<string, unknown>): Promise<unknown> {
  let conn: Verbindung;
  if (body.id) {
    const { data } = await adminClient()
      .from("llm_connections")
      .select("*")
      .eq("org_id", orgId)
      .eq("id", String(body.id))
      .maybeSingle();
    if (!data) return { ok: false, fehler: "Verbindung nicht gefunden" };
    const gespeichert = data as Verbindung;
    // RC-04 (74-01 Task 9): the stored key may only travel to the endpoint it
    // was stored for. A member changing base_url or provider without typing a
    // key would otherwise send the org key to a server of their choosing.
    if (!body.api_key && zielGeaendert(gespeichert, body)) {
      return {
        ok: false,
        fehler: "Anbieter oder Basis-URL geändert — bitte den API-Schlüssel erneut eingeben. Der gespeicherte Schlüssel wird für ein anderes Ziel nicht verwendet.",
      };
    }
    // Form values override stored ones; an empty api_key = use the stored key.
    conn = {
      ...gespeichert,
      ...(body as Partial<Verbindung>),
      api_key: String(body.api_key || gespeichert.api_key || ""),
    };
  } else {
    conn = body as unknown as Verbindung;
  }
  if (!conn.provider) return { ok: false, fehler: "Anbieter fehlt" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  const t0 = Date.now();
  try {
    const antwort = await callConnection(
      conn,
      { prompt: "Antworte nur mit dem Wort: OK" },
      { signal: controller.signal },
    );
    return {
      ok: true,
      modell: conn.model || "(Standard)",
      antwort: String(antwort).slice(0, 200),
      dauer_ms: Date.now() - t0,
    };
  } catch (err) {
    const e = err as Error;
    const fehler = e.name === "AbortError"
      ? "Zeitüberschreitung (15 s) — Endpoint nicht erreichbar"
      : e.message || "Verbindung fehlgeschlagen";
    return { ok: false, fehler, dauer_ms: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/** Reads and JSON-parses the body; empty body → {}. */
async function bodyLesen(req: Request): Promise<Record<string, unknown>> {
  try {
    const text = await req.text();
    return text ? JSON.parse(text) as Record<string, unknown> : {};
  } catch {
    const err = new Error("Ungültiger JSON-Body") as Error & { status: number };
    err.status = 400;
    throw err;
  }
}

/** Dispatch on `aktion` — one function, seven actions (fewer cold starts). */
async function ausführen(nutzer: Nutzer, body: Record<string, unknown>): Promise<unknown> {
  const aktion = String(body.aktion || "");
  const orgId = nutzer.orgId;
  // org_id in the body must match the membership — checked centrally.
  if (body.org_id && body.org_id !== orgId) {
    const err = new Error("Zugriff auf ein fremdes Büro ist nicht erlaubt.") as Error & { status: number };
    err.status = 403;
    throw err;
  }

  switch (aktion) {
    case "invoke":
      return invokeLLM(
        { prompt: String(body.prompt ?? ""), response_json_schema: body.response_json_schema },
        await aktiveVerbindung(orgId),
      );
    case "connections.list":
      return connectionsList(orgId);
    case "connections.create":
      return connectionsCreate(orgId, body);
    case "connections.update":
      if (!body.id) {
        const err = new Error("id fehlt") as Error & { status: number };
        err.status = 400;
        throw err;
      }
      return connectionsUpdate(orgId, String(body.id), body);
    case "connections.delete":
      if (!body.id) {
        const err = new Error("id fehlt") as Error & { status: number };
        err.status = 400;
        throw err;
      }
      return connectionsDelete(orgId, String(body.id));
    case "test":
      return connectionTest(orgId, body);
    case "defaults":
      return PROVIDER_DEFAULTS;
    default: {
      const err = new Error(`Unbekannte Aktion: ${aktion || "(leer)"}`) as Error & { status: number };
      err.status = 400;
      throw err;
    }
  }
}

/**
 * Entry point. OPTIONS → preflight; anything else must be POST with a valid
 * JWT (GET included — an unauthenticated GET must answer 401, not 405, per
 * the verification "curl ohne JWT → 401").
 */
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return optionsAntwort(req);
  try {
    if (req.method !== "POST") {
      const err = new Error("Nur POST unterstützt") as Error & { status: number };
      err.status = 405;
      throw err;
    }
    const body = await bodyLesen(req);
    const nutzer = await nutzerAusRequest(req, { orgId: body.org_id ? String(body.org_id) : null });
    const ergebnis = await ausführen(nutzer, body);
    // create answers 201 on Express; keeping 200 here is fine for the client
    // (it only reads the JSON), but parity is cheap:
    const status = String(body.aktion) === "connections.create" ? 201 : 200;
    return jsonAntwort(req, ergebnis, status);
  } catch (err) {
    return fehlerAntwort(req, err, `llm`);
  }
});
