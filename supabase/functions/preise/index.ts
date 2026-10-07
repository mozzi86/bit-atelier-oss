// supabase/functions/preise/index.ts — price-research proxy as an Edge
// Function (Phase 57-04, Task 4). Port of
// packages/nova-ausschreibung/server/routes.js pricesRouter:
//   POST { aktion: 'ted-search', query?, fields?, page?, scope?, limit? }
//
// Security:
//  - Errors answer 200 { offline: true } — no stack traces, no 5xx
//    (ted-search convention).
//  - Every action requires a valid user JWT + org membership — anonymous
//    calls answer 401.
//
// Deno notes: no node: imports.

import { nutzerAusRequest } from "../_shared/auth.ts";
import { optionsAntwort, jsonAntwort, fehlerAntwort } from "../_shared/cors.ts";

// --- TED Search API v3 proxy (routes.js:17-47) --------------------------------
// No key, POST only; errors/offline → 200 { offline:true }, never 5xx.
// Target URL hard-coded (no open relay), server-side limit ≤ 250.
async function tedSearch(body: Record<string, unknown>): Promise<unknown> {
  const limit = Math.min(Number(body?.limit) || 250, 250);
  // ME-07: reduce the body to the expected fields — no unfiltered pass-through.
  const { query, fields, page, scope } = body as {
    query?: string; fields?: unknown[]; page?: number | string; scope?: string;
  };
  const tedBody = {
    ...(typeof query === "string" ? { query } : {}),
    ...(Array.isArray(fields) ? { fields } : {}),
    page: Math.max(1, Number(page) || 1),
    ...(typeof scope === "string" ? { scope } : {}),
    limit,
  };
  try {
    const resp = await fetch("https://api.ted.europa.eu/v3/notices/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "BIT-Atelier/1.0 (lokales Planungstool)",
      },
      body: JSON.stringify(tedBody),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) {
      // 405/400/429/504 land here — no throw, no 5xx to the client.
      return { offline: true, status: resp.status };
    }
    return await resp.json();
  } catch {
    return { offline: true };
  }
}

// --- Handler -------------------------------------------------------------------

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

/**
 * Entry point. OPTIONS → preflight; POST with a valid JWT dispatches on
 * `aktion` ('ted-search'). Unknown path → plain-text 400.
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
    // Membership gate first — price research runs on org projects (must-have:
    // anonymous → 401). org_id in the body must match, checked centrally.
    await nutzerAusRequest(req, { orgId: body.org_id ? String(body.org_id) : null });

    const aktion = String(body.aktion || "");
    if (aktion === "ted-search") {
      return jsonAntwort(req, await tedSearch(body));
    }
    const err = new Error(
      `Unbekannte Aktion: ${aktion || "(leer)"} — verfügbar: ted-search`,
    ) as Error & { status: number };
    err.status = 400;
    throw err;
  } catch (err) {
    return fehlerAntwort(req, err, "preise");
  }
});
