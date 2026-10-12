// freigabe/index.ts — download of a released file WITH proof (Phase 74-01 Task 9).
//
// POST { org_id, record_id }  (record_id = a ModellFreigabe row, 0012)
//   1. caller is a member of org_id (mitgliedFuerOrg — JWT verified);
//   2. VISIBILITY is decided by the database under the CALLER's JWT: a client
//      with the anon key plus the caller's bearer token reads the row, so RLS
//      (0011) and auth.uid() apply — the function never decides by itself
//      who may see what;
//   3. the object path is built from that row (zugriffRegeln.freigabePfad),
//      NEVER taken from the request — the neighbour file with the same stem is
//      unreachable (A-32);
//   4. .ifc/.ifczip originals additionally need can_export_ifc (externals
//      never have it, G-3);
//   5. the service role signs a URL valid for 60 seconds and writes the log
//      entry — IN EVERY CASE, also on refusal ('download_verweigert').
//
// Honest limit (G-3): a signed URL can be passed on within its 60 seconds,
// and Supabase signed URLs are not single-use. The log records the event; it
// is no copy protection. Therefore externals get reduced views, never the
// IFC original.
//
// Not deployed (deploy only after the user's yes; `deno check` locally).

import { createClient } from "npm:@supabase/supabase-js@2";
import { adminClient, AuthFehler, mitgliedFuerOrg, protokollieren } from "../_shared/auth.ts";
import { fehlerAntwort, jsonAntwort, optionsAntwort } from "../_shared/cors.ts";
import { freigabePfad, istIfcDatei } from "../_shared/zugriffRegeln.js";

/** Lifetime of a signed URL, in seconds. */
const GUELTIG_S = 60;

const ABGEWIESEN = "Vorgang nicht zulässig oder nicht gefunden";

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return optionsAntwort(req);
  try {
    if (req.method !== "POST") throw new AuthFehler("Nur POST unterstützt", 405);
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      throw new AuthFehler("Ungültiger JSON-Body", 400);
    }
    const mitglied = await mitgliedFuerOrg(req, body.org_id ? String(body.org_id) : null);
    const recordId = String(body.record_id ?? "");

    /** Logs the refusal, then throws the one refusal text. */
    const abweisen = async (grund: string): Promise<never> => {
      await protokollieren({
        orgId: mitglied.orgId, aktion: "download_verweigert", entity: "ModellFreigabe",
        recordId: recordId || null, detail: { grund }, akteur: mitglied.userId,
      });
      throw new AuthFehler(ABGEWIESEN, 403);
    };

    if (!/^[A-Za-z0-9_-]{1,80}$/.test(recordId)) return await abweisen("record_id ungültig");

    const url = Deno.env.get("SUPABASE_URL");
    const anon = Deno.env.get("SUPABASE_ANON_KEY");
    if (!url || !anon) throw new AuthFehler("Serverkonfiguration fehlt: SUPABASE_URL / SUPABASE_ANON_KEY", 500);
    const alsAufrufer = createClient(url, anon, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${mitglied.token}` } },
    });
    const { data: zeile, error } = await alsAufrufer
      .from("records")
      .select("id, org_id, entity, projekt_id, vergabe_id, data")
      .eq("id", recordId)
      .eq("org_id", mitglied.orgId)
      .eq("entity", "ModellFreigabe")
      .maybeSingle() as { data: Record<string, any> | null; error: { message: string } | null };
    if (error) throw new AuthFehler(`Freigabe nicht lesbar: ${error.message}`, 500);
    if (!zeile) return await abweisen("nicht sichtbar");

    const pfad = freigabePfad(zeile);
    if (!pfad) return await abweisen("Pfad nicht bildbar");
    if (istIfcDatei(pfad) && !mitglied.rechte.can_export_ifc) return await abweisen("IFC-Original ohne can_export_ifc");

    const signiert = await adminClient().storage.from("freigaben").createSignedUrl(pfad, GUELTIG_S);
    if (signiert.error || !signiert.data?.signedUrl) return await abweisen("Datei fehlt im Bucket");

    await protokollieren({
      orgId: mitglied.orgId, projektId: zeile.projekt_id ?? null, aktion: "download", entity: "ModellFreigabe",
      recordId, detail: { datei: zeile.data?.datei ?? null, vergabe_id: zeile.vergabe_id ?? null, gueltig_s: GUELTIG_S },
      akteur: mitglied.userId,
    });
    return jsonAntwort(req, { url: signiert.data.signedUrl, gueltig_s: GUELTIG_S }, 200);
  } catch (err) {
    return fehlerAntwort(req, err, "freigabe");
  }
});
