// cors.ts — shared CORS + response helpers for every Edge Function
// (Phase 57-04, Task 1).
//
// Same idea as server/index.js:29-37 (the Express cors() whitelist): the app's
// own origins are allowed, extras come from an env secret. Edge Functions are
// public HTTP endpoints, so every response (including OPTIONS preflight and
// errors) must carry the CORS headers or the browser blocks the call before
// the app can read it.
//
// Deno notes: no `node:` imports; env via Deno.env.get().

/** Built-in allowed origins (same set as server/index.js ERLAUBTE_ORIGINS). */
const BASIS_ORIGINS = [
  "https://app.bit-atelier.de", // cloud production (57-05)
  "http://localhost:5173", // vite dev
  "http://localhost:4173", // vite preview / client build
  "http://127.0.0.1:5173",
  "http://127.0.0.1:4173",
];

/**
 * The allowed origins, memoized. EXTRA_ORIGINS (comma-separated) is a secret
 * the user sets per environment — e.g. a Tauri custom origin (phase 70) or a
 * preview URL. Mirrors API_ORIGINS in server/index.js.
 * @returns {Set<string>} allowed origin strings
 */
let _origins: Set<string> | null = null;
function erlaubteOrigins(): Set<string> {
  if (_origins) return _origins;
  const extra = String(Deno.env.get("EXTRA_ORIGINS") || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  _origins = new Set([...BASIS_ORIGINS, ...extra]);
  return _origins;
}

/**
 * Builds the CORS headers for one request. An Origin not on the list yields
 * NO Access-Control-Allow-Origin header — the browser then blocks the read
 * (the same deny-by-omission the Express cors() middleware uses).
 * @param {Request} req incoming request (read for its Origin header)
 * @returns {Record<string, string>} headers to spread into a Response
 */
export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") || req.headers.get("origin");
  const headers: Record<string, string> = {
    // Vary so caches don't serve one origin's response to another.
    "Vary": "Origin",
  };
  if (origin && erlaubteOrigins().has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Headers"] =
      "authorization, x-client-info, apikey, content-type";
    headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS";
    // The app is same-site-ish (app.bit-atelier.de + supabase.co); credentials
    // are NOT used (supabase-js sends the JWT in a header, not a cookie), so
    // Allow-Credentials stays off — least privilege.
  }
  return headers;
}

/**
 * Answers an OPTIONS preflight. 204 with the CORS headers and an empty body.
 * @param {Request} req incoming request
 * @returns {Response} preflight response
 */
export function optionsAntwort(req: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

/**
 * Wraps a JSON body into a Response carrying the CORS headers.
 * @param {Request} req incoming request (for its Origin)
 * @param {unknown} body JSON-serializable payload
 * @param {number} [status=200] HTTP status
 * @returns {Response}
 */
export function jsonAntwort(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

/**
 * The single error funnel: an AuthFehler (or anything carrying .status) keeps
 * its status, everything else becomes 500 WITHOUT leaking internals — message
 * only, never a stack trace to the client; the stack goes to the console (Edge
 * Function logs). Reads .status structurally, so it needs no auth.ts import
 * (keeps the dependency direction one-way: auth.ts and the functions import
 * cors.ts, never the reverse).
 * @param {Request} req incoming request
 * @param {unknown} err thrown value
 * @param {string} kontext function/action name for the console log
 * @returns {Response} { error: "…" } with CORS headers
 */
export function fehlerAntwort(req: Request, err: unknown, kontext: string): Response {
  const status = typeof (err as { status?: number })?.status === "number"
    ? (err as { status: number }).status
    : 500;
  const message = (err as Error)?.message || "Interner Fehler";
  // Loud on the server (Edge Function logs), plain on the wire.
  console.error(`[${kontext}] ${status}:`, err);
  return jsonAntwort(req, { error: message }, status);
}
